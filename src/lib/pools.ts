import { Task } from '../types/todo';
import { getWeekKeyFromDateKey } from './dateUtils';

/**
 * Unscheduled tasks in a week's pool. Tasks without a weekKey belong to the current week only,
 * so they do not show up in every week.
 */
export function getWeekPoolTasks(tasks: Task[], weekKey: string, currentWeekKey: string): Task[] {
  return tasks.filter(
    (t) =>
      t.horizon === 'week' &&
      t.scheduledDate === null &&
      (t.weekKey === weekKey || (t.weekKey === null && weekKey === currentWeekKey))
  );
}

/** Open week-pool tasks that can be pulled into a given day (same week as the day). */
export function getPullablePoolTasksForDay(
  tasks: Task[],
  dateKey: string,
  currentWeekKey: string
): Task[] {
  return getWeekPoolTasks(tasks, getWeekKeyFromDateKey(dateKey), currentWeekKey).filter(
    (t) => t.status !== 'done'
  );
}
