// Small math + RNG helpers shared by every module.

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function asNumber(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

// mulberry32 — small, fast, good-enough seeded PRNG.
export function makeRng(seed) {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

export function pick(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

export function formatClock(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Word-wraps a short Vietnamese sentence into at most two lines.
export function splitText(text, maxChars = 18) {
  if (typeof text !== "string" || text.trim().length === 0) return [];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || line.length === 0) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ")];
}
