/**
 * Bech32 (BIP-173), decoding only: an age identity is `AGE-SECRET-KEY-1` and 32 bytes in it, and a non-extractable browser key is made from those bytes.
 * The checksum is checked, so that a key with a typo is told apart from a key that is another person's. The text is case-insensitive but not mixed.
 */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: readonly number[]): number {
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) check ^= GENERATORS[i] ?? 0;
  }
  return check >>> 0;
}

const expand = (hrp: string): number[] => [
  ...[...hrp].map((c) => c.charCodeAt(0) >>> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

/** Regroups bits (from 5 to 8, without padding bits that are not zero), or `undefined` if the padding is wrong. */
function convert(data: readonly number[], from: number, to: number): number[] | undefined {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= from || acc !== 0) return undefined;
  return out;
}

export function bech32Decode(text: string): { hrp: string; bytes: Uint8Array } | undefined {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return undefined;
  const lower = text.toLowerCase();
  const split = lower.lastIndexOf('1');
  if (split < 1 || split + 7 > lower.length) return undefined;
  const hrp = lower.slice(0, split);
  const data: number[] = [];
  for (const char of lower.slice(split + 1)) {
    const index = CHARSET.indexOf(char);
    if (index < 0) return undefined;
    data.push(index);
  }
  if (polymod([...expand(hrp), ...data]) !== 1) return undefined;
  const bytes = convert(data.slice(0, -6), 5, 8);
  return bytes ? { hrp, bytes: Uint8Array.from(bytes) } : undefined;
}
