/**
 * Minimal two-language support. Every UI string is written in place as t('English', 'Türkçe').
 * The current language lives here (set from the store); the app remounts when it changes.
 */
export type Lang = 'en' | 'tr';

let current: Lang = 'en';

export function setLang(lang: Lang) {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(en: string, tr: string): string {
  return current === 'tr' ? tr : en;
}

/** Locale for Intl / toLocale* date and number formatting. */
export function getLocale(): string {
  return current === 'tr' ? 'tr-TR' : 'en-US';
}

/** Percent in the local order: '45%' (en) or '%45' (tr). */
export function pct(n: number): string {
  return current === 'tr' ? `%${n}` : `${n}%`;
}
