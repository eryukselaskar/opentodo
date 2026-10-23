import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Calendar,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import {
  getTodayKey,
  formatTurkishDate,
  shiftDateKey,
  computeDayWorkload,
} from '../../lib/dateUtils';
import { autoScheduleWeekWithAI } from '../../lib/ollamaClient';
import { t as tt } from '../../lib/i18n';

export function RolloverBanner() {
  const tasks = useTodoStore((s) => s.tasks);
  const rolloverOverdueTasks = useTodoStore((s) => s.rolloverOverdueTasks);
  const assignTaskToDay = useTodoStore((s) => s.assignTaskToDay);
  const setEditingTaskId = useTodoStore((s) => s.setEditingTaskId);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDistributingAI, setIsDistributingAI] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const todayKey = getTodayKey();
  const overdueTasks = tasks.filter(
    (t) =>
      t.recurrence === 'none' &&
      t.status !== 'done' &&
      t.scheduledDate !== null &&
      t.scheduledDate < todayKey
  );

  if (overdueTasks.length === 0) {
    return null;
  }

  const count = overdueTasks.length;

  const handleDistributeWithAI = async () => {
    if (isDistributingAI || overdueTasks.length === 0) return;
    setIsDistributingAI(true);
    try {
      const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      const upcomingDays = Array.from({ length: 7 }, (_, idx) => {
        const dateKey = shiftDateKey(todayKey, idx);
        const [y, m, d] = dateKey.split('-').map(Number);
        const dt = new Date(y, (m || 1) - 1, d || 1);
        const summary = computeDayWorkload(tasks, dateKey);
        return {
          dateKey,
          dayName: dayNames[dt.getDay()],
          currentMinutes: summary.plannedMinutes,
          workMinutes: summary.workMinutes,
          leisureMinutes: summary.leisureMinutes,
          routineMinutes: summary.routineMinutes,
        };
      });

      const poolPayload = overdueTasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes || 25,
      }));

      const res = await autoScheduleWeekWithAI(poolPayload, upcomingDays);
      if (res && Array.isArray(res.assignments)) {
        for (const a of res.assignments) {
          assignTaskToDay(a.taskId, a.dateKey);
        }
      }
    } catch (err) {
      console.error('Failed to distribute overdue tasks with AI:', err);
    } finally {
      setIsDistributingAI(false);
    }
  };

  return (
    <div className="bg-stone-100/80 border border-stone-200 rounded-lg px-4 py-3 mb-4 text-sm text-stone-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-stone-400 shrink-0" />
          <span>
            {tt('You have', 'Geçmişten kalan')} <strong className="font-semibold text-stone-900">{count}</strong>{' '}
            {tt('unfinished tasks from earlier days.', 'tamamlanmamış görev var.')}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors ml-1 cursor-pointer"
            title={isExpanded ? tt('Hide details', 'Detayları Gizle') : tt('Review tasks', 'Görevleri İncele')}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isDistributingAI}
            onClick={handleDistributeWithAI}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-stone-900 text-[#FAF9F5] hover:bg-stone-800 disabled:opacity-60 transition-colors cursor-pointer flex items-center gap-1.5"
            title={tt('Spread overdue tasks evenly over the freest days of the week', 'Gecikmiş görevleri haftanın en müsait günlerine dengeli dağıt')}
          >
            {isDistributingAI ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            )}
            <span>{tt('Spread over free days', 'Müsait Günlere Dağıt')}</span>
          </button>
          <button
            type="button"
            onClick={() => rolloverOverdueTasks('to_today')}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-stone-200 text-stone-800 hover:bg-stone-50 transition-colors cursor-pointer"
          >
            {tt('Move to today', 'Bugüne Al')}
          </button>
          <button
            type="button"
            onClick={() => rolloverOverdueTasks('to_week_pool')}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
          >
            {tt('Leave for next week', 'Haftaya Bırak')}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-stone-600">{tt(`Delete ${count} tasks?`, `${count} görev silinsin mi?`)}</span>
              <button
                type="button"
                onClick={() => {
                  rolloverOverdueTasks('delete');
                  setConfirmDelete(false);
                }}
                className="px-2.5 py-1.5 font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer"
              >
                {tt('Yes, delete', 'Evet, Sil')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1.5 font-medium rounded-md text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
              >
                {tt('Cancel', 'Vazgeç')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md text-stone-500 hover:text-rose-600 hover:bg-rose-50/60 transition-colors cursor-pointer"
            >
              {tt('Delete', 'Temizle')}
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 pt-2.5 border-t border-stone-200 space-y-1.5 animate-in fade-in-50 duration-150">
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {overdueTasks.map((t) => (
              <div
                key={t.id}
                onClick={() => setEditingTaskId(t.id)}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-white border border-stone-200 hover:border-stone-300 cursor-pointer transition-colors text-xs text-stone-800"
              >
                <span className="truncate font-medium">{t.title}</span>
                <span className="shrink-0 text-stone-400 flex items-center gap-1 text-xs">
                  <Calendar className="h-3 w-3" />
                  {t.scheduledDate && formatTurkishDate(t.scheduledDate)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
