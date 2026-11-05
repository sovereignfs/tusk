import type { RefusalCode } from './format';

/**
 * What to tell a person when the server refused a change (DESIGN.md §8.4): the only thing of the whole sync that ever reaches them. It says what
 * happened to *their* change and what they can do, in their words, and none of it says anything the server did not already say to this device.
 */
const BY_CODE: Record<RefusalCode, string> = {
  invalid: 'That change could not be saved, and has been undone.',
  unavailable:
    'That change could not be saved because what it was for is gone, and has been undone.',
  structure:
    'That change could not be saved because it would break how tasks fit together, and has been undone.',
  limit:
    'That change could not be saved because you have as many lists or tasks as an account can hold, and has been undone.',
};

export const refusalMessage = (code: RefusalCode): string => BY_CODE[code];
