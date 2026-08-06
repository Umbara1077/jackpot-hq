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
};
let S;
try { S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('jhq') || '{}')); }
catch { S = { ...DEFAULTS }; }
S.budget = Object.assign({}, DEFAULTS.budget, S.budget);
S.alerts = Object.assign({}, DEFAULTS.alerts, S.alerts);
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('jhq', JSON.stringify(S)); } catch {} }, 120); }

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
  ai: { name: 'AI Pick', ico: '🤖', truth: 'No AI can beat randomness — these models build smart low-crowd lines from the real draw history and explain their thinking.', desc: 'Fable 5, Opus 5, Grok 4.5 or GPT-5.6 reasons over the real draw data and explains each pick.', ai: true },
};

/* ============================================================
   AI PICKS — answered by the /api/ai-pick Cloudflare Pages Function
   (API keys live in Cloudflare env vars, never in the browser)
   ============================================================ */
let AI = { checked: false, ok: false, models: {}, passReq: false };
let aiModel = null, aiNote = null;
function aiEndpoint() {
  if (typeof window !== 'undefined' && window.claude) return null; // hosted artifact: platform blocks outside calls
  if (location.protocol === 'file:') {
    if (!S.aiEndpoint) return null;
    const base = S.aiEndpoint.trim().replace(/\/+$/, '');
    return /\/api\/ai-pick$/.test(base) ? base : base + '/api/ai-pick';
  }
  return 'api/ai-pick';
}
async function aiProbe() {
  const ep = aiEndpoint();
  if (!ep) { AI = { checked: true, ok: false, models: {}, passReq: false }; return; }
  try {
    const r = await fetch(ep, { cache: 'no-store' });
    const j = await r.json();
    AI = { checked: true, ok: !!j.ok, models: j.models || {}, passReq: !!j.passcodeRequired };
    const avail = Object.keys(AI.models).filter(k => AI.models[k].available);
    if (!aiModel || !avail.includes(aiModel)) aiModel = avail[0] || null;
  } catch { AI = { checked: true, ok: false, models: {}, passReq: false }; }
  if (curView === 'lab') renderLab();
}
function aiPanelHtml() {
  const ep = aiEndpoint();
  if (!ep && typeof window !== 'undefined' && window.claude) {
    return `<div class="card" style="margin-top:10px"><b>🤖 AI picks live on the website</b><p class="muted small" style="margin:5px 0 0">This hosted copy can't reach outside servers — open your deployed site for AI picks.</p></div>`;
  }
  if (!ep) {
    return `<div class="card" style="margin-top:10px"><b>🤖 Connect to your site once</b>
      <p class="muted small" style="margin:5px 0 8px">Enter your deployed site URL — its server answers AI requests so your API keys stay private.</p>
      <div class="formrow"><label>Site URL</label><input id="aiEpIn" placeholder="https://jackpot-hq.pages.dev" value="${esc(S.aiEndpoint || '')}"></div>
      <div class="formrow"><label>Passcode (only if you set APP_PASSCODE)</label><input id="aiPassIn" placeholder="optional" value="${esc(S.aiPass || '')}"></div>
      <div style="margin-top:12px"><button class="gbtn" id="aiEpSave">Connect</button></div></div>`;
  }
  if (!AI.checked) return `<div class="card" style="margin-top:10px"><span class="muted small">Checking AI availability…</span></div>`;
  if (!AI.ok) return `<div class="card" style="margin-top:10px"><b>AI endpoint unreachable</b><p class="muted small" style="margin:5px 0 0">Couldn't reach ${esc(ep)}. If you just deployed, give it a minute, then switch tabs and back to retry.</p></div>`;
  const entries = Object.entries(AI.models);
  if (!entries.some(([, m]) => m.available)) {
    return `<div class="card" style="margin-top:10px"><b>Almost there — add your API keys</b>
      <p class="muted small" style="margin:5px 0 0">In Cloudflare Pages → your project → <b>Settings → Environment variables</b>, add any of: <b>ANTHROPIC_API_KEY</b> (Fable 5 + Opus 5), <b>OPENAI_API_KEY</b> (GPT-5.6 Sol + Terra), <b>XAI_API_KEY</b> (Grok 4.5). Redeploy and the models appear here automatically.</p></div>`;
  }
  return `<div class="gpick" id="aimodels" style="margin-top:10px">${entries.map(([k, m]) =>
    `<button data-ai="${k}" class="${k === aiModel ? 'on' : ''}" ${m.available ? '' : 'disabled style="opacity:.35"'}>🤖 ${esc(m.name)}${m.available ? '' : ' — no key'}</button>`).join('')}</div>`;
}
function askPasscode() {
  openSheet(`<h3>🔒 Passcode</h3>
    <p class="muted small">This AI endpoint is protected. Enter the passcode you set as APP_PASSCODE in Cloudflare.</p>
    <div class="formrow"><label>Passcode</label><input id="aiPassEntry" value="${esc(S.aiPass || '')}"></div>
    <div style="margin-top:14px"><button class="gbtn" id="aiPassOk">Save & retry</button></div>`);
  $('#aiPassOk').onclick = () => { S.aiPass = $('#aiPassEntry').value.trim(); save(); closeSheet(); aiGenerate(); };
}
async function aiGenerate() {
  const G = GAMES[labGame];
  const ep = aiEndpoint();
  if (!ep || !AI.ok) return toast('AI isn\'t connected here yet');
  if (!aiModel || !AI.models[aiModel]?.available) return toast('Pick an AI model first');
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
    const b = $('#genbtn'); if (b) { b.disabled = false; b.textContent = 'Generate'; }
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
function renderHome() {
  const v = $('#view-home');
  const heroGames = [...JACKPOT_GAMES].sort((a, b) => jackpotOf(b).amt - jackpotOf(a).amt).slice(0, 3);
  const tonight = TRACKED.map(g => ({ g, nd: nextDraws(g, 1)[0] })).filter(x => x.nd && nyISO(x.nd.when) === todayISO());
  v.innerHTML = `
  <div id="heroStack">${heroGames.map((g, i) => heroCard(g, i)).join('')}</div>
  ${tonight.length ? `<div id="tonightrow"><span class="chip tlabel">🌙 Tonight</span>${tonight.map(x => `<span class="chip" data-open="${x.g}" style="cursor:pointer"><span class="dot" style="background:${GAMES[x.g].color}"></span><b>${GAMES[x.g].name}</b><span class="ctime">${fmtTime(x.nd.when)}</span></span>`).join('')}</div>` : ''}
  <h2 class="sect">Games <small>tap a card for rules & odds</small></h2>
  <div class="gamegrid">
    ${GAME_IDS.map(g => gameCard(g)).join('')}
  </div>
  <div class="footnote">Winning numbers auto-update for Powerball, Mega Millions & Millionaire for Life (official state open-data).<br>NJ-only games: tap <b>↻</b> on a game card after the draw to type results in — takes 15 seconds.</div>`;
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
        : `<span class="nextin">Next: <b>${fmtNextShort(nd)}</b>${nd && nd.session ? ' <span class="muted">(' + (nd.session === 'M' ? 'midday' : 'evening') + ')</span>' : ''}</span>`}
      ${last && !G.digits && !G.infoOnly ? `<span class="lastmini">${last.n.slice(0, GAMES[g].matrix.pick).map(n => `<span class="ball xs">${n}</span>`).join('')}${last.b != null && !G.matrix?.bullseye ? `<span class="ball xs bonus">${last.b}</span>` : ''}</span>`
        : last && G.digits ? `<span class="lastmini">${[...last.n].map(d => `<span class="ball xs">${d}</span>`).join('')}</span>` : ''}
      ${G.manualResults ? `<button class="obtn" style="padding:4px 10px;font-size:11px" data-addres="${g}" title="Enter last night's result">↻</button>` : ''}
    </div>
  </div>`;
}
function countUp(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = +el.dataset.amt; const t0 = performance.now(); const dur = 1300;
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtMoney(target * e);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmtMoney(target);
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
function renderLab() {
  const v = $('#view-lab'); const G = GAMES[labGame];
  const strats = G.digits ? ['quick', 'hot', 'cold', 'balanced', 'ai'] : G.matrix?.pick === 1 ? ['quick'] : ['quick', 'smart', 'ai', 'hot', 'cold', 'balanced', 'manual'];
  if (!strats.includes(labStrat)) labStrat = strats[0];
  v.innerHTML = `
  <h2 class="sect">Number Lab <small>strategy picks</small></h2>
  <div class="gpick">${GAME_IDS.map(g => `<button data-g="${g}" class="${g === labGame ? 'on' : ''}">${badge(g, 'sm')}${GAMES[g].short}</button>`).join('')}</div>
  ${G.infoOnly ? `<div class="card"><b>Cash Pop</b><p class="muted small" style="margin:6px 0 0">${esc(G.multNote)} Odds are 1 in 15 per number — the picker below is just for fun.</p>
    <div style="margin-top:12px"><button class="gbtn" id="popgen">Pop me a number</button></div><div id="popout" style="text-align:center;margin-top:14px"></div></div>` : `
  <div class="stratgrid">
    ${strats.map(s => { const st = G.digits && !['manual', 'ai'].includes(s) ? { name: { quick: 'Quick Pick', hot: 'Hot Digits', cold: 'Cold Digits', balanced: 'Balanced Sum' }[s], desc: { quick: 'Crypto-random digits.', hot: 'Digits hitting most, per position (last 80 draws).', cold: 'Digits hitting least, per position.', balanced: 'Random but keeps the sum mid-range.' }[s], ico: { quick: '🎲', hot: '🔥', cold: '🧊', balanced: '⚖️' }[s] } : STRATS[s];
      return `<button class="strat ${s === labStrat ? 'on' : ''}" data-s="${s}"><b><span class="ico">${st.ico}</span>${st.name}</b><p>${st.desc}</p></button>`; }).join('')}
  </div>
  <div class="chip truth" style="margin-top:10px" id="truthchip">${STRATS[labStrat] && (!G.digits || labStrat === 'ai') ? esc(STRATS[labStrat].truth) : 'Every combination has identical odds — strategies are about fun and (for Smart Pick) not splitting a shared win.'}</div>
  ${labStrat === 'ai' ? aiPanelHtml() : ''}
  ${labStrat === 'manual' && !G.digits ? manualBoard() : `
  <div id="labctl">
    <div class="stepper"><button id="minus">−</button><b id="lcount">${labCount} line${labCount > 1 ? 's' : ''}</b><button id="plus">+</button></div>
    <button class="gbtn" id="genbtn" style="flex:1">Generate</button>
  </div>`}
  <div id="machine"><div class="drum"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div></div>
  <div id="labout"></div>`}`;
  $$('.gpick button:not([data-ai])', v).forEach(b => { if (b.dataset.g) b.onclick = () => { labGame = b.dataset.g; labLines = []; aiNote = null; manualSel = []; manualBonus = null; renderLab(); }; });
  $$('.strat', v).forEach(b => b.onclick = () => { labStrat = b.dataset.s; labLines = []; aiNote = null; renderLab(); });
  $$('#aimodels button', v).forEach(b => b.onclick = () => { aiModel = b.dataset.ai; renderLab(); });
  const epSave = $('#aiEpSave');
  if (epSave) epSave.onclick = () => {
    S.aiEndpoint = $('#aiEpIn').value.trim(); S.aiPass = $('#aiPassIn').value.trim(); save();
    AI.checked = false; renderLab(); aiProbe();
  };
  if (G.infoOnly) { const pg = $('#popgen'); if (pg) pg.onclick = () => { $('#popout').innerHTML = `<div class="ballrow popin" style="justify-content:center"><span class="ball" style="--tint:#ffc0e5">${1 + rnd(15)}</span></div>`; }; return; }
  if (labStrat === 'manual' && !G.digits) { wireManual(); return; }
  $('#minus').onclick = () => { labCount = Math.max(1, labCount - 1); $('#lcount').textContent = labCount + ' line' + (labCount > 1 ? 's' : ''); };
  $('#plus').onclick = () => { labCount = Math.min(10, labCount + 1); $('#lcount').textContent = labCount + ' line' + (labCount > 1 ? 's' : ''); };
  $('#genbtn').onclick = generate;
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
    save(); closeSheet(); setView('tickets'); toast('Ticket saved — good luck! 🍀', true);
    scheduleAlerts();
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
    <b>Backup</b>
    <p class="muted small" style="margin:5px 0 10px">Tickets & settings live only in this browser. Export a backup once in a while.</p>
    <div class="rowflex"><button class="obtn" id="exp">⬇ Export data</button><button class="obtn" id="imp">⬆ Restore</button><input type="file" id="impfile" accept=".json" style="display:none"></div>
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
  $('#exp').onclick = () => saveFile('jackpot-hq-backup-' + todayISO() + '.json', JSON.stringify(S, null, 1));
  $('#imp').onclick = () => $('#impfile').click();
  $('#impfile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(txt => {
      try { const data = JSON.parse(txt); if (!data || typeof data !== 'object' || !('tickets' in data)) throw 0; S = Object.assign({}, DEFAULTS, data); save(); initResults(); refreshCurrentView(); toast('Backup restored ✓', true); }
      catch { toast('That file doesn\'t look like a Jackpot HQ backup'); }
    });
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
}
setInterval(tickCountdowns, 1000);
setInterval(() => { if (curView === 'home' && !$('#sheet').classList.contains('on')) renderHome(); }, 30000);

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
