import { Landing } from '@/src/landing/Landing';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';

// The front address (DESIGN.md §14.1). For a visitor, this page; for someone with a session cookie, the proxy has already sent the request to the
// app's first list (`/desk`) before it gets here, and the address stays `/`.
export default function Front() {
  return (
    <AppShell name={site.name}>
      <Landing />
    </AppShell>
  );
}
