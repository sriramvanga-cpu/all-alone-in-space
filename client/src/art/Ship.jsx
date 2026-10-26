// The player's ship. Geometry is in ship units; the saucer centre sits at SAUCER_X
// so a flight path can be followed from the saucer, not the ship's origin.
// Gradients live in ShipDefs: render it once wherever the ship is drawn.

export const SAUCER_X = 11.4;

export function ShipDefs() {
  return (
    <defs>
      <radialGradient id="ship-aura" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#8cc8ff" stopOpacity="0.34" />
        <stop offset="0.55" stopColor="#5a9cf0" stopOpacity="0.12" />
        <stop offset="1" stopColor="#5a9cf0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ship-saucer" cx="0.36" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.5" stopColor="#dbe5f4" />
        <stop offset="1" stopColor="#7d91b2" />
      </radialGradient>
      <radialGradient id="ship-shade" cx="0.36" cy="0.3" r="0.85">
        <stop offset="0.5" stopColor="#06102a" stopOpacity="0" />
        <stop offset="1" stopColor="#06102a" stopOpacity="0.55" />
      </radialGradient>
      <linearGradient id="ship-hull" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eef3fb" />
        <stop offset="0.5" stopColor="#b3c1d8" />
        <stop offset="1" stopColor="#6c809f" />
      </linearGradient>
      <linearGradient id="ship-nacelle" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eef3fb" />
        <stop offset="0.45" stopColor="#aebdd3" />
        <stop offset="1" stopColor="#5b7090" />
      </linearGradient>
      <linearGradient id="ship-warp" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#3fb4ff" stopOpacity="0.2" />
        <stop offset="0.65" stopColor="#8fdcff" />
        <stop offset="1" stopColor="#ffffff" />
      </linearGradient>
      <radialGradient id="ship-bussard" cx="0.4" cy="0.4" r="0.7">
        <stop offset="0" stopColor="#ffd9c0" />
        <stop offset="0.55" stopColor="#ff6a46" />
        <stop offset="1" stopColor="#8a1c10" />
      </radialGradient>
      <linearGradient id="ship-trail" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8fd8ff" stopOpacity="0" />
        <stop offset="1" stopColor="#d8f4ff" stopOpacity="0.95" />
      </linearGradient>
    </defs>
  );
}

export function ShipShapes() {
  const cx = SAUCER_X;
  const grid = [-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return `M${(cx + c * 1.9).toFixed(2)} ${(s * 1.9).toFixed(2)}L${(cx + c * 6.3).toFixed(2)} ${(s * 6.3).toFixed(2)}`;
    })
    .join("");
  return (
    <>
      <ellipse className="aura" cx="2" cy="0" rx="19" ry="10.6" />
      <ellipse className="trail" cx="-20" cy="-8.16" rx="8.5" ry="0.7" />
      <ellipse className="trail" cx="-20" cy="8.16" rx="8.5" ry="0.7" />
      <ellipse className="plume" cx="-13.8" cy="-8.16" rx="3.2" ry="0.8" />
      <ellipse className="plume" cx="-13.8" cy="8.16" rx="3.2" ry="0.8" />
      <ellipse className="exhaust" cx="-11.9" cy="-8.16" rx="1.25" ry="0.62" />
      <ellipse className="exhaust" cx="-11.9" cy="8.16" rx="1.25" ry="0.62" />
      <rect className="nacelle" x="-11.4" y="-9.18" width="16" height="2.05" rx="1.02" />
      <rect className="nacelle" x="-11.4" y="7.13" width="16" height="2.05" rx="1.02" />
      <rect className="warp" x="-9.6" y="-8.5" width="12.4" height="0.7" rx="0.35" />
      <rect className="warp" x="-9.6" y="7.8" width="12.4" height="0.7" rx="0.35" />
      <circle className="cap" cx="4.15" cy="-8.16" r="0.9" />
      <circle className="cap" cx="4.15" cy="8.16" r="0.9" />
      <path className="pylon" d="M-0.2 -2.05L-2.6 -7.05L-5.6 -7.05L-2.6 -1.85Z" />
      <path className="pylon" d="M-0.2 2.05L-2.6 7.05L-5.6 7.05L-2.6 1.85Z" />
      <path className="hull" d="M9.2 0C8.2 1.9 3.2 2.75-1 2.5-5.4 2.2-8.4 1.35-10.6 0-8.4-1.35-5.4-2.2-1-2.5 3.2-2.75 8.2-1.9 9.2 0Z" />
      <path className="line" d="M6.6 0H-9.4M-4.2 -1.35V1.35" />
      <circle className="saucer" cx={cx} cy="0" r="7" />
      <circle className="shade" cx={cx} cy="0" r="7" />
      <path className="line" d={grid} />
      <circle className="line" cx={cx} cy="0" r="4.9" />
      <circle className="line" cx={cx} cy="0" r="2.7" />
      <ellipse className="impulse" cx="5.46" cy="-3.71" rx="1.25" ry="0.46" transform="rotate(-58 5.46 -3.71)" />
      <ellipse className="impulse" cx="5.46" cy="3.71" rx="1.25" ry="0.46" transform="rotate(58 5.46 3.71)" />
      <circle className="bridge" cx={cx + 2.1} cy="0" r="1.05" />
      <circle className="line" cx={cx + 2.1} cy="0" r="0.42" />
      <circle className="navlight red" cx={cx} cy="-6.45" r="0.34" />
      <circle className="navlight green" cx={cx} cy="6.45" r="0.34" />
    </>
  );
}

export function ShipSvg({ className }) {
  return (
    <svg className={className} viewBox="-24 -11 46 22" aria-hidden="true">
      <ShipDefs />
      <ShipShapes />
    </svg>
  );
}
