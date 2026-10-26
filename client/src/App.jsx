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
import SpaceBackdrop from "./art/SpaceBackdrop.jsx";
import { SAUCER_X, ShipShapes, ShipSvg } from "./art/Ship.jsx";
import Intro from "./intro/Intro.jsx";
import { Starbase } from "./art/Station.jsx";
import { PlanetDot, faceOf } from "./art/Planet.jsx";
import { MapDefs, MapBackdrop } from "./art/MapArt.jsx";
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
};

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

const byRank = (rows) => [...rows].sort(compareRuns);

function RankBadge({ n }) {
  return <span className={n <= 3 ? `rank r${n}` : "rank"}>{n}</span>;
}

// `start` skips rows already shown elsewhere (the podium) but keeps their numbering.
function BoardTable({ rows, err, start = 0 }) {
  const list = byRank(rows).slice(start);
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
            </tr>
          </thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={row.id ?? start + i} className={start + i < 3 ? `top top${start + i + 1}` : undefined}>
                <td>
                  <RankBadge n={start + i + 1} />
                </td>
                <td className="who">{row.name}</td>
                <td>
                  <span className={row.settled ? "pill yes" : "pill no"}>{row.settled ? "Yes" : "No"}</span>
                </td>
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
              {row.settled ? `${formatClock((row.timeLeft ?? 0) * 1000)} left · ` : ""}
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
          <p className="eyebrow">All Alone in Space</p>
          <h1>Leaderboard</h1>
        </div>
        <span className={err ? "live off" : "live"}>{err ? "Offline" : "Live"}</span>
      </header>
      <p className="hint rules">
        Wins rank above every loss. Then more worlds, then more fuel left. Wins with those tied rank by time left;
        losses by who lasted longer.
      </p>
      <Podium rows={rows} />
      <BoardTable rows={rows} err={err} start={Math.min(3, rows.length)} />
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
          All Alone
          <br />
          in Space
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
                {n.id === viewer ? <circle className="here-ring" r="37" /> : null}
                {ready ? <circle className="ready-ring" r="38" /> : null}
              </>
            ) : (
              <>
                <circle className="hit" r={Math.max(14, face.radius + 3)} />
                <PlanetDot face={face} detail={detail} shut={shut.has(n.id)} />
                {n.id === viewer ? <circle className="here-ring" r={face.radius + 5} /> : null}
                {ready ? <circle className="ready-ring" r={face.radius + 7} /> : null}
                {n.shell === "inner" || n.shell === "middle" || n.shell === "outer" ? (
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
          Back to the map
        </button>
      </div>
    </section>
  );
}

function ChoiceButtons({ choices, onPick }) {
  return (
    <div className="choices">
      {choices.map((choice, i) => (
        <button key={choice} type="button" className="tile choice" onClick={() => onPick(choice)}>
          <span className="key" aria-hidden="true">
            {String.fromCharCode(65 + i)}
          </span>
          <span>{choice}</span>
        </button>
      ))}
    </div>
  );
}

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
      phone: game.current.phone,
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
    return <NameScreen onStart={(who) => commit({ ...who, phase: "intro" })} />;
  }
  if (snap.phase === "intro") return <Intro onDone={dock} />;

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
          </div>
          <div className="meter credits">
            <CreditIcon />
            <div className="m-text">
              <small>Credits</small>
              <b>{snap.credits}</b>
            </div>
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
              <button type="button" className="ghost" onClick={() => markFuel("skip")}>
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
      </dl>
      <p>
        <a className="linkbtn" href="/board">
          Open the display board
        </a>
      </p>
      <BoardTable rows={rows} err={err} />
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
