// Local server for the repo + the on-disk ticket store.
//   node scripts/serve.mjs   →   http://localhost:8123
//
// GET/POST /api/store keeps the whole app state in a real file, so tickets survive
// clearing the browser, switching browsers, or losing localStorage. The app posts
// after every change; the store also writes a human-readable tickets.csv.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// fileURLToPath, not URL.pathname: this repo lives under "AI Server 2", and pathname keeps
// the space percent-encoded, which made every static file 404.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Outside the repo on purpose: this folder is OneDrive-synced and Controlled Folder Access
// blocks script writes to it (see README), which would silently break every save.
const DATA = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'JackpotHQ');
const STATE = join(DATA, 'state.json');
const BAK = join(DATA, 'state.bak.json');
const CSV = join(DATA, 'tickets.csv');
mkdirSync(DATA, { recursive: true });

const GAME_NAME = { pb: 'Powerball', mm: 'Mega Millions', m4l: 'Millionaire for Life', p6: 'Pick-6', jc5: 'Jersey Cash 5', p3: 'Pick-3', p4: 'Pick-4', pop: 'Pick-6 POP' };

const json = (res, obj, status = 200) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
};

function readState() {
  for (const f of [STATE, BAK]) {
    if (!existsSync(f)) continue;
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* corrupt — try the backup */ }
  }
  return null;
}

// One row per line played, so the file is readable in Excel without any parsing.
function ticketsCsv(state) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['saved', 'game', 'draw_date', 'session', 'line', 'numbers', 'bonus', 'bet', 'wager', 'ticket_cost', 'addons', 'ticket_id'].join(',')];
  for (const t of state?.tickets || []) {
    const addons = Object.entries(t.addons || {}).filter(([, v]) => v).map(([k]) => k).join(' ');
    const lines = t.lines?.length ? t.lines : [{}];
    lines.forEach((L, i) => {
      const nums = Array.isArray(L.n) ? L.n.join(' ') : (L.n ?? '');
      rows.push([t.created, GAME_NAME[t.g] || t.g, t.date, t.session || '', i + 1, nums, L.b ?? '', L.bet ?? '', L.wager ?? '', i === 0 ? (t.cost ?? '') : '', i === 0 ? addons : '', t.id].map(q).join(','));
    });
  }
  return rows.join('\r\n') + '\r\n';
}

function writeState(text) {
  const state = JSON.parse(text); // throws on bad json — caller returns 400
  if (existsSync(STATE)) { try { copyFileSync(STATE, BAK); } catch { } }
  // write-then-rename so a crash mid-write can never leave a half-file as the live state
  const tmp = STATE + '.tmp';
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, STATE);
  try { writeFileSync(CSV, ticketsCsv(state), 'utf8'); } catch { /* csv is a convenience, never fatal */ }
  return state;
}

function handleStore(req, res) {
  if (req.method === 'GET') {
    const state = readState();
    return json(res, { ok: true, state, dir: DATA, file: STATE, csv: CSV });
  }
  if (req.method !== 'POST') return json(res, { error: 'method not allowed' }, 405);
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 8 * 1024 * 1024) { req.destroy(); }
  });
  req.on('end', () => {
    try {
      const state = writeState(body);
      json(res, { ok: true, savedAt: Date.now(), tickets: (state.tickets || []).length, dir: DATA, file: STATE, csv: CSV });
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
  });
}

createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/api/store') return handleStore(req, res);
  if (p === '/') p = '/index.html';
  const file = join(root, p.replace(/^\/+/, ''));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(8123, () => {
  console.log('Jackpot HQ  →  http://localhost:8123');
  console.log('Tickets saved to ' + STATE);
  console.log('Readable copy  ' + CSV);
});
