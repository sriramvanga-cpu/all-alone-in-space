import { useEffect, useRef, useState } from "react";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  drawPercent,
  fuelCost,
  idealCost,
  score,
  habitability,
  fuelMinute,
  buyPacks,
} from "./game/rules.js";
import {
  INNER,
  MIDDLE,
  OUTER,
  STATION,
  DELTA_VEGA,
  CETI_ALPHA,
  LINKS,
  NODES,
  shellOf,
  destinations,
} from "./game/map.js";
import bank from "./data/questions.json";

const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "")).replace(/\/+$/, "");
const PENDING = "aais-pending-scores";
const SCALE = 104;
const FLIGHT_MS = 2400;
const BODY = { inner: 7.2, middle: 9, outer: 11, fuel: 8 };
const SURFACES = ["rock", "ice", "gas", "dust"];
const SPECKS = [
  [-360, -180, 1.1],
  [-250, 60, 0.7],
  [-120, -240, 1.3],
  [60, -300, 0.8],
  [240, -220, 1.2],
  [340, -30, 0.7],
  [300, 160, 1.1],
  [140, 300, 0.8],
  [-40, 250, 1.4],
  [-220, 220, 0.7],
  [-330, -40, 1],
  [390, 110, 0.8],
];
const BAYS = [0, 60, 120, 180, 240, 300];
const ROUND_MS = 15 * 60 * 1000;
const QUESTION_MS = 60_000;
const FUEL_WORLDS = new Set([DELTA_VEGA, CETI_ALPHA]);

const DOMAINS = [
  ["general", "General knowledge"],
  ["mental", "Mental ability"],
  ["technology", "Technology"],
];

const BEATS = [
  {
    k: "leave",
    title: "Departure",
    text: "The ship lifts off Vulcan. The ground falls away.",
  },
  {
    k: "look",
    title: "Look back",
    text: "You turn for one last look at home.",
  },
  {
    k: "boom",
    title: "The flare",
    text: "Light tears across Vulcan. When it fades, the planet is gone.",
  },
  {
    k: "dock",
    title: "Docking",
    text: "You coast in and lock onto the station. The clock starts now.",
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

function norm(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ").replace(/^the /, "");
}

function matches(input, answer) {
  const a = norm(input);
  const b = norm(answer);
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return a !== "" && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
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
  let px = -dy / len;
  let py = dx / len;
  if (mx * px + my * py < 0) {
    px = -px;
    py = -py;
  }
  const approach = Math.abs(a.x * b.y - a.y * b.x) / len;
  const avoid = Math.max(0, 1 - approach / 140);
  const bulge = Math.min(160, Math.max(36, len * (0.26 + avoid * 0.4)));
  const cx = round2(mx + px * bulge);
  const cy = round2(my + py * bulge);
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

function labelAt(id) {
  const p = POS[id];
  if (id === STATION) return { x: 0, y: 44 };
  const len = Math.hypot(p.x, p.y) || 1;
  return {
    x: round2(p.x + (p.x / len) * 28),
    y: round2(p.y + (p.y / len) * 28),
  };
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
    fuelDeadline: 0,
    note: "",
    postState: "",
    sent: false,
  };
}

function payloadOk(p) {
  return (
    !!p &&
    typeof p.name === "string" &&
    p.name.trim() !== "" &&
    typeof p.score === "number" &&
    Number.isFinite(p.score) &&
    typeof p.finishedAt === "string" &&
    !Number.isNaN(Date.parse(p.finishedAt))
  );
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
  if (!API) return false;
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
    if (!API) {
      setErr(true);
      return;
    }
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
  return (
    <>
      {err ? <p className="error">Can't reach the leaderboard.</p> : null}
      {rows.length === 0 ? <p className="hint">No scores yet.</p> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th className="num">Score</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i}>
                <td>{i + 1}</td>
                <td>{row.name}</td>
                <td className="num">{fmtScore(Number(row.score))}</td>
                <td>{Number.isNaN(Date.parse(row.finishedAt)) ? row.finishedAt : new Date(row.finishedAt).toLocaleString()}</td>
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
      <p className="hint">Updates every 3 seconds.</p>
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

function ShipShapes() {
  return (
    <>
      <ellipse className="plume" cx="-18" cy="-6.4" rx="4.6" ry="1.5" />
      <ellipse className="plume" cx="-18" cy="6.4" rx="4.6" ry="1.5" />
      <ellipse className="exhaust" cx="-14.6" cy="-6.4" rx="2.6" ry="1.15" />
      <ellipse className="exhaust" cx="-14.6" cy="6.4" rx="2.6" ry="1.15" />
      <ellipse className="nacelle" cx="-2" cy="-6.4" rx="9" ry="1.55" />
      <ellipse className="nacelle" cx="-2" cy="6.4" rx="9" ry="1.55" />
      <path className="strut" d="M-1 -4.9 V-1.7 M-1 1.7 V4.9" />
      <ellipse className="hull" cx="-1.5" cy="0" rx="7.4" ry="2.5" />
      <rect className="neck" x="4.6" y="-0.7" width="3.4" height="1.4" />
      <ellipse className="saucer" cx="11.4" cy="0" rx="6" ry="3.5" />
      <ellipse className="bridge" cx="13.6" cy="0" rx="1.5" ry="1" />
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

function surfaceOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  // Low bits of these names clump; the high bits spread the four surfaces.
  return {
    kind: FUEL_WORLDS.has(id) ? "fuel" : SURFACES[(h >>> 9) % 4],
    spin: h % 360,
  };
}

function PlanetDot({ radius: r, kind, spin }) {
  return (
    <g transform={`rotate(${spin})`}>
      <g className={`surface surface-${kind}`} clipPath="url(#planet-dot)" filter="url(#planet-grain)">
        <circle className="body" r={r} />
        {kind === "rock" ? (
          <>
            <circle className="mark" cx={-r * 0.22} cy={-r * 0.06} r={r * 0.34} />
            <circle className="mark" cx={r * 0.26} cy={r * 0.24} r={r * 0.2} />
            <circle className="speck" cx={r * 0.02} cy={-r * 0.4} r={r * 0.12} />
          </>
        ) : null}
        {kind === "ice" ? (
          <>
            <circle className="mark" cy={-r * 0.18} r={r * 0.62} />
            <circle className="speck" cx={r * 0.16} cy={r * 0.34} r={r * 0.1} />
            <circle className="speck" cx={-r * 0.28} cy={r * 0.2} r={r * 0.08} />
          </>
        ) : null}
        {kind === "gas" || kind === "fuel" ? (
          <>
            <ellipse className="band" cy={-r * 0.12} rx={r} ry={r * 0.24} />
            <ellipse className="band alt" cy={r * 0.36} rx={r * 0.9} ry={r * 0.16} />
          </>
        ) : null}
        {kind === "dust" ? (
          <>
            <circle className="mark" cx={-r * 0.1} cy={r * 0.08} r={r * 0.42} />
            <circle className="speck" cx={r * 0.28} cy={-r * 0.26} r={r * 0.14} />
            <circle className="speck" cx={-r * 0.34} cy={-r * 0.18} r={r * 0.1} />
            <circle className="speck" cx={r * 0.14} cy={r * 0.38} r={r * 0.11} />
          </>
        ) : null}
        {kind === "fuel" ? <circle className="speck" r={r * 0.16} /> : null}
      </g>
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
      <line className="spine" x1="0" y1="8" x2="0" y2="32" />
      <circle className="ring outer" r="28" />
      <circle className="ring inner" r="17" />
      <circle className="core" r="5" />
      {BAYS.map((deg) => (
        <circle key={deg} className="bay" r="1.8" transform={`rotate(${deg}) translate(28 0)`} />
      ))}
    </svg>
  );
}

function Intro({ step, onSkip }) {
  const beat = BEATS[step];
  return (
    <main className={`opener beat-${beat.k}`}>
      <div className="opener-scene" aria-hidden="true">
        <div className="starfield" />
        <div className="vulcan">
          <span className="crater a" />
          <span className="crater b" />
          <span className="crater c" />
          <span className="crack a" />
          <span className="crack b" />
          <span className="crack c" />
          <span className="crack d" />
        </div>
        <span className="chunk a" />
        <span className="chunk b" />
        <span className="chunk c" />
        <span className="chunk d" />
        <span className="chunk e" />
        <span className="debris a" />
        <span className="debris b" />
        <span className="debris c" />
        <span className="debris d" />
        <span className="debris e" />
        <span className="debris f" />
        <div className="dust">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="wash" />
        <div className="shock" />
        <div className="flash" />
        <Starbase className="station-actor" />
        <ShipSvg className="ship ship-actor" />
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

function MapView({ snap, shipRef, onLaunch }) {
  const viewer = snap.phase === "fly" && snap.flight ? snap.flight.from : snap.here;
  const options = destinations(viewer, snap.closed);
  const byId = new Map(options.map((d) => [d.id, d]));
  const shut = new Set(snap.closed);
  const flying = snap.phase === "fly" && snap.flight;
  return (
    <svg className={flying ? "map-svg flying" : "map-svg"} viewBox="-430 -450 860 900" role="img" aria-label="Star map">
      <defs>
        <radialGradient id="neb-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe7b8" stopOpacity="0.95" />
          <stop offset="16%" stopColor="#ff8a1e" stopOpacity="0.78" />
          <stop offset="42%" stopColor="#c2410c" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb-teal" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1d6e8a" stopOpacity="0.5" />
          <stop offset="58%" stopColor="#12324a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0a1628" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb-red" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9a3412" stopOpacity="0.42" />
          <stop offset="62%" stopColor="#4a1520" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#1a0a10" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb-blue" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0" />
        </radialGradient>
        <filter id="planet-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="noise" />
          <feComponentTransfer in="noise" result="soft">
            <feFuncA type="linear" slope="0.22" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="soft" mode="overlay" />
        </filter>
        <clipPath id="planet-dot" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.5" r="0.5" />
        </clipPath>
      </defs>
      <g className="nebula">
        <rect x="-560" y="-580" width="1120" height="1160" fill="#070b16" />
        <ellipse cx="-190" cy="20" rx="360" ry="270" fill="url(#neb-teal)" />
        <ellipse cx="210" cy="-20" rx="320" ry="290" fill="url(#neb-red)" />
        <ellipse cx="-20" cy="120" rx="280" ry="200" fill="url(#neb-blue)" />
        {SPECKS.map(([x, y, r], i) => (
          <circle key={i} className="speck" cx={x} cy={y} r={r} />
        ))}
      </g>
      <circle className="core-glow" cx="0" cy="0" r="210" fill="url(#neb-core)" />
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
        const label = labelAt(n.id);
        const dest = byId.get(n.id);
        const cost = dest ? fuelCost(snap.variable, dest.distance) : null;
        const ready = snap.phase === "map" && cost != null && cost <= snap.fuel + 1e-9;
        const body = BODY[n.shell] || 4;
        const face = n.id === STATION ? null : surfaceOf(n.id);
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
            onClick={() => ready && onLaunch(dest)}
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
                <circle className="hit" r="14" />
                <PlanetDot radius={body} kind={face.kind} spin={face.spin} />
              </>
            )}
            <text className="node-label" x={label.x - p.x} y={label.y - p.y} textAnchor="middle">
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
        <g
          ref={shipRef}
          className="ship"
          style={{ offsetPath: "url(#flight)", offsetRotate: "auto", offsetAnchor: "center" }}
        >
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

function Game() {
  const game = useRef(null);
  if (!game.current) game.current = fresh();
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [flyFuel, setFlyFuel] = useState(null);
  const shipRef = useRef(null);
  const percentRef = useRef({});
  const usedRef = useRef({ general: new Set(), mental: new Set(), technology: new Set() });
  const inputRef = useRef(null);

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
    if (id === STATION) {
      commit({ phase: "map", flight: null });
      return;
    }
    if (FUEL_WORLDS.has(id)) {
      commit({
        phase: "fuel",
        here: id,
        flight: null,
        fuelDeck: shuffle(bank.fuel),
        fuelIndex: 0,
        fuelAnswers: [],
        fuelDeadline: Date.now() + QUESTION_MS,
      });
      setDraft("");
      return;
    }
    commit({ phase: "pick", here: id, flight: null });
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
    setDraft("");
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
    if (result.won) {
      game.current = { ...g, credits: result.credits, variable: result.variable };
      finish("win");
      return;
    }
    commit({
      credits: result.credits,
      variable: result.variable,
      closed: [...g.closed, g.here],
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
    commit({
      phase: "shop",
      variable: result.variable,
      credits: g.credits + result.credits,
    });
  }

  function markFuel(kind) {
    const g = game.current;
    if (g.phase !== "fuel") return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    setDraft("");
    commit({
      fuelAnswers: [...g.fuelAnswers, kind],
      fuelIndex: g.fuelIndex + 1,
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
    if (!el) return;
    el.style.offsetPath = "url(#flight)";
    el.style.offsetRotate = "auto";
    el.style.offsetDistance = "0%";
    const { fromFuel, actual } = snap.flight;
    const anim = el.animate([{ offsetDistance: "0%" }, { offsetDistance: "100%" }], {
      duration: FLIGHT_MS,
      easing: "ease-in-out",
      fill: "forwards",
    });
    let dead = false;
    let raf = 0;
    const frame = () => {
      if (dead) return;
      const progress = anim.effect?.getComputedTiming().progress ?? 0;
      const u = Math.min(1, progress || 0);
      setFlyFuel(fromFuel - actual * u);
      if (anim.playState !== "finished" && u < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    anim.onfinish = () => {
      if (dead) return;
      setFlyFuel(null);
      arrive();
    };
    return () => {
      dead = true;
      anim.cancel();
      cancelAnimationFrame(raf);
    };
  }, [snap.phase, snap.flight]);

  useEffect(() => {
    if (snap.phase !== "end" || game.current.sent) return;
    game.current = { ...game.current, sent: true };
    const payload = {
      name: game.current.name,
      score: score(game.current.path),
      finishedAt: new Date().toISOString(),
    };
    commit({ postState: "saving" });
    serial(async () => {
      const list = readPending();
      const seen = list.some(
        (item) =>
          item.name === payload.name &&
          item.score === payload.score &&
          item.finishedAt === payload.finishedAt,
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

  useEffect(() => {
    if (snap.phase === "question" || snap.phase === "fuel") inputRef.current?.focus();
  }, [snap.phase, snap.card, snap.fuelIndex]);

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
  const fuelCard = snap.fuelDeck.length
    ? snap.fuelDeck[snap.fuelIndex % snap.fuelDeck.length]
    : null;
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
            <MapView snap={snap} shipRef={shipRef} onLaunch={launch} />
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (game.current.phase !== "question" || !draft.trim()) return;
                const correct = matches(draft, game.current.card.answer);
                setDraft("");
                resolveQuestion(correct, false);
              }}
            >
              <label htmlFor="answer">Answer</label>
              <input
                id="answer"
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="row">
                <button type="submit">Submit</button>
              </div>
            </form>
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
            <p>One credit for each right answer. Skip if you want.</p>
            <p className="prompt">{fuelCard.prompt}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim() || !fuelCard) return;
                markFuel(matches(draft, fuelCard.answer) ? "right" : "wrong");
              }}
            >
              <label htmlFor="fuel-answer">Answer</label>
              <input
                id="fuel-answer"
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="row">
                <button type="submit">Submit</button>
                <button type="button" onClick={() => markFuel("skip")}>
                  Skip
                </button>
              </div>
            </form>
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
        Score <strong>{fmtScore(score(snap.path))}</strong>
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
