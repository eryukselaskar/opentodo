import { t } from './i18n';
/**
 * Automatic JSON backup to a user-chosen file (File System Access API, Chrome / Edge).
 * The file handle is kept in IndexedDB so the same file is reused after a reload.
 * Other browsers fall back to the "backup overdue" reminder.
 */

const BACKUP_REMINDER_DAYS = 7;
/** Fired on window when the backup file is chosen or turned off */
export const BACKUP_HANDLE_EVENT = 'todo-plus-backup-handle-changed';
const DB_NAME = 'todo-plus-backup';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'backup-file';

/** True when there was never a backup or the last one is older than `days`. */
export function isBackupOverdue(lastBackupAt: string | null, now: Date, days = BACKUP_REMINDER_DAYS): boolean {
  if (!lastBackupAt) return true;
  const last = new Date(lastBackupAt).getTime();
  if (isNaN(last)) return true;
  return now.getTime() - last > days * 24 * 60 * 60 * 1000;
}

// Minimal typings; these APIs are not in TypeScript's DOM lib yet
interface WritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
export interface BackupFileHandle {
  name: string;
  createWritable(): Promise<WritableFileStream>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}
type SaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<BackupFileHandle>;

export function isAutoBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadBackupHandle(): Promise<BackupFileHandle | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    return (await idbRequest<BackupFileHandle | undefined>('readonly', (s) => s.get(HANDLE_KEY))) || null;
  } catch {
    return null;
  }
}

export async function clearBackupHandle(): Promise<void> {
  if (!isAutoBackupSupported()) return;
  await idbRequest('readwrite', (s) => s.delete(HANDLE_KEY));
  window.dispatchEvent(new Event(BACKUP_HANDLE_EVENT));
}

/** Asks the user where to save (must be called from a click). */
export async function chooseBackupFile(): Promise<BackupFileHandle> {
  const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;
  const handle = await picker({
    suggestedName: 'todo-plus-yedek.json',
    types: [{ description: t('OpenTodo backup', 'OpenTodo yedeği'), accept: { 'application/json': ['.json'] } }],
  });
  await idbRequest('readwrite', (s) => s.put(handle, HANDLE_KEY));
  window.dispatchEvent(new Event(BACKUP_HANDLE_EVENT));
  return handle;
}

/** 'granted' | 'prompt' | 'denied'. After a reload Chrome usually answers 'prompt'. */
export async function getBackupPermission(handle: BackupFileHandle): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted';
  return handle.queryPermission({ mode: 'readwrite' });
}

/** Re-grants write access (must be called from a click). */
export async function requestBackupPermission(handle: BackupFileHandle): Promise<boolean> {
  if (!handle.requestPermission) return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeBackupFile(handle: BackupFileHandle, json: string): Promise<void> {
  const stream = await handle.createWritable();
  await stream.write(json);
  await stream.close();
}
