import { t, getLocale } from './i18n';

export type TagColor =
  | 'green'
  | 'lime'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'orange'
  | 'pink'
  | 'cyan'
  | 'gray'
  | 'red';

export interface TagDef {
  name: string;
  color: TagColor;
}

/** Tailwind classes per colour (literal strings so Tailwind keeps them) */
export const TAG_COLORS: Record<TagColor, { label: string; chip: string; dot: string; row: string }> = {
  green: {
    get label() {
      return t('Green', 'Yeşil');
    },
    chip: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    row: 'bg-emerald-500/10 hover:bg-emerald-500/15 border-l-emerald-500',
  },
  lime: {
    get label() {
      return t('Light green', 'Açık yeşil');
    },
    chip: 'bg-lime-500/15 text-lime-700 border-lime-500/30 dark:text-lime-300',
    dot: 'bg-lime-400',
    row: 'bg-lime-500/10 hover:bg-lime-500/15 border-l-lime-400',
  },
  blue: {
    get label() {
      return t('Blue', 'Mavi');
    },
    chip: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300',
    dot: 'bg-blue-500',
    row: 'bg-blue-500/10 hover:bg-blue-500/15 border-l-blue-500',
  },
  purple: {
    get label() {
      return t('Purple', 'Mor');
    },
    chip: 'bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300',
    dot: 'bg-violet-500',
    row: 'bg-violet-500/10 hover:bg-violet-500/15 border-l-violet-500',
  },
  yellow: {
    get label() {
      return t('Yellow', 'Sarı');
    },
    chip: 'bg-yellow-400/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-300',
    dot: 'bg-yellow-400',
    row: 'bg-yellow-400/10 hover:bg-yellow-400/15 border-l-yellow-400',
  },
  orange: {
    get label() {
      return t('Orange', 'Turuncu');
    },
    chip: 'bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300',
    dot: 'bg-orange-500',
    row: 'bg-orange-500/10 hover:bg-orange-500/15 border-l-orange-500',
  },
  pink: {
    get label() {
      return t('Pink', 'Pembe');
    },
    chip: 'bg-pink-500/15 text-pink-700 border-pink-500/30 dark:text-pink-300',
    dot: 'bg-pink-500',
    row: 'bg-pink-500/10 hover:bg-pink-500/15 border-l-pink-500',
  },
  cyan: {
    get label() {
      return t('Cyan', 'Camgöbeği');
    },
    chip: 'bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:text-cyan-300',
    dot: 'bg-cyan-400',
    row: 'bg-cyan-500/10 hover:bg-cyan-500/15 border-l-cyan-400',
  },
  gray: {
    get label() {
      return t('Gray', 'Gri');
    },
    chip: 'bg-stone-500/10 text-stone-600 border-stone-400/30',
    dot: 'bg-stone-400',
    row: 'bg-stone-500/10 hover:bg-stone-500/15 border-l-stone-400',
  },
  red: {
    get label() {
      return t('Red', 'Kırmızı');
    },
    chip: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300',
    dot: 'bg-red-500',
    row: 'bg-red-500/10 hover:bg-red-500/15 border-l-red-500',
  },
};

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

export const PRESET_TAGS: TagDef[] = [
  { name: 'health', color: 'green' },
  { name: 'sport', color: 'lime' },
  { name: 'work', color: 'blue' },
  { name: 'education', color: 'purple' },
  { name: 'finance', color: 'yellow' },
  { name: 'home', color: 'orange' },
  { name: 'shopping', color: 'pink' },
  { name: 'social', color: 'cyan' },
  { name: 'personal', color: 'gray' },
  { name: 'urgent', color: 'red' },
];

/** Same rule the task editors use: trim, drop a leading #, lowercase */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

export function isTagColor(v: unknown): v is TagColor {
  return typeof v === 'string' && v in TAG_COLORS;
}

export function getTagColor(tag: string, defs: TagDef[]): TagColor {
  const name = normalizeTagName(tag);
  return defs.find((d) => d.name === name)?.color ?? 'gray';
}

/** Defined tags first (in their order), then tags only used on tasks (A→Z, gray) */
export function collectAllTags(
  defs: TagDef[],
  tasks: { tags: string[] }[]
): (TagDef & { defined: boolean })[] {
  const known = new Set(defs.map((d) => d.name));
  const extra = new Set<string>();
  for (const t of tasks) {
    for (const tag of t.tags) {
      if (!known.has(tag)) extra.add(tag);
    }
  }
  return [
    ...defs.map((d) => ({ ...d, defined: true })),
    ...[...extra]
      .sort((a, b) => a.localeCompare(b, getLocale()))
      .map((name) => ({ name, color: 'gray' as TagColor, defined: false })),
  ];
}

/** A task takes the colour of its first tag that has one (null = no coloured tag) */
export function getTaskColor(tags: string[], defs: TagDef[]): TagColor | null {
  for (const tag of tags) {
    const def = defs.find((d) => d.name === tag);
    if (def) return def.color;
  }
  return null;
}

/** Tinted background + coloured left edge for a whole task row / card ('' when uncoloured) */
export function getTaskColorClass(tags: string[], defs: TagDef[]): string {
  const color = getTaskColor(tags, defs);
  return color ? `border-l-4 ${TAG_COLORS[color].row}` : '';
}
