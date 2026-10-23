import { useEffect, useState } from 'react';
import { DatabaseBackup, X } from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import {
  BACKUP_HANDLE_EVENT,
  isAutoBackupSupported,
  isBackupOverdue,
  loadBackupHandle,
  getBackupPermission,
  requestBackupPermission,
  writeBackupFile,
  type BackupFileHandle,
} from '../../lib/autoBackup';
import { t } from '../../lib/i18n';

const WRITE_DELAY_MS = 3000;

type Status = 'off' | 'active' | 'needs-permission' | 'error';

/**
 * Writes the JSON backup to the chosen file a few seconds after data changes.
 * Shows a banner when access must be re-granted, or when no backup was taken for a week.
 */
export function AutoBackupController() {
  const lastBackupAt = useTodoStore((s) => s.lastBackupAt);
  const markBackedUp = useTodoStore((s) => s.markBackedUp);
  const setBackupModalOpen = useTodoStore((s) => s.setBackupModalOpen);

  const [handle, setHandle] = useState<BackupFileHandle | null>(null);
  const [status, setStatus] = useState<Status>('off');
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // Load the saved file handle (and again whenever the backup modal changes it)
  useEffect(() => {
    if (!isAutoBackupSupported()) return;
    let cancelled = false;
    const load = async () => {
      const h = await loadBackupHandle();
      if (cancelled) return;
      setHandle(h);
      if (!h) {
        setStatus('off');
        return;
      }
      setStatus((await getBackupPermission(h)) === 'granted' ? 'active' : 'needs-permission');
    };
    load();
    window.addEventListener(BACKUP_HANDLE_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_HANDLE_EVENT, load);
    };
  }, []);

  // While active, write a backup shortly after tasks / milestones / focus logs change
  useEffect(() => {
    if (status !== 'active' || !handle) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const write = async () => {
      try {
        await writeBackupFile(handle, useTodoStore.getState().exportJson());
        markBackedUp();
      } catch (err) {
        console.error('Automatic backup write failed:', err);
        setStatus('error');
      }
    };

    const unsubscribe = useTodoStore.subscribe((state, prev) => {
      if (
        state.tasks === prev.tasks &&
        state.milestones === prev.milestones &&
        state.focusLogs === prev.focusLogs
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, WRITE_DELAY_MS);
    });

    write(); // bring the file up to date when (re)activated

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [status, handle, markBackedUp]);

  const handleGrant = async () => {
    if (!handle) return;
    setStatus((await requestBackupPermission(handle)) ? 'active' : 'needs-permission');
  };

  if (status === 'needs-permission' || status === 'error') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-900">
        <span className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 shrink-0" />
          {status === 'error'
            ? t(`Automatic backup could not write to "${handle?.name}".`, `Otomatik yedek "${handle?.name}" dosyasına yazılamadı.`)
            : t(
                `Automatic backup paused: permission is needed to write to "${handle?.name}".`,
                `Otomatik yedek duraklatıldı: "${handle?.name}" dosyasına yazmak için izin gerekiyor.`
              )}
        </span>
        <button
          type="button"
          onClick={status === 'error' ? () => setBackupModalOpen(true) : handleGrant}
          className="px-3 py-1 rounded-md bg-stone-900 text-stone-50 font-medium hover:bg-stone-800 cursor-pointer"
        >
          {status === 'error' ? t('Backup settings', 'Yedek Ayarları') : t('Allow', 'İzin Ver')}
        </button>
      </div>
    );
  }

  if (status !== 'active' && !reminderDismissed && isBackupOverdue(lastBackupAt, new Date())) {
    const daysAgo = lastBackupAt
      ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
      : null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-stone-100/80 border border-stone-200 rounded-lg px-4 py-2.5 text-xs text-stone-700">
        <span className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 shrink-0 text-stone-500" />
          {daysAgo === null
            ? t('Your data lives only in this browser and has never been backed up.', 'Verileriniz yalnızca bu tarayıcıda duruyor ve henüz hiç yedek alınmadı.')
            : t(`Last backup was ${daysAgo} days ago.`, `Son yedek ${daysAgo} gün önce alındı.`)}
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setBackupModalOpen(true)}
            className="px-3 py-1 rounded-md bg-stone-900 text-stone-50 font-medium hover:bg-stone-800 cursor-pointer"
          >
            {isAutoBackupSupported() ? t('Set up automatic backup', 'Otomatik Yedeği Kur') : t('Back up', 'Yedek Al')}
          </button>
          <button
            type="button"
            onClick={() => setReminderDismissed(true)}
            className="p-1 rounded text-stone-400 hover:text-stone-700 cursor-pointer"
            title={t('Hide for this session', 'Bu oturumda gizle')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    );
  }

  return null;
}
