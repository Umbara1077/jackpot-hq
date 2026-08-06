// Cross-device sync for signed-in users: GET returns the saved state blob, POST stores it.
// Requires a KV namespace bound to the Pages project as `USERS`
// (Cloudflare dashboard → Workers & Pages → KV → create namespace → your Pages project →
//  Settings → Bindings → KV namespace → variable name USERS).
import { verifySession, sessionSecret } from '../_session.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.USERS) return json({ error: 'sync not configured (bind a KV namespace as USERS)' }, 503);
  const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
  if (!user) return json({ error: 'not signed in' }, 401);
  const raw = await env.USERS.get('state:' + user.sub);
  return json({ ok: true, state: raw ? JSON.parse(raw) : null });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.USERS) return json({ error: 'sync not configured (bind a KV namespace as USERS)' }, 503);
  const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
  if (!user) return json({ error: 'not signed in' }, 401);
  const text = await request.text();
  if (text.length > 512 * 1024) return json({ error: 'state too large' }, 413);
  try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  await env.USERS.put('state:' + user.sub, text);
  return json({ ok: true, savedAt: Date.now() });
}
