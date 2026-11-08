/**
 * Web Push from the device's side (DESIGN.md §25.2, task 8.4): turning it on and off **for this device**, from this device. The browser makes the subscription
 * (its address at the push service, and the keys that encrypt to it), and the server keeps it for the account that is signed in. Nothing here runs unless the person
 * presses the switch: asking for the permission is a prompt, and a page that asks without being asked is one a browser learns to refuse.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/** A base64url string as the bytes `subscribe` wants for the application server key. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(key.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    // A worker that never becomes ready (none registered, one still installing) is no subscription: the answer is not waited for forever.
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
    ]);
    if (!registration) return 'off';
    return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export type Enabled = 'on' | 'denied' | 'unsupported' | 'limit' | 'failed';

/** Asks permission, subscribes this device with the server's VAPID key, and tells the server. A subscription the server did not take is given up again. */
export async function enablePush(vapidKey: string): Promise<Enabled> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidKey),
      }));
    const reply = await fetch('/api/push/subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (reply.ok) return 'on';
    await subscription.unsubscribe();
    return reply.status === 409 ? 'limit' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Turns Push off for this device: the server forgets it, and the browser gives the subscription up. */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/push/subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch {
    // Offline: the device keeps it, and the switch says so.
  }
}
