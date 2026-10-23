import { Task, FocusSessionLog } from '../types/todo';
import { getTodayKey, shiftDateKey, getTasksForDate, getSeriesKey } from './dateUtils';
import { t as tt } from './i18n';

/**
 * One-off tasks only. Routine instances (and their kept history) carry a seriesId; every
 * completed routine spawns a new open instance, which would otherwise drag the rate down.
 */
export function getOneOffTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.recurrence === 'none' && !t.seriesId);
}

export function computeCompletionStats(tasks: Task[]) {
  const oneOff = getOneOffTasks(tasks);
  const doneTasks = oneOff.filter((t) => t.status === 'done').length;
  const totalTasks = oneOff.length;

  const mitTasks = tasks.filter((t) => t.isMIT);
  const doneMIT = mitTasks.filter((t) => t.status === 'done').length;

  return {
    totalTasks,
    doneTasks,
    rate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    totalMIT: mitTasks.length,
    doneMIT,
    mitRate: mitTasks.length > 0 ? Math.round((doneMIT / mitTasks.length) * 100) : 0,
  };
}

export interface RoutineStat {
  seriesKey: string;
  title: string;
  /** Days in the window the routine was due (skipped days and an unfinished today excluded) */
  scheduledDays: number;
  doneDays: number;
  rate: number;
  /** Consecutive due days completed, counting back from today (or yesterday if today is open) */
  streak: number;
  /** Every day of the window, oldest → newest */
  calendar: { dateKey: string; status: RoutineDayStatus }[];
}

/** done / missed = due that day; none = not due or skipped; pending = due today, not done yet */
export type RoutineDayStatus = 'done' | 'missed' | 'none' | 'pending';

/**
 * Per-routine adherence over the last `windowDays` days ending today.
 */
export function computeRoutineStats(tasks: Task[], todayKey: string, windowDays = 30): RoutineStat[] {
  // For each routine: ordered list (oldest → newest) of due days with done flag
  const history = new Map<string, { title: string; days: { dateKey: string; done: boolean }[] }>();
  const windowKeys: string[] = [];
  const pendingToday = new Set<string>();

  for (let i = windowDays - 1; i >= 0; i--) {
    const dateKey = shiftDateKey(todayKey, -i);
    windowKeys.push(dateKey);
    for (const t of getTasksForDate(tasks, dateKey)) {
      if (t.recurrence === 'none') continue;
      const done = t.status === 'done';
      if (dateKey === todayKey && !done) {
        pendingToday.add(getSeriesKey(t)); // today is still open
        continue;
      }
      const key = getSeriesKey(t);
      const entry = history.get(key) || { title: t.title, days: [] };
      entry.title = t.title;
      entry.days.push({ dateKey, done });
      history.set(key, entry);
    }
  }

  const stats: RoutineStat[] = [];
  for (const [seriesKey, { title, days }] of history) {
    const doneDays = days.filter((d) => d.done).length;
    let streak = 0;
    for (let i = days.length - 1; i >= 0 && days[i].done; i--) streak++;
    const byDate = new Map(days.map((d) => [d.dateKey, d.done]));
    const calendar = windowKeys.map((dateKey) => {
      const due = byDate.get(dateKey);
      const status: RoutineDayStatus =
        due === true
          ? 'done'
          : due === false
          ? 'missed'
          : dateKey === todayKey && pendingToday.has(seriesKey)
          ? 'pending'
          : 'none';
      return { dateKey, status };
    });
    stats.push({
      seriesKey,
      title,
      scheduledDays: days.length,
      doneDays,
      rate: days.length > 0 ? Math.round((doneDays / days.length) * 100) : 0,
      streak,
      calendar,
    });
  }

  return stats.sort((a, b) => a.rate - b.rate || a.title.localeCompare(b.title, 'tr'));
}

/**
 * The single local day a finished task counts for: the local date of completedAt,
 * or its scheduled date when no completion time was recorded.
 */
export function getCompletionDateKey(t: Task): string | null {
  if (t.status !== 'done') return null;
  if (t.completedAt) {
    const d = new Date(t.completedAt);
    if (!isNaN(d.getTime())) return getTodayKey(d);
  }
  return t.scheduledDate;
}

/**
 * Calculates activity stats for a specific day key ('YYYY-MM-DD').
 */
export function getDayActivity(dateKey: string, tasks: Task[], focusLogs: FocusSessionLog[]) {
  const completedTasks = tasks.filter((t) => getCompletionDateKey(t) === dateKey);
  const sessions = focusLogs.filter((l) => l.dateKey === dateKey);

  return {
    completedCount: completedTasks.length,
    focusCount: sessions.length,
    totalActivity: completedTasks.length + sessions.length,
    completedTasks,
    sessions,
  };
}

/**
 * Calculates current active streak up to today.
 */
export function calculateStreak(tasks: Task[], focusLogs: FocusSessionLog[], todayKey: string) {
  const activeDays = new Set<string>();
  for (const t of tasks) {
    const key = getCompletionDateKey(t);
    if (key) activeDays.add(key);
  }
  for (const l of focusLogs) activeDays.add(l.dateKey);

  const isActiveToday = activeDays.has(todayKey);
  let cursor = isActiveToday ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  while (activeDays.has(cursor)) {
    streak++;
    cursor = shiftDateKey(cursor, -1);
  }

  return { streak, isActiveToday };
}

/**
 * Focus totals. Each session is stored once in focusLogs
 * (task.pomodoroCount is only a per-task tally of the same sessions).
 */
export function computeFocusStats(focusLogs: FocusSessionLog[]) {
  const totalMinutes = focusLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  return {
    totalMinutes,
    totalSessions: focusLogs.length,
    formattedDuration: hours > 0 ? tt(`${hours} h ${mins} min`, `${hours} sa ${mins} dk`) : tt(`${mins} min`, `${mins} dk`),
    hours,
    mins,
  };
}
