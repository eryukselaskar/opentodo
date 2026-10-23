export type TaskHorizon = 'day' | 'week' | 'month' | 'backlog';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RecurrencePattern = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_days';
export type ViewMode = 'day' | 'week' | 'month' | 'kanban' | 'focus' | 'analytics';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  horizon: TaskHorizon;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  /** 'YYYY-MM-DD' format or null */
  scheduledDate: string | null;
  /** Explicit time string, e.g. '12:00' or '12:00 – 12:30' */
  scheduledTime?: string | null;
  /** 'YYYY-Www' format (e.g. '2026-W43') or null */
  weekKey: string | null;
  /** 'YYYY-MM' format (e.g. '2026-10') or null */
  monthKey: string | null;
  milestoneId: string | null;
  isMIT: boolean;
  estimatedMinutes: number;
  pomodoroCount: number;
  recurrence: RecurrencePattern;
  /** Days of week for custom_days recurrence: 1=Pzt, 2=Sal, 3=Çar, 4=Per, 5=Cum, 6=Cmt, 7=Paz */
  recurrenceDays?: number[];
  /** Shared by every instance of the same recurring routine */
  seriesId?: string;
  /** Day of month a monthly routine aims for (keeps 31st on month ends) */
  recurrenceAnchorDay?: number;
  skippedDates?: string[];
  subtasks: Subtask[];
  createdAt: string;
  completedAt: string | null;
}

export interface MonthlyMilestone {
  id: string;
  title: string;
  monthKey: string; // 'YYYY-MM'
  completed: boolean;
}

export interface FocusSessionLog {
  id: string;
  taskId: string | null;
  durationMinutes: number;
  completedAt: string; // ISO string
  dateKey: string; // 'YYYY-MM-DD'
}
