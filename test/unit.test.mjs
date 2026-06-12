// Headless unit + invariant tests (node --test). No DOM needed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SIM, DAY } from "../src/config.js";
import {
  COUNTER,
  ENTRY_LEFT,
  TABLES,
  TABLE_BY_ID,
  WAITER_HOME,
  pointBlocked,
} from "../src/layout.js";
import { findPath, hasLineOfSight } from "../src/navgrid.js";
import { createFx, makeAgent, setPath, steerAgent } from "../src/physics.js";
import {
  createWorld,
  dayPhase,
  handleTap,
  simTick,
  startNextDay,
} from "../src/sim.js";
import { createDefaultState, restoreState } from "../src/state.js";
import { makeRng } from "../src/util.js";

// --- navgrid -----------------------------------------------------------------

test("seats and service points are walkable", () => {
  for (const table of TABLES) {
    assert.equal(pointBlocked(table.seatX, table.seatY, 10), false, `seat of ${table.id}`);
    assert.equal(pointBlocked(table.deliverX, table.deliverY, 10), false, `deliver of ${table.id}`);
  }
  assert.equal(pointBlocked(WAITER_HOME.x, WAITER_HOME.y, 10), false, "waiter home");
  assert.equal(pointBlocked(ENTRY_LEFT.x, ENTRY_LEFT.y, 10), false, "left entry");
});

test("paths exist from entry to every seat and never cross obstacles", () => {
  for (const table of TABLES) {
    const path = findPath(ENTRY_LEFT.x, ENTRY_LEFT.y, table.seatX, table.seatY, 10);
    assert.ok(path && path.length > 0, `path to ${table.id}`);
    let fromX = ENTRY_LEFT.x;
    let fromY = ENTRY_LEFT.y;
    for (const point of path) {
      assert.ok(
        hasLineOfSight(fromX, fromY, point.x, point.y, 9),
        `segment to ${table.id} stays clear`,
      );
      fromX = point.x;
      fromY = point.y;
    }
    const last = path[path.length - 1];
    assert.ok(Math.hypot(last.x - table.seatX, last.y - table.seatY) < 1, "path ends at seat");
  }
});

test("waiter can route from counter to the farthest table", () => {
  const far = TABLE_BY_ID.get("table-0-3");
  const path = findPath(WAITER_HOME.x, WAITER_HOME.y, far.deliverX, far.deliverY, 10);
  assert.ok(path && path.length > 0);
});

test("path around the counter never clips it", () => {
  const target = TABLE_BY_ID.get("table-1-0");
  const path = findPath(ENTRY_LEFT.x, ENTRY_LEFT.y, target.seatX, target.seatY, 10);
  assert.ok(path);
  let x = ENTRY_LEFT.x;
  let y = ENTRY_LEFT.y;
  for (const point of path) {
    const steps = Math.ceil(Math.hypot(point.x - x, point.y - y) / 4);
    for (let i = 0; i <= steps; i += 1) {
      const t = steps === 0 ? 1 : i / steps;
      const px = x + (point.x - x) * t;
      const py = y + (point.y - y) * t;
      const inCounter =
        px > COUNTER.x && px < COUNTER.x + COUNTER.w && py > COUNTER.y && py < COUNTER.y + COUNTER.h;
      assert.equal(inCounter, false, "point inside counter");
    }
    x = point.x;
    y = point.y;
  }
});

// --- steering -----------------------------------------------------------------

test("steering walks a real path to the seat without entering obstacles", () => {
  const table = TABLE_BY_ID.get("table-1-2");
  const agent = makeAgent({ x: -40, y: 424, speed: 140 });
  const path = findPath(ENTRY_LEFT.x, ENTRY_LEFT.y, table.seatX, table.seatY, 10);
  setPath(agent, [{ x: ENTRY_LEFT.x, y: ENTRY_LEFT.y }, ...path]);

  let done = false;
  let elapsed = 0;
  while (!done && elapsed < 60) {
    done = steerAgent(agent, SIM.DT, 1, null, true);
    elapsed += SIM.DT;
    assert.ok(Number.isFinite(agent.x) && Number.isFinite(agent.y), "no NaN positions");
    if (agent.x > -10) {
      assert.equal(pointBlocked(agent.x, agent.y, 2), false, `agent clipped at ${agent.x},${agent.y}`);
    }
  }
  assert.ok(done, "agent arrived");
  assert.ok(Math.hypot(agent.x - table.seatX, agent.y - table.seatY) < 8, "stopped at the seat");
});

test("arrive behavior never oscillates around the goal", () => {
  const agent = makeAgent({ x: 500, y: 400, speed: 150 });
  setPath(agent, [{ x: 700, y: 400 }]);
  let crossings = 0;
  let prevSide = Math.sign(700 - agent.x);
  for (let i = 0; i < 600; i += 1) {
    const done = steerAgent(agent, SIM.DT, 1, null, false);
    const side = Math.sign(700 - agent.x);
    if (side !== 0 && side !== prevSide) {
      crossings += 1;
      prevSide = side;
    }
    if (done) break;
  }
  assert.ok(crossings <= 1, `agent oscillated ${crossings} times`);
  assert.ok(agent.path.length === 0, "agent settled");
});

// --- state restore ---------------------------------------------------------------

test("restoreState clamps hostile saves", () => {
  const restored = restoreState({
    coins: -500,
    score: "wat",
    day: 99999999,
    reputation: 42,
    spawnTimer: -100,
    upgrades: { brew: 999, waiter2: -3 },
    weather: { state: "tornado", remaining: 1e9 },
    customers: [
      { id: 1, type: "ghost", phase: "seated", tableId: "table-0-0" },
      { id: 2, type: "man", phase: "entering", tableId: "table-0-1" },
      { id: 3, type: "man", phase: "seated", tableId: "table-0-2", patience: 9999, patienceMax: 24 },
    ],
    orders: [
      { id: 1, customerId: 999, status: "ready", drinkId: "thai_tea" },
      { id: 2, customerId: 3, status: "carried", drinkId: "milk_tea" },
    ],
  });

  assert.equal(restored.coins, 0);
  assert.equal(restored.score, 0);
  assert.equal(restored.day, 9999);
  assert.ok(restored.reputation <= 5);
  assert.ok(restored.spawnTimer >= 0.2);
  assert.equal(restored.upgrades.brew, 3); // max level
  assert.equal(restored.upgrades.waiter2, 0);
  assert.equal(restored.weather.state, "clear");

  // ghost type dropped, entering dropped, valid one kept
  assert.equal(restored.customers.length, 1);
  assert.equal(restored.customers[0].id, 3);
  assert.ok(restored.customers[0].patience <= restored.customers[0].patienceMax);

  // orphan order dropped; carried order back to the shelf
  assert.equal(restored.orders.length, 1);
  assert.equal(restored.orders[0].status, "ready");
  assert.equal(restored.customers[0].phase, "ordered");

  const table = restored.tables.find((t) => t.id === "table-0-2");
  assert.equal(table.status, "seated");
  assert.equal(table.customerId, 3);
});

test("default state round-trips through restore", () => {
  const fresh = createDefaultState(1000);
  const restored = restoreState(JSON.parse(JSON.stringify(fresh)), 1000);
  assert.equal(restored.coins, fresh.coins);
  assert.equal(restored.day, fresh.day);
  assert.equal(restored.tables.length, fresh.tables.length);
});

// --- day phase --------------------------------------------------------------------

test("day phases progress in order", () => {
  assert.equal(dayPhase(0), "morning");
  assert.equal(dayPhase(DAY.LENGTH * 0.3), "noon");
  assert.equal(dayPhase(DAY.LENGTH * 0.6), "evening");
  assert.equal(dayPhase(DAY.LENGTH * 0.9), "night");
});

// --- full-sim soak test --------------------------------------------------------------

function makeHarness(seed = 1234) {
  const state = createDefaultState(0);
  const rng = makeRng(seed);
  const fx = createFx();
  const toasts = [];
  const world = createWorld(state, rng, {
    emit: (msg) => toasts.push(msg),
    audio: { beep() {}, setRainLevel() {} },
    fx,
  });
  return { state, world, fx, toasts, rng };
}

function assertInvariants(state, world, tick) {
  assert.ok(Number.isFinite(state.coins) && state.coins >= 0, `coins finite @${tick}`);
  assert.ok(Number.isFinite(state.score), `score finite @${tick}`);

  for (const customer of state.customers) {
    const agent = world.agents.get(customer.id);
    assert.ok(agent, `customer ${customer.id} has agent @${tick}`);
    assert.ok(
      Number.isFinite(agent.x) && Number.isFinite(agent.y),
      `agent position finite @${tick}`,
    );
    // walking guests must never be inside furniture (small radius => real clip)
    if (
      ["entering", "leaving", "leaving_angry"].includes(customer.phase) &&
      agent.x > 4 &&
      agent.x < 956
    ) {
      assert.equal(
        pointBlocked(agent.x, agent.y, 1),
        false,
        `customer ${customer.id} (${customer.phase}) clipped at ${agent.x.toFixed(1)},${agent.y.toFixed(1)} @${tick}`,
      );
    }
  }

  for (const waiter of world.waiters) {
    assert.ok(Number.isFinite(waiter.agent.x) && Number.isFinite(waiter.agent.y));
    if (waiter.state !== "idle") {
      assert.equal(
        pointBlocked(waiter.agent.x, waiter.agent.y, 1),
        false,
        `waiter clipped at ${waiter.agent.x.toFixed(1)},${waiter.agent.y.toFixed(1)} @${tick}`,
      );
    }
  }

  for (const order of state.orders) {
    const customer = state.customers.find((c) => c.id === order.customerId);
    assert.ok(customer, `order ${order.id} has live customer @${tick}`);
    if (order.status === "carried") {
      assert.ok(
        world.waiters.some((w) => w.carrying.includes(order.id)),
        `carried order ${order.id} is actually carried @${tick}`,
      );
    }
  }

  for (const table of state.tables) {
    if (table.customerId !== null) {
      assert.ok(
        state.customers.some((c) => c.id === table.customerId),
        `table ${table.id} points at live customer @${tick}`,
      );
    }
  }
}

test("two full simulated days run clean with an attentive player", { timeout: 120000 }, () => {
  const { state, world } = makeHarness(42);
  let ticks = 0;
  let days = 0;
  const maxTicks = Math.ceil((DAY.LENGTH + DAY.CLOSE_GRACE + 40) / SIM.DT) * 3;

  while (days < 2 && ticks < maxTicks * 2) {
    simTick(state, world, SIM.DT);
    ticks += 1;

    // attentive player: order for every seated guest, shoo any cat quickly
    if (ticks % 10 === 0) {
      for (const table of state.tables) {
        if (table.status === "seated" && table.customerId !== null) {
          const layout = TABLE_BY_ID.get(table.id);
          handleTap(state, world, layout.cx, layout.cy);
        }
      }
      if (world.cat?.mode === "napping") {
        const layout = TABLE_BY_ID.get(world.cat.tableId);
        handleTap(state, world, layout.cx, layout.cy);
      }
    }

    if (ticks % 3 === 0) assertInvariants(state, world, ticks);

    if (state.daySummary) {
      days += 1;
      assert.ok(state.daySummary.served > 0, `day ${days} served someone`);
      assert.equal(state.customers.length, 0, "no guests left at day end");
      assert.equal(state.orders.length, 0, "no orders left at day end");
      if (days < 2) startNextDay(state, world, world.rng);
    }
  }

  assert.equal(days, 2, `completed 2 days (ticks=${ticks})`);
  assert.ok(state.totalServed >= 10, `served a healthy number (got ${state.totalServed})`);
  assert.ok(state.coins > 0, "earned coins");
});

test("ignored guests storm off and tables free up", { timeout: 60000 }, () => {
  const { state, world } = makeHarness(7);
  let ticks = 0;
  const maxTicks = Math.ceil(80 / SIM.DT);
  while (ticks < maxTicks && state.totalMissed < 3) {
    simTick(state, world, SIM.DT);
    ticks += 1;
    if (ticks % 5 === 0) assertInvariants(state, world, ticks);
  }
  assert.ok(state.totalMissed >= 3, `guests gave up when ignored (missed=${state.totalMissed})`);
  assert.equal(state.streak, 0);
  assert.ok(state.reputation < 3, "reputation dropped");
});

test("cat naps block a table and shooing frees it", { timeout: 60000 }, () => {
  const { state, world } = makeHarness(99);
  state.nextCatIn = 0.01;
  let ticks = 0;
  const maxTicks = Math.ceil(60 / SIM.DT);
  while (ticks < maxTicks && world.cat?.mode !== "napping") {
    simTick(state, world, SIM.DT);
    ticks += 1;
  }
  assert.ok(world.cat, "cat appeared");
  assert.equal(world.cat.mode, "napping");
  const blocked = state.tables.find((t) => t.id === world.cat.tableId);
  assert.equal(blocked.status, "blocked");

  const layout = TABLE_BY_ID.get(world.cat.tableId);
  const result = handleTap(state, world, layout.cx, layout.cy);
  assert.equal(result?.kind, "shoo");
  assert.equal(blocked.status, "empty");

  // cat leaves the board entirely
  while (ticks < maxTicks * 2 && world.cat) {
    simTick(state, world, SIM.DT);
    ticks += 1;
  }
  assert.equal(world.cat, null, "cat left");
});
