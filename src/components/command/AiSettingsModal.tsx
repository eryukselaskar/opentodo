import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import { listAiModels, type AiSettings } from '../../lib/ollamaClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button, cn } from '../ui/primitives';
import { t } from '../../lib/i18n';

const inputClass =
  'w-full h-9 text-xs px-3 rounded-lg bg-white border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400';

/** Choose the AI connection: local Ollama (any model) or an OpenAI-compatible API. */
export function AiSettingsModal() {
  const isOpen = useTodoStore((s) => s.aiSettingsOpen);
  const setOpen = useTodoStore((s) => s.setAiSettingsOpen);
  const saved = useTodoStore((s) => s.aiSettings);
  const save = useTodoStore((s) => s.setAiSettings);

  const [draft, setDraft] = useState<AiSettings>(saved);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(saved);
    setModels([]);
    setStatus(null);
  }, [isOpen, saved]);

  const update = (patch: Partial<AiSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
  };

  const testConnection = async () => {
    setLoading(true);
    try {
      const list = await listAiModels(draft);
      setModels(list);
      setStatus({
        ok: list.length > 0,
        text:
          list.length > 0
            ? t(`Connected — ${list.length} models found.`, `Bağlandı — ${list.length} model bulundu.`)
            : t('Connected, but no models found.', 'Bağlandı ama model bulunamadı.'),
      });
    } catch {
      setModels([]);
      setStatus({ ok: false, text: t('Could not connect. Check the address and key.', 'Bağlanılamadı. Adresi ve anahtarı kontrol edin.') });
    } finally {
      setLoading(false);
    }
  };

  const isOpenAi = draft.provider === 'openai';

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg bg-[#FAF9F5] border border-stone-200 shadow-xl p-6 text-stone-900 rounded-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-stone-200 text-stone-700">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-stone-900">{t('AI connection', 'AI bağlantısı')}</DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                {t(
                  'Optional. Used for subtasks, brain dump and milestone breakdown. Everything works without it.',
                  'İsteğe bağlı. Alt görev, serbest döküm ve hedef kırılımı için kullanılır. Olmadan da her şey çalışır.'
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-1 bg-stone-100/90 p-0.5 rounded-lg border border-stone-200/50">
            {(
              [
                ['ollama', t('Ollama (local)', 'Ollama (yerel)')],
                ['openai', t('OpenAI-compatible API', 'OpenAI uyumlu API')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ provider: value, baseUrl: '', model: '' })}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors',
                  draft.provider === value ? 'bg-stone-900 text-stone-50' : 'text-stone-500 hover:text-stone-900'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-stone-500">{t('Address', 'Adres')}</span>
            <input
              className={inputClass}
              value={draft.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value.trim() })}
              placeholder={isOpenAi ? 'https://api.openai.com/v1' : 'http://localhost:11434'}
            />
            <span className="block text-xs text-stone-400">
              {isOpenAi
                ? t(
                    'Works with OpenAI, OpenRouter, Groq, LM Studio (http://localhost:1234/v1) and other OpenAI-compatible servers.',
                    'OpenAI, OpenRouter, Groq, LM Studio (http://localhost:1234/v1) ve diğer OpenAI uyumlu sunucularla çalışır.'
                  )
                : t(
                    'Leave empty for the default. On the website, start Ollama with OLLAMA_ORIGINS=* so the page may reach it.',
                    'Varsayılan için boş bırakın. Web sitesinden kullanırken Ollama’yı OLLAMA_ORIGINS=* ile başlatın.'
                  )}
            </span>
          </label>

          {isOpenAi && (
            <label className="block space-y-1.5">
              <span className="text-xs text-stone-500">{t('API key', 'API anahtarı')}</span>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value.trim() })}
                placeholder="sk-..."
              />
              <span className="block text-xs text-stone-400">
                {t(
                  'Stored only on this device (not included in backups).',
                  'Yalnızca bu cihazda saklanır (yedeklere eklenmez).'
                )}
              </span>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs text-stone-500">{t('Model', 'Model')}</span>
            <div className="flex items-center gap-2">
              {models.length > 0 ? (
                <select className={inputClass} value={draft.model} onChange={(e) => update({ model: e.target.value })}>
                  <option value="">{t('Automatic', 'Otomatik')}</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputClass}
                  value={draft.model}
                  onChange={(e) => update({ model: e.target.value.trim() })}
                  placeholder={isOpenAi ? 'gpt-4o-mini' : t('Automatic (e.g. gemma4:12b, llama3.2)', 'Otomatik (örn. gemma4:12b, llama3.2)')}
                />
              )}
              <Button type="button" variant="outline" onClick={testConnection} disabled={loading} className="h-9 text-xs gap-1.5 shrink-0">
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                {t('Test & list models', 'Test et, modelleri getir')}
              </Button>
            </div>
          </label>

          {status && <p className={cn('text-xs', status.ok ? 'text-emerald-700' : 'text-rose-700')}>{status.text}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="text-xs h-9">
              {t('Cancel', 'Vazgeç')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                save(draft);
                setOpen(false);
              }}
              className="text-xs h-9"
            >
              {t('Save', 'Kaydet')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
