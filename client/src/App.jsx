import { useEffect, useId, useRef, useState } from "react";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  drawPercent,
  fuelCost,
  idealCost,
  compareRuns,
  runPoints,
  habitability,
  affordableVariable,
  fuelMinute,
  buyPacks,
  scanReadings,
  TOXIC_LIMIT,
} from "./game/rules.js";
import { FUEL_ROUNDS } from "./game/fuelRounds.js";
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
import SpaceBackdrop from "./art/SpaceBackdrop.jsx";
import { SAUCER_X, ShipShapes, ShipSvg } from "./art/Ship.jsx";
import Intro from "./intro/Intro.jsx";
import { Starbase } from "./art/Station.jsx";
import { PlanetDot, faceOf } from "./art/Planet.jsx";
import { MapDefs, MapBackdrop } from "./art/MapArt.jsx";
import { publishArt, webglAvailable } from "./three/artStore.js";
import { FuelIcon, CreditIcon, ClockIcon, GlobeIcon, BrainIcon, ChipIcon } from "./art/icons.jsx";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const PENDING = "aais-pending-scores";
const SCALE = 190;
const FLIGHT_MS = 2400;
const VIEW_W = 720;
const VIEW_H = 640;
const WORLD = 900;
const ROUND_MS = 15 * 60 * 1000;
const QUESTION_MS = 60_000;
const FUEL_WORLDS = new Set(NODES.filter((n) => n.shell === "fuel").map((n) => n.id));
const FACES = new Map(NODES.filter((n) => n.id !== STATION).map((n) => [n.id, faceOf(n)]));
// Realistic map art renders in the background; the map shows vector art until it lands.
if (webglAvailable()) {
  // While the realistic ship renders, show no ship rather than flash the old vector one.
  publishArt({ loading: true });
  import("./three/sprites.js")
    .then((m) => m.renderMapArt(FACES.values()))
    .catch((err) => {
      console.warn("Realistic map art unavailable, keeping vector art:", err);
      publishArt({ loading: false });
    });
}
// Zoomed out past this width, planets drop to simple lit discs so panning stays smooth.
const DETAIL_W = 1100;

const DOMAINS = [
  ["general", "General knowledge"],
  ["mental", "Mental ability"],
  ["technology", "Technology"],
];

const END_COPY = {
  win: "A world will take you.",
  time: "Fifteen minutes are up.",
  stranded: "No open route you can afford.",
  closed: "Every route from here leads to a closed world.",
};
// A reload in these phases throws the run away, so the browser asks first.
const LIVE_PHASES = new Set(["map", "fly", "pick", "question", "scan", "fuel", "shop"]);
// Follows SHELL_BANDS in rules.js: a right answer settles ~5% inner, ~25% middle, ~55% outer.
const HAB_LEVEL = { inner: "Low", middle: "Medium", outer: "High" };
const RING_LEVEL = { inner: "hard", middle: "medium", outer: "easy" };

function round2(v) {
  return Math.round(v * 100) / 100;
}

function fmtNum(n) {
  const shown = round2(n);
  return Object.is(shown, -0) ? "0" : String(shown);
}

function fare(variable, distance) {
  return round2(fuelCost(variable, distance));
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
    phone: "",
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
    fuelRound: null,
    fuelDeck: [],
    fuelIndex: 0,
    fuelAnswers: [],
    fuelSeen: [],
    fuelDeadline: 0,
    creditFloor: 0,
    visited: [],
    scan: null,
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

const fuelKey = (card) => card.prompt ?? card.choices.join();

// Interactive rounds have no cards.
function drawFuelCard(round, seen) {
  if (!round.make) return null;
  let card = round.make();
  for (let i = 0; i < 12 && seen.includes(fuelKey(card)); i++) card = round.make();
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

// A floating "+15" / "−25" and a glow on a HUD meter whenever its value changes.
function Delta({ value }) {
  const prev = useRef(value);
  const [pop, setPop] = useState(null);
  useEffect(() => {
    const diff = value - prev.current;
    prev.current = value;
    if (Math.abs(diff) >= 0.01) setPop((p) => ({ n: (p?.n ?? 0) + 1, diff }));
  }, [value]);
  if (!pop) return null;
  const dir = pop.diff > 0 ? "up" : "down";
  return (
    <>
      <span key={`f${pop.n}`} className={`meter-flash ${dir}`} aria-hidden="true" />
      <span key={`d${pop.n}`} className={`delta ${dir}`} aria-hidden="true">
        {pop.diff > 0 ? "+" : "−"}
        {fmtNum(Math.abs(pop.diff))}
      </span>
    </>
  );
}

function Ring({ ms, total }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const u = Math.max(0, Math.min(1, ms / total));
  const grad = useId();
  return (
    <svg className={ms <= 10_000 ? "ring urgent" : "ring"} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ring-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--ring-b)" }} />
        </linearGradient>
      </defs>
      <circle className="ring-track" cx="40" cy="40" r={r} />
      <circle
        className="ring-value"
        cx="40"
        cy="40"
        r={r}
        stroke={`url(#${grad})`}
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

// `run` asks the server to add that run's own row and rank to the top 10.
function useBoard(run) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const query = run ? `?run=${encodeURIComponent(run)}` : "";
        const res = await fetch(`${API}/api/leaderboard${query}`, { signal: AbortSignal.timeout(8000) });
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
  }, [run]);
  return { rows, err };
}

const byRank = (rows) => [...rows].sort(compareRuns);

function RankBadge({ n }) {
  return <span className={n <= 3 ? `rank r${n}` : "rank"}>{n}</span>;
}

// The top 10 only; `start` skips rows already shown elsewhere (the podium) but keeps their numbering.
// The player's own row, when it is outside the top 10, follows a gap with its real rank.
function BoardTable({ rows, err, start = 0 }) {
  const ranked = byRank(rows);
  const list = ranked.slice(start, 10);
  const mine = ranked.find((row) => row.mine && row.rank > 10);
  return (
    <>
      {err ? <p className="error">Can't reach the leaderboard.</p> : null}
      {rows.length === 0 ? <p className="hint">No scores yet.</p> : null}
      {list.length > 0 ? (
        <table className="lb">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Settled</th>
              <th className="num">Time left</th>
              <th className="num">Worlds</th>
              <th className="num">Fuel score</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {[...list, ...(mine ? [null, mine] : [])].map((row, i) =>
              row === null ? (
                <tr key="gap" className="gap" aria-hidden="true">
                  <td colSpan={7}>⋯</td>
                </tr>
              ) : (
              <tr
                key={row.id ?? start + i}
                className={[start + i < 3 && row !== mine ? `top top${start + i + 1}` : "", row.mine ? "me" : ""].join(" ").trim() || undefined}
              >
                <td>
                  <RankBadge n={row === mine ? row.rank : start + i + 1} />
                </td>
                <td className="who">{row.name}</td>
                <td>
                  <span className={row.settled ? "pill yes" : "pill no"}>{row.settled ? "Yes" : "No"}</span>
                </td>
                <td className="num">{formatClock((row.timeLeft ?? 0) * 1000)}</td>
                <td className="num">{row.worlds ?? 0}</td>
                <td className="num">{fmtScore(Number.isFinite(row.fuel) ? row.fuel : Number(row.score) || 0)}</td>
                <td className="num">{row.settled ? fmtScore(runPoints(row)) : "—"}</td>
              </tr>
              ),
            )}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function Podium({ rows }) {
  const top = byRank(rows).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="podium">
      {top.map((row, i) => {
        const fuel = Number.isFinite(row.fuel) ? row.fuel : Number(row.score) || 0;
        return (
          <article key={row.id ?? i} className={`pod p${i + 1}`}>
            <RankBadge n={i + 1} />
            <p className="pod-name">{row.name}</p>
            <p className={row.settled ? "pod-result yes" : "pod-result"}>{row.settled ? "Settled" : "Not settled"}</p>
            <p className="pod-meta">
              {row.settled ? `${fmtScore(runPoints(row))} pts · ${formatClock((row.timeLeft ?? 0) * 1000)} left · ` : ""}
              {row.worlds ?? 0} {(row.worlds ?? 0) === 1 ? "world" : "worlds"} · fuel {fmtScore(fuel)}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function Board() {
  const { rows, err } = useBoard();
  return (
    <main className="board">
      <header className="board-head">
        <div>
          <p className="eyebrow">Nova Grid</p>
          <h1>Leaderboard</h1>
        </div>
        <span className={err ? "live off" : "live"}>{err ? "Offline" : "Live"}</span>
      </header>
      <p className="hint rules">
        Wins rank above every loss. Wins rank by points: 1 per fuel left and 1 per 10 seconds left.
        Losses rank by more worlds, then more fuel left, then who lasted longer.
      </p>
      <Podium rows={rows} />
      <BoardTable rows={rows} err={err} start={Math.min(3, rows.length)} />
    </main>
  );
}

const BRIEF = [
  ["Goal", "Land on a planet that will take you within 15 minutes."],
  ["Fly", `Tap a glowing planet. You start with ${START_FUEL} fuel; each route shows its cost.`],
  ["Test", "On a ! planet, answer one question. Right: 15 credits and a chance to settle. Wrong: fuel costs rise."],
  ["Go far", "Outer planets are easier to settle but cost more fuel to reach."],
  ["Refuel", "On a fuel-drop planet, play a one-minute challenge for credits (a new one at every stop), then buy fuel."],
  ["Once only", "Each planet can be tried once. Run out of fuel or time and the run ends."],
  ["Score", "Settling beats every loss. Faster wins with more fuel left rank higher."],
];

function Briefing({ onStart }) {
  return (
    <main className="screen">
      <section className="panel wide brief">
        <p className="eyebrow">Mission briefing</p>
        <h1>How to play</h1>
        <ol>
          {BRIEF.map(([title, text]) => (
            <li key={title}>
              <b>{title}</b>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="row">
          <button type="button" onClick={onStart} autoFocus>
            Start the mission
          </button>
        </div>
      </section>
    </main>
  );
}

// Shown after the cutscene, before the chart opens and the clock starts.
function Mission({ onStart }) {
  return (
    <main className="screen">
      <section className="panel mission">
        <p className="eyebrow">Your mission</p>
        <h1>Find a new home</h1>
        <p>
          Vulcan is gone, and there is no world left to call home. Somewhere in Nova Grid is a planet that can
          support life. Find it before your fuel or the {ROUND_MS / 60000}-minute clock runs out.
        </p>
        <p className="hint">The clock starts when the star chart opens.</p>
        <div className="row">
          <button type="button" onClick={onStart} autoFocus>
            Open the star chart
          </button>
        </div>
      </section>
    </main>
  );
}

function NameScreen({ onStart }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="screen">
      <header className="title-card">
        <ShipSvg className="ship" />
        <p className="title-big">
          Nova
          <br />
          Grid
        </p>
        <p className="title-tag">Fifteen minutes. One world.</p>
      </header>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const nextName = name.trim();
          const nextPhone = phone.replace(/\D/g, "");
          if (!nextName) {
            setError("Enter a name.");
            return;
          }
          if (nextPhone.length < 10 || nextPhone.length > 15) {
            setError("Enter a phone number.");
            return;
          }
          onStart({ name: nextName.slice(0, 40), phone: nextPhone });
        }}
      >
        <p className="eyebrow">Pilot registration</p>
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
        <label htmlFor="phone">Phone number</label>
        <input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          inputMode="tel"
          autoComplete="tel"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="row">
          <button type="submit">Launch</button>
        </div>
      </form>
      <p className="credits">
        Planet and star imagery:{" "}
        <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">
          Solar System Scope
        </a>
        , CC BY 4.0
      </p>
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
  const detail = view.w <= DETAIL_W;
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
      <MapDefs />
      <MapBackdrop />
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
        const outward = edge.a === viewer ? edge.d : edge.rev;
        return (
          <g key={`${edge.a}-${edge.b}`}>
            {hot ? <path className="link-glow" d={edge.d} /> : null}
            <path d={edge.d} className={cls} />
            {hot ? <path className="link-flow" d={outward} /> : null}
          </g>
        );
      })}
      {flying ? (
        <path className="streak" d={snap.flight.d} pathLength="100" style={{ animationDuration: `${FLIGHT_MS}ms` }} />
      ) : null}
      {NODES.map((n) => {
        const p = POS[n.id];
        const dest = byId.get(n.id);
        const cost = dest ? fare(snap.variable, dest.distance) : null;
        const ready = snap.phase === "map" && cost != null && cost <= snap.fuel + 1e-9;
        const face = n.id === STATION ? null : FACES.get(n.id);
        const hab = HAB_LEVEL[n.shell];
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
              ready
                ? `Fly to ${n.id === STATION ? "the station" : n.id}, ${fmtNum(cost)} fuel${hab ? `, habitability ${hab}` : ""}`
                : undefined
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
              {hab ? `, habitability ${hab}` : ""}
              {cost != null ? `, ${fmtNum(cost)} fuel${ready ? "" : ", not enough fuel"}` : ""}
            </title>
            {n.id === STATION ? (
              <>
                <circle className="hit" r="30" />
                <Starbase x="-32" y="-32" width="64" height="64" />
                {n.id === viewer ? <circle className="here-ring" r="37" /> : null}
                {ready ? <circle className="ready-ring" r="38" /> : null}
              </>
            ) : (
              <>
                <circle className="hit" r={Math.max(14, face.radius + 3)} />
                <PlanetDot face={face} detail={detail} shut={shut.has(n.id)} />
                {n.id === viewer ? <circle className="here-ring" r={face.radius + 5} /> : null}
                {ready ? <circle className="ready-ring" r={face.radius + 7} /> : null}
                {hab ? (
                  <text className={`hab-tag hab-${hab.toLowerCase()}`} y={face.radius + 15} textAnchor="middle" aria-hidden="true">
                    Habitability: {hab}
                  </text>
                ) : null}
                {hab ? (
                  <g className="beacon" transform={`translate(0 ${-(face.radius + 25)})`} aria-hidden="true">
                    <circle className="beacon-pulse" r="6.5" />
                    <circle className="beacon-bg" r="6.5" />
                    <text className="beacon-mark" y="3.3" textAnchor="middle">
                      !
                    </text>
                  </g>
                ) : null}
                {n.shell === "fuel" ? (
                  <path
                    className="fuel-badge"
                    transform={`translate(${face.radius * 0.72 + 4} ${-(face.radius * 0.72 + 4)})`}
                    d="M0 -4.8C2.7 -1 4 1 4 2.7A4 4 0 0 1 -4 2.7C-4 1 -2.7 -1 0 -4.8Z"
                    aria-hidden="true"
                  />
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
            const text = fmtNum(fare(snap.variable, edge.distance));
            const w = 14 + text.length * 7;
            return (
              <g key={`cost-${edge.a}-${edge.b}`} className="cost hot" transform={`translate(${edge.mid.x} ${edge.mid.y})`}>
                <rect x={-w / 2} y="-9" width={w} height="18" rx="9" />
                <text y="4" textAnchor="middle">
                  {text}
                </text>
              </g>
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

function Shop({ credits, fuel, world, exitFare, onBuy, onLeave }) {
  const stuck = fuel + 1e-9 < exitFare;
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
          <span className="pack-name">
            <b>{pack.fuel}</b> fuel
            <em>for {pack.credits} credits</em>
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
          <span className="count">{counts[i]}</span>
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
      {stuck ? (
        <p className="error">
          {Number.isFinite(exitFare)
            ? `The cheapest route from here costs ${fmtNum(exitFare)} fuel. Buy fuel first, or leaving ends your run.`
            : "Every route from here leads to a closed world. Leaving ends your run."}
        </p>
      ) : null}
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
        <button type="button" className="ghost" onClick={onLeave}>
          {stuck ? "End the run" : "Back to the map"}
        </button>
      </div>
    </section>
  );
}

function ChoiceButtons({ choices, onPick, render = (choice) => <span>{choice}</span> }) {
  // The next card appears under the pointer, so a double click would answer a card nobody read.
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = performance.now();
  }, [choices]);
  return (
    <div className="choices">
      {choices.map((choice, i) => (
        <button
          key={choice}
          type="button"
          className="tile choice"
          onClick={() => {
            if (performance.now() - shownAt.current < 300) return;
            onPick(choice);
          }}
        >
          <span className="key" aria-hidden="true">
            {String.fromCharCode(65 + i)}
          </span>
          {render(choice)}
        </button>
      ))}
    </div>
  );
}

const VALVE_BAND = 0.2;

// A needle sweeps the gauge back and forth; a tap inside the green band is a hit, anywhere else a miss.
function Valve({ onMark }) {
  const needle = useRef(null);
  const sweep = useRef({ t0: performance.now(), period: 2200 });
  const [band, setBand] = useState(0.5);
  const [flash, setFlash] = useState(null);

  // Phase in [0, 1) of the current back-and-forth.
  const phase = () => (((performance.now() - sweep.current.t0) / sweep.current.period) % 1 + 1) % 1;
  const at = () => {
    const p = phase();
    return p < 0.5 ? p * 2 : 2 - p * 2;
  };

  useEffect(() => {
    let id;
    const step = () => {
      if (needle.current) needle.current.style.left = `${at() * 100}%`;
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, []);

  function vent() {
    const hit = Math.abs(at() - band) <= VALVE_BAND / 2;
    onMark(hit ? "right" : "wrong");
    setFlash((f) => ({ hit, n: (f?.n ?? 0) + 1 }));
    if (!hit) return;
    // Speed up, keeping the needle where it is; then move the band well away.
    const p = phase();
    const period = Math.max(1100, sweep.current.period * 0.94);
    sweep.current = { t0: performance.now() - p * period, period };
    let next = band;
    while (Math.abs(next - band) < 0.25) next = 0.15 + Math.random() * 0.7;
    setBand(next);
  }

  return (
    <div className="valve">
      <div className="valve-track">
        <span className="valve-band" style={{ left: `${(band - VALVE_BAND / 2) * 100}%`, width: `${VALVE_BAND * 100}%` }} />
        <span className="valve-needle" ref={needle} />
      </div>
      <div className="row">
        <button type="button" onClick={vent} autoFocus>
          Vent
        </button>
        {flash ? (
          <span key={flash.n} className={flash.hit ? "flash hit" : "flash miss"}>
            {flash.hit ? "Hit" : "Miss"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const PADS = ["#ff5a5a", "#3ddc84", "#4f8bff", "#ffd23f"];

// Simon-style: watch a sequence of pads light up, then tap it back. It grows by one after a
// success (up to 6) and shrinks by one after a mistake (down to 3).
function ReactorCode({ onMark }) {
  const [seq, setSeq] = useState(() => codeOf(3));
  const [lit, setLit] = useState(-1);
  const [watching, setWatching] = useState(true);
  const [last, setLast] = useState(null);
  const [got, setGot] = useState(0);
  const pos = useRef(0);

  useEffect(() => {
    pos.current = 0;
    setGot(0);
    setWatching(true);
    const timers = seq.flatMap((pad, i) => [
      setTimeout(() => setLit(pad), 600 + i * 600),
      setTimeout(() => setLit(-1), 600 + i * 600 + 400),
    ]);
    timers.push(setTimeout(() => setWatching(false), 600 + seq.length * 600));
    return () => timers.forEach(clearTimeout);
  }, [seq]);

  function press(pad) {
    if (watching) return;
    if (pad !== seq[pos.current]) {
      onMark("wrong");
      setLast("wrong");
      setSeq(codeOf(Math.max(3, seq.length - 1)));
      return;
    }
    pos.current += 1;
    setGot(pos.current);
    if (pos.current === seq.length) {
      onMark("right");
      setLast("right");
      setSeq(codeOf(Math.min(6, seq.length + 1)));
    }
  }

  const status = watching
    ? last === "wrong" ? "Wrong code. Watch again." : "Watch the lights."
    : `Your turn: ${got} of ${seq.length}.`;
  return (
    <div className="code">
      <p className="hint" aria-live="polite">{status}</p>
      <div className="pads">
        {PADS.map((color, i) => (
          <button
            key={color}
            type="button"
            className={lit === i ? "pad lit" : "pad"}
            style={{ "--pad": color }}
            aria-label={`Pad ${i + 1}`}
            aria-disabled={watching}
            onClick={() => press(i)}
          />
        ))}
      </div>
    </div>
  );
}

function codeOf(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * PADS.length));
}

const FUEL_GAMES = { valve: Valve, code: ReactorCode };

const DOMAIN_ICONS = { general: GlobeIcon, mental: BrainIcon, technology: ChipIcon };

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
    if (game.current.phase !== "mission") return;
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
    const actual = fare(g.variable, dest.distance);
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
      // Fuel worlds close after one visit, so this counts earlier fuel stops.
      const stops = g.visited.filter((v) => FUEL_WORLDS.has(v)).length;
      const round = FUEL_ROUNDS[stops % FUEL_ROUNDS.length];
      const card = drawFuelCard(round, g.fuelSeen);
      commit({
        phase: "fuel",
        here: id,
        flight: null,
        visited,
        closed: [...g.closed, id],
        creditFloor: g.credits,
        fuelRound: round,
        fuelDeck: [card],
        fuelIndex: 0,
        fuelAnswers: [],
        fuelSeen: card ? [...g.fuelSeen, fuelKey(card)] : g.fuelSeen,
        fuelDeadline: Date.now() + QUESTION_MS,
      });
      return;
    }
    commit({ phase: "pick", here: id, flight: null, visited });
  }

  function takeCard(domain, level) {
    const seen = usedRef.current[domain];
    const all = bank[domain] || [];
    const leveled = all.filter((card) => card.level === level);
    // A level with no cards falls back to the whole domain, so a thin bank never blocks a question.
    const deck = leveled.length ? leveled : all;
    let pool = deck.filter((card) => !seen.has(card.id));
    if (!pool.length) {
      for (const card of deck) seen.delete(card.id);
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
    const card = takeCard(domain, RING_LEVEL[shellOf(g.here)]);
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
    const scan = {
      world: g.here,
      readings: scanReadings(result.won),
      note: timedOut ? "Time's up." : correct ? "Right answer." : "Wrong answer.",
    };
    if (result.won) {
      game.current = { ...g, credits: result.credits, variable, scan };
      finish("win");
      return;
    }
    commit({ credits: result.credits, variable, closed, phase: "scan", card: null, scan });
  }

  function leaveScan() {
    const g = game.current;
    if (g.phase !== "scan") return;
    commit({ phase: "map", scan: null, note: `${g.here} is not habitable. This world is closed.` });
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
    const card = drawFuelCard(g.fuelRound, g.fuelSeen);
    const right = answers.filter((answer) => answer === "right").length;
    commit({
      fuelAnswers: answers,
      fuelIndex: 0,
      fuelDeck: [card],
      fuelSeen: card ? [...g.fuelSeen, fuelKey(card)] : g.fuelSeen,
      credits: g.creditFloor + Math.floor(right / g.fuelRound.per),
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
    const can = open.some((d) => fare(g.variable, d.distance) <= g.fuel + 1e-9);
    if (!can) finish(open.length ? "stranded" : "closed");
  }, [snap.phase, snap.here, snap.fuel, snap.variable, snap.closed]);

  const live = LIVE_PHASES.has(snap.phase);
  useEffect(() => {
    if (!live) return;
    const ask = (e) => {
      e.preventDefault();
      e.returnValue = ""; // older Safari only asks when this is set
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [live]);

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
    // Lets the server drop a retry of a post it already saved, and the end screen find this run's rank.
    // randomUUID needs https or localhost.
    const runId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      runId,
      name: game.current.name,
      phone: game.current.phone,
      ...facts,
      finishedAt: new Date().toISOString(),
    };
    commit({ postState: "saving", runId });
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
    return <NameScreen onStart={(who) => commit({ ...who, phase: "brief" })} />;
  }
  if (snap.phase === "brief") return <Briefing onStart={() => commit({ phase: "intro" })} />;
  if (snap.phase === "intro") {
    return <Intro onDone={() => game.current.phase === "intro" && commit({ phase: "mission" })} />;
  }
  if (snap.phase === "mission") return <Mission onStart={dock} />;

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
  const FuelGame = snap.fuelRound && FUEL_GAMES[snap.fuelRound.id];
  const qMs = Math.max(0, snap.qDeadline - now);
  const fuelMs = Math.max(0, snap.fuelDeadline - now);

  return (
    <div className="play">
      <header className="hud">
        <div>
          <p className="eyebrow">{snap.name}</p>
          <strong className="where">{where}</strong>
        </div>
        <div className="meters">
          <div className="meter fuel">
            <FuelIcon />
            <div className="m-text">
              <small>Fuel</small>
              <b>{fmtNum(fuelShown)}</b>
              <span className="gauge" aria-hidden="true">
                <i style={{ width: `${Math.max(0, Math.min(1, fuelShown / Math.max(30, fuelShown))) * 100}%` }} />
              </span>
            </div>
            <Delta value={snap.fuel} />
          </div>
          <div className="meter credits">
            <CreditIcon />
            <div className="m-text">
              <small>Credits</small>
              <b>{snap.credits}</b>
            </div>
            <Delta value={snap.credits} />
          </div>
          <div className={snap.phase !== "end" && clockMs <= 120_000 ? "meter clock urgent" : "meter clock"}>
            <ClockIcon />
            <div className="m-text">
              <small>Clock</small>
              <b>{formatClock(clockMs)}</b>
            </div>
          </div>
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
            <div className="domains">
              {DOMAINS.map(([id, label]) => {
                const DomainIcon = DOMAIN_ICONS[id];
                return (
                  <button key={id} type="button" className="tile domain" onClick={() => chooseDomain(id)}>
                    {DomainIcon ? <DomainIcon /> : null}
                    {label}
                  </button>
                );
              })}
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
            <p>A right answer might settle you. A miss closes this world.</p>
            <ChoiceButtons
              choices={snap.card.choices}
              onPick={(choice) => {
                if (game.current.phase !== "question") return;
                resolveQuestion(choice === game.current.card.answer, false);
              }}
            />
          </section>
        ) : null}

        {snap.phase === "scan" && snap.scan ? <Scan scan={snap.scan} onDone={leaveScan} /> : null}

        {snap.phase === "fuel" && snap.fuelRound ? (
          <section className="panel fuel">
            <div className="qhead">
              <Ring ms={fuelMs} total={QUESTION_MS} />
              <div>
                <p className="eyebrow">{snap.here} · Fuel minute</p>
                <h1>{snap.fuelRound.title}</h1>
              </div>
            </div>
            <p>
              {snap.fuelRound.how}{" "}
              {snap.fuelRound.per === 1 ? "1 credit each." : `1 credit for every ${snap.fuelRound.per}.`}{" "}
              You have {snap.credits}.
            </p>
            {FuelGame ? (
              <FuelGame key={snap.here} onMark={markFuel} />
            ) : fuelCard ? (
              <>
                {fuelCard.dots ? (
                  <div className="cells" role="img" aria-label="Fuel cells to count">
                    {fuelCard.dots.map(([x, y]) => (
                      <span key={`${x},${y}`} style={{ left: `${x}%`, top: `${y}%` }}>
                        <FuelIcon />
                      </span>
                    ))}
                  </div>
                ) : null}
                {fuelCard.prompt ? (
                  <p className="prompt" style={fuelCard.ink ? { color: fuelCard.ink } : undefined}>
                    {fuelCard.prompt}
                  </p>
                ) : null}
                <ChoiceButtons
                  choices={fuelCard.choices}
                  render={fuelCard.gauge ? (level) => <span className="gauge"><i style={{ width: `${level}%` }} /></span> : undefined}
                  onPick={(choice) => markFuel(choice === fuelCard.answer ? "right" : "wrong")}
                />
                <div className="row">
                  <button type="button" className="ghost" onClick={() => markFuel("skip")}>
                    Skip
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {snap.phase === "shop" ? (
          <Shop
            credits={snap.credits}
            fuel={snap.fuel}
            world={snap.here}
            exitFare={Math.min(...destinations(snap.here, snap.closed).map((d) => fare(snap.variable, d.distance)))}
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
  const { rows, err } = useBoard(snap.runId);
  const facts = runFacts(snap);
  const mine = rows.find((row) => row.mine);
  const post =
    snap.postState === "saved"
      ? "Score is on the board."
      : snap.postState === "retry"
        ? "The board is unreachable. This score stays on the laptop and retries."
        : "Sending the score…";
  return (
    <>
    {facts.settled && snap.scan ? <Scan scan={snap.scan} habitable /> : null}
    <section className={facts.settled ? "panel wide end won" : "panel wide end lost"}>
      <div className="end-hero">
        <div className="end-orb" aria-hidden="true" />
        <div>
          <p className="eyebrow">Run over</p>
          <h1>{END_COPY[snap.endReason] || "Run over."}</h1>
          <p className="hint">{post}</p>
        </div>
      </div>
      <dl className="stats">
        <div className="stat rank-stat">
          <dt>Your rank</dt>
          <dd>
            {mine ? `#${mine.rank}` : "…"}
            {mine ? <small>of {mine.total}</small> : null}
          </dd>
        </div>
        <div className="stat">
          <dt>Settled</dt>
          <dd className={facts.settled ? "yes" : "no"}>{facts.settled ? "Yes" : "No"}</dd>
        </div>
        <div className="stat">
          <dt>Time left</dt>
          <dd>{formatClock(facts.timeLeft * 1000)}</dd>
        </div>
        <div className="stat">
          <dt>Worlds</dt>
          <dd>{facts.worlds}</dd>
        </div>
        <div className="stat">
          <dt>Fuel score</dt>
          <dd>{fmtScore(facts.fuel)}</dd>
        </div>
        <div className="stat">
          <dt>Points</dt>
          <dd>{facts.settled ? fmtScore(runPoints(facts)) : "—"}</dd>
        </div>
      </dl>
      <p>
        <a className="linkbtn" href="/board">
          Open the display board
        </a>
      </p>
      <BoardTable rows={rows} err={err} />
    </section>
    </>
  );
}

const SCAN_STEP_MS = 450;

function Scan({ scan, habitable = false, onDone }) {
  const [done, setDone] = useState(false);
  const revealMs = (scan.readings.length + 1) * SCAN_STEP_MS;
  useEffect(() => {
    const id = setTimeout(() => setDone(true), revealMs);
    return () => clearTimeout(id);
  }, [revealMs]);
  return (
    <section className="panel wide scan">
      <p className="eyebrow">{scan.world}</p>
      <h1>Scientific readings</h1>
      <p className="hint">{scan.note} {done ? "Scan complete." : "Scanning the surface…"}</p>
      <div className="scan-bar" aria-hidden="true">
        <i style={{ animationDuration: `${revealMs}ms` }} />
      </div>
      <dl className="stats">
        {scan.readings.map((r, i) => (
          <div className="stat reading" key={r.label} style={{ animationDelay: `${(i + 1) * SCAN_STEP_MS}ms` }}>
            <dt>{r.label}</dt>
            <dd className={r.toxic ? (habitable ? "yes" : "no") : undefined}>
              {r.value}
              <small>{r.unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      {done ? (
        <>
          <p className={habitable ? "verdict yes" : "verdict no"} aria-live="polite">
            {habitable
              ? "All readings within safe limits. Habitable."
              : `Toxic elements concentration is too high (safe limit ${TOXIC_LIMIT} ppm). Not habitable.`}
          </p>
          {onDone ? (
            <div className="row">
              <button type="button" onClick={onDone}>
                Return to the map
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default function App() {
  const route = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    <>
      <SpaceBackdrop />
      {route === "/board" ? <Board /> : <Game />}
    </>
  );
}
