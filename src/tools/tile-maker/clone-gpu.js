/* Clone brush on the GPU, for drawing at the speed of the pointer.
   The same strokes are applied again by the worker (applyStrokes) when the file is
   saved, with the same math: each stroke's dabs make one mask (their maximum), then the
   stroke is laid over the image, copying from the image as it was before any stroke,
   shifted by the stroke's offset. Everything wraps around the tile edges.

   Textures: pre (worker result), accum (pre + finished strokes), view (accum + the stroke
   being drawn; what the viewer shows), mask (one stroke). */

const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  gl_Position = vec4(p, 0., 1.);
}`;
const HEAD = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
`;
const FS_COPY = HEAD + `
uniform sampler2D uSrc;
void main() { o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`;
const FS_DAB = HEAD + `
uniform vec2 uC, uSize;
uniform float uR, uHr;
void main() {
  vec2 d = abs(gl_FragCoord.xy - uC);
  d = min(d, uSize - d);                      // nearest copy of the dab around the tile
  o = vec4(1. - smoothstep(uHr, uR, length(d)));
}`;
const FS_COMP = HEAD + `
uniform sampler2D uAccum, uPre, uMask;
uniform ivec2 uOff, uSize;
uniform float uOpacity;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), q = p + uOff;
  q -= uSize * ivec2(floor(vec2(q) / vec2(uSize)));
  vec4 a = texelFetch(uAccum, p, 0);
  float m = texelFetch(uMask, p, 0).r * uOpacity;
  o = vec4(mix(a.rgb, texelFetch(uPre, q, 0).rgb, m), a.a);
}`;

function program(gl, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function target(gl, w, h, format, levels = 1) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, format, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb };
}

// [start, end) runs of [a, b) folded into [0, n).
function runs(a, b, n) {
  if (b - a >= n) return [[0, n]];
  const s = ((a % n) + n) % n, e = s + (b - a);
  return e <= n ? [[s, e]] : [[s, n], [0, e - n]];
}

export function createCloner(gl) {
  const P = { copy: program(gl, FS_COPY), dab: program(gl, FS_DAB), comp: program(gl, FS_COMP) };
  const vao = gl.createVertexArray();
  let W = 0, H = 0, pre = null, accum = null, view = null, mask = null;

  function pass(prog, fb, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    setup?.(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bind(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  function copy(from, to) { bind(0, from.tex); pass(P.copy, to.fb, u => gl.uniform1i(u.uSrc, 0)); }
  function mips() { gl.bindTexture(gl.TEXTURE_2D, view.tex); gl.generateMipmap(gl.TEXTURE_2D); }

  function setBase(w, h, data) {
    if (w !== W || h !== H) {
      for (const t of [pre, accum, view, mask]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      W = w; H = h;
      pre = target(gl, W, H, gl.RGBA8);
      accum = target(gl, W, H, gl.RGBA8);
      view = target(gl, W, H, gl.RGBA8, Math.floor(Math.log2(Math.max(W, H))) + 1);
      mask = target(gl, W, H, gl.R8);
    }
    gl.bindTexture(gl.TEXTURE_2D, pre.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  // Adds dabs [from, …) of the stroke to the mask.
  function dabs(s, from) {
    const R = s.r * W, hr = Math.min(.95, s.hardness) * R;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(P.dab.p);
    gl.bindVertexArray(vao);
    gl.uniform2f(P.dab.u.uSize, W, H);
    gl.uniform1f(P.dab.u.uR, R);
    gl.uniform1f(P.dab.u.uHr, hr);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.enable(gl.SCISSOR_TEST);
    for (let i = from; i < s.dabs.length; i++) {
      const cx = s.dabs[i][0] * W, cy = s.dabs[i][1] * H;
      gl.uniform2f(P.dab.u.uC, ((cx % W) + W) % W, ((cy % H) + H) % H);
      for (const [x0, x1] of runs(Math.floor(cx - R), Math.ceil(cx + R) + 1, W))
        for (const [y0, y1] of runs(Math.floor(cy - R), Math.ceil(cy + R) + 1, H)) {
          gl.scissor(x0, y0, x1 - x0, y1 - y0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
  }
  function clearMask() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  // view = accum with the stroke laid over it
  function composite(s) {
    bind(0, accum.tex); bind(1, pre.tex); bind(2, mask.tex);
    pass(P.comp, view.fb, u => {
      gl.uniform1i(u.uAccum, 0); gl.uniform1i(u.uPre, 1); gl.uniform1i(u.uMask, 2);
      gl.uniform2i(u.uOff, Math.round(s.off[0] * W), Math.round(s.off[1] * H));
      gl.uniform2i(u.uSize, W, H);
      gl.uniform1f(u.uOpacity, s.opacity);
    });
    bind(2, null); bind(1, null); gl.activeTexture(gl.TEXTURE0);
  }

  return {
    setBase,
    // All strokes again, from the worker's result.
    replay(strokes) {
      copy(pre, accum);
      for (const s of strokes) { clearMask(); dabs(s, 0); composite(s); copy(view, accum); }
      copy(accum, view);
      mips();
    },
    begin() { clearMask(); },
    // The stroke being drawn, with dabs added since `from`.
    extend(s, from) { dabs(s, from); composite(s); mips(); },
    commit() { copy(view, accum); },
    // Throws the unfinished stroke away.
    cancel() { copy(accum, view); mips(); },
    get texture() { return view?.tex; },
    get size() { return [W, H]; },
  };
}
