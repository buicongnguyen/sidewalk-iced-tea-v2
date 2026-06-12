// Renderer: HiDPI canvas, cached static background, y-sorted entities,
// interpolated agent positions, day/night lighting and weather effects.

import { BOARD, CUSTOMER_TYPE_BY_ID, DRINK_BY_ID, DAY } from "./config.js";
import {
  COUNTER,
  CURB_TOP,
  SHELF,
  SIDEWALK_BOTTOM,
  STREET_TOP,
  TABLES,
  TABLE_BY_ID,
  WALL_Y,
} from "./layout.js";
import { interpX, interpY } from "./physics.js";
import { clamp, lerp, smoothstep, splitText } from "./util.js";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const bg = document.createElement("canvas");
  let bgCtx = bg.getContext("2d");
  let pixelW = 0;
  let pixelH = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w === pixelW && h === pixelH) return;
    pixelW = w;
    pixelH = h;
    canvas.width = w;
    canvas.height = h;
    bg.width = w;
    bg.height = h;
    bgCtx = bg.getContext("2d");
    applyBoardTransform(bgCtx);
    drawStaticBackground(bgCtx);
  }

  function applyBoardTransform(context) {
    context.setTransform(pixelW / BOARD.W, 0, 0, pixelH / BOARD.H, 0, 0);
  }

  function render(frame) {
    if (pixelW === 0) resize();
    if (pixelW === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    applyBoardTransform(ctx);

    const { state, world, fx, alpha, time, mode } = frame;

    drawGroundWetness(ctx, state.weather.rainLevel);
    drawAwning(ctx, world.wind, time);
    drawStringLights(ctx, world.wind, time, ambientFor(state).lamp);
    drawCounterDynamic(ctx, state, world, time);

    // --- y-sorted world entities
    const drawables = [];
    for (const layout of TABLES) {
      const table = state.tables.find((t) => t.id === layout.id);
      drawables.push({
        sortY: layout.y + layout.h,
        draw: () => drawTable(ctx, layout, table, state, time),
      });
    }
    for (const customer of state.customers) {
      const agent = world.agents.get(customer.id);
      if (!agent) continue;
      const x = interpX(agent, alpha);
      const y = interpY(agent, alpha);
      drawables.push({
        sortY: y,
        draw: () => drawCustomer(ctx, customer, agent, x, y, time, state),
      });
    }
    for (const waiter of world.waiters) {
      const x = interpX(waiter.agent, alpha);
      const y = interpY(waiter.agent, alpha);
      drawables.push({ sortY: y, draw: () => drawWaiter(ctx, waiter, x, y, time, state) });
    }
    if (world.cat) {
      const cat = world.cat;
      const x = interpX(cat.agent, alpha);
      const y = interpY(cat.agent, alpha);
      const layout = cat.tableId ? TABLE_BY_ID.get(cat.tableId) : null;
      const sortY = cat.mode === "napping" && layout ? layout.y + layout.h + 2 : y;
      drawables.push({ sortY, draw: () => drawCat(ctx, cat, x, y, time) });
    }
    if (world.dog) {
      const dog = world.dog;
      const x = interpX(dog.agent, alpha);
      const y = interpY(dog.agent, alpha);
      drawables.push({ sortY: y, draw: () => drawDog(ctx, dog, x, y) });
    }
    for (const bike of world.bikes) {
      const x = lerp(bike.px, bike.x, alpha);
      drawables.push({ sortY: bike.y + 30, draw: () => drawBike(ctx, bike, x) });
    }
    drawables.sort((a, b) => a.sortY - b.sortY);
    for (const d of drawables) d.draw();

    // --- bubbles above everything in the scene
    for (const customer of state.customers) {
      const agent = world.agents.get(customer.id);
      if (!agent) continue;
      if (customer.phase === "seated" || customer.phase === "ordered") {
        drawOrderBubble(ctx, customer, interpX(agent, alpha), interpY(agent, alpha), time);
      }
    }

    drawLighting(ctx, state, time);
    drawWeather(ctx, state, world, fx, time);
    drawFxOverlays(ctx, fx);

    if (mode === "paused") drawPauseCurtain(ctx);
  }

  return { render, resize };
}

// ---------------------------------------------------------------------------
// static background

function drawStaticBackground(ctx) {
  // wall
  const wall = ctx.createLinearGradient(0, 0, 0, WALL_Y);
  wall.addColorStop(0, "#f0d9a8");
  wall.addColorStop(1, "#e3bd83");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, BOARD.W, WALL_Y);

  // plaster patches
  ctx.fillStyle = "rgba(176, 134, 88, 0.18)";
  rr(ctx, 60, 18, 90, 30, 8);
  ctx.fill();
  rr(ctx, 700, 30, 120, 26, 8);
  ctx.fill();

  // shop window (right side of wall)
  ctx.fillStyle = "#6c4a2c";
  rr(ctx, 596, 16, 188, 84, 10);
  ctx.fill();
  const panes = ctx.createLinearGradient(604, 24, 604, 92);
  panes.addColorStop(0, "#b3905f");
  panes.addColorStop(1, "#84603c");
  ctx.fillStyle = panes;
  rr(ctx, 604, 24, 172, 68, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 238, 190, 0.45)";
  rr(ctx, 610, 30, 76, 56, 6);
  ctx.fill();
  rr(ctx, 694, 30, 76, 56, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(108, 74, 44, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(648, 30);
  ctx.lineTo(648, 86);
  ctx.moveTo(732, 30);
  ctx.lineTo(732, 86);
  ctx.stroke();
  // curtain hint
  ctx.fillStyle = "rgba(199, 91, 74, 0.5)";
  rr(ctx, 610, 30, 18, 56, 5);
  ctx.fill();

  // sign board
  ctx.fillStyle = "#7a3c20";
  rr(ctx, 250, 14, 320, 64, 14);
  ctx.fill();
  ctx.fillStyle = "#9c5530";
  rr(ctx, 258, 22, 304, 48, 10);
  ctx.fill();
  ctx.fillStyle = "#ffe9bd";
  ctx.font = '700 30px "Trebuchet MS", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("TRÀ ĐÁ VỈA HÈ", 410, 55);
  ctx.textAlign = "left";

  // menu board on wall near counter
  ctx.fillStyle = "#54391f";
  rr(ctx, 32, 22, 150, 78, 10);
  ctx.fill();
  ctx.fillStyle = "#2e2114";
  rr(ctx, 40, 30, 134, 62, 8);
  ctx.fill();
  ctx.fillStyle = "#f7e9c4";
  ctx.font = '700 14px "Trebuchet MS", sans-serif';
  ctx.fillText("THỰC ĐƠN", 64, 48);
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = "#e8d3a8";
  ctx.fillText("Thái · Chanh · Đào", 52, 66);
  ctx.fillText("Matcha · Dâu · Sữa", 52, 82);

  // sidewalk
  const walk = ctx.createLinearGradient(0, WALL_Y, 0, SIDEWALK_BOTTOM);
  walk.addColorStop(0, "#cdab7e");
  walk.addColorStop(1, "#b08a5e");
  ctx.fillStyle = walk;
  ctx.fillRect(0, WALL_Y, BOARD.W, SIDEWALK_BOTTOM - WALL_Y);

  // tile grid
  ctx.strokeStyle = "rgba(80, 52, 28, 0.16)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= BOARD.W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, WALL_Y);
    ctx.lineTo(x, SIDEWALK_BOTTOM);
    ctx.stroke();
  }
  for (let y = WALL_Y + 36; y < SIDEWALK_BOTTOM; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD.W, y);
    ctx.stroke();
  }
  // stains & cracks
  ctx.fillStyle = "rgba(86, 56, 30, 0.10)";
  ctx.beginPath();
  ctx.ellipse(530, 270, 46, 18, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(840, 200, 30, 12, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 44, 22, 0.25)";
  ctx.beginPath();
  ctx.moveTo(250, 414);
  ctx.lineTo(286, 402);
  ctx.lineTo(306, 408);
  ctx.stroke();

  // planters at the wall between window and sign
  drawPlanter(ctx, 218, 96);
  drawPlanter(ctx, 856, 96);

  // curb
  ctx.fillStyle = "#9b9484";
  ctx.fillRect(0, CURB_TOP, BOARD.W, STREET_TOP - CURB_TOP);
  ctx.fillStyle = "#c8bfae";
  ctx.fillRect(0, CURB_TOP, BOARD.W, 5);
  // red/white no-parking stripes
  for (let x = 0; x < BOARD.W; x += 64) {
    ctx.fillStyle = x % 128 === 0 ? "#c75b4a" : "#ece2d0";
    ctx.fillRect(x, CURB_TOP + 6, 64, 7);
  }

  // street
  const street = ctx.createLinearGradient(0, STREET_TOP, 0, BOARD.H);
  street.addColorStop(0, "#55565e");
  street.addColorStop(1, "#3c3d45");
  ctx.fillStyle = street;
  ctx.fillRect(0, STREET_TOP, BOARD.W, BOARD.H - STREET_TOP);

  // lane dashes
  ctx.fillStyle = "rgba(235, 226, 200, 0.5)";
  for (let x = 16; x < BOARD.W; x += 86) {
    rr(ctx, x, 506, 42, 6, 3);
    ctx.fill();
  }
  // zebra crossing at the left edge
  ctx.fillStyle = "rgba(230, 224, 206, 0.55)";
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(26 + i * 30, STREET_TOP + 6, 18, BOARD.H - STREET_TOP - 12);
  }
  // manhole
  ctx.fillStyle = "#2f3037";
  ctx.beginPath();
  ctx.ellipse(700, 524, 22, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(200,200,200,0.25)";
  ctx.beginPath();
  ctx.ellipse(700, 524, 16, 6, 0, 0, Math.PI * 2);
  ctx.stroke();

  // counter cart (static body; cups/barista drawn live)
  drawCounterBody(ctx);

  // power pole, right edge — very Vietnamese
  ctx.fillStyle = "#4a3b30";
  ctx.fillRect(924, 6, 12, 434);
  ctx.strokeStyle = "rgba(40, 30, 22, 0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(930, 40);
  ctx.quadraticCurveTo(700, 76, 420, 60);
  ctx.moveTo(930, 56);
  ctx.quadraticCurveTo(660, 96, 300, 78);
  ctx.stroke();
}

function drawPlanter(ctx, x, y) {
  ctx.fillStyle = "#8d5d34";
  rr(ctx, x - 24, y - 4, 48, 26, 7);
  ctx.fill();
  ctx.fillStyle = "#6fa35e";
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.ellipse(x - 14 + i * 7, y - 12 - (i % 2) * 7, 9, 14, i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCounterBody(ctx) {
  // shadow
  ctx.fillStyle = "rgba(40, 22, 10, 0.22)";
  ctx.beginPath();
  ctx.ellipse(COUNTER.x + COUNTER.w / 2, COUNTER.y + COUNTER.h + 6, COUNTER.w / 2 + 8, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // cart body
  ctx.fillStyle = "#74452a";
  rr(ctx, COUNTER.x, COUNTER.y + 38, COUNTER.w, COUNTER.h - 38, 12);
  ctx.fill();
  ctx.fillStyle = "#8d5733";
  rr(ctx, COUNTER.x + 8, COUNTER.y + 46, COUNTER.w - 16, 46, 8);
  ctx.fill();

  // glass display front
  ctx.fillStyle = "rgba(235, 246, 255, 0.20)";
  rr(ctx, COUNTER.x + 12, COUNTER.y + 96, COUNTER.w - 24, 48, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(COUNTER.x + 18, COUNTER.y + 100);
  ctx.lineTo(COUNTER.x + 52, COUNTER.y + 138);
  ctx.stroke();

  // counter top
  ctx.fillStyle = "#a9744a";
  rr(ctx, COUNTER.x - 4, COUNTER.y + 26, COUNTER.w + 8, 18, 8);
  ctx.fill();

  // big kettle
  ctx.fillStyle = "#c8cdd4";
  ctx.beginPath();
  ctx.ellipse(COUNTER.x + 38, COUNTER.y + 18, 17, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#9aa0a8";
  rr(ctx, COUNTER.x + 30, COUNTER.y - 2, 16, 8, 3);
  ctx.fill();
  ctx.strokeStyle = "#9aa0a8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(COUNTER.x + 53, COUNTER.y + 14);
  ctx.quadraticCurveTo(COUNTER.x + 66, COUNTER.y + 10, COUNTER.x + 62, COUNTER.y + 24);
  ctx.stroke();

  // ice box
  ctx.fillStyle = "#7ba6b8";
  rr(ctx, COUNTER.x + 116, COUNTER.y + 4, 54, 28, 6);
  ctx.fill();
  ctx.fillStyle = "#a6cbd8";
  rr(ctx, COUNTER.x + 120, COUNTER.y + 8, 46, 8, 4);
  ctx.fill();

  // wheels
  ctx.fillStyle = "#3c2a1c";
  ctx.beginPath();
  ctx.arc(COUNTER.x + 30, COUNTER.y + COUNTER.h + 2, 10, 0, Math.PI * 2);
  ctx.arc(COUNTER.x + COUNTER.w - 30, COUNTER.y + COUNTER.h + 2, 10, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// dynamic scene pieces

function drawGroundWetness(ctx, rainLevel) {
  if (rainLevel <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = rainLevel * 0.25;
  ctx.fillStyle = "#2c3a52";
  ctx.fillRect(0, WALL_Y, BOARD.W, BOARD.H - WALL_Y);
  // puddle shines
  ctx.globalAlpha = rainLevel * 0.35;
  ctx.fillStyle = "#9db8d8";
  ctx.beginPath();
  ctx.ellipse(380, 430, 60, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(640, 478, 84, 9, 0, 0, Math.PI * 2);
  ctx.ellipse(150, 500, 60, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAwning(ctx, wind, time) {
  const scallops = 14;
  const width = BOARD.W - 24;
  const left = 12;
  const top = 0;
  const depth = 30;
  ctx.save();
  ctx.fillStyle = "#c75b4a";
  ctx.fillRect(left, top, width, 12);
  for (let i = 0; i < scallops; i += 1) {
    const w = width / scallops;
    const x = left + i * w;
    const sway = Math.sin(time * 2.2 + i * 0.8) * wind * 4;
    ctx.fillStyle = i % 2 === 0 ? "#d96f55" : "#f2e3c2";
    ctx.beginPath();
    ctx.moveTo(x, top + 10);
    ctx.lineTo(x + w, top + 10);
    ctx.quadraticCurveTo(x + w / 2 + sway, top + depth + sway * 0.6, x, top + 10);
    ctx.fill();
  }
  ctx.restore();
}

function drawStringLights(ctx, wind, time, lampLevel) {
  ctx.save();
  ctx.strokeStyle = "rgba(70, 44, 24, 0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(40, 84);
  ctx.quadraticCurveTo(300, 116, 520, 92);
  ctx.quadraticCurveTo(740, 70, 920, 96);
  ctx.stroke();

  for (let i = 0; i < 12; i += 1) {
    const t = i / 11;
    const x = 40 + t * 880;
    const curve = Math.sin(t * Math.PI) * 24;
    const sway = Math.sin(time * 2.4 + i) * wind * 5;
    const y = 86 + curve * 0.4 + Math.abs(Math.sin(i * 1.7)) * 6;
    ctx.strokeStyle = "rgba(70, 44, 24, 0.5)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sway, y + 9);
    ctx.stroke();
    const bulbColor = i % 2 === 0 ? "#ffd978" : "#ffb46e";
    if (lampLevel > 0.05) {
      ctx.fillStyle = `rgba(255, 214, 130, ${0.16 * lampLevel})`;
      ctx.beginPath();
      ctx.arc(x + sway, y + 13, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = bulbColor;
    ctx.beginPath();
    ctx.ellipse(x + sway, y + 13, 4, 5.5, sway * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCounterDynamic(ctx, state, world, time) {
  // barista behind the counter
  const bob = Math.sin(time * 3.2) * 1.4;
  const brewing = state.orders.find((o) => o.status === "brewing");
  drawPersonFigure(ctx, {
    x: COUNTER.x + 86,
    y: COUNTER.y + 34 + bob * 0.4,
    facing: 1,
    stride: 0,
    moving: false,
    seated: false,
    pose: brewing ? "brew" : "stand",
    style: { skin: "#eac39e", hair: "#27201b", top: "#e8e2d2", bottom: "#5a4634", accent: "#bb4f3e", hairStyle: "short", silhouette: "broad" },
    scale: 0.92,
    time,
  });

  // brewing progress + cup
  if (brewing) {
    const drink = DRINK_BY_ID.get(brewing.drinkId);
    const bx = COUNTER.x + 86;
    const by = COUNTER.y - 6;
    ctx.save();
    ctx.fillStyle = "rgba(38, 22, 12, 0.78)";
    rr(ctx, bx - 34, by - 14, 68, 12, 6);
    ctx.fill();
    ctx.fillStyle = drink ? drink.liquid : "#d67e3d";
    rr(ctx, bx - 31, by - 11, 62 * clamp(brewing.progress, 0, 1), 6, 3);
    ctx.fill();
    ctx.restore();
    if (Math.sin(time * 9) > 0.4) {
      // bubbling cup
      drawDrinkGlass(ctx, drink, COUNTER.x + 120, COUNTER.y + 26, 0.8);
    }
  }

  // ready shelf
  const ready = state.orders.filter((o) => o.status === "ready");
  for (let i = 0; i < ready.length; i += 1) {
    const drink = DRINK_BY_ID.get(ready[i].drinkId);
    drawDrinkGlass(ctx, drink, SHELF.x - i * 20, SHELF.y + 18, 0.78);
  }
  if (ready.length > 0) {
    ctx.fillStyle = "rgba(255, 244, 214, 0.9)";
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    ctx.fillText(`${ready.length} ly chờ bưng`, COUNTER.x + 96, COUNTER.y + 64);
  }
}

function drawTable(ctx, layout, table, state, time) {
  ctx.save();
  // shadow
  ctx.fillStyle = "rgba(39, 20, 11, 0.20)";
  ctx.beginPath();
  ctx.ellipse(layout.cx, layout.y + layout.h - 6, layout.w / 2 + 6, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.fillStyle = "#5e3922";
  rr(ctx, layout.x + 14, layout.y + 40, 10, layout.h - 36, 4);
  ctx.fill();
  rr(ctx, layout.x + layout.w - 24, layout.y + 40, 10, layout.h - 36, 4);
  ctx.fill();

  // top
  ctx.fillStyle = "#8d5b37";
  rr(ctx, layout.x, layout.y, layout.w, 54, 16);
  ctx.fill();
  ctx.fillStyle = "#aa744a";
  rr(ctx, layout.x + 6, layout.y + 6, layout.w - 12, 42, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(80, 46, 22, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.x + 14, layout.y + 18);
  ctx.lineTo(layout.x + layout.w - 14, layout.y + 16);
  ctx.moveTo(layout.x + 12, layout.y + 32);
  ctx.lineTo(layout.x + layout.w - 12, layout.y + 30);
  ctx.stroke();

  // stool (in front)
  ctx.fillStyle = "#4f7da3";
  rr(ctx, layout.seatX - 13, layout.seatY - 4, 26, 10, 5);
  ctx.fill();
  ctx.fillStyle = "#3c618047";
  rr(ctx, layout.seatX - 9, layout.seatY + 4, 18, 6, 3);
  ctx.fill();

  // status décor
  if (table) {
    if (table.status === "seated" && table.customerId !== null) {
      const customer = state.customers.find((c) => c.id === table.customerId);
      if (customer) {
        if (customer.phase === "served") {
          const drink = DRINK_BY_ID.get(customer.drinkId);
          drawDrinkGlass(ctx, drink, layout.cx + 24, layout.y + 30, 0.9);
        } else if (customer.phase === "ordered") {
          // order chit on the table
          ctx.fillStyle = "rgba(255, 248, 226, 0.95)";
          rr(ctx, layout.cx + 12, layout.y + 14, 28, 18, 4);
          ctx.fill();
          ctx.fillStyle = "#6b4423";
          ctx.font = '700 10px "Trebuchet MS", sans-serif';
          ctx.fillText("ghi", layout.cx + 18, layout.y + 26);
        }
      }
    }
    if (table.status === "reserved") {
      ctx.fillStyle = "rgba(255, 235, 190, 0.65)";
      ctx.font = '700 11px "Trebuchet MS", sans-serif';
      ctx.fillText("đặt", layout.x + 8, layout.y + 18);
    }
  }

  ctx.fillStyle = "rgba(46, 26, 12, 0.55)";
  ctx.font = '700 12px "Trebuchet MS", sans-serif';
  ctx.fillText(`B${layout.index + 1}`, layout.x + 8, layout.y + 49);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// characters

function drawPersonFigure(ctx, opts) {
  const {
    x, y, facing, stride, moving, seated, pose, style, scale, time,
    drink = null, patience = null, tray = null,
  } = opts;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * (facing < 0 ? -1 : 1), scale);

  const swing = moving ? Math.sin(stride) * 0.5 : 0;
  const counterSwing = moving ? -Math.sin(stride) * 0.5 : 0;
  const torsoW = style.silhouette === "broad" ? 25 : style.silhouette === "compact" ? 20 : 22;
  const torsoH = style.silhouette === "compact" ? 22 : 24;
  const legTop = seated ? -22 : -32;
  const legLen = seated ? 20 : 32;
  const shoulderY = legTop - torsoH + 5;
  const headY = shoulderY - 16;

  // legs
  drawLimb(ctx, -6, legTop, 8, legLen, seated ? -0.5 : counterSwing, style.bottom);
  drawLimb(ctx, 6, legTop, 8, legLen, seated ? 0.5 : swing, style.bottom);
  // shoes
  ctx.fillStyle = "#f7f0e6";
  ctx.beginPath();
  ctx.ellipse(-7 + (seated ? -8 : counterSwing * 10), seated ? -4 : 0, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(7 + (seated ? 8 : swing * 10), seated ? -4 : 0, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // arms
  let backArm = -0.3 - swing * 0.7;
  let frontArm = 0.3 + swing * 0.7;
  if (pose === "drink") {
    frontArm = -1.1;
  } else if (pose === "call") {
    frontArm = -2.4 + Math.sin(time * 6) * 0.18;
  } else if (pose === "brew") {
    backArm = -0.9 + Math.sin(time * 7) * 0.2;
    frontArm = -0.7 - Math.sin(time * 7) * 0.2;
  } else if (pose === "carry") {
    backArm = -1.5;
    frontArm = -1.5;
  } else if (pose === "angry") {
    frontArm = 0.9 + Math.sin(time * 10) * 0.25;
  }
  drawLimb(ctx, -torsoW / 2 - 3, shoulderY, 7, 19, backArm, style.skin);

  // torso
  ctx.fillStyle = style.top;
  rr(ctx, -torsoW / 2, legTop - torsoH, torsoW, torsoH, 9);
  ctx.fill();
  ctx.fillStyle = style.accent;
  rr(ctx, -torsoW / 2 + 4, legTop - torsoH + 4, torsoW - 8, 6, 3);
  ctx.fill();
  if (pose === "carry" || pose === "brew") {
    // apron
    ctx.fillStyle = "#54402e";
    rr(ctx, -torsoW / 2 + 3, legTop - torsoH + 10, torsoW - 6, torsoH - 6, 6);
    ctx.fill();
  }

  drawLimb(ctx, torsoW / 2 + 3, shoulderY, 7, 19, frontArm, style.skin);

  // tray with cups
  if (tray && tray.length > 0) {
    ctx.fillStyle = "#7c4a26";
    rr(ctx, 8, shoulderY - 14, 34, 5, 2);
    ctx.fill();
    for (let i = 0; i < tray.length; i += 1) {
      drawDrinkGlass(ctx, tray[i], 16 + i * 12, shoulderY - 15, 0.5);
    }
  }
  if (pose === "drink" && drink) {
    drawDrinkGlass(ctx, drink, 15, headY + 10, 0.72);
  }

  // head
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, 12, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  drawHair(ctx, style, headY);
  drawFace(ctx, pose, headY, time);

  ctx.restore();

  // patience ring (drawn unscaled above the head)
  if (patience !== null) {
    const ratio = clamp(patience, 0, 1);
    const ringY = y + (headY - 20) * scale;
    ctx.save();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = "rgba(46, 26, 12, 0.35)";
    ctx.beginPath();
    ctx.arc(x, ringY, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ratio > 0.55 ? "#69c77c" : ratio > 0.28 ? "#e8b94f" : "#e06c55";
    ctx.beginPath();
    ctx.arc(x, ringY, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLimb(ctx, x, y, width, length, rotation, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  rr(ctx, -width / 2, 0, width, length, width / 2);
  ctx.fill();
  ctx.restore();
}

function drawHair(ctx, style, headY) {
  ctx.save();
  ctx.fillStyle = style.hair;
  switch (style.hairStyle) {
    case "long":
      rr(ctx, -13, headY - 13, 26, 18, 8);
      ctx.fill();
      rr(ctx, -13, headY - 4, 8, 16, 4);
      ctx.fill();
      rr(ctx, 5, headY - 4, 8, 16, 4);
      ctx.fill();
      break;
    case "bun":
      rr(ctx, -13, headY - 13, 26, 14, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, headY - 15, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "cap":
      rr(ctx, -13, headY - 13, 26, 12, 8);
      ctx.fill();
      rr(ctx, 2, headY - 6, 12, 4, 2);
      ctx.fill();
      break;
    case "puff":
      ctx.beginPath();
      ctx.arc(-9, headY - 8, 5, 0, Math.PI * 2);
      ctx.arc(9, headY - 8, 5, 0, Math.PI * 2);
      ctx.fill();
      rr(ctx, -11, headY - 11, 22, 12, 7);
      ctx.fill();
      break;
    case "hat_la": {
      // nón lá
      ctx.fillStyle = "#d9b873";
      ctx.beginPath();
      ctx.moveTo(-17, headY - 6);
      ctx.lineTo(0, headY - 22);
      ctx.lineTo(17, headY - 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(120, 90, 40, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-11, headY - 12);
      ctx.lineTo(11, headY - 12);
      ctx.stroke();
      break;
    }
    case "thin":
      rr(ctx, -11, headY - 12, 22, 8, 5);
      ctx.fill();
      break;
    default:
      rr(ctx, -12, headY - 13, 24, 12, 8);
      ctx.fill();
  }
  ctx.restore();
}

function drawFace(ctx, pose, headY, time) {
  ctx.save();
  ctx.fillStyle = "#5b341f";
  ctx.beginPath();
  ctx.arc(-4, headY - 1, 1.4, 0, Math.PI * 2);
  ctx.arc(4, headY - 1, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#6e3f25";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (pose === "drink") {
    ctx.arc(0, headY + 5, 4, 0.1, Math.PI - 0.1);
  } else if (pose === "angry") {
    ctx.arc(0, headY + 8, 3.5, Math.PI + 0.3, -0.3);
  } else if (pose === "call") {
    ctx.ellipse(0, headY + 6, 2.4, 3.2, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(0, headY + 4, 3.5, 0.25, Math.PI - 0.25);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShadow(ctx, x, y, w) {
  ctx.save();
  ctx.fillStyle = "rgba(30, 18, 10, 0.24)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, w, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCustomer(ctx, customer, agent, x, y, time, state) {
  const style = CUSTOMER_TYPE_BY_ID.get(customer.type);
  const drink = DRINK_BY_ID.get(customer.drinkId);
  if (!style) return;
  const seated = ["seated", "ordered", "served"].includes(customer.phase);
  let pose = "walk";
  if (customer.phase === "served") pose = "drink";
  else if (customer.phase === "seated") pose = "call";
  else if (customer.phase === "leaving_angry") pose = "angry";
  else if (customer.phase === "ordered") pose = "sit";

  drawShadow(ctx, x, y, agent.moving ? 16 : 14);
  drawPersonFigure(ctx, {
    x,
    y,
    facing: agent.facing,
    stride: agent.stride,
    moving: agent.moving,
    seated,
    pose,
    style,
    scale: style.scale,
    time,
    drink,
    patience:
      customer.phase === "seated" || customer.phase === "ordered"
        ? customer.patience / customer.patienceMax
        : null,
  });

  // grumpy cloud for angry leavers
  if (customer.phase === "leaving_angry" && Math.sin(time * 8 + customer.id) > 0) {
    ctx.save();
    ctx.fillStyle = "rgba(120, 60, 50, 0.6)";
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    ctx.fillText("!", x + 12, y - 58);
    ctx.restore();
  }
}

function drawWaiter(ctx, waiter, x, y, time, state) {
  const carrying = waiter.carrying
    .map((orderId) => state.orders.find((o) => o.id === orderId))
    .filter(Boolean)
    .map((o) => DRINK_BY_ID.get(o.drinkId));
  drawShadow(ctx, x, y, 15);
  drawPersonFigure(ctx, {
    x,
    y,
    facing: waiter.agent.facing,
    stride: waiter.agent.stride,
    moving: waiter.agent.moving,
    seated: false,
    pose: carrying.length > 0 ? "carry" : "walk",
    style: { skin: "#ecc8a4", hair: "#1f1813", top: "#f4ede0", bottom: "#3f3329", accent: "#cf5b44", hairStyle: "cap", silhouette: "soft" },
    scale: 0.96,
    time,
    tray: carrying.length > 0 ? carrying : null,
  });
}

function drawCat(ctx, cat, x, y, time) {
  ctx.save();
  if (cat.mode === "napping") {
    // curled up
    drawShadow(ctx, x, y + 6, 14);
    ctx.translate(x, y);
    ctx.fillStyle = "#d7c3a3";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c4ad8a";
    ctx.beginPath();
    ctx.ellipse(8, -3, 7, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.fillStyle = "#d7c3a3";
    ctx.beginPath();
    ctx.moveTo(4, -8);
    ctx.lineTo(7, -13);
    ctx.lineTo(10, -8);
    ctx.closePath();
    ctx.fill();
    // tail wrap
    ctx.strokeStyle = "#b59f80";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(-2, 4, 12, 0.3, Math.PI - 0.2);
    ctx.stroke();
    // zzz
    ctx.fillStyle = "rgba(255, 250, 230, 0.85)";
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    const phase = (time % 1.6) / 1.6;
    ctx.globalAlpha = 0.4 + 0.6 * Math.sin(phase * Math.PI);
    ctx.fillText("z", 14, -14 - phase * 8);
    ctx.fillText("Z", 20, -22 - phase * 6);
  } else {
    drawShadow(ctx, x, y + 2, 13);
    ctx.translate(x, y);
    if (cat.agent.facing < 0) ctx.scale(-1, 1);
    const legPhase = cat.agent.moving ? Math.sin(cat.agent.stride * 2) * 3 : 0;
    ctx.fillStyle = "#b59f80";
    rr(ctx, -12 + legPhase, -12, 5, 12, 2);
    ctx.fill();
    rr(ctx, -2 - legPhase, -12, 5, 12, 2);
    ctx.fill();
    rr(ctx, 6 + legPhase, -12, 5, 12, 2);
    ctx.fill();
    ctx.fillStyle = "#d7c3a3";
    rr(ctx, -16, -22, 30, 14, 7);
    ctx.fill();
    rr(ctx, 9, -30, 14, 12, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11, -30);
    ctx.lineTo(14, -36);
    ctx.lineTo(17, -29);
    ctx.closePath();
    ctx.moveTo(18, -30);
    ctx.lineTo(21, -36);
    ctx.lineTo(24, -29);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#b59f80";
    ctx.lineWidth = 4;
    ctx.beginPath();
    const tailWave = Math.sin(time * 4) * 4;
    ctx.moveTo(-15, -16);
    ctx.quadraticCurveTo(-26 + tailWave, -32, -12, -36 + tailWave);
    ctx.stroke();
    ctx.fillStyle = "#1f140e";
    ctx.beginPath();
    ctx.arc(19, -25, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDog(ctx, dog, x, y) {
  ctx.save();
  drawShadow(ctx, x, y + 2, 17);
  ctx.translate(x, y);
  if (dog.agent.facing < 0) ctx.scale(-1, 1);
  const legPhase = dog.agent.moving ? Math.sin(dog.agent.stride * 2) * 4 : 0;
  ctx.fillStyle = "#5f3b25";
  rr(ctx, -18 + legPhase, -14, 6, 14, 3);
  ctx.fill();
  rr(ctx, -6 - legPhase, -14, 6, 14, 3);
  ctx.fill();
  rr(ctx, 6 + legPhase, -14, 6, 14, 3);
  ctx.fill();
  rr(ctx, 15 - legPhase, -14, 6, 14, 3);
  ctx.fill();
  ctx.fillStyle = "#7e5737";
  rr(ctx, -20, -26, 40, 16, 8);
  ctx.fill();
  rr(ctx, 12, -36, 17, 14, 7);
  ctx.fill();
  // ear + tail
  ctx.beginPath();
  ctx.moveTo(14, -36);
  ctx.lineTo(10, -44);
  ctx.lineTo(20, -38);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-20, -24);
  ctx.lineTo(-30, -32);
  ctx.lineTo(-24, -16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d44d44";
  rr(ctx, 16, -24, 9, 4, 2);
  ctx.fill();
  ctx.fillStyle = "#20130d";
  ctx.beginPath();
  ctx.arc(24, -31, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBike(ctx, bike, x) {
  ctx.save();
  ctx.translate(x, bike.y);
  if (bike.dir < 0) ctx.scale(-1, 1);
  // shadow
  ctx.fillStyle = "rgba(10, 10, 14, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 30, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // wheels
  ctx.fillStyle = "#23242a";
  ctx.beginPath();
  ctx.arc(-18, 6, 9, 0, Math.PI * 2);
  ctx.arc(20, 6, 9, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = bike.hue;
  rr(ctx, -22, -6, 38, 10, 5);
  ctx.fill();
  rr(ctx, 12, -14, 12, 10, 4);
  ctx.fill();
  // rider
  ctx.fillStyle = "#3e3344";
  rr(ctx, -12, -26, 16, 18, 7);
  ctx.fill();
  ctx.fillStyle = "#e7c39a";
  ctx.beginPath();
  ctx.arc(-4, -32, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cf5b44";
  ctx.beginPath();
  ctx.arc(-4, -35, 7, Math.PI, 0);
  ctx.fill();
  // headlight smear
  ctx.fillStyle = "rgba(255, 240, 190, 0.25)";
  ctx.beginPath();
  ctx.moveTo(26, -4);
  ctx.lineTo(52, -1);
  ctx.lineTo(52, 7);
  ctx.lineTo(26, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawOrderBubble(ctx, customer, x, y, time) {
  const drink = DRINK_BY_ID.get(customer.drinkId);
  if (!drink) return;
  const top = y - 96;
  ctx.save();
  if (customer.phase === "ordered") {
    // compact "waiting" bubble
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(255, 248, 230, 0.94)";
    rr(ctx, x - 24, top + 14, 48, 26, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 6, top + 40);
    ctx.lineTo(x, top + 48);
    ctx.lineTo(x + 6, top + 40);
    ctx.closePath();
    ctx.fill();
    drawDrinkGlass(ctx, drink, x - 8, top + 36, 0.52);
    const dots = Math.floor((time * 2) % 3) + 1;
    ctx.fillStyle = "#8d6040";
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillText(".".repeat(dots), x + 4, top + 32);
    ctx.restore();
    return;
  }

  const lines = splitText(customer.orderText, 17);
  ctx.fillStyle = "rgba(255, 248, 230, 0.96)";
  rr(ctx, x - 64, top, 128, 44, 14);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 8, top + 44);
  ctx.lineTo(x, top + 54);
  ctx.lineTo(x + 8, top + 44);
  ctx.closePath();
  ctx.fill();
  drawDrinkGlass(ctx, drink, x - 46, top + 34, 0.6);
  ctx.fillStyle = "#5f351c";
  ctx.font = '700 10px "Trebuchet MS", sans-serif';
  ctx.fillText(drink.shortVi, x - 56, top + 12);
  ctx.font = '600 9px "Trebuchet MS", sans-serif';
  if (lines[0]) ctx.fillText(lines[0], x - 28, top + 18);
  if (lines[1]) ctx.fillText(lines[1], x - 28, top + 30);
  ctx.fillStyle = "#8d6040";
  ctx.font = '600 8px "Trebuchet MS", sans-serif';
  ctx.fillText("chạm bàn để ghi món", x - 28, top + 40);
  ctx.restore();
}

function drawDrinkGlass(ctx, drink, x, y, scale = 1) {
  if (!drink) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(30, 16, 8, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = drink.cup;
  rr(ctx, -8, -22, 16, 22, 5);
  ctx.fill();
  ctx.fillStyle = drink.liquid;
  rr(ctx, -6, -17, 12, 15, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
  for (let i = 0; i < 3; i += 1) {
    rr(ctx, -5 + i * 4, -16 + (i % 2), 3, 3, 1);
    ctx.fill();
  }
  ctx.strokeStyle = drink.straw;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(3, -24);
  ctx.lineTo(7, -34);
  ctx.stroke();
  ctx.fillStyle = drink.garnish;
  ctx.beginPath();
  ctx.ellipse(-6, -23, 4, 2, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// lighting & weather

export function ambientFor(state) {
  const t = clamp(state.dayTime / DAY.LENGTH, 0, 1);
  // keyframes: [t, r, g, b, alpha, lamp]
  const keys = [
    [0.0, 255, 178, 120, 0.10, 0.0],
    [0.18, 255, 220, 170, 0.03, 0.0],
    [0.38, 255, 255, 235, 0.0, 0.0],
    [0.56, 255, 168, 92, 0.10, 0.15],
    [0.7, 224, 110, 70, 0.18, 0.5],
    [0.82, 44, 52, 96, 0.30, 1.0],
    [1.0, 30, 38, 80, 0.34, 1.0],
  ];
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (t >= keys[i][0] && t <= keys[i + 1][0]) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b[0] - a[0]);
  const k = smoothstep(0, 1, (t - a[0]) / span);
  const cloud = state.weather.state !== "clear" ? 1 : 0;
  return {
    r: lerp(a[1], b[1], k),
    g: lerp(a[2], b[2], k),
    b: lerp(a[3], b[3], k),
    alpha: lerp(a[4], b[4], k) + cloud * 0.06 + state.weather.rainLevel * 0.08,
    lamp: lerp(a[5], b[5], k),
  };
}

function drawLighting(ctx, state, time) {
  const amb = ambientFor(state);
  if (amb.alpha > 0.005) {
    ctx.save();
    ctx.fillStyle = `rgba(${amb.r | 0}, ${amb.g | 0}, ${amb.b | 0}, ${amb.alpha})`;
    ctx.fillRect(0, 0, BOARD.W, BOARD.H);
    ctx.restore();
  }
  if (amb.lamp > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    // window glow
    ctx.fillStyle = `rgba(255, 214, 140, ${0.18 * amb.lamp})`;
    rr(ctx, 604, 24, 172, 68, 8);
    ctx.fill();
    // neon sign flicker
    const flicker = 0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 3.1);
    ctx.strokeStyle = `rgba(120, 235, 220, ${0.65 * amb.lamp * flicker})`;
    ctx.lineWidth = 2.4;
    rr(ctx, 256, 20, 308, 52, 12);
    ctx.stroke();
    // counter lamp pool
    const pool = ctx.createRadialGradient(COUNTER.x + 96, COUNTER.y + 60, 8, COUNTER.x + 96, COUNTER.y + 60, 150);
    pool.addColorStop(0, `rgba(255, 206, 120, ${0.20 * amb.lamp})`);
    pool.addColorStop(1, "rgba(255, 206, 120, 0)");
    ctx.fillStyle = pool;
    ctx.fillRect(COUNTER.x - 80, COUNTER.y - 60, 360, 280);
    ctx.restore();
  }
}

function drawWeather(ctx, state, world, fx, time) {
  const rainLevel = state.weather.rainLevel;

  // wind streaks
  if (world.wind > 0.5) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 245, 211, ${0.18 * world.wind})`;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 10; i += 1) {
      const ox = ((time * 340 * world.wind) + i * 113) % (BOARD.W + 200) - 100;
      const oy = 90 + ((i * 47) % 340);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.bezierCurveTo(ox + 26, oy - 7, ox + 56, oy + 7, ox + 84, oy - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // leaves
  for (const leaf of fx.leaves) {
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.rot);
    ctx.fillStyle = leaf.hue;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // rain
  if (rainLevel > 0.01 && fx.rain.length > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(222, 240, 255, ${0.5 * rainLevel})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const drop of fx.rain) {
      const k = drop.len / Math.max(1, Math.hypot(drop.vx, drop.vy));
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - drop.vx * k, drop.y - drop.vy * k);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const splash of fx.splashes) {
    const k = splash.age / splash.life;
    ctx.save();
    ctx.strokeStyle = `rgba(222, 240, 255, ${0.4 * (1 - k)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(splash.x, splash.y, 3 + k * 9, 1.2 + k * 2.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawFxOverlays(ctx, fx) {
  for (const steam of fx.steams) {
    const k = steam.age / steam.life;
    ctx.save();
    ctx.globalAlpha = 0.34 * (1 - k);
    ctx.fillStyle = "#fdfaf2";
    ctx.beginPath();
    ctx.arc(steam.x, steam.y, 3 + k * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const puff of fx.puffs) {
    const k = puff.age / puff.life;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.strokeStyle = puff.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, 4 + k * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const item of fx.floats) {
    const k = item.age / item.life;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = item.color;
    ctx.textAlign = "center";
    ctx.font = '700 17px "Trebuchet MS", sans-serif';
    ctx.fillText(item.text, item.x, item.y - k * 30);
    ctx.restore();
  }
  ctx.textAlign = "left";
}

function drawPauseCurtain(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(23, 12, 8, 0.55)";
  ctx.fillRect(0, 0, BOARD.W, BOARD.H);
  ctx.fillStyle = "#fff7ea";
  ctx.textAlign = "center";
  ctx.font = '700 34px "Trebuchet MS", sans-serif';
  ctx.fillText("Tạm dừng", BOARD.W / 2, BOARD.H / 2);
  ctx.font = '600 17px "Trebuchet MS", sans-serif';
  ctx.fillText("Nhấn “Bán tiếp” để mở quán lại.", BOARD.W / 2, BOARD.H / 2 + 32);
  ctx.textAlign = "left";
  ctx.restore();
}

// rounded-rect helper (with fallback for older engines)
function rr(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
