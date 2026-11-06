// Sound effects synthesised with Web Audio, so there are no files to load. Every sound is
// optional: no audio support, or a context the browser hasn't unlocked yet, just stays silent.
// Voices run through one bus: a compressor so stacked sounds don't clip, and a short generated
// room so tones ring out instead of stopping dead.
let ac = null;
let bus = null;
let hum = null;
// The engine power last asked for, so unmuting can bring the engine back to it.
let wanted = 0;
let hiss = null;
// Booth staff can mute the game; the choice is remembered on this laptop.
let muted = false;
try {
  muted = localStorage.getItem("nova-muted") === "1";
} catch {
  /* storage blocked: start with sound on */
}

export function isMuted() {
  return muted;
}

export function setMuted(on) {
  muted = on;
  try {
    localStorage.setItem("nova-muted", on ? "1" : "0");
  } catch {
    /* the choice lasts until reload */
  }
  if (on && hum && ac) {
    const t = ac.currentTime;
    for (const param of [hum.drone.gain, hum.depth.gain, hum.rumbleGain.gain, hum.whineGain.gain]) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(0, t);
    }
  }
  // Sound back on: the engine picks up whatever it was last asked for, such as an idle.
  if (!on) engine(wanted);
}

function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
    bus = makeBus(ac);
  }
  // Browsers start a context suspended until the page has had a click or key press.
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

function makeBus(a) {
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  comp.connect(a.destination);
  const master = a.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  // The room: 1.6 s of stereo noise fading away, used as a convolution reverb.
  const len = Math.floor(a.sampleRate * 1.6);
  const room = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = room.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const verb = a.createConvolver();
  verb.buffer = room;
  const wet = a.createGain();
  wet.gain.value = 0.3;
  verb.connect(wet).connect(master);
  return { master, verb };
}

// Two seconds of white noise, shared by every noisy voice.
function noiseBuffer(a) {
  if (!hiss) {
    hiss = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const data = hiss.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return hiss;
}

// Sends a voice to the bus, and `send` of it to the room.
function out(a, node, send) {
  node.connect(bus.master);
  if (send > 0) {
    const g = a.createGain();
    g.gain.value = send;
    node.connect(g).connect(bus.verb);
  }
}

function envelope(a, t, gain, attack, dur) {
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return env;
}

/** One note gliding from f0 to f1 Hz over dur seconds, optionally through a low-pass that can sweep. */
function tone(f0, f1, dur, { type = "sine", gain = 0.12, delay = 0, attack = 0.01, send = 0.2, lp = 0, lpTo = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  let node = osc;
  if (lp) {
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(lp, t);
    if (lpTo) filter.frequency.exponentialRampToValueAtTime(lpTo, t + dur);
    node.connect(filter);
    node = filter;
  }
  const env = envelope(a, t, gain, attack, dur);
  node.connect(env);
  out(a, env, send);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Filtered noise over dur seconds, its filter sweeping from f0 to f1 Hz: whooshes, booms, ticks. */
function noise(dur, { type = "bandpass", f0 = 1000, f1 = f0, q = 1, gain = 0.1, delay = 0, attack = 0.01, send = 0.2 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const env = envelope(a, t, gain, attack, dur);
  src.connect(filter).connect(env);
  out(a, env, send);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

const SOUNDS = {
  // A soft tick for every button.
  click: () => {
    tone(2200, 1600, 0.04, { gain: 0.035, send: 0 });
    noise(0.025, { type: "highpass", f0: 5000, gain: 0.02, send: 0 });
  },
  // A tip slides in: two soft bell notes.
  tip: () => {
    tone(988, 988, 0.4, { gain: 0.05, send: 0.5 });
    tone(1480, 1480, 0.55, { gain: 0.04, delay: 0.09, send: 0.5 });
  },
  // A bright rising fifth with a high shimmer.
  right: () => {
    tone(784, 784, 0.14, { type: "triangle", gain: 0.11 });
    tone(1175, 1175, 0.26, { type: "triangle", gain: 0.11, delay: 0.07 });
    tone(2350, 2350, 0.3, { gain: 0.03, delay: 0.07, send: 0.4 });
  },
  // Two clashing low notes that sag, with a breath of noise.
  wrong: () => {
    tone(220, 150, 0.38, { type: "square", gain: 0.045, lp: 900 });
    tone(233, 156, 0.38, { type: "square", gain: 0.035, lp: 900 });
    noise(0.22, { type: "lowpass", f0: 700, gain: 0.03 });
  },
  // A coin: two quick bright notes.
  credit: () => {
    tone(1319, 1319, 0.08, { type: "square", gain: 0.03, lp: 5000, send: 0.1 });
    tone(1976, 1976, 0.28, { type: "square", gain: 0.03, lp: 5000, delay: 0.06, send: 0.3 });
  },
  bonus: () =>
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, f, 0.2, { type: "triangle", gain: 0.09, delay: i * 0.06, send: 0.4 })),
  // An asteroid breaks apart: a crack of noise falling into a thud.
  pop: () => {
    noise(0.28, { type: "lowpass", f0: 2600, f1: 260, gain: 0.2, send: 0.15 });
    tone(170, 55, 0.2, { gain: 0.12, send: 0 });
  },
  // The shop takes the credits: a register ding.
  buy: () => {
    noise(0.05, { type: "highpass", f0: 6000, gain: 0.03, send: 0 });
    tone(1047, 1047, 0.09, { type: "triangle", gain: 0.09 });
    tone(1568, 1568, 0.35, { type: "triangle", gain: 0.09, delay: 0.08, send: 0.35 });
  },
  // A sonar ping that rings, then its echo.
  scan: () => {
    noise(0.45, { f0: 400, f1: 3200, q: 3, gain: 0.025 });
    tone(1400, 1340, 0.7, { gain: 0.08, send: 0.6 });
    tone(1400, 1340, 0.55, { gain: 0.03, delay: 0.45, send: 0.8 });
  },
  // A hop between planets: a short rising whoosh.
  hop: () => {
    noise(0.55, { f0: 300, f1: 2600, q: 2, gain: 0.07, attack: 0.18, send: 0.3 });
    tone(220, 440, 0.45, { gain: 0.035, attack: 0.1 });
  },
  // One scanner reading: a data blip.
  reading: () => tone(1760, 1760, 0.05, { type: "square", gain: 0.022, lp: 4000, send: 0.1 }),
  // The verdict on a toxic world: a low beating buzz.
  toxic: () => {
    tone(110, 98, 0.65, { type: "sawtooth", gain: 0.05, lp: 700 });
    tone(116.5, 103, 0.65, { type: "sawtooth", gain: 0.045, lp: 700 });
  },
  // A planet popping out of existence as the ship leaves: a soft falling blip.
  vanish: () => tone(1320, 440, 0.16, { gain: 0.035, send: 0.4 }),
  // A planet popping into existence on arrival: a soft rising blip with a glint.
  appear: () => {
    tone(520, 1320, 0.12, { gain: 0.035, send: 0.4 });
    tone(2640, 2640, 0.15, { type: "triangle", gain: 0.012, delay: 0.06, send: 0.5 });
  },
  // A flight event: a two-tone alarm, three times.
  alert: () =>
    [0, 0.22, 0.44].forEach((delay) => tone(988, 740, 0.18, { type: "sawtooth", gain: 0.04, lp: 2600, delay, send: 0.25 })),
  // The drive charging before the jump: a rising tone opening up, and air rushing in.
  warpCharge: () => {
    tone(70, 520, 0.85, { type: "sawtooth", gain: 0.05, attack: 0.5, lp: 300, lpTo: 4000, send: 0.2 });
    noise(0.85, { f0: 200, f1: 3000, q: 1.5, gain: 0.05, attack: 0.6, send: 0.2 });
  },
  // The jump to warp: a deep boom, a burst of light-speed hiss and a falling zing.
  warpJump: () => {
    tone(110, 30, 0.9, { gain: 0.24, send: 0.4 });
    noise(1.2, { type: "lowpass", f0: 7000, f1: 180, gain: 0.16, attack: 0.005, send: 0.5 });
    tone(2600, 500, 0.35, { type: "sawtooth", gain: 0.025, lp: 5000, send: 0.3 });
  },
  // Dropping out of warp: rushing air that falls into a thump, then a sparkle.
  warpExit: () => {
    noise(0.5, { f0: 3200, f1: 240, q: 1.5, gain: 0.11, attack: 0.38, send: 0.35 });
    tone(80, 40, 0.5, { gain: 0.18, delay: 0.32, send: 0.3 });
    [2093, 1568, 1319].forEach((f, i) => tone(f, f, 0.3, { type: "triangle", gain: 0.035, delay: 0.38 + i * 0.07, send: 0.6 }));
  },
  // Settled: a rising arpeggio over a warm chord that rings out.
  win: () => {
    [523, 659, 784].forEach((f) => tone(f, f, 1.8, { type: "triangle", gain: 0.05, attack: 0.25, send: 0.5 }));
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(f, f, i === 4 ? 1.4 : 0.5, { type: "triangle", gain: 0.12, delay: i * 0.13, send: 0.4 }),
    );
  },
  // Run over: three falling notes and a low rumble.
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone(f, f * 0.97, 0.45, { type: "sawtooth", gain: 0.04, lp: 1400, delay: i * 0.24, send: 0.3 }));
    noise(1.2, { type: "lowpass", f0: 200, gain: 0.06, attack: 0.3, delay: 0.3, send: 0.2 });
  },
};

export function sfx(name) {
  if (muted || !name) return;
  try {
    SOUNDS[name]?.();
  } catch (err) {
    // Sound is optional, so players never see this; in development it says which sound broke.
    if (import.meta.env?.DEV) console.warn(`sound "${name}" failed:`, err);
  }
}

// Three seconds of brown noise (a deep, soft rumble), its ends cross-faded so the loop has no click.
let brown = null;
function brownBuffer(a) {
  if (!brown) {
    const len = a.sampleRate * 3;
    const fade = 2048;
    const raw = new Float32Array(len + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
    brown = a.createBuffer(1, len, a.sampleRate);
    const data = brown.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = i < fade ? raw[i] * (i / fade) + raw[len + i] * (1 - i / fade) : raw[i];
  }
  return brown;
}

/**
 * The starship's drive at power 0–1, silent at 0, in four layers:
 * - a warm drone: one low note built from soft harmonics only (an organ-like tone, no buzz), with a
 *   twin a few cents off so the two beat slowly; laptops can't play the fundamental but still hear
 *   its pitch through the harmonics;
 * - a deep rumble of brown noise that opens up with power;
 * - the reactor's throb, a pulse on the drone that quickens with power;
 * - a faint turbine whine that climbs at speed.
 */
export function engine(power) {
  wanted = power;
  if (muted) power = 0;
  if (!hum && !(power > 0)) return;
  const a = audio();
  if (!a) return;
  if (!hum) {
    const wave = a.createPeriodicWave(new Float32Array(7), new Float32Array([0, 1, 0.7, 0.45, 0.28, 0.16, 0.08]));
    const core = a.createOscillator();
    core.setPeriodicWave(wave);
    const twin = a.createOscillator();
    twin.setPeriodicWave(wave);
    twin.detune.value = 7;
    const warm = a.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 900;
    const drone = a.createGain();
    drone.gain.value = 0;
    core.connect(warm);
    twin.connect(warm);
    warm.connect(drone);
    out(a, drone, 0.2);
    // The throb: a pulse added to the drone's volume, scaled with power so silence stays silent.
    const pulse = a.createOscillator();
    const depth = a.createGain();
    depth.gain.value = 0;
    pulse.connect(depth).connect(drone.gain);
    const rumble = a.createBufferSource();
    rumble.buffer = brownBuffer(a);
    rumble.loop = true;
    const deep = a.createBiquadFilter();
    deep.type = "lowpass";
    deep.frequency.value = 160;
    const rumbleGain = a.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(deep).connect(rumbleGain);
    out(a, rumbleGain, 0.15);
    const whine = a.createOscillator();
    const whineGain = a.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain);
    out(a, whineGain, 0.3);
    for (const node of [core, twin, pulse, rumble, whine]) node.start();
    hum = { core, twin, warm, drone, pulse, depth, deep, rumbleGain, whine, whineGain };
  }
  const p = Math.max(0, Math.min(1, power || 0));
  const t = a.currentTime;
  const f = 55 + p * 27; // A1, rising toward E2 at full power
  hum.core.frequency.setTargetAtTime(f, t, 0.18);
  hum.twin.frequency.setTargetAtTime(f, t, 0.18);
  hum.warm.frequency.setTargetAtTime(600 + p * 900, t, 0.15);
  hum.drone.gain.setTargetAtTime(p * 0.09, t, 0.12);
  hum.depth.gain.setTargetAtTime(p * 0.022, t, 0.12);
  hum.pulse.frequency.setTargetAtTime(1.6 + p * 3.4, t, 0.25);
  hum.rumbleGain.gain.setTargetAtTime(p * 0.16, t, 0.12);
  hum.deep.frequency.setTargetAtTime(120 + p * 420, t, 0.15);
  hum.whine.frequency.setTargetAtTime(480 + p * 640, t, 0.2);
  hum.whineGain.gain.setTargetAtTime(p * p * 0.011, t, 0.15);
}
