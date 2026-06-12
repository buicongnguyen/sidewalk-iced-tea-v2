// Serializable game state: defaults, sanitized restore, derived getters.
//
// Restore policy (fixes v1's unvalidated loads):
//  - every number is clamped to a sane range
//  - cross references (customer<->table<->order) are revalidated
//  - customers caught mid-walk are dropped; seated guests are restored in place
//  - drinks being carried by a waiter are put back on the ready shelf

import {
  GAME_VERSION,
  CUSTOMER_TYPE_BY_ID,
  DRINK_BY_ID,
  DRINKS,
  REPUTATION,
  SERVICE,
  SPAWN,
  UPGRADES,
  WEATHER,
} from "./config.js";
import { TABLES, TABLE_BY_ID } from "./layout.js";
import { asNumber, clamp } from "./util.js";

export function createDefaultState(now = Date.now()) {
  return {
    version: GAME_VERSION,
    createdAt: now,
    lastSavedAt: now,

    day: 1,
    dayTime: 0, // seconds into the current day
    closing: false, // wind-down: no more arrivals
    closeGrace: 0,

    coins: 0,
    score: 0,
    tips: 0,
    totalServed: 0,
    totalMissed: 0,
    streak: 0,
    bestStreak: 0,
    reputation: REPUTATION.START,

    upgrades: { brew: 0, waiter2: 0, tray: 0, umbrella: 0, fans: 0, marketing: 0 },

    weather: {
      state: "clear", // clear | cloudy | rain
      remaining: 40,
      rainLevel: 0, // smooth 0..1
    },
    windPower: 0, // event envelope 0..1
    windRemaining: 0,
    nextWindIn: 36,

    spawnTimer: 3.5,
    nextCustomerId: 1,
    nextOrderId: 1,

    customers: [], // seated lifecycle entities (agent fields live in world)
    orders: [], // { id, customerId, tableId, drinkId, status, progress }
    tables: TABLES.map((t) => ({
      id: t.id,
      status: "empty", // empty | reserved | seated | blocked (cat)
      customerId: null,
      freeAt: 0, // dayTime after which it can be reassigned
    })),

    cat: null, // { mode: approach|napping|fleeing, tableId, napFor }
    nextCatIn: 30,
    nextDogIn: 16,
    nextBikeIn: 8,

    stats: { dropped: 0, windEvents: 0, dogVisits: 0, catNaps: 0, daysPlayed: 0 },
    daySummary: null, // filled when a day ends
    dayStart: { coins: 0, served: 0, missed: 0, tips: 0 },

    settings: { sound: true },
  };
}

export function makeCustomer(id, typeId, drinkId, tableId, patienceMax, orderText) {
  return {
    id,
    type: typeId,
    drinkId,
    tableId,
    phase: "entering", // entering | seated | ordered | served | leaving | leaving_angry
    patience: patienceMax,
    patienceMax,
    drinkTimer: 0,
    orderText,
    paid: false,
  };
}

const CUSTOMER_PHASES = new Set(["entering", "seated", "ordered", "served", "leaving", "leaving_angry"]);
const RESTORABLE_PHASES = new Set(["seated", "ordered", "served"]);
const ORDER_STATUSES = new Set(["queued", "brewing", "ready", "carried"]);

export function restoreState(saved, now = Date.now()) {
  const base = createDefaultState(now);
  if (!saved || typeof saved !== "object") return base;

  const s = base;
  s.day = asNumber(saved.day, 1, 1, 9999);
  s.dayTime = asNumber(saved.dayTime, 0, 0, 100000);
  s.closing = Boolean(saved.closing);
  s.closeGrace = asNumber(saved.closeGrace, 0, 0, 120);

  s.coins = asNumber(saved.coins, 0, 0, 10_000_000);
  s.score = asNumber(saved.score, 0, 0, 100_000_000);
  s.tips = asNumber(saved.tips, 0, 0, 10_000_000);
  s.totalServed = asNumber(saved.totalServed, 0, 0, 100_000_000);
  s.totalMissed = asNumber(saved.totalMissed, 0, 0, 100_000_000);
  s.streak = asNumber(saved.streak, 0, 0, 9999);
  s.bestStreak = asNumber(saved.bestStreak, 0, 0, 9999);
  s.reputation = asNumber(saved.reputation, REPUTATION.START, REPUTATION.MIN, REPUTATION.MAX);

  for (const key of Object.keys(s.upgrades)) {
    const maxLevel = UPGRADES[key]?.levels.length ?? 1;
    s.upgrades[key] = asNumber(saved.upgrades?.[key], 0, 0, maxLevel);
  }

  const weatherState = ["clear", "cloudy", "rain"].includes(saved.weather?.state)
    ? saved.weather.state
    : "clear";
  s.weather = {
    state: weatherState,
    remaining: asNumber(saved.weather?.remaining, 30, 0.5, 240),
    rainLevel: weatherState === "rain" ? asNumber(saved.weather?.rainLevel, 1, 0, 1) : 0,
  };
  s.windPower = asNumber(saved.windPower, 0, 0, 1);
  s.windRemaining = asNumber(saved.windRemaining, 0, 0, 60);
  s.nextWindIn = asNumber(saved.nextWindIn, 36, 1, 600);

  s.spawnTimer = asNumber(saved.spawnTimer, 3.5, 0.2, 60);
  s.nextCustomerId = asNumber(saved.nextCustomerId, 1, 1, 1e9);
  s.nextOrderId = asNumber(saved.nextOrderId, 1, 1, 1e9);
  s.nextCatIn = asNumber(saved.nextCatIn, 30, 1, 600);
  s.nextDogIn = asNumber(saved.nextDogIn, 16, 1, 600);
  s.nextBikeIn = asNumber(saved.nextBikeIn, 8, 1, 600);

  s.stats = {
    dropped: asNumber(saved.stats?.dropped, 0, 0, 1e9),
    windEvents: asNumber(saved.stats?.windEvents, 0, 0, 1e9),
    dogVisits: asNumber(saved.stats?.dogVisits, 0, 0, 1e9),
    catNaps: asNumber(saved.stats?.catNaps, 0, 0, 1e9),
    daysPlayed: asNumber(saved.stats?.daysPlayed, 0, 0, 1e9),
  };
  s.dayStart = {
    coins: asNumber(saved.dayStart?.coins, 0, 0, 1e9),
    served: asNumber(saved.dayStart?.served, 0, 0, 1e9),
    missed: asNumber(saved.dayStart?.missed, 0, 0, 1e9),
    tips: asNumber(saved.dayStart?.tips, 0, 0, 1e9),
  };
  s.settings.sound = saved.settings?.sound !== false;

  // --- customers: only restore guests that were actually seated.
  const seenTables = new Set();
  const customers = Array.isArray(saved.customers) ? saved.customers : [];
  for (const raw of customers) {
    if (!raw || typeof raw !== "object") continue;
    if (!RESTORABLE_PHASES.has(raw.phase)) continue;
    const type = CUSTOMER_TYPE_BY_ID.get(raw.type);
    const table = TABLE_BY_ID.get(raw.tableId);
    const drink = DRINK_BY_ID.get(raw.drinkId) ?? DRINKS[0];
    if (!type || !table || seenTables.has(table.id)) continue;
    seenTables.add(table.id);
    const patienceMax = asNumber(raw.patienceMax, type.patience, 4, 120);
    const customer = makeCustomer(
      asNumber(raw.id, s.nextCustomerId, 1, 1e9),
      type.id,
      drink.id,
      table.id,
      patienceMax,
      typeof raw.orderText === "string" ? raw.orderText.slice(0, 80) : "",
    );
    customer.phase = raw.phase;
    customer.patience = asNumber(raw.patience, patienceMax, 0, patienceMax);
    customer.drinkTimer = asNumber(raw.drinkTimer, 0, 0, 30);
    customer.paid = Boolean(raw.paid);
    s.customers.push(customer);
    s.nextCustomerId = Math.max(s.nextCustomerId, customer.id + 1);
  }

  // --- tables follow customers.
  for (const table of s.tables) {
    const customer = s.customers.find((c) => c.tableId === table.id);
    if (customer) {
      table.status = "seated";
      table.customerId = customer.id;
    }
  }

  // --- orders: keep only orders whose customer still exists and waits.
  const orders = Array.isArray(saved.orders) ? saved.orders : [];
  let sawBrewing = false;
  for (const raw of orders) {
    if (!raw || typeof raw !== "object" || !ORDER_STATUSES.has(raw.status)) continue;
    const customer = s.customers.find((c) => c.id === raw.customerId);
    if (!customer || customer.phase === "served") continue;
    if (s.orders.some((o) => o.customerId === customer.id)) continue;
    const drink = DRINK_BY_ID.get(raw.drinkId) ?? DRINK_BY_ID.get(customer.drinkId);
    let status = raw.status === "carried" ? "ready" : raw.status;
    if (status === "brewing") {
      if (sawBrewing) status = "queued"; // only one pot on the stove
      else sawBrewing = true;
    }
    const order = {
      id: asNumber(raw.id, s.nextOrderId, 1, 1e9),
      customerId: customer.id,
      tableId: customer.tableId,
      drinkId: drink.id,
      status,
      progress: status === "brewing" ? asNumber(raw.progress, 0, 0, 1) : 0,
    };
    s.orders.push(order);
    s.nextOrderId = Math.max(s.nextOrderId, order.id + 1);
    if (customer.phase === "seated") customer.phase = "ordered";
  }
  // shelf overflow guard
  const ready = s.orders.filter((o) => o.status === "ready");
  for (let i = SERVICE.SHELF_MAX; i < ready.length; i += 1) ready[i].status = "queued";

  // ordered customers must have an order; demote otherwise
  for (const customer of s.customers) {
    if (customer.phase === "ordered" && !s.orders.some((o) => o.customerId === customer.id)) {
      customer.phase = "seated";
    }
  }

  // cat is not restored mid-event; timers re-roll naturally.
  return s;
}

// --- derived helpers -------------------------------------------------------

export function brewTimeFor(state, drink) {
  const level = state.upgrades.brew;
  return drink.brewTime * (1 - 0.18 * level);
}

export function trayCapacity(state) {
  return state.upgrades.tray > 0 ? SERVICE.TRAY_UPGRADED : SERVICE.TRAY_BASE;
}

export function spawnIntervalFor(state, rng, phaseRush) {
  const dayFactor = Math.max(
    SPAWN.MIN_INTERVAL,
    SPAWN.BASE_INTERVAL - SPAWN.PER_DAY_STEP * (state.day - 1),
  );
  let mult = 1;
  // weather
  if (state.weather.state === "rain") {
    mult /= state.upgrades.umbrella > 0 ? WEATHER.RAIN_SPAWN_MULT_UMBRELLA : WEATHER.RAIN_SPAWN_MULT;
  }
  // rush hours raise pressure (shorter interval)
  mult /= 1 + SPAWN.RUSH_BONUS * phaseRush;
  // marketing
  mult /= 1 + 0.1 * state.upgrades.marketing;
  // reputation 0.5..5 -> arrival multiplier
  const rep = clamp(
    SPAWN.REP_MIN_MULT +
      ((state.reputation - REPUTATION.MIN) / (REPUTATION.MAX - REPUTATION.MIN)) *
        (SPAWN.REP_MAX_MULT - SPAWN.REP_MIN_MULT),
    SPAWN.REP_MIN_MULT,
    SPAWN.REP_MAX_MULT,
  );
  mult /= rep;

  const variance = 1 + (rng() * 2 - 1) * SPAWN.VARIANCE;
  return Math.max(1.4, dayFactor * mult * variance);
}

export function patienceFor(state, type) {
  const decay = Math.max(0.82, 0.985 ** (state.day - 1));
  return type.patience * decay;
}

export function serializeState(state) {
  return structuredClone(state);
}
