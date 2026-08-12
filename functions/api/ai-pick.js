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

/* Who sits on the panel. Order matters twice: seats are listed in this order, and the
   chair is the first seat in this list that actually answered — so the most capable
   model available does the adjudicating.

   Anthropic gets two seats because Fable 5 and Opus 5 are genuinely different models
   with different training, not near-duplicates. The rule this list follows is "no two
   seats that would just agree with each other" — which is why Google gets one seat
   (3.1 Pro) rather than all three Geminis, and OpenAI gets Sol rather than Sol + Terra. */
const PANEL_SEATS = [
  ['anthropic', 'fable'],   // most capable → chairs when configured
  ['anthropic', 'opus'],
  ['openai', 'sol'],
  ['xai', 'grok'],
  ['google', 'geminipro'],
];
const PROVIDERS = ['anthropic', 'openai', 'xai', 'google'];

/* Effort profiles.
   `balanced` is deliberately byte-identical to the request that works in production —
   it is the default, and changing it is what took the standard models down before.
   Only Anthropic gets a real `effort` API parameter (it already had one). For the other
   providers effort is expressed through the token ceiling and a prompt line, because
   inventing new API fields per provider is exactly the move that broke things.
   Token ceilings are per provider because the known-good values differ: Anthropic ran
   6000 (thinking counts against it) and the chat-completions providers ran 4000. At
   `balanced` both must reproduce those exactly. */
const EFFORTS = {
  quick: {
    label: 'Quick', anthropic: 'low', maxTokens: 6000, chatTokens: 4000, ms: 60000,
    guide: 'Keep your reasoning brief. Go with a sound answer rather than an exhaustive one.',
  },
  // ⚠ balanced === the shipped, working request. Do not tune these three fields.
  balanced: { label: 'Balanced', anthropic: 'medium', maxTokens: 6000, chatTokens: 4000, ms: 120000, guide: '' },
  /* maxTokens below has to be far larger than the answer, because on Anthropic it caps
     thinking AND response text together — and raising `effort` is precisely an
     instruction to spend more of it thinking. At `high`/`max` the JSON is a rounding
     error next to the reasoning, so a ceiling sized for the answer gets consumed before
     the model starts writing and the reply arrives truncated mid-JSON. Anthropic's own
     floor for `max` is 64000. chatTokens is untouched: the other providers never receive
     an effort parameter, which is why they were never affected. */
  deep: {
    label: 'Deep', anthropic: 'high', maxTokens: 32000, chatTokens: 12000, ms: 210000,
    guide: 'Reason thoroughly before answering. Work the history properly, weigh several candidate lines against both objectives, and discard the ones that fail.',
  },
  max: {
    label: 'Maximum', anthropic: 'max', maxTokens: 64000, chatTokens: 16000, ms: 300000,
    guide: 'Take as long as you need. Explore the number space widely, build more candidates than you need, stress-test each against both objectives, and only then choose. Depth matters more than speed here.',
  },
};
const effortOf = (k) => EFFORTS[k] || EFFORTS.balanced;
const effortKey = (k) => (EFFORTS[k] ? k : 'balanced');
// The panel is the deep-reasoning mode by definition — never run its seats below `deep`.
const panelEffort = (k) => (k === 'max' ? 'max' : 'deep');

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
  const eKey = effortKey(body.effort);

  // Provider self-test. Answers "why did this model not work?" with the provider's own
  // words instead of a guess, and tests the standard and deep request shapes separately
  // so it is obvious whether the deep settings are the problem or the provider is.
  if (body.diag) {
    try { return json(await runDiag(env, G, body, eKey)); }
    catch (e) { return json({ error: `diagnostics failed: ${String(e.message || e).slice(0, 300)}` }, 502); }
  }
  const run = (emit) => (M.ensemble ? runPanel(env, G, count, body, eKey, emit) : runSingle(env, M, G, count, body, eKey, emit));

  // Streaming is opt-in so an older cached client keeps getting the plain JSON it expects.
  if (body.stream) return ndjson(run, M.name);
  try {
    return json(await run(() => {}));
  } catch (e) {
    return json({ error: `${M.name}: ${String(e.message || e).slice(0, 300)}` }, 502);
  }
}

/* ---------------- progress stream ----------------
   Newline-delimited JSON rather than SSE: the client only needs one-way progress and
   NDJSON needs no event-framing on either end. The Response is returned immediately
   and written to as work happens, so the connection also acts as a keep-alive for the
   long panel runs — the browser sees bytes instead of an idle socket. */
function ndjson(run, label) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n')).catch(() => {});

  (async () => {
    const t0 = Date.now();
    // Heartbeat. A model can think for a minute with nothing to report, and a silent
    // socket is indistinguishable from a dead one — this proves the run is still alive
    // and gives the loading screen a clock that is coming from the server, not the tab.
    const beat = setInterval(() => send({ t: 'tick', ms: Date.now() - t0 }), 3000);
    try {
      send({ t: 'tick', ms: 0 }); // first beat immediately, so the clock starts at once
      const result = await run((ev) => send(ev));
      await send({ t: 'done', ms: Date.now() - t0, ...result });
    } catch (e) {
      await send({ t: 'error', error: `${label}: ${String(e.message || e).slice(0, 300)}` });
    } finally {
      clearInterval(beat);
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

/* Calls every panel seat twice — once with the standard request, once with the deep one —
   and reports exactly what each provider said. No retries, no salvage, no interpretation:
   the point is to see the raw failure, including a snippet of whatever came back. */
async function runDiag(env, G, body, eKey) {
  const seats = PANEL_SEATS
    .map(([provider, key]) => ({ ...MODELS[key], apiKey: keyFor(env, provider) }))
    .filter((m) => m.apiKey);
  const E = effortOf(panelEffort(eKey));
  const prompt = buildPrompt(G, 1, body, { panel: true });
  const deepPrompt = buildPrompt(G, 1, body, { panel: true, effort: panelEffort(eKey) });

  const probe = async (m, label, promptText, opts) => {
    const t0 = Date.now();
    try {
      const raw = await callModel(m, m.apiKey, promptText, { ...opts, timeoutMs: 45000 });
      const picks = extractJson(raw);
      const v = validateSome(picks, G, 1);
      return { mode: label, ok: v.ok, ms: Date.now() - t0, error: v.ok ? '' : `parsed but unusable: ${v.reason}`, sample: String(raw || '').slice(0, 200) };
    } catch (e) {
      return { mode: label, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 400), sample: '' };
    }
  };

  const checks = await Promise.all(seats.map(async (m) => {
    const standard = await probe(m, 'standard', prompt, {});
    const deep = await probe(m, 'deep', deepPrompt, { effort: E.anthropic, maxTokens: E.maxTokens, chatTokens: E.chatTokens, deepThinking: true });
    return { name: m.name, provider: m.provider, id: m.id, standard, deep };
  }));

  return { ok: true, diag: true, game: G.name, effort: E.label, checks };
}

/* Panel seats salvage what they can: keep the lines that validate, drop the ones that
   do not. One malformed line out of five should not delete an entire model's
   contribution — that is all-or-nothing behaviour the single-pick path never had,
   because it only ever asks for the lines the user wanted. */
function validateSome(picks, G, want) {
  if (!picks || !Array.isArray(picks.lines) || !picks.lines.length) return { ok: false, reason: 'no lines array' };
  const good = [];
  for (const line of picks.lines) {
    const probe = { lines: [line], note: '' };
    if (validate(probe, G, 1).ok) good.push(probe.lines[0]);
    if (good.length >= want) break;
  }
  if (!good.length) return { ok: false, reason: 'no line passed validation' };
  return { ok: true, lines: good };
}

async function runSingle(env, M, G, count, body, eKey, emit = () => {}) {
  const apiKey = keyFor(env, M.provider);
  const E = effortOf(eKey);
  const prompt = buildPrompt(G, count, body, { effort: eKey });
  const started = Date.now();
  emit({ t: 'seat', slot: 'seat', state: 'start', name: M.name, role: 'Building your lines', effort: E.label });

  const callApi = (pPrompt) => callModel(M, apiKey, pPrompt, { effort: E.anthropic, maxTokens: E.maxTokens, chatTokens: E.chatTokens });
  let picks = extractJson(await callApi(prompt));
  let check = validate(picks, G, count);
  if (!check.ok) {
    emit({ t: 'seat', slot: 'seat', state: 'retry', name: M.name, reason: check.reason });
    picks = extractJson(await callApi(prompt + `\n\nYour previous answer was invalid: ${check.reason}. Return corrected JSON only.`));
    check = validate(picks, G, count);
    if (!check.ok) throw new Error(`returned invalid picks (${check.reason}) — try again`);
  }
  emit({ t: 'seat', slot: 'seat', state: 'done', name: M.name, ms: Date.now() - started, lines: picks.lines.length });
  return {
    ok: true, model: M.name, effort: E.label, lines: picks.lines.slice(0, count), note: picks.note || '',
    seats: [{ name: M.name, read: picks.note || '', lines: picks.lines.slice(0, count) }],
  };
}

/* ---------------- Super Intelligence: panel + adjudication ----------------
   Round 1 — every configured provider's strongest model answers the same question
   in parallel, each producing more candidate lines than we need plus its read of
   the history. Round 2 — one model sees all of round 1 and picks the final lines,
   which is where cross-model agreement and disagreement actually gets used. A slow
   or broken provider drops out of the panel instead of failing the whole request. */
async function runPanel(env, G, count, body, eKey, emit = () => {}) {
  const panel = PANEL_SEATS
    .map(([provider, key]) => ({ ...MODELS[key], apiKey: keyFor(env, provider) }))
    .filter((m) => m.apiKey);
  if (panel.length < 2) throw new Error('needs at least two AI providers configured');

  const E = effortOf(panelEffort(eKey));
  const deep = { effort: E.anthropic, maxTokens: E.maxTokens, chatTokens: E.chatTokens, deepThinking: true };
  const candidates = Math.min(5, count + 2);
  const analystPrompt = buildPrompt(G, candidates, body, { panel: true, effort: panelEffort(eKey) });

  emit({ t: 'phase', phase: 'panel', of: panel.length, effort: E.label, names: panel.map((m) => m.name) });
  // slot distinguishes the chair's row from its own seat row — the chair is usually
  // one of the seats, so keying status rows by model name alone would overwrite it.
  for (const m of panel) emit({ t: 'seat', slot: 'seat', state: 'start', name: m.name, role: 'Analysing the draw history' });

  // Progress is emitted from inside each task so a fast provider reports the moment it
  // lands, instead of everyone appearing to finish together when allSettled resolves.
  /* Two attempts per seat, and the second one deliberately drops back to the exact
     configuration a single pick uses.

     This is why providers that answer fine on their own were vanishing from the panel:
     (1) the single-pick path has always had a corrective retry when a model returns
     malformed JSON, and the panel had none — one badly-formatted first answer and the
     seat was gone; (2) the panel also pushed a bigger token ceiling and a "reason
     thoroughly" prompt at providers only ever proven at the smaller, plainer settings.
     So attempt 1 is the deep profile, attempt 2 is the known-good one. */
  const safePrompt = buildPrompt(G, candidates, body, { panel: true }); // no deep guide
  const settled = await Promise.allSettled(panel.map(async (m) => {
    const started = Date.now();
    const attempt = async (prompt, opts) => {
      const picks = extractJson(await callModel(m, m.apiKey, prompt, opts)); // transport errors propagate
      // Salvage: keep whatever lines are valid. The panel asks each model for more lines
      // than the user wanted, so strict all-or-nothing validation gave every extra line
      // another chance to kill the whole seat.
      const check = validateSome(picks, G, candidates);
      if (!check.ok) { const err = new Error(check.reason); err.shape = true; throw err; }
      return { name: m.name, lines: check.lines, read: picks.note || '' };
    };
    let seat;
    try {
      seat = await attempt(analystPrompt, { ...deep, timeoutMs: 90000 });
    } catch (e1) {
      emit({ t: 'seat', slot: 'seat', state: 'retry', name: m.name, reason: `${String(e1.message || e1).slice(0, 90)} — retrying at standard settings` });
      try {
        // No opts = the single-pick request shape, which these providers demonstrably serve.
        seat = await attempt(safePrompt, { timeoutMs: 60000 });
      } catch (e2) {
        emit({ t: 'seat', slot: 'seat', state: 'fail', name: m.name, ms: Date.now() - started, reason: String(e2.message || e2).slice(0, 120) });
        throw e2;
      }
    }
    emit({ t: 'seat', slot: 'seat', state: 'done', name: m.name, ms: Date.now() - started, lines: seat.lines.length, read: seat.read });
    return seat;
  }));

  const seats = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!seats.length) throw new Error('every model on the panel failed — try a single model');
  const dropped = panel.length - seats.length;

  // The chair is simply the first seat in PANEL_SEATS order that answered — that list is
  // ordered most-capable-first, so Fable 5 chairs when it is configured and responded,
  // then Opus 5, then whoever else is left. A model that dropped out can never chair.
  const chairModel = panel.find((m) => seats.some((s) => s.name === m.name));
  const panelNames = seats.map((s) => s.name);
  const base = { ok: true, model: 'Super Intelligence', effort: E.label, panel: panelNames, seats, dropped };

  if (seats.length >= 2) {
    const started = Date.now();
    emit({ t: 'phase', phase: 'chair', name: chairModel.name });
    emit({ t: 'seat', slot: 'chair', state: 'start', name: chairModel.name, role: `Adjudicating ${seats.length} panel answers` });
    const chairPrompt = buildChairPrompt(G, count, body, seats);
    const chairTry = async (opts) => {
      const picks = extractJson(await callModel(chairModel, chairModel.apiKey, chairPrompt, opts));
      const check = validate(picks, G, count);
      if (!check.ok) { const err = new Error(check.reason); err.shape = true; throw err; }
      return picks;
    };
    try {
      let picks;
      try {
        picks = await chairTry({ ...deep, timeoutMs: 90000 });
      } catch (e1) {
        // Same fallback as the seats — don't lose the verdict to one malformed answer.
        emit({ t: 'seat', slot: 'chair', state: 'retry', name: chairModel.name, reason: `${String(e1.message || e1).slice(0, 90)} — retrying at standard settings` });
        picks = await chairTry({ timeoutMs: 60000 });
      }
      // chairTry only returns on a validated answer, so reaching here means a verdict.
      emit({ t: 'seat', slot: 'chair', state: 'done', name: chairModel.name, ms: Date.now() - started, lines: picks.lines.length, role: 'Verdict' });
      return { ...base, lines: picks.lines.slice(0, count), note: picks.note || '', chair: chairModel.name };
    } catch (e) {
      emit({ t: 'seat', slot: 'chair', state: 'fail', name: chairModel.name, ms: Date.now() - started, reason: String(e.message || e).slice(0, 120) });
    }
  }

  // Chair failed or only one seat answered — return the strongest raw panel answer
  // rather than nothing, and say so plainly instead of passing it off as a verdict.
  const best = seats[0];
  emit({ t: 'phase', phase: 'handoff', name: best.name });
  return {
    ...base, lines: best.lines.slice(0, count), chair: null,
    note: (seats.length >= 2 ? `No verdict — using ${best.name}'s lines. ` : `Only ${best.name} answered. `) + (best.read || ''),
  };
}

/* ---------------- prompt ----------------
   Two objectives, deliberately kept separate in the prompt because they pull in
   different directions: profile fit shapes a line that looks like draws actually
   look, crowd avoidance shapes one few other players would have picked. Asking
   for both at once, with the reasoning steps spelled out, produces noticeably
   better-argued lines than the old "build a low-crowd line" one-liner. */
// Theoretical shape of the game, straight from the matrix — no history needed.
// A uniform draw's sum is ~Normal(mean, sd); most real draws land within one sd of
// the mean, and a balanced draw splits roughly half odd / half high. Giving the model
// these exact numbers beats asking it to infer them from a handful of raw draw lines.
function matrixTargets(G) {
  if (G.digits || !G.pick || G.pick < 2 || !G.max) return null;
  const mean = G.pick * (G.max + 1) / 2;
  const sd = Math.sqrt(G.pick * (G.max + 1) * (G.max - G.pick) / 12);
  const lo = Math.floor(G.pick / 2), hi = Math.ceil(G.pick / 2);
  const split = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return {
    sumLo: Math.round(mean - sd), sumHi: Math.round(mean + sd), sumMean: Math.round(mean),
    mid: Math.round((G.max + 1) / 2), split,
    decades: Math.min(G.pick, Math.ceil(G.max / 10)),
  };
}

// Empirical shape of the real recent draws, computed client-side and passed in as
// body.stats. This is the "based on data" ground truth — what draws actually look like,
// not just what the math says they should.
function statsLine(G, s) {
  if (!s || G.digits) return '';
  const bits = [];
  if (Number.isFinite(s.sumLo) && Number.isFinite(s.sumHi)) bits.push(`sums usually ${s.sumLo}–${s.sumHi} (avg ${s.sumMean})`);
  if (Number.isFinite(s.oddAvg)) bits.push(`about ${s.oddAvg} odd / ${s.evenAvg} even`);
  if (Number.isFinite(s.highAvg)) bits.push(`about ${s.highAvg} above the midpoint / ${s.lowAvg} below`);
  if (!bits.length) return '';
  return `What real draws actually look like (measured over the last ${s.draws || 'many'} draws): ${bits.join('; ')}.`;
}

function gameContext(G, body) {
  const matrix = G.digits
    ? `${G.digits} digits, each 0-9 (order matters for a straight bet)`
    : `${G.pick} distinct numbers from 1 to ${G.max}` + (G.bonusMax ? `, plus one ${G.bonus} from 1 to ${G.bonusMax}` : '');
  const recent = Array.isArray(body.recent) && body.recent.length
    ? `Recent real draws (oldest to newest):\n${body.recent.slice(-20).map(String).join('\n')}`
    : 'No recent draw data provided.';
  const hot = Array.isArray(body.hot) && body.hot.length ? `Most frequently drawn recently: ${body.hot.join(', ')}` : '';
  const cold = Array.isArray(body.cold) && body.cold.length ? `Longest without appearing: ${body.cold.join(', ')}` : '';
  const jackpot = body.jackpot ? `Current jackpot: ${body.jackpot}.` : '';

  const t = matrixTargets(G);
  const empirical = statsLine(G, body.stats);
  const profile = t
    ? `Statistical targets for this game (use these concrete numbers — do not re-derive them from a few draws):
- Sum: aim inside ${t.sumLo}–${t.sumHi} (the central band; the mean is ${t.sumMean}). Lines far outside this band almost never come up.
- Odd/even: aim near ${t.split} odd (the rest even). All-odd and all-even draws are rare.
- High/low: aim near ${t.split} numbers above ${t.mid} (the rest below). Both halves should be represented.
- Spread: cover about ${t.decades} different tens-groups; don't bunch several numbers in one decade.
${empirical ? empirical + '\n' : ''}These describe the *shape* of a typical draw. They do not raise your odds — every combination is equally likely — but a line that fits them looks like a real winning draw instead of one no draw has ever resembled.`
    : empirical;

  return `Game: ${G.name} — pick ${matrix}.${G.note ? ' ' + G.note : ''}
${jackpot}
${recent}
${hot}
${cold}
${profile}`;
}

const GROUND_RULES = `Ground rules you must respect and never contradict:
- Every combination has exactly the same chance. Past draws do not influence future draws. Nothing you do raises the probability of winning, and you must never imply otherwise.
- Never call a number "due", and never treat a hot or cold streak as predictive. Frequency data describes what has already happened; it forecasts nothing.
- Both objectives below are real and worth doing, but only the second one changes anything you can actually bank. Be honest about that.`;

const OBJECTIVES = (G) => `You are optimising for two things at once. Every line must satisfy both.

OBJECTIVE A — PROFILE FIT (make the line look like a real winning draw)
Winning combinations are drawn uniformly, but they are not spread uniformly across the *shapes* a combination can take: most real draws land in a narrow band on sum, balance and spread, because far more combinations sit there. A line built at the extremes of those bands is a combination almost no draw has ever resembled. Hit the "Statistical targets" and the measured shape given above — those are the numbers to match:
- Sum: land inside the stated central band, not at the extremes. Compute each line's sum and check it.
- Odd/even: match the stated split. All-odd and all-even lines are rare in practice.
${G.digits ? '' : `- High/low: match the stated above/below-midpoint split.
- Spread: cover the stated number of tens-groups. Do not cluster several numbers in one decade.
- Adjacency: at most one consecutive pair. Real draws rarely contain runs.
`}Where the measured shape of real recent draws differs from the theoretical targets, prefer what the real draws show. This does not improve your odds — it means the line resembles the kind of combination that actually comes up, instead of one that has never looked like a winner.

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
  const guide = effortOf(opts.effort).guide;
  return `You are picking ${G.name} lottery lines for a New Jersey player, for entertainment.
${guide ? '\n' + guide + '\n' : ''}

${GROUND_RULES}

${gameContext(G, body)}

${OBJECTIVES(G)}

Work through it in this order before you answer:
1. Take the statistical targets above as your shape spec (sum band, odd/even, high/low, spread). Cross-check them against the measured real-draw shape and the recent draws; where they differ, trust the measured data.
2. Note which zones of the board are over-played by other people (see Objective B).
3. Build ${count} candidate line${count > 1 ? 's' : ''} that sit inside the target shape while staying out of the crowded zones on popularity.
4. For each line, actually compute its sum and its odd/even and high/low counts, confirm they fall in the target bands, and fix any that miss. Make the lines different from each other — do not submit ${count} variations of one idea.

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
//
// ⚠ Every option here is OFF by default, and that is load-bearing. A single-model pick
// calls this with no opts and must produce byte-identical requests to the ones that
// worked before the panel existed. Turning deep reasoning and per-call deadlines on
// for everyone is exactly what broke the standard models: the requests got much slower
// (higher effort + adaptive thinking + a longer prompt) at the same moment they gained
// a 90s server deadline they never used to have, so they aborted and surfaced as 502s.
// Opt in per call site; never change the defaults.
function callModel(M, apiKey, prompt, opts = {}) {
  if (M.provider === 'anthropic') return callAnthropic(apiKey, M.id, prompt, opts);
  if (M.provider === 'google') return callGemini(apiKey, M.id, prompt, opts);
  return callOpenAICompatible(M.provider, apiKey, M.id, prompt, opts);
}

// Returns undefined when the runtime has no AbortSignal.timeout; `signal: undefined`
// is a valid fetch init, so the worst case is losing the deadline, not the request.
const withTimeout = (ms) => {
  if (!ms) return undefined; // no deadline requested — matches the original behaviour
  try { return AbortSignal.timeout(ms); } catch { return undefined; }
};

// Read a provider response as JSON without letting a non-JSON body masquerade as a
// parse error. Calling r.json() before checking r.ok means a gateway HTML page, a
// rate-limit page, or an empty body surfaces as a cryptic "Unexpected token" and
// hides the real HTTP status — read the text first, then surface status + a snippet.
async function readJson(r, label) {
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body handled below */ }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(data?.error?.message || text || '').slice(0, 200) || '(empty body)'}`);
  if (data == null) throw new Error(`${label} returned a non-JSON response (HTTP ${r.status}): ${text.slice(0, 200) || '(empty body)'}`);
  return data;
}

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
      // Defaults below are the known-good single-model values. max_tokens caps thinking
      // AND response text together, so the panel raises it alongside its higher effort.
      max_tokens: opts.maxTokens || 6000,
      fallbacks: 'default', // if a safety classifier ever declines, Anthropic retries on its recommended fallback model
      // Thinking is already on by default for these models; only the panel asks for it
      // explicitly, so a single pick sends the exact body it always sent.
      ...(opts.deepThinking ? { thinking: { type: 'adaptive' } } : {}),
      output_config: { effort: opts.effort || 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: withTimeout(opts.timeoutMs),
  });
  const data = await readJson(r, 'Anthropic');
  if (data.stop_reason === 'refusal') throw new Error('the model declined this request');
  const text = (data.content || []).find((b) => b.type === 'text');
  // Hitting the ceiling is the one failure that does not look like a failure: HTTP 200,
  // a text block, and JSON that simply stops halfway. Without this check it reaches the
  // parser, comes back null, and surfaces as "no lines array" — which blames the model
  // for malformed output instead of naming the budget as the cause. Say what happened.
  if (data.stop_reason === 'max_tokens' && !extractJson(text?.text || '')) {
    const cap = opts.maxTokens || 6000;
    const used = data.usage?.output_tokens;
    throw new Error(`ran out of room before finishing the JSON — hit the ${cap}-token ceiling${used ? ` (used ${used})` : ''}. Thinking counts against it, so raise the ceiling or drop to a lower effort.`);
  }
  if (!text) throw new Error('empty response');
  return text.text;
}

async function callOpenAICompatible(provider, apiKey, model, prompt, opts = {}) {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const signal = withTimeout(opts.timeoutMs);
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  };
  // OpenAI reasoning models take max_completion_tokens; xAI takes max_tokens.
  // chatTokens is separate from Anthropic's maxTokens — 4000 is the known-good value here.
  const cap = opts.chatTokens || 4000;
  if (provider === 'openai') body.max_completion_tokens = cap;
  else body.max_tokens = cap;

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
  const data = await readJson(r, provider);
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
      // No maxOutputTokens on purpose. Gemini counts thinking against it, and these
      // prompts reason a lot — capping it risks truncating mid-JSON on models that
      // work fine today. Leave Google's default; the timeout is the real bound.
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }),
    signal: withTimeout(opts.timeoutMs),
  });
  const data = await readJson(r, 'Gemini');
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
