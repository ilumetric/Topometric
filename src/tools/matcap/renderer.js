// WebGL2 renderer for the MatCap Generator.
// The matcap is computed per pixel in a fragment shader: a sphere seen from the front,
// where each pixel's normal is lit in linear space and converted to sRGB at the end.
// The same shader draws the on-screen sphere, the preset thumbnails and the exported file,
// so the preview and the saved PNG match.
import { MESHES } from './meshes.js';

const MAX_LIGHTS = 4;

const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vP;
void main() { vP = aPos; gl_Position = vec4(aPos, 0., 1.); }`;

const MATCAP_FS = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 outColor;
#define PI 3.14159265

uniform float uPx;                 // size of one pixel in sphere units (2 / size)
uniform int uMode;                 // 0 shaded, 1 normal
uniform vec3 uBase, uSky, uGround, uScatterCol, uSpecCol, uRimCol, uOutlineCol, uStripeCol, uBg;
uniform float uAmbient, uScatter, uSpec, uExponent, uRefl, uBlur, uMetal, uEnvRot, uRim, uRimPow;
uniform float uToon, uSteps, uToonSoft, uOutline, uStripes, uStripeAngle, uStripeWidth;
uniform float uExposure, uContrast, uSaturation, uGrain, uOpaque;
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
  if (uEnv == 0) {                 // studio: dark room, every light is a soft round softbox
    vec3 col = mix(vec3(.015), vec3(.22), smoothstep(-.5 - b, .9 + b, d.y));
    col += vec3(.12) * (1. - smoothstep(0., .18 + b, abs(d.y + .05)));   // soft horizon glow
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLights) break;
      float rad = .14 + .4 * uLightWrap[i];
      col += uLightCol[i] * 2.5 * smoothstep(cos(rad + b), cos(max(rad - b, 0.)), dot(d, uLightDir[i]));
    }
    return col;
  }
  float c = cos(uEnvRot), s = sin(uEnvRot);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  if (uEnv == 1) {                 // sky: blue sky, warm ground, sun
    vec3 sky = mix(vec3(.72, .82, .95), vec3(.16, .32, .72), smoothstep(0., .9, d.y));
    vec3 ground = mix(vec3(.10, .08, .06), vec3(.32, .26, .2), smoothstep(-.9, 0., d.y));
    vec3 col = mix(ground, sky, smoothstep(-b * .5, b * .5, d.y));
    float sun = dot(d, normalize(vec3(.55, .55, .63)));
    return col + vec3(6., 5.4, 4.4) * smoothstep(.996 - b * .4, 1. - b * .2, sun);
  }
  vec3 top = mix(vec3(1.), vec3(.5), smoothstep(0., 1., d.y));   // horizon: classic chrome
  vec3 bottom = mix(vec3(.05), vec3(0.), smoothstep(0., -1., d.y));
  return mix(bottom, top, smoothstep(-b * .5, b * .5, d.y));
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
  if (uOutline > 0.) col = mix(col, uOutlineCol, smoothstep(1. - uOutline - uPx, 1. - uOutline + uPx, rr));
  return col;
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c));
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
  float a = clamp((1. - length(vP)) / uPx + .5, 0., 1.);   // exact edge coverage
  outColor = uOpaque > .5 ? vec4(mix(uBg, c, a), 1.) : vec4(c, a);
}`;

const MESH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
uniform mat4 uMVP;
uniform mat3 uNM;
out vec3 vN;
void main() { vN = uNM * aNor; gl_Position = uMVP * vec4(aPos, 1.); }`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec3 n = normalize(vN);
  outColor = vec4(texture(uTex, n.xy * .5 + .5).rgb, 1.);
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

/* ── Matrices (column-major) ── */
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function rotation(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Rx(pitch) * Ry(yaw)
  return [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1];
}

/* ── Renderer ── */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return null;

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc };
  }

  const matcap = compile(QUAD_VS, MATCAP_FS);
  const mesh = compile(MESH_VS, MESH_FS);

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const qa = gl.getAttribLocation(matcap.p, 'aPos');
  gl.enableVertexAttribArray(qa);
  gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);

  // Uniform values from tool parameters.
  function uniforms(s) {
    const u = matcap.loc, f = (k, v) => u[k] && gl.uniform1f(u[k], v), v3 = (k, v) => u[k] && gl.uniform3fv(u[k], v);
    gl.uniform1i(u.uMode, s.mode === 'normal' ? 1 : 0);
    v3('uBase', hexToLinear(s.base)); v3('uSky', hexToLinear(s.sky)); v3('uGround', hexToLinear(s.ground));
    v3('uScatterCol', hexToLinear(s.scatterColor)); v3('uSpecCol', hexToLinear(s.specColor));
    v3('uRimCol', hexToLinear(s.rimColor)); v3('uOutlineCol', hexToLinear(s.outlineColor));
    v3('uStripeCol', hexToLinear(s.stripeColor)); v3('uBg', hexToSRGB(s.bgColor));
    f('uAmbient', s.ambient); f('uScatter', s.scatter); f('uSpec', s.spec);
    const a = Math.max(.04, s.roughness) ** 2;               // Blinn-Phong exponent matching GGX roughness
    f('uExponent', 2 / (a * a) - 2);
    f('uRefl', s.refl); f('uBlur', s.blur); f('uMetal', s.metal); f('uEnvRot', s.envRot * Math.PI / 180);
    gl.uniform1i(u.uEnv, { studio: 0, sky: 1, horizon: 2 }[s.env] ?? 0);
    f('uRim', s.rim); f('uRimPow', 8 - s.rimWidth * 7.2);
    f('uToon', s.toon ? 1 : 0); f('uSteps', s.steps); f('uToonSoft', s.toonSoft);
    f('uOutline', s.outline); f('uStripes', s.stripes); f('uStripeAngle', s.stripeAngle * Math.PI / 180); f('uStripeWidth', s.stripeWidth);
    f('uExposure', s.exposure); f('uContrast', s.contrast); f('uSaturation', s.saturation); f('uGrain', s.grain);
    f('uOpaque', s.bg === 'color' ? 1 : 0);
    const lights = s.lights.slice(0, MAX_LIGHTS);
    gl.uniform1i(u.uLights, lights.length);
    const dir = new Float32Array(MAX_LIGHTS * 3), col = new Float32Array(MAX_LIGHTS * 3), wrap = new Float32Array(MAX_LIGHTS);
    lights.forEach((l, i) => {
      dir.set(lightDir(l.x, l.y), i * 3);
      col.set(hexToLinear(l.color).map(c => c * l.intensity), i * 3);
      wrap[i] = l.softness;
    });
    gl.uniform3fv(u.uLightDir, dir); gl.uniform3fv(u.uLightCol, col); gl.uniform1fv(u.uLightWrap, wrap);
  }

  function drawMatcap(s, size, opts = {}) {
    gl.useProgram(matcap.p);
    uniforms(opts.opaqueEdge ? { ...s, bg: 'transparent' } : s);
    gl.uniform1f(matcap.loc.uPx, 2 / size);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Offscreen RGBA8 target, resized on demand.
  function target() {
    const t = { tex: gl.createTexture(), fb: gl.createFramebuffer(), size: 0 };
    t.resize = size => {
      if (t.size === size) return;
      t.size = size;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    return t;
  }
  const off = target();      // exports and thumbnails
  const tex = target();      // matcap texture for the model view

  // Renders into the offscreen target and returns RGBA bytes, top row first.
  function readMatcap(s, size) {
    off.resize(size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, off.fb);
    gl.viewport(0, 0, size, size);
    drawMatcap(s, size);
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const row = size * 4, tmp = new Uint8Array(row);                // GL rows go bottom-up
    for (let y = 0; y < size >> 1; y++) {
      const a = y * row, b = (size - 1 - y) * row;
      tmp.set(px.subarray(a, a + row)); px.copyWithin(a, b, b + row); px.set(tmp, b);
    }
    return px;
  }

  /* ── Model view ── */
  const meshes = {};
  function meshVao(name) {
    if (meshes[name]) return meshes[name];
    const m = MESHES[name]();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [attr, data] of [['aPos', m.positions], ['aNor', m.normals]]) {
      const loc = gl.getAttribLocation(mesh.p, attr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    return meshes[name] = { vao, count: m.indices.length };
  }

  let texKey = '';
  function drawModel(s, shape, yaw, pitch) {
    const key = JSON.stringify(s);
    if (key !== texKey) {                      // the model samples the matcap as a texture
      texKey = key;
      tex.resize(512);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
      gl.viewport(0, 0, 512, 512);
      drawMatcap(s, 512, { opaqueEdge: true });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(mesh.p);
    const rot = rotation(yaw, pitch);
    const view = mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3.6, 1], rot);
    gl.uniformMatrix4fv(mesh.loc.uMVP, false, mul(perspective(.6, canvas.width / canvas.height, .1, 20), view));
    gl.uniformMatrix3fv(mesh.loc.uNM, false, [rot[0], rot[1], rot[2], rot[4], rot[5], rot[6], rot[8], rot[9], rot[10]]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(mesh.loc.uTex, 0);
    const m = meshVao(shape);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
  }

  function drawSphere(s) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawMatcap(s, canvas.width);
  }

  return { gl, drawSphere, drawModel, readMatcap, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
}
