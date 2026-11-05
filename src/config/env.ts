import { readFileSync } from 'node:fs';

/** The environment as a plain map, so that every rule about it can be tested with one that was made for the test. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Reads a file; a parameter so that a test need not write one. */
export type ReadFile = (path: string) => string;

/**
 * **The only place the process environment is read** (src/config/process-env.test.ts holds it to that). Everything else is given an `Env`, or
 * asks one of the functions below.
 */
export function processEnv(): Env {
  return process.env;
}

/**
 * A setting, by its name. A secret may arrive as a file named by `NAME_FILE` (contracts/env.md §3), so that it is never in the process list or a
 * log; the file wins when both are given, and the plain `NAME` is read as well, for running it on your own machine. An empty value is no value.
 * A trailing line break is not part of a secret.
 *
 * Throws `SettingFileError`, which names the variable and never the file's contents, when the file cannot be read.
 */
export function readSetting(
  env: Env,
  name: string,
  readFile: ReadFile = (path) => readFileSync(path, 'utf8'),
): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    try {
      return readFile(file).replace(/\r?\n$/, '') || undefined;
    } catch (cause) {
      throw new SettingFileError(`${name}_FILE`, { cause });
    }
  }
  return env[name] || undefined;
}

/** A `NAME_FILE` that could not be read. The message names the variable only: not the path, which may say more than it should, and never a value. */
export class SettingFileError extends Error {
  constructor(
    readonly variable: string,
    options?: ErrorOptions,
  ) {
    super(`${variable} names a file that cannot be read.`, options);
    this.name = 'SettingFileError';
  }
}
