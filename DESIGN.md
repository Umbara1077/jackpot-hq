# Jackpot HQ — NJ Lottery Tracker & Number Lab

**Design doc · Aug 5, 2026 · built for Dante**

## What it is

A single-file web app (`index.html`) that tracks every major NJ Lottery draw game, helps generate
and analyze number picks, tracks your tickets and spending, and alerts you before draws. Works
offline, saves everything in your browser (localStorage), and is mobile-first so it feels like an
app on your phone.

## The honest-odds promise (core design principle)

No app can raise your probability of hitting a jackpot — every combination is exactly as likely as
any other, and past draws don't influence future ones. What a smart player *can* do, and what this
app actually helps with:

1. **Play the right game** — jackpot odds range from 1 in 9.4M (Pick-6) to 1 in 292M (Powerball).
   The app compares odds, prize structure, and cost per game.
2. **Avoid the crowd** — you can't pick winning numbers, but you can avoid *popular* numbers
   (birthdays 1–31, sequences, patterns). If you ever do win, sharing with fewer people means a
   bigger payout. Smart Pick implements this.
3. **Never miss a win** — tickets are checked against real results automatically (Powerball, Mega
   Millions, Millionaire for Life) or quick manual entry (NJ-only games). Small prizes expire
   unclaimed all the time; the app makes sure you cash yours.
4. **Protect the bankroll** — budget tracking with spend vs. winnings, so the hobby stays fun.

Every "strategy" feature carries a truth-label saying what it does and doesn't do. 1-800-GAMBLER
footer included.

## Games covered (verified Aug 5, 2026 — from live NJ Lottery + open-data feeds)

| Game | Matrix | Price | Draws (ET) | Jackpot odds |
|---|---|---|---|---|
| Powerball | 5/69 + PB 1/26 | $2 (+$1 Power Play, +$1 Double Play) | Mon/Wed/Sat 10:59pm | 1:292,201,338 |
| Mega Millions | 5/70 + MB 1/24, multiplier built in | $5 | Tue/Fri 11:00pm | 1:290,472,336 |
| Millionaire for Life | 5/58 + Millionaire Ball 1/5 | $5 | daily 11:15pm (sales cut 10:15pm) | 1:22,910,580 |
| Pick-6 | 6/46 (+XTRA incl., +$1 Double Play) | $2 | Mon/Thu/Sat 10:57pm | 1:9,366,819 |
| Jersey Cash 5 | 5/45 + Bullseye incl. (+$1 XTRA) | $2 | daily 10:57pm | 1:1,221,759 |
| Pick-3 | 3 digits 0-9 (+Fireball) | $0.50+ | daily 12:59pm & 10:57pm | 1:1,000 straight |
| Pick-4 | 4 digits 0-9 (+Fireball) | $0.50+ | daily 12:59pm & 10:57pm | 1:10,000 straight |
| Cash Pop | 1 number 1–15 | $1–$10/number | every 4 min in-store | 1:15 |

Notes captured during research: Millionaire for Life launched 2/22/2026 replacing Cash4Life
(top prize $1M/yr for life, $18M cash; 9 tiers, full table embedded). Pick-6 plays 6/46 with
Mon/Thu/Sat draws (confirmed from 70 real draws — old 6/49 info is stale). Mega Millions is the
2025 format: $5, Mega Ball 1–24, random 2×–10× multiplier on every ticket.

## Live data

- **Auto-fetch (CORS-open NY open-data feeds, official winning numbers):**
  Powerball `data.ny.gov/resource/d6yy-54nr.json`, Mega Millions `5xaw-6ayf.json`,
  Millionaire for Life `a4w9-a3tp.json`.
- **NJ-only games** (Jersey Cash 5, Pick-6, Pick-3/4): njlottery.com API blocks outside apps, so
  results are entered manually (15-second flow) — the app ships pre-loaded with real history:
  130 JC5 draws, 70 Pick-6 draws, 100 each Pick-3/4, plus ~1 year PB/MM and the complete M4L
  history (164 draws), so all stats work on first launch.
- Current jackpot amounts: auto where possible, otherwise editable "last known" values
  (seeded Aug 5: PB $786M, MM $70M, Pick-6 $2.8M, JC5 $597K).

## Screens (bottom tab bar on mobile, top nav on desktop)

1. **Home** — next-draw countdowns per game, live jackpots, "tonight's draws" digest, alerts bell.
   Game cards open a detail sheet (rules, full prize/odds table, recent numbers).
2. **Number Lab** — pick a game, choose a strategy, watch animated ball draw:
   Quick Pick (crypto-random) · Smart Pick (anti-crowd: filters birthday-heavy, sequential,
   pattern combos) · Hot / Cold / Overdue (from real draw history, clearly labeled as
   entertainment) · Balanced (sum + odd/even + spread windows) · My Numbers (manual with live
   analysis: popularity flags, sum percentile, birthday-trap warning).
   Save any line straight to Tickets.
3. **My Tickets** — lines per game + draw date + cost incl. add-ons; auto-check vs results; win/loss
   badges, prize amounts, confetti on wins; totals feed Budget.
4. **Stats** — per game: frequency bars, hot/cold heat grid, drought (last-seen) list, recent draws
   strip; Pick-3/4 digit frequency; "Real Talk" odds explainers and game-vs-game comparison.
5. **Budget** — monthly limit, spent / won / net, progress ring, gentle 80% warning, over-limit
   banner, all-time stats. Responsible-play footer.

**Alerts:** in-app digest always; optional browser notifications (draw-night reminder ~30 min
before cutoff for chosen games, jackpot-threshold alerts); downloadable .ics calendar so phone
reminders work even when the app is closed.

## Look & feel

Dark "casino night" theme (deep navy-black, gold accent) with full light-mode support; per-game
accent colors; original SVG badge for each game (evokes each brand's colors — official logos are
trademarked, so the app uses its own marks with the real game names in text); 3-D gradient lottery
balls; ball-drop and count-up animations; confetti on wins; respects `prefers-reduced-motion`.

## Architecture

- One `index.html` (vanilla HTML/CSS/JS, zero dependencies, fully offline after load).
- Embedded `SEED_DRAWS` dataset (validated against each game's matrix at build time).
- localStorage keys: `jhq.tickets`, `jhq.results.<game>`, `jhq.budget`, `jhq.settings`,
  `jhq.jackpots`.
- Draw-time engine computes next draws in America/New_York (DST-safe) regardless of device TZ.
- Odds computed combinatorially (nCr) — no hardcoded magic numbers where math can do it.
- Prize tables per game embedded for win-checking (jackpot tiers marked estimated/pari-mutuel).

## Delivery

1. `index.html` in this folder — double-click to use on PC (also works from OneDrive on any device).
2. Published as a private Claude artifact for one-tap phone use (auto-fetch works there for the
   three multi-state games; NJ-game entry stays manual).
