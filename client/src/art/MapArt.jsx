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
      <radialGradient id="neb-violet" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#7a5cff" stopOpacity="0.3" />
        <stop offset="0.55" stopColor="#5a3ed0" stopOpacity="0.12" />
        <stop offset="1" stopColor="#5a3ed0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neb-teal" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#2ec8c0" stopOpacity="0.24" />
        <stop offset="0.55" stopColor="#1a8aa0" stopOpacity="0.1" />
        <stop offset="1" stopColor="#1a8aa0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neb-rose" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ff5a9a" stopOpacity="0.2" />
        <stop offset="0.55" stopColor="#b02a78" stopOpacity="0.08" />
        <stop offset="1" stopColor="#b02a78" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="neb-amber" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffb060" stopOpacity="0.16" />
        <stop offset="1" stopColor="#ffb060" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="fuel-drop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe08a" />
        <stop offset="1" stopColor="#ff8a1f" />
      </linearGradient>
      <ShipDefs />
      <StationDefs />
    </defs>
  );
}

function starfield() {
  let s = 0x51a7;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const tints = ["#f4f7ff", "#cfe0ff", "#ffe9cf", "#bcd4ff"];
  const stars = [];
  for (let i = 0; i < 280; i++) {
    const bright = rand() < 0.08;
    stars.push({
      x: Math.round((rand() - 0.5) * 2600),
      y: Math.round((rand() - 0.5) * 2400),
      r: bright ? 1.4 + rand() * 1.4 : 0.28 + rand() * 0.6,
      o: bright ? 0.8 + rand() * 0.2 : 0.22 + rand() * 0.45,
      c: tints[Math.floor(rand() * tints.length)],
      bright,
    });
  }
  return stars;
}

const STARS = starfield();

// Soft nebula clouds, drawn as radial-gradient ellipses (no blur filter), so the
// chart has colour and depth behind the worlds.
const CLOUDS = [
  { id: "neb-violet", x: -520, y: -240, rx: 760, ry: 300, rot: -16 },
  { id: "neb-teal", x: 640, y: 380, rx: 640, ry: 260, rot: 14 },
  { id: "neb-rose", x: 260, y: -560, rx: 520, ry: 240, rot: 28 },
  { id: "neb-violet", x: -180, y: 620, rx: 560, ry: 220, rot: -8 },
  { id: "neb-amber", x: 60, y: 40, rx: 420, ry: 420, rot: 0 },
  { id: "neb-teal", x: -760, y: 560, rx: 420, ry: 200, rot: 32 },
];

function meanRadius(shell) {
  const worlds = NODES.filter((n) => n.shell === shell);
  return (worlds.reduce((sum, n) => sum + n.r, 0) / worlds.length) * SCALE;
}

const SHELL_RINGS = ["inner", "middle", "outer"].map((shell) => ({ shell, r: meanRadius(shell) }));

export function MapBackdrop() {
  return (
    <g className="map-bg">
      {CLOUDS.map((c, i) => (
        <ellipse
          key={i}
          cx={c.x}
          cy={c.y}
          rx={c.rx}
          ry={c.ry}
          fill={`url(#${c.id})`}
          transform={`rotate(${c.rot} ${c.x} ${c.y})`}
        />
      ))}
      {SHELL_RINGS.map((ring) => (
        <circle key={ring.shell} className={`shell-ring ${ring.shell}`} r={ring.r} />
      ))}
      {STARS.map((star, i) => (
        <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={star.c} opacity={star.o} />
      ))}
      {STARS.filter((star) => star.bright).map((star, i) => (
        <path
          key={`f${i}`}
          className="flare"
          d={`M${star.x - 6} ${star.y}H${star.x + 6}M${star.x} ${star.y - 6}V${star.y + 6}`}
          stroke={star.c}
          opacity={star.o * 0.45}
        />
      ))}
    </g>
  );
}
