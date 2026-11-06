import { createHash } from 'node:crypto';

/**
 * What a backup is called and what it is said to be (DESIGN.md §21.3), pure. **The name is `YYYY-mm-dd_hh-mm-ss` in UTC,** so that names sort in order
 * whatever the time zone is doing, and under `tusk/` at the root of the repository, which is an ordinary folder outside every vault.
 */
const pad = (n: number) => String(n).padStart(2, '0');

function parts(now: Date) {
  return {
    date: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
    time: `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`,
  };
}

/** `tusk/2026-11-06_14-30-00.json` */
export function backupPath(now: Date): string {
  const { date, time } = parts(now);
  return `tusk/${date}_${time}.json`;
}

/** `Tusk backup 2026-11-06 14:30:00 UTC` */
export function backupMessage(now: Date): string {
  const { date, time } = parts(now);
  return `Tusk backup ${date} ${time.replaceAll('-', ':')} UTC`;
}

/**
 * A short name for the state of what would be written (DESIGN.md §21.4): **the Desk's `seq`, which every applied change moves on, and a stamp for each
 * thing of the workspaces the person owns** (the workspace, its boards and their versions, its people). Equal to the last one's means nothing changed
 * and an automatic backup need not commit. It is a hash: it says nothing of what it was made from. More stamps than strictly needed only cost a spare file;
 * too few would lose a change, so the stamps err toward changing.
 */
export function backupFingerprint(seq: number, stamps: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(`tusk-backup-fingerprint:v1\nseq:${seq}\n`);
  for (const stamp of [...stamps].sort()) hash.update(`${stamp}\n`);
  return hash.digest('hex').slice(0, 32);
}
