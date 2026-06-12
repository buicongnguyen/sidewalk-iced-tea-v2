# Sidewalk Iced Tea — Version 2 Plan

Version 2 is a ground-up rebuild of the Plan-B prototype at
`Games/sidewalk-iced-tea`, keeping its strengths (vanilla JS, no build step,
PWA shell, local-first saves, Vietnamese voice) and fixing every logic,
physics, and rendering problem found during the v1 code review.

---

## 1. V1 code review — catalogued problems

### Physics / movement
| # | Problem | Evidence (v1 `client/app.js`) |
|---|---------|-------------------------------|
| P1 | No movement physics: agents move at constant speed in straight segments and snap to waypoints; no acceleration, no arrival easing. | `moveEntityToward` (l.1758) |
| P2 | Dogs/cats walk straight through row-2 tables and seated customers. Dog lane y∈[404,448], cat y∈[368,420] overlap tables (y 305–401) and seats (y≈421). | `spawnWanderer` (l.766) vs `buildTableLayout` (l.329) |
| P3 | Customers clip through the tea counter (rect ≈ x102–300 / y214–300) when walking from the door (104,280) to row-1 approach points (y≈228). | `buildEntryWaypoints` (l.2014), `drawCounterDisplay` (l.2118) |
| P4 | Customers walk diagonally through table rectangles toward approach points; no obstacle representation exists at all. | `moveAlongWaypoints` |
| P5 | Two customers can overlap at the same seat: `beginExit` frees the table instantly so a new customer can be seated while the old one is still standing there. | `beginExit` (l.1014) |
| P6 | No agent separation — customers walking opposite directions pass through each other. | — |
| P7 | Walk bob is `sin(timestamp)` independent of actual velocity; characters "moonwalk" when stationary mid-path and stride doesn't match speed. | `drawCustomers` (l.1560) |
| P8 | Rain is a modulo-sliding line pattern, not particles: drops visibly teleport at wrap edges, no splash, no gravity, fixed slant. | `drawRainOverlay` (l.1604) |
| P9 | Facing direction flips instantly (scale −1) the frame velocity sign changes. | `getFacingDirection` |

### Logic
| # | Problem |
|---|---------|
| L1 | Drink orders are cosmetic: tapping the table serves it; nothing brews, nobody carries the drink, the order text changes nothing. |
| L2 | Flat difficulty: spawn ~6 s forever, no day cycle, no goals, no rush hours; once both one-shot upgrades are bought the game is over strategically. |
| L3 | Customer types are cosmetic; spec explicitly wanted stat branching (elders patient/slow, kids impatient/fast). |
| L4 | `stats.dropped` increments when spawn is suppressed — counts phantom customers that never existed. |
| L5 | Idle catch-up grants coins+score but not `totalServed`/tips — stat totals drift inconsistently. |
| L6 | Restored saves are not clamped/validated: tampered `spawnTimer`, negative coins, huge elapsed values pass straight in. Customers mid-walk restore with stale waypoints. |
| L7 | Rain multiplier only applies when the spawn timer resets, so rain starting mid-interval doesn't affect the pending spawn. |
| L8 | Score/combo system is shallow (flat +1, +2 bonuses); tips don't scale with anything the player controls. |
| L9 | Dead code: `splitOrderText` has a no-op `if (lines.length === 1) continue;`. |

### Rendering / background
| # | Problem |
|---|---------|
| R1 | Theme mismatch: the game is *sidewalk* iced tea but the background is an indoor café room with a door — no street, curb, or sidewalk. |
| R2 | All 9 preloaded SVG assets (`bg_room`, `stall_counter`, customers…) are loaded into `runtime.assets` and **never drawn** — dead boot cost. |
| R3 | Full procedural background redrawn from scratch every frame (gradients, ~40 grid strokes, lights) — wasted GPU/CPU. |
| R4 | Canvas is fixed 960×540 attribute size stretched by CSS — blurry on HiDPI; `image-rendering: pixelated` masks it. |
| R5 | HUD writes DOM text + button `innerHTML` every logic tick (10×/s) regardless of change — layout thrash. |
| R6 | No render interpolation: logic runs at 10 Hz; positions jump 10×/s while the render loop runs at 60 — visible stutter on walking characters (masked by slow speeds). |
| R7 | No time-of-day / lighting variation; scene is static forever. |

---

## 2. V2 design

### Architecture
- Vanilla ES modules, **no build step** (same deploy story as v1): `src/*.js` loaded via `<script type="module">`.
- Fixed timestep `1/30 s` simulation + **render interpolation** (Gaffer "Fix Your
  Timestep": accumulator, `alpha = acc/dt`, every moving entity keeps `prevX/prevY`).
- Logical board 960×540; canvas backing store scaled by `devicePixelRatio`
  (crisp on HiDPI), CSS handles layout size.
- Static scene pre-rendered into an **offscreen background canvas** once (and
  re-tinted only when the day-phase lighting changes), per MDN canvas
  optimization guidance.
- Seeded RNG (mulberry32) — deterministic tests, reproducible days.
- HUD updates are diffed: DOM is written only when a value changes.

### Scene (fixes R1) — a real Vietnamese sidewalk
```
y   0–116   shop wall: sign + neon "TRÀ ĐÁ", awning with scalloped edge, window, menu board
y 116–440   tiled sidewalk: tea counter left (x 24–218, y 152–306), 2×4 tables, plant pots
y 440–540   curb + street: lane line, zebra crossing, dogs/cats/motorbikes pass HERE only
```
- Customers arrive along the street edge sidewalk lane (y≈424) from left/right,
  then take aisles between tables. They physically cannot cross tables/counter.
- Time-of-day: one in-game day = 150 s, phases morning → noon → evening →
  night, sky-light overlay + lantern/neon glow at night; rush hours (morning,
  evening) raise arrivals.

### Physics (fixes P1–P9)
- **Nav grid** 20 px cells; counter, tables, wall band, street are blocked for
  customers; **A\*** with string-pulling (line-of-sight smoothing) produces
  paths; obstacles inflated by agent radius.
- **Steering agents** (pos, vel, maxSpeed, maxForce): `arrive` at the final
  waypoint (eased deceleration), `seek` intermediate ones, **separation** force
  between nearby agents, and hard obstacle clamp as a safety net.
  Per-type speeds: kids fast, elders slow; waiter fastest.
- **Walk cycle driven by distance traveled** (stride phase += speed·dt), bob
  amplitude ∝ speed; facing flips with hysteresis.
- **Rain**: pooled particles with gravity + wind acceleration, ground splash
  rings, intensity ramps in/out smoothly. **Wind**: smooth gust field
  (sum-of-sines) that tilts rain, blows tumbling leaves, sways string lights
  and awning scallops, and slows walkers.
- Street life: dog/cat wander the street band (never the seating area), except
  the deliberate **cat-nap event**: a cat pathfinds to an empty table, naps on
  it (table blocked), tap to shoo it away.

### Gameplay logic (fixes L1–L8)
- **Orders matter now**: tap a waiting table → order enters the counter queue →
  the barista brews it (visible progress, per-drink prep time) → drinks land on
  the ready shelf → the **waiter agent** physically carries up to 2 cups
  (nearest-table route) and delivers. Strategy = managing the pipeline.
- Customer state machine: `entering → seated(waiting) → ordered → served(drinking)
  → leaving`, patience per type (kids 18 s … elders 30 s), patience decay
  slows once the order is taken, ring indicator over each head.
- If a customer storms off, their queued/brewing/carried drink is cancelled or
  discarded consistently.
- **Economy**: per-drink price (2–4 xu), speed-based tip, **combo streak**
  (consecutive on-time serves) multiplies tips; reputation stars drift with
  service quality and nudge arrival rate.
- **Day cycle**: wind-down at day end (spawning stops, last guests finish),
  summary overlay, difficulty ramps next day (faster arrivals, slightly less
  patience, floors capped). Coins/upgrades persist.
- **Upgrades** (multi-level): brew speed ×3 levels, second waiter, umbrella,
  fans (heat patience), marketing ×3 levels.
- Weather: clear / cloudy / rain state machine with smooth transitions; noon
  heat (needs fans) and rain (umbrella reduces arrival hit, cools patience).
- Idle/away: hidden tab catch-up ≤30 s, condensed idle gains beyond it that
  update coins *and* served counters consistently.
- **Save schema v2**: every number clamped on restore, cross-references
  (table↔customer↔order) revalidated, walking customers dropped cleanly,
  waiter/barista reset to a safe state, IndexedDB + localStorage backups.

### Test plan
- `node --test` unit tests: A* (blocked cells, smoothing keeps line of sight),
  steering convergence (arrive never overshoots/oscillates), economy math,
  save restore clamping, day-phase function, order-cancel consistency.
- Playwright smoke (reuses v1's installed Playwright): boot → start → customers
  spawn and **never intersect obstacle rects while walking** (sampled), full
  serve pipeline completes, cat-nap blocks and shoo unblocks a table, save
  survives reload, no console errors.
- Manual visual pass via local server + screenshots each iteration.

### Out of scope (unchanged from v1)
Backend/auth/leaderboards, real audio assets (procedural WebAudio still),
thug/competitor systems, monetization.
