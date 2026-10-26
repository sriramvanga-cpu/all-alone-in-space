import { NODES } from "../game/map.js";
import { ShipDefs } from "./Ship.jsx";
import { StationDefs } from "./Station.jsx";

// Shared defs and backdrop for the star chart. Scale matches App.jsx's SCALE.
const SCALE = 190;

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
      <ShipDefs />
      <StationDefs />
    </defs>
  );
}

function meanRadius(shell) {
  const worlds = NODES.filter((n) => n.shell === shell);
  return (worlds.reduce((sum, n) => sum + n.r, 0) / worlds.length) * SCALE;
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
