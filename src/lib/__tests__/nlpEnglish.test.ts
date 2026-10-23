import { afterEach, describe, expect, it } from 'vitest';
import { parseQuickTaskInput } from '../nlpParser';
import { parseSmartDumpWithAI } from '../ollamaClient';

const ref = new Date(2026, 9, 19, 9, 0, 0); // Monday 19 Oct 2026

describe('English natural language (quick add)', () => {
  it('every day / daily routines', () => {
    expect(parseQuickTaskInput('Stretch every day', ref).recurrence).toBe('daily');
    const evening = parseQuickTaskInput('Read every evening', ref);
    expect(evening.recurrence).toBe('daily');
    expect(evening.scheduledTime).toBe('22:00');
    expect(parseQuickTaskInput('Walk every morning', ref).scheduledTime).toBe('10:00');
  });

  it('weekdays, weekends and named days', () => {
    expect(parseQuickTaskInput('Standup every weekday', ref).recurrenceDays).toEqual([1, 2, 3, 4, 5]);
    expect(parseQuickTaskInput('Long run every weekend', ref).recurrenceDays).toEqual([6, 7]);
    const swim = parseQuickTaskInput('Swim every Monday and Thursday after breakfast', ref);
    expect(swim.recurrence).toBe('custom_days');
    expect(swim.recurrenceDays).toEqual([1, 4]);
    expect(swim.scheduledTime).toBe('12:00');
    expect(parseQuickTaskInput('Piano lesson on Tuesdays', ref).recurrenceDays).toEqual([2]);
  });

  it('a single named day is not a routine', () => {
    expect(parseQuickTaskInput('Call mom on Monday', ref).recurrence).toBe('none');
  });

  it('plain titles stay one-off', () => {
    expect(parseQuickTaskInput('Write the daily report', ref).recurrence).toBe('none');
    expect(parseQuickTaskInput('Cook evening dinner', ref).scheduledTime).toBeNull();
    expect(parseQuickTaskInput('Ship release 2.10', ref).scheduledTime).toBeNull();
  });

  it('times with am / pm', () => {
    const call = parseQuickTaskInput('Call mom at 7pm', ref);
    expect(call.scheduledTime).toBe('19:00');
    expect(call.title).toBe('Call mom');
    expect(parseQuickTaskInput('Dinner at 8:30 pm', ref).scheduledTime).toBe('20:30');
    expect(parseQuickTaskInput('Gym 7am', ref).scheduledTime).toBe('07:00');
    expect(parseQuickTaskInput('Lunch 12pm', ref).scheduledTime).toBe('12:00');
  });

  it('health words make a daily health routine', () => {
    const med = parseQuickTaskInput('Take medicine daily after breakfast', ref);
    expect(med.recurrence).toBe('daily');
    expect(med.scheduledTime).toBe('12:00');
  });
});

describe('English brain dump without AI', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const ctx = { todayKey: '2026-10-19', tomorrowKey: '2026-10-20', currentWeekKey: '2026-W43', currentMonthKey: '2026-10' };

  it('splits on "and" and reads tomorrow / this week / this month / weekdays', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const res = await parseSmartDumpWithAI(
      'Call the plumber tomorrow and renew gym membership this month\nPlan the trip this week\nDentist on Thursday',
      ctx
    );
    const byTitle = Object.fromEntries(res.tasks.map((t) => [t.title, t]));
    expect(byTitle['Call the plumber'].scheduledDate).toBe('2026-10-20');
    expect(byTitle['renew gym membership'].horizon).toBe('month');
    expect(byTitle['Plan the trip'].horizon).toBe('week');
    expect(byTitle['Dentist on Thursday'].scheduledDate).toBe('2026-10-22');
  });

  it('reads priority, counts and routines', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const res = await parseSmartDumpWithAI('Urgent: send the invoice\nPost on Instagram 3 times\nRead every evening', ctx);
    expect(res.tasks.find((t) => t.title.includes('invoice'))?.priority).toBe('urgent');
    expect(res.tasks.filter((t) => t.title.startsWith('Post on Instagram'))).toHaveLength(3);
    const read = res.tasks.find((t) => t.title.startsWith('Read'));
    expect(read?.recurrence).toBe('daily');
    expect(read?.scheduledTime).toBe('22:00');
  });
});
