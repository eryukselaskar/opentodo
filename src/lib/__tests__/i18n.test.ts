import { afterEach, describe, expect, it } from 'vitest';
import { t, setLang, getLocale } from '../i18n';
import { formatTurkishDate, formatRecurrenceLabel, formatWeekRangeLabel } from '../dateUtils';
import { useTodoStore } from '../../store/useTodoStore';

describe('i18n', () => {
  afterEach(() => useTodoStore.getState().setLanguage('tr'));

  it('defaults to English for a fresh store', () => {
    expect(useTodoStore.getInitialState().language).toBe('en');
  });

  it('switches texts, dates and locale with the language', () => {
    setLang('en');
    expect(t('Today', 'Bugün')).toBe('Today');
    expect(getLocale()).toBe('en-US');
    expect(formatTurkishDate('2026-10-19')).toBe('Mon, Oct 19 2026');
    expect(formatWeekRangeLabel('2026-W43')).toBe('Week 43 (Oct 19 - Oct 25)');
    expect(formatRecurrenceLabel({ recurrence: 'custom_days', recurrenceDays: [1, 4] })).toBe('Mon, Thu');

    setLang('tr');
    expect(t('Today', 'Bugün')).toBe('Bugün');
    expect(formatTurkishDate('2026-10-19')).toBe('19 Eki 2026 Pzt');
    expect(formatRecurrenceLabel({ recurrence: 'custom_days', recurrenceDays: [1, 4] })).toBe('Pzt, Per');
  });

  it('remembers the chosen language in the store', () => {
    useTodoStore.getState().setLanguage('en');
    expect(useTodoStore.getState().language).toBe('en');
    expect(t('Today', 'Bugün')).toBe('Today');
  });
});
