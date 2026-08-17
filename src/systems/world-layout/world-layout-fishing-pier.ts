// Visual/physical construction for the independent small fishing pier —
// split out of world-layout-system.ts during the "world-layout per-area
// modularization" round (pure move, no behavior change). See
// world-layout-system.ts's own createLogisticsScene() for the dispatch/
// composition entry point that calls into buildFishingPier.
import * as THREE from 'three';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import {
  FISHING_PIER, FISHING_CHAIR_A, FISHING_CHAIR_B, FISHING_ROD_A, FISHING_ROD_B,
  FISHING_BUCKET, FISHING_TACKLE_BOX, FISHING_LANTERN,
} from './fishing-pier-data';
import { stdMat, WOOD_DECK_MAT, WOOD_DARK_MAT, buildFishingLantern } from './world-layout-shared';

const WOOD_PILING_MAT = () => stdMat(0x4a3018);

/** Independent small fishing pier ("Relocate pallet racks and add fishing
 * pier" round三) — south of the main sea-vehicle PIER, sharing its floorY so
 * there is no height discontinuity at the seam (spec: "與現有岸邊無高低差").
 * All positions come from fishing-pier-data.ts; this function only builds
 * geometry/colliders from them. Deliberately does NOT touch PIER's own deck,
 * water plane, or collider, and stays entirely south of every sea vehicle's
 * own dock/travel range (see fishing-pier-data.ts's own doc comment) — no
 * vehicle-route safety logic is needed here beyond correct static placement.
 * Open at the south (far) end — no railing there, so the fishing view over
 * open water stays unobstructed (spec: "面向海的一側維持開放"). */
export function buildFishingPier(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { minX, maxX, minZ, maxZ, floorY, deckThickness } = FISHING_PIER;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const deckGeo = new THREE.PlaneGeometry(width, depth);
  const deck = new THREE.Mesh(deckGeo, WOOD_DECK_MAT());
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, floorY, cz);
  scene.add(deck);
  physics.createStaticCuboid(cx, floorY - deckThickness / 2, cz, width / 2, deckThickness / 2, depth / 2);

  // Four corner support pilings, driven down toward the water below — purely
  // decorative (the deck's own collider above already handles walkability),
  // low-poly (8-sided cylinders) to match the requested wooden/low-poly look.
  const pilingRadius = 0.09;
  const pilingInset = 0.2;
  const pilingTopY = floorY - deckThickness;
  const pilingBottomY = floorY - 1.1;
  const pilingHeight = pilingTopY - pilingBottomY;
  const pilingGeo = new THREE.CylinderGeometry(pilingRadius, pilingRadius * 1.15, pilingHeight, 8);
  for (const px of [minX + pilingInset, maxX - pilingInset]) {
    for (const pz of [minZ + pilingInset, maxZ - pilingInset]) {
      const piling = new THREE.Mesh(pilingGeo, WOOD_PILING_MAT());
      piling.position.set(px, pilingTopY - pilingHeight / 2, pz);
      scene.add(piling);
    }
  }

  buildFishingChair(scene, physics, FISHING_CHAIR_A);
  buildFishingChair(scene, physics, FISHING_CHAIR_B);
  buildFishingRod(scene, FISHING_ROD_A);
  buildFishingRod(scene, FISHING_ROD_B);
  buildFishingBucket(scene, FISHING_BUCKET);
  buildFishingTackleBox(scene, FISHING_TACKLE_BOX);
  buildFishingLantern(scene, FISHING_LANTERN);
}

/** Simple low-poly wooden chair, facing +Z (no yaw — its backrest sits on
 * the -Z side by construction). Static collider only, no sitting behavior
 * this round (spec三: "本輪不需要實作坐下功能"). */
function buildFishingChair(scene: THREE.Scene, physics: PhysicsWorldPort, pos: THREE.Vector3): void {
  const legHeight = 0.28;
  const seatThickness = 0.06;
  const seatY = pos.y + legHeight + seatThickness / 2;

  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, legHeight, 6);
  const legOffsets: [number, number][] = [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]];
  for (const [ox, oz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, WOOD_DARK_MAT());
    leg.position.set(pos.x + ox, pos.y + legHeight / 2, pos.z + oz);
    scene.add(leg);
  }

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, seatThickness, 0.5), WOOD_DECK_MAT());
  seat.position.set(pos.x, seatY, pos.z);
  scene.add(seat);

  const backHeight = 0.4;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, backHeight, 0.06), WOOD_DECK_MAT());
  back.position.set(pos.x, seatY + backHeight / 2, pos.z - 0.22);
  scene.add(back);

  physics.createStaticCuboid(pos.x, pos.y + 0.35, pos.z, 0.26, 0.35, 0.26);
}

/** Thin leaning fishing rod — a plain cylinder tilted against an implicit
 * rest point near its chair, low-poly. */
function buildFishingRod(scene: THREE.Scene, pos: THREE.Vector3): void {
  const rodLength = 1.6;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, rodLength, 6), WOOD_DARK_MAT());
  rod.position.set(pos.x, pos.y + (rodLength / 2) * Math.cos(0.35), pos.z);
  rod.rotation.z = 0.35;
  scene.add(rod);
}

function buildFishingBucket(scene: THREE.Scene, pos: THREE.Vector3): void {
  const bucketHeight = 0.32;
  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, bucketHeight, 10, 1, true),
    stdMat(0x3a3a3a, { side: THREE.DoubleSide })
  );
  bucket.position.set(pos.x, pos.y + bucketHeight / 2, pos.z);
  scene.add(bucket);
}

function buildFishingTackleBox(scene: THREE.Scene, pos: THREE.Vector3): void {
  const boxHeight = 0.22;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, boxHeight, 0.24), WOOD_DARK_MAT());
  box.position.set(pos.x, pos.y + boxHeight / 2, pos.z);
  scene.add(box);
}
