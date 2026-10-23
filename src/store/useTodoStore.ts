import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  Task,
  Subtask,
  TaskHorizon,
  TaskStatus,
  TaskPriority,
  MonthlyMilestone,
  FocusSessionLog,
  ViewMode,
} from '../types/todo';
import {
  getTodayKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  getWeekKeyFromDateKey,
  getMonthKeyFromDateKey,
  shiftDateKey,
  shiftWeekKey,
  shiftMonthKey,
  addMonthsClamped,
  getSeriesKey,
} from '../lib/dateUtils';
import { parseQuickTaskInput, hasExplicitHorizonToken } from '../lib/nlpParser';
import { setLang, t, type Lang } from '../lib/i18n';
import { setAiSettings, DEFAULT_AI_SETTINGS, type AiSettings } from '../lib/ollamaClient';
import { PRESET_TAGS, normalizeTagName, isTagColor, type TagDef, type TagColor } from '../lib/tags';

export type TimerMode = 'work' | 'short_break' | 'long_break';

export interface TodoStoreState {
  tasks: Task[];
  milestones: MonthlyMilestone[];
  focusLogs: FocusSessionLog[];
  activeView: ViewMode;
  selectedDateKey: string;
  selectedWeekKey: string;
  selectedMonthKey: string;
  activeFocusTaskId: string | null;
  searchQuery: string;
  selectedTagFilter: string | null;
  selectedPriorityFilter: TaskPriority | 'all';
  commandPaletteOpen: boolean;
  backupModalOpen: boolean;
  editingTaskId: string | null;
  /** Day the editor was opened for (routines shown on a day other than their start) */
  editingDateKey: string | null;

  // New UX & Timer State
  timerMode: TimerMode;
  timerDurationMinutes: number;
  timerSecondsLeft: number;
  timerIsRunning: boolean;
  /** Wall-clock ms when the running timer reaches zero (lets it catch up after tab throttling) */
  timerEndsAt: number | null;
  lastDeletedTask: Task | null;
  lastDeletedSeries: Task[];
  darkMode: boolean;
  language: Lang;
  aiSettings: AiSettings;
  aiSettingsOpen: boolean;
  createDrawerOpen: boolean;
  smartDumpOpen: boolean;
  remindersEnabled: boolean;
  /** Reminder occurrences already notified ('YYYY-MM-DD|task|minutes'), pruned to today */
  notifiedReminderKeys: string[];
  lastBackupAt: string | null;
  /** User-defined tag colours (preset list by default) */
  tagDefs: TagDef[];
  tagManagerOpen: boolean;

  // Actions
  addTaskFromRaw: (raw: string, defaultHorizon?: TaskHorizon) => Task;
  addTask: (partial: Partial<Task> & { title: string }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  skipTaskForDate: (id: string, dateKey: string) => void;
  undoDeleteTask: () => void;
  dismissUndo: () => void;
  postponeTaskToTomorrow: (id: string) => void;
  clearAllData: () => void;
  toggleTaskDone: (id: string, targetDateKey?: string) => void;
  toggleTaskMIT: (id: string, dateKey?: string) => void;
  /** Returns the id of a real task for this routine on dateKey, creating one if it is only projected */
  materializeRecurringInstance: (id: string, dateKey: string) => string;
  assignTaskToDay: (id: string, dateKey: string) => void;
  assignTaskToWeekPool: (id: string, weekKey: string) => void;
  assignTaskToMonthPool: (id: string, monthKey: string) => void;
  rolloverOverdueTasks: (action: 'to_today' | 'to_week_pool' | 'delete') => void;
  addSubtask: (taskId: string, title: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string, targetDateKey?: string) => void;
  deleteSubtask: (taskId: string, subtaskId: string) => void;
  addMilestone: (title: string, monthKey?: string) => void;
  toggleMilestone: (id: string) => void;
  deleteMilestone: (id: string) => void;
  logFocusSession: (taskId: string | null, durationMinutes: number) => void;
  setActiveView: (view: ViewMode) => void;
  setSelectedDateKey: (dateKey: string) => void;
  setSelectedWeekKey: (weekKey: string) => void;
  setSelectedMonthKey: (monthKey: string) => void;
  /** With dateKey, a routine is focused on that day's own instance (created if needed) */
  setActiveFocusTaskId: (taskId: string | null, dateKey?: string) => void;
  setSearchQuery: (q: string) => void;
  setSelectedTagFilter: (tag: string | null) => void;
  setSelectedPriorityFilter: (p: TaskPriority | 'all') => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setBackupModalOpen: (open: boolean) => void;
  /** With dateKey, opens that day's instance of a routine if one exists */
  setEditingTaskId: (id: string | null, dateKey?: string) => void;
  exportJson: () => string;
  importJson: (jsonStr: string) => { ok: boolean; error?: string };

  // Timer & UI actions
  setTimerMode: (mode: TimerMode, customMinutes?: number) => void;
  setTimerRunning: (running: boolean) => void;
  resetTimer: () => void;
  tickTimer: () => { completedWorkSession: boolean; completedBreak: boolean };
  toggleDarkMode: () => void;
  setLanguage: (language: Lang) => void;
  setAiSettings: (settings: AiSettings) => void;
  setAiSettingsOpen: (open: boolean) => void;
  setCreateDrawerOpen: (open: boolean) => void;
  setSmartDumpOpen: (open: boolean) => void;
  /** Ends a running work session now and logs the elapsed minutes; returns minutes logged (0 if < 1 min) */
  completeSessionEarly: () => number;
  setRemindersEnabled: (enabled: boolean) => void;
  markRemindersNotified: (keys: string[]) => void;
  markBackedUp: () => void;
  /** Adds a tag definition or changes its colour */
  upsertTagDef: (name: string, color: TagColor) => void;
  removeTagDef: (name: string) => void;
  /** Renames a tag in the tag list and on every task (merges if the new name exists) */
  renameTag: (oldName: string, newName: string) => void;
  setTagManagerOpen: (open: boolean) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}

const isRecurring = (t: Task) => t.recurrence !== 'none';
/** A recurring task with a start date; moving it would move the whole routine */
const isDatedRecurring = (t: Task) => isRecurring(t) && !!t.scheduledDate;
const sameSeries = (a: Task, b: Task) =>
  isRecurring(a) && isRecurring(b) && getSeriesKey(a) === getSeriesKey(b);

/** Fields that describe the routine itself; editing one instance applies them to the whole series */
const SERIES_FIELDS: (keyof Task)[] = [
  'title',
  'notes',
  'priority',
  'tags',
  'estimatedMinutes',
  'scheduledTime',
  'recurrence',
  'recurrenceDays',
  'milestoneId',
];

/**
 * Gives every recurring task a seriesId. Legacy tasks (grouped by recurrence + title) share one.
 */
export function ensureSeriesIds(tasks: Task[]): Task[] {
  const groupIds = new Map<string, string>();
  return tasks.map((t) => {
    if (!isRecurring(t) || t.seriesId) return t;
    const key = getSeriesKey(t);
    let sid = groupIds.get(key);
    if (!sid) {
      sid = generateId();
      groupIds.set(key, sid);
    }
    return { ...t, seriesId: sid };
  });
}

const HORIZONS = ['day', 'week', 'month', 'backlog'] as const;
const STATUSES = ['todo', 'in_progress', 'done'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'custom_days'] as const;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Validates one imported task and fills missing fields. Returns null when id/title are missing. */
function normalizeImportedTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim()) {
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb);
  const scheduledDate = str(r.scheduledDate) && DATE_KEY_RE.test(r.scheduledDate as string)
    ? (r.scheduledDate as string)
    : null;
  const numArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : undefined;

  return {
    id: r.id,
    title: r.title,
    notes: str(r.notes) ?? '',
    horizon: pickEnum(r.horizon, HORIZONS, scheduledDate ? 'day' : 'backlog'),
    status: pickEnum(r.status, STATUSES, 'todo'),
    priority: pickEnum(r.priority, PRIORITIES, 'medium'),
    tags: Array.isArray(r.tags) ? r.tags.filter((x): x is string => typeof x === 'string') : [],
    scheduledDate,
    scheduledTime: str(r.scheduledTime),
    weekKey: str(r.weekKey) ?? (scheduledDate ? getWeekKeyFromDateKey(scheduledDate) : null),
    monthKey: str(r.monthKey) ?? (scheduledDate ? getMonthKeyFromDateKey(scheduledDate) : null),
    milestoneId: str(r.milestoneId),
    isMIT: r.isMIT === true,
    estimatedMinutes: num(r.estimatedMinutes, 25),
    pomodoroCount: num(r.pomodoroCount, 0),
    recurrence: pickEnum(r.recurrence, RECURRENCES, 'none'),
    recurrenceDays: numArray(r.recurrenceDays),
    seriesId: str(r.seriesId) ?? undefined,
    recurrenceAnchorDay: typeof r.recurrenceAnchorDay === 'number' ? r.recurrenceAnchorDay : undefined,
    skippedDates: Array.isArray(r.skippedDates)
      ? r.skippedDates.filter((x): x is string => typeof x === 'string')
      : undefined,
    subtasks: Array.isArray(r.subtasks)
      ? r.subtasks
          .filter(
            (s): s is Subtask =>
              !!s && typeof s === 'object' && typeof (s as Subtask).id === 'string' &&
              typeof (s as Subtask).title === 'string'
          )
          .map((s) => ({ id: s.id, title: s.title, completed: s.completed === true }))
      : [],
    createdAt: str(r.createdAt) ?? new Date().toISOString(),
    completedAt: str(r.completedAt),
  };
}

export const useTodoStore = create<TodoStoreState>()(
  persist(
    (set, get) => {
      const todayKey = getTodayKey();
      const currentWeekKey = getCurrentWeekKey();
      const currentMonthKey = getCurrentMonthKey();

      return {
        tasks: [],
        milestones: [],
        focusLogs: [],
        activeView: 'day',
        selectedDateKey: todayKey,
        selectedWeekKey: currentWeekKey,
        selectedMonthKey: currentMonthKey,
        activeFocusTaskId: null,
        searchQuery: '',
        selectedTagFilter: null,
        selectedPriorityFilter: 'all',
        commandPaletteOpen: false,
        backupModalOpen: false,
        editingTaskId: null,

        // New UX & Timer State
        timerMode: 'work',
        timerDurationMinutes: 25,
        timerSecondsLeft: 25 * 60,
        timerIsRunning: false,
        timerEndsAt: null,
        lastDeletedTask: null,
        lastDeletedSeries: [],
        darkMode: true,
        language: 'en',
        aiSettings: { ...DEFAULT_AI_SETTINGS },
        aiSettingsOpen: false,
        createDrawerOpen: false,
        smartDumpOpen: false,
        remindersEnabled: false,
        notifiedReminderKeys: [],
        lastBackupAt: null,
        tagDefs: PRESET_TAGS.map((t) => ({ ...t })),
        tagManagerOpen: false,
        editingDateKey: null,

        addTaskFromRaw: (raw: string, defaultHorizon?: TaskHorizon) => {
          const parsed = parseQuickTaskInput(raw);
          let horizon = parsed.horizon;
          let scheduledDate = parsed.scheduledDate;
          let weekKey = parsed.weekKey;
          let monthKey = parsed.monthKey;

          if (defaultHorizon && !hasExplicitHorizonToken(raw)) {
            horizon = defaultHorizon;
            if (horizon === 'day') {
              scheduledDate = get().selectedDateKey || getTodayKey();
              weekKey = getWeekKeyFromDateKey(scheduledDate);
              monthKey = getMonthKeyFromDateKey(scheduledDate);
            } else if (horizon === 'week') {
              scheduledDate = null;
              weekKey = get().selectedWeekKey || getCurrentWeekKey();
              monthKey = get().selectedMonthKey || getCurrentMonthKey();
            } else if (horizon === 'month') {
              scheduledDate = null;
              weekKey = null;
              monthKey = get().selectedMonthKey || getCurrentMonthKey();
            } else if (horizon === 'backlog') {
              scheduledDate = null;
              weekKey = null;
              monthKey = null;
            }
          }

          if ((parsed.recurrence === 'daily' || parsed.recurrence === 'custom_days') && !scheduledDate) {
            horizon = 'day';
            scheduledDate = get().selectedDateKey || getTodayKey();
            weekKey = getWeekKeyFromDateKey(scheduledDate);
            monthKey = getMonthKeyFromDateKey(scheduledDate);
          }

          let formattedTitle = parsed.title;
          if (parsed.scheduledTime && !formattedTitle.startsWith(parsed.scheduledTime) && !/^\d{1,2}[:.]\d{2}/.test(formattedTitle)) {
            formattedTitle = `${parsed.scheduledTime} | ${formattedTitle}`;
          }

          const newId = generateId();
          const newTask: Task = {
            id: newId,
            seriesId: parsed.recurrence !== 'none' ? newId : undefined,
            title: formattedTitle,
            notes: '',
            horizon,
            status: 'todo',
            priority: parsed.priority,
            tags: parsed.tags,
            scheduledDate,
            scheduledTime: parsed.scheduledTime || null,
            weekKey,
            monthKey,
            milestoneId: null,
            isMIT: false,
            estimatedMinutes: parsed.estimatedMinutes,
            pomodoroCount: 0,
            recurrence: parsed.recurrence,
            recurrenceDays: parsed.recurrenceDays,
            subtasks: [],
            createdAt: new Date().toISOString(),
            completedAt: null,
          };

          set((state) => ({ tasks: [newTask, ...state.tasks] }));
          return newTask;
        },

        addTask: (partial) => {
          const todayKey = getTodayKey();
          const currentWeekKey = getCurrentWeekKey();
          const currentMonthKey = getCurrentMonthKey();
          const recurrence = partial.recurrence || 'none';
          const horizon =
            recurrence === 'daily' || recurrence === 'custom_days'
              ? 'day'
              : partial.horizon || 'day';

          let scheduledDate =
            partial.scheduledDate !== undefined
              ? partial.scheduledDate
              : horizon === 'day'
              ? todayKey
              : null;

          if ((recurrence === 'daily' || recurrence === 'custom_days') && !scheduledDate) {
            scheduledDate = get().selectedDateKey || todayKey;
          }

          let weekKey =
            partial.weekKey !== undefined
              ? partial.weekKey
              : horizon === 'day' || horizon === 'week'
              ? currentWeekKey
              : null;
          let monthKey = partial.monthKey !== undefined ? partial.monthKey : currentMonthKey;

          if (scheduledDate) {
            weekKey = getWeekKeyFromDateKey(scheduledDate);
            monthKey = getMonthKeyFromDateKey(scheduledDate);
          }

          let taskTitle = partial.title;
          if (partial.scheduledTime && !taskTitle.startsWith(partial.scheduledTime) && !/^\d{1,2}[:.]\d{2}/.test(taskTitle)) {
            taskTitle = `${partial.scheduledTime} | ${taskTitle}`;
          }

          const newId = partial.id || generateId();
          const newTask: Task = {
            id: newId,
            seriesId: recurrence !== 'none' ? partial.seriesId || newId : undefined,
            title: taskTitle,
            notes: partial.notes || '',
            horizon,
            status: partial.status || 'todo',
            priority: partial.priority || 'medium',
            tags: partial.tags || [],
            scheduledDate,
            scheduledTime: partial.scheduledTime !== undefined ? partial.scheduledTime : null,
            weekKey,
            monthKey,
            milestoneId: partial.milestoneId || null,
            isMIT: partial.isMIT || false,
            estimatedMinutes: partial.estimatedMinutes !== undefined ? partial.estimatedMinutes : 25,
            pomodoroCount: partial.pomodoroCount || 0,
            recurrence,
            recurrenceDays: partial.recurrenceDays !== undefined ? partial.recurrenceDays : undefined,
            subtasks: partial.subtasks || [],
            createdAt: partial.createdAt || new Date().toISOString(),
            completedAt: partial.completedAt || null,
          };

          set((state) => ({ tasks: [newTask, ...state.tasks] }));
          return newTask;
        },

        updateTask: (id, patch) => {
          set((state) => {
            const target = state.tasks.find((t) => t.id === id);
            if (!target) return state;

            const updatedTarget: Task = { ...target, ...patch };
            if (
              (updatedTarget.recurrence === 'daily' || updatedTarget.recurrence === 'custom_days') &&
              !updatedTarget.scheduledDate
            ) {
              updatedTarget.scheduledDate = state.selectedDateKey || getTodayKey();
              updatedTarget.horizon = 'day';
            }
            if (updatedTarget.scheduledDate) {
              updatedTarget.weekKey = getWeekKeyFromDateKey(updatedTarget.scheduledDate);
              updatedTarget.monthKey = getMonthKeyFromDateKey(updatedTarget.scheduledDate);
            }
            if (isRecurring(updatedTarget) && !updatedTarget.seriesId) {
              updatedTarget.seriesId = updatedTarget.id;
            }

            // Routine-level edits (title, time, priority...) apply to every instance of the series
            const sharedPatch: Partial<Task> = {};
            for (const field of SERIES_FIELDS) {
              if (field in patch) {
                (sharedPatch as Record<string, unknown>)[field] = updatedTarget[field];
              }
            }
            const hasSharedPatch = Object.keys(sharedPatch).length > 0;

            // Moving a routine's start date: drop pending instances up to the new start,
            // keep completed ones as one-off history so they no longer project forward
            const newStartDate =
              patch.scheduledDate !== undefined && isRecurring(updatedTarget)
                ? updatedTarget.scheduledDate
                : null;

            const nextTasks: Task[] = [];
            for (const t of state.tasks) {
              if (t.id === id) {
                nextTasks.push(updatedTarget);
                continue;
              }
              if (!sameSeries(t, target)) {
                nextTasks.push(t);
                continue;
              }
              let member: Task = hasSharedPatch ? { ...t, ...sharedPatch } : t;
              if (newStartDate && member.scheduledDate && member.scheduledDate <= newStartDate) {
                if (member.status !== 'done') continue;
                member = { ...member, recurrence: 'none' };
              }
              nextTasks.push(member);
            }

            return { tasks: nextTasks };
          });
        },

        deleteTask: (id) => {
          set((state) => {
            const taskToDelete = state.tasks.find((t) => t.id === id) || null;
            if (!taskToDelete) return state;

            // Deleting a routine removes its pending instances. Completed ones stay as
            // one-off history (recurrence 'none') so stats keep them but they stop projecting.
            const recurringDelete = isRecurring(taskToDelete);
            const deletedSeries = recurringDelete
              ? state.tasks.filter((t) => sameSeries(t, taskToDelete))
              : [taskToDelete];

            const deletedIds = new Set(deletedSeries.map((t) => t.id));
            const nextTasks: Task[] = [];
            for (const t of state.tasks) {
              if (!deletedIds.has(t.id)) nextTasks.push(t);
              else if (recurringDelete && t.status === 'done') nextTasks.push({ ...t, recurrence: 'none' });
            }

            return {
              tasks: nextTasks,
              lastDeletedTask: taskToDelete,
              lastDeletedSeries: deletedSeries,
              activeFocusTaskId:
                state.activeFocusTaskId && deletedIds.has(state.activeFocusTaskId)
                  ? null
                  : state.activeFocusTaskId,
              editingTaskId:
                state.editingTaskId && deletedIds.has(state.editingTaskId)
                  ? null
                  : state.editingTaskId,
            };
          });
        },

        skipTaskForDate: (id, dateKey) => {
          set((state) => {
            const target = state.tasks.find((t) => t.id === id);
            if (!target) return state;

            if (target.recurrence === 'none') {
              return {
                tasks: state.tasks.filter((t) => t.id !== id),
                lastDeletedTask: target,
                lastDeletedSeries: [target],
              };
            }

            const seriesTasks = state.tasks.filter((t) => sameSeries(t, target));

            // If there are multiple instances in the series and one is explicitly on dateKey, remove that explicit instance
            // and add dateKey to skippedDates of all remaining instances in the series.
            const hasOtherInstances = seriesTasks.some((t) => t.scheduledDate !== dateKey);

            const nextTasks = state.tasks
              .filter((t) => {
                if (hasOtherInstances && sameSeries(t, target) && t.scheduledDate === dateKey) {
                  return false;
                }
                return true;
              })
              .map((t) => {
                if (sameSeries(t, target)) {
                  const prevSkipped = t.skippedDates || [];
                  const nextSkipped = prevSkipped.includes(dateKey)
                    ? prevSkipped
                    : [...prevSkipped, dateKey];
                  return {
                    ...t,
                    skippedDates: nextSkipped,
                  };
                }
                return t;
              });

            return { tasks: nextTasks };
          });
        },

        undoDeleteTask: () => {
          set((state) => {
            if (!state.lastDeletedTask) return state;
            const toRestore =
              state.lastDeletedSeries && state.lastDeletedSeries.length > 0
                ? state.lastDeletedSeries
                : [state.lastDeletedTask];
            // Kept history copies share ids with the originals; replace them
            const restoreIds = new Set(toRestore.map((t) => t.id));
            return {
              tasks: [...toRestore, ...state.tasks.filter((t) => !restoreIds.has(t.id))],
              lastDeletedTask: null,
              lastDeletedSeries: [],
            };
          });
        },

        dismissUndo: () => {
          set({ lastDeletedTask: null, lastDeletedSeries: [] });
        },

        postponeTaskToTomorrow: (id: string) => {
          const todayKey = getTodayKey();
          set((state) => {
            const task = state.tasks.find((t) => t.id === id);
            // Postponing a dated routine would move the whole series; skip the day instead
            if (!task || isDatedRecurring(task)) return state;

            let baseDate = todayKey;
            if (task.scheduledDate && task.scheduledDate >= todayKey) {
              baseDate = task.scheduledDate;
            }
            const nextDate = shiftDateKey(baseDate, 1);

            return {
              tasks: state.tasks.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      horizon: 'day',
                      scheduledDate: nextDate,
                      weekKey: getWeekKeyFromDateKey(nextDate),
                      monthKey: getMonthKeyFromDateKey(nextDate),
                      isMIT: false,
                    }
                  : t
              ),
            };
          });
        },

        clearAllData: () => {
          set({
            tasks: [],
            milestones: [],
            focusLogs: [],
            lastDeletedTask: null,
            lastDeletedSeries: [],
            activeFocusTaskId: null,
          });
        },

        toggleTaskDone: (id, targetDateKey) => {
          const state = get();
          const task = state.tasks.find((t) => t.id === id);
          if (!task) return;

          const nowIso = new Date().toISOString();

          // If user clicked a projected recurring routine (daily/weekly/monthly) on a different date than task.scheduledDate,
          // instantiate or toggle only that specific targetDateKey!
          if (
            targetDateKey &&
            task.recurrence !== 'none' &&
            task.scheduledDate !== targetDateKey
          ) {
            const existingOnDate = state.tasks.find(
              (t) => t.scheduledDate === targetDateKey && sameSeries(t, task)
            );

            if (existingOnDate) {
              const nextStatus: TaskStatus =
                existingOnDate.status !== 'done' ? 'done' : 'todo';
              set((s) => ({
                tasks: s.tasks.map((t) =>
                  t.id === existingOnDate.id
                    ? {
                        ...t,
                        status: nextStatus,
                        completedAt: nextStatus === 'done' ? nowIso : null,
                      }
                    : t
                ),
              }));
              return;
            }

            const newDayInstance: Task = {
              ...task,
              id: generateId(),
              status: 'done',
              scheduledDate: targetDateKey,
              weekKey: getWeekKeyFromDateKey(targetDateKey),
              monthKey: getMonthKeyFromDateKey(targetDateKey),
              isMIT: false,
              pomodoroCount: 0,
              createdAt: nowIso,
              completedAt: nowIso,
              subtasks: task.subtasks.map((st) => ({
                ...st,
                id: generateId(),
                completed: true,
              })),
            };

            set((s) => ({ tasks: [newDayInstance, ...s.tasks] }));
            return;
          }

          const isNowDone = task.status !== 'done';
          let spawnedRecurringTask: Task | null = null;

          // If transitioning to done and task has recurrence
          if (isNowDone && task.recurrence !== 'none') {
            let nextDate = task.scheduledDate;
            let nextWeek = task.weekKey;
            let nextMonth = task.monthKey;
            let anchorDay: number | undefined = task.recurrenceAnchorDay;

            if (task.recurrence === 'daily') {
              const base = task.scheduledDate || getTodayKey();
              nextDate = shiftDateKey(base, 1);
              nextWeek = getWeekKeyFromDateKey(nextDate);
              nextMonth = getMonthKeyFromDateKey(nextDate);
            } else if (task.recurrence === 'weekly') {
              if (task.scheduledDate) {
                nextDate = shiftDateKey(task.scheduledDate, 7);
                nextWeek = getWeekKeyFromDateKey(nextDate);
                nextMonth = getMonthKeyFromDateKey(nextDate);
              } else if (task.weekKey) {
                nextWeek = shiftWeekKey(task.weekKey, 1);
                nextDate = null;
              }
            } else if (task.recurrence === 'monthly') {
              if (task.scheduledDate) {
                // Shift 1 month, clamped to month end (Jan 31 → Feb 28 → Mar 31)
                anchorDay = task.recurrenceAnchorDay ?? Number(task.scheduledDate.slice(8, 10));
                nextDate = addMonthsClamped(task.scheduledDate, 1, anchorDay);
                nextWeek = getWeekKeyFromDateKey(nextDate);
                nextMonth = getMonthKeyFromDateKey(nextDate);
              } else if (task.monthKey) {
                nextMonth = shiftMonthKey(task.monthKey, 1);
                nextWeek = null;
                nextDate = null;
              }
            }

            // Avoid spawning a duplicate if an instance of this series already exists on nextDate
            const alreadyExistsOnNextDate =
              nextDate !== null &&
              state.tasks.some((t) => t.scheduledDate === nextDate && sameSeries(t, task));

            if (!alreadyExistsOnNextDate) {
              spawnedRecurringTask = {
                ...task,
                id: generateId(),
                status: 'todo',
                scheduledDate: nextDate,
                weekKey: nextWeek,
                monthKey: nextMonth,
                recurrenceAnchorDay: anchorDay,
                pomodoroCount: 0,
                createdAt: nowIso,
                completedAt: null,
                subtasks: task.subtasks.map((st) => ({ ...st, id: generateId(), completed: false })),
              };
            }
          }

          set((s) => {
            const updatedTasks = s.tasks.map((t) =>
              t.id === id
                ? {
                    ...t,
                    status: (isNowDone ? 'done' : 'todo') as TaskStatus,
                    completedAt: isNowDone ? nowIso : null,
                  }
                : t
            );

            if (spawnedRecurringTask) {
              return { tasks: [spawnedRecurringTask, ...updatedTasks] };
            }
            return { tasks: updatedTasks };
          });
        },

        materializeRecurringInstance: (id, dateKey) => {
          const state = get();
          const task = state.tasks.find((t) => t.id === id);
          if (!task || !isRecurring(task) || task.scheduledDate === dateKey) return id;

          const existing = state.tasks.find(
            (t) => t.scheduledDate === dateKey && sameSeries(t, task)
          );
          if (existing) return existing.id;

          const instance: Task = {
            ...task,
            id: generateId(),
            status: 'todo',
            scheduledDate: dateKey,
            weekKey: getWeekKeyFromDateKey(dateKey),
            monthKey: getMonthKeyFromDateKey(dateKey),
            isMIT: false,
            pomodoroCount: 0,
            createdAt: new Date().toISOString(),
            completedAt: null,
            subtasks: task.subtasks.map((st) => ({ ...st, id: generateId(), completed: false })),
          };
          set((s) => ({ tasks: [instance, ...s.tasks] }));
          return instance.id;
        },

        toggleTaskMIT: (rawId, dateKey) => {
          // On a projected routine day, star that day's own instance, not the series start
          const id = dateKey ? get().materializeRecurringInstance(rawId, dateKey) : rawId;
          set((state) => {
            const task = state.tasks.find((t) => t.id === id);
            if (!task) return state;

            // If already MIT, toggle off
            if (task.isMIT) {
              return {
                tasks: state.tasks.map((t) => (t.id === id ? { ...t, isMIT: false } : t)),
              };
            }

            // If toggling on, check current MIT count for that scheduledDate
            const dateKey = task.scheduledDate;
            const currentDayMITs = state.tasks.filter(
              (t) => t.isMIT && t.scheduledDate === dateKey && t.id !== id
            );

            if (currentDayMITs.length >= 3) {
              // Gracefully replace oldest MIT
              const oldestMIT = currentDayMITs[currentDayMITs.length - 1];
              return {
                tasks: state.tasks.map((t) => {
                  if (t.id === id) return { ...t, isMIT: true };
                  if (t.id === oldestMIT.id) return { ...t, isMIT: false };
                  return t;
                }),
              };
            }

            return {
              tasks: state.tasks.map((t) => (t.id === id ? { ...t, isMIT: true } : t)),
            };
          });
        },

        // Dated routines are not moved by assign actions (that would shift the whole series)
        assignTaskToDay: (id, dateKey) => {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === id && !isDatedRecurring(t)
                ? {
                    ...t,
                    horizon: 'day',
                    scheduledDate: dateKey,
                    weekKey: getWeekKeyFromDateKey(dateKey),
                    monthKey: getMonthKeyFromDateKey(dateKey),
                  }
                : t
            ),
          }));
        },

        assignTaskToWeekPool: (id, weekKey) => {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === id && !isDatedRecurring(t)
                ? {
                    ...t,
                    horizon: 'week',
                    scheduledDate: null,
                    weekKey,
                    isMIT: false,
                  }
                : t
            ),
          }));
        },

        assignTaskToMonthPool: (id, monthKey) => {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === id && !isDatedRecurring(t)
                ? {
                    ...t,
                    horizon: 'month',
                    scheduledDate: null,
                    weekKey: null,
                    monthKey,
                    isMIT: false,
                  }
                : t
            ),
          }));
        },

        rolloverOverdueTasks: (action) => {
          const todayKey = getTodayKey();
          const currentWeekKey = getCurrentWeekKey();
          const currentMonthKey = getCurrentMonthKey();

          set((state) => {
            const isOverdue = (t: Task) =>
              t.recurrence === 'none' &&
              t.status !== 'done' &&
              t.scheduledDate !== null &&
              t.scheduledDate < todayKey;

            if (action === 'delete') {
              const removed = state.tasks.filter(isOverdue);
              if (removed.length === 0) return state;
              return {
                tasks: state.tasks.filter((t) => !isOverdue(t)),
                // Enables the undo snackbar
                lastDeletedTask: removed[0],
                lastDeletedSeries: removed,
              };
            }

            return {
              tasks: state.tasks.map((t) => {
                if (!isOverdue(t)) return t;
                if (action === 'to_today') {
                  return {
                    ...t,
                    horizon: 'day',
                    scheduledDate: todayKey,
                    weekKey: currentWeekKey,
                    monthKey: currentMonthKey,
                  };
                }
                if (action === 'to_week_pool') {
                  return {
                    ...t,
                    horizon: 'week',
                    scheduledDate: null,
                    weekKey: currentWeekKey,
                    monthKey: currentMonthKey,
                    isMIT: false,
                  };
                }
                return t;
              }),
            };
          });
        },

        addSubtask: (taskId, title) => {
          if (!title.trim()) return;
          const trimmed = title.trim();
          const newSubtask: Subtask = {
            id: generateId(),
            title: trimmed,
            completed: false,
          };
          set((state) => {
            const targetTask = state.tasks.find((t) => t.id === taskId);

            return {
              tasks: state.tasks.map((t) => {
                if (t.id === taskId) {
                  return { ...t, subtasks: [...t.subtasks, newSubtask] };
                }
                if (targetTask && sameSeries(t, targetTask)) {
                  return {
                    ...t,
                    subtasks: [
                      ...t.subtasks,
                      { id: generateId(), title: trimmed, completed: false },
                    ],
                  };
                }
                return t;
              }),
            };
          });
        },

        toggleSubtask: (taskId, subtaskId, targetDateKey) => {
          const state = get();
          const task = state.tasks.find((t) => t.id === taskId);
          if (!task) return;

          const effectiveDateKey =
            targetDateKey || (state.activeView === 'day' ? state.selectedDateKey : null);

          // If toggling a subtask on a projected recurring routine for a date different from task.scheduledDate,
          // instantiate or update only that specific day's task so other days' subtasks stay untouched!
          if (
            effectiveDateKey &&
            task.recurrence !== 'none' &&
            task.scheduledDate !== effectiveDateKey
          ) {
            const clickedSubtask = task.subtasks.find((st) => st.id === subtaskId);
            const existingOnDate = state.tasks.find(
              (t) => t.scheduledDate === effectiveDateKey && sameSeries(t, task)
            );

            if (existingOnDate) {
              set((s) => ({
                tasks: s.tasks.map((t) => {
                  if (t.id !== existingOnDate.id) return t;
                  return {
                    ...t,
                    subtasks: t.subtasks.map((st) =>
                      st.id === subtaskId ||
                      (clickedSubtask && st.title === clickedSubtask.title)
                        ? { ...st, completed: !st.completed }
                        : st
                    ),
                  };
                }),
              }));
              return;
            }

            const newInstanceId = generateId();
            const newDayInstance: Task = {
              ...task,
              id: newInstanceId,
              status: 'todo',
              scheduledDate: effectiveDateKey,
              weekKey: getWeekKeyFromDateKey(effectiveDateKey),
              monthKey: getMonthKeyFromDateKey(effectiveDateKey),
              isMIT: false,
              pomodoroCount: 0,
              createdAt: new Date().toISOString(),
              completedAt: null,
              subtasks: task.subtasks.map((st) => ({
                ...st,
                id: generateId(),
                completed: st.id === subtaskId ? true : false,
              })),
            };

            set((s) => ({
              tasks: [newDayInstance, ...s.tasks],
              editingTaskId: s.editingTaskId === taskId ? newInstanceId : s.editingTaskId,
            }));
            return;
          }

          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (t.id !== taskId) return t;
              return {
                ...t,
                subtasks: t.subtasks.map((st) =>
                  st.id === subtaskId ? { ...st, completed: !st.completed } : st
                ),
              };
            }),
          }));
        },

        deleteSubtask: (taskId, subtaskId) => {
          set((state) => {
            const targetTask = state.tasks.find((t) => t.id === taskId);
            const targetSubtask = targetTask?.subtasks.find((st) => st.id === subtaskId);

            return {
              tasks: state.tasks.map((t) => {
                if (t.id === taskId) {
                  return {
                    ...t,
                    subtasks: t.subtasks.filter((st) => st.id !== subtaskId),
                  };
                }
                if (targetTask && targetSubtask && sameSeries(t, targetTask)) {
                  return {
                    ...t,
                    subtasks: t.subtasks.filter((st) => st.title !== targetSubtask.title),
                  };
                }
                return t;
              }),
            };
          });
        },

        addMilestone: (title, monthKey) => {
          if (!title.trim()) return;
          const newMilestone: MonthlyMilestone = {
            id: generateId(),
            title: title.trim(),
            monthKey: monthKey || get().selectedMonthKey || getCurrentMonthKey(),
            completed: false,
          };
          set((state) => ({ milestones: [newMilestone, ...state.milestones] }));
        },

        toggleMilestone: (id) => {
          set((state) => ({
            milestones: state.milestones.map((m) =>
              m.id === id ? { ...m, completed: !m.completed } : m
            ),
          }));
        },

        deleteMilestone: (id) => {
          set((state) => ({
            milestones: state.milestones.filter((m) => m.id !== id),
            tasks: state.tasks.map((t) =>
              t.milestoneId === id ? { ...t, milestoneId: null } : t
            ),
          }));
        },

        logFocusSession: (taskId, durationMinutes) => {
          const newLog: FocusSessionLog = {
            id: generateId(),
            taskId,
            durationMinutes,
            completedAt: new Date().toISOString(),
            dateKey: getTodayKey(),
          };
          set((state) => ({
            focusLogs: [newLog, ...state.focusLogs],
            tasks: taskId
              ? state.tasks.map((t) =>
                  t.id === taskId ? { ...t, pomodoroCount: t.pomodoroCount + 1 } : t
                )
              : state.tasks,
          }));
        },

        setActiveView: (view) => set({ activeView: view }),
        setSelectedDateKey: (dateKey) => set({ selectedDateKey: dateKey }),
        setSelectedWeekKey: (weekKey) => set({ selectedWeekKey: weekKey }),
        setSelectedMonthKey: (monthKey) => set({ selectedMonthKey: monthKey }),
        setActiveFocusTaskId: (taskId, dateKey) => {
          const id = taskId && dateKey ? get().materializeRecurringInstance(taskId, dateKey) : taskId;
          set({ activeFocusTaskId: id });
        },
        setSearchQuery: (searchQuery) => set({ searchQuery }),
        setSelectedTagFilter: (selectedTagFilter) => set({ selectedTagFilter }),
        setSelectedPriorityFilter: (selectedPriorityFilter) =>
          set({ selectedPriorityFilter }),
        setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
        setBackupModalOpen: (backupModalOpen) => set({ backupModalOpen }),
        setEditingTaskId: (id, dateKey) => {
          if (!id || !dateKey) {
            set({ editingTaskId: id, editingDateKey: null });
            return;
          }
          const state = get();
          const task = state.tasks.find((t) => t.id === id);
          // Prefer the routine's real instance on that day; otherwise remember the day
          const dayInstance =
            task && isRecurring(task) && task.scheduledDate !== dateKey
              ? state.tasks.find((t) => t.scheduledDate === dateKey && sameSeries(t, task))
              : undefined;
          set({ editingTaskId: dayInstance ? dayInstance.id : id, editingDateKey: dateKey });
        },

        exportJson: () => {
          const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            tasks: get().tasks,
            milestones: get().milestones,
            focusLogs: get().focusLogs,
            tagDefs: get().tagDefs,
          };
          return JSON.stringify(data, null, 2);
        },

        importJson: (jsonStr) => {
          try {
            const parsed = JSON.parse(jsonStr);
            if (!parsed || !Array.isArray(parsed.tasks)) {
              return { ok: false, error: t('Invalid JSON format: "tasks" array not found.', 'Geçersiz JSON formatı: "tasks" dizisi bulunamadı.') };
            }
            const tasks: Task[] = [];
            for (let i = 0; i < parsed.tasks.length; i++) {
              const normalized = normalizeImportedTask(parsed.tasks[i]);
              if (!normalized) {
                return {
                  ok: false,
                  error: t(
                    `Invalid task record (#${i + 1}): "id" and "title" are required.`,
                    `Geçersiz görev kaydı (#${i + 1}): "id" ve "title" alanları zorunludur.`
                  ),
                };
              }
              tasks.push(normalized);
            }

            const milestones: MonthlyMilestone[] = (Array.isArray(parsed.milestones) ? parsed.milestones : [])
              .filter(
                (m: unknown): m is MonthlyMilestone =>
                  !!m && typeof m === 'object' &&
                  typeof (m as MonthlyMilestone).id === 'string' &&
                  typeof (m as MonthlyMilestone).title === 'string' &&
                  typeof (m as MonthlyMilestone).monthKey === 'string'
              )
              .map((m: MonthlyMilestone) => ({ ...m, completed: m.completed === true }));

            const focusLogs: FocusSessionLog[] = (Array.isArray(parsed.focusLogs) ? parsed.focusLogs : []).filter(
              (l: unknown): l is FocusSessionLog =>
                !!l && typeof l === 'object' &&
                typeof (l as FocusSessionLog).id === 'string' &&
                typeof (l as FocusSessionLog).dateKey === 'string' &&
                typeof (l as FocusSessionLog).durationMinutes === 'number'
            );

            // Older backups have no tag colours; keep the current ones then
            const tagDefs: TagDef[] | undefined = Array.isArray(parsed.tagDefs)
              ? parsed.tagDefs.filter(
                  (d: unknown): d is TagDef =>
                    !!d && typeof d === 'object' &&
                    typeof (d as TagDef).name === 'string' &&
                    isTagColor((d as TagDef).color)
                )
              : undefined;

            set({
              tasks: ensureSeriesIds(tasks),
              milestones,
              focusLogs,
              ...(tagDefs ? { tagDefs } : {}),
              // Old ids may not exist in the imported data
              editingTaskId: null,
              editingDateKey: null,
              activeFocusTaskId: null,
              lastDeletedTask: null,
              lastDeletedSeries: [],
            });
            return { ok: true };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('JSON parse error', 'JSON ayrıştırma hatası');
            return { ok: false, error: msg };
          }
        },

        setTimerMode: (mode, customMinutes) => {
          const defaultMins = mode === 'work' ? 25 : mode === 'short_break' ? 5 : 15;
          const duration = customMinutes !== undefined ? customMinutes : defaultMins;
          set({
            timerMode: mode,
            timerDurationMinutes: duration,
            timerSecondsLeft: duration * 60,
            timerIsRunning: false,
            timerEndsAt: null,
          });
        },

        setTimerRunning: (running) => {
          set((state) => {
            if (running) {
              return {
                timerIsRunning: true,
                timerEndsAt: Date.now() + state.timerSecondsLeft * 1000,
              };
            }
            const clockLeft = state.timerEndsAt
              ? Math.max(1, Math.ceil((state.timerEndsAt - Date.now()) / 1000))
              : state.timerSecondsLeft;
            return {
              timerIsRunning: false,
              timerEndsAt: null,
              timerSecondsLeft: Math.min(state.timerSecondsLeft, clockLeft),
            };
          });
        },

        resetTimer: () => {
          set((state) => ({
            timerIsRunning: false,
            timerEndsAt: null,
            timerSecondsLeft: state.timerDurationMinutes * 60,
          }));
        },

        tickTimer: () => {
          const state = get();
          if (!state.timerIsRunning) {
            return { completedWorkSession: false, completedBreak: false };
          }

          // At least one second per tick, more if the tab was throttled or the page reloaded
          const clockLeft = state.timerEndsAt
            ? Math.ceil((state.timerEndsAt - Date.now()) / 1000)
            : Infinity;
          const nextLeft = Math.min(state.timerSecondsLeft - 1, clockLeft);

          if (nextLeft > 0) {
            set({ timerSecondsLeft: nextLeft });
            return { completedWorkSession: false, completedBreak: false };
          }

          // Timer finished
          const wasWork = state.timerMode === 'work';
          set({
            timerIsRunning: false,
            timerEndsAt: null,
            timerSecondsLeft: state.timerDurationMinutes * 60,
          });

          if (wasWork) {
            get().logFocusSession(state.activeFocusTaskId, state.timerDurationMinutes);
            return { completedWorkSession: true, completedBreak: false };
          }

          return { completedWorkSession: false, completedBreak: true };
        },

        toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

        setLanguage: (language) => {
          setLang(language);
          set({ language });
        },

        setAiSettings: (aiSettings) => {
          setAiSettings(aiSettings);
          set({ aiSettings });
        },

        setAiSettingsOpen: (open) => set({ aiSettingsOpen: open }),

        setCreateDrawerOpen: (open) => set({ createDrawerOpen: open }),
        upsertTagDef: (rawName, color) => {
          const name = normalizeTagName(rawName);
          if (!name) return;
          set((state) => ({
            tagDefs: state.tagDefs.some((d) => d.name === name)
              ? state.tagDefs.map((d) => (d.name === name ? { ...d, color } : d))
              : [...state.tagDefs, { name, color }],
          }));
        },
        removeTagDef: (name) =>
          set((state) => ({ tagDefs: state.tagDefs.filter((d) => d.name !== name) })),
        renameTag: (oldName, rawNew) => {
          const name = normalizeTagName(rawNew);
          if (!name || name === oldName) return;
          set((state) => {
            const hasNew = state.tagDefs.some((d) => d.name === name);
            return {
              tagDefs: hasNew
                ? state.tagDefs.filter((d) => d.name !== oldName)
                : state.tagDefs.map((d) => (d.name === oldName ? { ...d, name } : d)),
              tasks: state.tasks.map((t) =>
                t.tags.includes(oldName)
                  ? { ...t, tags: [...new Set(t.tags.map((tag) => (tag === oldName ? name : tag)))] }
                  : t
              ),
              selectedTagFilter: state.selectedTagFilter === oldName ? name : state.selectedTagFilter,
            };
          });
        },
        setTagManagerOpen: (open) => set({ tagManagerOpen: open }),

        setSmartDumpOpen: (open) => set({ smartDumpOpen: open }),

        completeSessionEarly: () => {
          const state = get();
          const totalSeconds = state.timerDurationMinutes * 60;
          const leftSeconds =
            state.timerIsRunning && state.timerEndsAt
              ? Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000))
              : state.timerSecondsLeft;
          const elapsedMinutes = Math.round((totalSeconds - leftSeconds) / 60);

          set({
            timerIsRunning: false,
            timerEndsAt: null,
            timerSecondsLeft: totalSeconds,
          });

          if (state.timerMode !== 'work' || elapsedMinutes < 1) return 0;
          get().logFocusSession(state.activeFocusTaskId, elapsedMinutes);
          return elapsedMinutes;
        },

        setRemindersEnabled: (enabled) => set({ remindersEnabled: enabled }),

        markRemindersNotified: (keys) => {
          const todayPrefix = `${getTodayKey()}|`;
          set((state) => ({
            notifiedReminderKeys: [
              ...state.notifiedReminderKeys.filter((k) => k.startsWith(todayPrefix)),
              ...keys,
            ],
          }));
        },

        markBackedUp: () => set({ lastBackupAt: new Date().toISOString() }),
      };
    },
    {
      name: 'todo-plus-storage-v3',
      // v1: recurring tasks get a shared seriesId
      // v2: dark theme becomes the default (switched on once for existing data)
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<TodoStoreState> | undefined;
        if (s && Array.isArray(s.tasks)) {
          s.tasks = ensureSeriesIds(s.tasks);
        }
        if (s && version < 2) {
          s.darkMode = true;
        }
        return s as TodoStoreState;
      },
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            if (!localStorage.getItem('todo-plus-storage-v3') && localStorage.getItem('todo-plus-storage-v2')) {
              const oldData = JSON.parse(localStorage.getItem('todo-plus-storage-v2') || '{}');
              if (oldData && oldData.state) {
                localStorage.setItem('todo-plus-storage-v3', JSON.stringify(oldData));
              }
            }
          } catch (e) {
            console.error('Migration failed:', e);
          }
          return window.localStorage;
        }
        const memMap = new Map<string, string>();
        return {
          getItem: (name: string) => memMap.get(name) ?? null,
          setItem: (name: string, value: string) => {
            memMap.set(name, value);
          },
          removeItem: (name: string) => {
            memMap.delete(name);
          },
        };
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          setLang(state.language);
          setAiSettings({ ...DEFAULT_AI_SETTINGS, ...state.aiSettings });
        }
      },
      partialize: (state) => ({
        tasks: state.tasks,
        milestones: state.milestones,
        focusLogs: state.focusLogs,
        darkMode: state.darkMode,
        language: state.language,
        aiSettings: state.aiSettings,
        remindersEnabled: state.remindersEnabled,
        notifiedReminderKeys: state.notifiedReminderKeys,
        lastBackupAt: state.lastBackupAt,
        tagDefs: state.tagDefs,
        // Timer survives a page reload
        timerMode: state.timerMode,
        timerDurationMinutes: state.timerDurationMinutes,
        timerSecondsLeft: state.timerSecondsLeft,
        timerIsRunning: state.timerIsRunning,
        timerEndsAt: state.timerEndsAt,
        activeFocusTaskId: state.activeFocusTaskId,
      }),
    }
  )
);

