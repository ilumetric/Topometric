// Procedural preview meshes. Each is a parametric surface f(u, v) on a grid;
// normals come from finite differences and are flipped to point away from `center(u, v)`.

const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function parametric(nu, nv, f, center, scale = 1) {
  const count = (nu + 1) * (nv + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const e = 1e-4;
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    const u = i / nu, v = j / nv, p = f(u, v);
    let n = norm(cross(sub(f(u + e, v), f(u - e, v)), sub(f(u, v + e), f(u, v - e))));
    const c = center(u, v), out = sub(p, c);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    positions.set([p[0] * scale, p[1] * scale, p[2] * scale], k * 3);
    normals.set(n, k * 3);
  }
  const indices = new Uint32Array(nu * nv * 6);
  let o = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    indices.set([a, c, b, b, c, d], o); o += 6;
  }
  return { positions, normals, indices };
}

// (2, 3) torus knot, built like three.js TorusKnotGeometry.
function knotCurve(t) {
  const q = 1.5 * t, cs = Math.cos(q);
  return [(2 + cs) * .5 * Math.cos(t), (2 + cs) * .5 * Math.sin(t), Math.sin(q) * .5];
}
function knot(u, v) {
  const t = u * 2 * TAU, p1 = knotCurve(t), p2 = knotCurve(t + .01);
  const T = sub(p2, p1);
  let N = [p1[0] + p2[0], p1[1] + p2[1], p1[2] + p2[2]];
  const B = norm(cross(T, N));
  N = norm(cross(B, T));
  const a = v * TAU, r = .36, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  return [p1[0] + ca * N[0] + sa * B[0], p1[1] + ca * N[1] + sa * B[1], p1[2] + ca * N[2] + sa * B[2]];
}

function torus(u, v) {
  const a = u * TAU, b = v * TAU, r = 1 + .42 * Math.cos(b);
  return [r * Math.cos(a), .42 * Math.sin(b), r * Math.sin(a)];
}

// Sphere with soft bumps; the poles are skipped by a hair to keep normals defined.
function blobDir(u, v) {
  const a = u * TAU, b = .0005 + v * (Math.PI - .001);
  return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
}
function blob(u, v) {
  const d = blobDir(u, v);
  const r = 1 + .13 * Math.sin(3.1 * d[0] + .6) * Math.sin(2.7 * d[1] + 1.1) * Math.sin(3.3 * d[2] + .3)
    + .06 * Math.sin(6.2 * d[1] + 2 * d[0]) + .04 * Math.cos(7.1 * d[2] - d[1]);
  return [d[0] * r, d[1] * r, d[2] * r];
}

export const MESHES = {
  knot: () => parametric(320, 40, knot, u => knotCurve(u * 2 * TAU), .56),
  torus: () => parametric(128, 64, torus, u => [Math.cos(u * TAU), 0, Math.sin(u * TAU)], .72),
  blob: () => parametric(160, 120, blob, () => [0, 0, 0], .86),
};
