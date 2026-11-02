// Sound effects synthesised with Web Audio, so there are no files to load. Every sound is
// optional: no audio support, or a context the browser hasn't unlocked yet, just stays silent.
let ac = null;
let hum = null;

function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
  }
  // Browsers start a context suspended until the page has had a click or key press.
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

// One note gliding from f0 to f1 Hz, with a quick attack and a decay over dur seconds.
function tone(f0, f1, dur, { type = "sine", gain = 0.16, delay = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const SOUNDS = {
  right: () => {
    tone(660, 660, 0.1);
    tone(990, 990, 0.16, { delay: 0.08 });
  },
  wrong: () => tone(196, 110, 0.32, { type: "square", gain: 0.06 }),
  credit: () => tone(1320, 1980, 0.08, { type: "triangle", gain: 0.1 }),
  bonus: () => [880, 1109, 1319, 1760].forEach((f, i) => tone(f, f, 0.14, { type: "triangle", gain: 0.11, delay: i * 0.06 })),
  // A sonar ping: a rising sweep, then the echo.
  scan: () => {
    tone(420, 1260, 0.5, { gain: 0.1 });
    tone(1260, 1260, 0.6, { gain: 0.05, delay: 0.5 });
  },
  alert: () => [0, 0.18].forEach((delay) => tone(880, 660, 0.14, { type: "square", gain: 0.05, delay })),
  // The landing chime: a rising major arpeggio that rings out.
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, i === 4 ? 1.4 : 0.5, { type: "triangle", gain: 0.16, delay: i * 0.13 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, f * 0.97, 0.4, { type: "sawtooth", gain: 0.04, delay: i * 0.24 })),
};

export function sfx(name) {
  try {
    SOUNDS[name]?.();
  } catch {
    /* sound is optional */
  }
}

/** Engine hum at power 0–1: louder and higher as power rises, and silent at 0. */
export function engine(power) {
  if (!hum && !(power > 0)) return;
  const a = audio();
  if (!a) return;
  if (!hum) {
    const low = a.createOscillator();
    const high = a.createOscillator();
    const filter = a.createBiquadFilter();
    const gain = a.createGain();
    low.type = "sawtooth";
    high.type = "sawtooth";
    high.detune.value = 1207; // an octave and a bit, so the two beat slowly
    filter.type = "lowpass";
    gain.gain.value = 0;
    low.connect(filter);
    high.connect(filter);
    filter.connect(gain).connect(a.destination);
    low.start();
    high.start();
    hum = { low, high, filter, gain };
  }
  const p = Math.max(0, Math.min(1, power || 0));
  const t = a.currentTime;
  hum.gain.gain.setTargetAtTime(p * 0.09, t, 0.08);
  hum.low.frequency.setTargetAtTime(48 + p * 40, t, 0.12);
  hum.high.frequency.setTargetAtTime(48 + p * 40, t, 0.12);
  hum.filter.frequency.setTargetAtTime(220 + p * 900, t, 0.12);
}
