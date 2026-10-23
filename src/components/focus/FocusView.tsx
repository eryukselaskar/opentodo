import * as React from 'react';
import { useTodoStore } from '../../store/useTodoStore';
import { TaskMeta } from '../ui/tags';
import { getTodayKey, splitTaskTimeAndTitle } from '../../lib/dateUtils';
import {
  cn,
  Button,
  Checkbox,
  ProgressBar,
} from '../ui/primitives';
import {
  Play,
  Pause,
  RotateCcw,
  Check,
  Coffee,
  Clock,
  Plus,
  CheckCircle2,
  ChevronDown,
  Trophy,
  Target,
  History,
  X,
} from 'lucide-react';
import { t as tt, getLocale, pct } from '../../lib/i18n';

type TimerMode = 'work' | 'short_break' | 'long_break';

const MODE_CONFIG: Record<
  TimerMode,
  { label: string; defaultMinutes: number; subtitle: string }
> = {
  work: {
    get label() {
      return tt('Focus', 'Odak');
    },
    defaultMinutes: 25,
    get subtitle() {
      return tt('Deep concentration and flow', 'Derin konsantrasyon ve akış durumu');
    },
  },
  short_break: {
    get label() {
      return tt('Short break', 'Kısa Mola');
    },
    defaultMinutes: 5,
    get subtitle() {
      return tt('A moment to refresh and breathe', 'Zihinsel tazelenme ve nefes alma');
    },
  },
  long_break: {
    get label() {
      return tt('Long break', 'Uzun Mola');
    },
    defaultMinutes: 15,
    get subtitle() {
      return tt('A longer rest to recharge', 'Büyük dinlenme ve enerji yenileme');
    },
  },
};

const WORK_DURATION_OPTIONS = [15, 25, 45, 60];

function playCompletionChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  } catch {
    // Autoplay policy or unsupported environment fallback
  }
}

export function FocusView() {
  const {
    tasks,
    focusLogs,
    activeFocusTaskId,
    setActiveFocusTaskId,
    toggleTaskDone,
    addSubtask,
    toggleSubtask,
    timerMode,
    timerDurationMinutes,
    timerSecondsLeft,
    timerIsRunning,
    setTimerMode,
    setTimerRunning,
    resetTimer,
  } = useTodoStore();

  const [celebration, setCelebration] = React.useState<boolean>(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = React.useState<string>('');
  // True once the user explicitly picks "Serbest Odak"; stops the auto task pick
  const [freeFocus, setFreeFocus] = React.useState<boolean>(false);
  const [loggedMinutes, setLoggedMinutes] = React.useState<number>(0);
  const completeSessionEarly = useTodoStore((s) => s.completeSessionEarly);

  // Determine active task or default to first MIT / first incomplete task
  const activeTask = React.useMemo(() => {
    if (activeFocusTaskId) {
      const found = tasks.find((t) => t.id === activeFocusTaskId);
      if (found) return found;
    }
    if (freeFocus) return null;
    const mitTask = tasks.find((t) => t.isMIT && t.status !== 'done');
    if (mitTask) return mitTask;

    const anyIncomplete = tasks.find((t) => t.status !== 'done');
    return anyIncomplete || null;
  }, [activeFocusTaskId, tasks, freeFocus]);

  // Keep store's activeFocusTaskId in sync if empty (unless free focus was chosen)
  React.useEffect(() => {
    if (!activeFocusTaskId && activeTask && !freeFocus) {
      setActiveFocusTaskId(activeTask.id);
    }
  }, [activeFocusTaskId, activeTask, freeFocus, setActiveFocusTaskId]);

  // Total seconds for current mode
  const totalSeconds = timerDurationMinutes * 60;

  // Handle mode changes
  const switchMode = (newMode: TimerMode) => {
    setCelebration(false);
    setTimerMode(newMode);
  };

  // Handle custom work duration change
  const handleDurationSelect = (mins: number) => {
    setCelebration(false);
    setTimerMode('work', mins);
  };

  // Reset timer
  const handleReset = () => {
    setCelebration(false);
    resetTimer();
  };

  // Toggle Start / Pause
  const handleTogglePlay = () => {
    setCelebration(false);
    setTimerRunning(!timerIsRunning);
  };

  // Finish the work session now and log only the time actually spent
  const handleCompleteSession = () => {
    const minutes = completeSessionEarly();
    if (minutes > 0) {
      setLoggedMinutes(minutes);
      playCompletionChime();
      setCelebration(true);
    }
  };

  // Subtask submission
  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || !activeTask) return;
    addSubtask(activeTask.id, newSubtaskTitle.trim());
    setNewSubtaskTitle('');
  };

  // Format time as MM:SS
  const minutes = Math.floor(timerSecondsLeft / 60);
  const seconds = timerSecondsLeft % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Progress percentage
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - timerSecondsLeft) / totalSeconds) * 100 : 0;

  // Today's focus logs
  const todayKey = getTodayKey();
  const todayLogs = React.useMemo(() => {
    return focusLogs.filter((log) => log.dateKey === todayKey);
  }, [focusLogs, todayKey]);

  const totalMinutesToday = React.useMemo(() => {
    return todayLogs.reduce((acc, log) => acc + log.durationMinutes, 0);
  }, [todayLogs]);

  // List of candidate incomplete tasks for selector
  const availableTasks = React.useMemo(() => {
    return tasks.filter((t) => t.status !== 'done');
  }, [tasks]);

  return (
    <div className="max-w-xl mx-auto py-8 text-center space-y-6">
      {/* Mode Switcher Pills */}
      <div className="inline-flex items-center gap-1 p-1 bg-stone-200/60 rounded-xl">
        {(Object.keys(MODE_CONFIG) as TimerMode[]).map((m) => {
          const isActive = timerMode === m;
          const mins = m === 'work' ? timerDurationMinutes : MODE_CONFIG[m].defaultMinutes;
          return (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-medium transition-all select-none cursor-pointer',
                isActive
                  ? 'bg-white text-stone-900 font-semibold shadow-2xs'
                  : 'text-stone-500 hover:text-stone-800'
              )}
            >
              {MODE_CONFIG[m].label} {mins}{tt('m', 'dk')}
            </button>
          );
        })}
      </div>

      {/* Subtitle */}
      <p className="text-xs text-stone-400 -mt-2">
        {MODE_CONFIG[timerMode].subtitle}
      </p>

      {/* Custom duration options for work mode */}
      {timerMode === 'work' && (
        <div className="flex items-center justify-center gap-1 text-xs text-stone-400 pt-1">
          <span className="text-xs text-stone-400 mr-1 flex items-center gap-1">
            <Clock className="w-3 h-3 text-stone-400" /> {tt('Length:', 'Süre:')}
          </span>
          {WORK_DURATION_OPTIONS.map((mins) => (
            <button
              key={mins}
              type="button"
              onClick={() => handleDurationSelect(mins)}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs transition-colors cursor-pointer',
                timerDurationMinutes === mins
                  ? 'bg-stone-900 text-stone-50 font-medium'
                  : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60'
              )}
            >
              {mins}{tt('m', 'dk')}
            </button>
          ))}
        </div>
      )}

      {/* Giant Crisp Ink Countdown */}
      <div className="my-8 select-none">
        <span className="font-mono text-7xl sm:text-8xl font-light tracking-tight text-stone-900 tabular-nums">
          {timeFormatted}
        </span>
      </div>

      {/* Subtle Hairline Progress Bar */}
      <div className="w-full max-w-xs mx-auto mb-6">
        <ProgressBar
          value={progressPercent}
          max={100}
          className="h-1 bg-stone-200/80 rounded-full"
          indicatorClassName="bg-stone-900"
        />
        <div className="flex justify-between items-center text-xs text-stone-400 mt-1.5 px-0.5">
          <span>{timerIsRunning ? tt('Focusing...', 'Odak devrede...') : tt('Paused', 'Duraklatıldı')}</span>
          <span>{pct(Math.round(progressPercent))}</span>
        </div>
      </div>

      {/* Primary & Secondary Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleTogglePlay}
          className="bg-stone-900 text-stone-50 hover:bg-stone-800 px-8 py-3 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2 shadow-2xs active:scale-[0.99] cursor-pointer"
        >
          {timerIsRunning ? (
            <>
              <Pause className="w-4 h-4 fill-current" />
              <span>{tt('Pause', 'Duraklat')}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>{tt('Start', 'Başlat')}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleReset}
          className="px-4 py-3 rounded-lg border border-stone-200/80 bg-white hover:bg-stone-50 text-stone-600 hover:text-stone-900 text-xs transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
          title={tt('Reset timer', 'Sayacı sıfırla')}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{tt('Reset', 'Sıfırla')}</span>
        </button>

        <button
          type="button"
          onClick={handleCompleteSession}
          disabled={timerMode !== 'work' || totalSeconds - timerSecondsLeft < 60}
          className="px-4 py-3 rounded-lg border border-stone-200/80 bg-white hover:bg-stone-50 text-stone-600 hover:text-stone-900 text-xs transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title={tt('End the session now; elapsed time is logged (at least 1 min)', 'Seansı şimdi bitir; geçen süre kaydedilir (en az 1 dk)')}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-stone-700" />
          <span>{tt('Finish and log', 'Bitir ve Kaydet')}</span>
        </button>
      </div>

      {/* Celebratory Banner */}
      {celebration && (
        <div className="rounded-lg bg-stone-100 border border-stone-200 p-4 text-left shadow-2xs flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center shrink-0">
              <Trophy className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-medium text-stone-900">
                {tt(`Session complete! ${loggedMinutes} min of focus logged`, `Seans tamamlandı! ${loggedMinutes} dk odak kaydedildi`)}
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                {tt('Take a short break or start a new session.', 'Kısa bir mola verebilir veya yeni bir seansa başlayabilirsiniz.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => switchMode('short_break')}
              className="text-xs px-2.5 py-1 rounded bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors inline-flex items-center gap-1"
            >
              <Coffee className="w-3 h-3" />
              {tt('Break (5m)', 'Mola (5dk)')}
            </button>
            <button
              type="button"
              onClick={() => setCelebration(false)}
              className="p-1 rounded text-stone-400 hover:text-stone-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Active Task Card Below Timer */}
      <div className="bg-white border border-stone-200/80 rounded-lg p-5 text-left shadow-2xs space-y-4">
        {/* Header with Task Selector Dropdown */}
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-3">
          <div className="flex items-center gap-1.5">
            <Target className="w-4 h-4 text-stone-700" />
            <span className="text-xs font-medium tracking-wide text-stone-700">
              {tt('Focus task', 'Odaklanılan Görev')}
            </span>
          </div>

          <div className="relative">
            <select
              value={activeTask?.id || ''}
              onChange={(e) => {
                setFreeFocus(!e.target.value);
                setActiveFocusTaskId(e.target.value || null);
              }}
              className="bg-stone-50 border border-stone-200 hover:border-stone-300 text-stone-800 text-xs rounded-md px-2.5 py-1 font-sans focus:outline-none focus:ring-1 focus:ring-stone-400 appearance-none pr-7 cursor-pointer max-w-[210px] truncate"
            >
              <option value="">{tt('-- Free focus (no task) --', '-- Serbest Odak (Görevsiz) --')}</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.isMIT ? '★ ' : ''}
                  {t.title}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-stone-400 absolute right-2 top-2.5 pointer-events-none" />
          </div>
        </div>

        {activeTask ? (
          <div className="space-y-4">
            {/* Task title + one meta line */}
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-stone-900 leading-snug">
                {splitTaskTimeAndTitle(activeTask.title).cleanTitle}
              </h2>
              <TaskMeta
                task={activeTask}
                timeBadge={splitTaskTimeAndTitle(activeTask.title).timeBadge}
                extra={activeTask.pomodoroCount > 0 && `${activeTask.pomodoroCount} pomodoro`}
              />
              {activeTask.notes && (
                <p className="text-sm text-stone-500 leading-relaxed pt-1">{activeTask.notes}</p>
              )}
            </div>

            {/* Complete Task Button */}
            <button
              type="button"
              onClick={() => toggleTaskDone(activeTask.id, todayKey)}
              className="w-full text-xs justify-center border border-stone-200/90 bg-stone-50 hover:bg-stone-100 text-stone-800 h-8 rounded-md flex items-center gap-1.5 transition-colors font-medium shadow-2xs"
            >
              <Check className="w-3.5 h-3.5 text-stone-700 stroke-[2.5]" />
              {tt('Complete task', 'Görevi Tamamla')}
            </button>

            {/* Subtask Interactive Checklist */}
            <div className="pt-3 border-t border-stone-100">
              <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
                <span className="font-medium text-stone-700">{tt('Subtasks', 'Alt Görevler')}</span>
                <span>
                  {activeTask.subtasks.filter((s) => s.completed).length}/
                  {activeTask.subtasks.length}
                </span>
              </div>

              {/* Subtask list */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {activeTask.subtasks.length === 0 ? (
                  <p className="text-xs text-stone-400 italic py-1">
                    {tt('No subtasks for this task yet.', 'Bu görev için henüz alt görev tanımlanmamış.')}
                  </p>
                ) : (
                  activeTask.subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center gap-2 p-1.5 rounded-md hover:bg-stone-50 transition-colors group"
                    >
                      <Checkbox
                        checked={st.completed}
                        onCheckedChange={() => toggleSubtask(activeTask.id, st.id)}
                        id={`st-${st.id}`}
                      />
                      <label
                        htmlFor={`st-${st.id}`}
                        className={cn(
                          'text-xs flex-1 cursor-pointer select-none leading-tight font-sans transition-colors',
                          st.completed
                            ? 'line-through text-stone-400'
                            : 'text-stone-800 group-hover:text-stone-950'
                        )}
                      >
                        {st.title}
                      </label>
                    </div>
                  ))
                )}
              </div>

              {/* Add Subtask Inline Form */}
              <form onSubmit={handleAddSubtask} className="mt-3 flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder={tt('+ Type a subtask and press Enter...', '+ Alt görev yaz ve Enter tuşuna bas...')}
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-md px-2.5 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 font-sans"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-800 border-stone-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center space-y-1.5">
            <Target className="w-6 h-6 text-stone-300 mx-auto stroke-[1.5]" />
            <p className="text-xs text-stone-700 font-medium">
              {tt('Free focus mode', 'Serbest Odak Modundasınız')}
            </p>
            <p className="text-xs text-stone-400 max-w-xs mx-auto">
              {tt('You are tracking time without a task. You can pick a task above.', 'Herhangi bir göreve bağlanmadan zaman tutuyorsunuz. Dilerseniz yukarıdan görev seçebilirsiniz.')}
            </p>
          </div>
        )}
      </div>

      {/* Today's Focus History Strip */}
      <div className="bg-white border border-stone-200/80 rounded-lg p-5 text-left shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-stone-600" />
            <h3 className="text-xs font-semibold text-stone-700">
              {tt('Today\'s focus log', 'Bugünkü Odaklanma Günlüğü')}
            </h3>
          </div>

          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span>
              {tt('Sessions:', 'Toplam Seans:')} <strong className="text-stone-900">{todayLogs.length}</strong>
            </span>
            <span className="text-stone-300">|</span>
            <span>
              {tt('Total:', 'Toplam Süre:')} <strong className="text-stone-900">{totalMinutesToday} {tt('min', 'dk')}</strong>
            </span>
          </div>
        </div>

        {todayLogs.length === 0 ? (
          <div className="py-4 text-center text-stone-400 text-xs">
            {tt('No focus sessions logged today yet.', 'Bugün henüz kaydedilmiş bir odaklanma seansı bulunmuyor.')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {todayLogs.map((log) => {
              const matchedTask = log.taskId ? tasks.find((t) => t.id === log.taskId) : null;
              const timeString = new Date(log.completedAt).toLocaleTimeString(getLocale(), {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-stone-50 border border-stone-200/60"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="overflow-hidden">
                      <p className="text-xs text-stone-800 font-medium truncate leading-tight">
                        {matchedTask ? matchedTask.title : tt('Free focus', 'Serbest Odak')}
                      </p>
                      <span className="text-xs text-stone-400">
                        {timeString}
                      </span>
                    </div>
                  </div>

                  <span className="text-xs font-semibold text-stone-700 shrink-0">
                    +{log.durationMinutes}m
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
