'use strict';
/* ============================================================
   Jackpot HQ — NJ Lottery tracker & number lab
   Single-file app · data saved locally in your browser
   ============================================================ */

/* ---------- tiny utils ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => nyISO(new Date());
function rnd(n) { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; }
function sampleUnique(count, max) { const set = new Set(); while (set.size < count) set.add(1 + rnd(max)); return [...set].sort((a, b) => a - b); }
function nCr(n, r) { if (r < 0 || r > n) return 0; r = Math.min(r, n - r); let v = 1; for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1); return Math.round(v); }
function fmtOdds(x) { return '1 in ' + Math.round(x).toLocaleString(); }
function fmtMoney(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v % 1e9 ? 2 : 0).replace(/\.0+$/, '') + 'B';
  if (v >= 1e6) return '$' + +(v / 1e6).toFixed(v % 1e6 >= 5e4 ? 1 : 0) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + (+v.toFixed(2)).toLocaleString();
}
const fmtUSD = v => '$' + (+v).toLocaleString(undefined, { minimumFractionDigits: (v % 1 ? 2 : 0), maximumFractionDigits: 2 });
const IS_HOSTED = typeof window !== 'undefined' && !!window.claude; // claude.ai artifact runtime
function saveFile(filename, text) {
  if (window.claude?.downloads) {
    window.claude.downloads.save({ filename, data: text })
      .then(() => toast('Saved ' + filename, true))
      .catch(err => {
        if (err?.code === 'declined') return;
        if (err?.code === 'rejected_extension' || err?.code === 'extension_not_enabled') toast('This hosted copy can\'t save that file type — use the PC copy for it.');
        else toast('Couldn\'t save the file (' + (err?.code || 'error') + ')');
      });
    return;
  }
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- New-York time engine (DST-safe) ---------- */
const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
function nyParts(date) {
  const p = {}; for (const { type, value } of NYF.formatToParts(date)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday) };
}
function nyISO(date) { const p = nyParts(date); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`; }
function nyDateAt(y, m, d, hh, mm) { // UTC instant for a NY wall-clock time
  let t = Date.UTC(y, m - 1, d, hh, mm) + 5 * 3600e3;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(new Date(t));
    t += Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  }
  return new Date(t);
}
function addDaysISO(iso, days) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + days)); return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`; }

/* ---------- game definitions (verified Aug 2026) ---------- */
/* draws: [{days:[0-6 NY weekdays], hh, mm, cutoffMin (mins before draw sales close in NJ), session}] */
const GAMES = {
  pb: {
    name: 'Powerball', short: 'PB', color: 'var(--pb)', ballClass: 'pbball',
    tag: 'The monster multi-state jackpot', price: 2,
    matrix: { pick: 5, max: 69, bonus: 'Powerball', bonusMax: 26 },
    draws: [{ days: [1, 3, 6], hh: 22, mm: 59, cutoffMin: 60 }],
    addons: [{ id: 'pp', label: 'Power Play (+$1/line)', per: 1 }, { id: 'dp', label: 'Double Play (+$1/line)', per: 1 }],
    fetch: { url: 'https://data.ny.gov/resource/d6yy-54nr.json?$order=draw_date%20DESC&$limit=300', map: r => { const w = r.winning_numbers.trim().split(/\s+/).map(Number); return { d: r.draw_date.slice(0, 10), n: w.slice(0, 5), b: w[5], m: +r.multiplier || null, dp: r.double_play_winning_numbers ? r.double_play_winning_numbers.trim().split(/\s+/).map(Number).slice(0, 5) : null, dpb: r.double_play_winning_numbers ? +r.double_play_winning_numbers.trim().split(/\s+/).pop() : null }; } },
    seed: 'pb', bonusKey: 'pb',
    prizes: [
      { k: 5, b: 1, label: 'JACKPOT', jackpot: true },
      { k: 5, b: 0, label: '$1,000,000', amt: 1e6, noMult: true, note: '$2M with Power Play' },
      { k: 4, b: 1, label: '$50,000', amt: 5e4 },
      { k: 4, b: 0, label: '$100', amt: 100 },
      { k: 3, b: 1, label: '$100', amt: 100 },
      { k: 3, b: 0, label: '$7', amt: 7 },
      { k: 2, b: 1, label: '$7', amt: 7 },
      { k: 1, b: 1, label: '$4', amt: 4 },
      { k: 0, b: 1, label: '$4', amt: 4 },
    ],
    multNote: 'Power Play (2–10×) multiplies non-jackpot prizes; 5-of-5 becomes $2M.',
    dpPrizes: [
      { k: 5, b: 1, label: '$10,000,000', amt: 1e7 }, { k: 5, b: 0, label: '$500,000', amt: 5e5 },
      { k: 4, b: 1, label: '$50,000', amt: 5e4 }, { k: 4, b: 0, label: '$500', amt: 500 },
      { k: 3, b: 1, label: '$500', amt: 500 }, { k: 3, b: 0, label: '$20', amt: 20 },
      { k: 2, b: 1, label: '$20', amt: 20 }, { k: 1, b: 1, label: '$10', amt: 10 }, { k: 0, b: 1, label: '$7', amt: 7 },
    ],
    jackpotSeed: 786e6, jackpotCashSeed: 341.6e6, jackpotStarts: '$20M',
  },
  mm: {
    name: 'Mega Millions', short: 'MM', color: 'var(--mm)', ballClass: 'mmball',
    tag: '$5 play · built-in 2–10× multiplier', price: 5,
    matrix: { pick: 5, max: 70, bonus: 'Mega Ball', bonusMax: 24 },
    draws: [{ days: [2, 5], hh: 23, mm: 0, cutoffMin: 60 }],
    addons: [],
    fetch: { url: 'https://data.ny.gov/resource/5xaw-6ayf.json?$order=draw_date%20DESC&$limit=300', map: r => { const w = r.winning_numbers.trim().split(/\s+/).map(Number); return { d: r.draw_date.slice(0, 10), n: w.slice(0, 5), b: +r.mega_ball }; } },
    seed: 'mm', bonusKey: 'mb',
    prizes: [
      { k: 5, b: 1, label: 'JACKPOT', jackpot: true },
      { k: 5, b: 0, label: '$1,000,000+', amt: 1e6 },
      { k: 4, b: 1, label: '$10,000+', amt: 1e4 },
      { k: 4, b: 0, label: '$500+', amt: 500 },
      { k: 3, b: 1, label: '$200+', amt: 200 },
      { k: 3, b: 0, label: '$10+', amt: 10 },
      { k: 2, b: 1, label: '$10+', amt: 10 },
      { k: 1, b: 1, label: '$7+', amt: 7 },
      { k: 0, b: 1, label: '$5+', amt: 5 },
    ],
    multNote: 'Every ticket gets a random 2–10× multiplier — shown base prizes multiply by the one printed on your ticket.',
    jackpotSeed: 70e6, jackpotCashSeed: 29.7e6, jackpotStarts: '$50M',
  },
  m4l: {
    name: 'Millionaire for Life', short: 'M4L', color: 'var(--m4l)', ballClass: 'm4lball',
    tag: '$1,000,000 a year — for life', price: 5,
    matrix: { pick: 5, max: 58, bonus: 'Millionaire Ball', bonusMax: 5 },
    draws: [{ days: [0, 1, 2, 3, 4, 5, 6], hh: 23, mm: 15, cutoffMin: 60 }],
    addons: [],
    fetch: { url: 'https://data.ny.gov/resource/a4w9-a3tp.json?$order=draw_date%20DESC&$limit=300', map: r => { const w = r.winning_numbers.trim().split(/\s+/).map(Number); return { d: r.draw_date.slice(0, 10), n: w.slice(0, 5), b: +r.mill_ball }; } },
    seed: 'm4l', bonusKey: 'mlb',
    prizes: [
      { k: 5, b: 1, label: '$1M/yr for life', jackpot: true, note: '$18M cash option' },
      { k: 5, b: 0, label: '$100K/yr for life', amt: 22e5, note: '$2.2M cash option' },
      { k: 4, b: 1, label: '$7,500', amt: 7500 },
      { k: 4, b: 0, label: '$500', amt: 500 },
      { k: 3, b: 1, label: '$250', amt: 250 },
      { k: 3, b: 0, label: '$50', amt: 50 },
      { k: 2, b: 1, label: '$25', amt: 25 },
      { k: 2, b: 0, label: '$8', amt: 8 },
      { k: 1, b: 1, label: '$8', amt: 8 },
    ],
    fixedJackpot: 18e6, fixedJackpotLabel: '$1M/YR · $18M CASH',
    launched: 'Launched Feb 22, 2026 — replaced Cash4Life. Daily draws at 11:15 PM, sales close 10:15 PM.',
  },
  p6: {
    name: 'Pick-6', short: 'P6', color: 'var(--p6)',
    tag: 'The Jersey classic — now 6 of 46', price: 2,
    matrix: { pick: 6, max: 46 },
    draws: [{ days: [1, 4, 6], hh: 22, mm: 57, cutoffMin: 4 }],
    addons: [{ id: 'dp', label: 'Double Play (+$1/line)', per: 1 }],
    seed: 'p6',
    prizes: [
      { k: 6, b: 0, label: 'JACKPOT', jackpot: true },
      { k: 5, b: 0, label: '≈$1,300', amt: 1300, pari: true },
      { k: 4, b: 0, label: '≈$27', amt: 27, pari: true },
      { k: 3, b: 0, label: '$2', amt: 2 },
    ],
    multNote: 'XTRA multiplier is built into the $2 play and can boost non-jackpot prizes. Pari-mutuel amounts vary by draw.',
    dpPrizes: [
      { k: 6, b: 0, label: '$250,000', amt: 25e4 }, { k: 5, b: 0, label: '≈$2,000', amt: 2000, pari: true },
      { k: 4, b: 0, label: '≈$88', amt: 88, pari: true }, { k: 3, b: 0, label: '$3', amt: 3 },
    ],
    jackpotSeed: 2.8e6, jackpotStarts: '$2M', manualResults: true,
  },
  jc5: {
    name: 'Jersey Cash 5', short: 'JC5', color: 'var(--jc5)',
    tag: 'NJ-only · best 5-ball odds in the state', price: 2,
    matrix: { pick: 5, max: 45, bullseye: true },
    draws: [{ days: [0, 1, 2, 3, 4, 5, 6], hh: 22, mm: 57, cutoffMin: 4 }],
    addons: [{ id: 'xtra', label: 'XTRA 2–5× (+$1/line)', per: 1 }],
    seed: 'jc5',
    prizes: [
      { k: 5, b: 0, label: 'JACKPOT', jackpot: true },
      { k: 4, b: 1, label: '$500', amt: 500, be: true },
      { k: 4, b: 0, label: '≈$250', amt: 250, pari: true },
      { k: 3, b: 1, label: '$30', amt: 30, be: true },
      { k: 3, b: 0, label: '≈$15', amt: 15, pari: true },
      { k: 2, b: 1, label: '$5', amt: 5, be: true },
      { k: 2, b: 0, label: '$2 (XTRA only)', amt: 2, xtraOnly: true },
    ],
    multNote: 'Bullseye is included: one of the 5 winning numbers is drawn as the Bullseye — match it for bigger tiers. XTRA (+$1) multiplies non-jackpot wins 2–5×.',
    jackpotSeed: 597e3, jackpotStarts: '$150K', manualResults: true,
  },
  p3: {
    name: 'Pick-3', short: 'P3', color: 'var(--p3)', digits: 3,
    tag: 'Twice daily · straight pays ≈$275', price: 1,
    draws: [{ days: [0, 1, 2, 3, 4, 5, 6], hh: 12, mm: 59, cutoffMin: 6, session: 'M' }, { days: [0, 1, 2, 3, 4, 5, 6], hh: 22, mm: 57, cutoffMin: 4, session: 'E' }],
    addons: [{ id: 'fireball', label: 'Fireball (doubles wager)', mult: 2 }],
    seed: 'p3',
    prizes: [
      { bet: 'Straight', odds: 1000, label: '≈$275 per $1', amt: 275 },
      { bet: 'Box (3-way)', odds: 333, label: '≈$90 per $1', amt: 90 },
      { bet: 'Box (6-way)', odds: 167, label: '≈$45 per $1', amt: 45 },
      { bet: 'Pair (front/back)', odds: 100, label: '≈$27 per $1', amt: 27 },
    ],
    multNote: 'NJ digit-game payouts are pari-mutuel — amounts shown are typical. Fireball swaps one drawn digit for extra ways to win (halves the base prize).',
    manualResults: true, sessions: true,
  },
  p4: {
    name: 'Pick-4', short: 'P4', color: 'var(--p4)', digits: 4,
    tag: 'Twice daily · straight pays ≈$2,750', price: 1,
    draws: [{ days: [0, 1, 2, 3, 4, 5, 6], hh: 12, mm: 59, cutoffMin: 6, session: 'M' }, { days: [0, 1, 2, 3, 4, 5, 6], hh: 22, mm: 57, cutoffMin: 4, session: 'E' }],
    addons: [{ id: 'fireball', label: 'Fireball (doubles wager)', mult: 2 }],
    seed: 'p4',
    prizes: [
      { bet: 'Straight', odds: 10000, label: '≈$2,750 per $1', amt: 2750 },
      { bet: 'Box (4-way)', odds: 2500, label: '≈$600 per $1', amt: 600 },
      { bet: 'Box (24-way)', odds: 417, label: '≈$100 per $1', amt: 100 },
    ],
    multNote: 'NJ digit-game payouts are pari-mutuel — amounts shown are typical.',
    manualResults: true, sessions: true,
  },
  pop: {
    name: 'Cash Pop', short: 'POP', color: 'var(--pop)',
    tag: '1 number, 1 in 15 · every 4 minutes in-store', price: 1,
    matrix: { pick: 1, max: 15 },
    draws: [], infoOnly: true,
    prizes: [{ bet: 'Your number pops', odds: 15, label: '$5–$250 per $1 (prize printed on ticket)', amt: 0 }],
    multNote: 'Every ticket shows a randomly assigned prize $5–$250 per $1 played. Play $1–$10 per number, or cover more numbers. Log wins in Budget → quick log.',
  },
};
const GAME_IDS = ['pb', 'mm', 'm4l', 'p6', 'jc5', 'p3', 'p4', 'pop'];
const TRACKED = GAME_IDS.filter(g => !GAMES[g].infoOnly);

/* odds for a lotto tier */
function tierOdds(g, k, b) {
  const M = GAMES[g].matrix; if (!M) return null;
  const total = nCr(M.max, M.pick) * (M.bonusMax || 1);
  let ways;
  if (M.bullseye) { // bullseye = one of the drawn numbers
    const base = nCr(M.pick, k) * nCr(M.max - M.pick, M.pick - k);
    ways = b ? base * k / M.pick : base * (M.pick - k) / M.pick;
    if (b === null) ways = base;
  } else if (M.bonusMax) {
    ways = nCr(M.pick, k) * nCr(M.max - M.pick, M.pick - k) * (b ? 1 : (M.bonusMax - 1));
  } else {
    ways = nCr(M.pick, k) * nCr(M.max - M.pick, M.pick - k);
  }
  return ways ? total / ways : null;
}
function jackpotOdds(g) { const M = GAMES[g].matrix; return M ? nCr(M.max, M.pick) * (M.bonusMax || 1) : (GAMES[g].digits ? Math.pow(10, GAMES[g].digits) : null); }
function anyPrizeOdds(g) {
  const G = GAMES[g]; if (!G.matrix || !G.prizes) return null;
  const M = G.matrix; const total = nCr(M.max, M.pick) * (M.bonusMax || 1);
  let ways = 0;
  for (const p of G.prizes) { if (p.xtraOnly) continue; const o = tierOdds(g, p.k, p.b); if (o) ways += total / o; }
  return total / ways;
}

/* ---------- SVG badges (original marks — official logos are trademarked) ---------- */
function badge(g, cls) {
  const B = {
    pb: `<circle cx="32" cy="32" r="29" fill="#fdf9f0"/><circle cx="32" cy="32" r="29" fill="none" stroke="#e0433e" stroke-width="5"/><text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="24" fill="#e0433e">PB</text>`,
    mm: `<defs><radialGradient id="bmm" cx="36%" cy="28%" r="80%"><stop offset="0%" stop-color="#ffe9a8"/><stop offset="60%" stop-color="#f0c04a"/><stop offset="100%" stop-color="#a97c1c"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="url(#bmm)"/><text x="32" y="40" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="21" fill="#1d3a6e">MM</text>`,
    m4l: `<defs><radialGradient id="bm4" cx="36%" cy="28%" r="80%"><stop offset="0%" stop-color="#9af0c2"/><stop offset="60%" stop-color="#2fa36b"/><stop offset="100%" stop-color="#175838"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="url(#bm4)"/><path d="M20 15 l4.5 6 7.5-9 7.5 9 4.5-6 v9 h-24z" fill="#f3dfa6" stroke="#175838" stroke-width="1"/><text x="32" y="46" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="19" fill="#fdf9f0">M4L</text>`,
    p6: `<path d="M32 4 56 18v28L32 60 8 46V18z" fill="#241a3d" stroke="#8f6bd4" stroke-width="3.5"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="28" fill="#c9b3f5">6</text>`,
    jc5: `<circle cx="32" cy="32" r="29" fill="#0e3634"/><circle cx="32" cy="32" r="29" fill="none" stroke="#2aa7a0" stroke-width="4"/><circle cx="32" cy="30" r="13" fill="none" stroke="#7fe0db" stroke-width="3"/><circle cx="32" cy="30" r="5.5" fill="#e8b84b"/><text x="32" y="55" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="13" fill="#7fe0db">CASH 5</text>`,
    p3: `<rect x="6" y="14" width="34" height="36" rx="7" fill="#3d2712" stroke="#e08a3c" stroke-width="3"/><rect x="24" y="20" width="34" height="30" rx="7" fill="#251708" stroke="#b56622" stroke-width="2.5"/><text x="23" y="41" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="22" fill="#ffc98f">P·3</text>`,
    p4: `<rect x="6" y="14" width="34" height="36" rx="7" fill="#3d1a20" stroke="#d4646c" stroke-width="3"/><rect x="24" y="20" width="34" height="30" rx="7" fill="#250b10" stroke="#a83f4a" stroke-width="2.5"/><text x="23" y="41" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="22" fill="#ff9da6">P·4</text>`,
    pop: `<path d="M32 5l6 14 15 1.6-11 10 3.2 14.8L32 37.5 18.8 45.4 22 30.6l-11-10L26 19z" fill="#4a1236" stroke="#d152a4" stroke-width="3" stroke-linejoin="round"/><text x="32" y="36" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="13" fill="#ffb3e2">POP</text>`,
  };
  return `<svg class="badge ${cls || ''}" viewBox="0 0 64 64" aria-hidden="true">${B[g]}</svg>`;
}

/* ---------- state ---------- */
const DEFAULTS = {
  v: 1, tickets: [], results: {}, jackpots: {},
  budget: { limit: 80, manual: [] },
  alerts: { enabled: false, lead: 30, games: { pb: true, mm: true, m4l: true, p6: false, jc5: false, p3: false, p4: false }, jpPB: 500, jpMM: 300 },
  theme: 'auto', lastSync: 0,
  ticketsAt: 0, backupAt: 0, // last ticket saved / last backup taken — drives the ⚠ backup nudge
};
let S;
try { S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('jhq') || '{}')); }
catch { S = { ...DEFAULTS }; }
S.budget = Object.assign({}, DEFAULTS.budget, S.budget);
S.alerts = Object.assign({}, DEFAULTS.alerts, S.alerts);
const FRESH_BROWSER = !localStorage.getItem('jhq'); // nothing local yet → adopt the disk copy wholesale
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('jhq', JSON.stringify(S)); } catch {} try { syncPushSoon(); } catch {} try { diskSaveSoon(); } catch {} }, 120); }

/* ---------- disk store — scripts/serve.mjs writes state.json + tickets.csv ----------
   Runs whenever the app is opened from the local server (Jackpot HQ.cmd), so tickets
   live in a real file instead of only localStorage. No account or network needed. */
const DISK = { on: false, file: '', csv: '', t: null, pulled: false, pullDone: false };
const onLocalServer = () => /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
// Folds a saved copy of the state into the live one without ever dropping a ticket.
// Shared by the disk store, the backup file restore, and the cloud sync.
// adoptScalars: also take the saved settings/results (a fresh browser or an explicit restore).
function mergeState(remote, adoptScalars) {
  if (!remote) return false;
  let changed = false;
  // tickets: union by id, so neither copy can delete a ticket from the other
  const byId = new Map((S.tickets || []).map(t => [t.id, t]));
  for (const t of remote.tickets || []) if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); changed = true; }
  if (changed) S.tickets = [...byId.values()].sort((a, b) => (b.created || '').localeCompare(a.created || '') || String(b.id).localeCompare(String(a.id)));
  const seen = new Set((S.budget.manual || []).map(m => JSON.stringify(m)));
  for (const m of remote.budget?.manual || []) { const k = JSON.stringify(m); if (!seen.has(k)) { S.budget.manual.push(m); seen.add(k); changed = true; } }
  for (const [g, j] of Object.entries(remote.jackpots || {})) {
    if (!S.jackpots[g] || (j.ts || 0) > (S.jackpots[g].ts || 0)) { S.jackpots[g] = j; changed = true; }
  }
  if (adoptScalars) {
    if (remote.results) S.results = Object.assign({}, remote.results, S.results);
    if (typeof remote.budget?.limit === 'number') S.budget.limit = remote.budget.limit;
    if (remote.alerts) S.alerts = Object.assign({}, S.alerts, remote.alerts);
    if (remote.theme) S.theme = remote.theme;
    changed = true;
  }
  return changed;
}
async function diskPull() {
  if (!onLocalServer() || DISK.pulled) return;
  DISK.pulled = true;
  try {
    const r = await fetch('api/store', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    DISK.on = true; DISK.file = j.file || ''; DISK.csv = j.csv || '';
    if (j.state && mergeState(j.state, FRESH_BROWSER)) { save(); applyTheme(); initResults(); refreshCurrentView(); }
  } catch { DISK.on = false; }
  finally { DISK.pullDone = true; }
}
function diskSaveSoon() {
  if (!onLocalServer()) return;
  clearTimeout(DISK.t);
  DISK.t = setTimeout(async () => {
    // never write before the first read lands, or a boot-time save would wipe the file
    if (!DISK.pullDone) return diskSaveSoon();
    try {
      const r = await fetch('api/store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S) });
      const j = await r.json().catch(() => ({}));
      DISK.on = !!j.ok;
      if (j.file) { DISK.file = j.file; DISK.csv = j.csv || ''; }
    } catch { DISK.on = false; }
  }, 600);
}

/* results store: seed + fetched/manual merged, ascending by date */
const RES = {};
function resKey(r) { return r.d + (r.t ? ':' + r.t : ''); }
// chronological sort key — plain resKey would put "E"vening before "M"idday alphabetically
function sortKey(r) { return r.d + (r.t ? (r.t === 'M' ? ':1' : ':2') : ''); }
const byDraw = (a, b) => sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0;
function initResults() {
  for (const g of TRACKED) {
    const seed = (typeof SEED_DRAWS !== 'undefined' && SEED_DRAWS[GAMES[g].seed]) || [];
    const seedNorm = seed.map(r => GAMES[g].bonusKey ? { d: r.d, n: r.n, b: r[GAMES[g].bonusKey], m: r.m || null, dp: r.dp || null, dpb: r.dpb || null } : { ...r });
    const extra = S.results[g] || [];
    const map = new Map();
    for (const r of [...seedNorm, ...extra]) map.set(resKey(r), r);
    RES[g] = [...map.values()].sort(byDraw);
  }
}
function addResults(g, rows) {
  const map = new Map(RES[g].map(r => [resKey(r), r]));
  let added = 0;
  for (const r of rows) { const k = resKey(r); if (!map.has(k)) added++; map.set(k, r); }
  RES[g] = [...map.values()].sort(byDraw);
  S.results[g] = RES[g].slice(-400); // persist a rolling window
  save();
  return added;
}
function latestResult(g) { const rows = RES[g] || []; return rows[rows.length - 1]; }
function resultFor(g, date, session) { return (RES[g] || []).find(r => r.d === date && (!session || r.t === session)); }

/* ---------- draw schedule ---------- */
function nextDraws(g, count = 1, from = new Date()) {
  const G = GAMES[g]; if (!G.draws || !G.draws.length) return [];
  const out = [];
  const start = nyParts(from);
  for (let off = 0; off < 15 && out.length < count; off++) {
    const iso = addDaysISO(`${start.y}-${pad2(start.m)}-${pad2(start.d)}`, off);
    const [y, m, d] = iso.split('-').map(Number);
    for (const slot of G.draws) {
      const when = nyDateAt(y, m, d, slot.hh, slot.mm);
      if (nyParts(when).wd !== undefined && slot.days.includes(nyParts(when).wd) && when > from) {
        out.push({ when, iso, session: slot.session || null, cutoff: new Date(when.getTime() - slot.cutoffMin * 60e3) });
      }
    }
  }
  return out.sort((a, b) => a.when - b.when).slice(0, count);
}
function cdParts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
}
function fmtNextShort(nd) {
  if (!nd) return '—';
  const ms = nd.when - Date.now();
  const p = cdParts(ms);
  if (p.d >= 1) { const w = nyParts(nd.when); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][w.wd] + ' ' + fmtTime(nd.when); }
  if (p.h >= 1) return `in ${p.h}h ${p.m}m`;
  return `in ${p.m}m ${p.s}s`;
}
function fmtTime(date) { const p = nyParts(date); const h12 = ((p.hh + 11) % 12) + 1; return `${h12}:${pad2(p.mm)} ${p.hh >= 12 ? 'PM' : 'AM'}`; }
function fmtDateNice(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }

/* ---------- jackpots: live via the background updater (live.js), manual override, seed fallback ---------- */
function liveData() { return (typeof window !== 'undefined' && window.JHQ_LIVE) ? window.JHQ_LIVE : null; }
function jackpotOf(g) {
  const G = GAMES[g];
  if (G.fixedJackpot) return { amt: G.fixedJackpot, label: G.fixedJackpotLabel, fixed: true };
  const L = liveData();
  const live = L && L.jackpots ? L.jackpots[g] : null;
  const j = S.jackpots[g];
  if (j && (j.ts || 0) > ((L && L.asof) || 0)) return { amt: j.amt, asof: j.asof }; // manual edit newer than last auto-update
  if (live && live.amt) return { amt: live.amt, asof: nyISO(new Date(L.asof)), live: true };
  if (j) return { amt: j.amt, asof: j.asof };
  return { amt: G.jackpotSeed, asof: '2026-08-05', seedDefault: true };
}

/* ============================================================
   PICKER STRATEGIES
   ============================================================ */
function decadeSpread(nums, max) { const buckets = new Set(nums.map(n => Math.floor((n - 1) / 10))); return buckets.size; }
function maxRun(nums) { let run = 1, best = 1; for (let i = 1; i < nums.length; i++) { run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); } return best; }
function isArithmetic(nums) { if (nums.length < 3) return false; const d = nums[1] - nums[0]; return d > 0 && nums.every((v, i) => i === 0 || v - nums[i - 1] === d); }
const FAMOUS = [[1,2,3,4,5],[1,2,3,4,5,6],[2,4,6,8,10],[5,10,15,20,25],[10,20,30,40,50],[1,2,3,5,8],[1,2,3,5,8,13],[4,8,15,16,23],[4,8,15,16,23,42],[7,14,21,28,35],[3,7,11,21,30]];
function crowdScore(g, nums) {
  // 0 (contrarian) → 100 (very popular). Heuristic — affects SHARING only, never odds.
  const M = GAMES[g].matrix; if (!M || M.pick === 1) return null;
  let score = 0; const flags = [];
  const under31 = nums.filter(n => n <= 31).length / nums.length;
  if (under31 === 1) { score += 34; flags.push({ t: 'All numbers ≤ 31 — the birthday zone. Very crowded.', bad: 1 }); }
  else if (under31 >= .8) { score += 20; flags.push({ t: 'Mostly birthday-range numbers (≤31)', bad: 1 }); }
  else if (under31 <= .4) { flags.push({ t: 'Good spread above 31 — fewer birthday players share these', bad: 0 }); }
  const under12 = nums.filter(n => n <= 12).length;
  if (under12 >= Math.min(3, nums.length - 1)) { score += 10; flags.push({ t: 'Heavy in 1–12 (day+month picks)', bad: 1 }); }
  const run = maxRun(nums);
  if (run >= 3) { score += 16; flags.push({ t: `${run} consecutive numbers — popular pattern`, bad: 1 }); }
  if (isArithmetic(nums)) { score += 16; flags.push({ t: 'Perfect arithmetic sequence — thousands play these', bad: 1 }); }
  const mult5 = nums.filter(n => n % 5 === 0).length;
  if (mult5 >= nums.length - 1) { score += 12; flags.push({ t: 'Nearly all multiples of 5', bad: 1 }); }
  if (FAMOUS.some(f => f.length === nums.length && f.every((v, i) => nums[i] === v))) { score += 30; flags.push({ t: 'A famous combo (played by huge crowds every draw!)', bad: 1 }); }
  const spread = decadeSpread(nums, M.max);
  if (spread <= 2 && M.max > 30) { score += 8; flags.push({ t: 'Bunched into few number groups', bad: 1 }); }
  const lastDigits = new Set(nums.map(n => n % 10));
  if (lastDigits.size <= 2 && nums.length >= 5) { score += 8; flags.push({ t: 'Numbers share last digits — pattern players pick these', bad: 1 }); }
  score = Math.min(100, score);
  if (score <= 15) flags.unshift({ t: 'Low crowd score — if this ever hits, fewer people to split with', bad: 0 });
  return { score, flags };
}
function sumBand(g) { const M = GAMES[g].matrix; const mean = M.pick * (M.max + 1) / 2; const sd = Math.sqrt(M.pick * (M.max + 1) * (M.max - M.pick) / 12); return { lo: Math.round(mean - sd), hi: Math.round(mean + sd), mean: Math.round(mean) }; }
function freqTable(g, window) {
  const M = GAMES[g].matrix; const rows = RES[g] || [];
  const use = window ? rows.slice(-window) : rows;
  const f = new Array(M.max + 1).fill(0); const last = new Array(M.max + 1).fill(-1);
  use.forEach((r, i) => r.n.forEach(n => { f[n]++; last[n] = i; }));
  return { f, last, draws: use.length, expected: use.length * M.pick / M.max };
}
function weightedSample(weights, count) {
  const picked = new Set(); const w = weights.slice();
  while (picked.size < count) {
    let tot = 0; for (let i = 1; i < w.length; i++) if (!picked.has(i)) tot += w[i];
    if (tot <= 0) { for (let i = 1; i < w.length && picked.size < count; i++) if (!picked.has(i)) picked.add(i); break; }
    let roll = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * tot;
    for (let i = 1; i < w.length; i++) { if (picked.has(i)) continue; roll -= w[i]; if (roll <= 0) { picked.add(i); break; } }
  }
  return [...picked].sort((a, b) => a - b);
}
const STRATS = {
  quick: {
    name: 'Quick Pick', ico: '🎲', truth: 'Pure crypto-random — the classic.',
    desc: 'True random from a cryptographic generator, like the terminal but fancier.',
    gen(g) { const M = GAMES[g].matrix; return { n: sampleUnique(M.pick, M.max), b: M.bonusMax ? 1 + rnd(M.bonusMax) : null }; },
  },
  smart: {
    name: 'Smart Pick', ico: '🧠', truth: 'Same odds as any pick — built to avoid crowd favorites so a win splits with fewer people.',
    desc: 'Random, then filtered: dodges birthday-heavy, sequential and famous combos that thousands of players share.',
    gen(g) {
      const M = GAMES[g].matrix; const band = sumBand(g);
      for (let tries = 0; tries < 400; tries++) {
        const n = sampleUnique(M.pick, M.max);
        const cs = crowdScore(g, n); const sum = n.reduce((a, b) => a + b, 0);
        const odd = n.filter(x => x % 2).length;
        if (cs.score <= 12 && sum >= band.lo && sum <= band.hi && maxRun(n) < 3 &&
            odd >= Math.floor(M.pick / 2) - 1 && odd <= Math.ceil(M.pick / 2) + 1 &&
            n.filter(x => x > 31).length >= Math.min(2, M.pick - 1) && decadeSpread(n, M.max) >= Math.min(3, Math.ceil(M.max / 10) - 1)) {
          return { n, b: M.bonusMax ? 1 + rnd(M.bonusMax) : null };
        }
      }
      return STRATS.quick.gen(g);
    },
  },
  hot: {
    name: 'Hot Numbers', ico: '🔥', truth: 'For fun only — every ball is equally likely next draw, hot streaks are normal randomness.',
    desc: 'Weights numbers by how often they hit in recent real draws.',
    gen(g) { const M = GAMES[g].matrix; const { f } = freqTable(g, 60); const w = f.map(v => Math.pow(v + .5, 2)); return { n: weightedSample(w, M.pick), b: M.bonusMax ? 1 + rnd(M.bonusMax) : null }; },
  },
  cold: {
    name: 'Overdue', ico: '🧊', truth: 'The “due” feeling is the gambler’s fallacy — but if you enjoy it, play it.',
    desc: 'Favors numbers that haven’t shown up in the longest time.',
    gen(g) { const M = GAMES[g].matrix; const { last, draws } = freqTable(g); const w = last.map((v, i) => i === 0 ? 0 : Math.pow((v < 0 ? draws : draws - 1 - v) + 1, 2)); return { n: weightedSample(w, M.pick), b: M.bonusMax ? 1 + rnd(M.bonusMax) : null }; },
  },
  balanced: {
    name: 'Balanced', ico: '⚖️', truth: 'Statistically “typical-looking” — odds identical, it just avoids extreme outliers.',
    desc: 'Keeps the sum mid-range, mixes odd/even and spreads across the board.',
    gen(g) {
      const M = GAMES[g].matrix; const band = sumBand(g);
      for (let tries = 0; tries < 300; tries++) {
        const n = sampleUnique(M.pick, M.max); const sum = n.reduce((a, b) => a + b, 0);
        const odd = n.filter(x => x % 2).length;
        if (sum >= band.lo && sum <= band.hi && Math.abs(odd - M.pick / 2) <= 1 && decadeSpread(n, M.max) >= Math.min(3, Math.ceil(M.max / 15))) return { n, b: M.bonusMax ? 1 + rnd(M.bonusMax) : null };
      }
      return STRATS.quick.gen(g);
    },
  },
  manual: { name: 'My Numbers', ico: '✍️', truth: 'Pick your own — the Lab grades the crowd-factor as you tap.', desc: 'Tap the board to build your line and get instant analysis.', manual: true },
  ai: { name: 'AI Pick', ico: '✨', truth: 'No AI can beat randomness — these models build smart low-crowd lines from the real draw history and explain their thinking.', desc: 'Claude Fable 5, Opus 5, Grok 4.5 or GPT-5.6 reasons over the real draw data and explains every pick it makes.', ai: true },
};

/* official maker logos: Claude spark for Anthropic models, OpenAI blossom for GPT,
   X mark for xAI/Grok, Gemini star for Google Gemini. */
const LOGO_PATHS = {
  claude: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  openai: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  gemini: 'M20 2C20 12, 28 20, 38 20C28 20, 20 28, 20 38C20 28, 12 20, 2 20C12 20, 20 12, 20 2Z',
};
function aiLogo(key) {
  const tile = (bg, fg, path) => `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="${bg}"/><path transform="translate(8 8)" fill="${fg}" d="${LOGO_PATHS[path]}"/></svg>`;
  const geminiTile = `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#131722"/><defs><linearGradient id="gemGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285F4"/><stop offset="35%" stop-color="#9B51E0"/><stop offset="70%" stop-color="#EA4335"/><stop offset="100%" stop-color="#FBBC05"/></linearGradient></defs><path fill="url(#gemGrad)" d="${LOGO_PATHS.gemini}"/></svg>`;
  const M = {
    fable: tile('#d97757', '#fdf6ee', 'claude'),
    opus: tile('#b85c3f', '#fdf6ee', 'claude'),
    grok: tile('#000', '#fff', 'x'),
    sol: tile('#0f0f10', '#10a37f', 'openai'),
    terra: tile('#0f0f10', '#7fd4a8', 'openai'),
    gemini: geminiTile,
    geminipro: geminiTile,
    geminiflash: geminiTile,
    gemini2flash: geminiTile,
  };
  return `<span class="ailogo">${M[key] || M.fable}</span>`;
}
const AI_MAKER = {
  fable: 'Anthropic', opus: 'Anthropic', grok: 'xAI', sol: 'OpenAI', terra: 'OpenAI',
  geminipro: 'Google', geminiflash: 'Google', gemini2flash: 'Google', gemini: 'Google',
};

/* ============================================================
   ACCOUNT + CROSS-DEVICE SYNC — /api/auth/* and /api/sync
   Password login gate; optional Google/Apple; tickets/settings sync.
   ============================================================ */
let ACCT = { checked: false, user: null, providers: {}, sync: false, syncBackend: null, lastPush: 0 };
let syncT = null;
const LOCAL_SESS_KEY = 'jhq_local_sess';
const onWeb = () => location.protocol !== 'file:' && !(typeof window !== 'undefined' && window.claude);
function localSession() {
  try { return JSON.parse(sessionStorage.getItem(LOCAL_SESS_KEY) || 'null'); } catch { return null; }
}
function setLocalSession(user) {
  if (user) sessionStorage.setItem(LOCAL_SESS_KEY, JSON.stringify(user));
  else sessionStorage.removeItem(LOCAL_SESS_KEY);
}
function showLoginGate(show) {
  const gate = $('#loginGate');
  if (!gate) return;
  gate.classList.toggle('on', !!show);
}
function wireLoginGate() {
  const form = $('#loginGateForm');
  if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin($('#gateUser')?.value.trim() || '', $('#gatePass')?.value.trim() || '', true);
  });
}
async function doLogin(username, password, fromGate) {
  if (!username || !password) return toast('Enter username and password');

  if (onWeb()) {
    try {
      const r = await fetch('api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.ok) {
          setLocalSession(null);
          toast('Signed in as ' + (j.user.name || username), true);
          showLoginGate(false);
          if (!fromGate) closeSheet();
          await authProbe();
          return true;
        }
      } else if (r.status === 401) {
        const j = await r.json().catch(() => ({}));
        return toast(j.error || 'Invalid username or password');
      }
      // 404 / non-function hosts fall through to local admin/admin
    } catch { /* static preview — local fallback */ }
  }

  if (username === 'admin' && password === 'admin') {
    const user = { name: 'admin', email: 'admin', provider: 'password' };
    setLocalSession(user);
    ACCT = { ...ACCT, checked: true, user, providers: { password: true }, sync: false, syncBackend: null };
    toast('Signed in as admin', true);
    showLoginGate(false);
    if (!fromGate) closeSheet();
    paintAcctBtn();
    return true;
  }
  return toast('Invalid username or password');
}
async function authProbe() {
  wireLoginGate();
  const local = localSession();
  if (!onWeb()) {
    ACCT = { checked: true, user: local, providers: { password: true }, sync: false, syncBackend: null, lastPush: 0 };
    paintAcctBtn();
    showLoginGate(!ACCT.user);
    return;
  }
  try {
    const r = await fetch('api/auth/me', { cache: 'no-store' });
    if (!r.ok) throw new Error('auth unavailable');
    const j = await r.json();
    ACCT = { checked: true, user: j.user || local, providers: j.providers || { password: true }, sync: !!j.sync, syncBackend: j.syncBackend || null, lastPush: 0 };
    // Pull cloud → merge, then always push local so tickets created before D1 was live get uploaded.
    if (ACCT.user && ACCT.sync) { await syncPull(); syncPushSoon(true); }
  } catch {
    ACCT = { checked: true, user: local, providers: { password: true }, sync: false, syncBackend: null, lastPush: 0 };
  }
  paintAcctBtn();
  showLoginGate(!ACCT.user);
}
function paintAcctBtn() {
  const b = $('#btn-acct'); if (!b) return;
  b.classList.toggle('attn', !!ACCT.user);
  b.title = ACCT.user ? (ACCT.user.email || ACCT.user.name || 'Signed in') : 'Sign in';
}
function syncPayload() {
  return { tickets: S.tickets, budget: S.budget, jackpots: S.jackpots, alerts: S.alerts, theme: S.theme, aiPass: S.aiPass || '', aiEndpoint: S.aiEndpoint || '', pushedAt: Date.now() };
}
function mergeRemote(remote) {
  if (!remote) return false;
  let changed = false;
  // tickets: union by id (never lose a ticket from either device)
  const byId = new Map((S.tickets || []).map(t => [t.id, t]));
  for (const t of remote.tickets || []) if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); changed = true; }
  S.tickets = [...byId.values()].sort((a, b) => (b.created || '').localeCompare(a.created || '') || String(b.id).localeCompare(String(a.id)));
  // quick-log entries: union
  const seen = new Set((S.budget.manual || []).map(m => JSON.stringify(m)));
  for (const m of remote.budget?.manual || []) { const k = JSON.stringify(m); if (!seen.has(k)) { S.budget.manual.push(m); seen.add(k); changed = true; } }
  // manual jackpot edits: newest timestamp wins per game
  for (const [g, j] of Object.entries(remote.jackpots || {})) {
    if (!S.jackpots[g] || (j.ts || 0) > (S.jackpots[g].ts || 0)) { S.jackpots[g] = j; changed = true; }
  }
  // scalar settings: whoever pushed most recently wins
  if ((remote.pushedAt || 0) > (S.syncedAt || 0)) {
    if (remote.budget && typeof remote.budget.limit === 'number') S.budget.limit = remote.budget.limit;
    if (remote.alerts) S.alerts = Object.assign({}, S.alerts, remote.alerts);
    if (remote.theme) S.theme = remote.theme;
    if (remote.aiPass) S.aiPass = remote.aiPass;
    if (remote.aiEndpoint) S.aiEndpoint = remote.aiEndpoint;
    changed = true;
  }
  S.syncedAt = Math.max(S.syncedAt || 0, remote.pushedAt || 0);
  return changed;
}
async function syncPull() {
  try {
    const r = await fetch('api/sync', { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    if (j.state && mergeRemote(j.state)) { save(); applyTheme(); refreshCurrentView(); }
    return true;
  } catch { return false; }
}
function syncPushSoon(immediate) {
  if (!onWeb() || !ACCT.user || !ACCT.sync) return Promise.resolve(false);
  clearTimeout(syncT);
  const run = async () => {
    try {
      const payload = syncPayload();
      const r = await fetch('api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) { ACCT.lastPush = Date.now(); S.syncedAt = payload.pushedAt; localStorage.setItem('jhq', JSON.stringify(S)); return true; }
    } catch { }
    return false;
  };
  // after login / Sync now: upload right away so existing tickets land in D1
  if (immediate) return run();
  syncT = setTimeout(run, 2500);
  return Promise.resolve(false);
}
function openAccount() {
  if (ACCT.user) {
    openSheet(`<h3>👤 Account: ${esc(ACCT.user.name || 'Signed In')}</h3>
      <p class="muted small">Signed in as <b>${esc(ACCT.user.name)}</b></p>
      <div class="card" style="margin-top:12px">
        <b>${ACCT.sync ? (ACCT.syncBackend === 'd1' ? '☁ Cloud database active' : '🔄 Account Sync Active') : 'Account Status: Active'}</b>
        <p class="muted small" style="margin:5px 0 0">${ACCT.sync
          ? 'Tickets, budget, and settings sync to your Cloudflare database when you save. Spend &amp; won still track from your tickets + draw results.'
          : 'Signed in on this device only. Cloud database isn\'t bound yet — tickets stay in this browser (JSON backup still works).'}</p>
        ${ACCT.sync ? '<div class="rowflex" style="margin-top:10px"><button class="obtn gold" id="syncNow">Sync now</button></div>' : ''}
      </div>
      ${DISK.on ? `<div class="card" style="margin-top:12px">
        <b>💾 Saved to this PC</b>
        <p class="muted small" style="margin:5px 0 0">Every ticket is written to a file the moment you save it:</p>
        <p class="small" style="margin:6px 0 0;word-break:break-all"><code>${esc(DISK.file)}</code></p>
        <p class="muted small" style="margin:6px 0 0">Readable spreadsheet copy: <code>${esc(DISK.csv)}</code></p>
      </div>` : ''}
      ${DISK.on ? '' : `<div class="card" style="margin-top:12px">
        <b>💾 Backup${backupSummary().stale && S.tickets.length ? ' <span style="color:var(--warn,#e0a33c)">⚠</span>' : ''}</b>
        <p class="muted small" style="margin:5px 0 10px">Tickets are stored in this browser. Save a copy to move them between devices.</p>
        <button class="obtn" id="acctBackup" style="width:100%">Backup &amp; restore</button>
      </div>`}
      <div style="margin-top:14px"><button class="obtn" id="signOut" style="width:100%">Sign out</button></div>`);
    const ab = $('#acctBackup'); if (ab) ab.onclick = openBackup;
    const sn = $('#syncNow'); if (sn) sn.onclick = async () => {
      await syncPull();
      const ok = await syncPushSoon(true);
      toast(ok ? 'Synced to cloud' : 'Sync failed — open the Cloudflare URL (not localhost)', !!ok);
    };
    $('#signOut').onclick = async () => {
      ACCT.user = null;
      setLocalSession(null);
      closeSheet();
      paintAcctBtn();
      showLoginGate(true);
      if (onWeb()) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
        } catch { }
      }
      toast('Signed out', true);
    };
    return;
  }

  openSheet(`<h3>Sign In</h3>
    <div class="card" style="margin-top:10px">
      <div class="formrow"><label>Username</label><input id="accUser" placeholder="Username" value="admin"></div>
      <div class="formrow"><label>Password</label><input id="accPass" type="password" placeholder="Password" value="admin"></div>
      <div style="margin-top:14px"><button class="gbtn" id="accLoginBtn">Sign In</button></div>
    </div>`);

  const btn = $('#accLoginBtn');
  if (btn) btn.onclick = () => doLogin($('#accUser').value.trim(), $('#accPass').value.trim(), false);
}

/* ============================================================
   AI PICKS — /api/ai-pick
   ============================================================ */
let AI = { checked: false, ok: false, models: {}, passReq: false };
/* shown before the server has answered (or when it can't) so the picker is always visible */
const AI_FALLBACK_MODELS = {
  fable: { name: 'Claude Fable 5' }, opus: { name: 'Claude Opus 5' }, grok: { name: 'Grok 4.5' },
  sol: { name: 'GPT-5.6 Sol' }, terra: { name: 'GPT-5.6 Terra' },
  geminipro: { name: 'Gemini 3.1 Pro' }, geminiflash: { name: 'Gemini 3.6 Flash' }, gemini2flash: { name: 'Gemini 3.5 Flash' },
};
let aiModel = 'geminiflash', aiNote = null;
function aiEndpoint() {
  if (typeof window !== 'undefined' && window.claude) return null; // hosted artifact: platform blocks outside calls
  if (location.protocol === 'file:') {
    if (!S.aiEndpoint) return null;
    const base = S.aiEndpoint.trim().replace(/\/+$/, '');
    return /\/api\/ai-pick$/.test(base) ? base : base + '/api/ai-pick';
  }
  return 'api/ai-pick';
}
function mergeAiModels(live) {
  const out = {};
  for (const [k, m] of Object.entries(AI_FALLBACK_MODELS)) {
    const srv = live && live[k];
    out[k] = { name: (srv && srv.name) || m.name, available: !!(srv && srv.available) };
  }
  if (live) {
    for (const [k, m] of Object.entries(live)) {
      if (!out[k]) out[k] = { name: m.name, available: !!m.available };
    }
  }
  return out;
}
async function aiProbe() {
  const ep = aiEndpoint();
  if (!ep) { AI = { checked: true, ok: false, models: mergeAiModels(null), passReq: false }; return; }
  try {
    const r = await fetch(ep, { cache: 'no-store' });
    const j = await r.json();
    const models = mergeAiModels(j.models || {});
    AI = { checked: true, ok: !!j.ok, models, passReq: !!j.passcodeRequired };
    const avail = Object.keys(models).filter(k => models[k].available);
    if (avail.length && !avail.includes(aiModel)) aiModel = avail.includes('geminiflash') ? 'geminiflash' : avail[0];
  } catch { AI = { checked: true, ok: false, models: mergeAiModels(null), passReq: false }; }
  if (curView === 'lab') renderLab();
}
function aiModelGrid() {
  const live = AI.ok;
  const modelsMap = Object.keys(AI.models || {}).length ? AI.models : mergeAiModels(null);
  const entries = Object.entries(modelsMap);
  return `
    <div class="formrow" style="margin-bottom:12px">
      <label for="aiModelSelect">Model</label>
      <select id="aiModelSelect" style="font-weight:700;font-size:14.5px">
        ${entries.map(([k, m]) => `<option value="${k}" ${k === aiModel ? 'selected' : ''} ${live && !m.available ? 'disabled' : ''}>${esc(m.name)}${AI_MAKER[k] ? ' — ' + esc(AI_MAKER[k]) : ''}${live && !m.available ? ' (unavailable)' : ''}</option>`).join('')}
      </select>
    </div>
    <div id="aimodels">${entries.map(([k, m]) =>
      `<button data-ai="${k}" class="aimodel ${k === aiModel ? 'on' : ''}" ${live && !m.available ? 'disabled' : ''}>
        ${aiLogo(k)}
        <span class="aimeta"><b>${esc(m.name)}</b><small>${esc(AI_MAKER[k] || '')}</small></span>
      </button>`).join('')}</div>`;
}
function aiPanelHtml() {
  const ep = aiEndpoint();
  if (!ep && typeof window !== 'undefined' && window.claude) {
    return `<div class="card" style="margin-top:10px"><b>AI picks</b><p class="muted small" style="margin:5px 0 0">Open the website to use AI picks.</p></div>`;
  }
  let status = '';
  if (!ep) {
    status = `<div class="card" style="margin-top:12px">
      <div class="formrow"><label>Site URL</label><input id="aiEpIn" placeholder="https://yoursite.pages.dev" value="${esc(S.aiEndpoint || '')}"></div>
      <div class="formrow"><label>Passcode</label><input id="aiPassIn" placeholder="optional" value="${esc(S.aiPass || '')}"></div>
      <div style="margin-top:12px"><button class="gbtn" id="aiEpSave">Connect</button></div></div>`;
  } else if (!AI.checked) {
    status = `<div class="chip" style="margin-top:12px">Loading models…</div>`;
  } else if (!AI.ok) {
    status = `<div class="chip" style="margin-top:12px">AI endpoint unreachable</div>`;
  }
  return aiModelGrid() + status;
}
function askPasscode() {
  openSheet(`<h3>Passcode</h3>
    <div class="formrow"><label>Passcode</label><input id="aiPassEntry" value="${esc(S.aiPass || '')}"></div>
    <div style="margin-top:14px"><button class="gbtn" id="aiPassOk">Continue</button></div>`);
  $('#aiPassOk').onclick = () => { S.aiPass = $('#aiPassEntry').value.trim(); save(); closeSheet(); aiGenerate(); };
}
async function aiGenerate() {
  const G = GAMES[labGame];
  const ep = aiEndpoint();
  if (!ep) return toast('Connect a site URL first');
  if (!AI.ok) return toast('AI endpoint unreachable');
  if (!aiModel) return toast('Pick a model');
  if (!AI.models[aiModel]?.available) return toast((AI_FALLBACK_MODELS[aiModel]?.name || 'That model') + ' is unavailable');
  const m = $('#machine'); const out = $('#labout'); out.innerHTML = ''; m.classList.add('go');
  const gb = $('#genbtn'); if (gb) { gb.disabled = true; gb.textContent = AI.models[aiModel].name + ' is thinking…'; }
  const recent = (RES[labGame] || []).slice(-15).map(r => G.digits
    ? `${r.d}${r.t ? '/' + r.t : ''}: ${r.n}${r.f ? ' FB' + r.f : ''}`
    : `${r.d}: ${r.n.join(' ')}${r.b != null ? ' +' + r.b : ''}`);
  let hot = [], cold = [];
  if (!G.digits && G.matrix && G.matrix.pick > 1) {
    const { f, last, draws } = freqTable(labGame, 60);
    const items = Array.from({ length: G.matrix.max }, (_, i) => ({ n: i + 1, c: f[i + 1], gap: last[i + 1] < 0 ? draws : draws - 1 - last[i + 1] }));
    hot = [...items].sort((a, b) => b.c - a.c).slice(0, 5).map(x => x.n);
    cold = [...items].sort((a, b) => b.gap - a.gap).slice(0, 5).map(x => x.n);
  }
  const J = (G.jackpotSeed || G.fixedJackpot) ? jackpotOf(labGame) : null;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(ep, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(S.aiPass ? { 'x-app-pass': S.aiPass } : {}) },
      body: JSON.stringify({ model: aiModel, game: labGame, count: Math.min(5, labCount), recent, hot, cold, jackpot: J ? fmtMoney(J.amt) : null }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({ error: 'bad response from endpoint' }));
    if (r.status === 401) { askPasscode(); return; }
    if (!r.ok || !j.ok) { toast(j.error || 'AI error ' + r.status); return; }
    labLines = j.lines.map(L => G.digits
      ? ({ n: L.numbers.join(''), why: L.why })
      : ({ n: L.numbers, b: (G.matrix.bonusMax && !G.matrix.bullseye) ? L.bonus : null, why: L.why }));
    aiNote = j.note ? `${j.model} — ${j.note}` : j.model;
    paintLines();
  } catch (e) {
    toast(e.name === 'AbortError' ? 'The AI took too long — try again' : 'AI request failed — check connection');
  } finally {
    clearTimeout(timer); m.classList.remove('go');
    const b = $('#genbtn'); if (b) { b.disabled = false; b.textContent = genLabel(); }
  }
}
function digitGen(g, kind) {
  const D = GAMES[g].digits; const rows = RES[g] || [];
  const posFreq = Array.from({ length: D }, () => new Array(10).fill(0));
  rows.slice(-80).forEach(r => [...r.n].forEach((ch, i) => posFreq[i][+ch]++));
  const pickW = (w) => { let tot = w.reduce((a, b) => a + b, 0); let roll = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * tot; for (let d = 0; d <= 9; d++) { roll -= w[d]; if (roll <= 0) return d; } return 9; };
  let s = '';
  for (let i = 0; i < D; i++) {
    if (kind === 'hot') s += pickW(posFreq[i].map(v => Math.pow(v + .5, 2)));
    else if (kind === 'cold') s += pickW(posFreq[i].map(v => 1 / Math.pow(v + .7, 2)));
    else s += rnd(10);
  }
  if (kind === 'balanced') { // aim for mid-band sum
    const target = [10.5 * D / 3 * 1.286]; // ~13.5 for P3, 18 for P4
    for (let t = 0; t < 60; t++) { const sum = [...s].reduce((a, c) => a + +c, 0); const lo = D === 3 ? 10 : 14, hi = D === 3 ? 17 : 22; if (sum >= lo && sum <= hi) break; s = ''; for (let i = 0; i < D; i++) s += rnd(10); }
  }
  return s;
}

/* ============================================================
   WIN CHECKING
   ============================================================ */
function checkLine(g, line, res, addons) {
  const G = GAMES[g];
  if (G.digits) {
    if (!res) return null;
    const straight = line.n === res.n;
    const box = !straight && [...line.n].sort().join('') === [...res.n].sort().join('');
    let prize = 0, label = null;
    const per = line.wager || 1;
    if (straight) { prize = G.prizes[0].amt * per; label = 'Straight!'; }
    else if (box && line.bet !== 'straight') {
      const uniq = new Set(res.n).size;
      const tier = G.digits === 3 ? (uniq < 3 ? G.prizes[1] : G.prizes[2]) : (uniq < 4 ? G.prizes[1] : G.prizes[2]);
      prize = tier.amt * per; label = 'Box';
    }
    if (!prize && addons?.fireball && res.f != null) {
      // fireball: swapping any one drawn digit for the fireball digit
      const target = line.n;
      for (let i = 0; i < res.n.length; i++) {
        const alt = res.n.slice(0, i) + res.f + res.n.slice(i + 1);
        if (alt === target) { prize = Math.round(G.prizes[0].amt * per / 2); label = 'Fireball straight'; break; }
        if ([...alt].sort().join('') === [...target].sort().join('')) { prize = Math.round((G.prizes[1]?.amt || 45) * per / 2); label = 'Fireball box'; }
      }
    }
    return prize ? { prize, label, approx: true } : { prize: 0 };
  }
  if (!res) return null;
  const M = G.matrix;
  const k = line.n.filter(n => res.n.includes(n)).length;
  const bHit = M.bullseye ? (res.b != null && line.n.includes(res.b) && res.n.includes(res.b) ? 1 : 0)
    : (M.bonusMax ? (line.b === res.b ? 1 : 0) : 0);
  let tier = null;
  for (const p of G.prizes) {
    if (p.k !== k) continue;
    if (M.bullseye) { if (p.b === 1 && !bHit) continue; if (p.b === 0 && p.be) continue; if (p.b === 1 && bHit) { tier = p; break; } if (p.b === 0 && (!p.be)) { if (p.xtraOnly && !addons?.xtra) continue; tier = p; break; } }
    else if ((p.b || 0) === bHit) { tier = p; break; }
  }
  if (M.bullseye && bHit) { // prefer the BE tier when it exists for this k
    const beTier = G.prizes.find(p => p.k === k && p.be);
    if (beTier) tier = beTier;
  }
  if (!tier) return { prize: 0, k, bHit };
  if (tier.jackpot) return { prize: jackpotOf(g).amt, jackpot: true, label: 'JACKPOT!!!', k, bHit };
  let prize = tier.amt;
  let mult = 1;
  if (g === 'jc5' && addons?.xtra && res.m) mult = res.m;
  if (g === 'pb' && addons?.pp && res.m) mult = (k === 5 ? 2 : res.m);
  if (tier.noMult && mult > 2) mult = 2;
  prize *= mult;
  return { prize, label: tier.label + (mult > 1 ? ` ×${mult}` : ''), k, bHit, approx: !!tier.pari || g === 'mm' };
}
function checkTicket(t) {
  const G = GAMES[t.g];
  const res = resultFor(t.g, t.date, t.session);
  if (!res) return { status: 'pending' };
  let total = 0; const outcomes = [];
  for (const line of t.lines) {
    const r = checkLine(t.g, line, res, t.addons) || { prize: 0 };
    outcomes.push(r); total += r.prize || 0;
    if (!G.digits && t.addons?.dp && res.dp) {
      const kdp = line.n.filter(n => res.dp.includes(n)).length;
      const bdp = G.matrix.bonusMax && !G.matrix.bullseye ? (line.b === res.dpb ? 1 : 0) : 0;
      const tier = (G.dpPrizes || []).find(p => p.k === kdp && (p.b || 0) === bdp);
      if (tier) { outcomes[outcomes.length - 1].dpPrize = tier.amt; outcomes[outcomes.length - 1].dpLabel = 'DP: ' + tier.label; total += tier.amt; }
    }
  }
  return { status: total > 0 ? 'win' : 'lose', total, outcomes, res };
}
function ticketCost(g, lines, addons, wager) {
  const G = GAMES[g];
  let per = G.digits ? (wager || 1) : G.price;
  if (G.digits && addons?.fireball) per *= 2;
  if (!G.digits) for (const a of G.addons || []) if (addons?.[a.id]) per += a.per;
  return per * lines;
}

/* ============================================================
   RENDER — HOME
   ============================================================ */
const JACKPOT_GAMES = ['pb', 'mm', 'm4l', 'p6', 'jc5'];
function heroCard(g, i) {
  const G = GAMES[g]; const J = jackpotOf(g); const nd = nextDraws(g, 1)[0];
  return `<div class="card hero ${i ? 'hero2' : ''}">
    <div class="glabel">${badge(g, 'sm')}<span class="gname">${G.name} · ${G.fixedJackpot ? 'top prize' : 'est. jackpot'}</span></div>
    <div class="amt" data-amt="${J.amt}">${fmtMoney(J.amt)}</div>
    <div class="sub">${G.fixedJackpot ? esc(G.fixedJackpotLabel) + (nd ? ' · ' : '') : ''}${nd ? 'draw ' + (nyISO(nd.when) === todayISO() ? 'tonight' : fmtDateNice(nyISO(nd.when))) + ' at ' + fmtTime(nd.when) : ''}</div>
    <div class="cd" data-cdfor="${g}">
      <div class="cell"><b data-u="d">0</b><span>days</span></div>
      <div class="cell"><b data-u="h">00</b><span>hrs</span></div>
      <div class="cell"><b data-u="m">00</b><span>min</span></div>
      <div class="cell"><b data-u="s">00</b><span>sec</span></div>
    </div>
  </div>`;
}
function openAiLab() {
  labStrat = 'ai';
  setView('lab');
  if (!AI.checked) aiProbe();
}
function homeAiBannerHtml() {
  const spark = `<span class="af-spark"><svg viewBox="0 0 24 24"><defs><linearGradient id="homesprk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".55" stop-color="#c56bff"/><stop offset="1" stop-color="#7aa2ff"/></linearGradient></defs><path fill="url(#homesprk)" d="M10.5 2.5 12.6 9l6.5 2.1-6.5 2.1-2.1 6.5-2.1-6.5-6.5-2.1L8.4 9z"/><path fill="url(#homesprk)" d="M18.8 14.6l1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1z"/></svg></span>`;
  return `<button type="button" class="aibanner" id="homeAiBanner">
    ${spark}
    <span class="aibanner-text">
      <b>Try AI Pick</b>
      <span>Smart lottery lines with a clear reason behind every number</span>
    </span>
    <span class="aibanner-go">Open</span>
  </button>`;
}
function renderHome() {
  const v = $('#view-home');
  const heroGames = [...JACKPOT_GAMES].sort((a, b) => jackpotOf(b).amt - jackpotOf(a).amt).slice(0, 3);
  const tonight = TRACKED.map(g => ({ g, nd: nextDraws(g, 1)[0] })).filter(x => x.nd && nyISO(x.nd.when) === todayISO());
  v.innerHTML = `
  <div id="heroStack">${heroGames.map((g, i) => heroCard(g, i)).join('')}</div>
  ${tonight.length ? `<div id="tonightrow"><span class="chip tlabel">🌙 Tonight</span>${tonight.map(x => `<span class="chip" data-open="${x.g}" style="cursor:pointer"><span class="dot" style="background:${GAMES[x.g].color}"></span><b>${GAMES[x.g].name}</b><span class="ctime">${fmtTime(x.nd.when)}</span></span>`).join('')}</div>` : ''}
  ${homeAiBannerHtml()}
  <h2 class="sect">Games <small>tap a card for rules & odds</small></h2>
  <div class="gamegrid">
    ${GAME_IDS.map(g => gameCard(g)).join('')}
  </div>
  <div class="footnote">Winning numbers auto-update for Powerball, Mega Millions & Millionaire for Life (official state open-data).<br>NJ-only games: tap <b>↻</b> on a game card after the draw to type results in — takes 15 seconds.</div>`;
  const aiBan = $('#homeAiBanner'); if (aiBan) aiBan.onclick = openAiLab;
  $$('#view-home .gcard, #tonightrow .chip[data-open]').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-editjp]') || e.target.closest('[data-addres]')) return;
    openGameSheet(el.dataset.open || el.dataset.g);
  }));
  $$('#view-home [data-editjp]').forEach(el => el.addEventListener('click', () => editJackpot(el.dataset.editjp)));
  $$('#view-home [data-addres]').forEach(el => el.addEventListener('click', () => openResultEntry(el.dataset.addres)));
  $$('#heroStack .amt').forEach(countUp);
  tickCountdowns();
}
function gameCard(g) {
  const G = GAMES[g]; const nd = nextDraws(g, 1)[0]; const last = latestResult(g);
  const J = (G.jackpotSeed || G.fixedJackpot) ? jackpotOf(g) : null;
  return `<div class="card gcard goldline" data-g="${g}">
    <div class="top">
      ${badge(g)}
      <div><div class="gtitle">${G.name}</div><div class="gsub">${esc(G.tag)}</div></div>
      ${J ? `<div class="jack" ${!G.fixedJackpot ? `data-editjp="${g}" title="Tap to update jackpot"` : ''}>
        <b>${G.fixedJackpot ? '$1M/yr' : fmtMoney(J.amt)}</b><span>${G.fixedJackpot ? 'for life' : (J.live ? 'live jackpot' : 'est. jackpot ✎')}</span>
      </div>` : `<div class="jack"><b>${G.digits ? '≈$' + G.prizes[0].amt.toLocaleString() : '$5–250'}</b><span>${G.digits ? 'per $1 straight' : 'per $1'}</span></div>`}
    </div>
    <div class="bottom">
      ${G.infoOnly ? '<span class="nextin muted">every 4 min at the retailer</span>'
        : `<span class="nextin" data-nextfor="${g}">Next: <b>${fmtNextShort(nd)}</b>${nd && nd.session ? ' <span class="muted">(' + (nd.session === 'M' ? 'midday' : 'evening') + ')</span>' : ''}</span>`}
      ${last && !G.digits && !G.infoOnly ? `<span class="lastmini">${last.n.slice(0, GAMES[g].matrix.pick).map(n => `<span class="ball xs">${n}</span>`).join('')}${last.b != null && !G.matrix?.bullseye ? `<span class="ball xs bonus">${last.b}</span>` : ''}</span>`
        : last && G.digits ? `<span class="lastmini">${[...last.n].map(d => `<span class="ball xs">${d}</span>`).join('')}</span>` : ''}
      ${G.manualResults ? `<button class="obtn" style="padding:4px 10px;font-size:11px" data-addres="${g}" title="Enter last night's result">↻</button>` : ''}
    </div>
  </div>`;
}
function countUp(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = +el.dataset.amt; if (!target) return;
  const formatted = fmtMoney(target);
  if (el.textContent === formatted) return;
  const t0 = performance.now(); const dur = 1000;
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtMoney(target * e);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = formatted;
  })(t0);
}
function editJackpot(g) {
  const cur = jackpotOf(g);
  const auto = !!liveData();
  openSheet(`
    <h3>${badge(g, 'sm')} Update ${GAMES[g].name} jackpot</h3>
    <p class="muted small">${auto ? 'This updates automatically every few hours on this PC (background updater' + (cur.live ? ' — current value is live' : '') + '). Anything you type here overrides it until the next auto-update.' : 'On this device jackpots are manual — check njlottery.com or the board at your retailer. On your PC they update automatically.'}</p>
    <div class="formrow"><label>Estimated jackpot (millions $)</label><input id="jpin" type="number" inputmode="decimal" min="0.1" step="0.1" value="${(cur.amt / 1e6).toFixed(1)}"></div>
    <div style="margin-top:16px"><button class="gbtn" id="jpsave">Save jackpot</button></div>`);
  $('#jpsave').onclick = () => {
    const v = parseFloat($('#jpin').value);
    if (!isFinite(v) || v <= 0) return toast('Enter a valid amount');
    S.jackpots[g] = { amt: Math.round(v * 1e6), asof: todayISO(), ts: Date.now() }; save();
    closeSheet(); renderHome(); toast(`${GAMES[g].name} jackpot set to ${fmtMoney(v * 1e6)}`, true);
    maybeJackpotAlert();
  };
}

/* ============================================================
   RENDER — LAB
   ============================================================ */
let labGame = 'pb', labStrat = 'smart', labCount = 3, labLines = [], manualSel = [], manualBonus = null;
const genLabel = () => {
  if (labStrat !== 'ai') return 'Generate';
  const name = (AI.models[aiModel]?.name || AI_FALLBACK_MODELS[aiModel]?.name || 'AI');
  return `✨ Generate with ${name}`;
};
function aiFeatureHtml(on) {
  const spark = `<span class="af-spark"><svg viewBox="0 0 24 24"><defs><linearGradient id="aisprk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".55" stop-color="#ffffff"/><stop offset="1" stop-color="#9f7aff"/></linearGradient></defs><path fill="url(#aisprk)" d="M10.5 2.5 12.6 9l6.5 2.1-6.5 2.1-2.1 6.5-2.1-6.5-6.5-2.1L8.4 9z"/><path fill="url(#aisprk)" d="M18.8 14.6l1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1z"/></svg></span>`;
  return `<button class="aifeature ${on ? 'on' : ''}" data-s="ai">
    <div class="af-head">${spark}<b>AI Pick</b><span class="af-tag">${on ? 'Active' : 'Select AI'}</span></div>
    <p>Select your preferred AI brain below — Anthropic Claude, OpenAI GPT, xAI Grok, or Google Gemini analyzes draw trends and generates smart picks with reasoning.</p>
    <div class="af-makers">${aiLogo('fable')}${aiLogo('sol')}${aiLogo('grok')}${aiLogo('geminiflash')}<span>Claude Fable 5 · Opus 5 · GPT-5.6 · Grok 4.5 · Gemini 3.6 Flash</span></div>
  </button>`;
}
function renderLab() {
  const v = $('#view-lab'); const G = GAMES[labGame];
  const strats = G.digits ? ['ai', 'quick', 'hot', 'cold', 'balanced'] : G.matrix?.pick === 1 ? ['quick'] : ['ai', 'quick', 'smart', 'hot', 'cold', 'balanced', 'manual'];
  if (!strats.includes(labStrat)) labStrat = G.digits ? 'quick' : 'smart';
  const hasAI = strats.includes('ai');
  const aiOn = labStrat === 'ai';
  v.classList.toggle('aimode', aiOn && !G.infoOnly);
  const gridHtml = `<div class="stratgrid">
    ${strats.filter(s => s !== 'ai').map(s => { const st = G.digits && s !== 'manual' ? { name: { quick: 'Quick Pick', hot: 'Hot Digits', cold: 'Cold Digits', balanced: 'Balanced Sum' }[s], desc: { quick: 'Crypto-random digits.', hot: 'Digits hitting most, per position (last 80 draws).', cold: 'Digits hitting least, per position.', balanced: 'Random but keeps the sum mid-range.' }[s], ico: { quick: '🎲', hot: '🔥', cold: '🧊', balanced: '⚖️' }[s] } : STRATS[s];
      return `<button class="strat ${s === labStrat ? 'on' : ''}" data-s="${s}"><b><span class="ico">${st.ico}</span>${st.name}</b><p>${st.desc}</p></button>`; }).join('')}
  </div>`;
  const truthHtml = `<div class="chip truth" style="margin-top:10px" id="truthchip">${STRATS[labStrat] && (!G.digits || labStrat === 'ai') ? esc(STRATS[labStrat].truth) : 'Every combination has identical odds — strategies are about fun and (for Smart Pick) not splitting a shared win.'}</div>`;
  const ctlHtml = labStrat === 'manual' && !G.digits ? manualBoard() : `
  <div id="labctl">
    <div class="stepper"><button id="minus">−</button><b id="lcount">${labCount} line${labCount > 1 ? 's' : ''}</b><button id="plus">+</button></div>
    <button class="gbtn ${aiOn ? 'aibtn' : ''}" id="genbtn" style="flex:1">${genLabel()}</button>
  </div>`;
  const tailHtml = `<div id="machine"><div class="drum"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div></div>
  <div id="labout"></div>`;
  v.innerHTML = `
  <h2 class="sect">Number Lab <small>strategy picks</small></h2>
  <div class="gpick">${GAME_IDS.map(g => `<button data-g="${g}" class="${g === labGame ? 'on' : ''}">${badge(g, 'sm')}${GAMES[g].short}</button>`).join('')}</div>
  ${G.infoOnly ? `<div class="card"><b>Cash Pop</b><p class="muted small" style="margin:6px 0 0">${esc(G.multNote)} Odds are 1 in 15 per number — the picker below is just for fun.</p>
    <div style="margin-top:12px"><button class="gbtn" id="popgen">Pop me a number</button></div><div id="popout" style="text-align:center;margin-top:14px"></div></div>`
    : `${hasAI ? aiFeatureHtml(aiOn) : ''}
  ${aiOn
      ? `<div id="aipanel">${aiPanelHtml()}</div>${truthHtml}${ctlHtml}${tailHtml}<div class="sublabel">More ways to pick</div>${gridHtml}`
      : `${gridHtml}${truthHtml}${ctlHtml}${tailHtml}`}`}`;
  $$('.gpick button:not([data-ai])', v).forEach(b => { if (b.dataset.g) b.onclick = () => { labGame = b.dataset.g; labLines = []; aiNote = null; manualSel = []; manualBonus = null; renderLab(); }; });
  // Strategy tiles + featured AI Pick button (data-s) — without this the AI panel never opens
  $$('[data-s]', v).forEach(b => {
    b.onclick = () => {
      const next = b.dataset.s;
      if (!next || next === labStrat) return;
      labStrat = next;
      labLines = [];
      aiNote = null;
      if (labStrat !== 'manual') { manualSel = []; manualBonus = null; }
      renderLab();
      if (labStrat === 'ai' && !AI.checked) aiProbe();
    };
  });
  const sel = $('#aiModelSelect');
  if (sel) sel.onchange = (e) => { aiModel = e.target.value; renderLab(); };
  $$('#aimodels button', v).forEach(b => b.onclick = () => { aiModel = b.dataset.ai; renderLab(); });
  const epSave = $('#aiEpSave');
  if (epSave) epSave.onclick = () => {
    S.aiEndpoint = $('#aiEpIn').value.trim(); S.aiPass = $('#aiPassIn').value.trim(); save();
    AI.checked = false; renderLab(); aiProbe();
  };
  if (G.infoOnly) { const pg = $('#popgen'); if (pg) pg.onclick = () => { $('#popout').innerHTML = `<div class="ballrow popin" style="justify-content:center"><span class="ball" style="--tint:#ffc0e5">${1 + rnd(15)}</span></div>`; }; return; }
  if (labStrat === 'manual' && !G.digits) { wireManual(); return; }
  const minus = $('#minus'); if (minus) minus.onclick = () => { labCount = Math.max(1, labCount - 1); $('#lcount').textContent = labCount + ' line' + (labCount > 1 ? 's' : ''); };
  const plus = $('#plus'); if (plus) plus.onclick = () => { labCount = Math.min(10, labCount + 1); $('#lcount').textContent = labCount + ' line' + (labCount > 1 ? 's' : ''); };
  const genbtn = $('#genbtn'); if (genbtn) genbtn.onclick = generate;
  if (labLines.length) paintLines();
}
function generate() {
  if (labStrat === 'ai') return aiGenerate();
  const G = GAMES[labGame];
  aiNote = null;
  const m = $('#machine'); const out = $('#labout'); out.innerHTML = ''; m.classList.add('go');
  $('#genbtn').disabled = true;
  setTimeout(() => {
    m.classList.remove('go'); $('#genbtn').disabled = false;
    labLines = [];
    for (let i = 0; i < labCount; i++) {
      if (G.digits) labLines.push({ n: digitGen(labGame, labStrat) });
      else labLines.push(STRATS[labStrat].gen(labGame));
    }
    paintLines();
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 950);
}
function lineBalls(g, line, cls) {
  const G = GAMES[g];
  if (G.digits) return `<div class="digitrow">${[...line.n].map(d => `<div class="digit">${d}</div>`).join('')}</div>`;
  return `<div class="ballrow ${cls || ''}">${line.n.map(n => `<span class="ball ${line.hits?.includes(n) ? 'hit' : ''}">${n}</span>`).join('')}${line.b != null ? `<span class="ball bonus ${line.bHit ? 'hit' : ''}">${line.b}</span>` : ''}</div>`;
}
function paintLines() {
  const G = GAMES[labGame]; const out = $('#labout');
  out.innerHTML = labLines.map((L, i) => {
    const cs = !G.digits && G.matrix.pick > 1 ? crowdScore(labGame, L.n) : null;
    const sum = G.digits ? [...L.n].reduce((a, c) => a + +c, 0) : L.n.reduce((a, b) => a + b, 0);
    return `<div class="line">${lineBalls(labGame, L, 'popin')}
      <div class="meta">
        ${cs ? `<span class="chip" title="How many other players likely share numbers like these"><span class="dot" style="background:${cs.score <= 20 ? 'var(--ok)' : cs.score <= 45 ? 'var(--warn)' : 'var(--bad)'}"></span>crowd ${cs.score}</span>` : ''}
        <span class="chip">sum ${sum}</span>
      </div>
      ${L.why ? `<div class="aiwhy">“${esc(L.why)}”</div>` : ''}</div>`;
  }).join('') + `
  ${aiNote ? `<div class="chip" style="margin-top:11px;color:var(--gold);border-color:var(--gold-deep)">🤖 ${esc(aiNote)}</div>` : ''}
  <div class="rowflex" style="margin-top:13px">
    <button class="gbtn" id="saveticket" style="flex:2;min-width:180px">Save as ticket</button>
    <button class="obtn" id="copylines">Copy</button>
    <button class="obtn" id="regen">↻ Again</button>
  </div>
  ${!G.digits && G.matrix.pick > 1 ? `<p class="chip truth" style="margin-top:10px">Crowd score estimates how many OTHER people play similar numbers (birthdays, patterns). Lower = a jackpot would split fewer ways. It cannot change your odds of winning.</p>` : ''}`;
  $('#regen').onclick = generate;
  $('#copylines').onclick = () => {
    const txt = labLines.map(L => G.digits ? L.n : L.n.join('-') + (L.b != null ? ' [' + L.b + ']' : '')).join('\n');
    navigator.clipboard?.writeText(txt).then(() => toast('Copied to clipboard', true), () => toast(txt));
  };
  $('#saveticket').onclick = () => openTicketSave(labGame, labLines.map(L => ({ ...L })));
}
function manualBoard() {
  const M = GAMES[labGame].matrix;
  return `<div class="card" style="margin-top:12px">
    <b>Tap ${M.pick} number${M.pick > 1 ? 's' : ''}</b> <span class="muted small">(${manualSel.length}/${M.pick})</span>
    <div class="numgrid" id="mgrid">${Array.from({ length: M.max }, (_, i) => `<button data-n="${i + 1}" class="${manualSel.includes(i + 1) ? 'sel' : ''}">${i + 1}</button>`).join('')}</div>
    ${M.bonusMax && !M.bullseye ? `<b style="display:block;margin-top:14px">…then the ${GAMES[labGame].matrix.bonus} <span class="muted small">(1–${M.bonusMax})</span></b>
    <div class="numgrid" id="bgrid">${Array.from({ length: M.bonusMax }, (_, i) => `<button data-b="${i + 1}" class="${manualBonus === i + 1 ? 'selb' : ''}">${i + 1}</button>`).join('')}</div>` : ''}
    <div class="analysis" id="manalysis"></div>
    <div class="rowflex" style="margin-top:13px">
      <button class="gbtn" id="msave" style="flex:2" disabled>Save as ticket</button>
      <button class="obtn" id="mclear">Clear</button>
    </div>
  </div>`;
}
function wireManual() {
  const M = GAMES[labGame].matrix;
  const paint = () => {
    $$('#mgrid button').forEach(b => b.classList.toggle('sel', manualSel.includes(+b.dataset.n)));
    $$('#bgrid button').forEach(b => b.classList.toggle('selb', manualBonus === +b.dataset.b));
    const a = $('#manalysis');
    if (manualSel.length >= 2) {
      const cs = crowdScore(labGame, [...manualSel].sort((x, y) => x - y));
      const band = sumBand(labGame); const sum = manualSel.reduce((x, y) => x + y, 0);
      a.innerHTML = cs.flags.map(f => `<span class="chip"><span class="dot" style="background:${f.bad ? 'var(--warn)' : 'var(--ok)'}"></span>${esc(f.t)}</span>`).join('') +
        (manualSel.length === M.pick ? `<span class="chip">sum ${sum} · typical range ${band.lo}–${band.hi}</span>` : '');
    } else a.innerHTML = '';
    $('#msave').disabled = !(manualSel.length === M.pick && (!M.bonusMax || M.bullseye || manualBonus));
  };
  $$('#mgrid button').forEach(b => b.onclick = () => {
    const n = +b.dataset.n;
    if (manualSel.includes(n)) manualSel = manualSel.filter(x => x !== n);
    else if (manualSel.length < M.pick) manualSel.push(n);
    paint();
  });
  $$('#bgrid button').forEach(b => b.onclick = () => { manualBonus = +b.dataset.b; paint(); });
  $('#mclear').onclick = () => { manualSel = []; manualBonus = null; paint(); };
  $('#msave').onclick = () => openTicketSave(labGame, [{ n: [...manualSel].sort((x, y) => x - y), b: M.bullseye ? null : manualBonus }]);
  paint();
}

/* ============================================================
   TICKETS
   ============================================================ */
let tFilter = 'upcoming';
function openTicketSave(g, lines) {
  const G = GAMES[g];
  const nds = nextDraws(g, 6);
  openSheet(`
    <h3>${badge(g, 'sm')} Save ticket · ${G.name}</h3>
    <div style="margin-top:8px">${lines.map(L => `<div class="line">${lineBalls(g, L)}</div>`).join('')}</div>
    <div class="formrow"><label>Draw</label>
      <select id="tdraw">${nds.map((nd, i) => `<option value="${nd.iso}|${nd.session || ''}" ${i === 0 ? 'selected' : ''}>${fmtDateNice(nd.iso)}${nd.session ? ' · ' + (nd.session === 'M' ? 'Midday' : 'Evening') : ''} — ${fmtTime(nd.when)}</option>`).join('')}</select>
    </div>
    ${G.digits ? `<div class="formrow"><label>Bet type</label><select id="tbet"><option value="straight">Straight (exact order)</option><option value="box">Box (any order)</option></select></div>
    <div class="formrow"><label>Wager per line</label><select id="twager"><option value="0.5">$0.50</option><option value="1" selected>$1.00</option><option value="2">$2.00</option><option value="5">$5.00</option></select></div>` : ''}
    ${(G.addons || []).map(a => `<label class="switchrow"><span class="txt"><b>${esc(a.label)}</b></span><span class="sw"><input type="checkbox" id="ad_${a.id}"><i></i></span></label>`).join('')}
    <div class="rowflex" style="margin-top:16px; justify-content:space-between">
      <span class="muted" id="tcostout"></span>
      <button class="gbtn" id="tsave" style="flex:1">Save ticket</button>
    </div>`);
  const costOut = () => {
    const addons = {}; (G.addons || []).forEach(a => addons[a.id] = $('#ad_' + a.id)?.checked ? 1 : 0);
    const wager = G.digits ? parseFloat($('#twager').value) : null;
    $('#tcostout').textContent = 'Cost: ' + fmtUSD(ticketCost(g, lines.length, addons, wager));
  };
  $$('.sheet input,.sheet select').forEach(el => el.addEventListener('change', costOut)); costOut();
  $('#tsave').onclick = () => {
    const [date, session] = $('#tdraw').value.split('|');
    const addons = {}; (G.addons || []).forEach(a => addons[a.id] = $('#ad_' + a.id)?.checked ? 1 : 0);
    const wager = G.digits ? parseFloat($('#twager').value) : null;
    const bet = G.digits ? $('#tbet').value : null;
    S.tickets.unshift({
      id: Date.now() + '' + rnd(999), g, date, session: session || null,
      lines: lines.map(L => ({ ...L, wager, bet })), addons,
      cost: ticketCost(g, lines.length, addons, wager), created: todayISO(),
    });
    S.ticketsAt = Date.now();
    save(); closeSheet(); setView('tickets'); toast('Ticket saved — good luck! 🍀', true);
    scheduleAlerts();
    // web copies keep tickets in this browser only — nudge toward a backup, but never nag
    if (!DISK.on && backupSummary().stale && S.tickets.length % 3 === 1) {
      setTimeout(() => toast('Tip: Budget → Backup keeps these safe if you clear your browser'), 1500);
    }
  };
}
function renderTickets() {
  const v = $('#view-tickets');
  const today = todayISO();
  const enriched = S.tickets.map(t => ({ t, chk: checkTicket(t) }));
  const groups = {
    upcoming: enriched.filter(x => x.chk.status === 'pending'),
    winners: enriched.filter(x => x.chk.status === 'win'),
    past: enriched.filter(x => x.chk.status !== 'pending'),
    all: enriched,
  };
  const list = groups[tFilter] || enriched;
  const totSpent = S.tickets.reduce((a, t) => a + t.cost, 0);
  const totWon = enriched.reduce((a, x) => a + (x.chk.total || 0), 0);
  v.innerHTML = `
  <h2 class="sect">My Tickets <small>${S.tickets.length} saved</small></h2>
  <div class="tfilter">
    ${[['upcoming', 'Waiting on draw'], ['winners', '🏆 Winners'], ['past', 'Checked'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${tFilter === k ? 'on' : ''}">${l}</button>`).join('')}
  </div>
  ${list.length === 0 ? `<div class="card" style="text-align:center; padding:34px 20px">
      <div style="font-size:34px">🎟️</div>
      <b>No tickets here yet</b>
      <p class="muted small" style="margin:6px 0 14px">Generate numbers in the Lab, then save them as a ticket — the app checks them against real results.</p>
      <button class="gbtn" style="max-width:230px;margin:0 auto" onclick="setView('lab')">Open the Lab</button>
    </div>` :
    list.map(({ t, chk }) => ticketCard(t, chk)).join('')}
  ${S.tickets.length ? `<p class="footnote">Lifetime on saved tickets: spent <b>${fmtUSD(totSpent)}</b> · won <b>${fmtUSD(totWon)}</b> · net <b style="color:${totWon - totSpent >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtUSD(totWon - totSpent)}</b></p>` : ''}
  <button class="fab" id="fabAdd" title="New ticket">+</button>`;
  $$('.tfilter button', v).forEach(b => b.onclick = () => { tFilter = b.dataset.f; renderTickets(); });
  $('#fabAdd').onclick = () => setView('lab');
  $$('[data-del]', v).forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    const t = S.tickets.find(x => x.id === id);
    if (confirm('Delete this ' + GAMES[t.g].name + ' ticket?')) { S.tickets = S.tickets.filter(x => x.id !== id); save(); renderTickets(); }
  });
  $$('[data-enterres]', v).forEach(b => b.onclick = () => openResultEntry(b.dataset.enterres));
}
function ticketCard(t, chk) {
  const G = GAMES[t.g];
  const res = chk.res;
  const pillHtml = chk.status === 'pending'
    ? (GAMES[t.g].manualResults && t.date < todayISO() ? `<button class="obtn gold" style="padding:5px 12px;font-size:11px" data-enterres="${t.g}">enter result to check</button>` : '<span class="pill pend">waiting on draw</span>')
    : chk.status === 'win' ? `<span class="pill win">WINNER ${fmtUSD(chk.total)}</span>` : '<span class="pill lose">not this time</span>';
  return `<div class="card ticket goldline">
    <div class="thead">
      ${badge(t.g, 'sm')}
      <div><b>${G.name}</b><div class="tdate">${fmtDateNice(t.date)}${t.session ? ' · ' + (t.session === 'M' ? 'Midday' : 'Evening') : ''}</div></div>
      <div style="margin-left:auto; text-align:right">${pillHtml}<div class="tcost">${t.lines.length} line${t.lines.length > 1 ? 's' : ''} · ${fmtUSD(t.cost)}</div></div>
    </div>
    ${t.lines.map((L, i) => {
      const o = chk.outcomes?.[i];
      const hits = res && !G.digits ? L.n.filter(n => res.n.includes(n)) : [];
      const bHit = res && !G.digits ? (G.matrix.bullseye ? (res.b != null && L.n.includes(res.b)) : L.b === res.b) : false;
      return `<div class="tline">${lineBalls(t.g, { ...L, hits, bHit })}
        ${o && o.prize ? `<span class="prize">+${fmtUSD(o.prize)}${o.approx ? '≈' : ''} <span class="muted small">${esc(o.label || '')}</span></span>` : o && o.dpPrize ? `<span class="prize">+${fmtUSD(o.dpPrize)} <span class="muted small">${esc(o.dpLabel)}</span></span>` : ''}</div>`;
    }).join('')}
    ${res && !G.digits ? `<div class="small muted" style="margin-top:8px">Drawn: ${res.n.join(' · ')}${res.b != null ? ' — ' + (G.matrix.bullseye ? 'Bullseye' : G.matrix.bonus) + ' ' + res.b : ''}${t.addons?.dp && res.dp ? ' · DP: ' + res.dp.join(' · ') : ''}</div>` : ''}
    ${res && G.digits ? `<div class="small muted" style="margin-top:8px">Drawn: ${res.n}${res.f ? ' · Fireball ' + res.f : ''}</div>` : ''}
    <div class="rowflex" style="margin-top:9px; justify-content:flex-end"><button class="obtn" style="font-size:11px; padding:5px 11px" data-del="${t.id}">delete</button></div>
  </div>`;
}

/* ============================================================
   RESULTS — fetch + manual entry
   ============================================================ */
async function syncResults(silent) {
  const btn = $('#btn-sync svg'); btn.classList.add('spin');
  let addedTotal = 0, okAny = false, hadWin = false;
  for (const g of TRACKED) {
    const F = GAMES[g].fetch; if (!F) continue;
    try {
      const rows = await (await fetch(F.url, { mode: 'cors' })).json();
      const mapped = rows.map(F.map).filter(r => r.n && r.n.length);
      addedTotal += addResults(g, mapped); okAny = true;
    } catch (e) { /* offline or blocked — seeds still work */ }
  }
  S.lastSync = Date.now(); save();
  btn.classList.remove('spin');
  const wins = S.tickets.map(t => checkTicket(t)).filter(c => c.status === 'win');
  if (!silent) {
    if (okAny) toast(addedTotal ? `Results updated — ${addedTotal} new draw${addedTotal > 1 ? 's' : ''} in` : 'Results are up to date', true);
    else if (IS_HOSTED) toast('This hosted copy can\'t reach the live feed — enter results with ✎ or open the PC copy to auto-sync');
    else toast('Couldn\'t reach the results feed — check connection');
  }
  refreshCurrentView();
  maybeJackpotAlert();
}
function openResultEntry(g) {
  const G = GAMES[g]; const M = G.matrix;
  const yesterday = addDaysISO(todayISO(), -1);
  openSheet(`
    <h3>${badge(g, 'sm')} Enter ${G.name} result</h3>
    <p class="muted small">Type the winning numbers from njlottery.com or the news — the app then checks your tickets instantly.</p>
    <div class="formrow"><label>Draw date</label><input type="date" id="rdate" value="${todayISO()}" max="${todayISO()}"></div>
    ${G.sessions ? `<div class="formrow"><label>Drawing</label><select id="rsession"><option value="M">Midday (12:59 PM)</option><option value="E" selected>Evening (10:57 PM)</option></select></div>` : ''}
    ${G.digits ? `<div class="formrow"><label>Winning number (${G.digits} digits)</label><input id="rdigits" inputmode="numeric" maxlength="${G.digits}" placeholder="${'0'.repeat(G.digits)}" style="font-size:26px;letter-spacing:.35em;text-align:center;font-family:var(--display)"></div>
      <div class="formrow"><label>Fireball (optional)</label><input id="rfb" inputmode="numeric" maxlength="1" placeholder="–" style="text-align:center"></div>` : `
      <div class="formrow"><label>Winning numbers (${M.pick} of 1–${M.max})</label>
      <div class="rowflex">${Array.from({ length: M.pick }, (_, i) => `<input class="rnum" inputmode="numeric" style="width:62px;text-align:center;font-size:19px" min="1" max="${M.max}" placeholder="–">`).join('')}</div></div>
      ${M.bullseye ? `<div class="formrow"><label>Bullseye (one of the 5 drawn)</label><input id="rbull" inputmode="numeric" style="width:80px;text-align:center" placeholder="–"></div>
      <div class="formrow"><label>XTRA multiplier drawn (2–5, optional)</label><input id="rxtra" inputmode="numeric" style="width:80px;text-align:center" placeholder="–"></div>` : ''}
      ${M.bonusMax && !M.bullseye ? `<div class="formrow"><label>${M.bonus} (1–${M.bonusMax})</label><input id="rbonus" inputmode="numeric" style="width:80px;text-align:center" placeholder="–"></div>` : ''}`}
    <div style="margin-top:16px"><button class="gbtn" id="rsave">Save result & check tickets</button></div>`);
  $('#rsave').onclick = () => {
    const d = $('#rdate').value; if (!d) return toast('Pick the draw date');
    let row = { d };
    if (G.sessions) row.t = $('#rsession').value;
    if (G.digits) {
      const nRaw = $('#rdigits').value.replace(/\D/g, '');
      if (nRaw.length !== G.digits) return toast(`Enter all ${G.digits} digits`);
      row.n = nRaw; const fb = $('#rfb').value.replace(/\D/g, ''); if (fb) row.f = fb;
    } else {
      const nums = $$('.rnum').map(i => parseInt(i.value, 10)).filter(n => isFinite(n));
      if (nums.length !== M.pick || new Set(nums).size !== M.pick || nums.some(n => n < 1 || n > M.max)) return toast(`Enter ${M.pick} different numbers between 1 and ${M.max}`);
      row.n = nums.sort((a, b) => a - b);
      if (M.bullseye) {
        const be = parseInt($('#rbull').value, 10);
        if (isFinite(be)) { if (!row.n.includes(be)) return toast('Bullseye must be one of the 5 drawn numbers'); row.b = be; }
        const xm = parseInt($('#rxtra')?.value, 10); if (isFinite(xm) && xm >= 2 && xm <= 10) row.m = xm;
      } else if (M.bonusMax) {
        const b = parseInt($('#rbonus').value, 10);
        if (!isFinite(b) || b < 1 || b > M.bonusMax) return toast(`Enter the ${M.bonus} (1–${M.bonusMax})`);
        row.b = b;
      }
    }
    addResults(g, [row]);
    closeSheet();
    const winNow = S.tickets.filter(t => t.g === g && t.date === d && (!G.sessions || t.session === row.t)).map(t => checkTicket(t)).filter(c => c.status === 'win');
    if (winNow.length) { const amt = winNow.reduce((a, c) => a + c.total, 0); confetti(); toast(`🏆 WINNER! Your ${G.name} ticket won ${fmtUSD(amt)}`, true); }
    else toast('Result saved — tickets checked', true);
    refreshCurrentView();
  };
}

/* ============================================================
   STATS
   ============================================================ */
let statGame = 'jc5', statWin = 60;
function renderStats() {
  const v = $('#view-stats'); const G = GAMES[statGame];
  const gamesWithData = GAME_IDS.filter(g => !GAMES[g].infoOnly);
  v.innerHTML = `
  <h2 class="sect">Stats <small>real draw history</small></h2>
  <div class="gpick">${gamesWithData.map(g => `<button data-g="${g}" class="${g === statGame ? 'on' : ''}">${badge(g, 'sm')}${GAMES[g].short}</button>`).join('')}</div>
  <div class="rowflex" style="margin-bottom:10px">
    ${[[30, 'Last 30'], [60, 'Last 60'], [0, 'All ' + (RES[statGame]?.length || 0)]].map(([w, l]) => `<button class="obtn ${statWin === w ? 'gold' : ''}" data-w="${w}" style="font-size:12px;padding:6px 13px">${l} draws</button>`).join('')}
  </div>
  <div id="statbody"></div>
  <h2 class="sect">Real talk <small>the honest math</small></h2>
  <div id="realtalk"></div>`;
  $$('.gpick button', v).forEach(b => b.onclick = () => { statGame = b.dataset.g; renderStats(); });
  $$('[data-w]', v).forEach(b => b.onclick = () => { statWin = +b.dataset.w; renderStats(); });
  $('#statbody').innerHTML = G.digits ? digitStats(statGame) : lottoStats(statGame);
  wireTips($('#statbody'));
  $('#realtalk').innerHTML = realTalk();
  wireRealTalk();
}
function lottoStats(g) {
  const G = GAMES[g]; const M = G.matrix;
  const { f, last, draws, expected } = freqTable(g, statWin || null);
  if (!draws) return '<div class="card">No draw history yet — hit ↻ sync or enter results.</div>';
  const maxF = Math.max(...f.slice(1), 1);
  const items = Array.from({ length: M.max }, (_, i) => ({ n: i + 1, c: f[i + 1], gap: last[i + 1] < 0 ? draws : draws - 1 - last[i + 1] }));
  const hot = [...items].sort((a, b) => b.c - a.c || a.n - b.n).slice(0, 5);
  const cold = [...items].sort((a, b) => b.gap - a.gap || a.n - b.n).slice(0, 5);
  const bw = 13, gapPx = 3, w = M.max * (bw + gapPx) + 34, h = 168, base = h - 26;
  const top5set = new Set(hot.map(x => x.n));
  const bars = items.map((it, i) => {
    const bh = Math.max(2, Math.round((it.c / maxF) * (base - 34)));
    const x = 26 + i * (bw + gapPx);
    return `<rect class="bar" data-tip="Number ${it.n} — drawn ${it.c}× in last ${draws} draws (expected ≈${expected.toFixed(1)})" x="${x}" y="${base - bh}" width="${bw}" height="${bh}" rx="3.5" fill="${top5set.has(it.n) ? 'var(--gold)' : 'var(--mark-gold)'}"/>
      ${top5set.has(it.n) ? `<text x="${x + bw / 2}" y="${base - bh - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink2)">${it.c}</text>` : ''}
      ${it.n % 5 === 0 || it.n === 1 ? `<text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="var(--ink3)">${it.n}</text>` : ''}`;
  }).join('');
  const expY = base - Math.round((expected / maxF) * (base - 34));
  const dev = it => (it.c - expected) / (expected || 1);
  const heatCells = items.map(it => {
    const d = dev(it);
    const a = Math.min(1, Math.abs(d) / 0.7);
    const bg = Math.abs(d) < .12 ? 'color-mix(in srgb, var(--mark-mid) 22%, transparent)'
      : d > 0 ? `color-mix(in srgb, var(--mark-gold) ${Math.round(18 + a * 62)}%, transparent)`
        : `color-mix(in srgb, var(--mark-cool) ${Math.round(18 + a * 62)}%, transparent)`;
    return `<div class="cell" data-tip="№${it.n}: ${it.c}× (${d >= 0 ? '+' : ''}${Math.round(d * 100)}% vs expected) · last seen ${it.gap === 0 ? 'latest draw' : it.gap + ' draws ago'}" style="background:${bg}">${it.n}</div>`;
  }).join('');
  return `
  <div class="card">
    <b>How often each number hit</b> <span class="muted small">last ${draws} draws · gold = top 5</span>
    <div class="statwrap"><svg class="freq" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <line x1="24" x2="${w - 4}" y1="${expY}" y2="${expY}" stroke="var(--ink3)" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="${w - 6}" y="${expY - 5}" text-anchor="end" font-size="9.5" fill="var(--ink3)">expected ≈${expected.toFixed(1)}</text>
      <line x1="24" x2="${w - 4}" y1="${base}" y2="${base}" stroke="var(--card-edge)"/>
      ${bars}
    </svg></div>
    <div class="chart-note">Every number's true chance per draw is identical (${(M.pick / M.max * 100).toFixed(1)}%) — differences here are normal randomness, not a pattern.</div>
  </div>
  <div class="card" style="margin-top:11px">
    <b>Hot & cold board</b> <span class="muted small">vs expected frequency · tap a tile</span>
    <div class="heat">${heatCells}</div>
    <div class="legend"><span class="sw" style="background:var(--mark-cool)"></span>drawn less than expected<span class="sw" style="background:color-mix(in srgb, var(--mark-mid) 30%, transparent)"></span>about expected<span class="sw" style="background:var(--mark-gold)"></span>drawn more</div>
  </div>
  <div class="duo" style="margin-top:11px">
    <div class="card"><b>🔥 Hottest</b>${hot.map(x => `<div class="rankrow"><span class="ball xs">${x.n}</span><span class="bar" style="width:${Math.round(x.c / maxF * 92)}px"></span><span class="val">${x.c}×</span></div>`).join('')}</div>
    <div class="card"><b>🧊 Longest missing</b>${cold.map(x => `<div class="rankrow coldbar"><span class="ball xs">${x.n}</span><span class="bar" style="width:${Math.round(x.gap / Math.max(...cold.map(c => c.gap), 1) * 92)}px"></span><span class="val">${x.gap} draws</span></div>`).join('')}</div>
  </div>
  <div class="card" style="margin-top:11px">
    <b>Latest draws</b>
    ${RES[g].slice(-8).reverse().map(r => `<div class="rankrow"><span class="small muted" style="min-width:86px">${fmtDateNice(r.d)}</span><span class="ballrow">${r.n.map(n => `<span class="ball xs">${n}</span>`).join('')}${r.b != null ? `<span class="ball xs bonus">${r.b}</span>` : ''}</span></div>`).join('')}
  </div>`;
}
function digitStats(g) {
  const G = GAMES[g]; const rows = (RES[g] || []).slice(-(statWin || 9999));
  if (!rows.length) return '<div class="card">No draw history yet.</div>';
  const D = G.digits;
  const posFreq = Array.from({ length: D }, () => new Array(10).fill(0));
  rows.forEach(r => [...r.n].forEach((ch, i) => posFreq[i][+ch]++));
  const maxAll = Math.max(...posFreq.flat(), 1);
  return `
  <div class="card">
    <b>Digit heat by position</b> <span class="muted small">last ${rows.length} drawings</span>
    <table class="tiletable" style="margin-top:10px"><tr><th></th>${Array.from({ length: 10 }, (_, d) => `<th style="text-align:center">${d}</th>`).join('')}</tr>
    ${posFreq.map((row, i) => `<tr><td class="muted small">pos ${i + 1}</td>${row.map((c, d) => { const a = c / maxAll; return `<td style="text-align:center;border-radius:8px;background:color-mix(in srgb, var(--mark-gold) ${Math.round(a * 62)}%, transparent)" data-tip="Digit ${d} in position ${i + 1}: ${c}×">${c}</td>`; }).join('')}</tr>`).join('')}
    </table>
    <div class="chart-note">Each digit has a flat 10% chance per position, always. This board just shows the recent shake-out.</div>
  </div>
  <div class="card" style="margin-top:11px"><b>Latest drawings</b>
    ${rows.slice(-10).reverse().map(r => `<div class="rankrow"><span class="small muted" style="min-width:110px">${fmtDateNice(r.d)} ${r.t === 'M' ? '☀️' : '🌙'}</span><span class="digitrow">${[...r.n].map(d => `<div class="digit" style="width:34px;height:42px;font-size:22px">${d}</div>`).join('')}</span>${r.f ? `<span class="chip" style="margin-left:8px">FB ${r.f}</span>` : ''}</div>`).join('')}
  </div>`;
}
function realTalk() {
  const rows = TRACKED.map(g => {
    const jo = jackpotOdds(g); const any = anyPrizeOdds(g);
    return `<tr><td><span class="rowflex" style="gap:7px">${badge(g, 'sm')}<b>${GAMES[g].short}</b></span></td><td>${GAMES[g].digits ? '$' + GAMES[g].price + '+' : '$' + GAMES[g].price}</td><td>${fmtOdds(jo)}</td><td>${any ? fmtOdds(any) : GAMES[g].digits ? '1 in ' + Math.pow(10, GAMES[g].digits).toLocaleString() + ' (straight)' : '—'}</td></tr>`;
  }).join('');
  return `
  <div class="card">
    <b>Game vs game</b> <span class="muted small">what a single line buys you</span>
    <div class="statwrap"><table class="tiletable" style="margin-top:8px; min-width:480px">
      <tr><th>Game</th><th>Price</th><th>Top-prize odds</th><th>Any-prize odds</th></tr>${rows}
    </table></div>
    <div class="chart-note">Best jackpot odds per dollar in NJ: Jersey Cash 5, then Pick-6. The giants (PB/MM) trade terrible odds for life-changing prizes.</div>
  </div>
  <div class="card" style="margin-top:11px">
    <b>Reality-check calculator</b>
    <div class="rowflex" style="margin-top:10px">
      <select id="rcGame" style="flex:1;font:inherit;color:var(--ink);background:var(--card-solid);border:1px solid var(--card-edge);border-radius:12px;padding:10px">${TRACKED.filter(g => !GAMES[g].digits).map(g => `<option value="${g}" ${g === 'pb' ? 'selected' : ''}>${GAMES[g].name}</option>`).join('')}</select>
      <select id="rcLines" style="font:inherit;color:var(--ink);background:var(--card-solid);border:1px solid var(--card-edge);border-radius:12px;padding:10px">${[1, 2, 3, 5, 10].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="muted small">lines each draw</span>
    </div>
    <div id="rcOut" style="margin-top:12px"></div>
  </div>
  <details class="rt"><summary>🎯 Can any strategy beat the lottery?</summary><p>No. Draws use certified machines or RNGs — every combination is exactly as likely as every other, and past draws never influence the next one. What you CAN control: which game you play (odds vary 300×), how much you spend, and whether your numbers are shared with crowds (birthday picks split jackpots more ways). That's what this app optimizes.</p></details>
  <details class="rt"><summary>🎂 The birthday trap</summary><p>Most people play dates, so 1–31 is over-picked, and 32+ is under-picked. When a "date-heavy" combo wins, it tends to split among more winners. Smart Pick keeps your odds identical but leans on 32+ and avoids famous patterns, so a win would more likely be all yours.</p></details>
  <details class="rt"><summary>🔥 Do hot numbers stay hot?</summary><p>Hot/cold boards describe the past, not the future — with 45 balls and 130 draws, some numbers WILL look streaky by pure chance. It's fun to play them (and harmless), just never chase losses because a number feels "due."</p></details>
  <details class="rt"><summary>💡 The one real edge</summary><p>Prizes over ~$600 are taxable and jackpots split among all winning tickets. Unpopular numbers = fewer co-winners. Cash option vs annuity, and claiming small wins before they expire (NJ gives you one year) are where real money is routinely left on the table — the app's ticket checker exists for exactly that.</p></details>`;
}
function wireRealTalk() {
  const out = $('#rcOut'); if (!out) return;
  const upd = () => {
    const g = $('#rcGame').value; const lines = +$('#rcLines').value;
    const G = GAMES[g];
    const drawsYr = (G.draws[0].days.length === 7 ? 365 : G.draws[0].days.length * 52);
    const costYr = ticketCost(g, lines, {}, null) * drawsYr;
    const jo = jackpotOdds(g);
    const years = jo / (lines * drawsYr);
    const anyO = anyPrizeOdds(g);
    out.innerHTML = `
      <div class="budgrid">
        <div class="statile"><b>${fmtUSD(costYr)}</b><span>per year</span></div>
        <div class="statile"><b>${years >= 1e6 ? (years / 1e6).toFixed(1) + 'M' : Math.round(years).toLocaleString()}</b><span>avg years per jackpot</span></div>
        <div class="statile"><b>${anyO ? Math.max(1, Math.round(lines * drawsYr / anyO)) : '–'}</b><span>small wins / yr (avg)</span></div>
      </div>
      <p class="chart-note">At ${lines} line${lines > 1 ? 's' : ''} per ${G.name} draw you'd statistically hit the jackpot about once every <b>${Math.round(years).toLocaleString()} years</b>. Play for the fun of the sweat — never as a plan.</p>`;
  };
  $('#rcGame').onchange = upd; $('#rcLines').onchange = upd; upd();
}
function wireTips(root) {
  const tip = $('#tip');
  const show = (e) => {
    const t = e.target.closest('[data-tip]'); if (!t) { tip.style.display = 'none'; return; }
    tip.innerHTML = esc(t.dataset.tip).replace(/№(\d+)/, '<b>№$1</b>');
    tip.style.display = 'block';
    const r = t.getBoundingClientRect();
    const x = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
  };
  root.addEventListener('pointerover', show);
  root.addEventListener('click', show);
  root.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('[data-tip]')) tip.style.display = 'none'; });
}

/* ============================================================
   BUDGET
   ============================================================ */
function monthKey(iso) { return iso.slice(0, 7); }
function budgetMonth() {
  const mk = monthKey(todayISO());
  let spent = 0, won = 0;
  for (const t of S.tickets) {
    if (monthKey(t.created || t.date) === mk) spent += t.cost;
    const chk = checkTicket(t);
    if (chk.status === 'win' && monthKey(t.date) === mk) won += chk.total;
  }
  for (const m of S.budget.manual) {
    if (monthKey(m.d) !== mk) continue;
    if (m.kind === 'spend') spent += m.amt; else won += m.amt;
  }
  return { spent, won, net: won - spent };
}
function renderBudget() {
  const v = $('#view-budget');
  const { spent, won, net } = budgetMonth();
  const lim = S.budget.limit;
  const pct = lim > 0 ? Math.min(1.35, spent / lim) : 0;
  const state = pct < .8 ? 'ok' : pct <= 1 ? 'warn' : 'bad';
  const C = 2 * Math.PI * 74;
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  v.innerHTML = `
  <h2 class="sect">Budget <small>${monthName}</small></h2>
  <div class="card" style="text-align:center">
    <div id="ring">
      <svg width="172" height="172" viewBox="0 0 172 172">
        <circle cx="86" cy="86" r="74" fill="none" stroke="var(--card-edge)" stroke-width="13"/>
        <circle cx="86" cy="86" r="74" fill="none" stroke="var(--${state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'bad'})" stroke-width="13" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, pct))}" style="transition:stroke-dashoffset 1s cubic-bezier(.22,.9,.3,1)"/>
      </svg>
      <div class="mid"><div><b>${fmtUSD(spent)}</b><span>of ${fmtUSD(lim)} limit</span></div></div>
    </div>
    ${state === 'warn' ? `<div class="warnbar w"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Heads up — you're at ${Math.round(pct * 100)}% of this month's play budget.</div>` : ''}
    ${state === 'bad' ? `<div class="warnbar b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Over budget for ${monthName.split(' ')[0]} — the lottery will still be here next month. 💛</div>` : ''}
    <div class="budgrid">
      <div class="statile"><b>${fmtUSD(spent)}</b><span>spent</span></div>
      <div class="statile"><b style="color:var(--ok)">${fmtUSD(won)}</b><span>won</span></div>
      <div class="statile"><b style="color:${net >= 0 ? 'var(--ok)' : 'var(--bad)'}">${net >= 0 ? '+' : ''}${fmtUSD(net)}</b><span>net</span></div>
    </div>
    <div class="rowflex" style="margin-top:14px; justify-content:center">
      <button class="obtn gold" id="editlim">Change limit</button>
      <button class="obtn" id="quicklog">Quick log win/spend</button>
    </div>
  </div>
  ${S.budget.manual.length ? `<div class="card" style="margin-top:11px"><b>Quick-logged</b>
    ${S.budget.manual.slice(-8).reverse().map((m, i) => `<div class="rankrow"><span class="small muted" style="min-width:86px">${fmtDateNice(m.d)}</span><span class="small">${esc(m.note || (m.kind === 'spend' ? 'spend' : 'win'))}</span><span class="val" style="color:${m.kind === 'win' ? 'var(--ok)' : 'var(--ink2)'}">${m.kind === 'win' ? '+' : '−'}${fmtUSD(m.amt)}</span></div>`).join('')}</div>` : ''}
  <div class="card" style="margin-top:11px">
    <b>Backup${backupSummary().stale && S.tickets.length ? ' <span style="color:var(--warn,#e0a33c)">⚠</span>' : ''}</b>
    <p class="muted small" style="margin:5px 0 10px">${backupSummary().stale && S.tickets.length
      ? 'You\'ve saved tickets since your last backup — they exist only in this browser right now.'
      : 'Tickets & settings live only in this browser. Save a copy once in a while.'}</p>
    <div class="rowflex"><button class="obtn gold" id="bkOpen" style="width:100%">💾 Backup &amp; restore</button></div>
  </div>
  <div class="footnote">Play for entertainment, with money you can afford to lose.<br>If it stops being fun: <b>1-800-GAMBLER</b> (NJ, free & confidential).</div>`;
  $('#editlim').onclick = () => {
    openSheet(`<h3>Monthly play budget</h3>
      <div class="formrow"><label>Limit ($/month)</label><input id="limin" type="number" inputmode="decimal" min="0" step="5" value="${S.budget.limit}"></div>
      <div style="margin-top:16px"><button class="gbtn" id="limsave">Save</button></div>`);
    $('#limsave').onclick = () => { const v2 = parseFloat($('#limin').value); if (isFinite(v2) && v2 >= 0) { S.budget.limit = v2; save(); closeSheet(); renderBudget(); } };
  };
  $('#quicklog').onclick = () => {
    openSheet(`<h3>Quick log</h3><p class="muted small">For scratch-offs, Cash Pop, store plays you didn't save as tickets — keeps the budget honest.</p>
      <div class="formrow"><label>Type</label><select id="qkind"><option value="spend">Money played</option><option value="win">Money won</option></select></div>
      <div class="formrow"><label>Amount ($)</label><input id="qamt" type="number" inputmode="decimal" min="0" step="1" placeholder="10"></div>
      <div class="formrow"><label>Note (optional)</label><input id="qnote" placeholder="scratch-off, Cash Pop…"></div>
      <div style="margin-top:16px"><button class="gbtn" id="qsave">Log it</button></div>`);
    $('#qsave').onclick = () => {
      const amt = parseFloat($('#qamt').value); if (!isFinite(amt) || amt <= 0) return toast('Enter an amount');
      S.budget.manual.push({ d: todayISO(), amt, note: $('#qnote').value.slice(0, 60), kind: $('#qkind').value });
      save(); closeSheet(); renderBudget();
      if ($('#qkind') && $('#qkind').value === 'win') confetti();
    };
  };
  $('#bkOpen').onclick = openBackup;
}

/* ============================================================
   BACKUP / RESTORE — the portable copy of your tickets
   Web copies keep data in this browser only, so this is the way tickets move
   between devices (and survive clearing the browser) until KV sync is on.
   Three ways out and three ways back in, because file downloads are unreliable
   on mobile browsers: file, share sheet, or plain text you can paste anywhere.
   ============================================================ */
const backupName = () => 'jackpot-hq-backup-' + todayISO() + '.json';
const backupText = () => JSON.stringify(S, null, 1);
function backupSummary() {
  const n = (S.tickets || []).length;
  const last = S.backupAt ? new Date(S.backupAt) : null;
  const stale = !last || (S.ticketsAt || 0) > (S.backupAt || 0);
  return { n, last, stale };
}
function markBackedUp() { S.backupAt = Date.now(); save(); }

async function backupShare() {
  const text = backupText();
  try {
    const file = new File([text], backupName(), { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Jackpot HQ backup' });
      markBackedUp();
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return true; // user closed the share sheet
  }
  return false;
}
async function backupCopy() {
  const text = backupText();
  try {
    await navigator.clipboard.writeText(text);
    markBackedUp();
    toast('Backup copied — paste it somewhere safe 📋', true);
    return true;
  } catch {
    const ta = $('#bkText');
    if (ta) { ta.style.display = 'block'; ta.value = text; ta.focus(); ta.select(); toast('Select all and copy this text'); }
    return false;
  }
}
function restoreFrom(txt, replace) {
  let data;
  try { data = JSON.parse(txt); } catch { return toast('That doesn\'t look like a Jackpot HQ backup'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.tickets)) return toast('That doesn\'t look like a Jackpot HQ backup');
  const before = (S.tickets || []).length;
  if (replace) {
    S = Object.assign({}, DEFAULTS, data);
    // fresh containers: Object.assign would otherwise alias DEFAULTS' own objects,
    // and addResults() mutating them would poison every later restore this session
    S.budget = Object.assign({}, DEFAULTS.budget, data.budget);
    S.alerts = Object.assign({}, DEFAULTS.alerts, data.alerts);
    S.results = Object.assign({}, data.results);
    S.jackpots = Object.assign({}, data.jackpots);
  } else {
    mergeState(data, true);
  }
  save(); applyTheme(); initResults(); scheduleAlerts(); closeSheet(); refreshCurrentView();
  const now = (S.tickets || []).length;
  toast(replace ? `Replaced — ${now} ticket${now === 1 ? '' : 's'} restored ✓`
    : `Merged — ${now - before} new, ${now} total ✓`, true);
}
function openBackup() {
  const { n, last, stale } = backupSummary();
  openSheet(`<h3>💾 Backup & restore</h3>
    <p class="muted small">Your ${n} ticket${n === 1 ? '' : 's'} live in <b>this browser only</b>. Save a copy to keep them
    — and to move them to another phone or computer.</p>
    ${stale && n ? '<p class="small" style="color:var(--warn,#e0a33c);margin:8px 0 0">⚠ You have tickets saved since your last backup.</p>' : ''}
    ${last ? `<p class="muted small" style="margin:6px 0 0">Last backup: ${last.toLocaleString()}</p>` : ''}

    <div class="card" style="margin-top:12px">
      <b>Save a copy</b>
      <p class="muted small" style="margin:5px 0 10px">Any one of these is a complete backup.</p>
      <div class="rowflex" style="flex-wrap:wrap;gap:8px">
        <button class="obtn gold" id="bkDl">⬇ Download file</button>
        <button class="obtn" id="bkShare">📤 Share / Save to Files</button>
        <button class="obtn" id="bkCopy">📋 Copy as text</button>
      </div>
      <p class="muted small" style="margin:9px 0 0">On iPhone, <b>Share</b> and <b>Copy</b> are the reliable ones — Safari often ignores downloads.</p>
    </div>

    <div class="card" style="margin-top:11px">
      <b>Bring tickets back</b>
      <p class="muted small" style="margin:5px 0 10px">Merging keeps everything on this device and adds anything missing — nothing gets deleted.</p>
      <div class="rowflex" style="flex-wrap:wrap;gap:8px">
        <button class="obtn" id="bkFile">⬆ Restore from file</button>
        <button class="obtn" id="bkPaste">📥 Paste backup text</button>
      </div>
      <input type="file" id="bkFileIn" accept=".json,application/json" style="display:none">
      <textarea id="bkText" style="display:none;width:100%;margin-top:10px;min-height:110px;font-family:ui-monospace,monospace;font-size:11px" placeholder="Paste your backup here, then tap Restore"></textarea>
      <div id="bkPasteGo" style="display:none;margin-top:8px"><button class="obtn gold" id="bkPasteBtn" style="width:100%">Restore pasted backup</button></div>
      <label class="muted small" style="display:flex;align-items:center;gap:7px;margin-top:11px">
        <input type="checkbox" id="bkReplace"> Replace everything instead of merging
      </label>
    </div>`);

  const replacing = () => !!$('#bkReplace')?.checked;
  const confirmReplace = () => !replacing() || confirm('Replace all tickets and settings on this device with the backup? Anything not in the backup is lost.');

  $('#bkDl').onclick = () => { saveFile(backupName(), backupText()); markBackedUp(); };
  $('#bkShare').onclick = async () => { if (!(await backupShare())) { toast('Sharing not available — downloading instead'); saveFile(backupName(), backupText()); markBackedUp(); } };
  $('#bkCopy').onclick = backupCopy;
  $('#bkFile').onclick = () => { if (confirmReplace()) $('#bkFileIn').click(); };
  $('#bkFileIn').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = replacing();
    f.text().then(txt => restoreFrom(txt, r)).catch(() => toast('Could not read that file'));
  };
  $('#bkPaste').onclick = async () => {
    const ta = $('#bkText'); ta.style.display = 'block'; $('#bkPasteGo').style.display = 'block';
    if (!ta.value) { try { const t = await navigator.clipboard.readText(); if (t) ta.value = t; } catch { } }
    ta.focus();
  };
  $('#bkPasteBtn').onclick = () => {
    const txt = $('#bkText').value.trim();
    if (!txt) return toast('Paste your backup into the box first');
    if (confirmReplace()) restoreFrom(txt, replacing());
  };
}

/* ============================================================
   GAME DETAIL SHEET
   ============================================================ */
function openGameSheet(g) {
  const G = GAMES[g]; const M = G.matrix;
  const nds = nextDraws(g, 3);
  const J = (G.jackpotSeed || G.fixedJackpot) ? jackpotOf(g) : null;
  const prizeRows = G.digits || G.infoOnly
    ? (G.prizes || []).map(p => `<tr><td>${esc(p.bet)}</td><td>${esc(p.label)}</td><td>1 in ${p.odds.toLocaleString()}</td></tr>`).join('')
    : G.prizes.map(p => {
      const o = tierOdds(g, p.k, M.bullseye ? (p.be ? 1 : 0) : (p.b || 0));
      const matchTxt = M.bullseye ? `${p.k}${p.be ? ' + Bullseye' : ''}` : `${p.k}${p.b ? ' + ' + M.bonus.split(' ')[0] : ''}`;
      return `<tr><td>${matchTxt}</td><td>${p.jackpot ? '<b style="color:var(--gold)">' + esc(p.label) + '</b>' : esc(p.label)}${p.note ? ` <span class="muted small">${esc(p.note)}</span>` : ''}</td><td>${o ? fmtOdds(o) : '—'}</td></tr>`;
    }).join('');
  openSheet(`
    <h3>${badge(g)} ${G.name}</h3>
    <p class="muted small" style="margin:2px 0 0">${esc(G.tag)} · ${G.digits ? `pick ${G.digits} digits` : G.infoOnly ? 'pick 1 number, 1–15' : `pick ${M.pick} of 1–${M.max}${M.bonusMax ? ` + ${M.bonus} 1–${M.bonusMax}` : ''}${M.bullseye ? ' (Bullseye drawn from the 5)' : ''}`} · $${G.price}${G.digits ? '+' : ''}/play</p>
    ${G.launched ? `<p class="chip" style="margin-top:9px">🆕 ${esc(G.launched)}</p>` : ''}
    <div class="rowflex" style="margin-top:12px">
      ${J ? `<div class="statile" style="flex:1"><b style="color:var(--gold)">${G.fixedJackpot ? '$1M/yr' : fmtMoney(J.amt)}</b><span>${G.fixedJackpot ? '$18M cash option' : 'est. jackpot' + (G.jackpotStarts ? ' · starts ' + G.jackpotStarts : '')}</span></div>` : ''}
      ${nds[0] ? `<div class="statile" style="flex:1"><b>${fmtNextShort(nds[0])}</b><span>next draw ${fmtTime(nds[0].when)}${nds[0].session ? ' · ' + (nds[0].session === 'M' ? 'midday' : 'evening') : ''}</span></div>` : ''}
    </div>
    ${nds.length ? `<p class="small muted" style="margin-top:9px">Sales cut off ~${Math.round((nds[0].when - nds[0].cutoff) / 60000)} min before each drawing.</p>` : ''}
    <h2 class="sect" style="margin-top:16px">Prizes & odds</h2>
    <div class="statwrap"><table class="tiletable prizeTable"><tr><th>${G.digits || G.infoOnly ? 'Bet' : 'Match'}</th><th>Prize</th><th>Odds</th></tr>${prizeRows}</table></div>
    ${G.multNote ? `<p class="chart-note">${esc(G.multNote)}</p>` : ''}
    ${!G.infoOnly ? `<div class="rowflex" style="margin-top:14px">
      <button class="gbtn" style="flex:1" id="gopick">🎱 Pick numbers</button>
      ${G.manualResults ? `<button class="obtn gold" id="goenter">Enter result</button>` : ''}
    </div>` : ''}`);
  const gp = $('#gopick'); if (gp) gp.onclick = () => { labGame = g; labLines = []; closeSheet(); setView('lab'); };
  const ge = $('#goenter'); if (ge) ge.onclick = () => openResultEntry(g);
}

/* ============================================================
   ALERTS
   ============================================================ */
let alertTimers = [];
function openAlerts() {
  const A = S.alerts;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  openSheet(`
    <h3>🔔 Alerts</h3>
    <p class="muted small">Browser alerts fire while the app is open. For guaranteed phone reminders, add the draw calendar below — it works even when the app is closed.</p>
    <label class="switchrow"><span class="txt"><b>Draw-night reminders</b><span>${perm === 'denied' ? 'Notifications blocked in browser settings' : 'Notify me before ticket sales cut off'}</span></span>
      <span class="sw"><input type="checkbox" id="alEn" ${A.enabled && perm === 'granted' ? 'checked' : ''}><i></i></span></label>
    <div class="formrow"><label>Remind me</label><select id="alLead">${[15, 30, 60, 120].map(m => `<option value="${m}" ${A.lead === m ? 'selected' : ''}>${m >= 60 ? (m / 60) + ' hour' + (m > 60 ? 's' : '') : m + ' minutes'} before cutoff</option>`).join('')}</select></div>
    <div style="margin-top:6px">${TRACKED.map(g => `<label class="switchrow"><span class="txt rowflex" style="gap:8px">${badge(g, 'sm')}<b>${GAMES[g].name}</b></span><span class="sw"><input type="checkbox" data-alg="${g}" ${A.games[g] ? 'checked' : ''}><i></i></span></label>`).join('')}</div>
    <h2 class="sect" style="margin-top:18px">Jackpot watch</h2>
    <p class="muted small" style="margin-top:-6px">Ping me when a jackpot crosses…</p>
    <div class="duo">
      <div class="formrow"><label>Powerball ($M)</label><input id="jpPB" type="number" inputmode="numeric" value="${A.jpPB}"></div>
      <div class="formrow"><label>Mega Millions ($M)</label><input id="jpMM" type="number" inputmode="numeric" value="${A.jpMM}"></div>
    </div>
    <div class="rowflex" style="margin-top:16px">
      <button class="gbtn" style="flex:1" id="alSave">Save alerts</button>
      <button class="obtn" id="alTest">Test</button>
    </div>
    <div class="card" style="margin-top:14px">
      <b>📅 Phone calendar reminders</b>
      <p class="muted small" style="margin:5px 0 10px">Downloads a calendar file (.ics) with every draw night for the games toggled above + a 30-min heads-up alarm. Open it and your phone adds the schedule.</p>
      <button class="obtn gold" id="alIcs">Download draw calendar</button>
    </div>`);
  $('#alEn').onchange = async (e) => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { e.target.checked = false; toast('Notifications not allowed — use the calendar file instead'); }
    }
  };
  $('#alTest').onclick = () => {
    if (('Notification' in window) && Notification.permission === 'granted') new Notification('Jackpot HQ 🎰', { body: 'Alerts are working! Powerball draws tonight at 10:59 PM.' });
    else toast('🔔 This is how in-app alerts look!', true);
  };
  $('#alSave').onclick = () => {
    S.alerts.enabled = $('#alEn').checked;
    S.alerts.lead = +$('#alLead').value;
    $$('[data-alg]').forEach(c => S.alerts.games[c.dataset.alg] = c.checked);
    S.alerts.jpPB = +$('#jpPB').value || 500; S.alerts.jpMM = +$('#jpMM').value || 300;
    save(); scheduleAlerts(); closeSheet(); toast('Alerts saved', true);
    $('#btn-alerts').classList.toggle('attn', S.alerts.enabled);
  };
  $('#alIcs').onclick = downloadICS;
}
function scheduleAlerts() {
  alertTimers.forEach(clearTimeout); alertTimers = [];
  if (!S.alerts.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  for (const g of TRACKED) {
    if (!S.alerts.games[g]) continue;
    for (const nd of nextDraws(g, 2)) {
      const at = nd.cutoff.getTime() - S.alerts.lead * 60e3;
      const delay = at - now;
      if (delay > 0 && delay < 36e5 * 20) {
        alertTimers.push(setTimeout(() => {
          const J = jackpotOf(g);
          new Notification(`${GAMES[g].name} closes soon 🎰`, { body: `Sales cut off at ${fmtTime(nd.cutoff)}${J && !GAMES[g].fixedJackpot ? ` — jackpot ${fmtMoney(J.amt)}` : ''}. Draw at ${fmtTime(nd.when)}.` });
        }, delay));
      }
    }
    // pending-ticket reminder: results likely posted next morning
  }
}
function maybeJackpotAlert() {
  const hits = [];
  if (jackpotOf('pb').amt >= S.alerts.jpPB * 1e6) hits.push(`Powerball is at ${fmtMoney(jackpotOf('pb').amt)}`);
  if (jackpotOf('mm').amt >= S.alerts.jpMM * 1e6) hits.push(`Mega Millions is at ${fmtMoney(jackpotOf('mm').amt)}`);
  if (!hits.length) return;
  const key = hits.join('|') + todayISO();
  if (S._lastJpAlert === key) return;
  S._lastJpAlert = key; save();
  toast('💰 ' + hits.join(' · '), true);
  if (S.alerts.enabled && ('Notification' in window) && Notification.permission === 'granted') new Notification('Jackpot watch 💰', { body: hits.join(' — ') });
}
function downloadICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JackpotHQ//NJ//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:NJ Lottery draws',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'];
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  let uid = 0;
  for (const g of TRACKED) {
    if (!S.alerts.games[g]) continue;
    const G = GAMES[g];
    for (const slot of G.draws) {
      if (slot.session === 'M') continue; // evening reminders only for digit games
      const nd = nextDraws(g, 1)[0]; if (!nd) continue;
      const p = nyParts(nd.when);
      lines.push('BEGIN:VEVENT',
        `UID:jhq-${g}-${slot.hh}${slot.mm}-${++uid}@jackpothq`,
        `DTSTART;TZID=America/New_York:${p.y}${pad2(p.m)}${pad2(p.d)}T${pad2(slot.hh)}${pad2(slot.mm)}00`,
        `RRULE:FREQ=WEEKLY;BYDAY=${slot.days.map(d => BYDAY[d]).join(',')}`,
        `SUMMARY:🎰 ${G.name} drawing`,
        `DESCRIPTION:Ticket sales cut off ~${slot.cutoffMin} min before. Good luck!`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${G.name} — get your ticket!`, 'TRIGGER:-PT45M', 'END:VALARM',
        'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  if (IS_HOSTED) { toast('Calendar export needs the PC copy (Documents → Lotto → index.html) — hosted pages can\'t save .ics files.'); return; }
  saveFile('nj-lottery-draws.ics', lines.join('\r\n'));
  toast('Calendar downloaded — open it to add reminders', true);
}

/* ============================================================
   sheets / toast / confetti / nav
   ============================================================ */
function openSheet(html) {
  $('#sheet').innerHTML = '<div class="grab"></div>' + html;
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
}
function closeSheet() { $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on'); }
$('#scrim').addEventListener('click', closeSheet);
function toast(msg, gold) {
  const t = document.createElement('div'); t.className = 'toast' + (gold ? ' gold' : ''); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3400);
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti'); const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#e8b84b', '#f5dfa2', '#2fa36b', '#e0433e', '#5e93d8', '#fdf9f0'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 140, y: innerHeight * .35,
    vx: (Math.random() - .5) * 11, vy: -Math.random() * 13 - 3,
    w: 5 + Math.random() * 6, h: 8 + Math.random() * 7,
    c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
  }));
  const t0 = performance.now();
  (function tick(t) {
    const el = (t - t0) / 1000;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += .32; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / 2.2); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (el < 2.3) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}
let curView = 'home';
function setView(name) {
  curView = name;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name));
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  refreshCurrentView();
  scrollTo({ top: 0 });
}
window.setView = setView;
function refreshCurrentView() {
  ({ home: renderHome, lab: renderLab, tickets: renderTickets, stats: renderStats, budget: renderBudget })[curView]();
}
window.refreshCurrentView = refreshCurrentView;
$$('#tabbar button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('#btn-sync').onclick = () => syncResults(false);
$('#btn-alerts').onclick = openAlerts;
$('#btn-theme').onclick = () => {
  S.theme = S.theme === 'auto' ? 'light' : S.theme === 'light' ? 'dark' : 'auto';
  applyTheme(); save(); toast('Theme: ' + S.theme, true);
};
function applyTheme() {
  const sysLight = matchMedia('(prefers-color-scheme: light)').matches;
  const mode = S.theme === 'auto' ? (sysLight ? 'light' : 'dark') : S.theme;
  document.documentElement.dataset.theme = mode;
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

/* countdown ticker */
function tickCountdowns() {
  $$('[data-cdfor]').forEach(el => {
    const nd = nextDraws(el.dataset.cdfor, 1)[0]; if (!nd) return;
    const p = cdParts(nd.when - Date.now());
    const set = (u, v) => { const c = el.querySelector(`[data-u="${u}"]`); if (c && c.textContent != v) c.textContent = v; };
    set('d', p.d); set('h', pad2(p.h)); set('m', pad2(p.m)); set('s', pad2(p.s));
  });
  $$('[data-nextfor]').forEach(el => {
    const nd = nextDraws(el.dataset.nextfor, 1)[0]; if (!nd) return;
    const b = el.querySelector('b');
    const txt = fmtNextShort(nd);
    if (b && b.textContent !== txt) b.textContent = txt;
  });
}
setInterval(tickCountdowns, 1000);

/* ---------- live data (from the hourly cloud job, or the local PC updater) ---------- */
function applyLiveData(L) {
  L = L || liveData();
  if (!L || !L.asof) return false;
  if (window.JHQ_LIVE && L.asof < (window.JHQ_LIVE.asof || 0)) return false;
  window.JHQ_LIVE = L;
  if (L.results) for (const g of ['jc5', 'p6', 'p3', 'p4']) {
    if (Array.isArray(L.results[g]) && L.results[g].length) addResults(g, L.results[g]);
  }
  return true;
}
window.applyLiveData = applyLiveData;

/* ---------- boot ---------- */
initResults();
try { applyLiveData(); } catch { }
applyTheme();
$('#btn-alerts').classList.toggle('attn', S.alerts.enabled);
renderHome();
scheduleAlerts();
aiProbe(); // discover which AI models the /api endpoint offers
authProbe(); // signed in? pull synced tickets/budget/settings
diskPull(); // local server running? restore tickets from state.json
const acctBtn = $('#btn-acct'); if (acctBtn) acctBtn.onclick = openAccount;
if (navigator.onLine) syncResults(true); // always refresh on open — draws happen nightly
// web-hosted copies: pull live.json (refreshed hourly by the cloud job) from the same host
(async () => {
  if (location.protocol === 'file:') return; // PC copy loads live.js instead (see index.html)
  try {
    const r = await fetch('live.json?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    if (applyLiveData(await r.json())) refreshCurrentView();
  } catch { }
})();
