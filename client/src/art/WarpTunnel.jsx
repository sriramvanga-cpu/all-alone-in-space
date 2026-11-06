import { useEffect, useRef } from "react";
import { smooth } from "../intro/draw.js";

// The cockpit view while the ship flies a lane between systems: stars stretch into lines from the
// centre inside a blue tunnel glow, with a flash going into warp and coming out. It follows the
// flight's progress the way the ship does (ms, resume), and a flight event's pause drops it to a
// slow drift until the flight goes on.

const STAR_COUNT = 240;

// A star in tunnel space: angle and distance from the axis, and depth (1 far, 0 at the glass).
function spawn(star, far = true) {
  star.a = Math.random() * Math.PI * 2;
  star.r = 0.12 + Math.random() * 0.88;
  star.z = far ? 0.6 + Math.random() * 0.4 : 0.05 + Math.random() * 0.95;
  star.blue = Math.random() < 0.3;
  return star;
}

export default function WarpTunnel({ ms, resume, paused, to }) {
  const canvasRef = useRef(null);
  const flight = useRef(null);
  flight.current = { ms, resume, paused };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;
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

    const stars = Array.from({ length: STAR_COUNT }, () => spawn({}, false));
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
      // Warp builds over the first sixth of the flight and eases off over the last.
      const target = paused ? 0.1 : 0.1 + 0.9 * smooth(0, 0.16, t) * (1 - smooth(0.84, 1, t));
      level += (target - level) * Math.min(1, dt * 6);

      const cx = width / 2;
      const cy = height / 2;
      const reach = Math.hypot(cx, cy) || 1;
      const lens = Math.min(width, height) * 0.22;
      ctx.clearRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
      glow.addColorStop(0, `rgba(200, 235, 255, ${0.5 * level})`);
      glow.addColorStop(0.12, `rgba(90, 170, 255, ${0.3 * level})`);
      glow.addColorStop(0.45, `rgba(138, 125, 255, ${0.12 * level})`);
      glow.addColorStop(1, "rgba(4, 6, 13, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const speed = 0.06 + 1.6 * level;
      const tail = 0.01 + 0.35 * level;
      ctx.lineCap = "round";
      for (const s of stars) {
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
        ctx.strokeStyle = s.blue
          ? `rgba(150, 190, 255, ${0.25 + 0.75 * near})`
          : `rgba(228, 243, 255, ${0.25 + 0.75 * near})`;
        ctx.lineWidth = 0.6 + 2.2 * near * near;
        ctx.beginPath();
        ctx.moveTo(cx + (Math.cos(s.a) * k) / zt, cy + (Math.sin(s.a) * k) / zt);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // A flash going into warp, and a brighter one coming out that the arrival fades away.
      const flash = paused ? 0 : 0.8 * smooth(0.08, 0.15, t) * (1 - smooth(0.15, 0.32, t)) + 0.95 * smooth(0.9, 1, t);
      if (flash > 0.01) {
        const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        light.addColorStop(0, `rgba(240, 250, 255, ${flash})`);
        light.addColorStop(0.5, `rgba(170, 205, 255, ${flash * 0.75})`);
        light.addColorStop(1, `rgba(120, 150, 255, ${flash * 0.4})`);
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, width, height);
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
      <p className="warp-to">Warp to {to}</p>
    </div>
  );
}
