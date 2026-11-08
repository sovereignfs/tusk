'use client';

import { useEffect, useState } from 'react';
import { type PushState, disablePush, enablePush, pushState } from '../push/client';
import { Alert, Checkbox } from '../ui';
import { NOTICE_KINDS, type NoticeKind } from '../workspaces/format';
import styles from './Account.module.css';

const LABELS: Record<NoticeKind, string> = {
  assigned: 'When I am assigned a card',
  comment: 'When someone comments on a card I made or am assigned to',
  added_to_workspace: 'When I am added to a workspace',
  added_to_board: 'When I am added to a board',
  backup_stopped: 'When my automatic backups stop',
  workspace_passed: 'When a workspace is passed to me because its owner left',
};

/** What the account keeps of this and what the server can deliver (`GET /api/settings`). */
interface Loaded {
  noticesOff: NoticeKind[];
  briefOn: boolean;
  briefAt: string;
  remindersOn: boolean;
  emailOn: boolean;
  sentKinds: NoticeKind[];
  can: { email: boolean; push: boolean; core: boolean };
  pushKey?: string;
}

/**
 * Settings, Notifications (DESIGN.md §16, §19, §25.2): which kinds of notice are written to the Inbox, and what also leaves the app: the daily brief and its
 * time, a reminder when a card is due, email, and which kinds of notice are sent as well. **All of it is saved with the account**, so that it is the same on every
 * device. A kind turned off is not written at all (those already there stay). **Each outside-the-app setting is offered only where this server can deliver it,
 * and says why not where it cannot**: no email without a mail server, nothing at all without one of email, push or a core. The copy says where a title goes.
 */
export function NotificationsSection() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  // Push is per device: what this browser has, not what the account has.
  const [push, setPush] = useState<PushState | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const reply = await fetch('/api/settings', { cache: 'no-store' });
        if (!reply.ok) return setFailed(true);
        setLoaded((await reply.json()) as Loaded);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  /** Shows a change at once and puts it back if the server does not take it. */
  async function save(change: Partial<Omit<Loaded, 'can'>>) {
    if (loaded === null) return;
    const before = loaded;
    setLoaded({ ...loaded, ...change });
    setFailed(false);
    try {
      const reply = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(change),
      });
      if (reply.ok) return;
    } catch {
      // The same answer as a refusal.
    }
    setLoaded(before);
    setFailed(true);
  }

  // Only where the server can send Push is the device asked what it has: the question touches the service worker, which a server with no Push has no use for.
  const pushPossible = loaded?.can.push === true;
  useEffect(() => {
    if (pushPossible) void pushState().then(setPush);
  }, [pushPossible]);

  const off = loaded?.noticesOff ?? [];
  const sent = loaded?.sentKinds ?? [];
  const channel = loaded !== null && (loaded.can.email || loaded.can.push || loaded.can.core);

  return (
    <div className={styles.group}>
      <h2>Notifications</h2>
      {failed ? <Alert variant="warning">This needs a connection, and was not saved.</Alert> : null}

      <h3>In your Inbox</h3>
      <p className={styles.muted}>
        What is written to your Inbox. A kind you turn off is not written at all.
      </p>
      <ul className={styles.list}>
        {NOTICE_KINDS.map((kind) => (
          <li key={kind}>
            <Checkbox
              label={LABELS[kind]}
              checked={loaded !== null && !off.includes(kind)}
              disabled={loaded === null}
              onChange={(on) =>
                void save({
                  noticesOff: NOTICE_KINDS.filter((each) =>
                    each === kind ? !on : off.includes(each),
                  ),
                })
              }
            />
          </li>
        ))}
      </ul>

      <h3>Outside the app</h3>
      {loaded === null ? null : !channel ? (
        <p className={styles.muted}>
          Nothing leaves Tusk on this server: it has no mail, no push keys and no Sovereign core to
          carry a notification, so a brief and reminders have nowhere to go. Whoever runs it can set
          one up.
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            What goes outside Tusk carries a card’s title, so the title is then in your inbox or on
            your phone, and in whatever carries it. A Desk sealed with a key of its own is not read
            by the server: for it a brief and a reminder say how many cards and when, and never
            what.
          </p>
          <ul className={styles.list}>
            <li>
              <Checkbox
                label="A daily brief of what needs attention"
                checked={loaded.briefOn}
                onChange={(on) => void save({ briefOn: on })}
              />
              {loaded.briefOn ? (
                <label className={styles.inline}>
                  At{' '}
                  <input
                    type="time"
                    aria-label="Time of the daily brief"
                    value={loaded.briefAt}
                    onChange={(event) => {
                      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value))
                        void save({ briefAt: event.target.value });
                    }}
                  />
                </label>
              ) : null}
            </li>
            <li>
              <Checkbox
                label="A reminder when a card is due, at its time"
                checked={loaded.remindersOn}
                onChange={(on) => void save({ remindersOn: on })}
              />
            </li>
            {loaded.can.push ? (
              <li>
                {push === 'unsupported' ? (
                  <p className={styles.muted}>This browser cannot receive push notifications.</p>
                ) : push === 'denied' ? (
                  <p className={styles.muted}>
                    Notifications are blocked for this site in the browser. Allow them there to turn
                    Push on.
                  </p>
                ) : (
                  <Checkbox
                    label="Push on this device"
                    checked={push === 'on'}
                    disabled={push === null}
                    onChange={(on) => {
                      setPushNote(null);
                      void (async () => {
                        if (!on) {
                          await disablePush();
                          return setPush(await pushState());
                        }
                        const done = await enablePush(loaded.pushKey ?? '');
                        if (done === 'limit')
                          setPushNote('This account has as many devices as it can have.');
                        else if (done === 'failed')
                          setPushNote('Push could not be turned on. Try again.');
                        setPush(await pushState());
                      })();
                    }}
                  />
                )}
                {pushNote ? <p className={styles.muted}>{pushNote}</p> : null}
              </li>
            ) : null}
            <li>
              {loaded.can.email ? (
                <Checkbox
                  label="Send by email too"
                  checked={loaded.emailOn}
                  onChange={(on) => void save({ emailOn: on })}
                />
              ) : (
                <p className={styles.muted}>
                  Email is not set up on this server, so nothing is sent by email.
                </p>
              )}
            </li>
          </ul>
          <h4>Also send these Inbox notices</h4>
          <ul className={styles.list}>
            {NOTICE_KINDS.map((kind) => (
              <li key={kind}>
                <Checkbox
                  label={LABELS[kind]}
                  aria-label={`Also send: ${LABELS[kind]}`}
                  checked={sent.includes(kind)}
                  onChange={(on) =>
                    void save({
                      sentKinds: NOTICE_KINDS.filter((each) =>
                        each === kind ? on : sent.includes(each),
                      ),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
