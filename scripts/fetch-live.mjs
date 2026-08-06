// Refreshes live.json with current NJ Lottery jackpots + NJ-only game results.
// Runs in GitHub Actions hourly. On any failure it keeps the previous data —
// the app also degrades gracefully, so a bad hour never breaks the site.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.njlottery.com/en-us/drawgames.html',
};
const OUT = new URL('../live.json', import.meta.url);

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const njFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = (ms) => njFmt.format(new Date(Number(ms)));

async function api(query) {
  const r = await fetch('https://www.njlottery.com/api/v2/draw-games/draws/?' + query, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('njlottery HTTP ' + r.status);
  return (await r.json()).draws || [];
}

/* ---- jackpots ---- */
const jackpots = {};
try {
  const open = await api('next-draws=1&status=OPEN&game-names=' + encodeURIComponent('Powerball,Mega Millions,Pick 6,Cash 5'));
  const nameMap = { 'Powerball': 'pb', 'Mega Millions': 'mm', 'Pick 6': 'p6', 'Cash 5': 'jc5' };
  for (const d of open) {
    const key = nameMap[d.gameName];
    if (key && d.estimatedJackpot > 0) jackpots[key] = { amt: Math.round(d.estimatedJackpot / 100), cash: Math.round((d.annuityCashOption || 0) / 100) };
  }
  console.log('njlottery jackpots:', Object.keys(jackpots).join(',') || 'none');
} catch (e) { console.log('njlottery jackpots failed:', e.message); }

// fallbacks for the two multi-state giants if njlottery is unreachable from this network
if (!jackpots.pb) {
  try {
    const r = await fetch('https://www.powerball.com/api/v1/estimates/powerball?_format=json', { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : null;
    const amt = row ? parseFloat(String(row.field_prize_amount || '').replace(/[^0-9.]/g, '')) : 0;
    if (amt > 0) { jackpots.pb = { amt: Math.round(amt * 1e6) }; console.log('powerball.com fallback ok'); }
  } catch (e) { console.log('powerball.com fallback failed:', e.message); }
}
if (!jackpots.mm) {
  try {
    const r = await fetch('https://www.megamillions.com/cmspages/utilservice.asmx/GetLatestDrawData', { headers: { ...HEADERS, 'Accept': 'application/json, text/javascript' }, signal: AbortSignal.timeout(20000) });
    const txt = await r.text();
    const m = txt.match(/"NextEstimatedJackpot"\s*:\s*([0-9.]+)/) || txt.match(/NextJackpot[^0-9]*([0-9,]{6,})/);
    if (m) { const amt = parseFloat(m[1].replace(/,/g, '')); if (amt > 1e5) { jackpots.mm = { amt: Math.round(amt) }; console.log('megamillions.com fallback ok'); } }
  } catch (e) { console.log('megamillions.com fallback failed:', e.message); }
}

/* ---- NJ-only results ---- */
const results = {};
function mapLotto(draws, doublePlay) {
  const rows = [];
  for (const d of [...draws].sort((a, b) => a.drawTime - b.drawTime)) {
    if (d.status !== 'CLOSED' || !Array.isArray(d.results)) continue;
    const reg = d.results.find(r => r.drawType === 'Regular');
    if (!reg || !reg.primary) continue;
    const n = reg.primary.filter(v => /^\d+$/.test(v)).map(Number).sort((a, b) => a - b);
    if (!n.length) continue;
    const row = { d: etDate(d.drawTime), n };
    const be = reg.primary.find(v => /^B-/.test(v)); if (be) row.b = Number(be.slice(2));
    const mu = reg.primary.find(v => /^M-/.test(v)); if (mu) { const m = Number(mu.slice(2)); if (m >= 2) row.m = m; }
    if (doublePlay) {
      const dp = d.results.find(r => r.drawType !== 'Regular' && Array.isArray(r.primary));
      if (dp) row.dp = dp.primary.filter(v => /^\d+$/.test(v)).map(Number).sort((a, b) => a - b);
    }
    rows.push(row);
  }
  return rows;
}
// NOTE: the API stamps every draw at midnight; only closeTime separates the
// 12:53 midday sale cutoff from the 22:53 evening one.
const etHour = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(Number(ms))));
function mapDigit(draws, len) {
  const rows = [];
  for (const d of [...draws].sort((a, b) => (a.closeTime || a.drawTime) - (b.closeTime || b.drawTime))) {
    if (d.status !== 'CLOSED' || !Array.isArray(d.results)) continue;
    const reg = d.results.find(r => r.drawType === 'Regular');
    if (!reg || !reg.primary) continue;
    const digits = reg.primary.find(v => new RegExp('^\\d{' + len + '}$').test(v));
    if (digits == null) continue;
    const date = etDate(d.drawTime);
    const row = { d: date, t: (d.closeTime && etHour(d.closeTime) < 17) ? 'M' : 'E', n: digits };
    const fbRow = d.results.find(r => r.drawType === 'FIREBALL' && Array.isArray(r.primary));
    if (fbRow) { const tok = fbRow.primary.find(v => /^FB-/.test(v)); if (tok) row.f = tok.replace(/\D/g, ''); }
    rows.push(row);
  }
  return rows;
}
try { results.jc5 = mapLotto(await api('previous-draws=12&next-draws=0&game-names=' + encodeURIComponent('Cash 5')), false); } catch (e) { console.log('jc5 failed:', e.message); }
try { results.p6 = mapLotto(await api('previous-draws=12&next-draws=0&game-names=' + encodeURIComponent('Pick 6')), true); } catch (e) { console.log('p6 failed:', e.message); }
try { results.p3 = mapDigit(await api('previous-draws=24&next-draws=0&game-names=' + encodeURIComponent('Pick 3')), 3); } catch (e) { console.log('p3 failed:', e.message); }
try { results.p4 = mapDigit(await api('previous-draws=24&next-draws=0&game-names=' + encodeURIComponent('Pick 4')), 4); } catch (e) { console.log('p4 failed:', e.message); }

/* ---- write (merge with previous so partial failures never lose data) ---- */
const gotAnything = Object.keys(jackpots).length || Object.values(results).some(r => r && r.length);
if (!gotAnything) { console.log('nothing fetched — keeping previous live.json'); process.exit(0); }
const out = {
  asof: Date.now(),
  jackpots: { ...(prev.jackpots || {}), ...jackpots },
  results: { ...(prev.results || {}), ...Object.fromEntries(Object.entries(results).filter(([, v]) => v && v.length)) },
};
writeFileSync(OUT, JSON.stringify(out));
console.log('live.json written:', Object.keys(out.jackpots).join(','), '|', Object.entries(out.results).map(([k, v]) => k + ':' + v.length).join(' '));
