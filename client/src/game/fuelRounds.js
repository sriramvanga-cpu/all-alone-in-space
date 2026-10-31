// Fuel-stop challenges. Each stop plays the next round in this list, so ten fuel stops never
// repeat one, and every player meets them in the same order. `per` is how many right answers
// earn one credit; it evens out fast rounds against the maths minute (~13 credits for a typical
// player). Rounds without `make` are interactive games drawn in App.jsx.
import { makeFuelCard, rollInt, shuffleWith } from "./rules.js";

const pick = (list, rng) => list[rollInt(rng, 0, list.length - 1)];

// The answer plus three distinct non-negative numbers near it.
function nearMisses(answer, rng, spread) {
  const choices = new Set([answer]);
  for (let guard = 0; choices.size < 4 && guard < 40; guard++) {
    const n = answer + rollInt(rng, 1, spread) * (rng() < 0.5 ? -1 : 1);
    if (n >= 0) choices.add(n);
  }
  return shuffleWith([...choices], rng).map(String);
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

function makeCountCard(rng = Math.random) {
  const n = rollInt(rng, 7, 15);
  // One cell per slot of an 8 × 5 grid, nudged off the grid so it doesn't look like one.
  const slots = shuffleWith([...Array(40).keys()], rng).slice(0, n);
  const dots = slots.map((i) => [(i % 8) * 12.5 + 6.25 + rollInt(rng, -3, 3), Math.floor(i / 8) * 20 + 10 + rollInt(rng, -4, 4)]);
  return { dots, choices: nearMisses(n, rng, 3), answer: String(n) };
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

function makePatternCard(rng = Math.random) {
  const a = rollInt(rng, 2, 9);
  const d = rollInt(rng, 3, 12);
  const kind = rollInt(rng, 0, 2);
  // Add d each time, double each time, or squares (4, 9, 16, 25, …).
  const term = (i) => [a + d * i, a * 2 ** i, (a + i) ** 2][kind];
  const answer = term(4);
  return { prompt: `${[0, 1, 2, 3].map(term).join(", ")}, ?`, choices: nearMisses(answer, rng, 9), answer: String(answer) };
}

const ARROWS = ["←", "→", "↑", "↓"];

function makeArrowCard(rng = Math.random) {
  const dir = pick(ARROWS, rng);
  const flank = rng() < 0.4 ? dir : pick(ARROWS.filter((a) => a !== dir), rng);
  return { prompt: `${flank} ${flank} ${dir} ${flank} ${flank}`, choices: [...ARROWS], answer: dir };
}

// None of these has both parts even, so the doubled form never matches another fraction's plain form.
const FRACTIONS = [[1, 2], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 10], [3, 10], [7, 10], [1, 8]];
const FORMS = [
  ([n, d]) => `${n}/${d}`,
  ([n, d]) => `${2 * n}/${2 * d}`,
  ([n, d]) => String(n / d),
  ([n, d]) => `${(100 * n) / d}%`,
];

function makeOddCard(rng = Math.random) {
  const [f, g] = shuffleWith(FRACTIONS, rng);
  const odd = rollInt(rng, 0, 3);
  const choices = FORMS.map((form, i) => form(i === odd ? g : f));
  return { choices: shuffleWith(choices, rng), answer: choices[odd] };
}

export const FUEL_ROUNDS = Object.freeze(
  [
    { id: "maths", title: "Quick maths", how: "Pick the right answer.", per: 1, make: makeFuelCard },
    { id: "valve", title: "Pressure valve", how: "Tap Vent while the needle is in the green.", per: 3 },
    { id: "code", title: "Reactor code", how: "Watch the lights, then tap them back in order.", per: 1 },
    { id: "ink", title: "Colour clash", how: "Pick the colour of the ink, not the word.", per: 2, make: makeInkCard },
    { id: "count", title: "Cell count", how: "How many fuel cells are there?", per: 1, make: makeCountCard },
    { id: "element", title: "Element check", how: "Name the element from its symbol.", per: 1, make: makeElementCard },
    { id: "tank", title: "Fullest tank", how: "Pick the fullest tank.", per: 2, make: makeTankCard },
    { id: "pattern", title: "Number pattern", how: "What comes next?", per: 1, make: makePatternCard },
    { id: "arrows", title: "Flight path", how: "Which way does the middle arrow point?", per: 3, make: makeArrowCard },
    { id: "odd", title: "Odd one out", how: "Which value is not equal to the other three?", per: 1, make: makeOddCard },
  ].map(Object.freeze),
);
