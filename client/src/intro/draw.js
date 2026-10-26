// 2D layer for the intro, drawn over the WebGL space pass: the shuttle, the
// ship, smoke and sparks, debris, the docking reticle, lens flares, and the
// cockpit window. Ship geometry matches art/Ship.jsx.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => clamp(t) ** 3;
export const easeInOut = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const rand = (a, b) => a + Math.random() * (b - a);

function sprite(size, stops) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export const SPRITES = {
  smoke: sprite(96, [[0, "rgba(232,222,212,0.6)"], [0.45, "rgba(205,192,186,0.3)"], [1, "rgba(180,170,170,0)"]]),
  glow: sprite(96, [[0, "rgba(255,244,226,1)"], [0.22, "rgba(255,176,96,0.65)"], [1, "rgba(255,90,30,0)"]]),
  spark: sprite(32, [[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,206,150,0.85)"], [1, "rgba(255,120,40,0)"]]),
  blue: sprite(96, [[0, "rgba(228,244,255,1)"], [0.28, "rgba(130,196,255,0.5)"], [1, "rgba(80,140,255,0)"]]),
  dust: sprite(96, [[0, "rgba(160,74,40,0.55)"], [0.6, "rgba(110,46,30,0.22)"], [1, "rgba(90,40,30,0)"]]),
};

export function blit(ctx, img, x, y, r, alpha, additive = false) {
  if (alpha <= 0.002 || r <= 0.1) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// A tiny particle system. `shiftX`/`shiftY` move everything with the ground, so smoke
// left behind by the rocket falls away with the planet as the camera climbs.
export class Particles {
  constructor() {
    this.list = [];
  }
  add(p) {
    this.list.push({ age: 0, drag: 0, grow: 0, spin: 0, rot: 0, additive: false, ...p });
  }
  clear() {
    this.list.length = 0;
  }
  step(dt, shiftY = 0, shiftX = 0) {
    const out = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt + shiftX;
      p.y += p.vy * dt + shiftY;
      p.r += p.grow * dt;
      p.rot += p.spin * dt;
      out.push(p);
    }
    this.list = out;
  }
  draw(ctx, fadeAll = 1) {
    if (fadeAll <= 0) return;
    for (const p of this.list) {
      const k = p.age / p.life;
      const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      if (p.chunk) drawChunk(ctx, p, fade);
      else if (p.ember) drawEmber(ctx, p, k, fade);
      else blit(ctx, p.img, p.x, p.y, p.r, p.alpha * fade * fadeAll, p.additive);
    }
  }
}

function drawEmber(ctx, p, k, fade) {
  const r = Math.round(lerp(255, 255, k));
  const g = Math.round(lerp(236, 90, k));
  const b = Math.round(lerp(200, 30, k));
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.85 * fade})`;
  ctx.lineWidth = p.r;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
  blit(ctx, SPRITES.spark, p.x, p.y, p.r * 3, fade * 0.8, true);
}

// A piece of crust: dark rock, white-hot on the face turned toward the blast,
// cooling as it drifts away.
function drawChunk(ctx, p, fade) {
  const k = p.age / p.life;
  const heat = p.heat * (1 - k * 0.8);
  const toward = Math.atan2(p.cy - p.y, p.cx - p.x) - p.rot;
  const hx = Math.cos(toward);
  const hy = Math.sin(toward);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(p.r, p.r);
  ctx.globalAlpha = clamp(fade * 1.6);
  ctx.beginPath();
  p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const g = ctx.createLinearGradient(hx, hy, -hx, -hy);
  g.addColorStop(0, `rgba(255,${Math.round(150 + 80 * heat)},${Math.round(90 + 60 * heat)},1)`);
  g.addColorStop(0.3, `rgb(${Math.round(90 + 90 * heat)},${Math.round(32 + 30 * heat)},18)`);
  g.addColorStop(1, "#0e0605");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  blit(ctx, SPRITES.glow, p.x + hx * p.r * 0.4, p.y + hy * p.r * 0.4, p.r * 1.3, fade * heat * 0.35, true);
}

export function chunkPoints() {
  const n = 6 + Math.floor(Math.random() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
    const r = rand(0.55, 1);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

// --- Shuttlecraft (top view, nose at y = -26, engines at y = 18) --------------
// A Starfleet-style shuttle: a tapered hull with a wraparound cockpit window,
// two warp nacelles on short pylons, red-orange collectors at the nacelle
// fronts, blue warp strips, and an impulse strip across the stern.

const SH = {
  hull: new Path2D("M-4.6 -20 Q0 -27 4.6 -20 L6.8 12 Q6.8 16.6 4.5 17.2 L-4.5 17.2 Q-6.8 16.6 -6.8 12 Z"),
  deck: new Path2D("M-3 -9 L3 -9 L4.1 11 L-4.1 11 Z"),
  window: new Path2D("M-3.9 -18.4 Q0 -22.6 3.9 -18.4 L4.3 -15.2 Q0 -16.6 -4.3 -15.2 Z"),
  pylonL: new Path2D("M-6.6 1.5 L-8.8 3.5 L-8.8 9.5 L-6.7 9.5 Z"),
  pylonR: new Path2D("M6.6 1.5 L8.8 3.5 L8.8 9.5 L6.7 9.5 Z"),
  lines: new Path2D("M0 -14 V15 M-5.6 -2 H5.6 M-6.1 6 H6.1 M-3 -9 L-4.1 11 M3 -9 L4.1 11"),
};

export function rocketPoint(x, y, rot, s, lx, ly) {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  return [x + (lx * c - ly * n) * s, y + (lx * n + ly * c) * s];
}

function plume(ctx, x, y, w, len, inner, outer) {
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.45, y + len * 0.5, x, y + len);
  ctx.quadraticCurveTo(x + w * 0.45, y + len * 0.5, x + w / 2, y);
  ctx.fill();
}

export function drawShuttle(ctx, x, y, rot, s, thrust, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  if (thrust > 0.01) {
    const flick = 0.9 + 0.07 * Math.sin(t * 61) + 0.05 * Math.sin(t * 127);
    const len = (8 + 26 * thrust) * flick;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = thrust;
    for (const nx of [-10.6, 10.6]) {
      ctx.drawImage(SPRITES.blue, nx - 6, 12, 12, 12 + len * 0.6);
      plume(ctx, nx, 18, 3.4, len, "rgba(235,248,255,0.95)", "rgba(90,160,255,0)");
    }
    ctx.drawImage(SPRITES.glow, -9, 11, 18, 12 + len * 0.5);
    plume(ctx, 0, 17.4, 7, len * 0.7, "rgba(255,214,170,0.9)", "rgba(255,90,40,0)");
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Nacelles and pylons.
  ctx.fillStyle = "#8d9bb2";
  ctx.fill(SH.pylonL);
  ctx.fill(SH.pylonR);
  for (const sgn of [-1, 1]) {
    const x0 = sgn < 0 ? -12.6 : 8.6;
    const g = ctx.createLinearGradient(x0, 0, x0 + 4, 0);
    g.addColorStop(0, sgn < 0 ? "#f2f6fc" : "#c2cede");
    g.addColorStop(0.5, "#b8c5d8");
    g.addColorStop(1, sgn < 0 ? "#6d7f9c" : "#55657f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x0, -9.5, 4, 27.5, 2);
    ctx.fill();
    ctx.lineWidth = 0.18;
    ctx.strokeStyle = "#5e7090";
    ctx.stroke();
    const glow = 0.55 + 0.45 * Math.max(thrust, 0.4);
    const w = ctx.createLinearGradient(0, -5, 0, 16);
    w.addColorStop(0, `rgba(255,255,255,${glow})`);
    w.addColorStop(0.3, `rgba(143,220,255,${glow})`);
    w.addColorStop(1, `rgba(63,150,255,${0.3 * glow})`);
    ctx.fillStyle = w;
    ctx.beginPath();
    ctx.roundRect(x0 + 1.4, -5, 1.2, 20, 0.6);
    ctx.fill();
    const bx = x0 + 2;
    const b = ctx.createRadialGradient(bx - 0.5, -8.9, 0.2, bx, -8.2, 2.1);
    b.addColorStop(0, "#ffe6d2");
    b.addColorStop(0.5, "#ff6a46");
    b.addColorStop(1, "#7a1a10");
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.ellipse(bx, -8.2, 2, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    blit(ctx, SPRITES.glow, bx, -8.2, 3.6, 0.55, true);
  }

  // Hull, raised deck, details.
  const hull = ctx.createLinearGradient(-7, 0, 7, 0);
  hull.addColorStop(0, "#f6f9fd");
  hull.addColorStop(0.45, "#dbe3ef");
  hull.addColorStop(1, "#7c8ca8");
  ctx.fillStyle = hull;
  ctx.fill(SH.hull);
  ctx.lineWidth = 0.22;
  ctx.strokeStyle = "#6a7c99";
  ctx.stroke(SH.hull);
  const deck = ctx.createLinearGradient(-4, 0, 4, 0);
  deck.addColorStop(0, "#e6ecf5");
  deck.addColorStop(1, "#97a6bd");
  ctx.fillStyle = deck;
  ctx.fill(SH.deck);
  ctx.lineWidth = 0.12;
  ctx.strokeStyle = "rgba(90,108,138,0.8)";
  ctx.stroke(SH.lines);
  ctx.fillStyle = "#b8452c";
  ctx.fillRect(-5.3, -12.6, 10.6, 0.9);
  ctx.fillRect(-5.1, -11.3, 10.2, 0.35);
  const win = ctx.createLinearGradient(0, -22, 0, -15);
  win.addColorStop(0, "#9fdcff");
  win.addColorStop(0.4, "#1e5a96");
  win.addColorStop(1, "#0a1d3a");
  ctx.fillStyle = win;
  ctx.fill(SH.window);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(-1.6, -19.2, 1.3, 0.4, -0.35, 0, Math.PI * 2);
  ctx.fill();
  const imp = ctx.createLinearGradient(-4, 0, 4, 0);
  imp.addColorStop(0, "#7a1c10");
  imp.addColorStop(0.5, `rgb(255,${Math.round(110 + 90 * thrust)},70)`);
  imp.addColorStop(1, "#7a1c10");
  ctx.fillStyle = imp;
  ctx.fillRect(-4, 16.1, 8, 1.2);
  if (Math.sin(t * 6) > 0.6) {
    blit(ctx, SPRITES.glow, -6.6, 11, 1.6, 1, true);
    blit(ctx, SPRITES.blue, 6.6, 11, 1.6, 1, true);
  }
  ctx.restore();
}

// --- Landing pad ----------------------------------------------------------------

export function drawPad(ctx, x, y, s, t) {
  ctx.save();
  const w = 30 * s;
  const h = 4.5 * s;
  const g = ctx.createLinearGradient(0, y - h, 0, y + h);
  g.addColorStop(0, "#5b5560");
  g.addColorStop(0.5, "#2a2328");
  g.addColorStop(1, "#120d10");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,209,255,0.45)";
  ctx.lineWidth = Math.max(1, 0.5 * s);
  ctx.beginPath();
  ctx.ellipse(x, y - 0.4 * s, w * 0.7, h * 0.6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const on = Math.sin(t * 4 - i * 0.8) > 0.2;
    if (on) blit(ctx, SPRITES.glow, x + Math.cos(a) * w * 0.92, y + Math.sin(a) * h * 0.92, 3 * s, 0.9, true);
  }
}

// --- Ship (art/Ship.jsx geometry, saucer centre at x = 11.4) -------------------

const SX = 11.4;
const SHIP = {
  hull: new Path2D("M9.2 0C8.2 1.9 3.2 2.75-1 2.5-5.4 2.2-8.4 1.35-10.6 0-8.4-1.35-5.4-2.2-1-2.5 3.2-2.75 8.2-1.9 9.2 0Z"),
  pylonA: new Path2D("M-0.2 -2.05L-2.6 -7.05L-5.6 -7.05L-2.6 -1.85Z"),
  pylonB: new Path2D("M-0.2 2.05L-2.6 7.05L-5.6 7.05L-2.6 1.85Z"),
  lines: new Path2D("M6.6 0H-9.4M-4.2 -1.35V1.35"),
  grid: new Path2D(
    [-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180]
      .map((deg) => {
        const a = (deg * Math.PI) / 180;
        return `M${SX + Math.cos(a) * 1.9} ${Math.sin(a) * 1.9}L${SX + Math.cos(a) * 6.3} ${Math.sin(a) * 6.3}`;
      })
      .join(""),
  ),
};

export function shipPoint(x, y, rot, s, lx, ly) {
  return rocketPoint(x, y, rot, s, lx, ly);
}

export function drawShip(ctx, x, y, rot, s, power, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  const lit = 0.35 + 0.65 * power;
  if (power > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.28 * power;
    ctx.drawImage(SPRITES.blue, -20, -14, 44, 28);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  for (const y0 of [-8.16, 8.16]) {
    const g = ctx.createLinearGradient(0, y0 - 1.02, 0, y0 + 1.02);
    g.addColorStop(0, "#eef3fb");
    g.addColorStop(0.45, "#aebdd3");
    g.addColorStop(1, "#4f6282");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-11.4, y0 - 1.02, 16, 2.05, 1.02);
    ctx.fill();
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = "#6f8cb0";
    ctx.stroke();
    const w = ctx.createLinearGradient(-9.6, 0, 2.8, 0);
    w.addColorStop(0, `rgba(63,180,255,${0.15 * lit})`);
    w.addColorStop(0.65, `rgba(143,220,255,${lit})`);
    w.addColorStop(1, `rgba(255,255,255,${lit})`);
    ctx.fillStyle = w;
    ctx.beginPath();
    ctx.roundRect(-9.6, y0 - 0.35, 12.4, 0.7, 0.35);
    ctx.fill();
    if (power > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.6 * power;
      ctx.drawImage(SPRITES.blue, -10, y0 - 2.2, 14, 4.4);
      ctx.drawImage(SPRITES.blue, -15, y0 - 1.6, 5, 3.2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    const b = ctx.createRadialGradient(3.9, y0 - 0.3, 0.1, 4.15, y0, 0.95);
    b.addColorStop(0, "#ffe2cc");
    b.addColorStop(0.55, `rgba(255,${Math.round(90 + 40 * power)},70,1)`);
    b.addColorStop(1, "#7a1a10");
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(4.15, y0, 0.9, 0, Math.PI * 2);
    ctx.fill();
    if (power > 0) blit(ctx, SPRITES.glow, 4.15, y0, 2.4, 0.7 * power, true);
  }
  ctx.fillStyle = "#a9b7cd";
  ctx.fill(SHIP.pylonA);
  ctx.fill(SHIP.pylonB);
  const hull = ctx.createLinearGradient(0, -2.7, 0, 2.7);
  hull.addColorStop(0, "#eef3fb");
  hull.addColorStop(0.5, "#b3c1d8");
  hull.addColorStop(1, "#5f7393");
  ctx.fillStyle = hull;
  ctx.fill(SHIP.hull);
  ctx.lineWidth = 0.16;
  ctx.strokeStyle = "#6f87a6";
  ctx.stroke(SHIP.hull);
  ctx.stroke(SHIP.lines);
  const saucer = ctx.createRadialGradient(SX - 2.4, -2.2, 0.5, SX, 0, 7.2);
  saucer.addColorStop(0, "#ffffff");
  saucer.addColorStop(0.5, "#dbe5f4");
  saucer.addColorStop(1, "#7489ab");
  ctx.fillStyle = saucer;
  ctx.beginPath();
  ctx.arc(SX, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.2;
  ctx.strokeStyle = "#7f93ad";
  ctx.stroke();
  ctx.lineWidth = 0.13;
  ctx.strokeStyle = "#6f87a6";
  ctx.stroke(SHIP.grid);
  for (const r of [4.9, 2.7]) {
    ctx.beginPath();
    ctx.arc(SX, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(255,${Math.round(120 + 60 * power)},90,${0.6 + 0.4 * power})`;
  for (const sgn of [-1, 1]) {
    ctx.save();
    ctx.translate(5.46, 3.71 * sgn);
    ctx.rotate(sgn * ((58 * Math.PI) / 180));
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.25, 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (power > 0) blit(ctx, SPRITES.glow, 5.46, 3.71 * sgn, 2, 0.5 * power, true);
  }
  ctx.fillStyle = "#cfe6ff";
  ctx.beginPath();
  ctx.arc(SX + 2.1, 0, 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const blink = (t * 0.8) % 1 < 0.14;
  if (blink) {
    blit(ctx, SPRITES.glow, SX, -6.45, 1.6, 1, true);
    blit(ctx, SPRITES.blue, SX, 6.45, 1.6, 1, true);
  }
  ctx.restore();
}

// --- HUD-ish docking reticle --------------------------------------------------

export function drawReticle(ctx, x, y, size, color, alpha) {
  if (alpha <= 0) return;
  const arm = size * 0.38;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = x + sx * size;
    const cy = y + sy * size;
    ctx.moveTo(cx - sx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - sy * arm);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Lens effects -------------------------------------------------------------

export function drawStreak(ctx, x, y, W, alpha, tint = "140,185,255") {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [h, a] of [[2.2, 0.55], [14, 0.1]]) {
    const g = ctx.createLinearGradient(x - W * 0.5, 0, x + W * 0.5, 0);
    g.addColorStop(0, `rgba(${tint},0)`);
    g.addColorStop(0.5, `rgba(${tint},${a * alpha})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - W * 0.5, y - h / 2, W, h);
  }
  ctx.restore();
}

export function drawFlare(ctx, sx, sy, W, H, alpha) {
  if (alpha <= 0.01) return;
  drawStreak(ctx, sx, sy, W * 0.9, alpha);
  const vx = W / 2 - sx;
  const vy = H / 2 - sy;
  const ghosts = [[0.45, 0.05, "blue"], [0.8, 0.025, "glow"], [1.25, 0.07, "blue"], [1.6, 0.04, "glow"]];
  for (const [k, r, img] of ghosts) {
    blit(ctx, SPRITES[img], sx + vx * k, sy + vy * k, Math.min(W, H) * r, 0.16 * alpha, true);
  }
}

// --- Cockpit window (static parts pre-rendered once per size) -----------------

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function buildCockpit(W, H, dpr) {
  const make = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return [c, g];
  };
  const portrait = W < H;
  // Clear of the 8vh letterbox bars at top and bottom.
  const win = portrait
    ? { x: W * 0.07, y: H * 0.12, w: W * 0.86, h: H * 0.56 }
    : { x: W * 0.09, y: H * 0.12, w: W * 0.82, h: H * 0.57 };
  win.r = Math.min(win.w, win.h) * 0.08;
  const [frame, g] = make();

  // Interior hull plating.
  const wall = g.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, "#0a0e17");
  wall.addColorStop(0.6, "#121926");
  wall.addColorStop(1, "#070a10");
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  g.lineWidth = 1;
  for (let x = 0; x < W; x += Math.max(60, W / 12)) {
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
    g.strokeStyle = "rgba(140,170,220,0.06)";
    g.beginPath();
    g.moveTo(x + 1, 0);
    g.lineTo(x + 1, H);
    g.stroke();
  }
  for (const y of [H * 0.035, win.y + win.h + H * 0.045]) {
    g.strokeStyle = "rgba(140,170,220,0.08)";
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }

  // Console under the window: a sloped desk with screens and buttons.
  const deskTop = win.y + win.h + H * 0.08;
  const desk = g.createLinearGradient(0, deskTop, 0, H);
  desk.addColorStop(0, "#1c2434");
  desk.addColorStop(0.15, "#111723");
  desk.addColorStop(1, "#05070b");
  g.fillStyle = desk;
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(W * 0.04, deskTop);
  g.lineTo(W * 0.96, deskTop);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(170,200,255,0.22)";
  g.beginPath();
  g.moveTo(W * 0.04, deskTop);
  g.lineTo(W * 0.96, deskTop);
  g.stroke();
  const screens = portrait ? [[0.12, 0.3], [0.58, 0.3]] : [[0.16, 0.18], [0.41, 0.18], [0.66, 0.18]];
  const sh = (H - deskTop) * 0.34;
  for (const [sx, sw] of screens) {
    const x = W * sx;
    const y = deskTop + (H - deskTop) * 0.22;
    const w = W * sw;
    const scr = g.createLinearGradient(0, y, 0, y + sh);
    scr.addColorStop(0, "#0b2a3a");
    scr.addColorStop(1, "#061620");
    g.fillStyle = scr;
    roundedRect(g, x, y, w, sh, 6);
    g.fill();
    g.strokeStyle = "rgba(90,209,255,0.35)";
    g.stroke();
    g.strokeStyle = "rgba(90,209,255,0.6)";
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = x + 8 + ((w - 16) * i) / 24;
      const py = y + sh * 0.55 + Math.sin(i * 0.9 + sx * 10) * sh * 0.18;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  }
  const lights = [];
  const rowY = deskTop + (H - deskTop) * 0.7;
  const count = portrait ? 8 : 16;
  for (let i = 0; i < count; i++) {
    const x = W * (0.12 + (0.76 * i) / (count - 1));
    g.fillStyle = "#0b0f17";
    roundedRect(g, x - 7, rowY - 4, 14, 8, 2);
    g.fill();
    lights.push({ x, y: rowY, hue: ["#5ad1ff", "#7ddec0", "#ffb020", "#ff7a8a"][i % 4], phase: Math.random() * 6, rate: rand(0.6, 2.2) });
  }

  // Cut the window, then frame it.
  g.save();
  g.globalCompositeOperation = "destination-out";
  roundedRect(g, win.x, win.y, win.w, win.h, win.r);
  g.fill();
  g.restore();

  const bevel = g.createLinearGradient(0, win.y, 0, win.y + win.h);
  bevel.addColorStop(0, "#8a9bb5");
  bevel.addColorStop(0.18, "#2a3446");
  bevel.addColorStop(0.82, "#1b2230");
  bevel.addColorStop(1, "#56657d");
  g.lineWidth = Math.max(14, W * 0.014);
  g.strokeStyle = bevel;
  roundedRect(g, win.x, win.y, win.w, win.h, win.r);
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(200,220,255,0.35)";
  const inset = g.lineWidth + Math.max(7, W * 0.007);
  roundedRect(g, win.x + inset, win.y + inset, win.w - inset * 2, win.h - inset * 2, Math.max(4, win.r - inset));
  g.stroke();

  // Two struts, clear of the centre where the planet sits.
  for (const fx of [0.2, 0.8]) {
    const sx = win.x + win.w * fx;
    const sw = Math.max(10, W * 0.011);
    const st = g.createLinearGradient(sx - sw / 2, 0, sx + sw / 2, 0);
    st.addColorStop(0, "#151b27");
    st.addColorStop(0.4, "#6b7b94");
    st.addColorStop(1, "#111620");
    g.fillStyle = st;
    g.fillRect(sx - sw / 2, win.y, sw, win.h);
    g.fillStyle = "#a9b7cc";
    for (const fy of [0.08, 0.5, 0.92]) {
      g.beginPath();
      g.arc(sx, win.y + win.h * fy, sw * 0.18, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Glass: a faint diagonal reflection and the console glow reflected low down.
  g.save();
  roundedRect(g, win.x, win.y, win.w, win.h, win.r);
  g.clip();
  const refl = g.createLinearGradient(win.x, win.y, win.x + win.w * 0.6, win.y + win.h);
  refl.addColorStop(0, "rgba(255,255,255,0.07)");
  refl.addColorStop(0.3, "rgba(255,255,255,0.015)");
  refl.addColorStop(0.31, "rgba(255,255,255,0.04)");
  refl.addColorStop(0.36, "rgba(255,255,255,0)");
  g.fillStyle = refl;
  g.fillRect(win.x, win.y, win.w, win.h);
  const low = g.createLinearGradient(0, win.y + win.h * 0.75, 0, win.y + win.h);
  low.addColorStop(0, "rgba(90,209,255,0)");
  low.addColorStop(1, "rgba(90,209,255,0.06)");
  g.fillStyle = low;
  g.fillRect(win.x, win.y, win.w, win.h);
  g.restore();

  // A copy of the interior washed in explosion light, faded in per frame.
  const [litCanvas, lg] = make();
  lg.setTransform(1, 0, 0, 1, 0, 0);
  lg.drawImage(frame, 0, 0);
  lg.globalCompositeOperation = "source-atop";
  lg.scale(dpr, dpr);
  const cx = W * 0.5;
  const cy = win.y + win.h * 0.48;
  const wash = lg.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
  wash.addColorStop(0, "rgba(255,226,180,0.95)");
  wash.addColorStop(0.35, "rgba(255,140,70,0.6)");
  wash.addColorStop(1, "rgba(160,50,20,0.25)");
  lg.fillStyle = wash;
  lg.fillRect(0, 0, W, H);

  return { frame, lit: litCanvas, win, lights };
}

export function drawCockpit(ctx, cockpit, W, H, light, t) {
  ctx.drawImage(cockpit.frame, 0, 0, W, H);
  if (light > 0.005) {
    ctx.globalAlpha = Math.min(1, light);
    ctx.drawImage(cockpit.lit, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  for (const l of cockpit.lights) {
    const on = Math.sin(t * l.rate + l.phase) > -0.2;
    if (!on) continue;
    ctx.fillStyle = l.hue;
    ctx.fillRect(l.x - 5, l.y - 2.5, 10, 5);
    blit(ctx, SPRITES.blue, l.x, l.y, 12, 0.18, true);
  }
}
