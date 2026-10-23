// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTodoStore } from '../../store/useTodoStore';
import { CommandPalette } from '../command/CommandPalette';
import { TaskDetailDrawer } from '../command/TaskDetailDrawer';
import { RolloverBanner } from '../command/RolloverBanner';
import { QuickAddBar } from '../command/QuickAddBar';
import { FocusView } from '../focus/FocusView';
import { DayView } from '../views/DayView';
import App from '../../App';

const store = () => useTodoStore.getState();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline (test)')));
  useTodoStore.setState({
    tasks: [],
    milestones: [],
    focusLogs: [],
    activeView: 'day',
    selectedDateKey: '2026-10-19',
    selectedWeekKey: '2026-W43',
    selectedMonthKey: '2026-10',
    commandPaletteOpen: false,
    backupModalOpen: false,
    createDrawerOpen: false,
    smartDumpOpen: false,
    editingTaskId: null,
    editingDateKey: null,
    activeFocusTaskId: null,
    lastDeletedTask: null,
    lastDeletedSeries: [],
    lastBackupAt: new Date().toISOString(), // hide the backup reminder banner
    timerMode: 'work',
    timerDurationMinutes: 25,
    timerSecondsLeft: 25 * 60,
    timerIsRunning: false,
    timerEndsAt: null,
  });
});

describe('Komut paleti', () => {
  it('Enter eşleşen görünümü açar, görev oluşturmaz', async () => {
    act(() => store().setCommandPaletteOpen(true));
    render(<CommandPalette />);
    const input = await screen.findByPlaceholderText(/komut veya görev arayın/i);
    await userEvent.type(input, 'haftam{Enter}');
    expect(store().activeView).toBe('week');
    expect(store().tasks).toHaveLength(0);
  });

  it('"+" ile başlayan metin Enter ile görev oluşturur', async () => {
    act(() => store().setCommandPaletteOpen(true));
    render(<CommandPalette />);
    const input = await screen.findByPlaceholderText(/komut veya görev arayın/i);
    await userEvent.type(input, '+Süt al{Enter}');
    expect(store().tasks.map((t) => t.title)).toEqual(['Süt al']);
  });
});

describe('Görev detay paneli', () => {
  it('Esc ile kapatınca yazılan başlık kaydedilir', async () => {
    const t = store().addTask({ title: 'Eski başlık', scheduledDate: '2026-10-19' });
    act(() => store().setEditingTaskId(t.id));
    render(<TaskDetailDrawer />);
    const input = await screen.findByPlaceholderText('Görev Başlığı');
    await userEvent.clear(input);
    await userEvent.type(input, 'Yeni başlık');
    await userEvent.keyboard('{Escape}');
    expect(store().editingTaskId).toBeNull();
    expect(store().tasks[0].title).toBe('Yeni başlık');
  });

  it('yansıtılan rutin gününde durum değişikliği yalnızca o güne yazılır', async () => {
    const t = store().addTask({ title: 'Esneme', scheduledDate: '2026-10-19', recurrence: 'daily' });
    act(() => store().setEditingTaskId(t.id, '2026-10-22'));
    render(<TaskDetailDrawer />);
    const select = (await screen.findByDisplayValue('Yapılacak')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'done' } });

    const thu = store().tasks.find((x) => x.scheduledDate === '2026-10-22');
    expect(thu?.status).toBe('done');
    expect(store().tasks.find((x) => x.id === t.id)?.status).toBe('todo');
  });
});

describe('Gecikmiş görev bandı', () => {
  it('"Temizle" önce onay ister', async () => {
    store().addTask({ title: 'Eski iş', scheduledDate: '2026-01-01' });
    render(<RolloverBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Temizle' }));
    expect(store().tasks).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Evet, Sil' }));
    expect(store().tasks).toHaveLength(0);
  });
});

describe('Odak ekranı', () => {
  it('mod etiketleri süreyi bir kez yazar', () => {
    render(<FocusView />);
    expect(screen.getByRole('button', { name: 'Odak 25dk' })).toBeTruthy();
    expect(screen.queryByText(/25dk 25dk/)).toBeNull();
  });

  it('"Serbest Odak" seçimi korunur', () => {
    store().addTask({ title: 'Bir görev', scheduledDate: '2026-10-19' });
    render(<FocusView />);
    const select = screen.getByDisplayValue('Bir görev') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByText('Serbest Odak Modundasınız')).toBeTruthy();
    expect(store().activeFocusTaskId).toBeNull();
  });
});

describe('Gün görünümü', () => {
  it('seçili günlere tekrar eden görevde günleri gösterir', () => {
    store().addTask({ title: 'Yürüyüş', scheduledDate: '2026-10-19', recurrence: 'custom_days', recurrenceDays: [1, 4] });
    render(<DayView />);
    expect(screen.getByText('Pzt, Per')).toBeTruthy();
    expect(screen.queryByText('Her Ay')).toBeNull();
  });
});

describe('Hızlı ekleme çubuğu', () => {
  it('hafta görünümünde görüntülenen haftanın havuzuna ekler', async () => {
    act(() => useTodoStore.setState({ activeView: 'week', selectedWeekKey: '2026-W45' }));
    render(<QuickAddBar defaultHorizon="week" />);
    await userEvent.type(screen.getByLabelText('Yeni Görev'), 'Plan yap{Enter}');
    const t = store().tasks[0];
    expect(t.horizon).toBe('week');
    expect(t.weekKey).toBe('2026-W45');
  });

  it('gün görünümünde bakılan güne ekler', async () => {
    act(() => useTodoStore.setState({ activeView: 'day', selectedDateKey: '2030-01-15' }));
    render(<QuickAddBar defaultHorizon="day" />);
    await userEvent.type(screen.getByLabelText('Yeni Görev'), 'Toplantı{Enter}');
    expect(store().tasks[0].scheduledDate).toBe('2030-01-15');
  });

  it('@tarih belirteci hedef butonundan önce gelir', async () => {
    render(<QuickAddBar defaultHorizon="day" />);
    await userEvent.type(screen.getByLabelText('Yeni Görev'), 'Lansman @2030-02-01{Enter}');
    expect(store().tasks[0].scheduledDate).toBe('2030-02-01');
    expect(store().tasks[0].title).toBe('Lansman');
  });
});

describe('Kısayollar', () => {
  it('açık bir pencere varken görünüm değiştirmez', () => {
    render(<App />);
    act(() => store().setCommandPaletteOpen(true));
    fireEvent.keyDown(document.body, { key: '2' });
    expect(store().activeView).toBe('day');

    act(() => store().setCommandPaletteOpen(false));
    fireEvent.keyDown(document.body, { key: '2' });
    expect(store().activeView).toBe('week');
  });

  it('Odak ekranında N yeni görev formunu açar', () => {
    act(() => store().setActiveView('focus'));
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(store().activeView).toBe('day');
    expect(store().createDrawerOpen).toBe(true);
  });
});
