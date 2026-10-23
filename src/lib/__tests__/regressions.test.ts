import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTodoStore, ensureSeriesIds } from '../../store/useTodoStore';
import {
  getTasksForDate,
  getTodayKey,
  shiftDateKey,
  formatRecurrenceLabel,
} from '../dateUtils';
import { parseQuickTaskInput, hasExplicitHorizonToken } from '../nlpParser';
import { parseSmartDumpWithAI } from '../ollamaClient';
import { getDayActivity, computeFocusStats } from '../analytics';
import { Task } from '../../types/todo';

const store = () => useTodoStore.getState();
const titlesOn = (dateKey: string) => getTasksForDate(store().tasks, dateKey).map((t) => t.title);

beforeEach(() => {
  useTodoStore.setState({
    tasks: [],
    milestones: [],
    focusLogs: [],
    lastDeletedTask: null,
    lastDeletedSeries: [],
    editingTaskId: null,
    activeFocusTaskId: null,
    selectedDateKey: '2026-10-19',
  });
});

describe('Tekrarlayan görev serileri', () => {
  it('yeniden adlandırma tüm seriye uygulanır, görev çift görünmez', () => {
    const t = store().addTask({ title: 'Kitap oku', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(t.id);
    const tue = store().tasks.find((x) => x.scheduledDate === '2026-10-20')!;
    store().updateTask(tue.id, { title: 'Roman oku' });
    expect(titlesOn('2026-10-22')).toEqual(['Roman oku']);
  });

  it('"Yarına Ertele" tarihli bir rutinin başlangıcını taşımaz', () => {
    const today = getTodayKey();
    const t = store().addTask({ title: 'İlaç', scheduledDate: shiftDateKey(today, -3), recurrence: 'daily' });
    store().postponeTaskToTomorrow(t.id);
    expect(titlesOn(today)).toEqual(['İlaç']);
    expect(titlesOn(shiftDateKey(today, -1))).toEqual(['İlaç']);
  });

  it('havuza gönderme / güne atama tarihli rutini bozmaz', () => {
    const t = store().addTask({ title: 'Rutin', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().assignTaskToWeekPool(t.id, '2026-W43');
    store().assignTaskToDay(t.id, '2026-10-25');
    expect(titlesOn('2026-10-21')).toEqual(['Rutin']);
  });

  it('rutini silmek tamamlanmış geçmişi korur, geri alma her şeyi geri getirir', () => {
    const t = store().addTask({ title: 'Spor', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(t.id); // Pzt tamam, Salı örneği oluştu
    const tue = store().tasks.find((x) => x.scheduledDate === '2026-10-20')!;
    store().deleteTask(tue.id);

    const kept = store().tasks.find((x) => x.id === t.id);
    expect(kept?.status).toBe('done');
    expect(titlesOn('2026-10-22')).toEqual([]);

    store().undoDeleteTask();
    expect(titlesOn('2026-10-22')).toEqual(['Spor']);
    expect(store().tasks.find((x) => x.id === t.id)?.recurrence).toBe('daily');
  });

  it('başlangıç tarihini ileri almak tamamlanmış geçmişi silmez', () => {
    const t = store().addTask({ title: 'Yürüyüş', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(t.id);
    const tue = store().tasks.find((x) => x.scheduledDate === '2026-10-20')!;
    store().updateTask(tue.id, { scheduledDate: '2026-10-25' });

    expect(store().tasks.find((x) => x.id === t.id)?.status).toBe('done');
    expect(titlesOn('2026-10-22')).toEqual([]);
    expect(titlesOn('2026-10-26')).toEqual(['Yürüyüş']);
  });

  it('yansıtılan günde MIT yapmak o güne ait örneği MIT yapar', () => {
    const t = store().addTask({ title: 'Odak', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskMIT(t.id, '2026-10-22');
    const thu = getTasksForDate(store().tasks, '2026-10-22');
    expect(thu).toHaveLength(1);
    expect(thu[0].isMIT).toBe(true);
    expect(store().tasks.find((x) => x.id === t.id)?.isMIT).toBe(false);
  });

  it('materializeRecurringInstance yalnızca o güne ait örnek oluşturur', () => {
    const t = store().addTask({ title: 'Plan', scheduledDate: '2026-10-19', recurrence: 'daily' });
    const id1 = store().materializeRecurringInstance(t.id, '2026-10-22');
    const id2 = store().materializeRecurringInstance(t.id, '2026-10-22');
    expect(id1).not.toBe(t.id);
    expect(id1).toBe(id2);
    store().updateTask(id1, { status: 'in_progress' });
    expect(getTasksForDate(store().tasks, '2026-10-22')[0].status).toBe('in_progress');
    expect(getTasksForDate(store().tasks, '2026-10-23')[0].status).toBe('todo');
  });

  it('seçili günlere tekrar eden görev izin verilmeyen günde görünmez', () => {
    store().addTask({ title: 'D vit', scheduledDate: '2026-10-21', recurrence: 'custom_days', recurrenceDays: [1, 4] });
    expect(titlesOn('2026-10-21')).toEqual([]); // Çarşamba
    expect(titlesOn('2026-10-22')).toEqual(['D vit']); // Perşembe
  });

  it('aylık tekrar ay sonunda taşmaz', () => {
    const t = store().addTask({ title: 'Kira', scheduledDate: '2027-01-31', recurrence: 'monthly' });
    store().toggleTaskDone(t.id);
    const feb = store().tasks.find((x) => x.id !== t.id)!;
    expect(feb.scheduledDate).toBe('2027-02-28');
    store().toggleTaskDone(feb.id);
    expect(store().tasks.some((x) => x.scheduledDate === '2027-03-31')).toBe(true);

    useTodoStore.setState({ tasks: [] });
    store().addTask({ title: 'Fatura', scheduledDate: '2027-01-31', recurrence: 'monthly' });
    expect(titlesOn('2027-04-30')).toEqual(['Fatura']);
    expect(titlesOn('2027-05-31')).toEqual(['Fatura']);
    expect(titlesOn('2027-05-30')).toEqual([]);
  });

  it('eski verideki tekrarlayan görevlere ortak seriId atanır', () => {
    const base = store().addTask({ title: 'X', scheduledDate: '2026-10-19', recurrence: 'daily' });
    const legacy: Task[] = [
      { ...base, id: 'a', seriesId: undefined },
      { ...base, id: 'b', seriesId: undefined, scheduledDate: '2026-10-20' },
      { ...base, id: 'c', seriesId: undefined, title: 'Y' },
    ];
    const out = ensureSeriesIds(legacy);
    expect(out[0].seriesId).toBeTruthy();
    expect(out[0].seriesId).toBe(out[1].seriesId);
    expect(out[2].seriesId).not.toBe(out[0].seriesId);
  });

  it('formatRecurrenceLabel seçili günleri doğru yazar', () => {
    expect(formatRecurrenceLabel({ recurrence: 'custom_days', recurrenceDays: [1, 4] })).toBe('Pzt, Per');
    expect(formatRecurrenceLabel({ recurrence: 'monthly' })).toBe('Her Ay');
    expect(formatRecurrenceLabel({ recurrence: 'none' })).toBeNull();
  });
});

describe('Silme ve içe aktarma güvenliği', () => {
  it('gecikmiş görevleri temizlemek geri alınabilir', () => {
    store().addTask({ title: 'Eski iş', scheduledDate: '2026-01-01' });
    store().rolloverOverdueTasks('delete');
    expect(store().tasks).toHaveLength(0);
    store().undoDeleteTask();
    expect(store().tasks.map((t) => t.title)).toEqual(['Eski iş']);
  });

  it('importJson geçersiz görev kaydını reddeder', () => {
    const res = store().importJson(JSON.stringify({ tasks: [{ foo: 1 }] }));
    expect(res.ok).toBe(false);
  });

  it('importJson eksik alanları tamamlar ve geçici durumu sıfırlar', () => {
    useTodoStore.setState({ editingTaskId: 'eski', activeFocusTaskId: 'eski' });
    const res = store().importJson(
      JSON.stringify({ tasks: [{ id: 'x1', title: 'Minimal', recurrence: 'daily', scheduledDate: '2026-10-19' }] })
    );
    expect(res.ok).toBe(true);
    const t = store().tasks[0];
    expect(t.tags).toEqual([]);
    expect(t.subtasks).toEqual([]);
    expect(t.status).toBe('todo');
    expect(t.seriesId).toBeTruthy();
    expect(store().editingTaskId).toBeNull();
    expect(store().activeFocusTaskId).toBeNull();
  });
});

describe('Pomodoro zamanlayıcısı', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arka plan sekmesinde geçen gerçek süreyi yakalar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 0));
    store().setTimerMode('work', 25);
    store().setTimerRunning(true);
    vi.setSystemTime(new Date(2026, 9, 22, 10, 10, 0)); // 10 dk sonra tek bir tick
    store().tickTimer();
    expect(store().timerSecondsLeft).toBe(15 * 60);
  });

  it('mola bitişini bildirir', () => {
    store().setTimerMode('short_break', 5);
    store().setTimerRunning(true);
    useTodoStore.setState({ timerSecondsLeft: 1 });
    const res = store().tickTimer();
    expect(res.completedBreak).toBe(true);
    expect(res.completedWorkSession).toBe(false);
  });
});

describe('NLP sezgileri', () => {
  const ref = new Date(2026, 9, 22, 12, 0, 0);

  it('sıradan başlıkları tekrar/saat olarak yorumlamaz', () => {
    expect(parseQuickTaskInput('Günlük raporu yaz', ref).recurrence).toBe('none');
    expect(parseQuickTaskInput('Akşam yemeği hazırla', ref).scheduledTime).toBeNull();
    expect(parseQuickTaskInput('Hafta sonu planı yap', ref).recurrence).toBe('none');
    const v = parseQuickTaskInput('Sürüm 2.10 yayınla', ref);
    expect(v.scheduledTime).toBeNull();
    expect(v.title).toBe('Sürüm 2.10 yayınla');
    expect(parseQuickTaskInput('Kitap al', ref).tags).toEqual([]);
  });

  it('açık saat ifadelerini hâlâ tanır', () => {
    expect(parseQuickTaskInput('Toplantı 14:30', ref).scheduledTime).toBe('14:30');
    expect(parseQuickTaskInput('saat 9.15 koşu', ref).scheduledTime).toBe('09:15');
    expect(parseQuickTaskInput('Kod 25:99 hatası', ref).scheduledTime).toBeNull();
    expect(parseQuickTaskInput('her hafta sonu yürüyüş', ref).recurrenceDays).toEqual([6, 7]);
  });

  it('hasExplicitHorizonToken yalnızca tam belirteçleri tanır', () => {
    expect(hasExplicitHorizonToken('Kahve @ayşe ile')).toBe(false);
    expect(hasExplicitHorizonToken('Lansman @2026-10-25')).toBe(true);
    expect(hasExplicitHorizonToken('Plan @gelecekhafta')).toBe(true);
  });
});

describe('AI yedek ayrıştırıcı', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gün adlarını doğru tarihe eşler', async () => {
    const r = await parseSmartDumpWithAI('cumartesi halı saha\npazartesi toplantı\ncuma sinema', {
      todayKey: '2026-10-22', // Perşembe
      tomorrowKey: '2026-10-23',
      currentWeekKey: '2026-W43',
      currentMonthKey: '2026-10',
    });
    expect(r.tasks.map((t) => t.scheduledDate)).toEqual(['2026-10-24', '2026-10-26', '2026-10-23']);
  });

  it('"pazartesi ve perşembe" kalıbını bölmeden tekrar olarak tanır', async () => {
    const r = await parseSmartDumpWithAI('pazartesi ve perşembe yüzme', {
      todayKey: '2026-10-22',
      tomorrowKey: '2026-10-23',
      currentWeekKey: '2026-W43',
      currentMonthKey: '2026-10',
    });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].recurrence).toBe('custom_days');
    expect(r.tasks[0].recurrenceDays).toEqual([1, 4]);
  });
});

describe('Analitik', () => {
  it('odak süresini iki kez saymaz', () => {
    const stats = computeFocusStats([
      { id: '1', taskId: 't', durationMinutes: 25, completedAt: '2026-10-22T09:00:00.000Z', dateKey: '2026-10-22' },
    ]);
    expect(stats.totalMinutes).toBe(25);
    expect(stats.totalSessions).toBe(1);
  });

  it('tamamlanmayı yerel tarihe ve tek bir güne yazar', () => {
    const local = new Date(2026, 9, 22, 1, 30, 0); // yerel gece 01:30
    const task = {
      ...store().addTask({ title: 'Gece işi', scheduledDate: '2026-10-20' }),
      status: 'done' as const,
      completedAt: local.toISOString(),
    };
    expect(getDayActivity('2026-10-22', [task], []).completedCount).toBe(1);
    expect(getDayActivity('2026-10-20', [task], []).completedCount).toBe(0);
  });
});
