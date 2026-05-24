# Contract Whist Tracker

A free, browser-based scorekeeper for contract whist (oh hell / nomination whist).

**Live:** https://bravostation.github.io/whist-tracker/

## Features

- Configurable number of players (2–7) and starting cards (capped at 52/players)
- Direction: down only (e.g. 7 → 1) or up & down (7 → 1 → 7)
- Trump cycles each round: ♠ → ♥ → ♣ → ♦ → No Trump
- Each round shows trump suit + cards in hand
- Per-player bid → actual tricks → round score → running total
- Scoring: **+3 + bid** if exact; **−|actual − bid|** if missed
- Visual indicators: bid is **circled** if correct, **squared** if missed
- Bid total warning (helps enforce "total bids ≠ cards" house rule)
- Undo last round, end game early
- End-of-game summary: line chart of cumulative scores + stats (accuracy, biggest round, lead changes, etc.)
- All games persisted in **sessionStorage** for the duration of the browser session

## Deploy

Static site — just open `index.html` or host on GitHub Pages / Netlify / any static host.

No build step. No dependencies beyond Chart.js (loaded from CDN).
