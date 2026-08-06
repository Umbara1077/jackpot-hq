// Cloudflare Pages Function: POST /api/ai-pick
// Calls the selected AI model server-side (keys stay in Cloudflare env vars, never in the browser)
// and returns lottery number picks with the model's reasoning.
//
// Env vars (Cloudflare Pages → Settings → Environment variables):
//   ANTHROPIC_API_KEY  — enables Fable 5 + Opus 5
//   OPENAI_API_KEY     — enables GPT-5.6 Sol + Terra
//   XAI_API_KEY        — enables Grok 4.5
//   APP_PASSCODE       — optional; if set, requests must carry the matching x-app-pass header
//
// Honest by design: no model can raise the odds of winning. The prompt asks for
// statistically-typical, low-crowd-share lines with reasoning — the same real edge
// the app's Smart Pick has, plus an actual explanation.
import { verifySession } from '../_session.js';

const MODELS = {
  fable: { provider: 'anthropic', id: 'claude-fable-5', name: 'Claude Fable 5' },
  opus: { provider: 'anthropic', id: 'claude-opus-5', name: 'Claude Opus 5' },
  grok: { provider: 'xai', id: 'grok-4.5', name: 'Grok 4.5' },
  sol: { provider: 'openai', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  terra: { provider: 'openai', id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
};

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
  provider === 'anthropic' ? env.ANTHROPIC_API_KEY : provider === 'openai' ? env.OPENAI_API_KEY : env.XAI_API_KEY;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET → capability report so the app knows which models it can offer
export async function onRequestGet(context) {
  const { env } = context;
  const models = {};
  for (const [k, m] of Object.entries(MODELS)) models[k] = { name: m.name, available: !!keyFor(env, m.provider) };
  return json({ ok: true, models, passcodeRequired: !!env.APP_PASSCODE });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (env.APP_PASSCODE && request.headers.get('x-app-pass') !== env.APP_PASSCODE) {
    // signed-in users skip the passcode
    const user = await verifySession(request.headers.get('cookie'), env.SESSION_SECRET);
    if (!user) return json({ error: 'passcode' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const M = MODELS[body.model];
  const G = GAMES[body.game];
  if (!M) return json({ error: 'unknown model' }, 400);
  if (!G) return json({ error: 'unknown game' }, 400);
  const apiKey = keyFor(env, M.provider);
  if (!apiKey) return json({ error: `${M.name} is not configured — add the ${M.provider.toUpperCase()} API key in Cloudflare` }, 503);

  const count = Math.min(5, Math.max(1, parseInt(body.count, 10) || 1));
  const prompt = buildPrompt(G, count, body);

  try {
    const raw = M.provider === 'anthropic'
      ? await callAnthropic(apiKey, M.id, prompt)
      : await callOpenAICompatible(M.provider, apiKey, M.id, prompt);

    const picks = extractJson(raw);
    const check = validate(picks, G, count);
    if (!check.ok) {
      // one corrective retry, then give up honestly
      const retryRaw = M.provider === 'anthropic'
        ? await callAnthropic(apiKey, M.id, prompt + `\n\nYour previous answer was invalid: ${check.reason}. Return corrected JSON only.`)
        : await callOpenAICompatible(M.provider, apiKey, M.id, prompt + `\n\nYour previous answer was invalid: ${check.reason}. Return corrected JSON only.`);
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

/* ---------------- prompt ---------------- */
function buildPrompt(G, count, body) {
  const matrix = G.digits
    ? `${G.digits} digits, each 0-9 (order matters for a straight bet)`
    : `${G.pick} distinct numbers from 1 to ${G.max}` + (G.bonusMax ? `, plus one ${G.bonus} from 1 to ${G.bonusMax}` : '');
  const recent = Array.isArray(body.recent) && body.recent.length
    ? `Recent real draws (oldest to newest):\n${body.recent.slice(-15).map(String).join('\n')}`
    : 'No recent draw data provided.';
  const hot = Array.isArray(body.hot) && body.hot.length ? `Most frequently drawn recently: ${body.hot.join(', ')}` : '';
  const cold = Array.isArray(body.cold) && body.cold.length ? `Longest without appearing: ${body.cold.join(', ')}` : '';
  const jackpot = body.jackpot ? `Current jackpot: ${body.jackpot}.` : '';

  return `You are picking ${G.name} lottery lines for a New Jersey player, for entertainment.

Ground rules you must respect (and never contradict):
- Every combination has identical odds; past draws do not influence future draws. You cannot improve the chance of winning.
- What you CAN do: build statistically typical lines that avoid combinations popular with other players (all numbers ≤31 "birthday" picks, obvious sequences, famous number sets), because unpopular numbers split a shared jackpot with fewer people.
- You may use the draw history for flavor and pattern commentary, but never claim a number is "due" or "hot" as if it changes probability.

Game: ${G.name} — pick ${matrix}.${G.note ? ' ' + G.note : ''}
${jackpot}
${recent}
${hot}
${cold}

Task: produce ${count} line${count > 1 ? 's' : ''}. For each line give a one-sentence "why" (max 140 chars) that is fun and specific — mention spread, sum, crowd-avoidance, or a nod to the history — without promising better odds. Also give one short overall "note" (max 160 chars) in your own voice.

Return ONLY JSON in exactly this shape (no markdown, no commentary outside the JSON):
{"lines":[{"numbers":[${G.digits ? 'digit, digit, ...' : 'n1, n2, ...'}],"bonus":${G.bonusMax ? 'bonusNumber' : 'null'},"why":"..."}],"note":"..."}`;
}

/* ---------------- providers (raw HTTP keeps this function dependency-free for zero-build Pages deploys) ---------------- */
async function callAnthropic(apiKey, model, prompt) {
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
      max_tokens: 6000, // hard cap on thinking + response together
      fallbacks: 'default', // if a safety classifier ever declines, Anthropic retries on its recommended fallback model
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  if (data.stop_reason === 'refusal') throw new Error('the model declined this request');
  const text = (data.content || []).find((b) => b.type === 'text');
  if (!text) throw new Error('empty response');
  return text.text;
}

async function callOpenAICompatible(provider, apiKey, model, prompt) {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  };
  // OpenAI reasoning models take max_completion_tokens; xAI takes max_tokens
  if (provider === 'openai') body.max_completion_tokens = 4000;
  else body.max_tokens = 4000;

  let r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
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
