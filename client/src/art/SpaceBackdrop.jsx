// Fixed deep-space backdrop shared by every screen. Pure CSS: a nebula wash,
// a faint galactic band, and three star layers that drift at different speeds.
// Stars are seeded box-shadows, so the field is identical on every load.

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Each star is written twice, 100vh apart, so a 100vh drift loops without a seam.
function starShadows(seed, count, palette, glow) {
  const rand = lcg(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() * 100).toFixed(2);
    const y = rand() * 100;
    const color = palette[Math.floor(rand() * palette.length)];
    out.push(`${x}vw ${y.toFixed(2)}vh ${glow} ${color}`);
    out.push(`${x}vw ${(y + 100).toFixed(2)}vh ${glow} ${color}`);
  }
  return out.join(",");
}

const COOL = ["rgba(255,255,255,.9)", "rgba(207,224,255,.8)", "rgba(170,200,255,.7)"];
const WARM = ["rgba(255,227,194,.85)", "rgba(255,255,255,.9)", "rgba(190,215,255,.85)"];

const FAR = starShadows(0x5eed, 90, COOL, "0");
const MID = starShadows(0xa11c, 38, WARM, "0");
const NEAR = starShadows(0x7c0d, 14, WARM, "0 0 5px 1px");

export default function SpaceBackdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="band" />
      <div className="stars far" style={{ boxShadow: FAR }} />
      <div className="stars mid" style={{ boxShadow: MID }} />
      <div className="stars near" style={{ boxShadow: NEAR }} />
      <div className="vignette" />
    </div>
  );
}
