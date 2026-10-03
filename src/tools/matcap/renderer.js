// Matcap shader on three.js. The sphere is computed per pixel in a fragment shader:
// each pixel's normal is lit in linear space and converted to sRGB at the end, with
// 4 samples per pixel and exact edge coverage. The same material draws the on-screen
// sphere, the preset thumbnails, the texture for the model preview and the exported file,
// so they always match.
import * as THREE from 'three';

const MAX_LIGHTS = 4;

const VERTEX = /* glsl */ `
in vec3 position;
out vec2 vP;
void main() { vP = position.xy; gl_Position = vec4(position.xy, 0., 1.); }`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vP;
out vec4 outColor;
#define PI 3.14159265

uniform float uPx;                 // size of one pixel in sphere units (2 / size)
uniform int uMode;                 // 0 shaded, 1 normal
uniform vec3 uBase, uSky, uGround, uScatterCol, uSpecCol, uRimCol, uOutlineCol, uStripeCol, uBg, uShadowCol;
uniform float uAmbient, uScatter, uSpec, uExponent, uRefl, uBlur, uMetal, uEnvRot, uRim, uRimPow;
uniform float uToon, uSteps, uToonSoft, uOutline, uStripes, uStripeAngle, uStripeWidth;
uniform float uExposure, uContrast, uSaturation, uGrain, uEdgeLight, uEdgeShadow;
uniform int uBgMode;               // 0 transparent, 1 solid color, 2 extend edge colors
uniform float uLinearOut;          // 1 when drawing into an sRGB texture, which encodes on write
uniform int uEnv, uLights;
uniform vec3 uLightDir[${MAX_LIGHTS}], uLightCol[${MAX_LIGHTS}];
uniform float uLightWrap[${MAX_LIGHTS}];

float toonStep(float d) {
  if (uToon < .5) return d;
  float x = d * uSteps, i = floor(x), e = uToonSoft * .5 + .002;
  return min(1., (i + smoothstep(.5 - e, .5 + e, x - i)) / uSteps);
}

// Procedural environments for reflections; blur widens every edge.
vec3 env(vec3 d) {
  float b = uBlur * .9 + .004;
  vec3 col;
  if (uEnv == 0) {                 // studio: dark room, every light is a soft round softbox
    col = mix(vec3(.015), vec3(.22), smoothstep(-.5 - b, .9 + b, d.y));
    col += vec3(.12) * (1. - smoothstep(0., .18 + b, abs(d.y + .05)));   // soft horizon glow
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLights) break;
      float rad = .14 + .4 * uLightWrap[i];
      col += uLightCol[i] * 2.5 * smoothstep(cos(rad + b), cos(max(rad - b, 0.)), dot(d, uLightDir[i]));
    }
  } else {
    float c = cos(uEnvRot), s = sin(uEnvRot);
    d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
    if (uEnv == 1) {               // sky: blue sky, warm ground, sun
      vec3 sky = mix(vec3(.72, .82, .95), vec3(.16, .32, .72), smoothstep(0., .9, d.y));
      vec3 ground = mix(vec3(.10, .08, .06), vec3(.32, .26, .2), smoothstep(-.9, 0., d.y));
      float sun = dot(d, normalize(vec3(.55, .55, .63)));
      col = mix(ground, sky, smoothstep(-b * .5, b * .5, d.y)) + vec3(6., 5.4, 4.4) * smoothstep(.996 - b * .4, 1. - b * .2, sun);
    } else {                       // horizon: classic chrome
      vec3 top = mix(vec3(1.), vec3(.5), smoothstep(0., 1., d.y));
      vec3 bottom = mix(vec3(.05), vec3(0.), smoothstep(0., -1., d.y));
      col = mix(bottom, top, smoothstep(-b * .5, b * .5, d.y));
    }
  }
  return col;
}

vec3 shade(vec2 p) {
  float rr = length(p);
  if (rr > .9997) p *= .9997 / rr;   // outside the disc: keep the edge normal (no dark fringe)
  vec3 N = vec3(p, sqrt(max(0., 1. - dot(p, p))));
  if (uMode == 1) return N * .5 + .5;
  const vec3 V = vec3(0., 0., 1.);
  float NV = N.z;
  vec3 R = 2. * NV * N - V;

  vec3 albedo = uBase;
  if (uStripes > 0.) {
    vec2 dir = vec2(cos(uStripeAngle), sin(uStripeAngle));
    float t = dot(N.xy, dir) * uStripes * .5;
    float g = abs(fract(t) - .5) * 2., aa = fwidth(t) * 2. + 1e-4;
    albedo = mix(albedo, uStripeCol, smoothstep(1. - uStripeWidth - aa, 1. - uStripeWidth + aa, g));
  }

  vec3 diff = vec3(0.), spec = vec3(0.), sss = vec3(0.);
  float e = uToonSoft * .5 + .002;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLights) break;
    vec3 L = uLightDir[i], C = uLightCol[i];
    float ndl = dot(N, L), w = uLightWrap[i];
    diff += C * toonStep(clamp((ndl + w) / (1. + w), 0., 1.));
    sss += C * smoothstep(-.55 - w * .4, 0., ndl) * (1. - smoothstep(0., .55, ndl));
    vec3 H = (L + V) / max(length(L + V), 1e-4);
    float sh = pow(max(dot(N, H), 0.), uExponent) * smoothstep(-.15, .25, ndl);
    if (uToon > .5) sh = smoothstep(.5 - e, .5 + e, sh);
    spec += C * sh;
  }
  vec3 amb = mix(uGround, uSky, N.y * .5 + .5) * uAmbient;
  vec3 col = albedo * (diff + amb) * (1. - uMetal) + uScatterCol * sss * uScatter;
  col += spec * uSpec * uSpecCol * mix(vec3(1.), albedo, uMetal);
  vec3 F0 = mix(vec3(.06), albedo, uMetal);
  col += env(R) * (F0 + (1. - F0) * pow(1. - NV, 5.)) * uRefl;
  col = mix(col, uRimCol, clamp(pow(1. - NV, uRimPow) * uRim, 0., 1.));
  col *= 1. + uEdgeLight * smoothstep(.95, .985, rr);   // thin light band along the edge
  if (uOutline > 0.) col = mix(col, uOutlineCol, smoothstep(1. - uOutline - uPx, 1. - uOutline + uPx, rr));
  return col;
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c));
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  // 4 samples per pixel, averaged in linear space
  vec3 acc = shade(vP + vec2(-.375, -.125) * uPx) + shade(vP + vec2(.125, -.375) * uPx)
           + shade(vP + vec2(.375, .125) * uPx) + shade(vP + vec2(-.125, .375) * uPx);
  vec3 c = acc * .25;
  if (uMode == 0) {
    c = toSRGB(clamp(c * exp2(uExposure), 0., 1.));
    c = (c - .5) * (1. + uContrast) + .5;
    c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, uSaturation);
    c += (hash(gl_FragCoord.xy) - .5) * uGrain * .16;
  }
  c = clamp(c, 0., 1.);
  if (uLinearOut > .5) c = toLinear(c);
  float a = clamp((1. - length(vP)) / uPx + .5, 0., 1.);   // exact edge coverage
  // Outside the disc shade() keeps the edge normal, so "extend" is a radial dilation of the edge colors.
  // Edge shadow: a dark contour hugging the sphere that fades into the extended background.
  float shadow = uEdgeShadow * exp(-max(length(vP) - 1., 0.) / .03);
  outColor = uBgMode == 2 ? vec4(mix(mix(c, uShadowCol, shadow), c, a), 1.) : uBgMode == 1 ? vec4(mix(uBg, c, a), 1.) : vec4(c, a);
}`;

/* ── Color ── */
export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, n >> 8 & 255, n & 255].map(v => {
    v /= 255;
    return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
  });
}
const hexToSRGB = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// Light position on the sphere (x, y in the unit disc) marks where its highlight appears.
// The light direction is the view vector reflected about the normal at that point.
export function lightDir(x, y) {
  const r2 = x * x + y * y, k = r2 > 1 ? 1 / Math.sqrt(r2) : 1;
  const nx = x * k, ny = y * k, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return [2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1];
}

const BG_MODES = { transparent: 0, color: 1, extend: 2 };

// Draws matcaps with a three.js WebGLRenderer (shared with the model viewer).
export function createMatcapPainter(renderer) {
  const vec3 = () => new THREE.Vector3();
  const uniforms = {
    uPx: { value: 1 }, uMode: { value: 0 }, uEnv: { value: 0 }, uLights: { value: 0 }, uBgMode: { value: 0 },
    uLightDir: { value: Array.from({ length: MAX_LIGHTS }, vec3) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, vec3) },
    uLightWrap: { value: new Array(MAX_LIGHTS).fill(0) },
  };
  for (const k of ['uBase', 'uSky', 'uGround', 'uScatterCol', 'uSpecCol', 'uRimCol', 'uOutlineCol', 'uStripeCol', 'uBg', 'uShadowCol']) uniforms[k] = { value: vec3() };
  for (const k of ['uAmbient', 'uScatter', 'uSpec', 'uExponent', 'uRefl', 'uBlur', 'uMetal', 'uEnvRot', 'uRim', 'uRimPow',
    'uToon', 'uSteps', 'uToonSoft', 'uOutline', 'uStripes', 'uStripeAngle', 'uStripeWidth',
    'uExposure', 'uContrast', 'uSaturation', 'uGrain', 'uEdgeLight', 'uEdgeShadow', 'uLinearOut']) uniforms[k] = { value: 0 };

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms,
    depthTest: false, depthWrite: false, transparent: false, blending: THREE.NoBlending,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene().add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function setParams(s) {
    const u = uniforms, lin = (k, hex) => u[k].value.fromArray(hexToLinear(hex));
    u.uMode.value = s.mode === 'normal' ? 1 : 0;
    lin('uBase', s.base); lin('uSky', s.sky); lin('uGround', s.ground); lin('uScatterCol', s.scatterColor);
    lin('uSpecCol', s.specColor); lin('uRimCol', s.rimColor); lin('uOutlineCol', s.outlineColor); lin('uStripeCol', s.stripeColor);
    u.uBg.value.fromArray(hexToSRGB(s.bgColor));
    u.uShadowCol.value.fromArray(hexToSRGB(s.edgeShadowColor || '#000000'));
    u.uBgMode.value = BG_MODES[s.bg] ?? 0;
    u.uAmbient.value = s.ambient; u.uScatter.value = s.scatter; u.uSpec.value = s.spec;
    const a = Math.max(.04, s.roughness) ** 2;               // Blinn-Phong exponent matching GGX roughness
    u.uExponent.value = 2 / (a * a) - 2;
    u.uRefl.value = s.refl; u.uBlur.value = s.blur; u.uMetal.value = s.metal; u.uEnvRot.value = s.envRot * Math.PI / 180;
    u.uEnv.value = { studio: 0, sky: 1, horizon: 2 }[s.env] ?? 0;
    u.uRim.value = s.rim; u.uRimPow.value = 8 - s.rimWidth * 7.2;
    u.uToon.value = s.toon ? 1 : 0; u.uSteps.value = s.steps; u.uToonSoft.value = s.toonSoft;
    u.uOutline.value = s.outline; u.uStripes.value = s.stripes;
    u.uStripeAngle.value = s.stripeAngle * Math.PI / 180; u.uStripeWidth.value = s.stripeWidth;
    u.uEdgeLight.value = s.edgeLight ?? 0; u.uEdgeShadow.value = s.edgeShadow ?? 0;
    u.uExposure.value = s.exposure; u.uContrast.value = s.contrast; u.uSaturation.value = s.saturation; u.uGrain.value = s.grain;
    const lights = s.lights.slice(0, MAX_LIGHTS);
    u.uLights.value = lights.length;
    lights.forEach((l, i) => {
      u.uLightDir.value[i].fromArray(lightDir(l.x, l.y));
      u.uLightCol.value[i].fromArray(hexToLinear(l.color)).multiplyScalar(l.intensity);
      u.uLightWrap.value[i] = l.softness;
    });
  }

  // Draws into `target` (a render target, or null for the canvas) that is `size` pixels wide.
  function draw(s, target, size) {
    setParams(s);
    uniforms.uPx.value = 2 / size;
    uniforms.uLinearOut.value = target?.texture.colorSpace === THREE.SRGBColorSpace ? 1 : 0;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
  }

  // srgb: an SRGB8_ALPHA8 texture for sampling (filtering happens in linear space);
  // otherwise plain RGBA8 that stores the output bytes as they are (for reading back).
  function makeTarget(size, { srgb = false } = {}) {
    const t = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    if (srgb) t.texture.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // RGBA bytes of a matcap, top row first.
  let readTarget = null;
  function read(s, size) {
    if (!readTarget || readTarget.width !== size) { readTarget?.dispose(); readTarget = makeTarget(size); }
    draw(s, readTarget, size);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(readTarget, 0, 0, size, size, px);
    const row = size * 4, tmp = new Uint8Array(row);           // GL rows go bottom-up
    for (let y = 0; y < size >> 1; y++) {
      const a = y * row, b = (size - 1 - y) * row;
      tmp.set(px.subarray(a, a + row)); px.copyWithin(a, b, b + row); px.set(tmp, b);
    }
    return px;
  }

  return { draw, read, makeTarget, maxSize: renderer.capabilities.maxTextureSize };
}
