import { Task } from '../types/todo';
import { getTodayKey, getTasksForDate, getSeriesKey, splitTaskTimeAndTitle } from './dateUtils';

/**
 * Start time of a task in minutes from midnight, only when an explicit clock time exists
 * (scheduledTime or a "12:00 | ..." title prefix). Words like "Gece" do not count.
 */
export function getTaskReminderMinutes(task: Pick<Task, 'title' | 'scheduledTime'>): number | null {
  const source = task.scheduledTime || splitTaskTimeAndTitle(task.title).timeBadge || '';
  const m = source.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface DueReminder {
  /** Unique per task occurrence and day; used to avoid notifying twice */
  key: string;
  task: Task;
  timeLabel: string;
}

/**
 * Today's open tasks whose time has come within the last `windowMinutes` and that were not
 * notified yet. Includes routines projected onto today.
 */
export function getDueReminders(
  tasks: Task[],
  now: Date,
  notifiedKeys: string[],
  windowMinutes = 60
): DueReminder[] {
  const todayKey = getTodayKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const notified = new Set(notifiedKeys);
  const result: DueReminder[] = [];

  for (const task of getTasksForDate(tasks, todayKey)) {
    if (task.status === 'done') continue;
    const minutes = getTaskReminderMinutes(task);
    if (minutes === null) continue;
    if (nowMinutes < minutes || nowMinutes - minutes > windowMinutes) continue;

    const identity = task.recurrence !== 'none' ? getSeriesKey(task) : task.id;
    const key = `${todayKey}|${identity}|${minutes}`;
    if (notified.has(key)) continue;

    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    result.push({ key, task, timeLabel: `${hh}:${mm}` });
  }

  return result;
}
