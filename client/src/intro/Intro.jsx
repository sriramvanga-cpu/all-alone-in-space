import { lazy, Suspense, useState } from "react";
import { webglAvailable } from "../three/artStore.js";
import ClassicIntro from "./ClassicIntro.jsx";

// three.js only loads when the 3D intro is actually shown.
const Intro3D = lazy(() => import("./Intro3D.jsx"));

// Plays the realistic 3D intro, and falls back to the 2D one if WebGL or the
// textures are not available on this machine.
export default function Intro({ onDone }) {
  const [classic, setClassic] = useState(() => !webglAvailable());
  if (classic) return <ClassicIntro onDone={onDone} />;
  return (
    <Suspense fallback={<main className="opener"><p className="intro-loading">Preparing launch…</p></main>}>
      <Intro3D onDone={onDone} onFail={() => setClassic(true)} />
    </Suspense>
  );
}
