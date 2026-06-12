import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const READY = /available at (http:\/\/[^\s]+)/;
const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, HOST: "127.0.0.1", PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
const url = await new Promise((res, rej) => { let b = ""; server.stdout.on("data", c => { b += c; const m = b.match(READY); if (m) res(m[1]); }); setTimeout(() => rej(new Error("timeout")), 10000); });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("sidewalk-iced-tea-v2"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("#start-button");
await page.evaluate(() => { window.__game.debug.fastForward(20); window.__game.debug.startRain(); window.__game.debug.startWind(); window.__game.debug.spawnDog(); });
await page.waitForTimeout(3000);
const stats = await page.evaluate(() => new Promise((resolve) => {
  const times = [];
  let last = performance.now();
  function tick() {
    const now = performance.now();
    times.push(now - last);
    last = now;
    if (times.length < 180) requestAnimationFrame(tick); else {
      times.sort((a, b) => a - b);
      resolve({ avgMs: times.reduce((s, t) => s + t, 0) / times.length, p95Ms: times[Math.floor(times.length * 0.95)], worstMs: times[times.length - 1] });
    }
  }
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify(stats));
await browser.close();
server.kill();

