// Grid-based A* pathfinding with line-of-sight smoothing (string pulling).
// Guarantees agents never path through the counter or tables.

import { BOARD } from "./config.js";
import { pointBlocked } from "./layout.js";

export const CELL = 20;
const COLS = Math.ceil(BOARD.W / CELL);
const ROWS = Math.ceil(BOARD.H / CELL);

const gridCache = new Map(); // radius -> Uint8Array blocked flags

function gridFor(radius) {
  const key = Math.round(radius);
  let grid = gridCache.get(key);
  if (!grid) {
    grid = new Uint8Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cx = col * CELL + CELL / 2;
        const cy = row * CELL + CELL / 2;
        grid[row * COLS + col] = pointBlocked(cx, cy, key) ? 1 : 0;
      }
    }
    gridCache.set(key, grid);
  }
  return grid;
}

function cellOf(x, y) {
  return {
    col: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))),
    row: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
  };
}

function centerOf(col, row) {
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

// Spiral search for the nearest walkable cell (start/goal may sit in an
// inflated zone, e.g. a seat right next to a table).
function nearestWalkable(grid, col, row, maxRing = 6) {
  if (!grid[row * COLS + col]) return { col, row };
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (!grid[r * COLS + c]) return { col: c, row: r };
      }
    }
  }
  return null;
}

export function hasLineOfSight(ax, ay, bx, by, radius) {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(length / 6));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (pointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t, radius)) {
      return false;
    }
  }
  return true;
}

const NEIGHBORS = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
  [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14],
];

function octile(ac, ar, bc, br) {
  const dx = Math.abs(ac - bc);
  const dy = Math.abs(ar - br);
  return 10 * (dx + dy) - 6 * Math.min(dx, dy);
}

// A* over the grid. Returns waypoints [{x, y}...] ending exactly at (tx, ty),
// or null when no route exists.
export function findPath(sx, sy, tx, ty, radius = 10) {
  const grid = gridFor(radius);
  const clampedSx = Math.max(4, Math.min(BOARD.W - 4, sx));
  const clampedSy = Math.max(4, Math.min(BOARD.H - 4, sy));
  let start = cellOf(clampedSx, clampedSy);
  let goal = cellOf(Math.max(4, Math.min(BOARD.W - 4, tx)), Math.max(4, Math.min(BOARD.H - 4, ty)));
  start = nearestWalkable(grid, start.col, start.row);
  goal = nearestWalkable(grid, goal.col, goal.row);
  if (!start || !goal) return null;

  // Trivial case: direct sight.
  if (hasLineOfSight(sx, sy, tx, ty, radius)) {
    return [{ x: tx, y: ty }];
  }

  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map();
  const startKey = start.row * COLS + start.col;
  const goalKey = goal.row * COLS + goal.col;
  gScore.set(startKey, 0);
  open.push(startKey, octile(start.col, start.row, goal.col, goal.row));

  let found = false;
  while (open.size > 0) {
    const currentKey = open.pop();
    if (currentKey === goalKey) {
      found = true;
      break;
    }
    const cCol = currentKey % COLS;
    const cRow = (currentKey - cCol) / COLS;
    const currentG = gScore.get(currentKey);

    for (const [dc, dr, cost] of NEIGHBORS) {
      const nc = cCol + dc;
      const nr = cRow + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (grid[nr * COLS + nc]) continue;
      // no corner cutting on diagonals
      if (dc !== 0 && dr !== 0) {
        if (grid[cRow * COLS + nc] || grid[nr * COLS + cCol]) continue;
      }
      const nKey = nr * COLS + nc;
      const tentative = currentG + cost;
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentative);
        cameFrom.set(nKey, currentKey);
        open.push(nKey, tentative + octile(nc, nr, goal.col, goal.row));
      }
    }
  }

  if (!found) return null;

  // Reconstruct cell path -> points.
  const cells = [];
  let key = goalKey;
  while (key !== undefined) {
    const col = key % COLS;
    cells.push(centerOf(col, (key - col) / COLS));
    key = cameFrom.get(key);
  }
  cells.reverse();

  const points = [...cells, { x: tx, y: ty }];

  // String pulling: keep the farthest point still in line of sight.
  const smoothed = [];
  let anchorX = sx;
  let anchorY = sy;
  let i = 0;
  while (i < points.length) {
    let farthest = i;
    for (let j = points.length - 1; j > i; j -= 1) {
      if (hasLineOfSight(anchorX, anchorY, points[j].x, points[j].y, radius)) {
        farthest = j;
        break;
      }
    }
    smoothed.push(points[farthest]);
    anchorX = points[farthest].x;
    anchorY = points[farthest].y;
    i = farthest + 1;
  }

  return smoothed;
}

class MinHeap {
  constructor() {
    this.keys = [];
    this.scores = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, score) {
    this.keys.push(key);
    this.scores.push(score);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] <= this.scores[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    const top = this.keys[0];
    const lastKey = this.keys.pop();
    const lastScore = this.scores.pop();
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.scores[0] = lastScore;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.scores[left] < this.scores[smallest]) smallest = left;
        if (right < this.keys.length && this.scores[right] < this.scores[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]];
  }
}
