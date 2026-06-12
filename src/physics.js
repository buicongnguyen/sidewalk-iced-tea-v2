// Movement physics (steering agents) and particle systems.
//
// Agents integrate velocity from steering forces (seek/arrive along a path),
// get soft separation from nearby agents, and a hard axis-sliding clamp so
// nothing ever ends up inside an obstacle.

import { BOARD } from "./config.js";
import { pointBlocked } from "./layout.js";
import { clamp, lerp } from "./util.js";

export function makeAgent({ x, y, speed = 130, radius = 10, accel = 520 }) {
  return {
    x, y,
    px: x, py: y, // previous tick position (render interpolation)
    vx: 0, vy: 0,
    speed, accel, radius,
    path: [],
    stride: 0, // walk-cycle phase, advanced by distance travelled
    facing: 1,
    moving: false,
  };
}

export function snapAgent(agent, x, y) {
  agent.x = x; agent.y = y;
  agent.px = x; agent.py = y;
  agent.vx = 0; agent.vy = 0;
  agent.path = [];
  agent.moving = false;
}

export function setPath(agent, path) {
  agent.path = Array.isArray(path) ? path.slice() : [];
}

const ARRIVE_RADIUS = 56;
const WAYPOINT_RADIUS = 16;
const STOP_EPSILON = 2.2;

// Advances the agent along its path. Returns true once the final point is
// reached (agent stops there).
export function steerAgent(agent, dt, speedMult = 1, neighbors = null, avoidObstacles = true) {
  agent.px = agent.x;
  agent.py = agent.y;

  if (!agent.path || agent.path.length === 0) {
    agent.vx = 0;
    agent.vy = 0;
    agent.moving = false;
    return true;
  }

  const target = agent.path[0];
  const isFinal = agent.path.length === 1;
  const dx = target.x - agent.x;
  const dy = target.y - agent.y;
  const distance = Math.hypot(dx, dy);
  const maxSpeed = agent.speed * speedMult;

  // Desired velocity: full speed toward the waypoint, eased near a final stop.
  let desiredSpeed = maxSpeed;
  if (isFinal && distance < ARRIVE_RADIUS) {
    desiredSpeed = maxSpeed * clamp(distance / ARRIVE_RADIUS, 0.12, 1);
  }
  const inv = distance > 0.0001 ? 1 / distance : 0;
  const desiredX = dx * inv * desiredSpeed;
  const desiredY = dy * inv * desiredSpeed;

  // Steering force toward desired velocity, clamped by acceleration.
  let fx = desiredX - agent.vx;
  let fy = desiredY - agent.vy;
  const fLen = Math.hypot(fx, fy);
  const maxForce = agent.accel * dt;
  if (fLen > maxForce && fLen > 0) {
    fx = (fx / fLen) * maxForce;
    fy = (fy / fLen) * maxForce;
  }
  agent.vx += fx;
  agent.vy += fy;

  // Separation from neighbors (soft push, never teleports).
  if (neighbors) {
    let pushX = 0;
    let pushY = 0;
    for (const other of neighbors) {
      if (other === agent) continue;
      const ox = agent.x - other.x;
      const oy = agent.y - other.y;
      const minDist = agent.radius + other.radius + 2;
      const d = Math.hypot(ox, oy);
      if (d > 0.001 && d < minDist) {
        const strength = (1 - d / minDist) * 130;
        pushX += (ox / d) * strength;
        pushY += (oy / d) * strength;
      }
    }
    agent.vx += pushX * dt * 8;
    agent.vy += pushY * dt * 8;
  }

  // Clamp speed.
  const vLen = Math.hypot(agent.vx, agent.vy);
  if (vLen > maxSpeed && vLen > 0) {
    agent.vx = (agent.vx / vLen) * maxSpeed;
    agent.vy = (agent.vy / vLen) * maxSpeed;
  }

  // Integrate with axis-sliding obstacle clamp.
  const stepX = agent.vx * dt;
  const stepY = agent.vy * dt;
  moveWithSlide(agent, stepX, stepY, avoidObstacles);

  // Walk cycle + facing.
  const speedNow = Math.hypot(agent.x - agent.px, agent.y - agent.py) / Math.max(dt, 1e-6);
  agent.moving = speedNow > 6;
  agent.stride += (speedNow / 30) * dt * Math.PI * 2;
  if (Math.abs(agent.vx) > 14) {
    agent.facing = agent.vx >= 0 ? 1 : -1;
  }

  // Waypoint bookkeeping.
  const reachRadius = isFinal ? STOP_EPSILON + 2.5 : WAYPOINT_RADIUS;
  if (distance <= reachRadius || (isFinal && distance < 6 && speedNow < 12)) {
    agent.path.shift();
    if (agent.path.length === 0) {
      agent.x = target.x;
      agent.y = target.y;
      agent.vx = 0;
      agent.vy = 0;
      agent.moving = false;
      return true;
    }
  }
  return false;
}

function moveWithSlide(agent, stepX, stepY, avoidObstacles) {
  if (!avoidObstacles) {
    agent.x += stepX;
    agent.y += stepY;
    return;
  }
  const r = agent.radius * 0.8;
  if (!pointBlocked(agent.x + stepX, agent.y + stepY, r)) {
    agent.x += stepX;
    agent.y += stepY;
    return;
  }
  if (!pointBlocked(agent.x + stepX, agent.y, r)) {
    agent.x += stepX;
    return;
  }
  if (!pointBlocked(agent.x, agent.y + stepY, r)) {
    agent.y += stepY;
  }
  // fully blocked: stay put; A* paths make this rare
}

export function interpX(agent, alpha) {
  return lerp(agent.px, agent.x, alpha);
}

export function interpY(agent, alpha) {
  return lerp(agent.py, agent.y, alpha);
}

// ---------------------------------------------------------------------------
// Wind: a smooth gust field. `power` is the slow event envelope (0..1+);
// the field adds quick sub-gusts so it feels alive.

export function windStrength(timeSeconds, power) {
  const flutter =
    0.55 +
    0.3 * Math.sin(timeSeconds * 1.7) +
    0.15 * Math.sin(timeSeconds * 4.3 + 1.7);
  return clamp(power * flutter, 0, 1.4);
}

// ---------------------------------------------------------------------------
// Particles (runtime-only, never saved).

export function createFx() {
  return {
    rain: [],
    splashes: [],
    leaves: [],
    floats: [], // floating reward/penalty texts
    puffs: [], // discard / shoo effects
    steams: [],
  };
}

export function updateFx(fx, dt, env) {
  const { rainLevel, wind, rng } = env;

  // --- rain: spawn proportional to intensity, integrate gravity + wind drift
  const targetCount = Math.round(rainLevel * 130);
  let spawnBudget = Math.max(0, targetCount - fx.rain.length);
  spawnBudget = Math.min(spawnBudget, 14);
  for (let i = 0; i < spawnBudget; i += 1) {
    fx.rain.push({
      x: rng() * (BOARD.W + 200) - 100,
      y: -20 - rng() * 40,
      vx: 0,
      vy: 380 + rng() * 160,
      len: 10 + rng() * 8,
    });
  }
  for (let i = fx.rain.length - 1; i >= 0; i -= 1) {
    const drop = fx.rain[i];
    drop.vx = lerp(drop.vx, wind * 150, 0.1);
    drop.vy = Math.min(620, drop.vy + 420 * dt);
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    if (drop.y >= BOARD.H - 6 - (drop.x % 40)) {
      // splash where it lands
      if (fx.splashes.length < 70) {
        fx.splashes.push({ x: drop.x, y: Math.min(BOARD.H - 4, drop.y), age: 0, life: 0.32 });
      }
      fx.rain.splice(i, 1);
    } else if (drop.x < -140 || drop.x > BOARD.W + 140) {
      fx.rain.splice(i, 1);
    }
  }

  for (let i = fx.splashes.length - 1; i >= 0; i -= 1) {
    const s = fx.splashes[i];
    s.age += dt;
    if (s.age >= s.life) fx.splashes.splice(i, 1);
  }

  // --- leaves: spawn on strong wind, tumble across
  if (wind > 0.45 && fx.leaves.length < 16 && rng() < dt * wind * 4) {
    fx.leaves.push({
      x: -30,
      y: 90 + rng() * 360,
      vx: 60 + rng() * 80,
      vy: -10 + rng() * 20,
      rot: rng() * Math.PI * 2,
      rotV: 2 + rng() * 5,
      hue: rng() < 0.5 ? "#d2b45f" : "#9ec46b",
    });
  }
  for (let i = fx.leaves.length - 1; i >= 0; i -= 1) {
    const leaf = fx.leaves[i];
    leaf.vx = lerp(leaf.vx, 60 + wind * 240, 0.06);
    leaf.vy += Math.sin(leaf.rot * 2) * 60 * dt + 16 * dt;
    leaf.vy = clamp(leaf.vy, -60, 70);
    leaf.x += leaf.vx * dt;
    leaf.y += leaf.vy * dt;
    leaf.rot += leaf.rotV * dt;
    if (leaf.x > BOARD.W + 60 || leaf.y > BOARD.H + 30) fx.leaves.splice(i, 1);
  }

  // --- floating texts
  for (let i = fx.floats.length - 1; i >= 0; i -= 1) {
    const f = fx.floats[i];
    f.age += dt;
    if (f.age >= f.life) fx.floats.splice(i, 1);
  }

  // --- puffs
  for (let i = fx.puffs.length - 1; i >= 0; i -= 1) {
    const p = fx.puffs[i];
    p.age += dt;
    if (p.age >= p.life) fx.puffs.splice(i, 1);
  }

  // --- steam wisps above fresh drinks
  for (let i = fx.steams.length - 1; i >= 0; i -= 1) {
    const s = fx.steams[i];
    s.age += dt;
    s.y -= 14 * dt;
    s.x += Math.sin(s.age * 5 + s.seed) * 6 * dt + wind * 10 * dt;
    if (s.age >= s.life) fx.steams.splice(i, 1);
  }
}

export function spawnFloat(fx, text, x, y, color = "#dcffe1") {
  fx.floats.push({ text, x, y, color, age: 0, life: 1.5 });
  if (fx.floats.length > 24) fx.floats.shift();
}

export function spawnPuff(fx, x, y, color = "#fff3d9") {
  fx.puffs.push({ x, y, color, age: 0, life: 0.45 });
}

export function spawnSteam(fx, x, y) {
  if (fx.steams.length > 30) return;
  fx.steams.push({ x, y, age: 0, life: 1.6, seed: Math.random() * 10 });
}
