import { useState, useEffect, type FormEvent } from 'react';
import {
  X,
  Star,
  Trash2,
  Play,
  Calendar,
  Clock,
  Layers,
  Repeat,
  Target,
  Plus,
  AlertCircle,
  FileText,
  ListTodo,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  TaskHorizon,
  TaskPriority,
  TaskStatus,
  RecurrencePattern,
} from '../../types/todo';
import { useTodoStore } from '../../store/useTodoStore';
import { TagEditor } from '../ui/tags';
import { generateSubtasksWithAI } from '../../lib/ollamaClient';
import {
  getTodayKey,
  shiftDateKey,
  getWeekKeyFromDateKey,
  getMonthKeyFromDateKey,
  getCurrentWeekKey,
  getCurrentMonthKey,
  formatTurkishDate,
  getNames,
} from '../../lib/dateUtils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Checkbox,
  ProgressBar,
  cn,
} from '../ui/primitives';
import { t as tt, getLocale } from '../../lib/i18n';

export function TaskDetailDrawer() {
  const editingTaskId = useTodoStore((s) => s.editingTaskId);
  const setEditingTaskId = useTodoStore((s) => s.setEditingTaskId);
  const tasks = useTodoStore((s) => s.tasks);
  const milestones = useTodoStore((s) => s.milestones);
  const updateTask = useTodoStore((s) => s.updateTask);
  const deleteTask = useTodoStore((s) => s.deleteTask);
  const toggleTaskMIT = useTodoStore((s) => s.toggleTaskMIT);
  const addSubtask = useTodoStore((s) => s.addSubtask);
  const toggleSubtask = useTodoStore((s) => s.toggleSubtask);
  const deleteSubtask = useTodoStore((s) => s.deleteSubtask);
  const setActiveFocusTaskId = useTodoStore((s) => s.setActiveFocusTaskId);
  const setActiveView = useTodoStore((s) => s.setActiveView);
  const editingDateKey = useTodoStore((s) => s.editingDateKey);
  const toggleTaskDone = useTodoStore((s) => s.toggleTaskDone);
  const materializeRecurringInstance = useTodoStore((s) => s.materializeRecurringInstance);

  const task = tasks.find((t) => t.id === editingTaskId);
  // Opened from a day where this routine is only projected: show and act on that day
  const isProjectedDay =
    !!task && !!editingDateKey && task.recurrence !== 'none' && task.scheduledDate !== editingDateKey;

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isGeneratingSubtasks, setIsGeneratingSubtasks] = useState(false);

  const handleGenerateSubtasksAI = async () => {
    if (!task || !task.title.trim() || isGeneratingSubtasks) return;
    setIsGeneratingSubtasks(true);
    try {
      const result = await generateSubtasksWithAI(task.title, task.notes);
      if (result && Array.isArray(result.subtasks) && result.subtasks.length > 0) {
        for (const stTitle of result.subtasks) {
          addSubtask(task.id, stTitle);
        }
        if (result.estimatedMinutes && (!task.estimatedMinutes || task.estimatedMinutes === 25)) {
          updateTask(task.id, { estimatedMinutes: result.estimatedMinutes });
        }
      }
    } catch (err) {
      console.error('Failed to generate subtasks with AI:', err);
    } finally {
      setIsGeneratingSubtasks(false);
    }
  };

  // Keep local state in sync when the task (or its saved title/notes) changes, not on every edit
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.title, task?.notes]);

  if (!task) {
    return null;
  }

  const todayKey = getTodayKey();
  const tomorrowKey = shiftDateKey(todayKey, 1);

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleNotesBlur = () => {
    if (notes !== task.notes) {
      updateTask(task.id, { notes });
    }
  };

  // Esc / outside click / X close the drawer without a blur; save typed title & notes first
  const closeDrawer = () => {
    const trimmed = title.trim();
    const patch: { title?: string; notes?: string } = {};
    if (trimmed && trimmed !== task.title) patch.title = trimmed;
    if (notes !== task.notes) patch.notes = notes;
    if (patch.title !== undefined || patch.notes !== undefined) {
      updateTask(task.id, patch);
    }
    setEditingTaskId(null);
  };

  /** Real task id for the viewed day (creates the routine's day instance when needed). */
  const resolveDayTaskId = (): string => {
    if (!isProjectedDay || !editingDateKey) return task.id;
    const id = materializeRecurringInstance(task.id, editingDateKey);
    setEditingTaskId(id, editingDateKey);
    return id;
  };

  const handleStatusChange = (next: TaskStatus) => {
    const id = resolveDayTaskId();
    const current = useTodoStore.getState().tasks.find((t) => t.id === id);
    if (next === 'done' && current?.status !== 'done') {
      // Normal completion path: records the day and spawns the next routine instance
      toggleTaskDone(id);
      return;
    }
    updateTask(id, {
      status: next,
      completedAt: next === 'done' ? current?.completedAt ?? new Date().toISOString() : null,
    });
  };

  const handleToggleMIT = () => {
    toggleTaskMIT(resolveDayTaskId());
  };

  const handleHorizonChange = (next: TaskHorizon) => {
    // Keep date / week / month fields consistent with the chosen horizon
    if (next === 'day') {
      updateTask(task.id, { horizon: 'day', scheduledDate: task.scheduledDate || todayKey });
    } else if (next === 'week') {
      updateTask(task.id, {
        horizon: 'week',
        scheduledDate: null,
        weekKey: task.weekKey || getCurrentWeekKey(),
        isMIT: false,
      });
    } else if (next === 'month') {
      updateTask(task.id, {
        horizon: 'month',
        scheduledDate: null,
        weekKey: null,
        monthKey: task.monthKey || getCurrentMonthKey(),
        isMIT: false,
      });
    } else {
      updateTask(task.id, {
        horizon: 'backlog',
        scheduledDate: null,
        weekKey: null,
        monthKey: null,
        isMIT: false,
      });
    }
  };

  const handleDateChange = (newDateStr: string | null) => {
    if (!newDateStr) {
      // A task without a day goes back to its week's pool instead of becoming invisible
      updateTask(task.id, {
        scheduledDate: null,
        horizon: 'week',
        weekKey: task.weekKey || getCurrentWeekKey(),
        isMIT: false,
      });
      return;
    }

    updateTask(task.id, {
      scheduledDate: newDateStr,
      weekKey: getWeekKeyFromDateKey(newDateStr),
      monthKey: getMonthKeyFromDateKey(newDateStr),
      horizon: 'day',
    });
  };

  const handleAddSubtask = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    addSubtask(task.id, trimmed);
    setNewSubtaskTitle('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    updateTask(task.id, {
      tags: task.tags.filter((t) => t !== tagToRemove),
    });
  };

  const handleStartFocus = () => {
    setActiveFocusTaskId(task.id, editingDateKey || undefined);
    setActiveView('focus');
    closeDrawer();
  };

  const handleDeleteTask = () => {
    deleteTask(task.id);
    setEditingTaskId(null);
  };

  // On a projected day nothing has been checked yet
  const viewSubtasks = isProjectedDay
    ? task.subtasks.map((st) => ({ ...st, completed: false }))
    : task.subtasks;
  const viewStatus: TaskStatus = isProjectedDay ? 'todo' : task.status;
  const viewIsMIT = isProjectedDay ? false : task.isMIT;
  const isDatedRoutine = task.recurrence !== 'none' && !!task.scheduledDate;

  const subtasksTotal = viewSubtasks.length;
  const subtasksCompleted = viewSubtasks.filter((st) => st.completed).length;

  return (
    <Dialog open={Boolean(editingTaskId)} onOpenChange={(open) => !open && closeDrawer()}>
      <DialogContent className="fixed inset-y-0 right-0 left-auto top-0 translate-x-0 translate-y-0 h-full w-full max-w-xl bg-[#FAF9F5] text-stone-900 border-l border-stone-200 border-t-0 border-r-0 border-b-0 p-0 shadow-2xl rounded-none flex flex-col overflow-hidden duration-300">
        <DialogHeader className="sr-only">
          <DialogTitle>{tt('Task details:', 'Görev Detayı:')} {task.title}</DialogTitle>
          <DialogDescription>{tt('Edit the task\'s properties, subtasks and notes', 'Görev özelliklerini, alt görevlerini ve notlarını düzenleyin')}</DialogDescription>
        </DialogHeader>

        {/* Top Action Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-white/70">
          <div className="flex items-center gap-2">
            {/* Status Selector */}
            <select
              value={viewStatus}
              onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-stone-200 bg-white text-stone-800 cursor-pointer focus:border-stone-400 focus:outline-none transition-colors"
            >
              <option value="todo">{tt('To do', 'Yapılacak')}</option>
              <option value="in_progress">{tt('In progress', 'Devam Ediyor')}</option>
              <option value="done">{tt('Done', 'Tamamlandı')}</option>
            </select>

            {/* MIT Star Toggle */}
            <button
              type="button"
              onClick={handleToggleMIT}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-all cursor-pointer ${
                viewIsMIT
                  ? 'bg-stone-900 text-[#FAF9F5] font-semibold border-stone-900 shadow-xs'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300 hover:text-stone-900'
              }`}
              title={tt('Add to / remove from the day\'s 3 most important tasks (MIT)', 'Günün En Önemli 3 İşi (MIT) arasına ekle / çıkar')}
            >
              <Star className={`h-3.5 w-3.5 ${viewIsMIT ? 'fill-current' : ''}`} />
              <span>{viewIsMIT ? 'MIT' : tt('Make MIT', 'MIT Yap')}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeDrawer}
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
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder={tt('Task title', 'Görev Başlığı')}
              className="w-full text-lg sm:text-xl font-semibold tracking-tight bg-transparent text-stone-900 border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:outline-none transition-colors pb-1"
            />
            {task.createdAt && (
              <p className="text-xs text-stone-400">
                {tt('Created:', 'Oluşturulma:')} {new Date(task.createdAt).toLocaleDateString(getLocale())}
                {!isProjectedDay &&
                  task.completedAt &&
                  ` • ${tt('Completed:', 'Tamamlanma:')} ${new Date(task.completedAt).toLocaleDateString(getLocale())}`}
              </p>
            )}
            {isProjectedDay && editingDateKey && (
              <p className="text-xs text-stone-500">
                {tt('Routine on', 'Rutinin')}{' '}
                <strong className="font-medium text-stone-700">{formatTurkishDate(editingDateKey)}</strong>
                {tt('.', ' günü.')}{' '}
                {tt(
                  'Status, MIT and subtasks apply to this day only; title, time and priority apply to the whole routine.',
                  'Durum, MIT ve alt görevler yalnızca bu güne; başlık, saat ve öncelik tüm rutine uygulanır.'
                )}
              </p>
            )}
          </div>

          {/* Core Properties Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-stone-200 bg-white/70">
            {/* Horizon */}
            <div className="space-y-1.5">
              <label className="text-xs text-stone-500 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-stone-400" />
                {tt('Horizon', 'Zaman Ufku')}
              </label>
              <select
                value={task.horizon}
                disabled={isDatedRoutine}
                title={isDatedRoutine ? tt('Dated routines are tied to days', 'Tarihli rutinler günlere bağlıdır') : undefined}
                onChange={(e) => handleHorizonChange(e.target.value as TaskHorizon)}
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none disabled:opacity-60"
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
                value={task.priority}
                onChange={(e) =>
                  updateTask(task.id, { priority: e.target.value as TaskPriority })
                }
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
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
                {task.recurrence === 'daily' || task.recurrence === 'custom_days'
                  ? tt('Planned date (start)', 'Planlanan Tarih (Başlangıç)')
                  : tt('Planned date', 'Planlanan Tarih')}
              </label>
              <input
                type="date"
                value={task.scheduledDate || ''}
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
                {task.scheduledDate && task.recurrence !== 'daily' && task.recurrence !== 'custom_days' && (
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
                  value={task.scheduledTime || ''}
                  onChange={(e) => updateTask(task.id, { scheduledTime: e.target.value || null })}
                  className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
                />
                {task.scheduledTime && (
                  <button
                    type="button"
                    onClick={() => updateTask(task.id, { scheduledTime: null })}
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
                    onClick={() => updateTask(task.id, { scheduledTime: time })}
                    className={cn(
                      'text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                      task.scheduledTime === time
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
                  value={task.estimatedMinutes}
                  onChange={(e) =>
                    updateTask(task.id, {
                      estimatedMinutes: Math.max(5, parseInt(e.target.value, 10) || 25),
                    })
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
                    onClick={() => updateTask(task.id, { estimatedMinutes: mins })}
                    className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
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
                value={task.milestoneId || ''}
                onChange={(e) =>
                  updateTask(task.id, { milestoneId: e.target.value || null })
                }
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none"
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
                value={task.recurrence}
                onChange={(e) => {
                  const nextRec = e.target.value as RecurrencePattern;
                  updateTask(task.id, {
                    recurrence: nextRec,
                    recurrenceDays:
                      nextRec === 'custom_days'
                        ? task.recurrenceDays && task.recurrenceDays.length > 0
                          ? task.recurrenceDays
                          : [1, 4]
                        : undefined,
                  });
                }}
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
              >
                <option value="none">{tt('Does not repeat', 'Tekrarlanmaz')}</option>
                <option value="daily">{tt('Every day', 'Her Gün')}</option>
                <option value="custom_days">{tt('Specific weekdays (e.g. Monday & Thursday)', 'Haftanın Belirli Günleri (Örn: Pazartesi & Perşembe)')}</option>
                <option value="weekly">{tt('Every week (same day)', 'Her Hafta (Aynı Gün)')}</option>
                <option value="monthly">{tt('Every month', 'Her Ay')}</option>
              </select>

              {task.recurrence === 'custom_days' && (
                <div className="pt-2 p-3 rounded-lg border border-stone-200 bg-stone-50/70 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <span className="text-xs text-stone-600 font-semibold">
                      {tt('Repeat on:', 'Tekrarlanacak Günler:')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateTask(task.id, { recurrenceDays: [1, 4] })}
                        className="text-xs px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-600 hover:text-stone-900 cursor-pointer"
                      >
                        {tt('Mon & Thu', 'Pzt & Per')}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTask(task.id, { recurrenceDays: [1, 2, 3, 4, 5] })}
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
                      const isSelected = (task.recurrenceDays || []).includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            const current = task.recurrenceDays || [];
                            const updated = isSelected
                              ? current.filter((x) => x !== d.id)
                              : [...current, d.id].sort();
                            updateTask(task.id, { recurrenceDays: updated });
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
            tags={task.tags}
            onAdd={(tag) => updateTask(task.id, { tags: [...task.tags, tag] })}
            onRemove={handleRemoveTag}
          />

          {/* Subtasks / Checklist */}
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
                    <ProgressBar value={subtasksCompleted} max={subtasksTotal} className="h-1.5" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleGenerateSubtasksAI}
                  disabled={isGeneratingSubtasks || !task.title.trim()}
                  className="flex items-center gap-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 border border-stone-200/80 px-2.5 py-1 rounded-md cursor-pointer transition-all duration-150 active:scale-[0.98]"
                  title={tt('Split the task into steps with Gemma 4', 'Gemma 4 ile görevi alt adımlara böl')}
                >
                  {isGeneratingSubtasks ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-stone-600" />
                      <span className="text-stone-600">{tt('AI is generating steps...', 'AI alt adımları çıkarıyor...')}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      <span>{tt('Split into steps with AI', 'AI ile Alt Adımlara Böl')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* List with hairline dividers */}
            {viewSubtasks.length > 0 && (
              <div className="divide-y divide-stone-200/70">
                {viewSubtasks.map((st) => (
                  <div
                    key={st.id}
                    className="group flex items-center justify-between gap-2.5 py-2 transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Checkbox
                        checked={st.completed}
                        onCheckedChange={() => toggleSubtask(task.id, st.id, editingDateKey || undefined)}
                      />
                      <span
                        className={`truncate transition-colors ${
                          st.completed
                            ? 'line-through text-stone-400'
                            : 'text-stone-800'
                        }`}
                      >
                        {st.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteSubtask(task.id, st.id)}
                      className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 p-1 rounded transition-opacity cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Subtask Input */}
            <form onSubmit={handleAddSubtask} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder={tt('Add a new subtask...', 'Yeni alt görev ekle...')}
                className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!newSubtaskTitle.trim()}
                className="text-xs h-8 gap-1 bg-stone-100 hover:bg-stone-200 border-stone-200 text-stone-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tt('Add', 'Ekle')}</span>
              </Button>
            </form>
          </div>

          {/* Notes / Description */}
          <div className="space-y-2">
            <label htmlFor="task-notes-textarea" className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-stone-400" />
              {tt('Notes & description', 'Notlar & Açıklama')}
            </label>
            <textarea
              id="task-notes-textarea"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder={tt('Add details, links or notes about the task here...', 'Görevle ilgili ayrıntıları, bağlantıları veya notları buraya ekleyin...')}
              className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-white/70">
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleDeleteTask}
            className="text-xs h-8 gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{tt('Delete task', 'Görevi Sil')}</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleStartFocus}
              className="text-xs font-medium h-8 gap-1.5"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{tt('Start Pomodoro', 'Pomodoro Başlat')}</span>
              {!isProjectedDay && task.pomodoroCount > 0 && (
                <span className="text-xs bg-stone-800 text-stone-200 px-1 rounded ml-1">
                  {task.pomodoroCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
