// Shared session helpers for Pages Functions (signed, stateless cookies — no DB reads to authenticate)
const enc = new TextEncoder();

export const b64u = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  encodeStr: (s) => b64u.encode(enc.encode(s)),
  decodeToStr: (s) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  },
};

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(payload, secret) {
  const body = b64u.encodeStr(JSON.stringify(payload));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u.encode(mac)}`;
}

export async function verifySession(cookieHeader, secret) {
  if (!cookieHeader || !secret) return null;
  const m = /(?:^|;\s*)jhq_sess=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const [body, mac] = m[1].split('.');
  if (!body || !mac) return null;
  try {
    const expected = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
    if (b64u.encode(expected) !== mac) return null;
    const payload = JSON.parse(b64u.decodeToStr(body));
    if (!payload.sub || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

export function sessionCookie(token, maxAgeSec) {
  return `jhq_sess=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function parseJwtPayload(jwt) {
  try { return JSON.parse(b64u.decodeToStr(jwt.split('.')[1])); } catch { return null; }
}
