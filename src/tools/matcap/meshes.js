// Preview shapes for the model view. Each call returns a fresh object (a mesh, or a
// glTF scene with its node transforms); the caller assigns the material. Sample models are loaded from files on first use.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SHAPES = [['knot', 'Knot'], ['torus', 'Torus'], ['blob', 'Blob'], ['suzanne', 'Suzanne']];

const MODELS = {
  suzanne: new URL('../../assets/models/blender-suzanne.glb', import.meta.url).href,
};

// Sphere with soft bumps. Vertices are welded first so normals are smooth across the UV seam.
function blob() {
  let g = new THREE.SphereGeometry(1, 192, 128);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + .13 * Math.sin(3.1 * x + .6) * Math.sin(2.7 * y + 1.1) * Math.sin(3.3 * z + .3)
      + .06 * Math.sin(6.2 * y + 2 * x) + .04 * Math.cos(7.1 * z - y);
    p.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}

async function sampleModel(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { scene } = await new GLTFLoader().loadAsync(url);
  scene.traverse(o => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
  return scene;
}

export async function createShape(name) {
  if (MODELS[name]) return sampleModel(MODELS[name]);
  return new THREE.Mesh(
    name === 'torus' ? new THREE.TorusGeometry(1, .42, 96, 192)
      : name === 'blob' ? blob()
        : new THREE.TorusKnotGeometry(1, .36, 400, 48, 2, 3));
}
