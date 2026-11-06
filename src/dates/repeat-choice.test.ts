import { describe, expect, it } from 'vitest';
import { describe as say, formatRule, parseRule, summary } from '../recurrence';
import {
  PRESETS,
  choiceOf,
  draftOf,
  presetRule,
  ruleOfDraft,
  toggleDay,
  withFrequency,
} from './repeat-choice';

/** What the repeat picker offers (DESIGN.md §12.2): each choice is a rule `parseRule` accepts, said in the right words, and weekdays stay with weekly. */
const FRIDAY = '2026-11-06';

describe('the presets', () => {
  it('each makes a rule that parseRule accepts and reads back as the same, for any day of the week', () => {
    for (let day = 0; day < 14; day++) {
      const date = `2026-11-${String(2 + day).padStart(2, '0')}`;
      for (const preset of PRESETS) {
        const rule = presetRule(preset, date);
        const text = formatRule(rule);
        const read = parseRule(text);
        expect(read.ok, `${preset} on ${date}: ${text}`).toBe(true);
        expect(read.ok && formatRule(read.rule)).toBe(text);
      }
    }
  });

  it('are said as they are named', () => {
    const said = Object.fromEntries(
      PRESETS.map((preset) => [
        preset,
        [summary(presetRule(preset, FRIDAY)), say(presetRule(preset, FRIDAY))],
      ]),
    );
    expect(said).toEqual({
      daily: ['Daily', 'every day'],
      weekdays: ['Weekdays', 'every weekday'],
      weekly: ['Weekly', 'every week on Friday'],
      monthly: ['Monthly', 'every month'],
      yearly: ['Yearly', 'every year'],
    });
  });

  it('puts weekly on the weekday of the card’s date', () => {
    expect(formatRule(presetRule('weekly', '2026-11-02'))).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(formatRule(presetRule('weekly', '2026-11-08'))).toBe('FREQ=WEEKLY;BYDAY=SU');
  });
});

describe('which choice a rule is', () => {
  const rule = (text: string) => {
    const read = parseRule(text);
    if (!read.ok) throw new Error(text);
    return read.rule;
  };

  it('is none for no rule, a preset for exactly one, and custom for anything else', () => {
    expect(choiceOf(null, FRIDAY)).toBe('none');
    for (const preset of PRESETS) expect(choiceOf(presetRule(preset, FRIDAY), FRIDAY)).toBe(preset);
    expect(choiceOf(rule('FREQ=WEEKLY'), FRIDAY)).toBe('weekly');
    expect(choiceOf(rule('FREQ=WEEKLY;BYDAY=MO'), FRIDAY)).toBe('custom');
    expect(choiceOf(rule('FREQ=DAILY;INTERVAL=2'), FRIDAY)).toBe('custom');
    expect(choiceOf(rule('FREQ=DAILY;COUNT=3'), FRIDAY)).toBe('custom');
    expect(choiceOf(rule('FREQ=MONTHLY;UNTIL=20271231'), FRIDAY)).toBe('custom');
  });
});

describe('the custom form', () => {
  it('begins as every week on the date’s weekday, or as the rule the card has', () => {
    expect(draftOf(null, FRIDAY)).toMatchObject({
      freq: 'WEEKLY',
      interval: '1',
      byDay: ['FR'],
      endKind: 'never',
    });
    const read = parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4');
    expect(read.ok && draftOf(read.rule, FRIDAY)).toMatchObject({
      freq: 'WEEKLY',
      interval: '2',
      byDay: ['MO', 'WE'],
      endKind: 'count',
      count: '4',
    });
  });

  it('does not carry weekdays to another unit, and starts weekly on the date’s weekday', () => {
    let draft = draftOf(null, FRIDAY);
    draft = toggleDay(draft, 'MO');
    expect(draft.byDay).toEqual(['MO', 'FR']);
    const monthly = withFrequency(draft, 'MONTHLY', FRIDAY);
    expect(monthly.byDay).toEqual([]);
    const result = ruleOfDraft(monthly, FRIDAY);
    expect(result.ok && formatRule(result.rule)).toBe('FREQ=MONTHLY');
    expect(withFrequency(monthly, 'WEEKLY', FRIDAY).byDay).toEqual(['FR']);
    // Going to the unit it is already in changes nothing.
    expect(withFrequency(draft, 'WEEKLY', FRIDAY)).toBe(draft);
    // A weekly draft that somehow still has days, made monthly by hand, is a monthly rule with none.
    const odd = ruleOfDraft({ ...draft, freq: 'MONTHLY' }, FRIDAY);
    expect(odd.ok && odd.rule.byDay).toEqual([]);
  });

  it('keeps weekdays in the week’s order, and at least one', () => {
    let draft = draftOf(null, FRIDAY);
    draft = toggleDay(toggleDay(draft, 'SU'), 'TU');
    expect(draft.byDay).toEqual(['TU', 'FR', 'SU']);
    expect(toggleDay(draft, 'FR').byDay).toEqual(['TU', 'SU']);
    const last = draftOf(null, FRIDAY);
    expect(toggleDay(last, 'FR')).toBe(last);
  });

  it('makes a rule for every valid draft, and refuses a number or a date that is not one', () => {
    const base = draftOf(null, FRIDAY);
    const ok = (draft: typeof base) => {
      const result = ruleOfDraft(draft, FRIDAY);
      expect(result.ok && parseRule(formatRule(result.rule)).ok).toBe(true);
      return result.ok ? formatRule(result.rule) : undefined;
    };
    expect(ok({ ...base, interval: '2', byDay: ['MO', 'WE'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    );
    expect(ok({ ...base, interval: '999' })).toBe('FREQ=WEEKLY;INTERVAL=999;BYDAY=FR');
    expect(ok({ ...base, endKind: 'count', count: '5' })).toBe('FREQ=WEEKLY;BYDAY=FR;COUNT=5');
    expect(ok({ ...base, endKind: 'until', until: '2027-01-31' })).toBe(
      'FREQ=WEEKLY;BYDAY=FR;UNTIL=20270131',
    );
    expect(ok({ ...base, endKind: 'until', until: FRIDAY })).toBe(
      'FREQ=WEEKLY;BYDAY=FR;UNTIL=20261106',
    );

    for (const interval of ['', '0', '1000', '-1', '1.5', 'x', '01', ' 2'])
      expect(ruleOfDraft({ ...base, interval }, FRIDAY), `interval ${interval}`).toEqual({
        ok: false,
        reason: 'interval',
      });
    for (const count of ['', '0', '1000', '2.5'])
      expect(ruleOfDraft({ ...base, endKind: 'count', count }, FRIDAY), `count ${count}`).toEqual({
        ok: false,
        reason: 'count',
      });
    for (const until of ['', '2026-11-05', 'tomorrow', '2027-02-30', '2027-13-01'])
      expect(ruleOfDraft({ ...base, endKind: 'until', until }, FRIDAY), `until ${until}`).toEqual({
        ok: false,
        reason: 'until',
      });
    // What the form is not ending on is not looked at.
    expect(ruleOfDraft({ ...base, count: 'x', until: 'x' }, FRIDAY).ok).toBe(true);
  });
});
