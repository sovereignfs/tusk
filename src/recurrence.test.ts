import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDays } from './time';
import {
  LIMITS,
  type Rule,
  describe as describeRule,
  firstOnOrAfter,
  formatRule,
  nextOccurrence,
  parseRule,
  reanchor,
  summary,
  weekdayOf,
} from './recurrence';

const rule = (text: string): Rule => {
  const parsed = parseRule(text);
  if (!parsed.ok) throw new Error(`not a rule: ${text} (${parsed.reason})`);
  return parsed.rule;
};
const next = (text: string, anchor: string, dueDate: string | null, today: string) =>
  nextOccurrence({ rule: rule(text), anchor, due: dueDate, today });

/** A small deterministic generator, so that a failing case can be run again. */
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

describe('reading a rule', () => {
  it('reads each allowed shape into a structured rule, and writes it back as the one canonical text', () => {
    expect(rule('FREQ=DAILY')).toEqual({
      freq: 'DAILY',
      interval: 1,
      byDay: [],
      end: { kind: 'never' },
    });
    expect(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;COUNT=5')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: ['MO', 'WE'],
      end: { kind: 'count', count: 5 },
    });
    expect(rule('FREQ=MONTHLY;UNTIL=20271231').end).toEqual({ kind: 'until', date: '2027-12-31' });
    for (const [given, canonical] of [
      ['FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY'],
      ['INTERVAL=3;FREQ=YEARLY', 'FREQ=YEARLY;INTERVAL=3'],
      ['FREQ=WEEKLY;BYDAY=FR,MO', 'FREQ=WEEKLY;BYDAY=MO,FR'],
      ['COUNT=2;FREQ=MONTHLY', 'FREQ=MONTHLY;COUNT=2'],
      ['FREQ=WEEKLY;UNTIL=20260131', 'FREQ=WEEKLY;UNTIL=20260131'],
    ] as const)
      expect(formatRule(rule(given)), given).toBe(canonical);
  });

  it('refuses what is not on the allow-list: BYHOUR, DTSTART, BYDAY on a monthly rule, a prefix, and 201 characters', () => {
    const refused: [string, string][] = [
      ['FREQ=DAILY;BYHOUR=9', 'unknown_key'],
      ['DTSTART=20261106;FREQ=DAILY', 'unknown_key'],
      ['FREQ=DAILY;BYMONTHDAY=3', 'unknown_key'],
      ['FREQ=MONTHLY;BYDAY=MO', 'byday_not_weekly'],
      ['FREQ=DAILY;BYDAY=MO', 'byday_not_weekly'],
      ['FREQ=WEEKLY;BYDAY=1MO', 'byday'],
      ['FREQ=WEEKLY;BYDAY=MO,MO', 'byday'],
      ['FREQ=WEEKLY;BYDAY=XX', 'byday'],
      ['RRULE:FREQ=DAILY', 'syntax'],
      ['FREQ=HOURLY', 'freq'],
      ['FREQ=SECONDLY', 'freq'],
      ['freq=daily', 'syntax'],
      ['INTERVAL=2', 'freq'],
      ['FREQ=DAILY;FREQ=WEEKLY', 'duplicate_key'],
      ['FREQ=DAILY;INTERVAL=0', 'interval'],
      ['FREQ=DAILY;INTERVAL=1000', 'interval'],
      ['FREQ=DAILY;INTERVAL=-1', 'interval'],
      ['FREQ=DAILY;INTERVAL=1.5', 'interval'],
      ['FREQ=DAILY;INTERVAL=01', 'interval'],
      ['FREQ=DAILY;COUNT=0', 'count'],
      ['FREQ=DAILY;COUNT=1000', 'count'],
      ['FREQ=DAILY;COUNT=3;UNTIL=20270101', 'end_both'],
      ['FREQ=DAILY;UNTIL=20270230', 'until'],
      ['FREQ=DAILY;UNTIL=2027-01-01', 'until'],
      ['FREQ=DAILY;UNTIL=20270101T000000Z', 'until'],
      ['FREQ=DAILY;', 'syntax'],
      ['FREQ=', 'syntax'],
      ['=DAILY', 'syntax'],
      ['', 'empty'],
      [`FREQ=DAILY;K=${'X'.repeat(LIMITS.ruleChars)}`, 'too_long'],
    ];
    for (const [text, reason] of refused)
      expect(parseRule(text), text.slice(0, 40)).toEqual({ ok: false, reason });
    // 200 characters is the limit and fits; 201 does not.
    const fits = `FREQ=DAILY;K=${'X'.repeat(LIMITS.ruleChars - 'FREQ=DAILY;K='.length)}`;
    expect(fits).toHaveLength(LIMITS.ruleChars);
    expect(parseRule(fits)).toEqual({ ok: false, reason: 'unknown_key' });
    expect(parseRule(`${fits}X`)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('is the same for the browser and the server: one function says what a rule is', async () => {
    const { isRule } = await import('./recurrence');
    expect(isRule('FREQ=WEEKLY;BYDAY=MO')).toBe(true);
    for (const other of ['FREQ=NOPE', '', null, undefined, 3, {}])
      expect(isRule(other)).toBe(false);
  });
});

describe('saying a rule', () => {
  it('has a short form for a card and a full one for its detail', () => {
    const cases: [string, string, string][] = [
      ['FREQ=DAILY', 'Daily', 'every day'],
      ['FREQ=DAILY;INTERVAL=3', 'Every 3 days', 'every 3 days'],
      ['FREQ=WEEKLY', 'Weekly', 'every week'],
      ['FREQ=WEEKLY;INTERVAL=2', 'Every 2 weeks', 'every 2 weeks'],
      ['FREQ=WEEKLY;BYDAY=MO,WE', 'Weekly', 'every week on Monday, Wednesday'],
      ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'Every 2 weeks', 'every 2 weeks on Tuesday'],
      ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Weekdays', 'every weekday'],
      ['FREQ=MONTHLY', 'Monthly', 'every month'],
      [
        'FREQ=MONTHLY;INTERVAL=3;UNTIL=20271231',
        'Every 3 months',
        'every 3 months, until Dec 31, 2027',
      ],
      ['FREQ=YEARLY;COUNT=5', 'Yearly', 'every year, 5 times'],
      ['FREQ=YEARLY;COUNT=1', 'Yearly', 'every year, once'],
    ];
    for (const [text, short, full] of cases) {
      expect(summary(rule(text)), text).toBe(short);
      expect(describeRule(rule(text)), text).toBe(full);
    }
  });
});

describe('the next occurrence', () => {
  it('is the first one after the later of the due date and today, counted from the anchor', () => {
    // Weekly on Mondays from Monday 2026-11-02.
    const weekly = 'FREQ=WEEKLY;BYDAY=MO';
    // Done on time: due Monday the 2nd, today the 2nd.
    expect(next(weekly, '2026-11-02', '2026-11-02', '2026-11-02')).toBe('2026-11-09');
    // Done late, on a Thursday: the one that follows today, not the ones missed.
    expect(next(weekly, '2026-11-02', '2026-11-02', '2026-11-26')).toBe('2026-11-30');
    // Done early, with the due date in the future: after the due date, not after today.
    expect(next(weekly, '2026-11-02', '2026-11-16', '2026-11-04')).toBe('2026-11-23');
    // No due date: from today.
    expect(next(weekly, '2026-11-02', null, '2026-11-06')).toBe('2026-11-09');
    // Every 2 weeks keeps its phase from the anchor.
    expect(next('FREQ=WEEKLY;INTERVAL=2', '2026-11-02', '2026-11-02', '2026-11-12')).toBe(
      '2026-11-16',
    );
    expect(next('FREQ=DAILY;INTERVAL=3', '2026-11-01', '2026-11-01', '2026-11-01')).toBe(
      '2026-11-04',
    );
  });

  it('never lands on a date that does not exist: monthly from the 31st takes the months that have one', () => {
    expect(next('FREQ=MONTHLY', '2026-01-31', '2026-01-31', '2026-01-31')).toBe('2026-03-31');
    expect(next('FREQ=MONTHLY', '2026-03-31', '2026-03-31', '2026-03-31')).toBe('2026-05-31');
    expect(next('FREQ=YEARLY', '2024-02-29', '2024-02-29', '2024-02-29')).toBe('2028-02-29');
    expect(next('FREQ=MONTHLY', '2026-01-30', '2026-01-30', '2026-02-27')).toBe('2026-03-30');
  });

  it('ends: COUNT counts the anchor and UNTIL is inclusive, and after the end there is none', () => {
    expect(next('FREQ=DAILY;COUNT=3', '2026-11-01', '2026-11-01', '2026-11-01')).toBe('2026-11-02');
    expect(next('FREQ=DAILY;COUNT=3', '2026-11-01', '2026-11-02', '2026-11-02')).toBe('2026-11-03');
    expect(next('FREQ=DAILY;COUNT=3', '2026-11-01', '2026-11-03', '2026-11-03')).toBeNull();
    expect(next('FREQ=DAILY;COUNT=1', '2026-11-01', '2026-11-01', '2026-11-01')).toBeNull();
    expect(next('FREQ=DAILY;UNTIL=20261103', '2026-11-01', '2026-11-02', '2026-11-02')).toBe(
      '2026-11-03',
    );
    expect(next('FREQ=DAILY;UNTIL=20261103', '2026-11-01', '2026-11-03', '2026-11-03')).toBeNull();
    // Done late after the series would have ended: none, and no trail.
    expect(next('FREQ=WEEKLY;UNTIL=20261130', '2026-11-02', '2026-11-02', '2026-12-15')).toBeNull();
  });

  it('is none for a date that is not one, rather than a guess', () => {
    expect(next('FREQ=DAILY', '2026-02-30', null, '2026-11-06')).toBeNull();
    expect(next('FREQ=DAILY', '2026-11-01', 'tomorrow', '2026-11-06')).toBeNull();
    expect(next('FREQ=DAILY', '2026-11-01', null, '06/11/2026')).toBeNull();
  });

  it('is found from an anchor decades back, the same as from one near', () => {
    expect(next('FREQ=DAILY', '1990-01-01', '1990-01-01', '2026-11-06')).toBe('2026-11-07');
    expect(next('FREQ=WEEKLY;BYDAY=MO', '1990-01-01', '1990-01-01', '2026-11-06')).toBe(
      '2026-11-09',
    );
  });
});

describe('the first date for a repeat set on a card with no date', () => {
  it('is today when today matches, and the next match when it does not', () => {
    // 2026-11-06 is a Friday.
    expect(weekdayOf('2026-11-06')).toBe('FR');
    expect(firstOnOrAfter(rule('FREQ=DAILY'), '2026-11-06')).toBe('2026-11-06');
    expect(firstOnOrAfter(rule('FREQ=WEEKLY'), '2026-11-06')).toBe('2026-11-06');
    expect(firstOnOrAfter(rule('FREQ=WEEKLY;BYDAY=FR'), '2026-11-06')).toBe('2026-11-06');
    expect(firstOnOrAfter(rule('FREQ=WEEKLY;BYDAY=MO,WE'), '2026-11-06')).toBe('2026-11-09');
    expect(firstOnOrAfter(rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), '2026-11-07')).toBe(
      '2026-11-09',
    );
    expect(firstOnOrAfter(rule('FREQ=MONTHLY'), '2026-01-31')).toBe('2026-01-31');
    expect(firstOnOrAfter(rule('FREQ=DAILY'), 'nope')).toBeNull();
  });
});

describe('moving a series to another date', () => {
  it('moves a weekly rule on one weekday to the new date’s weekday, and leaves every other rule as it was', () => {
    // 2026-11-11 is a Wednesday.
    expect(reanchor(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-11-11').byDay).toEqual(['WE']);
    expect(reanchor(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4'), '2026-11-11')).toEqual(
      rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=4'),
    );
    for (const same of ['FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,TH', 'FREQ=DAILY', 'FREQ=MONTHLY'])
      expect(reanchor(rule(same), '2026-11-11')).toEqual(rule(same));
  });
});

/**
 * Properties, over many rules and dates, under whichever `TZ` the run has (`pnpm test:zones` runs this file under three). A conversion through a
 * local `Date` moves a weekday by a day in the zones east or west of Greenwich, and fails these.
 */
describe('properties of the next occurrence', () => {
  const pick = random(20261106);
  const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
  const cases = Array.from({ length: 400 }, () => {
    const freq = (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const)[pick(4)];
    const interval = 1 + pick(4);
    let text = `FREQ=${freq}`;
    if (interval > 1) text += `;INTERVAL=${interval}`;
    let weekdays: string[] = [];
    if (freq === 'WEEKLY' && pick(2) === 0) {
      weekdays = days.filter(() => pick(3) === 0);
      if (weekdays.length > 0) text += `;BYDAY=${weekdays.join(',')}`;
    }
    const anchor = addDays('2024-01-01', pick(1100));
    const today = addDays(anchor, pick(900) - 100);
    const dueDate = pick(3) === 0 ? null : addDays(anchor, pick(900));
    return { text, freq, weekdays, anchor, today, dueDate };
  });

  it('lands on the rule’s weekday, and never on or before the later of the due date and today', () => {
    for (const c of cases) {
      const got = next(c.text, c.anchor, c.dueDate, c.today);
      expect(got, JSON.stringify(c)).not.toBeNull();
      if (got === null) continue;
      const later = c.dueDate !== null && c.dueDate > c.today ? c.dueDate : c.today;
      expect(got > later, JSON.stringify(c)).toBe(true);
      if (c.freq === 'WEEKLY' && c.weekdays.length > 0)
        expect(c.weekdays, JSON.stringify(c)).toContain(weekdayOf(got));
      if (c.freq === 'WEEKLY' && c.weekdays.length === 0)
        expect(weekdayOf(got), JSON.stringify(c)).toBe(weekdayOf(c.anchor));
      if (c.freq === 'MONTHLY') expect(got.slice(8), JSON.stringify(c)).toBe(c.anchor.slice(8));
      if (c.freq === 'YEARLY') expect(got.slice(5), JSON.stringify(c)).toBe(c.anchor.slice(5));
    }
  });

  it('is the first such one: nothing in between matches, and one step on it is later still', () => {
    for (const c of cases.slice(0, 120)) {
      const got = next(c.text, c.anchor, c.dueDate, c.today);
      if (got === null) continue;
      // The next after `got` is later than `got` and is the one that follows it.
      const after = next(c.text, c.anchor, got, got);
      expect(after !== null && after > got, JSON.stringify(c)).toBe(true);
      // Asked from the day before `got`, it is `got` again: nothing in between.
      expect(next(c.text, c.anchor, addDays(got, -1), addDays(got, -1)), JSON.stringify(c)).toBe(
        got,
      );
    }
  });

  it('counts the same whatever the zone: a weekly rule from a known Monday lands on Mondays', () => {
    let at = '2026-11-02';
    for (let i = 0; i < 60; i++) {
      const following = next('FREQ=WEEKLY;BYDAY=MO', '2026-11-02', at, at);
      expect(following).toBe(addDays(at, 7));
      at = following ?? at;
      expect(weekdayOf(at)).toBe('MO');
    }
  });
});

describe('where rrule is used', () => {
  it('is imported by src/recurrence.ts and by nothing else', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    for (const dir of ['src', 'app', 'scripts']) walk(join(__dirname, '..', dir));
    const importers = files
      .filter((file) =>
        /from\s+['"]rrule['"]|require\(\s*['"]rrule['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => file.slice(join(__dirname, '..').length + 1));
    expect(importers).toEqual(['src/recurrence.ts']);
  });
});
