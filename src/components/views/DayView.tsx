import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Play,
  Trash2,
  Edit3,
  Layers,
  ArrowRight,
  CalendarOff,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTodoStore } from '../../store/useTodoStore';
import { TaskMeta } from '../ui/tags';
import { getTaskColorClass } from '../../lib/tags';
import type { Task } from '../../types/todo';
import {
  formatTurkishDate,
  shiftDateKey,
  getTodayKey,
  getTasksForDate,
  sortTasksByTimeAndStatus,
  splitTaskTimeAndTitle,
  getCurrentWeekKey,
} from '../../lib/dateUtils';
import { getPullablePoolTasksForDay } from '../../lib/pools';
import {
  cn,
  Checkbox,
  TooltipWrapper,
} from '../ui/primitives';
import {
  formatMinutes,
  matchesTaskFilters,
  isDatedRoutine,
  DAY_CAPACITY_MINUTES,
} from '../ui/taskUi';
import { t as tt } from '../../lib/i18n';

export function DayView() {
  const {
    tasks,
    selectedDateKey,
    selectedWeekKey,
    searchQuery,
    selectedTagFilter,
    selectedPriorityFilter,
    deleteTask,
    skipTaskForDate,
    toggleTaskDone,
    toggleTaskMIT,
    assignTaskToDay,
    assignTaskToWeekPool,
    postponeTaskToTomorrow,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    setSelectedDateKey,
    setActiveFocusTaskId,
    setActiveView,
    setEditingTaskId,
    tagDefs,
  } = useTodoStore(
    useShallow((s) => ({
      tasks: s.tasks,
      selectedDateKey: s.selectedDateKey,
      selectedWeekKey: s.selectedWeekKey,
      searchQuery: s.searchQuery,
      selectedTagFilter: s.selectedTagFilter,
      selectedPriorityFilter: s.selectedPriorityFilter,
      deleteTask: s.deleteTask,
      skipTaskForDate: s.skipTaskForDate,
      toggleTaskDone: s.toggleTaskDone,
      toggleTaskMIT: s.toggleTaskMIT,
      assignTaskToDay: s.assignTaskToDay,
      assignTaskToWeekPool: s.assignTaskToWeekPool,
      postponeTaskToTomorrow: s.postponeTaskToTomorrow,
      addSubtask: s.addSubtask,
      toggleSubtask: s.toggleSubtask,
      deleteSubtask: s.deleteSubtask,
      setSelectedDateKey: s.setSelectedDateKey,
      setActiveFocusTaskId: s.setActiveFocusTaskId,
      setActiveView: s.setActiveView,
      setEditingTaskId: s.setEditingTaskId,
      tagDefs: s.tagDefs,
    }))
  );

  const [expandedSubtaskTaskId, setExpandedSubtaskTaskId] = useState<string | null>(null);
  const [newSubtaskInput, setNewSubtaskInput] = useState<{ [taskId: string]: string }>({});

  const todayKey = getTodayKey();
  const isToday = selectedDateKey === todayKey;

  // Filter tasks belonging to selectedDateKey (including daily fixed routines)
  const dailyTasks = useMemo(() => {
    return getTasksForDate(tasks, selectedDateKey);
  }, [tasks, selectedDateKey]);

  // Capacity calculations
  const { totalEstimatedMinutes, isOverCapacity } = useMemo(() => {
    const total = dailyTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
    return {
      totalEstimatedMinutes: total,
      isOverCapacity: total > DAY_CAPACITY_MINUTES,
    };
  }, [dailyTasks]);

  // Filter with global filters (search, tag, priority)
  const filteredDailyTasks = useMemo(() => {
    return dailyTasks.filter((t) =>
      matchesTaskFilters(t, { searchQuery, selectedTagFilter, selectedPriorityFilter })
    );
  }, [dailyTasks, searchQuery, selectedTagFilter, selectedPriorityFilter]);

  // Top 3 MITs (sorted chronologically by time, completed at bottom)
  const mitTasks = useMemo(() => {
    return sortTasksByTimeAndStatus(filteredDailyTasks.filter((t) => t.isMIT)).slice(0, 3);
  }, [filteredDailyTasks]);

  // Remaining daily tasks (non-MIT, sorted chronologically by time, completed automatically sunk to bottom)
  const nonMitTasks = useMemo(() => {
    return sortTasksByTimeAndStatus(filteredDailyTasks.filter((t) => !t.isMIT));
  }, [filteredDailyTasks]);

  // Weekly pool tasks available for drawing into today
  const weeklyPoolTasks = useMemo(() => {
    return getPullablePoolTasksForDay(tasks, selectedDateKey, getCurrentWeekKey());
  }, [tasks, selectedDateKey]);

  const handleAddSubtaskSubmit = (taskId: string) => {
    const title = (newSubtaskInput[taskId] || '').trim();
    if (!title) return;
    addSubtask(taskId, title);
    setNewSubtaskInput((prev) => ({ ...prev, [taskId]: '' }));
  };

  // One task: title on top, a single muted meta line below, actions on hover.
  // `mit` = shown in the Öncelikli card list instead of the plain list.
  const renderTask = (task: Task, mit: boolean) => {
    const isDone = task.status === 'done';
    const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
    const taskExpandKey =
      task.recurrence === 'daily' ? `daily:${task.title.trim().toLowerCase()}` : task.id;
    const isSubtaskOpen = expandedSubtaskTaskId === taskExpandKey;
    const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(task.title);
    const actionBtn = 'p-1.5 hover:text-stone-900 rounded hover:bg-stone-100 transition-colors cursor-pointer';

    return (
      <div key={task.id} className="group">
        <div
          className={cn(
            'flex flex-col sm:flex-row sm:items-start justify-between gap-2 px-4 py-3 transition-colors',
            mit
              ? 'bg-white border border-stone-200/80 border-l-2 border-l-stone-900 rounded-lg hover:border-stone-300 shadow-xs'
              : 'border-b border-stone-200/70 border-l-4 border-l-transparent hover:bg-stone-50/70',
            getTaskColorClass(task.tags, tagDefs)
          )}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Checkbox
              checked={isDone}
              onCheckedChange={() => toggleTaskDone(task.id, selectedDateKey)}
              className="h-5 w-5 border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0 mt-0.5 cursor-pointer"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <span
                onClick={() => setEditingTaskId(task.id, selectedDateKey)}
                className={cn(
                  'block text-sm font-medium text-stone-900 cursor-pointer hover:text-stone-600 transition-colors break-words leading-snug',
                  isDone && 'line-through text-stone-400 font-normal'
                )}
              >
                {cleanTitle}
              </span>
              <TaskMeta
                task={task}
                timeBadge={timeBadge}
                extra={
                  task.subtasks.length > 0 && (
                    <button
                      onClick={() => setExpandedSubtaskTaskId(isSubtaskOpen ? null : taskExpandKey)}
                      className="hover:text-stone-800 underline-offset-2 hover:underline cursor-pointer"
                      title={tt('Show/hide steps', 'Alt adımları göster/gizle')}
                    >
                      {completedSubtasks}/{task.subtasks.length} {tt('steps', 'adım')}
                    </button>
                  )
                }
              />
            </div>
          </div>

          {/* Touch-visible & desktop hover actions */}
          <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 text-stone-400 shrink-0 pl-8 sm:pl-0">
            {/* Routines are skipped per day instead of postponed */}
            {!isDatedRoutine(task) && (
              <TooltipWrapper content={tt('Postpone to tomorrow', 'Yarına Ertele')}>
                <button onClick={() => postponeTaskToTomorrow(task.id)} className={actionBtn}>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </TooltipWrapper>
            )}
            <TooltipWrapper content={mit ? tt('Remove from priorities', 'Öncelikli listeden çıkar') : tt('Make a priority', 'Öncelikli yap')}>
              <button onClick={() => toggleTaskMIT(task.id, selectedDateKey)} className={actionBtn}>
                <Star className={cn('h-4 w-4', mit && 'fill-current')} />
              </button>
            </TooltipWrapper>
            <TooltipWrapper content={tt('Focus (Pomodoro)', 'Odaklan (Pomodoro)')}>
              <button
                onClick={() => {
                  setActiveFocusTaskId(task.id, selectedDateKey);
                  setActiveView('focus');
                }}
                className={actionBtn}
              >
                <Play className="h-4 w-4" />
              </button>
            </TooltipWrapper>
            {!isDatedRoutine(task) && (
              <TooltipWrapper content={tt('Send to weekly pool', 'Haftalık havuza gönder')}>
                <button onClick={() => assignTaskToWeekPool(task.id, selectedWeekKey)} className={actionBtn}>
                  <Layers className="h-4 w-4" />
                </button>
              </TooltipWrapper>
            )}
            <TooltipWrapper content={tt('Edit', 'Düzenle')}>
              <button onClick={() => setEditingTaskId(task.id, selectedDateKey)} className={actionBtn}>
                <Edit3 className="h-4 w-4" />
              </button>
            </TooltipWrapper>
            {task.recurrence !== 'none' && (
              <TooltipWrapper content={tt('Skip just this day', 'Sadece Bu Günlük Atla')}>
                <button
                  onClick={() => skipTaskForDate(task.id, selectedDateKey)}
                  className="p-1.5 hover:text-amber-700 rounded hover:bg-amber-50 transition-colors cursor-pointer"
                >
                  <CalendarOff className="h-4 w-4" />
                </button>
              </TooltipWrapper>
            )}
            <TooltipWrapper content={task.recurrence !== 'none' ? tt('Delete whole routine', 'Rutini Tamamen Sil') : tt('Delete', 'Sil')}>
              <button
                onClick={() => deleteTask(task.id)}
                className="p-1.5 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </TooltipWrapper>
          </div>
        </div>

        {/* Subtask Panel */}
        {isSubtaskOpen && (
          <div className="pl-8 pr-4 py-2 space-y-1.5 border-l-2 border-stone-200 ml-6 mb-2">
            {task.subtasks.map((st) => (
              <div
                key={st.id}
                className="flex items-center justify-between group/subtask gap-2 text-sm text-stone-600 hover:bg-stone-50 py-1 px-1.5 rounded transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Checkbox
                    checked={st.completed}
                    onCheckedChange={() => toggleSubtask(task.id, st.id, selectedDateKey)}
                    className="h-4 w-4 border-stone-300 data-[state=checked]:bg-stone-800 shrink-0 cursor-pointer"
                  />
                  <span className={cn('break-words', st.completed && 'line-through text-stone-400')}>
                    {st.title}
                  </span>
                </div>
                <TooltipWrapper content={tt('Delete step', 'Alt adımı sil')}>
                  <button
                    type="button"
                    onClick={() => deleteSubtask(task.id, st.id)}
                    className="opacity-100 sm:opacity-0 sm:group-hover/subtask:opacity-100 p-0.5 text-stone-400 hover:text-rose-600 transition-opacity cursor-pointer rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipWrapper>
              </div>
            ))}
            <input
              type="text"
              value={newSubtaskInput[task.id] || ''}
              onChange={(e) => setNewSubtaskInput((prev) => ({ ...prev, [task.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSubtaskSubmit(task.id);
                }
              }}
              placeholder={tt('+ Add step (Enter)', '+ Alt adım ekle (Enter)')}
              className="h-8 text-sm px-2.5 rounded bg-stone-50 border border-stone-200 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 w-full"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12 font-sans text-stone-900">
      {/* 1. MINIMAL DATE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 border-b border-stone-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            {isToday ? tt('Today', 'Bugün') : formatTurkishDate(selectedDateKey)}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {isToday ? (
              formatTurkishDate(selectedDateKey)
            ) : (
              <button
                onClick={() => setSelectedDateKey(todayKey)}
                className="hover:text-stone-800 transition-colors underline underline-offset-2"
              >
                {tt('Back to today', 'Bugüne Dön')}
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-6 self-start sm:self-auto">
          {/* Capacity Progress Bar */}
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-stone-500">
              {tt('Planned:', 'Planlanan:')} {formatMinutes(totalEstimatedMinutes)} / {formatMinutes(480)}
            </span>
            <div className="h-1 w-24 bg-stone-200 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  isOverCapacity ? 'bg-amber-600' : 'bg-stone-800'
                )}
                style={{
                  width: `${Math.min(100, Math.round((totalEstimatedMinutes / DAY_CAPACITY_MINUTES) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Navigation Controls: < Today > */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDateKey(shiftDateKey(selectedDateKey, -1))}
              className="p-1 rounded text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors"
              title={tt('Previous day', 'Önceki Gün')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {!isToday && (
              <button
                onClick={() => setSelectedDateKey(todayKey)}
                className="px-2 py-0.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-200/50 rounded transition-colors font-medium"
              >
                {tt('Today', 'Bugün')}
              </button>
            )}
            <button
              onClick={() => setSelectedDateKey(shiftDateKey(selectedDateKey, 1))}
              className="p-1 rounded text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors"
              title={tt('Next day', 'Sonraki Gün')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. SECTION 1: PRIORITIES (TOP 3 MIT) */}
      {mitTasks.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-stone-500 mb-2">{tt('Priorities', 'Öncelikli')}</h2>
          <div className="space-y-2">{mitTasks.map((task) => renderTask(task, true))}</div>
        </div>
      )}

      {/* 3. SECTION 2: TASKS */}
      <div>
        <h2 className="text-sm font-semibold text-stone-500 mb-1">
          {tt('Tasks', 'Görevler')} {nonMitTasks.length > 0 && <span className="font-normal text-stone-400">({nonMitTasks.length})</span>}
        </h2>

        {nonMitTasks.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">
            {mitTasks.length > 0
              ? tt('All tasks are in the priority list.', 'Tüm görevler öncelikli listesinde.')
              : tt('No tasks planned for today.', 'Bugün için planlanan görev bulunmuyor.')}
          </div>
        ) : (
          <div className="border-t border-stone-200/70">{nonMitTasks.map((task) => renderTask(task, false))}</div>
        )}
      </div>

      {/* 4. COLLAPSIBLE WEEKLY POOL SECTION AT BOTTOM */}
      {weeklyPoolTasks.length > 0 && (
        <details className="mt-10 pt-4 border-t border-stone-200/70 group/details">
          <summary className="cursor-pointer text-sm font-semibold text-stone-500 hover:text-stone-800 flex items-center justify-between select-none list-none">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-stone-400" />
              {tt(`Pull from weekly pool (${weeklyPoolTasks.length} tasks)`, `Haftalık Havuzdan Bugüne Çek (${weeklyPoolTasks.length} görev)`)}
            </span>
            <span className="text-xs text-stone-400 group-open/details:rotate-180 transition-transform">
              ▼
            </span>
          </summary>
          <div className="mt-3 divide-y divide-stone-200/60 rounded-lg border border-stone-200/80 bg-white overflow-hidden shadow-sm">
            {weeklyPoolTasks.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'flex items-center justify-between px-4 py-3 text-sm border-l-4 border-l-transparent hover:bg-stone-50/80 transition-colors',
                  getTaskColorClass(t.tags, tagDefs)
                )}
              >
                <div className="flex items-center gap-2 min-w-0 mr-3">
                  <span className="text-stone-800 truncate">{t.title}</span>
                  {t.estimatedMinutes > 0 && (
                    <span className="text-stone-400 shrink-0">· {formatMinutes(t.estimatedMinutes)}</span>
                  )}
                </div>
                <button
                  onClick={() => assignTaskToDay(t.id, selectedDateKey)}
                  className="text-xs font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 px-2.5 py-1 rounded transition-colors shrink-0"
                >
                  {tt('+ Move to today', '+ Bugüne Al')}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
