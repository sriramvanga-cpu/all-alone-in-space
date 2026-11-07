import { useEffect, useRef, useState } from "react";
import { createSpaceRenderer } from "./space.js";
import {
  Particles, SPRITES, blit, buildCockpit, chunkPoints, clamp, drawCockpit, drawFlare, drawPad, drawReticle,
  drawShip, drawShuttle, drawStreak, easeIn, easeInOut, easeOut, lerp, rand, rocketPoint, shipPoint, smooth,
} from "./draw.js";

// Fallback intro, drawn in 2D over a WebGL space pass. Intro.jsx uses it when
// the 3D intro (Intro3D.jsx) cannot start: no WebGL or textures that fail to load.
// One continuous shot, no cuts:
//   Launch     the shuttle lifts off Vulcan and the camera climbs with it.
//   Docking    the planet sweeps away, the ship glides into frame, the shuttle docks.
//   Push in    the camera dives into the ship's bridge window until the glass fills the screen.
//   Look back  it pulls back inside the cockpit; through the window Vulcan cracks and breaks apart.
const LIFT = 1.0;
const A_END = 5.4;
const DOCK = 8.4;
const ZOOM0 = 9.6;
const INSIDE = 10.6;
const BOOM = INSIDE + 2.6;
const END = INSIDE + 6.4;
const BRIDGE_X = 13.5;

// The same story as the 3D intro, in the time this film has.
const CAPTIONS = [
  { from: 0.7, to: 5.0, title: "Vulcan is dying", text: "Its core is collapsing, and quakes are tearing the planet apart." },
  { from: 5.6, to: 9.4, title: "The last shuttle out", text: "Everyone else has fled. Your crew races for the starship in orbit." },
  { from: INSIDE - 0.4, to: BOOM - 0.2, title: "Full speed away", text: "Vulcan has only seconds left." },
  { from: BOOM + 0.4, to: END - 0.4, title: "Find a new home", text: "The blast damaged life support: 15 minutes of air. Land on a world marked ! in time." },
];

function captionAt(T) {
  return CAPTIONS.findIndex((c) => T >= c.from && T < c.to);
}

// Black only at the very start and the very end; everything between is one shot.
function blackAt(T) {
  return 1 - smooth(0, 1, T) * (1 - smooth(END - 0.8, END, T));
}

function bezier(p0, p1, p2, p3, u) {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function bezierTangent(p0, p1, p2, p3, u) {
  const v = 1 - u;
  const tx = 3 * v * v * (p1[0] - p0[0]) + 6 * v * u * (p2[0] - p1[0]) + 3 * u * u * (p3[0] - p2[0]);
  const ty = 3 * v * v * (p1[1] - p0[1]) + 6 * v * u * (p2[1] - p1[1]) + 3 * u * u * (p3[1] - p2[1]);
  const len = Math.hypot(tx, ty) || 1;
  return [tx / len, ty / len];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const mixv = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

// The launch, as a pure function of time: where the ground is and where the shuttle is.
function launchAt(T, W, H) {
  const S = Math.max(W, H);
  const a = clamp(T / A_END);
  const fall = easeInOut(smooth(0.2, 1, a));
  const hy = H * (0.64 + 0.17 * fall);
  const R = S * Math.exp(lerp(Math.log(5), Math.log(1.05), fall));
  const cx = W * (0.52 - 0.05 * a);
  const rs0 = H * 0.003;
  const rs = rs0 * (1 - 0.35 * fall);
  const padX = W * 0.36;
  const climb = easeInOut(clamp((T - LIFT) / 2.8));
  const turn = easeIn(clamp((T - LIFT) / 4.4));
  const y = lerp(H * 0.64 - 17.5 * rs0, H * 0.5, climb) - smooth(3.6, A_END, T) * H * 0.04;
  const x = padX + W * 0.05 * turn;
  const rot = 0.24 * turn + 0.5 * smooth(3.8, A_END, T);
  const thrust = clamp((T - (LIFT - 0.45)) / 0.45);
  return { S, hy, R, cx, rs, rs0, padX, x, y, rot, thrust, fall };
}

// Where the ship sits: it glides in from the upper right as the camera reaches orbit.
function shipAt(T, W, H) {
  const portrait = W < H;
  const enter = easeOut(smooth(4.6, 7.0, T));
  const ss = ((portrait ? W * 0.62 : Math.min(W * 0.42, H * 0.62)) / 34) * (1 + 0.05 * smooth(A_END, ZOOM0, T));
  return {
    x: lerp(W * 1.35, W * (portrait ? 0.6 : 0.66), enter) + Math.sin(T * 0.6) * W * 0.006,
    y: lerp(-H * 0.15, H * 0.34, enter) + Math.sin(T * 0.45) * H * 0.006,
    rot: -0.12,
    ss,
  };
}

// Space-pass settings for the launch and for orbit; the shot blends between them.
function spaceLaunch(T, W, H) {
  const L = launchAt(T, W, H);
  return {
    planet: [L.cx, L.hy + L.R, L.R],
    light: [0.55, 0.5, 0.35],
    atm: clamp(L.R * 0.07, 10, 150),
    sun: [W * 0.84, L.hy - H * 0.05 - L.fall * H * 0.1, 1 - L.fall * 0.35],
    cam: [0, (L.hy - H * 0.64) * 0.3],
    neb: 0.6 + 0.4 * L.fall,
  };
}

function spaceOrbit(T, W, H) {
  const S = Math.max(W, H);
  const end = spaceLaunch(A_END, W, H);
  return {
    planet: [W * 0.08, H * 0.62 + S, S],
    light: [0.75, 0.55, 0.35],
    atm: clamp(S * 0.05, 10, 90),
    sun: [W * 1.02, -H * 0.08, 0.7],
    cam: [Math.max(0, T - A_END) * 8, end.cam[1]],
    neb: 1,
  };
}

// Used only when WebGL is missing: a flat lit disc, so the story still reads.
function drawFallbackSpace(ctx, W, H, u) {
  ctx.fillStyle = "#03050b";
  ctx.fillRect(0, 0, W, H);
  const [x, y, r] = u.planet;
  if (u.boom < 1) {
    ctx.globalAlpha = 1 - u.boom;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, "#f2b07a");
    g.addColorStop(0.5, "#b4502a");
    g.addColorStop(1, "#2a0c08");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (u.flash > 0) blit(ctx, SPRITES.glow, x, y, r * 4, u.flash, true);
}

// Bright glass that fills the screen as the camera passes through the bridge window.
function drawGlass(ctx, W, H, alpha) {
  if (alpha <= 0.005) return;
  const g = ctx.createRadialGradient(W * 0.45, H * 0.4, 0, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, `rgba(236,248,255,${alpha})`);
  g.addColorStop(0.55, `rgba(176,218,250,${alpha})`);
  g.addColorStop(1, `rgba(96,150,210,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawStreak(ctx, W * 0.5, H * 0.42, W * 1.6, alpha * 0.6, "255,255,255");
}

export default function ClassicIntro({ onDone }) {
  const stageRef = useRef(null);
  const glRef = useRef(null);
  const fxRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [caption, setCaption] = useState(-1);

  useEffect(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      doneRef.current();
    };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const space = createSpaceRenderer(glRef.current);
    const fxCanvas = fxRef.current;
    const ctx = fxCanvas.getContext("2d");
    let W = 0;
    let H = 0;
    let dpr = 1;
    let cockpit = null;
    // The space pass is the expensive part; it renders below device resolution
    // and drops further if frames run slow (see the check in frame()).
    let glScale = Math.min(window.devicePixelRatio || 1, 1.5);
    let slowSum = 0;
    let slowN = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      space?.resize(W, H, glScale);
      fxCanvas.width = Math.round(W * dpr);
      fxCanvas.height = Math.round(H * dpr);
      cockpit = buildCockpit(W, H, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    const smoke = new Particles();
    const sparks = new Particles();
    const debris = new Particles();
    let prevGround = null;
    let docked = false;
    let boomed = false;
    let wentInside = false;
    let trailCleared = false;
    let lastRcs = 0;
    let shown = -1;
    const start = performance.now();
    let last = start;
    let raf = 0;

    function frame(now) {
      const T = (now - start) / 1000;
      const rawDt = (now - last) / 1000;
      const dt = Math.min(0.05, rawDt);
      last = now;
      if (space && rawDt < 0.25) {
        slowSum += rawDt;
        slowN += 1;
        if (slowN === 45) {
          if (slowSum / slowN > 0.022 && glScale > 0.6) {
            glScale = Math.max(0.6, glScale * 0.75);
            space.resize(W, H, glScale);
          }
          slowSum = 0;
          slowN = 0;
        }
      }
      if (T >= END) {
        finish();
        return;
      }
      const cap = captionAt(T);
      if (cap !== shown) {
        shown = cap;
        setCaption(cap);
      }

      const u = {
        time: T,
        planet: [W / 2, H / 2, 100],
        light: [0, 0, 1],
        rot: 0.6 + T * 0.012,
        atm: 20,
        crack: 0,
        boom: 0,
        flash: 0,
        ring: [0, 0, 0.2, 0],
        sun: [0, 0, 0],
        cam: [0, 0],
        neb: 1,
      };
      const draws = [];
      let shake = 0;

      if (T < INSIDE) {
        // --- Outside: launch, climb to orbit, docking, push into the bridge ---
        const blend = easeInOut(smooth(4.4, 6.6, T));
        const sa = spaceLaunch(Math.min(T, A_END), W, H);
        const sb = spaceOrbit(T, W, H);
        u.planet = mixv(sa.planet, sb.planet, blend);
        u.light = norm(mixv(norm(sa.light), norm(sb.light), blend));
        u.atm = lerp(sa.atm, sb.atm, blend);
        u.sun = mixv(sa.sun, sb.sun, blend);
        u.cam = mixv(sa.cam, sb.cam, blend);
        u.neb = lerp(sa.neb, sb.neb, blend);

        // The pad stays bolted to the planet surface as the planet slides away.
        const LA = launchAt(Math.min(T, A_END), W, H);
        const padAngle = Math.atan2(LA.hy - (LA.hy + LA.R), LA.padX - LA.cx);
        const ground = [u.planet[0] + Math.cos(padAngle) * u.planet[2], u.planet[1] + Math.sin(padAngle) * u.planet[2]];
        const shift = prevGround ? [ground[0] - prevGround[0], ground[1] - prevGround[1]] : [0, 0];
        prevGround = ground;

        const ship = shipAt(T, W, H);
        const fwd = [Math.cos(ship.rot), Math.sin(ship.rot)];
        const D = shipPoint(ship.x, ship.y, ship.rot, ship.ss, -10.4, 0);

        // The shuttle: launch path until A_END, then one smooth curve to the port.
        let sx;
        let sy;
        let srot;
        let srs;
        let thrust;
        if (T < A_END) {
          sx = LA.x;
          sy = LA.y;
          srot = LA.rot;
          srs = LA.rs;
          thrust = LA.thrust;
        } else {
          const L0 = launchAt(A_END, W, H);
          const P0 = rocketPoint(L0.x, L0.y, L0.rot, L0.rs, 0, -26);
          const dir0 = [Math.sin(L0.rot), -Math.cos(L0.rot)];
          const C1 = [P0[0] + dir0[0] * W * 0.12, P0[1] + dir0[1] * W * 0.12];
          const C2 = [D[0] - fwd[0] * W * 0.16, D[1] - fwd[1] * W * 0.16];
          const k = smooth(A_END, DOCK, T);
          const nose = T >= DOCK ? D : bezier(P0, C1, C2, D, k);
          const dir = T >= DOCK || k > 0.999 ? fwd : bezierTangent(P0, C1, C2, D, k);
          srs = lerp(L0.rs, ship.ss * 0.16, smooth(A_END, DOCK - 0.5, T));
          srot = Math.atan2(dir[1], dir[0]) + Math.PI / 2;
          sx = nose[0] - dir[0] * 26 * srs;
          sy = nose[1] - dir[1] * 26 * srs;
          thrust = T < DOCK - 0.9 ? 1 : clamp((DOCK - 0.6 - T) / 0.3);
          if (T > DOCK - 1.1 && T < DOCK - 0.1 && T - lastRcs > 0.12) {
            lastRcs = T;
            for (const side of [-1, 1]) {
              const [px, py] = rocketPoint(sx, sy, srot, srs, side * 6, -18);
              smoke.add({ img: SPRITES.smoke, x: px, y: py, vx: dir[0] * 0.08 * H + side * 0.02 * H, vy: dir[1] * 0.08 * H, r: 2 * srs, grow: 9 * srs, life: 0.55, alpha: 0.7 });
            }
          }
        }
        const [nx, ny] = rocketPoint(sx, sy, srot, srs, 0, 19);

        // Lift-off dust, then a vapour trail while still in the air.
        if (thrust > 0 && T < LIFT + 1.5) {
          for (let i = 0; i < 4; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            smoke.add({
              img: SPRITES.smoke, x: LA.padX + rand(-6, 6) * LA.rs, y: LA.hy - rand(0, 5) * LA.rs,
              vx: side * rand(0.04, 0.32) * H, vy: -rand(0, 0.05) * H, r: rand(6, 12) * LA.rs,
              grow: rand(10, 24) * LA.rs, life: rand(1.8, 3), drag: 1.2, alpha: 0.5,
            });
          }
        }
        if (T > LIFT && T < 6.4) {
          const thin = 1 - smooth(4.2, 6.4, T);
          for (let i = 0; i < 2; i++) {
            smoke.add({
              img: SPRITES.smoke, x: nx + rand(-2, 2) * srs, y: ny + rand(0, 4) * srs,
              vx: rand(-0.012, 0.012) * H, vy: rand(0.005, 0.03) * H, r: rand(3, 6) * srs,
              grow: rand(6, 12) * srs, life: rand(1.6, 2.8), drag: 0.6, alpha: 0.42 * thin,
            });
          }
        }
        if (thrust > 0 && T > LIFT) {
          sparks.add({ img: SPRITES.blue, x: nx, y: ny, vx: 0, vy: 0, r: 6 * srs, grow: 8 * srs, life: 0.3, alpha: 0.5 * thrust, additive: true });
        }
        if (T >= DOCK && !docked) {
          docked = true;
          for (let i = 0; i < 28; i++) {
            const a = rand(0, Math.PI * 2);
            const sp = rand(0.02, 0.14) * H;
            sparks.add({ img: SPRITES.spark, x: D[0], y: D[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1.5, 3.5), life: rand(0.3, 0.8), drag: 2, alpha: 1, additive: true });
          }
        }
        // The faded launch trail is dropped before the docking thruster puffs start.
        if (T >= DOCK - 1.2 && !trailCleared) {
          trailCleared = true;
          smoke.clear();
        }
        smoke.step(dt, T < A_END ? shift[1] : 0, T < A_END ? shift[0] : 0);
        sparks.step(dt);

        const power = smooth(DOCK + 0.2, DOCK + 1.3, T);
        const contact = T >= DOCK ? Math.exp(-(T - DOCK) * 5) : 0;
        const ret = smooth(DOCK - 1.7, DOCK - 1.2, T) * (1 - smooth(DOCK + 0.3, DOCK + 0.8, T));
        const retSize = lerp(ship.ss * 14, ship.ss * 3.4, easeOut((T - (DOCK - 1.7)) / 1.7));

        // Push in: everything scales around the bridge window.
        const z = clamp((T - ZOOM0) / (INSIDE - ZOOM0));
        const Z = Math.exp(Math.log(80) * easeIn(z));
        const F = shipPoint(ship.x, ship.y, ship.rot, ship.ss, BRIDGE_X, 0);
        if (Z > 1.0001) {
          u.planet = [F[0] + (u.planet[0] - F[0]) * Z, F[1] + (u.planet[1] - F[1]) * Z, u.planet[2] * Z];
          u.atm *= Z;
        }
        const padFade = 1 - smooth(4.6, 5.6, T);
        const sunFade = 1 - blend;

        draws.push(() => {
          ctx.save();
          if (Z > 1.0001) {
            ctx.translate(F[0], F[1]);
            ctx.scale(Z, Z);
            ctx.translate(-F[0], -F[1]);
          }
          if (padFade > 0) {
            ctx.globalAlpha = padFade;
            if (thrust > 0 && T < LIFT + 1.6) {
              const g = clamp(1 - (T - LIFT) / 1.6) * thrust;
              blit(ctx, SPRITES.blue, ground[0], ground[1], 60 * LA.rs, g * 0.7, true);
            }
            drawPad(ctx, ground[0], ground[1], LA.rs0 * (1 - 0.35 * LA.fall), T);
            ctx.globalAlpha = 1;
          }
          smoke.draw(ctx, 1 - smooth(A_END, A_END + 1.2, T) * (T < DOCK - 1.2 ? 1 : 0));
          if (T > 4.5) drawShip(ctx, ship.x, ship.y, ship.rot, ship.ss, power, T);
          sparks.draw(ctx);
          drawShuttle(ctx, sx, sy, srot, srs, thrust, T);
          if (contact > 0) {
            blit(ctx, SPRITES.blue, D[0], D[1], ship.ss * 9 * (1.2 - contact * 0.4), contact, true);
            blit(ctx, SPRITES.spark, D[0], D[1], ship.ss * 3, contact, true);
          }
          drawReticle(ctx, D[0], D[1], retSize, T < DOCK ? "#5ad1ff" : "#7ddec0", ret * 0.9);
          ctx.restore();
          if (sunFade > 0) drawFlare(ctx, u.sun[0], u.sun[1], W, H, u.sun[2] * 0.9 * sunFade);
          drawGlass(ctx, W, H, smooth(0.55, 1, z));
        });
      } else {
        // --- Inside: pull back from the glass, then Vulcan breaks apart -------
        if (!wentInside) {
          wentInside = true;
          smoke.clear();
          sparks.clear();
        }
        const t = T - INSIDE;
        const win = cockpit.win;
        const pc = [W * 0.5, win.y + win.h * 0.48];
        const sc = lerp(1.8, 1, easeOut(t / 0.9));
        const R = Math.min(W, H) * 0.15 * (1 + 0.035 * (t / (END - INSIDE))) * sc;
        const since = T - BOOM;
        u.planet = [pc[0], pc[1], R];
        u.light = norm([-0.65, 0.35, 0.68]);
        u.rot = 4.0 + t * 0.02;
        u.atm = clamp(R * 0.1, 8, 30);
        u.cam = [t * 3, 0];
        u.crack = smooth(INSIDE + 1.4, BOOM, T);
        u.flash = since >= 0 ? Math.exp(-since * 3) * (reduce ? 0.4 : 1) : 0;
        u.boom = since >= 0 ? easeOut(since / 2.8) : 0;
        if (since >= 0) {
          const grow = 1 - Math.pow(1 - clamp(since / 2.8), 4);
          u.ring = [R * (1 + grow * ((W * 1.5) / R)), (1 - clamp(since / 3)) * 1.3, 0.2, -0.12];
        }
        const tremor = T > INSIDE + 1.6 && since < 0 ? 2.5 * smooth(INSIDE + 1.6, BOOM, T) : 0;
        const blast = since >= 0 ? 16 * Math.exp(-since * 2.2) : 0;
        shake = reduce ? 0 : tremor + blast;

        if (since >= 0 && !boomed) {
          boomed = true;
          for (let i = 0; i < 280; i++) {
            const a = rand(0, Math.PI * 2);
            const r0 = R * Math.sqrt(Math.random()) * 0.95;
            const sp = R * (0.6 + 6 * Math.random() ** 2);
            debris.add({ ember: true, x: pc[0] + Math.cos(a) * r0, y: pc[1] + Math.sin(a) * r0 * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.85, r: rand(1.1, 3), life: rand(1.2, 3.6), drag: 0.55 });
          }
          for (let i = 0; i < 40; i++) {
            const a = rand(0, Math.PI * 2);
            const r0 = R * Math.sqrt(Math.random()) * 0.6;
            const sp = R * rand(0.2, 0.9);
            debris.add({ img: SPRITES.dust, x: pc[0] + Math.cos(a) * r0, y: pc[1] + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: R * rand(0.3, 0.6), grow: R * 0.5, life: rand(2.5, 4), drag: 0.4, alpha: 0.4 });
          }
          for (let i = 0; i < 34; i++) {
            const a = rand(0, Math.PI * 2);
            const r0 = R * Math.sqrt(Math.random()) * 0.85;
            const sp = R * rand(0.25, 1.6);
            debris.add({ chunk: true, pts: chunkPoints(), cx: pc[0], cy: pc[1], x: pc[0] + Math.cos(a) * r0, y: pc[1] + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: R * rand(0.04, 0.13), grow: R * rand(0, 0.05), spin: rand(-1.6, 1.6), rot: rand(0, 6), life: rand(3.6, 5.2), drag: 0.25, heat: rand(0.5, 1) });
          }
        }
        debris.step(dt);
        const remnant = since >= 0 ? Math.exp(-since * 0.9) : 0;
        const light = Math.min(1, u.flash * 1.1 + u.crack * 0.12 + remnant * 0.25);
        const glass = 1 - smooth(INSIDE, INSIDE + 0.6, T);

        draws.push(() => {
          if (u.crack > 0 && since < 0) blit(ctx, SPRITES.glow, pc[0], pc[1], R * 1.5, u.crack * 0.35, true);
          debris.draw(ctx);
          if (remnant > 0) blit(ctx, SPRITES.glow, pc[0], pc[1], R * (1.4 + since * 0.7), remnant * 0.85, true);
          ctx.save();
          if (sc > 1.0001) {
            ctx.translate(pc[0], pc[1]);
            ctx.scale(sc, sc);
            ctx.translate(-pc[0], -pc[1]);
          }
          drawCockpit(ctx, cockpit, W, H, light, T);
          ctx.restore();
          drawStreak(ctx, pc[0], pc[1], W * 1.4, u.flash, "255,200,150");
          drawGlass(ctx, W, H, glass);
        });
      }

      if (space) space.render(u);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!space) drawFallbackSpace(ctx, W, H, u);
      for (const d of draws) d();
      const black = blackAt(T);
      if (black > 0.002) {
        ctx.fillStyle = `rgba(2,3,7,${black})`;
        ctx.fillRect(0, 0, W, H);
      }
      const stage = stageRef.current;
      if (stage) {
        stage.style.transform = shake > 0.05
          ? `translate(${(Math.sin(T * 83) + Math.sin(T * 47)) * shake * 0.5}px, ${(Math.sin(T * 71) + Math.cos(T * 53)) * shake * 0.5}px)`
          : "";
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const onKey = (e) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      space?.dispose();
    };
  }, []);

  return (
    <main className="opener">
      <div className="intro-stage" ref={stageRef} aria-hidden="true">
        <canvas className="intro-gl" ref={glRef} />
        <canvas className="intro-fx" ref={fxRef} />
      </div>
      <div className="letterbox top" aria-hidden="true" />
      <div className="letterbox bottom" aria-hidden="true" />
      <div className="opener-copy" aria-live="polite">
        {CAPTIONS.map((c, i) => (
          <div key={c.title} className={i === caption ? "cap show" : "cap"}>
            <p className="eyebrow">
              {String(i + 1).padStart(2, "0")} / {String(CAPTIONS.length).padStart(2, "0")} · Nova Grid
            </p>
            <h1>{c.title}</h1>
            <p>{c.text}</p>
          </div>
        ))}
      </div>
      <button type="button" className="skip" onClick={() => doneRef.current()}>
        Skip
      </button>
    </main>
  );
}
