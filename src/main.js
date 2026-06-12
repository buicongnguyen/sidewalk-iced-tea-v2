// Bootstrap: wiring, fixed-timestep loop with render interpolation,
// input, visibility handling, day summary, debug surface.

import { BOARD, SIM, UPGRADES } from "./config.js";
import { createAudio } from "./audio.js";
import { createHud } from "./hud.js";
import { createFx, updateFx } from "./physics.js";
import { createRenderer } from "./render.js";
import { createStorage } from "./save.js";
import {
  applyIdleCredit,
  createWorld,
  ensureWaiters,
  handleTap,
  simTick,
  startNextDay,
} from "./sim.js";
import { createDefaultState, restoreState } from "./state.js";
import { makeRng } from "./util.js";

const els = {
  canvas: document.getElementById("game-canvas"),
  coins: document.getElementById("coins-value"),
  score: document.getElementById("score-value"),
  served: document.getElementById("served-value"),
  streak: document.getElementById("streak-value"),
  day: document.getElementById("day-value"),
  weather: document.getElementById("weather-value"),
  reputation: document.getElementById("reputation-value"),
  tables: document.getElementById("tables-value"),
  flow: document.getElementById("flow-value"),
  incident: document.getElementById("incident-value"),
  save: document.getElementById("save-value"),
  clock: document.getElementById("clock-value"),
  upBrew: document.getElementById("upgrade-brew"),
  upWaiter: document.getElementById("upgrade-waiter"),
  upTray: document.getElementById("upgrade-tray"),
  upUmbrella: document.getElementById("upgrade-umbrella"),
  upFans: document.getElementById("upgrade-fans"),
  upMarketing: document.getElementById("upgrade-marketing"),
  pause: document.getElementById("pause-button"),
  sound: document.getElementById("sound-button"),
  reset: document.getElementById("reset-button"),
  overlay: document.getElementById("title-overlay"),
  overlayEyebrow: document.getElementById("overlay-eyebrow"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayCopy: document.getElementById("overlay-copy"),
  overlayStats: document.getElementById("overlay-stats"),
  startButton: document.getElementById("start-button"),
  installButton: document.getElementById("install-button"),
  offlineBadge: document.getElementById("offline-badge"),
  toast: document.getElementById("toast"),
};

const SAVE_LABELS = {
  booting: "đang mở",
  ready: "sẵn sàng",
  loaded: "đã tải",
  recovered: "đã khôi phục",
  fallback: "lưu dự phòng",
  autosave: "đã lưu",
  "save error": "lỗi lưu",
  start: "bắt đầu",
  upgrade: "nâng cấp",
  hidden: "ẩn nền",
  resume: "trở lại",
  pagehide: "rời trang",
  reset: "đã xóa",
  day: "qua ngày",
};

const runtime = {
  mode: "title", // title | playing | paused | summary
  lastFrame: 0,
  accumulator: 0,
  autoSaveTimer: 0,
  toastTimer: null,
  hiddenAt: null,
  installPrompt: null,
  saveLabel: SAVE_LABELS.booting,
  renderTime: 0,
};

const storage = createStorage();
const audio = createAudio();
const fx = createFx();
const renderer = createRenderer(els.canvas);
const hud = createHud(els);
const rng = makeRng((Date.now() % 0xffffffff) >>> 0);

let state = createDefaultState();
let world = createWorld(state, rng, hooks());

function hooks() {
  return { emit: showToast, audio, fx };
}

document.documentElement.lang = "vi";

init().catch((error) => {
  console.error(error);
  showToast("Mở quán chưa xong, tải lại giúp mình nhé.");
});

async function init() {
  bindEvents();
  await storage.init();
  const saved = await storage.load();
  if (saved) {
    state = restoreState(saved);
    world = createWorld(state, rng, hooks());
  }
  runtime.saveLabel = SAVE_LABELS[storage.status] ?? storage.status;
  audio.setEnabled(state.settings.sound);

  renderer.resize();
  updateOverlay();
  hud.update(state, world, runtime);
  updateOnlineBadge();
  exposeDebug();
  registerServiceWorker();
  requestAnimationFrame(frameLoop);
}

function bindEvents() {
  els.canvas.addEventListener("pointerdown", onCanvasPointer);
  els.startButton.addEventListener("click", onStartButton);
  els.installButton.addEventListener("click", onInstall);
  els.pause.addEventListener("click", togglePause);
  els.sound.addEventListener("click", toggleSound);
  els.reset.addEventListener("click", resetSave);
  els.upBrew.addEventListener("click", () => buyUpgrade("brew"));
  els.upWaiter.addEventListener("click", () => buyUpgrade("waiter2"));
  els.upTray.addEventListener("click", () => buyUpgrade("tray"));
  els.upUmbrella.addEventListener("click", () => buyUpgrade("umbrella"));
  els.upFans.addEventListener("click", () => buyUpgrade("fans"));
  els.upMarketing.addEventListener("click", () => buyUpgrade("marketing"));

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", () => {
    void persist("pagehide");
  });
  window.addEventListener("online", updateOnlineBadge);
  window.addEventListener("offline", updateOnlineBadge);
  window.addEventListener("resize", () => renderer.resize());
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    runtime.installPrompt = event;
    els.installButton.classList.remove("hidden");
  });
  window.addEventListener("appinstalled", () => {
    runtime.installPrompt = null;
    els.installButton.classList.add("hidden");
    showToast("Cài xong rồi, giờ mở như ứng dụng được luôn.");
  });
}

// --- loop -------------------------------------------------------------------

function frameLoop(timestamp) {
  if (!runtime.lastFrame) runtime.lastFrame = timestamp;
  const frameDelta = Math.min((timestamp - runtime.lastFrame) / 1000, SIM.MAX_FRAME_DELTA);
  runtime.lastFrame = timestamp;
  runtime.renderTime += frameDelta;

  if (runtime.mode === "playing" && !document.hidden) {
    runtime.accumulator += frameDelta;
    runtime.autoSaveTimer += frameDelta;

    let steps = 0;
    while (runtime.accumulator >= SIM.DT && steps < 12) {
      simTick(state, world, SIM.DT);
      runtime.accumulator -= SIM.DT;
      steps += 1;
    }

    if (state.daySummary && runtime.mode === "playing") {
      enterSummary();
    }

    if (runtime.autoSaveTimer >= SIM.AUTOSAVE_EVERY) {
      runtime.autoSaveTimer = 0;
      void persist("autosave");
    }
  }

  // visual particles advance with real frame time (smooth at any fps)
  updateFx(fx, frameDelta, {
    rainLevel: state.weather.rainLevel,
    wind: world.wind,
    rng: Math.random,
  });

  const alpha = runtime.mode === "playing" ? Math.min(1, runtime.accumulator / SIM.DT) : 1;
  renderer.render({
    state,
    world,
    fx,
    alpha,
    time: runtime.renderTime,
    mode: runtime.mode,
  });
  hud.update(state, world, runtime);
  requestAnimationFrame(frameLoop);
}

// --- input ------------------------------------------------------------------

function onCanvasPointer(event) {
  if (runtime.mode === "title") {
    onStartButton();
    return;
  }
  if (runtime.mode !== "playing") return;
  const bounds = els.canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = ((event.clientX - bounds.left) / bounds.width) * BOARD.W;
  const y = ((event.clientY - bounds.top) / bounds.height) * BOARD.H;
  handleTap(state, world, x, y);
}

function onStartButton() {
  if (runtime.mode === "playing") return;

  if (runtime.mode === "summary") {
    startNextDay(state, world, rng);
    audio.beep("day");
    runtime.mode = "playing";
    updateOverlay();
    void persist("day");
    return;
  }

  runtime.mode = "playing";
  runtime.lastFrame = 0;
  runtime.accumulator = 0;
  audio.unlock();
  audio.setEnabled(state.settings.sound);
  updateOverlay();
  void persist("start");
}

async function onInstall() {
  if (!runtime.installPrompt) return;
  runtime.installPrompt.prompt();
  await runtime.installPrompt.userChoice;
  runtime.installPrompt = null;
  els.installButton.classList.add("hidden");
}

function buyUpgrade(key) {
  const def = UPGRADES[key];
  const level = state.upgrades[key];
  if (level >= def.levels.length) {
    showToast("Nâng cấp này đã tối đa rồi.");
    return;
  }
  const cost = def.levels[level];
  if (state.coins < cost) {
    showToast(`Cần ${cost} xu cho ${def.labelVi}.`);
    return;
  }
  state.coins -= cost;
  state.upgrades[key] += 1;
  if (key === "waiter2") ensureWaiters(state, world);
  audio.beep("upgrade");
  showToast(`Đã nâng cấp: ${def.labelVi}.`);
  void persist("upgrade");
}

function togglePause() {
  if (runtime.mode === "title" || runtime.mode === "summary") return;
  if (runtime.mode === "paused") {
    runtime.mode = "playing";
    runtime.lastFrame = 0;
    runtime.accumulator = 0;
    showToast("Bán tiếp thôi.");
  } else {
    runtime.mode = "paused";
    showToast("Tạm nghỉ một chút.");
    void persist("hidden");
  }
  updateOverlay();
}

function toggleSound() {
  state.settings.sound = !state.settings.sound;
  audio.setEnabled(state.settings.sound);
  if (state.settings.sound) audio.beep("tap");
  void persist("autosave");
}

async function resetSave() {
  const confirmed = window.confirm("Xóa toàn bộ dữ liệu của quán và làm lại từ đầu?");
  if (!confirmed) return;
  await storage.clear();
  state = createDefaultState();
  world = createWorld(state, rng, hooks());
  fx.rain.length = 0;
  fx.floats.length = 0;
  runtime.mode = "title";
  runtime.saveLabel = SAVE_LABELS.reset;
  updateOverlay();
  showToast("Đã xóa dữ liệu. Quán quay về ngày đầu tiên.");
}

// --- visibility / idle -------------------------------------------------------

async function onVisibilityChange() {
  if (document.hidden) {
    runtime.hiddenAt = Date.now();
    runtime.lastFrame = 0;
    runtime.accumulator = 0;
    await persist("hidden");
    return;
  }

  const hiddenFor = runtime.hiddenAt ? (Date.now() - runtime.hiddenAt) / 1000 : 0;
  runtime.hiddenAt = null;
  runtime.lastFrame = 0;

  if (runtime.mode !== "playing" || hiddenFor <= 0.5) return;

  const catchUp = Math.min(hiddenFor, SIM.MAX_CATCH_UP);
  world.quiet = true;
  let remaining = catchUp;
  while (remaining > 0 && !state.daySummary) {
    simTick(state, world, SIM.DT);
    remaining -= SIM.DT;
  }
  world.quiet = false;

  const extra = Math.min(Math.max(0, hiddenFor - catchUp), SIM.MAX_IDLE);
  if (extra > 5 && !state.daySummary) {
    const earned = applyIdleCredit(state, world, extra);
    if (earned > 0) {
      showToast(`Khách quen tự phục vụ lúc bạn vắng: +${earned} xu.`);
    }
  }
  if (state.daySummary) enterSummary();
  await persist("resume");
}

// --- overlays ----------------------------------------------------------------

function enterSummary() {
  runtime.mode = "summary";
  audio.beep("day");
  updateOverlay();
  void persist("day");
}

function updateOverlay() {
  const overlay = els.overlay;
  if (runtime.mode === "playing") {
    overlay.classList.add("hidden");
    return;
  }
  overlay.classList.remove("hidden");
  els.overlayStats.classList.add("hidden");

  if (runtime.mode === "summary" && state.daySummary) {
    const s = state.daySummary;
    els.overlayEyebrow.textContent = `Hết ngày ${s.day}`;
    els.overlayTitle.textContent = "Đóng quán!";
    els.overlayCopy.textContent =
      s.missed === 0
        ? "Không khách nào phải bỏ về — một ngày trọn vẹn."
        : "Ngày mai khách sẽ đông hơn chút, chuẩn bị nhé.";
    els.overlayStats.classList.remove("hidden");
    els.overlayStats.innerHTML = `
      <div><span>Phục vụ</span><strong>${s.served} khách</strong></div>
      <div><span>Bỏ về</span><strong>${s.missed} khách</strong></div>
      <div><span>Thu nhập</span><strong>+${s.earned} xu</strong></div>
      <div><span>Tiền boa</span><strong>+${s.tips} xu</strong></div>
      <div><span>Chuỗi tốt nhất</span><strong>×${s.bestStreak}</strong></div>
    `;
    els.startButton.textContent = `Mở ngày ${s.day + 1}`;
    return;
  }

  if (runtime.mode === "paused") {
    els.overlayEyebrow.textContent = "Đang tạm dừng";
    els.overlayTitle.textContent = "Nghỉ tay chút";
    els.overlayCopy.textContent = "Khách vẫn ngồi yên chờ. Khi sẵn sàng thì mở quán lại nhé.";
    els.startButton.textContent = "Tiếp tục ca";
    return;
  }

  // title
  els.overlayEyebrow.textContent = "Phiên bản 2";
  els.overlayTitle.textContent = "Trà Đá Vỉa Hè";
  const returning = state.totalServed > 0 || state.coins > 0 || state.day > 1;
  els.overlayCopy.textContent = returning
    ? `Quán đang ở ngày ${state.day} với ${state.coins} xu. Khách gọi món, quầy pha chế và em phục vụ sẽ lo phần còn lại.`
    : "Chạm vào bàn để ghi món. Quầy sẽ pha và em phục vụ sẽ bưng ra tận bàn — đừng để khách chờ lâu nhé!";
  els.startButton.textContent = returning ? "Tiếp tục bán" : "Mở quán";
}

function updateOnlineBadge() {
  els.offlineBadge.classList.toggle("hidden", navigator.onLine);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .catch((error) => console.warn("Service worker registration failed.", error));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  if (runtime.toastTimer) clearTimeout(runtime.toastTimer);
  runtime.toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2400);
}

async function persist(reason) {
  await storage.persist(state, reason);
  runtime.saveLabel = SAVE_LABELS[storage.status] ?? storage.status;
}

// --- debug / test surface -------------------------------------------------------

function exposeDebug() {
  window.__game = {
    getSnapshot() {
      return {
        mode: runtime.mode,
        saveStatus: storage.status,
        day: state.day,
        dayTime: state.dayTime,
        coins: state.coins,
        score: state.score,
        streak: state.streak,
        reputation: state.reputation,
        totalServed: state.totalServed,
        totalMissed: state.totalMissed,
        weather: structuredClone(state.weather),
        wind: world.wind,
        heat: world.heat,
        customers: state.customers.map((c) => {
          const agent = world.agents.get(c.id);
          return {
            ...structuredClone(c),
            x: agent?.x ?? null,
            y: agent?.y ?? null,
            moving: agent?.moving ?? false,
          };
        }),
        orders: structuredClone(state.orders),
        tables: structuredClone(state.tables),
        waiters: world.waiters.map((w) => ({
          state: w.state,
          x: w.agent.x,
          y: w.agent.y,
          carrying: [...w.carrying],
          stops: structuredClone(w.stops),
        })),
        cat: world.cat ? { mode: world.cat.mode, x: world.cat.agent.x, y: world.cat.agent.y, tableId: world.cat.tableId } : null,
        dog: world.dog ? { x: world.dog.agent.x, y: world.dog.agent.y } : null,
        bikes: world.bikes.map((b) => ({ x: b.x, y: b.y })),
        upgrades: structuredClone(state.upgrades),
        stats: structuredClone(state.stats),
        daySummary: state.daySummary ? structuredClone(state.daySummary) : null,
      };
    },
    debug: {
      tap(x, y) {
        return handleTap(state, world, x, y);
      },
      grantCoins(amount) {
        state.coins += Math.max(0, Number(amount) || 0);
      },
      setDayTime(seconds) {
        state.dayTime = Math.max(0, Number(seconds) || 0);
      },
      startRain() {
        state.weather = { state: "rain", remaining: 20, rainLevel: state.weather.rainLevel };
      },
      startWind() {
        state.windRemaining = 9;
        state.stats.windEvents += 1;
      },
      spawnCat() {
        state.nextCatIn = 0.01;
      },
      spawnDog() {
        state.nextDogIn = 0.01;
      },
      fastForward(seconds) {
        const steps = Math.floor(seconds / SIM.DT);
        world.quiet = true;
        for (let i = 0; i < steps && !state.daySummary; i += 1) {
          simTick(state, world, SIM.DT);
        }
        world.quiet = false;
        if (state.daySummary && runtime.mode === "playing") enterSummary();
      },
    },
  };
}
