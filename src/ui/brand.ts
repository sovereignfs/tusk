/** The first two letters of the app's name, the first a capital: "Tusk" is "Tu". It is the mark where there is no logo. */
export function markOf(name: string): string {
  const [first = 'T', second = ''] = [...name.trim()];
  return `${first.toUpperCase()}${second}`;
}
