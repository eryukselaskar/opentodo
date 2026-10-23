import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import {
  Download,
  Upload,
  Copy,
  Check,
  FileJson,
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  Trash2,
  DatabaseBackup,
} from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import { getTodayKey } from '../../lib/dateUtils';
import {
  isAutoBackupSupported,
  loadBackupHandle,
  chooseBackupFile,
  clearBackupHandle,
  writeBackupFile,
} from '../../lib/autoBackup';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
} from '../ui/primitives';
import { t, getLocale } from '../../lib/i18n';

export function BackupModal() {
  const isOpen = useTodoStore((s) => s.backupModalOpen);
  const setOpen = useTodoStore((s) => s.setBackupModalOpen);
  const exportJson = useTodoStore((s) => s.exportJson);
  const importJson = useTodoStore((s) => s.importJson);
  const clearAllData = useTodoStore((s) => s.clearAllData);
  const tasks = useTodoStore((s) => s.tasks);
  const milestones = useTodoStore((s) => s.milestones);
  const focusLogs = useTodoStore((s) => s.focusLogs);
  const lastBackupAt = useTodoStore((s) => s.lastBackupAt);
  const markBackedUp = useTodoStore((s) => s.markBackedUp);

  // Automatic backup file (Chrome / Edge)
  const autoSupported = isAutoBackupSupported();
  const [autoFileName, setAutoFileName] = useState<string | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !autoSupported) return;
    loadBackupHandle().then((h) => setAutoFileName(h ? h.name : null));
  }, [isOpen, autoSupported]);

  const handleChooseAutoFile = async () => {
    setAutoError(null);
    try {
      const handle = await chooseBackupFile();
      await writeBackupFile(handle, exportJson());
      markBackedUp();
      setAutoFileName(handle.name);
    } catch (err) {
      // AbortError = user closed the picker
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setAutoError(t('Could not set up the backup file. The browser may have denied permission.', 'Yedek dosyası ayarlanamadı. Tarayıcı izin vermemiş olabilir.'));
    }
  };

  const handleDisableAuto = async () => {
    await clearBackupHandle();
    setAutoFileName(null);
  };

  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [copied, setCopied] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = () => {
    const jsonStr = exportJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = getTodayKey();
    link.href = url;
    link.download = `opentodo-backup-${today}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    markBackedUp();
  };

  const handleCopyClipboard = async () => {
    try {
      const jsonStr = exportJson();
      await navigator.clipboard.writeText(jsonStr);
      markBackedUp();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleImportSubmit = (rawStr: string) => {
    if (!rawStr.trim()) {
      setImportStatus({
        type: 'error',
        message: t('Please paste valid JSON or choose a file to import.', 'Lütfen içe aktarılacak geçerli bir JSON metni yapıştırın veya dosya seçin.'),
      });
      return;
    }

    const res = importJson(rawStr);
    if (res.ok) {
      setImportStatus({
        type: 'success',
        message: t('Data imported successfully and your workspace was updated!', 'Veriler başarıyla içe aktarıldı ve çalışma alanınız güncellendi!'),
      });
      setImportInput('');
    } else {
      setImportStatus({
        type: 'error',
        message: res.error || t('Invalid JSON data or format error.', 'Geçersiz JSON verisi veya format hatası.'),
      });
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setImportInput(content);
        handleImportSubmit(content);
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl bg-[#FAF9F5] border border-stone-200 shadow-xl p-6 text-stone-900 rounded-xl sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-stone-200 text-stone-700 shadow-2xs">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-stone-900">
                {t('Data backup & import', 'Veri Yedekleme & İçe Aktarma')}
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                {t('Keep your tasks, milestones and focus sessions safe.', 'Görevlerinizi, kilometre taşlarınızı ve odak oturumlarınızı güvende tutun.')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <TabsRoot
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val as 'export' | 'import');
            setImportStatus({ type: 'idle' });
          }}
          className="mt-2"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export" className="text-xs font-medium gap-2">
              <Download className="h-3.5 w-3.5" />
              {t('Export (back up)', 'Dışa Aktar (Yedek Al)')}
            </TabsTrigger>
            <TabsTrigger value="import" className="text-xs font-medium gap-2">
              <Upload className="h-3.5 w-3.5" />
              {t('Import (restore)', 'İçe Aktar (Yedekten Yükle)')}
            </TabsTrigger>
          </TabsList>

          {/* EXPORT TAB */}
          <TabsContent value="export" className="space-y-4 pt-3">
            <div className="p-3.5 rounded-lg border border-stone-200 bg-white/70 space-y-2">
              <div className="text-xs text-stone-500 font-medium">{t('Current data:', 'Mevcut Sistem Özeti:')}</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded bg-stone-50 border border-stone-200/80">
                  <div className="text-base font-semibold text-stone-900">{tasks.length}</div>
                  <div className="text-xs text-stone-500">{t('Tasks', 'Görev')}</div>
                </div>
                <div className="p-2 rounded bg-stone-50 border border-stone-200/80">
                  <div className="text-base font-semibold text-stone-900">
                    {milestones.length}
                  </div>
                  <div className="text-xs text-stone-500">{t('Milestones', 'Kilometre Taşı')}</div>
                </div>
                <div className="p-2 rounded bg-stone-50 border border-stone-200/80">
                  <div className="text-base font-semibold text-stone-900">
                    {focusLogs.length}
                  </div>
                  <div className="text-xs text-stone-500">{t('Focus logs', 'Odak Kaydı')}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2.5">
              <Button
                type="button"
                variant="primary"
                onClick={handleDownload}
                className="w-full sm:flex-1 text-xs font-medium h-9 gap-2"
              >
                <Download className="h-4 w-4" />
                <span>{t('Download as JSON file', 'JSON Dosyası Olarak İndir')}</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleCopyClipboard}
                className="w-full sm:w-auto text-xs h-9 gap-2 bg-white border-stone-200 hover:bg-stone-50 text-stone-700"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-700 font-medium">{t('Copied to clipboard', 'Panoya Kopyalandı')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>{t('Copy JSON text', 'JSON Metnini Kopyala')}</span>
                  </>
                )}
              </Button>
            </div>

            {/* Automatic backup */}
            <div className="p-3.5 rounded-lg border border-stone-200 bg-white/70 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
                <DatabaseBackup className="h-4 w-4 text-stone-500" />
                {t('Automatic backup', 'Otomatik Yedek')}
              </div>
              {autoSupported ? (
                autoFileName ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                    <span>
                      {t('On: written to', 'Açık: her değişiklikten birkaç saniye sonra')}{' '}
                      <strong className="text-stone-900">{autoFileName}</strong>{' '}
                      {t('a few seconds after every change.', 'dosyasına yazılıyor.')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Button type="button" size="sm" variant="outline" onClick={handleChooseAutoFile} className="text-xs h-7">
                        {t('Change file', 'Dosyayı Değiştir')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={handleDisableAuto} className="text-xs h-7">
                        {t('Turn off', 'Kapat')}
                      </Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                    <span>{t('Choose a file; your data is saved to it automatically on every change.', 'Bir dosya seçin; veriler her değişiklikte oraya otomatik kaydedilsin.')}</span>
                    <Button type="button" size="sm" variant="primary" onClick={handleChooseAutoFile} className="text-xs h-7">
                      {t('Choose backup file', 'Yedek Dosyası Seç')}
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-xs text-stone-500">
                  {t(
                    'This browser does not support automatic file backup (Chrome or Edge required). You will be reminded to back up every 7 days.',
                    'Bu tarayıcı otomatik dosya yedeğini desteklemiyor (Chrome veya Edge gerekir). 7 günde bir yedek almanız hatırlatılır.'
                  )}
                </p>
              )}
              {autoError && <p className="text-xs text-rose-700">{autoError}</p>}
              <p className="text-xs text-stone-400">
                {t('Last backup:', 'Son yedek:')} {lastBackupAt ? new Date(lastBackupAt).toLocaleString(getLocale()) : t('never', 'hiç alınmadı')}
              </p>
            </div>
          </TabsContent>

          {/* IMPORT TAB */}
          <TabsContent value="import" className="space-y-4 pt-3">
            <div className="p-3 rounded-lg border border-stone-200 bg-stone-100/70 text-xs text-stone-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-stone-500 mt-0.5" />
              <div>
                <strong className="font-semibold text-stone-900">{t('Note:', 'Dikkat:')}</strong>{' '}
                {t(
                  'Importing replaces your current tasks and settings with the data in the backup file.',
                  'İçe aktarma işlemi yapıldığında mevcut görevleriniz ve ayarlarınız yedek dosyasındaki veriler ile güncellenir.'
                )}
              </div>
            </div>

            {/* File Upload Trigger */}
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-stone-200 hover:border-stone-300 rounded-xl p-4 bg-white/60 text-center transition-colors">
              <FileJson className="h-7 w-7 text-stone-400 mb-1.5" />
              <p className="text-xs text-stone-700 font-medium">
                {t('Choose or upload your backup .json file', 'Yedek .json dosyanızı seçin veya yükleyin')}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
                id="backup-file-input"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2.5 text-xs h-8 gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{t('Choose file', 'Dosya Seç')}</span>
              </Button>
            </div>

            {/* Manual JSON Paste Area */}
            <div className="space-y-1.5">
              <label htmlFor="import-textarea" className="text-xs text-stone-600 font-medium flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-stone-400" />
                {t('Or paste the JSON here:', 'Veya JSON Kodunu Buraya Yapıştırın:')}
              </label>
              <textarea
                id="import-textarea"
                rows={4}
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder='{"version": 1, "tasks": [...]}'
                className="w-full rounded-lg border border-stone-200 bg-white p-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
              />
            </div>

            {/* Status Feedback */}
            {importStatus.type === 'success' && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{importStatus.message}</span>
              </div>
            )}

            {importStatus.type === 'error' && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{importStatus.message}</span>
              </div>
            )}

            <Button
              type="button"
              variant="primary"
              onClick={() => handleImportSubmit(importInput)}
              disabled={!importInput.trim()}
              className="w-full text-xs font-medium h-9 gap-2"
            >
              <Upload className="h-4 w-4" />
              <span>{t('Import and restore data', 'Verileri İçe Aktar ve Geri Yükle')}</span>
            </Button>
          </TabsContent>
        </TabsRoot>

        {/* Reset section */}
        <div className="mt-5 pt-4 border-t border-stone-200 space-y-2">
          <div className="flex flex-col gap-0.5">
            <h4 className="text-xs font-semibold text-stone-900">
              {t('Reset', 'Sıfırla')}
            </h4>
            <p className="text-xs text-stone-500">
              {t('Delete all tasks, milestones and focus logs and start empty.', 'Tüm görevleri, kilometre taşlarını ve odak kayıtlarını silip boş başlayın.')}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
            {confirmClear ? (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    clearAllData();
                    setConfirmClear(false);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white text-xs h-8 px-3 font-medium"
                >
                  {t('Yes, clear everything', 'Evet, Tümünü Temizle')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmClear(false)}
                  className="text-xs h-8 px-2.5 text-stone-600 border-stone-200"
                >
                  {t('Cancel', 'İptal')}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmClear(true)}
                className="w-full sm:w-auto text-xs h-8 gap-1.5 text-rose-600 border-rose-200/80 hover:bg-rose-50 hover:border-rose-300 font-medium"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t('Clear all data (start empty)', 'Tüm Verileri Temizle (Boş Başla)')}</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
