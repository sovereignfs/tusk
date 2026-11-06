'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BoardStore } from '../boards/store';
import { type BoardPeople, type BoardRow, type Role, type Visibility } from '../workspaces/format';
import { Avatar, Button, ConfirmDialog, Dialog, FormField, Select } from '../ui';
import styles from './BoardScreen.module.css';

/**
 * A board's Share dialog (DESIGN.md §14.3): its people and their roles, and for an administrator a picker over the workspace's people (never a search of
 * the server), role and removal, and the board's visibility. Anyone on the board can leave it. Every change is an operation through the board's store,
 * and the people are read again after each, since names are read from the accounts and never kept.
 */
export function ShareDialog({
  board,
  workspaceId,
  people,
  admin,
  store,
  refresh,
  onClose,
}: {
  board: BoardRow;
  workspaceId: string;
  people: BoardPeople | null;
  admin: boolean;
  store: BoardStore;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = people?.members.find((each) => each.you);
  // An archived board is read-only for everyone: its people are not changed until it is restored.
  const editable = admin && !board.archived;

  async function act(op: Parameters<BoardStore['perform']>[0]) {
    setBusy(true);
    const done = await store.perform(op);
    await refresh();
    setBusy(false);
    return done;
  }

  return (
    <Dialog open onClose={onClose} aria-label="Share board" title="Share board" size="md">
      <div className={styles.dialog}>
        {editable ? (
          <FormField label="Who can see it">
            {(field) => (
              <Select
                {...field}
                value={board.visibility}
                disabled={busy}
                onChange={(event) =>
                  void act({
                    op: 'board.setVisibility',
                    id: board.id,
                    visibility: event.target.value as Visibility,
                  })
                }
              >
                <option value="public">Everyone in the workspace</option>
                <option value="private">Only the people below and the workspace’s owners</option>
              </Select>
            )}
          </FormField>
        ) : (
          <p className={styles.muted}>
            {board.visibility === 'public'
              ? 'Everyone in the workspace can see this board.'
              : 'Only its people and the workspace’s owners can see this board.'}
          </p>
        )}

        <section aria-label="People on the board">
          <h3 className={styles.sectionTitle}>People</h3>
          {people === null ? (
            <p className={styles.muted}>Reading the people…</p>
          ) : (
            <ul className={styles.people}>
              {people.members.map((person) => (
                <li key={person.accountId} className={styles.personRow}>
                  <Avatar name={person.name} size="sm" />
                  <span className={styles.personName}>
                    {person.name}
                    {person.you ? <span className={styles.muted}> (you)</span> : null}
                    {person.email ? <span className={styles.muted}> {person.email}</span> : null}
                  </span>
                  {editable ? (
                    <>
                      <span className={styles.roleSelect}>
                        <Select
                          aria-label={`Role of ${person.name}`}
                          value={person.role}
                          disabled={busy}
                          onChange={(event) =>
                            void act({
                              op: 'boardMember.setRole',
                              boardId: board.id,
                              accountId: person.accountId,
                              role: event.target.value as Role,
                            })
                          }
                        >
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                        </Select>
                      </span>
                      {person.you ? null : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          aria-label={`Remove ${person.name} from the board`}
                          onClick={() =>
                            void act({
                              op: 'boardMember.remove',
                              boardId: board.id,
                              accountId: person.accountId,
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className={styles.muted}>
                      {person.role === 'owner' ? 'Owner' : 'Member'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {editable && people && people.candidates.length > 0 ? (
          <div className={styles.pickRow}>
            <Select
              aria-label="Add someone from the workspace"
              value={picked}
              disabled={busy}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">Add someone from the workspace…</option>
              {people.candidates.map((each) => (
                <option key={each.accountId} value={each.accountId}>
                  {each.name}
                </option>
              ))}
            </Select>
            <Button
              disabled={busy || picked === ''}
              onClick={() =>
                void act({ op: 'boardMember.add', boardId: board.id, accountId: picked }).then(() =>
                  setPicked(''),
                )
              }
            >
              Add to board
            </Button>
          </div>
        ) : null}

        {me ? (
          <div>
            <Button variant="secondary" disabled={busy} onClick={() => setLeaving(true)}>
              Leave board
            </Button>
          </div>
        ) : null}
      </div>
      {leaving ? (
        <ConfirmDialog
          open
          onClose={() => setLeaving(false)}
          title="Leave this board?"
          message={
            <>
              You will be taken off <strong>{board.name}</strong> and its cards. Your comments stay.
              {board.visibility === 'private'
                ? ' It is private: you will not see it again unless someone adds you.'
                : ' You can join it again from its header.'}
            </>
          }
          confirmLabel="Leave"
          destructive
          onConfirm={() => {
            setLeaving(false);
            void act({ op: 'board.leave', id: board.id }).then((done) => {
              // A private board is not there for them any more.
              if (done && board.visibility === 'private') router.replace(`/w/${workspaceId}`);
            });
          }}
        />
      ) : null}
    </Dialog>
  );
}
