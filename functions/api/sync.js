// Cross-device sync for signed-in users: GET returns the saved state blob, POST stores it.
// Prefers Cloudflare D1 (`DB`) — a real SQLite database. Falls back to KV (`USERS`) if
// only that binding exists (older setup).
import { verifySession, sessionSecret } from '../_session.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const syncReady = (env) => !!(env.DB || env.USERS);

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS user_state (
  user_sub TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);`;

function errDetail(e) {
  const parts = [e?.message, e?.cause?.message, e?.cause?.cause?.message, e?.toString?.()];
  return [...new Set(parts.filter(Boolean).map(String))].join(' | ') || 'unknown error';
}

async function ensureSchema(env) {
  if (!env.DB) return;
  if (typeof env.DB.exec === 'function') await env.DB.exec(CREATE_SQL);
  else await env.DB.prepare(CREATE_SQL.replace(/;$/, '')).run();
}

async function loadState(env, sub) {
  if (env.DB) {
    await ensureSchema(env);
    const row = await env.DB.prepare(
      'SELECT state_json FROM user_state WHERE user_sub = ?'
    ).bind(sub).first();
    if (!row?.state_json) return null;
    return JSON.parse(row.state_json);
  }
  const raw = await env.USERS.get('state:' + sub);
  return raw ? JSON.parse(raw) : null;
}

async function saveState(env, sub, text) {
  if (env.DB) {
    await ensureSchema(env);
    const now = Date.now();
    // Prefer plain UPDATE/INSERT over ON CONFLICT — fewer D1 edge-case failures
    const existing = await env.DB.prepare(
      'SELECT user_sub FROM user_state WHERE user_sub = ?'
    ).bind(sub).first();
    if (existing) {
      await env.DB.prepare(
        'UPDATE user_state SET state_json = ?, updated_at = ? WHERE user_sub = ?'
      ).bind(text, now, sub).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO user_state (user_sub, state_json, updated_at) VALUES (?, ?, ?)'
      ).bind(sub, text, now).run();
    }
    return;
  }
  await env.USERS.put('state:' + sub, text);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!syncReady(env)) {
    return json({ error: 'sync not configured (bind D1 as DB, or KV as USERS)' }, 503);
  }
  const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
  if (!user) return json({ error: 'not signed in' }, 401);
  try {
    const state = await loadState(env, user.sub);
    return json({ ok: true, state, backend: env.DB ? 'd1' : 'kv', sub: user.sub });
  } catch (e) {
    return json({ error: 'read failed', detail: errDetail(e) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!syncReady(env)) {
    return json({ error: 'sync not configured (bind D1 as DB, or KV as USERS)' }, 503);
  }
  const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
  if (!user) return json({ error: 'not signed in' }, 401);
  const text = await request.text();
  if (text.length > 512 * 1024) return json({ error: 'state too large' }, 413);
  try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  try {
    await saveState(env, user.sub, text);
    return json({ ok: true, savedAt: Date.now(), backend: env.DB ? 'd1' : 'kv', sub: user.sub });
  } catch (e) {
    return json({ error: 'write failed', detail: errDetail(e) }, 500);
  }
}
