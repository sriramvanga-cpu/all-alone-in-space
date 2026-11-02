import { shuffleWith } from "./rules.js";

// Two maps. The star map holds the station and solar systems, joined by lanes that cost fuel.
// Inside a system, planets orbit a sun, and a hop between two of them costs power by how far
// apart they are right now. A system's ring sets its test planets' habitability band and
// question level, so the outer systems settle most often but cost the most fuel to reach.

export const STATION = "station";

// One fixed chart, so every run is equally fair: [ring, r, angle, planets from the sun outward],
// F a fuel planet and T a test planet. x = r*cos(angle), y = r*sin(angle), SVG y-down.
// 14 test planets (4 inner, 4 middle, 6 outer) keep a simulated typical player winning about half
// their runs; more of them, or cheaper lanes, make the game much easier.
const CHART = [
  ["inner", 0.74, -2.55, "FTF"],
  ["inner", 1.2, -1.5, "FF"],
  ["inner", 0.86, -0.45, "FFT"],
  ["inner", 1.3, 0.6, "FTFF"],
  ["inner", 0.96, 1.65, "FF"],
  ["inner", 1.12, 2.7, "TFF"],
  ["middle", 1.95, -2.1, "FF"],
  ["middle", 2.5, -1.2, "TF"],
  ["middle", 2.07, -0.3, "FF"],
  ["middle", 2.6, 0.59, "FTF"],
  ["middle", 2.15, 1.49, "FFT"],
  ["middle", 2.45, 2.39, "TF"],
  ["middle", 2.3, 3.29, "FFF"],
  ["outer", 3.48, -2.33, "TF"],
  ["outer", 4.2, -1.54, "FF"],
  ["outer", 3.65, -0.76, "FTF"],
  ["outer", 4.28, 0.03, "FF"],
  ["outer", 3.78, 0.81, "FTT"],
  ["outer", 4.05, 1.6, "FT"],
  ["outer", 3.6, 2.38, "TF"],
  ["outer", 4.15, 3.17, "FF"],
];

// Lanes by CHART row; -1 is the station. Each ring is joined with one gap, plus a few lanes between rings.
const LANE_ROWS = [
  [-1, 0], [-1, 2], [-1, 5],
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
  [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20],
  [1, 7], [3, 9], [4, 10],
  [6, 13], [9, 17], [11, 19], [12, 20],
];

// Lane length: 10 out of the station, otherwise by the farther ring. Fuel = variable × length × 0.5,
// so lanes cost 8, 12 or 16 fuel: refuelling inside a system is cheap, so the lanes carry the cost.
const BAND = { inner: 16, middle: 24, outer: 32 };

const STARS = [
  "Sirius", "Procyon", "Arcturus", "Polaris", "Canopus", "Achernar", "Fomalhaut", "Spica",
  "Kochab", "Castor", "Pollux", "Mira", "Alcyone", "Bellatrix", "Mintaka", "Shaula",
  "Hadar", "Mimosa", "Algol", "Mizar", "Thuban", "Albireo", "Merak", "Wolf 359",
];
const TEST_NAMES = [
  "Earth", "Risa", "Andoria", "P'Jem", "Tellar", "Denobula", "Bajor", "Deneb", "Betazed", "Khitomer",
  "Trill", "Orion", "Qo'noS", "Nimbus", "Romulus", "Remus", "Cardassia", "Ferenginar", "Ocampa", "Talax",
];
const FUEL_NAMES = [
  "Delta Vega", "Ceti Alpha", "Talos", "Organia", "Cestus", "Regula", "Deneva", "Tarsus", "Janus",
  "Sherman", "Mudd", "Capella", "Ardana", "Eminiar", "Neural", "Ekos", "Gideon", "Scalos", "Sarpeidon",
  "Argelius", "Melkot", "Minara", "Aldebaran", "Berengaria", "Izar", "Elas", "Troyius", "Cheron",
  "Coridan", "Rigel", "Altair", "Antares", "Vega", "Maluria", "Holberg", "Platonius", "Excalbia", "Gothos",
];

// What each system's planets circle. It's only looks: every kind plays the same.
const STAR_KINDS = [
  "hole", "hole", "neutron", "neutron", "giant", "giant", "dwarf", "dwarf", "binary", "binary",
  "yellow", "yellow", "yellow", "yellow", "yellow", "orange", "orange", "orange", "red", "red", "blue",
];

// Each load turns the chart, mirrors it half the time and shuffles the names: the same map
// to play, but a route can't be passed from one player to the next.
const turn = Math.random() * 2 * Math.PI;
const flip = Math.random() < 0.5 ? -1 : 1;
const stars = shuffleWith(STARS, Math.random);
const tests = shuffleWith(TEST_NAMES, Math.random);
const fuels = shuffleWith(FUEL_NAMES, Math.random);
const kinds = shuffleWith(STAR_KINDS, Math.random);

export const SYSTEMS = Object.freeze(
  CHART.map(([ring, r, angle], slot) =>
    Object.freeze({ id: stars[slot], ring, r, angle: flip * angle + turn, slot, star: kinds[slot] }),
  ),
);

// Orbits are 65 apart, starting 100 from the sun; inner planets go round faster.
export const PLANETS = Object.freeze(
  CHART.flatMap(([ring, , , kinds], slot) =>
    [...kinds].map((kind, i) => {
      const orbit = 100 + 65 * i;
      return Object.freeze({
        id: kind === "T" ? tests.pop() : fuels.pop(),
        system: SYSTEMS[slot].id,
        shell: kind === "T" ? ring : "fuel",
        orbit,
        period: 24_000 * (orbit / 100) ** 1.5,
        phase: Math.random() * 2 * Math.PI,
      });
    }),
  ),
);

const idOf = (row) => (row < 0 ? STATION : SYSTEMS[row].id);
export const LANES = Object.freeze(
  LANE_ROWS.map(([a, b]) =>
    Object.freeze({
      a: idOf(a),
      b: idOf(b),
      distance: a < 0 ? 10 : Math.max(BAND[CHART[a][0]], BAND[CHART[b][0]]),
    }),
  ),
);

export function system(id) {
  return SYSTEMS.find((s) => s.id === id) ?? null;
}

export function planet(id) {
  return PLANETS.find((p) => p.id === id) ?? null;
}

export function planetsOf(id) {
  return PLANETS.filter((p) => p.system === id);
}

export function lanesFrom(id) {
  const out = [];
  for (const lane of LANES) {
    if (lane.a === id) out.push({ id: lane.b, distance: lane.distance });
    else if (lane.b === id) out.push({ id: lane.a, distance: lane.distance });
  }
  return out;
}

// Inside a system the ship arrives at a jump point this far left of the sun.
export const JUMP_R = 365;
// Each system is seen at a tilt, so its orbits are ovals this much flatter than they are wide.
export const TILT = 0.62;

/** Where a planet is at wall-clock time ms, in system units around its sun. */
export function orbitAt(p, ms) {
  const a = p.phase - (2 * Math.PI * ms) / p.period;
  return { x: p.orbit * Math.cos(a), y: p.orbit * TILT * Math.sin(a) };
}

/** A planet's spot at ms, or the jump point for a system id. */
export function positionAt(id, ms) {
  const p = planet(id);
  return p ? orbitAt(p, ms) : { x: -JUMP_R, y: 0 };
}

export function hopDistance(from, to, ms) {
  const a = positionAt(from, ms);
  const b = positionAt(to, ms);
  return Math.hypot(a.x - b.x, a.y - b.y);
}
