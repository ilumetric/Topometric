// Loads a user's 3D model from local files: GLB/GLTF, OBJ, FBX, STL.
// Loaders are imported only when a file of that type is opened.
// For .gltf with separate .bin/texture files, pass all of them together (e.g. a multi-file drop).
import * as THREE from 'three';

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx', 'stl'];
export const MODEL_ACCEPT = MODEL_EXTENSIONS.map(e => '.' + e).join(',');

const extOf = name => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

export function isModelFile(file) {
  return MODEL_EXTENSIONS.includes(extOf(file.name));
}

// Returns { object, name }. The object has normals on every mesh.
export async function loadModel(files) {
  files = [...files];
  const main = files.find(isModelFile);
  if (!main) throw new Error('Supported formats: ' + MODEL_EXTENSIONS.join(', ').toUpperCase());
  const ext = extOf(main.name);
  const buffer = await main.arrayBuffer();
  let object;

  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    // Resolve the files a .gltf refers to (buffers, textures) to the other dropped files.
    const urls = new Map(files.filter(f => f !== main).map(f => [f.name, URL.createObjectURL(f)]));
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => urls.get(decodeURIComponent(url.split(/[\\/]/).pop())) || url);
    try {
      const gltf = await new GLTFLoader(manager).parseAsync(ext === 'glb' ? buffer : new TextDecoder().decode(buffer), '');
      object = gltf.scene;
    } finally {
      urls.forEach(u => URL.revokeObjectURL(u));
    }
  } else if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    object = new OBJLoader().parse(new TextDecoder().decode(buffer));
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    object = new FBXLoader().parse(buffer, '');
  } else {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    object = new THREE.Mesh(new STLLoader().parse(buffer));
  }

  let meshes = 0;
  object.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
  });
  if (!meshes) throw new Error('No meshes in ' + main.name);
  return { object, name: main.name };
}
