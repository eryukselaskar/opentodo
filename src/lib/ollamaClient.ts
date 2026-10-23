import { TaskHorizon, TaskPriority, RecurrencePattern } from '../types/todo';
import { getLang, t, t as tr2 } from './i18n';
import { getNames } from './dateUtils';

/** Extra system-prompt line so model-written text matches the UI language */
function languageRule(): string {
  return getLang() === 'en'
    ? '\nIMPORTANT: Write every text value (titles, subtasks, reasons, tags) in English.'
    : '';
}

const DEFAULT_MODEL = 'gemma4:12b';
let activeModelCache: string = DEFAULT_MODEL;

/** Task object as returned by the model; every field is validated before use */
interface RawModelTask {
  title?: unknown;
  horizon?: unknown;
  scheduledDate?: unknown;
  scheduledTime?: unknown;
  priority?: unknown;
  estimatedMinutes?: unknown;
  tags?: unknown;
  suggestedReason?: unknown;
  recurrence?: unknown;
  recurrenceDays?: unknown;
}

/**
 * Strips <think>...</think> reasoning blocks and markdown code fences (```json ... ```)
 */
export function cleanJsonOutput(raw: string): string {
  if (!raw) return '';
  // 1. Remove <think>...</think> blocks
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Remove markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If there are still surrounding code fences inside leading/trailing text
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return cleaned;
}

/**
 * Extracts the first contiguous JSON object {...} or array [...] from a string.
 */
export function extractJsonBlock(raw: string): string {
  const cleaned = cleanJsonOutput(raw);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  // Check if object comes first or is the only container
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.slice(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    if (lastBracket !== -1 && lastBracket > firstBracket) {
      return cleaned.slice(firstBracket, lastBracket + 1);
    }
  }

  return cleaned;
}

/**
 * Helper to fetch Ollama API with fallback between /ollama proxy and direct localhost:11434.
 */
async function fetchOllama(
  endpoint: string,
  options?: RequestInit,
  timeoutMs = 1500
): Promise<Response> {
  const isBrowser = typeof window !== 'undefined';
  const endpoints = isBrowser
    ? [`/ollama${endpoint}`, `http://localhost:11434${endpoint}`]
    : [`http://localhost:11434${endpoint}`];

  let lastError: unknown;
  for (const url of endpoints) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = err;
    }
  }

  throw lastError || new Error(`Ollama fetch failed for ${endpoint}`);
}

/**
 * Check if Ollama is running and discover available models.
 */
export async function checkOllamaStatus(): Promise<{ online: boolean; model: string }> {
  try {
    const res = await fetchOllama('/api/tags');
    const data = await res.json();
    const models: { name: string }[] = data.models || [];

    // Find gemma4:12b, or any gemma model, or first available model
    const matched =
      models.find((m) => m.name === 'gemma4:12b') ||
      models.find((m) => m.name.toLowerCase().startsWith('gemma')) ||
      models[0];

    const modelName = matched ? matched.name : DEFAULT_MODEL;
    activeModelCache = modelName;
    return { online: true, model: modelName };
  } catch {
    return { online: false, model: DEFAULT_MODEL };
  }
}

/**
 * Call Ollama /api/chat with think: false and stream: false for fast response.
 */
async function callOllamaChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const payload = {
    model: activeModelCache || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
    think: false,
    format: 'json',
    options: {
      temperature: 0.1,
      num_ctx: 2048,
      num_predict: 700,
    },
  };

  const chatTimeoutMs = typeof window !== 'undefined' ? 90000 : 400;
  const res = await fetchOllama(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    chatTimeoutMs
  );

  const data = await res.json();
  return data.message?.content || data.response || '';
}

/**
 * 1. AI ile alt görev oluşturma ve süre/öncelik tahmini
 */
export async function generateSubtasksWithAI(
  taskTitle: string,
  taskNotes?: string
): Promise<{ subtasks: string[]; estimatedMinutes: number; priority: TaskPriority }> {
  const fallback = {
    subtasks: [
      t(`Define and prepare requirements for ${taskTitle}`, `${taskTitle} gereksinimlerini belirle ve hazırla`),
      t(`Carry out ${taskTitle}`, `${taskTitle} uygulamasını gerçekleştir`),
      t(`Review and verify ${taskTitle}`, `${taskTitle} kontrolünü yap ve doğrula`),
    ],
    estimatedMinutes: 45,
    priority: 'medium' as TaskPriority,
  };

  try {
    const systemPrompt = `Sen Todo Plus için Türkçe çalışan uzman bir görev ayrıştırma ve planlama asistanısın.
Kullanıcının verdiği görevi 3 ila 5 adet somut, eyleme dönüştürülebilir kısa alt göreve (subtasks) böl.
Toplam tahmini süreyi dakika cinsinden (15 ile 180 arasında bir sayı) ve önerilen önceliği ('low', 'medium', 'high', 'urgent') belirle.
Cevabını SADECE geçerli JSON olarak ver:
{
  "subtasks": ["alt görev 1", "alt görev 2", "alt görev 3"],
  "estimatedMinutes": 45,
  "priority": "medium"
}${languageRule()}`;

    const userPrompt = `Görev Başlığı: "${taskTitle}"${taskNotes ? `\nNotlar: "${taskNotes}"` : ''}`;
    const rawOutput = await callOllamaChat(systemPrompt, userPrompt);
    const jsonStr = extractJsonBlock(rawOutput);
    const parsed = JSON.parse(jsonStr);

    const subtasks: string[] = Array.isArray(parsed.subtasks)
      ? parsed.subtasks.map((s: unknown) => String(s).trim()).filter(Boolean)
      : fallback.subtasks;

    let estimatedMinutes = Number(parsed.estimatedMinutes) || 45;
    if (estimatedMinutes < 15) estimatedMinutes = 15;
    if (estimatedMinutes > 180) estimatedMinutes = 180;

    const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
    const priority: TaskPriority = validPriorities.includes(parsed.priority)
      ? parsed.priority
      : 'medium';

    return {
      subtasks: subtasks.length > 0 ? subtasks.slice(0, 5) : fallback.subtasks,
      estimatedMinutes,
      priority,
    };
  } catch (err) {
    console.warn('generateSubtasksWithAI fallback triggered:', err);
    return fallback;
  }
}

export function extractTaskSequenceOrder(title: string): number | null {
  // Match "(1/3)", "(2/4)"
  const parenMatch = title.match(/\((\d+)\s*\/\s*\d+\)/);
  if (parenMatch) return parseInt(parenMatch[1], 10);
  // Match leading "1.", "2-", "#1" or trailing " 1", "#2"
  const numMatch = title.match(/(?:^|\s|#)(\d+)(?:\.|-|\b)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return null;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * 2. Hafta havuzu görevlerini haftanın günlerine dengeli ve kronolojik sırayla dağıtma.
 * Model çağrısı yapılmaz; yerel algoritma hem daha hızlı hem pratikte daha iyi sonuç veriyordu.
 */
export async function autoScheduleWeekWithAI(
  poolTasks: { id: string; title: string; priority: TaskPriority; estimatedMinutes: number }[],
  weekDays: {
    dateKey: string;
    dayName: string;
    currentMinutes: number;
    workMinutes?: number;
    leisureMinutes?: number;
    routineMinutes?: number;
  }[]
): Promise<{ assignments: { taskId: string; dateKey: string; reason: string }[] }> {
  if (poolTasks.length === 0 || weekDays.length === 0) {
    return { assignments: [] };
  }

  // 1. Order tasks strictly: sequential numbers (1 -> 2 -> 3) first, then priority (urgent -> low)
  const orderedTasks = [...poolTasks].sort((a, b) => {
    const seqA = extractTaskSequenceOrder(a.title);
    const seqB = extractTaskSequenceOrder(b.title);
    if (seqA !== null && seqB !== null && seqA !== seqB) {
      return seqA - seqB;
    }
    const pDiff = (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    if (seqA !== null && seqB === null) return -1;
    if (seqA === null && seqB !== null) return 1;
    return 0;
  });

  // 2. Convert weekDays to DayLoadInfo and pick N best low-work days sorted chronologically (Mon -> Sun)
  const dayLoadList: DayLoadInfo[] = weekDays.map((d) => ({
    dateKey: d.dateKey,
    dayName: d.dayName,
    plannedMinutes: d.currentMinutes,
    workMinutes: d.workMinutes ?? d.currentMinutes,
    leisureMinutes: d.leisureMinutes ?? 0,
    routineMinutes: d.routineMinutes ?? 0,
    taskCount: 0,
  }));

  const bestChronologicalDays = pickBestAvailableDays(dayLoadList, orderedTasks.length);

  // 1st ordered task -> earliest best day, 2nd ordered task -> next best day
  const assignments = orderedTasks.map((task, idx) => {
    const targetDay = bestChronologicalDays[idx] || dayLoadList[idx % dayLoadList.length];
    return {
      taskId: task.id,
      dateKey: targetDay.dateKey,
      reason: formatDayRecommendationReason(targetDay),
    };
  });

  return { assignments };
}

export interface DayLoadInfo {
  dateKey: string;
  dayName: string;
  plannedMinutes: number;
  workMinutes?: number;
  leisureMinutes?: number;
  routineMinutes?: number;
  taskCount: number;
}

function formatDayRecommendationReason(day: DayLoadInfo): string {
  const work = day.workMinutes ?? day.plannedMinutes;
  const leisure = day.leisureMinutes ?? 0;
  const [y, m, d] = day.dateKey.split('-').map(Number);
  const name = getNames('dayNames')[new Date(y, (m || 1) - 1, d || 1).getDay()];
  if (work === 0 && leisure > 0) {
    return t(
      `No work tasks on ${name} (leisure: ${leisure} min) — suggested for work`,
      `${name} günü iş görevi yok (oyun/serbest zaman: ${leisure} dk) — İş için önerildi`
    );
  }
  if (work === 0) {
    return t(`${name} has 0 min of work — suggested because it is free`, `${name} günü iş yükü 0 dk — Müsait olduğu için önerildi`);
  }
  return t(
    `${name} has a light load (${work} min of work) — suggested for balance`,
    `${name} günü iş yükü hafif (${work} dk iş) — Dengeli dağılım için önerildi`
  );
}

function buildUpcomingDaysMap(
  todayKey: string,
  dayLoads?: DayLoadInfo[]
): {
  lines: string[];
  weekdayToDate: Record<string, string>;
  upcomingDays: DayLoadInfo[];
} {
  const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const [y, m, d] = todayKey.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  const lines: string[] = [];
  const mapByDate = new Map((dayLoads || []).map((dl) => [dl.dateKey, dl]));
  const upcomingDays: DayLoadInfo[] = [];
  const wdMap: Record<string, string> = {};

  for (let offset = 0; offset <= 7; offset++) {
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    const name = dayNames[dt.getDay()];
    const lowerName = name.toLowerCase();
    if (!wdMap[lowerName]) {
      wdMap[lowerName] = key;
    }

    const existingLoad = mapByDate.get(key);
    const plannedMinutes = existingLoad ? existingLoad.plannedMinutes : 0;
    const workMinutes = existingLoad ? (existingLoad.workMinutes ?? existingLoad.plannedMinutes) : 0;
    const leisureMinutes = existingLoad ? (existingLoad.leisureMinutes ?? 0) : 0;
    const routineMinutes = existingLoad ? (existingLoad.routineMinutes ?? 0) : 0;
    const taskCount = existingLoad ? existingLoad.taskCount : 0;

    if (offset < 7) {
      upcomingDays.push({
        dateKey: key,
        dayName: name,
        plannedMinutes,
        workMinutes,
        leisureMinutes,
        routineMinutes,
        taskCount,
      });
    }

    let statusLabel = '';
    if (workMinutes === 0 && leisureMinutes > 0) {
      statusLabel = `İŞ İÇİN ÇOK UYGUN — İş: 0 dk, Oyun/Eğlence: ${leisureMinutes} dk, Günlük Rutin: ${routineMinutes} dk`;
    } else if (workMinutes === 0) {
      statusLabel = `TAMAMEN MÜSAİT — İş: 0 dk, Günlük Rutin: ${routineMinutes} dk`;
    } else if (workMinutes <= 60) {
      statusLabel = `MÜSAİT — İş: ${workMinutes} dk, Oyun/Kişisel: ${leisureMinutes} dk`;
    } else {
      statusLabel = `İŞ YOĞUN — İş: ${workMinutes} dk dolu`;
    }

    const label =
      offset === 0
        ? `Bugün (${name})`
        : offset === 1
        ? `Yarın (${name})`
        : offset === 7
        ? `Haftaya ${name}`
        : name;
    lines.push(`- ${label}: ${key} [${statusLabel}]`);
  }

  return { lines, weekdayToDate: wdMap, upcomingDays };
}

/**
 * Picks N well-spaced, low-work-load days from the upcoming 7 days.
 * Prioritizes days where workMinutes is lowest (especially days that have gaming/leisure but zero/low work).
 */
function pickBestAvailableDays(upcomingDays: DayLoadInfo[], count: number): DayLoadInfo[] {
  if (upcomingDays.length === 0) return [];
  const pool = [...upcomingDays];
  // Sort by lowest workMinutes first; if tied on workMinutes, prefer days with gaming/leisure time (where work is missing)
  const sorted = [...pool].sort((a, b) => {
    const workA = a.workMinutes ?? a.plannedMinutes;
    const workB = b.workMinutes ?? b.plannedMinutes;
    if (workA !== workB) return workA - workB;
    const leisureA = a.leisureMinutes ?? 0;
    const leisureB = b.leisureMinutes ?? 0;
    if (leisureA !== leisureB) return leisureB - leisureA;
    return a.plannedMinutes - b.plannedMinutes;
  });

  const selected: DayLoadInfo[] = [];
  const usedDates = new Set<string>();

  // If count <= 3 and there are multiple low-work days, try to avoid adjacent days when work load is similar
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    const candIdx = pool.findIndex((d) => d.dateKey === candidate.dateKey);
    const hasAdjacent = selected.some((s) => {
      const sIdx = pool.findIndex((d) => d.dateKey === s.dateKey);
      return Math.abs(sIdx - candIdx) === 1;
    });
    const candWork = candidate.workMinutes ?? candidate.plannedMinutes;
    const hasGameNoWork = candWork === 0 && (candidate.leisureMinutes ?? 0) > 0;
    if (hasGameNoWork || !hasAdjacent || sorted.length <= count + 1) {
      selected.push(candidate);
      usedDates.add(candidate.dateKey);
    }
  }

  // Fill any remaining slots from sorted order
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    if (!usedDates.has(candidate.dateKey)) {
      selected.push(candidate);
      usedDates.add(candidate.dateKey);
    }
  }

  // Sort chronologically so (1/3) is earliest day, (2/3) is middle day, (3/3) is later day
  selected.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  // If count > 7, cycle
  while (selected.length < count) {
    selected.push(sorted[selected.length % sorted.length]);
  }

  return selected;
}

/**
 * 3. Serbest metin akıllı dökümü (Smart Brain Dump) görevlere ayrıştırma
 */
export async function parseSmartDumpWithAI(
  rawText: string,
  context: {
    todayKey: string;
    tomorrowKey: string;
    currentWeekKey: string;
    currentMonthKey: string;
    dayLoads?: DayLoadInfo[];
  }
): Promise<{
  tasks: {
    title: string;
    horizon: TaskHorizon;
    scheduledDate: string | null;
    scheduledTime?: string | null;
    recurrence?: RecurrencePattern;
    recurrenceDays?: number[];
    priority: TaskPriority;
    estimatedMinutes: number;
    tags: string[];
    suggestedReason?: string;
  }[];
}> {
  if (!rawText.trim()) {
    return { tasks: [] };
  }

  const { lines: calendarLines, weekdayToDate, upcomingDays } = buildUpcomingDaysMap(
    context.todayKey,
    context.dayLoads
  );
  const upcomingDayMap = new Map(upcomingDays.map((d) => [d.dateKey, d]));

  // Smart local fallback in case Ollama is offline
  const buildSmartFallback = () => {
    // Keep "pazartesi ve perşembe" together so it is not split into two tasks
    const DAY_WORDS = '(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|cuma|pazar)';
    const protectedText = rawText.replace(
      new RegExp(`${DAY_WORDS}\\s+ve\\s+(?=${DAY_WORDS})`, 'giu'),
      '$1 & '
    );
    const lines = protectedText
      .split(/\n|;|(?:\s+ve\s+)|(?:,\s*(?=[a-zA-ZçğıöşüÇĞİÖŞÜ0-9]))/)
      .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
      .filter(Boolean);

    const results: {
      title: string;
      horizon: TaskHorizon;
      scheduledDate: string | null;
      scheduledTime?: string | null;
      recurrence?: RecurrencePattern;
      recurrenceDays?: number[];
      priority: TaskPriority;
      estimatedMinutes: number;
      tags: string[];
      suggestedReason?: string;
    }[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      let horizon: TaskHorizon = 'day';
      let scheduledDate: string | null = context.todayKey;
      let scheduledTime: string | null = null;
      let recurrence: RecurrencePattern = 'none';
      let recurrenceDays: number[] | undefined = undefined;
      const tags: string[] = [];

      let matchedWeekday = false;
      // Longest names first: "cumartesi" contains "cuma", "pazartesi" contains "pazar"
      const weekdayEntries = Object.entries(weekdayToDate).sort((a, b) => b[0].length - a[0].length);
      for (const [dayName, dateStr] of weekdayEntries) {
        if (lower.includes(dayName)) {
          horizon = 'day';
          scheduledDate = dateStr;
          matchedWeekday = true;
          break;
        }
      }

      if (!matchedWeekday) {
        if (lower.includes('yarın')) {
          horizon = 'day';
          scheduledDate = context.tomorrowKey;
        } else if (lower.includes('bu ay') || lower.includes('aylık')) {
          horizon = 'month';
          scheduledDate = null;
        } else if (lower.includes('bu hafta') || lower.includes('haftaya') || lower.includes('haftalık')) {
          horizon = 'week';
          scheduledDate = null;
        }
      }

      // Check time hints
      if (lower.includes('kahvaltı') || lower.includes('öğle') || lower.includes('ogle')) {
        scheduledTime = '12:00';
      } else if (lower.includes('akşam') || lower.includes('aksam') || lower.includes('gece')) {
        scheduledTime = '22:00';
      } else if (lower.includes('sabah')) {
        scheduledTime = '10:00';
      }

      // Check recurrence hints
      if (
        lower.includes('pazartesi ve perşembe') ||
        lower.includes('pazartesi & perşembe') ||
        lower.includes('pzt ve per')
      ) {
        recurrence = 'custom_days';
        recurrenceDays = [1, 4];
      } else if (lower.includes('her gün') || lower.includes('günlük')) {
        recurrence = 'daily';
      }

      let priority: TaskPriority = 'medium';
      if (lower.includes('acil') || lower.includes('kritik')) priority = 'urgent';
      else if (lower.includes('önemli') || lower.includes('yüksek')) priority = 'high';

      // Detect "3 adet ...", "3 tane ..."
      const countMatch = line.match(/\b([2-9])\s*(?:adet|tane|kez|defa)\b/i);
      const cleanBaseTitle = line
        .replace(/ & /g, ' ve ')
        .replace(/\bbu hafta\b/gi, '')
        .replace(/\bbu ay\b/gi, '')
        .replace(/\byarın\b/gi, '')
        .replace(/\b([2-9])\s*(?:adet|tane|kez|defa)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (countMatch) {
        const count = parseInt(countMatch[1], 10);
        const suggestedDays =
          horizon !== 'month' ? pickBestAvailableDays(upcomingDays, count) : [];

        for (let i = 1; i <= count; i++) {
          const chosenDay = suggestedDays[i - 1];
          results.push({
            title: `${cleanBaseTitle || line} (${i}/${count})`,
            horizon: chosenDay ? 'day' : horizon,
            scheduledDate: chosenDay ? chosenDay.dateKey : scheduledDate,
            scheduledTime,
            recurrence,
            recurrenceDays,
            priority,
            estimatedMinutes: 30,
            tags,
            suggestedReason: chosenDay ? formatDayRecommendationReason(chosenDay) : undefined,
          });
        }
      } else {
        results.push({
          title: cleanBaseTitle || line,
          horizon,
          scheduledDate,
          scheduledTime,
          recurrence,
          recurrenceDays,
          priority,
          estimatedMinutes: 25,
          tags,
        });
      }
    }
    return results;
  };

  try {
    const systemPrompt = `Sen Todo Plus için Türkçe serbest metin (Smart Dump) ayrıştırıcısı ve akıllı gün önericisisin.
Takvim ve Günlük İş / Oyun-Eğlence / Sabit Rutin Durumu:
${calendarLines.join('\n')}
- Bu hafta: ${context.currentWeekKey}, Bu ay: ${context.currentMonthKey}

KURALLAR:
1. "3 adet post", "3 tane post", "2 blog yazısı", "4 video" gibi çoklu adetli işleri mutlaka (1/N), (2/N)... şeklinde AYRI görevler olarak dizide döndür VE her birine "horizon": "day" verip yukarıdaki takvimde [İŞ İÇİN ÇOK UYGUN] veya [TAMAMEN MÜSAİT] olan FARKLI bir günün "YYYY-MM-DD" tarihini "scheduledDate" olarak ata!
2. Gün seçimi yaparken: O gün "Oyun/Eğlence" süresi yüksek olsa bile eğer "İş" yükü 0 dk veya çok az ise o günleri ÖNCELİKLE SEÇ ve "scheduledDate" alanına o günün tarihini yaz! "suggestedReason" alanına neden o günü seçtiğini yaz.
3. Metinde belirli bir gün ("bugün", "yarın", "çarşamba", "cuma", "pazar", "haftaya pazartesi" vb.) açıkça yazıldıysa: "horizon": "day" ve "scheduledDate": "YYYY-MM-DD" yap.
4. Sadece metinde açıkça "bu ay", "aylık", "bu ay içinde" kelimesi geçiyorsa: "horizon": "month", "scheduledDate": null yap.
5. Görev başlığını ("title") temiz ve net yaz; saat varsa başlığa ekle.
6. "priority": "low" | "medium" | "high" | "urgent", "estimatedMinutes": 15-180 arası sayı, "tags": Türkçe etiket dizisi.
SADECE JSON döndür:
{"tasks":[{"title":"Post Paylaşımı (1/3)","horizon":"day","scheduledDate":"YYYY-MM-DD","priority":"medium","estimatedMinutes":30,"tags":["iş"],"suggestedReason":"..."}]}${languageRule()}`;

    const rawOutput = await callOllamaChat(systemPrompt, rawText);
    const jsonStr = extractJsonBlock(rawOutput);
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
      const validHorizons: TaskHorizon[] = ['day', 'week', 'month', 'backlog'];
      const explicitlyMonthly = /\b(bu ay|aylık|ay içinde)\b/i.test(rawText);

      const rawTasks = parsed.tasks.map((t: RawModelTask) => {
        const hasValidDate =
          typeof t.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.scheduledDate);
        let horizon: TaskHorizon = validHorizons.includes(t.horizon as TaskHorizon)
          ? (t.horizon as TaskHorizon)
          : 'day';
        if (horizon === 'month' && !explicitlyMonthly) {
          horizon = 'week';
        }
        let scheduledDate: string | null = hasValidDate ? (t.scheduledDate as string) : null;

        if (scheduledDate) {
          horizon = 'day';
        } else if (horizon === 'day') {
          scheduledDate = context.todayKey;
        }

        const priority: TaskPriority = validPriorities.includes(t.priority as TaskPriority)
          ? (t.priority as TaskPriority)
          : 'medium';
        const estimatedMinutes = Math.max(15, Math.min(180, Number(t.estimatedMinutes) || 30));
        const tags: string[] = Array.isArray(t.tags)
          ? t.tags.map((s: unknown) => String(s).trim()).filter(Boolean)
          : [];
        const suggestedReason =
          typeof t.suggestedReason === 'string' && t.suggestedReason.trim()
            ? t.suggestedReason.trim()
            : undefined;

        const scheduledTime =
          typeof t.scheduledTime === 'string' && t.scheduledTime.trim()
            ? t.scheduledTime.trim()
            : null;
        const validRecurrences: RecurrencePattern[] = ['none', 'daily', 'weekly', 'monthly', 'custom_days'];
        const recurrence: RecurrencePattern = validRecurrences.includes(t.recurrence as RecurrencePattern)
          ? (t.recurrence as RecurrencePattern)
          : 'none';
        const recurrenceDays = Array.isArray(t.recurrenceDays)
          ? t.recurrenceDays.filter((d): d is number => typeof d === 'number')
          : undefined;

        return {
          title: String(t.title || tr2('New task', 'Yeni Görev')).trim(),
          horizon,
          scheduledDate,
          scheduledTime,
          recurrence,
          recurrenceDays,
          priority,
          estimatedMinutes,
          tags,
          suggestedReason,
        };
      });

      // Automatically number duplicate titles if model returned identical titles (e.g. "Post paylaşımı" x3)
      const titleCounts = new Map<string, number>();
      for (const rt of rawTasks) {
        titleCounts.set(rt.title, (titleCounts.get(rt.title) || 0) + 1);
      }
      const titleRunningIdx = new Map<string, number>();
      const numberedTasks = rawTasks.map((rt: typeof rawTasks[0]) => {
        const total = titleCounts.get(rt.title) || 1;
        if (total > 1) {
          const idx = (titleRunningIdx.get(rt.title) || 0) + 1;
          titleRunningIdx.set(rt.title, idx);
          return { ...rt, title: `${rt.title} (${idx}/${total})` };
        }
        return rt;
      });

      // Ensure multi-count series (e.g. (1/3), 1., #1) are distributed across best low-work / gaming-heavy days!
      const multiSeriesIndices: number[] = [];
      numberedTasks.forEach((t: typeof numberedTasks[0], i: number) => {
        if (
          (/\(\d+\/\d+\)|(?:^|\s|#)[1-9](?:\.|\b)/.test(t.title) || numberedTasks.length >= 2) &&
          t.horizon !== 'month'
        ) {
          if (/\(\d+\/\d+\)|(?:^|\s|#)[1-9](?:\.|\b)/.test(t.title)) {
            multiSeriesIndices.push(i);
          }
        }
      });

      if (multiSeriesIndices.length >= 2 && upcomingDays.length > 0) {
        const bestDays = pickBestAvailableDays(upcomingDays, multiSeriesIndices.length);
        const distinctDates = new Set(
          multiSeriesIndices.map((idx) => numberedTasks[idx].scheduledDate).filter(Boolean)
        );
        const modelTotalWorkOnChosenDays = multiSeriesIndices.reduce((acc, idx) => {
          const dKey = numberedTasks[idx].scheduledDate;
          const info = dKey ? upcomingDayMap.get(dKey) : undefined;
          return acc + (info ? (info.workMinutes ?? info.plannedMinutes) : 999);
        }, 0);
        const bestTotalWork = bestDays.reduce(
          (acc, d) => acc + (d.workMinutes ?? d.plannedMinutes),
          0
        );

        if (
          distinctDates.size < Math.min(multiSeriesIndices.length, upcomingDays.length) ||
          modelTotalWorkOnChosenDays > bestTotalWork
        ) {
          multiSeriesIndices.forEach((taskIdx, i) => {
            const chosen = bestDays[i];
            if (chosen) {
              numberedTasks[taskIdx].horizon = 'day';
              numberedTasks[taskIdx].scheduledDate = chosen.dateKey;
              numberedTasks[taskIdx].suggestedReason = formatDayRecommendationReason(chosen);
            }
          });
        }
      }

      // Enrich suggestedReason if a task has a scheduledDate in upcomingDays
      for (const nt of numberedTasks) {
        if (nt.scheduledDate) {
          const dayInfo = upcomingDayMap.get(nt.scheduledDate);
          if (dayInfo && (!nt.suggestedReason || (dayInfo.leisureMinutes ?? 0) > 0)) {
            nt.suggestedReason = formatDayRecommendationReason(dayInfo);
          }
        }
      }

      return { tasks: numberedTasks };
    }

    return { tasks: buildSmartFallback() };
  } catch (err) {
    console.warn('parseSmartDumpWithAI fallback triggered:', err);
    return { tasks: buildSmartFallback() };
  }
}

/**
 * 4. Ayın hedefini (Milestone) 3-4 eyleme dönüştürülebilir göreve bölme
 */
export async function generateMilestoneTasksWithAI(
  milestoneTitle: string
): Promise<{
  tasks: {
    title: string;
    horizon: 'week' | 'month';
    estimatedMinutes: number;
    priority: TaskPriority;
  }[];
}> {
  const fallback = {
    tasks: [
      {
        title: t(`${milestoneTitle} - Research and planning`, `${milestoneTitle} - Araştırma ve Planlama`),
        horizon: 'week' as const,
        estimatedMinutes: 60,
        priority: 'high' as TaskPriority,
      },
      {
        title: t(`${milestoneTitle} - Core implementation`, `${milestoneTitle} - Çekirdek Uygulama Aşaması`),
        horizon: 'week' as const,
        estimatedMinutes: 90,
        priority: 'high' as TaskPriority,
      },
      {
        title: t(`${milestoneTitle} - Review, test and deliver`, `${milestoneTitle} - İnceleme, Test ve Teslim`),
        horizon: 'month' as const,
        estimatedMinutes: 45,
        priority: 'medium' as TaskPriority,
      },
    ],
  };

  try {
    const systemPrompt = `Sen Todo Plus için Türkçe çalışan aylık hedef ve kilometre taşı (Milestone) kırılım uzmanısın.
Verilen aylık hedefi 3 ila 4 adet somut, eyleme dökülebilir hafta veya ay görevine böl.
Kurallar:
- 'horizon': 'week' veya 'month'
- 'estimatedMinutes': 15 ile 180 arasında dakika sayısı
- 'priority': 'low' | 'medium' | 'high' | 'urgent'
Cevabını SADECE geçerli JSON olarak ver:
{
  "tasks": [
    { "title": "1. Aşama Planlama", "horizon": "week", "estimatedMinutes": 60, "priority": "high" }
  ]
}${languageRule()}`;

    const rawOutput = await callOllamaChat(systemPrompt, `Aylık Hedef: "${milestoneTitle}"`);
    const jsonStr = extractJsonBlock(rawOutput);
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
      const tasks = parsed.tasks.slice(0, 4).map((t: RawModelTask) => ({
        title: String(t.title || tr2(`${milestoneTitle} subtask`, `${milestoneTitle} alt görevi`)).trim(),
        horizon: (t.horizon === 'month' ? 'month' : 'week') as 'week' | 'month',
        estimatedMinutes: Math.max(15, Math.min(180, Number(t.estimatedMinutes) || 45)),
        priority: validPriorities.includes(t.priority as TaskPriority) ? (t.priority as TaskPriority) : 'medium',
      }));

      return { tasks };
    }

    return fallback;
  } catch (err) {
    console.warn('generateMilestoneTasksWithAI fallback triggered:', err);
    return fallback;
  }
}
