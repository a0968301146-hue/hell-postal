import * as THREE from 'three';
import { InteractableObject } from './interactable-object';
import { PhysicsSystem } from './physics-system';
import { PackageData } from './package-data';
import { SCENE_CONFIG } from './scene-manager';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

const FLOOR_Y = BACK_AREA.floorY;

export const STAMP_TABLE = {
  width: 2.4,
  depth: 1.8,
  height: 0.9,
  legWidth: 0.1,
  // Relocated into the back-area work furniture cluster (see logistics-layout-data.ts)
  posX: -8,
  posZ: 17.5,
};

export class StampStation {
  tableMesh: THREE.Group;
  tableTopMesh!: THREE.Mesh; // exposed for placement raycasting
  private sensorBox: THREE.Box3;
  private interactables: Map<string, InteractableObject>;
  private packageDataMap: Map<string, PackageData>;
  private stableTimer = 0;
  private stableThreshold = 0.25;
  private velocityThreshold = 0.5;

  readyPackageId: string | null = null;
  statusMessage: string = '';

  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    packageDataMap: Map<string, PackageData>
  ) {
    this.interactables = interactables;
    this.packageDataMap = packageDataMap;

    // Create table mesh
    this.tableMesh = this.createTableMesh();
    this.tableMesh.position.set(STAMP_TABLE.posX, FLOOR_Y, STAMP_TABLE.posZ);
    scene.add(this.tableMesh);
    // Force world matrix computation so raycaster works immediately
    this.tableMesh.updateMatrixWorld(true);

    // Create physics collider for table top
    const tableY = FLOOR_Y + STAMP_TABLE.height;
    const topThickness = 0.06;
    physics.createStaticCuboid(
      STAMP_TABLE.posX, tableY - topThickness / 2, STAMP_TABLE.posZ,
      STAMP_TABLE.width / 2, topThickness / 2, STAMP_TABLE.depth / 2
    );

    // 4 legs
    const legH = STAMP_TABLE.height - topThickness;
    const hw = STAMP_TABLE.width / 2 - 0.15;
    const hd = STAMP_TABLE.depth / 2 - 0.15;
    const legHx = STAMP_TABLE.legWidth / 2;
    const positions = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
    for (const [lx, lz] of positions) {
      physics.createStaticCuboid(
        STAMP_TABLE.posX + lx, FLOOR_Y + legH / 2, STAMP_TABLE.posZ + lz,
        legHx, legH / 2, legHx
      );
    }

    // Sensor area above table
    const sensorY = FLOOR_Y + STAMP_TABLE.height;
    this.sensorBox = new THREE.Box3(
      new THREE.Vector3(
        STAMP_TABLE.posX - STAMP_TABLE.width / 2 + 0.1,
        sensorY,
        STAMP_TABLE.posZ - STAMP_TABLE.depth / 2 + 0.1
      ),
      new THREE.Vector3(
        STAMP_TABLE.posX + STAMP_TABLE.width / 2 - 0.1,
        sensorY + 1.5,
        STAMP_TABLE.posZ + STAMP_TABLE.depth / 2 - 0.1
      )
    );
  }

  private createTableMesh(): THREE.Group {
    const group = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x8B6B4A });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5C4033 });

    // Table top
    const topGeo = new THREE.BoxGeometry(STAMP_TABLE.width, 0.06, STAMP_TABLE.depth);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = STAMP_TABLE.height - 0.03;
    top.userData.surfaceType = 'stamp-table';
    group.add(top);
    this.tableTopMesh = top;

    // Legs
    const legH = STAMP_TABLE.height - 0.06;
    const legGeo = new THREE.BoxGeometry(STAMP_TABLE.legWidth, legH, STAMP_TABLE.legWidth);
    const hw = STAMP_TABLE.width / 2 - 0.15;
    const hd = STAMP_TABLE.depth / 2 - 0.15;
    const positions = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
    for (const [lx, lz] of positions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, legH / 2, lz);
      group.add(leg);
    }

    // Label — floating billboard, always faces the player
    const labelMesh = createFloatingLabel('貼郵票工作桌', { width: 0.9 });
    labelMesh.position.set(0, STAMP_TABLE.height + 0.5, 0);
    group.add(labelMesh);

    return group;
  }

  update(deltaTime: number): void {
    // Find boxes in sensor area
    const boxesInSensor: string[] = [];

    for (const obj of this.interactables.values()) {
      if (obj.isHeld) continue;
      if (!obj.rigidBody || !obj.mesh.visible) continue;

      const pos = obj.mesh.position;
      if (this.sensorBox.containsPoint(pos)) {
        // Check velocity
        const body = obj.rigidBody;
        const linVel = body.linvel();
        const angVel = body.angvel();
        const speed = Math.sqrt(linVel.x ** 2 + linVel.y ** 2 + linVel.z ** 2);
        const angSpeed = Math.sqrt(angVel.x ** 2 + angVel.y ** 2 + angVel.z ** 2);

        if (speed < this.velocityThreshold && angSpeed < this.velocityThreshold) {
          boxesInSensor.push(obj.id);
        }
      }
    }

    // Determine status
    if (boxesInSensor.length === 0) {
      this.readyPackageId = null;
      this.stableTimer = 0;
      this.statusMessage = 'empty';
      return;
    }

    if (boxesInSensor.length > 1) {
      this.readyPackageId = null;
      this.stableTimer = 0;
      this.statusMessage = 'too-many';
      return;
    }

    // Single box
    const boxId = boxesInSensor[0];
    const pkgData = this.packageDataMap.get(boxId);

    if (pkgData && pkgData.isStamped) {
      this.readyPackageId = null;
      this.statusMessage = 'already-stamped';
      return;
    }

    // Accumulate stable time
    this.stableTimer += deltaTime;
    if (this.stableTimer >= this.stableThreshold) {
      this.readyPackageId = boxId;
      this.statusMessage = 'ready';
    } else {
      this.readyPackageId = null;
      this.statusMessage = 'stabilizing';
    }
  }

  isPlayerNearTable(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - STAMP_TABLE.posX;
    const dz = playerPos.z - STAMP_TABLE.posZ;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }

  getWorkPoint(): THREE.Vector3 {
    return new THREE.Vector3(STAMP_TABLE.posX, FLOOR_Y + STAMP_TABLE.height + 0.01, STAMP_TABLE.posZ);
  }
}
