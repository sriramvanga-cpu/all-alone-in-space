import { SYSTEMS } from "../game/map.js";
import { hashId } from "./Planet.jsx";
import { ShipDefs } from "./Ship.jsx";
import { StationDefs } from "./Station.jsx";

// Shared defs and backdrop for the star chart. Scale matches App.jsx's SCALE.
const SCALE = 190;

// Star colours: centre, body, limb.
const STAR_TINTS = {
  yellow: ["#fffbe8", "#ffd86a", "#e89a2a"],
  orange: ["#fff1de", "#ffad5c", "#d8702a"],
  red: ["#ffe6dc", "#ff7f5c", "#b8442e"],
  blue: ["#f6f9ff", "#b4ceff", "#6688ff"],
};
const TINTS = Object.keys(STAR_TINTS);

/** A star: a bright core in a soft glow, its colour fixed by its name. Small on the star map, big as a sun. */
export function StarDot({ name, r }) {
  const tint = TINTS[hashId(name) % TINTS.length];
  return (
    <g className="star" aria-hidden="true">
      <circle className="star-glow" r={r * 2.6} fill={`url(#star-${tint}-glow)`} />
      <circle r={r} fill={`url(#star-${tint})`} />
    </g>
  );
}

// Day/night shading shared by every planet. Unit space, light from the upper left.
export function MapDefs() {
  const speckles = [];
  let s = 0x9d2f;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 16; i++) {
    const dark = rand() < 0.5;
    speckles.push(
      <circle
        key={i}
        cx={(rand() * 0.22).toFixed(3)}
        cy={(rand() * 0.22).toFixed(3)}
        r={(0.006 + rand() * 0.012).toFixed(3)}
        fill={dark ? "#000" : "#fff"}
        opacity={(0.1 + rand() * 0.16).toFixed(2)}
      />,
    );
  }
  return (
    <defs>
      <radialGradient id="pl-night" cx="0.34" cy="0.3" r="0.78">
        <stop offset="0" stopColor="#02040e" stopOpacity="0" />
        <stop offset="0.5" stopColor="#02040e" stopOpacity="0" />
        <stop offset="0.75" stopColor="#02040e" stopOpacity="0.46" />
        <stop offset="1" stopColor="#02040e" stopOpacity="0.9" />
      </radialGradient>
      <radialGradient id="pl-shine" cx="0.3" cy="0.26" r="0.3">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="pl-rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
        <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.16" />
        <stop offset="0.7" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <pattern id="pl-grain" width="0.22" height="0.22" patternUnits="userSpaceOnUse">
        {speckles}
      </pattern>
      <linearGradient id="fuel-drop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe08a" />
        <stop offset="1" stopColor="#ff8a1f" />
      </linearGradient>
      {TINTS.map((tint) => {
        const [centre, body, limb] = STAR_TINTS[tint];
        return [
          <radialGradient key={tint} id={`star-${tint}`} cx="0.42" cy="0.4" r="0.62">
            <stop offset="0" stopColor={centre} />
            <stop offset="0.55" stopColor={body} />
            <stop offset="1" stopColor={limb} />
          </radialGradient>,
          <radialGradient key={`${tint}-glow`} id={`star-${tint}-glow`}>
            <stop offset="0.3" stopColor={body} stopOpacity="0.5" />
            <stop offset="1" stopColor={body} stopOpacity="0" />
          </radialGradient>,
        ];
      })}
      <ShipDefs />
      <StationDefs />
    </defs>
  );
}

function meanRadius(ring) {
  const systems = SYSTEMS.filter((s) => s.ring === ring);
  return (systems.reduce((sum, s) => sum + s.r, 0) / systems.length) * SCALE;
}

const SHELL_RINGS = ["inner", "middle", "outer"].map((shell) => ({ shell, r: meanRadius(shell) }));

// The photo sky shows through the map, so only the faint shell guide rings are drawn.
export function MapBackdrop() {
  return (
    <g className="map-bg">
      {SHELL_RINGS.map((ring) => (
        <circle key={ring.shell} className={`shell-ring ${ring.shell}`} r={ring.r} />
      ))}
    </g>
  );
}
