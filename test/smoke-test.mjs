// End-to-end smoke test: boots the real game in Chromium and verifies the
// serve pipeline, physics invariants, events, persistence, and console health.
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const READY = /Sidewalk Iced Tea V2 available at (http:\/\/[^\s]+)/;

let server;
try {
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await waitForServer(server);
  const summary = await runSmoke(url);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (server && !server.killed) server.kill();
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("server start timeout")), 12000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(READY);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
}

async function runSmoke(url) {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("#title-overlay", { state: "visible" });

    if ((await page.evaluate(() => document.documentElement.lang)) !== "vi") {
      throw new Error("document language must be vi");
    }

    // start playing
    await page.click("#start-button");
    await page.waitForFunction(() => window.__game.getSnapshot().mode === "playing");

    // customers arrive and sit
    await page.waitForFunction(
      () => window.__game.getSnapshot().customers.some((c) => c.phase === "seated"),
      null,
      { timeout: 20000 },
    );

    // physics: sample walking guests for 6s — never inside furniture
    const clipReport = await page.evaluate(async () => {
      const samples = [];
      const layout = await import("./src/layout.js");
      for (let i = 0; i < 60; i += 1) {
        const snap = window.__game.getSnapshot();
        for (const c of snap.customers) {
          if (["entering", "leaving", "leaving_angry"].includes(c.phase) && c.x > 4 && c.x < 956) {
            if (layout.pointBlocked(c.x, c.y, 1)) {
              samples.push({ id: c.id, phase: c.phase, x: c.x, y: c.y });
            }
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return samples;
    });
    if (clipReport.length > 0) {
      throw new Error(`walking guests clipped furniture: ${JSON.stringify(clipReport.slice(0, 3))}`);
    }

    // serve flow via a real canvas click on a seated table
    const target = await page.evaluate(() => {
      const snap = window.__game.getSnapshot();
      const table = snap.tables.find((t) => t.status === "seated");
      if (!table) return null;
      const m = table.id.match(/table-(\d)-(\d)/);
      return { x: 286 + 160 * Number(m[2]) + 56, y: 152 + 144 * Number(m[1]) + 40 };
    });
    if (!target) throw new Error("no seated table to click");
    const box = await page.locator("#game-canvas").boundingBox();
    await page.mouse.click(box.x + (target.x / 960) * box.width, box.y + (target.y / 540) * box.height);

    await page.waitForFunction(
      () => window.__game.getSnapshot().orders.length > 0,
      null,
      { timeout: 4000 },
    );
    await page.waitForFunction(
      () => window.__game.getSnapshot().totalServed > 0,
      null,
      { timeout: 25000 },
    );

    // weather + events
    await page.evaluate(() => {
      window.__game.debug.startRain();
      window.__game.debug.startWind();
      window.__game.debug.spawnCat();
      window.__game.debug.spawnDog();
    });
    await page.waitForFunction(
      () => {
        const s = window.__game.getSnapshot();
        return s.weather.state === "rain" && s.wind >= 0;
      },
      null,
      { timeout: 6000 },
    );
    await page.waitForFunction(() => window.__game.getSnapshot().cat?.mode === "napping", null, {
      timeout: 30000,
    });

    // shoo the cat with a real click
    const catTable = await page.evaluate(() => {
      const s = window.__game.getSnapshot();
      const m = s.cat.tableId.match(/table-(\d)-(\d)/);
      return { x: 286 + 160 * Number(m[2]) + 56, y: 152 + 144 * Number(m[1]) + 40 };
    });
    await page.mouse.click(
      box.x + (catTable.x / 960) * box.width,
      box.y + (catTable.y / 540) * box.height,
    );
    await page.waitForFunction(
      () => !window.__game.getSnapshot().cat || window.__game.getSnapshot().cat.mode === "fleeing",
      null,
      { timeout: 4000 },
    );

    // day summary
    await page.evaluate(() => {
      window.__game.debug.setDayTime(149);
      window.__game.debug.fastForward(40);
    });
    await page.waitForFunction(() => window.__game.getSnapshot().mode === "summary", null, {
      timeout: 30000,
    });
    const summaryShot = await page.evaluate(() => window.__game.getSnapshot().daySummary);

    // next day via overlay button
    await page.click("#start-button");
    await page.waitForFunction(
      () => window.__game.getSnapshot().mode === "playing" && window.__game.getSnapshot().day === 2,
    );

    // upgrade purchase
    await page.evaluate(() => window.__game.debug.grantCoins(200));
    await page.click("#upgrade-brew");
    const brewLevel = await page.evaluate(() => window.__game.getSnapshot().upgrades.brew);
    if (brewLevel !== 1) throw new Error(`brew upgrade did not apply (level=${brewLevel})`);

    // persistence across reload
    const before = await page.evaluate(() => {
      const s = window.__game.getSnapshot();
      return { coins: s.coins, day: s.day, served: s.totalServed, brew: s.upgrades.brew };
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#title-overlay", { state: "visible" });
    const after = await page.evaluate(() => {
      const s = window.__game.getSnapshot();
      return { coins: s.coins, day: s.day, served: s.totalServed, brew: s.upgrades.brew };
    });
    if (after.coins !== before.coins || after.day !== before.day || after.brew !== before.brew) {
      throw new Error(`save mismatch: ${JSON.stringify({ before, after })}`);
    }

    // screenshot for the visual record
    await page.screenshot({ path: new URL("./smoke-desktop.png", import.meta.url).pathname.slice(1) });

    if (errors.length > 0) {
      throw new Error(`console errors: ${errors.join(" | ")}`);
    }

    return {
      ok: true,
      daySummary: summaryShot,
      persisted: after,
      consoleErrors: errors.length,
    };
  } finally {
    await browser.close();
  }
}
