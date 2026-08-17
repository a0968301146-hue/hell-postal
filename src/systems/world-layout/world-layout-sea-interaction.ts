// Visual/physical construction for Day6's own relocated sea interaction
// platform — split out of world-layout-system.ts during the "world-layout
// per-area modularization" round (pure move, no behavior change). See
// world-layout-system.ts's own createLogisticsScene() for the dispatch/
// composition entry point that calls into buildSeaInteractionPlatform.
//
// Deliberately imports buildFishingLantern/WOOD_DECK_MAT/WOOD_DARK_MAT from
// world-layout-shared.ts rather than from world-layout-fishing-pier.ts —
// this platform and the fishing pier are two independent areas that happen
// to share a couple of small decorative props; importing directly from the
// fishing-pier area file would create a builder-to-builder dependency this
// round's dependency-direction rule explicitly disallows.
import * as THREE from 'three';
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import { SEA_INTERACTION_AREA } from '../../data/world/sea-interaction-data';
import { WOOD_DECK_MAT, WOOD_DARK_MAT, buildFishingLantern } from './world-layout-shared';

/** Day6's own relocated dialogue scene ("每日特殊劇情系統" round follow-up,
 * spec: "Day6不應在營火區進行...傳送至海面上的特殊互動區") — a small
 * floating wooden raft out in open water, clear of FISHING_PIER's own deck
 * (never touches or affects it — different X range entirely, see
 * sea-interaction-data.ts's own doc comment) so Day5's "beach swimming"
 * scene (which still uses the fishing pier chairs) is completely unaffected.
 * A simple standalone platform + a mooring post + lantern, low-poly to match
 * every other decorative prop in this file — no swim mechanic, the player
 * is teleported to stand on the raft exactly like every other day's own
 * seatPlayer/seatNpc teleport. */
export function buildSeaInteractionPlatform(scene: THREE.Scene, physics: PhysicsWorldPort): void {
  const { centerX, centerZ, platformY, radius } = SEA_INTERACTION_AREA;

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.15, 12), WOOD_DECK_MAT());
  platform.position.set(centerX, platformY - 0.075, centerZ);
  scene.add(platform);
  physics.createStaticCuboid(centerX, platformY - 0.075, centerZ, radius * 0.9, 0.1, radius * 0.9);

  // A few short mooring-post rails around the rim, purely decorative.
  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const post = new THREE.Mesh(postGeo, WOOD_DARK_MAT());
    post.position.set(centerX + Math.cos(angle) * radius * 0.85, platformY + 0.1, centerZ + Math.sin(angle) * radius * 0.85);
    scene.add(post);
  }

  const lanternPos = new THREE.Vector3(centerX - radius * 0.7, platformY, centerZ - radius * 0.7);
  buildFishingLantern(scene, lanternPos);
  const lampLight = new THREE.PointLight(0xffcc66, 0.6, 5);
  lampLight.position.set(lanternPos.x, lanternPos.y + 0.3, lanternPos.z);
  scene.add(lampLight);
}
