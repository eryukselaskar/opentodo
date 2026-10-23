import { Task, TaskPriority } from '../../types/todo';
import { t as tt } from '../../lib/i18n';

/** Daily planning capacity in minutes (8 hours) */
export const DAY_CAPACITY_MINUTES = 480;

export function formatMinutes(minutes: number): string {
  const min = tt('m', 'dk');
  const hr = tt('h', 's');
  if (minutes <= 0) return `0${min}`;
  if (minutes < 60) return `${minutes}${min}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}${hr} ${m}${min}` : `${h}${hr}`;
}

export interface TaskFilters {
  searchQuery: string;
  selectedTagFilter: string | null;
  selectedPriorityFilter: TaskPriority | 'all';
}

/** Global search / tag / priority filter shared by all views */
export function matchesTaskFilters(t: Task, f: TaskFilters): boolean {
  const q = f.searchQuery.trim().toLowerCase();
  if (q) {
    const matchTitle = t.title.toLowerCase().includes(q);
    const matchNotes = t.notes.toLowerCase().includes(q);
    const matchTags = t.tags.some((tag) => tag.toLowerCase().includes(q));
    if (!matchTitle && !matchNotes && !matchTags) return false;
  }
  if (f.selectedTagFilter && !t.tags.includes(f.selectedTagFilter)) return false;
  if (f.selectedPriorityFilter !== 'all' && t.priority !== f.selectedPriorityFilter) return false;
  return true;
}

/** A routine with a start date; moving it would move the whole series */
export function isDatedRoutine(t: Task): boolean {
  return t.recurrence !== 'none' && !!t.scheduledDate;
}
