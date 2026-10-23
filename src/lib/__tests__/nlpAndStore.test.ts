import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTodayKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  getWeekKeyFromDateKey,
  getMonthKeyFromDateKey,
  getWeekDays,
  getMonthCalendarDays,
  shiftDateKey,
  shiftWeekKey,
  shiftMonthKey,
  formatTurkishDate,
  formatWeekRangeLabel,
  formatMonthLabel,
  getTasksForDate,
} from '../dateUtils';
import { Task } from '../../types/todo';
import { parseQuickTaskInput } from '../nlpParser';
import { useTodoStore } from '../../store/useTodoStore';
import {
  cleanJsonOutput,
  extractJsonBlock,
  checkOllamaStatus,
  generateSubtasksWithAI,
  autoScheduleWeekWithAI,
  parseSmartDumpWithAI,
  generateMilestoneTasksWithAI,
} from '../ollamaClient';

describe('Date Utilities (dateUtils.ts)', () => {
  const refDate = new Date(2026, 9, 19, 12, 0, 0); // 19 Ekim 2026, Monday

  it('calculates today key, week key and month key accurately', () => {
    expect(getTodayKey(refDate)).toBe('2026-10-19');
    expect(getCurrentWeekKey(refDate)).toBe('2026-W43');
    expect(getCurrentMonthKey(refDate)).toBe('2026-10');
    expect(getWeekKeyFromDateKey('2026-10-19')).toBe('2026-W43');
    expect(getMonthKeyFromDateKey('2026-10-19')).toBe('2026-10');
  });

  it('generates 7 week days for an ISO week starting on Monday', () => {
    const days = getWeekDays('2026-W43');
    expect(days).toHaveLength(7);
    expect(days[0].dateKey).toBe('2026-10-19');
    expect(days[0].dayName).toBe('Pazartesi');
    expect(days[0].shortName).toBe('Pzt');
    expect(days[6].dateKey).toBe('2026-10-25');
    expect(days[6].dayName).toBe('Pazar');
    expect(days[6].shortName).toBe('Paz');
  });

  it('generates a grid of 35 or 42 days for month calendar', () => {
    const cells = getMonthCalendarDays('2026-10');
    expect([35, 42]).toContain(cells.length);
    // The first day of the grid should be a Monday (Sept 28, 2026)
    expect(cells[0].dateKey).toBe('2026-09-28');
    expect(cells[0].isCurrentMonth).toBe(false);
    // Cell for Oct 1 should be current month
    const oct1 = cells.find((c) => c.dateKey === '2026-10-01');
    expect(oct1).toBeDefined();
    expect(oct1?.isCurrentMonth).toBe(true);
  });

  it('shifts dates, weeks and months correctly', () => {
    expect(shiftDateKey('2026-10-19', 1)).toBe('2026-10-20');
    expect(shiftDateKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDateKey('2026-10-19', -1)).toBe('2026-10-18');

    expect(shiftWeekKey('2026-W43', 1)).toBe('2026-W44');
    expect(shiftWeekKey('2026-W43', -1)).toBe('2026-W42');

    expect(shiftMonthKey('2026-10', 1)).toBe('2026-11');
    expect(shiftMonthKey('2026-10', -1)).toBe('2026-09');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('formats Turkish date labels properly', () => {
    expect(formatTurkishDate('2026-10-19')).toBe('19 Eki 2026 Pzt');
    expect(formatWeekRangeLabel('2026-W43')).toBe('43. Hafta (19 Eki - 25 Eki)');
    expect(formatMonthLabel('2026-10')).toBe('Ekim 2026');
  });
});

describe('NLP Parser (nlpParser.ts)', () => {
  const refDate = new Date(2026, 9, 19, 12, 0, 0); // Monday, 2026-10-19

  it('parses tags, priorities, durations, and horizons', () => {
    const input = 'Q4 Raporunu hazırla #iş #finans !acil ~45dk @yarın %haftalık';
    const parsed = parseQuickTaskInput(input, refDate);

    expect(parsed.title).toBe('Q4 Raporunu hazırla');
    expect(parsed.tags).toEqual(['iş', 'finans']);
    expect(parsed.priority).toBe('urgent');
    expect(parsed.estimatedMinutes).toBe(45);
    expect(parsed.horizon).toBe('day');
    expect(parsed.scheduledDate).toBe('2026-10-20');
    expect(parsed.weekKey).toBe('2026-W43');
    expect(parsed.monthKey).toBe('2026-10');
    expect(parsed.recurrence).toBe('weekly');
  });

  it('parses hour duration symbols (~1.5s, ~2h)', () => {
    const p1 = parseQuickTaskInput('Yazılım mimarisi ~1.5s', refDate);
    expect(p1.estimatedMinutes).toBe(90);

    const p2 = parseQuickTaskInput('Büyük sunum provası ~2saat', refDate);
    expect(p2.estimatedMinutes).toBe(120);

    const p3 = parseQuickTaskInput('Hızlı kontrol ~15m', refDate);
    expect(p3.estimatedMinutes).toBe(15);
  });

  it('parses different priority indicators', () => {
    expect(parseQuickTaskInput('Görev 1 !!!', refDate).priority).toBe('urgent');
    expect(parseQuickTaskInput('Görev 2 !urgent', refDate).priority).toBe('urgent');
    expect(parseQuickTaskInput('Görev 3 !yüksek', refDate).priority).toBe('high');
    expect(parseQuickTaskInput('Görev 4 !!', refDate).priority).toBe('high');
    expect(parseQuickTaskInput('Görev 5 !orta', refDate).priority).toBe('medium');
    expect(parseQuickTaskInput('Görev 6 !düşük', refDate).priority).toBe('low');
    expect(parseQuickTaskInput('Görev 7', refDate).priority).toBe('medium'); // default
  });

  it('parses horizon tokens (@buhafta, @buay, @YYYY-MM-DD)', () => {
    const weekTask = parseQuickTaskInput('Haftalık strateji planı @buhafta', refDate);
    expect(weekTask.horizon).toBe('week');
    expect(weekTask.scheduledDate).toBeNull();
    expect(weekTask.weekKey).toBe('2026-W43');

    const monthTask = parseQuickTaskInput('Aylık hedefler @buay', refDate);
    expect(monthTask.horizon).toBe('month');
    expect(monthTask.scheduledDate).toBeNull();
    expect(monthTask.weekKey).toBeNull();
    expect(monthTask.monthKey).toBe('2026-10');

    const specificDate = parseQuickTaskInput('Özel lansman @2026-10-25', refDate);
    expect(specificDate.horizon).toBe('day');
    expect(specificDate.scheduledDate).toBe('2026-10-25');
    expect(specificDate.weekKey).toBe('2026-W43');
  });

  it('defaults to today when no horizon token is given', () => {
    const def = parseQuickTaskInput('Basit görev', refDate);
    expect(def.horizon).toBe('day');
    expect(def.scheduledDate).toBe('2026-10-19');
    expect(def.weekKey).toBe('2026-W43');
    expect(def.monthKey).toBe('2026-10');
    expect(def.recurrence).toBe('none');
    expect(def.estimatedMinutes).toBe(25);
  });
});

describe('Zustand Todo Store (useTodoStore.ts)', () => {
  beforeEach(() => {
    // Reset store state
    useTodoStore.setState({
      tasks: [],
      milestones: [],
      focusLogs: [],
      selectedDateKey: '2026-10-19',
      selectedWeekKey: '2026-W43',
      selectedMonthKey: '2026-10',
    });
  });

  it('adds task via NLP with addTaskFromRaw', () => {
    const task = useTodoStore
      .getState()
      .addTaskFromRaw('Müşteri görüşmesi #satış !yüksek ~30dk @buhafta');

    expect(task.title).toBe('Müşteri görüşmesi');
    expect(task.tags).toContain('satış');
    expect(task.priority).toBe('high');
    expect(task.estimatedMinutes).toBe(30);
    expect(task.horizon).toBe('week');
    expect(task.scheduledDate).toBeNull();
    expect(useTodoStore.getState().tasks).toHaveLength(1);
  });

  it('toggles task done and spawns recurring task', () => {
    const task = useTodoStore.getState().addTask({
      title: 'Her gün kitap oku',
      scheduledDate: '2026-10-19',
      horizon: 'day',
      recurrence: 'daily',
    });

    useTodoStore.getState().toggleTaskDone(task.id);

    const state = useTodoStore.getState();
    const completedTask = state.tasks.find((t) => t.id === task.id);
    expect(completedTask?.status).toBe('done');
    expect(completedTask?.completedAt).toBeTruthy();

    // Should have spawned next day's task
    const nextTask = state.tasks.find((t) => t.id !== task.id);
    expect(nextTask).toBeDefined();
    expect(nextTask?.scheduledDate).toBe('2026-10-20');
    expect(nextTask?.status).toBe('todo');
    expect(nextTask?.completedAt).toBeNull();
  });

  it('enforces maximum 3 MIT tasks per scheduled day gracefully', () => {
    const t1 = useTodoStore.getState().addTask({ title: 'T1', scheduledDate: '2026-10-19', isMIT: false });
    const t2 = useTodoStore.getState().addTask({ title: 'T2', scheduledDate: '2026-10-19', isMIT: false });
    const t3 = useTodoStore.getState().addTask({ title: 'T3', scheduledDate: '2026-10-19', isMIT: false });
    const t4 = useTodoStore.getState().addTask({ title: 'T4', scheduledDate: '2026-10-19', isMIT: false });

    useTodoStore.getState().toggleTaskMIT(t1.id);
    useTodoStore.getState().toggleTaskMIT(t2.id);
    useTodoStore.getState().toggleTaskMIT(t3.id);

    let mits = useTodoStore.getState().tasks.filter((t) => t.isMIT && t.scheduledDate === '2026-10-19');
    expect(mits).toHaveLength(3);

    // Toggling 4th should replace oldest or keep max at 3
    useTodoStore.getState().toggleTaskMIT(t4.id);
    mits = useTodoStore.getState().tasks.filter((t) => t.isMIT && t.scheduledDate === '2026-10-19');
    expect(mits).toHaveLength(3);
    expect(useTodoStore.getState().tasks.find((t) => t.id === t4.id)?.isMIT).toBe(true);
  });

  it('assigns tasks between Day, Week Pool, and Month Pool', () => {
    const task = useTodoStore.getState().addTask({ title: 'Hareketli görev', horizon: 'backlog' });

    useTodoStore.getState().assignTaskToDay(task.id, '2026-10-21');
    let updated = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.horizon).toBe('day');
    expect(updated?.scheduledDate).toBe('2026-10-21');
    expect(updated?.weekKey).toBe('2026-W43');

    useTodoStore.getState().assignTaskToWeekPool(task.id, '2026-W43');
    updated = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.horizon).toBe('week');
    expect(updated?.scheduledDate).toBeNull();
    expect(updated?.weekKey).toBe('2026-W43');

    useTodoStore.getState().assignTaskToMonthPool(task.id, '2026-10');
    updated = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.horizon).toBe('month');
    expect(updated?.scheduledDate).toBeNull();
    expect(updated?.monthKey).toBe('2026-10');
  });

  it('handles rollover of overdue tasks', () => {
    useTodoStore.getState().addTask({
      title: 'Eski bitmemiş iş',
      scheduledDate: '2026-10-10', // overdue date
      status: 'todo',
    });

    useTodoStore.getState().rolloverOverdueTasks('to_today');
    const tasks = useTodoStore.getState().tasks;
    expect(tasks[0].scheduledDate).toBe(getTodayKey());
    expect(tasks[0].horizon).toBe('day');
  });

  it('manages subtasks and milestones', () => {
    const task = useTodoStore.getState().addTask({ title: 'Büyük Proje' });
    useTodoStore.getState().addSubtask(task.id, 'Alt iş 1');

    let currentTask = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(currentTask?.subtasks).toHaveLength(1);
    const subId = currentTask!.subtasks[0].id;

    useTodoStore.getState().toggleSubtask(task.id, subId);
    currentTask = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(currentTask?.subtasks[0].completed).toBe(true);

    useTodoStore.getState().deleteSubtask(task.id, subId);
    currentTask = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(currentTask?.subtasks).toHaveLength(0);

    useTodoStore.getState().addMilestone('Yeni Çeyrek Hedefi');
    expect(useTodoStore.getState().milestones).toHaveLength(1);
    const mId = useTodoStore.getState().milestones[0].id;

    useTodoStore.getState().toggleMilestone(mId);
    expect(useTodoStore.getState().milestones[0].completed).toBe(true);

    useTodoStore.getState().deleteMilestone(mId);
    expect(useTodoStore.getState().milestones).toHaveLength(0);
  });

  it('logs focus session and increments pomodoro count', () => {
    const task = useTodoStore.getState().addTask({ title: 'Pomodoro Görevi', pomodoroCount: 0 });
    useTodoStore.getState().logFocusSession(task.id, 25);

    const logs = useTodoStore.getState().focusLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0].durationMinutes).toBe(25);
    expect(logs[0].taskId).toBe(task.id);

    const updatedTask = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(updatedTask?.pomodoroCount).toBe(1);
  });

  it('exports and imports JSON state correctly', () => {
    useTodoStore.getState().addTask({ title: 'Yedeklenecek İş' });
    useTodoStore.getState().addMilestone('Yedeklenecek Hedef');

    const jsonStr = useTodoStore.getState().exportJson();
    expect(jsonStr).toContain('Yedeklenecek İş');
    expect(jsonStr).toContain('Yedeklenecek Hedef');

    // Clear state
    useTodoStore.setState({ tasks: [], milestones: [], focusLogs: [] });
    expect(useTodoStore.getState().tasks).toHaveLength(0);

    // Import back
    const res = useTodoStore.getState().importJson(jsonStr);
    expect(res.ok).toBe(true);
    expect(useTodoStore.getState().tasks).toHaveLength(1);
    expect(useTodoStore.getState().milestones).toHaveLength(1);
  });

  it('handles view mode navigation across all 6 temporal horizons and execution modes', () => {
    const { setActiveView } = useTodoStore.getState();

    setActiveView('day');
    expect(useTodoStore.getState().activeView).toBe('day');

    setActiveView('week');
    expect(useTodoStore.getState().activeView).toBe('week');

    setActiveView('month');
    expect(useTodoStore.getState().activeView).toBe('month');

    setActiveView('kanban');
    expect(useTodoStore.getState().activeView).toBe('kanban');

    setActiveView('focus');
    expect(useTodoStore.getState().activeView).toBe('focus');

    setActiveView('analytics');
    expect(useTodoStore.getState().activeView).toBe('analytics');
  });

  it('manages search query, tag filters, priority filters, and modals', () => {
    const store = useTodoStore.getState();

    store.setSearchQuery('test query');
    expect(useTodoStore.getState().searchQuery).toBe('test query');

    store.setSelectedTagFilter('frontend');
    expect(useTodoStore.getState().selectedTagFilter).toBe('frontend');

    store.setSelectedPriorityFilter('urgent');
    expect(useTodoStore.getState().selectedPriorityFilter).toBe('urgent');

    store.setCommandPaletteOpen(true);
    expect(useTodoStore.getState().commandPaletteOpen).toBe(true);

    store.setBackupModalOpen(true);
    expect(useTodoStore.getState().backupModalOpen).toBe(true);

    store.setEditingTaskId('task-123');
    expect(useTodoStore.getState().editingTaskId).toBe('task-123');
  });

  it('supports undoing deleted task and dismissing undo', () => {
    const task = useTodoStore.getState().addTask({ title: 'Silinecek Görev' });
    expect(useTodoStore.getState().tasks).toHaveLength(1);

    useTodoStore.getState().deleteTask(task.id);
    expect(useTodoStore.getState().tasks).toHaveLength(0);
    expect(useTodoStore.getState().lastDeletedTask?.id).toBe(task.id);

    // Undo delete restores task
    useTodoStore.getState().undoDeleteTask();
    expect(useTodoStore.getState().tasks).toHaveLength(1);
    expect(useTodoStore.getState().tasks[0].id).toBe(task.id);
    expect(useTodoStore.getState().lastDeletedTask).toBeNull();

    // Delete again and dismiss
    useTodoStore.getState().deleteTask(task.id);
    expect(useTodoStore.getState().lastDeletedTask).not.toBeNull();
    useTodoStore.getState().dismissUndo();
    expect(useTodoStore.getState().lastDeletedTask).toBeNull();
  });

  it('postpones task to tomorrow accurately and removes MIT flag', () => {
    const today = getTodayKey();
    const task = useTodoStore.getState().addTask({
      title: 'Ertelenen Görev',
      scheduledDate: today,
      isMIT: true,
      horizon: 'day',
    });

    useTodoStore.getState().postponeTaskToTomorrow(task.id);
    const updated = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    const expectedTomorrow = shiftDateKey(today, 1);

    expect(updated?.scheduledDate).toBe(expectedTomorrow);
    expect(updated?.horizon).toBe('day');
    expect(updated?.isMIT).toBe(false);
    expect(updated?.weekKey).toBe(getWeekKeyFromDateKey(expectedTomorrow));
    expect(updated?.monthKey).toBe(getMonthKeyFromDateKey(expectedTomorrow));
  });

  it('clears all data', () => {
    useTodoStore.getState().addTask({ title: 'Örnek İş' });
    useTodoStore.getState().addMilestone('Örnek Hedef');
    useTodoStore.getState().logFocusSession(null, 25);

    expect(useTodoStore.getState().tasks.length).toBeGreaterThan(0);

    useTodoStore.getState().clearAllData();
    expect(useTodoStore.getState().tasks).toHaveLength(0);
    expect(useTodoStore.getState().milestones).toHaveLength(0);
    expect(useTodoStore.getState().focusLogs).toHaveLength(0);
    expect(useTodoStore.getState().lastDeletedTask).toBeNull();
  });

  it('manages pomodoro timer modes, countdown, and auto focus session completion', () => {
    const store = useTodoStore.getState();

    // Initial state
    expect(store.timerMode).toBe('work');
    expect(store.timerDurationMinutes).toBe(25);
    expect(store.timerSecondsLeft).toBe(1500);
    expect(store.timerIsRunning).toBe(false);

    // Switch modes
    store.setTimerMode('short_break');
    expect(useTodoStore.getState().timerDurationMinutes).toBe(5);
    expect(useTodoStore.getState().timerSecondsLeft).toBe(300);

    store.setTimerMode('long_break', 20);
    expect(useTodoStore.getState().timerDurationMinutes).toBe(20);
    expect(useTodoStore.getState().timerSecondsLeft).toBe(1200);

    // Work session test
    const task = store.addTask({ title: 'Odak Görevi', pomodoroCount: 0 });
    store.setActiveFocusTaskId(task.id);
    store.setTimerMode('work', 25);
    store.setTimerRunning(true);
    expect(useTodoStore.getState().timerIsRunning).toBe(true);

    // Tick when seconds > 1
    const res1 = useTodoStore.getState().tickTimer();
    expect(res1.completedWorkSession).toBe(false);
    expect(useTodoStore.getState().timerSecondsLeft).toBe(1499);

    // Simulate tick at last second
    useTodoStore.setState({ timerSecondsLeft: 1 });
    const res2 = useTodoStore.getState().tickTimer();
    expect(res2.completedWorkSession).toBe(true);
    expect(useTodoStore.getState().timerIsRunning).toBe(false);
    expect(useTodoStore.getState().timerSecondsLeft).toBe(25 * 60);

    // Verify focus log was recorded and task pomodoroCount incremented
    const logs = useTodoStore.getState().focusLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0].durationMinutes).toBe(25);
    expect(logs[0].taskId).toBe(task.id);

    const updatedTask = useTodoStore.getState().tasks.find((t) => t.id === task.id);
    expect(updatedTask?.pomodoroCount).toBe(1);

    // Reset timer
    useTodoStore.getState().setTimerRunning(true);
    useTodoStore.getState().resetTimer();
    expect(useTodoStore.getState().timerIsRunning).toBe(false);
    expect(useTodoStore.getState().timerSecondsLeft).toBe(25 * 60);
  });

  it('manages dark mode and create drawer state', () => {
    expect(useTodoStore.getState().darkMode).toBe(true);
    useTodoStore.getState().toggleDarkMode();
    expect(useTodoStore.getState().darkMode).toBe(false);
    useTodoStore.getState().toggleDarkMode();
    expect(useTodoStore.getState().darkMode).toBe(true);

    expect(useTodoStore.getState().createDrawerOpen).toBe(false);
    useTodoStore.getState().setCreateDrawerOpen(true);
    expect(useTodoStore.getState().createDrawerOpen).toBe(true);
  });
});

describe('Ollama AI Client (ollamaClient.ts)', () => {
  // Never reach a real local Ollama from tests; individual tests may mock fetch further
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline (test)')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips <think> blocks and code fences cleanly', () => {
    const rawWithThink = '<think>Model reasoning here\nstep 1\nstep 2</think>```json\n{"subtasks": ["A", "B"]}\n```';
    const cleaned = cleanJsonOutput(rawWithThink);
    expect(cleaned).toBe('{"subtasks": ["A", "B"]}');

    const json = extractJsonBlock(rawWithThink);
    expect(JSON.parse(json)).toEqual({ subtasks: ['A', 'B'] });
  });

  it('extracts JSON objects from conversational wrapped text', () => {
    const rawConversational = 'Tabii ki, işte alt görevleriniz:\n{\n  "subtasks": ["Tasarımı yap", "Kodu yaz"],\n  "estimatedMinutes": 45,\n  "priority": "high"\n}\nUmarım yardımcı olur!';
    const json = extractJsonBlock(rawConversational);
    const parsed = JSON.parse(json);
    expect(parsed.subtasks).toHaveLength(2);
    expect(parsed.estimatedMinutes).toBe(45);
    expect(parsed.priority).toBe('high');
  });

  it('handles checkOllamaStatus gracefully when offline or mock', async () => {
    const status = await checkOllamaStatus();
    expect(typeof status.online).toBe('boolean');
    expect(typeof status.model).toBe('string');
  });

  it('generates subtasks with fallback if Ollama call encounters network issue', async () => {
    const result = await generateSubtasksWithAI('Mobil Uygulama Tasarımı', 'Figma dosyası hazır');
    expect(result.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(result.estimatedMinutes).toBeGreaterThanOrEqual(15);
    expect(result.estimatedMinutes).toBeLessThanOrEqual(180);
    expect(['low', 'medium', 'high', 'urgent']).toContain(result.priority);
  });

  it('auto schedules week tasks with fallback or AI distribution', async () => {
    const pool = [
      { id: 'task-1', title: 'Veritabanı Şeması', priority: 'urgent' as const, estimatedMinutes: 60 },
      { id: 'task-2', title: 'İkon Seti', priority: 'low' as const, estimatedMinutes: 30 },
    ];
    const days = [
      { dateKey: '2026-10-19', dayName: 'Pazartesi', currentMinutes: 0 },
      { dateKey: '2026-10-20', dayName: 'Salı', currentMinutes: 0 },
    ];

    const result = await autoScheduleWeekWithAI(pool, days);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0].taskId).toBe('task-1');
    expect(result.assignments[0].dateKey).toBeTruthy();
    expect(result.assignments[0].reason).toBeTruthy();
  });

  it('parses smart dump free-form text with AI or fallback', async () => {
    const text = 'Yarın sabah markete git\nBu hafta bütçe raporunu hazırla';
    const context = {
      todayKey: '2026-10-19',
      tomorrowKey: '2026-10-20',
      currentWeekKey: '2026-W43',
      currentMonthKey: '2026-10',
    };

    const result = await parseSmartDumpWithAI(text, context);
    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.tasks[0].title).toBeTruthy();
    expect(['day', 'week', 'month', 'backlog']).toContain(result.tasks[0].horizon);
  });

  it('generates milestone tasks with AI or fallback', async () => {
    const result = await generateMilestoneTasksWithAI('Q4 Yeni Ürün Lansmanı');
    expect(result.tasks.length).toBeGreaterThanOrEqual(3);
    expect(result.tasks[0].title).toContain('Lansman');
    expect(['week', 'month']).toContain(result.tasks[0].horizon);
  });

  it('correctly parses simulated gemma4:12b response containing <think> tags', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/tags')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [{ name: 'gemma4:12b' }, { name: 'llama3:latest' }],
            }),
          });
        }
        if (url.includes('/api/chat')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              message: {
                content:
                  '<think>Model internal thoughts and reasoning</think>```json\n{\n  "subtasks": ["Adım 1", "Adım 2", "Adım 3"],\n  "estimatedMinutes": 60,\n  "priority": "urgent"\n}\n```',
              },
            }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      }) as unknown as typeof fetch;

      const status = await checkOllamaStatus();
      expect(status.online).toBe(true);
      expect(status.model).toBe('gemma4:12b');

      const subtasksRes = await generateSubtasksWithAI('Mock Görev');
      expect(subtasksRes.subtasks).toEqual(['Adım 1', 'Adım 2', 'Adım 3']);
      expect(subtasksRes.estimatedMinutes).toBe(60);
      expect(subtasksRes.priority).toBe('urgent');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('correctly parses health keywords, times, and custom recurring days', () => {
    // 1. Health word: daily after breakfast
    const med = parseQuickTaskInput('günlük kahvaltı sonrası ilaç al');
    expect(med.recurrence).toBe('daily');
    expect(med.scheduledTime).toBe('12:00');
    expect(med.tags).toContain('sağlık');

    // 2. Mon & Thu after breakfast
    const dVit = parseQuickTaskInput('pazartesi ve perşembe günleri kahvaltıdan sonra yürüyüş yap');
    expect(dVit.recurrence).toBe('custom_days');
    expect(dVit.recurrenceDays).toEqual([1, 4]);
    expect(dVit.scheduledTime).toBe('12:00');

    // 3. Every evening
    const mag = parseQuickTaskInput('her akşam kitap oku');
    expect(mag.recurrence).toBe('daily');
    expect(mag.scheduledTime).toBe('22:00');
  });

  it('filters custom_days tasks appropriately in getTasksForDate', () => {
    const walkTask: Task = {
      id: 'walk',
      title: '12:00 | Yürüyüş',
      notes: '',
      horizon: 'day',
      status: 'todo',
      priority: 'high',
      tags: ['sağlık'],
      scheduledDate: '2026-10-19', // Monday
      scheduledTime: '12:00',
      weekKey: '2026-W43',
      monthKey: '2026-10',
      milestoneId: null,
      isMIT: false,
      estimatedMinutes: 5,
      pomodoroCount: 0,
      recurrence: 'custom_days',
      recurrenceDays: [1, 4], // Monday (1) & Thursday (4)
      subtasks: [],
      createdAt: '2026-10-19T10:00:00Z',
      completedAt: null,
    };

    // 2026-10-19 is Monday (ISO day 1) -> must match
    const mondayTasks = getTasksForDate([walkTask], '2026-10-19');
    expect(mondayTasks).toHaveLength(1);

    // 2026-10-20 is Tuesday (ISO day 2) -> must NOT match
    const tuesdayTasks = getTasksForDate([walkTask], '2026-10-20');
    expect(tuesdayTasks).toHaveLength(0);

    // 2026-10-22 is Thursday (ISO day 4) -> must match
    const thursdayTasks = getTasksForDate([walkTask], '2026-10-22');
    expect(thursdayTasks).toHaveLength(1);
  });
});


