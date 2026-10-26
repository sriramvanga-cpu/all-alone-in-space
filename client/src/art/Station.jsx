// The orbital station at the centre of the chart. Gradients are in StationDefs,
// rendered once with the map's other defs.

const BAYS = [0, 60, 120, 180, 240, 300];

export function StationDefs() {
  return (
    <defs>
      <radialGradient id="station-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.3" stopColor="#ffc880" stopOpacity="0.3" />
        <stop offset="0.65" stopColor="#ff9a50" stopOpacity="0.1" />
        <stop offset="1" stopColor="#ff9a50" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="station-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f6efe0" />
        <stop offset="0.45" stopColor="#9fa9bb" />
        <stop offset="0.7" stopColor="#5a6680" />
        <stop offset="1" stopColor="#dfe6f2" />
      </linearGradient>
      <radialGradient id="station-core" cx="0.4" cy="0.38" r="0.7">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.5" stopColor="#ffe2a8" />
        <stop offset="1" stopColor="#ff9a3c" />
      </radialGradient>
      <radialGradient id="station-corona" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff2d0" stopOpacity="0.85" />
        <stop offset="1" stopColor="#ffb060" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

export function Starbase(props) {
  const { className, ...rest } = props;
  return (
    <svg
      className={className ? `starbase ${className}` : "starbase"}
      viewBox="-40 -40 80 80"
      aria-hidden="true"
      {...rest}
    >
      <circle className="halo" r="39" />
      <g className="spin">
        {BAYS.map((deg) => (
          <line key={deg} className="spoke" x1="5" y1="0" x2="27" y2="0" transform={`rotate(${deg})`} />
        ))}
        <circle className="hull-ring outer" r="28" />
        <circle className="rim" r="26.4" />
        <circle className="hull-ring inner" r="17" />
        {BAYS.map((deg) => (
          <g key={deg} transform={`rotate(${deg}) translate(28 0)`}>
            <rect className="module" x="-3.4" y="-2.8" width="6.8" height="5.6" rx="1.5" />
            <rect className="window" x="-1.7" y="-1.1" width="3.4" height="2.2" rx="0.6" />
          </g>
        ))}
      </g>
      <circle className="corona" r="12" />
      <circle className="core" r="5.4" />
    </svg>
  );
}
