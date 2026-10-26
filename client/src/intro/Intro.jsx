import { useEffect, useRef, useState } from "react";
import { createSpaceRenderer } from "./space.js";
import {
  Particles, SPRITES, blit, buildCockpit, chunkPoints, clamp, drawCockpit, drawFlare, drawReticle,
  drawRocket, drawShip, drawStreak, drawTower, easeIn, easeInOut, easeOut, lerp, rand, rocketPoint,
  shipPoint, smooth,
} from "./draw.js";

// One continuous cinematic in three scenes:
//   A. Departure  the rocket lifts off Vulcan and the ground falls away.
//   B. Docking    the rocket closes on the ship and locks on; the ship powers up.
//   C. Look back  through the cockpit window Vulcan cracks, flashes, and breaks apart.
const A_END = 5.4;
const B_END = 10.2;
const C_END = 16.6;

const CAPTIONS = [
  { from: 0.7, to: A_END - 0.4, title: "Departure", text: "A rocket lifts off Vulcan. The ground falls away." },
  { from: A_END + 0.5, to: B_END - 0.4, title: "Docking", text: "The rocket locks onto the ship." },
  { from: B_END + 0.5, to: C_END - 0.7, title: "Look back", text: "Through the window, Vulcan blows apart. The clock starts with the chart." },
];

function captionAt(T) {
  return CAPTIONS.findIndex((c) => T >= c.from && T < c.to);
}

// Black-out between scenes and at the very start and end.
function blackAt(T) {
  if (T < A_END) return 1 - smooth(0, 1, T) * (1 - smooth(A_END - 0.35, A_END, T));
  if (T < B_END) return 1 - smooth(A_END, A_END + 0.35, T) * (1 - smooth(B_END - 0.35, B_END, T));
  return 1 - smooth(B_END, B_END + 0.45, T) * (1 - smooth(C_END - 0.8, C_END, T));
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

export default function Intro({ onDone }) {
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
    let scene = -1;
    let prevHy = null;
    let docked = false;
    let boomed = false;
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
      if (T >= C_END) {
        finish();
        return;
      }
      const cap = captionAt(T);
      if (cap !== shown) {
        shown = cap;
        setCaption(cap);
      }
      const nextScene = T < A_END ? 0 : T < B_END ? 1 : 2;
      if (nextScene !== scene) {
        scene = nextScene;
        smoke.clear();
        sparks.clear();
        debris.clear();
      }

      const S = Math.max(W, H);
      const u = {
        time: T,
        planet: [W / 2, H / 2, 100],
        light: [0, 0, 1],
        rot: 0,
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

      if (scene === 0) {
        // --- A. Departure -----------------------------------------------------
        const a = T / A_END;
        const fall = easeInOut(smooth(0.2, 1, a));
        const hy = H * (0.64 + 0.17 * fall);
        const R = S * Math.exp(lerp(Math.log(5), Math.log(1.05), fall));
        const cx = W * (0.52 - 0.05 * a);
        u.planet = [cx, hy + R, R];
        u.light = norm([0.62, 0.3, 0.3]);
        u.rot = 0.6 + T * 0.01;
        u.atm = clamp(R * 0.07, 10, 150);
        u.sun = [W * 0.84, hy - H * 0.05 - fall * H * 0.1, 1 - fall * 0.35];
        u.cam = [0, (hy - H * 0.64) * 0.3];
        u.neb = 0.6 + 0.4 * fall;
        const shift = prevHy == null ? 0 : hy - prevHy;
        prevHy = hy;

        const tL = 1.0;
        const rs0 = H * 0.0021;
        const rs = rs0 * (1 - 0.35 * fall);
        const padX = W * 0.46;
        const climb = easeInOut(clamp((T - tL) / 2.8));
        const ry = lerp(H * 0.64 - 17.5 * rs0, H * 0.36, climb) - smooth(3.6, A_END, T) * H * 0.07;
        const turn = easeIn(clamp((T - tL) / 4.4));
        const rx = padX + W * 0.07 * turn;
        const rrot = 0.24 * turn;
        const thrust = clamp((T - (tL - 0.45)) / 0.45);
        const [nx, ny] = rocketPoint(rx, ry, rrot, rs, 0, 19);

        if (thrust > 0 && T < tL + 1.5) {
          for (let i = 0; i < 4; i++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            smoke.add({
              img: SPRITES.smoke, x: padX + rand(-6, 6) * rs, y: hy - rand(0, 5) * rs,
              vx: dir * rand(0.04, 0.32) * H, vy: -rand(0, 0.05) * H, r: rand(6, 12) * rs,
              grow: rand(10, 24) * rs, life: rand(1.8, 3), drag: 1.2, alpha: 0.5,
            });
          }
        }
        if (T > tL) {
          for (let i = 0; i < 3; i++) {
            smoke.add({
              img: SPRITES.smoke, x: nx + rand(-2, 2) * rs, y: ny + rand(0, 4) * rs,
              vx: rand(-0.012, 0.012) * H, vy: rand(0.005, 0.03) * H, r: rand(4, 7) * rs,
              grow: rand(7, 15) * rs, life: rand(1.8, 3.2), drag: 0.6, alpha: 0.5,
            });
          }
          smoke.add({ img: SPRITES.glow, x: nx, y: ny + 6 * rs, vx: 0, vy: 0.04 * H, r: 7 * rs, grow: 10 * rs, life: 0.3, alpha: 0.7, additive: true });
        }
        smoke.step(dt, shift);

        draws.push(() => {
          if (thrust > 0 && T < tL + 1.6) {
            const g = clamp(1 - (T - tL) / 1.6) * thrust;
            blit(ctx, SPRITES.glow, padX, hy, 60 * rs * (0.9 + 0.1 * Math.sin(T * 40)), g * 0.9, true);
          }
          drawTower(ctx, padX + 13 * rs0, hy, 52 * rs0, rs0, T);
          smoke.draw(ctx);
          drawRocket(ctx, rx, ry, rrot, rs, thrust, T);
          drawFlare(ctx, u.sun[0], u.sun[1], W, H, u.sun[2] * 0.9);
        });
      } else if (scene === 1) {
        // --- B. Docking -------------------------------------------------------
        const t = T - A_END;
        const dur = B_END - A_END;
        const portrait = W < H;
        const R = S;
        u.planet = [W * 0.08, H * 0.62 + R, R];
        u.light = norm([0.75, 0.55, 0.35]);
        u.rot = 2.0 + t * 0.015;
        u.atm = clamp(R * 0.05, 10, 90);
        u.sun = [W * 1.02, -H * 0.08, 0.7];
        u.cam = [t * 8, 0];

        const ss = ((portrait ? W * 0.62 : Math.min(W * 0.42, H * 0.62)) / 34) * (1 + 0.05 * (t / dur));
        const shipX = W * (portrait ? 0.55 : 0.6) + Math.sin(t * 0.6) * W * 0.006;
        const shipY = H * 0.4 + Math.sin(t * 0.45) * H * 0.006;
        const shipRot = -0.12;
        const fwd = [Math.cos(shipRot), Math.sin(shipRot)];
        const D = shipPoint(shipX, shipY, shipRot, ss, -10.9, 0);
        const rs = ss * 0.16;
        const tS = 0.15;
        const tD = 3.0;
        const k = easeOut((t - tS) / (tD - tS));
        const P0 = [-W * 0.06, H * 1.06];
        const C1 = [W * 0.16, H * 0.6];
        const C2 = [D[0] - fwd[0] * W * 0.24, D[1] - fwd[1] * W * 0.24];
        let nose;
        let dir;
        if (t >= tD) {
          nose = D;
          dir = fwd;
        } else {
          nose = bezier(P0, C1, C2, D, k);
          dir = k > 0.999 ? fwd : bezierTangent(P0, C1, C2, D, k);
        }
        const rrot = Math.atan2(dir[1], dir[0]) + Math.PI / 2;
        const rx = nose[0] - dir[0] * 26 * rs;
        const ry = nose[1] - dir[1] * 26 * rs;
        const thrust = t < tD - 0.9 ? 1 : clamp((tD - 0.6 - t) / 0.3);
        const [nx, ny] = rocketPoint(rx, ry, rrot, rs, 0, 19);
        if (thrust > 0) {
          sparks.add({ img: SPRITES.glow, x: nx, y: ny, vx: -dir[0] * 0.05 * H, vy: -dir[1] * 0.05 * H, r: 6 * rs, grow: 8 * rs, life: 0.35, alpha: 0.6 * thrust, additive: true });
        }
        if (t > tD - 1.1 && t < tD - 0.1 && t - lastRcs > 0.12) {
          lastRcs = t;
          for (const side of [-1, 1]) {
            const [px, py] = rocketPoint(rx, ry, rrot, rs, side * 6, -18);
            smoke.add({ img: SPRITES.smoke, x: px, y: py, vx: dir[0] * 0.08 * H + side * 0.02 * H, vy: dir[1] * 0.08 * H, r: 2 * rs, grow: 9 * rs, life: 0.55, alpha: 0.7 });
          }
        }
        if (t >= tD && !docked) {
          docked = true;
          for (let i = 0; i < 28; i++) {
            const a = rand(0, Math.PI * 2);
            const sp = rand(0.02, 0.14) * H;
            sparks.add({ img: SPRITES.spark, x: D[0], y: D[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1.5, 3.5), life: rand(0.3, 0.8), drag: 2, alpha: 1, additive: true });
          }
        }
        smoke.step(dt);
        sparks.step(dt);
        const power = smooth(tD + 0.2, tD + 1.3, t);
        const contact = t >= tD ? Math.exp(-(t - tD) * 5) : 0;
        const ret = smooth(tD - 1.7, tD - 1.2, t) * (1 - smooth(tD + 0.3, tD + 0.8, t));
        const retSize = lerp(ss * 14, ss * 3.4, easeOut((t - (tD - 1.7)) / 1.7));

        draws.push(() => {
          drawShip(ctx, shipX, shipY, shipRot, ss, power, T);
          smoke.draw(ctx);
          sparks.draw(ctx);
          drawRocket(ctx, rx, ry, rrot, rs, thrust, T);
          if (contact > 0) {
            blit(ctx, SPRITES.blue, D[0], D[1], ss * 9 * (1.2 - contact * 0.4), contact, true);
            blit(ctx, SPRITES.spark, D[0], D[1], ss * 3, contact, true);
          }
          drawReticle(ctx, D[0], D[1], retSize, t < tD ? "#5ad1ff" : "#7ddec0", ret * 0.9);
        });
      } else {
        // --- C. Look back -----------------------------------------------------
        const t = T - B_END;
        const dur = C_END - B_END;
        const win = cockpit.win;
        const R = Math.min(W, H) * 0.15 * (1 + 0.035 * (t / dur));
        const pc = [W * 0.5, win.y + win.h * 0.48];
        const tBoom = 2.4;
        const since = t - tBoom;
        u.planet = [pc[0], pc[1], R];
        u.light = norm([-0.65, 0.35, 0.68]);
        u.rot = 4.0 + t * 0.02;
        u.atm = clamp(R * 0.1, 8, 30);
        u.cam = [t * 3, 0];
        u.crack = smooth(1.3, tBoom, t);
        u.flash = since >= 0 ? Math.exp(-since * 3) * (reduce ? 0.4 : 1) : 0;
        u.boom = since >= 0 ? easeOut(since / 2.8) : 0;
        if (since >= 0) {
          const grow = 1 - Math.pow(1 - clamp(since / 2.8), 4);
          u.ring = [R * (1 + grow * ((W * 1.5) / R)), (1 - clamp(since / 3)) * 1.3, 0.2, -0.12];
        }
        const tremor = t > 1.2 && since < 0 ? 2.5 * smooth(1.2, tBoom, t) : 0;
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

        draws.push(() => {
          if (u.crack > 0 && since < 0) blit(ctx, SPRITES.glow, pc[0], pc[1], R * 1.5, u.crack * 0.35, true);
          debris.draw(ctx);
          if (remnant > 0) blit(ctx, SPRITES.glow, pc[0], pc[1], R * (1.4 + since * 0.7), remnant * 0.85, true);
          drawCockpit(ctx, cockpit, W, H, light, T);
          drawStreak(ctx, pc[0], pc[1], W * 1.4, u.flash, "255,200,150");
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
              {String(i + 1).padStart(2, "0")} / 03 · All Alone in Space
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
