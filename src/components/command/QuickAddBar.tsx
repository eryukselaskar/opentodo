import { useState, useRef, useEffect, useId, type FormEvent } from 'react';
import {
  Plus,
  X,
  Star,
  Calendar,
  Clock,
  Layers,
  Repeat,
  Target,
  AlertCircle,
  FileText,
  ListTodo,
  Trash2,
  Sparkles,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  TaskHorizon,
  TaskPriority,
  RecurrencePattern,
  Subtask,
} from '../../types/todo';
import {
  getTodayKey,
  shiftDateKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  getWeekKeyFromDateKey,
  getMonthKeyFromDateKey,
  computeDayWorkload,
  formatRecurrenceLabel,
  formatWeekRangeLabel,
  formatMonthLabel,
  getNames,
} from '../../lib/dateUtils';
import { parseQuickTaskInput, hasExplicitHorizonToken } from '../../lib/nlpParser';
import { useTodoStore } from '../../store/useTodoStore';
import { ColoredTags, TagEditor } from '../ui/tags';
import {
  generateSubtasksWithAI,
  parseSmartDumpWithAI,
} from '../../lib/ollamaClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Checkbox,
  ProgressBar,
  Badge,
  cn,
} from '../ui/primitives';
import { t as tt } from '../../lib/i18n';
import { formatMinutes } from '../ui/taskUi';

export interface QuickAddBarProps {
  defaultHorizon?: TaskHorizon;
  className?: string;
}

function generateSubtaskId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'st-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}

export function QuickAddBar({ defaultHorizon, className = '' }: QuickAddBarProps) {
  const tasks = useTodoStore((s) => s.tasks);
  const milestones = useTodoStore((s) => s.milestones);
  const selectedDateKey = useTodoStore((s) => s.selectedDateKey);
  const addTask = useTodoStore((s) => s.addTask);
  const createDrawerOpen = useTodoStore((s) => s.createDrawerOpen);
  const setCreateDrawerOpen = useTodoStore((s) => s.setCreateDrawerOpen);
  const setEditingTaskId = useTodoStore((s) => s.setEditingTaskId);
  const activeView = useTodoStore((s) => s.activeView);
  const selectedWeekKey = useTodoStore((s) => s.selectedWeekKey);
  const selectedMonthKey = useTodoStore((s) => s.selectedMonthKey);
  // In the store so the global "A" shortcut can open it from any view
  const isSmartDumpOpen = useTodoStore((s) => s.smartDumpOpen);
  const setIsSmartDumpOpen = useTodoStore((s) => s.setSmartDumpOpen);

  // Single-line Quick Input State
  const [quickInput, setQuickInput] = useState('');
  const quickInputRef = useRef<HTMLInputElement>(null);
  const quickInputId = useId();

  // Quick Controls State for Transparent Task Placement
  const [quickTarget, setQuickTarget] = useState<'today' | 'tomorrow' | 'week' | 'month' | 'custom'>(() => {
    if (defaultHorizon === 'week') return 'week';
    if (defaultHorizon === 'month') return 'month';
    return 'today';
  });
  const [quickCustomDate, setQuickCustomDate] = useState('');
  const [quickTime, setQuickTime] = useState('');
  const [quickRecurrence, setQuickRecurrence] = useState<RecurrencePattern>('none');
  const [quickRecurrenceDays, setQuickRecurrenceDays] = useState<number[]>([]);
  const [recentlyAddedFeedback, setRecentlyAddedFeedback] = useState<{
    title: string;
    targetText: string;
    id: string;
  } | null>(null);

  // AI Smart Dump Modal State
  const [smartDumpText, setSmartDumpText] = useState('');
  const [isParsingDump, setIsParsingDump] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<
    {
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
    }[]
  >([]);

  // Slide-Over Drawer Form Field State
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [horizon, setHorizon] = useState<TaskHorizon>(() => defaultHorizon || 'day');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [scheduledDate, setScheduledDate] = useState<string | null>(() => {
    return (defaultHorizon || 'day') === 'day' ? selectedDateKey || getTodayKey() : null;
  });
  const [scheduledTime, setScheduledTime] = useState<string>('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(25);
  const [recurrence, setRecurrence] = useState<RecurrencePattern>('none');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [isMIT, setIsMIT] = useState<boolean>(false);
  const [tags, setTags] = useState<string[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [isGeneratingSubtasks, setIsGeneratingSubtasks] = useState(false);

  // Drawer helper inputs
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const drawerTitleInputRef = useRef<HTMLInputElement>(null);

  const todayKey = getTodayKey();
  const tomorrowKey = shiftDateKey(todayKey, 1);

  // Compute upcoming 7 days availability (including Work vs Gaming/Leisure & Daily Fixed Routines)
  const upcomingDaysLoad = (() => {
    const dayNames = getNames('dayNames');
    const shortNames = getNames('dayShort');
    const [y, m, d] = todayKey.split('-').map(Number);
    const base = new Date(y, (m || 1) - 1, d || 1);
    const result: {
      dateKey: string;
      dayName: string;
      shortName: string;
      dayNumber: number;
      plannedMinutes: number;
      workMinutes: number;
      leisureMinutes: number;
      routineMinutes: number;
      taskCount: number;
    }[] = [];

    for (let offset = 0; offset < 7; offset++) {
      const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const summary = computeDayWorkload(tasks, key);
      result.push({
        dateKey: key,
        dayName: dayNames[dt.getDay()],
        shortName: shortNames[dt.getDay()],
        dayNumber: dt.getDate(),
        plannedMinutes: summary.plannedMinutes,
        workMinutes: summary.workMinutes,
        leisureMinutes: summary.leisureMinutes,
        routineMinutes: summary.routineMinutes,
        taskCount: summary.taskCount,
      });
    }
    return result;
  })();

  // Week / month pools follow the week or month being viewed
  const poolWeekKey = defaultHorizon === 'week' ? selectedWeekKey : getCurrentWeekKey();
  const poolMonthKey = defaultHorizon === 'month' ? selectedMonthKey : getCurrentMonthKey();

  // Quick-add target follows the view: week/month pool, or the day being viewed
  useEffect(() => {
    if (defaultHorizon === 'week') {
      setQuickTarget('week');
    } else if (defaultHorizon === 'month') {
      setQuickTarget('month');
    } else if (activeView === 'day' && selectedDateKey && selectedDateKey !== getTodayKey()) {
      setQuickTarget('custom');
      setQuickCustomDate(selectedDateKey);
    } else {
      setQuickTarget('today');
    }
  }, [defaultHorizon, activeView, selectedDateKey]);

  // Sync default horizon when parent prop or selectedDateKey changes
  useEffect(() => {
    if (defaultHorizon) {
      setHorizon(defaultHorizon);
      if (defaultHorizon === 'day') {
        setScheduledDate(selectedDateKey || getTodayKey());
      } else {
        setScheduledDate(null);
      }
    }
  }, [defaultHorizon, selectedDateKey]);

  // Global 'n' / 'N' hotkey to open full slide-over creation drawer
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
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
      // Do not open another panel on top of an open dialog
      if (document.querySelector('[role="dialog"]')) {
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setCreateDrawerOpen(true);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setIsSmartDumpOpen(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setCreateDrawerOpen, setIsSmartDumpOpen]);

  // When drawer opens, focus title input after slight delay for animation
  useEffect(() => {
    if (createDrawerOpen) {
      const timer = setTimeout(() => {
        drawerTitleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [createDrawerOpen]);

  // Auto-dismiss recently added feedback toast after 6 seconds
  useEffect(() => {
    if (recentlyAddedFeedback) {
      const timer = setTimeout(() => {
        setRecentlyAddedFeedback(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [recentlyAddedFeedback]);

  // Where a quick-add goes: an @token in the text (@yarın, @2026-10-25, @gelecekhafta...)
  // wins over the target buttons. Shared by the submit handler and the live preview.
  const resolveQuickTarget = (text: string) => {
    const parsed = parseQuickTaskInput(text);
    const dayLabel = (d: string) => (d === todayKey ? tt('Today', 'Bugün') : d === tomorrowKey ? tt('Tomorrow', 'Yarın') : d);

    if (hasExplicitHorizonToken(text)) {
      const label =
        parsed.horizon === 'week'
          ? parsed.weekKey && parsed.weekKey !== getCurrentWeekKey()
            ? `${tt('Weekly pool', 'Haftalık Havuz')} (${parsed.weekKey})`
            : tt('Weekly pool', 'Haftalık Havuz')
          : parsed.horizon === 'month'
          ? tt('Monthly pool', 'Aylık Havuz')
          : dayLabel(parsed.scheduledDate || todayKey);
      return {
        parsed,
        horizon: parsed.horizon,
        date: parsed.scheduledDate,
        weekKey: parsed.weekKey as string | null | undefined,
        monthKey: parsed.monthKey as string | null | undefined,
        label,
      };
    }

    const base = {
      parsed,
      weekKey: undefined as string | null | undefined,
      monthKey: undefined as string | null | undefined,
    };
    if (quickTarget === 'tomorrow') return { ...base, horizon: 'day' as TaskHorizon, date: tomorrowKey, label: tt('Tomorrow', 'Yarın') };
    if (quickTarget === 'custom') {
      const d = quickCustomDate || todayKey;
      return { ...base, horizon: 'day' as TaskHorizon, date: d, label: dayLabel(d) };
    }
    if (quickTarget === 'week') {
      return {
        ...base,
        weekKey: poolWeekKey,
        monthKey: undefined,
        horizon: 'week' as TaskHorizon,
        date: null,
        label:
          poolWeekKey === getCurrentWeekKey()
            ? tt('Weekly pool', 'Haftalık Havuz')
            : `${tt('Weekly pool', 'Haftalık Havuz')} (${formatWeekRangeLabel(poolWeekKey)})`,
      };
    }
    if (quickTarget === 'month') {
      return {
        ...base,
        weekKey: null,
        monthKey: poolMonthKey,
        horizon: 'month' as TaskHorizon,
        date: null,
        label:
          poolMonthKey === getCurrentMonthKey()
            ? tt('Monthly pool', 'Aylık Havuz')
            : `${tt('Monthly pool', 'Aylık Havuz')} (${formatMonthLabel(poolMonthKey)})`,
      };
    }
    return { ...base, horizon: 'day' as TaskHorizon, date: todayKey, label: tt('Today', 'Bugün') };
  };

  const resolveQuickRecurrence = (parsed: ReturnType<typeof parseQuickTaskInput>) => {
    const recurrence = quickRecurrence !== 'none' ? quickRecurrence : parsed.recurrence;
    const recurrenceDays =
      recurrence === 'custom_days'
        ? quickRecurrenceDays.length > 0
          ? quickRecurrenceDays
          : parsed.recurrenceDays || [1, 4]
        : undefined;
    return { recurrence, recurrenceDays };
  };

  // 1. Single-Line Quick Add Submit (with transparent destination & time controls)
  const handleSubmitQuick = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = quickInput.trim();
    if (!trimmed) return;

    const target = resolveQuickTarget(trimmed);
    const parsed = target.parsed;
    const effectiveHorizon = target.horizon;
    const effectiveDate = target.date;
    const targetLabel = target.label;

    const effectiveTime = quickTime || parsed.scheduledTime || null;
    const { recurrence: effectiveRecurrence, recurrenceDays: effectiveRecurrenceDays } =
      resolveQuickRecurrence(parsed);

    let cleanTitle = parsed.title;
    if (effectiveTime && !cleanTitle.startsWith(effectiveTime) && !/^\d{1,2}[:.]\d{2}/.test(cleanTitle)) {
      cleanTitle = `${effectiveTime} | ${cleanTitle}`;
    }

    const created = addTask({
      title: cleanTitle,
      horizon: effectiveHorizon,
      scheduledDate: effectiveDate,
      scheduledTime: effectiveTime,
      ...(target.weekKey !== undefined ? { weekKey: target.weekKey } : {}),
      ...(target.monthKey !== undefined ? { monthKey: target.monthKey } : {}),
      recurrence: effectiveRecurrence,
      recurrenceDays: effectiveRecurrenceDays,
      priority: parsed.priority,
      estimatedMinutes: parsed.estimatedMinutes,
      tags: parsed.tags,
    });

    const recurrenceLabel = formatRecurrenceLabel({
      recurrence: effectiveRecurrence,
      recurrenceDays: effectiveRecurrenceDays,
    });
    setRecentlyAddedFeedback({
      title: cleanTitle,
      targetText: `${targetLabel}${effectiveTime ? ` · ${effectiveTime}` : ''}${
        recurrenceLabel ? ` · ${recurrenceLabel}` : ''
      }`,
      id: created.id,
    });

    setQuickInput('');
    setQuickTime('');

    // Auto-hide feedback toast after 4.5 seconds
    setTimeout(() => {
      setRecentlyAddedFeedback((prev) => (prev?.id === created.id ? null : prev));
    }, 4500);
  };

  // 2. AI Smart Dump Handler (Ollama Gemma 4:12b)
  const handleParseSmartDump = async () => {
    const trimmed = smartDumpText.trim();
    if (!trimmed || isParsingDump) return;

    setIsParsingDump(true);
    try {
      const context = {
        todayKey: getTodayKey(),
        tomorrowKey: shiftDateKey(getTodayKey(), 1),
        currentWeekKey: getCurrentWeekKey(),
        currentMonthKey: getCurrentMonthKey(),
        dayLoads: upcomingDaysLoad,
      };
      const res = await parseSmartDumpWithAI(trimmed, context);
      if (res && Array.isArray(res.tasks) && res.tasks.length > 0) {
        setParsedTasks(res.tasks);
      }
    } catch (err) {
      console.error('Failed to parse smart dump with AI:', err);
    } finally {
      setIsParsingDump(false);
    }
  };

  const handleAddAllParsedTasks = () => {
    if (parsedTasks.length === 0) return;
    const currWeek = getCurrentWeekKey();
    const currMonth = getCurrentMonthKey();

    for (const t of [...parsedTasks].reverse()) {
      const resolvedScheduledDate = t.horizon === 'day' ? t.scheduledDate || todayKey : null;
      const resolvedWeekKey =
        t.horizon === 'day' && resolvedScheduledDate
          ? getWeekKeyFromDateKey(resolvedScheduledDate)
          : t.horizon === 'week'
          ? currWeek
          : null;
      const resolvedMonthKey =
        t.horizon === 'day' && resolvedScheduledDate
          ? getMonthKeyFromDateKey(resolvedScheduledDate)
          : t.horizon === 'week' || t.horizon === 'month'
          ? currMonth
          : null;

      addTask({
        title: t.title,
        horizon: t.horizon,
        scheduledDate: resolvedScheduledDate,
        scheduledTime: t.scheduledTime || null,
        recurrence: t.recurrence || 'none',
        recurrenceDays: t.recurrenceDays,
        weekKey: resolvedWeekKey,
        monthKey: resolvedMonthKey,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes,
        tags: t.tags,
        notes: '',
        subtasks: [],
        milestoneId: null,
        isMIT: false,
      });
    }
    setParsedTasks([]);
    setSmartDumpText('');
    setIsSmartDumpOpen(false);
  };

  // 3. AI Subtask Breakdown in Slide-Over Drawer
  const handleGenerateSubtasksAI = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isGeneratingSubtasks) return;

    setIsGeneratingSubtasks(true);
    try {
      const result = await generateSubtasksWithAI(trimmedTitle, notes);
      if (result && Array.isArray(result.subtasks) && result.subtasks.length > 0) {
        const generated: Subtask[] = result.subtasks.map((stTitle) => ({
          id: generateSubtaskId(),
          title: stTitle,
          completed: false,
        }));
        setSubtasks((prev) => [...prev, ...generated]);
        if (result.estimatedMinutes) {
          setEstimatedMinutes(result.estimatedMinutes);
        }
        if (result.priority) {
          setPriority(result.priority);
        }
      }
    } catch (err) {
      console.error('Failed to generate subtasks with AI:', err);
    } finally {
      setIsGeneratingSubtasks(false);
    }
  };

  // Drawer Field Handlers
  const handleDateChange = (newDateStr: string | null) => {
    if (!newDateStr) {
      setScheduledDate(null);
      return;
    }
    setScheduledDate(newDateStr);
    setHorizon('day');
  };

  const handleHorizonChange = (newHorizon: TaskHorizon) => {
    setHorizon(newHorizon);
    if (newHorizon === 'day') {
      if (!scheduledDate) {
        setScheduledDate(todayKey);
      }
    } else {
      setScheduledDate(null);
    }
  };

  const handleAddSubtask = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    setSubtasks((prev) => [
      ...prev,
      { id: generateSubtaskId(), title: trimmed, completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks((prev) =>
      prev.map((st) => (st.id === id ? { ...st, completed: !st.completed } : st))
    );
  };

  const handleDeleteSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((st) => st.id !== id));
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const resetForm = () => {
    setTitle('');
    setNotes('');
    setHorizon(defaultHorizon || 'day');
    setPriority('medium');
    setScheduledDate((defaultHorizon || 'day') === 'day' ? selectedDateKey || todayKey : null);
    setScheduledTime('');
    setEstimatedMinutes(25);
    setRecurrence('none');
    setRecurrenceDays([]);
    setMilestoneId(null);
    setIsMIT(false);
    setTags([]);
    setSubtasks([]);
    setNewSubtaskTitle('');
  };

  const handleDrawerSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const effectiveHorizon: TaskHorizon =
      recurrence === 'daily' || recurrence === 'custom_days' ? 'day' : horizon;
    let finalScheduledDate = scheduledDate;
    let weekKey: string | null = null;
    let monthKey: string | null = null;

    if (effectiveHorizon === 'day') {
      finalScheduledDate = scheduledDate || selectedDateKey || todayKey;
      weekKey = getWeekKeyFromDateKey(finalScheduledDate);
      monthKey = getMonthKeyFromDateKey(finalScheduledDate);
    } else if (effectiveHorizon === 'week') {
      if (scheduledDate) {
        weekKey = getWeekKeyFromDateKey(scheduledDate);
        monthKey = getMonthKeyFromDateKey(scheduledDate);
      } else {
        weekKey = poolWeekKey;
        monthKey = poolMonthKey;
      }
    } else if (effectiveHorizon === 'month') {
      if (scheduledDate) {
        monthKey = getMonthKeyFromDateKey(scheduledDate);
      } else {
        monthKey = poolMonthKey;
      }
    } else if (effectiveHorizon === 'backlog') {
      finalScheduledDate = null;
      weekKey = null;
      monthKey = null;
    }

    let finalTitle = trimmedTitle;
    if (scheduledTime && !finalTitle.startsWith(scheduledTime) && !/^\d{1,2}[:.]\d{2}/.test(finalTitle)) {
      finalTitle = `${scheduledTime} | ${finalTitle}`;
    }

    addTask({
      title: finalTitle,
      notes,
      horizon: effectiveHorizon,
      priority,
      scheduledDate: finalScheduledDate,
      scheduledTime: scheduledTime || null,
      weekKey,
      monthKey,
      estimatedMinutes,
      recurrence,
      recurrenceDays: recurrence === 'custom_days' ? recurrenceDays : undefined,
      milestoneId: milestoneId || null,
      isMIT: effectiveHorizon === 'day' ? isMIT : false,
      subtasks,
      tags,
    });

    resetForm();
    setCreateDrawerOpen(false);
    quickInputRef.current?.focus();
  };

  const subtasksTotal = subtasks.length;
  const subtasksCompleted = subtasks.filter((st) => st.completed).length;

  const [quickFocused, setQuickFocused] = useState(false);
  const showQuickOptions = quickFocused || quickInput.trim().length > 0;

  return (
    <div className={cn('w-full space-y-2', className)}>
      {/* ─────────────────────────────────────────────────────────────
          0. CONFIRMATION FEEDBACK TOAST (Transparent Task Destination)
         ───────────────────────────────────────────────────────────── */}
      {recentlyAddedFeedback && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-stone-900 text-stone-50 text-xs shadow-md border border-stone-800 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="truncate flex items-center gap-1.5 flex-wrap">
              <span className="text-stone-300">{tt('Task added:', 'Görev Eklendi:')}</span>
              <span className="font-semibold text-white">"{recentlyAddedFeedback.title}"</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-800 text-xs text-stone-200 border border-stone-700/80">
                {recentlyAddedFeedback.targetText}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingTaskId(recentlyAddedFeedback.id);
                setRecentlyAddedFeedback(null);
              }}
              className="text-xs underline text-stone-300 hover:text-white cursor-pointer"
            >
              {tt('View / edit', 'Görüntüle / Düzenle')}
            </button>
            <button
              type="button"
              onClick={() => setRecentlyAddedFeedback(null)}
              className="p-1 text-stone-400 hover:text-stone-200 rounded cursor-pointer"
              title={tt('Close', 'Kapat')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          1. SLEEK, TRANSPARENT QUICK ADD BAR WITH EXPLICIT DESTINATION & TIME
         ───────────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmitQuick}
        onFocus={() => setQuickFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setQuickFocused(false);
        }}
        className="bg-white border border-stone-200/90 rounded-xl px-3 py-2.5 sm:px-4 shadow-2xs flex flex-col gap-3 focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400/20 transition-all"
      >
        {/* Main Input Line */}
        <div className="flex items-center gap-2">
          <label htmlFor={quickInputId} className="sr-only">
            {tt('New task', 'Yeni Görev')}
          </label>
          <input
            id={quickInputId}
            ref={quickInputRef}
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder={tt('Add a task… (e.g. 14:00 team call #work)', 'Yeni görev ekle… (örn. 14:00 ekip toplantısı #iş)')}
            className="flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none py-1.5 min-w-0"
            autoComplete="off"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!quickInput.trim()}
            className="text-sm h-9 px-4 shrink-0"
          >
            {tt('Add', 'Ekle')}
          </Button>
        </div>

        {/* Options: only while the box is in use */}
        {showQuickOptions && (
          <div className="flex items-center gap-2 flex-wrap border-t border-stone-100 pt-3 text-xs">
            {/* Target Buttons */}
            <div className="flex items-center gap-1 bg-stone-100/90 p-0.5 rounded-lg border border-stone-200/50">
              {(
                [
                  ['today', tt('Today', 'Bugün')],
                  ['tomorrow', tt('Tomorrow', 'Yarın')],
                  ['week', tt('This week', 'Bu hafta')],
                  ['month', tt('This month', 'Bu ay')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQuickTarget(value)}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer',
                    quickTarget === value
                      ? 'bg-stone-900 text-stone-50 shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Custom Date Input */}
            <input
              type="date"
              value={quickCustomDate}
              onChange={(e) => {
                setQuickCustomDate(e.target.value);
                if (e.target.value) setQuickTarget('custom');
              }}
              className={cn(
                'px-2 py-1 rounded-md border transition-colors',
                quickTarget === 'custom'
                  ? 'border-stone-900 bg-stone-900 text-stone-50'
                  : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
              )}
              title={tt('Pick another date', 'Farklı bir tarih seç')}
            />

            {/* Time */}
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200/80 px-2 py-1 rounded-md">
              <Clock className="h-3.5 w-3.5 text-stone-400 shrink-0" />
              <input
                type="time"
                value={quickTime}
                onChange={(e) => setQuickTime(e.target.value)}
                className="bg-transparent text-stone-800 focus:outline-none w-[4.5rem]"
                title={tt('Set a time', 'Saat belirle')}
              />
              {quickTime && (
                <button
                  type="button"
                  onClick={() => setQuickTime('')}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  title={tt('Clear time', 'Saati temizle')}
                >
                  ×
                </button>
              )}
            </div>

            {/* Recurrence */}
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200/80 px-2 py-1 rounded-md">
              <Repeat className="h-3.5 w-3.5 text-stone-400 shrink-0" />
              <select
                value={quickRecurrence}
                onChange={(e) => {
                  const val = e.target.value as RecurrencePattern;
                  setQuickRecurrence(val);
                  if (val === 'custom_days' && quickRecurrenceDays.length === 0) {
                    setQuickRecurrenceDays([1, 4]); // default Mon & Thu
                  }
                }}
                className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
              >
                <option value="none">{tt('No repeat', 'Tekrarsız')}</option>
                <option value="daily">{tt('Every day', 'Her Gün')}</option>
                <option value="custom_days">{tt('Mon & Thu', 'Pzt & Per')}</option>
                <option value="weekly">{tt('Every week', 'Her Hafta')}</option>
                <option value="monthly">{tt('Every month', 'Her Ay')}</option>
              </select>
            </div>

            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => setIsSmartDumpOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                title={tt('Turn free text into several tasks with AI (shortcut: A)', 'Serbest metni AI ile birden çok göreve dönüştür (Kısayol: A)')}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {tt('Add many', 'Çoklu ekle')}
              </button>
              <button
                type="button"
                onClick={() => setCreateDrawerOpen(true)}
                className="px-2.5 py-1 rounded-md text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                title={tt('Open all details (shortcut: N)', 'Tüm detayları aç (Kısayol: N)')}
              >
                {tt('Full form', 'Detaylı form')}
              </button>
            </div>
          </div>
        )}

        {/* Live Destination Indicator Preview */}
        {quickInput.trim().length > 0 &&
          (() => {
            const preview = resolveQuickTarget(quickInput.trim());
            const previewTime = quickTime || preview.parsed.scheduledTime;
            const previewRecurrence = formatRecurrenceLabel(resolveQuickRecurrence(preview.parsed));
            return (
              <div className="text-xs text-stone-500">
                Eklenecek yer:{' '}
                <span className="font-medium text-stone-800">
                  {preview.date ? `${preview.label} (${preview.date})` : preview.label}
                </span>
                {previewTime && <> · {previewTime}</>}
                {previewRecurrence && <> · {previewRecurrence}</>}
              </div>
            );
          })()}
      </form>

      {/* ─────────────────────────────────────────────────────────────
          2. AI SMART DUMP MODAL (Dialog)
         ───────────────────────────────────────────────────────────── */}
      <Dialog open={isSmartDumpOpen} onOpenChange={setIsSmartDumpOpen}>
        <DialogContent className="max-w-2xl bg-[#FAF9F5] text-stone-900 border border-stone-200 p-0 shadow-2xl rounded-2xl flex flex-col overflow-hidden max-h-[85vh]">
          <DialogHeader className="px-6 pt-5 pb-4 pr-12 border-b border-stone-200 bg-white/70">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800 shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-stone-900">
                  {tt('AI brain dump (Gemma 4)', 'AI Akıllı Görev Dökümü (Gemma 4)')}
                </DialogTitle>
                <DialogDescription className="text-xs text-stone-500">
                  {tt('Write down everything on your mind; Gemma 4 splits it into tasks, counts, weekly/monthly horizons and priorities.', 'Aklınızdaki her şeyi serbestçe yazın; Gemma 4 görevleri, adetleri, haftalık/aylık ufku ve öncelikleri otomatik ayırsın.')}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            {/* Free-form Textarea */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-stone-700">
                  {tt('Free text / daily or weekly note', 'Serbest Metin / Günlük veya Haftalık Not')}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSmartDumpText(
                      tt(
                        'Publish 3 blog posts this week, call the plumber tomorrow morning, renew the gym membership this month',
                        'Bu hafta 3 blog yazısı yayınlanacak, yarın sabah tesisatçıyı ara, bu ay spor salonu üyeliğini yenile'
                      )
                    )
                  }
                  className="text-xs text-stone-500 hover:text-stone-900 underline cursor-pointer"
                >
                  {tt('Fill in an example', 'Örnek metin doldur')}
                </button>
              </div>
              <textarea
                rows={4}
                value={smartDumpText}
                onChange={(e) => setSmartDumpText(e.target.value)}
                placeholder={tt('e.g. Publish 3 blog posts this week, call the plumber tomorrow morning...', 'Örn: Bu hafta 3 blog yazısı yayınlanacak, yarın sabah tesisatçıyı ara...')}
                className="w-full rounded-xl border border-stone-200 bg-white p-3.5 text-sm text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none transition-colors"
              />
            </div>

            {/* Parse Trigger Button */}
            <div className="flex items-center justify-between gap-3">
              {isParsingDump ? (
                <span className="text-xs text-stone-500">
                  {tt('Local Gemma 4 (12B) is checking your free days and spreading the tasks (~2-4 s)...', 'Yerel Gemma 4 (12B) müsait günlerinizi analiz edip görevleri dağıtıyor (~2-4 sn)...')}
                </span>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="primary"
                onClick={handleParseSmartDump}
                disabled={!smartDumpText.trim() || isParsingDump}
                className="text-xs h-9 px-4 gap-2 font-medium bg-stone-900 hover:bg-stone-800 text-stone-50"
              >
                {isParsingDump ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-300" />
                    <span>{tt('Gemma 4 is planning...', 'Gemma 4 Planlıyor...')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 text-stone-200" />
                    <span>{tt('Plan on free days with Gemma 4', 'Gemma 4 ile Müsait Günlere Planla')}</span>
                  </>
                )}
              </Button>
            </div>

            {/* 7-Day Availability Strip */}
            <div className="rounded-xl border border-stone-200/80 bg-white/60 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>{tt('7-DAY WORK / LEISURE & ROUTINE LOAD', '7 GÜNLÜK İŞ / OYUN & RUTİN DURUMU')}</span>
                <span>{tt('Green = free for work (little work / leisure or empty day)', 'Yeşil = İş için müsait (İş az / Oyun veya boş gün)')}</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {upcomingDaysLoad.map((d) => {
                  const isWorkFree = d.workMinutes <= 30;
                  return (
                    <div
                      key={d.dateKey}
                      className="flex flex-col items-center justify-center rounded-lg border border-stone-200/70 bg-white px-1 py-1.5 text-center"
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            isWorkFree ? 'bg-emerald-500' : 'bg-amber-500'
                          )}
                        />
                        <span className="text-xs font-semibold text-stone-800">
                          {d.shortName} {d.dayNumber}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500">
                        {tt('Work:', 'İş:')} {formatMinutes(d.workMinutes)}
                      </span>
                      {d.leisureMinutes > 0 && (
                        <span className="text-xs text-stone-400">
                          {tt('Leisure', 'Keyif')} {formatMinutes(d.leisureMinutes)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Extracted Tasks Preview */}
            {parsedTasks.length > 0 && (
              <div className="space-y-3 pt-3 border-t border-stone-200/80">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="text-xs font-semibold text-stone-800">
                    {tt(`Suggested plan (${parsedTasks.length} tasks)`, `Önerilen Plan (${parsedTasks.length} Görev)`)}
                  </span>
                  <span className="text-xs text-stone-500">
                    {tt('Change the suggested day with one click on the day buttons below', 'Önerilen günü alttaki gün düğmeleriyle 1 tıkla değiştirebilirsiniz')}
                  </span>
                </div>

                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {parsedTasks.map((task, idx) => {
                    const horizonLabels: Record<TaskHorizon, string> = {
                      day: tt('DAY', 'GÜNÜM'),
                      week: tt('WEEK', 'HAFTAM'),
                      month: tt('MONTH', 'AYIM'),
                      backlog: tt('POOL', 'HAVUZ'),
                    };
                    const priorityLabels: Record<TaskPriority, string> = {
                      urgent: tt('Urgent', 'Acil'),
                      high: tt('High', 'Yüksek'),
                      medium: tt('Medium', 'Orta'),
                      low: tt('Low', 'Düşük'),
                    };
                    const matchedDay = upcomingDaysLoad.find(
                      (d) => d.dateKey === task.scheduledDate
                    );

                    return (
                      <div
                        key={idx}
                        className="flex flex-col gap-2 p-3 rounded-xl border border-stone-200 bg-white/90 shadow-2xs text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-stone-900 leading-snug break-words">
                                {task.title}
                              </p>
                              {task.suggestedReason && (
                                <span className="inline-flex items-center gap-1 text-xs text-stone-700 bg-stone-100 border border-stone-200/80 px-2 py-0.5 rounded-full">
                                  {task.suggestedReason}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="horizon">{horizonLabels[task.horizon]}</Badge>
                              {task.scheduledDate && (
                                <span className="text-xs font-medium text-stone-800 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                                                                    {matchedDay
                                    ? `${matchedDay.dayName} (${matchedDay.dayNumber})`
                                    : task.scheduledDate}
                                </span>
                              )}
                              {task.scheduledTime && (
                                <span className="text-xs font-semibold text-stone-900 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
                                  {task.scheduledTime}
                                </span>
                              )}
                              {task.recurrence && task.recurrence !== 'none' && (
                                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  {formatRecurrenceLabel({ recurrence: task.recurrence, recurrenceDays: task.recurrenceDays })}
                                </span>
                              )}
                              <Badge variant={task.priority}>{priorityLabels[task.priority]}</Badge>
                              <span className="text-xs text-stone-500">
                                {task.estimatedMinutes} dk
                              </span>
                              <ColoredTags tags={task.tags} />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setParsedTasks((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-stone-400 hover:text-rose-600 p-1.5 rounded transition-colors cursor-pointer shrink-0"
                            title={tt('Remove from list', 'Listeden çıkar')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* 1-Click Day / Pool Switcher Pills */}
                        <div className="flex items-center gap-1 flex-wrap pt-1.5 border-t border-stone-100">
                          <span className="text-xs text-stone-400 mr-1">
                            {tt('Pick a day:', 'Gün Seç:')}
                          </span>
                          {upcomingDaysLoad.map((d) => {
                            const isSelected =
                              task.horizon === 'day' && task.scheduledDate === d.dateKey;
                            return (
                              <button
                                key={d.dateKey}
                                type="button"
                                onClick={() =>
                                  setParsedTasks((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            horizon: 'day',
                                            scheduledDate: d.dateKey,
                                            suggestedReason: tt(`${d.dayName} chosen`, `${d.dayName} seçildi`),
                                          }
                                        : item
                                    )
                                  )
                                }
                                className={cn(
                                  'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer',
                                  isSelected
                                    ? 'bg-stone-900 text-stone-50 border-stone-900 font-semibold'
                                    : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100 hover:text-stone-900'
                                )}
                                title={tt(`${d.dayName} (${d.plannedMinutes} min already planned)`, `${d.dayName} (${d.plannedMinutes} dk mevcut yük)`)}
                              >
                                {d.shortName} {d.dayNumber}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() =>
                              setParsedTasks((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        horizon: 'week',
                                        scheduledDate: null,
                                        suggestedReason: tt('Will wait in the weekly pool', 'Haftalık havuzda bekletilecek'),
                                      }
                                    : item
                                )
                              )
                            }
                            className={cn(
                              'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer ml-auto',
                              task.horizon === 'week' && !task.scheduledDate
                                ? 'bg-stone-900 text-stone-50 border-stone-900 font-semibold'
                                : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                            )}
                          >
                            {tt('Weekly pool', 'Haftalık Havuz')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setParsedTasks((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        horizon: 'month',
                                        scheduledDate: null,
                                        suggestedReason: tt('Will wait in the monthly pool', 'Aylık havuzda bekletilecek'),
                                      }
                                    : item
                                )
                              )
                            }
                            className={cn(
                              'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer',
                              task.horizon === 'month' && !task.scheduledDate
                                ? 'bg-stone-900 text-stone-50 border-stone-900 font-semibold'
                                : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                            )}
                          >
                            {tt('Monthly pool', 'Aylık Havuz')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-white/70">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsSmartDumpOpen(false);
                setSmartDumpText('');
                setParsedTasks([]);
              }}
              className="text-xs text-stone-500 hover:text-stone-900"
            >
              {tt('Close', 'Kapat')}
            </Button>

            {parsedTasks.length > 0 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleAddAllParsedTasks}
                className="text-xs font-medium h-8 px-4 gap-1.5 bg-stone-900 hover:bg-stone-800 text-stone-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tt(`Add all (${parsedTasks.length} tasks)`, `Tümünü Ekle (${parsedTasks.length} Görev)`)}</span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          3. SLIDE-OVER "NEW TASK" DRAWER (Matching TaskDetailDrawer)
         ───────────────────────────────────────────────────────────── */}
      <Dialog open={createDrawerOpen} onOpenChange={setCreateDrawerOpen}>
        <DialogContent className="fixed inset-y-0 right-0 left-auto top-0 translate-x-0 translate-y-0 h-full w-full max-w-xl bg-[#FAF9F5] text-stone-900 border-l border-stone-200 border-t-0 border-r-0 border-b-0 p-0 shadow-2xl rounded-none flex flex-col overflow-hidden duration-300">
          <DialogHeader className="sr-only">
            <DialogTitle>{tt('Create new task', 'Yeni Görev Oluştur')}</DialogTitle>
            <DialogDescription>
              {tt('Set up the task\'s properties, subtasks, horizon and notes', 'Görev özelliklerini, alt görevlerini, zaman ufuklarını ve notlarını yapılandırın')}
            </DialogDescription>
          </DialogHeader>

          {/* Top Action Bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-white/70">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-stone-600 flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-stone-800" />
                {tt('New task', 'Yeni Görev')}
              </span>

              {/* MIT Star Toggle */}
              <button
                type="button"
                onClick={() => setIsMIT((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-all cursor-pointer',
                  isMIT
                    ? 'bg-stone-900 text-[#FAF9F5] font-semibold border-stone-900 shadow-xs'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300 hover:text-stone-900'
                )}
                title={tt('Add to / remove from the day\'s 3 most important tasks (MIT)', 'Günün En Önemli 3 İşi (MIT) arasına ekle / çıkar')}
              >
                <Star className={cn('h-3.5 w-3.5', isMIT ? 'fill-current' : '')} />
                <span>{isMIT ? 'MIT' : tt('Make MIT', 'MIT Yap')}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateDrawerOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
                title={tt('Close', 'Kapat')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            {/* Title Input */}
            <div className="space-y-1">
              <input
                ref={drawerTitleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tt('Task title', 'Görev Başlığı')}
                className="w-full text-lg sm:text-xl font-semibold tracking-tight bg-transparent text-stone-900 border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none transition-colors pb-1"
              />
              <p className="text-xs text-stone-400">
                {tt('Set the basics, subtasks and notes', 'Temel özellikleri, alt görevleri ve notları belirleyin')}
              </p>
            </div>

            {/* Core Properties Grid (2 Columns - Identical to TaskDetailDrawer) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-stone-200 bg-white/70">
              {/* Horizon */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Horizon', 'Zaman Ufku')}
                </label>
                <select
                  value={horizon}
                  onChange={(e) => handleHorizonChange(e.target.value as TaskHorizon)}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
                >
                  <option value="day">{tt('Day (today\'s plan)', 'Günüm (Bugün Planı)')}</option>
                  <option value="week">{tt('Week (weekly pool)', 'Haftam (Haftalık Havuz)')}</option>
                  <option value="month">{tt('Month (monthly horizon)', 'Ayım (Aylık Ufuk)')}</option>
                  <option value="backlog">{tt('Backlog / pool', 'Bekleyen / Havuz')}</option>
                </select>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Priority', 'Öncelik')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
                >
                  <option value="urgent">{tt('Urgent (P1)', 'Acil (P1)')}</option>
                  <option value="high">{tt('High (P2)', 'Yüksek (P2)')}</option>
                  <option value="medium">{tt('Medium (P3)', 'Orta (P3)')}</option>
                  <option value="low">{tt('Low (P4)', 'Düşük (P4)')}</option>
                </select>
              </div>

              {/* Scheduled Date */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-stone-400" />
                  {recurrence === 'daily' ? tt('Planned date (start)', 'Planlanan Tarih (Başlangıç)') : tt('Planned date', 'Planlanan Tarih')}
                </label>
                <input
                  type="date"
                  value={scheduledDate || ''}
                  onChange={(e) => handleDateChange(e.target.value || null)}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
                />
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleDateChange(todayKey)}
                    className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
                  >
                    {tt('Today', 'Bugün')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDateChange(tomorrowKey)}
                    className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
                  >
                    {tt('Tomorrow', 'Yarın')}
                  </button>
                  {scheduledDate && recurrence !== 'daily' && recurrence !== 'custom_days' && (
                    <button
                      type="button"
                      onClick={() => handleDateChange(null)}
                      className="text-xs px-2 py-0.5 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors ml-auto cursor-pointer"
                    >
                      {tt('Remove', 'Kaldır')}
                    </button>
                  )}
                </div>
              </div>

              {/* Scheduled Time */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Time / time block', 'Saat / Zaman Bloğu')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
                  />
                  {scheduledTime && (
                    <button
                      type="button"
                      onClick={() => setScheduledTime('')}
                      className="text-xs px-2 py-1 rounded bg-stone-100 text-stone-500 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                    >
                      {tt('Remove', 'Kaldır')}
                    </button>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-1 pt-1">
                  {['10:00', '11:30', '12:00', '17:00', '18:30', '20:30', '22:00'].map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setScheduledTime(time)}
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                        scheduledTime === time
                          ? 'bg-stone-900 text-stone-50 font-semibold'
                          : 'bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200'
                      )}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated Minutes */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Estimated time', 'Tahmini Süre')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) =>
                      setEstimatedMinutes(Math.max(5, parseInt(e.target.value, 10) || 25))
                    }
                    className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
                  />
                  <span className="text-xs text-stone-400">{tt('min', 'dk')}</span>
                </div>
                <div className="flex items-center gap-1 pt-1">
                  {[15, 25, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setEstimatedMinutes(mins)}
                      className={cn(
                        'text-xs px-2 py-0.5 rounded transition-colors cursor-pointer',
                        estimatedMinutes === mins
                          ? 'bg-stone-900 text-stone-50 font-semibold'
                          : 'bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200'
                      )}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Monthly Milestone Link */}
              <div className="space-y-1.5">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Monthly milestone', 'Aylık Kilometre Taşı')}
                </label>
                <select
                  value={milestoneId || ''}
                  onChange={(e) => setMilestoneId(e.target.value || null)}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
                >
                  <option value="">{tt('None', 'Bağlantı Yok')}</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Recurrence (Full Span) */}
              <div className="space-y-1.5 sm:col-span-2 pt-1 border-t border-stone-100">
                <label className="text-xs text-stone-500 flex items-center gap-1.5">
                  <Repeat className="h-3.5 w-3.5 text-stone-400" />
                  {tt('Repeat', 'Tekrar Periyodu')}
                </label>
                <select
                  value={recurrence}
                  onChange={(e) => {
                    const nextRec = e.target.value as RecurrencePattern;
                    setRecurrence(nextRec);
                    if (nextRec === 'daily') {
                      setHorizon('day');
                      if (!scheduledDate) {
                        setScheduledDate(selectedDateKey || todayKey);
                      }
                    } else if (nextRec === 'custom_days') {
                      setHorizon('day');
                      if (!scheduledDate) {
                        setScheduledDate(selectedDateKey || todayKey);
                      }
                      if (recurrenceDays.length === 0) {
                        setRecurrenceDays([1, 4]); // default Mon & Thu
                      }
                    }
                  }}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
                >
                  <option value="none">{tt('Does not repeat', 'Tekrarlanmaz')}</option>
                  <option value="daily">{tt('Every day', 'Her Gün')}</option>
                  <option value="custom_days">{tt('Specific weekdays (e.g. Monday & Thursday)', 'Haftanın Belirli Günleri (Örn: Pazartesi & Perşembe)')}</option>
                  <option value="weekly">{tt('Every week (same day)', 'Her Hafta (Aynı Gün)')}</option>
                  <option value="monthly">{tt('Every month', 'Her Ay')}</option>
                </select>

                {recurrence === 'custom_days' && (
                  <div className="pt-2 p-3 rounded-lg border border-stone-200 bg-stone-50/70 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                      <span className="text-xs text-stone-600 font-semibold">
                        {tt('Repeat on:', 'Tekrarlanacak Günler:')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRecurrenceDays([1, 4])}
                          className="text-xs px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-600 hover:text-stone-900 cursor-pointer"
                        >
                          {tt('Mon & Thu', 'Pzt & Per')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRecurrenceDays([1, 2, 3, 4, 5])}
                          className="text-xs px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-600 hover:text-stone-900 cursor-pointer"
                        >
                          {tt('Weekdays', 'Hafta İçi')}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[
                        { id: 1, label: getNames('dayNames')[1] },
                        { id: 2, label: getNames('dayNames')[2] },
                        { id: 3, label: getNames('dayNames')[3] },
                        { id: 4, label: getNames('dayNames')[4] },
                        { id: 5, label: getNames('dayNames')[5] },
                        { id: 6, label: getNames('dayNames')[6] },
                        { id: 7, label: getNames('dayNames')[0] },
                      ].map((d) => {
                        const isSelected = recurrenceDays.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              const updated = isSelected
                                ? recurrenceDays.filter((x) => x !== d.id)
                                : [...recurrenceDays, d.id].sort();
                              setRecurrenceDays(updated);
                            }}
                            className={cn(
                              'text-xs px-2.5 py-1 rounded-md border transition-colors cursor-pointer',
                              isSelected
                                ? 'bg-stone-900 text-stone-50 border-stone-900 font-semibold'
                                : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                            )}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tags Section */}
            <TagEditor
              tags={tags}
              onAdd={(tag) => setTags((prev) => [...prev, tag])}
              onRemove={handleRemoveTag}
            />

            {/* Subtasks / Checklist with AI Breakdown Button */}
            <div className="space-y-3 p-4 rounded-xl border border-stone-200 bg-white/70">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-stone-500" />
                  <span className="text-xs font-semibold text-stone-800">{tt('Subtasks', 'Alt Görevler')}</span>
                  <span className="text-xs text-stone-400">
                    ({subtasksCompleted}/{subtasksTotal})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {subtasksTotal > 0 && (
                    <div className="w-20 hidden sm:block">
                      <ProgressBar
                        value={subtasksCompleted}
                        max={subtasksTotal}
                        className="h-1.5"
                      />
                    </div>
                  )}

                  {/* ✨ AI ile Alt Görevlere Böl Button */}
                  <button
                    type="button"
                    onClick={handleGenerateSubtasksAI}
                    disabled={isGeneratingSubtasks || !title.trim()}
                    className="flex items-center gap-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 border border-stone-200/80 px-2.5 py-1 rounded-md cursor-pointer transition-all duration-150 active:scale-[0.98]"
                    title={tt('Split the title into steps with Gemma 4', 'Gemma 4 ile başlığı alt adımlara böl')}
                  >
                    {isGeneratingSubtasks ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-stone-600" />
                        <span className="text-stone-600">{tt('Gemma 4 is thinking...', 'Gemma 4 düşünüyor...')}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        <span>{tt('Split into subtasks with AI', 'AI ile Alt Görevlere Böl')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {subtasks.length > 0 && (
                <div className="divide-y divide-stone-200/70">
                  {subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="group flex items-center justify-between gap-2.5 py-2 transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Checkbox
                          checked={st.completed}
                          onCheckedChange={() => handleToggleSubtask(st.id)}
                        />
                        <span
                          className={`truncate transition-colors ${
                            st.completed ? 'line-through text-stone-400' : 'text-stone-800'
                          }`}
                        >
                          {st.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSubtask(st.id)}
                        className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 p-1 rounded transition-opacity cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Subtask Input Form */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSubtask();
                    }
                  }}
                  placeholder={tt('Add a new subtask...', 'Yeni alt görev ekle...')}
                  className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!newSubtaskTitle.trim()}
                  onClick={handleAddSubtask}
                  className="text-xs h-8 gap-1 bg-stone-100 hover:bg-stone-200 border-stone-200 text-stone-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{tt('Add', 'Ekle')}</span>
                </Button>
              </div>
            </div>

            {/* Notes / Description */}
            <div className="space-y-2">
              <label
                htmlFor="drawer-task-notes-textarea"
                className="text-xs font-semibold text-stone-700 flex items-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-stone-400" />
                {tt('Notes & description', 'Notlar & Açıklama')}
              </label>
              <textarea
                id="drawer-task-notes-textarea"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tt('Add details, links or notes about the task here...', 'Görevle ilgili ayrıntıları, bağlantıları veya notları buraya ekleyin...')}
                className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-white/70">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetForm();
                setCreateDrawerOpen(false);
              }}
              className="text-xs h-8 text-stone-500 hover:text-stone-900"
            >
              <span>{tt('Cancel', 'Vazgeç')}</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!title.trim()}
                onClick={() => handleDrawerSubmit()}
                className="text-xs font-medium h-8 gap-1.5 px-4"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tt('Create task', 'Görevi Oluştur')}</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
