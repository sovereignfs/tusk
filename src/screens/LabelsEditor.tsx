'use client';

import { type FormEvent, useState } from 'react';
import { SWATCHES } from '../lists/colors';
import { readableOn } from '../ui/contrast';
import { type LabelRow, type Op, WORKSPACE_LIMITS } from '../workspaces/format';
import { Button, Checkbox, ColorPicker, ConfirmDialog, Input } from '@sovereignfs/ui';
import styles from './LabelsEditor.module.css';

/**
 * A board's labels (DESIGN.md §15.2): a colour, any colour, and a name that may be empty. Shown in the card's dialog with a tick for each label the card
 * carries, and in the board's settings without; in both a label is made, recoloured, renamed and deleted (which takes it off every card). A label's
 * name is drawn in black or white by contrast with its colour (`src/ui/contrast.ts`), because the colour is data a person chose and not a token.
 */
export function LabelChip({ label }: { label: LabelRow }) {
  return (
    <span
      className={styles.chip}
      style={{ background: label.color, color: readableOn(label.color) }}
      aria-label={label.name === '' ? `Label, colour ${label.color}` : undefined}
    >
      {label.name === '' ? ' ' : label.name}
    </span>
  );
}

export function LabelsEditor({
  labels,
  carried,
  cardId,
  boardId,
  perform,
}: {
  labels: readonly LabelRow[];
  /** The ids of the labels the card carries, when this is a card's picker. */
  carried?: readonly string[];
  cardId?: string;
  boardId: string;
  perform: (op: Op) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LabelRow | null>(null);
  const full = labels.length >= WORKSPACE_LIMITS.labelsPerBoard;

  return (
    <div className={styles.editor}>
      <ul className={styles.list} aria-label="Labels">
        {labels.map((label) => (
          <li key={label.id} className={styles.row}>
            {cardId && carried ? (
              <>
                <Checkbox
                  label={`Label ${label.name === '' ? label.color : label.name}`}
                  checked={carried.includes(label.id)}
                  onChange={(checked) =>
                    void perform(
                      checked
                        ? { op: 'card.addLabel', cardId, labelId: label.id }
                        : { op: 'card.removeLabel', cardId, labelId: label.id },
                    )
                  }
                />
                {/* The label's own colour, as data: a swatch beside its tick. */}
                <span className={styles.swatch} style={{ background: label.color }} aria-hidden />
              </>
            ) : null}
            {editing === label.id ? (
              <LabelForm
                initial={label}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (name, color) => {
                  setEditing(null);
                  await perform({ op: 'label.update', id: label.id, name, color });
                }}
              />
            ) : (
              <>
                {cardId ? null : <LabelChip label={label} />}
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Edit label ${label.name === '' ? label.color : label.name}`}
                  onClick={() => setEditing(label.id)}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Delete label ${label.name === '' ? label.color : label.name}`}
                  onClick={() => setDeleting(label)}
                >
                  Delete
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {labels.length === 0 ? <p className={styles.muted}>This board has no labels yet.</p> : null}
      {full ? (
        <p className={styles.muted}>A board can hold {WORKSPACE_LIMITS.labelsPerBoard} labels.</p>
      ) : (
        <LabelForm
          key={labels.length}
          submitLabel="Add label"
          onSubmit={async (name, color) => {
            await perform({ op: 'label.create', id: crypto.randomUUID(), boardId, name, color });
          }}
        />
      )}
      {deleting ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this label?"
          message={
            <>
              <LabelChip label={deleting} /> will be taken off every card that has it.
            </>
          }
          confirmLabel="Delete label"
          destructive
          onConfirm={() => {
            const label = deleting;
            setDeleting(null);
            void perform({ op: 'label.delete', id: label.id });
          }}
        />
      ) : null}
    </div>
  );
}

function LabelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: LabelRow;
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? SWATCHES[6]?.value ?? '#2563eb');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(name.trim(), color);
  };
  return (
    <form onSubmit={submit} className={styles.form}>
      <Input
        aria-label="Label name"
        value={name}
        maxLength={WORKSPACE_LIMITS.labelNameChars}
        placeholder="Label name (optional)"
        onChange={(event) => setName(event.target.value)}
      />
      <ColorPicker
        aria-label="Label colour"
        customLabel="Pick any colour"
        swatches={SWATCHES}
        value={color}
        onChange={(value) => {
          if (value !== null) setColor(value.toLowerCase());
        }}
      />
      <div className={styles.buttons}>
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
