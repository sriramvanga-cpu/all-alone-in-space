import { useId } from "react";

// The departure rocket. Class names (hull, fin, port, flame) are driven by the
// intro's beat classes in styles.css, so the flame stays a single `.flame` group.
export function Rocket() {
  const uid = useId().replace(/:/g, "");
  const id = (name) => `${uid}-${name}`;
  return (
    <svg className="rocket" viewBox="-16 -30 32 60" aria-hidden="true">
      <defs>
        <linearGradient id={id("hull")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8fa3c2" />
          <stop offset="0.35" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#dbe5f4" />
          <stop offset="1" stopColor="#7b8eae" />
        </linearGradient>
        <linearGradient id={id("nose")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a8281c" />
          <stop offset="0.4" stopColor="#ff7a5a" />
          <stop offset="1" stopColor="#8a1c12" />
        </linearGradient>
        <linearGradient id={id("fin")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e1693f" />
          <stop offset="1" stopColor="#8a2a16" />
        </linearGradient>
        <radialGradient id={id("port")} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#e8f8ff" />
          <stop offset="0.45" stopColor="#5ec0ff" />
          <stop offset="1" stopColor="#0f3a78" />
        </radialGradient>
        <linearGradient id={id("fire")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#bfe8ff" />
          <stop offset="1" stopColor="#4a8cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("fire2")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a0" />
          <stop offset="0.5" stopColor="#ff8a3c" />
          <stop offset="1" stopColor="#ff4a1c" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("glow")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff8a3c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="flame">
        <ellipse cx="0" cy="24" rx="11" ry="14" fill={`url(#${id("glow")})`} />
        <path d="M-5.2 16 Q0 40 5.2 16 Z" fill={`url(#${id("fire2")})`} />
        <path d="M-3 16 Q0 31 3 16 Z" fill={`url(#${id("fire")})`} />
      </g>
      <path className="fin" d="M-6.6 4 L-15.5 21 L-7 16.4 Z" fill={`url(#${id("fin")})`} />
      <path className="fin" d="M6.6 4 L15.5 21 L7 16.4 Z" fill={`url(#${id("fin")})`} />
      <path d="M-2.2 8 L0 20 L2.2 8Z" fill={`url(#${id("fin")})`} />
      <path d="M-4 14 L-3 17.5 L3 17.5 L4 14Z" fill="#46526b" />
      <path className="hull" d="M0 -26 C5.2 -20 8 -7 8 14 L-8 14 C-8 -7 -5.2 -20 0 -26Z" fill={`url(#${id("hull")})`} />
      <path d="M0 -26 C2.6 -23.4 4.4 -19.6 5.4 -14.4 L-5.4 -14.4 C-4.4 -19.6 -2.6 -23.4 0 -26Z" fill={`url(#${id("nose")})`} />
      <rect x="-8" y="6.2" width="16" height="2.2" fill="#c2412a" opacity="0.9" />
      <circle className="port" cx="0" cy="-4" r="3.1" fill={`url(#${id("port")})`} stroke="#5d6f8d" strokeWidth="0.8" />
      <ellipse cx="-0.9" cy="-5" rx="0.9" ry="0.55" fill="#fff" opacity="0.8" />
    </svg>
  );
}
