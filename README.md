# NJ Jackpot HQ

Your NJ Lottery tracker & number lab. Built Aug 5, 2026.

## Open it

- **PC:** double-click `index.html` (works offline; auto-updates Powerball, Mega Millions
  & Millionaire for Life results when online).
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
| `functions/api/sync.js` | Cross-device sync blob for signed-in users (KV) |
| `functions/_session.js` | Shared signed-cookie session helpers |
| `worker/index.js` + `wrangler.jsonc` | Makes Cloudflare run the API (see “Why variables were blocked”) |
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

Note: the tracked file `api/ai-pick` is a static test fixture that reports every model as
available. It sits at the same path as the real endpoint; `run_worker_first` in `wrangler.jsonc`
keeps the Worker ahead of it, but deleting it would remove the trap entirely.

## AI Picks (Claude · GPT · Grok · Gemini 3.x)

The Lab's featured **AI Pick** card sends the game rules + recent real draws to the model you
choose (each shows its maker's mark in the picker) and returns picks with per-line reasoning.
It runs through `functions/api/ai-pick.js` on Cloudflare so API keys never touch the browser.
The app auto-detects which models are configured. Honest fine print: no AI improves the odds —
they build statistically-typical, low-crowd-share lines and explain them. Cost per pick request
is roughly $0.01–0.05 (Grok/Terra/Opus) up to ~$0.10 (Fable 5).

## Password login gate

The full-screen login gate appears until you sign in. Locally use **`admin` / `admin`**.
On Cloudflare Pages set **`APP_USER`** and **`APP_PASSWORD`**. Sessions are signed HttpOnly
cookies (`functions/api/auth/[action].js`). Signed-in users skip the AI passcode, and with the
KV binding below their tickets/budget/settings follow them via `functions/api/sync.js`.

## Optional: Sign in with Google (+ Apple) & cross-device sync

One-time Google setup (~5 minutes, free):

1. Go to https://console.cloud.google.com → create (or pick) a project.
2. **APIs & Services → OAuth consent screen** → External → fill in the app name + your email.
   The app only uses basic scopes (openid/email/profile), so no Google verification is needed.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*:
   - Authorized redirect URI: `https://YOUR-SITE.pages.dev/api/auth/google-cb`
     (add one per domain if you also use a custom domain)
4. Copy the **Client ID** and **Client secret** into the env vars below.

Sync storage (optional): Cloudflare dashboard → **Workers & Pages → KV → Create namespace**
(any name), then your Pages project → **Settings → Bindings → Add → KV namespace** with
variable name `USERS`. Without it, sign-in still works — data just stays per-device.

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

Plus the KV binding `USERS` (Settings → Bindings) if you want cross-device sync.

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

## Notes

- Tickets/budget live in the browser you use (localStorage). Use **Budget → Export data**
  for backups; PC and phone each keep their own data.
- Manual entry (↻ on a game card) and jackpot tap-to-edit (✎) still exist as fallbacks —
  the phone artifact can't reach lottery servers (platform security), so it relies on them.
- Windows note: this OneDrive folder blocks writes from scripts (Controlled Folder Access),
  so `src/build.js` writes bundles to a temp folder — Claude handled delivery of `index.html` here.
