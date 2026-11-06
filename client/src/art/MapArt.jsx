import { memo } from "react";
import { JUMP_R, SYSTEMS, TILT, ringLabelAngle } from "../game/map.js";
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
  giant: ["#ffe2c8", "#ff8a4c", "#a8341c"],
  dwarf: ["#ffffff", "#eaf3ff", "#a9c8ff"],
  neutron: ["#ffffff", "#cfe6ff", "#7fb0ff"],
};
const TINTS = Object.keys(STAR_TINTS);

export const STAR_NAMES = {
  yellow: "yellow star",
  orange: "orange star",
  red: "red dwarf",
  blue: "blue star",
  giant: "red giant",
  dwarf: "white dwarf",
  neutron: "neutron star",
  hole: "black hole",
  binary: "binary star",
};
const KIND_SIZE = { giant: 1.2, dwarf: 0.45 };

// The planetary map's look, shared with the warp shots that must match it: the sun's radius, how much
// bigger planets are drawn than on the old chart (phones draw them at 2), and the phone breakpoint.
export const SUN_R = 40;
export const PLANET_ZOOM = 1.2;
export const NARROW = "(max-width: 560px)";

/** The planetary map's view box for a system whose outer orbit is `reach`: the jump point on the left,
 * the outer orbit with its labels on the right. Phones draw planets bigger, so labels need wider margins. */
export function systemBox(reach, narrow) {
  return narrow
    ? [-JUMP_R - 40, -reach * TILT - 105, JUMP_R + reach + 180, 2 * reach * TILT + 165]
    : [-JUMP_R - 40, -reach * TILT - 65, JUMP_R + reach + 120, 2 * reach * TILT + 115];
}

// The fuel-stop badge: a drop, filled from MapDefs' fuel-drop gradient.
export const DROP = "M0 -4.8C2.7 -1 4 1 4 2.7A4 4 0 0 1 -4 2.7C-4 1 -2.7 -1 0 -4.8Z";

/** A lane's fuel or a hop's power, as a pill centred on (x, y). */
export function CostPill({ text, x, y, power = false, short = false, big = false }) {
  const w = big ? 18 + text.length * 10 : 14 + text.length * 7;
  const h = big ? 26 : 18;
  const cls = ["cost", "hot", power ? "power" : "", short ? "short" : "", big ? "big" : ""].filter(Boolean).join(" ");
  return (
    <g className={cls} transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
      <text y={big ? 5.5 : 4} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

// In unit space. Corona: thin streamers of uneven length, blurred soft. Spikes: the sparkle of a
// distant star. Beams: a pulsar's two cones of light.
const RAYS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * 2 * Math.PI + ((i * 5) % 3) * 0.06;
  const len = 1.45 + ((i * 7) % 6) * 0.2;
  const at = (angle, d) => `${(Math.cos(angle) * d).toFixed(3)} ${(Math.sin(angle) * d).toFixed(3)}`;
  return `M${at(a - 0.07, 0.9)}L${at(a, len)}L${at(a + 0.07, 0.9)}Z`;
}).join("");
const SPIKES = "M-2.2 0H2.2M0 -2.2V2.2";
const BEAMS = "M0 0L-0.32 -3.2L0.32 -3.2ZM0 0L-0.32 3.2L0.32 3.2Z";

function Ball({ tint, r }) {
  return (
    <>
      <circle r={r * 2.6} fill={`url(#star-${tint}-glow)`} />
      <circle r={r} fill={`url(#star-${tint})`} />
    </>
  );
}

/** A system's star (`kind` from map.js). Small on the star map; with `sun`, big at the centre of a planetary map. */
function StarDotImpl({ kind, r, sun = false }) {
  if (kind === "hole") {
    // A black disc rimmed with light, inside a tilted disk of glowing gas.
    return (
      <g className="star" aria-hidden="true">
        <circle r={r * 3} fill="url(#hole-glow)" />
        <ellipse className="disk haze" rx={r * 1.7} ry={r * 1.7 * TILT} strokeWidth={r * 0.8} />
        <ellipse className="disk" rx={r * 1.7} ry={r * 1.7 * TILT} strokeWidth={r * 0.28} />
        <circle r={r * 0.8} fill="#000" />
        <circle className="photon" r={r * 0.86} strokeWidth={r * 0.08} />
      </g>
    );
  }
  if (kind === "binary") {
    return (
      <g className="star" aria-hidden="true">
        <g className="pair">
          {/* Keeps the pair's box centred, so it turns about the middle. */}
          <circle r={r * 2.6} fill="none" />
          <g transform={`translate(${-r * 0.7} 0)`}>
            <Ball tint="yellow" r={r * 0.6} />
          </g>
          <g transform={`translate(${r * 0.8} 0)`}>
            <Ball tint="blue" r={r * 0.45} />
          </g>
        </g>
      </g>
    );
  }
  if (kind === "neutron") {
    return (
      <g className="star" aria-hidden="true">
        <circle r={r * 1.4} fill="url(#star-neutron-glow)" />
        <Ball tint="neutron" r={r * 0.3} />
        <g transform={`scale(${r * (sun ? 1 : 0.75)})`}>
          <path className="beams" d={BEAMS} fill="url(#star-beam)" />
        </g>
      </g>
    );
  }
  const size = r * (KIND_SIZE[kind] ?? 1);
  return (
    <g className="star" aria-hidden="true">
      <circle className="star-glow" r={size * (sun ? 3.2 : 2.6)} fill={`url(#star-${kind}-glow)`} />
      {sun ? (
        <g transform={`scale(${size})`}>
          <path className="rays" d={RAYS} fill="url(#star-ray)" filter="url(#star-soft)" opacity="0.6" />
        </g>
      ) : null}
      <circle r={size} fill={`url(#star-${kind})`} />
      {sun ? null : (
        <g transform={`scale(${size})`}>
          <path d={SPIKES} stroke="url(#star-ray)" strokeWidth="0.07" />
        </g>
      )}
    </g>
  );
}

export const StarDot = memo(StarDotImpl);

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
      {/* Rays, spikes and beams are drawn in unit space, so these gradients and the blur are too. */}
      <filter id="star-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.09" />
      </filter>
      <radialGradient id="star-ray" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="2.4">
        <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="star-beam" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="3.2">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#9cc8ff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="hole-disk" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff4d6" />
        <stop offset="0.35" stopColor="#ffb347" />
        <stop offset="0.7" stopColor="#d4541c" />
        <stop offset="1" stopColor="#8a2a10" stopOpacity="0.8" />
      </linearGradient>
      <radialGradient id="hole-glow">
        <stop offset="0.25" stopColor="#ff9a40" stopOpacity="0.35" />
        <stop offset="1" stopColor="#ff9a40" stopOpacity="0" />
      </radialGradient>
      <ShipDefs />
      <StationDefs />
    </defs>
  );
}

function meanRadius(ring) {
  const systems = SYSTEMS.filter((s) => s.ring === ring);
  return (systems.reduce((sum, s) => sum + s.r, 0) / systems.length) * SCALE;
}

const RING_WORDS = { inner: "Hard questions", middle: "Medium questions", outer: "Easy questions" };
const SHELL_RINGS = ["inner", "middle", "outer"].map((shell) => ({ shell, r: meanRadius(shell), a: ringLabelAngle(shell) }));

// The photo sky shows through the map, so only the faint shell guide rings and their labels are drawn.
export function MapBackdrop() {
  return (
    <g className="map-bg">
      {SHELL_RINGS.map((ring) => (
        <circle key={ring.shell} className={`shell-ring ${ring.shell}`} r={ring.r} />
      ))}
      {SHELL_RINGS.map((ring) => (
        <text
          key={`${ring.shell}-label`}
          className={`shell-label ${ring.shell}`}
          x={Math.round(ring.r * Math.cos(ring.a))}
          y={Math.round(ring.r * Math.sin(ring.a))}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {RING_WORDS[ring.shell]}
        </text>
      ))}
    </g>
  );
}
