// Sign in with Google / Apple for Jackpot HQ.
// Routes (action param): google, google-cb, apple, apple-cb, me, logout
//
// Env vars (Cloudflare Pages → Settings → Environment variables):
//   SESSION_SECRET        — required for any sign-in; any long random string
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET          — enables Google sign-in
//   APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY — enables Apple sign-in
//     (APPLE_CLIENT_ID is the Services ID; APPLE_PRIVATE_KEY is the full .p8 file contents.
//      Sign in with Apple requires an Apple Developer membership.)
import { b64u, signSession, verifySession, sessionCookie, parseJwtPayload } from '../../_session.js';

const SESSION_DAYS = 90;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

const googleReady = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
const appleReady = (env) => !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && env.SESSION_SECRET);

function stateCookie(value) {
  return `jhq_oauth=${value}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}
function readStateCookie(request) {
  const m = /(?:^|;\s*)jhq_oauth=([^;]+)/.exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}
function randomToken() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function establishSession(env, profile) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ ...profile, iat: now, exp: now + SESSION_DAYS * 86400 }, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      location: '/',
      'set-cookie': sessionCookie(token, SESSION_DAYS * 86400),
    },
  });
}
const loginFailed = (msg) =>
  new Response(`<meta charset="utf-8"><body style="font-family:system-ui;background:#0c1310;color:#f2efe4;display:grid;place-items:center;height:100vh"><div><h2>Sign-in didn't complete</h2><p>${msg}</p><p><a style="color:#e8b84b" href="/">Back to Jackpot HQ</a></p></div>`,
    { status: 400, headers: { 'content-type': 'text/html' } });

/* ---- Apple client secret: ES256 JWT signed with the .p8 key ---- */
async function appleClientSecret(env) {
  const pem = env.APPLE_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const header = b64u.encodeStr(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }));
  const payload = b64u.encodeStr(JSON.stringify({
    iss: env.APPLE_TEAM_ID, iat: now, exp: now + 3600, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID,
  }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u.encode(sig)}`;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = params.action;
  const origin = new URL(request.url).origin;

  if (action === 'me') {
    const user = await verifySession(request.headers.get('cookie'), env.SESSION_SECRET);
    return json({
      user: user ? { email: user.email || null, name: user.name || null, provider: user.provider } : null,
      providers: { google: googleReady(env), apple: appleReady(env) },
      sync: !!env.USERS,
    });
  }

  if (action === 'logout') {
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie('x', 0) } });
  }

  if (action === 'google') {
    if (!googleReady(env)) return loginFailed('Google sign-in isn\'t configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_SECRET).');
    const state = randomToken();
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', origin + '/api/auth/google-cb');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    u.searchParams.set('prompt', 'select_account');
    return new Response(null, { status: 302, headers: { location: u.toString(), 'set-cookie': stateCookie(state) } });
  }

  if (action === 'google-cb') {
    const q = new URL(request.url).searchParams;
    if (q.get('error')) return loginFailed('Google said: ' + q.get('error'));
    if (!q.get('state') || q.get('state') !== readStateCookie(request)) return loginFailed('State check failed — start the sign-in again.');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: origin + '/api/auth/google-cb', grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return loginFailed('Token exchange failed.');
    const p = parseJwtPayload(tok.id_token); // trusted: fetched directly from Google over TLS
    if (!p?.sub) return loginFailed('No identity in the response.');
    return establishSession(env, { sub: 'g:' + p.sub, email: p.email, name: p.name, provider: 'google' });
  }

  if (action === 'apple') {
    if (!appleReady(env)) return loginFailed('Apple sign-in isn\'t configured yet (needs the four APPLE_* variables — and an Apple Developer membership).');
    const state = randomToken();
    const u = new URL('https://appleid.apple.com/auth/authorize');
    u.searchParams.set('client_id', env.APPLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', origin + '/api/auth/apple-cb');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'name email');
    u.searchParams.set('response_mode', 'form_post'); // required by Apple when requesting scopes
    u.searchParams.set('state', state);
    return new Response(null, { status: 302, headers: { location: u.toString(), 'set-cookie': stateCookie(state) } });
  }

  if (action === 'apple-cb') {
    // Apple POSTs the result (form_post)
    const form = request.method === 'POST' ? await request.formData() : new URL(request.url).searchParams;
    const get = (k) => (form.get ? form.get(k) : null);
    if (get('error')) return loginFailed('Apple said: ' + get('error'));
    if (!get('state') || get('state') !== readStateCookie(request)) return loginFailed('State check failed — start the sign-in again.');
    const secret = await appleClientSecret(env);
    const r = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: get('code') || '', client_id: env.APPLE_CLIENT_ID, client_secret: secret,
        redirect_uri: origin + '/api/auth/apple-cb', grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return loginFailed('Apple token exchange failed.');
    const p = parseJwtPayload(tok.id_token);
    if (!p?.sub) return loginFailed('No identity in the response.');
    // Apple only sends the user's name on the FIRST authorization, via the `user` form field
    let name = null;
    try { const u = JSON.parse(get('user') || 'null'); name = u?.name ? `${u.name.firstName || ''} ${u.name.lastName || ''}`.trim() : null; } catch { }
    return establishSession(env, { sub: 'a:' + p.sub, email: p.email || null, name, provider: 'apple' });
  }

  return json({ error: 'unknown action' }, 404);
}
