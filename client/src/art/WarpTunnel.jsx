import { useEffect, useRef } from "react";
import { easeIn, easeOut, smooth } from "../intro/draw.js";
import { sfx } from "../sound.js";
import { ShipSvg } from "./Ship.jsx";

// A lane flight between systems as a warp jump, in three shots over the flight (t from 0 to 1):
// outside, the ship's drive charges as the stars speed past, then it stretches to a streak and is
// gone in a flash (to JUMP); inside warp space, stars stretch from the centre of a blue tunnel
// (IN to OUT); outside again, a flash, and the ship snaps back from a streak and coasts to a stop.
// It follows the flight's progress the way the ship does (ms, resume), and a flight event's pause
// drops the tunnel to a slow drift until the flight goes on.

const JUMP = 0.27;
const IN = 0.3;
const OUT = 0.7;
const EXIT = 0.715;
const TUNNEL_STARS = 240;
const SIDE_STARS = 150;
// The ship art's box, in its own units (Ship.jsx draws it in -24 -11 46 22).
const SHIP_ASPECT = 22 / 46;

// A star in tunnel space: angle and distance from the axis, and depth (1 far, 0 at the glass).
function spawn(star, far = true) {
  star.a = Math.random() * Math.PI * 2;
  star.r = 0.12 + Math.random() * 0.88;
  star.z = far ? 0.6 + Math.random() * 0.4 : 0.05 + Math.random() * 0.95;
  star.blue = Math.random() < 0.3;
  return star;
}

// A star seen from the side: a spot on the screen and a depth (near ones move faster).
function sideStar(star, x = Math.random()) {
  star.x = x;
  star.y = Math.random();
  star.d = 0.25 + Math.random() * 0.75;
  return star;
}

// How fast the stars pass outside: drifting, building as the drive charges, then a rush at the
// jump; on the way out, the rush dies back down to a drift.
function sideSpeed(t) {
  if (t < IN) return 1 + 5 * smooth(0.08, 0.22, t) + 60 * smooth(0.22, IN, t);
  return 1 + 60 * (1 - smooth(OUT, 0.84, t));
}

function burst(ctx, x, y, radius, alpha) {
  if (alpha <= 0.01) return;
  const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
  light.addColorStop(0, `rgba(245, 252, 255, ${alpha})`);
  light.addColorStop(0.25, `rgba(180, 215, 255, ${alpha * 0.8})`);
  light.addColorStop(1, "rgba(120, 150, 255, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

export default function WarpTunnel({ ms, resume, paused, to }) {
  const canvasRef = useRef(null);
  const shipRef = useRef(null);
  const flight = useRef(null);
  flight.current = { ms, resume, paused };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ship = shipRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !ship) return undefined;
    let width = 0;
    let height = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(canvas);

    const tunnel = Array.from({ length: TUNNEL_STARS }, () => spawn({}, false));
    const side = Array.from({ length: SIDE_STARS }, () => sideStar({}));
    const played = new Set();
    const cue = (name, when, t) => {
      if (t >= when && !played.has(name)) {
        played.add(name);
        sfx(name);
      }
    };
    cue("warpCharge", 0, 0);
    let resumed = flight.current.resume;
    let started = performance.now() - resumed * flight.current.ms;
    let last = performance.now();
    let level = 0.1;
    let raf = 0;
    const frame = (now) => {
      const { ms, resume, paused } = flight.current;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      // After a flight event the flight resumes from halfway; follow it.
      if (resume !== resumed) {
        resumed = resume;
        started = now - resume * ms;
      }
      const t = paused ? resume || 0.5 : Math.min(1, (now - started) / ms);
      cue("warpJump", JUMP - 0.005, t);
      // The drop-out sound swells for a third of a second before its thump, so it starts early.
      cue("warpExit", EXIT - 0.11, t);

      const cx = width / 2;
      const cy = height / 2;
      const reach = Math.hypot(cx, cy) || 1;
      ctx.clearRect(0, 0, width, height);
      const inside = paused || (t >= IN && t < OUT);

      if (inside) {
        const target = paused ? 0.1 : 0.1 + 0.9 * smooth(IN, IN + 0.06, t) * (1 - smooth(OUT - 0.06, OUT, t));
        level += (target - level) * Math.min(1, dt * 6);
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        glow.addColorStop(0, `rgba(200, 235, 255, ${0.5 * level})`);
        glow.addColorStop(0.12, `rgba(90, 170, 255, ${0.3 * level})`);
        glow.addColorStop(0.45, `rgba(138, 125, 255, ${0.12 * level})`);
        glow.addColorStop(1, "rgba(4, 6, 13, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        const lens = Math.min(width, height) * 0.22;
        const speed = 0.06 + 1.6 * level;
        const tail = 0.01 + 0.35 * level;
        ctx.lineCap = "round";
        for (const s of tunnel) {
          s.z -= speed * dt;
          if (s.z <= 0.02) spawn(s);
          const k = lens * s.r;
          const x1 = cx + (Math.cos(s.a) * k) / s.z;
          const y1 = cy + (Math.sin(s.a) * k) / s.z;
          if (Math.abs(x1 - cx) > cx + 40 || Math.abs(y1 - cy) > cy + 40) {
            spawn(s);
            continue;
          }
          const zt = s.z + tail;
          const near = 1 - Math.min(1, s.z);
          ctx.strokeStyle = s.blue ? `rgba(150, 190, 255, ${0.25 + 0.75 * near})` : `rgba(228, 243, 255, ${0.25 + 0.75 * near})`;
          ctx.lineWidth = 0.6 + 2.2 * near * near;
          ctx.beginPath();
          ctx.moveTo(cx + (Math.cos(s.a) * k) / zt, cy + (Math.sin(s.a) * k) / zt);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      } else {
        // Outside: stars slide past behind the ship, stretching into lines as it speeds up.
        const v = sideSpeed(t) * width * 0.05;
        ctx.lineCap = "round";
        for (const s of side) {
          s.x -= (v * s.d * dt) / width;
          if (s.x < -0.2) sideStar(s, 1 + Math.random() * 0.1);
          const x = s.x * width;
          const y = s.y * height;
          const len = Math.min(width * 0.7, v * s.d * 0.05) + 1.5;
          ctx.strokeStyle = `rgba(220, 238, 255, ${0.25 + 0.6 * s.d})`;
          ctx.lineWidth = 0.6 + 1.4 * s.d;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + len, y);
          ctx.stroke();
        }
      }

      // The ship, seen from outside: it pulls back as the drive charges, stretches into a streak
      // that shoots ahead at the jump, and on the way out snaps back from a streak to its shape.
      const w = Math.max(110, Math.min(300, width * 0.26));
      const h = w * SHIP_ASPECT;
      const top = cy - h / 2 + Math.sin(now / 420) * 2;
      let nose = 0;
      if (!inside && t < IN) {
        const tailX = width * 0.42 - w / 2 - width * 0.03 * smooth(0.1, 0.22, t);
        const stretch = 1 + 14 * easeIn(smooth(0.22, JUMP, t));
        nose = tailX + w * stretch;
        ship.style.transformOrigin = "0% 50%";
        ship.style.transform = `translate(${tailX}px, ${top}px) scale(${stretch}, ${1 - 0.35 * smooth(0.22, JUMP, t)})`;
        ship.style.opacity = String(1 - smooth(JUMP - 0.01, JUMP + 0.01, t));
      } else if (!inside) {
        const noseX = width * 0.58 + width * 0.03 * easeOut(smooth(0.78, 0.96, t));
        const stretch = 1 + 14 * (1 - easeOut(smooth(EXIT - 0.005, 0.8, t)));
        nose = noseX;
        ship.style.transformOrigin = "100% 50%";
        ship.style.transform = `translate(${noseX - w}px, ${top}px) scale(${stretch}, ${1 - 0.35 * (1 - smooth(EXIT, 0.8, t))})`;
        ship.style.opacity = String(smooth(OUT, EXIT, t));
      } else {
        ship.style.opacity = "0";
      }
      ship.style.width = `${w}px`;
      ship.style.height = `${h}px`;

      if (!paused) {
        // The jump flash at the tip of the streak, and the drop-out flash where the ship reappears.
        const jump = smooth(JUMP - 0.03, JUMP, t) * (1 - smooth(JUMP, IN + 0.04, t));
        burst(ctx, Math.min(nose || width * 0.75, width + 40), cy, reach * (0.6 + 0.8 * jump), jump);
        const exit = smooth(OUT - 0.01, EXIT, t) * (1 - smooth(EXIT, EXIT + 0.06, t));
        burst(ctx, width * 0.58, cy, reach * (0.6 + 0.8 * exit), exit);
        // The view fades to dark for the arrival, which fades in from dark.
        const dark = smooth(0.93, 1, t);
        if (dark > 0.01) {
          ctx.fillStyle = `rgba(4, 6, 13, ${dark})`;
          ctx.fillRect(0, 0, width, height);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      watch.disconnect();
    };
  }, []);

  return (
    <div className="warp" aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="warp-ship" ref={shipRef}>
        <ShipSvg className="ship flying" />
      </div>
      <p className="warp-to">Warp to {to}</p>
    </div>
  );
}
