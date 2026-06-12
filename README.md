# Trà Đá Vỉa Hè — Version 2

**Play it live: https://buicongnguyen.github.io/sidewalk-iced-tea-v2/**

A ground-up rebuild of
[sidewalk-iced-tea](https://github.com/buicongnguyen/sidewalk-iced-tea) (the
Plan B prototype, version 1) with real movement physics, a deeper service
loop, a proper sidewalk scene, and a test suite that enforces the physics
invariants. Vanilla JS ES modules, Canvas 2D, no build step, installable PWA,
local-first saves.

## Run

```bash
node server.js          # http://127.0.0.1:4180
```

## Test

```bash
npm test                # node --test: pathfinding, steering, restore, 2-day sim soak
npm run smoke           # Playwright end-to-end (needs `npx playwright install chromium` once)
node test/shots.mjs     # capture gameplay screenshots (day/noon/evening-rain/night)
node test/perf.mjs      # frame-time measurement under load
```

## What's new vs. v1

**Physics**
- Steering agents (seek/arrive with eased deceleration), velocity-integrated,
  with separation between walkers — no more constant-speed teleport segments.
- A* pathfinding over a nav grid with line-of-sight smoothing; the counter and
  tables are real obstacles. Nobody clips furniture anymore (v1 customers
  walked through the counter; dogs/cats walked through tables).
- Walk cycles driven by actual velocity; facing flips with hysteresis.
- Rain is a particle system with gravity, wind drift and ground splashes; wind
  is a smooth gust field that tilts rain, tumbles leaves, sways the awning and
  string lights, and slows walkers.
- Fixed 30 Hz simulation with render interpolation (Gaffer-style accumulator);
  HiDPI-scaled canvas.

**Logic**
- Orders matter: tap a table → barista brews (per-drink prep time) → drinks
  land on the ready shelf → a waiter agent physically carries up to 2–3 cups
  and delivers along a nearest-first route. Cancelled orders are handled at
  every pipeline stage.
- Per-type customer stats (kids fast & impatient, elders slow & patient),
  patience rings, tips scale with delivery speed, combo streaks, reputation
  stars that feed back into arrival rate.
- Day cycle (150 s) with morning/evening rush hours, noon heat, smooth
  day-night lighting, closing wind-down and an end-of-day summary; difficulty
  ramps per day. Six multi-level upgrades.
- Street life: dogs, motorbikes, and a cat that naps on an empty table until
  you shoo it. All street critters stay in the street band — by pathfinding,
  not luck.
- Saves are versioned and validated: every number clamped, cross references
  revalidated, carried drinks returned to the shelf; IndexedDB + localStorage
  written newest-wins with coalesced (never dropped) save requests.

See [docs/PLAN-V2.md](docs/PLAN-V2.md) for the full v1 bug catalogue and design.

## Verification results (2026-06-12)

- 12/12 unit tests pass, including a 2-simulated-day soak with invariants
  checked every 3 ticks (no NaN, no obstacle clipping, consistent
  orders/tables) and a neglect scenario (guests storm off, reputation drops).
- Playwright smoke passes: real-click serve pipeline, weather/cat/dog events,
  cat shoo, day summary → day 2, upgrade purchase, exact save round-trip
  across reload, **0 console errors**.
- Frame timing under load (rain + wind + full house, 1280×820):
  avg 16.65 ms, p95 17.7 ms, worst 18.2 ms — steady 60 fps.
