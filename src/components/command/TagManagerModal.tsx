import { useMemo, useState } from 'react';
import { Tags, Trash2, Plus, Pencil } from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import { TAG_COLORS, TAG_COLOR_KEYS, collectAllTags, normalizeTagName, type TagColor } from '../../lib/tags';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, cn } from '../ui/primitives';
import { TagChip } from '../ui/tags';
import { t as tt } from '../../lib/i18n';

function ColorPicker({ value, onChange }: { value: TagColor | null; onChange: (c: TagColor) => void }) {
  return (
    <div className="flex items-center gap-1">
      {TAG_COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={TAG_COLORS[c].label}
          aria-label={TAG_COLORS[c].label}
          aria-pressed={value === c}
          className={cn(
            'w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 active:scale-95',
            TAG_COLORS[c].dot,
            value === c ? 'ring-2 ring-offset-1 ring-stone-500 ring-offset-white' : 'opacity-70 hover:opacity-100'
          )}
        />
      ))}
    </div>
  );
}

export function TagManagerModal() {
  const isOpen = useTodoStore((s) => s.tagManagerOpen);
  const setOpen = useTodoStore((s) => s.setTagManagerOpen);
  const tagDefs = useTodoStore((s) => s.tagDefs);
  const tasks = useTodoStore((s) => s.tasks);
  const upsertTagDef = useTodoStore((s) => s.upsertTagDef);
  const removeTagDef = useTodoStore((s) => s.removeTagDef);
  const renameTag = useTodoStore((s) => s.renameTag);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<TagColor>('blue');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const finishRename = () => {
    if (editing) renameTag(editing, draft);
    setEditing(null);
  };

  const allTags = useMemo(() => collectAllTags(tagDefs, tasks), [tagDefs, tasks]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
    return m;
  }, [tasks]);

  const handleAdd = () => {
    if (!normalizeTagName(newName)) return;
    upsertTagDef(newName, newColor);
    setNewName('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg bg-[#FAF9F5] border border-stone-200 shadow-xl p-6 text-stone-900 rounded-xl sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-stone-200 text-stone-700 shadow-2xs">
              <Tags className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-stone-900">{tt('Tags', 'Etiketler')}</DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                {tt('Add tags and pick their colors. Tasks show up in these colors.', 'Etiket ekleyin ve renklerini seçin. Görevlerde bu renklerle görünürler.')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* New tag */}
        <div className="mt-3 p-3 rounded-lg border border-stone-200 bg-white space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={tt('New tag name (e.g. hobby)', 'Yeni etiket adı (örn. hobi)')}
              className="flex-1 h-8 text-xs px-2.5 rounded-md bg-stone-50 border border-stone-300 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-900"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!normalizeTagName(newName)}
              className="h-8 px-3 text-xs font-medium rounded-md bg-stone-900 text-stone-50 hover:bg-stone-800 disabled:opacity-40 cursor-pointer flex items-center gap-1 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {tt('Add', 'Ekle')}
            </button>
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
        </div>

        {/* All tags */}
        <div className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-stone-100 pr-1">
          {allTags.map((t) => (
            <div key={t.name} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                {editing === t.name ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        finishRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    aria-label={tt(`New name for tag ${t.name}`, `${t.name} etiketinin yeni adı`)}
                    className="w-32 h-7 text-xs px-2 rounded-md bg-stone-50 border border-stone-300 text-stone-800 focus:outline-none focus:border-stone-900"
                  />
                ) : (
                  <>
                    <TagChip tag={t.name} />
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(t.name);
                        setDraft(t.name);
                      }}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer transition-colors"
                      title={tt('Rename (changes on every task)', 'Yeniden adlandır (tüm görevlerde değişir)')}
                      aria-label={tt(`Rename tag ${t.name}`, `${t.name} etiketini yeniden adlandır`)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <span className="text-xs text-stone-400">
                  {usage.get(t.name) ? tt(`${usage.get(t.name)} tasks`, `${usage.get(t.name)} görev`) : tt('unused', 'kullanılmıyor')}
                  {!t.defined && ' · renksiz'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ColorPicker value={t.defined ? t.color : null} onChange={(c) => upsertTagDef(t.name, c)} />
                {t.defined ? (
                  <button
                    type="button"
                    onClick={() => removeTagDef(t.name)}
                    className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                    title={tt('Remove from list (tasks keep the tag, shown in gray)', 'Listeden kaldır (görevlerdeki etiket silinmez, gri görünür)')}
                    aria-label={tt(`Remove tag ${t.name} from the list`, `${t.name} etiketini listeden kaldır`)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="w-[22px]" />
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
