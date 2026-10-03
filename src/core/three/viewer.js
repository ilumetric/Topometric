// Reusable three.js viewer: renderer, perspective camera, orbit controls, and an object
// that is centered and scaled to fit. Renders on demand (only when something changed).
//
//   const v = createViewer(canvas);
//   v.setObject(mesh);          // replaces the shown object and frames it
//   v.render();                 // request a frame after changing materials etc.
//   v.setEnabled(false);        // stop rendering and ignore input (e.g. while hidden)
//   v.onBeforeRender = () => …; // runs right before every frame
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(canvas, { fov = 32, distance = 3.8, alpha = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, premultipliedAlpha: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, .01, 100);
  const home = new THREE.Vector3(0, 0, distance);
  camera.position.copy(home);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .12;
  controls.minDistance = distance * .35;
  controls.maxDistance = distance * 3;
  controls.addEventListener('change', () => render());

  const holder = new THREE.Group();     // centers and scales the object
  scene.add(holder);
  let object = null, enabled = true, raf = 0;

  const v = { renderer, scene, camera, controls, onBeforeRender: null };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    return true;
  }

  function frame() {
    raf = 0;
    if (!enabled || !resize()) return;
    const moving = controls.update();
    v.onBeforeRender?.();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    if (moving) render();               // keep going while damping settles
  }

  function render() {
    if (enabled && !raf) raf = requestAnimationFrame(frame);
  }

  // Shows `obj`, centered at the origin and scaled so its bounding sphere has radius 1.
  function setObject(obj, { dispose = true } = {}) {
    if (object) {
      holder.remove(object);
      if (dispose) disposeObject(object);
    }
    object = obj;
    if (obj) {
      holder.add(obj);
      holder.position.set(0, 0, 0);
      holder.scale.setScalar(1);
      holder.updateMatrixWorld(true);
      const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
      const k = sphere.radius > 0 ? 1 / sphere.radius : 1;
      holder.scale.setScalar(k);
      holder.position.copy(sphere.center).multiplyScalar(-k);
    }
    render();
  }

  function resetView() {
    camera.position.copy(home);
    controls.target.set(0, 0, 0);
    controls.update();
    render();
  }

  function setEnabled(on) {
    enabled = on;
    controls.enabled = on;
    if (on) render();
  }

  return Object.assign(v, { render, resize, setObject, resetView, setEnabled, getObject: () => object });
}

export function disposeObject(obj) {
  obj.traverse(o => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
      m.dispose();
    }
  });
}
