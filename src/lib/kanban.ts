import { getSeriesKey, getTasksForDate } from './dateUtils';
import type { Task } from '../types/todo';

/**
 * A routine is stored as several records (today's finished one, the series continuing tomorrow ...).
 * The board shows each routine once: today's card when it runs today, otherwise its first record.
 */
export function dedupeRoutines(list: Task[], todayTasks: Task[]): Task[] {
  const todayBySeries = new Map<string, Task>();
  for (const t of todayTasks) {
    if (t.recurrence !== 'none') todayBySeries.set(getSeriesKey(t), t);
  }
  const seen = new Set<string>();
  const result: Task[] = [];
  for (const t of list) {
    if (t.recurrence === 'none') {
      result.push(t);
      continue;
    }
    const key = getSeriesKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(todayBySeries.get(key) ?? t);
  }
  return result;
}

/** All tasks for the board ("All" filter) with routines collapsed to one card. */
export function getKanbanTasks(tasks: Task[], todayKey: string): Task[] {
  return dedupeRoutines(tasks, getTasksForDate(tasks, todayKey));
}
