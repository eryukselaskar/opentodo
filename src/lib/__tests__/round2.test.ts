import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTodoStore } from '../../store/useTodoStore';
import { computeDayWorkload } from '../dateUtils';
import { computeCompletionStats, computeRoutineStats } from '../analytics';
import { getWeekPoolTasks, getPullablePoolTasksForDay } from '../pools';
import { getDueReminders } from '../reminders';
import { isBackupOverdue } from '../autoBackup';

const store = () => useTodoStore.getState();

beforeEach(() => {
  useTodoStore.setState({
    tasks: [],
    milestones: [],
    focusLogs: [],
    editingTaskId: null,
    editingDateKey: null,
    activeFocusTaskId: null,
    selectedDateKey: '2026-10-19',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Rutinlerde gün bağlamı', () => {
  it('detay paneli o güne ait mevcut örneği açar, yoksa günü hatırlar', () => {
    const t = store().addTask({ title: 'Esneme', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(t.id, '2026-10-22');
    const thu = store().tasks.find((x) => x.scheduledDate === '2026-10-22')!;

    store().setEditingTaskId(t.id, '2026-10-22');
    expect(store().editingTaskId).toBe(thu.id);
    expect(store().editingDateKey).toBe('2026-10-22');

    store().setEditingTaskId(t.id, '2026-10-23');
    expect(store().editingTaskId).toBe(t.id);
    expect(store().editingDateKey).toBe('2026-10-23');

    store().setEditingTaskId('baska');
    expect(store().editingDateKey).toBeNull();
  });

  it('rutinde başlatılan odak seansı o günün kaydına yazılır', () => {
    const t = store().addTask({ title: 'Kod', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().setActiveFocusTaskId(t.id, '2026-10-22');
    const focusId = store().activeFocusTaskId!;
    expect(focusId).not.toBe(t.id);
    expect(store().tasks.find((x) => x.id === focusId)?.scheduledDate).toBe('2026-10-22');

    store().logFocusSession(focusId, 25);
    expect(store().tasks.find((x) => x.id === focusId)?.pomodoroCount).toBe(1);
    expect(store().tasks.find((x) => x.id === t.id)?.pomodoroCount).toBe(0);
  });
});

describe('Erken bitirilen odak seansı', () => {
  it('geçen süre kadar kaydedilir', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 0));
    store().setTimerMode('work', 25);
    store().setTimerRunning(true);
    vi.setSystemTime(new Date(2026, 9, 22, 10, 10, 0));

    expect(store().completeSessionEarly()).toBe(10);
    expect(store().focusLogs[0].durationMinutes).toBe(10);
    expect(store().timerIsRunning).toBe(false);
    expect(store().timerSecondsLeft).toBe(25 * 60);
  });

  it('1 dakikadan kısa seans kaydedilmez', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 0));
    store().setTimerMode('work', 25);
    store().setTimerRunning(true);
    vi.setSystemTime(new Date(2026, 9, 22, 10, 0, 20));

    expect(store().completeSessionEarly()).toBe(0);
    expect(store().focusLogs).toHaveLength(0);
  });
});

describe('Analitik', () => {
  it('tamamlama oranı rutin örneklerini saymaz', () => {
    const a = store().addTask({ title: 'Tek seferlik A', scheduledDate: '2026-10-19' });
    store().addTask({ title: 'Tek seferlik B', scheduledDate: '2026-10-19' });
    const r = store().addTask({ title: 'Rutin', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(a.id);
    store().toggleTaskDone(r.id); // rutin bir sonraki günü üretir

    const stats = computeCompletionStats(store().tasks);
    expect(stats.totalTasks).toBe(2);
    expect(stats.doneTasks).toBe(1);
    expect(stats.rate).toBe(50);
  });

  it('rutin takibi oran ve seriyi hesaplar', () => {
    const t = store().addTask({ title: 'Akşam yürüyüşü', scheduledDate: '2026-10-13', recurrence: 'daily' });
    for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) store().toggleTaskDone(t.id, d);

    const [stat] = computeRoutineStats(store().tasks, '2026-10-22', 7); // 16..22
    expect(stat.title).toBe('Akşam yürüyüşü');
    expect(stat.scheduledDays).toBe(7);
    expect(stat.doneDays).toBe(3);
    expect(stat.rate).toBe(43);
    expect(stat.streak).toBe(3);
  });

  it('bugün henüz yapılmadıysa bugünü saymaz, seri dünden devam eder', () => {
    const t = store().addTask({ title: 'Su iç', scheduledDate: '2026-10-20', recurrence: 'daily' });
    store().toggleTaskDone(t.id, '2026-10-20');
    store().toggleTaskDone(t.id, '2026-10-21');

    const [stat] = computeRoutineStats(store().tasks, '2026-10-22', 7);
    expect(stat.scheduledDays).toBe(2);
    expect(stat.doneDays).toBe(2);
    expect(stat.streak).toBe(2);
  });

  it('atlanan gün seriyi bozmaz ve paydaya girmez', () => {
    const t = store().addTask({ title: 'Kitap', scheduledDate: '2026-10-19', recurrence: 'daily' });
    store().toggleTaskDone(t.id, '2026-10-19');
    store().skipTaskForDate(t.id, '2026-10-20');
    store().toggleTaskDone(t.id, '2026-10-21');
    store().toggleTaskDone(t.id, '2026-10-22');

    const [stat] = computeRoutineStats(store().tasks, '2026-10-22', 7);
    expect(stat.scheduledDays).toBe(3);
    expect(stat.streak).toBe(3);
  });
});

describe('Havuzlar', () => {
  it('hafta havuzu yalnızca o haftanın görevlerini gösterir', () => {
    store().addTask({ title: 'W43 işi', horizon: 'week', weekKey: '2026-W43', scheduledDate: null });
    store().addTask({ title: 'W44 işi', horizon: 'week', weekKey: '2026-W44', scheduledDate: null });
    store().addTask({ title: 'Haftasız', horizon: 'week', weekKey: null, scheduledDate: null });
    const tasks = store().tasks;

    expect(getWeekPoolTasks(tasks, '2026-W43', '2026-W43').map((t) => t.title).sort()).toEqual(['Haftasız', 'W43 işi']);
    expect(getWeekPoolTasks(tasks, '2026-W44', '2026-W43').map((t) => t.title)).toEqual(['W44 işi']);
  });

  it('günden çekilecek havuz o günün haftasına ait ve açık görevlerdir', () => {
    store().addTask({ title: 'W43 açık', horizon: 'week', weekKey: '2026-W43', scheduledDate: null });
    const done = store().addTask({ title: 'W43 bitti', horizon: 'week', weekKey: '2026-W43', scheduledDate: null });
    store().updateTask(done.id, { status: 'done' });
    store().addTask({ title: 'W45', horizon: 'week', weekKey: '2026-W45', scheduledDate: null });

    expect(getPullablePoolTasksForDay(store().tasks, '2026-10-21', '2026-W43').map((t) => t.title)).toEqual(['W43 açık']);
  });
});

describe('İş yükü', () => {
  it('seçili günlere tekrar eden görevler rutin sayılır', () => {
    store().addTask({ title: 'D vit', scheduledDate: '2026-10-19', recurrence: 'custom_days', recurrenceDays: [1, 4], estimatedMinutes: 5 });
    const w = computeDayWorkload(store().tasks, '2026-10-22');
    expect(w.routineMinutes).toBe(5);
    expect(w.workMinutes).toBe(0);
  });
});

describe('Hatırlatmalar', () => {
  it('saati gelen ve henüz bildirilmemiş görevleri döndürür', () => {
    store().addTask({ title: 'Esneme', scheduledDate: '2026-10-22', scheduledTime: '12:00' });
    const tasks = store().tasks;

    const due = getDueReminders(tasks, new Date(2026, 9, 22, 12, 5), []);
    expect(due).toHaveLength(1);
    expect(getDueReminders(tasks, new Date(2026, 9, 22, 12, 5), [due[0].key])).toHaveLength(0);
    expect(getDueReminders(tasks, new Date(2026, 9, 22, 11, 59), [])).toHaveLength(0);
    expect(getDueReminders(tasks, new Date(2026, 9, 22, 13, 30), [])).toHaveLength(0);
  });

  it('başlıktaki saati ve günlük rutinleri de kapsar, bitenleri atlar', () => {
    const m = store().addTask({ title: '22:00 | Akşam yürüyüşü', scheduledDate: '2026-10-19', recurrence: 'daily' });
    const due = getDueReminders(store().tasks, new Date(2026, 9, 22, 22, 10), []);
    expect(due.map((d) => d.task.title)).toEqual(['22:00 | Akşam yürüyüşü']);

    store().toggleTaskDone(m.id, '2026-10-22');
    expect(getDueReminders(store().tasks, new Date(2026, 9, 22, 22, 10), [])).toHaveLength(0);
  });

  it('"Gece Kapanışı" gibi saatsiz başlıkları hatırlatmaz', () => {
    store().addTask({ title: 'Gece Kapanışı | Kitap', scheduledDate: '2026-10-22' });
    expect(getDueReminders(store().tasks, new Date(2026, 9, 22, 23, 30), [])).toHaveLength(0);
  });
});

describe('Yedek hatırlatma', () => {
  it('hiç yedek yoksa veya 7 günden eskiyse gecikmiş sayılır', () => {
    const now = new Date(2026, 9, 22, 12);
    expect(isBackupOverdue(null, now)).toBe(true);
    expect(isBackupOverdue(new Date(2026, 9, 19).toISOString(), now)).toBe(false);
    expect(isBackupOverdue(new Date(2026, 9, 14).toISOString(), now)).toBe(true);
  });
});
