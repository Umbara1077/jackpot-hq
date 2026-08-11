// Cloudflare Pages Function / Worker route: GET /api/odds?sport=nfl
// Proxies live sports odds from The Odds API (https://the-odds-api.com) so the key
// stays server-side, and normalises the payload down to what the Sportsbook UI needs.
//
// Env vars (Cloudflare → Settings → Environment variables):
//   ODDS_API_KEY  — a The Odds API key. Without it, the endpoint returns clearly
//                   labelled sample games so the UI is fully usable offline.
//
// Honest by design: odds are the market's price, not a prediction. Nothing here
// implies a bet is +EV — the house edge is real and always disclosed in the UI.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-app-pass',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });

// Friendly sport id → The Odds API sport key. Football first — it's the headliner.
export const SPORTS = {
  nfl:   { key: 'americanfootball_nfl',        name: 'NFL Football',      emoji: '🏈' },
  ncaaf: { key: 'americanfootball_ncaaf',      name: 'College Football',  emoji: '🏈' },
  nba:   { key: 'basketball_nba',              name: 'NBA',               emoji: '🏀' },
  ncaab: { key: 'basketball_ncaab',            name: 'College Hoops',     emoji: '🏀' },
  mlb:   { key: 'baseball_mlb',                name: 'MLB',               emoji: '⚾' },
  nhl:   { key: 'icehockey_nhl',               name: 'NHL',               emoji: '🏒' },
  epl:   { key: 'soccer_epl',                  name: 'Premier League',    emoji: '⚽' },
  mls:   { key: 'soccer_usa_mls',              name: 'MLS',               emoji: '⚽' },
  mma:   { key: 'mma_mixed_martial_arts',      name: 'MMA / UFC',         emoji: '🥊' },
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sportId = (url.searchParams.get('sport') || 'nfl').toLowerCase();
  const S = SPORTS[sportId] || SPORTS.nfl;

  const key = env.ODDS_API_KEY;
  if (!key) {
    return json({ ok: true, sample: true, sport: sportId, sportName: S.name, games: sampleGames(sportId) });
  }

  const api = `https://api.the-odds-api.com/v4/sports/${S.key}/odds/?apiKey=${key}` +
    `&regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso`;
  try {
    const r = await fetch(api, { signal: withTimeout(12000) });
    const remaining = r.headers.get('x-requests-remaining');
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!r.ok) {
      // Fall back to sample rather than blanking the board; surface the real reason.
      return json({
        ok: true, sample: true, sport: sportId, sportName: S.name,
        note: `Live feed unavailable (HTTP ${r.status}: ${(data?.message || text || '').slice(0, 140)}) — showing sample games.`,
        games: sampleGames(sportId),
      });
    }
    const games = (Array.isArray(data) ? data : []).map(normalizeGame).filter(Boolean);
    return json({ ok: true, sample: false, sport: sportId, sportName: S.name, remaining: remaining || null, games });
  } catch (e) {
    return json({
      ok: true, sample: true, sport: sportId, sportName: S.name,
      note: `Couldn't reach the odds feed (${String(e.message || e).slice(0, 120)}) — showing sample games.`,
      games: sampleGames(sportId),
    });
  }
}

const withTimeout = (ms) => { try { return AbortSignal.timeout(ms); } catch { return undefined; } };

// Collapse a The Odds API game (many bookmakers × markets) into one consensus board row.
// Consensus = median across books for each price, which is more robust than any one book.
function normalizeGame(g) {
  if (!g || !g.home_team || !g.away_team) return null;
  const books = Array.isArray(g.bookmakers) ? g.bookmakers : [];
  const ml = { home: [], away: [] };
  const spread = { point: [], home: [], away: [] };
  const total = { point: [], over: [], under: [] };

  for (const b of books) {
    for (const m of (b.markets || [])) {
      const out = m.outcomes || [];
      const find = (name) => out.find(o => o.name === name);
      if (m.key === 'h2h') {
        push(ml.home, find(g.home_team)?.price); push(ml.away, find(g.away_team)?.price);
      } else if (m.key === 'spreads') {
        const h = find(g.home_team), a = find(g.away_team);
        push(spread.point, h?.point); push(spread.home, h?.price); push(spread.away, a?.price);
      } else if (m.key === 'totals') {
        const o = find('Over'), u = find('Under');
        push(total.point, o?.point); push(total.over, o?.price); push(total.under, u?.price);
      }
    }
  }
  return {
    id: g.id,
    home: g.home_team, away: g.away_team,
    commence: g.commence_time,
    books: books.length,
    ml: { home: median(ml.home), away: median(ml.away) },
    spread: { point: median(spread.point), home: median(spread.home), away: median(spread.away) },
    total: { point: median(total.point), over: median(total.over), under: median(total.under) },
  };
}
const push = (arr, v) => { if (typeof v === 'number' && !Number.isNaN(v)) arr.push(v); };
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Realistic, clearly-labelled sample slates so the section works before a key is set.
function sampleGames(sportId) {
  const soon = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const g = (id, away, home, commence, ml, spread, total) =>
    ({ id: `sample-${sportId}-${id}`, away, home, commence, books: 6, ml, spread, total, sample: true });
  const sets = {
    nfl: [
      g(1, 'Dallas Cowboys', 'Philadelphia Eagles', soon(6),  { away: +145, home: -170 }, { point: 3.5, away: +100, home: -120 }, { point: 47.5, over: -110, under: -110 }),
      g(2, 'Kansas City Chiefs', 'Buffalo Bills', soon(28),   { away: -125, home: +105 }, { point: -1.5, away: -110, home: -110 }, { point: 48.5, over: -108, under: -112 }),
      g(3, 'San Francisco 49ers', 'Detroit Lions', soon(52),  { away: -140, home: +120 }, { point: -2.5, away: -110, home: -110 }, { point: 51.5, over: -110, under: -110 }),
    ],
    nba: [
      g(1, 'Boston Celtics', 'Denver Nuggets', soon(5),       { away: +110, home: -130 }, { point: 2.5, away: -110, home: -110 }, { point: 224.5, over: -110, under: -110 }),
      g(2, 'Los Angeles Lakers', 'Golden State Warriors', soon(27), { away: +150, home: -175 }, { point: 4.5, away: -108, home: -112 }, { point: 232.5, over: -110, under: -110 }),
    ],
    mlb: [
      g(1, 'New York Yankees', 'Los Angeles Dodgers', soon(4),{ away: +120, home: -140 }, { point: 1.5, away: -160, home: +135 }, { point: 8.5, over: -105, under: -115 }),
    ],
    nhl: [
      g(1, 'Toronto Maple Leafs', 'Boston Bruins', soon(7),   { away: +115, home: -135 }, { point: 1.5, away: -180, home: +150 }, { point: 6.5, over: +100, under: -120 }),
    ],
    epl: [
      g(1, 'Arsenal', 'Manchester City', soon(20),            { away: -105, home: +260 }, { point: 0.5, away: -160, home: +130 }, { point: 2.5, over: -125, under: +105 }),
    ],
  };
  return sets[sportId] || sets.nfl;
}
