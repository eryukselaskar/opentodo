import { getLang, t as tr2 } from './i18n';

const NAMES = {
  monthNames: {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  },
  monthShort: {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  },
  /** Index 0 = Sunday (Date.getDay order) */
  dayNames: {
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  },
  dayShort: {
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    tr: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
  },
};

/** Month / day names in the current UI language */
export function getNames(kind: keyof typeof NAMES): string[] {
  return NAMES[kind][getLang()];
}

/**
 * Creates a Date object at noon (12:00) to avoid any DST boundary anomalies.
 */
function parseDateKeyToNoonDate(dateKey: string): Date {
  const [yearStr, monthStr, dayStr] = dateKey.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = parseInt(dayStr, 10);
  return new Date(y, m, d, 12, 0, 0, 0);
}

function formatDateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns today's date key in 'YYYY-MM-DD' format (local time).
 */
export function getTodayKey(now: Date = new Date()): string {
  return formatDateToKey(now);
}

/**
 * Returns ISO week key 'YYYY-Www' for a given 'YYYY-MM-DD' string.
 * An ISO week starts on Monday and ends on Sunday.
 */
export function getWeekKeyFromDateKey(dateKey: string): string {
  const d = parseDateKeyToNoonDate(dateKey);
  // ISO day: 1 = Mon, ..., 7 = Sun
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
  // Target Thursday in current week
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + (4 - dayOfWeek));

  const isoYear = thursday.getFullYear();
  // Jan 4th is always in ISO week 1 of isoYear
  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const jan4Day = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const thursdayWeek1 = new Date(isoYear, 0, 4 + (4 - jan4Day), 12, 0, 0, 0);

  const diffMs = thursday.getTime() - thursdayWeek1.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  const weekNum = 1 + Math.round(diffDays / 7);

  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Returns current week key 'YYYY-Www'.
 */
export function getCurrentWeekKey(now: Date = new Date()): string {
  return getWeekKeyFromDateKey(getTodayKey(now));
}

/**
 * Returns month key 'YYYY-MM' for a given 'YYYY-MM-DD'.
 */
export function getMonthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/**
 * Returns current month key 'YYYY-MM'.
 */
export function getCurrentMonthKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Returns the Monday Date for a given ISO week key 'YYYY-Www'.
 */
function getMondayOfIsoWeek(weekKey: string): Date {
  const [yearStr, weekPart] = weekKey.split('-W');
  const isoYear = parseInt(yearStr, 10);
  const weekNum = parseInt(weekPart, 10);

  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const jan4Day = jan4.getDay() === 0 ? 7 : jan4.getDay();
  // Monday of week 1
  const mondayWeek1 = new Date(isoYear, 0, 4 - (jan4Day - 1), 12, 0, 0, 0);
  
  const mondayTarget = new Date(mondayWeek1);
  mondayTarget.setDate(mondayWeek1.getDate() + (weekNum - 1) * 7);
  return mondayTarget;
}

export interface WeekDayInfo {
  dateKey: string;
  dayName: string;
  shortName: string;
  dayNumber: number;
  isToday: boolean;
}

/**
 * Returns 7 items (Monday to Sunday) for the given ISO week key 'YYYY-Www'.
 */
export function getWeekDays(weekKey: string): WeekDayInfo[] {
  const monday = getMondayOfIsoWeek(weekKey);
  const todayKey = getTodayKey();
  const result: WeekDayInfo[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateKey = formatDateToKey(d);
    const dayOfWeek = d.getDay(); // 0 is Sun, 1 is Mon...
    result.push({
      dateKey,
      dayName: getNames('dayNames')[dayOfWeek],
      shortName: getNames('dayShort')[dayOfWeek],
      dayNumber: d.getDate(),
      isToday: dateKey === todayKey,
    });
  }

  return result;
}

export interface MonthCalendarCell {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

/**
 * Returns 35 or 42 grid cells (Monday-aligned) for the given month key 'YYYY-MM'.
 */
export function getMonthCalendarDays(monthKey: string): MonthCalendarCell[] {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-based

  const firstDayOfMonth = new Date(year, month, 1, 12, 0, 0, 0);
  const lastDayOfMonth = new Date(year, month + 1, 0, 12, 0, 0, 0);

  // ISO day: 1 = Mon, ..., 7 = Sun
  const firstDayIso = firstDayOfMonth.getDay() === 0 ? 7 : firstDayOfMonth.getDay();
  // Start Monday for calendar view
  const startMonday = new Date(firstDayOfMonth);
  startMonday.setDate(firstDayOfMonth.getDate() - (firstDayIso - 1));

  const lastDayIso = lastDayOfMonth.getDay() === 0 ? 7 : lastDayOfMonth.getDay();
  const daysToEndSunday = 7 - lastDayIso;
  const endSunday = new Date(lastDayOfMonth);
  endSunday.setDate(lastDayOfMonth.getDate() + daysToEndSunday);

  const diffMs = endSunday.getTime() - startMonday.getTime();
  let totalDays = Math.round(diffMs / 86400000) + 1;
  // Ensure minimum 35 days, or 42 if 35 is not enough
  if (totalDays <= 35) {
    totalDays = 35;
  } else if (totalDays <= 42) {
    totalDays = 42;
  }

  const todayKey = getTodayKey();
  const cells: MonthCalendarCell[] = [];

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startMonday);
    d.setDate(startMonday.getDate() + i);
    const dateKey = formatDateToKey(d);
    cells.push({
      dateKey,
      dayNumber: d.getDate(),
      isCurrentMonth: d.getMonth() === month,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}

/**
 * Shifts a 'YYYY-MM-DD' date by deltaDays days.
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = parseDateKeyToNoonDate(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return formatDateToKey(d);
}

/**
 * Shifts an ISO week key 'YYYY-Www' by deltaWeeks.
 */
export function shiftWeekKey(weekKey: string, deltaWeeks: number): string {
  const monday = getMondayOfIsoWeek(weekKey);
  monday.setDate(monday.getDate() + deltaWeeks * 7);
  return getWeekKeyFromDateKey(formatDateToKey(monday));
}

/**
 * Shifts a month key 'YYYY-MM' by deltaMonths.
 */
export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = new Date(y, m + deltaMonths, 1, 12, 0, 0, 0);
  const newY = d.getFullYear();
  const newM = String(d.getMonth() + 1).padStart(2, '0');
  return `${newY}-${newM}`;
}

/**
 * Formats 'YYYY-MM-DD' as '19 Eki 2026 Pzt'.
 */
export function formatTurkishDate(dateKey: string): string {
  const d = parseDateKeyToNoonDate(dateKey);
  const day = d.getDate();
  const monthShort = getNames('monthShort')[d.getMonth()];
  const year = d.getFullYear();
  const dayOfWeekShort = getNames('dayShort')[d.getDay()];
  if (getLang() === 'en') return `${dayOfWeekShort}, ${monthShort} ${day} ${year}`;
  return `${day} ${monthShort} ${year} ${dayOfWeekShort}`;
}

/**
 * Formats 'YYYY-Www' as '43. Hafta (19 Eki - 25 Eki)'.
 */
export function formatWeekRangeLabel(weekKey: string): string {
  const days = getWeekDays(weekKey);
  const monday = days[0];
  const sunday = days[6];
  const monDate = parseDateKeyToNoonDate(monday.dateKey);
  const sunDate = parseDateKeyToNoonDate(sunday.dateKey);

  const short = getNames('monthShort');
  const en = getLang() === 'en';
  const fmt = (d: Date) => (en ? `${short[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${short[d.getMonth()]}`);
  const weekNum = parseInt(weekKey.split('-W')[1], 10);

  return en
    ? `Week ${weekNum} (${fmt(monDate)} - ${fmt(sunDate)})`
    : `${weekNum}. Hafta (${fmt(monDate)} - ${fmt(sunDate)})`;
}

/**
 * Formats 'YYYY-MM' as 'Ekim 2026'.
 */
export function formatMonthLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  return `${getNames('monthNames')[m]} ${y}`;
}

const LEISURE_KEYWORDS = [
  'oyun',
  'game',
  'gaming',
  'valorant',
  'cs2',
  'csgo',
  'lol',
  'steam',
  'ps5',
  'playstation',
  'xbox',
  'fifa',
  'dizi',
  'film',
  'sinema',
  'netflix',
  'eğlence',
  'eglence',
  'hobi',
  'dinlenme',
  'keyif',
  'arkadaş',
  'arkadas',
  'chill',
  'serbest',
  'discord',
];

/**
 * Detects whether a task is gaming / leisure / hobby rather than heavy work.
 */
export function isLeisureOrGameTask(task: {
  title: string;
  tags?: string[];
  notes?: string;
}): boolean {
  const text = `${task.title} ${(task.tags || []).join(' ')} ${task.notes || ''}`.toLowerCase();
  return LEISURE_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Extracts chronological time in minutes from midnight (0..1440) from a task title.
 * e.g. "10:00 – 11:30 | Deep work" -> 600 (10:00)
 *      "18:30 – 20:00 | Gym" -> 1110 (18:30)
 *      "20:30+ | Reading" -> 1230 (20:30)
 *      "Gece Kapanışı" -> 1380 (23:00)
 * Untimed tasks return 9999.
 */
export function extractTaskTimeMinutes(title: string, scheduledTime?: string | null): number {
  if (scheduledTime) {
    const match = scheduledTime.match(/(\d{1,2})[:.](\d{2})/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const mins = parseInt(match[2], 10);
      if (!isNaN(hours) && !isNaN(mins)) {
        return hours * 60 + mins;
      }
    }
  }

  if (!title) return 9999;
  const match = title.match(/(?:^|\s|[|(])(\d{1,2})[:.](\d{2})/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    if (!isNaN(hours) && !isNaN(mins)) {
      return hours * 60 + mins;
    }
  }

  const lower = title.toLowerCase();
  if (lower.includes('sabah')) return 540; // 09:00
  if (lower.includes('öğle') || lower.includes('ogle')) return 720; // 12:00
  if (lower.includes('akşam') || lower.includes('aksam')) return 1140; // 19:00
  if (lower.includes('gece') || lower.includes('kapanış') || lower.includes('kapanis')) return 1380; // 23:00

  return 9999;
}

/**
 * Splits a task title into a structured time badge and clean title if a time prefix exists.
 * e.g. "10:00 – 11:30 | Deep work" ->
 *      { timeBadge: "10:00 – 11:30", cleanTitle: "Deep work" }
 */
export function splitTaskTimeAndTitle(title: string): { timeBadge: string | null; cleanTitle: string } {
  if (!title) return { timeBadge: null, cleanTitle: '' };

  // Match pattern: "10:00 – 11:30 | Title" or "18:30 - 20:00 | Title" or "20:30+ | Title" or "Gece Kapanışı | Title"
  const pipeMatch = title.match(/^((?:\d{1,2}[:.]\d{2}(?:\s*[-–—]\s*\d{1,2}[:.]\d{2})?|\d{1,2}[:.]\d{2}\+?|Gece Kapanışı|Sabah Bloğu))\s*\|\s*(.+)$/i);
  if (pipeMatch) {
    return {
      timeBadge: pipeMatch[1].trim(),
      cleanTitle: pipeMatch[2].trim(),
    };
  }

  // Match pattern at the beginning without pipe: "10:00 - 11:30 Title" or "18:30 Title"
  const startMatch = title.match(/^(\d{1,2}[:.]\d{2}(?:\s*[-–—]\s*\d{1,2}[:.]\d{2})?|\d{1,2}[:.]\d{2}\+?)\s+([^-–—].+)$/);
  if (startMatch) {
    return {
      timeBadge: startMatch[1].trim(),
      cleanTitle: startMatch[2].trim(),
    };
  }

  return { timeBadge: null, cleanTitle: title };
}

/**
 * Sorts tasks chronologically by their time (morning to night), sinking completed tasks to the bottom.
 */
export function sortTasksByTimeAndStatus<
  T extends {
    title: string;
    status: string;
    scheduledTime?: string | null;
    priority?: string;
    isMIT?: boolean;
  }
>(tasks: T[]): T[] {
  const priorityRank: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...tasks].sort((a, b) => {
    // 1. Completed tasks sink to bottom
    const aDone = a.status === 'done';
    const bDone = b.status === 'done';
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;

    // 2. Sort by chronological time (e.g. 10:00 -> 12:00 -> 18:30)
    const aTime = extractTaskTimeMinutes(a.title, a.scheduledTime);
    const bTime = extractTaskTimeMinutes(b.title, b.scheduledTime);
    if (aTime !== bTime) {
      return aTime - bTime;
    }

    // 3. If both untimed or same time, MIT comes first
    if (a.isMIT && !b.isMIT) return -1;
    if (!a.isMIT && b.isMIT) return 1;

    // 4. Then by priority
    const aPri = priorityRank[a.priority || 'medium'] || 2;
    const bPri = priorityRank[b.priority || 'medium'] || 2;
    return bPri - aPri;
  });
}

function getDaysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/**
 * Shifts a 'YYYY-MM-DD' by whole months, clamping to the month's last day
 * (e.g. Jan 31 + 1 → Feb 28). anchorDay keeps the intended day across short months.
 */
export function addMonthsClamped(dateKey: string, deltaMonths: number, anchorDay?: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const first = new Date(y, m - 1 + deltaMonths, 1, 12, 0, 0, 0);
  const ny = first.getFullYear();
  const nm = first.getMonth() + 1;
  const day = Math.min(anchorDay ?? d, getDaysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Identifies which recurring routine a task belongs to.
 * Falls back to recurrence + title for legacy data without seriesId.
 */
export function getSeriesKey(t: { seriesId?: string; recurrence: string; title: string }): string {
  return t.seriesId || `${t.recurrence}|${t.title.trim().toLowerCase()}`;
}


/**
 * Human label for a recurrence pattern, e.g. 'Her Gün' or 'Pzt, Per'. Null when not recurring.
 */
export function formatRecurrenceLabel(t: { recurrence: string; recurrenceDays?: number[] }): string | null {
  if (t.recurrence === 'daily') return tr2('Every day', 'Her Gün');
  if (t.recurrence === 'weekly') return tr2('Every week', 'Her Hafta');
  if (t.recurrence === 'monthly') return tr2('Every month', 'Her Ay');
  if (t.recurrence === 'custom_days') {
    const days = [...(t.recurrenceDays || [])].sort((a, b) => a - b);
    // ISO day 1 = Monday … 7 = Sunday
    const short = getNames('dayShort');
    return days.length > 0 ? days.map((d) => short[d % 7]).join(', ') : tr2('Selected days', 'Seçili Günler');
  }
  return null;
}

function isoDayOfDateKey(dateKey: string): number {
  const day = parseDateKeyToNoonDate(dateKey).getDay();
  return day === 0 ? 7 : day;
}

/** Weekday rule for custom_days / weekly-with-days routines. */
function matchesWeekdayRule(
  t: { recurrence: string; recurrenceDays?: number[] },
  isoDay: number
): boolean {
  if (t.recurrence === 'custom_days') return (t.recurrenceDays || []).includes(isoDay);
  if (t.recurrence === 'weekly' && t.recurrenceDays && t.recurrenceDays.length > 0) {
    return t.recurrenceDays.includes(isoDay);
  }
  return true;
}

function daysBetweenDateKeys(startKey: string, endKey: string): number {
  const [y1, m1, d1] = startKey.split('-').map(Number);
  const [y2, m2, d2] = endKey.split('-').map(Number);
  const utc1 = Date.UTC(y1, (m1 || 1) - 1, d1 || 1);
  const utc2 = Date.UTC(y2, (m2 || 1) - 1, d2 || 1);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * Returns all tasks for a specific dateKey, including recurring tasks (daily, weekly, monthly)
 * projected forward from their planned start date (scheduledDate), while respecting skippedDates.
 */
export function getTasksForDate<
  T extends {
    id: string;
    title: string;
    scheduledDate: string | null;
    scheduledTime?: string | null;
    recurrence: string;
    recurrenceDays?: number[];
    seriesId?: string;
    recurrenceAnchorDay?: number;
    status: string;
    isMIT?: boolean;
    createdAt?: string;
    skippedDates?: string[];
    subtasks?: { id: string; title: string; completed: boolean }[];
  }
>(tasks: T[], dateKey: string): T[] {
  const isoDay = isoDayOfDateKey(dateKey);
  const explicitTasks = tasks.filter(
    (t) =>
      t.scheduledDate === dateKey &&
      !(t.skippedDates && t.skippedDates.includes(dateKey)) &&
      (t.recurrence === 'none' || matchesWeekdayRule(t, isoDay))
  );
  const explicitSeries = new Set(
    explicitTasks.filter((t) => t.recurrence !== 'none').map((t) => getSeriesKey(t))
  );

  const projectedRecurringTasks: T[] = [];
  const seenSeries = new Set<string>();

  for (const t of tasks) {
    if (
      t.recurrence === 'daily' ||
      t.recurrence === 'weekly' ||
      t.recurrence === 'monthly' ||
      t.recurrence === 'custom_days'
    ) {
      // Strictly project from the task's planned date (scheduledDate) onwards
      if (!t.scheduledDate || dateKey < t.scheduledDate) {
        continue;
      }

      // Skip if user marked this date as skipped for this recurring series
      if (t.skippedDates && t.skippedDates.includes(dateKey)) {
        continue;
      }

      if (!matchesWeekdayRule(t, isoDay)) {
        continue;
      }

      if (t.recurrence === 'weekly' && !(t.recurrenceDays && t.recurrenceDays.length > 0)) {
        const diffDays = daysBetweenDateKeys(t.scheduledDate, dateKey);
        if (diffDays < 0 || diffDays % 7 !== 0) {
          continue;
        }
      } else if (t.recurrence === 'monthly') {
        // Aim for the anchor day; on shorter months fall back to the last day
        const anchorDay = t.recurrenceAnchorDay ?? Number(t.scheduledDate.slice(8, 10));
        const [ty, tm, td] = dateKey.split('-').map(Number);
        if (td !== Math.min(anchorDay, getDaysInMonth(ty, tm))) {
          continue;
        }
      }

      const seriesKey = getSeriesKey(t);
      if (!explicitSeries.has(seriesKey) && !seenSeries.has(seriesKey)) {
        seenSeries.add(seriesKey);
        projectedRecurringTasks.push({
          ...t,
          scheduledDate: dateKey,
          // Projected onto another day: show as active ('todo'), non-MIT, and with unchecked subtasks for that day
          status: 'todo',
          isMIT: false,
          subtasks: Array.isArray(t.subtasks)
            ? t.subtasks.map((st) => ({ ...st, completed: false }))
            : t.subtasks,
        });
      }
    }
  }

  return [...explicitTasks, ...projectedRecurringTasks];
}

export interface DayWorkloadSummary {
  dateKey: string;
  plannedMinutes: number;
  workMinutes: number;
  leisureMinutes: number;
  routineMinutes: number;
  taskCount: number;
}

/**
 * Computes a day's workload split into Work, Gaming/Leisure, and Daily Routine minutes.
 */
export function computeDayWorkload<
  T extends {
    id: string;
    title: string;
    scheduledDate: string | null;
    recurrence: string;
    status: string;
    estimatedMinutes?: number;
    tags?: string[];
    notes?: string;
  }
>(tasks: T[], dateKey: string): DayWorkloadSummary {
  const dayTasks = getTasksForDate(tasks, dateKey).filter((t) => t.status !== 'done');
  let plannedMinutes = 0;
  let workMinutes = 0;
  let leisureMinutes = 0;
  let routineMinutes = 0;

  for (const t of dayTasks) {
    const mins = t.estimatedMinutes || 25;
    plannedMinutes += mins;
    if (t.recurrence === 'daily' || t.recurrence === 'custom_days') {
      routineMinutes += mins;
    } else if (isLeisureOrGameTask(t)) {
      leisureMinutes += mins;
    } else {
      workMinutes += mins;
    }
  }

  return {
    dateKey,
    plannedMinutes,
    workMinutes,
    leisureMinutes,
    routineMinutes,
    taskCount: dayTasks.length,
  };
}

