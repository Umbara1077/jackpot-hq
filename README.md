# NJ Jackpot HQ

Your NJ Lottery tracker & number lab. Built Aug 5, 2026.

## Open it

- **PC:** double-click `index.html` (works offline; auto-updates Powerball, Mega Millions
  & Millionaire for Life results when online).
- **Phone:** open your private artifact at
  https://claude.ai/code/artifact/49051ebc-c66d-49f5-abc1-dc28ac61a916
  (sign in to claude.ai → it's also under claude.ai/code/artifacts).

## What's what

| File | Purpose |
|---|---|
| `index.html` | The app (PC entry point — loads `src/seeds.js` + `src/app-src.js`) |
| `src/app-src.js` | All app logic — edit here |
| `src/index-src.html` | HTML/CSS shell source used by the bundler |
| `src/seeds.js` | Embedded real draw history (NJ-only games) |
| `src/build.js` | Bundles everything into one portable file + the artifact variant |
| `DESIGN.md` | Design doc: games, odds, features, architecture |

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
