// Simulation: day cycle, weather, customer lifecycle, order pipeline,
// waiter agents, street life. Runs on a fixed timestep.

import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_BY_ID,
  DRINKS,
  DRINK_BY_ID,
  DAY,
  REPUTATION,
  SERVICE,
  WEATHER,
  WIND,
  BOARD,
} from "./config.js";
import {
  ENTRY_LEFT,
  ENTRY_RIGHT,
  OFF_LEFT,
  OFF_RIGHT,
  STREET_LANES,
  TABLES,
  TABLE_BY_ID,
  WAITER_HOME,
  SHELF,
  nearestExit,
  tableAt,
} from "./layout.js";
import { findPath } from "./navgrid.js";
import { makeAgent, setPath, snapAgent, steerAgent, spawnFloat, spawnPuff, spawnSteam, windStrength } from "./physics.js";
import { brewTimeFor, makeCustomer, patienceFor, spawnIntervalFor, trayCapacity } from "./state.js";
import { clamp, pick, randRange } from "./util.js";

const WAITER_SPEED = 188;
const CAT_SPEED = 110;
const DOG_SPEED = 86;

export function createWorld(state, rng, hooks) {
  const world = {
    time: 0,
    rng,
    heat: 0,
    wind: 0,
    quiet: false,
    agents: new Map(), // customerId -> agent
    waiters: [],
    cat: null,
    dog: null,
    bikes: [],
    emit: hooks?.emit ?? (() => {}),
    audio: hooks?.audio ?? { beep() {}, setRainLevel() {} },
    fx: hooks?.fx ?? null,
  };

  // restored seated guests snap straight onto their stools
  for (const customer of state.customers) {
    const table = TABLE_BY_ID.get(customer.tableId);
    const type = CUSTOMER_TYPE_BY_ID.get(customer.type);
    if (!table || !type) continue;
    const agent = makeAgent({ x: table.seatX, y: table.seatY, speed: type.walkSpeed });
    snapAgent(agent, table.seatX, table.seatY);
    world.agents.set(customer.id, agent);
  }

  ensureWaiters(state, world);
  return world;
}

export function ensureWaiters(state, world) {
  const wanted = 1 + (state.upgrades.waiter2 > 0 ? 1 : 0);
  while (world.waiters.length < wanted) {
    // stack idle spots vertically below the counter; sideways offsets would
    // park the second waiter against the first table column
    const offset = world.waiters.length * 30;
    const agent = makeAgent({ x: WAITER_HOME.x, y: WAITER_HOME.y + offset, speed: WAITER_SPEED, radius: 10 });
    world.waiters.push({ agent, state: "idle", stops: [], carrying: [], homeX: WAITER_HOME.x, homeY: WAITER_HOME.y + offset });
  }
}

function toast(world, message) {
  if (!world.quiet) world.emit(message);
}

function beep(world, kind) {
  if (!world.quiet) world.audio.beep(kind);
}

// --- main tick --------------------------------------------------------------

export function simTick(state, world, dt) {
  world.time += dt;

  updateDay(state, world, dt);
  if (state.daySummary) return; // frozen until the next day starts

  updateWeather(state, world, dt);
  updateWind(state, world, dt);
  updateHeat(state, world, dt);
  updateSpawning(state, world, dt);
  updateCustomers(state, world, dt);
  updateOrders(state, world, dt);
  updateWaiters(state, world, dt);
  updateCat(state, world, dt);
  updateDog(state, world, dt);
  updateBikes(state, world, dt);
}

// --- day cycle ---------------------------------------------------------------

export function dayPhase(dayTime) {
  const t = clamp(dayTime / DAY.LENGTH, 0, 1);
  if (t < 0.25) return "morning";
  if (t < 0.52) return "noon";
  if (t < 0.78) return "evening";
  return "night";
}

export function phaseRush(dayTime) {
  const t = clamp(dayTime / DAY.LENGTH, 0, 1);
  const morning = Math.exp(-(((t - 0.1) / 0.07) ** 2));
  const evening = Math.exp(-(((t - 0.62) / 0.08) ** 2));
  return clamp(morning + evening, 0, 1);
}

function updateDay(state, world, dt) {
  if (state.daySummary) return;
  state.dayTime += dt;

  if (!state.closing && state.dayTime >= DAY.LENGTH - DAY.WIND_DOWN) {
    state.closing = true;
    toast(world, "Sắp hết ngày, quán ngừng nhận khách mới.");
  }

  if (state.dayTime >= DAY.LENGTH) {
    state.closeGrace += dt;
    const guestsGone = state.customers.length === 0;
    if (state.closeGrace >= DAY.CLOSE_GRACE && !guestsGone) {
      // closing time: everyone still seated finishes up politely
      for (const customer of state.customers) {
        if (["seated", "ordered", "served"].includes(customer.phase)) {
          cancelOrderForCustomer(state, world, customer, false);
          beginLeave(state, world, customer, false, true);
        }
      }
    }
    if (guestsGone) {
      endDay(state, world);
    }
  }
}

function endDay(state, world) {
  // sweep the cat out with the day
  if (world.cat) {
    clearCat(state, world);
  }
  state.orders = [];
  state.daySummary = {
    day: state.day,
    served: state.totalServed - state.dayStart.served,
    missed: state.totalMissed - state.dayStart.missed,
    earned: state.coins - state.dayStart.coins,
    tips: state.tips - state.dayStart.tips,
    reputation: state.reputation,
    bestStreak: state.bestStreak,
  };
  state.stats.daysPlayed += 1;
}

export function startNextDay(state, world, rng) {
  state.day += 1;
  state.dayTime = 0;
  state.closing = false;
  state.closeGrace = 0;
  state.daySummary = null;
  // fresh tables: stale freeAt values from yesterday would lock them all morning
  for (const table of state.tables) {
    table.status = "empty";
    table.customerId = null;
    table.freeAt = 0;
  }
  // staff back to the counter
  for (const waiter of world.waiters) {
    waiter.state = "idle";
    waiter.stops = [];
    waiter.carrying = [];
    snapAgent(waiter.agent, waiter.homeX, waiter.homeY);
  }
  state.dayStart = {
    coins: state.coins,
    served: state.totalServed,
    missed: state.totalMissed,
    tips: state.tips,
  };
  state.spawnTimer = randRange(rng, 1.5, 3.5);
  state.weather = { state: "clear", remaining: randRange(rng, ...WEATHER.CLEAR_DURATION), rainLevel: 0 };
  state.nextCatIn = randRange(rng, ...SERVICE.CAT_NAP_WINDOW);
  state.nextDogIn = randRange(rng, ...SERVICE.DOG_WINDOW);
  state.nextBikeIn = randRange(rng, ...SERVICE.BIKE_WINDOW);
  state.nextWindIn = randRange(rng, ...WIND.EVENT_WINDOW);
  state.windRemaining = 0;
}

// --- weather / wind / heat ----------------------------------------------------

function updateWeather(state, world, dt) {
  const w = state.weather;
  w.remaining -= dt;
  if (w.remaining <= 0) {
    if (w.state === "clear") {
      w.state = "cloudy";
      w.remaining = randRange(world.rng, ...WEATHER.CLOUDY_DURATION);
    } else if (w.state === "cloudy") {
      if (world.rng() < WEATHER.RAIN_CHANCE_FROM_CLOUDY) {
        w.state = "rain";
        w.remaining = randRange(world.rng, ...WEATHER.RAIN_DURATION);
        beep(world, "rain");
        toast(
          world,
          state.upgrades.umbrella > 0
            ? "Mưa rồi, may mà có ô che."
            : "Mưa rồi, khách ngại ghé hơn.",
        );
      } else {
        w.state = "clear";
        w.remaining = randRange(world.rng, ...WEATHER.CLEAR_DURATION);
      }
    } else {
      w.state = "cloudy";
      w.remaining = randRange(world.rng, ...WEATHER.CLOUDY_DURATION);
      toast(world, "Tạnh mưa rồi, trời mát hẳn.");
    }
  }
  const target = w.state === "rain" ? 1 : 0;
  const step = dt / WEATHER.RAIN_RAMP;
  w.rainLevel = clamp(w.rainLevel + Math.sign(target - w.rainLevel) * step, 0, 1);
  world.audio.setRainLevel(w.rainLevel);
}

function updateWind(state, world, dt) {
  if (state.windRemaining > 0) {
    state.windRemaining -= dt;
    if (state.windRemaining <= 0) {
      toast(world, "Gió lớn qua rồi.");
      state.nextWindIn = randRange(world.rng, ...WIND.EVENT_WINDOW);
    }
  } else {
    state.nextWindIn -= dt;
    if (state.nextWindIn <= 0) {
      state.windRemaining = randRange(world.rng, ...WIND.EVENT_DURATION);
      state.stats.windEvents += 1;
      beep(world, "wind");
      toast(world, "Một đợt gió lớn quét ngang phố.");
    }
  }
  const targetPower = state.windRemaining > 0 ? WIND.EVENT_POWER : WIND.BASE;
  state.windPower = clamp(state.windPower + Math.sign(targetPower - state.windPower) * dt * 0.7, 0, 1);
  world.wind = windStrength(world.time, state.windPower);
}

function updateHeat(state, world, dt) {
  const target = dayPhase(state.dayTime) === "noon" && state.weather.state === "clear" ? 1 : 0;
  world.heat = clamp(world.heat + Math.sign(target - world.heat) * dt * 0.5, 0, 1);
}

// --- spawning -----------------------------------------------------------------

function freeTables(state) {
  return state.tables.filter(
    (t) => t.status === "empty" && state.dayTime >= t.freeAt,
  );
}

function updateSpawning(state, world, dt) {
  if (state.closing) return;
  state.spawnTimer -= dt;
  if (state.spawnTimer > 0) return;

  const open = freeTables(state);
  if (open.length === 0) {
    spawnWalkby(state, world);
    state.spawnTimer = randRange(world.rng, 1.4, 2.6);
    return;
  }

  spawnCustomer(state, world, pick(world.rng, open));
  state.spawnTimer = spawnIntervalFor(state, world.rng, phaseRush(state.dayTime));
}

function spawnCustomer(state, world, tableState) {
  const rng = world.rng;
  const type = pick(rng, CUSTOMER_TYPES);
  const drink = pick(rng, DRINKS);
  const table = TABLE_BY_ID.get(tableState.id);
  const patienceMax = patienceFor(state, type);
  const id = state.nextCustomerId;
  state.nextCustomerId += 1;

  const template = pick(rng, type.speech);
  const customer = makeCustomer(id, type.id, drink.id, table.id, patienceMax, template.replace("{drink}", drink.labelVi));
  state.customers.push(customer);
  tableState.status = "reserved";
  tableState.customerId = id;

  const fromLeft = rng() < 0.5;
  const off = fromLeft ? OFF_LEFT : OFF_RIGHT;
  const entry = fromLeft ? ENTRY_LEFT : ENTRY_RIGHT;
  const agent = makeAgent({ x: off.x, y: off.y + randRange(rng, -6, 6), speed: type.walkSpeed });
  const path = findPath(entry.x, entry.y, table.seatX, table.seatY, agent.radius) ?? [
    { x: table.seatX, y: table.seatY },
  ];
  setPath(agent, [{ x: entry.x, y: entry.y }, ...path]);
  world.agents.set(id, agent);
}

function spawnWalkby(state, world) {
  const walkbys = state.customers.filter((c) => c.phase === "walkby");
  if (walkbys.length >= 2) return;
  const rng = world.rng;
  const type = pick(rng, CUSTOMER_TYPES);
  const id = state.nextCustomerId;
  state.nextCustomerId += 1;
  const customer = makeCustomer(id, type.id, pick(rng, DRINKS).id, null, 10, "");
  customer.phase = "walkby";
  state.customers.push(customer);
  state.stats.dropped += 1;

  const fromLeft = rng() < 0.5;
  const start = fromLeft ? OFF_LEFT : OFF_RIGHT;
  const end = fromLeft ? OFF_RIGHT : OFF_LEFT;
  const laneY = randRange(rng, 416, 434);
  const agent = makeAgent({ x: start.x, y: laneY, speed: type.walkSpeed });
  setPath(agent, [
    { x: (start.x + end.x) / 2 + randRange(rng, -120, 120), y: laneY + randRange(rng, -4, 4) },
    { x: end.x, y: laneY },
  ]);
  world.agents.set(id, agent);
}

// --- customers ------------------------------------------------------------------

function walkSpeedMult(state, world) {
  return (1 - WIND.WALK_SLOWDOWN * clamp(world.wind, 0, 1)) * (1 + 0.08 * state.weather.rainLevel);
}

function movingNeighbors(state, world) {
  const list = [];
  for (const customer of state.customers) {
    const agent = world.agents.get(customer.id);
    if (!agent) continue;
    if (["entering", "leaving", "leaving_angry", "walkby"].includes(customer.phase)) {
      list.push(agent);
    }
  }
  for (const waiter of world.waiters) {
    if (waiter.state !== "idle") list.push(waiter.agent);
  }
  return list;
}

function updateCustomers(state, world, dt) {
  const speedMult = walkSpeedMult(state, world);
  const neighbors = movingNeighbors(state, world);
  const toRemove = [];

  for (const customer of state.customers) {
    const agent = world.agents.get(customer.id);
    const table = customer.tableId ? state.tables.find((t) => t.id === customer.tableId) : null;
    const layout = customer.tableId ? TABLE_BY_ID.get(customer.tableId) : null;

    if (!agent) {
      toRemove.push(customer.id);
      continue;
    }

    switch (customer.phase) {
      case "entering": {
        const arrived = steerAgent(agent, dt, speedMult, neighbors, true);
        if (arrived && layout) {
          snapAgent(agent, layout.seatX, layout.seatY);
          customer.phase = "seated";
          if (table) {
            table.status = "seated";
            table.customerId = customer.id;
          }
          beep(world, "seat");
        }
        break;
      }
      case "seated":
      case "ordered": {
        let decay = 1;
        if (world.heat > 0.4 && state.upgrades.fans === 0) decay *= WEATHER.HEAT_PATIENCE_MULT;
        if (state.weather.rainLevel > 0.4) decay *= WEATHER.RAIN_PATIENCE_MULT;
        if (customer.phase === "ordered") decay *= SERVICE.ORDERED_PATIENCE_RELIEF;
        customer.patience -= dt * decay;
        if (customer.patience <= 0) {
          missCustomer(state, world, customer, layout);
        }
        break;
      }
      case "served": {
        customer.drinkTimer -= dt;
        if (customer.drinkTimer <= 0) {
          beginLeave(state, world, customer, false, false);
        }
        break;
      }
      case "leaving":
      case "leaving_angry":
      case "walkby": {
        const done = steerAgent(agent, dt, speedMult, neighbors, customer.phase !== "walkby");
        if (done) toRemove.push(customer.id);
        break;
      }
      default:
        toRemove.push(customer.id);
    }
  }

  if (toRemove.length > 0) {
    state.customers = state.customers.filter((c) => !toRemove.includes(c.id));
    for (const id of toRemove) world.agents.delete(id);
  }

  // safety: tables must point at live customers
  for (const table of state.tables) {
    if (table.customerId !== null && !state.customers.some((c) => c.id === table.customerId)) {
      if (table.status !== "blocked") {
        table.status = "empty";
        table.customerId = null;
      } else {
        table.customerId = null;
      }
    }
  }
}

function missCustomer(state, world, customer, layout) {
  state.totalMissed += 1;
  state.streak = 0;
  state.score = Math.max(0, state.score - 2);
  state.reputation = clamp(state.reputation - REPUTATION.MISS_LOSS, REPUTATION.MIN, REPUTATION.MAX);
  cancelOrderForCustomer(state, world, customer, true);
  beginLeave(state, world, customer, true, false);
  if (world.fx && layout) {
    spawnFloat(world.fx, "Bực quá!", layout.seatX, layout.y - 6, "#ffd5d5");
  }
  beep(world, "angry");
  const type = CUSTOMER_TYPE_BY_ID.get(customer.type);
  toast(world, `${type?.labelVi ?? "Khách"} chờ lâu quá nên bỏ đi.`);
}

function beginLeave(state, world, customer, angry, closing) {
  const agent = world.agents.get(customer.id);
  const table = customer.tableId ? state.tables.find((t) => t.id === customer.tableId) : null;
  const layout = customer.tableId ? TABLE_BY_ID.get(customer.tableId) : null;
  if (table && table.status !== "blocked") {
    table.status = "empty";
    table.customerId = null;
    table.freeAt = state.dayTime + SERVICE.TABLE_COOLDOWN;
  }
  customer.phase = angry ? "leaving_angry" : "leaving";
  if (agent && layout) {
    const exit = nearestExit(agent.x);
    const path = findPath(layout.seatX, layout.seatY, exit.entry.x, exit.entry.y, agent.radius) ?? [
      { x: exit.entry.x, y: exit.entry.y },
    ];
    setPath(agent, [...path, { x: exit.off.x, y: exit.off.y }]);
  }
  if (!angry && !closing && customer.paid && world.fx && layout) {
    spawnFloat(world.fx, "Cảm ơn nha!", layout.seatX, layout.y - 4, "#ffe9b8");
  }
}

// --- orders & barista -------------------------------------------------------------

export function placeOrder(state, world, customer) {
  const order = {
    id: state.nextOrderId,
    customerId: customer.id,
    tableId: customer.tableId,
    drinkId: customer.drinkId,
    status: "queued",
    progress: 0,
  };
  state.nextOrderId += 1;
  state.orders.push(order);
  customer.phase = "ordered";
  beep(world, "tap");
  return order;
}

function cancelOrderForCustomer(state, world, customer, withPuff) {
  const index = state.orders.findIndex((o) => o.customerId === customer.id);
  if (index === -1) return;
  const order = state.orders[index];
  if (order.status === "carried") {
    for (const waiter of world.waiters) {
      const ci = waiter.carrying.indexOf(order.id);
      if (ci === -1) continue;
      waiter.carrying.splice(ci, 1);
      const wasCurrentStop = waiter.stops[0]?.orderId === order.id;
      waiter.stops = waiter.stops.filter((s) => s.orderId !== order.id);
      if (world.fx && withPuff) spawnPuff(world.fx, waiter.agent.x, waiter.agent.y - 20);
      // re-aim the waiter: walking on to a cancelled table would deliver the
      // next cup at the wrong spot
      if (waiter.state === "out" && wasCurrentStop && waiter.stops.length > 0) {
        pathToNextStop(state, world, waiter);
      }
    }
  } else if (order.status === "ready" && world.fx && withPuff) {
    spawnPuff(world.fx, SHELF.x, SHELF.y);
  }
  state.orders.splice(index, 1);
}

function updateOrders(state, world, dt) {
  let brewing = state.orders.find((o) => o.status === "brewing");
  if (!brewing) {
    const next = state.orders.find((o) => o.status === "queued");
    if (next) {
      next.status = "brewing";
      next.progress = 0;
      brewing = next;
    }
  }
  if (brewing) {
    const drink = DRINK_BY_ID.get(brewing.drinkId);
    const duration = Math.max(0.4, brewTimeFor(state, drink));
    brewing.progress = Math.min(1, brewing.progress + dt / duration);
    if (brewing.progress >= 1) {
      const shelfCount = state.orders.filter((o) => o.status === "ready").length;
      if (shelfCount < SERVICE.SHELF_MAX) {
        brewing.status = "ready";
        brewing.progress = 0;
        if (world.fx) spawnSteam(world.fx, SHELF.x, SHELF.y - 10);
        beep(world, "ready");
      }
    }
  }
}

// --- waiters ----------------------------------------------------------------------

function updateWaiters(state, world, dt) {
  ensureWaiters(state, world);
  const speedMult = 1 - WIND.WALK_SLOWDOWN * 0.5 * clamp(world.wind, 0, 1);
  const neighbors = movingNeighbors(state, world);

  for (const waiter of world.waiters) {
    if (waiter.state === "idle") {
      const ready = state.orders.filter((o) => o.status === "ready");
      if (ready.length > 0) {
        const capacity = trayCapacity(state);
        const taken = ready.slice(0, capacity);
        for (const order of taken) order.status = "carried";
        waiter.carrying = taken.map((o) => o.id);
        waiter.stops = routeStops(taken, waiter.agent.x, waiter.agent.y);
        waiter.state = "out";
        pathToNextStop(state, world, waiter);
        beep(world, "pickup");
      }
      continue;
    }

    if (waiter.state === "out") {
      if (waiter.stops.length === 0) {
        waiter.state = "returning";
        const home = findPath(waiter.agent.x, waiter.agent.y, waiter.homeX, waiter.homeY, waiter.agent.radius);
        setPath(waiter.agent, home ?? [{ x: waiter.homeX, y: waiter.homeY }]);
        continue;
      }
      const arrived = steerAgent(waiter.agent, dt, speedMult, neighbors, true);
      if (arrived) {
        deliverAtStop(state, world, waiter, waiter.stops.shift());
        if (waiter.stops.length > 0) {
          pathToNextStop(state, world, waiter);
        } else {
          waiter.state = "returning";
          const home = findPath(waiter.agent.x, waiter.agent.y, waiter.homeX, waiter.homeY, waiter.agent.radius);
          setPath(waiter.agent, home ?? [{ x: waiter.homeX, y: waiter.homeY }]);
        }
      }
      continue;
    }

    if (waiter.state === "returning") {
      const arrived = steerAgent(waiter.agent, dt, speedMult, neighbors, true);
      if (arrived) {
        waiter.state = "idle";
        snapAgent(waiter.agent, waiter.homeX, waiter.homeY);
      }
    }
  }
}

function routeStops(orders, fromX, fromY) {
  // greedy nearest-first delivery route
  const remaining = orders.map((o) => ({ orderId: o.id, tableId: o.tableId }));
  const stops = [];
  let cx = fromX;
  let cy = fromY;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const table = TABLE_BY_ID.get(remaining[i].tableId);
      const d = (table.deliverX - cx) ** 2 + (table.deliverY - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    const [stop] = remaining.splice(bestIndex, 1);
    const table = TABLE_BY_ID.get(stop.tableId);
    cx = table.deliverX;
    cy = table.deliverY;
    stops.push(stop);
  }
  return stops;
}

function pathToNextStop(state, world, waiter) {
  const stop = waiter.stops[0];
  if (!stop) return;
  const table = TABLE_BY_ID.get(stop.tableId);
  const path = findPath(waiter.agent.x, waiter.agent.y, table.deliverX, table.deliverY, waiter.agent.radius);
  setPath(waiter.agent, path ?? [{ x: table.deliverX, y: table.deliverY }]);
}

function deliverAtStop(state, world, waiter, stop) {
  const orderIndex = state.orders.findIndex((o) => o.id === stop.orderId);
  const carryingIndex = waiter.carrying.indexOf(stop.orderId);
  if (carryingIndex !== -1) waiter.carrying.splice(carryingIndex, 1);
  if (orderIndex === -1) return; // order was cancelled mid-route

  const order = state.orders[orderIndex];
  state.orders.splice(orderIndex, 1);
  const customer = state.customers.find((c) => c.id === order.customerId);
  const layout = TABLE_BY_ID.get(stop.tableId);

  if (!customer || customer.phase !== "ordered" || customer.tableId !== stop.tableId) {
    // guest already gone: quietly bin the drink
    if (world.fx) spawnPuff(world.fx, waiter.agent.x, waiter.agent.y - 18);
    return;
  }

  // success! pay up.
  const drink = DRINK_BY_ID.get(order.drinkId);
  const ratio = clamp(customer.patience / customer.patienceMax, 0, 1);
  const tip = ratio >= SERVICE.TIP_FAST_RATIO ? 2 : ratio >= SERVICE.TIP_OK_RATIO ? 1 : 0;
  const comboBonus = tip > 0 ? Math.floor(Math.min(state.streak, 9) / 3) : 0;
  const earned = drink.price + tip + comboBonus;

  state.coins += earned;
  state.tips += tip + comboBonus;
  state.score += drink.price + (tip > 0 ? 2 : 1) + Math.floor(state.streak / 5);
  state.streak += 1;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.totalServed += 1;
  state.reputation = clamp(
    state.reputation + (tip > 0 ? REPUTATION.TIP_GAIN : REPUTATION.SERVE_GAIN),
    REPUTATION.MIN,
    REPUTATION.MAX,
  );

  customer.phase = "served";
  customer.paid = true;
  customer.drinkTimer = randRange(world.rng, ...SERVICE.DRINKING_TIME);

  if (world.fx && layout) {
    spawnFloat(
      world.fx,
      tip + comboBonus > 0 ? `+${earned} xu (boa ${tip + comboBonus})` : `+${earned} xu`,
      layout.seatX,
      layout.y - 10,
      tip > 0 ? "#fff2a8" : "#dcffe1",
    );
    spawnSteam(world.fx, layout.cx + layout.w / 2 - 28, layout.y + 30);
  }
  beep(world, tip > 0 ? "tip" : "serve");
}

// --- cat / dog / bikes ---------------------------------------------------------------

function updateCat(state, world, dt) {
  if (!world.cat) {
    state.nextCatIn -= dt;
    if (state.nextCatIn <= 0) {
      trySpawnCat(state, world);
      state.nextCatIn = randRange(world.rng, ...SERVICE.CAT_NAP_WINDOW);
    }
    return;
  }

  const cat = world.cat;
  const layout = cat.tableId ? TABLE_BY_ID.get(cat.tableId) : null;

  if (cat.mode === "approach") {
    const done = steerAgent(cat.agent, dt, 1, null, cat.leg === "sidewalk");
    if (done) {
      if (cat.leg === "street") {
        cat.leg = "sidewalk";
        const path = findPath(cat.agent.x, cat.agent.y, layout.seatX, layout.y + layout.h + 14, 8);
        setPath(cat.agent, path ?? [{ x: layout.seatX, y: layout.y + layout.h + 14 }]);
      } else {
        // hop onto the table
        cat.mode = "napping";
        cat.napFor = 0;
        snapAgent(cat.agent, layout.cx, layout.cy - 4);
        const table = state.tables.find((t) => t.id === cat.tableId);
        if (table) table.status = "blocked";
        state.stats.catNaps += 1;
        beep(world, "cat");
        toast(world, "Một chú mèo leo lên bàn nằm ngủ. Chạm để đuổi đi!");
      }
    }
    return;
  }

  if (cat.mode === "napping") {
    cat.napFor += dt;
    cat.agent.px = cat.agent.x;
    cat.agent.py = cat.agent.y;
    if (cat.napFor >= SERVICE.CAT_NAP_MAX) {
      shooCat(state, world, true);
    }
    return;
  }

  if (cat.mode === "fleeing") {
    const done = steerAgent(cat.agent, dt, 1.45, null, false);
    if (done) {
      world.cat = null;
      state.cat = null;
    }
  }
}

function trySpawnCat(state, world) {
  const open = freeTables(state);
  if (open.length === 0) return;
  const tableState = pick(world.rng, open);
  const layout = TABLE_BY_ID.get(tableState.id);
  tableState.status = "blocked"; // claim it right away so guests skip it
  tableState.customerId = null;

  const fromLeft = world.rng() < 0.5;
  const startX = fromLeft ? -36 : BOARD.W + 36;
  const startY = randRange(world.rng, ...STREET_LANES.catY);
  const agent = makeAgent({ x: startX, y: startY, speed: CAT_SPEED, radius: 8 });
  // street leg: walk to the curb point under the table, then up onto the sidewalk
  const curbX = clamp(layout.cx + randRange(world.rng, -30, 30), 60, BOARD.W - 60);
  setPath(agent, [
    { x: curbX, y: startY },
    { x: curbX, y: 424 },
  ]);
  world.cat = { agent, mode: "approach", leg: "street", tableId: tableState.id, napFor: 0 };
  state.cat = { mode: "approach", tableId: tableState.id };
}

export function shooCat(state, world, voluntary = false) {
  const cat = world.cat;
  if (!cat || cat.mode === "fleeing") return false;
  const table = state.tables.find((t) => t.id === cat.tableId);
  if (table && table.status === "blocked") {
    table.status = "empty";
    table.customerId = null;
    table.freeAt = state.dayTime + 0.8;
  }
  const layout = TABLE_BY_ID.get(cat.tableId);
  cat.mode = "fleeing";
  state.cat = { mode: "fleeing", tableId: null };
  const exitX = cat.agent.x < BOARD.W / 2 ? -50 : BOARD.W + 50;
  const streetY = randRange(world.rng, ...STREET_LANES.catY);
  setPath(cat.agent, [
    { x: layout ? layout.cx + 30 : cat.agent.x + 30, y: layout ? layout.y + layout.h + 16 : cat.agent.y + 26 },
    { x: cat.agent.x + (exitX > 0 ? 60 : -60), y: 430 },
    { x: (cat.agent.x + exitX) / 2, y: streetY },
    { x: exitX, y: streetY },
  ]);
  if (!voluntary) {
    beep(world, "cat");
    if (world.fx) spawnPuff(world.fx, cat.agent.x, cat.agent.y - 10, "#ffe2ba");
  } else {
    toast(world, "Mèo ngủ đã rồi tự đi mất.");
  }
  return true;
}

function clearCat(state, world) {
  if (world.cat?.tableId) {
    const table = state.tables.find((t) => t.id === world.cat.tableId);
    if (table && table.status === "blocked") {
      table.status = "empty";
      table.customerId = null;
    }
  }
  world.cat = null;
  state.cat = null;
}

function updateDog(state, world, dt) {
  if (!world.dog) {
    state.nextDogIn -= dt;
    if (state.nextDogIn <= 0) {
      const fromLeft = world.rng() < 0.5;
      const y = randRange(world.rng, ...STREET_LANES.dogY);
      const agent = makeAgent({
        x: fromLeft ? -40 : BOARD.W + 40,
        y,
        speed: DOG_SPEED,
        radius: 9,
      });
      const exitX = fromLeft ? BOARD.W + 40 : -40;
      setPath(agent, [
        { x: fromLeft ? randRange(world.rng, 200, 420) : randRange(world.rng, 540, 760), y: y + randRange(world.rng, -8, 8) },
        { x: exitX, y: y + randRange(world.rng, -6, 6) },
      ]);
      world.dog = { agent, sniff: randRange(world.rng, 1.2, 2.4), sniffed: false };
      state.stats.dogVisits += 1;
      state.nextDogIn = randRange(world.rng, ...SERVICE.DOG_WINDOW);
    }
    return;
  }

  const dog = world.dog;
  if (!dog.sniffed && dog.agent.path.length === 1 && dog.sniff > 0) {
    // pause to sniff at the mid waypoint
    dog.sniff -= dt;
    dog.agent.px = dog.agent.x;
    dog.agent.py = dog.agent.y;
    if (dog.sniff <= 0) dog.sniffed = true;
    return;
  }
  const done = steerAgent(dog.agent, dt, 1, null, false);
  if (done) world.dog = null;
}

function updateBikes(state, world, dt) {
  state.nextBikeIn -= dt;
  if (state.nextBikeIn <= 0 && world.bikes.length < 2) {
    const fromLeft = world.rng() < 0.5;
    world.bikes.push({
      x: fromLeft ? -70 : BOARD.W + 70,
      px: fromLeft ? -70 : BOARD.W + 70,
      y: randRange(world.rng, ...STREET_LANES.bikeY),
      dir: fromLeft ? 1 : -1,
      speed: randRange(world.rng, 300, 420),
      hue: pick(world.rng, ["#d8595d", "#5b86c4", "#67a86b", "#c4995b"]),
    });
    state.nextBikeIn = randRange(world.rng, ...SERVICE.BIKE_WINDOW);
    beep(world, "bike");
  }
  for (let i = world.bikes.length - 1; i >= 0; i -= 1) {
    const bike = world.bikes[i];
    bike.px = bike.x;
    bike.x += bike.dir * bike.speed * dt;
    if (bike.x < -90 || bike.x > BOARD.W + 90) world.bikes.splice(i, 1);
  }
}

// --- input ------------------------------------------------------------------------

export function handleTap(state, world, x, y) {
  // 1) napping cat anywhere near its table top
  if (world.cat && world.cat.mode === "napping") {
    const layout = TABLE_BY_ID.get(world.cat.tableId);
    if (
      layout &&
      x >= layout.x - 10 && x <= layout.x + layout.w + 10 &&
      y >= layout.y - 26 && y <= layout.y + layout.h + 30
    ) {
      shooCat(state, world, false);
      return { kind: "shoo" };
    }
  }

  const layout = tableAt(x, y);
  if (!layout) return null;
  const table = state.tables.find((t) => t.id === layout.id);
  if (!table) return null;

  if (table.status === "seated" && table.customerId !== null) {
    const customer = state.customers.find((c) => c.id === table.customerId);
    if (customer && customer.phase === "seated") {
      placeOrder(state, world, customer);
      toast(world, `“${customer.orderText}”`);
      return { kind: "order" };
    }
    if (customer && customer.phase === "ordered") {
      toast(world, "Món đang được pha, chờ chút nhé.");
      return { kind: "info" };
    }
    if (customer && customer.phase === "served") {
      return { kind: "info" };
    }
  }
  return null;
}

// --- away-from-tab catch-up ----------------------------------------------------------

export function applyIdleCredit(state, world, extraSeconds) {
  const interval = Math.max(2.5, spawnIntervalFor(state, () => 0.5, 0.3));
  const estimated = Math.floor((extraSeconds / interval) * 0.22);
  if (estimated <= 0) return 0;
  const perCup = 2; // conservative average earnings
  state.coins += estimated * perCup;
  state.score += estimated * perCup;
  state.totalServed += estimated;
  return estimated * perCup;
}
