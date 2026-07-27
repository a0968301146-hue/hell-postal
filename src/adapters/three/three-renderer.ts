import * as THREE from 'three';

export interface ThreeRendererBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}

/** The ONE place `new THREE.WebGLRenderer`/`document.body.appendChild` for
 * the main canvas happens — extracted out of the old Game constructor so
 * app/game-context.ts (and eventually a Unity port's own bootstrap) doesn't
 * need to know any WebGL setup details itself. */
export function createThreeRenderer(): ThreeRendererBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.autoClear = false;
  document.body.appendChild(renderer.domElement);

  return { scene, camera, renderer };
}
