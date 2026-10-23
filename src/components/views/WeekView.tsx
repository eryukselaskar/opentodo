import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Play,
  Trash2,
  ArrowUpRight,
  Edit3,
  Layers,
  LayoutGrid,
  List,
  Sparkles,
  Loader2,
  Plus,
  X,
  Check,
  CalendarOff,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTodoStore } from '../../store/useTodoStore';
import { getTaskColorClass } from '../../lib/tags';
import { TaskMeta } from '../ui/tags';
import {
  formatWeekRangeLabel,
  shiftWeekKey,
  getCurrentWeekKey,
  getTodayKey,
  getWeekDays,
  getTasksForDate,
  computeDayWorkload,
  sortTasksByTimeAndStatus,
  splitTaskTimeAndTitle,
} from '../../lib/dateUtils';
import type { Task } from '../../types/todo';
import {
  cn,
  Checkbox,
  TooltipWrapper,
} from '../ui/primitives';
import { formatMinutes, matchesTaskFilters, isDatedRoutine } from '../ui/taskUi';
import { getWeekPoolTasks } from '../../lib/pools';
import { autoScheduleWeekWithAI, extractTaskSequenceOrder } from '../../lib/ollamaClient';
import { t as tt } from '../../lib/i18n';

export function WeekView() {
  const {
    tasks,
    selectedWeekKey,
    selectedMonthKey,
    searchQuery,
    selectedTagFilter,
    selectedPriorityFilter,
    addTask,
    addTaskFromRaw,
    deleteTask,
    skipTaskForDate,
    toggleTaskDone,
    assignTaskToDay,
    assignTaskToWeekPool,
    assignTaskToMonthPool,
    setSelectedWeekKey,
    setSelectedDateKey,
    setActiveView,
    setActiveFocusTaskId,
    setEditingTaskId,
  } = useTodoStore(
    useShallow((s) => ({
      tasks: s.tasks,
      selectedWeekKey: s.selectedWeekKey,
      selectedMonthKey: s.selectedMonthKey,
      searchQuery: s.searchQuery,
      selectedTagFilter: s.selectedTagFilter,
      selectedPriorityFilter: s.selectedPriorityFilter,
      addTask: s.addTask,
      addTaskFromRaw: s.addTaskFromRaw,
      deleteTask: s.deleteTask,
      skipTaskForDate: s.skipTaskForDate,
      toggleTaskDone: s.toggleTaskDone,
      assignTaskToDay: s.assignTaskToDay,
      assignTaskToWeekPool: s.assignTaskToWeekPool,
      assignTaskToMonthPool: s.assignTaskToMonthPool,
      setSelectedWeekKey: s.setSelectedWeekKey,
      setSelectedDateKey: s.setSelectedDateKey,
      setActiveView: s.setActiveView,
      setActiveFocusTaskId: s.setActiveFocusTaskId,
      setEditingTaskId: s.setEditingTaskId,
    }))
  );
  const tagDefs = useTodoStore((s) => s.tagDefs);

  const [poolInput, setPoolInput] = useState('');
  const [dayInputs, setDayInputs] = useState<{ [dateKey: string]: string }>({});
  const [activeQuickAddDateKey, setActiveQuickAddDateKey] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'agenda'>('grid');

  // HTML5 Drag-and-Drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null); // 'pool' | dateKey

  // AI Week Auto-balance & Proposal state
  const [isBalancingWeek, setIsBalancingWeek] = useState(false);
  const [pendingProposals, setPendingProposals] = useState<
    { taskId: string; dateKey: string; reason: string }[]
  >([]);
  const [balanceResultBanner, setBalanceResultBanner] = useState<{
    count: number;
    message: string;
  } | null>(null);

  const currentWeekKey = getCurrentWeekKey();
  const isCurrentWeek = selectedWeekKey === currentWeekKey;

  const weekDays = useMemo(() => {
    return getWeekDays(selectedWeekKey);
  }, [selectedWeekKey]);

  // Tasks in unassigned weekly pool for this week
  const weeklyPoolTasks = useMemo(() => {
    return getWeekPoolTasks(tasks, selectedWeekKey, getCurrentWeekKey());
  }, [tasks, selectedWeekKey]);

  // Current workload minutes per day for AI load balancing (including work vs gaming/leisure & daily routines)
  const weekDaysWithCurrentMinutes = useMemo(() => {
    return weekDays.map((day) => {
      const summary = computeDayWorkload(tasks, day.dateKey);
      return {
        dateKey: day.dateKey,
        dayName: day.dayName,
        currentMinutes: summary.plannedMinutes,
        workMinutes: summary.workMinutes,
        leisureMinutes: summary.leisureMinutes,
        routineMinutes: summary.routineMinutes,
      };
    });
  }, [weekDays, tasks]);

  // Filter tasks with global search, tag and priority filters
  const filterTask = React.useCallback(
    (t: (typeof tasks)[0]) =>
      matchesTaskFilters(t, { searchQuery, selectedTagFilter, selectedPriorityFilter }),
    [searchQuery, selectedTagFilter, selectedPriorityFilter]
  );

  const filteredPoolTasks = useMemo(() => {
    return [...weeklyPoolTasks.filter(filterTask)].sort((a, b) => {
      const seqA = extractTaskSequenceOrder(a.title);
      const seqB = extractTaskSequenceOrder(b.title);
      if (seqA !== null && seqB !== null && seqA !== seqB) {
        return seqA - seqB;
      }
      return 0;
    });
  }, [weeklyPoolTasks, filterTask]);

  // Handle adding a task to the weekly pool
  const handleAddPoolTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!poolInput.trim()) return;

    if (addTaskFromRaw) {
      addTaskFromRaw(poolInput, 'week');
    } else {
      addTask({
        title: poolInput.trim(),
        horizon: 'week',
        weekKey: selectedWeekKey,
        scheduledDate: null,
      });
    }
    setPoolInput('');
  };

  // Handle quick adding task to specific day
  const handleAddDayTask = (dateKey: string) => {
    const text = (dayInputs[dateKey] || '').trim();
    if (!text) return;

    addTask({
      title: text,
      horizon: 'day',
      scheduledDate: dateKey,
    });

    setDayInputs((prev) => ({ ...prev, [dateKey]: '' }));
    setActiveQuickAddDateKey(null);
  };

  // AI Weekly Auto-Balancing (Generates Proposals for User Confirmation)
  const handleAutoBalanceWeek = async () => {
    if (filteredPoolTasks.length === 0 || isBalancingWeek) return;

    // Never propose days that are already over, or tasks that are already done
    const todayKey = getTodayKey();
    const schedulableDays = weekDaysWithCurrentMinutes.filter((d) => d.dateKey >= todayKey);
    const openPoolTasks = filteredPoolTasks.filter((t) => t.status !== 'done');
    if (schedulableDays.length === 0) {
      setBalanceResultBanner({
        count: 0,
        message: tt('Every day of this week is in the past; pick a later week to plan.', 'Bu haftanın tüm günleri geçmişte kaldı; planlamak için ileri bir hafta seçin.'),
      });
      return;
    }
    if (openPoolTasks.length === 0) {
      setBalanceResultBanner({ count: 0, message: tt('No open tasks in the pool to plan.', 'Havuzda planlanacak açık görev yok.') });
      return;
    }

    setIsBalancingWeek(true);
    setBalanceResultBanner(null);

    try {
      const poolPayload = openPoolTasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes || 25,
      }));

      const result = await autoScheduleWeekWithAI(poolPayload, schedulableDays);
      if (result && result.assignments && result.assignments.length > 0) {
        setPendingProposals(result.assignments);
      } else {
        setBalanceResultBanner({
          count: 0,
          message: tt('No suitable tasks to plan.', 'Planlanacak uygun görev bulunamadı.'),
        });
      }
    } catch (err) {
      console.error('Failed to auto balance week:', err);
      setBalanceResultBanner({
        count: 0,
        message: tt('Something went wrong while preparing the week plan.', 'Hafta önerisi hazırlanırken bir hata oluştu.'),
      });
    } finally {
      setIsBalancingWeek(false);
    }
  };

  const handleApproveAllProposals = () => {
    if (pendingProposals.length === 0) return;
    const count = pendingProposals.length;
    pendingProposals.forEach((proposal) => {
      assignTaskToDay(proposal.taskId, proposal.dateKey);
    });
    setPendingProposals([]);
    setBalanceResultBanner({
      count,
      message: tt(`${count} tasks placed on the week's days in order.`, `${count} görev onayınızla hafta günlerine kronolojik sırayla yerleştirildi.`),
    });
  };

  const handleApproveSingleProposal = (taskId: string) => {
    const proposal = pendingProposals.find((p) => p.taskId === taskId);
    if (!proposal) return;
    assignTaskToDay(proposal.taskId, proposal.dateKey);
    const remaining = pendingProposals.filter((p) => p.taskId !== taskId);
    setPendingProposals(remaining);
    if (remaining.length === 0) {
      setBalanceResultBanner({
        count: 1,
        message: tt('All suggestions accepted and placed on their days.', 'Tüm öneriler onaylandı ve günlere yerleştirildi.'),
      });
    }
  };

  const handleChangeProposalDate = (taskId: string, newDateKey: string, dayName: string) => {
    setPendingProposals((prev) =>
      prev.map((p) =>
        p.taskId === taskId
          ? { ...p, dateKey: newDateKey, reason: tt(`Moved to ${dayName} by you`, `${dayName} gününe sizin tarafınızdan seçildi`) }
          : p
      )
    );
  };

  const handleRemoveProposal = (taskId: string) => {
    setPendingProposals((prev) => prev.filter((p) => p.taskId !== taskId));
  };

  const totalWeekTasksCount = useMemo(() => {
    return weekDays.reduce((acc, day) => {
      const count = getTasksForDate(tasks, day.dateKey).filter(filterTask).length;
      return acc + count;
    }, 0);
  }, [weekDays, tasks, filterTask]);

  // --- Shared pieces for both week layouts (Kart / Liste) ---
  type WeekDay = (typeof weekDays)[number];

  const getDayData = (day: WeekDay) => {
    const dayTasks = sortTasksByTimeAndStatus(getTasksForDate(tasks, day.dateKey).filter(filterTask));
    const daySummary = weekDaysWithCurrentMinutes.find((w) => w.dateKey === day.dateKey);
    const plannedMinutes = dayTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
    return { dayTasks, daySummary, plannedMinutes };
  };

  const dayDropProps = (day: WeekDay) => ({
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverTarget !== day.dateKey) {
        setDragOverTarget(day.dateKey);
      }
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragOverTarget(null);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOverTarget(null);
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      if (taskId) {
        assignTaskToDay(taskId, day.dateKey);
      }
      setDraggedTaskId(null);
    },
  });

  const dayFrameClass = (day: WeekDay) =>
    dragOverTarget === day.dateKey
      ? 'ring-2 ring-stone-900 bg-stone-100/70 border-stone-900'
      : day.isToday
      ? 'border-stone-900 ring-2 ring-stone-900/10'
      : 'border-stone-200/80 hover:border-stone-300';

  const goToDay = (dateKey: string) => {
    setSelectedDateKey(dateKey);
    setActiveView('day');
  };

  const renderTodayBadge = () => (
    <span className="text-xs px-1.5 py-0.5 rounded bg-stone-900 text-stone-50 font-medium">
      {tt('Today', 'Bugün')}
    </span>
  );

  const renderQuickAddToggle = (day: WeekDay) => (
    <TooltipWrapper content={tt('Add task', 'Görev ekle')}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setActiveQuickAddDateKey(activeQuickAddDateKey === day.dateKey ? null : day.dateKey);
        }}
        className={cn(
          'p-1 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer',
          activeQuickAddDateKey === day.dateKey && 'text-stone-900 bg-stone-100'
        )}
        title={tt('Add task', 'Görev ekle')}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </TooltipWrapper>
  );

  const renderDayQuickAdd = (day: WeekDay) =>
    activeQuickAddDateKey === day.dateKey && (
      <div className="pt-1">
        <input
          type="text"
          autoFocus
          value={dayInputs[day.dateKey] || ''}
          onChange={(e) =>
            setDayInputs((prev) => ({
              ...prev,
              [day.dateKey]: e.target.value,
            }))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddDayTask(day.dateKey);
            } else if (e.key === 'Escape') {
              setActiveQuickAddDateKey(null);
            }
          }}
          onBlur={() => {
            if (!dayInputs[day.dateKey]?.trim()) {
              setActiveQuickAddDateKey(null);
            }
          }}
          placeholder={tt('+ Add task... [Enter]', '+ Görev ekle... [Enter]')}
          className="h-7 text-xs px-2.5 rounded-md bg-stone-50 border border-stone-300 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 w-full font-sans transition-all"
        />
      </div>
    );

  const renderWorkloadBreakdown = (
    daySummary: (typeof weekDaysWithCurrentMinutes)[number] | undefined,
    compact: boolean
  ) =>
    daySummary &&
    (daySummary.workMinutes > 0 || daySummary.leisureMinutes > 0 || daySummary.routineMinutes > 0) && (
      <div className={cn('flex items-center gap-1.5 flex-wrap text-xs text-stone-500', !compact && 'mt-1')}>
        <span>{tt('Work:', 'İş:')} {formatMinutes(daySummary.workMinutes)}</span>
        {daySummary.leisureMinutes > 0 && (
          <span className="text-amber-700">
            · {tt('Leisure:', 'Keyif:')} {formatMinutes(daySummary.leisureMinutes)}
          </span>
        )}
        {daySummary.routineMinutes > 0 && (
          <span className="text-stone-400">
            · {tt('Routine:', 'Rutin:')} {formatMinutes(daySummary.routineMinutes)}
          </span>
        )}
      </div>
    );

  // One task row. `compact` = Kart görünümü (smaller, wraps); otherwise Liste görünümü.
  const renderTaskRow = (task: Task, day: WeekDay, compact: boolean) => {
    const isDone = task.status === 'done';
    const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(task.title);
    const iconClass = 'h-3.5 w-3.5';
    const title = (
      <span
        onClick={() => setEditingTaskId(task.id, day.dateKey)}
        className={cn(
          'block text-stone-900 leading-snug break-words cursor-pointer hover:text-stone-600 font-medium transition-colors',
          compact ? 'text-sm' : 'text-sm',
          isDone && 'line-through text-stone-400 font-normal'
        )}
      >
        {cleanTitle}
      </span>
    );

    return (
      <div
        key={`${task.id}-${day.dateKey}`}
        draggable={!isDatedRoutine(task)}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
          setDraggedTaskId(task.id);
        }}
        onDragEnd={() => {
          setDraggedTaskId(null);
          setDragOverTarget(null);
        }}
        className={cn(
          'group/task relative flex justify-between rounded-md border-l-4 border-l-transparent hover:bg-stone-50 transition-all cursor-grab active:cursor-grabbing',
          compact ? 'items-start gap-2 py-2.5 px-1.5' : 'items-start gap-3 py-3 px-2',
          isDone && 'opacity-60',
          getTaskColorClass(task.tags, tagDefs),
          draggedTaskId === task.id && 'opacity-40 ring-1 ring-stone-400 bg-stone-50'
        )}
      >
        <div className={cn('flex items-start min-w-0 flex-1', compact ? 'gap-2' : 'gap-3')}>
          <Checkbox
            checked={isDone}
            onCheckedChange={() => toggleTaskDone(task.id, day.dateKey)}
            className={cn(
              'border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0 cursor-pointer',
              compact ? 'h-4 w-4 mt-0.5' : 'h-5 w-5 mt-0.5'
            )}
          />
          <div className="min-w-0 flex-1 space-y-1">
            {title}
            <TaskMeta task={task} timeBadge={timeBadge} size={compact ? 'xs' : 'sm'} />
          </div>
          {task.isMIT && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500 shrink-0 mt-0.5" />}
        </div>

        {/* Actions: Odaklan, Havuza geri bırak, Düzenle, Bu günü atla, Sil */}
        <div
          className={cn(
            'flex items-center shrink-0 text-stone-400',
            compact
              ? // Kart: no reserved column; float over the row on hover so titles keep full width
                'gap-0.5 sm:hidden sm:group-hover/task:flex sm:absolute sm:right-1 sm:top-1.5 sm:bg-white sm:border sm:border-stone-200 sm:rounded-md sm:shadow-sm sm:px-0.5'
              : 'gap-1 opacity-100 sm:opacity-0 sm:group-hover/task:opacity-100 focus-within:opacity-100 transition-opacity'
          )}
        >
          <TooltipWrapper content={tt('Focus', 'Odaklan')}>
            <button
              onClick={() => {
                setActiveFocusTaskId(task.id, day.dateKey);
                setActiveView('focus');
              }}
              className="p-1 hover:text-stone-900 rounded hover:bg-stone-100 transition-colors cursor-pointer"
            >
              <Play className={iconClass} />
            </button>
          </TooltipWrapper>
          {!isDatedRoutine(task) && (
            <TooltipWrapper content={tt('Move back to pool', 'Havuza geri bırak')}>
              <button
                onClick={() => assignTaskToWeekPool(task.id, selectedWeekKey)}
                className="p-1 hover:text-stone-900 rounded hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <Layers className={iconClass} />
              </button>
            </TooltipWrapper>
          )}
          <TooltipWrapper content={tt('Edit', 'Düzenle')}>
            <button
              onClick={() => setEditingTaskId(task.id, day.dateKey)}
              className="p-1 hover:text-stone-900 rounded hover:bg-stone-100 transition-colors cursor-pointer"
            >
              <Edit3 className={iconClass} />
            </button>
          </TooltipWrapper>
          {task.recurrence !== 'none' && (
            <TooltipWrapper content={tt('Skip just this day', 'Sadece Bu Günlük Atla')}>
              <button
                onClick={() => skipTaskForDate(task.id, day.dateKey)}
                className="p-1 hover:text-amber-700 rounded hover:bg-amber-50 transition-colors cursor-pointer"
                title={tt('Skip just this day', 'Sadece Bu Günlük Atla')}
              >
                <CalendarOff className={iconClass} />
              </button>
            </TooltipWrapper>
          )}
          <TooltipWrapper content={task.recurrence !== 'none' ? tt('Delete whole routine', 'Rutini Tamamen Sil') : tt('Delete', 'Sil')}>
            <button
              onClick={() => deleteTask(task.id)}
              className="p-1 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <Trash2 className={iconClass} />
            </button>
          </TooltipWrapper>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12 font-sans text-stone-900">
      {/* 1. HEADER & WEEK NAVIGATION */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 border-b border-stone-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            {formatWeekRangeLabel(selectedWeekKey)}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {isCurrentWeek ? (
              <span className="text-xs text-stone-400">
                {tt('This week', 'Bu Hafta')}
              </span>
            ) : (
              <button
                onClick={() => setSelectedWeekKey(currentWeekKey)}
                className="hover:text-stone-800 transition-colors underline underline-offset-2 text-xs cursor-pointer"
              >
                {tt('Back to this week', 'Bu Haftaya Dön')}
              </button>
            )}
          </p>
        </div>

        {/* Week Navigation Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedWeekKey(shiftWeekKey(selectedWeekKey, -1))}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors cursor-pointer"
            title={tt('Previous week', 'Önceki Hafta')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {!isCurrentWeek && (
            <button
              onClick={() => setSelectedWeekKey(currentWeekKey)}
              className="px-2.5 py-1 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-200/50 rounded-md transition-colors font-medium cursor-pointer"
            >
              {tt('This week', 'Bu Hafta')}
            </button>
          )}
          <button
            onClick={() => setSelectedWeekKey(shiftWeekKey(selectedWeekKey, 1))}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors cursor-pointer"
            title={tt('Next week', 'Sonraki Hafta')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 2. HAFTALIK HAVUZ (UNASSIGNED WEEKLY POOL) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverTarget !== 'pool') {
            setDragOverTarget('pool');
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOverTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverTarget(null);
          const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
          if (taskId) {
            assignTaskToWeekPool(taskId, selectedWeekKey);
          }
          setDraggedTaskId(null);
        }}
        className={cn(
          'bg-white border rounded-xl p-4 sm:p-5 shadow-xs space-y-3 transition-all',
          dragOverTarget === 'pool'
            ? 'ring-2 ring-stone-900 bg-stone-100/70 border-stone-900'
            : 'border-stone-200/80'
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xs text-stone-500">
              {tt('WEEKLY TASK POOL', 'HAFTALIK GÖREV HAVUZU')}
            </h2>
            <span className="text-xs text-stone-400">
              ({filteredPoolTasks.length})
            </span>

            {/* ✨ Haftamı Dengele Button */}
            {filteredPoolTasks.length > 0 && (
              <button
                type="button"
                onClick={handleAutoBalanceWeek}
                disabled={isBalancingWeek}
                className={cn(
                  'ml-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all shadow-2xs cursor-pointer',
                  isBalancingWeek
                    ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                    : 'bg-stone-900 text-white hover:bg-stone-800 active:scale-[0.98]'
                )}
                title={tt('Get day suggestions for the weekly pool tasks', 'Haftalık havuzdaki görevler için kronolojik gün önerisi al')}
              >
                {isBalancingWeek ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{tt('Preparing suggestions...', 'Öneri hazırlanıyor...')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 text-amber-300" />
                    <span>{tt('Balance my week', 'Haftamı Dengele')}</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Quick Input to Add to Weekly Pool */}
          <form onSubmit={handleAddPoolTask} className="w-full sm:w-auto">
            <input
              type="text"
              value={poolInput}
              onChange={(e) => setPoolInput(e.target.value)}
              placeholder={tt('+ Add a task to this week\'s pool... [Enter]', '+ Bu haftanın havuzuna görev ekle... [Enter]')}
              className="h-8.5 w-full sm:w-80 px-3 rounded-md bg-stone-50 border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 transition-colors font-sans"
            />
          </form>
        </div>

        {/* INTERACTIVE AI PROPOSAL & APPROVAL PANEL */}
        {pendingProposals.length > 0 && (
          <div className="bg-[#FAF9F5] border-2 border-stone-900 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-stone-900 shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold text-stone-900">
                    {tt('Weekly plan suggestion (awaiting your approval)', 'Haftalık Plan Önerisi (Onayınızı Bekliyor)')}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {tt('Tasks are ordered 1 → 2 → 3 and placed on your lightest days. You can change the days or approve.', 'Görevler 1 → 2 → 3 sırasına ve iş yükünüzün en az olduğu günlere göre dizildi. Günleri değiştirebilir veya onaylayabilirsiniz.')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingProposals([])}
                  className="px-2.5 py-1 rounded-md text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
                >
                  {tt('Cancel', 'Vazgeç')}
                </button>
                <button
                  type="button"
                  onClick={handleApproveAllProposals}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors cursor-pointer shadow-2xs"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{tt(`Approve all (${pendingProposals.length})`, `Tüm Önerileri Onayla (${pendingProposals.length})`)}</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-stone-200/70">
              {pendingProposals.map((proposal, idx) => {
                const task = tasks.find((t) => t.id === proposal.taskId);
                if (!task) return null;
                const targetDay = weekDays.find((d) => d.dateKey === proposal.dateKey);
                const dayLoad = weekDaysWithCurrentMinutes.find(
                  (d) => d.dateKey === proposal.dateKey
                );

                return (
                  <div
                    key={proposal.taskId}
                    className="py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-900 text-stone-50 text-xs font-semibold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-stone-900 break-words">
                          {task.title}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-stone-900 text-stone-50">
                          {targetDay ? `${targetDay.dayName} ${targetDay.dayNumber}` : proposal.dateKey}
                        </span>
                        {dayLoad && (
                          <span className="text-xs text-stone-500">
                            ({tt('Work:', 'İş:')} {formatMinutes(dayLoad.workMinutes)}
                            {dayLoad.leisureMinutes > 0 ? ` · ${tt('Leisure:', 'Oyun/Boş:')} ${formatMinutes(dayLoad.leisureMinutes)}` : ''})
                          </span>
                        )}
                      </div>
                      {proposal.reason && (
                        <p className="text-xs text-stone-600 pl-7">
                          {proposal.reason}
                        </p>
                      )}
                    </div>

                    {/* Day Switcher Pills + Single Approve Button */}
                    <div className="flex items-center flex-wrap gap-1.5 pl-7 lg:pl-0 shrink-0">
                      <div className="flex items-center gap-1 mr-1">
                        {weekDays.map((day) => {
                          const isSelected = day.dateKey === proposal.dateKey;
                          return (
                            <button
                              key={day.dateKey}
                              type="button"
                              onClick={() =>
                                handleChangeProposalDate(
                                  proposal.taskId,
                                  day.dateKey,
                                  day.dayName
                                )
                              }
                              className={cn(
                                'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer',
                                isSelected
                                  ? 'bg-stone-900 text-stone-50 border-stone-900 font-semibold'
                                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                              )}
                              title={tt(`Move to ${day.dayName}`, `${day.dayName} gününe al`)}
                            >
                              {day.shortName}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleApproveSingleProposal(proposal.taskId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-stone-200/80 text-stone-900 hover:bg-stone-900 hover:text-stone-50 transition-colors cursor-pointer"
                        title={tt('Approve this task for the suggested day', 'Bu görevi önerilen güne onayla')}
                      >
                        <Check className="h-3 w-3" />
                        <span>{tt('Approve', 'Onayla')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveProposal(proposal.taskId)}
                        className="p-1 text-stone-400 hover:text-stone-700 rounded transition-colors cursor-pointer"
                        title={tt('Remove from suggestions', 'Öneriden çıkar')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Balancing result banner */}
        {balanceResultBanner && (
          <div className="flex items-center justify-between px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg text-xs text-stone-800 font-sans animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-stone-700 shrink-0" />
              <span>{balanceResultBanner.message}</span>
            </div>
            <button
              onClick={() => setBalanceResultBanner(null)}
              className="p-1 hover:text-stone-900 text-stone-400 rounded transition-colors cursor-pointer"
              title={tt('Close', 'Kapat')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Weekly Pool Tasks List */}
        {filteredPoolTasks.length === 0 ? (
          <p className="text-xs text-stone-400 py-3 text-center">
            {tt('No unassigned tasks in the weekly pool.', 'Haftalık havuzda atanmamış görev bulunmuyor.')}
          </p>
        ) : (
          <div className="divide-y divide-stone-100 pt-1">
            {filteredPoolTasks.map((task) => {
              const isDone = task.status === 'done';
              const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(task.title);

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', task.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedTaskId(task.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTaskId(null);
                    setDragOverTarget(null);
                  }}
                  className={cn(
                    'flex flex-col md:flex-row md:items-center justify-between py-3 px-2 gap-2.5 border-l-4 border-l-transparent hover:bg-stone-50/70 rounded-md transition-all group cursor-grab active:cursor-grabbing',
                    getTaskColorClass(task.tags, tagDefs),
                    draggedTaskId === task.id && 'opacity-40 ring-1 ring-stone-400 bg-stone-50'
                  )}
                >
                  {/* Left: Checkbox + Title + meta line */}
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={() => toggleTaskDone(task.id)}
                      className="border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0 mt-0.5 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <span
                        onClick={() => setEditingTaskId(task.id)}
                        className={cn(
                          'block text-sm font-medium text-stone-900 leading-snug break-words cursor-pointer hover:text-stone-600 transition-colors',
                          isDone && 'line-through text-stone-400 font-normal'
                        )}
                      >
                        {cleanTitle}
                      </span>
                      <TaskMeta task={task} timeBadge={timeBadge} />
                    </div>
                  </div>

                  {/* Right: Day Assignment buttons (Pzt Sal Çar Per Cum Cmt Paz) + Month + Hover/tap actions */}
                  <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 pl-7 md:pl-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-xs text-stone-400 mr-1">{tt('Assign to day:', 'Güne Ata:')}</span>
                      {weekDays.map((day) => (
                        <button
                          key={day.dateKey}
                          onClick={() => assignTaskToDay(task.id, day.dateKey)}
                          title={tt(`Assign to ${day.dayName}`, `${day.dayName} gününe ata`)}
                          className={cn(
                            'text-xs px-2 py-0.5 rounded transition-colors border cursor-pointer',
                            day.isToday
                              ? 'font-semibold text-stone-900 bg-stone-200/90 border-stone-300 hover:bg-stone-300'
                              : 'text-stone-600 bg-stone-50 border-stone-200 hover:bg-stone-100 hover:text-stone-900'
                          )}
                        >
                          {day.shortName}
                        </button>
                      ))}
                      <button
                        onClick={() => assignTaskToMonthPool(task.id, selectedMonthKey)}
                        title={tt('Send to monthly pool', 'Aylık havuza gönder')}
                        className="text-xs text-stone-500 bg-stone-50 border border-stone-200 hover:text-stone-900 hover:bg-stone-100 px-2 py-0.5 rounded transition-colors ml-0.5 cursor-pointer"
                      >
                        {tt('Month', 'Ay')}
                      </button>
                    </div>

                    <div className="flex items-center gap-0.5 text-stone-400 shrink-0 ml-1.5">
                      <TooltipWrapper content={tt('Edit', 'Düzenle')}>
                        <button
                          onClick={() => setEditingTaskId(task.id)}
                          className="p-1 hover:text-stone-900 rounded hover:bg-stone-100 transition-colors cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </TooltipWrapper>
                      <TooltipWrapper content={tt('Delete', 'Sil')}>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TooltipWrapper>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. 7 GÜNLÜK PLAN */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs text-stone-500">
              {tt('7-DAY PLAN', '7 GÜNLÜK PLAN')}
            </h2>
            <span className="text-xs text-stone-400">
              ({totalWeekTasksCount} {tt('tasks', 'Görev')})
            </span>
          </div>

          {/* Layout Mode Toggle: Kart Görünümü vs Liste / Ajanda Görünümü */}
          <div className="flex items-center bg-stone-100 p-0.5 rounded-lg border border-stone-200/80 text-xs font-medium self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setLayoutMode('grid')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer',
                layoutMode === 'grid'
                  ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                  : 'text-stone-500 hover:text-stone-800'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>{tt('Cards', 'Kart Görünümü')}</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('agenda')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer',
                layoutMode === 'agenda'
                  ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                  : 'text-stone-500 hover:text-stone-800'
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span>{tt('List / agenda', 'Liste / Ajanda Görünümü')}</span>
            </button>
          </div>
        </div>

        {layoutMode === 'grid' ? (
          /* Card layout: Responsive 1 / 2 / 3 / 4 columns (NEVER 7-cols on desktop!) */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {weekDays.map((day) => {
              const { dayTasks, daySummary, plannedMinutes } = getDayData(day);

              const workPct = Math.min(100, Math.round(((daySummary?.workMinutes || 0) / 360) * 100));
              const leisurePct = Math.min(
                100 - workPct,
                Math.round(((daySummary?.leisureMinutes || 0) / 360) * 100)
              );
              const routinePct = Math.min(
                100 - workPct - leisurePct,
                Math.round(((daySummary?.routineMinutes || 0) / 360) * 100)
              );

              return (
                <div
                  key={day.dateKey}
                  {...dayDropProps(day)}
                  className={cn(
                    'bg-white border rounded-xl p-4 flex flex-col justify-between min-h-[380px] transition-all shadow-xs',
                    dayFrameClass(day)
                  )}
                >
                  <div className="space-y-3 flex-1 flex flex-col min-h-0">
                    {/* Day Column Header */}
                    <div
                      onClick={() => goToDay(day.dateKey)}
                      className="cursor-pointer group pb-2.5 border-b border-stone-100 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold tracking-tight text-stone-900 group-hover:text-stone-600 transition-colors">
                            {day.dayName}
                          </span>
                          {day.isToday && renderTodayBadge()}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {renderQuickAddToggle(day)}
                          <span
                            className={cn(
                              'h-6 w-6 rounded-full flex items-center justify-center text-xs transition-colors',
                              day.isToday
                                ? 'bg-stone-900 text-white font-bold'
                                : 'text-stone-700 bg-stone-100 group-hover:bg-stone-200 font-semibold'
                            )}
                          >
                            {day.dayNumber}
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-stone-400 group-hover:text-stone-700 transition-colors opacity-0 group-hover:opacity-100" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-stone-400">
                        <span>{dayTasks.length} {tt('tasks', 'Görev')}</span>
                        {plannedMinutes > 0 && <span>{formatMinutes(plannedMinutes)}</span>}
                      </div>

                      {/* Segmented Workload Bar + Work vs Gaming/Routine Breakdown */}
                      <div className="space-y-1.5">
                        <div className="h-1 w-full bg-stone-100 rounded-full overflow-hidden flex">
                          {workPct > 0 && (
                            <div
                              className="h-full bg-stone-900 transition-all"
                              style={{ width: `${workPct}%` }}
                              title={`${tt('Workload:', 'İş Yükü:')} ${formatMinutes(daySummary?.workMinutes || 0)}`}
                            />
                          )}
                          {leisurePct > 0 && (
                            <div
                              className="h-full bg-amber-500/80 transition-all"
                              style={{ width: `${leisurePct}%` }}
                              title={`${tt('Leisure:', 'Oyun / Keyif:')} ${formatMinutes(daySummary?.leisureMinutes || 0)}`}
                            />
                          )}
                          {routinePct > 0 && (
                            <div
                              className="h-full bg-stone-300 transition-all"
                              style={{ width: `${routinePct}%` }}
                              title={`${tt('Routine:', 'Sabit Rutin:')} ${formatMinutes(daySummary?.routineMinutes || 0)}`}
                            />
                          )}
                        </div>
                        {renderWorkloadBreakdown(daySummary, true)}
                      </div>
                    </div>

                    {renderDayQuickAdd(day)}

                    {/* Day Tasks List */}
                    <div className="divide-y divide-stone-100 overflow-y-auto max-h-[380px] pr-0.5 flex-1">
                      {dayTasks.length === 0 ? (
                        <p className="text-xs text-stone-400 text-center py-8">
                          {tt('No tasks planned', 'Planlanmış görev yok')}
                        </p>
                      ) : (
                        dayTasks.map((task) => renderTaskRow(task, day, true))
                      )}
                    </div>
                  </div>

                  {/* Day Footer with DayView Shortcut */}
                  <div className="mt-3 pt-2.5 border-t border-stone-100">
                    <button
                      onClick={() => goToDay(day.dateKey)}
                      className="w-full text-center text-xs text-stone-500 hover:text-stone-900 py-1 rounded hover:bg-stone-100 transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>{tt('Go to day', 'Güne Git')}</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List / agenda layout: 7 wide horizontal bands */
          <div className="space-y-3">
            {weekDays.map((day) => {
              const { dayTasks, daySummary, plannedMinutes } = getDayData(day);

              return (
                <div
                  key={day.dateKey}
                  {...dayDropProps(day)}
                  className={cn(
                    'bg-white border rounded-xl p-4 sm:p-5 transition-all shadow-xs flex flex-col md:flex-row md:items-start gap-4',
                    dayFrameClass(day)
                  )}
                >
                  {/* Left Column: Day info (Pazartesi 19), stats, and quick day navigation */}
                  <div className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-stone-100 pb-3 md:pb-0 md:pr-4 space-y-2.5">
                    <div onClick={() => goToDay(day.dateKey)} className="cursor-pointer group">
                      <div className="flex items-center justify-between md:justify-start md:gap-3">
                        <span className="text-base font-semibold text-stone-900 group-hover:text-stone-600 transition-colors">
                          {day.dayName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {renderQuickAddToggle(day)}
                          <span
                            className={cn(
                              'h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold',
                              day.isToday
                                ? 'bg-stone-900 text-white'
                                : 'bg-stone-100 text-stone-700 group-hover:bg-stone-200'
                            )}
                          >
                            {day.dayNumber}
                          </span>
                          {day.isToday && renderTodayBadge()}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-stone-400 mt-1">
                        <span>{dayTasks.length} {tt('tasks', 'Görev')}</span>
                        {plannedMinutes > 0 && <span>{formatMinutes(plannedMinutes)}</span>}
                      </div>

                      {renderWorkloadBreakdown(daySummary, false)}
                    </div>

                    {renderDayQuickAdd(day)}

                    <button
                      onClick={() => goToDay(day.dateKey)}
                      className="text-xs text-stone-400 hover:text-stone-800 flex items-center gap-1 transition-colors cursor-pointer group"
                    >
                      <span>{tt('Go to day', 'Güne Git')}</span>
                      <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </button>
                  </div>

                  {/* Right Column: Full-width hairline rows */}
                  <div className="flex-1 min-w-0">
                    {dayTasks.length === 0 ? (
                      <p className="text-xs text-stone-400 py-3 text-center md:text-left italic">
                        {tt('No tasks planned for this day.', 'Bu gün için planlanmış görev yok.')}
                      </p>
                    ) : (
                      <div className="divide-y divide-stone-100">
                        {dayTasks.map((task) => renderTaskRow(task, day, false))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
