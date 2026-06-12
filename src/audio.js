// Procedural WebAudio: envelope beeps + filtered-noise rain ambience.

export function createAudio() {
  let context = null;
  let enabled = true;
  let rainGain = null;
  let rainSource = null;
  let rainLevel = 0;

  function ensureContext() {
    if (context) return context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    return context;
  }

  function ensureRain() {
    const ac = ensureContext();
    if (!ac || rainSource) return;
    // 2s loop of filtered white noise
    const length = ac.sampleRate * 2;
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    rainSource = ac.createBufferSource();
    rainSource.buffer = buffer;
    rainSource.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1900;
    filter.Q.value = 0.6;
    rainGain = ac.createGain();
    rainGain.gain.value = 0;
    rainSource.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(ac.destination);
    rainSource.start();
  }

  function pulse({ frequency, duration, type = "square", gain = 0.02, when = 0 }) {
    if (!enabled) return;
    const ac = ensureContext();
    if (!ac) return;
    if (ac.state === "suspended") {
      ac.resume().catch(() => {});
    }
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(env);
    env.connect(ac.destination);
    const start = ac.currentTime + when;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    unlock() {
      const ac = ensureContext();
      if (ac && ac.state === "suspended") {
        ac.resume().catch(() => {});
      }
      ensureRain();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (rainGain) {
        rainGain.gain.value = enabled ? rainLevel * 0.05 : 0;
      }
    },
    get enabled() {
      return enabled;
    },
    setRainLevel(level) {
      rainLevel = level;
      if (rainGain) {
        const target = enabled ? level * 0.05 : 0;
        rainGain.gain.setTargetAtTime(target, context.currentTime, 0.4);
      }
    },
    beep(kind) {
      switch (kind) {
        case "tip":
          pulse({ frequency: 780, duration: 0.12, gain: 0.03 });
          pulse({ frequency: 988, duration: 0.12, gain: 0.026, when: 0.09 });
          pulse({ frequency: 1180, duration: 0.1, gain: 0.02, when: 0.18 });
          break;
        case "serve":
          pulse({ frequency: 660, duration: 0.1, gain: 0.024 });
          pulse({ frequency: 880, duration: 0.1, gain: 0.02, when: 0.08 });
          break;
        case "upgrade":
          pulse({ frequency: 520, duration: 0.14, gain: 0.028 });
          pulse({ frequency: 700, duration: 0.12, gain: 0.024, when: 0.1 });
          pulse({ frequency: 920, duration: 0.12, gain: 0.02, when: 0.2 });
          break;
        case "rain":
          pulse({ frequency: 240, duration: 0.24, type: "triangle", gain: 0.02 });
          break;
        case "wind":
          pulse({ frequency: 180, duration: 0.3, type: "sine", gain: 0.016 });
          break;
        case "tap":
          pulse({ frequency: 460, duration: 0.07, gain: 0.018 });
          break;
        case "seat":
          pulse({ frequency: 392, duration: 0.06, type: "triangle", gain: 0.012 });
          break;
        case "ready":
          pulse({ frequency: 1046, duration: 0.08, type: "triangle", gain: 0.016 });
          break;
        case "pickup":
          pulse({ frequency: 587, duration: 0.06, type: "triangle", gain: 0.014 });
          break;
        case "angry":
          pulse({ frequency: 220, duration: 0.16, type: "sawtooth", gain: 0.014 });
          pulse({ frequency: 175, duration: 0.18, type: "sawtooth", gain: 0.012, when: 0.12 });
          break;
        case "cat":
          pulse({ frequency: 900, duration: 0.1, type: "sine", gain: 0.02 });
          pulse({ frequency: 1180, duration: 0.14, type: "sine", gain: 0.016, when: 0.07 });
          break;
        case "bike":
          pulse({ frequency: 130, duration: 0.1, type: "sawtooth", gain: 0.008 });
          pulse({ frequency: 118, duration: 0.1, type: "sawtooth", gain: 0.007, when: 0.1 });
          break;
        case "day":
          pulse({ frequency: 523, duration: 0.16, type: "triangle", gain: 0.022 });
          pulse({ frequency: 659, duration: 0.16, type: "triangle", gain: 0.02, when: 0.14 });
          pulse({ frequency: 784, duration: 0.2, type: "triangle", gain: 0.02, when: 0.28 });
          break;
        default:
          pulse({ frequency: 540, duration: 0.1, gain: 0.018 });
      }
    },
  };
}
