import { useSyncExternalStore } from "react";

// Rendered map art (planet, ship and station images) published once ready, and
// a WebGL check. Kept free of three.js so the main bundle does not load it.

let art = { planets: new Map(), ship: null, station: null };
const listeners = new Set();

export function publishArt(next) {
  art = { ...art, ...next };
  for (const l of listeners) l();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useArt() {
  return useSyncExternalStore(subscribe, () => art);
}

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
