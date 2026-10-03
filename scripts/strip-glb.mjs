// Removes vertex attributes from every primitive of a GLB and repacks the binary chunk,
// dropping data nothing refers to any more. Geometry and other attributes stay byte-identical.
// Usage: node scripts/strip-glb.mjs model.glb [ATTRIBUTE ...]   (default: COLOR_0 TEXCOORD_0 TEXCOORD_1)
import { readFileSync, writeFileSync } from 'node:fs';

const [, , file, ...names] = process.argv;
if (!file) { console.error('Usage: node scripts/strip-glb.mjs model.glb [ATTRIBUTE ...]'); process.exit(1); }
const strip = new Set(names.length ? names : ['COLOR_0', 'TEXCOORD_0', 'TEXCOORD_1']);

const glb = readFileSync(file);
if (glb.readUInt32LE(0) !== 0x46546C67) throw new Error('Not a GLB file');
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));

// Remove attributes.
const removed = new Set();
for (const mesh of gltf.meshes || []) for (const prim of mesh.primitives) {
  for (const name of Object.keys(prim.attributes)) if (strip.has(name)) { removed.add(name); delete prim.attributes[name]; }
  for (const t of prim.targets || []) for (const name of Object.keys(t)) if (strip.has(name)) delete t[name];
}
// A material that samples textures through removed UVs would break; drop texture references then.
if (removed.has('TEXCOORD_0')) {
  for (const m of gltf.materials || []) {
    const pbr = m.pbrMetallicRoughness || {};
    delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
}

// Which accessors and buffer views are still used.
const usedAccessors = new Set();
for (const mesh of gltf.meshes || []) for (const prim of mesh.primitives) {
  Object.values(prim.attributes).forEach(i => usedAccessors.add(i));
  if (prim.indices !== undefined) usedAccessors.add(prim.indices);
  for (const t of prim.targets || []) Object.values(t).forEach(i => usedAccessors.add(i));
}
for (const skin of gltf.skins || []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
for (const anim of gltf.animations || []) for (const s of anim.samplers) { usedAccessors.add(s.input); usedAccessors.add(s.output); }
if (removed.has('TEXCOORD_0')) { delete gltf.textures; delete gltf.images; delete gltf.samplers; }

const accessorMap = new Map(), accessors = [];
(gltf.accessors || []).forEach((a, i) => { if (usedAccessors.has(i)) { accessorMap.set(i, accessors.length); accessors.push(a); } });
const usedViews = new Set(accessors.map(a => a.bufferView).filter(v => v !== undefined));
for (const img of gltf.images || []) if (img.bufferView !== undefined) usedViews.add(img.bufferView);

// Repack the used buffer views, 4-byte aligned.
const pad4 = n => (n + 3) & ~3;
const viewMap = new Map(), views = [], parts = [];
let offset = 0;
(gltf.bufferViews || []).forEach((v, i) => {
  if (!usedViews.has(i)) return;
  const data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  viewMap.set(i, views.length);
  views.push({ ...v, byteOffset: offset });
  parts.push([offset, data]);
  offset = pad4(offset + v.byteLength);
});
const newBin = Buffer.alloc(offset);
for (const [o, data] of parts) data.copy(newBin, o);

// Remap indices.
accessors.forEach(a => { if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView); });
for (const img of gltf.images || []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);
const remap = i => accessorMap.get(i);
for (const mesh of gltf.meshes || []) for (const prim of mesh.primitives) {
  for (const k of Object.keys(prim.attributes)) prim.attributes[k] = remap(prim.attributes[k]);
  if (prim.indices !== undefined) prim.indices = remap(prim.indices);
  for (const t of prim.targets || []) for (const k of Object.keys(t)) t[k] = remap(t[k]);
}
for (const skin of gltf.skins || []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
for (const anim of gltf.animations || []) for (const s of anim.samplers) { s.input = remap(s.input); s.output = remap(s.output); }
gltf.accessors = accessors;
gltf.bufferViews = views;
gltf.buffers = [{ byteLength: newBin.length }];

// Write the GLB.
const json = Buffer.from(JSON.stringify(gltf));
const jsonChunk = Buffer.alloc(pad4(json.length), 0x20);
json.copy(jsonChunk);
const total = 12 + 8 + jsonChunk.length + 8 + newBin.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4E4F534A, 16); jsonChunk.copy(out, 20);
const o = 20 + jsonChunk.length;
out.writeUInt32LE(newBin.length, o); out.writeUInt32LE(0x004E4942, o + 4); newBin.copy(out, o + 8);
writeFileSync(file, out);
console.log(`${file}: removed ${[...removed].join(', ') || 'nothing'}; ${glb.length} → ${total} bytes`);
