import { createHash } from 'node:crypto';

/**
 * When an automatic backup is due (DESIGN.md §21.1, §21.4), pure, with the clock passed in. `hourly`, `6h`, `daily` or `weekly`; the default is `daily`.
 */
export const FREQUENCIES = ['hourly', '6h', 'daily', 'weekly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const MODES = ['manual', 'auto'] as const;
export type Mode = (typeof MODES)[number];

export const DEFAULT_FREQUENCY: Frequency = 'daily';

const HOUR = 60 * 60 * 1000;
export const INTERVAL_MS: Record<Frequency, number> = {
  hourly: HOUR,
  '6h': 6 * HOUR,
  daily: 24 * HOUR,
  weekly: 7 * 24 * HOUR,
};

export const isFrequency = (value: unknown): value is Frequency =>
  typeof value === 'string' && (FREQUENCIES as readonly string[]).includes(value);
export const isMode = (value: unknown): value is Mode =>
  typeof value === 'string' && (MODES as readonly string[]).includes(value);

/** The most a connection is moved by, so that a server's connections do not all fall on one minute: a tenth of the interval, and never over ten minutes. */
const MAX_SPREAD_MS = 10 * 60 * 1000;

/** A fixed amount for an account, from `0` up to a tenth of the interval (ten minutes at most): the same every time, and different between accounts. */
export function spreadMs(accountId: string, frequency: Frequency): number {
  const room = Math.min(MAX_SPREAD_MS, Math.floor(INTERVAL_MS[frequency] / 10));
  const digest = createHash('sha256').update(`tusk-backup-spread:v1:${accountId}`).digest();
  return Math.floor((digest.readUInt32BE(0) / 0x1_0000_0000) * room);
}

/**
 * The next time a connection is due. From a change of mode or frequency, `due` is absent and it is one interval from `now`, plus the account's spread. After
 * a run it is `due`, the time the run was claimed for, plus one interval: **the schedule keeps its place and does not drift by the time a run took**, and the
 * spread, being inside `due`, is not added again. A connection that was missed by more than an interval (the server was off) starts over from `now`.
 */
export function nextBackup(
  frequency: Frequency,
  now: number,
  accountId: string,
  due?: number,
): number {
  const interval = INTERVAL_MS[frequency];
  if (due !== undefined && due <= now && now - due < interval) return due + interval;
  return now + interval + spreadMs(accountId, frequency);
}
