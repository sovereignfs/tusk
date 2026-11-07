'use client';

import { useState } from 'react';
import { type Frequency, type Rule, WEEKDAYS, describe, formatRule, summary } from '../recurrence';
import { addDays } from '../time';
import { Button, Icon, Input, Popover, Select } from '../ui';
import {
  type Choice,
  type Draft,
  PRESETS,
  PRESET_LABELS,
  choiceOf,
  draftOf,
  presetRule,
  ruleOfDraft,
  toggleDay,
  withFrequency,
} from './repeat-choice';
import styles from './RepeatPicker.module.css';

/**
 * The one picker for a repeat (DESIGN.md §12.2): Does not repeat, Daily, Weekdays, Weekly, Monthly, Yearly, and Custom (every N units, on chosen
 * weekdays, ending never, on a date or after N). It says only what was chosen, as the rule's text or none, and what to do with it is the caller's
 * (`setRepeat` and `stopRepeat` in `actions/series.ts`). Choosing only selects (so that the arrow keys can go through the choices without applying each); **Apply** applies the one selected. **Weekdays are weekly's alone:**
 * changing the unit clears them. Every choice is a rule `parseRule` accepts (`repeat-choice.ts`). `date` is the card's due date, or today.
 */
const NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};
const SHORT: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};
const UNITS: [Frequency, string, string][] = [
  ['DAILY', 'day', 'days'],
  ['WEEKLY', 'week', 'weeks'],
  ['MONTHLY', 'month', 'months'],
  ['YEARLY', 'year', 'years'],
];

export function RepeatPicker({
  value,
  date,
  onChange,
  disabled = false,
}: {
  /** The card's rule, or none. */
  value: Rule | null;
  /** The day the card is due, or today when it has no date. */
  date: string;
  /** The rule's text, or null for "Does not repeat". */
  onChange: (rule: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>('none');
  const [draft, setDraft] = useState<Draft>(() => draftOf(value, date));

  const show = () => {
    // Opened afresh each time, on what the card has now.
    setChoice(choiceOf(value, date));
    setDraft(draftOf(value, date));
    setOpen(true);
  };
  const apply = (rule: string | null) => {
    onChange(rule);
    setOpen(false);
  };
  const made = ruleOfDraft(draft, date);
  // What Apply would say: the rule's text, null for "Does not repeat", and nothing while the custom form is not a rule.
  const chosen: string | null | undefined =
    choice === 'none'
      ? null
      : choice === 'custom'
        ? made.ok
          ? formatRule(made.rule)
          : undefined
        : formatRule(presetRule(choice, date));

  return (
    <Popover
      aria-label="Repeat"
      open={open}
      onClose={() => setOpen(false)}
      align="left"
      width={320}
      trigger={
        <button
          type="button"
          className={styles.trigger}
          disabled={disabled}
          aria-expanded={open}
          // The name begins with what is drawn on the button (WCAG 2.5.3) and then says what it does.
          aria-label={
            value
              ? `${summary(value)}, repeats ${describe(value)}`
              : 'Does not repeat, set a repeat'
          }
          onClick={() => (open ? setOpen(false) : show())}
        >
          <Icon name="refresh-cw" aria-hidden />
          <span>{value ? summary(value) : 'Does not repeat'}</span>
        </button>
      }
    >
      <div className={styles.panel}>
        <fieldset className={styles.choices}>
          <legend className={styles.said}>Repeat</legend>
          <Radio
            name="Does not repeat"
            checked={choice === 'none'}
            onPick={() => setChoice('none')}
          />
          {PRESETS.map((preset) => (
            <Radio
              key={preset}
              name={
                preset === 'weekly'
                  ? `${PRESET_LABELS[preset]} on ${NAMES[presetRule(preset, date).byDay[0] ?? 'MO']}`
                  : PRESET_LABELS[preset]
              }
              checked={choice === preset}
              onPick={() => setChoice(preset)}
            />
          ))}
          <Radio
            name="Custom"
            checked={choice === 'custom'}
            onPick={() => {
              setChoice('custom');
              // Starts from what the card has, so that "Custom" is a way to adjust and not to start over.
              setDraft(draftOf(value, date));
            }}
          />
        </fieldset>
        {choice === 'custom' ? (
          <div className={styles.custom}>
            <div className={styles.row}>
              <span>Every</span>
              <Input
                className={styles.number}
                type="number"
                min={1}
                max={999}
                aria-label="Every how many"
                value={draft.interval}
                onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
              />
              <Select
                aria-label="Unit"
                value={draft.freq}
                onChange={(event) =>
                  setDraft(withFrequency(draft, event.target.value as Frequency, date))
                }
              >
                {UNITS.map(([freq, one, many]) => (
                  <option key={freq} value={freq}>
                    {draft.interval === '1' ? one : many}
                  </option>
                ))}
              </Select>
            </div>
            {draft.freq === 'WEEKLY' ? (
              <div className={styles.days} role="group" aria-label="On">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={styles.day}
                    aria-pressed={draft.byDay.includes(day)}
                    aria-label={NAMES[day]}
                    onClick={() => setDraft(toggleDay(draft, day))}
                  >
                    {SHORT[day]}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.row}>
              <span>Ends</span>
              <Select
                aria-label="Ends"
                value={draft.endKind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    endKind: event.target.value as Draft['endKind'],
                    until: draft.until === '' ? addDays(date, 30) : draft.until,
                  })
                }
              >
                <option value="never">Never</option>
                <option value="until">On a date</option>
                <option value="count">After a number of times</option>
              </Select>
              {draft.endKind === 'until' ? (
                <Input
                  type="date"
                  aria-label="Last date"
                  min={date}
                  value={draft.until}
                  onChange={(event) => setDraft({ ...draft, until: event.target.value })}
                />
              ) : null}
              {draft.endKind === 'count' ? (
                <Input
                  className={styles.number}
                  type="number"
                  min={1}
                  max={999}
                  aria-label="How many times"
                  value={draft.count}
                  onChange={(event) => setDraft({ ...draft, count: event.target.value })}
                />
              ) : null}
            </div>
            <p className={styles.said}>
              {made.ok ? `Repeats ${describe(made.rule)}` : 'Check the numbers and the date.'}
            </p>
          </div>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          disabled={chosen === undefined}
          onClick={() => chosen !== undefined && apply(chosen)}
        >
          Apply
        </Button>
      </div>
    </Popover>
  );
}

/** A native radio, so that the arrow keys move among the choices and a screen reader says how many there are. */
function Radio({ name, checked, onPick }: { name: string; checked: boolean; onPick: () => void }) {
  return (
    <label className={styles.choice}>
      <input type="radio" name="repeat" checked={checked} onChange={onPick} />
      <span>{name}</span>
    </label>
  );
}
