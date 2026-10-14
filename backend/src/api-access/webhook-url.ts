import { lookup } from 'dns/promises';
import { isIP } from 'net';

// Webhooks make the server fetch an address a customer typed in, which is
// the classic way to make it reach things only it can see (the database,
// cloud metadata at 169.254.169.254, other containers). So the target must
// be a public address — checked when the endpoint is saved and again at
// every delivery, since DNS can change in between.

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return isPrivateV4(v.slice(7));
  return (
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe8') ||
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb')
  );
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);
}

// Throws with a user-facing reason when the URL isn't an allowed target.
export async function assertPublicWebhookUrl(
  raw: string,
  allowHttp = process.env.NODE_ENV !== 'production',
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('Webhook URLs must use https');
  }
  if (url.username || url.password)
    throw new Error('Webhook URLs cannot contain credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('Webhook URLs must point to a public internet address');
  }
  return url;
}
