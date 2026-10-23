import * as React from 'react';
import {
  Task,
  TaskHorizon,
  TaskStatus,
  TaskPriority,
} from '../../types/todo';
import { useShallow } from 'zustand/react/shallow';
import { useTodoStore } from '../../store/useTodoStore';
import { getTaskColorClass } from '../../lib/tags';
import { TaskMeta } from '../ui/tags';
import { matchesTaskFilters } from '../ui/taskUi';
import {
  cn,
  Button,
} from '../ui/primitives';
import {
  getTodayKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  getTasksForDate,
  sortTasksByTimeAndStatus,
  splitTaskTimeAndTitle,
} from '../../lib/dateUtils';
import {
  Flame,
  Plus,
  ArrowRight,
  ArrowLeft,
  Undo2,
  Check,
  Layers,
  Search,
} from 'lucide-react';
import { t as tt } from '../../lib/i18n';
import { dedupeRoutines } from '../../lib/kanban';

type HorizonFilter = 'all' | TaskHorizon;

interface ColumnConfig {
  status: TaskStatus;
  title: string;
  subtitle: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    status: 'todo',
    get title() {
      return tt('TO DO', 'YAPILACAK');
    },
    get subtitle() {
      return tt('Ready to start', 'Başlamaya hazır hedefler');
    },
  },
  {
    status: 'in_progress',
    get title() {
      return tt('IN PROGRESS', 'DEVAM EDEN');
    },
    get subtitle() {
      return tt('Active focus and work', 'Aktif odak ve çalışma alanı');
    },
  },
  {
    status: 'done',
    get title() {
      return tt('DONE', 'TAMAMLANDI');
    },
    get subtitle() {
      return tt('Completed goals', 'Başarılan hedefler');
    },
  },
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  get urgent() {
    return tt('Urgent', 'Acil');
  },
  get high() {
    return tt('High', 'Yüksek');
  },
  get medium() {
    return tt('Medium', 'Orta');
  },
  get low() {
    return tt('Low', 'Düşük');
  },
};

export function KanbanView() {
  const {
    tasks,
    searchQuery,
    selectedTagFilter,
    selectedPriorityFilter,
    addTask,
    updateTask,
    toggleTaskDone,
    materializeRecurringInstance,
    setActiveFocusTaskId,
    setActiveView,
    setEditingTaskId,
  } = useTodoStore(
    useShallow((s) => ({
      tasks: s.tasks,
      searchQuery: s.searchQuery,
      selectedTagFilter: s.selectedTagFilter,
      selectedPriorityFilter: s.selectedPriorityFilter,
      addTask: s.addTask,
      updateTask: s.updateTask,
      toggleTaskDone: s.toggleTaskDone,
      materializeRecurringInstance: s.materializeRecurringInstance,
      setActiveFocusTaskId: s.setActiveFocusTaskId,
      setActiveView: s.setActiveView,
      setEditingTaskId: s.setEditingTaskId,
    }))
  );
  const tagDefs = useTodoStore((s) => s.tagDefs);

  const [horizonFilter, setHorizonFilter] = React.useState<HorizonFilter>('all');
  const [draggedTaskId, setDraggedTaskId] = React.useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = React.useState<TaskStatus | null>(null);

  // Inline Quick Add inputs per column
  const [quickAddColumn, setQuickAddColumn] = React.useState<TaskStatus | null>(null);
  const [quickAddTitle, setQuickAddTitle] = React.useState('');

  const todayKey = getTodayKey();
  const currentWeekKey = getCurrentWeekKey();
  const currentMonthKey = getCurrentMonthKey();

  // Horizon candidate task sets
  const todayTasks = React.useMemo(() => getTasksForDate(tasks, todayKey), [tasks, todayKey]);
  // Routines are kept as several records; every list shows each routine once
  const allTasks = React.useMemo(() => dedupeRoutines(tasks, todayTasks), [tasks, todayTasks]);
  const weekTasks = React.useMemo(() => {
    return dedupeRoutines(
      tasks.filter(
        (t) =>
          t.weekKey === currentWeekKey ||
          (t.horizon === 'week' && (!t.weekKey || t.weekKey === currentWeekKey))
      ),
      todayTasks
    );
  }, [tasks, currentWeekKey, todayTasks]);
  const monthTasks = React.useMemo(() => {
    return dedupeRoutines(
      tasks.filter(
        (t) =>
          t.monthKey === currentMonthKey ||
          (t.horizon === 'month' && (!t.monthKey || t.monthKey === currentMonthKey))
      ),
      todayTasks
    );
  }, [tasks, currentMonthKey, todayTasks]);
  const backlogTasks = React.useMemo(() => {
    return tasks.filter((t) => t.horizon === 'backlog');
  }, [tasks]);

  // Counts for Horizon filter buttons
  const horizonCounts = React.useMemo(() => {
    return {
      all: allTasks.length,
      day: todayTasks.length,
      week: weekTasks.length,
      month: monthTasks.length,
      backlog: backlogTasks.length,
    };
  }, [allTasks.length, todayTasks.length, weekTasks.length, monthTasks.length, backlogTasks.length]);

  // Filter tasks based on selected horizon and search/tag/priority filters
  const filteredTasks = React.useMemo(() => {
    let list: Task[] = allTasks;
    if (horizonFilter === 'day') {
      list = todayTasks;
    } else if (horizonFilter === 'week') {
      list = weekTasks;
    } else if (horizonFilter === 'month') {
      list = monthTasks;
    } else if (horizonFilter === 'backlog') {
      list = backlogTasks;
    }

    return list.filter((task) =>
      matchesTaskFilters(task, { searchQuery, selectedTagFilter, selectedPriorityFilter })
    );
  }, [
    allTasks,
    horizonFilter,
    todayTasks,
    weekTasks,
    monthTasks,
    backlogTasks,
    searchQuery,
    selectedTagFilter,
    selectedPriorityFilter,
  ]);

  // Tasks grouped by status and sorted chronologically by time & done status
  const tasksByStatus = React.useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };
    filteredTasks.forEach((t) => {
      if (map[t.status]) {
        map[t.status].push(t);
      } else {
        map.todo.push(t);
      }
    });

    return {
      todo: sortTasksByTimeAndStatus(map.todo),
      in_progress: sortTasksByTimeAndStatus(map.in_progress),
      done: sortTasksByTimeAndStatus(map.done),
    };
  }, [filteredTasks]);

  // Status transition handler
  const handleMoveStatus = (taskId: string, targetStatus: TaskStatus) => {
    // Use the card as shown: in "Günüm" a routine card is today's projection of its series
    const task = filteredTasks.find((t) => t.id === taskId) || tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;
    const dateContext = horizonFilter === 'day' ? todayKey : undefined;

    if (targetStatus === 'done') {
      // Goes through the normal completion path (records the right day, spawns the next routine)
      toggleTaskDone(taskId, dateContext);
      return;
    }

    const realId = dateContext ? materializeRecurringInstance(taskId, dateContext) : taskId;
    updateTask(realId, {
      status: targetStatus,
      completedAt: null,
    });
  };

  // Quick task addition
  const handleQuickAdd = (status: TaskStatus) => {
    if (!quickAddTitle.trim()) return;

    const horizon = horizonFilter === 'all' ? 'day' : horizonFilter;
    addTask({
      title: quickAddTitle.trim(),
      status,
      horizon,
      scheduledDate: horizon === 'day' ? todayKey : null,
      weekKey: horizon === 'week' ? currentWeekKey : null,
      monthKey: horizon === 'month' ? currentMonthKey : null,
    });

    setQuickAddTitle('');
    setQuickAddColumn(null);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, status: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== status) {
      setDragOverColumn(status);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, status: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    if (taskId) {
      handleMoveStatus(taskId, status);
    }
    setDraggedTaskId(null);
    setDragOverColumn(null);
  };

  return (
    <div className="flex flex-col h-full w-full space-y-4">
      {/* Top Filter & Horizon Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 pb-4 pt-1">
        {/* Understated Horizon Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-stone-100/80 border border-stone-200/80 rounded-lg">
          <button
            type="button"
            onClick={() => setHorizonFilter('all')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all select-none flex items-center gap-1.5',
              horizonFilter === 'all'
                ? 'bg-white text-stone-900 shadow-2xs border border-stone-200/90 font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'
            )}
          >
            <span>{tt('All', 'Tümü')}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                horizonFilter === 'all' ? 'bg-stone-100 text-stone-800' : 'text-stone-400 bg-stone-200/60'
              )}
            >
              {horizonCounts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHorizonFilter('day')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all select-none flex items-center gap-1.5',
              horizonFilter === 'day'
                ? 'bg-white text-stone-900 shadow-2xs border border-stone-200/90 font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'
            )}
          >
            <span>{tt('Day', 'Günüm')}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                horizonFilter === 'day' ? 'bg-stone-100 text-stone-800' : 'text-stone-400 bg-stone-200/60'
              )}
            >
              {horizonCounts.day}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHorizonFilter('week')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all select-none flex items-center gap-1.5',
              horizonFilter === 'week'
                ? 'bg-white text-stone-900 shadow-2xs border border-stone-200/90 font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'
            )}
          >
            <span>{tt('Week', 'Haftam')}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                horizonFilter === 'week' ? 'bg-stone-100 text-stone-800' : 'text-stone-400 bg-stone-200/60'
              )}
            >
              {horizonCounts.week}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHorizonFilter('month')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all select-none flex items-center gap-1.5',
              horizonFilter === 'month'
                ? 'bg-white text-stone-900 shadow-2xs border border-stone-200/90 font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'
            )}
          >
            <span>{tt('Month', 'Ayım')}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                horizonFilter === 'month' ? 'bg-stone-100 text-stone-800' : 'text-stone-400 bg-stone-200/60'
              )}
            >
              {horizonCounts.month}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setHorizonFilter('backlog')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all select-none flex items-center gap-1.5',
              horizonFilter === 'backlog'
                ? 'bg-white text-stone-900 shadow-2xs border border-stone-200/90 font-semibold'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/50'
            )}
          >
            <span>{tt('Pool', 'Havuz')}</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                horizonFilter === 'backlog' ? 'bg-stone-100 text-stone-800' : 'text-stone-400 bg-stone-200/60'
              )}
            >
              {horizonCounts.backlog}
            </span>
          </button>
        </div>

        {/* Status Indicators & Active Filter Tags */}
        <div className="flex items-center gap-2 text-xs text-stone-500">
          {searchQuery && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800 shadow-2xs">
              <Search className="w-3 h-3 text-stone-400" /> &ldquo;{searchQuery}&rdquo;
            </span>
          )}
          {selectedTagFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800 shadow-2xs">
              #{selectedTagFilter}
            </span>
          )}
          {selectedPriorityFilter !== 'all' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-800 text-xs font-medium shadow-2xs">
              {PRIORITY_LABELS[selectedPriorityFilter]}
            </span>
          )}
          <span className="text-stone-500 text-xs ml-1">
            {tt('Total:', 'Toplam:')} <strong className="text-stone-900">{filteredTasks.length}</strong> {tt('tasks', 'görev')}
          </span>
        </div>
      </div>

      {/* Kanban 3-Column Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 flex-1 items-start min-h-[620px]">
        {COLUMNS.map((col) => {
          const colTasks = tasksByStatus[col.status];
          const isOver = dragOverColumn === col.status;
          const totalEstimatedMinutes = colTasks.reduce(
            (acc, t) => acc + (t.estimatedMinutes || 0),
            0
          );

          return (
            <div
              key={col.status}
              onDragOver={(e) => handleDragOver(e, col.status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.status)}
              className={cn(
                'flex flex-col bg-stone-100/70 border border-stone-200/80 rounded-xl p-4 transition-all duration-200 h-full min-h-[580px]',
                isOver && 'border-stone-400 bg-stone-100 ring-1 ring-stone-300'
              )}
            >
              {/* Column Header */}
              <div className="pb-3 border-b border-stone-200/80 flex items-center justify-between select-none">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full',
                      col.status === 'todo' && 'bg-stone-400',
                      col.status === 'in_progress' && 'bg-stone-700',
                      col.status === 'done' && 'bg-stone-900'
                    )}
                  />
                  <div>
                    <h2 className="text-xs font-semibold text-stone-800">
                      {col.title}
                    </h2>
                    <p className="text-xs text-stone-500 leading-tight">
                      {col.subtitle}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {totalEstimatedMinutes > 0 && (
                    <span className="text-xs text-stone-500 px-1.5 py-0.5 rounded bg-white border border-stone-200/80">
                      {totalEstimatedMinutes} {tt('min', 'dk')}
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-md bg-stone-200/70 text-stone-700 border border-stone-300/60 font-medium">
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Inline Quick Add Bar */}
              <div className="py-2.5">
                {quickAddColumn === col.status ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleQuickAdd(col.status);
                    }}
                    className="flex flex-col gap-2 p-2 bg-white rounded-lg border border-stone-300 shadow-2xs"
                  >
                    <input
                      type="text"
                      autoFocus
                      placeholder={tt('Type a new task title...', 'Yeni görev başlığı yazın...')}
                      value={quickAddTitle}
                      onChange={(e) => setQuickAddTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setQuickAddColumn(null);
                          setQuickAddTitle('');
                        }
                      }}
                      className="w-full bg-stone-50 border border-stone-200 rounded px-2.5 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 font-sans"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs h-6 px-2 text-stone-500 hover:text-stone-800"
                        onClick={() => {
                          setQuickAddColumn(null);
                          setQuickAddTitle('');
                        }}
                      >
                        {tt('Cancel', 'İptal')}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="text-xs h-6 px-3 bg-stone-900 text-stone-50 hover:bg-stone-800 font-medium border-stone-900"
                      >
                        {tt('Add', 'Ekle')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setQuickAddColumn(col.status);
                      setQuickAddTitle('');
                    }}
                    className="w-full py-1.5 px-2.5 rounded-lg border border-dashed border-stone-300 hover:border-stone-400 bg-white/60 hover:bg-white text-stone-500 hover:text-stone-800 text-xs flex items-center justify-center gap-1.5 transition-all group"
                  >
                    <Plus className="w-3.5 h-3.5 group-hover:text-stone-900 transition-colors" />
                    <span>{tt('Add task', 'Görev Ekle')}</span>
                  </button>
                )}
              </div>

              {/* Task Cards Scroll Container */}
              <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[calc(100vh-260px)] min-h-[220px] pr-0.5">
                {colTasks.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center p-4 border border-dashed border-stone-200/90 rounded-lg text-stone-400">
                    <Layers className="w-5 h-5 mb-1.5 stroke-[1.5] opacity-40 text-stone-400" />
                    <p className="text-xs font-medium text-stone-500">{tt('No tasks in this column', 'Bu sütunda görev yok')}</p>
                    <p className="text-xs mt-0.5 text-stone-400">
                      {tt('Add a new task or drag a card here.', 'Yeni görev ekleyebilir veya kart sürükleyebilirsiniz.')}
                    </p>
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const subtaskDoneCount = task.subtasks.filter((s) => s.completed).length;
                    const hasSubtasks = task.subtasks.length > 0;
                    const isCardDragged = draggedTaskId === task.id;
                    const { timeBadge, cleanTitle } = splitTaskTimeAndTitle(task.title);

                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDragOverColumn(null);
                        }}
                        onClick={() => setEditingTaskId(task.id, horizonFilter === 'day' ? todayKey : undefined)}
                        className={cn(
                          'group relative rounded-lg border p-3.5 transition-all duration-150 cursor-pointer select-none',
                          'bg-white border-stone-200/80 shadow-2xs hover:border-stone-300 hover:shadow-xs',
                          getTaskColorClass(task.tags, tagDefs),
                          isCardDragged && 'opacity-30 border-stone-400 border-dashed scale-[0.98]'
                        )}
                      >
                        <h3
                          className={cn(
                            'text-sm font-medium text-stone-900 line-clamp-2 leading-snug mb-1',
                            task.status === 'done' && 'line-through text-stone-400'
                          )}
                        >
                          {cleanTitle}
                        </h3>
                        <TaskMeta
                          task={task}
                          timeBadge={timeBadge}
                          size="xs"
                          extra={
                            (hasSubtasks || task.pomodoroCount > 0) &&
                            [
                              hasSubtasks && `${subtaskDoneCount}/${task.subtasks.length} ${tt('steps', 'adım')}`,
                              task.pomodoroCount > 0 && `${task.pomodoroCount} pomodoro`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          }
                        />

                        {/* Card Action Strip (Clean Hover / Subtle Action Links) */}
                        <div
                          className="mt-2.5 flex items-center justify-between gap-1 sm:mt-0 sm:hidden sm:group-hover:flex sm:absolute sm:right-2 sm:bottom-2 sm:bg-white sm:border sm:border-stone-200 sm:rounded-md sm:shadow-sm sm:p-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Odaklan */}
                          <button
                            type="button"
                            className="h-6 px-2 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 border border-stone-200/80 rounded-md flex items-center gap-1 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFocusTaskId(task.id, horizonFilter === 'day' ? todayKey : undefined);
                              setActiveView('focus');
                            }}
                            title={tt('Open this task in focus mode', 'Bu görevi Focus modunda aç')}
                          >
                            <Flame className="w-3 h-3 text-stone-500" />
                            {tt('Focus', 'Odaklan')}
                          </button>

                          {/* Status Movement Action Buttons */}
                          <div className="flex items-center gap-1">
                            {col.status === 'todo' && (
                              <>
                                <button
                                  type="button"
                                  className="h-6 px-2 text-xs text-stone-700 hover:text-stone-950 hover:bg-stone-100 border border-stone-200/80 rounded-md flex items-center gap-0.5 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'in_progress');
                                  }}
                                  title={tt('Move to in progress', 'Devam eden duruma al')}
                                >
                                  <span>{tt('Start', 'Başlat')}</span>
                                  <ArrowRight className="w-3 h-3 ml-0.5 text-stone-400" />
                                </button>
                                <button
                                  type="button"
                                  className="h-6 px-2 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md flex items-center transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'done');
                                  }}
                                  title={tt('Mark as done', 'Tamamlandı olarak işaretle')}
                                >
                                  <Check className="w-3 h-3 text-stone-600" />
                                </button>
                              </>
                            )}

                            {col.status === 'in_progress' && (
                              <>
                                <button
                                  type="button"
                                  className="h-6 px-1.5 text-xs text-stone-400 hover:text-stone-800 hover:bg-stone-100 rounded-md transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'todo');
                                  }}
                                  title={tt('Move back to to-do', 'Yapılacak sütununa geri al')}
                                >
                                  <ArrowLeft className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  className="h-6 px-2.5 text-xs bg-stone-900 text-stone-50 hover:bg-stone-800 rounded-md font-medium flex items-center gap-1 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'done');
                                  }}
                                  title={tt('Complete', 'Tamamla')}
                                >
                                  <Check className="w-3 h-3 stroke-[2.5]" />
                                  <span>{tt('Complete', 'Tamamla')}</span>
                                </button>
                              </>
                            )}

                            {col.status === 'done' && (
                              <>
                                <button
                                  type="button"
                                  className="h-6 px-2 text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-md flex items-center gap-1 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'in_progress');
                                  }}
                                  title={tt('Move back to in progress', 'Devam eden sütununa geri taşı')}
                                >
                                  <ArrowLeft className="w-3 h-3" />
                                  <span>{tt('Resume', 'Devam Et')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="h-6 px-2 text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-md flex items-center gap-1 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStatus(task.id, 'todo');
                                  }}
                                  title={tt('Move back to to-do', 'Yapılacak sütununa geri al')}
                                >
                                  <Undo2 className="w-3 h-3" />
                                  <span>{tt('Undo', 'Geri Al')}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
