// Cloudflare Pages Function: POST /api/ai-pick
// Calls the selected AI model server-side (keys stay in Cloudflare env vars, never in the browser)
// and returns lottery number picks with the model's reasoning.
//
// Env vars (Cloudflare Pages → Settings → Environment variables):
//   ANTHROPIC_API_KEY  — enables Fable 5 + Opus 5
//   OPENAI_API_KEY     — enables GPT-5.6 Sol + Terra
//   XAI_API_KEY        — enables Grok 4.5
//   GEMINI_API_KEY     — enables Gemini 3.x models (GOOGLE_API_KEY also accepted)
//   APP_USER / APP_PASSWORD — login gate (defaults admin / admin if unset)
//   APP_PASSCODE       — optional; if set, requests must carry the matching x-app-pass header
//
// Honest by design: no model can raise the odds of winning. The prompt asks for
// statistically-typical, low-crowd-share lines with reasoning — the same real edge
// the app's Smart Pick has, plus an actual explanation.
import { verifySession, sessionSecret } from '../_session.js';

const MODELS = {
  // Not a model — a panel. Fans the question out to the strongest model from every
  // configured provider in parallel, then has one of them adjudicate the results.
  super: { provider: 'ensemble', id: null, name: 'Super Intelligence', ensemble: true },
  fable: { provider: 'anthropic', id: 'claude-fable-5', name: 'Claude Fable 5' },
  opus: { provider: 'anthropic', id: 'claude-opus-5', name: 'Claude Opus 5' },
  grok: { provider: 'xai', id: 'grok-4.5', name: 'Grok 4.5' },
  sol: { provider: 'openai', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  terra: { provider: 'openai', id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  geminipro: { provider: 'google', id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
  geminiflash: { provider: 'google', id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
  gemini2flash: { provider: 'google', id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
};

// One seat per provider, strongest model first — a panel of four near-identical
// Geminis would just agree with itself.
const PANEL_SEATS = [
  ['anthropic', 'opus'], ['openai', 'sol'], ['xai', 'grok'], ['google', 'geminipro'],
];
const PROVIDERS = ['anthropic', 'openai', 'xai', 'google'];

const GAMES = {
  pb: { name: 'Powerball', pick: 5, max: 69, bonus: 'Powerball', bonusMax: 26 },
  mm: { name: 'Mega Millions', pick: 5, max: 70, bonus: 'Mega Ball', bonusMax: 24 },
  m4l: { name: 'Millionaire for Life', pick: 5, max: 58, bonus: 'Millionaire Ball', bonusMax: 5 },
  p6: { name: 'Pick-6 (NJ)', pick: 6, max: 46 },
  jc5: { name: 'Jersey Cash 5', pick: 5, max: 45, note: 'The Bullseye is drawn from the winning numbers, so players do not pick it.' },
  p3: { name: 'Pick-3 (NJ)', digits: 3 },
  p4: { name: 'Pick-4 (NJ)', digits: 4 },
  pop: { name: 'Cash Pop', pick: 1, max: 15 },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-app-pass',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });

const keyFor = (env, provider) =>
  provider === 'anthropic' ? env.ANTHROPIC_API_KEY :
  provider === 'openai' ? env.OPENAI_API_KEY :
  provider === 'xai' ? env.XAI_API_KEY :
  provider === 'google' ? (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) : null;

const readyProviders = (env) => PROVIDERS.filter((p) => keyFor(env, p));
// The panel needs at least two makers to disagree with each other; one seat is just
// that model with extra steps, so Super Intelligence stays unavailable below two.
const isAvailable = (env, m) => (m.ensemble ? readyProviders(env).length >= 2 : !!keyFor(env, m.provider));

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET → capability report so the app knows which models it can offer
export async function onRequestGet(context) {
  const { env } = context;
  const models = {};
  for (const [k, m] of Object.entries(MODELS)) models[k] = { name: m.name, available: isAvailable(env, m) };
  return json({ ok: true, models, passcodeRequired: !!env.APP_PASSCODE });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (env.APP_PASSCODE && request.headers.get('x-app-pass') !== env.APP_PASSCODE) {
    // signed-in users skip the passcode
    const user = await verifySession(request.headers.get('cookie'), sessionSecret(env));
    if (!user) return json({ error: 'passcode' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const M = MODELS[body.model];
  const G = GAMES[body.game];
  if (!M) return json({ error: 'unknown model' }, 400);
  if (!G) return json({ error: 'unknown game' }, 400);
  if (!isAvailable(env, M)) {
    return json({ error: M.ensemble ? 'Super Intelligence needs at least two AI providers configured' : `${M.name} is not configured` }, 503);
  }

  const count = Math.min(5, Math.max(1, parseInt(body.count, 10) || 1));

  if (M.ensemble) {
    try {
      return json(await runPanel(env, G, count, body));
    } catch (e) {
      return json({ error: `Super Intelligence: ${String(e.message || e).slice(0, 300)}` }, 502);
    }
  }

  const apiKey = keyFor(env, M.provider);
  const prompt = buildPrompt(G, count, body);

  try {
    const callApi = (pPrompt) => callModel(M, apiKey, pPrompt, { effort: 'high' });
    const raw = await callApi(prompt);

    const picks = extractJson(raw);
    const check = validate(picks, G, count);
    if (!check.ok) {
      // one corrective retry, then give up honestly
      const retryRaw = await callApi(prompt + `\n\nYour previous answer was invalid: ${check.reason}. Return corrected JSON only.`);
      const retryPicks = extractJson(retryRaw);
      const retryCheck = validate(retryPicks, G, count);
      if (!retryCheck.ok) return json({ error: `${M.name} returned invalid picks (${retryCheck.reason}) — try again` }, 502);
      return json({ ok: true, model: M.name, lines: retryPicks.lines.slice(0, count), note: retryPicks.note || '' });
    }
    return json({ ok: true, model: M.name, lines: picks.lines.slice(0, count), note: picks.note || '' });
  } catch (e) {
    return json({ error: `${M.name}: ${String(e.message || e).slice(0, 300)}` }, 502);
  }
}

/* ---------------- Super Intelligence: panel + adjudication ----------------
   Round 1 — every configured provider's strongest model answers the same question
   in parallel, each producing more candidate lines than we need plus its read of
   the history. Round 2 — one model sees all of round 1 and picks the final lines,
   which is where cross-model agreement and disagreement actually gets used. A slow
   or broken provider drops out of the panel instead of failing the whole request. */
async function runPanel(env, G, count, body) {
  const panel = PANEL_SEATS
    .map(([provider, key]) => ({ ...MODELS[key], apiKey: keyFor(env, provider) }))
    .filter((m) => m.apiKey);
  if (panel.length < 2) throw new Error('needs at least two AI providers configured');

  const candidates = Math.min(5, count + 2);
  const analystPrompt = buildPrompt(G, candidates, body, { panel: true });

  const settled = await Promise.allSettled(panel.map(async (m) => {
    const raw = await callModel(m, m.apiKey, analystPrompt, { effort: 'high', timeoutMs: 75000 });
    const picks = extractJson(raw);
    const check = validate(picks, G, candidates);
    if (!check.ok) throw new Error(check.reason);
    return { name: m.name, lines: picks.lines.slice(0, candidates), read: picks.note || '' };
  }));

  const seats = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!seats.length) throw new Error('every model on the panel failed — try a single model');
  const dropped = panel.length - seats.length;

  // Adjudicate. Anthropic chairs when configured; otherwise the first seat that answered.
  const chairModel = panel.find((m) => m.provider === 'anthropic' && seats.some((s) => s.name === m.name))
    || panel.find((m) => seats.some((s) => s.name === m.name));
  const panelNames = seats.map((s) => s.name);

  if (seats.length >= 2) {
    try {
      const raw = await callModel(chairModel, chairModel.apiKey, buildChairPrompt(G, count, body, seats), { effort: 'high', timeoutMs: 90000 });
      const picks = extractJson(raw);
      const check = validate(picks, G, count);
      if (check.ok) {
        return {
          ok: true, model: 'Super Intelligence', lines: picks.lines.slice(0, count),
          note: picks.note || '', panel: panelNames, chair: chairModel.name, dropped,
        };
      }
    } catch { /* fall through to the best single panel answer below */ }
  }

  // Chair failed or only one seat answered — return the strongest raw panel answer
  // rather than nothing, and say so plainly instead of passing it off as a verdict.
  const best = seats[0];
  return {
    ok: true, model: 'Super Intelligence', lines: best.lines.slice(0, count),
    note: (seats.length >= 2 ? `Panel agreed to hand off: ${best.name}'s lines. ` : `Only ${best.name} answered. `) + (best.read || ''),
    panel: panelNames, chair: null, dropped,
  };
}

/* ---------------- prompt ----------------
   Two objectives, deliberately kept separate in the prompt because they pull in
   different directions: profile fit shapes a line that looks like draws actually
   look, crowd avoidance shapes one few other players would have picked. Asking
   for both at once, with the reasoning steps spelled out, produces noticeably
   better-argued lines than the old "build a low-crowd line" one-liner. */
function gameContext(G, body) {
  const matrix = G.digits
    ? `${G.digits} digits, each 0-9 (order matters for a straight bet)`
    : `${G.pick} distinct numbers from 1 to ${G.max}` + (G.bonusMax ? `, plus one ${G.bonus} from 1 to ${G.bonusMax}` : '');
  const recent = Array.isArray(body.recent) && body.recent.length
    ? `Recent real draws (oldest to newest):\n${body.recent.slice(-15).map(String).join('\n')}`
    : 'No recent draw data provided.';
  const hot = Array.isArray(body.hot) && body.hot.length ? `Most frequently drawn recently: ${body.hot.join(', ')}` : '';
  const cold = Array.isArray(body.cold) && body.cold.length ? `Longest without appearing: ${body.cold.join(', ')}` : '';
  const jackpot = body.jackpot ? `Current jackpot: ${body.jackpot}.` : '';
  return `Game: ${G.name} — pick ${matrix}.${G.note ? ' ' + G.note : ''}
${jackpot}
${recent}
${hot}
${cold}`;
}

const GROUND_RULES = `Ground rules you must respect and never contradict:
- Every combination has exactly the same chance. Past draws do not influence future draws. Nothing you do raises the probability of winning, and you must never imply otherwise.
- Never call a number "due", and never treat a hot or cold streak as predictive. Frequency data describes what has already happened; it forecasts nothing.
- Both objectives below are real and worth doing, but only the second one changes anything you can actually bank. Be honest about that.`;

const OBJECTIVES = (G) => `You are optimising for two things at once. Every line must satisfy both.

OBJECTIVE A — PROFILE FIT (make the line look like a real winning draw)
Winning combinations are drawn uniformly, but they are not spread uniformly across the *shapes* a combination can take: most real draws land in a narrow band on sum, balance and spread, because far more combinations sit there. A line built at the extremes of those bands is a combination almost no draw has ever resembled. Use the history above to work out, and then hit:
- Sum: land inside the central band of the recent winning sums, not at the extremes.
- Odd/even: near-balanced. All-odd and all-even lines are rare in practice.
${G.digits ? '' : `- High/low: near-balanced around the midpoint of the 1-${G.max} range.
- Spread: cover the range. Do not cluster several numbers in one decade.
- Adjacency: at most one consecutive pair. Real draws rarely contain runs.
`}This does not improve your odds — it means the line resembles the kind of combination that actually comes up, instead of one that has never looked like a winner.

OBJECTIVE B — CROWD AVOIDANCE (own more of the prize if it does hit)
This one has real, bankable value: prizes are shared between everyone holding the line, so an unpopular line is worth more money when it wins. Actively avoid:
- Every number ≤ 31 (birthday picks — the single most crowded pattern there is).
- Arithmetic runs and patterns: 5-10-15-20-25, all multiples of 7, straight sequences.
- Famous sets, jersey numbers, dates, and "lucky" numbers (7, 11, 13, 21).
- Geometric patterns on a physical playslip grid (rows, columns, diagonals).
- Simply copying a recent winning draw — thousands of players do exactly that.
Numbers above 31 are structurally under-played and are your cheapest edge here.

Where A and B conflict, satisfy A first (the line should still look like a plausible draw) and then push toward B as hard as the profile allows.`;

const OUTPUT_SHAPE = (G) => `Return ONLY JSON in exactly this shape. No markdown, no commentary outside the JSON:
{"lines":[{"numbers":[${G.digits ? 'digit, digit, ...' : 'n1, n2, ...'}],"bonus":${G.bonusMax ? 'bonusNumber' : 'null'},"why":"..."}],"note":"..."}`;

function buildPrompt(G, count, body, opts = {}) {
  const forPanel = !!opts.panel;
  return `You are picking ${G.name} lottery lines for a New Jersey player, for entertainment.

${GROUND_RULES}

${gameContext(G, body)}

${OBJECTIVES(G)}

Work through it in this order before you answer:
1. Read the history: typical sum range, typical odd/even and high/low splits, how spread out a normal draw is.
2. Note which zones of the board are over-played by other people (see Objective B).
3. Build ${count} candidate line${count > 1 ? 's' : ''} that sit in the typical zones on shape while staying out of the crowded zones on popularity.
4. Check each line against both objectives and fix any that fail. Make the lines different from each other — do not submit ${count} variations of one idea.

For each line write a "why" (max 160 chars) naming the concrete reason it passes: its sum, its split, and the crowd pattern it dodges. Be specific and readable, not generic. Never promise better odds.
${forPanel
    ? 'For "note" (max 220 chars): give your read of this game\'s history — the sum band, the splits, and anything genuinely notable. Another model will compare your read against other models\', so be precise and state what you are confident about versus guessing.'
    : 'For "note" (max 200 chars): one short paragraph in your own voice on how you built these.'}

${OUTPUT_SHAPE(G)}`;
}

// Round 2 of the panel: one model sees every other model's lines and reasoning.
function buildChairPrompt(G, count, body, seats) {
  const dossier = seats.map((s, i) => `--- PANEL MEMBER ${i + 1}: ${s.name} ---
Their read of the history: ${s.read || '(none given)'}
Their candidate lines:
${s.lines.map((L) => `  ${G.digits ? (L.numbers || []).join('') : (L.numbers || []).join(' ')}${L.bonus != null ? ' +' + L.bonus : ''} — ${L.why || ''}`).join('\n')}`).join('\n\n');

  return `You are chairing a panel of frontier AI models that independently analysed the same ${G.name} lottery data. Your job is to produce the final ${count} line${count > 1 ? 's' : ''} the player will actually buy.

${GROUND_RULES}

${gameContext(G, body)}

${OBJECTIVES(G)}

Here is what each panel member independently concluded:

${dossier}

Adjudicate. This is the part that makes a panel worth more than one model, so use it properly:
1. Compare their reads of the history. Where they agree on the sum band and the splits, that is your most reliable signal — several independent analyses converged. Where they disagree, work out who is actually right from the draw data above; do not split the difference.
2. Judge the candidate lines against both objectives, not by who proposed them. A line several members converged on is worth a hard look, but popularity inside the panel is not evidence — a line every member proposed may simply be the obvious line other players also pick, which makes it worse on Objective B.
3. Build the final ${count} line${count > 1 ? 's' : ''}. Take the best candidates outright, or construct better ones from what the panel established. Do not just average them — averaging number-by-number produces a line nobody reasoned about.
4. Make the final lines genuinely different from one another, and confirm each one passes both objectives.

For each line write a "why" (max 160 chars): its sum, its split, the crowd pattern it dodges, and where the panel stood on it — agreement, or which member you overruled and why.
For "note" (max 220 chars): what the panel agreed on, the sharpest disagreement and how you settled it. Honest, specific, no odds promises.

${OUTPUT_SHAPE(G)}`;
}

/* ---------------- providers (raw HTTP keeps this function dependency-free for zero-build Pages deploys) ---------------- */

// One entry point so the panel can call four different providers without caring which.
// timeoutMs bounds each call: on the panel, one wedged provider must not hold up the rest.
function callModel(M, apiKey, prompt, opts = {}) {
  const o = { effort: 'high', timeoutMs: 90000, ...opts };
  if (M.provider === 'anthropic') return callAnthropic(apiKey, M.id, prompt, o);
  if (M.provider === 'google') return callGemini(apiKey, M.id, prompt, o);
  return callOpenAICompatible(M.provider, apiKey, M.id, prompt, o);
}

const withTimeout = (ms) => AbortSignal.timeout(ms);

async function callAnthropic(apiKey, model, prompt, opts = {}) {
  const schema = {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            numbers: { type: 'array', items: { type: 'integer' } },
            bonus: { type: ['integer', 'null'] },
            why: { type: 'string' },
          },
          required: ['numbers', 'bonus', 'why'],
          additionalProperties: false,
        },
      },
      note: { type: 'string' },
    },
    required: ['lines', 'note'],
    additionalProperties: false,
  };
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
      // max_tokens caps thinking AND response text together. The reasoning here is
      // deliberately deep, so leave real headroom — 6000 truncated mid-answer.
      max_tokens: 16000,
      fallbacks: 'default', // if a safety classifier ever declines, Anthropic retries on its recommended fallback model
      thinking: { type: 'adaptive' }, // let the model decide its own depth per game
      output_config: { effort: opts.effort || 'high', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: withTimeout(opts.timeoutMs || 90000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  if (data.stop_reason === 'refusal') throw new Error('the model declined this request');
  const text = (data.content || []).find((b) => b.type === 'text');
  if (!text) throw new Error('empty response');
  return text.text;
}

async function callOpenAICompatible(provider, apiKey, model, prompt, opts = {}) {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const signal = withTimeout(opts.timeoutMs || 90000);
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  };
  // OpenAI reasoning models take max_completion_tokens; xAI takes max_tokens.
  // Raised alongside Anthropic's — reasoning tokens are billed against this too.
  if (provider === 'openai') body.max_completion_tokens = 12000;
  else body.max_tokens = 12000;

  let r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    // some models reject response_format — retry once without it
    const errText = await r.text();
    if (r.status === 400 && /response_format/i.test(errText)) {
      delete body.response_format;
      r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } else {
      throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
    }
  }
  const data = await r.json();
  const msg = data.choices?.[0]?.message?.content;
  if (!msg) throw new Error('empty response');
  return msg;
}

async function callGemini(apiKey, model, prompt, opts = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 12000 }
    }),
    signal: withTimeout(opts.timeoutMs || 90000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response from Gemini');
  return text;
}

/* ---------------- parsing + validation ---------------- */
function extractJson(text) {
  try { return JSON.parse(text); } catch { }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { } }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { } }
  return null;
}

function validate(picks, G, count) {
  if (!picks || !Array.isArray(picks.lines) || !picks.lines.length) return { ok: false, reason: 'no lines array' };
  for (const line of picks.lines.slice(0, count)) {
    if (!Array.isArray(line.numbers)) return { ok: false, reason: 'numbers must be an array' };
    if (G.digits) {
      if (line.numbers.length !== G.digits || line.numbers.some((d) => !Number.isInteger(d) || d < 0 || d > 9)) {
        return { ok: false, reason: `each line needs exactly ${G.digits} digits 0-9` };
      }
    } else {
      const nums = line.numbers;
      if (nums.length !== G.pick) return { ok: false, reason: `each line needs exactly ${G.pick} numbers` };
      if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > G.max)) return { ok: false, reason: `numbers must be 1-${G.max}` };
      if (new Set(nums).size !== nums.length) return { ok: false, reason: 'numbers must be distinct' };
      if (G.bonusMax && (!Number.isInteger(line.bonus) || line.bonus < 1 || line.bonus > G.bonusMax)) {
        return { ok: false, reason: `bonus must be 1-${G.bonusMax}` };
      }
      nums.sort((a, b) => a - b);
    }
    if (typeof line.why !== 'string') line.why = '';
    line.why = line.why.slice(0, 200);
  }
  if (typeof picks.note !== 'string') picks.note = '';
  picks.note = picks.note.slice(0, 220);
  return { ok: true };
}
