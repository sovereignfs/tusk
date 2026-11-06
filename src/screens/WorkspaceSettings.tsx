'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { WORKSPACE_LIMITS, type Person, type Role, type WorkspaceRow } from '../workspaces/format';
import { Alert, Avatar, Button, ConfirmDialog, Dialog, FormField, Input, Select } from '../ui';
import styles from './WorkspaceSettings.module.css';

/**
 * A workspace's settings (DESIGN.md §13.2, §17.3): its name, its people, and what a person may do about their own place in it. **An owner** renames it, adds
 * people by the exact address of an account that exists here, changes roles, removes people and deletes the workspace; **a member** sees the people and
 * can leave. Names are read from the accounts when the list is read and never kept, so the list is asked for again after each change.
 *
 * Deleting is a dialog of its own, which the screen opens after this one is closed, so that two dialogs are never open at once.
 */
export function WorkspaceSettings({
  workspace,
  onClose,
  onDelete,
}: {
  workspace: WorkspaceRow;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { perform } = useWorkspaces();
  const owner = workspace.role === 'owner';
  const [people, setPeople] = useState<readonly Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(workspace.name);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const read = useCallback(async () => {
    try {
      const reply = await fetch(`/api/workspaces/${workspace.id}/members`, { cache: 'no-store' });
      if (!reply.ok) return;
      setPeople(((await reply.json()) as { people: Person[] }).people);
    } catch {
      // Offline: the list that was read stays, and a change says it needs a connection.
    }
  }, [workspace.id]);
  useEffect(() => {
    void read();
  }, [read, workspace.role]);

  /** Does one thing, shows why if it was not done, and reads the people again. */
  async function act(request: Parameters<typeof perform>[0]): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await perform(request);
    setBusy(false);
    if (!result.ok) {
      setError(failureMessage(result.reason, result.detail));
      await read();
      return false;
    }
    await read();
    return true;
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (name === '' || name === workspace.name) return;
    if (!(await act({ op: 'workspace.rename', id: workspace.id, name }))) setDraft(workspace.name);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === '') return;
    if (await act({ op: 'member.add', workspaceId: workspace.id, email })) setEmail('');
  }

  const setRole = (person: Person, role: Role) =>
    act({ op: 'member.setRole', workspaceId: workspace.id, accountId: person.accountId, role });
  const remove = (person: Person) =>
    act({ op: 'member.remove', workspaceId: workspace.id, accountId: person.accountId });

  return (
    <Dialog
      open
      onClose={onClose}
      aria-label="Workspace settings"
      title="Workspace settings"
      size="md"
    >
      <div className={styles.body}>
        {error ? <Alert variant="error">{error}</Alert> : null}
        {owner ? (
          <form onSubmit={(event) => void rename(event)} className={styles.form}>
            <FormField label="Name">
              {(field) => (
                <Input
                  {...field}
                  value={draft}
                  maxLength={WORKSPACE_LIMITS.nameChars}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
            </FormField>
            <div>
              <Button
                type="submit"
                disabled={busy || draft.trim() === '' || draft.trim() === workspace.name}
              >
                Save name
              </Button>
            </div>
          </form>
        ) : null}

        <section aria-label="People" className={styles.section}>
          <h3 className={styles.heading}>People</h3>
          {people === null ? (
            <p className={styles.muted}>Reading the people…</p>
          ) : (
            <ul className={styles.people}>
              {people.map((person) => (
                <li key={person.accountId} className={styles.person}>
                  <Avatar name={person.name} size="sm" />
                  <span className={styles.who}>
                    <span className={styles.name}>
                      {person.name}
                      {person.you ? <span className={styles.muted}> (you)</span> : null}
                    </span>
                    {person.email ? <span className={styles.muted}>{person.email}</span> : null}
                  </span>
                  {owner ? (
                    <>
                      <span className={styles.role}>
                        <Select
                          aria-label={`Role of ${person.name}`}
                          value={person.role}
                          disabled={busy}
                          onChange={(event) => void setRole(person, event.target.value as Role)}
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
                          aria-label={`Remove ${person.name}`}
                          onClick={() => void remove(person)}
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
          {owner ? (
            <form onSubmit={(event) => void add(event)} className={styles.add}>
              <FormField label="Add a person by email">
                {(field) => (
                  <Input
                    {...field}
                    type="email"
                    value={email}
                    autoComplete="off"
                    placeholder="name@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
              </FormField>
              <Button type="submit" disabled={busy || email.trim() === ''}>
                Add person
              </Button>
            </form>
          ) : null}
        </section>

        <section aria-label="Leave or delete" className={styles.section}>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={() => setLeaving(true)}>
              Leave workspace
            </Button>
            {owner ? (
              <Button
                variant="secondary"
                onClick={() =>
                  window.location.assign(`/api/export?scope=workspace&id=${workspace.id}`)
                }
              >
                Export workspace
              </Button>
            ) : null}
            {owner ? (
              <Button variant="secondary" onClick={onDelete}>
                Delete workspace
              </Button>
            ) : null}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Leave this workspace?"
        message={
          <>
            You will lose access to <strong>{workspace.name}</strong> and be taken off its boards.
            Your comments stay. Someone will have to add you again to come back.
          </>
        }
        confirmLabel="Leave"
        destructive
        onConfirm={() => {
          setLeaving(false);
          void act({ op: 'member.leave', workspaceId: workspace.id });
        }}
      />
    </Dialog>
  );
}
