import { memo, useEffect, useRef, useState } from "react";
import { easeIn, easeOut, smooth } from "../intro/draw.js";
import { sfx } from "../sound.js";
import { ShipShapes } from "./Ship.jsx";
import { Belt, DROP, JumpGate, MapDefs, NARROW, PLANET_ZOOM, StarDot, SUN_R, systemBox } from "./MapArt.jsx";
import { PlanetDot, faceOf } from "./Planet.jsx";
import { beltOf } from "./sky.js";
import { Starbase } from "./Station.jsx";
import { JUMP_R, STATION, TILT, orbitAt, planetsOf, system } from "../game/map.js";

// A lane flight between systems as a warp jump, in three shots over the flight (t from 0 to 1).
// Leaving: the old system as its planetary map showed it, the ship at the jump point facing out.
// Its planets pop out of existence one by one, then its sun, and the ship stretches into a streak
// and is gone in a flash (JUMP). Inside: stars stretch from the centre of a blue tunnel (IN to
// OUT). Arriving: a flash, the ship snaps back from a streak at the new jump point, the new sun and
// then its planets pop into existence, and the ship settles where the planetary map parks it, so
// the map takes over without a cut. Progress follows the ship's flight (ms, resume); a flight
// event's pause drops the tunnel to a slow drift until the flight goes on.

export const JUMP = 0.27;
const IN = 0.3;
export const OUT = 0.7;
const EXIT = 0.715;
const SETTLE = 0.92;
// One pop, in flight time, and when each planet and sun pops.
const POP = 0.045;
const popOutAt = (i) => 0.05 + i * 0.035;
const SUN_OUT = 0.21;
const SUN_IN = 0.725;
const popInAt = (i) => 0.77 + i * 0.028;
// While it jumps the ship is drawn this much bigger than the map's; it settles to the map's size.
const SHIP_K = 1.6;
const TUNNEL_STARS = 240;
const SIDE_STARS = 150;

const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
// Facing the sun, in degrees: the planet art is turned so its lit side faces the star.
const sunward = (at) => (Math.atan2(-at.y, -at.x) * 180) / Math.PI;

// Popping out: a quick swell, then gone. Popping in: grows past full size, then settles.
function popOut(u) {
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  return u < 0.35 ? 1 + 0.3 * smooth(0, 0.35, u) : 1.3 * (1 - easeIn((u - 0.35) / 0.65));
}

function popIn(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u < 0.6 ? 1.3 * easeOut(u / 0.6) : 1.3 - 0.3 * smooth(0.6, 1, u);
}

// A system as the planetary map frames it; the station gets a system-sized view of its own.
function sceneOf(id, closed, narrow) {
  const planets = planetsOf(id);
  const station = id === STATION || !planets.length;
  const reach = station ? 230 : Math.max(...planets.map((p) => p.orbit));
  return {
    station,
    box: systemBox(reach, narrow),
    star: system(id)?.star,
    belt: station ? null : beltOf(id, planets.map((p) => p.orbit)),
    worlds: planets.map((p) => ({ p, face: faceOf(p), shut: closed.includes(p.id) })),
  };
}

// The planets, orbits, sun and jump point, drawn as SystemMap draws them. Rendered once: the frame
// loop moves and pops them through the warp-* classes.
const Scene = memo(function Scene({ scene, zoom }) {
  const now = Date.now();
  const world = ({ p, face, shut }, i) => (
    <g key={p.id} className="warp-world" data-i={i}>
      <circle className="warp-spark" r="0" opacity="0" />
      <g className="warp-pop">
        <g className={shut ? `node node-${p.shell} shut` : `node node-${p.shell}`}>
          <g className="warp-spin">
            <PlanetDot face={face} detail shut={shut} />
          </g>
          {p.shell !== "fuel" ? (
            <g className="beacon" transform={`translate(0 ${-(face.radius + 25)})`}>
              <circle className="beacon-pulse" r="6.5" />
              <circle className="beacon-bg" r="6.5" />
              <text className="beacon-mark" y="3.3" textAnchor="middle">
                !
              </text>
            </g>
          ) : (
            <path className="fuel-badge" transform={`translate(${face.radius * 0.72 + 4} ${-(face.radius * 0.72 + 4)})`} d={DROP} />
          )}
          <text className="node-label" y={-(face.radius + 3)} textAnchor="middle" dominantBaseline="text-after-edge">
            {p.id}
          </text>
        </g>
      </g>
    </g>
  );
  // Planets on the far side of the star are drawn before it, as on the planetary map.
  const far = (w) => orbitAt(w.p, now).y < 0;
  return (
    <>
      {scene.worlds.map(({ p }, i) => (
        <ellipse key={p.id} className="orbit warp-orbit" data-i={i} rx={p.orbit} ry={p.orbit * TILT} />
      ))}
      {scene.worlds.map((w, i) => (far(w) ? world(w, i) : null))}
      <g className="warp-sun">
        {scene.station ? (
          <Starbase x="-48" y="-48" width="96" height="96" />
        ) : (
          <>
            {/* The belt pops in and out with the sun, as the map draws it between the orbits. */}
            {scene.belt ? <Belt belt={scene.belt} /> : null}
            <g className="sun">
              <StarDot kind={scene.star} r={SUN_R} sun />
            </g>
          </>
        )}
      </g>
      {scene.worlds.map((w, i) => (far(w) ? null : world(w, i)))}
      <g className="jump warp-jump" transform={`translate(${-JUMP_R} 0)`}>
        <JumpGate />
        <text className="node-label" y="-21" textAnchor="middle">
          Jump point
        </text>
      </g>
      {/* Laid out like SystemMap's parked Ship, so the last frame matches it exactly. */}
      <g className="warp-ship lit">
        <svg className="ship" viewBox="-24 -11 46 22" x="-22" y="-11" width="44" height="22" overflow="visible">
          <ShipShapes />
        </svg>
      </g>
    </>
  );
});

// A star in tunnel space: angle and distance from the axis, and depth (1 far, 0 at the glass).
function spawn(star, far = true) {
  star.a = Math.random() * Math.PI * 2;
  star.r = 0.12 + Math.random() * 0.88;
  star.z = far ? 0.6 + Math.random() * 0.4 : 0.05 + Math.random() * 0.95;
  star.blue = Math.random() < 0.3;
  return star;
}

// A star seen from outside: a spot on the screen and a depth (near ones move faster).
function sideStar(star, x = Math.random()) {
  star.x = x;
  star.y = Math.random();
  star.d = 0.25 + Math.random() * 0.75;
  return star;
}

// How fast the stars pass outside: a drift, building as the drive charges, a rush at the jump;
// on the way out the rush dies back down to a drift.
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

export default function WarpTunnel({ ms, resume, paused, from, to, closed }) {
  const canvasRef = useRef(null);
  const leaveRef = useRef(null);
  const arriveRef = useRef(null);
  const flight = useRef(null);
  flight.current = { ms, resume, paused };
  const [shots] = useState(() => {
    const narrow = window.matchMedia?.(NARROW).matches ?? false;
    return {
      zoom: narrow ? 2 : PLANET_ZOOM,
      leave: sceneOf(from, closed, narrow),
      arrive: sceneOf(to, closed, narrow),
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !leaveRef.current || !arriveRef.current) return undefined;
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

    // The parts each shot moves, found once in the rendered scenes.
    const parts = (svg, scene) => ({
      svg,
      worlds: [...svg.querySelectorAll(".warp-world")].map((el) => {
        const i = Number(el.dataset.i);
        return {
          i,
          p: scene.worlds[i].p,
          r: scene.worlds[i].face.radius * shots.zoom,
          el,
          pop: el.querySelector(".warp-pop"),
          spin: el.querySelector(".warp-spin"),
          spark: el.querySelector(".warp-spark"),
          orbit: svg.querySelector(`.warp-orbit[data-i="${i}"]`),
        };
      }),
      sun: svg.querySelector(".warp-sun"),
      jump: svg.querySelector(".warp-jump"),
      ship: svg.querySelector(".warp-ship"),
    });
    const leave = parts(leaveRef.current, shots.leave);
    const arrive = parts(arriveRef.current, shots.arrive);
    arrive.svg.style.visibility = "hidden";

    // A world at its spot on its orbit right now, popped to `scale`, with its sparkle ring at v.
    const place = (w, scale, spark, wall) => {
      const at = orbitAt(w.p, wall);
      w.el.setAttribute("transform", `translate(${r1(at.x)} ${r1(at.y)})`);
      w.pop.setAttribute("transform", `scale(${r3(shots.zoom * scale)})`);
      w.spin.setAttribute("transform", `rotate(${r1(sunward(at) + 135)})`);
      const on = spark > 0 && spark < 1;
      w.spark.setAttribute("r", on ? r1(w.r * (1 + 1.6 * spark)) : "0");
      w.spark.setAttribute("opacity", on ? r3(0.9 * (1 - spark)) : "0");
    };
    // Where a point of a shot's scene is on the canvas.
    const toCanvas = (svg, x, y) => {
      const m = svg.getScreenCTM();
      const box = canvas.getBoundingClientRect();
      if (!m) return { x: width / 2, y: height / 2 };
      return { x: m.a * x + m.c * y + m.e - box.left, y: m.b * x + m.d * y + m.f - box.top };
    };

    const tunnel = Array.from({ length: TUNNEL_STARS }, () => spawn({}, false));
    const side = Array.from({ length: SIDE_STARS }, () => sideStar({}));
    const played = new Set();
    const cue = (key, name, when, t) => {
      if (t >= when && !played.has(key)) {
        played.add(key);
        sfx(name);
      }
    };
    cue("charge", "warpCharge", 0, 0);
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
      const wall = Date.now();
      const inside = paused || (t >= IN && t < OUT);
      const leaving = !paused && t < IN;
      const arriving = !paused && t >= OUT;
      leave.svg.style.visibility = leaving ? "visible" : "hidden";
      arrive.svg.style.visibility = arriving ? "visible" : "hidden";

      // Leaving: planets pop out one by one, then the sun; the ship pulls out and streaks away.
      let nose = null;
      if (leaving) {
        for (const w of leave.worlds) {
          const u = (t - popOutAt(w.i)) / POP;
          place(w, popOut(u), (u - 0.6) / 0.9, wall);
          w.orbit.setAttribute("opacity", r3(1 - smooth(popOutAt(w.i), popOutAt(w.i) + POP, t)));
          cue(`out${w.i}`, "vanish", popOutAt(w.i) + POP * 0.4, t);
        }
        leave.sun.setAttribute("transform", `scale(${r3(popOut((t - SUN_OUT) / POP))})`);
        leave.jump.setAttribute("opacity", r3(1 - smooth(SUN_OUT, SUN_OUT + POP, t)));
        cue("outSun", "vanish", SUN_OUT + POP * 0.4, t);
        const x = -JUMP_R - 50 * easeIn(smooth(0.1, JUMP, t));
        const charge = smooth(0.22, JUMP, t);
        const sx = 1 + 14 * easeIn(charge);
        // Facing out of the system; the tail stays put while the nose streaks ahead.
        leave.ship.setAttribute(
          "transform",
          `translate(${r1(x)} 0) rotate(180) scale(${SHIP_K}) translate(-22 0) scale(${r3(sx)} ${r3(1 - 0.35 * charge)}) translate(22 0)`,
        );
        leave.ship.setAttribute("opacity", r3(1 - smooth(JUMP - 0.01, JUMP + 0.01, t)));
        nose = toCanvas(leave.svg, x - SHIP_K * (44 * sx - 22), 0);
      }

      // Arriving: the ship snaps back from a streak and settles at the jump point; the new sun,
      // the jump point and then the planets pop into existence.
      if (arriving) {
        arrive.sun.setAttribute("transform", `scale(${r3(popIn((t - SUN_IN) / POP))})`);
        arrive.jump.setAttribute("opacity", r3(smooth(SUN_IN, SUN_IN + POP, t)));
        cue("inSun", "appear", SUN_IN, t);
        for (const w of arrive.worlds) {
          const u = (t - popInAt(w.i)) / POP;
          place(w, popIn(u), u, wall);
          w.orbit.setAttribute("opacity", r3(smooth(popInAt(w.i) - 0.02, popInAt(w.i) + 0.02, t)));
          cue(`in${w.i}`, "appear", popInAt(w.i), t);
        }
        const x = -JUMP_R - 80 * (1 - easeOut(smooth(EXIT, SETTLE, t)));
        const k = SHIP_K - (SHIP_K - 1) * smooth(0.8, SETTLE, t);
        const snap = 1 - easeOut(smooth(EXIT - 0.005, 0.8, t));
        arrive.ship.setAttribute(
          "transform",
          `translate(${r1(x)} 0) scale(${r3(k)}) translate(22 0) scale(${r3(1 + 14 * snap)} ${r3(1 - 0.35 * snap)}) translate(-22 0)`,
        );
        arrive.ship.setAttribute("opacity", r3(smooth(OUT, EXIT, t)));
        // Engines off once it has stopped, as the parked ship on the map.
        arrive.ship.classList.toggle("lit", t < SETTLE - 0.03);
        nose = toCanvas(arrive.svg, x + 22 * k, 0);
      }
      cue("jump", "warpJump", JUMP - 0.005, t);
      // The drop-out sound swells for a third of a second before its thump, so it starts early.
      cue("exit", "warpExit", EXIT - 0.11, t);

      const cx = width / 2;
      const cy = height / 2;
      const reach = Math.hypot(cx, cy) || 1;
      ctx.clearRect(0, 0, width, height);

      // Outside: stars slide past (the other way while leaving, since the ship faces out), a
      // drift that stretches into lines as the ship speeds up, gone once it has stopped.
      if (!inside) {
        const dir = leaving ? 1 : -1;
        const v = sideSpeed(t) * width * 0.05;
        const fade = arriving ? 1 - smooth(0.84, SETTLE, t) : 1;
        ctx.lineCap = "round";
        for (const s of side) {
          s.x += (dir * v * s.d * dt) / width;
          if (s.x < -0.2 || s.x > 1.2) sideStar(s, dir > 0 ? -0.1 - Math.random() * 0.1 : 1 + Math.random() * 0.1);
          if (fade <= 0.01) continue;
          const len = Math.min(width * 0.7, v * s.d * 0.05) + 1.5;
          const x = s.x * width;
          const y = s.y * height;
          ctx.strokeStyle = `rgba(220, 238, 255, ${r3(fade * Math.min(1, 0.3 + v / (width * 0.6)) * (0.3 + 0.6 * s.d))})`;
          ctx.lineWidth = 0.6 + 1.4 * s.d;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - dir * len, y);
          ctx.stroke();
        }
      }

      // Warp space covers the systems: a dark sky with a blue tunnel and stars streaming from its heart.
      const sky = inside ? 1 : leaving ? smooth(JUMP - 0.01, IN, t) : 1 - smooth(OUT, EXIT + 0.01, t);
      if (sky > 0.01) {
        ctx.fillStyle = `rgba(4, 6, 13, ${r3(sky)})`;
        ctx.fillRect(0, 0, width, height);
      }
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
      }

      if (!paused) {
        // The jump flash at the tip of the streak, and the drop-out flash where the ship reappears.
        const jump = smooth(JUMP - 0.03, JUMP, t) * (1 - smooth(JUMP, IN + 0.04, t));
        const jx = nose && leaving ? Math.max(-40, Math.min(width + 40, nose.x)) : width * 0.1;
        burst(ctx, jx, nose && leaving ? nose.y : cy, reach * (0.6 + 0.8 * jump), jump);
        const exit = smooth(OUT - 0.01, EXIT, t) * (1 - smooth(EXIT, EXIT + 0.06, t));
        burst(ctx, nose && arriving ? nose.x : width * 0.15, nose && arriving ? nose.y : cy, reach * (0.6 + 0.8 * exit), exit);
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
      {/* Hidden until the frame loop has placed everything; it shows each shot in turn. */}
      <svg className="warp-scene" viewBox={shots.leave.box.join(" ")} ref={leaveRef} visibility="hidden">
        <MapDefs />
        <Scene scene={shots.leave} zoom={shots.zoom} />
      </svg>
      <svg className="warp-scene" viewBox={shots.arrive.box.join(" ")} ref={arriveRef} visibility="hidden">
        <Scene scene={shots.arrive} zoom={shots.zoom} />
      </svg>
      <canvas ref={canvasRef} />
      <p className="warp-to">Warp to {to === STATION ? "the station" : to}</p>
    </div>
  );
}
