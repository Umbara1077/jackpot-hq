// Worker entry: serves the static app and runs the API.
//
// Cloudflare deployed this repo as a *Worker with static assets*, not a Pages project,
// so the Pages-Functions convention (a bare `functions/` folder) is never executed and
// the dashboard refuses env vars ("only has static assets"). This file gives the Worker
// real code: it routes /api/* to the same handlers in `functions/` and hands everything
// else to the static asset server. The handlers stay in Pages-Function shape so the repo
// still works unchanged if it's ever deployed as a Pages project.
import * as aiPick from '../functions/api/ai-pick.js';
import * as sync from '../functions/api/sync.js';
import * as auth from '../functions/api/auth/[action].js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    // Pages Functions receive a context object; build the same shape for these handlers.
    const context = (params = {}) => ({
      request, env, params,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
      next: () => env.ASSETS.fetch(request),
      data: {},
    });

    if (path === '/api/ai-pick') {
      if (request.method === 'OPTIONS') return aiPick.onRequestOptions(context());
      if (request.method === 'GET') return aiPick.onRequestGet(context());
      if (request.method === 'POST') return aiPick.onRequestPost(context());
      return json({ error: 'method not allowed' }, 405);
    }

    if (path === '/api/sync') {
      if (request.method === 'GET') return sync.onRequestGet(context());
      if (request.method === 'POST') return sync.onRequestPost(context());
      return json({ error: 'method not allowed' }, 405);
    }

    const authRoute = /^\/api\/auth\/([A-Za-z0-9_-]+)$/.exec(path);
    if (authRoute) return auth.onRequest(context({ action: authRoute[1] }));

    if (path === '/api' || path.startsWith('/api/')) return json({ error: 'not found' }, 404);

    return env.ASSETS.fetch(request);
  },
};
