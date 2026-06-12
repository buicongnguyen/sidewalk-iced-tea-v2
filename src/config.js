// Static game configuration: board, timing, customers, drinks, upgrades.

export const BOARD = { W: 960, H: 540 };

export const SIM = {
  DT: 1 / 30, // fixed logic step (seconds)
  MAX_FRAME_DELTA: 0.25, // clamp long frames
  MAX_CATCH_UP: 30, // seconds replayed after tab hide
  MAX_IDLE: 900, // seconds of condensed idle credit
  IDLE_EFFICIENCY: 0.22, // fraction of normal throughput while away
  AUTOSAVE_EVERY: 10,
};

export const DAY = {
  LENGTH: 150, // seconds per in-game day
  WIND_DOWN: 14, // no spawns during the last seconds of a day
  CLOSE_GRACE: 30, // after closing, guests get this long before walking out
  // phase keyframes (t in [0,1]) -> ambient lighting
  PHASES: [
    { t: 0.0, name: "morning", labelVi: "Sáng" },
    { t: 0.25, name: "noon", labelVi: "Trưa" },
    { t: 0.52, name: "evening", labelVi: "Chiều" },
    { t: 0.78, name: "night", labelVi: "Tối" },
  ],
};

export const WEATHER = {
  CLEAR_DURATION: [32, 64],
  CLOUDY_DURATION: [14, 30],
  RAIN_DURATION: [16, 30],
  RAIN_CHANCE_FROM_CLOUDY: 0.62,
  RAIN_RAMP: 2.5, // seconds for rain to fade in/out
  RAIN_SPAWN_MULT: 0.55,
  RAIN_SPAWN_MULT_UMBRELLA: 0.85,
  HEAT_PATIENCE_MULT: 1.3, // patience drains faster in noon heat
  RAIN_PATIENCE_MULT: 0.85, // rain cools everyone down
};

export const WIND = {
  EVENT_WINDOW: [26, 56], // seconds between gust events
  EVENT_DURATION: [7, 12],
  BASE: 0.12, // always a little breeze
  EVENT_POWER: 1.0,
  WALK_SLOWDOWN: 0.16, // max walk-speed loss at full wind
};

export const SPAWN = {
  BASE_INTERVAL: 5.6, // day-1 average seconds between arrivals
  PER_DAY_STEP: 0.22, // interval shrinks per day
  MIN_INTERVAL: 3.1,
  VARIANCE: 0.35, // +-35%
  RUSH_BONUS: 0.55, // extra arrival pressure at rush peaks
  REP_MIN_MULT: 0.8,
  REP_MAX_MULT: 1.3,
};

export const SERVICE = {
  SHELF_MAX: 4,
  TRAY_BASE: 2,
  TRAY_UPGRADED: 3,
  DRINKING_TIME: [3.0, 4.2],
  TABLE_COOLDOWN: 1.6, // seconds before a vacated table can be reassigned
  ORDERED_PATIENCE_RELIEF: 0.6, // patience decay multiplier once order is taken
  TIP_FAST_RATIO: 0.55, // patience fraction remaining => big tip
  TIP_OK_RATIO: 0.3,
  CAT_NAP_WINDOW: [38, 75],
  CAT_NAP_MAX: 26,
  DOG_WINDOW: [20, 42],
  BIKE_WINDOW: [11, 26],
};

export const PATIENCE_PER_DAY_MULT = 0.985;
export const PATIENCE_FLOOR_MULT = 0.82;

export const REPUTATION = {
  START: 3,
  MIN: 0.5,
  MAX: 5,
  TIP_GAIN: 0.07,
  SERVE_GAIN: 0.035,
  MISS_LOSS: 0.3,
};

export const CUSTOMER_TYPES = [
  {
    id: "man",
    labelVi: "Khách nam",
    skin: "#e8bc9a", hair: "#2d211a", top: "#6285d8", bottom: "#4b3b32", accent: "#cfddd4",
    hairStyle: "short", silhouette: "broad",
    scale: 1.0, walkSpeed: 132, patience: 24,
    speech: ["Cho mình một ly {drink} nha.", "Cho mình xin một ly {drink} nhé."],
  },
  {
    id: "woman",
    labelVi: "Khách nữ",
    skin: "#efc6a8", hair: "#523124", top: "#d86f7a", bottom: "#6f4c83", accent: "#f4d8cc",
    hairStyle: "long", silhouette: "soft",
    scale: 0.98, walkSpeed: 128, patience: 24,
    speech: ["Cho mình một ly {drink} nhé.", "Bán mình ly {drink} với."],
  },
  {
    id: "old_man",
    labelVi: "Chú khách",
    skin: "#e5b89a", hair: "#d8d1cb", top: "#7da1b8", bottom: "#655447", accent: "#eadcae",
    hairStyle: "hat_la", silhouette: "narrow",
    scale: 0.97, walkSpeed: 88, patience: 31,
    speech: ["Cho chú một ly {drink} nhé.", "Chú uống ly {drink} nha."],
  },
  {
    id: "old_woman",
    labelVi: "Cô khách",
    skin: "#ebbf9f", hair: "#cfd0d5", top: "#6fa89f", bottom: "#765a85", accent: "#f2dbbd",
    hairStyle: "bun", silhouette: "soft",
    scale: 0.95, walkSpeed: 84, patience: 31,
    speech: ["Cho cô một ly {drink} nhé.", "Cô lấy một ly {drink} nha."],
  },
  {
    id: "young_boy",
    labelVi: "Bé trai",
    skin: "#f0c69c", hair: "#3f2617", top: "#6da65f", bottom: "#516cb4", accent: "#f4d66c",
    hairStyle: "cap", silhouette: "compact",
    scale: 0.78, walkSpeed: 156, patience: 18,
    speech: ["Cho cháu xin một ly {drink} ạ.", "Cháu thèm {drink} quá ạ."],
  },
  {
    id: "young_girl",
    labelVi: "Bé gái",
    skin: "#f2cba9", hair: "#452819", top: "#f0c15f", bottom: "#d97872", accent: "#8fc8d2",
    hairStyle: "puff", silhouette: "compact",
    scale: 0.76, walkSpeed: 150, patience: 18,
    speech: ["Cho cháu xin một ly {drink} ạ.", "Cháu muốn một ly {drink} nha."],
  },
];

export const DRINKS = [
  { id: "thai_tea", labelVi: "trà Thái", shortVi: "Thái", price: 3, brewTime: 2.6, liquid: "#d67e3d", cup: "#ffe1af", straw: "#f45a52", garnish: "#f6d89c" },
  { id: "lemon_tea", labelVi: "trà chanh", shortVi: "Chanh", price: 2, brewTime: 1.8, liquid: "#caa642", cup: "#f5edd0", straw: "#4fa06e", garnish: "#f5e26d" },
  { id: "peach_fizz", labelVi: "trà đào", shortVi: "Đào", price: 3, brewTime: 2.4, liquid: "#ef9a7b", cup: "#ffe8df", straw: "#5db7d0", garnish: "#f5c2ab" },
  { id: "matcha_latte", labelVi: "matcha sữa", shortVi: "Matcha", price: 4, brewTime: 3.0, liquid: "#84b06a", cup: "#edf5e0", straw: "#e5c657", garnish: "#badc8f" },
  { id: "berry_soda", labelVi: "soda dâu", shortVi: "Dâu", price: 3, brewTime: 2.2, liquid: "#9a64c0", cup: "#f1e7ff", straw: "#efb0d2", garnish: "#d58eff" },
  { id: "milk_tea", labelVi: "trà sữa", shortVi: "Sữa", price: 4, brewTime: 2.8, liquid: "#a66c46", cup: "#f1d8b7", straw: "#dd634f", garnish: "#e7c39d" },
];

export const UPGRADES = {
  brew: {
    labelVi: "Pha nhanh",
    levels: [15, 40, 90],
    hintVi: (lvl, cost) => (cost === null ? `cấp tối đa` : `cấp ${lvl + 1} · ${cost} xu`),
    descVi: "Pha mỗi ly nhanh hơn 18%",
  },
  waiter2: {
    labelVi: "Thêm nhân viên",
    levels: [45],
    hintVi: (lvl, cost) => (cost === null ? "đã thuê" : `${cost} xu`),
    descVi: "Thuê thêm một người bưng trà",
  },
  tray: {
    labelVi: "Khay lớn",
    levels: [30],
    hintVi: (lvl, cost) => (cost === null ? "đã mua" : `${cost} xu`),
    descVi: "Bưng được 3 ly mỗi chuyến",
  },
  umbrella: {
    labelVi: "Ô che",
    levels: [25],
    hintVi: (lvl, cost) => (cost === null ? "đã mua" : `${cost} xu`),
    descVi: "Trời mưa khách vẫn ghé",
  },
  fans: {
    labelVi: "Quạt mát",
    levels: [35],
    hintVi: (lvl, cost) => (cost === null ? "đã mua" : `${cost} xu`),
    descVi: "Trưa nắng khách đỡ sốt ruột",
  },
  marketing: {
    labelVi: "Quảng cáo",
    levels: [20, 45, 85],
    hintVi: (lvl, cost) => (cost === null ? "cấp tối đa" : `cấp ${lvl + 1} · ${cost} xu`),
    descVi: "Thêm 10% khách mỗi cấp",
  },
};

export const BREW_LEVEL_MULT = 0.18; // brew time reduction per level
export const MARKETING_LEVEL_MULT = 0.1;

export const CUSTOMER_TYPE_BY_ID = new Map(CUSTOMER_TYPES.map((t) => [t.id, t]));
export const DRINK_BY_ID = new Map(DRINKS.map((d) => [d.id, d]));

export const GAME_VERSION = 2;
export const SAVE_DB_NAME = "sidewalk-iced-tea-v2";
export const SAVE_STORE = "saves";
export const SAVE_SLOT = "slot-1";
export const SAVE_LS_KEY = "sidewalk-iced-tea-v2:save";
export const SAVE_LS_BACKUP = "sidewalk-iced-tea-v2:save-backup";
