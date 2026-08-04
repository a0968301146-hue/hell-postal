import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../shared/types/interactable';
import { BACK_AREA } from './world-layout';
import { createFloatingLabel } from '../adapters/three/world-label-system';
import { LADDER_WALL_SLOT } from './ladder/ladder-data';

export const TOOL_STATION_ID = 'tool-station-01';
const TOOL_STATION_DISPLAY_NAME = '工具推車';

const TOOL_STATION_DIMENSIONS = { width: 1.2, depth: 0.6, height: 0.9 };

/** Placed a few meters west of the pallet-rack/ladder wall cluster (spec二:
 * "放在托盤架與梯子附近"), far enough off the east wall itself that its own
 * 1.0m player-clearance footprint on every side never overlaps the rack
 * cluster's own pickup/return zone or the main north-south walkway through
 * the back area — derived from the ladder's own wall-slot Z so it stays
 * co-located with that cluster rather than a bare literal. */
export const TOOL_STATION_POSITION = new THREE.Vector3(
  LADDER_WALL_SLOT.position.x - 2.4,
  BACK_AREA.floorY + TOOL_STATION_DIMENSIONS.height / 2,
  LADDER_WALL_SLOT.position.z - 0.2
);

/**
 * An immovable tool cart ("Add ladder tool station and envelope vacuum"
 * round二) — a Fixed RigidBody with a real collider (spec: "不可搬運、不可
 * 投擲、不可被捕貨鉤勾取"), registered into the shared `interactables` map
 * purely so the existing crosshair raycast can target it for the "E 開啟
 * 工具配置" prompt (canPickUp=true only to satisfy that raycast filter,
 * same "fake pickupable dummy" convention as every other wall
 * button/rack/counter target in this codebase — see pallet-system.ts's own
 * buildRackVisual doc comment). Never registered into CargoSystem, so
 * CargoHookSystem's own target resolution (which only ever recognizes ids
 * CargoSystem itself owns) can never target it either — no separate
 * exclusion code needed.
 *
 * Owns no UI of its own — InteractionSystem calls back into a plain
 * onOpenToolLoadoutMenu callback (see create-game-systems.ts) when the
 * player E-presses it, the same "world object triggers an external UI"
 * pattern the bulletin board/television already establish.
 */
export class ToolStationSystem {
  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x555a5f });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e3134 });

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(TOOL_STATION_DIMENSIONS.width, TOOL_STATION_DIMENSIONS.height, TOOL_STATION_DIMENSIONS.depth),
      bodyMat
    );
    mesh.position.copy(TOOL_STATION_POSITION);
    scene.add(mesh);

    // Simple wheeled-cart legs/frame accents — purely cosmetic children.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), frameMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * (TOOL_STATION_DIMENSIONS.width / 2 - 0.12), -TOOL_STATION_DIMENSIONS.height / 2 + 0.08, sz * (TOOL_STATION_DIMENSIONS.depth / 2 - 0.05));
        mesh.add(wheel);
      }
    }
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(TOOL_STATION_DIMENSIONS.width - 0.1, 0.04, TOOL_STATION_DIMENSIONS.depth - 0.1), frameMat);
    topRail.position.set(0, TOOL_STATION_DIMENSIONS.height / 2 + 0.02, 0);
    mesh.add(topRail);

    const label = createFloatingLabel(TOOL_STATION_DISPLAY_NAME, { width: 0.6, bg: 'rgba(20,25,30,0.75)', fontSize: 20 });
    label.position.set(TOOL_STATION_POSITION.x, TOOL_STATION_POSITION.y + TOOL_STATION_DIMENSIONS.height / 2 + 0.3, TOOL_STATION_POSITION.z);
    scene.add(label);

    // Fixed body — never moves, never disabled (spec二: "不可推動...使用Fixed
    // RigidBody") — PhysicsSystem's own createStaticCuboid is exactly this
    // (RAPIER.RigidBodyDesc.fixed()), the same primitive every static wall/
    // floor collider in this codebase already uses.
    physics.createStaticCuboid(
      TOOL_STATION_POSITION.x, TOOL_STATION_POSITION.y, TOOL_STATION_POSITION.z,
      TOOL_STATION_DIMENSIONS.width / 2, TOOL_STATION_DIMENSIONS.height / 2, TOOL_STATION_DIMENSIONS.depth / 2
    );

    const stationObj = createInteractableObject(TOOL_STATION_ID, TOOL_STATION_DISPLAY_NAME, mesh, TOOL_STATION_DIMENSIONS.width, TOOL_STATION_DIMENSIONS.height, TOOL_STATION_DIMENSIONS.depth);
    stationObj.canPickUp = true;
    interactables.set(TOOL_STATION_ID, stationObj);
  }

  isToolStationTarget(id: string): boolean {
    return id === TOOL_STATION_ID;
  }
}
