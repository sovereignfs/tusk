import type { RepositoryRef } from '../providers/types';

/**
 * A repository, as a person writes it (DESIGN.md §21.2): `https://github.com/owner/name` with or without `.git` or a trailing slash, `git@github.com:owner/name`,
 * or `owner/name`. **Another host is refused, and so is an address with a password in it**, which would be kept, shown and sent in places a password must not
 * be. Nothing else of the address is kept (no path, query or fragment): what comes out is an owner and a name, and the app builds every address from those.
 * `hosts` are the web hosts the server may talk to: `github.com`, or the Enterprise Server's own host when `TUSK_GITHUB_API_URL` names one.
 */
export type AddressProblem = 'address' | 'host' | 'password';

export type ParsedAddress =
  | { readonly ok: true; readonly ref: RepositoryRef }
  | { readonly ok: false; readonly problem: AddressProblem };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

function refOf(owner: string, rawName: string): ParsedAddress {
  const name = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..')
    return { ok: false, problem: 'address' };
  return { ok: true, ref: { owner, name } };
}

export function parseAddress(input: string, hosts: readonly string[]): ParsedAddress {
  const text = input.trim();
  if (text === '' || text.length > 300) return { ok: false, problem: 'address' };
  const allowed = hosts.map((host) => host.toLowerCase());

  // `user:password@host/owner/name`, with no scheme to say what it is.
  if (/^[^/@\s]+:[^/@\s]+@/.test(text)) return { ok: false, problem: 'password' };

  // git@host:owner/name
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(text);
  if (scp && !text.includes('://')) {
    if (scp[1] !== 'git') return { ok: false, problem: 'host' };
    if (!allowed.includes((scp[2] as string).toLowerCase())) return { ok: false, problem: 'host' };
    const parts = (scp[3] as string).replace(/\/$/, '').split('/');
    return parts.length === 2
      ? refOf(parts[0] as string, parts[1] as string)
      : { ok: false, problem: 'address' };
  }

  // https://host/owner/name
  if (text.includes('://') || text.includes('@')) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, problem: 'address' };
    }
    // A password, or a user name that is the other half of one, in an address that would be kept: refused before the host is looked at.
    if (url.password !== '' || url.username !== '') return { ok: false, problem: 'password' };
    if (url.protocol !== 'https:') return { ok: false, problem: 'address' };
    if (!allowed.includes(url.hostname.toLowerCase())) return { ok: false, problem: 'host' };
    if (url.search !== '' || url.hash !== '') return { ok: false, problem: 'address' };
    const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
    return parts.length === 2
      ? refOf(parts[0] as string, parts[1] as string)
      : { ok: false, problem: 'address' };
  }

  // owner/name
  const parts = text.split('/');
  return parts.length === 2
    ? refOf(parts[0] as string, parts[1] as string)
    : { ok: false, problem: 'address' };
}

/** The web hosts a repository may be on, for an API address: GitHub's own, or the Enterprise Server the setting names. */
export function webHostsFor(apiUrl: string): string[] {
  const host = new URL(apiUrl).hostname;
  // `api.github.com` is GitHub's own; an Enterprise Server serves its API and its pages from one host.
  return host === 'api.github.com' ? ['github.com', 'www.github.com'] : [host];
}

/** Where a connected repository is on the web, for a link: built from the API address the server was given and the owner and name it checked. */
export function webUrlOf(apiUrl: string, repository: string): string {
  const url = new URL(apiUrl);
  const origin = url.hostname === 'api.github.com' ? 'https://github.com' : url.origin;
  return `${origin}/${repository}`;
}
