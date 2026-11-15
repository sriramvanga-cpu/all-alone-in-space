// How to play: a short reel between the opening film and the run that shows the aim of
// the game with the map's own art, plus the one-scene clips the first-time tips loop. Each scene
// is a pure function of the seconds played, like the films' poses. Every number on screen comes
// from the rules, so the reel stays true when they change.

import { memo, useEffect, useRef, useState } from "react";
import { clamp, easeInOut, easeOut, lerp, smooth } from "./draw.js";
import { CostPill, DROP, JumpGate, MapDefs, StarDot } from "../art/MapArt.jsx";
import { Starbase } from "../art/Station.jsx";
import { SAUCER_X, ShipShapes } from "../art/Ship.jsx";
import { PlanetDot, faceOf } from "../art/Planet.jsx";
import { ClockIcon, CreditIcon, FuelIcon, PowerIcon, StarIcon } from "../art/icons.jsx";
import { LANES, PLANETS, STATION, TILT } from "../game/map.js";
import {
  LAND_FAIL_MS,
  MAP_SCAN_POWER,
  SHOP_PACKS,
  START_FUEL,
  START_POWER,
  answerPlanet,
  fuelCost,
  hopPower,
  landingChance,
  runPoints,
  timeChance,
  FUEL_PER_POINT,
  SECONDS_PER_POINT,
} from "../game/rules.js";

const ROUND_S = 15 * 60;
const touchesStation = (lane) => lane.a === STATION || lane.b === STATION;
const cheapest = (lanes) => fuelCost(1, Math.min(...lanes.map((lane) => lane.distance)));
const LANE_OUT = cheapest(LANES.filter(touchesStation));
const LANE_ON = cheapest(LANES.filter((lane) => !touchesStation(lane)));
const HOP = hopPower(180);
const PACK = SHOP_PACKS[0];
const PAY = answerPlanet({ credits: 0, variable: 1 }, true).credits;
// shortcut: a fuel minute's credits depend on the player; 12 is a typical minute, shown as an example.
const EARN = 12;
const FAIL_S = LAND_FAIL_MS / 1000;
// The two landing tries happen at 7:30 and 4:10 left on the clock.
const TRY_AT = 450;
const HOME_AT = 250;
const flownMs = (left) => (ROUND_S - left) * 1000;
const TRY_CHANCE = landingChance(flownMs(TRY_AT), true);
const HOME_CHANCE = landingChance(flownMs(HOME_AT), true);
const RIGHT_BONUS = TRY_CHANCE - timeChance(flownMs(TRY_AT));

// The top bar at the start of each scene, so jumping to a scene shows the right numbers.
const AT_GOAL = { fuel: START_FUEL, power: START_POWER, credits: 0, clock: ROUND_S };
const AT_FLY = { ...AT_GOAL, clock: AT_GOAL.clock - 3 };
const AT_HOP = { ...AT_FLY, fuel: AT_FLY.fuel - LANE_OUT, power: AT_FLY.power - MAP_SCAN_POWER, clock: AT_FLY.clock - 6 };
const AT_FUEL = { ...AT_HOP, power: AT_HOP.power - HOP + 1, clock: AT_HOP.clock - 5 };
const AT_ASK = { ...AT_FUEL, fuel: AT_FUEL.fuel + PACK.fuel, credits: EARN - PACK.credits, clock: AT_FUEL.clock - 60 };
const AT_LAND = { ...AT_ASK, credits: AT_ASK.credits + PAY, clock: TRY_AT };
const POINTS = runPoints({ settled: true, fuel: AT_LAND.fuel, timeLeft: HOME_AT });

// Real planets from this load's chart, so the reel shows their rendered art.
const fuelWorlds = PLANETS.filter((p) => p.shell === "fuel");
const homeWorlds = PLANETS.filter((p) => p.shell !== "fuel");
const FUEL_A = faceOf(fuelWorlds[0]);
const FUEL_B = faceOf(fuelWorlds[1]);
const HOME_A = faceOf(homeWorlds[0]);
const HOME_B = faceOf(homeWorlds[1]);

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (n) => String(r1(n));

function clockText(s) {
  const total = Math.max(0, Math.ceil(s - 1e-9));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// A point on a quadratic Bézier and the heading there, in degrees.
function quad(a, c, b, u) {
  const v = 1 - u;
  const dx = 2 * v * (c.x - a.x) + 2 * u * (b.x - c.x);
  const dy = 2 * v * (c.y - a.y) + 2 * u * (b.y - c.y);
  return {
    x: v * v * a.x + 2 * v * u * c.x + u * u * b.x,
    y: v * v * a.y + 2 * v * u * c.y + u * u * b.y,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

// The control point that bows a lane the way the star map does.
function bow(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const s = Math.min(16, len * 0.06);
  return { x: (a.x + b.x) / 2 - (dy / len) * s, y: (a.y + b.y) / 2 + (dx / len) * s };
}

const curve = (a, c, b) => `M ${r1(a.x)} ${r1(a.y)} Q ${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`;
const heading = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

// The game's ship, placed by its saucer like a flight on the map, a little bigger so it reads on a phone.
function Ship({ x, y, angle = 0, flying = false }) {
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) rotate(${Math.round(angle)}) scale(1.3)`}>
      <g className={flying ? "ship flying" : "ship"} transform={`translate(${-SAUCER_X} 0)`}>
        <ShipShapes />
      </g>
    </g>
  );
}

// A planet drawn `size` units in radius, with the map's drop or ! badge.
function World({ face, x, y, size, badge, shut = false }) {
  const mark = Math.min(1.8, Math.max(1.2, size / 20));
  const off = size * 0.72 + 6;
  return (
    <g transform={`translate(${r1(x)} ${r1(y)})`}>
      <g transform={`scale(${r2(size / face.radius)})`}>
        <PlanetDot face={face} detail shut={shut} />
      </g>
      {badge === "fuel" ? (
        <path className="fuel-badge" d={DROP} transform={`translate(${r1(off)} ${r1(-off)}) scale(${r2(mark * 1.3)})`} />
      ) : null}
      {badge === "home" ? (
        <g className="node-outer" transform={`translate(0 ${r1(-(size + 9 * mark))}) scale(${r2(mark)})`}>
          <circle className="beacon-pulse" r="6.5" />
          <circle className="beacon-bg" r="6.5" />
          <text className="beacon-mark" y="3.3" textAnchor="middle">
            !
          </text>
        </g>
      ) : null}
    </g>
  );
}

function Tag({ text, x, y, show = 1, tone, power, short }) {
  if (show <= 0.01) return null;
  return (
    <g className={tone ? `tag ${tone}` : "tag"} opacity={r2(show)}>
      <CostPill text={text} x={r1(x)} y={r1(y)} big power={power} short={short} />
    </g>
  );
}

function Label({ x, y, show = 1, tone, size, anchor = "middle", children }) {
  if (show <= 0.01) return null;
  return (
    <text
      className={tone ? `reel-label ${tone}` : "reel-label"}
      x={r1(x)}
      y={r1(y)}
      textAnchor={anchor}
      opacity={r2(show)}
      style={size ? { fontSize: `${size}px` } : undefined}
    >
      {children}
    </text>
  );
}

// 1 · The goal: leave the station and find a home before the clock runs out.
const GOAL = { from: { x: 104, y: 120 }, bend: { x: 236, y: 30 }, to: { x: 352, y: 112 }, home: { x: 404, y: 120 } };

function drawGoal(t, v) {
  const { from, bend, to, home } = GOAL;
  const u = 0.82 * easeInOut((t - 0.5) / 3.8);
  return (
    <>
      <path className="reel-route" d={curve(from, bend, to)} />
      <Starbase x="40" y="88" width="64" height="64" />
      <World face={HOME_A} x={home.x} y={home.y} size={36} badge="home" />
      <Label x={home.x} y={home.y + 62} show={smooth(0.9, 1.5, t)}>
        New home?
      </Label>
      <Ship {...quad(from, bend, to, u)} flying={t > 0.5 && t < 4.3} />
      <Tag text={`${clockText(v.clock)} left`} x={226} y={214} tone="time" />
    </>
  );
}

// 2 · Fly: a scan finds the systems one lane away, and each lane costs fuel.
const FLY = { S: { x: 52, y: 122 }, A: { x: 206, y: 66 }, B: { x: 218, y: 186 }, C: { x: 394, y: 42 }, D: { x: 410, y: 154 } };
const FLY_BEND = { SA: bow(FLY.S, FLY.A), SB: bow(FLY.S, FLY.B), AC: bow(FLY.A, FLY.C), AD: bow(FLY.A, FLY.D) };

function drawFly(t) {
  const { S, A, B, C, D } = FLY;
  const { SA, SB, AC, AD } = FLY_BEND;
  const found = smooth(0.8, 1.4, t);
  const onward = smooth(4.6, 5.2, t);
  const sweep = clamp((t - 0.2) / 1.2);
  const stars = [
    [A, "yellow", found],
    [B, "orange", found],
    [C, "blue", onward],
    [D, "red", onward],
  ];
  return (
    <>
      {sweep > 0 && sweep < 1 ? (
        <circle className="reel-sweep" cx={S.x} cy={S.y} r={r1(lerp(8, 250, easeOut(sweep)))} opacity={r2(0.9 * (1 - sweep))} />
      ) : null}
      <g opacity={r2(found)}>
        <path className={t >= 2 ? "link onroute" : "link hot"} d={curve(S, SA, A)} />
        <path className="link hot" d={curve(S, SB, B)} />
      </g>
      <g opacity={r2(onward)}>
        <path className="link" d={curve(A, AC, C)} />
        <path className="link" d={curve(A, AD, D)} />
      </g>
      <Starbase x={S.x - 24} y={S.y - 24} width="48" height="48" />
      {stars.map(([p, kind, show]) => (
        <g key={kind} transform={`translate(${p.x} ${p.y})`} opacity={r2(show)}>
          <StarDot kind={kind} r={9} />
        </g>
      ))}
      <Tag text={`${num(LANE_OUT)} fuel`} {...quad(S, SA, A, 0.5)} show={found * (1 - smooth(1.9, 2.3, t))} />
      <Tag text={`${num(LANE_OUT)} fuel`} {...quad(S, SB, B, 0.5)} show={found} />
      <Tag text={`${num(LANE_ON)} fuel`} {...quad(A, AC, C, 0.5)} show={onward} short />
      <Tag text={`${num(LANE_ON)} fuel`} {...quad(A, AD, D, 0.5)} show={onward} short />
      <Ship {...quad(S, SA, A, easeInOut((t - 2) / 2.4))} flying={t > 2 && t < 4.4} />
      <Label x={A.x} y={lerp(42, 34, smooth(4.4, 5, t))} tone="bad" show={smooth(4.4, 4.7, t)}>
        −{num(LANE_OUT)} fuel
      </Label>
      <Label x={404} y={216} tone="bad" show={smooth(5.1, 5.5, t)}>
        Refuel first
      </Label>
    </>
  );
}

// 3 · Hop: inside a system, planets orbit the sun and hops cost power, which the sun recharges.
const SUN = { x: 272, y: 122 };
const JUMP = { x: 42, y: 122 };
const ORBITS = [
  { face: FUEL_A, rx: 70, a: 2.4, w: 0.18, size: 13, badge: "fuel" },
  { face: HOME_A, rx: 110, a: 0.5, w: 0.12, size: 16, badge: "home" },
  { face: FUEL_B, rx: 150, a: 4.3, w: 0.08, size: 12, badge: "fuel" },
];
const orbit = (o, t) => ({
  x: SUN.x + o.rx * Math.cos(o.a + o.w * t),
  y: SUN.y + o.rx * TILT * Math.sin(o.a + o.w * t),
});
const HOP_TO = orbit(ORBITS[0], 2.5);
const HOP_BEND = bow(JUMP, HOP_TO);

function drawHop(t) {
  const here = orbit(ORBITS[0], t);
  const ship =
    t >= 2.5
      ? { x: here.x, y: here.y - 26, angle: heading(here, SUN) }
      : quad(JUMP, HOP_BEND, HOP_TO, easeInOut((t - 0.9) / 1.6));
  const shown = smooth(0.3, 0.7, t);
  return (
    <>
      {ORBITS.map((o) => (
        <ellipse key={o.rx} className="orbit" cx={SUN.x} cy={SUN.y} rx={o.rx} ry={r1(o.rx * TILT)} />
      ))}
      <g className="jump" transform={`translate(${JUMP.x} ${JUMP.y})`}>
        <JumpGate />
      </g>
      <Label x={JUMP.x} y={JUMP.y + 36} tone="dim">
        Jump point
      </Label>
      <g className="sun" transform={`translate(${SUN.x} ${SUN.y})`}>
        <StarDot kind="yellow" r={20} sun />
      </g>
      {ORBITS.map((o) => {
        const p = orbit(o, t);
        return <World key={o.rx} face={o.face} x={p.x} y={p.y} size={o.size} badge={o.badge} />;
      })}
      <path className="link hot" d={curve(JUMP, HOP_BEND, HOP_TO)} opacity={r2(shown * (1 - 0.7 * smooth(2.5, 3, t)))} />
      <Tag text={`${num(HOP)} power`} {...quad(JUMP, HOP_BEND, HOP_TO, 0.5)} power show={shown * (1 - smooth(0.9, 1.2, t))} />
      <Ship {...ship} flying={t > 0.9 && t < 2.5} />
      <Label x={here.x} y={here.y - 44} tone="power" show={smooth(2.5, 2.8, t) * (1 - smooth(3.4, 3.6, t))}>
        −{num(HOP)} power
      </Label>
      <Label x={here.x} y={here.y - 44} tone="power" show={smooth(3.6, 3.9, t)}>
        +1 power
      </Label>
    </>
  );
}

// 4 · Refuel: a fuel stop's one-minute game earns credits, and the shop turns them into fuel.
const ROCKS = [80, 104, 92, 116].map((y, i) => ({ y, from: 0.5 + 0.62 * i, pop: 0.95 + 0.62 * i }));
const rockX = (rock, t) => 456 - 200 * (t - rock.from);
// A bomb drifts through between the second and third rocks, is left alone, and fades before the timer.
const BOMB = { y: 98, from: 0.5 + 0.62 * 1.5, life: 1 };
const RING = 2 * Math.PI * 24;

function drawRefuel(t) {
  const left = 1 - clamp((t - 0.3) / 3);
  const pressed = t >= 4.3 && t < 4.5;
  return (
    <>
      <World face={FUEL_A} x={80} y={118} size={38} badge="fuel" />
      <Ship x={80} y={196} />
      <Label x={80} y={lerp(64, 56, smooth(4.3, 4.9, t))} tone="fuel" show={smooth(4.3, 4.6, t)}>
        +{num(PACK.fuel)} fuel
      </Label>
      <rect className="reel-card" x="164" y="14" width="302" height="212" rx="12" />
      <text className="reel-card-title" x="180" y="38">
        FUEL STOP · ONE MINUTE
      </text>
      <circle className="reel-ring track" cx="210" cy="92" r="24" />
      <circle
        className="reel-ring value"
        cx="210"
        cy="92"
        r="24"
        strokeDasharray={r1(RING)}
        strokeDashoffset={r1(RING * (1 - left))}
        transform="rotate(-90 210 92)"
      />
      <text className="reel-ring-text" x="210" y="97" textAnchor="middle">
        {Math.ceil(60 * left)}
      </text>
      {ROCKS.map((rock, i) =>
        t >= rock.from && t < rock.pop ? <circle key={i} className="reel-rock" cx={r1(rockX(rock, t))} cy={rock.y} r="10" /> : null,
      )}
      {t >= BOMB.from && t < BOMB.from + BOMB.life ? (
        <g
          transform={`translate(${r1(rockX(BOMB, t))} ${BOMB.y})`}
          opacity={r2(1 - smooth(BOMB.from + 0.75, BOMB.from + BOMB.life, t))}
        >
          <circle className="reel-bomb" r="10" />
          <circle className="reel-spark" cx="3" cy="-13" r="3" />
        </g>
      ) : null}
      {ROCKS.map((rock, i) => {
        const k = clamp((t - rock.pop) / 0.35);
        return k > 0 && k < 1 ? (
          <circle key={`b${i}`} className="reel-boom" cx={r1(rockX(rock, rock.pop))} cy={rock.y} r={r1(lerp(6, 26, k))} opacity={r2(1 - k)} />
        ) : null;
      })}
      <Label x={315} y={148} tone="gold" show={smooth(3.3, 3.6, t)}>
        +{EARN} credits
      </Label>
      <g opacity={r2(0.45 + 0.55 * smooth(3.6, 3.9, t))}>
        <rect className={t >= 3.8 ? "reel-pack lit" : "reel-pack"} x="180" y="162" width="270" height="46" rx="10" />
        <path className="fuel-badge" d={DROP} transform="translate(202 185) scale(2)" />
        <Label x={220} y={191} anchor="start" tone="fuel">
          +{num(PACK.fuel)} fuel
        </Label>
        <Label x={312} y={191} anchor="start" tone="gold" size={13}>
          {PACK.credits} credits
        </Label>
        <rect className={pressed ? "reel-buy down" : "reel-buy"} x="392" y="172" width="46" height="26" rx="8" />
        <text className="reel-buy-text" x="415" y="189" textAnchor="middle">
          BUY
        </text>
      </g>
    </>
  );
}

// 5 · Answer: the landing chance grows with the time flown, and a right answer adds to it.
const KEYS = [
  ["A", "var(--accent)"],
  ["B", "var(--violet)"],
  ["C", "var(--pink)"],
  ["D", "var(--gold)"],
];
const BAR = { x: 164, y: 184, w: 302 };

function drawAnswer(t, v) {
  const flown = ROUND_S - Math.ceil(v.clock - 1e-9);
  const time = timeChance(flown * 1000);
  const plus = RIGHT_BONUS * smooth(4.2, 4.5, t);
  const right = t >= 3.8;
  return (
    <>
      <World face={HOME_A} x={72} y={112} size={34} badge="home" />
      <Ship x={72} y={196} />
      <rect className="reel-card" x="164" y="12" width="302" height="140" rx="12" />
      <text className="reel-card-title" x="180" y="34">
        A POSSIBLE HOME · ONE QUESTION
      </text>
      <rect className="reel-line" x="180" y="44" width="230" height="7" rx="3.5" />
      <rect className="reel-line" x="180" y="56" width="150" height="7" rx="3.5" />
      {KEYS.map(([key, color], i) => {
        const x = 180 + (i % 2) * 142;
        const y = 68 + Math.floor(i / 2) * 36;
        const good = right && key === "B";
        return (
          <g key={key}>
            <rect className={good ? "reel-tile right" : "reel-tile"} x={x} y={y} width="132" height="30" rx="8" />
            <rect className="reel-key" x={x + 7} y={y + 6} width="18" height="18" rx="4" style={{ "--k": color }} />
            <text className="reel-key-text" x={x + 16} y={y + 19} textAnchor="middle" style={{ "--k": color }}>
              {key}
            </text>
            {good ? (
              <Label x={x + 34} y={y + 20} anchor="start" tone="ok" size={13}>
                Right!
              </Label>
            ) : (
              <rect className="reel-line" x={x + 34} y={y + 12} width="72" height="6" rx="3" />
            )}
          </g>
        );
      })}
      <rect className="reel-skip" x="180" y="138" width="46" height="11" rx="5.5" />
      <text className="reel-skip-text" x="203" y="146.5" textAnchor="middle">
        SKIP
      </text>
      <text className="reel-card-title" x={BAR.x} y="175">
        LANDING CHANCE
      </text>
      <Label x={BAR.x + BAR.w} y={177} anchor="end" size={17}>
        {Math.round(time + plus)}%
      </Label>
      <rect className="reel-track" x={BAR.x} y={BAR.y} width={BAR.w} height="12" rx="6" />
      {time > 0 ? <rect className="reel-time" x={BAR.x} y={BAR.y} width={r1((BAR.w * time) / 100)} height="12" rx="6" /> : null}
      {plus > 0 ? (
        <rect className="reel-right" x={r1(BAR.x + (BAR.w * time) / 100)} y={BAR.y} width={r1((BAR.w * plus) / 100)} height="12" rx="6" />
      ) : null}
      <Label x={BAR.x} y={214} anchor="start" tone="time" size={13}>
        {clockText(flown)} flown: {time}%
      </Label>
      <Label x={BAR.x + BAR.w} y={214} anchor="end" tone="ok" size={13} show={smooth(4.2, 4.5, t)}>
        +{RIGHT_BONUS} right answer
      </Label>
      <Label x={BAR.x + BAR.w / 2} y={234} tone="dim" show={smooth(5, 5.4, t)}>
        A wrong answer halves it. Skip: new question.
      </Label>
    </>
  );
}

// 6 · Land: a toxic world costs time; the chance keeps growing, and a good one ends the run.
const TRY = { x: 70, y: 62 };
const SETTLE = { x: 70, y: 184 };
const SHIP_TRY = { x: 122, y: 62 };
const SHIP_SETTLE = { x: 122, y: 184 };
const LAND_BEND = bow(SHIP_TRY, SHIP_SETTLE);
const READINGS = [
  [
    ["Oxygen", "21%"],
    ["Gravity", "0.9 g"],
    ["Toxic elements", "640 ppm", "bad"],
  ],
  [
    ["Oxygen", "20%"],
    ["Gravity", "1.1 g"],
    ["Toxic elements", "12 ppm", "ok"],
  ],
];
const CONFETTI = ["#5ad1ff", "#8a7dff", "#ff79c6", "#ffd23f", "#7df0b4"];
const BITS = Array.from({ length: 18 }, (_, i) => ({
  x: 30 + ((i * 53) % 420),
  fall: 60 + (i % 5) * 15,
  spin: (i % 2 ? 1 : -1) * (160 + i * 12),
  w: i % 3 ? 5 : 9,
  color: CONFETTI[i % 5],
  delay: (i % 4) * 0.08,
}));

function drawLand(t) {
  const failed = t >= 1.3;
  const second = t >= 2.8;
  const card = second ? smooth(3, 3.3, t) : 1 - smooth(2.4, 2.8, t);
  const from = second ? 3.3 : 0.2;
  const ship =
    t < 2.4 ? { ...SHIP_TRY, angle: 180 } : quad(SHIP_TRY, LAND_BEND, SHIP_SETTLE, easeInOut((t - 2.4) / 1));
  const party = t - 4.5;
  return (
    <>
      <World face={HOME_A} x={TRY.x} y={TRY.y} size={30} badge={failed ? null : "home"} shut={failed} />
      <World face={HOME_B} x={SETTLE.x} y={SETTLE.y} size={30} badge="home" />
      <Ship {...ship} flying={t > 2.4 && t < 3.4} />
      <g opacity={r2(card)}>
        <rect className="reel-card" x="168" y="12" width="298" height="150" rx="12" />
        <text className="reel-card-title" x="184" y="36">
          LANDING CHANCE {second ? HOME_CHANCE : TRY_CHANCE}%
        </text>
        {READINGS[second ? 1 : 0].map(([name, value, tone], i) => (
          <g key={name} opacity={r2(smooth(from + 0.3 * i, from + 0.3 * i + 0.25, t))}>
            <Label x={184} y={66 + 26 * i} anchor="start" tone="dim">
              {name}
            </Label>
            <Label x={450} y={66 + 26 * i} anchor="end" tone={tone}>
              {value}
            </Label>
          </g>
        ))}
        {second ? (
          <Label x={184} y={146} anchor="start" tone="ok" size={20} show={smooth(4.5, 4.7, t)}>
            Settled!
          </Label>
        ) : (
          <Label x={184} y={146} anchor="start" tone="bad" show={smooth(1.3, 1.5, t)}>
            Not habitable · −{FAIL_S} s
          </Label>
        )}
      </g>
      {party > 0 && t < 6.9 ? (
        <g opacity={r2(1 - smooth(6.1, 6.8, t))}>
          {BITS.map((bit, i) => {
            const k = Math.max(0, party - bit.delay);
            return (
              <rect
                key={i}
                x={-bit.w / 2}
                y="-2.5"
                width={bit.w}
                height="5"
                fill={bit.color}
                transform={`translate(${bit.x} ${r1(-8 + bit.fall * k)}) rotate(${Math.round(bit.spin * k)})`}
              />
            );
          })}
        </g>
      ) : null}
      <Label x={317} y={196} tone="pink" size={22} show={smooth(5.2, 5.5, t)}>
        {num(POINTS)} points
      </Label>
      <Label x={317} y={220} tone="dim" show={smooth(5.3, 5.6, t)}>
        {num(AT_LAND.fuel / FUEL_PER_POINT)} for fuel + {num(HOME_AT / SECONDS_PER_POINT)} for {clockText(HOME_AT)} left
      </Label>
    </>
  );
}

// Each scene: its chip, length in seconds, caption, top bar over time (`focus` glows), the meter
// changes that pop (as [time, meter, text]), and its drawing.
const SCENES = [
  {
    id: "goal",
    chip: "Goal",
    s: 5,
    title: "Find a new home",
    text: `Land on a planet you can live on before the ${ROUND_S / 60}-minute clock runs out.`,
    hud: (t) => ({ ...AT_GOAL, clock: AT_GOAL.clock - 3 * clamp((t - 0.5) / 4), focus: "clock" }),
    pops: [],
    draw: drawGoal,
  },
  {
    id: "fly",
    chip: "Fly",
    s: 6,
    title: "Fly between stars",
    text: "Scan to find nearby solar systems, then fly a lane. Every flight burns fuel.",
    hud: (t) => ({
      ...AT_FLY,
      power: AT_FLY.power - (t >= 0.3 ? MAP_SCAN_POWER : 0),
      fuel: AT_FLY.fuel - LANE_OUT * easeInOut((t - 2) / 2.4),
      clock: AT_FLY.clock - 6 * clamp(t / 6),
      focus: t < 1.6 ? "power" : "fuel",
    }),
    pops: [
      [0.3, "power", `−${MAP_SCAN_POWER}`],
      [4.4, "fuel", `−${num(LANE_OUT)}`],
    ],
    draw: drawFly,
  },
  {
    id: "hop",
    chip: "Hop",
    s: 5,
    title: "Hop between planets",
    text: "Inside a solar system, hops cost power. Power recharges while you're there.",
    hud: (t) => ({
      ...AT_HOP,
      power: AT_HOP.power - HOP * easeInOut((t - 0.9) / 1.6) + (t >= 3.6 ? 1 : 0),
      clock: AT_HOP.clock - 5 * clamp(t / 5),
      focus: "power",
    }),
    pops: [
      [2.5, "power", `−${num(HOP)}`],
      [3.6, "power", "+1"],
    ],
    draw: drawHop,
  },
  {
    id: "refuel",
    chip: "Refuel",
    s: 6,
    title: "Refuel at a drop",
    text: "Planets with a drop are fuel stops: play for one minute to earn credits, then buy fuel.",
    hud: (t) => ({
      ...AT_FUEL,
      credits: t >= 4.3 ? EARN - PACK.credits : t >= 3.3 ? EARN : 0,
      fuel: AT_FUEL.fuel + (t >= 4.3 ? PACK.fuel : 0),
      clock: AT_FUEL.clock - 60 * clamp((t - 0.3) / 3),
      focus: t < 3.8 ? "credits" : "fuel",
    }),
    pops: [
      [3.3, "credits", `+${EARN}`],
      [4.3, "credits", `−${PACK.credits}`],
      [4.3, "fuel", `+${num(PACK.fuel)}`],
    ],
    draw: drawRefuel,
  },
  {
    id: "answer",
    chip: "Answer",
    s: 6,
    title: "Try a possible home",
    text: "Planets marked ! could be home. Answer one question, then try to land.",
    hud: (t) => ({
      ...AT_ASK,
      clock: lerp(AT_ASK.clock, TRY_AT, easeInOut((t - 0.6) / 2.4)),
      credits: AT_ASK.credits + (t >= 3.8 ? PAY : 0),
      focus: t < 3.4 ? "clock" : "credits",
    }),
    pops: [[3.8, "credits", `+${PAY}`]],
    draw: drawAnswer,
  },
  {
    id: "land",
    chip: "Land",
    s: 7,
    title: "Land to win",
    text: `The chance grows as the clock runs, and a failed landing costs ${FAIL_S} s. Settle to win.`,
    hud: (t) => ({
      ...AT_LAND,
      clock: t < 1.3 ? TRY_AT : lerp(TRY_AT - FAIL_S, HOME_AT, easeInOut((t - 2.4) / 1)),
      focus: t < 5.2 ? "clock" : "points",
    }),
    pops: [[1.3, "clock", `−${FAIL_S}`]],
    draw: drawLand,
  },
];

const METERS = [
  ["fuel", FuelIcon, "Fuel"],
  ["power", PowerIcon, "Power"],
  ["credits", CreditIcon, "Credits"],
  ["clock", ClockIcon, "Clock"],
  ["points", StarIcon, "Points"],
];

// The game's top bar, as the HUD draws it, showing the scene's numbers.
function Meters({ scene, t, v }) {
  const shown = {
    fuel: num(v.fuel),
    power: num(v.power),
    credits: String(Math.round(v.credits)),
    clock: clockText(v.clock),
    points: String(Math.round(runPoints({ settled: true, fuel: v.fuel, timeLeft: Math.floor(v.clock) }))),
  };
  return (
    <div className="meters reel-hud" aria-hidden="true">
      {METERS.map(([id, Icon, label]) => (
        <div key={id} className={v.focus === id ? `meter ${id} focus` : `meter ${id}`}>
          <Icon />
          <div className="m-text">
            <small>
              {label}
              {id === "points" ? <span className="if-land"> if you land</span> : null}
            </small>
            <b>{shown[id]}</b>
            {id === "fuel" ? (
              <span className="gauge">
                <i style={{ width: `${clamp(v.fuel / Math.max(30, v.fuel)) * 100}%` }} />
              </span>
            ) : null}
          </div>
          {scene.pops.map(([at, meter, text]) =>
            meter === id && t >= at && t < at + 1.2 ? (
              <span key={`${scene.id}-${meter}-${at}`} className={text.startsWith("+") ? "delta up" : "delta down"}>
                {text}
              </span>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}

function ReelDefs() {
  return (
    <defs>
      <radialGradient id="reel-rock" cx="0.4" cy="0.36" r="0.7">
        <stop offset="0" stopColor="#a58b77" />
        <stop offset="0.62" stopColor="#5a463a" />
        <stop offset="1" stopColor="#33271f" />
      </radialGradient>
      <radialGradient id="reel-bomb" cx="0.4" cy="0.36" r="0.7">
        <stop offset="0" stopColor="#3a4256" />
        <stop offset="0.68" stopColor="#141824" />
        <stop offset="1" stopColor="#07090f" />
      </radialGradient>
      <radialGradient id="reel-boom">
        <stop offset="0.14" stopColor="#ffffff" />
        <stop offset="0.3" stopColor="#ffd27a" />
        <stop offset="0.5" stopColor="#ff7828" stopOpacity="0.6" />
        <stop offset="0.7" stopColor="#ff7828" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="reel-time" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7be0ff" />
        <stop offset="1" stopColor="#4a7cff" />
      </linearGradient>
    </defs>
  );
}

// The defs never change, so they render once rather than every frame.
const Defs = memo(function Defs() {
  return (
    <>
      <MapDefs />
      <ReelDefs />
    </>
  );
});

function Stage({ scene, t, v }) {
  return (
    <svg className="reel-stage" viewBox="0 0 480 240" aria-hidden="true">
      <Defs />
      {scene.draw(t, v)}
    </svg>
  );
}

const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Reel seconds per real second. Below 1 so walk-up players can follow the moves and read the captions.
const PACE = 0.8;

// Calls tick(reel seconds) once per animation frame while `on`. The step is capped, so a hidden tab
// or a stall doesn't skip the reel ahead.
function useFrames(on, tick) {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!on) return undefined;
    let last = performance.now();
    let id = requestAnimationFrame(function frame(now) {
      ref.current(PACE * Math.min(0.1, Math.max(0, (now - last) / 1000)));
      last = now;
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [on]);
}

// Each scene's last frame stays up this many reel seconds before the next scene or loop.
const HOLD = 1.2;
const LOOPS = 3;

/** One scene as a clip for a tip: it plays LOOPS times, holding the last frame for HOLD s, then stays on it. */
export function Reel({ only }) {
  const scene = SCENES.find((s) => s.id === only);
  const [calm] = useState(still);
  const [pos, setPos] = useState(() => ({ t: calm ? scene.s : 0, plays: calm ? LOOPS : 0 }));
  useFrames(pos.plays < LOOPS, (dt) =>
    setPos((p) => {
      const t = p.t + dt;
      if (t < scene.s + HOLD) return { ...p, t };
      const plays = p.plays + 1;
      return { t: plays < LOOPS ? 0 : scene.s, plays };
    }),
  );
  const t = Math.min(pos.t, scene.s);
  return <Stage scene={scene} t={t} v={scene.hud(t)} />;
}

/** The how-to-play screen: the whole reel once, with chips to jump; the last button reads `doneLabel`. */
export default function HowTo({ onDone, doneLabel = "Continue" }) {
  const [calm] = useState(still);
  const [pos, setPos] = useState({ i: 0, t: calm ? SCENES[0].s : 0 });
  const [playing, setPlaying] = useState(!calm);
  const scene = SCENES[pos.i];
  const last = pos.i === SCENES.length - 1;
  const ended = last && pos.t >= scene.s;
  const t = Math.min(pos.t, scene.s);
  const v = scene.hud(t);

  useFrames(playing && !ended, (dt) =>
    setPos((p) => {
      const next = p.t + dt;
      const s = SCENES[p.i].s;
      if (p.i === SCENES.length - 1) return { i: p.i, t: Math.min(next, s) };
      return next < s + HOLD ? { i: p.i, t: next } : { i: p.i + 1, t: 0 };
    }),
  );

  const go = (i) => {
    setPos({ i, t: calm ? SCENES[i].s : 0 });
    setPlaying(!calm);
  };
  const keys = useRef(null);
  keys.current = { go, i: pos.i, last, onDone };
  useEffect(() => {
    const onKey = (e) => {
      // A held key from skipping the film must not skip this too.
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = keys.current;
      if (e.key === "Escape") k.onDone();
      else if (e.key === "ArrowRight" && !k.last) k.go(k.i + 1);
      else if (e.key === "ArrowLeft" && k.i > 0) k.go(k.i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="screen">
      <section className="panel wide howto">
        <div className="howto-head">
          <p className="eyebrow">
            How to play · {pos.i + 1} / {SCENES.length}
          </p>
          <button type="button" className="ghost" onClick={onDone}>
            Skip
          </button>
        </div>
        <Meters scene={scene} t={t} v={v} />
        <Stage scene={scene} t={t} v={v} />
        <div className="reel-cap" aria-live="polite">
          <h1>{scene.title}</h1>
          <p>{scene.text}</p>
        </div>
        <ol className="reel-steps">
          {SCENES.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="ghost"
                aria-current={i === pos.i ? "step" : undefined}
                style={{ "--p": i < pos.i ? 1 : i === pos.i ? r2(t / s.s) : 0 }}
                onClick={() => go(i)}
              >
                {s.chip}
              </button>
            </li>
          ))}
        </ol>
        <div className="row reel-controls">
          <button type="button" className="ghost" onClick={() => go(pos.i - 1)} disabled={pos.i === 0}>
            Back
          </button>
          {calm ? null : (
            <button type="button" className="ghost" onClick={() => (ended ? go(0) : setPlaying((p) => !p))}>
              {ended ? "Replay" : playing ? "Pause" : "Play"}
            </button>
          )}
          <button type="button" onClick={() => (last ? onDone() : go(pos.i + 1))} autoFocus>
            {last ? doneLabel : "Next"}
          </button>
        </div>
      </section>
    </main>
  );
}
