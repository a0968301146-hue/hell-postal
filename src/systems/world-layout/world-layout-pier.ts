// Visual/physical construction for the main sea-vehicle pier + water plane —
// split out of world-layout-system.ts during the "world-layout per-area
// modularization" round (pure move, no behavior change). See
// world-layout-system.ts's own createLogisticsScene() for the dispatch/
// composition entry point that calls into buildPierAndWater.
import * as THREE from 'three';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import { WALL_THICKNESS, PIER } from './logistics-layout-data';
import { stdMat } from './world-layout-shared';

export function buildPierAndWater(scene: THREE.Scene, physics: PhysicsWorldPort): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, floorY, waterY } = PIER;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const deckGeo = new THREE.PlaneGeometry(width, depth);
  const deck = new THREE.Mesh(deckGeo, stdMat(0x2f8f8f));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, floorY, cz);
  scene.add(deck);
  physics.createStaticCuboid(cx, floorY - WALL_THICKNESS / 2, cz, width / 2, WALL_THICKNESS / 2, depth / 2);

  // Pier now extends EAST off the back-area wall, so bias the water plane
  // further east (away from the building) rather than in +Z.
  const waterGeo = new THREE.PlaneGeometry(width * 3, depth * 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: 0x1a4a6a, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + width * 0.3, waterY, cz);
  scene.add(water);

  return deck;
}
