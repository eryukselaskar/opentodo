import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  CheckCircle2,
  Flame,
  Clock,
  Target,
  CalendarDays,
  Layers,
  AlertTriangle,
  Tag,
  Milestone,
  Repeat,
  ChevronDown,
} from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import { TaskPriority, TaskHorizon } from '../../types/todo';
import {
  getTodayKey,
  shiftDateKey,
  formatTurkishDate,
  getCurrentMonthKey,
  formatMonthLabel,
  getNames,
} from '../../lib/dateUtils';
import {
  getDayActivity,
  calculateStreak,
  computeFocusStats,
  computeCompletionStats,
  getOneOffTasks,
  computeRoutineStats,
  type RoutineStat,
  type RoutineDayStatus,
} from '../../lib/analytics';
import { cn, ProgressBar, TooltipWrapper } from '../ui/primitives';
import { t as tt, pct } from '../../lib/i18n';

const ROUTINE_DAY_STYLE: Record<RoutineDayStatus, { cell: string; label: string }> = {
  done: { cell: 'bg-emerald-500 text-white border-emerald-500', get label() {
      return tt('Done', 'Yapıldı');
    } },
  missed: { cell: 'bg-rose-500/20 text-rose-700 border-rose-500/40 dark:text-rose-300', get label() {
      return tt('Missed', 'Kaçırıldı');
    } },
  pending: { cell: 'bg-transparent text-stone-600 border-dashed border-stone-400', get label() {
      return tt('Today (open)', 'Bugün (açık)');
    } },
  none: { cell: 'bg-stone-100 text-stone-400 border-transparent', get label() {
      return tt('Not planned / skipped', 'Planlı değil / atlandı');
    } },
};

/** Monday-first calendar of a routine's last days: done / missed / not due */
function RoutineCalendar({ calendar }: { calendar: RoutineStat['calendar'] }) {
  if (calendar.length === 0) return null;
  const [y, m, d] = calendar[0].dateKey.split('-').map(Number);
  const leading = (new Date(y, m - 1, d).getDay() + 6) % 7; // empty cells before the first day
  return (
    <div className="pt-2 space-y-2">
      <div className="grid grid-cols-7 gap-1 max-w-xs">
        {[1, 2, 3, 4, 5, 6, 0].map((i) => getNames('dayShort')[i]).map((w) => (
          <span key={w} className="text-xs text-stone-400 text-center">
            {w}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {calendar.map(({ dateKey, status }) => (
          <span
            key={dateKey}
            title={`${dateKey} · ${ROUTINE_DAY_STYLE[status].label}`}
            className={cn(
              'aspect-square rounded border flex items-center justify-center text-xs ',
              ROUTINE_DAY_STYLE[status].cell
            )}
          >
            {Number(dateKey.slice(8))}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
        {(['done', 'missed', 'pending', 'none'] as RoutineDayStatus[]).map((st) => (
          <span key={st} className="flex items-center gap-1">
            <span className={cn('w-2.5 h-2.5 rounded-sm border', ROUTINE_DAY_STYLE[st].cell)} />
            {ROUTINE_DAY_STYLE[st].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Returns monochrome ink classes for the 28-day activity heatmap cells on warm paper.
 */
function getIntensityStyle(count: number) {
  if (count === 0) {
    return {
      container: 'bg-stone-100 border-stone-200/70 text-stone-400 hover:border-stone-300',
      label: tt('No activity', 'Aktivite Yok'),
    };
  }
  if (count <= 2) {
    return {
      container: 'bg-stone-300 border-stone-300 text-stone-800 hover:bg-stone-400/80',
      label: tt('1-2 activities', '1-2 Aktivite'),
    };
  }
  if (count <= 4) {
    return {
      container: 'bg-stone-500 border-stone-500 text-white hover:bg-stone-600',
      label: tt('3-4 activities', '3-4 Aktivite'),
    };
  }
  return {
    container: 'bg-stone-900 border-stone-900 text-white font-bold hover:bg-stone-800 shadow-2xs',
    label: tt('5+ activities', '5+ Aktivite'),
  };
}

const PRIORITY_META: Record<
  TaskPriority,
  { label: string }
> = {
  urgent: { get label() {
      return tt('Urgent / critical', 'Acil / Kritik');
    } },
  high: { get label() {
      return tt('High priority', 'Yüksek Öncelik');
    } },
  medium: { get label() {
      return tt('Medium priority', 'Orta Öncelik');
    } },
  low: { get label() {
      return tt('Low priority', 'Düşük Öncelik');
    } },
};

const HORIZON_META: Record<
  TaskHorizon,
  { label: string; sublabel: string }
> = {
  day: {
    get label() {
      return tt('Day', 'Günüm');
    },
    get sublabel() {
      return tt('Daily focus and execution', 'Günlük odak ve yürütme');
    },
  },
  week: {
    get label() {
      return tt('Week', 'Haftam');
    },
    get sublabel() {
      return tt('Weekly goal pool', 'Haftalık hedef havuzu');
    },
  },
  month: {
    get label() {
      return tt('Month', 'Ayım');
    },
    get sublabel() {
      return tt('Strategic milestones', 'Stratejik kilometre taşları');
    },
  },
  backlog: {
    get label() {
      return tt('Pool', 'Havuz');
    },
    get sublabel() {
      return tt('Future plans and notes', 'Gelecek planlar ve notlar');
    },
  },
};

export function AnalyticsView() {
  const { tasks, milestones, focusLogs, toggleMilestone } = useTodoStore(
    useShallow((s) => ({
      tasks: s.tasks,
      milestones: s.milestones,
      focusLogs: s.focusLogs,
      toggleMilestone: s.toggleMilestone,
    }))
  );
  const todayKey = getTodayKey();
  const currentMonth = getCurrentMonthKey();
  const currentMonthName = formatMonthLabel(currentMonth);

  // 1. Overall Completion Rates & MIT Accuracy (one-off tasks; routines are tracked separately)
  const completionStats = useMemo(() => computeCompletionStats(tasks), [tasks]);
  const oneOffTasks = useMemo(() => getOneOffTasks(tasks), [tasks]);
  const routineStats = useMemo(() => computeRoutineStats(tasks, todayKey, 30), [tasks, todayKey]);
  const [openRoutineKey, setOpenRoutineKey] = useState<string | null>(null);

  // 2. Streak Metrics
  const streakInfo = useMemo(() => {
    return calculateStreak(tasks, focusLogs, todayKey);
  }, [tasks, focusLogs, todayKey]);

  // 3. Focus & Deep Work Metrics
  const focusStats = useMemo(() => computeFocusStats(focusLogs), [focusLogs]);

  // 4. 28-Day Activity Heatmap Data
  const heatmapData = useMemo(() => {
    const dayShortNames = getNames('dayShort');
    const days = [];

    for (let i = 27; i >= 0; i--) {
      const dateKey = shiftDateKey(todayKey, -i);
      const activity = getDayActivity(dateKey, tasks, focusLogs);
      const [y, m, d] = dateKey.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d, 12, 0, 0);
      const dayOfWeekShort = dayShortNames[dateObj.getDay()];

      days.push({
        dateKey,
        dayNumber: d,
        dayOfWeekShort,
        isToday: i === 0,
        ...activity,
      });
    }

    const totalPeriodActivity = days.reduce((acc, d) => acc + d.totalActivity, 0);
    const activeDaysCount = days.filter((d) => d.totalActivity > 0).length;

    return {
      days,
      totalPeriodActivity,
      activeDaysCount,
    };
  }, [tasks, focusLogs, todayKey]);

  // 5. Temporal Horizon Breakdown
  const horizonStats = useMemo(() => {
    const horizons: TaskHorizon[] = ['day', 'week', 'month', 'backlog'];
    return horizons.map((h) => {
      const horizonTasks = oneOffTasks.filter((t) => t.horizon === h);
      const done = horizonTasks.filter((t) => t.status === 'done').length;
      const total = horizonTasks.length;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;
      const active = total - done;
      const mitCount = horizonTasks.filter((t) => t.isMIT).length;
      const estMinutes = horizonTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);

      return {
        horizon: h,
        ...HORIZON_META[h],
        total,
        done,
        active,
        rate,
        mitCount,
        estMinutes,
      };
    });
  }, [oneOffTasks]);

  // 6. Priority Breakdown
  const priorityStats = useMemo(() => {
    const priorities: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
    return priorities.map((p) => {
      const pTasks = oneOffTasks.filter((t) => t.priority === p);
      const done = pTasks.filter((t) => t.status === 'done').length;
      const total = pTasks.length;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        priority: p,
        ...PRIORITY_META[p],
        total,
        done,
        active: total - done,
        rate,
      };
    });
  }, [oneOffTasks]);

  // 7. Tag Analysis
  const tagStats = useMemo(() => {
    const tagMap = new Map<string, { total: number; done: number }>();

    for (const task of oneOffTasks) {
      for (const tag of task.tags) {
        const clean = tag.trim().toLowerCase();
        if (!clean) continue;
        const current = tagMap.get(clean) || { total: 0, done: 0 };
        current.total += 1;
        if (task.status === 'done') {
          current.done += 1;
        }
        tagMap.set(clean, current);
      }
    }

    return Array.from(tagMap.entries())
      .map(([tag, val]) => ({
        tag,
        total: val.total,
        done: val.done,
        rate: Math.round((val.done / val.total) * 100),
      }))
      .sort((a, b) => b.total - a.total);
  }, [oneOffTasks]);

  // 8. Monthly Milestones Progress
  const milestoneStats = useMemo(() => {
    const currentList = milestones.filter((m) => m.monthKey === currentMonth);
    const listToDisplay = currentList.length > 0 ? currentList : milestones;

    const completedCount = listToDisplay.filter((m) => m.completed).length;
    const totalCount = listToDisplay.length;
    const rate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const detailedList = listToDisplay.map((m) => {
      const linkedTasks = tasks.filter((t) => t.milestoneId === m.id);
      const linkedDone = linkedTasks.filter((t) => t.status === 'done').length;
      const linkedRate = linkedTasks.length > 0 ? Math.round((linkedDone / linkedTasks.length) * 100) : 0;

      return {
        ...m,
        linkedTotal: linkedTasks.length,
        linkedDone,
        linkedRate,
      };
    });

    return {
      isCurrentMonthOnly: currentList.length > 0,
      list: detailedList,
      completedCount,
      totalCount,
      rate,
    };
  }, [milestones, tasks, currentMonth]);

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 text-stone-900">
      <header className="border-b border-stone-200/80 pb-5 space-y-1">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">{tt('Analytics', 'Analitik')}</h1>
        <p className="text-sm text-stone-500">
          {formatTurkishDate(todayKey)} · {tt('Completion rates, streaks and focus time', 'Tamamlama oranları, seriler ve odak süreleri')}
        </p>
      </header>

      {/* 1. TOP METRIC CARDS (4 Monospace Cards on Warm Paper) */}
      <section aria-label={tt('Key metrics', 'Temel Performans Göstergeleri')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Tamamlama Oranı */}
          <div className="bg-white border border-stone-200/80 rounded-lg p-4 shadow-2xs flex flex-col justify-between hover:border-stone-300 transition-all">
            <div>
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs text-stone-500">
                  {tt('Completion rate', 'Tamamlama Oranı')}
                </span>
                <CheckCircle2 className="w-4 h-4 text-stone-400" />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-semibold text-stone-900">
                  {pct(completionStats.rate)}
                </span>
                <span className="text-xs text-stone-400">
                  ({completionStats.doneTasks}/{completionStats.totalTasks})
                </span>
              </div>
              <p className="text-xs text-stone-500 font-sans">
                {completionStats.totalTasks === 0
                  ? tt('No tasks recorded yet', 'Henüz kayıtlı görev yok')
                  : tt(`${completionStats.doneTasks} tasks completed (routines excluded)`, `${completionStats.doneTasks} görev tamamlandı (rutinler hariç)`)}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100">
              <ProgressBar
                value={completionStats.rate}
                max={100}
                className="h-1 bg-stone-200"
                indicatorClassName="bg-stone-900"
              />
            </div>
          </div>

          {/* Card 2: Aktif Seri */}
          <div className="bg-white border border-stone-200/80 rounded-lg p-4 shadow-2xs flex flex-col justify-between hover:border-stone-300 transition-all">
            <div>
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs text-stone-500">
                  {tt('Active streak', 'Aktif Seri')}
                </span>
                <Flame className="w-4 h-4 text-stone-400" />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-semibold text-stone-900">
                  {streakInfo.streak}
                </span>
                <span className="text-xs text-stone-400">{tt('days', 'Gün')}</span>
              </div>
              <p className="text-xs text-stone-500 font-sans">
                {streakInfo.isActiveToday ? (
                  <span className="text-stone-800 font-medium">
                    {tt('Streak kept today', 'Bugün seri korundu')}
                  </span>
                ) : streakInfo.streak > 0 ? (
                  tt('Keep the streak going with a task today', 'Bugünkü görevle seriyi sürdür')
                ) : (
                  tt('Complete a task to start a streak', 'Görev tamamlayarak seriyi başlat')
                )}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-400">
              <span>{tt('Unbroken rhythm', 'Kesintisiz Ritim')}</span>
              <span className="text-stone-700 font-medium">{streakInfo.streak > 0 ? tt('Active', 'Aktif') : tt('Waiting', 'Beklemede')}</span>
            </div>
          </div>

          {/* Card 3: Derin Odak Süresi */}
          <div className="bg-white border border-stone-200/80 rounded-lg p-4 shadow-2xs flex flex-col justify-between hover:border-stone-300 transition-all">
            <div>
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs text-stone-500">
                  {tt('Deep focus time', 'Derin Odak Süresi')}
                </span>
                <Clock className="w-4 h-4 text-stone-400" />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-semibold text-stone-900">
                  {focusStats.formattedDuration}
                </span>
              </div>
              <p className="text-xs text-stone-500 font-sans">
                {tt(`${focusStats.totalSessions} Pomodoro & focus sessions in total`, `Toplam ${focusStats.totalSessions} Pomodoro & odak seansı`)}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-400">
              <span>{tt('Sessions', 'Seans Sayısı')}</span>
              <span className="text-stone-800 font-medium">{focusStats.totalSessions} {tt('sessions', 'seans')}</span>
            </div>
          </div>

          {/* Card 4: MIT Başarısı */}
          <div className="bg-white border border-stone-200/80 rounded-lg p-4 shadow-2xs flex flex-col justify-between hover:border-stone-300 transition-all">
            <div>
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs text-stone-500">
                  {tt('MIT success', 'MIT Başarısı')}
                </span>
                <Target className="w-4 h-4 text-stone-400" />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-semibold text-stone-900">
                  {pct(completionStats.mitRate)}
                </span>
                <span className="text-xs text-stone-400">
                  ({completionStats.doneMIT}/{completionStats.totalMIT})
                </span>
              </div>
              <p className="text-xs text-stone-500 font-sans">
                {tt('Hit rate on your 3 most important tasks (MIT)', 'En önemli 3 kritik iş (MIT) isabeti')}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100">
              <ProgressBar
                value={completionStats.mitRate}
                max={100}
                className="h-1 bg-stone-200"
                indicatorClassName="bg-stone-900"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. 28-DAY ACTIVITY HEATMAP (Monochrome ink on paper) */}
      <section
        aria-label={tt('28-day activity heatmap', '28 Günlük Aktivite Isı Haritası')}
        className="bg-white border border-stone-200/80 rounded-lg p-5 sm:p-6 space-y-5 shadow-2xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-stone-700" />
              <h2 className="text-sm font-semibold text-stone-900 tracking-tight">
                {tt('Last 28 days activity heatmap', 'Son 28 Günlük Aktivite Isı Haritası')}
              </h2>
            </div>
            <p className="text-xs text-stone-500 font-sans">
              {tt('Completed tasks and logged focus sessions over the last 4 weeks.', 'Son 4 haftadaki tamamlanan görevler ve kaydedilen derin odak seansları ritmi.')}
            </p>
          </div>

          {/* Activity Monochrome Legend */}
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="text-xs text-stone-400">{tt('Intensity:', 'Yoğunluk:')}</span>
            <div className="flex items-center gap-1.5">
              <TooltipWrapper content={tt('0 activities', '0 Aktivite')}>
                <div className="w-3.5 h-3.5 rounded bg-stone-100 border border-stone-200/70" />
              </TooltipWrapper>
              <TooltipWrapper content={tt('1 - 2 activities', '1 - 2 Aktivite')}>
                <div className="w-3.5 h-3.5 rounded bg-stone-300 border border-stone-300" />
              </TooltipWrapper>
              <TooltipWrapper content={tt('3 - 4 activities', '3 - 4 Aktivite')}>
                <div className="w-3.5 h-3.5 rounded bg-stone-500 border border-stone-500" />
              </TooltipWrapper>
              <TooltipWrapper content={tt('5+ high productivity', '5+ Yüksek Üretkenlik')}>
                <div className="w-3.5 h-3.5 rounded bg-stone-900 border border-stone-900" />
              </TooltipWrapper>
            </div>
            <span className="text-xs text-stone-400">{tt('Low → High', 'Düşük → Yüksek')}</span>
          </div>
        </div>

        {/* 28-Cell Grid */}
        <div className="space-y-3">
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {heatmapData.days.map((cell) => {
              const style = getIntensityStyle(cell.totalActivity);
              const tooltipContent = (
                <div className="text-left space-y-1 text-xs">
                  <div className="font-semibold text-stone-900 border-b border-stone-200 pb-1">
                    {formatTurkishDate(cell.dateKey)}
                    {cell.isToday && ` (${tt('Today', 'Bugün')})`}
                  </div>
                  <div className="text-xs text-stone-600 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span>{tt('Total activity:', 'Toplam Aktivite:')}</span>
                      <span className="font-bold text-stone-900">{cell.totalActivity}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-stone-500">
                      <span>{tt('• Tasks:', '• Görev:')}</span>
                      <span>{cell.completedCount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-stone-500">
                      <span>{tt('• Focus sessions:', '• Odak Seansı:')}</span>
                      <span>{cell.focusCount}</span>
                    </div>
                  </div>
                </div>
              );

              return (
                <TooltipWrapper key={cell.dateKey} content={tooltipContent} delayDuration={100}>
                  <div
                    tabIndex={0}
                    role="button"
                    aria-label={`${formatTurkishDate(cell.dateKey)}: ${cell.totalActivity} ${tt('activities', 'aktivite')}`}
                    className={cn(
                      'relative flex flex-col items-center justify-between p-2 rounded-lg border transition-all duration-150 cursor-pointer select-none',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400',
                      style.container,
                      cell.isToday && 'ring-2 ring-stone-900 ring-offset-1'
                    )}
                  >
                    <div className="w-full flex items-center justify-between text-xs opacity-80">
                      <span>{cell.dayOfWeekShort}</span>
                      {cell.isToday && (
                        <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                      )}
                    </div>
                    <span className="text-sm sm:text-base font-semibold my-0.5">
                      {cell.dayNumber}
                    </span>
                    <span className="text-xs tracking-tight opacity-80">
                      {cell.totalActivity > 0 ? `${cell.totalActivity}` : '—'}
                    </span>
                  </div>
                </TooltipWrapper>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-stone-500 pt-2 border-t border-stone-100">
            <span>
              {tt('Active days in period:', 'Periyot İçi Aktif Günler:')}{' '}
              <strong className="text-stone-900">{heatmapData.activeDaysCount} / 28 {tt('days', 'Gün')}</strong>
            </span>
            <span>
              {tt('Total activity:', 'Toplam İcraat Skoru:')}{' '}
              <strong className="text-stone-900">{heatmapData.totalPeriodActivity} {tt('activities', 'Aktivite')}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* 3. TEMPORAL HORIZON BREAKDOWN (Hairline Rows with bg-stone-900 on bg-stone-200) */}
      <section aria-label={tt('Horizon breakdown', 'Zaman Ufku Dağılımı')} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight text-stone-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-stone-700" />
            {tt('Progress by horizon', 'Zaman Ufku Yürütme Dağılımı')}
          </h2>
          <p className="text-xs text-stone-500 font-sans">
            {tt('Progress of tasks by Day, Week and Month horizon.', 'Görevlerin Gün (mikro), Hafta (taktik) ve Ay (stratejik) ufuklarına göre ilerleme durumu.')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {horizonStats.map((item) => (
            <div
              key={item.horizon}
              className="bg-white border border-stone-200/80 rounded-lg p-4 shadow-2xs hover:border-stone-300 transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200/80">
                    {item.label}
                  </span>
                  <span className="text-xs text-stone-500 font-semibold">{pct(item.rate)}</span>
                </div>

                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xl font-semibold text-stone-900">
                      {item.done} / {item.total}
                    </span>
                    <span className="text-xs text-stone-400 font-sans">{tt('done', 'tamamlandı')}</span>
                  </div>
                  <p className="text-xs text-stone-500 font-sans">{item.sublabel}</p>
                </div>

                <div className="pt-1">
                  <ProgressBar
                    value={item.rate}
                    max={100}
                    className="h-1 bg-stone-200"
                    indicatorClassName="bg-stone-900"
                  />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 grid grid-cols-2 gap-2 text-xs text-stone-500">
                <div>
                  <span className="text-stone-400 block">{tt('Remaining:', 'Kalan:')}</span>
                  <span className="text-stone-800 font-medium">{item.active}</span>
                </div>
                <div>
                  <span className="text-stone-400 block">{tt('Critical (MIT):', 'Kritik (MIT):')}</span>
                  <span className="text-stone-800 font-medium">{item.mitCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3b. ROUTINE ADHERENCE (last 30 days) */}
      <section
        aria-label={tt('Routine tracking', 'Rutin Takibi')}
        className="bg-white border border-stone-200/80 rounded-lg p-5 sm:p-6 space-y-4 shadow-2xs"
      >
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-stone-900 tracking-tight flex items-center gap-2">
              <Repeat className="w-4 h-4 text-stone-700" />
              {tt('Routine tracking (last 30 days)', 'Rutin Takibi (Son 30 Gün)')}
            </h2>
            <p className="text-xs text-stone-500">
              {tt('Completion rate and streak of each routine on its planned days. Skipped days do not count.', 'Her rutinin planlandığı günlerde tamamlanma oranı ve kesintisiz serisi. Atlanan günler sayılmaz.')}
            </p>
          </div>
          <span className="text-xs text-stone-400">{routineStats.length} {tt('routines', 'Rutin')}</span>
        </div>

        {routineStats.length === 0 ? (
          <div className="text-center py-6 text-stone-400 text-xs border border-dashed border-stone-200 rounded-lg">
            {tt('No routines planned in the last 30 days.', 'Son 30 günde planlanmış rutin bulunmuyor.')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5">
            {routineStats.map((r) => (
              <div key={r.seriesKey} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setOpenRoutineKey(openRoutineKey === r.seriesKey ? null : r.seriesKey)}
                  aria-expanded={openRoutineKey === r.seriesKey}
                  title={tt('Show the last 30 days', 'Son 30 günün takvimini göster')}
                  className="w-full flex items-center justify-between gap-3 text-xs cursor-pointer group text-left"
                >
                  <span className="font-medium text-stone-800 truncate font-sans flex items-center gap-1.5 group-hover:text-stone-600 transition-colors">
                    <ChevronDown
                      className={cn(
                        'w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform',
                        openRoutineKey === r.seriesKey && 'rotate-180'
                      )}
                    />
                    {r.title}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {r.streak > 0 && <span className="text-stone-500">{tt(`${r.streak}-day streak`, `${r.streak} gün seri`)}</span>}
                    <span className="text-stone-400">
                      {r.doneDays}/{r.scheduledDays}
                    </span>
                    <span className="font-semibold text-stone-900">{pct(r.rate)}</span>
                  </span>
                </button>
                <ProgressBar
                  value={r.rate}
                  max={100}
                  className="h-1 bg-stone-200"
                  indicatorClassName={r.rate < 50 ? 'bg-amber-600' : 'bg-stone-900'}
                />
                {openRoutineKey === r.seriesKey && <RoutineCalendar calendar={r.calendar} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. PRIORITY & TAG DISTRIBUTION + MONTHLY MILESTONES PROGRESS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Priority & Tags */}
        <div className="lg:col-span-7 space-y-6">
          {/* Priority Breakdown */}
          <section
            aria-label={tt('Priority breakdown', 'Öncelik Dağılımı')}
            className="bg-white border border-stone-200/80 rounded-lg p-5 space-y-4 shadow-2xs"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-stone-900 tracking-tight flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-stone-700" />
                  {tt('Priority breakdown', 'Öncelik Seviyesi Analizi')}
                </h3>
                <p className="text-xs text-stone-500">
                  {tt('Completion rates by urgency.', 'İşlerin aciliyet derecesine göre icra ve tamamlama oranları.')}
                </p>
              </div>
              <span className="text-xs text-stone-400">
                {tt(`${completionStats.totalTasks} tasks in total`, `Toplam ${completionStats.totalTasks} Görev`)}
              </span>
            </div>

            <div className="space-y-3.5">
              {priorityStats.map((item) => (
                <div key={item.priority} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-stone-800">{item.label}</span>
                      <span className="text-stone-400">
                        ({item.done} / {item.total})
                      </span>
                    </div>
                    <span className="font-semibold text-stone-900">{pct(item.rate)}</span>
                  </div>
                  <ProgressBar
                    value={item.rate}
                    max={100}
                    className="h-1 bg-stone-200"
                    indicatorClassName="bg-stone-900"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Tag Intelligence */}
          <section
            aria-label={tt('Tag analytics', 'Etiket Analitiği')}
            className="bg-white border border-stone-200/80 rounded-lg p-5 space-y-4 shadow-2xs"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-stone-900 tracking-tight flex items-center gap-2">
                  <Tag className="w-4 h-4 text-stone-700" />
                  {tt('Tags & areas', 'Etiket & Alan Dağılımı')}
                </h3>
                <p className="text-xs text-stone-500">
                  {tt('Tags used on tasks and their completion rates.', 'Görevlerde kullanılan etiketler ve tamamlama oranları.')}
                </p>
              </div>
              <span className="text-xs text-stone-400">{tagStats.length} Etiket</span>
            </div>

            {tagStats.length === 0 ? (
              <div className="text-center py-6 text-stone-400 text-xs border border-dashed border-stone-200 rounded-lg">
                {tt('No tagged tasks yet.', 'Henüz etiketli görev bulunmuyor.')}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {tagStats.map((tagItem) => (
                  <div
                    key={tagItem.tag}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-stone-200 bg-stone-50 text-xs"
                  >
                    <span className="text-stone-800 font-medium">#{tagItem.tag}</span>
                    <span className="text-stone-300">•</span>
                    <span className="text-stone-600">
                      {tagItem.done}/{tagItem.total}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-stone-200/80 text-stone-700 font-medium">
                      {pct(tagItem.rate)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column (5 cols): Monthly Milestones Progress */}
        <div className="lg:col-span-5 space-y-6">
          <section
            aria-label={tt('Monthly milestone progress', 'Aylık Kilometre Taşları İlerlemesi')}
            className="bg-white border border-stone-200/80 rounded-lg p-5 space-y-4 shadow-2xs"
          >
            <div className="border-b border-stone-100 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Milestone className="w-4 h-4 text-stone-700" />
                  <h3 className="text-sm font-semibold text-stone-900 tracking-tight">
                    {tt('Monthly milestones', 'Aylık Kilometre Taşları')}
                  </h3>
                </div>
                <span className="text-xs text-stone-600 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded">
                  {currentMonthName}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                {tt('Completion of strategic goals and their linked tasks.', 'Stratejik hedeflerin ve bağlı görevlerin tamamlama durumu.')}
              </p>

              {/* Overall Milestones Progress */}
              <div className="pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-stone-500">{tt('Overall progress:', 'Genel İlerleme:')}</span>
                  <span className="font-semibold text-stone-900">
                    {pct(milestoneStats.rate)} ({milestoneStats.completedCount}/{milestoneStats.totalCount})
                  </span>
                </div>
                <ProgressBar
                  value={milestoneStats.rate}
                  max={100}
                  className="h-1 bg-stone-200"
                  indicatorClassName="bg-stone-900"
                />
              </div>
            </div>

            {/* Milestones List */}
            {milestoneStats.list.length === 0 ? (
              <div className="text-center py-6 text-stone-400 text-xs border border-dashed border-stone-200 rounded-lg">
                {tt('No milestones set for this month.', 'Bu ay için tanımlanmış kilometre taşı bulunamadı.')}
              </div>
            ) : (
              <div className="space-y-2.5">
                {milestoneStats.list.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'p-3 rounded-lg border transition-all duration-150 space-y-2',
                      m.completed
                        ? 'bg-stone-50/50 border-stone-200/50 opacity-75'
                        : 'bg-white border-stone-200 hover:border-stone-300'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => toggleMilestone(m.id)}
                        className="mt-0.5 text-stone-400 hover:text-stone-900 transition-colors cursor-pointer rounded"
                        title={m.completed ? tt('Unmark as done', 'Tamamlandı işaretini kaldır') : tt('Mark as done', 'Tamamlandı olarak işaretle')}
                      >
                        {m.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-stone-900" />
                        ) : (
                          <div className="w-4 h-4 rounded border border-stone-300 bg-white hover:border-stone-500" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <h4
                          className={cn(
                            'text-xs font-medium tracking-tight leading-snug',
                            m.completed ? 'line-through text-stone-400' : 'text-stone-800'
                          )}
                        >
                          {m.title}
                        </h4>
                      </div>

                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded border shrink-0',
                          m.completed
                            ? 'bg-stone-100 text-stone-600 border-stone-200'
                            : 'bg-stone-50 text-stone-600 border-stone-200'
                        )}
                      >
                        {m.completed ? tt('Done', 'Tamam') : tt('Ongoing', 'Sürüyor')}
                      </span>
                    </div>

                    {/* Connected tasks info */}
                    {m.linkedTotal > 0 && (
                      <div className="pt-1.5 border-t border-stone-100 space-y-1">
                        <div className="flex items-center justify-between text-xs text-stone-400">
                          <span>{tt('Linked tasks:', 'Bağlı Görevler:')}</span>
                          <span className="text-stone-700 font-medium">
                            {m.linkedDone} / {m.linkedTotal} ({pct(m.linkedRate)})
                          </span>
                        </div>
                        <ProgressBar
                          value={m.linkedRate}
                          max={100}
                          className="h-1 bg-stone-200"
                          indicatorClassName="bg-stone-900"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
