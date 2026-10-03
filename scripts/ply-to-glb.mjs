// Converts an ASCII PLY mesh (positions + triangle faces) to a minimal GLB:
// float32 positions and uint16/uint32 indices, no normals (three.js computes them on load).
// Usage: node scripts/ply-to-glb.mjs input.ply output.glb
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) { console.error('Usage: node scripts/ply-to-glb.mjs input.ply output.glb'); process.exit(1); }

const text = readFileSync(input, 'utf8');
const end = text.indexOf('end_header');
const header = text.slice(0, end).split(/\r?\n/);
if (!header.some(l => l.trim() === 'format ascii 1.0')) throw new Error('Only ASCII PLY is supported');
const vertexCount = +header.find(l => l.startsWith('element vertex')).split(/\s+/)[2];
const faceCount = +header.find(l => l.startsWith('element face')).split(/\s+/)[2];
const props = header.slice(header.findIndex(l => l.startsWith('element vertex')) + 1)
  .filter(l => l.startsWith('property ')).map(l => l.split(/\s+/).pop());
const ix = props.indexOf('x'), iy = props.indexOf('y'), iz = props.indexOf('z');

const lines = text.slice(end).split(/\r?\n/).slice(1).filter(l => l.trim());
const positions = new Float32Array(vertexCount * 3);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vertexCount; i++) {
  const v = lines[i].trim().split(/\s+/).map(Number), p = [v[ix], v[iy], v[iz]];
  positions.set(p, i * 3);
  p.forEach((c, k) => { min[k] = Math.min(min[k], c); max[k] = Math.max(max[k], c); });
}
const tris = [];
for (let i = 0; i < faceCount; i++) {
  const f = lines[vertexCount + i].trim().split(/\s+/).map(Number);
  for (let k = 2; k < f[0]; k++) tris.push(f[1], f[k], f[k + 1]);   // fan-triangulate polygons
}
const big = vertexCount > 65535;
const indices = big ? new Uint32Array(tris) : new Uint16Array(tris);

const pad4 = n => (n + 3) & ~3;
const posBytes = positions.byteLength, idxOffset = pad4(posBytes), binLength = pad4(idxOffset + indices.byteLength);
const bin = new Uint8Array(binLength);
bin.set(new Uint8Array(positions.buffer), 0);
bin.set(new Uint8Array(indices.buffer), idxOffset);

const gltf = {
  asset: { version: '2.0', generator: 'Topometric ply-to-glb' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: [{ byteLength: binLength }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: indices.byteLength, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
    { bufferView: 1, componentType: big ? 5125 : 5123, count: indices.length, type: 'SCALAR' },
  ],
};

let json = new TextEncoder().encode(JSON.stringify(gltf));
const jsonPadded = new Uint8Array(pad4(json.length)).fill(0x20);
jsonPadded.set(json);
const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
const glb = new Uint8Array(total), dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
dv.setUint32(12, jsonPadded.length, true); dv.setUint32(16, 0x4E4F534A, true);
glb.set(jsonPadded, 20);
const o = 20 + jsonPadded.length;
dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004E4942, true);
glb.set(bin, o + 8);
writeFileSync(output, glb);
console.log(`${output}: ${vertexCount} vertices, ${tris.length / 3} triangles, ${total} bytes`);
