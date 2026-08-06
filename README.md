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
| `scripts/fetch-live.mjs` + `.github/workflows/refresh.yml` | Hourly cloud data refresh (`live.json`) |
| `DESIGN.md` | Design doc: games, odds, features, architecture |

## AI Picks (Fable 5 · Opus 5 · Grok 4.5 · GPT-5.6)

The Lab's **AI Pick** strategy sends the game rules + recent real draws to a model of your
choice and returns picks with per-line reasoning. It runs through `functions/api/ai-pick.js`
on Cloudflare so API keys never touch the browser.

Setup (Cloudflare Pages → your project → **Settings → Environment variables**, then redeploy):

| Variable | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Fable 5 + Claude Opus 5 (console.anthropic.com) |
| `OPENAI_API_KEY` | GPT-5.6 Sol + Terra (platform.openai.com) |
| `XAI_API_KEY` | Grok 4.5 (console.x.ai) |
| `APP_PASSCODE` | Optional but recommended — a passcode the app asks for once, so strangers who find your URL can't spend your API credits |

The app auto-detects which models are configured. Honest fine print: no AI improves the odds —
they build statistically-typical, low-crowd-share lines and explain them. Cost per pick request
is roughly $0.01–0.05 (Grok/Terra/Opus) up to ~$0.10 (Fable 5).

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
