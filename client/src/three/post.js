import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Film look applied after tone mapping: a little lens fringing toward the edges,
// vignette, grain, and two full-screen fades (black for the start and end,
// bright glass for flying through the bridge window).
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.025 },
    uVignette: { value: 0.9 },
    uFringe: { value: 0.0007 },
    uBlack: { value: 0 },
    uWhite: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFringe;
    uniform float uBlack;
    uniform float uWhite;
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * uFringe * r2 * 40.0).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * uFringe * r2 * 40.0).b;
      col *= 1.0 - r2 * uVignette;
      col += (rnd(vUv * 913.0) - 0.5) * uGrain;
      vec3 glass = mix(vec3(0.62, 0.8, 0.98), vec3(0.95, 0.98, 1.0), 1.0 - r2 * 2.0);
      col = mix(col, glass, uWhite);
      col = mix(col, vec3(0.008, 0.01, 0.02), uBlack);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createComposer(renderer, scene, camera) {
  // Half-float HDR target with 4x MSAA so bloom has headroom and hull edges stay smooth.
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(buffer.x, buffer.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera);
  composer.addPass(render);
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.75, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);
  return { composer, render, bloom, film };
}
