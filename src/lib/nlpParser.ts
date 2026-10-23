import { TaskHorizon, TaskPriority, RecurrencePattern } from '../types/todo';
import {
  getTodayKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  shiftDateKey,
  shiftWeekKey,
  getWeekKeyFromDateKey,
  getMonthKeyFromDateKey,
} from './dateUtils';
import { t } from './i18n';

export interface ParsedTaskInput {
  title: string;
  tags: string[];
  priority: TaskPriority;
  estimatedMinutes: number;
  horizon: TaskHorizon;
  scheduledDate: string | null;
  scheduledTime?: string | null;
  weekKey: string | null;
  monthKey: string | null;
  recurrence: RecurrencePattern;
  recurrenceDays?: number[];
}

const HORIZON_TOKEN_REGEX =
  /(?:^|\s)@(bugün|bugun|today|yarın|yarin|tomorrow|buhafta|hafta|week|gelecekhafta|nextweek|buay|ay|month|\d{4}-\d{2}-\d{2})(?=\s|$)/iu;

/** Health / medication words; word-bounded so e.g. "kitap" does not match "hap". */
const HEALTH_REGEX =
  /(?<!\p{L})(?:ila[çc]|magnezyum|vitamin|takviye|hap(?:ı|lar[ıi]?)?(?!\p{L})|re[çc]ete)/iu;

/** True when the text contains a full @horizon token (@yarın, @buhafta, @2026-10-25 ...). */
export function hasExplicitHorizonToken(raw: string): boolean {
  return HORIZON_TOKEN_REGEX.test(raw);
}

/**
 * Parses natural language input for task creation supporting Turkish & English tokens.
 * E.g.: "Sunumu hazırla #iş #proje !acil ~45dk @yarın %haftalık"
 */
export function parseQuickTaskInput(
  raw: string,
  referenceDate: Date = new Date()
): ParsedTaskInput {
  let text = raw.trim();

  // 1. Tags: #etiket or #tag-name
  const tags: string[] = [];
  const tagRegex = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  text = text.replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' ');

  // 2. Priority: !acil, !yüksek, !orta, !düşük, !urgent, !high, !medium, !low, !p1..!p4, !!!, !!, !
  let priority: TaskPriority = 'medium';
  // Check urgent
  const urgentRegex = /(?:^|\s)(!acil|!urgent|!p1|!!!)(?=\s|$)/iu;
  const highRegex = /(?:^|\s)(!yüksek|!yuksek|!high|!p2|!!)(?=\s|$)/iu;
  const lowRegex = /(?:^|\s)(!düşük|!dusuk|!low|!p4)(?=\s|$)/iu;
  const mediumRegex = /(?:^|\s)(!orta|!medium|!p3|!)(?=\s|$)/iu;

  if (urgentRegex.test(text)) {
    priority = 'urgent';
    text = text.replace(urgentRegex, ' ');
  } else if (highRegex.test(text)) {
    priority = 'high';
    text = text.replace(highRegex, ' ');
  } else if (lowRegex.test(text)) {
    priority = 'low';
    text = text.replace(lowRegex, ' ');
  } else if (mediumRegex.test(text)) {
    priority = 'medium';
    text = text.replace(mediumRegex, ' ');
  }

  // 3. Duration: ~45dk, ~45m, ~1.5s, ~2saat, ~2h, ~30
  let estimatedMinutes = 25;
  const durationRegex = /(?:^|\s)~([0-9]+(?:[.,][0-9]+)?)\s*(dk|m|min|saat|s|h|hr)?(?=\s|$)/iu;
  const durMatch = text.match(durationRegex);
  if (durMatch) {
    const val = parseFloat(durMatch[1].replace(',', '.'));
    const unit = durMatch[2]?.toLowerCase() || 'dk';
    if (unit === 's' || unit === 'saat' || unit === 'h' || unit === 'hr') {
      estimatedMinutes = Math.round(val * 60);
    } else {
      estimatedMinutes = Math.round(val);
    }
    text = text.replace(durationRegex, ' ');
  }

  // 4. Recurrence: %günlük, %haftalık, %aylık, %daily, %weekly, %monthly or custom natural days
  let recurrence: RecurrencePattern = 'none';
  let recurrenceDays: number[] | undefined = undefined;

  const recurrenceRegex = /(?:^|\s)%(günlük|gunluk|daily|haftalık|haftalik|weekly|aylık|aylik|monthly)(?=\s|$)/iu;
  const recMatch = text.match(recurrenceRegex);
  if (recMatch) {
    const token = recMatch[1].toLowerCase();
    if (token === 'günlük' || token === 'gunluk' || token === 'daily') {
      recurrence = 'daily';
    } else if (token === 'haftalık' || token === 'haftalik' || token === 'weekly') {
      recurrence = 'weekly';
    } else if (token === 'aylık' || token === 'aylik' || token === 'monthly') {
      recurrence = 'monthly';
    }
    text = text.replace(recurrenceRegex, ' ');
  }

  // Natural language recurrence. Only explicit phrases ("her gün", "her hafta sonu",
  // "pazartesi ve perşembe günleri") count, so plain titles like "Günlük raporu yaz" stay one-off.
  const lowerText = text.toLowerCase();
  const isHealthRoutine = HEALTH_REGEX.test(lowerText);
  const hasMonThuPair = /(?:pazartesi\s*(?:ve|,)?\s*per[şs]embe|pzt\s*(?:ve|,)?\s*per)/iu.test(lowerText);
  if (hasMonThuPair && (/g[üu]nleri|(?:^|\s)her\s/iu.test(lowerText) || isHealthRoutine)) {
    recurrence = 'custom_days';
    recurrenceDays = [1, 4]; // Pazartesi (1), Perşembe (4)
  } else if (/her\s+hafta\s*i[çc]i|hafta\s*i[çc]i\s+her\s+g[üu]n/iu.test(lowerText)) {
    recurrence = 'custom_days';
    recurrenceDays = [1, 2, 3, 4, 5];
  } else if (/her\s+hafta\s*sonu/iu.test(lowerText)) {
    recurrence = 'custom_days';
    recurrenceDays = [6, 7];
  } else if (
    recurrence === 'none' &&
    (/her\s*g[üu]n|her\s*ak[şs]am|her\s*sabah/iu.test(lowerText) ||
      (isHealthRoutine && /g[üu]nl[üu]k/iu.test(lowerText)))
  ) {
    recurrence = 'daily';
  }

  // 4b. Explicit time: "14:30", "12:00 - 12:30", "saat 9.15". A dot is only accepted
  // after "saat" so values like "Sürüm 2.10" are left alone.
  let scheduledTime: string | null = null;
  const isValidTime = (h: string, m: string) => Number(h) < 24 && Number(m) < 60;
  const pad2 = (v: string) => String(parseInt(v, 10)).padStart(2, '0');
  const timeRegex =
    /(?:^|\s)(saat\s*)?(\d{1,2})([:.])(\d{2})(?:\s*[-–—]\s*(\d{1,2})[:.](\d{2}))?(?=\s|$)/giu;
  for (const m of text.matchAll(timeRegex)) {
    const [whole, saatPrefix, sh, sep, sm, eh, em] = m;
    if ((sep !== ':' && !saatPrefix) || !isValidTime(sh, sm)) continue;
    const hasEnd = eh !== undefined && em !== undefined && isValidTime(eh, em);
    scheduledTime = hasEnd
      ? `${pad2(sh)}:${pad2(sm)} – ${pad2(eh)}:${pad2(em)}`
      : `${pad2(sh)}:${pad2(sm)}`;
    text = text.replace(whole, ' ');
    break;
  }

  // Contextual time hints ("kahvaltı sonrası", "akşam") only for routines / health items,
  // so "Akşam yemeği hazırla" does not get a 22:00 slot.
  const isRoutineContext = recurrence !== 'none' || isHealthRoutine;
  if (!scheduledTime && isRoutineContext) {
    if (/(?:kahvalt[ıi]\s*sonras[ıi]|kahvalt[ıi]dan\s*sonra|öğle|ogle)/iu.test(lowerText)) {
      scheduledTime = '12:00';
    } else if (/(?:ak[şs]am|gece|yatmadan\s*önce)/iu.test(lowerText)) {
      scheduledTime = '22:00';
    } else if (/(?:sabah)/iu.test(lowerText)) {
      scheduledTime = '10:00';
    }
  }

  // Health / Routine tag detection
  if (isHealthRoutine) {
    for (const tag of [t('health', 'sağlık'), t('routine', 'rutin')]) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }

  // 5. Horizon & Scheduled Date tokens: @bugün, @yarın, @buhafta, @gelecekhafta, @buay, @YYYY-MM-DD
  const todayKey = getTodayKey(referenceDate);
  const currentWeekKey = getCurrentWeekKey(referenceDate);
  const currentMonthKey = getCurrentMonthKey(referenceDate);

  let horizon: TaskHorizon = 'day';
  let scheduledDate: string | null = todayKey;
  let weekKey: string | null = currentWeekKey;
  let monthKey: string | null = currentMonthKey;

  const horizonRegex = HORIZON_TOKEN_REGEX;
  const horMatch = text.match(horizonRegex);

  if (horMatch) {
    const token = horMatch[1].toLowerCase();
    if (token === 'bugün' || token === 'bugun' || token === 'today') {
      horizon = 'day';
      scheduledDate = todayKey;
      weekKey = currentWeekKey;
      monthKey = currentMonthKey;
    } else if (token === 'yarın' || token === 'yarin' || token === 'tomorrow') {
      horizon = 'day';
      const tomorrowKey = shiftDateKey(todayKey, 1);
      scheduledDate = tomorrowKey;
      weekKey = getWeekKeyFromDateKey(tomorrowKey);
      monthKey = getMonthKeyFromDateKey(tomorrowKey);
    } else if (token === 'buhafta' || token === 'hafta' || token === 'week') {
      horizon = 'week';
      scheduledDate = null;
      weekKey = currentWeekKey;
      monthKey = currentMonthKey;
    } else if (token === 'gelecekhafta' || token === 'nextweek') {
      horizon = 'week';
      scheduledDate = null;
      const nextWeekKey = shiftWeekKey(currentWeekKey, 1);
      weekKey = nextWeekKey;
      // Get month key corresponding to start of next week
      monthKey = currentMonthKey;
    } else if (token === 'buay' || token === 'ay' || token === 'month') {
      horizon = 'month';
      scheduledDate = null;
      weekKey = null;
      monthKey = currentMonthKey;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      horizon = 'day';
      scheduledDate = token;
      weekKey = getWeekKeyFromDateKey(token);
      monthKey = getMonthKeyFromDateKey(token);
    }
    text = text.replace(horizonRegex, ' ');
  }

  // Clean and normalize remaining title text
  const title = text.replace(/\s+/g, ' ').trim();

  return {
    title: title || raw.trim(),
    tags,
    priority,
    estimatedMinutes,
    horizon,
    scheduledDate,
    scheduledTime,
    weekKey,
    monthKey,
    recurrence,
    recurrenceDays,
  };
}
