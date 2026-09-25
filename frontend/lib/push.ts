import { apiFetch } from '@/lib/apifetch';

// VAPID public key is inlined at build time (see frontend/Dockerfile) —
// it's public by design, safe to ship in the client bundle.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

// Best-effort, single call per session — never throws, since push is an
// enhancement (in-app notifications already work without it). Silently
// no-ops when VAPID isn't configured, the browser lacks support, or the
// user declines/ignores the permission prompt.
export async function ensurePushSubscription(): Promise<void> {
  try {
    if (!VAPID_PUBLIC_KEY) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const registration = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    await apiFetch('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
    });
  } catch (err) {
    console.error('Push subscription setup failed:', err);
  }
}
