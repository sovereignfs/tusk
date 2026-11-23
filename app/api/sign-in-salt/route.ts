import { passwordsMoving } from '@sovereignfs/auth/server';
import { AppVault } from '@sovereignfs/sdk/vault';
import { authSettings } from '@/src/auth/server';
import { getAuthStore } from '@/src/db/boot';

// The salt a page derives the sign-in value with (auth.md §4, rule 1): the instance's vault id, made once (sdk §9.5). It is no secret.
// `moving` says whether any password stored before the package can still move, so the page sends a password only then (auth.md §8.1).
// Without an account of Tusk's own there is no password to derive: 404, as the sign-in's routes answer.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!authSettings()?.local) return new Response(null, { status: 404 });
  const store = await getAuthStore();
  return Response.json(
    { vaultId: await new AppVault(store).vaultId(), moving: await passwordsMoving(store) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
