// Preview shapes for the model view. Each call returns a fresh THREE.Mesh;
// the caller assigns the material. The bunny is loaded from a file on first use.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SHAPES = [['knot', 'Knot'], ['torus', 'Torus'], ['blob', 'Blob'], ['bunny', 'Bunny']];

const BUNNY_URL = new URL('../../assets/models/stanford-bunny.glb', import.meta.url).href;

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

async function bunny() {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(BUNNY_URL);
  let geometry = null;
  gltf.scene.traverse(o => { if (o.isMesh && !geometry) geometry = o.geometry; });
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return geometry;
}

export async function createShape(name) {
  const geometry =
    name === 'torus' ? new THREE.TorusGeometry(1, .42, 96, 192)
      : name === 'blob' ? blob()
        : name === 'bunny' ? await bunny()
          : new THREE.TorusKnotGeometry(1, .36, 400, 48, 2, 3);
  return new THREE.Mesh(geometry);
}
