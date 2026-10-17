import { useEffect, useRef, useState } from "react";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  drawPercent,
  fuelCost,
  idealCost,
  compareRuns,
  habitability,
  affordableVariable,
  fuelMinute,
  makeFuelCard,
  buyPacks,
} from "./game/rules.js";
import {
  INNER,
  MIDDLE,
  OUTER,
  STATION,
  LINKS,
  NODES,
  shellOf,
  destinations,
} from "./game/map.js";
import bank from "./data/questions.json";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const PENDING = "aais-pending-scores";
const SCALE = 190;
const FLIGHT_MS = 2400;
const VIEW_W = 720;
const VIEW_H = 640;
const WORLD = 900;
const SURFACES = ["rock", "ice", "gas", "dust"];
const PLANET_COLORS = {
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
function starfield() {
  let s = 0x51a7;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const stars = [];
  for (let i = 0; i < 280; i++) {
    const bright = rand() < 0.08;
    stars.push({
      x: Math.round((rand() - 0.5) * 2600),
      y: Math.round((rand() - 0.5) * 2400),
      r: bright ? 1.4 + rand() * 1.4 : 0.28 + rand() * 0.6,
      o: bright ? 0.8 + rand() * 0.2 : 0.22 + rand() * 0.45,
    });
  }
  return stars;
}

const STARS = starfield();
const BAYS = [0, 60, 120, 180, 240, 300];
const ROUND_MS = 15 * 60 * 1000;
const QUESTION_MS = 60_000;
const FUEL_WORLDS = new Set(NODES.filter((n) => n.shell === "fuel").map((n) => n.id));

const DOMAINS = [
  ["general", "General knowledge"],
  ["mental", "Mental ability"],
  ["technology", "Technology"],
];

const BEATS = [
  {
    k: "launch",
    title: "Departure",
    text: "A rocket lifts off Vulcan. The ground falls away.",
  },
  {
    k: "dock",
    title: "Docking",
    text: "The rocket locks onto the ship.",
  },
  {
    k: "window",
    title: "Look back",
    text: "Through the window, Vulcan blows apart. The clock starts with the chart.",
  },
];

const END_COPY = {
  win: "A world will take you.",
  time: "Fifteen minutes are up.",
  stranded: "No open route you can afford.",
};

function round2(v) {
  return Math.round(v * 100) / 100;
}

function fmtNum(n) {
  const shown = Math.round(n * 10) / 10;
  return Object.is(shown, -0) ? "0" : String(shown);
}

function fmtScore(n) {
  const t = Math.round(n * 100) / 100;
  return Object.is(t, -0) ? "0" : String(t);
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bend(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(16, len * 0.06);
  const cx = round2(mx - (dy / len) * bow);
  const cy = round2(my + (dx / len) * bow);
  const ax = round2(a.x);
  const ay = round2(a.y);
  const bx = round2(b.x);
  const by = round2(b.y);
  return {
    d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`,
    rev: `M ${bx} ${by} Q ${cx} ${cy} ${ax} ${ay}`,
    mid: {
      x: round2(0.25 * ax + 0.5 * cx + 0.25 * bx),
      y: round2(0.25 * ay + 0.5 * cy + 0.25 * by),
    },
  };
}

const POS = Object.fromEntries(
  NODES.map((n) => [
    n.id,
    {
      x: round2(n.r * SCALE * Math.cos(n.angle)),
      y: round2(n.r * SCALE * Math.sin(n.angle)),
    },
  ]),
);

const ROUTES = LINKS.map((edge) => ({ ...edge, ...bend(POS[edge.a], POS[edge.b]) }));

function routePath(from, to) {
  const edge = ROUTES.find(
    (r) => (r.a === from && r.b === to) || (r.a === to && r.b === from),
  );
  if (!edge) return "";
  return edge.a === from ? edge.d : edge.rev;
}

function heading(id) {
  const p = POS[id];
  if (!p || (p.x === 0 && p.y === 0)) return -90;
  return Math.round((Math.atan2(p.y, p.x) * 180) / Math.PI);
}

function linkOpen(edge, here, closed) {
  const shut = new Set(closed);
  const a = shut.has(edge.a);
  const b = shut.has(edge.b);
  if (!a && !b) return true;
  if (a && b) return false;
  return (a && edge.a === here) || (b && edge.b === here);
}

function fresh() {
  return {
    phase: "name",
    name: "",
    intro: 0,
    here: STATION,
    fuel: START_FUEL,
    credits: START_CREDITS,
    variable: START_VARIABLE,
    closed: [],
    path: [],
    deadline: 0,
    stoppedAt: 0,
    endReason: "",
    flight: null,
    domain: "",
    card: null,
    qDeadline: 0,
    fuelDeck: [],
    fuelIndex: 0,
    fuelAnswers: [],
    fuelSeen: [],
    fuelDeadline: 0,
    creditFloor: 0,
    visited: [],
    note: "",
    postState: "",
    sent: false,
  };
}

function payloadOk(p) {
  if (!p || typeof p.name !== "string" || p.name.trim() === "") return false;
  if (typeof p.finishedAt !== "string" || Number.isNaN(Date.parse(p.finishedAt))) return false;
  if (typeof p.settled === "boolean") {
    return Number.isInteger(p.timeLeft) && p.timeLeft >= 0 && Number.isInteger(p.worlds) && p.worlds >= 0 && Number.isFinite(p.fuel);
  }
  return typeof p.score === "number" && Number.isFinite(p.score);
}

function runFacts(snap) {
  return {
    settled: snap.endReason === "win",
    timeLeft: Math.floor(Math.max(0, snap.deadline - (snap.stoppedAt || snap.deadline)) / 1000),
    worlds: snap.visited.length,
    fuel: snap.fuel,
  };
}

function drawFuelCard(seen) {
  let card = makeFuelCard();
  for (let i = 0; i < 12 && seen.includes(card.prompt); i++) card = makeFuelCard();
  return card;
}

function readPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(list));
  } catch {
    /* the score stays on screen */
  }
}

async function sendScore(payload) {
  try {
    const res = await fetch(`${API}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ponytail: one chain for score posts; split per tab if two browsers share this storage
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function flushPendingBody() {
  const left = [];
  for (const item of readPending()) {
    if (!payloadOk(item) || (await sendScore(item))) continue;
    left.push(item);
  }
  writePending(left);
  return left.length;
}

function Ring({ ms, total }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const u = Math.max(0, Math.min(1, ms / total));
  return (
    <svg className="ring" viewBox="0 0 80 80" aria-hidden="true">
      <circle className="ring-track" cx="40" cy="40" r={r} />
      <circle
        className="ring-value"
        cx="40"
        cy="40"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - u)}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="46" textAnchor="middle">
        {Math.ceil(ms / 1000)}
      </text>
    </svg>
  );
}

function useBoard() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const res = await fetch(`${API}/api/leaderboard`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!stop) {
          setRows(Array.isArray(data) ? data : []);
          setErr(false);
        }
      } catch {
        if (!stop) setErr(true);
      }
    }
    pull();
    const id = setInterval(pull, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return { rows, err };
}

function BoardTable({ rows, err }) {
  const ranked = [...rows].sort(compareRuns);
  return (
    <>
      {err ? <p className="error">Can't reach the leaderboard.</p> : null}
      {ranked.length === 0 ? <p className="hint">No scores yet.</p> : null}
      {ranked.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Settled</th>
              <th className="num">Time left</th>
              <th className="num">Worlds</th>
              <th className="num">Fuel score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, i) => (
              <tr key={row.id ?? i}>
                <td>{i + 1}</td>
                <td>{row.name}</td>
                <td>{row.settled ? "Yes" : "No"}</td>
                <td className="num">{formatClock((row.timeLeft ?? 0) * 1000)}</td>
                <td className="num">{row.worlds ?? 0}</td>
                <td className="num">{fmtScore(Number.isFinite(row.fuel) ? row.fuel : Number(row.score) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function Board() {
  const { rows, err } = useBoard();
  return (
    <main className="board">
      <p className="eyebrow">All Alone in Space</p>
      <h1>Leaderboard</h1>
      <p className="hint">Wins rank above every loss. Then more worlds, then more fuel left. Wins with those tied rank by time left; losses by who lasted longer.</p>
      <BoardTable rows={rows} err={err} />
    </main>
  );
}

function NameScreen({ onStart }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="screen">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const next = name.trim();
          if (!next) {
            setError("Enter a name.");
            return;
          }
          onStart(next.slice(0, 40));
        }}
      >
        <p className="eyebrow">All Alone in Space</p>
        <h1>Who is flying?</h1>
        <label htmlFor="pilot">Name</label>
        <input
          id="pilot"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={40}
          autoComplete="name"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="row">
          <button type="submit">Launch</button>
        </div>
      </form>
    </main>
  );
}

const SAUCER_X = 11.4;

function ShipShapes() {
  const cx = SAUCER_X;
  const grid = [-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return `M${(cx + c * 1.9).toFixed(2)} ${(s * 1.9).toFixed(2)}L${(cx + c * 6.3).toFixed(2)} ${(s * 6.3).toFixed(2)}`;
    })
    .join("");
  return (
    <>
      <ellipse className="plume" cx="-13.8" cy="-8.16" rx="3.2" ry="0.8" />
      <ellipse className="plume" cx="-13.8" cy="8.16" rx="3.2" ry="0.8" />
      <ellipse className="exhaust" cx="-11.9" cy="-8.16" rx="1.25" ry="0.62" />
      <ellipse className="exhaust" cx="-11.9" cy="8.16" rx="1.25" ry="0.62" />
      <rect className="nacelle" x="-11.4" y="-9.18" width="16" height="2.05" rx="1.02" />
      <rect className="nacelle" x="-11.4" y="7.13" width="16" height="2.05" rx="1.02" />
      <circle className="cap" cx="4.15" cy="-8.16" r="0.9" />
      <circle className="cap" cx="4.15" cy="8.16" r="0.9" />
      <path className="line" d="M-9.4 -8.16H3.1M-9.4 8.16H3.1" />
      <path className="pylon" d="M-0.2 -2.05L-2.6 -7.05L-5.6 -7.05L-2.6 -1.85Z" />
      <path className="pylon" d="M-0.2 2.05L-2.6 7.05L-5.6 7.05L-2.6 1.85Z" />
      <path className="hull" d="M9.2 0C8.2 1.9 3.2 2.75-1 2.5-5.4 2.2-8.4 1.35-10.6 0-8.4-1.35-5.4-2.2-1-2.5 3.2-2.75 8.2-1.9 9.2 0Z" />
      <path className="line" d="M6.6 0H-9.4M-4.2 -1.35V1.35" />
      <circle className="saucer" cx={cx} cy="0" r="7" />
      <path className="line" d={grid} />
      <circle className="line" cx={cx} cy="0" r="4.9" />
      <circle className="line" cx={cx} cy="0" r="2.7" />
      <ellipse className="impulse" cx="5.46" cy="-3.71" rx="1.25" ry="0.46" transform="rotate(-58 5.46 -3.71)" />
      <ellipse className="impulse" cx="5.46" cy="3.71" rx="1.25" ry="0.46" transform="rotate(58 5.46 3.71)" />
      <circle className="bridge" cx={cx + 2.1} cy="0" r="1.05" />
      <circle className="line" cx={cx + 2.1} cy="0" r="0.42" />
    </>
  );
}

function ShipSvg({ className }) {
  return (
    <svg className={className} viewBox="-24 -11 46 22" aria-hidden="true">
      <ShipShapes />
    </svg>
  );
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function faceOf(node) {
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
  return { kind, colors, spin, radius, ring, marks, bands, clip: `pd${hashId(node.id).toString(36)}` };
}

function PlanetDot({ face }) {
  const r = face.radius;
  const [base, dark, light] = face.colors;
  const glossy = face.kind === "gas" || face.kind === "ice" || face.kind === "fuel";
  return (
    <g className={`surface surface-${face.kind}`}>
      {face.ring ? (
        <ellipse
          className="halo"
          rx={r * 1.9}
          ry={r * 0.42}
          transform={`rotate(${face.spin})`}
          fill="none"
          stroke={light}
          strokeWidth={Math.max(0.8, r * 0.13)}
          opacity="0.72"
        />
      ) : null}
      <svg x={-r} y={-r} width={r * 2} height={r * 2} viewBox="-1 -1 2 2">
        <clipPath id={face.clip}>
          <circle r="1" />
        </clipPath>
        <g clipPath={`url(#${face.clip})`} filter="url(#planet-grain)">
          <circle className="body" r="1" fill={base} />
          <g transform={`rotate(${face.spin})`}>
            {face.kind === "ice" ? <ellipse cy="-0.28" rx="0.82" ry="0.4" fill={light} opacity="0.92" /> : null}
            {face.bands.map((band, i) => (
              <ellipse key={i} cy={band.y} rx="1.15" ry={band.ry} fill={band.alt ? light : dark} opacity="0.9" />
            ))}
            {face.marks.map((mark, i) => (
              <circle key={i} cx={mark.x} cy={mark.y} r={mark.s} fill={i % 2 ? light : dark} opacity="0.85" />
            ))}
          </g>
        </g>
        <circle r="1" fill={`url(#planet-light)`} clipPath={`url(#${face.clip})`} />
        {glossy ? <ellipse cx="-0.28" cy="-0.32" rx="0.2" ry="0.1" fill="#fff" opacity="0.3" /> : null}
      </svg>
      <circle className="limb" r={r + 0.45} fill="none" />
    </g>
  );
}

function Starbase(props) {
  const { className, ...rest } = props;
  return (
    <svg
      className={className ? `starbase ${className}` : "starbase"}
      viewBox="-40 -40 80 80"
      aria-hidden="true"
      {...rest}
    >
      <circle className="ring outer" r="28" />
      <circle className="ring inner" r="17" />
      <circle className="core" r="5" />
      {BAYS.map((deg) => (
        <circle key={deg} className="bay" r="1.8" transform={`rotate(${deg}) translate(28 0)`} />
      ))}
    </svg>
  );
}

function Rocket() {
  return (
    <svg className="rocket" viewBox="-16 -30 32 60" aria-hidden="true">
      <path className="flame" d="M-5 18 Q0 32 5 18 Q0 24 -5 18 Z" />
      <path className="fin" d="M-7 8 L-16 20 L-7 16 Z" />
      <path className="fin" d="M7 8 L16 20 L7 16 Z" />
      <path className="hull" d="M0 -24 L8 16 L-8 16 Z" />
      <circle className="port" cx="0" cy="-4" r="2.4" />
    </svg>
  );
}

function Intro({ step, onSkip }) {
  const beat = BEATS[step];
  return (
    <main className={`opener beat-${beat.k}`}>
      <div className="opener-scene" aria-hidden="true">
        <div className="starfield" />
        <div className="launch-ground">
          <div className="ball" />
          <Rocket />
        </div>
        <div className="meet">
          <ShipSvg className="ship ship-actor" />
          <Rocket />
        </div>
        <div className="porthole">
          <div className="window-view">
            <div className="ball" />
            <span className="fireball" />
            <span className="shock" />
            <span className="chunk a" />
            <span className="chunk b" />
            <span className="chunk c" />
            <span className="chunk d" />
            <span className="chunk e" />
            <span className="flash" />
          </div>
        </div>
      </div>
      <div className="opener-copy" aria-live="polite">
        <p className="eyebrow">All Alone in Space</p>
        <h1>{beat.title}</h1>
        <p>{beat.text}</p>
      </div>
      <button type="button" className="skip" onClick={onSkip}>
        Skip
      </button>
    </main>
  );
}

function fit(origin, size) {
  const hi = WORLD - size;
  if (hi < -WORLD) return (-WORLD + hi) / 2;
  return Math.max(-WORLD, Math.min(hi, origin));
}

function MapView({ snap, shipRef, onLaunch, view, onView }) {
  const stageRef = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const viewer = snap.phase === "fly" && snap.flight ? snap.flight.from : snap.here;
  const options = destinations(viewer, snap.closed);
  const byId = new Map(options.map((d) => [d.id, d]));
  const shut = new Set(snap.closed);
  const flying = snap.phase === "fly" && snap.flight;
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const w = Math.min(1800, Math.max(200, v.w * Math.exp(dy * 0.0015)));
      const h = w * (VIEW_H / VIEW_W);
      const next = {
        x: fit(v.x + px * (v.w - w), w),
        y: fit(v.y + py * (v.h - h), h),
        w,
        h,
      };
      viewRef.current = next;
      onView(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onView]);
  function onPointerDown(e) {
    if (flying) return;
    moved.current = false;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 6) {
      moved.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* Pointer capture needs a real pointer. */
      }
    }
    if (!moved.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onView({
      x: fit(d.vx - (dx / rect.width) * view.w, view.w),
      y: fit(d.vy - (dy / rect.height) * view.h, view.h),
      w: view.w,
      h: view.h,
    });
  }
  function onPointerUp() {
    drag.current = null;
  }
  return (
    <div className="map-stage" ref={stageRef}>
    <svg
      className={flying ? "map-svg flying" : "map-svg"}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="img"
      aria-label="Star map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <filter id="planet-grain" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4" stitchTiles="stitch" result="noise" />
          <feComponentTransfer in="noise" result="soft">
            <feFuncA type="linear" slope="0.28" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="soft" mode="overlay" />
        </filter>
        <radialGradient id="planet-light" cx="32%" cy="28%" r="68%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="70%" stopColor="#02040a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#02040a" stopOpacity="0.82" />
        </radialGradient>
      </defs>
      <g className="starfield">
        <rect x="-1500" y="-1400" width="3000" height="2800" fill="#070b16" />
        <ellipse cx="-480" cy="-220" rx="640" ry="200" fill="#1c2a4a" opacity="0.45" transform="rotate(-16 -480 -220)" />
        <ellipse cx="520" cy="340" rx="520" ry="160" fill="#2a1830" opacity="0.32" transform="rotate(14 520 340)" />
        {STARS.map((star, i) => (
          <circle key={i} className="star" cx={star.x} cy={star.y} r={star.r} opacity={star.o} />
        ))}
      </g>
      {flying ? (
        <path id="flight" d={snap.flight.d} fill="none" stroke="none" pointerEvents="none" />
      ) : null}
      {ROUTES.map((edge) => {
        const open = linkOpen(edge, viewer, snap.closed);
        const hot = open && (edge.a === viewer || edge.b === viewer);
        const onRoute =
          snap.flight &&
          ((edge.a === snap.flight.from && edge.b === snap.flight.to) ||
            (edge.a === snap.flight.to && edge.b === snap.flight.from));
        const cls = ["link", `d${edge.distance}`, open ? "" : "shut", hot ? "hot" : "", onRoute ? "onroute" : ""]
          .filter(Boolean)
          .join(" ");
        return <path key={`${edge.a}-${edge.b}`} d={edge.d} className={cls} />;
      })}
      {flying ? (
        <path className="streak" d={snap.flight.d} pathLength="100" style={{ animationDuration: `${FLIGHT_MS}ms` }} />
      ) : null}
      {NODES.map((n) => {
        const p = POS[n.id];
        const dest = byId.get(n.id);
        const cost = dest ? fuelCost(snap.variable, dest.distance) : null;
        const ready = snap.phase === "map" && cost != null && cost <= snap.fuel + 1e-9;
        const face = n.id === STATION ? null : faceOf(n);
        const classes = [
          "node",
          `node-${n.shell}`,
          n.id === viewer ? "here" : "",
          shut.has(n.id) ? "shut" : "",
          ready ? "ready" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={n.id}
            className={classes}
            transform={`translate(${p.x} ${p.y})`}
            role={ready ? "button" : undefined}
            tabIndex={ready ? 0 : undefined}
            aria-label={
              ready ? `Fly to ${n.id === STATION ? "the station" : n.id}, ${fmtNum(cost)} fuel` : undefined
            }
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              if (ready) onLaunch(dest);
            }}
            onKeyDown={(e) => {
              if (!ready || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              onLaunch(dest);
            }}
          >
            <title>
              {n.id === STATION ? "Station" : n.id}
              {cost != null ? `, ${fmtNum(cost)} fuel${ready ? "" : ", not enough fuel"}` : ""}
            </title>
            {n.id === STATION ? (
              <>
                <circle className="hit" r="30" />
                <Starbase x="-32" y="-32" width="64" height="64" />
              </>
            ) : (
              <>
                <circle className="hit" r={Math.max(14, face.radius + 3)} />
                <PlanetDot face={face} />
                {n.shell === "inner" || n.shell === "middle" || n.shell === "outer" ? (
                  <text className="bang" y={-(face.radius + 21)} textAnchor="middle" aria-hidden="true">
                    !
                  </text>
                ) : null}
              </>
            )}
            <text
              className="node-label"
              y={-(n.id === STATION ? 26 : face.radius + 3)}
              textAnchor="middle"
              dominantBaseline="text-after-edge"
            >
              {n.id === STATION ? "Station" : n.id}
            </text>
          </g>
        );
      })}
      {snap.phase === "map"
        ? ROUTES.map((edge) => {
            const open = linkOpen(edge, snap.here, snap.closed);
            if (!open || (edge.a !== snap.here && edge.b !== snap.here)) return null;
            const cost = fuelCost(snap.variable, edge.distance);
            return (
              <text key={`cost-${edge.a}-${edge.b}`} className="cost hot" x={edge.mid.x} y={edge.mid.y} textAnchor="middle">
                {fmtNum(cost)}
              </text>
            );
          })
        : null}
      {flying ? (
        <g ref={shipRef} className="ship">
          <ShipShapes />
        </g>
      ) : (
        <g transform={`translate(${POS[snap.here].x} ${POS[snap.here].y}) rotate(${heading(snap.here)})`}>
          <svg className="ship" viewBox="-24 -11 46 22" x="-22" y="-11" width="44" height="22" overflow="visible">
            <ShipShapes />
          </svg>
        </g>
      )}
    </svg>
    </div>
  );
}

function Shop({ credits, fuel, world, onBuy, onLeave }) {
  const [counts, setCounts] = useState([0, 0, 0]);
  const quote = buyPacks({ credits, fuel }, counts);
  function canInc(i) {
    const next = counts.slice();
    next[i] += 1;
    return buyPacks({ credits, fuel }, next).ok;
  }
  return (
    <section className="panel">
      <p className="eyebrow">{world}</p>
      <h1>Shop</h1>
      <p>
        {credits} {credits === 1 ? "credit" : "credits"}, {fmtNum(fuel)} fuel. Buy as many packs as you can pay for.
      </p>
      {SHOP_PACKS.map((pack, i) => (
        <div className="pack" key={pack.credits}>
          <span>
            {pack.fuel} fuel for {pack.credits} credits
          </span>
          <button
            type="button"
            onClick={() => {
              if (counts[i] <= 0) return;
              const next = counts.slice();
              next[i] -= 1;
              setCounts(next);
            }}
            disabled={counts[i] === 0}
            aria-label={`Fewer packs of ${pack.fuel} fuel`}
          >
            −
          </button>
          <span>{counts[i]}</span>
          <button
            type="button"
            onClick={() => {
              if (!canInc(i)) return;
              const next = counts.slice();
              next[i] += 1;
              setCounts(next);
            }}
            disabled={!canInc(i)}
            aria-label={`More packs of ${pack.fuel} fuel`}
          >
            +
          </button>
        </div>
      ))}
      <p>
        {quote.cost > 0
          ? `${quote.cost} credits for ${quote.fuel - fuel} fuel.`
          : "Choose a pack, or leave."}
      </p>
      <div className="row">
        <button
          type="button"
          disabled={!quote.ok || quote.cost <= 0}
          onClick={() => {
            if (!quote.ok || quote.cost <= 0) return;
            onBuy(counts);
            setCounts([0, 0, 0]);
          }}
        >
          Buy
        </button>
        <button type="button" onClick={onLeave}>
          Back to the map
        </button>
      </div>
    </section>
  );
}

function ChoiceButtons({ choices, onPick }) {
  return (
    <div className="choices">
      {choices.map((choice) => (
        <button key={choice} type="button" onClick={() => onPick(choice)}>
          {choice}
        </button>
      ))}
    </div>
  );
}

function Game() {
  const game = useRef(null);
  if (!game.current) game.current = fresh();
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [flyFuel, setFlyFuel] = useState(null);
  const [view, setView] = useState(() => {
    const w = 520;
    const h = w * (VIEW_H / VIEW_W);
    return { x: -w / 2, y: -h / 2, w, h };
  });
  const shipRef = useRef(null);
  const percentRef = useRef({});
  const usedRef = useRef({ general: new Set(), mental: new Set(), technology: new Set() });

  function commit(patch) {
    game.current = { ...game.current, ...patch };
    setTick((n) => n + 1);
  }

  function finish(reason) {
    if (game.current.phase === "end") return;
    commit({
      phase: "end",
      endReason: reason,
      flight: null,
      stoppedAt: Date.now(),
    });
  }

  const snap = game.current;
  void tick;

  function dock() {
    if (game.current.phase !== "intro") return;
    const percents = {};
    for (const id of [...INNER, ...MIDDLE, ...OUTER]) {
      percents[id] = drawPercent(shellOf(id));
    }
    percentRef.current = percents;
    commit({ phase: "map", deadline: Date.now() + ROUND_MS });
  }

  function launch(dest) {
    const g = game.current;
    if (g.phase !== "map" || !dest) return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    if (!destinations(g.here, g.closed).some((d) => d.id === dest.id)) return;
    const actual = fuelCost(g.variable, dest.distance);
    if (actual > g.fuel + 1e-9) return;
    const ideal = idealCost(dest.distance);
    setFlyFuel(g.fuel);
    commit({
      phase: "fly",
      here: dest.id,
      path: [...g.path, { ideal, actual }],
      fuel: g.fuel - actual,
      note: "",
      flight: {
        from: g.here,
        to: dest.id,
        d: routePath(g.here, dest.id),
        fromFuel: g.fuel,
        actual,
      },
    });
  }

  function arrive() {
    const g = game.current;
    if (g.phase !== "fly" || !g.flight) return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    const id = g.flight.to;
    const visited = id === STATION || g.visited.includes(id) ? g.visited : [...g.visited, id];
    if (id === STATION) {
      commit({ phase: "map", flight: null });
      return;
    }
    if (FUEL_WORLDS.has(id)) {
      if (g.closed.includes(id)) {
        commit({ phase: "map", here: id, flight: null, visited });
        return;
      }
      const card = drawFuelCard(g.fuelSeen);
      commit({
        phase: "fuel",
        here: id,
        flight: null,
        visited,
        closed: [...g.closed, id],
        creditFloor: g.credits,
        fuelDeck: [card],
        fuelIndex: 0,
        fuelAnswers: [],
        fuelSeen: [...g.fuelSeen, card.prompt],
        fuelDeadline: Date.now() + QUESTION_MS,
      });
      return;
    }
    commit({ phase: "pick", here: id, flight: null, visited });
  }

  function takeCard(domain) {
    const seen = usedRef.current[domain];
    const deck = bank[domain] || [];
    let pool = deck.filter((card) => !seen.has(card.id));
    if (!pool.length) {
      seen.clear();
      pool = deck;
    }
    if (!pool.length) return null;
    const card = pool[Math.floor(Math.random() * pool.length)];
    seen.add(card.id);
    return card;
  }

  function chooseDomain(domain) {
    const g = game.current;
    if (g.phase !== "pick") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    const card = takeCard(domain);
    if (!card) return;
    commit({
      phase: "question",
      domain,
      card,
      qDeadline: Date.now() + QUESTION_MS,
    });
  }

  function resolveQuestion(correct, timedOut) {
    const g = game.current;
    if (g.phase !== "question") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    const result = habitability(
      { percent: percentRef.current[g.here], credits: g.credits, variable: g.variable },
      correct,
    );
    percentRef.current[g.here] = result.percent;
    const closed = [...g.closed, g.here];
    const exits = destinations(g.here, closed).map((hop) => hop.distance);
    const variable = result.won ? result.variable : affordableVariable(result.variable, g.fuel, exits);
    if (result.won) {
      game.current = { ...g, credits: result.credits, variable };
      finish("win");
      return;
    }
    commit({
      credits: result.credits,
      variable,
      closed,
      phase: "map",
      card: null,
      note: timedOut
        ? "Time's up. This world is closed."
        : correct
          ? "Right answer. This world is closed."
          : "Wrong answer. This world is closed.",
    });
  }

  function closeFuelMinute() {
    const g = game.current;
    if (g.phase !== "fuel") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    const result = fuelMinute(g.variable, g.fuelAnswers);
    const exits = destinations(g.here, g.closed).map((hop) => hop.distance);
    commit({
      phase: "shop",
      variable: affordableVariable(result.variable, g.fuel, exits),
      closed: g.closed.includes(g.here) ? g.closed : [...g.closed, g.here],
    });
  }

  function markFuel(kind) {
    const g = game.current;
    if (g.phase !== "fuel") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    const answers = [...g.fuelAnswers, kind];
    const card = drawFuelCard(g.fuelSeen);
    commit({
      fuelAnswers: answers,
      fuelIndex: 0,
      fuelDeck: [card],
      fuelSeen: [...g.fuelSeen, card.prompt],
      credits: g.creditFloor + answers.filter((answer) => answer === "right").length,
    });
  }

  function purchase(counts) {
    const g = game.current;
    if (g.phase !== "shop") return;
    const result = buyPacks({ credits: g.credits, fuel: g.fuel }, counts);
    if (!result.ok) return;
    commit({ credits: result.credits, fuel: result.fuel });
  }

  function leaveShop() {
    const g = game.current;
    if (g.phase !== "shop") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    commit({ phase: "map" });
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (snap.phase !== "intro") return;
    const id = setTimeout(() => {
      if (game.current.phase !== "intro") return;
      if (game.current.intro >= BEATS.length - 1) dock();
      else commit({ intro: game.current.intro + 1 });
    }, 3600);
    return () => clearTimeout(id);
  }, [snap.phase, snap.intro]);

  useEffect(() => {
    const g = game.current;
    if (!g.deadline || g.phase === "end" || g.phase === "name" || g.phase === "intro") return;
    const left = g.deadline - Date.now();
    if (left <= 0) {
      finish("time");
      return;
    }
    const id = setTimeout(() => finish("time"), left);
    return () => clearTimeout(id);
  }, [snap.phase, snap.deadline]);

  useEffect(() => {
    if (game.current.phase !== "question") return;
    const left = game.current.qDeadline - Date.now();
    const id = setTimeout(() => {
      if (game.current.phase !== "question") return;
      if (game.current.deadline && Date.now() >= game.current.deadline) {
        finish("time");
        return;
      }
      resolveQuestion(false, true);
    }, Math.max(0, left));
    return () => clearTimeout(id);
  }, [snap.phase, snap.qDeadline]);

  useEffect(() => {
    if (game.current.phase !== "fuel") return;
    const left = game.current.fuelDeadline - Date.now();
    const id = setTimeout(() => {
      if (game.current.phase !== "fuel") return;
      closeFuelMinute();
    }, Math.max(0, left));
    return () => clearTimeout(id);
  }, [snap.phase, snap.fuelDeadline]);

  useEffect(() => {
    if (game.current.phase !== "map") return;
    const g = game.current;
    const open = destinations(g.here, g.closed);
    const can = open.some((d) => fuelCost(g.variable, d.distance) <= g.fuel + 1e-9);
    if (!can) finish("stranded");
  }, [snap.phase, snap.here, snap.fuel, snap.variable, snap.closed]);

  useEffect(() => {
    if (snap.phase !== "fly" || !snap.flight) return;
    const el = shipRef.current;
    const pathEl = document.getElementById("flight");
    if (!el || !pathEl) return;
    const len = pathEl.getTotalLength();
    const { fromFuel, actual } = snap.flight;
    const started = performance.now();
    let dead = false;
    let raf = 0;
    const place = (u) => {
      const dist = len * u;
      const p = pathEl.getPointAtLength(dist);
      const a = pathEl.getPointAtLength(Math.max(0, dist - 1));
      const b = pathEl.getPointAtLength(Math.min(len, dist + 1));
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      el.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${angle}) translate(${-SAUCER_X} 0)`);
    };
    const frame = (now) => {
      if (dead) return;
      const t = Math.min(1, (now - started) / FLIGHT_MS);
      const u = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      place(u);
      setFlyFuel(fromFuel - actual * u);
      if (t < 1) raf = requestAnimationFrame(frame);
      else {
        place(1);
        setFlyFuel(null);
        arrive();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [snap.phase, snap.flight]);

  useEffect(() => {
    if (snap.phase !== "end" || game.current.sent) return;
    game.current = { ...game.current, sent: true };
    const facts = runFacts(game.current);
    const payload = {
      name: game.current.name,
      ...facts,
      finishedAt: new Date().toISOString(),
    };
    commit({ postState: "saving" });
    serial(async () => {
      const list = readPending();
      const seen = list.some(
        (item) => item.name === payload.name && item.finishedAt === payload.finishedAt,
      );
      if (!seen) writePending([...list, payload]);
      const left = await flushPendingBody();
      if (game.current.phase === "end") commit({ postState: left === 0 ? "saved" : "retry" });
    });
  }, [snap.phase]);

  useEffect(() => {
    function run() {
      return serial(async () => {
        if (!readPending().length) return;
        const left = await flushPendingBody();
        if (left === 0 && game.current.postState === "retry") commit({ postState: "saved" });
      });
    }
    run();
    const id = setInterval(run, 4000);
    return () => clearInterval(id);
  }, []);

  if (snap.phase === "name") {
    return <NameScreen onStart={(name) => commit({ name, phase: "intro", intro: 0 })} />;
  }
  if (snap.phase === "intro") return <Intro step={snap.intro} onSkip={dock} />;

  const clockMs =
    snap.phase === "end"
      ? Math.max(0, snap.deadline - (snap.stoppedAt || snap.deadline))
      : Math.max(0, snap.deadline - now);
  const fuelShown = snap.phase === "fly" && flyFuel != null ? flyFuel : snap.fuel;
  const where =
    snap.phase === "fly" && snap.flight
      ? `En route to ${snap.flight.to === STATION ? "the station" : snap.flight.to}`
      : snap.here === STATION
        ? "Station"
        : snap.here;
  const domainLabel = DOMAINS.find((d) => d[0] === snap.domain)?.[1] || "";
  const fuelCard = snap.fuelDeck[snap.fuelIndex] ?? null;
  const qMs = Math.max(0, snap.qDeadline - now);
  const fuelMs = Math.max(0, snap.fuelDeadline - now);

  return (
    <div className="play">
      <header className="hud">
        <div>
          <p className="eyebrow">{snap.name}</p>
          <strong>{where}</strong>
        </div>
        <div className="meters">
          <span>
            Fuel <b>{fmtNum(fuelShown)}</b>
          </span>
          <span>
            Credits <b>{snap.credits}</b>
          </span>
          <span className="clock">
            Clock <b>{formatClock(clockMs)}</b>
          </span>
        </div>
      </header>
      <div className="play-body">
        {snap.phase === "map" || snap.phase === "fly" ? (
          <>
            {snap.note ? (
              <p className="note" aria-live="polite">
                {snap.note}
              </p>
            ) : (
              <p className="hint">Routes from here show the fuel they cost.</p>
            )}
            <MapView snap={snap} shipRef={shipRef} onLaunch={launch} view={view} onView={setView} />
          </>
        ) : null}

        {snap.phase === "pick" ? (
          <section className="panel">
            <p className="eyebrow">{snap.here}</p>
            <h1>Choose a domain</h1>
            <p>One question. Sixty seconds.</p>
            <div className="row">
              {DOMAINS.map(([id, label]) => (
                <button key={id} type="button" onClick={() => chooseDomain(id)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {snap.phase === "question" && snap.card ? (
          <section className="panel">
            <div className="qhead">
              <Ring ms={qMs} total={QUESTION_MS} />
              <div>
                <p className="eyebrow">{snap.here}</p>
                <h1>{domainLabel}</h1>
              </div>
            </div>
            <p className="prompt">{snap.card.prompt}</p>
            <ChoiceButtons
              choices={snap.card.choices}
              onPick={(choice) => {
                if (game.current.phase !== "question") return;
                resolveQuestion(choice === game.current.card.answer, false);
              }}
            />
          </section>
        ) : null}

        {snap.phase === "fuel" && fuelCard ? (
          <section className="panel">
            <div className="qhead">
              <Ring ms={fuelMs} total={QUESTION_MS} />
              <div>
                <p className="eyebrow">{snap.here}</p>
                <h1>Fuel minute</h1>
              </div>
            </div>
            <p>One credit for each right answer. You have {snap.credits}. Skip if you want.</p>
            <p className="prompt">{fuelCard.prompt}</p>
            <ChoiceButtons
              choices={fuelCard.choices}
              onPick={(choice) => markFuel(choice === fuelCard.answer ? "right" : "wrong")}
            />
            <div className="row">
              <button type="button" onClick={() => markFuel("skip")}>
                Skip
              </button>
            </div>
          </section>
        ) : null}

        {snap.phase === "shop" ? (
          <Shop
            credits={snap.credits}
            fuel={snap.fuel}
            world={snap.here}
            onBuy={purchase}
            onLeave={leaveShop}
          />
        ) : null}

        {snap.phase === "end" ? <EndScreen snap={snap} /> : null}
      </div>
    </div>
  );
}

function EndScreen({ snap }) {
  const { rows, err } = useBoard();
  const facts = runFacts(snap);
  const post =
    snap.postState === "saved"
      ? "Score is on the board."
      : snap.postState === "retry"
        ? "The board is unreachable. This score stays on the laptop and retries."
        : "Sending the score…";
  return (
    <section className="panel">
      <p className="eyebrow">Run over</p>
      <h1>{END_COPY[snap.endReason] || "Run over."}</h1>
      <p className="final-score">
        Settled <strong>{facts.settled ? "Yes" : "No"}</strong>
        {" · "}
        Time left <strong>{formatClock(facts.timeLeft * 1000)}</strong>
        {" · "}
        Worlds <strong>{facts.worlds}</strong>
        {" · "}
        Fuel score <strong>{fmtScore(facts.fuel)}</strong>
      </p>
      <p>{post}</p>
      <p>
        <a href="/board">Open the display board</a>
      </p>
      <BoardTable rows={rows} err={err} />
    </section>
  );
}

export default function App() {
  const route = window.location.pathname.replace(/\/+$/, "") || "/";
  if (route === "/board") return <Board />;
  return <Game />;
}
