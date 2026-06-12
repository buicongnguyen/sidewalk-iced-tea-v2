// Capture gameplay screenshots for visual review (not part of CI).
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const READY = /Sidewalk Iced Tea V2 available at (http:\/\/[^\s]+)/;

const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const url = await new Promise((resolve, reject) => {
  let buf = "";
  server.stdout.on("data", (c) => {
    buf += c;
    const m = buf.match(READY);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("timeout")), 10000);
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => indexedDB.deleteDatabase("sidewalk-iced-tea-v2"));
await page.reload({ waitUntil: "networkidle" });
await page.click("#start-button");

// play attentively for ~20 sim seconds
for (let i = 0; i < 40; i += 1) {
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.getSnapshot();
    for (const t of s.tables) {
      if (t.status === "seated") {
        const m = t.id.match(/table-(\d)-(\d)/);
        g.debug.tap(286 + 160 * Number(m[2]) + 56, 152 + 144 * Number(m[1]) + 40);
      }
    }
  });
  await page.waitForTimeout(500);
}
await page.screenshot({ path: "test/shot-day.png" });

// midday heat
await page.evaluate(() => window.__game.debug.setDayTime(55));
await page.waitForTimeout(1200);
await page.screenshot({ path: "test/shot-noon.png" });

// rainy evening
await page.evaluate(() => {
  window.__game.debug.setDayTime(100);
  window.__game.debug.startRain();
  window.__game.debug.startWind();
});
await page.waitForTimeout(3500);
await page.screenshot({ path: "test/shot-evening-rain.png" });

// night with cat
await page.evaluate(() => {
  window.__game.debug.setDayTime(128);
  window.__game.debug.spawnCat();
});
await page.waitForTimeout(4500);
await page.screenshot({ path: "test/shot-night.png" });

await browser.close();
server.kill();
console.log("shots saved");
