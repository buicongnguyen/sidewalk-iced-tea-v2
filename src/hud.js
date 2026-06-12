// DOM HUD with diffed writes: the DOM is only touched when a value changes.

import { DAY, UPGRADES } from "./config.js";
import { dayPhase } from "./sim.js";
import { formatClock } from "./util.js";

const PHASE_LABEL = { morning: "Sáng", noon: "Trưa", evening: "Chiều", night: "Tối" };
const PHASE_ICON = { morning: "🌤", noon: "☀️", evening: "🌇", night: "🌙" };
const WEATHER_LABEL = {
  clear: "nắng ráo",
  cloudy: "trời râm",
  rain: "đang mưa",
};

export function createHud(els) {
  const cache = new Map();

  function setText(el, value) {
    if (!el) return;
    if (cache.get(el) !== value) {
      cache.set(el, value);
      el.textContent = value;
    }
  }

  function setHtml(el, value) {
    if (!el) return;
    const key = `${value}::html`;
    if (cache.get(el) !== key) {
      cache.set(el, key);
      el.innerHTML = value;
    }
  }

  function setDisabled(el, value) {
    if (!el) return;
    if (el.disabled !== value) el.disabled = value;
  }

  function upgradeButton(el, state, key) {
    const def = UPGRADES[key];
    const level = state.upgrades[key];
    const maxed = level >= def.levels.length;
    const cost = maxed ? null : def.levels[level];
    const hint = def.hintVi(level, cost);
    setHtml(el, `${def.labelVi}<small>${hint}</small>`);
    setDisabled(el, maxed || state.coins < (cost ?? Infinity));
    const title = `${def.descVi}`;
    if (el.title !== title) el.title = title;
  }

  return {
    update(state, world, runtime) {
      setText(els.coins, String(state.coins));
      setText(els.score, String(state.score));
      setText(els.served, String(state.totalServed));
      setText(els.streak, state.streak > 1 ? `×${state.streak}` : "—");

      const phase = dayPhase(state.dayTime);
      setText(els.day, `Ngày ${state.day} · ${PHASE_ICON[phase]} ${PHASE_LABEL[phase]}`);

      const weather = state.weather.state;
      const weatherText =
        weather === "rain"
          ? `${WEATHER_LABEL[weather]} ${Math.max(0, Math.ceil(state.weather.remaining))}s`
          : WEATHER_LABEL[weather];
      setText(els.weather, weatherText);

      const stars = "★".repeat(Math.round(state.reputation)) + "☆".repeat(5 - Math.round(state.reputation));
      setText(els.reputation, stars);

      const busy = state.tables.filter((t) => t.status !== "empty").length;
      setText(els.tables, `${busy} / ${state.tables.length}`);
      setText(els.flow, `${state.totalServed} bán / ${state.totalMissed} lỡ`);

      const pieces = [];
      if (state.windRemaining > 0) pieces.push("gió lớn");
      if (world.heat > 0.5) pieces.push("nắng gắt");
      if (world.cat?.mode === "napping") pieces.push("mèo chiếm bàn");
      if (world.dog) pieces.push("chó dạo phố");
      setText(els.incident, pieces.length > 0 ? pieces.join(" / ") : "yên ắng");

      setText(els.save, runtime.saveLabel);
      const dayLeft = Math.max(0, DAY.LENGTH - state.dayTime);
      setText(els.clock, state.closing ? "sắp đóng cửa" : `còn ${formatClock(dayLeft)}`);

      upgradeButton(els.upBrew, state, "brew");
      upgradeButton(els.upWaiter, state, "waiter2");
      upgradeButton(els.upTray, state, "tray");
      upgradeButton(els.upUmbrella, state, "umbrella");
      upgradeButton(els.upFans, state, "fans");
      upgradeButton(els.upMarketing, state, "marketing");

      setHtml(
        els.pause,
        runtime.mode === "paused"
          ? "Bán tiếp<small>quay lại phục vụ</small>"
          : "Tạm dừng<small>ngưng phục vụ</small>",
      );
      setHtml(
        els.sound,
        state.settings.sound ? "Âm thanh<small>đang bật</small>" : "Âm thanh<small>đang tắt</small>",
      );
    },
  };
}
