import * as THREE from 'three';
import { InteractableObject } from './interactable-object';
import { PhysicsSystem } from './physics-system';
import { SCENE_CONFIG } from './scene-manager';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from './world-label-system';

const FLOOR_Y = BACK_AREA.floorY;

export const ENVELOPE_TABLE = {
  width: 1.6,
  depth: 1.0,
  height: 0.9,
  legWidth: 0.08,
  // Relocated into the back-area work furniture cluster (see logistics-layout-data.ts)
  posX: -8,
  posZ: 14.5,
};

export class EnvelopeStampStation {
  tableMesh!: THREE.Group;
  tableTopMesh!: THREE.Mesh;
  private sensorBox!: THREE.Box3;
  private interactables: Map<string, InteractableObject>;
  private enabled: boolean;
  private stableTimer = 0;
  private stableThreshold = 0.25;
  private velocityThreshold = 0.5;

  readyEnvelopeId: string | null = null;
  statusMessage: string = '';

  /** `enabled` gates the whole table out of the scene this round (spec
   * "每日貨品清空核心流程" section 三 — see feature-flags.ts
   * ENABLE_LEGACY_MAIL_FLOW). game.ts skips calling update() entirely when
   * disabled, so tableMesh/sensorBox staying unbuilt is safe — the only
   * other public method, isPlayerNearTable(), is guarded below. */
  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    enabled: boolean
  ) {
    this.interactables = interactables;
    this.enabled = enabled;
    if (!enabled) return;

    this.tableMesh = this.createTableMesh();
    this.tableMesh.position.set(ENVELOPE_TABLE.posX, FLOOR_Y, ENVELOPE_TABLE.posZ);
    scene.add(this.tableMesh);
    this.tableMesh.updateMatrixWorld(true);

    // Physics collider for table top
    const topThickness = 0.05;
    physics.createStaticCuboid(
      ENVELOPE_TABLE.posX, FLOOR_Y + ENVELOPE_TABLE.height - topThickness / 2, ENVELOPE_TABLE.posZ,
      ENVELOPE_TABLE.width / 2, topThickness / 2, ENVELOPE_TABLE.depth / 2
    );

    // Legs
    const legH = ENVELOPE_TABLE.height - topThickness;
    const hw = ENVELOPE_TABLE.width / 2 - 0.1;
    const hd = ENVELOPE_TABLE.depth / 2 - 0.1;
    const legHx = ENVELOPE_TABLE.legWidth / 2;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      physics.createStaticCuboid(
        ENVELOPE_TABLE.posX + lx, FLOOR_Y + legH / 2, ENVELOPE_TABLE.posZ + lz,
        legHx, legH / 2, legHx
      );
    }

    // Sensor
    this.sensorBox = new THREE.Box3(
      new THREE.Vector3(
        ENVELOPE_TABLE.posX - ENVELOPE_TABLE.width / 2 + 0.05,
        FLOOR_Y + ENVELOPE_TABLE.height,
        ENVELOPE_TABLE.posZ - ENVELOPE_TABLE.depth / 2 + 0.05
      ),
      new THREE.Vector3(
        ENVELOPE_TABLE.posX + ENVELOPE_TABLE.width / 2 - 0.05,
        FLOOR_Y + ENVELOPE_TABLE.height + 0.5,
        ENVELOPE_TABLE.posZ + ENVELOPE_TABLE.depth / 2 - 0.05
      )
    );
  }

  private createTableMesh(): THREE.Group {
    const group = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x6B8E6A });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5C4033 });

    const topGeo = new THREE.BoxGeometry(ENVELOPE_TABLE.width, 0.05, ENVELOPE_TABLE.depth);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = ENVELOPE_TABLE.height - 0.025;
    top.userData.surfaceType = 'envelope-table';
    group.add(top);
    this.tableTopMesh = top;

    const legH = ENVELOPE_TABLE.height - 0.05;
    const legGeo = new THREE.BoxGeometry(ENVELOPE_TABLE.legWidth, legH, ENVELOPE_TABLE.legWidth);
    const hw = ENVELOPE_TABLE.width / 2 - 0.1;
    const hd = ENVELOPE_TABLE.depth / 2 - 0.1;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, legH / 2, lz);
      group.add(leg);
    }

    // Label — floating billboard, always faces the player
    const labelMesh = createFloatingLabel('信封貼郵票桌', { width: 0.8 });
    labelMesh.position.set(0, ENVELOPE_TABLE.height + 0.4, 0);
    group.add(labelMesh);

    return group;
  }

  update(deltaTime: number): void {
    // Find envelopes in sensor (envelopes have height ~0.03, very thin)
    const envelopesInSensor: string[] = [];

    for (const obj of this.interactables.values()) {
      if (obj.isHeld) continue;
      if (!obj.rigidBody || !obj.mesh.visible) continue;
      // Only detect envelopes (thin objects)
      if (obj.height > 0.05) continue; // skip packages

      const pos = obj.mesh.position;
      if (this.sensorBox.containsPoint(pos)) {
        const body = obj.rigidBody;
        const lv = body.linvel();
        const av = body.angvel();
        const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
        const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
        if (speed < this.velocityThreshold && angSpeed < this.velocityThreshold) {
          envelopesInSensor.push(obj.id);
        }
      }
    }

    if (envelopesInSensor.length === 0) {
      this.readyEnvelopeId = null;
      this.stableTimer = 0;
      this.statusMessage = 'empty';
      return;
    }

    if (envelopesInSensor.length > 1) {
      this.readyEnvelopeId = null;
      this.stableTimer = 0;
      this.statusMessage = 'too-many';
      return;
    }

    const envId = envelopesInSensor[0];
    const obj = this.interactables.get(envId);
    if (obj?.packageData?.isStamped) {
      this.readyEnvelopeId = null;
      this.statusMessage = 'already-stamped';
      return;
    }

    this.stableTimer += deltaTime;
    if (this.stableTimer >= this.stableThreshold) {
      this.readyEnvelopeId = envId;
      this.statusMessage = 'ready';
    } else {
      this.readyEnvelopeId = null;
      this.statusMessage = 'stabilizing';
    }
  }

  isPlayerNearTable(playerPos: THREE.Vector3): boolean {
    if (!this.enabled) return false;
    const dx = playerPos.x - ENVELOPE_TABLE.posX;
    const dz = playerPos.z - ENVELOPE_TABLE.posZ;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }
}
