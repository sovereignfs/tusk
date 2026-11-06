import {
  type Frequency,
  LIMITS,
  type Rule,
  type RuleEnd,
  type Weekday,
  WEEKDAYS,
  formatRule,
  parseRule,
  weekdayOf,
} from '../recurrence';

/**
 * What the repeat picker offers (DESIGN.md §12.2), as pure functions: the presets, what a rule already is among them, and the custom form's draft.
 * **Every choice ends in a rule `parseRule` accepts** (a test makes each one and reads it back), so the picker cannot offer what the server would
 * refuse. `date` is the day the card is due, or today if it has none: a weekly preset falls on its weekday.
 */
export const PRESETS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export type Preset = (typeof PRESETS)[number];
export type Choice = 'none' | Preset | 'custom';

export const PRESET_LABELS: Record<Preset, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const never: RuleEnd = { kind: 'never' };

/** The rule a preset stands for. Weekly is on the weekday of `date`, so that "weekly" on a Friday card is every Friday. */
export function presetRule(preset: Preset, date: string): Rule {
  switch (preset) {
    case 'daily':
      return { freq: 'DAILY', interval: 1, byDay: [], end: never };
    case 'weekdays':
      return { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], end: never };
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1, byDay: [weekdayOf(date)], end: never };
    case 'monthly':
      return { freq: 'MONTHLY', interval: 1, byDay: [], end: never };
    case 'yearly':
      return { freq: 'YEARLY', interval: 1, byDay: [], end: never };
  }
}

/** Which choice a rule is: a preset if it is exactly one (a weekly rule on its date's weekday, or a plain weekly one), otherwise custom; none for no rule. */
export function choiceOf(rule: Rule | null, date: string): Choice {
  if (rule === null) return 'none';
  const text = formatRule(rule);
  for (const preset of PRESETS) {
    if (formatRule(presetRule(preset, date)) === text) return preset;
  }
  // A plain weekly rule falls on the anchor's own weekday, which is the weekly preset.
  if (text === 'FREQ=WEEKLY') return 'weekly';
  return 'custom';
}

/** The custom form's state: every N units, on which weekdays (weekly only), and how it ends. The numbers are text, as typed. */
export interface Draft {
  readonly freq: Frequency;
  readonly interval: string;
  readonly byDay: readonly Weekday[];
  readonly endKind: RuleEnd['kind'];
  readonly until: string;
  readonly count: string;
}

/** The form for a rule, or for a fresh custom one: every week, on the weekday of `date`. */
export function draftOf(rule: Rule | null, date: string): Draft {
  if (rule === null)
    return {
      freq: 'WEEKLY',
      interval: '1',
      byDay: [weekdayOf(date)],
      endKind: 'never',
      until: '',
      count: '10',
    };
  return {
    freq: rule.freq,
    interval: String(rule.interval),
    byDay: rule.byDay.length > 0 || rule.freq !== 'WEEKLY' ? rule.byDay : [weekdayOf(date)],
    endKind: rule.end.kind,
    until: rule.end.kind === 'until' ? rule.end.date : '',
    count: rule.end.kind === 'count' ? String(rule.end.count) : '10',
  };
}

/**
 * Changes the unit. **Weekdays belong to weekly alone:** going to any other unit clears them, so that a monthly rule is not narrowed to days it was
 * not asked about (the plugin kept them), and going to weekly starts at the weekday of `date`.
 */
export function withFrequency(draft: Draft, freq: Frequency, date: string): Draft {
  if (freq === draft.freq) return draft;
  return { ...draft, freq, byDay: freq === 'WEEKLY' ? [weekdayOf(date)] : [] };
}

/** Picks or unpicks a weekday, in the week's order. At least one stays: a weekly rule on no day is the anchor's own, which the form shows as chosen. */
export function toggleDay(draft: Draft, day: Weekday): Draft {
  const has = draft.byDay.includes(day);
  if (has && draft.byDay.length === 1) return draft;
  const next = has ? draft.byDay.filter((each) => each !== day) : [...draft.byDay, day];
  return { ...draft, byDay: WEEKDAYS.filter((each) => next.includes(each)) };
}

const WHOLE = /^[1-9]\d{0,2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rule a draft means, or why not: a number that is not 1 to 999, a date that is not one or is before the card's own (a rule that has ended before
 * it begins would make nothing). The picker disables Apply on a reason.
 */
export function ruleOfDraft(
  draft: Draft,
  date: string,
): { ok: true; rule: Rule } | { ok: false; reason: 'interval' | 'count' | 'until' } {
  if (!WHOLE.test(draft.interval) || Number(draft.interval) > LIMITS.interval)
    return { ok: false, reason: 'interval' };
  let end: RuleEnd = never;
  if (draft.endKind === 'count') {
    if (!WHOLE.test(draft.count) || Number(draft.count) > LIMITS.count)
      return { ok: false, reason: 'count' };
    end = { kind: 'count', count: Number(draft.count) };
  }
  if (draft.endKind === 'until') {
    if (!ISO.test(draft.until) || draft.until < date) return { ok: false, reason: 'until' };
    end = { kind: 'until', date: draft.until };
  }
  const rule: Rule = {
    freq: draft.freq,
    interval: Number(draft.interval),
    byDay: draft.freq === 'WEEKLY' ? draft.byDay : [],
    end,
  };
  // What is written is what `parseRule` reads: a date such as 30 February is shaped like one and is not.
  if (!parseRule(formatRule(rule)).ok) return { ok: false, reason: 'until' };
  return { ok: true, rule };
}
