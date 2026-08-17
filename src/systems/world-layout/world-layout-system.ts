import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';
// Depends on the neutral PhysicsWorldPort contract (Phase 7: 解除最後一個
// 循環依賴) rather than importing PhysicsSystem (adapters/rapier) directly
// — that adapter used to import PLAYER_SPAWN from this very module, which
// combined with this file's own import of PhysicsSystem created a
// file-level circular import. PLAYER_SPAWN is now passed into
// PhysicsSystem.init() as a parameter instead (see app/game-context.ts),
// and this file only ever needs the one collider-creation method the port
// exposes.
import { PhysicsWorldPort } from '../../shared/types/physics-world-port';
import {
  buildBackArea, buildBulletinBoard, buildTelevisionAndTable, buildWestWallShelves, buildMainHallSkylight, buildIthacaTownSign,
  BULLETIN_BOARD_INTERACTABLE_ID, TELEVISION_INTERACTABLE_ID,
} from './world-layout-main-hall';
import {
  buildCargoChuteRoom, buildLostFoundRoom, buildCoffeeRoom, buildPlayerRoom, buildCampfireArea,
} from './world-layout-side-rooms';
import { buildFishingPier } from './world-layout-fishing-pier';
import { buildPierAndWater } from './world-layout-pier';
import { buildSeaInteractionPlatform } from './world-layout-sea-interaction';

export const SCENE_CONFIG = {
  playerEyeHeight: 1.6,
  playerSpeed: 7,
  sprintMultiplier: 1.5,
  jumpHeight: 0.5,
  gravity: 9.81,
  interactionDistance: 3,
  deltaTimeMax: 0.1,
  maxChargeTime: 2.0,
  minThrowImpulse: 3,
  maxThrowImpulse: 12,
};

export interface SceneData {
  interactables: Map<string, InteractableObject>;
  /** Back-area floor — now the single primary floor for the whole building
   * (the north front-office room was removed entirely this round — see
   * buildBackArea's north wall). Used by PickupSystem as its default
   * placement raycast floor. */
  floor: THREE.Mesh;
  /** Pier deck — register as an additional PickupSystem placement surface. */
  pierFloor: THREE.Mesh;
  /** West-side lost & found room's own floor — a separate mesh from `floor`
   * above, so it must also be registered as an additional PickupSystem
   * placement surface ("Reduce daily cargo and add lost found desk" round
   * 二), same pattern as pierFloor. */
  lostFoundFloor: THREE.Mesh;
  /** North cargo-chute room's own floor ("重製出貨口" round) — same "separate
   * mesh, needs its own placement-surface registration" reasoning as
   * lostFoundFloor/pierFloor above; without this, dropping cargo onto this
   * new room's floor would silently fail PickupSystem's placement raycast. */
  cargoChuteFloor: THREE.Mesh;
  /** West-wall freezer cabinets' own level-top boards ("Add freezer shelves
   * and frozen cargo freshness system" round, redesign pass) — 3 boards per
   * cabinet group, 6 total (2 groups). Registered as additional PickupSystem
   * placement surfaces the same way pierFloor/lostFoundFloor already are
   * (see create-game-systems.ts) — this file only builds the
   * Mesh/Collider/candidate-surface geometry, never touches PickupSystem
   * itself (it doesn't exist yet at this point in app startup). */
  shelfSurfaces: THREE.Mesh[];
  /** Television's own floating world label + screen material handles ("Add
   * television media playlist" round) — returned so MediaPlayerSystem
   * (built later in create-game-systems.ts, well after PauseManager exists)
   * can update the label text (playback status, spec八) and toggle the
   * screen's own emissive glow while playing, without this file needing any
   * knowledge of playback state itself (spec: "不需要把網路影片製作成
   * Three.js VideoTexture" — this is a plain material property tweak, not a
   * video texture). */
  television: { label: THREE.Sprite; screenMaterial: THREE.MeshStandardMaterial };
}

// "world-layout per-area modularization" round — BULLETIN_BOARD_INTERACTABLE_ID
// and TELEVISION_INTERACTABLE_ID are now DEFINED in world-layout-main-hall.ts
// (the file that actually builds/registers those interactables) and
// re-exported here so every external `import { BULLETIN_BOARD_INTERACTABLE_ID }
// from '../world-layout'` (via this folder's own index.ts barrel) keeps
// resolving exactly as before — this file's own export surface is
// byte-for-byte unchanged, only where each symbol is DEFINED moved.
export { BULLETIN_BOARD_INTERACTABLE_ID, TELEVISION_INTERACTABLE_ID };

export function createLogisticsScene(scene: THREE.Scene, physics: PhysicsWorldPort): SceneData {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(6, 14, 4);
  scene.add(dirLight);

  const floor = buildBackArea(scene, physics);
  const pierFloor = buildPierAndWater(scene, physics);
  const cargoChuteFloor = buildCargoChuteRoom(scene, physics);
  const lostFoundFloor = buildLostFoundRoom(scene, physics);
  const shelfSurfaces = buildWestWallShelves(scene, physics);
  buildFishingPier(scene, physics);
  buildCoffeeRoom(scene, physics);
  buildPlayerRoom(scene, physics);
  buildCampfireArea(scene, physics);
  buildMainHallSkylight(scene, physics);
  buildSeaInteractionPlatform(scene, physics);
  buildIthacaTownSign(scene);

  const interactables = new Map<string, InteractableObject>();
  buildBulletinBoard(scene, physics, interactables);
  const television = buildTelevisionAndTable(scene, physics, interactables);
  return { interactables, floor, pierFloor, lostFoundFloor, cargoChuteFloor, shelfSurfaces, television };
}
