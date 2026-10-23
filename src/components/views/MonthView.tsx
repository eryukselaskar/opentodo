import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
  ArrowRight,
  Calendar,
  Sparkles,
  Loader2,
  GripVertical,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTodoStore } from '../../store/useTodoStore';
import { getTaskColorClass } from '../../lib/tags';
import { TaskMeta } from '../ui/tags';
import { formatMinutes, matchesTaskFilters, isDatedRoutine } from '../ui/taskUi';
import {
  formatMonthLabel,
  shiftMonthKey,
  getCurrentMonthKey,
  getMonthCalendarDays,
  getCurrentWeekKey,
  formatTurkishDate,
  getTodayKey,
  getTasksForDate,
  sortTasksByTimeAndStatus,
  splitTaskTimeAndTitle,
  getNames,
} from '../../lib/dateUtils';
import {
  cn,
  Checkbox,
  TooltipWrapper,
} from '../ui/primitives';
import { generateMilestoneTasksWithAI } from '../../lib/ollamaClient';
import { t as tt, pct } from '../../lib/i18n';


export function MonthView() {
  const {
    tasks,
    milestones,
    selectedMonthKey,
    searchQuery,
    selectedTagFilter,
    selectedPriorityFilter,
    addTask,
    addTaskFromRaw,
    deleteTask,
    toggleTaskDone,
    addMilestone,
    toggleMilestone,
    deleteMilestone,
    assignTaskToWeekPool,
    assignTaskToDay,
    assignTaskToMonthPool,
    setSelectedMonthKey,
    setSelectedDateKey,
    setActiveView,
    setEditingTaskId,
  } = useTodoStore(
    useShallow((s) => ({
      tasks: s.tasks,
      milestones: s.milestones,
      selectedMonthKey: s.selectedMonthKey,
      searchQuery: s.searchQuery,
      selectedTagFilter: s.selectedTagFilter,
      selectedPriorityFilter: s.selectedPriorityFilter,
      addTask: s.addTask,
      addTaskFromRaw: s.addTaskFromRaw,
      deleteTask: s.deleteTask,
      toggleTaskDone: s.toggleTaskDone,
      addMilestone: s.addMilestone,
      toggleMilestone: s.toggleMilestone,
      deleteMilestone: s.deleteMilestone,
      assignTaskToWeekPool: s.assignTaskToWeekPool,
      assignTaskToDay: s.assignTaskToDay,
      assignTaskToMonthPool: s.assignTaskToMonthPool,
      setSelectedMonthKey: s.setSelectedMonthKey,
      setSelectedDateKey: s.setSelectedDateKey,
      setActiveView: s.setActiveView,
      setEditingTaskId: s.setEditingTaskId,
    }))
  );
  const tagDefs = useTodoStore((s) => s.tagDefs);

  const [milestoneInput, setMilestoneInput] = useState('');
  const [monthTaskInput, setMonthTaskInput] = useState('');
  const [previewDayTaskInput, setPreviewDayTaskInput] = useState('');

  // Drag and Drop & AI generation state
  const [dragOverDateKey, setDragOverDateKey] = useState<string | null>(null);
  const [isDragOverMonthPool, setIsDragOverMonthPool] = useState(false);
  const [generatingMilestoneId, setGeneratingMilestoneId] = useState<string | null>(null);

  const handleGenerateMilestoneTasks = async (milestone: { id: string; title: string }) => {
    if (generatingMilestoneId) return;
    setGeneratingMilestoneId(milestone.id);
    try {
      const result = await generateMilestoneTasksWithAI(milestone.title);
      if (result && Array.isArray(result.tasks)) {
        result.tasks.forEach((gt) => {
          addTask({
            title: gt.title,
            horizon: 'month',
            monthKey: selectedMonthKey,
            milestoneId: milestone.id,
            estimatedMinutes: gt.estimatedMinutes,
            priority: gt.priority,
            scheduledDate: null,
          });
        });
      }
    } catch (error) {
      console.error('Failed to generate milestone tasks with AI:', error);
    } finally {
      setGeneratingMilestoneId(null);
    }
  };

  // Selected / preview day for inspector, defaulting to today or first day of selected month
  const [previewDateKey, setPreviewDateKey] = useState<string>(() => {
    const today = getTodayKey();
    return today.startsWith(selectedMonthKey) ? today : `${selectedMonthKey}-01`;
  });

  const currentMonthKey = getCurrentMonthKey();
  const isCurrentMonth = selectedMonthKey === currentMonthKey;

  // Month navigation handler updating month and preview date
  const handleShiftMonth = (delta: number) => {
    const nextMonth = shiftMonthKey(selectedMonthKey, delta);
    setSelectedMonthKey(nextMonth);
    const today = getTodayKey();
    if (today.startsWith(nextMonth)) {
      setPreviewDateKey(today);
    } else {
      setPreviewDateKey(`${nextMonth}-01`);
    }
  };

  const handleReturnToCurrentMonth = () => {
    setSelectedMonthKey(currentMonthKey);
    setPreviewDateKey(getTodayKey());
  };

  // Calendar cells for 7x5 or 7x6 grid
  const calendarCells = useMemo(() => {
    return getMonthCalendarDays(selectedMonthKey);
  }, [selectedMonthKey]);

  // Monthly Milestones for this month
  const monthMilestones = useMemo(() => {
    return milestones.filter((m) => m.monthKey === selectedMonthKey);
  }, [milestones, selectedMonthKey]);

  // Tasks in unassigned monthly pool
  const monthPoolTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.horizon === 'month' &&
        t.scheduledDate === null &&
        t.monthKey === selectedMonthKey
    );
  }, [tasks, selectedMonthKey]);

  // Global search & filter checker
  const filterTask = React.useCallback(
    (t: (typeof tasks)[0]) =>
      matchesTaskFilters(t, { searchQuery, selectedTagFilter, selectedPriorityFilter }),
    [searchQuery, selectedTagFilter, selectedPriorityFilter]
  );

  const filteredMonthPoolTasks = useMemo(() => {
    return monthPoolTasks.filter(filterTask);
  }, [monthPoolTasks, filterTask]);

  // Map of scheduled tasks (including daily fixed routines) grouped by dateKey for fast calendar cell lookup
  const tasksByDateKey = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const cell of calendarCells) {
      const cellTasks = sortTasksByTimeAndStatus(getTasksForDate(tasks, cell.dateKey).filter(filterTask));
      if (cellTasks.length > 0) {
        map.set(cell.dateKey, cellTasks);
      }
    }
    return map;
  }, [tasks, calendarCells, filterTask]);

  // Tasks for the selected preview date
  const previewDayTasks = useMemo(() => {
    const list = tasksByDateKey.get(previewDateKey) || getTasksForDate(tasks, previewDateKey).filter(filterTask);
    return sortTasksByTimeAndStatus(list);
  }, [tasksByDateKey, tasks, previewDateKey, filterTask]);

  const previewCompletedCount = useMemo(() => {
    return previewDayTasks.filter((t) => t.status === 'done').length;
  }, [previewDayTasks]);

  // Add new milestone submit handler
  const handleAddMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!milestoneInput.trim()) return;
    addMilestone(milestoneInput.trim(), selectedMonthKey);
    setMilestoneInput('');
  };

  // Add new month pool task submit handler
  const handleAddMonthPoolTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!monthTaskInput.trim()) return;
    if (addTaskFromRaw) {
      addTaskFromRaw(monthTaskInput, 'month');
    } else {
      addTask({
        title: monthTaskInput.trim(),
        horizon: 'month',
        monthKey: selectedMonthKey,
        scheduledDate: null,
      });
    }
    setMonthTaskInput('');
  };

  // Add task to selected preview date handler
  const handleAddPreviewDayTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewDayTaskInput.trim()) return;
    addTask({
      title: previewDayTaskInput.trim(),
      horizon: 'day',
      scheduledDate: previewDateKey,
    });
    setPreviewDayTaskInput('');
  };

  return (
    <div className="space-y-6 pb-12 font-sans text-stone-900">
      {/* 1. HEADER & MONTH NAVIGATION */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 border-b border-stone-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            {formatMonthLabel(selectedMonthKey)}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {isCurrentMonth ? (
              <span className="text-xs text-stone-400">
                {tt('This month', 'Bu Ay')}
              </span>
            ) : (
              <button
                onClick={handleReturnToCurrentMonth}
                className="hover:text-stone-800 transition-colors underline underline-offset-2 text-xs"
              >
                {tt('Back to this month', 'Bu Aya Dön')}
              </button>
            )}
          </p>
        </div>

        {/* Month Navigation Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleShiftMonth(-1)}
            className="p-1 rounded text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors"
            title={tt('Previous month', 'Önceki Ay')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={handleReturnToCurrentMonth}
              className="px-2 py-0.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-200/50 rounded transition-colors font-medium"
            >
              {tt('This month', 'Bu Ay')}
            </button>
          )}
          <button
            onClick={() => handleShiftMonth(1)}
            className="p-1 rounded text-stone-400 hover:text-stone-800 hover:bg-stone-200/50 transition-colors"
            title={tt('Next month', 'Sonraki Ay')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 2. SPACIOUS 2-COLUMN TOP SECTION: MILESTONES & MONTHLY POOL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT CARD: AYIN HEDEFLERİ (MILESTONES) */}
        <div className="bg-white border border-stone-200/80 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
            <h2 className="text-xs text-stone-500 font-semibold">
              {tt('MONTH GOALS (MILESTONES)', 'AYIN HEDEFLERİ (MİLESTONES)')}
            </h2>
            <span className="text-xs text-stone-400">
              ({monthMilestones.length})
            </span>
          </div>

          {/* Add Milestone Form */}
          <form onSubmit={handleAddMilestone} className="flex items-center gap-2">
            <input
              type="text"
              value={milestoneInput}
              onChange={(e) => setMilestoneInput(e.target.value)}
              placeholder={tt('+ Add a new big goal... [Enter]', '+ Yeni büyük hedef ekle... [Enter]')}
              className="h-8 text-xs px-3 rounded-lg bg-stone-50 border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 font-sans w-full transition-colors"
            />
          </form>

          {/* Milestones List */}
          {monthMilestones.length === 0 ? (
            <p className="text-xs text-stone-400 py-3 text-center">
              {tt('No big goal set for this month yet.', 'Bu ay için henüz büyük bir hedef belirlenmedi.')}
            </p>
          ) : (
            <div className="space-y-3 pt-1 max-h-[280px] overflow-y-auto pr-1">
              {monthMilestones.map((m) => {
                const linkedTasks = tasks.filter((t) => t.milestoneId === m.id);
                const completedLinkedCount = linkedTasks.filter((t) => t.status === 'done').length;
                const progressPercent =
                  linkedTasks.length > 0
                    ? Math.round((completedLinkedCount / linkedTasks.length) * 100)
                    : m.completed
                    ? 100
                    : 0;

                const isGenerating = generatingMilestoneId === m.id;

                return (
                  <div
                    key={m.id}
                    className={cn(
                      'group py-2.5 px-3 rounded-lg border border-stone-100 hover:border-stone-200 bg-stone-50/50 space-y-2.5 transition-colors',
                      m.completed && 'opacity-60 bg-stone-50/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <Checkbox
                          checked={m.completed}
                          onCheckedChange={() => toggleMilestone(m.id)}
                          className="mt-0.5 border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'text-sm font-medium text-stone-900 leading-snug break-words',
                              m.completed && 'line-through text-stone-400'
                            )}
                          >
                            {m.title}
                          </p>
                          {isGenerating && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-stone-600 animate-pulse">
                              <Loader2 className="h-3 w-3 animate-spin text-stone-700" />
                              <span>{tt('Gemma 4 is generating tasks...', 'Gemma 4 görev üretiyor...')}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!m.completed && (
                          <button
                            type="button"
                            disabled={generatingMilestoneId !== null}
                            onClick={() => handleGenerateMilestoneTasks(m)}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-all cursor-pointer',
                              isGenerating
                                ? 'bg-stone-200/80 text-stone-800 animate-pulse'
                                : 'text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 border border-stone-200/60'
                            )}
                            title={tt('Generate tasks with AI', 'AI ile Görev Çıkar')}
                          >
                            {isGenerating ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin text-stone-700" />
                                <span className="hidden sm:inline">{tt('Generating...', 'Üretiliyor...')}</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-3 w-3 text-stone-700" />
                                <span>{tt('Generate tasks with AI', 'AI ile Görev Çıkar')}</span>
                              </>
                            )}
                          </button>
                        )}

                        <button
                          onClick={() => deleteMilestone(m.id)}
                          className="text-stone-400 hover:text-stone-900 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title={tt('Delete goal', 'Hedefi Sil')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Clean Progress Bar */}
                    <div className="space-y-1.5 pl-6">
                      <div className="flex items-center justify-between text-xs text-stone-400">
                        <span>
                          {linkedTasks.length > 0
                            ? tt(`${completedLinkedCount}/${linkedTasks.length} linked tasks`, `${completedLinkedCount}/${linkedTasks.length} bağlı görev`)
                            : m.completed
                            ? tt('Done', 'Tamamlandı')
                            : tt('No linked tasks', 'Bağlı görev yok')}
                        </span>
                        <span className="font-medium text-stone-600">{pct(progressPercent)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-stone-200/80 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-stone-900 rounded-full transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT CARD: AYLIK GÖREV HAVUZU (UNASSIGNED MONTHLY TASKS) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!isDragOverMonthPool) setIsDragOverMonthPool(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDragOverMonthPool(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const taskId = e.dataTransfer.getData('text/plain');
            if (taskId) {
              assignTaskToMonthPool(taskId, selectedMonthKey);
            }
            setIsDragOverMonthPool(false);
          }}
          className={cn(
            'bg-white border rounded-xl p-5 shadow-xs space-y-4 transition-all',
            isDragOverMonthPool
              ? 'border-stone-900 ring-2 ring-stone-900 bg-stone-50/90'
              : 'border-stone-200/80'
          )}
        >
          <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-xs text-stone-500 font-semibold">
                {tt('MONTHLY TASK POOL', 'AYLIK GÖREV HAVUZU')}
              </h2>
              {isDragOverMonthPool && (
                <span className="text-xs text-stone-900 bg-stone-200/80 px-1.5 py-0.5 rounded font-medium animate-pulse">
                  {tt('Drop here', 'Buraya bırakın')}
                </span>
              )}
            </div>
            <span className="text-xs text-stone-400">
              ({filteredMonthPoolTasks.length})
            </span>
          </div>

          {/* Quick Add Monthly Task */}
          <form onSubmit={handleAddMonthPoolTask} className="flex items-center gap-2">
            <input
              type="text"
              value={monthTaskInput}
              onChange={(e) => setMonthTaskInput(e.target.value)}
              placeholder={tt('+ Add a monthly pool task... [Enter]', '+ Aylık havuz görevi ekle... [Enter]')}
              className="h-8 text-xs px-3 rounded-lg bg-stone-50 border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 font-sans w-full transition-colors"
            />
          </form>

          {/* Monthly Pool Tasks List */}
          {filteredMonthPoolTasks.length === 0 ? (
            <p className="text-xs text-stone-400 py-3 text-center">
              {tt('No tasks waiting in the monthly pool.', 'Aylık havuzda bekleyen görev bulunmuyor.')}
            </p>
          ) : (
            <div className="divide-y divide-stone-100 pt-1 max-h-[280px] overflow-y-auto pr-1">
              {filteredMonthPoolTasks.map((t) => {
                const isDone = t.status === 'done';

                return (
                  <div
                    key={t.id}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', t.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    className={cn(
                      'group flex items-center justify-between py-2.5 px-2 border-l-4 border-l-transparent hover:bg-stone-50/80 rounded-md transition-colors cursor-grab active:cursor-grabbing select-none',
                      isDone && 'opacity-60',
                      getTaskColorClass(t.tags, tagDefs)
                    )}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                      <GripVertical className="h-3.5 w-3.5 text-stone-300 group-hover:text-stone-500 shrink-0 cursor-grab" />
                      <Checkbox
                        checked={isDone}
                        onCheckedChange={() => toggleTaskDone(t.id)}
                        className="border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0"
                      />
                      <span
                        onClick={() => setEditingTaskId(t.id)}
                        className={cn(
                          'text-sm text-stone-900 leading-snug break-words cursor-pointer hover:text-stone-600',
                          isDone && 'line-through text-stone-400'
                        )}
                      >
                        {t.title}
                      </span>
                      {t.estimatedMinutes > 0 && (
                        <span className="text-xs text-stone-500 shrink-0 ml-1">
                          · {formatMinutes(t.estimatedMinutes)}
                        </span>
                      )}
                    </div>

                    {/* 1-click "Haftaya Al" + Edit / Delete */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => assignTaskToWeekPool(t.id, getCurrentWeekKey())}
                        className="text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 px-2.5 py-1 rounded-md transition-colors"
                      >
                        {tt('Move to week', 'Haftaya Al')}
                      </button>

                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-stone-400 ml-1">
                        <button
                          onClick={() => setEditingTaskId(t.id)}
                          className="p-1 hover:text-stone-900 rounded transition-colors"
                          title={tt('Edit', 'Düzenle')}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteTask(t.id)}
                          className="p-1 hover:text-stone-900 rounded transition-colors"
                          title={tt('Delete', 'Sil')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3. FULL 12-COLUMN WIDTH MONTHLY CALENDAR */}
      <div className="w-full bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-xs">
        {/* Weekday Headers: Pzt - Paz */}
        <div className="grid grid-cols-7 border-b border-stone-200/80 bg-stone-50/70 py-2.5 text-center text-xs font-medium text-stone-500">
          {[1, 2, 3, 4, 5, 6, 0].map((i) => getNames('dayShort')[i]).map((dayName) => (
            <div key={dayName}>{dayName}</div>
          ))}
        </div>

        {/* Calendar Grid Cells */}
        <div
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverDateKey(null);
            }
          }}
          className="grid grid-cols-7 gap-px bg-stone-200/60"
        >
          {calendarCells.map((cell) => {
            const cellTasks = tasksByDateKey.get(cell.dateKey) || [];
            const displayTasks = cellTasks.slice(0, 3);
            const remainingCount = cellTasks.length - displayTasks.length;
            const isSelected = previewDateKey === cell.dateKey;
            const isDragOver = dragOverDateKey === cell.dateKey;

            return (
              <div
                key={cell.dateKey}
                onClick={() => setPreviewDateKey(cell.dateKey)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverDateKey !== cell.dateKey) {
                    setDragOverDateKey(cell.dateKey);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverDateKey === cell.dateKey) {
                      setDragOverDateKey(null);
                    }
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('text/plain');
                  if (taskId) {
                    assignTaskToDay(taskId, cell.dateKey);
                    setPreviewDateKey(cell.dateKey);
                  }
                  setDragOverDateKey(null);
                }}
                className={cn(
                  'group relative flex flex-col justify-between p-1.5 md:p-2.5 min-h-[90px] md:min-h-[135px] cursor-pointer transition-colors select-none',
                  cell.isCurrentMonth
                    ? 'bg-white hover:bg-stone-50/80'
                    : 'bg-stone-50/40 text-stone-400 hover:bg-stone-50/80',
                  cell.isToday && 'bg-stone-50/90',
                  isSelected && 'ring-2 ring-inset ring-stone-900 bg-stone-50/60 z-10',
                  isDragOver && 'ring-2 ring-stone-900 bg-stone-100 z-20'
                )}
              >
                {/* Cell Top Header */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      'text-xs transition-colors',
                      cell.isToday
                        ? 'h-5 w-5 md:h-6 md:w-6 rounded-full bg-stone-900 text-white flex items-center justify-center font-bold text-xs md:text-xs'
                        : cell.isCurrentMonth
                        ? 'text-stone-800 font-medium group-hover:text-stone-950'
                        : 'text-stone-400'
                    )}
                  >
                    {cell.dayNumber}
                  </span>

                  <div className="flex items-center gap-1">
                    {cellTasks.length > 0 && (
                      <span className="text-xs text-stone-400 group-hover:text-stone-600">
                        {cellTasks.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDateKey(cell.dateKey);
                        setActiveView('day');
                      }}
                      title={tt('Go to day', 'Güne Git')}
                      className="hidden md:inline-flex opacity-0 group-hover:opacity-100 p-0.5 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 transition-all"
                    >
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Desktop: Multiline readable task pills with line-clamp-2 */}
                <div className="hidden md:flex flex-col space-y-1.5 flex-1 mt-1">
                  {displayTasks.map((t) => {
                    const isDone = t.status === 'done';
                    const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(t.title);

                    return (
                      <TooltipWrapper
                        key={t.id}
                        side="top"
                        content={
                          <div className="space-y-0.5 max-w-xs text-left">
                            <p className="font-sans font-medium text-xs text-white">{t.title}</p>
                            {t.estimatedMinutes > 0 && (
                              <p className="text-xs text-stone-300">
                                Tahmini: {formatMinutes(t.estimatedMinutes)}
                              </p>
                            )}
                            {t.priority !== 'medium' && (
                              <p className="text-xs text-stone-400 capitalize">
                                {tt('Priority:', 'Öncelik:')} {t.priority === 'urgent' ? tt('Urgent', 'Acil') : tt('High', 'Yüksek')}
                              </p>
                            )}
                          </div>
                        }
                      >
                        <div
                          draggable={!isDatedRoutine(t)}
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData('text/plain', t.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTaskId(t.id, cell.dateKey);
                          }}
                          className={cn(
                            'group/pill flex items-start gap-1.5 px-2 py-1 rounded border border-stone-200/60 bg-stone-100/90 hover:bg-stone-200/80 transition-colors cursor-grab active:cursor-grabbing text-left select-none',
                            isDone && 'opacity-60 bg-stone-50 border-stone-100 text-stone-400',
                            getTaskColorClass(t.tags, tagDefs)
                          )}
                        >
                          <span
                            className={cn(
                              'line-clamp-2 text-xs leading-snug font-medium text-stone-800 break-words flex-1',
                              isDone && 'line-through text-stone-400'
                            )}
                          >
                            {timeBadge && (
                              <span className="text-stone-500 mr-1 font-normal">
                                {timeBadge}
                              </span>
                            )}
                            {cleanTitle}
                          </span>
                        </div>
                      </TooltipWrapper>
                    );
                  })}

                  {remainingCount > 0 && (
                    <div className="text-xs text-stone-500 font-medium pl-1">
                      +{remainingCount} daha
                    </div>
                  )}
                </div>

                {/* Mobile: Compact task indicator dot/badge */}
                <div className="flex md:hidden flex-wrap items-center justify-center gap-1 mt-1">
                  {cellTasks.length > 0 && (
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium',
                        isSelected
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-700 border border-stone-200/80'
                      )}
                    >
                      {cellTasks.length}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. SELECTED DAY INSPECTOR STRIP */}
      <div className="bg-white border border-stone-200/80 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-stone-100 border border-stone-200/70 flex items-center justify-center text-stone-800 shrink-0">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-400 font-semibold">
                  {tt('SELECTED DAY TASKS', 'SEÇİLİ GÜN GÖREVLERİ')}
                </span>
                {previewDateKey === getTodayKey() && (
                  <span className="text-xs bg-stone-900 text-white px-1.5 py-0.5 rounded font-medium">
                    {tt('TODAY', 'BUGÜN')}
                  </span>
                )}
              </div>
              <h3 className="text-base font-semibold text-stone-900">
                {formatTurkishDate(previewDateKey)}
              </h3>
            </div>
            <span className="text-xs text-stone-400 ml-2 hidden sm:inline">
              ({previewCompletedCount}/{previewDayTasks.length} {tt('done', 'tamamlandı')})
            </span>
          </div>

          {/* O Güne Git Button */}
          <button
            onClick={() => {
              setSelectedDateKey(previewDateKey);
              setActiveView('day');
            }}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-xs font-medium text-stone-900 hover:text-white bg-stone-100 hover:bg-stone-900 border border-stone-200/80 rounded-lg transition-all self-start sm:self-auto cursor-pointer"
          >
            <span>{tt('Go to that day', 'O Güne Git')}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Quick Add for Selected Day */}
        <form onSubmit={handleAddPreviewDayTask} className="flex items-center gap-2">
          <input
            type="text"
            value={previewDayTaskInput}
            onChange={(e) => setPreviewDayTaskInput(e.target.value)}
            placeholder={tt(`+ Add a task to this day (${formatTurkishDate(previewDateKey)})... [Enter]`, `+ Bu güne görev ekle (${formatTurkishDate(previewDateKey)})... [Enter]`)}
            className="h-8 text-xs px-3 rounded-lg bg-stone-50 border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 font-sans w-full transition-colors"
          />
        </form>

        {/* Tasks List */}
        {previewDayTasks.length === 0 ? (
          <div className="py-6 text-center text-stone-400 text-xs bg-stone-50/50 rounded-lg border border-dashed border-stone-200/80">
            {tt('No tasks planned for this day. Add one quickly with the box above.', 'Bu gün için planlanmış görev bulunmuyor. Yukarıdaki kutudan hızlıca ekleyebilirsiniz.')}
          </div>
        ) : (
          <div className="divide-y divide-stone-100 rounded-lg border border-stone-100 overflow-hidden">
            {previewDayTasks.map((t) => {
              const isDone = t.status === 'done';
              const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(t.title);
              return (
                <div
                  key={t.id}
                  draggable={!isDatedRoutine(t)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  className={cn(
                    'group flex items-center justify-between py-2.5 px-3 border-l-4 border-l-transparent hover:bg-stone-50/80 transition-colors cursor-grab active:cursor-grabbing select-none',
                    isDone && 'opacity-60 bg-stone-50/30',
                    getTaskColorClass(t.tags, tagDefs)
                  )}
                >
                  <div className="flex items-start gap-2.5 flex-1 min-w-0 mr-3">
                    <GripVertical className="h-3.5 w-3.5 text-stone-300 group-hover:text-stone-500 shrink-0 cursor-grab mt-1" />
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={() => toggleTaskDone(t.id, previewDateKey)}
                      className="border-stone-300 bg-white data-[state=checked]:bg-stone-900 data-[state=checked]:border-stone-900 data-[state=checked]:text-white shrink-0 mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <span
                        onClick={() => setEditingTaskId(t.id, previewDateKey)}
                        className={cn(
                          'block text-sm text-stone-900 leading-snug break-words cursor-pointer hover:text-stone-600 font-medium',
                          isDone && 'line-through text-stone-400 font-normal'
                        )}
                      >
                        {cleanTitle}
                      </span>
                      <TaskMeta task={t} timeBadge={timeBadge} />
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-stone-400">
                    <button
                      onClick={() => setEditingTaskId(t.id, previewDateKey)}
                      className="p-1 hover:text-stone-900 rounded transition-colors"
                      title={tt('Edit', 'Düzenle')}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteTask(t.id)}
                      className="p-1 hover:text-stone-900 rounded transition-colors"
                      title={tt('Delete', 'Sil')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
