// Fuel-stop challenges. Each player gets them in a shuffled order (App.jsx), so none repeats until
// all seven have been played. `per` is how many right answers
// earn one credit; it evens out fast rounds so a typical player earns about 13 credits a minute.
// Rounds without `make` are interactive games drawn in App.jsx.
import { rollInt, shuffleWith } from "./rules.js";

const pick = (list, rng) => list[rollInt(rng, 0, list.length - 1)];

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

export const FUEL_ROUNDS = Object.freeze(
  [
    { id: "valve", title: "Pressure valve", how: "Tap Vent while the needle is in the green.", per: 2 },
    { id: "log", title: "Flight log", how: "Watch the arrows, then tap them back in order, or use the arrow keys.", per: 1 },
    { id: "ink", title: "Colour clash", how: "Pick the colour of the ink, not the word.", per: 2, make: makeInkCard },
    { id: "rocks", title: "Asteroid tap", how: "Tap or drag across the asteroids as they fly past, or press Space to hit the leading one.", per: 4 },
    { id: "tank", title: "Fullest tank", how: "Pick the fullest tank.", per: 2, make: makeTankCard },
    { id: "arrows", title: "Flight path", how: "Which way does the middle arrow point?", per: 3, make: makeArrowCard },
    { id: "element", title: "Element check", how: "Name the element from its symbol.", per: 1, make: makeElementCard },
  ].map(Object.freeze),
);
