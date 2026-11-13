// Fuel-stop challenges. Each player gets them in a shuffled order (App.jsx), so none repeats until
// all nine have been played. `per` is how many right answers earn one credit; it is 1 in every
// game now. Rounds without `make` are interactive games drawn in App.jsx.
import { rollInt, shuffleWith } from "./rules.js";

const pick = (list, rng) => list[rollInt(rng, 0, list.length - 1)];

// A fresh sum, difference or product each time, so there is no list to learn. The wrong choices sit a
// few off the answer.
function makeMathsCard(rng = Math.random) {
  let a;
  let b;
  let op;
  let answer;
  const kind = rollInt(rng, 0, 2);
  if (kind === 0) {
    a = rollInt(rng, 12, 89);
    b = rollInt(rng, 12, 89);
    [op, answer] = ["+", a + b];
  } else if (kind === 1) {
    a = rollInt(rng, 24, 99);
    b = rollInt(rng, 3, Math.min(40, a - 3));
    [op, answer] = ["−", a - b];
  } else {
    a = rollInt(rng, 3, 12);
    b = rollInt(rng, 3, 12);
    [op, answer] = ["×", a * b];
  }
  const choices = new Set([String(answer)]);
  for (let guard = 0; choices.size < 4 && guard < 40; guard++) {
    const n = answer + rollInt(rng, 1, 9) * (rng() < 0.5 ? -1 : 1);
    if (n >= 0) choices.add(String(n));
  }
  return { prompt: `${a} ${op} ${b}`, choices: shuffleWith([...choices], rng), answer: String(answer) };
}

const INKS = [
  ["Red", "#ff5a5a"],
  ["Blue", "#4f8bff"],
  ["Green", "#3ddc84"],
  ["Yellow", "#ffd23f"],
  ["Purple", "#c08bff"],
  ["Orange", "#ff9a3c"],
];

function makeInkCard(rng = Math.random) {
  const [word, ink, a, b] = shuffleWith(INKS, rng);
  return {
    prompt: word[0].toUpperCase(),
    ink: ink[1],
    choices: shuffleWith([ink, word, a, b], rng).map((c) => c[0]),
    answer: ink[0],
  };
}

const ELEMENTS = [
  ["H", "Hydrogen"], ["He", "Helium"], ["C", "Carbon"], ["N", "Nitrogen"], ["O", "Oxygen"],
  ["Ne", "Neon"], ["Na", "Sodium"], ["Mg", "Magnesium"], ["Al", "Aluminium"], ["Si", "Silicon"],
  ["P", "Phosphorus"], ["S", "Sulphur"], ["Cl", "Chlorine"], ["Ar", "Argon"], ["K", "Potassium"],
  ["Ca", "Calcium"], ["Ti", "Titanium"], ["Fe", "Iron"], ["Ni", "Nickel"], ["Cu", "Copper"],
  ["Zn", "Zinc"], ["Ag", "Silver"], ["Sn", "Tin"], ["Pt", "Platinum"], ["Au", "Gold"],
  ["Hg", "Mercury"], ["Pb", "Lead"], ["U", "Uranium"],
];

function makeElementCard(rng = Math.random) {
  const [answer, ...rest] = shuffleWith(ELEMENTS, rng);
  // Names starting with the symbol's letter make the best traps (Ag: Argon, Aluminium).
  const traps = rest.filter((e) => e[1][0] === answer[0][0]);
  const others = [...traps, ...rest.filter((e) => !traps.includes(e))].slice(0, 3);
  return { prompt: answer[0], choices: shuffleWith([answer, ...others], rng).map((e) => e[1]), answer: answer[1] };
}

function makeTankCard(rng = Math.random) {
  const top = rollInt(rng, 50, 92);
  const gaps = shuffleWith([5, 8, 11, 14, 18, 22, 27], rng).slice(0, 3);
  return { gauge: true, choices: shuffleWith([top, ...gaps.map((g) => top - g)], rng).map(String), answer: String(top) };
}

const ARROWS = ["←", "→", "↑", "↓"];

function makeArrowCard(rng = Math.random) {
  const dir = pick(ARROWS, rng);
  const flank = rng() < 0.4 ? dir : pick(ARROWS.filter((a) => a !== dir), rng);
  return { prompt: `${flank} ${flank} ${dir} ${flank} ${flank}`, choices: [...ARROWS], answer: dir };
}

// The planets in order out from the Sun.
export const PLANET_ORDER = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

// Planet order: the planet just out from ("Mars → ?") or just in from ("? → Mars") the one shown.
// `worlds` asks for pictures on the choices, and `row` says where in the order the shown planet and the gap are
// (indexes into PLANET_ORDER), for the screen to draw as a row of slots; `prompt` is the same card in words.
function makeOrderCard(rng = Math.random) {
  const i = rollInt(rng, 0, PLANET_ORDER.length - 2);
  const outward = rng() < 0.5;
  const [inner, outer] = [PLANET_ORDER[i], PLANET_ORDER[i + 1]];
  const shown = outward ? inner : outer;
  const answer = outward ? outer : inner;
  const others = shuffleWith(PLANET_ORDER.filter((p) => p !== shown && p !== answer), rng).slice(0, 3);
  return {
    prompt: outward ? `${shown} → ?` : `? → ${shown}`,
    choices: shuffleWith([answer, ...others], rng),
    answer,
    worlds: true,
    row: { shown, at: outward ? i : i + 1, gap: outward ? i + 1 : i },
  };
}

export const FUEL_ROUNDS = Object.freeze(
  [
    { id: "maths", title: "Quick maths", how: "Pick the right answer.", per: 1, make: makeMathsCard },
    { id: "valve", title: "Pressure valve", how: "Tap Vent while the needle is in the green.", per: 1 },
    { id: "reactor", title: "Reactor tap", how: "Watch the four cells light up, then tap them in the same order (or press 1 to 4).", per: 1 },
    { id: "ink", title: "Colour clash", how: "Pick the colour of the ink, not the word.", per: 1, make: makeInkCard },
    { id: "rocks", title: "Asteroid tap", how: "Tap or drag across the asteroids as they fly past, or press Space to hit the leading one. Leave the bombs alone.", per: 1 },
    { id: "tank", title: "Fullest tank", how: "Pick the fullest tank.", per: 1, make: makeTankCard },
    { id: "arrows", title: "Flight path", how: "Which way does the middle arrow point?", per: 1, make: makeArrowCard },
    { id: "element", title: "Element check", how: "Name the element from its symbol.", per: 1, make: makeElementCard },
    { id: "order", title: "Planet order", how: "Going out from the Sun, which planet fills the gap?", per: 1, make: makeOrderCard },
  ].map(Object.freeze),
);
