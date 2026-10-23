import { lazy, Suspense, useEffect, useState } from 'react';
import { useTodoStore } from './store/useTodoStore';
import { ViewMode } from './types/todo';
import { getTodayKey, formatTurkishDate, splitTaskTimeAndTitle } from './lib/dateUtils';
import { getDueReminders } from './lib/reminders';
import { AutoBackupController } from './components/command/AutoBackupController';
import { checkOllamaStatus } from './lib/ollamaClient';
import { QuickAddBar } from './components/command/QuickAddBar';
import { CommandPalette } from './components/command/CommandPalette';
import { RolloverBanner } from './components/command/RolloverBanner';
import { BackupModal } from './components/command/BackupModal';
import { TagManagerModal } from './components/command/TagManagerModal';
import { AiSettingsModal } from './components/command/AiSettingsModal';
import { TaskDetailDrawer } from './components/command/TaskDetailDrawer';
import { DayView } from './components/views/DayView';
// Views other than the day view load on first use to keep the initial bundle small
const WeekView = lazy(() => import('./components/views/WeekView').then((m) => ({ default: m.WeekView })));
const MonthView = lazy(() => import('./components/views/MonthView').then((m) => ({ default: m.MonthView })));
const KanbanView = lazy(() => import('./components/views/KanbanView').then((m) => ({ default: m.KanbanView })));
const FocusView = lazy(() => import('./components/focus/FocusView').then((m) => ({ default: m.FocusView })));
const AnalyticsView = lazy(() =>
  import('./components/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);
import { cn } from './components/ui/primitives';
import { t, setLang } from './lib/i18n';
import { Sun, Moon, Bell, BellOff } from 'lucide-react';

interface NavTab {
  id: ViewMode;
  keyNumber: string;
  label: string;
}

const getNavTabs = (): NavTab[] => [
  { id: 'day', keyNumber: '1', label: t('Day', 'Günüm') },
  { id: 'week', keyNumber: '2', label: t('Week', 'Haftam') },
  { id: 'month', keyNumber: '3', label: t('Month', 'Ayım') },
  { id: 'kanban', keyNumber: '4', label: 'Kanban' },
  { id: 'focus', keyNumber: '5', label: t('Focus', 'Odak') },
  { id: 'analytics', keyNumber: '6', label: t('Analytics', 'Analitik') },
];

function playCompletionChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    // Two-strike warm Zen Bell harmonic chime (528Hz + 792Hz)
    const playBellStrike = (startTime: number, baseFreq: number) => {
      [baseFreq, baseFreq * 1.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        const initialGain = idx === 0 ? 0.22 : 0.08;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(initialGain, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, startTime + 1.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 1.45);
      });
    };

    playBellStrike(ctx.currentTime, 528);
    playBellStrike(ctx.currentTime + 0.35, 660);
  } catch {
    // Autoplay policy or unsupported environment fallback
  }
}

function formatTimer(secondsLeft: number): string {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Drives the pomodoro countdown and the tab title. Kept as its own leaf component so
 * the once-per-second updates do not re-render the whole app.
 */
function PomodoroTicker({ onNotify }: { onNotify: (message: string) => void }) {
  const timerIsRunning = useTodoStore((s) => s.timerIsRunning);
  const timerSecondsLeft = useTodoStore((s) => s.timerSecondsLeft);
  const tickTimer = useTodoStore((s) => s.tickTimer);

  useEffect(() => {
    if (!timerIsRunning) return;
    const interval = setInterval(() => {
      const { completedWorkSession, completedBreak } = tickTimer();
      if (completedWorkSession) {
        playCompletionChime();
        onNotify(t('🔔 Focus session complete! (+1 Pomodoro logged)', '🔔 Odak seansı tamamlandı! (+1 Pomodoro kaydedildi)'));
      } else if (completedBreak) {
        playCompletionChime();
        onNotify(t('🔔 Break is over! Ready for a new focus session.', '🔔 Mola süresi bitti! Yeni odak seansına hazırsınız.'));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timerIsRunning, tickTimer, onNotify]);

  useEffect(() => {
    document.title = timerIsRunning ? `⏳ ${formatTimer(timerSecondsLeft)} — OpenTodo` : 'OpenTodo';
  }, [timerIsRunning, timerSecondsLeft]);

  return null;
}

/**
 * Checks every 30 s for timed tasks (e.g. "12:00 | Stand-up") whose time has come and notifies once.
 * Uses a browser notification when allowed, plus an in-app toast. Works while the tab is open.
 */
function ReminderScheduler({ onNotify }: { onNotify: (message: string) => void }) {
  const enabled = useTodoStore((s) => s.remindersEnabled);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const state = useTodoStore.getState();
      const due = getDueReminders(state.tasks, new Date(), state.notifiedReminderKeys);
      if (due.length === 0) return;
      state.markRemindersNotified(due.map((d) => d.key));

      const canNotify = 'Notification' in window && Notification.permission === 'granted';
      for (const d of due) {
        if (!canNotify) break;
        try {
          const n = new Notification(`⏰ ${d.timeLabel} · ${splitTaskTimeAndTitle(d.task.title).cleanTitle}`, {
            body: t('OpenTodo reminder', 'OpenTodo hatırlatması'),
            tag: d.key,
          });
          // Clicking brings the app forward (desktop app: also out of the tray)
          n.onclick = () => {
            window.todoPlusDesktop?.showWindow();
            window.focus();
          };
        } catch {
          // Some browsers only allow notifications from a service worker
        }
      }
      playCompletionChime();
      onNotify(
        due.length === 1
          ? `⏰ ${due[0].timeLabel} · ${splitTaskTimeAndTitle(due[0].task.title).cleanTitle}`
          : t(`⏰ ${due.length} tasks are due`, `⏰ ${due.length} görevin saati geldi`)
      );
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [enabled, onNotify]);

  return null;
}

/** Top navigation tabs; the focus tab shows the live timer. */
function MainNav() {
  const activeView = useTodoStore((s) => s.activeView);
  const setActiveView = useTodoStore((s) => s.setActiveView);
  const timerDurationMinutes = useTodoStore((s) => s.timerDurationMinutes);
  const timerSecondsLeft = useTodoStore((s) => s.timerSecondsLeft);
  const timerIsRunning = useTodoStore((s) => s.timerIsRunning);
  const formattedTimer = formatTimer(timerSecondsLeft);

  return (
    <nav className="flex items-center gap-1 overflow-x-auto py-1">
      {getNavTabs().map((tab) => {
        const isActive = activeView === tab.id;
        const isFocusTab = tab.id === 'focus';
        const hasActiveTimer =
          isFocusTab && (timerIsRunning || timerSecondsLeft < timerDurationMinutes * 60);
        const tabLabel = hasActiveTimer ? `${t('Focus', 'Odak')} · ${formattedTimer}` : tab.label;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={cn(
              'transition-colors whitespace-nowrap select-none cursor-pointer',
              isActive
                ? 'bg-stone-900 text-stone-50 rounded-md px-3 py-1 text-xs font-medium'
                : 'text-stone-500 hover:text-stone-900 px-3 py-1 text-xs font-medium',
              hasActiveTimer && !isActive && 'text-amber-700 font-semibold'
            )}
            title={`${tab.label} [${tab.keyNumber}]`}
          >
            {tabLabel}
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const activeView = useTodoStore((s) => s.activeView);
  const setActiveView = useTodoStore((s) => s.setActiveView);
  const searchQuery = useTodoStore((s) => s.searchQuery);
  const setSearchQuery = useTodoStore((s) => s.setSearchQuery);
  const selectedTagFilter = useTodoStore((s) => s.selectedTagFilter);
  const setSelectedTagFilter = useTodoStore((s) => s.setSelectedTagFilter);
  const selectedPriorityFilter = useTodoStore((s) => s.selectedPriorityFilter);
  const setSelectedPriorityFilter = useTodoStore((s) => s.setSelectedPriorityFilter);
  const setCommandPaletteOpen = useTodoStore((s) => s.setCommandPaletteOpen);
  const setBackupModalOpen = useTodoStore((s) => s.setBackupModalOpen);
  const setTagManagerOpen = useTodoStore((s) => s.setTagManagerOpen);

  // Timer & Dark Mode & Undo store state
  const timerMode = useTodoStore((s) => s.timerMode);
  const setTimerMode = useTodoStore((s) => s.setTimerMode);
  const setTimerRunning = useTodoStore((s) => s.setTimerRunning);
  const lastDeletedTask = useTodoStore((s) => s.lastDeletedTask);
  const lastDeletedSeries = useTodoStore((s) => s.lastDeletedSeries);
  const undoDeleteTask = useTodoStore((s) => s.undoDeleteTask);
  const dismissUndo = useTodoStore((s) => s.dismissUndo);
  const darkMode = useTodoStore((s) => s.darkMode);
  const toggleDarkMode = useTodoStore((s) => s.toggleDarkMode);
  const language = useTodoStore((s) => s.language);
  const setLanguage = useTodoStore((s) => s.setLanguage);
  const remindersEnabled = useTodoStore((s) => s.remindersEnabled);
  const setRemindersEnabled = useTodoStore((s) => s.setRemindersEnabled);
  const setCreateDrawerOpen = useTodoStore((s) => s.setCreateDrawerOpen);
  const setSmartDumpOpen = useTodoStore((s) => s.setSmartDumpOpen);
  const [reminderToast, setReminderToast] = useState<string | null>(null);
  const notificationsBlocked =
    typeof Notification !== 'undefined' && Notification.permission === 'denied';

  const handleToggleReminders = async () => {
    if (remindersEnabled) {
      setRemindersEnabled(false);
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    setRemindersEnabled(true);
  };

  // Ollama live status
  const [ollamaStatus, setOllamaStatus] = useState<{ online: boolean; model: string }>({
    online: false,
    model: 'gemma4:12b',
  });
  const [pomodoroToast, setPomodoroToast] = useState<string | null>(null);

  const todayKey = getTodayKey();
  const hasActiveFilter = Boolean(
    searchQuery || selectedTagFilter || selectedPriorityFilter !== 'all'
  );

  // Several different tasks removed at once (e.g. "Temizle") vs. one task / one routine
  const deletedLabel =
    lastDeletedTask &&
    lastDeletedSeries.length > 1 &&
    lastDeletedSeries.some((t) => t.title !== lastDeletedTask.title)
      ? t(`${lastDeletedSeries.length} tasks deleted`, `${lastDeletedSeries.length} görev silindi`)
      : null;

  // Dark mode class sync on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Check the AI connection on mount and whenever its settings change
  const aiSettings = useTodoStore((s) => s.aiSettings);
  const setAiSettingsOpen = useTodoStore((s) => s.setAiSettingsOpen);
  useEffect(() => {
    checkOllamaStatus().then((status) => {
      setOllamaStatus(status);
    });
  }, [aiSettings]);

  // Auto-dismiss undo snackbar after 6s
  useEffect(() => {
    if (!lastDeletedTask) return;
    const timer = setTimeout(() => {
      dismissUndo();
    }, 6000);
    return () => clearTimeout(timer);
  }, [lastDeletedTask, dismissUndo]);

  // Global Keyboard Listener for 1-6 keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      // Shortcuts must not act behind an open dialog
      if (document.querySelector('[role="dialog"]')) {
        return;
      }

      // N / A live in the quick-add bar, which is hidden on focus & analytics; open it via the day view
      const quickAddHidden = activeView === 'focus' || activeView === 'analytics';
      if (quickAddHidden && (e.key === 'n' || e.key === 'N' || e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setActiveView('day');
        if (e.key === 'n' || e.key === 'N') setCreateDrawerOpen(true);
        else setSmartDumpOpen(true);
        return;
      }

      switch (e.key) {
        case '1':
          e.preventDefault();
          setActiveView('day');
          break;
        case '2':
          e.preventDefault();
          setActiveView('week');
          break;
        case '3':
          e.preventDefault();
          setActiveView('month');
          break;
        case '4':
          e.preventDefault();
          setActiveView('kanban');
          break;
        case '5':
          e.preventDefault();
          setActiveView('focus');
          break;
        case '6':
          e.preventDefault();
          setActiveView('analytics');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, setActiveView, setCreateDrawerOpen, setSmartDumpOpen]);

  return (
    <div className="app-shell min-h-screen bg-[#FAF9F5] text-stone-900 selection:bg-stone-900 selection:text-[#FAF9F5] flex flex-col font-sans">
      {/* Minimal Top Header */}
      <header className="border-b border-stone-200/70 bg-[#FAF9F5]/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          {/* Left: Brand title & Date */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-semibold tracking-tight text-stone-900 text-base">
              OpenTodo
            </span>
            <span className="text-xs text-stone-400 hidden sm:inline">
              {formatTurkishDate(todayKey)}
            </span>
          </div>

          {/* Center: Minimal Navigation Tabs */}
          <MainNav />

          {/* Right: AI Status, Theme Toggle, Search & Backup Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* AI status: click to choose the AI connection */}
            <button
              type="button"
              onClick={() => setAiSettingsOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-stone-200 bg-white shadow-2xs select-none cursor-pointer hover:bg-stone-50"
              title={ollamaStatus.online ? t(`AI connected (${ollamaStatus.model}) — click to change`, `AI bağlı (${ollamaStatus.model}) — değiştirmek için tıklayın`) : t('AI offline — click to connect', 'AI çevrimdışı — bağlamak için tıklayın')}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full inline-block shrink-0',
                  ollamaStatus.online ? 'bg-emerald-500 animate-pulse' : 'bg-stone-300'
                )}
              />
              <span className="text-stone-600 hidden md:inline truncate max-w-[130px]">
                {ollamaStatus.online ? `AI: ${ollamaStatus.model}` : t('AI: Offline', 'AI: Çevrimdışı')}
              </span>
            </button>

            {/* Reminders Toggle */}
            <button
              type="button"
              onClick={handleToggleReminders}
              className={cn(
                'p-1.5 rounded-md border border-stone-200 bg-white hover:bg-stone-50 transition-colors cursor-pointer shadow-2xs',
                remindersEnabled ? 'text-stone-900' : 'text-stone-400 hover:text-stone-900'
              )}
              title={
                remindersEnabled
                  ? notificationsBlocked
                    ? t('Reminders on (browser notifications blocked; in-app alerts only)', 'Hatırlatmalar açık (tarayıcı bildirimi engelli; yalnızca uygulama içi uyarı)')
                    : t('Reminders for timed tasks are on — click to turn off', 'Saatli görev hatırlatmaları açık — kapatmak için tıklayın')
                  : t('Turn on reminders for timed tasks', 'Saatli görevler için hatırlatmaları aç')
              }
              aria-label={remindersEnabled ? t('Turn off reminders', 'Hatırlatmaları kapat') : t('Turn on reminders', 'Hatırlatmaları aç')}
              aria-pressed={remindersEnabled}
            >
              {remindersEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            </button>

            {/* Dark Mode Toggle */}
            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-1.5 rounded-md border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 hover:text-stone-900 transition-colors cursor-pointer shadow-2xs"
              title={darkMode ? t('Switch to light mode', 'Gündüz Moduna Geç') : t('Switch to dark mode', 'Gece Moduna Geç')}
              aria-label={darkMode ? t('Switch to light mode', 'Gündüz Moduna Geç') : t('Switch to dark mode', 'Gece Moduna Geç')}
            >
              {darkMode ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-stone-600" />
              )}
            </button>

            {/* Language Toggle */}
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'tr' : 'en')}
              className="px-1.5 py-1 rounded-md border border-stone-200 bg-white hover:bg-stone-50 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors cursor-pointer shadow-2xs"
              title={t('Türkçeye geç', 'Switch to English')}
              aria-label={t('Language: English', 'Dil: Türkçe')}
            >
              {language === 'en' ? 'EN' : 'TR'}
            </button>

            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="text-xs text-stone-500 hover:text-stone-900 border border-stone-200 rounded-md px-2.5 py-1 bg-white cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <span>{t('Search', 'Ara')}</span>
              <kbd className="font-mono text-xs text-stone-400">⌘K</kbd>
            </button>
            <button
              type="button"
              onClick={() => setTagManagerOpen(true)}
              className="text-xs text-stone-500 hover:text-stone-900 px-2 py-1 cursor-pointer transition-colors"
            >
              {t('Tags', 'Etiketler')}
            </button>
            <button
              type="button"
              onClick={() => setBackupModalOpen(true)}
              className="text-xs text-stone-500 hover:text-stone-900 px-2 py-1 cursor-pointer transition-colors"
            >
              {t('Backup', 'Yedek')}
            </button>
          </div>
        </div>

        {/* Quiet Active Filter Bar (Only visible when a filter is applied) */}
        {hasActiveFilter && (
          <div className="border-t border-stone-200/60 bg-stone-100/60 text-xs text-stone-600">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-stone-400 text-xs">
                  {t('Active filter:', 'Aktif Filtre:')}
                </span>
                {searchQuery && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800">
                    "{searchQuery}"
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-stone-400 hover:text-stone-800 ml-1 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
                {selectedTagFilter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800">
                    #{selectedTagFilter}
                    <button
                      type="button"
                      onClick={() => setSelectedTagFilter(null)}
                      className="text-stone-400 hover:text-stone-800 ml-1 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
                {selectedPriorityFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800">
                    {t('Priority', 'Öncelik')}: {selectedPriorityFilter}
                    <button
                      type="button"
                      onClick={() => setSelectedPriorityFilter('all')}
                      className="text-stone-400 hover:text-stone-800 ml-1 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedTagFilter(null);
                  setSelectedPriorityFilter('all');
                }}
                className="text-xs text-stone-500 hover:text-stone-900 underline shrink-0 cursor-pointer"
              >
                {t('Clear', 'Temizle')}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Single-Column Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 flex-1 w-full">
        <div
          className={cn(
            activeView === 'day' || activeView === 'focus'
              ? 'max-w-3xl mx-auto w-full space-y-6'
              : 'space-y-6'
          )}
        >
          <AutoBackupController />

          {/* Hide QuickAddBar and RolloverBanner on focus and analytics for distraction-free immersion */}
          {activeView !== 'focus' && activeView !== 'analytics' && (
            <>
              <RolloverBanner />
              <QuickAddBar
                defaultHorizon={
                  activeView === 'week'
                    ? 'week'
                    : activeView === 'month'
                    ? 'month'
                    : 'day'
                }
              />
            </>
          )}

          {/* Active View */}
          <section className="transition-opacity duration-150">
            <Suspense
              fallback={<div className="py-16 text-center text-xs text-stone-400">{t('Loading…', 'Yükleniyor…')}</div>}
            >
              {activeView === 'day' && <DayView />}
              {activeView === 'week' && <WeekView />}
              {activeView === 'month' && <MonthView />}
              {activeView === 'kanban' && <KanbanView />}
              {activeView === 'focus' && <FocusView />}
              {activeView === 'analytics' && <AnalyticsView />}
            </Suspense>
          </section>
        </div>
      </main>

      {/* Floating Pomodoro Completion Toast */}
      {pomodoroToast && (
        <div
          role="status"
          className="fixed bottom-5 left-5 z-50 bg-stone-900 text-stone-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <span>{pomodoroToast}</span>
          {timerMode === 'work' && (
            <button
              type="button"
              onClick={() => {
                setTimerMode('short_break', 5);
                setTimerRunning(true);
                setPomodoroToast(null);
              }}
              className="px-2.5 py-1 rounded bg-stone-800 hover:bg-stone-700 text-amber-300 font-semibold cursor-pointer transition-colors shrink-0"
            >
              {t('Start 5 min break', '5dk Mola Başlat')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPomodoroToast(null)}
            className="text-stone-400 hover:text-stone-200 cursor-pointer ml-1 text-sm font-bold leading-none shrink-0"
            aria-label={t('Close', 'Kapat')}
          >
            ×
          </button>
        </div>
      )}

      {/* Floating Undo Snackbar */}
      {lastDeletedTask && (
        <div
          role="status"
          className="undo-toast fixed bottom-5 right-5 z-50 bg-stone-900 text-stone-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <span className="truncate max-w-[220px] sm:max-w-xs">
            {deletedLabel ?? (
              <>
                {t('Task deleted:', 'Görev silindi:')} <strong className="font-medium text-white">{lastDeletedTask.title}</strong>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={undoDeleteTask}
            className="undo-btn px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-amber-300 hover:text-amber-200 font-semibold cursor-pointer transition-colors text-xs shrink-0 underline underline-offset-2"
          >
            {t('Undo', 'Geri Al')}
          </button>
          <button
            type="button"
            onClick={dismissUndo}
            className="text-stone-400 hover:text-stone-200 cursor-pointer ml-1 text-sm font-bold leading-none shrink-0"
            aria-label={t('Close', 'Kapat')}
          >
            ×
          </button>
        </div>
      )}

      <PomodoroTicker onNotify={setPomodoroToast} />
      <ReminderScheduler onNotify={setReminderToast} />

      {/* Reminder Toast */}
      {reminderToast && (
        <div
          role="status"
          className="fixed top-16 right-5 z-50 bg-stone-900 text-stone-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-xs animate-in"
        >
          <span>{reminderToast}</span>
          <button
            type="button"
            onClick={() => setReminderToast(null)}
            className="text-stone-400 hover:text-stone-200 cursor-pointer ml-1 text-sm font-bold leading-none shrink-0"
            aria-label={t('Close', 'Kapat')}
          >
            ×
          </button>
        </div>
      )}

      {/* Global Modals & Drawers */}
      <CommandPalette />
      <BackupModal />
      <TagManagerModal />
      <AiSettingsModal />
      <TaskDetailDrawer />
    </div>
  );
}

/** Remounts the whole app when the language changes so every t() call picks it up */
export function Root() {
  const language = useTodoStore((s) => s.language);
  setLang(language);
  return <App key={language} />;
}
