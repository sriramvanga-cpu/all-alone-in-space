import { useEffect, useId, useRef, useState } from "react";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  fuelCost,
  idealCost,
  compareRuns,
  runPoints,
  landingChance,
  timeChance,
  LAND_FAIL_MS,
  siteSettles,
  answerPlanet,
  affordableVariable,
  fuelMinute,
  buyPacks,
  scanReadings,
  TOXIC_LIMIT,
  STREAK,
  fuelStreak,
  SCAN_POWER,
  START_POWER,
  POWER_CAP,
  POWER_TICK_MS,
  MAP_SCAN_POWER,
  hopPower,
} from "./game/rules.js";
import { FUEL_ROUNDS } from "./game/fuelRounds.js";
import { EVENT_CHANCE, FLIGHT_EVENTS, canTake } from "./game/events.js";
import { engine, sfx, isMuted, setMuted } from "./sound.js";
import {
  STATION,
  SYSTEMS,
  PLANETS,
  LANES,
  JUMP_R,
  TILT,
  system,
  planet,
  planetsOf,
  lanesFrom,
  orbitAt,
  positionAt,
  hopDistance,
} from "./game/map.js";
import bank from "./data/questions.json";
import SpaceBackdrop from "./art/SpaceBackdrop.jsx";
import { SAUCER_X, ShipShapes, ShipSvg } from "./art/Ship.jsx";
import Intro from "./intro/Intro.jsx";
import HowTo, { Reel } from "./intro/HowTo.jsx";
import WarpTunnel from "./art/WarpTunnel.jsx";
import { Starbase } from "./art/Station.jsx";
import { PlanetDot, faceOf } from "./art/Planet.jsx";
import { CostPill, DROP, MapDefs, MapBackdrop, StarDot, STAR_NAMES } from "./art/MapArt.jsx";
import { publishArt, webglAvailable } from "./three/artStore.js";
import { FuelIcon, PowerIcon, CreditIcon, ClockIcon, GlobeIcon, BrainIcon, ChipIcon, StarIcon, CompassIcon } from "./art/icons.jsx";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const PENDING = "aais-pending-scores";
const SCALE = 190;
// A lane flight is a warp jump: about a second to jump in, a second in warp, a second to drop out.
const FLIGHT_MS = 3200;
const HOP_MS = 1600;
const VIEW_W = 720;
const VIEW_H = 640;
const SWEEP_MS = 1200;
const STAR_R = 11;
const SUN_R = 40;
// Planets on the planetary map are drawn this much bigger than on the old chart, since the oval
// orbits spread wider.
const PLANET_ZOOM = 1.2;
const WORLD = 900;
const ROUND_MS = 15 * 60 * 1000;
// Test runs: "admin" as both name and phone starts a cheat run. Its clock gets a day (the landing
// odds still follow the time flown), fuel, power and credits are topped up after every change, and
// the run never goes to the leaderboard.
const CHEAT_ROUND_MS = 24 * 60 * 60 * 1000;
const CHEAT_FILL = 9999;
const roundMs = (g) => (g.cheat ? CHEAT_ROUND_MS : ROUND_MS);
const QUESTION_MS = 60_000;
const FUEL_WORLDS = new Set(PLANETS.filter((p) => p.shell === "fuel").map((p) => p.id));
const FACES = new Map(PLANETS.map((p) => [p.id, faceOf(p)]));
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

const DOMAINS = [
  ["general", "General knowledge"],
  ["mental", "Mental ability"],
  ["technology", "Technology"],
];

const END_COPY = {
  win: (world) => `You settled ${world}.`,
  time: () => "Fifteen minutes are up.",
  stranded: () => "No lane you can afford, and no planet left here.",
};
// A reload in these phases throws the run away, so the browser asks first.
const LIVE_PHASES = new Set(["map", "fly", "pick", "question", "land", "scan", "fuel", "shop"]);
const RING_LEVEL = { inner: "hard", middle: "medium", outer: "easy" };

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Fuel, power and costs show one decimal at most; the rules still use exact values.
function fmtNum(n) {
  const shown = Math.round(n * 10) / 10;
  return Object.is(shown, -0) ? "0" : String(shown);
}

// How much more a move needs, rounded up so it never reads as 0.
function shortBy(n) {
  return fmtNum(Math.ceil(n * 10 - 1e-9) / 10);
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

const POS = Object.fromEntries([
  [STATION, { x: 0, y: 0 }],
  ...SYSTEMS.map((s) => [s.id, { x: round2(s.r * SCALE * Math.cos(s.angle)), y: round2(s.r * SCALE * Math.sin(s.angle)) }]),
]);

const ROUTES = LANES.map((edge) => ({ ...edge, ...bend(POS[edge.a], POS[edge.b]) }));

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

// Where a click can fly at time ms: inside a system, its open planets, priced in power by how far
// apart they are right then; on the star map, the lanes a scan has revealed, priced in fuel.
function moves(g, ms = Date.now()) {
  if (g.system) {
    return planetsOf(g.system)
      .filter((p) => p.id !== g.here && !g.closed.includes(p.id))
      .map((p) => ({ id: p.id, power: hopPower(hopDistance(g.here, p.id, ms)) }));
  }
  const seen = new Set(g.scanned);
  return lanesFrom(g.here)
    .filter((hop) => seen.has(g.here) || seen.has(hop.id))
    .map((hop) => ({ id: hop.id, distance: hop.distance, fuel: fare(g.variable, hop.distance) }));
}

// Lane lengths out of the system you're at or in.
function laneExits(g) {
  return lanesFrom(g.system ?? g.here).map((hop) => hop.distance);
}

// Out of moves: no lane is affordable (hidden ones count, since a scan or a recharge is always
// possible) and no planet is left open here. Power never strands you: a system recharges it.
function stuck(g) {
  const at = g.system ?? g.here;
  if (laneExits(g).some((d) => fare(g.variable, d) <= g.fuel + 1e-9)) return false;
  return !planetsOf(at).some((p) => p.id !== g.here && !g.closed.includes(p.id));
}

function fresh() {
  return {
    phase: "name",
    name: "",
    phone: "",
    cheat: false,
    here: STATION,
    // The system you're inside (its planetary map is showing), or null on the star map.
    system: null,
    // Star-map spots you've scanned from; the systems one lane from them are on the chart.
    scanned: [],
    scanAt: 0,
    fuel: START_FUEL,
    power: START_POWER,
    credits: START_CREDITS,
    variable: START_VARIABLE,
    closed: [],
    path: [],
    deadline: 0,
    stoppedAt: 0,
    endReason: "",
    flight: null,
    // When the last warp jump ended; the arrival flash fades out from then.
    warpAt: 0,
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
    landing: null,
    // Every event shows once before any repeats.
    eventOrder: shuffle(FLIGHT_EVENTS),
    // Each player meets the fuel games in their own order; none repeats until all have been played.
    // Reduced motion leaves out Asteroid tap, which is nothing but moving targets.
    fuelOrder: shuffle(FUEL_ROUNDS.filter((r) => !(r.id === "rocks" && stillMotion()))),
    // What the last fuel minute earned, shown at the top of the shop.
    fuelResult: null,
    eventCount: 0,
    // Tips already shown this run; when the open one appeared; clock time handed back for reading them.
    tipsSeen: [],
    tipAt: 0,
    pausedMs: 0,
    scan: null,
    note: "",
    postState: "",
    sent: false,
  };
}

function stillMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
      {err ? <p className="error">Can't reach the leaderboard. Retrying.</p> : null}
      {!err && rows.length === 0 ? <p className="hint">No scores yet.</p> : null}
      {list.length > 0 ? (
        <table className="lb">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Settled</th>
              <th className="num">Time left</th>
              <th className="num">Worlds</th>
              <th className="num">Fuel left</th>
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


// The first time each part of the game appears, a tip explains it; the clock waits while it's open.
const TIPS = {
  star: [
    "Star map",
    `Scan (${MAP_SCAN_POWER} power) to find the solar systems one lane away, then tap one to fly there. Lanes cost fuel. Outer systems ask easier questions, but they are the farthest away.`,
  ],
  system: [
    "Solar system",
    "Planets circle the sun. Tap one to hop there: a hop costs power, less when the planets line up. Planets with a drop refuel you. Planets marked ! could be home. Power recharges while you're in a system.",
  ],
  fuel: ["Fuel stop", "Play for one minute to earn credits, then spend them in the shop on fuel and power. Get more than 1 in 10 wrong and fuel costs more."],
  test: [
    "A possible home",
    "Answer one question, then try to land. The chance starts at 0% and climbs faster as the clock runs, to 60% at 15 minutes. A right answer adds 10% and pays 15 credits; a wrong one halves the chance and makes fuel cost more. A failed landing costs 30 s. Each planet can be tried once.",
  ],
};

function tipFor(g) {
  const id = g.phase === "map" ? (g.system ? "system" : "star") : g.phase === "fuel" ? "fuel" : g.phase === "pick" ? "test" : null;
  return id && !g.tipsSeen.includes(id) ? id : null;
}

// Each tip loops its scene from the how-to-play reel above the words.
const TIP_SCENE = { star: "fly", system: "hop", fuel: "refuel", test: "answer" };

function Tip({ id, onClose }) {
  const [title, text] = TIPS[id];
  useEffect(() => sfx("tip"), [id]);
  return (
    <section className="panel tip" aria-live="polite">
      <p className="eyebrow">How it works</p>
      <h1>{title}</h1>
      <Reel only={TIP_SCENE[id]} />
      <p>{text}</p>
      <p className="hint">The clock is paused.</p>
      <div className="row">
        <button type="button" onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </section>
  );
}

// The mission card follows the how-to-play reel: what to do, how to win, how you score. The clock starts here.
const MISSION = [
  [CompassIcon, "Explore", "Scan the star map and fly between solar systems. Fuel flies the lanes; power flies between planets."],
  [GlobeIcon, "Land", "On a planet marked !, answer a question, then try to land. Your chance starts at 0% and climbs faster as the clock runs, up to 60%. A right answer adds 10%; a wrong one halves it."],
  [StarIcon, "Win", "Land before your fuel or the 15-minute clock runs out. Points = fuel left + 1 per 10 s left. Most points tops the board; watch yours in the top bar."],
];

function Mission({ onStart }) {
  return (
    <main className="screen">
      <section className="panel wide mission">
        <p className="eyebrow">Your mission</p>
        <h1>Find a new home</h1>
        <ol className="mission-steps">
          {MISSION.map(([StepIcon, title, text]) => (
            <li key={title}>
              <StepIcon />
              <b>{title}</b>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <p className="hint">Tips explain each part of the game the first time you meet it. The clock waits while you read them.</p>
        <div className="row">
          <button type="button" onClick={onStart} autoFocus>
            Start the clock
          </button>
        </div>
      </section>
    </main>
  );
}

function NameScreen({ onStart }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Which field is wrong and why; the field gets focus so screen readers hear the message with it.
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  function fail(field, text) {
    setError({ field, text });
    (field === "pilot" ? nameRef : phoneRef).current?.focus();
  }
  return (
    <main className="screen">
      <i className="shooting-star" aria-hidden="true" />
      <i className="shooting-star" aria-hidden="true" />
      <header className="title-card">
        <div className="title-planet" aria-hidden="true" />
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
          const cheat = nextName.toLowerCase() === "admin" && phone.trim().toLowerCase() === "admin";
          if (cheat) {
            onStart({ name: nextName, phone: "", cheat });
            return;
          }
          if (!nextName) {
            fail("pilot", "Enter your name.");
            return;
          }
          if (nextPhone.length < 10 || nextPhone.length > 15) {
            fail("phone", "Phone number needs 10 to 15 digits.");
            return;
          }
          // Browsers only allow fullscreen from the click itself, so ask here. Older Safari has only the
          // webkit name and no promise; iPhones refuse and the game stays in the page.
          const page = document.documentElement;
          (page.requestFullscreen ?? page.webkitRequestFullscreen)?.call(page)?.catch?.(() => {});
          onStart({ name: nextName.slice(0, 40), phone: nextPhone });
        }}
      >
        <p className="eyebrow">Pilot registration</p>
        <h1>Who is flying?</h1>
        <label htmlFor="pilot">Name</label>
        <input
          id="pilot"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={40}
          autoComplete="name"
          aria-invalid={error?.field === "pilot" || undefined}
          aria-describedby={error?.field === "pilot" ? "pilot-error" : undefined}
        />
        {error?.field === "pilot" ? (
          <p className="error" id="pilot-error" role="alert">
            {error.text}
          </p>
        ) : null}
        <label htmlFor="phone">Phone number</label>
        <input
          id="phone"
          ref={phoneRef}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          inputMode="tel"
          autoComplete="tel"
          aria-invalid={error?.field === "phone" || undefined}
          aria-describedby={error?.field === "phone" ? "phone-error phone-hint" : "phone-hint"}
        />
        <p className="hint field-hint" id="phone-hint">
          Only used to contact prize winners.
        </p>
        {error?.field === "phone" ? (
          <p className="error" id="phone-error" role="alert">
            {error.text}
          </p>
        ) : null}
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

function Ship({ at, angle }) {
  return (
    <g transform={`translate(${round2(at.x)} ${round2(at.y)}) rotate(${Math.round(angle)})`}>
      <svg className="ship" viewBox="-24 -11 46 22" x="-22" y="-11" width="44" height="22" overflow="visible">
        <ShipShapes />
      </svg>
    </g>
  );
}

// Phones get bigger map targets and labels; the map's own scale would make them too small to tap.
const NARROW = "(max-width: 560px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

// The star map: the station and the systems you have found. A scan reveals the systems one
// lane away and the lanes to them; whatever you have found stays on the chart.
function StarMap({ snap, now, shipRef, onLaunch, onBlocked, view, onView, children }) {
  const narrow = useNarrow();
  const stageRef = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const flying = snap.phase === "fly" && snap.flight;
  const viewer = flying ? snap.flight.from : snap.here;
  const scanned = new Set(snap.scanned);
  const shown = new Set([STATION, snap.here, ...snap.scanned.flatMap((id) => [id, ...lanesFrom(id).map((hop) => hop.id)])]);
  const options = snap.phase === "map" ? moves(snap) : [];
  const byId = new Map(options.map((m) => [m.id, m]));
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
      className={["map-svg", flying ? "flying" : "", narrow ? "narrow" : ""].filter(Boolean).join(" ")}
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
      {ROUTES.filter((edge) => scanned.has(edge.a) || scanned.has(edge.b)).map((edge) => {
        const hot = edge.a === viewer || edge.b === viewer;
        const onRoute =
          snap.flight &&
          ((edge.a === snap.flight.from && edge.b === snap.flight.to) ||
            (edge.a === snap.flight.to && edge.b === snap.flight.from));
        const cls = ["link", `d${edge.distance}`, hot ? "hot" : "", onRoute ? "onroute" : ""].filter(Boolean).join(" ");
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
        <path
          className="streak"
          d={snap.flight.d}
          pathLength="100"
          style={{ animationDuration: `${snap.flight.ms}ms`, animationPlayState: snap.flight.paused ? "paused" : undefined }}
        />
      ) : null}
      {now - snap.scanAt < SWEEP_MS ? (
        <circle key={snap.scanAt} className="sweep" cx={POS[snap.here].x} cy={POS[snap.here].y} r="420" />
      ) : null}
      {[STATION, ...SYSTEMS.map((s) => s.id)].filter((id) => shown.has(id)).map((id) => {
        const p = POS[id];
        const s = system(id);
        const move = byId.get(id);
        const ready = move != null && move.fuel <= snap.fuel + 1e-9;
        // A lane you can see but can't pay for: still a button, so a tap explains the shortfall.
        const short = move != null && !ready;
        const planets = s ? planetsOf(id) : [];
        const name = id === STATION ? "Station" : id;
        const go = () => (ready ? onLaunch(id) : short ? onBlocked(id === STATION ? "The station" : id, move.fuel - snap.fuel, "fuel") : null);
        const classes = ["node", s ? `node-${s.ring} system` : "node-station", id === viewer ? "here" : "", ready ? "ready" : "", short ? "far" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={id}
            className={classes}
            transform={`translate(${p.x} ${p.y})`}
            role={move ? "button" : undefined}
            tabIndex={move ? 0 : undefined}
            aria-disabled={short || undefined}
            aria-label={
              ready
                ? `Fly to ${id === STATION ? "the station" : id}, ${fmtNum(move.fuel)} fuel`
                : short
                  ? `${name}, ${fmtNum(move.fuel)} fuel, ${shortBy(move.fuel - snap.fuel)} more than you have`
                  : undefined
            }
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              go();
            }}
            onKeyDown={(e) => {
              if (!move || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              go();
            }}
          >
            <title>
              {name}
              {s ? `, ${STAR_NAMES[s.star]}` : ""}
              {move ? `, ${fmtNum(move.fuel)} fuel${ready ? "" : ", not enough fuel"}` : ""}
            </title>
            {id === STATION ? (
              <>
                <circle className="hit" r={narrow ? 33 : 30} />
                <Starbase x="-32" y="-32" width="64" height="64" />
                {id === viewer ? <circle className="here-ring" r="37" /> : null}
                {ready ? <circle className="ready-ring" r="38" /> : null}
              </>
            ) : (
              <>
                <circle className="hit" r={narrow ? 33 : STAR_R + 12} />
                <StarDot kind={s.star} r={STAR_R} />
                {id === viewer ? <circle className="here-ring" r={STAR_R + 8} /> : null}
                {ready ? <circle className="ready-ring" r={STAR_R + 10} /> : null}
                <g className="sys-planets" transform={`translate(0 ${STAR_R + 16})`} aria-hidden="true">
                  {planets.map((pl, i) => (
                    <g
                      key={pl.id}
                      className={snap.closed.includes(pl.id) ? "used" : undefined}
                      transform={`translate(${(i - (planets.length - 1) / 2) * 14} 0)`}
                    >
                      {pl.shell === "fuel" ? (
                        <path className="fuel-badge" d={DROP} transform="scale(1.15)" />
                      ) : (
                        <>
                          <circle className="beacon-bg" r="5.6" />
                          <text className="beacon-mark" y="3.2" textAnchor="middle">
                            !
                          </text>
                        </>
                      )}
                    </g>
                  ))}
                </g>
              </>
            )}
            <text
              className="node-label"
              y={-(id === STATION ? 26 : STAR_R + 5)}
              textAnchor="middle"
              dominantBaseline="text-after-edge"
            >
              {name}
            </text>
          </g>
        );
      })}
      {options.map((m) => {
        const edge = ROUTES.find((r) => (r.a === snap.here && r.b === m.id) || (r.b === snap.here && r.a === m.id));
        return (
          <CostPill
            key={`cost-${m.id}`}
            text={fmtNum(m.fuel)}
            x={edge.mid.x}
            y={edge.mid.y}
            short={m.fuel > snap.fuel + 1e-9}
            big={narrow}
          />
        );
      })}
      {flying ? (
        <g ref={shipRef} className="ship">
          <ShipShapes />
        </g>
      ) : (
        <Ship at={POS[snap.here]} angle={heading(snap.here)} />
      )}
    </svg>
    {/* A lane flight is a warp jump: the cockpit view covers the chart until the ship drops out. */}
    {flying && !stillMotion() ? (
      <WarpTunnel
        ms={snap.flight.ms}
        resume={snap.flight.resume}
        paused={snap.flight.paused}
        to={snap.flight.to === STATION ? "the station" : snap.flight.to}
      />
    ) : null}
    {children ? <div className="map-overlay">{children}</div> : null}
    </div>
  );
}

// A system's planets orbit its sun. A hop costs power by how far apart two planets are right
// now, so each open planet's price moves with them; a click pays the price on its label.
function SystemMap({ snap, shipRef, onLaunch, onBlocked, children }) {
  const narrow = useNarrow();
  const zoom = narrow ? 2 : PLANET_ZOOM;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const flying = snap.phase === "fly" && snap.flight;
  const options = snap.phase === "map" ? moves(snap, now) : [];
  const byId = new Map(options.map((m) => [m.id, m]));
  const shut = new Set(snap.closed);
  const planets = planetsOf(snap.system);
  const ship = positionAt(snap.here, now);
  // Facing the sun, in degrees.
  const sunward = (at) => (Math.atan2(-at.y, -at.x) * 180) / Math.PI;
  // Fit the view to this system: the jump point on the left, the outer orbit with its labels on the right.
  const reach = Math.max(...planets.map((p) => p.orbit));
  // Phones draw planets bigger, so their labels and pills need wider margins.
  const box = narrow
    ? [-JUMP_R - 40, -reach * TILT - 105, JUMP_R + reach + 180, 2 * reach * TILT + 165]
    : [-JUMP_R - 40, -reach * TILT - 65, JUMP_R + reach + 120, 2 * reach * TILT + 115];
  const placed = planets.map((p) => ({ p, at: orbitAt(p, now) }));
  // Planets on the far side of the star are drawn before it, the near side after, so they pass behind it.
  const drawPlanet = ({ p, at }) => {
    const move = byId.get(p.id);
    const ready = move != null && move.power <= snap.power + 1e-9;
    const short = move != null && !ready;
    const face = FACES.get(p.id);
    const test = p.shell !== "fuel";
    const go = () => (ready ? onLaunch(p.id) : short ? onBlocked(p.id, move.power - snap.power, "power") : null);
    const classes = ["node", `node-${p.shell}`, p.id === snap.here ? "here" : "", shut.has(p.id) ? "shut" : "", ready ? "ready" : "", short ? "far" : ""]
      .filter(Boolean)
      .join(" ");
    return (
      <g
        key={p.id}
        className={classes}
        transform={`translate(${round2(at.x)} ${round2(at.y)}) scale(${zoom})`}
        role={move ? "button" : undefined}
        tabIndex={move ? 0 : undefined}
        aria-disabled={short || undefined}
        aria-label={
          ready
            ? `Fly to ${p.id}, ${fmtNum(move.power)} power${test ? ", a possible home" : ""}`
            : short
              ? `${p.id}, ${fmtNum(move.power)} power, ${shortBy(move.power - snap.power)} more than you have`
              : undefined
        }
        onClick={go}
        onKeyDown={(e) => {
          if (!move || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          go();
        }}
      >
        <title>
          {p.id}
          {test ? ", a possible home" : ""}
          {move ? `, ${fmtNum(move.power)} power${ready ? "" : ", not enough power"}` : ""}
        </title>
        <circle className="hit" r={Math.max(narrow ? 24 : 14, face.radius + 3)} />
        {/* The art is lit from the upper left; turn it so its lit side faces the sun. */}
        <g transform={`rotate(${round2(sunward(at) + 135)})`}>
          <PlanetDot face={face} detail shut={shut.has(p.id)} />
        </g>
        {p.id === snap.here ? <circle className="here-ring" r={face.radius + 5} /> : null}
        {ready ? <circle className="ready-ring" r={face.radius + 7} /> : null}
        {test ? (
          <g className="beacon" transform={`translate(0 ${-(face.radius + 25)})`} aria-hidden="true">
            <circle className="beacon-pulse" r="6.5" />
            <circle className="beacon-bg" r="6.5" />
            <text className="beacon-mark" y="3.3" textAnchor="middle">
              !
            </text>
          </g>
        ) : null}
        {p.shell === "fuel" ? (
          <path
            className="fuel-badge"
            transform={`translate(${face.radius * 0.72 + 4} ${-(face.radius * 0.72 + 4)})`}
            d={DROP}
            aria-hidden="true"
          />
        ) : null}
        <text className="node-label" y={-(face.radius + 3)} textAnchor="middle" dominantBaseline="text-after-edge">
          {p.id}
        </text>
        {move ? <CostPill text={fmtNum(move.power)} x={face.radius + 24} y={0} power short={short} /> : null}
      </g>
    );
  };
  return (
    <div className="map-stage system-stage">
      <svg
        className={flying ? "map-svg flying" : "map-svg"}
        viewBox={box.join(" ")}
        role="img"
        aria-label={`${snap.system} system`}
      >
        <MapDefs />
        {planets.map((p) => (
          <ellipse key={p.id} className="orbit" rx={p.orbit} ry={p.orbit * TILT} />
        ))}
        {placed.filter(({ at }) => at.y < 0).map(drawPlanet)}
        <g className="sun">
          <StarDot kind={system(snap.system).star} r={SUN_R} sun />
        </g>
        {placed.filter(({ at }) => at.y >= 0).map(drawPlanet)}
        <g className="jump" transform={`translate(${-JUMP_R} 0)`}>
          <circle r="15" />
          <text className="node-label" y="-21" textAnchor="middle">
            Jump point
          </text>
        </g>
        {flying ? <path id="flight" d={snap.flight.d} fill="none" stroke="none" pointerEvents="none" /> : null}
        {flying ? (
          <path className="streak" d={snap.flight.d} pathLength="100" style={{ animationDuration: `${snap.flight.ms}ms` }} />
        ) : null}
        {flying ? (
          <g ref={shipRef} className="ship">
            <ShipShapes />
          </g>
        ) : (
          <Ship at={ship} angle={sunward(ship)} />
        )}
      </svg>
      {children ? <div className="map-overlay">{children}</div> : null}
    </div>
  );
}

function effectText(option) {
  const sign = (n) => (n > 0 ? "+" : "−") + Math.abs(n);
  const parts = [];
  if (option.fuel) parts.push(`${sign(option.fuel)} fuel`);
  if (option.credits) parts.push(`${sign(option.credits)} credits`);
  if (option.time) parts.push(`${sign(option.time)} s on the clock`);
  return parts.join(", ") || "No change";
}

function FlightEvent({ event, fuel, credits, onPick }) {
  return (
    <section className="panel event" aria-live="assertive">
      <p className="eyebrow">En route</p>
      <h1>{event.title}</h1>
      <p>{event.text}</p>
      <div className="choices">
        {event.options.map((option) => {
          const open = canTake(option, { fuel, credits });
          return (
            <button key={option.label} type="button" className="tile choice" disabled={!open} onClick={() => onPick(option)}>
              <span>{option.label}</span>
              <small>{open ? effectText(option) : `${effectText(option)}: not enough`}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Shop({ result, credits, fuel, power, world, exitFare, stuck, onBuy, onLeave }) {
  const [counts, setCounts] = useState(() => SHOP_PACKS.map(() => 0));
  const quote = buyPacks({ credits, fuel, power }, counts);
  function canInc(i) {
    const next = counts.slice();
    next[i] += 1;
    return buyPacks({ credits, fuel, power }, next).ok;
  }
  const gains = [
    quote.fuel > fuel ? `${fmtNum(quote.fuel - fuel)} fuel` : "",
    quote.power > power ? `${fmtNum(quote.power - power)} power` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    <section className="panel">
      <p className="eyebrow">{world}</p>
      <h1>Shop</h1>
      {result ? (
        <p className="fuel-result" role="status">
          Fuel minute: <b>{result.right}</b> right, <b>{result.wrong}</b> wrong.{" "}
          <b className="earned">
            +{result.earned} {result.earned === 1 ? "credit" : "credits"}
          </b>
          {result.bonus ? ` (${result.bonus} from streaks)` : ""}.
          {result.pricier ? " Over 1 in 10 wrong, so fuel now costs more." : ""}
        </p>
      ) : null}
      <p>
        {credits} {credits === 1 ? "credit" : "credits"}, {fmtNum(fuel)} fuel, {fmtNum(power)} power. Buy as many packs
        as you can pay for.
      </p>
      {SHOP_PACKS.map((pack, i) => (
        <div className={pack.power ? "pack power" : "pack"} key={pack.credits}>
          <span className="pack-name">
            <b>{pack.fuel ?? pack.power}</b> {pack.fuel ? "fuel" : "power"}
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
            aria-label={`Fewer packs of ${pack.fuel ?? pack.power} ${pack.fuel ? "fuel" : "power"}`}
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
            aria-label={`More packs of ${pack.fuel ?? pack.power} ${pack.fuel ? "fuel" : "power"}`}
          >
            +
          </button>
        </div>
      ))}
      <p>
        {quote.cost > 0 ? `${quote.cost} credits for ${gains}.` : "Choose a pack, or leave."}
      </p>
      {stuck ? (
        <p className="error">
          The cheapest lane from here costs {fmtNum(exitFare)} fuel, and no planet is left in this system. Buy fuel first,
          or leaving ends your run.
        </p>
      ) : null}
      <div className="row">
        <button
          type="button"
          disabled={!quote.ok || quote.cost <= 0}
          onClick={() => {
            if (!quote.ok || quote.cost <= 0) return;
            onBuy(counts);
            setCounts(SHOP_PACKS.map(() => 0));
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
  const pickRef = useRef(null);
  pickRef.current = (choice) => {
    if (performance.now() - shownAt.current < 300) return;
    onPick(choice);
  };
  useEffect(() => {
    shownAt.current = performance.now();
  }, [choices]);
  // The keycaps are real: A to D, or 1 to 4, answer like a tap.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea")) return;
      const k = e.key.toLowerCase();
      const i = k >= "a" && k <= "d" && k.length === 1 ? k.charCodeAt(0) - 97 : k >= "1" && k <= "4" && k.length === 1 ? Number(k) - 1 : -1;
      if (i < 0 || i >= choices.length) return;
      e.preventDefault();
      pickRef.current(choices[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choices]);
  return (
    <div className="choices">
      {choices.map((choice, i) => (
        <button key={choice} type="button" className="tile choice" onClick={() => pickRef.current(choice)}>
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
  // Where the needle was last drawn: presses are judged against what the player saw.
  const drawn = useRef(0);
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
      drawn.current = at();
      if (needle.current) needle.current.style.left = `${drawn.current * 100}%`;
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, []);

  function vent() {
    const hit = Math.abs(drawn.current - band) <= VALVE_BAND / 2;
    onMark(hit ? "right" : "wrong");
    setFlash((f) => ({ hit, n: (f?.n ?? 0) + 1 }));
    if (!hit) return;
    // Speed up, keeping the needle where it is; then move the band well away.
    const p = phase();
    // It never gets faster than this, so a late hit is still a fair timing test.
    const period = Math.max(1500, sweep.current.period * 0.94);
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
        {/* Judge the press, not the release: a click lands ~0.1 s later, when the needle has moved on. */}
        <button
          type="button"
          autoFocus
          onPointerDown={(e) => e.button === 0 && vent()}
          onKeyDown={(e) => {
            if (e.key !== " " && e.key !== "Enter") return;
            e.preventDefault();
            if (!e.repeat) vent();
          }}
        >
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

const LOG_DIRS = [
  ["←", "Left"],
  ["↑", "Up"],
  ["↓", "Down"],
  ["→", "Right"],
];

// Simon-style: arrows flash one at a time, then tap them back in order. The log grows by one after a
// success (up to 4) and shrinks by one after a mistake (down to 3). Short logs keep the pay close to
// the other rounds'.
function FlightLog({ onMark }) {
  const [seq, setSeq] = useState(() => logOf(3));
  const [lit, setLit] = useState(-1);
  const [watching, setWatching] = useState(true);
  const [last, setLast] = useState(null);
  const [got, setGot] = useState(0);
  const pos = useRef(0);

  useEffect(() => {
    pos.current = 0;
    setGot(0);
    setWatching(true);
    const timers = seq.flatMap((dir, i) => [
      setTimeout(() => setLit(dir), 500 + i * 500),
      setTimeout(() => setLit(-1), 500 + i * 500 + 350),
    ]);
    timers.push(setTimeout(() => setWatching(false), 500 + seq.length * 500));
    return () => timers.forEach(clearTimeout);
  }, [seq]);

  function press(dir) {
    if (watching) return;
    if (dir !== seq[pos.current]) {
      onMark("wrong");
      setLast("wrong");
      setSeq(logOf(Math.max(3, seq.length - 1)));
      return;
    }
    pos.current += 1;
    setGot(pos.current);
    if (pos.current === seq.length) {
      onMark("right");
      setLast("right");
      setSeq(logOf(Math.min(4, seq.length + 1)));
    }
  }

  // The keyboard's arrow keys work like the buttons, in LOG_DIRS order.
  useEffect(() => {
    const keys = { ArrowLeft: 0, ArrowUp: 1, ArrowDown: 2, ArrowRight: 3 };
    const onKey = (e) => {
      if (!(e.key in keys)) return;
      e.preventDefault();
      if (!e.repeat) press(keys[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [watching, seq]);

  const status = watching
    ? last === "wrong" ? "Wrong log. Watch again." : "Watch the arrows."
    : `Your turn: ${got} of ${seq.length}.`;
  return (
    <div className="log">
      <p className="hint" aria-live="polite">{status}</p>
      <p className="log-screen" aria-hidden="true">
        {lit >= 0 ? LOG_DIRS[lit][0] : ""}
      </p>
      <div className="log-keys">
        {LOG_DIRS.map(([arrow, name], i) => (
          <button key={name} type="button" className="ghost" aria-label={name} aria-disabled={watching} onClick={() => press(i)}>
            {arrow}
          </button>
        ))}
      </div>
    </div>
  );
}

function logOf(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * LOG_DIRS.length));
}

// Asteroids drift across a scanner screen; tap one to blast it. A miss costs nothing, but the cannon
// takes a moment to recharge, so tapping everywhere doesn't pay. One rock a second keeps the pay
// close to the valve's.
const ROCK_EVERY_MS = 1000;
const SHOT_MS = 250;

function AsteroidTap({ onMark }) {
  const [rocks, setRocks] = useState([]);
  const [booms, setBooms] = useState([]);
  const field = useRef(null);
  const lastShot = useRef(0);
  const count = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const n = ++count.current;
      const y0 = 6 + Math.random() * 70;
      const y1 = Math.max(2, Math.min(78, y0 + (Math.random() - 0.5) * 40));
      // A lumpy outline: eleven corners at uneven distances, so no two rocks look alike.
      const outline = Array.from({ length: 11 }, (_, i) => {
        const a = (i / 11) * 2 * Math.PI;
        const d = 34 + Math.random() * 16;
        return `${(50 + d * Math.cos(a)).toFixed(1)}% ${(50 + d * Math.sin(a)).toFixed(1)}%`;
      }).join(", ");
      const size = 2.4 + Math.random() * 1.4;
      setRocks((list) => [...list, { n, y0, y1, ms: 2600 + Math.random() * 1600, size, squash: 0.7 + Math.random() * 0.3, outline }]);
    }, ROCK_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  // Pointer hits land at once, so a drag can slice through rocks side by side; the key waits SHOT_MS.
  function hit(el, keyed = false) {
    const n = Number(el?.dataset?.rock);
    if (!n) return;
    if (keyed) {
      const now = performance.now();
      if (now - lastShot.current < SHOT_MS) return;
      lastShot.current = now;
    }
    const box = el.getBoundingClientRect();
    const area = field.current.getBoundingClientRect();
    onMark("right");
    setRocks((list) => list.filter((r) => r.n !== n));
    setBooms((list) => [...list, { n, x: box.left + box.width / 2 - area.left, y: box.top + box.height / 2 - area.top }]);
  }
  // Keyboard players fire with Space or Enter at the rock closest to escaping off the left edge.
  const hitRef = useRef(hit);
  hitRef.current = hit;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      const area = field.current?.getBoundingClientRect();
      if (!area) return;
      const lead = [...field.current.querySelectorAll(".rock")]
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.right > area.left && box.left < area.right)
        .sort((a, b) => a.box.left - b.box.left)[0];
      if (lead) hitRef.current(lead.el, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Press and drag across the field: every rock the pointer passes over is hit. Touch keeps its
  // first target as e.target, so look up what is under the finger now.
  return (
    <div
      className="rocks"
      ref={field}
      onPointerDown={(e) => hit(e.target)}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" && !(e.buttons & 1)) return;
        hit(document.elementFromPoint(e.clientX, e.clientY));
      }}
      aria-label="Asteroid field"
    >
      {rocks.map((r) => (
        <span
          key={r.n}
          className="rock"
          data-rock={r.n}
          style={{
            "--y0": `${r.y0}%`,
            "--y1": `${r.y1}%`,
            "--size": `${r.size}rem`,
            "--fly": `${r.ms}ms`,
            height: `${r.size * r.squash}rem`,
            clipPath: `polygon(${r.outline})`,
          }}
          onAnimationEnd={(e) => e.animationName === "fly" && setRocks((list) => list.filter((x) => x.n !== r.n))}
        />
      ))}
      {booms.map((b) => (
        <span
          key={b.n}
          className="boom"
          style={{ left: b.x, top: b.y }}
          onAnimationEnd={() => setBooms((list) => list.filter((x) => x.n !== b.n))}
        />
      ))}
    </div>
  );
}

const FUEL_GAMES = { valve: Valve, log: FlightLog, rocks: AsteroidTap };

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
  const usedRef = useRef({ general: new Set(), mental: new Set(), technology: new Set() });

  function commit(patch) {
    const next = { ...game.current, ...patch };
    if (next.cheat) {
      next.fuel = Math.max(next.fuel, CHEAT_FILL);
      next.power = Math.max(next.power, CHEAT_FILL);
      next.credits = Math.max(next.credits, CHEAT_FILL);
    }
    game.current = next;
    setTick((n) => n + 1);
  }

  function finish(reason) {
    if (game.current.phase === "end") return;
    sfx(reason === "win" ? "win" : "lose");
    commit({
      phase: "end",
      endReason: reason,
      flight: null,
      stoppedAt: Date.now(),
    });
  }

  const snap = game.current;
  void tick;
  const tip = tipFor(snap);

  function dock() {
    if (game.current.phase !== "mission") return;
    commit({ phase: "map", deadline: Date.now() + roundMs(game.current) });
  }

  // A lane on the star map costs fuel; a hop inside a system costs the power its label shows now.
  function launch(id) {
    const g = game.current;
    if (g.phase !== "map" || tipFor(g)) return;
    const now = Date.now();
    if (g.deadline && now >= g.deadline) {
      finish("time");
      return;
    }
    const move = moves(g, now).find((m) => m.id === id);
    if (!move) return;
    setFlyFuel(g.fuel);
    if (g.system) {
      if (move.power > g.power + 1e-9) return;
      // Aim for where the planet will be when the ship gets there.
      const { d } = bend(positionAt(g.here, now), positionAt(id, now + HOP_MS));
      sfx("hop");
      commit({
        phase: "fly",
        here: id,
        power: g.power - move.power,
        note: "",
        flight: { from: g.here, to: id, d, ms: HOP_MS, fromFuel: g.fuel, actual: 0, event: null, paused: false, resume: 0 },
      });
      return;
    }
    if (move.fuel > g.fuel + 1e-9) return;
    // Never on the first flight, so the player has seen a plain one first.
    const event = g.path.length && Math.random() < EVENT_CHANCE ? g.eventOrder[g.eventCount % g.eventOrder.length] : null;
    commit({
      phase: "fly",
      here: id,
      path: [...g.path, { ideal: idealCost(move.distance), actual: move.fuel }],
      fuel: g.fuel - move.fuel,
      note: "",
      eventCount: g.eventCount + (event ? 1 : 0),
      flight: {
        from: g.here,
        to: id,
        d: routePath(g.here, id),
        ms: FLIGHT_MS,
        fromFuel: g.fuel,
        actual: move.fuel,
        event,
        paused: false,
        resume: 0,
      },
    });
  }

  // A tap on a world you can't afford says what's missing instead of doing nothing.
  function blocked(name, need, unit) {
    const g = game.current;
    if (g.phase !== "map" || tipFor(g)) return;
    const how = unit === "power" ? "Power recharges while you're in a system." : "Refuel at a planet with a drop.";
    commit({ note: `${name} needs ${shortBy(need)} more ${unit}. ${how}` });
  }

  // A radar sweep from where you are on the star map: the systems one lane away appear.
  function scanHere() {
    const g = game.current;
    if (g.phase !== "map" || tipFor(g) || g.system || g.scanned.includes(g.here) || g.power + 1e-9 < MAP_SCAN_POWER) return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    sfx("scan");
    commit({ power: g.power - MAP_SCAN_POWER, scanned: [...g.scanned, g.here], scanAt: Date.now(), note: "" });
  }

  function enterSystem() {
    const g = game.current;
    if (g.phase !== "map" || tipFor(g) || g.system || !system(g.here)) return;
    commit({ system: g.here, note: "" });
  }

  function leaveSystem() {
    const g = game.current;
    if (g.phase !== "map" || tipFor(g) || !g.system) return;
    const p = POS[g.system];
    setView((v) => ({ ...v, x: fit(p.x - v.w / 2, v.w), y: fit(p.y - v.h / 2, v.h) }));
    commit({ system: null, here: g.system, note: "" });
  }

  // The flight pauses halfway while an event is open; the pick applies, then the flight resumes.
  function resolveEvent(option) {
    const g = game.current;
    if (g.phase !== "fly" || !g.flight?.paused || !canTake(option, g)) return;
    const fuel = option.fuel ?? 0;
    if (option.credits > 0) sfx("credit");
    commit({
      fuel: g.fuel + fuel,
      credits: g.credits + (option.credits ?? 0),
      deadline: g.deadline + (option.time ?? 0) * 1000,
      flight: { ...g.flight, event: null, paused: false, resume: 0.5, fromFuel: g.flight.fromFuel + fuel },
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
    if (!g.system) {
      // A lane flight: a system opens its planetary map; the station stays on the star map.
      commit({ phase: "map", flight: null, system: id === STATION ? null : id, warpAt: Date.now() });
      return;
    }
    const visited = g.visited.includes(id) ? g.visited : [...g.visited, id];
    if (FUEL_WORLDS.has(id)) {
      // Fuel worlds close after one visit, so this counts earlier fuel stops.
      const stops = g.visited.filter((v) => FUEL_WORLDS.has(v)).length;
      const round = g.fuelOrder[stops % g.fuelOrder.length];
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
    const card = takeCard(domain, RING_LEVEL[planet(g.here).shell]);
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
    const result = answerPlanet({ credits: g.credits, variable: g.variable }, correct);
    sfx(correct ? "right" : "wrong");
    // Right or wrong, the player now tries to land; the odds come from the time flown (the clock's
    // view of it, so paused tips don't count), plus 10 for a right answer or halved for a wrong one.
    const elapsed = roundMs(g) - (g.deadline - Date.now());
    commit({
      phase: "land",
      card: null,
      credits: result.credits,
      variable: correct ? g.variable : affordableVariable(result.variable, g.fuel, laneExits(g)),
      landing: {
        chance: landingChance(elapsed, correct),
        base: timeChance(elapsed),
        correct,
        timedOut,
        answer: g.card?.answer ?? "",
      },
    });
  }

  function land(scanned) {
    const g = game.current;
    if (g.phase !== "land" || !g.landing) return;
    if (g.deadline && Date.now() >= g.deadline) {
      finish("time");
      return;
    }
    if (scanned && g.power + 1e-9 < SCAN_POWER) return;
    const power = scanned ? g.power - SCAN_POWER : g.power;
    const first = siteSettles(g.landing.chance);
    const second = scanned && !first;
    const won = first || (second && siteSettles(g.landing.chance));
    const scan = {
      world: g.here,
      readings: scanReadings(won),
      note: second ? "Site 1 was toxic, so the scanner checked a second site." : scanned ? "Scanned from orbit." : "Landed blind.",
    };
    if (won) {
      game.current = { ...g, power, scan, landing: null };
      finish("win");
      return;
    }
    commit({ power, closed: [...g.closed, g.here], phase: "scan", scan, landing: null });
  }

  function leaveScan() {
    const g = game.current;
    if (g.phase !== "scan") return;
    // The 30 s comes off here, not at touchdown, so the clock can't give the result away before the readings do.
    commit({
      phase: "map",
      scan: null,
      deadline: g.deadline - LAND_FAIL_MS,
      note: `${g.here} isn't habitable, and the failed landing cost ${LAND_FAIL_MS / 1000} s. You can't land here again.`,
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
    const count = (kind) => g.fuelAnswers.filter((a) => a === kind).length;
    commit({
      fuelResult: {
        right: count("right"),
        wrong: count("wrong"),
        earned: g.credits - g.creditFloor,
        bonus: fuelStreak(g.fuelAnswers).bonus,
        pricier: result.applied,
      },
      phase: "shop",
      variable: affordableVariable(result.variable, g.fuel, laneExits(g)),
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
    const { bonus } = fuelStreak(answers);
    const credits = g.creditFloor + Math.floor(right / g.fuelRound.per) + bonus;
    // An asteroid hit always cracks; a credit or a streak bonus chimes on top.
    const rock = g.fuelRound?.id === "rocks" && kind === "right";
    if (rock) sfx("pop");
    sfx(bonus > fuelStreak(g.fuelAnswers).bonus ? "bonus" : credits > g.credits ? "credit" : rock ? null : kind);
    commit({
      fuelAnswers: answers,
      fuelIndex: 0,
      fuelDeck: [card],
      fuelSeen: card ? [...g.fuelSeen, fuelKey(card)] : g.fuelSeen,
      credits,
    });
  }

  // Colour clash needs colour vision, so a player can trade it for the next round in their order.
  function swapFuelRound() {
    const g = game.current;
    if (g.phase !== "fuel" || g.fuelRound?.id !== "ink") return;
    const others = g.fuelOrder.filter((r) => r.id !== "ink");
    if (!others.length) return;
    const at = g.fuelOrder.indexOf(g.fuelRound);
    const next = g.fuelOrder.slice(at + 1).concat(g.fuelOrder.slice(0, at)).find((r) => r.id !== "ink") ?? others[0];
    const card = drawFuelCard(next, g.fuelSeen);
    commit({
      fuelRound: next,
      fuelDeck: [card],
      fuelIndex: 0,
      fuelSeen: card ? [...g.fuelSeen, fuelKey(card)] : g.fuelSeen,
    });
  }

  function purchase(counts) {
    const g = game.current;
    if (g.phase !== "shop") return;
    const result = buyPacks({ credits: g.credits, fuel: g.fuel, power: g.power }, counts);
    if (!result.ok) return;
    sfx("buy");
    commit({ credits: result.credits, fuel: result.fuel, power: result.power });
  }

  // Closing a tip hands back the time it was open, so reading never costs the player.
  function closeTip() {
    const g = game.current;
    const id = tipFor(g);
    if (!id) return;
    const paused = g.tipAt ? Date.now() - g.tipAt : 0;
    commit({
      tipsSeen: [...g.tipsSeen, id],
      tipAt: 0,
      pausedMs: g.pausedMs + paused,
      deadline: g.deadline + paused,
      fuelDeadline: g.fuelDeadline + paused,
    });
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
    if (!g.deadline || g.phase === "end" || g.phase === "name" || g.phase === "intro" || tip) return;
    const left = g.deadline - Date.now();
    if (left <= 0) {
      finish("time");
      return;
    }
    const id = setTimeout(() => finish("time"), left);
    return () => clearTimeout(id);
  }, [snap.phase, snap.deadline, tip]);

  useEffect(() => {
    if (tip && !game.current.tipAt) commit({ tipAt: Date.now() });
  }, [tip]);

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
    if (game.current.phase !== "fuel" || tip) return;
    const left = game.current.fuelDeadline - Date.now();
    const id = setTimeout(() => {
      if (game.current.phase !== "fuel") return;
      closeFuelMinute();
    }, Math.max(0, left));
    return () => clearTimeout(id);
  }, [snap.phase, snap.fuelDeadline, tip]);

  useEffect(() => {
    if (game.current.phase === "map" && stuck(game.current)) finish("stranded");
  }, [snap.phase, snap.here, snap.fuel, snap.variable, snap.closed, snap.system]);

  // Inside a system its sun recharges power, a whole unit at a time, up to the cap.
  useEffect(() => {
    if (!snap.system) return;
    const id = setInterval(() => {
      const g = game.current;
      if (!g.system || g.phase === "end" || tipFor(g) || g.power >= POWER_CAP) return;
      commit({ power: Math.min(POWER_CAP, g.power + 1) });
    }, POWER_TICK_MS);
    return () => clearInterval(id);
  }, [snap.system]);

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
    const { fromFuel, actual, event, paused, resume, ms } = snap.flight;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
    const started = performance.now() - resume * ms;
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
    const halfway = () => {
      place(ease(0.5));
      setFlyFuel(fromFuel - actual * ease(0.5));
    };
    if (paused) {
      halfway();
      return;
    }
    const frame = (now) => {
      if (dead) return;
      const t = Math.min(1, (now - started) / ms);
      if (event && t >= 0.5) {
        halfway();
        engine(0);
        sfx("alert");
        commit({ flight: { ...game.current.flight, paused: true } });
        return;
      }
      const u = ease(t);
      place(u);
      setFlyFuel(fromFuel - actual * u);
      // Louder as the ship speeds up mid-route.
      engine(0.25 + 0.75 * (t < 0.5 ? 2 * t : 2 - 2 * t));
      if (t < 1) raf = requestAnimationFrame(frame);
      else {
        place(1);
        setFlyFuel(null);
        engine(0);
        arrive();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      engine(0);
    };
  }, [snap.phase, snap.flight]);

  useEffect(() => {
    // A cheat run is a test: it never goes to the board, not even into the retry queue.
    if (snap.phase !== "end" || game.current.sent || game.current.cheat) return;
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
    return <NameScreen onStart={(who) => commit({ ...who, phase: "intro" })} />;
  }
  if (snap.phase === "intro") {
    return <Intro onDone={() => game.current.phase === "intro" && commit({ phase: "howto" })} />;
  }
  if (snap.phase === "howto") {
    return <HowTo onDone={() => game.current.phase === "howto" && commit({ phase: "mission" })} />;
  }
  if (snap.phase === "mission") return <Mission onStart={dock} />;

  const clockMs =
    snap.phase === "end"
      ? Math.max(0, snap.deadline - (snap.stoppedAt || snap.deadline))
      : Math.max(0, snap.deadline - (tip && snap.tipAt ? snap.tipAt : now));
  const fuelShown = snap.phase === "fly" && flyFuel != null ? flyFuel : snap.fuel;
  // What landing right now would score, the same sum the board ranks by.
  const pointsShown =
    snap.phase === "end"
      ? runFacts(snap).settled
        ? fmtScore(runPoints(runFacts(snap)))
        : "—"
      : String(Math.round(runPoints({ settled: true, fuel: fuelShown, timeLeft: Math.floor(clockMs / 1000) })));
  const where =
    snap.phase === "fly" && snap.flight
      ? `En route to ${snap.flight.to === STATION ? "the station" : snap.flight.to}`
      : snap.here === STATION
        ? "Station"
        : snap.system && snap.here !== snap.system
          ? `${snap.here} · ${snap.system}`
          : `${snap.here} system`;
  const mapHint = snap.system
    ? `Planets orbit this ${STAR_NAMES[system(snap.system).star]}. A hop costs power by how far apart they are right now.`
    : snap.scanned.includes(snap.here)
      ? "Lanes from here show the fuel they cost."
      : snap.power + 1e-9 < MAP_SCAN_POWER
        ? "Not enough power to scan. Enter the system: its sun recharges you."
        : "Scan to find the solar systems around you.";
  const domainLabel = DOMAINS.find((d) => d[0] === snap.domain)?.[1] || "";
  const fuelCard = snap.fuelDeck[snap.fuelIndex] ?? null;
  const FuelGame = snap.fuelRound && FUEL_GAMES[snap.fuelRound.id];
  const qMs = Math.max(0, snap.qDeadline - now);
  const fuelMs = Math.max(0, snap.fuelDeadline - now);
  const streak = fuelStreak(snap.fuelAnswers);

  return (
    <div className="play">
      <header className="hud">
        <div>
          <p className="eyebrow">
            {snap.name}
            {snap.cheat ? <span className="cheat-tag"> · Cheat mode</span> : null}
          </p>
          <strong className="where">{where}</strong>
        </div>
        <div className="meters">
          <div className="meter fuel">
            <FuelIcon />
            <div className="m-text">
              <small>Fuel</small>
              <b>{snap.cheat ? "∞" : fmtNum(fuelShown)}</b>
              <span className="gauge" aria-hidden="true">
                <i style={{ width: `${Math.max(0, Math.min(1, fuelShown / Math.max(30, fuelShown))) * 100}%` }} />
              </span>
            </div>
            <Delta value={snap.fuel} />
          </div>
          <div className="meter power">
            <PowerIcon />
            <div className="m-text">
              <small>Power</small>
              <b>{snap.cheat ? "∞" : fmtNum(snap.power)}</b>
            </div>
            <Delta value={snap.power} />
          </div>
          <div className="meter credits">
            <CreditIcon />
            <div className="m-text">
              <small>Credits</small>
              <b>{snap.cheat ? "∞" : snap.credits}</b>
            </div>
            <Delta value={snap.credits} />
          </div>
          <div className={snap.phase !== "end" && clockMs <= 120_000 ? "meter clock urgent" : "meter clock"}>
            <ClockIcon />
            <div className="m-text">
              <small>Clock</small>
              <b>{snap.cheat ? "∞" : formatClock(clockMs)}</b>
            </div>
            <Delta value={(snap.deadline - snap.pausedMs) / 1000} />
          </div>
          <div className="meter points" title="Points if you land now: 1 per fuel left + 1 per 10 s left">
            <StarIcon />
            <div className="m-text">
              <small>
                Points<span className="if-land"> if you land</span>
              </small>
              <b>{snap.cheat ? "—" : pointsShown}</b>
            </div>
          </div>
        </div>
      </header>
      <div className="play-body">
        {snap.warpAt && now - snap.warpAt < 900 ? <div key={snap.warpAt} className="warp-out" aria-hidden="true" /> : null}
        {snap.phase === "map" || snap.phase === "fly" ? (
          <>
            <div className="map-bar">
              {snap.note ? (
                <p className="note" aria-live="polite">
                  {snap.note}
                </p>
              ) : (
                <p className="hint">{mapHint}</p>
              )}
              <p className="map-key">
                <span>
                  <svg viewBox="-5 -6 10 11" aria-hidden="true">
                    <path d={DROP} />
                  </svg>
                  Fuel stop
                </span>
                <span>
                  <b aria-hidden="true">!</b>
                  Possible home
                </span>
              </p>
              <div className="row">
                {snap.system ? (
                  <button type="button" className="ghost" disabled={snap.phase !== "map" || !!tip} onClick={leaveSystem}>
                    Star map
                  </button>
                ) : (
                  <>
                    {snap.scanned.includes(snap.here) ? null : (
                      <button
                        type="button"
                        className="scan-btn"
                        disabled={snap.phase !== "map" || !!tip || snap.power + 1e-9 < MAP_SCAN_POWER}
                        onClick={scanHere}
                      >
                        Scan nearby systems · {MAP_SCAN_POWER} power
                      </button>
                    )}
                    {system(snap.here) ? (
                      <button type="button" className="ghost" disabled={snap.phase !== "map" || !!tip} onClick={enterSystem}>
                        Enter {snap.here}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            {snap.system ? (
              <SystemMap snap={snap} shipRef={shipRef} onLaunch={launch} onBlocked={blocked}>
                {tip ? <Tip id={tip} onClose={closeTip} /> : null}
              </SystemMap>
            ) : (
              <StarMap snap={snap} now={now} shipRef={shipRef} onLaunch={launch} onBlocked={blocked} view={view} onView={setView}>
                {tip ? (
                  <Tip id={tip} onClose={closeTip} />
                ) : snap.phase === "fly" && snap.flight?.paused ? (
                  <FlightEvent event={snap.flight.event} fuel={snap.fuel} credits={snap.credits} onPick={resolveEvent} />
                ) : null}
              </StarMap>
            )}
          </>
        ) : null}

        {/* Off the map, a tip stands in for the screen it explains, so a fuel round can't start under it. */}
        {tip && snap.phase !== "map" ? <Tip id={tip} onClose={closeTip} /> : null}

        {snap.phase === "pick" && !tip ? (
          <section className="panel">
            <p className="eyebrow">{snap.here}</p>
            <h1>Pick a topic</h1>
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
            <ChoiceButtons
              choices={snap.card.choices}
              onPick={(choice) => {
                if (game.current.phase !== "question") return;
                resolveQuestion(choice === game.current.card.answer, false);
              }}
            />
            <p className="hint">Then you try to land. A right answer adds 10% to the chance and pays 15 credits; a wrong one halves it.</p>
          </section>
        ) : null}

        {snap.phase === "land" ? (
          <section className="panel">
            <p className="eyebrow">
              {snap.here} · Landing chance {snap.landing.chance}%
            </p>
            <h1>{snap.landing.correct ? "Right answer." : snap.landing.timedOut ? "Time's up." : "Wrong answer."} How will you land?</h1>
            {!snap.landing.correct && snap.landing.answer ? (
              <p className="answer-reveal">
                The answer was <b>{snap.landing.answer}</b>.
              </p>
            ) : null}
            <p className="hint">
              {snap.landing.base}% for the time you've flown
              {snap.landing.correct
                ? `, +${snap.landing.chance - snap.landing.base} for your right answer`
                : `, halved to ${snap.landing.chance}% ${snap.landing.timedOut ? "because time ran out" : "for the wrong answer"}`}
              . The chance grows as the clock runs. A failed landing costs {LAND_FAIL_MS / 1000} s.
            </p>
            <div className="domains land">
              <button type="button" className="tile domain" disabled={snap.power + 1e-9 < SCAN_POWER} onClick={() => land(true)}>
                Scan first · {SCAN_POWER} power
                <small>If the first landing site is toxic, the scanner checks a second one.</small>
              </button>
              <button type="button" className="tile domain" onClick={() => land(false)}>
                Land blind · free
                <small>One landing site, one chance.</small>
              </button>
            </div>
          </section>
        ) : null}

        {snap.phase === "scan" && snap.scan ? <Scan scan={snap.scan} onDone={leaveScan} /> : null}

        {snap.phase === "fuel" && snap.fuelRound && !tip ? (
          <section className="panel fuel">
            <div className="qhead">
              <Ring ms={fuelMs} total={QUESTION_MS} />
              <div>
                <p className="eyebrow">{snap.here} · Fuel minute</p>
                <h1>{snap.fuelRound.title}</h1>
              </div>
              <p className={streak.streak ? "combo hot" : "combo"} aria-live="polite">
                <b>{streak.streak}</b> in a row
                {streak.bonus ? (
                  <span key={streak.bonus} className="flash hit">
                    Bonus +{streak.bonus}
                  </span>
                ) : null}
              </p>
            </div>
            <p>
              {snap.fuelRound.how}{" "}
              {snap.fuelRound.per === 1 ? "1 credit each." : `1 credit for every ${snap.fuelRound.per}.`}{" "}
              Every {STREAK} in a row earns a bonus credit. You have {snap.credits}.
            </p>
            {FuelGame ? (
              <FuelGame key={snap.here} onMark={markFuel} />
            ) : fuelCard ? (
              <>
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
                  {snap.fuelRound.id === "ink" ? (
                    <button type="button" className="ghost" onClick={swapFuelRound}>
                      Can't tell colours apart? Swap round
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {snap.phase === "shop" ? (
          <Shop
            result={snap.fuelResult}
            credits={snap.credits}
            fuel={snap.fuel}
            power={snap.power}
            world={snap.here}
            exitFare={Math.min(...laneExits(snap).map((d) => fare(snap.variable, d)))}
            stuck={stuck(snap)}
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
        ? "Couldn't reach the board. Your score is saved here and will send itself."
        : "Sending the score…";
  const sentLine = snap.cheat ? "Cheat run: not sent to the board." : post;
  return (
    <>
    {facts.settled ? <Celebration /> : null}
    {facts.settled && snap.scan ? <Scan scan={snap.scan} habitable /> : null}
    <section className={facts.settled ? "panel wide end won" : "panel wide end lost"}>
      <div className="end-hero">
        <div className="end-orb" aria-hidden="true" />
        <div>
          <p className="eyebrow">{facts.settled ? "Mission complete" : "Run over"}</p>
          <h1>{END_COPY[snap.endReason]?.(snap.here) || "Run over."}</h1>
          <p className="hint">{sentLine}</p>
        </div>
      </div>
      <dl className="stats">
        <div className="stat rank-stat">
          <dt>Your rank</dt>
          <dd key={mine ? "rank" : "wait"} className={mine ? "pop-in" : undefined}>
            {mine ? `#${mine.rank}` : snap.cheat ? "—" : "…"}
            {mine ? <small>of {mine.total}</small> : null}
          </dd>
        </div>
        <div className="stat">
          <dt>Settled</dt>
          <dd className={facts.settled ? "yes" : "no"}>{facts.settled ? "Yes" : "No"}</dd>
        </div>
        <div className="stat">
          <dt>Time left</dt>
          <dd>{snap.cheat ? "∞" : formatClock(facts.timeLeft * 1000)}</dd>
        </div>
        <div className="stat">
          <dt>Worlds</dt>
          <dd>{facts.worlds}</dd>
        </div>
        <div className="stat">
          <dt>Fuel left</dt>
          <dd>{fmtScore(facts.fuel)}</dd>
        </div>
        <div className="stat">
          <dt>Points</dt>
          <dd>{facts.settled ? <CountUp value={runPoints(facts)} /> : "—"}</dd>
        </div>
      </dl>
      <div className="row">
        <button type="button" onClick={() => window.location.reload()} autoFocus>
          Next pilot
        </button>
        <a className="linkbtn" href="/board">
          Open the display board
        </a>
      </div>
      <BoardTable rows={rows} err={err} />
    </section>
    </>
  );
}

// Confetti for a win, laid out once so a re-render doesn't reshuffle it.
const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  left: Math.random() * 100,
  delay: Math.random() * 0.9,
  ms: 2200 + Math.random() * 1400,
  spin: 360 + Math.random() * 720,
  drift: (Math.random() - 0.5) * 30,
  wide: i % 3 === 0,
  color: ["#5ad1ff", "#8a7dff", "#ff79c6", "#ffd23f", "#7df0b4"][i % 5],
}));

function Celebration() {
  return (
    <div className="celebrate" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <i
          key={i}
          className={c.wide ? "wide" : undefined}
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.ms}ms`,
            "--spin": `${c.spin}deg`,
            "--drift": `${c.drift}vw`,
          }}
        />
      ))}
    </div>
  );
}

/** Counts from 0 up to value over ms, easing out; shows the value at once for reduced motion. */
function CountUp({ value, ms = 1200 }) {
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(still ? value : 0);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      setShown(value * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, still]);
  return fmtScore(shown);
}

const SCAN_STEP_MS = 450;

function Scan({ scan, habitable = false, onDone }) {
  const [done, setDone] = useState(false);
  const revealMs = (scan.readings.length + 1) * SCAN_STEP_MS;
  useEffect(() => {
    // A blip as each reading comes in, then the buzz of a toxic verdict (a win has its own chime).
    const ids = scan.readings.map((_, i) => setTimeout(() => sfx("reading"), (i + 1) * SCAN_STEP_MS));
    ids.push(
      setTimeout(() => {
        setDone(true);
        if (!habitable) sfx("toxic");
      }, revealMs),
    );
    return () => ids.forEach(clearTimeout);
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
              : `Toxic elements concentration is too high (safe limit ${TOXIC_LIMIT} ppm). Not habitable. The failed landing costs ${LAND_FAIL_MS / 1000} s.`}
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

function SoundToggle() {
  const [off, setOff] = useState(isMuted);
  return (
    <button
      type="button"
      className="ghost sound-toggle"
      aria-pressed={off}
      onClick={() => {
        setMuted(!off);
        setOff(!off);
      }}
    >
      {off ? "Sound off" : "Sound on"}
    </button>
  );
}

export default function App() {
  const route = window.location.pathname.replace(/\/+$/, "") || "/";
  // Every button ticks when pressed; the game's own sounds play on top.
  useEffect(() => {
    const onClick = (e) => {
      if (e.target instanceof Element && e.target.closest("button:not(:disabled)")) sfx("click");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return (
    <>
      <SpaceBackdrop />
      {route === "/board" ? (
        <Board />
      ) : (
        <>
          <Game />
          <SoundToggle />
        </>
      )}
    </>
  );
}
