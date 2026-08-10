# NJ Jackpot HQ

Your NJ Lottery tracker & number lab. Built Aug 5, 2026.

## Open it

- **PC:** double-click **`Jackpot HQ.cmd`** — refreshes live data, then opens the app with
  ticket-saving to disk turned on (see *Where your tickets are saved*). Needs Node installed.
  `index.html` still opens standalone if you'd rather, but saves only to localStorage.
- **Phone:** open your private artifact at
  https://claude.ai/code/artifact/49051ebc-c66d-49f5-abc1-dc28ac61a916
  (sign in to claude.ai → it's also under claude.ai/code/artifacts).t

## What's what

| File | Purpose |
|---|---|
| `index.html` | The app (PC entry point — loads `src/seeds.js` + `src/app-src.js`) |
| `src/app-src.js` | All app logic — edit here |
| `src/index-src.html` | HTML/CSS shell source used by the bundler |
| `src/seeds.js` | Embedded real draw history (NJ-only games) |
| `src/build.js` | Bundles everything into one portable file + the artifact variant |
| `functions/api/ai-pick.js` | Cloudflare Pages Function that answers AI Pick requests |
| `functions/api/auth/[action].js` | Sign in with Google / Apple (OAuth) |
| `functions/api/sync.js` | Cross-device sync blob for signed-in users (D1, KV fallback) |
| `migrations/` | D1 schema (`user_state` table) |
| `functions/_session.js` | Shared signed-cookie session helpers |
| `worker/index.js` + `wrangler.jsonc` | Makes Cloudflare run the API (see “Why variables were blocked”) |
| `scripts/serve.mjs` | Local server + the on-disk ticket store (`/api/store`) |
| `scripts/fetch-live.mjs` + `.github/workflows/refresh.yml` | Hourly cloud data refresh (`live.json`) |
| `DESIGN.md` | Design doc: games, odds, features, architecture |

## Why variables were blocked (read this before adding env vars)

Cloudflare deployed this repo as a **Worker with static assets**, not a Pages project. In that
mode the `functions/` folder is never executed — so `/api/*` returned 404 (no AI picks, no
sign-in) and the dashboard refused env vars: *“Variables cannot be added to a Worker that only
has static assets.”*

`wrangler.jsonc` + `worker/index.js` fix that: the Worker now has real code that routes `/api/*`
to the same handlers in `functions/` and serves everything else as static files. Once deployed,
**Settings → Variables and secrets** accepts values. Two things to check in the dashboard:

- **Worker name** must match `"name"` in `wrangler.jsonc` (currently `jackpot-hq`), or
  `wrangler deploy` publishes to a *different* Worker and your URL keeps serving the old build.
- **Deploy command** (Settings → Build) should be plain `npx wrangler deploy` — a leftover
  `--assets=.` flag can fight the config.

Add API keys as **Secrets**, not plaintext variables: `wrangler deploy` replaces plaintext vars
declared in config but preserves secrets. Same reason the KV binding for sync must be declared
in `wrangler.jsonc` rather than added in the dashboard.

### ⚠ Why your environment variables keep vanishing on their own

`wrangler deploy` is **declarative**: whatever `wrangler.jsonc` says is the complete truth for
the Worker. It has no `vars` block, so every deploy wipes plaintext variables added in the
dashboard. Nothing merges them back.

The reason it looks spontaneous: `.github/workflows/refresh.yml` runs **hourly**, commits
`live.json`, and pushes to `main` — and that push triggers a Cloudflare build, which runs
`wrangler deploy`, which clears the vars again. You never touched anything; a bot did.

Three fixes, use the first:

1. **Re-add every key as a Secret** (Settings → Variables and Secrets → *Encrypt* / type
   Secret). Secrets are stored separately and survive `wrangler deploy`. This is the fix.
2. Or stop the hourly redeploy: Cloudflare → your Worker → Settings → Build → **watch paths**,
   exclude `live.json`. Data still refreshes; pushes stop rebuilding the Worker.
3. Non-sensitive values only (never API keys — this repo is on GitHub) can go in a `"vars"`
   block in `wrangler.jsonc`, which makes them survive by being declared.

Note: the tracked file `api/ai-pick` is a static test fixture that reports every model as
available. It sits at the same path as the real endpoint; `run_worker_first` in `wrangler.jsonc`
keeps the Worker ahead of it, but deleting it would remove the trap entirely.

## AI Picks (Claude · GPT · Grok · Gemini 3.x)

The Lab's featured **AI Pick** card sends the game rules + recent real draws to the model you
choose (each shows its maker's mark in the picker) and returns picks with per-line reasoning.
It runs through `functions/api/ai-pick.js` on Cloudflare so API keys never touch the browser.
The app auto-detects which models are configured.

### ✦ Super Intelligence — the panel

Top of the model picker. Instead of asking one model, it runs two rounds:

1. **Fan-out.** The strongest model from *every* configured provider — Claude Opus 5, GPT-5.6
   Sol, Grok 4.5, Gemini 3.1 Pro — answers the same question **in parallel**, each producing
   extra candidate lines plus its own read of the draw history.
2. **Adjudication.** One model (Anthropic chairs when configured) receives every other model's
   lines *and* reasoning, resolves where their readings of the history disagree, and builds the
   final lines. It's told not to average them and warned that a line the whole panel converged
   on may just be the obvious line other *players* pick too — which makes it worse, not better.

Needs **two or more providers** configured; with one it's greyed out, because a panel of one is
just that model with extra steps. A provider that errors or stalls drops out of the panel
instead of failing your request, and the result names who took part, who chaired, and how many
dropped. If the chair itself fails you still get the best panel answer, labelled as such.

It is slower (two rounds, deepest reasoning setting) and costs the sum of its seats — roughly
$0.15–0.30 a pick versus $0.01–0.10 for a single model.

### What the models are actually asked to do

Every model, panel or single, now optimises for **two** things instead of one:

- **Profile fit** — match the shape of real winning draws: sum inside the typical band,
  balanced odd/even and high/low, spread across the range, at most one consecutive pair.
- **Crowd avoidance** — stay off numbers everyone else plays: all-≤31 birthday picks,
  arithmetic runs, multiples of 7, dates, playslip patterns, copied recent draws.

**Only the second one is worth money, and the app says so.** Profile fit does not raise your
odds — every combination is equally likely, always. It means the line resembles a combination
that actually comes up rather than one no draw has ever looked like. Crowd avoidance is the
real edge: it doesn't help you win, it means you split the prize with fewer people when you do.
The prompt forbids calling a number "due" and forbids treating hot/cold streaks as predictive.

Cost per pick is roughly $0.01–0.05 (Grok/Terra/Opus) up to ~$0.10 (Fable 5) for a single
model; Super Intelligence is the sum of its panel.

## Password login gate

The full-screen login gate appears until you sign in. Locally use **`admin` / `admin`**.
On Cloudflare Pages set **`APP_USER`** and **`APP_PASSWORD`**. Sessions are signed HttpOnly
cookies (`functions/api/auth/[action].js`). Signed-in users skip the AI passcode, and with the
D1 (or legacy KV) binding below their tickets/budget/settings follow them via
`functions/api/sync.js`.

## Cloud database (D1) — tickets that follow you

Today tickets live in **localStorage** on the phone/browser, plus optional **JSON backup**
and (on PC via `Jackpot HQ.cmd`) a **disk file**. Spend / won are calculated from those
tickets + draw results — they are not a separate ledger.

To keep the same tickets and budget across devices on Cloudflare, use **D1** (SQLite):

1. `npx wrangler login`
2. `npx wrangler d1 create jackpot-hq` — copy the `database_id`
3. In `wrangler.jsonc`, uncomment `d1_databases` and paste that id
4. `npx wrangler d1 migrations apply jackpot-hq --remote`
5. Deploy when you are ready (`npx wrangler deploy`) — **do not deploy until you ask to**

After deploy + sign-in, Account shows **Cloud database active**. Saves push to D1;
opening on another device pulls and merges tickets by id. JSON backup remains a good
offline spare.

Legacy option: a KV namespace bound as `USERS` still works if D1 is not set up.
`/api/sync` prefers D1 when both exist.

## Optional: Sign in with Google (+ Apple)

One-time Google setup (~5 minutes, free):

1. Go to https://console.cloud.google.com → create (or pick) a project.
2. **APIs & Services → OAuth consent screen** → External → fill in the app name + your email.
   The app only uses basic scopes (openid/email/profile), so no Google verification is needed.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*:
   - Authorized redirect URI: `https://YOUR-SITE.pages.dev/api/auth/google-cb`
     (add one per domain if you also use a custom domain)
4. Copy the **Client ID** and **Client secret** into the env vars below.

Apple sign-in also ships (`APPLE_*` vars below) but needs a paid Apple Developer membership —
skip it unless you already have one.

## Cloudflare env vars — the full checklist

Cloudflare Pages → your project → **Settings → Environment variables** (Production), then
**redeploy** (env changes only apply to new deployments).

**Minimum 6 for password login + the four AI providers:**

| Variable | Unlocks | Where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Fable 5 + Claude Opus 5 | console.anthropic.com → API keys |
| `OPENAI_API_KEY` | GPT-5.6 Sol + Terra | platform.openai.com → API keys |
| `XAI_API_KEY` | Grok 4.5 | console.x.ai |
| `GEMINI_API_KEY` | Gemini 3.1 Pro / 3.6 Flash / 3.5 Flash | aistudio.google.com → API keys |
| `APP_USER` | Login username (defaults to `admin` if unset) | any string you choose |
| `APP_PASSWORD` | Login password (defaults to `admin` if unset — set a real one in production) | any string you choose |

**Optional extras:**

| Variable | Unlocks | Where it comes from |
|---|---|---|
| `APP_PASSCODE` | Extra AI gate so strangers can't spend API credits (signed-in users skip it) | any string you choose |
| `SESSION_SECRET` | Stronger cookie signing (a built-in default works; set your own for production) | e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Sign in with Google | Google Cloud Console (steps above) |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Sign in with Apple (optional) | developer.apple.com (Services ID + .p8 key) |

Plus the D1 binding `DB` in `wrangler.jsonc` (see *Cloud database* above) for cross-device
sync. Legacy KV binding `USERS` still works as a fallback.

## Live data on this PC

`%LOCALAPPDATA%\JackpotHQ\updater.ps1` pulls current jackpots (PB/MM/Pick-6/Jersey Cash 5) and
the latest NJ-only results straight from njlottery.com and writes `live.js`, which the app reads
on open. **Launch the app with `Jackpot HQ.cmd`** — it refreshes the data then opens the app.
For background refreshes every 4 hours as well, run once in PowerShell:

```
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\DanteCorso\AppData\Local\JackpotHQ\updater.ps1"'
$t = @((New-ScheduledTaskTrigger -AtLogOn), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration (New-TimeSpan -Days 3650)))
Register-ScheduledTask -TaskName 'JackpotHQ Updater' -Action $a -Trigger $t -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)) -Force
```

(Remove anytime with `Unregister-ScheduledTask -TaskName 'JackpotHQ Updater'`.)

## Where your tickets are saved

Launch with **`Jackpot HQ.cmd`** and every ticket is written to a real file the moment you
save it — no account, no setup, nothing to click. The launcher starts `scripts/serve.mjs`
and opens the app at `http://localhost:8123`; the app posts its whole state to `/api/store`
after each change.

| File | What it is |
|---|---|
| `%LOCALAPPDATA%\JackpotHQ\state.json` | Everything — tickets, budget, settings. This is the real save file. |
| `%LOCALAPPDATA%\JackpotHQ\state.bak.json` | The previous version, kept automatically on every write. |
| `%LOCALAPPDATA%\JackpotHQ\tickets.csv` | One row per line played — double-click to open in Excel. |

Clearing your browser, switching browsers, or losing localStorage no longer loses tickets:
on open the app reads `state.json` back and **unions** it with whatever the browser has, so
neither copy can delete a ticket from the other. Account → **💾 Saved to this PC** shows the
exact paths. Files live outside the repo on purpose — this folder is OneDrive-synced and
Controlled Folder Access blocks script writes to it, which would silently break saving.

Opening `index.html` directly still works, but that's the old localStorage-only behavior —
use the `.cmd` if you want tickets on disk.

## Prize checking — verified against the official tiers

Jersey Cash 5 used to report a **phantom $4 win** on a losing ticket. The prize table carried a
`2/5 XTRA` tier worth $2, which then got multiplied by the draw's XTRA number. njlottery.com does
publish a tier by that name, but checking 14 consecutive draws it paid **$0 to 0 winners every
time**, while `2/5 B-E` paid ~10,000 winners a draw at $5. Matching 2 plain numbers is a loss,
XTRA or not, so that tier is gone.

Same pass corrected `4/5` and `3/5`: they are **FIXED** $250 / $15, not pari-mutuel, so the app
no longer shows them as "≈". Every Jersey Cash 5 outcome now matches the official tiers exactly:

| Match | Pays | Match | Pays |
|---|---|---|---|
| 5/5 | Jackpot (pari-mutuel) | 3/5 + Bullseye | $30 |
| 4/5 + Bullseye | $500 | 3/5 | $15 |
| 4/5 | $250 | 2/5 + Bullseye | $5 |
| | | 2/5 | **nothing** |

Anything the app reports is still worth checking against the official app before you throw a
ticket away — pari-mutuel jackpots and XTRA multipliers move.

## Stale results on the PC copy

Pick-3 and Pick-4 draw twice a day, so the seeds compiled into `index.html` go stale within
hours. Opening `index.html` directly gets you seed data only — that's why the numbers stopped
matching the official app. Launching with **`Jackpot HQ.cmd`** now fixes it: `scripts/serve.mjs`
runs `fetch-live.mjs` on startup and holds the app's first `live.json` request (up to 8s) so the
page opens with today's draws. Offline, it keeps the last good file and carries on.

## Backup & restore (the web copy — Cloudflare, phone artifact)

With D1 bound and you signed in, the hosted app syncs tickets to the cloud database
automatically. JSON backup is still useful as an offline spare. Without D1, hosted
copies keep tickets in that browser's localStorage only — **Budget → 💾 Backup & restore**
is how they get out. Three ways to save, three ways back:

| Save a copy | Notes |
|---|---|
| ⬇ **Download file** | `jackpot-hq-backup-YYYY-MM-DD.json`. Best on desktop. |
| 📤 **Share / Save to Files** | Uses the OS share sheet — the reliable one on iPhone/Android. |
| 📋 **Copy as text** | Puts the whole backup on the clipboard; paste into Notes, email, anywhere. |

Restore with **⬆ Restore from file** or **📥 Paste backup text**. Restoring **merges by
default** — it unions tickets by id, so nothing on the device is deleted and re-importing the
same file twice is harmless. Tick *Replace everything* (with a confirm) only if you want the
backup to win outright.

Safari often ignores blob downloads, which is why Share and Copy exist — on iPhone use those.

The app tracks when you last backed up and shows a ⚠ on the Budget tab once you've saved
tickets since. This is the stopgap until the KV sync below is switched on.

## Notes

- Hosted copies keep tickets per-browser; the PC copy launched with `Jackpot HQ.cmd` saves to
  disk automatically. Cross-device sync needs the KV binding below.
- Manual entry (↻ on a game card) and jackpot tap-to-edit (✎) still exist as fallbacks —
  the phone artifact can't reach lottery servers (platform security), so it relies on them.
- Windows note: this OneDrive folder blocks writes from scripts (Controlled Folder Access),
  so `src/build.js` writes bundles to a temp folder — Claude handled delivery of `index.html` here.
