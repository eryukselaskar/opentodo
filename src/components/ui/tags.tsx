import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X, Tag as TagIcon, Settings2 } from 'lucide-react';
import { useTodoStore } from '../../store/useTodoStore';
import { TAG_COLORS, getTagColor, normalizeTagName } from '../../lib/tags';
import { formatRecurrenceLabel, isLeisureOrGameTask } from '../../lib/dateUtils';
import type { Task } from '../../types/todo';
import { formatMinutes } from './taskUi';
import { cn } from './primitives';
import { t as tt } from '../../lib/i18n';

/** A coloured #tag pill; the colour comes from the user's tag definitions */
export function TagChip({
  tag,
  size = 'sm',
  onRemove,
}: {
  tag: string;
  size?: 'xs' | 'sm';
  onRemove?: () => void;
}) {
  const color = useTodoStore((s) => getTagColor(tag, s.tagDefs));
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium rounded border shrink-0 leading-none',
        size === 'xs' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1',
        TAG_COLORS[color].chip
      )}
    >
      #{tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
          aria-label={tt(`Remove tag ${tag}`, `${tag} etiketini kaldır`)}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** Tag field used by the task editors: chips, free-text input and one-click suggestions */
export function TagEditor({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const tagDefs = useTodoStore((s) => s.tagDefs);
  const setTagManagerOpen = useTodoStore((s) => s.setTagManagerOpen);
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const clean = normalizeTagName(raw);
    if (clean && !tags.includes(clean)) onAdd(clean);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input);
      setInput('');
    }
  };

  const suggestions = tagDefs.filter((d) => !tags.includes(d.name));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
          <TagIcon className="h-3.5 w-3.5 text-stone-400" />
          {tt('Tags', 'Etiketler')}
        </label>
        <button
          type="button"
          onClick={() => setTagManagerOpen(true)}
          className="text-xs text-stone-400 hover:text-stone-800 flex items-center gap-1 cursor-pointer transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          {tt('Manage tags', 'Etiketleri yönet')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} onRemove={() => onRemove(tag)} />
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tt('+ Type a tag and press Enter', '+ Etiket yazıp Enter tuşuna basın')}
          className="bg-transparent text-xs text-stone-800 placeholder:text-stone-400 focus:outline-none px-2 py-0.5 min-w-[150px]"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {suggestions.map((d) => (
            <button
              key={d.name}
              type="button"
              onClick={() => add(d.name)}
              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-dashed border-stone-300 text-stone-500 hover:text-stone-900 hover:border-stone-400 cursor-pointer transition-colors"
              title={tt(`Add #${d.name}`, `#${d.name} ekle`)}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', TAG_COLORS[d.color].dot)} />
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Names of the tags the user gave a colour to, as plain muted text. Clicking one filters by it.
 * The colour itself is shown on the whole task (see getTaskColorClass).
 */
export function ColoredTags({ tags }: { tags: string[] }) {
  const tagDefs = useTodoStore((s) => s.tagDefs);
  const activeTag = useTodoStore((s) => s.selectedTagFilter);
  const setTagFilter = useTodoStore((s) => s.setSelectedTagFilter);
  const colored = tags.filter((t) => tagDefs.some((d) => d.name === t));
  if (colored.length === 0) return null;
  return (
    <>
      {colored.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTagFilter(activeTag === tag ? null : tag);
          }}
          className={cn(
            'cursor-pointer hover:underline',
            activeTag === tag ? 'text-stone-900 font-semibold' : 'text-stone-600 hover:text-stone-900'
          )}
          title={activeTag === tag ? tt('Remove filter', 'Filtreyi kaldır') : tt(`Show only #${tag} tasks`, `Sadece #${tag} görevlerini göster`)}
        >
          #{tag}
        </button>
      ))}
    </>
  );
}

/**
 * The single muted line under a task title:
 * time · duration · recurrence · (extra, e.g. subtask count) · coloured tags
 */
export function TaskMeta({
  task,
  timeBadge,
  extra,
  size = 'sm',
}: {
  task: Task;
  timeBadge?: string | null;
  extra?: ReactNode;
  size?: 'xs' | 'sm';
}) {
  const parts: ReactNode[] = [];
  if (timeBadge) parts.push(<span className="font-medium text-stone-700 tabular-nums">{timeBadge}</span>);
  if (task.estimatedMinutes > 0) parts.push(formatMinutes(task.estimatedMinutes));
  const rec = task.recurrence !== 'none' ? formatRecurrenceLabel(task) : null;
  if (rec) parts.push(rec);
  else if (isLeisureOrGameTask(task)) parts.push(tt('Leisure', 'Keyif'));
  if (extra) parts.push(extra);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-stone-500 leading-snug',
        size === 'xs' ? 'text-xs' : 'text-xs'
      )}
    >
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-stone-300">·</span>}
          <span>{p}</span>
        </Fragment>
      ))}
      <ColoredTags tags={task.tags} />
    </div>
  );
}
