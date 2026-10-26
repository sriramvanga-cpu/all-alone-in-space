import { memo } from "react";
import { useArt } from "../three/artStore.js";

// Planets are drawn in unit space (radius 1) and scaled by face.radius.
// One key light sits at the upper left of the whole chart, so every world shares
// a lit side, a terminator, and a night side. A face is a pure function of the
// node id and its shell: it never reflects hidden habitability or run state.

export const SURFACES = ["rock", "ice", "gas", "dust"];

export const PLANET_COLORS = {
  rock: [
    ["#c4784a", "#5c2814", "#f0c4a0"],
    ["#8e9098", "#3c3e46", "#e6e7ec"],
    ["#a34b38", "#4a1c14", "#e8b098"],
    ["#b99262", "#5a4030", "#f3e0c4"],
  ],
  ice: [
    ["#d7e7f2", "#6f98b4", "#ffffff"],
    ["#b9d6ea", "#3e7394", "#f5fbff"],
    ["#e7eef3", "#8aa0b0", "#ffffff"],
  ],
  gas: [
    ["#d4a15a", "#6a3a18", "#f3d7a4"],
    ["#c48448", "#3e2414", "#f6e2b4"],
    ["#5e98c4", "#16344e", "#d4e9f8"],
    ["#6fbfb8", "#144240", "#e7fffb"],
  ],
  dust: [
    ["#c4a06a", "#5a3818", "#f0ddb0"],
    ["#a87858", "#3a2414", "#e8c8a0"],
    ["#8a6848", "#2c1c10", "#d8c0a0"],
  ],
  fuel: [
    ["#e8a020", "#7a4010", "#ffe6b0"],
    ["#f0b44a", "#8a5018", "#fff1cc"],
    ["#d48428", "#5a2808", "#ffd7a4"],
    ["#c46a22", "#4a1c08", "#f8c890"],
  ],
};

// How glossy and how thick the atmosphere is, per surface kind.
const SHINE = { gas: 0.5, ice: 0.6, fuel: 0.55, rock: 0.2, dust: 0.16 };
const ATMO = { gas: 0.55, ice: 0.6, fuel: 0.75, rock: 0.34, dust: 0.3 };

export function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function f(n) {
  return Math.round(n * 1000) / 1000;
}

export function faceOf(node) {
  const rand = rng(hashId(node.id));
  const fuel = node.shell === "fuel";
  const kind = fuel ? "fuel" : SURFACES[Math.floor(rand() * SURFACES.length)];
  const colors = PLANET_COLORS[kind][Math.floor(rand() * PLANET_COLORS[kind].length)];
  const spin = Math.floor(rand() * 360);
  const span = fuel
    ? [7.4, 12.6]
    : node.shell === "inner"
      ? [10, 16]
      : node.shell === "middle"
        ? [12.5, 19]
        : [15, 23];
  const radius = span[0] + rand() * (span[1] - span[0]);
  const ring = kind === "gas" && rand() < 0.4;
  const marks = [];
  if (kind === "rock" || kind === "dust" || kind === "ice") {
    const count = kind === "ice" ? 2 : 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * 0.58;
      marks.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: 0.07 + rand() * (kind === "dust" ? 0.28 : 0.18) });
    }
  }
  const bands = [];
  if (kind === "gas" || kind === "fuel") {
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      bands.push({ y: -0.62 + (i / (count - 1)) * 1.24, ry: 0.05 + rand() * 0.11, alt: i % 2 === 1 });
    }
  }

  // Everything below is drawn after the original draws, so a world keeps its
  // kind, colours, size, and ring from before the lighting rework.
  const [base, dark, light] = colors;
  const tilt = f(rand() * 44 - 22);
  const blots = [];
  if (kind === "rock" || kind === "dust" || kind === "ice") {
    const count = kind === "ice" ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 0.8;
      const rx = 0.2 + rand() * 0.34;
      blots.push({
        x: f(Math.cos(a) * d),
        y: f(Math.sin(a) * d),
        rx: f(rx),
        ry: f(rx * (0.45 + rand() * 0.4)),
        rot: Math.floor(rand() * 180),
        light: rand() < 0.45,
        o: f(0.35 + rand() * 0.4),
      });
    }
  }
  const strata = [];
  if (kind === "gas" || kind === "fuel") {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const t = rand();
      const color = t < 0.5 ? mix(base, dark, t * 1.5) : mix(base, light, (t - 0.5) * 1.7);
      strata.push({ o: f(Math.min(1, Math.max(0, i / (count - 1) + (rand() - 0.5) * 0.06))), c: color });
    }
    strata.sort((a, b) => a.o - b.o);
  }
  const storm =
    kind === "gas" && rand() < 0.55
      ? { x: f((rand() - 0.5) * 0.7), y: f(0.12 + rand() * 0.42), rx: f(0.2 + rand() * 0.14), ry: f(0.09 + rand() * 0.06) }
      : null;
  const cracks = [];
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    const x0 = Math.cos(a) * 0.1;
    const y0 = Math.sin(a) * 0.1;
    const bend = (rand() - 0.5) * 0.7;
    const x1 = Math.cos(a + bend * 0.5) * (0.45 + rand() * 0.2);
    const y1 = Math.sin(a + bend * 0.5) * (0.45 + rand() * 0.2);
    const x2 = Math.cos(a + bend) * (0.85 + rand() * 0.2);
    const y2 = Math.sin(a + bend) * (0.85 + rand() * 0.2);
    cracks.push(`M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`);
  }
  const dunes = [];
  if (kind === "dust") {
    for (let i = 0; i < 4; i++) {
      const y = -0.55 + i * 0.36 + (rand() - 0.5) * 0.1;
      dunes.push({ d: `M-1 ${f(y)}Q-0.2 ${f(y - 0.14)} 1 ${f(y + 0.06)}`, light: i % 2 === 0 });
    }
  }
  return {
    kind,
    colors,
    spin,
    radius,
    ring,
    marks,
    bands,
    tilt,
    blots,
    strata,
    storm,
    cracks,
    dunes,
    uid: `pd${hashId(node.id).toString(36)}`,
  };
}

const RING_BACK = "M-1.8 0A1.8 0.44 0 0 1 1.8 0";
const RING_FRONT = "M1.8 0A1.8 0.44 0 0 1 -1.8 0";

// Half of a tilted ring. The back half is drawn under the globe, the front half over it.
function RingArc({ face, d }) {
  const [, dark, light] = face.colors;
  return (
    <g transform={`rotate(${face.tilt})`}>
      <path d={d} fill="none" stroke={`url(#${face.uid}r)`} strokeWidth="0.2" strokeLinecap="round" />
      <path d={d} fill="none" stroke={dark} strokeWidth="0.03" opacity="0.45" transform="scale(1.06 1.06)" />
      <path d={d} fill="none" stroke={light} strokeWidth="0.025" opacity="0.8" transform="scale(0.93 0.93)" />
    </g>
  );
}

function Surface({ face }) {
  const { uid, kind, colors, blots, marks, cracks, dunes, storm, spin } = face;
  const [base, dark, light] = colors;
  return (
    <g transform={`rotate(${spin})`}>
      {kind === "ice" ? (
        <>
          <ellipse cy="-0.62" rx="0.78" ry="0.4" fill={light} opacity="0.92" />
          <ellipse cy="0.74" rx="0.5" ry="0.22" fill={light} opacity="0.7" />
        </>
      ) : null}
      {blots.map((b, i) => (
        <ellipse
          key={i}
          cx={b.x}
          cy={b.y}
          rx={b.rx}
          ry={b.ry}
          transform={`rotate(${b.rot} ${b.x} ${b.y})`}
          fill={`url(#${uid}${b.light ? "l" : "d"})`}
          opacity={b.o}
        />
      ))}
      {dunes.map((d, i) => (
        <path key={i} d={d.d} fill="none" stroke={d.light ? light : dark} strokeWidth="0.07" strokeLinecap="round" opacity="0.28" />
      ))}
      {kind === "ice"
        ? cracks.slice(0, 3).map((d, i) => (
            <path key={i} d={d} fill="none" stroke={i % 2 ? "#ffffff" : dark} strokeWidth="0.022" opacity="0.5" />
          ))
        : null}
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={m.x} cy={m.y} r={m.s} fill={dark} opacity="0.62" />
          <circle cx={m.x + m.s * 0.24} cy={m.y + m.s * 0.24} r={m.s * 0.86} fill={base} opacity="0.92" />
          <circle cx={m.x + m.s * 0.5} cy={m.y + m.s * 0.5} r={m.s * 0.3} fill={light} opacity="0.28" />
        </g>
      ))}
      {storm ? (
        <g>
          <ellipse cx={storm.x} cy={storm.y} rx={storm.rx} ry={storm.ry} fill={dark} opacity="0.55" />
          <ellipse cx={storm.x} cy={storm.y} rx={storm.rx * 0.55} ry={storm.ry * 0.5} fill={light} opacity="0.5" />
        </g>
      ) : null}
    </g>
  );
}

function Scorch({ face }) {
  return (
    <g className="scorch">
      <rect x="-1" y="-1" width="2" height="2" fill="#190907" opacity="0.62" />
      {face.cracks.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#ff7a3a" strokeWidth="0.05" strokeLinecap="round" opacity="0.85" />
      ))}
    </g>
  );
}

function PlanetDotImpl({ face, detail, shut }) {
  const { uid, kind, colors, radius: r } = face;
  // Once the realistic render of this world is ready, show it instead of the vector art.
  const sprite = useArt().planets.get(uid);
  if (sprite) {
    const e = sprite.ext;
    return (
      <g className={`planet-art surface-${kind}`}>
        <image href={sprite.url} x={-r * e} y={-r * e} width={2 * r * e} height={2 * r * e} />
        {shut ? (
          <g transform={`scale(${r})`}>
            <defs>
              <clipPath id={`${uid}c`}>
                <circle r="1" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${uid}c)`}>
              <Scorch face={face} />
            </g>
          </g>
        ) : null}
      </g>
    );
  }
  const [base, dark, light] = colors;
  const banded = kind === "gas" || kind === "fuel";
  const atmo = ATMO[kind];
  const globe = banded ? `url(#${uid}s)` : `url(#${uid}b)`;
  const ringed = face.ring && detail;
  return (
    <g className={`planet-art surface-${kind}`}>
      <g transform={`scale(${r})`}>
        <defs>
          <clipPath id={`${uid}c`}>
            <circle r="1" />
          </clipPath>
          <radialGradient id={`${uid}a`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.6" stopColor={light} stopOpacity="0" />
            <stop offset="0.645" stopColor={light} stopOpacity={atmo} />
            <stop offset="0.78" stopColor={base} stopOpacity={atmo * 0.32} />
            <stop offset="1" stopColor={base} stopOpacity="0" />
          </radialGradient>
          {banded ? (
            <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1" gradientTransform={`rotate(${face.tilt} 0.5 0.5)`}>
              {face.strata.map((s, i) => (
                <stop key={i} offset={s.o} stopColor={s.c} />
              ))}
            </linearGradient>
          ) : (
            <radialGradient id={`${uid}b`} cx="0.36" cy="0.32" r="0.85">
              <stop offset="0" stopColor={mix(base, light, 0.38)} />
              <stop offset="0.45" stopColor={base} />
              <stop offset="1" stopColor={mix(base, dark, 0.8)} />
            </radialGradient>
          )}
          {face.ring ? (
            <linearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={light} stopOpacity="0.35" />
              <stop offset="0.5" stopColor={light} stopOpacity="0.95" />
              <stop offset="1" stopColor={light} stopOpacity="0.35" />
            </linearGradient>
          ) : null}
          {detail && face.blots.length ? (
            <>
              <radialGradient id={`${uid}d`}>
                <stop offset="0" stopColor={dark} stopOpacity="0.9" />
                <stop offset="1" stopColor={dark} stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${uid}l`}>
                <stop offset="0" stopColor={light} stopOpacity="0.9" />
                <stop offset="1" stopColor={light} stopOpacity="0" />
              </radialGradient>
            </>
          ) : null}
        </defs>
        <circle className="atmo" r="1.55" fill={`url(#${uid}a)`} />
        {ringed ? <RingArc face={face} d={RING_BACK} /> : null}
        <g clipPath={`url(#${uid}c)`}>
          <circle r="1" fill={globe} />
          {detail ? <Surface face={face} /> : null}
          {detail ? <circle r="1" fill="url(#pl-grain)" /> : null}
          <circle r="1" fill="url(#pl-night)" />
          <circle r="1" fill="url(#pl-shine)" opacity={SHINE[kind]} />
          {shut ? <Scorch face={face} /> : null}
        </g>
        <circle className="limb" r="0.985" fill="none" stroke="url(#pl-rim)" strokeWidth="0.05" />
        {ringed ? <RingArc face={face} d={RING_FRONT} /> : null}
      </g>
    </g>
  );
}

export const PlanetDot = memo(PlanetDotImpl);
