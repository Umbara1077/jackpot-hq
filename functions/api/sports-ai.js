// Cloudflare Pages Function / Worker route: POST /api/sports-ai
// AI matchup analysis for the Sportsbook section. Self-contained on purpose — it reuses
// the same provider API keys as /api/ai-pick but shares no code with it, so the lottery
// path can never regress from a change made here.
//
// Env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY (GOOGLE_API_KEY
// also accepted), APP_PASSCODE (optional). GET returns which models are available.
//
// Honest by design: sports betting is -EV over time and the model is told never to imply
// otherwise. The analysis is reasoning about a matchup and its market price, not a promise.
import { verifySession, sessionSecret } from '../_session.js';

const MODELS = {
  opus:        { provider: 'anthropic', id: 'claude-opus-5',            name: 'Claude Opus 5' },
  fable:       { provider: 'anthropic', id: 'claude-fable-5',           name: 'Claude Fable 5' },
  grok:        { provider: 'xai',       id: 'grok-4.5',                 name: 'Grok 4.5' },
  sol:         { provider: 'openai',    id: 'gpt-5.6-sol',              name: 'GPT-5.6 Sol' },
  geminipro:   { provider: 'google',    id: 'gemini-3.1-pro-preview',   name: 'Gemini 3.1 Pro' },
  geminiflash: { provider: 'google',    id: 'gemini-3.6-flash',         name: 'Gemini 3.6 Flash' },
};
// Order the analyst is auto-picked in when the client doesn't name one.
const PREFERENCE = ['opus', 'fable', 'grok', 'sol', 'geminipro', 'geminiflash'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-app-pass',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });

const keyFor = (env, p) =>
  p === 'anthropic' ? env.ANTHROPIC_API_KEY :
  p === 'openai' ? env.OPENAI_API_KEY :
  p === 'xai' ? env.XAI_API_KEY :
  p === 'google' ? (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) : null;

const DISCLAIMER = 'For entertainment only. No bet is guaranteed and sports betting loses money over time. 21+. Never wager more than you can afford to lose. Problem gambling? Call 1-800-GAMBLER.';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET → which analysts are configured, so the UI can offer them / disable the feature.
export async function onRequestGet(context) {
  const { env } = context;
  const models = {};
  for (const [k, m] of Object.entries(MODELS)) models[k] = { name: m.name, available: !!keyFor(env, m.provider) };
  const anyAvailable = Object.values(models).some(m => m.available);
  return json({ ok: anyAvailable, models, passcodeRequired: !!env.APP_PASSCODE });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (env.APP_PASSCODE && request.headers.get('x-app-pass') !== env.APP_PASSCODE) {
    const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
    if (!user) return json({ error: 'passcode' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  // Pick the analyst: requested model if available, else the best configured one.
  let key = body.model && MODELS[body.model] && keyFor(env, MODELS[body.model].provider) ? body.model : null;
  if (!key) key = PREFERENCE.find(k => keyFor(env, MODELS[k].provider));
  if (!key) return json({ error: 'No AI provider is configured on this site' }, 503);
  const M = MODELS[key];
  const apiKey = keyFor(env, M.provider);

  const prompt = buildPrompt(body);
  try {
    const raw = await callModel(M, apiKey, prompt);
    let analysis = extractJson(raw);
    if (!validAnalysis(analysis)) {
      const raw2 = await callModel(M, apiKey, prompt + '\n\nYour previous answer was not valid JSON in the required shape. Return corrected JSON only.');
      analysis = extractJson(raw2);
      if (!validAnalysis(analysis)) return json({ error: `${M.name} returned an unreadable analysis — try again` }, 502);
    }
    return json({ ok: true, model: M.name, analysis: clampAnalysis(analysis), disclaimer: DISCLAIMER });
  } catch (e) {
    return json({ error: `${M.name}: ${String(e.message || e).slice(0, 300)}` }, 502);
  }
}

/* ---------------- prompt ---------------- */
function matchupContext(body) {
  const m = body.matchup || {};
  const o = body.odds || {};
  const american = (v) => (typeof v === 'number' ? (v > 0 ? '+' + v : String(v)) : '—');
  const lines = [];
  lines.push(`Sport/League: ${body.sportName || m.league || body.sport || 'unknown'}`);
  lines.push(`Matchup: ${m.away || 'Away'} at ${m.home || 'Home'}${m.commence ? ` (starts ${m.commence})` : ''}`);
  if (o.ml && (o.ml.home != null || o.ml.away != null)) lines.push(`Moneyline (consensus): ${m.away} ${american(o.ml.away)} / ${m.home} ${american(o.ml.home)}`);
  if (o.spread && o.spread.point != null) lines.push(`Spread: ${m.home} ${o.spread.point > 0 ? '+' : ''}${o.spread.point} (${american(o.spread.home)}), ${m.away} ${(-o.spread.point) > 0 ? '+' : ''}${-o.spread.point} (${american(o.spread.away)})`);
  if (o.total && o.total.point != null) lines.push(`Total: ${o.total.point} — Over ${american(o.total.over)} / Under ${american(o.total.under)}`);
  if (o.books) lines.push(`Prices are the median across ${o.books} sportsbooks.`);
  return lines.join('\n');
}

const GROUND_RULES = `Ground rules you must respect and never contradict:
- Sports betting is negative expected value over time. Nothing you say raises the bettor's long-run edge, and you must never imply a bet is "guaranteed", "lock", "free money", or a sure thing.
- The odds shown are the market's price. Beating the market is hard; most bettors lose. Be honest about that and about your own uncertainty.
- Reason from the matchup, the market price implied by the odds, and general knowledge. If you do not know a current injury, lineup, weather, or roster fact, say so — do NOT invent specific stats, injuries, or numbers.
- Recommend responsible staking (small, fixed units) and never tell the user to chase losses.`;

function buildPrompt(body) {
  const q = (body.question || '').toString().slice(0, 400).trim();
  return `You are a sharp, honest sports betting analyst helping a New Jersey bettor think through a wager, for entertainment.

${GROUND_RULES}

${matchupContext(body)}
${q ? `\nThe bettor specifically asks: ${q}` : ''}

Do this:
1. Convert the odds into the market's implied probability, and say what the price is really pricing in.
2. Weigh the concrete factors you can reason about (matchup style, situation, rest, home/away, pace, market movement). Flag anything you'd want to check (injuries, weather, lineups) rather than guessing it.
3. Identify the single wager on this game with the best case for value — moneyline, spread, or total — or conclude there is no clear edge and say to pass.
4. Give a calibrated confidence, and be willing to say "low" or "pass". Overconfidence is the tell of a bad analyst.

Return ONLY JSON in exactly this shape. No markdown, no commentary outside the JSON:
{"pick":"e.g. Eagles -3.5, or Under 47.5, or PASS","market":"moneyline|spread|total|pass","confidence":"low|medium|high","edge":"one sentence on where the value is, or why to pass","keyFactors":["short factor", "short factor"],"risks":["short risk", "short risk"],"summary":"2-3 sentences in plain language"}`;
}

/* ---------------- providers (raw HTTP, dependency-free) ---------------- */
const withTimeout = (ms) => { try { return AbortSignal.timeout(ms); } catch { return undefined; } };

async function readJson(r, label) {
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON handled below */ }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(data?.error?.message || text || '').slice(0, 200) || '(empty body)'}`);
  if (data == null) throw new Error(`${label} returned a non-JSON response (HTTP ${r.status}): ${text.slice(0, 200) || '(empty body)'}`);
  return data;
}

function callModel(M, apiKey, prompt) {
  if (M.provider === 'anthropic') return callAnthropic(apiKey, M.id, prompt);
  if (M.provider === 'google') return callGemini(apiKey, M.id, prompt);
  return callOpenAICompatible(M.provider, apiKey, M.id, prompt);
}

/* Reads a streamed /v1/messages response and returns the assistant's text. Streaming
   keeps bytes on the socket for the whole run, so the deadline below only fires on a
   request that is genuinely stuck rather than on one that is simply still thinking.
   Only text_delta is collected — thinking blocks stream as thinking_delta and, with
   display defaulting to omitted, carry no text anyway. */
async function readAnthropicStream(r) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stopReason = null, outputTokens = 0, streamError = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text || '';
      else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage?.output_tokens != null) outputTokens = ev.usage.output_tokens;
      } else if (ev.type === 'error') streamError = ev.error?.message || 'stream error';
    }
  }
  if (streamError) throw new Error(streamError);
  return { text, stopReason, outputTokens };
}

async function callAnthropic(apiKey, model, prompt) {
  const schema = {
    type: 'object',
    properties: {
      pick: { type: 'string' }, market: { type: 'string' }, confidence: { type: 'string' },
      edge: { type: 'string' },
      keyFactors: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
    required: ['pick', 'market', 'confidence', 'edge', 'keyFactors', 'risks', 'summary'],
    additionalProperties: false,
  };
  const CAP = 16000;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model,
      /* max_tokens caps thinking AND response text together, and thinking is on by
         default on claude-opus-5 / always on for claude-fable-5. 6000 was inherited from
         the pre-thinking Opus models; on the current ones a medium-effort run can spend
         all of it reasoning and then truncate mid-JSON, which reads as a failure right at
         the end of an otherwise healthy request. A ceiling that is never reached costs
         nothing — `effort` decides what is actually spent — so leave real headroom. */
      max_tokens: CAP,
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: withTimeout(120000),
  });
  // A rejected request comes back as an ordinary non-streamed JSON error body.
  if (!r.ok || !r.body) {
    await readJson(r, 'Anthropic');
    throw new Error('Anthropic accepted the request but sent no response body');
  }

  const { text, stopReason, outputTokens } = await readAnthropicStream(r);
  if (stopReason === 'refusal') throw new Error('the model declined this request');
  // HTTP 200 with JSON that stops halfway otherwise surfaces as a parse failure and
  // blames the model for malformed output instead of naming the budget. Say what happened.
  if (stopReason === 'max_tokens' && !extractJson(text)) {
    throw new Error(`ran out of room before finishing the JSON — hit the ${CAP}-token ceiling${outputTokens ? ` (used ${outputTokens})` : ''}. Thinking counts against it.`);
  }
  if (!text.trim()) throw new Error('empty response');
  return text;
}

async function callOpenAICompatible(provider, apiKey, model, prompt) {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const body = { model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } };
  if (provider === 'openai') body.max_completion_tokens = 4000; else body.max_tokens = 4000;
  let r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body), signal: withTimeout(90000),
  });
  if (!r.ok) {
    const errText = await r.text();
    if (r.status === 400 && /response_format/i.test(errText)) {
      delete body.response_format;
      r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body), signal: withTimeout(90000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } else {
      throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
    }
  }
  const data = await readJson(r, provider);
  const msg = data.choices?.[0]?.message?.content;
  if (!msg) throw new Error('empty response');
  return msg;
}

async function callGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: withTimeout(90000),
  });
  const data = await readJson(r, 'Gemini');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response from Gemini');
  return text;
}

/* ---------------- parse + validate ---------------- */
function extractJson(text) {
  try { return JSON.parse(text); } catch { }
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { } }
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { } }
  return null;
}
function validAnalysis(a) {
  return a && typeof a.pick === 'string' && typeof a.summary === 'string' && a.summary.length > 0;
}
function clampAnalysis(a) {
  const arr = (x) => Array.isArray(x) ? x.filter(s => typeof s === 'string').slice(0, 6).map(s => s.slice(0, 160)) : [];
  const conf = ['low', 'medium', 'high'].includes(String(a.confidence).toLowerCase()) ? String(a.confidence).toLowerCase() : 'low';
  return {
    pick: String(a.pick || '').slice(0, 80),
    market: String(a.market || '').slice(0, 20).toLowerCase(),
    confidence: conf,
    edge: String(a.edge || '').slice(0, 240),
    keyFactors: arr(a.keyFactors),
    risks: arr(a.risks),
    summary: String(a.summary || '').slice(0, 600),
  };
}
