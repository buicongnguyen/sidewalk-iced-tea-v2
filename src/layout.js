// Scene geometry: one source of truth for rendering, navigation and hit tests.
//
//   y   0..116   shop wall band (blocked)
//   y 116..440   sidewalk seating area (walkable, minus counter + tables)
//   y 440..456   curb
//   y 456..540   street (wanderers + bikes only)

import { BOARD } from "./config.js";

export const WALL_Y = 116;
export const SIDEWALK_BOTTOM = 440;
export const CURB_TOP = SIDEWALK_BOTTOM;
export const STREET_TOP = 456;
export const WALK_MARGIN_X = 8;

export const COUNTER = { x: 24, y: 152, w: 194, h: 152 };
export const WAITER_HOME = { x: 248, y: 336 };
export const SHELF = { x: COUNTER.x + COUNTER.w - 26, y: COUNTER.y + 24 }; // visual anchor

export const TABLE_W = 112;
export const TABLE_H = 80;

function buildTables() {
  const tables = [];
  const colXs = [286, 446, 606, 766];
  const rowYs = [152, 296];
  for (let row = 0; row < rowYs.length; row += 1) {
    for (let col = 0; col < colXs.length; col += 1) {
      const x = colXs[col];
      const y = rowYs[row];
      tables.push({
        id: `table-${row}-${col}`,
        index: tables.length,
        row,
        col,
        x,
        y,
        w: TABLE_W,
        h: TABLE_H,
        cx: x + TABLE_W / 2,
        cy: y + TABLE_H / 2,
        seatX: x + TABLE_W / 2,
        seatY: y + TABLE_H + 16,
        deliverX: x + TABLE_W / 2 - 26,
        deliverY: y + TABLE_H + 14,
      });
    }
  }
  return tables;
}

export const TABLES = buildTables();
export const TABLE_BY_ID = new Map(TABLES.map((t) => [t.id, t]));

export const ENTRY_LEFT = { x: 18, y: 424 };
export const ENTRY_RIGHT = { x: 942, y: 424 };
export const OFF_LEFT = { x: -40, y: 424 };
export const OFF_RIGHT = { x: 1000, y: 424 };

// Rect obstacles used by both navigation and the safety clamp.
export const OBSTACLES = [
  { x: COUNTER.x, y: COUNTER.y, w: COUNTER.w, h: COUNTER.h, id: "counter" },
  ...TABLES.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, id: t.id })),
];

export function pointBlocked(x, y, radius = 0) {
  if (y < WALL_Y + radius) return true;
  if (y > SIDEWALK_BOTTOM - radius) return true;
  // allow walking slightly off-screen so agents can enter/exit the board
  if (x < WALK_MARGIN_X + radius - 70 || x > BOARD.W - WALK_MARGIN_X - radius + 70) return true;
  for (const rect of OBSTACLES) {
    if (
      x > rect.x - radius &&
      x < rect.x + rect.w + radius &&
      y > rect.y - radius &&
      y < rect.y + rect.h + radius
    ) {
      return true;
    }
  }
  return false;
}

// The street band is free-form (no obstacles); wanderers roam here.
export const STREET_LANES = {
  catY: [468, 500],
  dogY: [486, 524],
  bikeY: [496, 514],
};

export function tableAt(x, y, padBottom = 44) {
  return (
    TABLES.find(
      (t) => x >= t.x - 6 && x <= t.x + t.w + 6 && y >= t.y - 8 && y <= t.y + t.h + padBottom,
    ) ?? null
  );
}

export function nearestExit(x) {
  return x < BOARD.W / 2 ? { entry: ENTRY_LEFT, off: OFF_LEFT } : { entry: ENTRY_RIGHT, off: OFF_RIGHT };
}
