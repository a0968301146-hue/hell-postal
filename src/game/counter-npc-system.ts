import * as THREE from 'three';
import { NPC_SPAWN_POINT } from './counter-layout-data';

const NPC_SPEED = 1.8; // m/s, simple slide-to-target movement
const ARRIVE_EPS = 0.05;
const NPC_COLORS = [0xd8a05a, 0xc98a70, 0xa8c07a, 0x8ab0c8, 0xc0a0d0];

export type NpcState = 'walking' | 'atCounter' | 'gone';

export interface NpcEntity {
  id: string;
  mesh: THREE.Group;
  target: THREE.Vector3;
  state: NpcState;
}

/** Simple capsule-body NPCs with slide-to-target movement — no pathfinding,
 * no skeleton/animation, just enough to visibly queue and walk. */
export class CounterNpcSystem {
  npcs: Map<string, NpcEntity> = new Map();
  private scene: THREE.Scene;
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawnNpc(): NpcEntity {
    const id = `npc-${this.nextId++}`;
    const mesh = this.createNpcMesh(this.nextId % NPC_COLORS.length);
    mesh.position.set(NPC_SPAWN_POINT.x, 0, NPC_SPAWN_POINT.z);
    this.scene.add(mesh);

    const entity: NpcEntity = { id, mesh, target: mesh.position.clone(), state: 'walking' };
    this.npcs.set(id, entity);
    return entity;
  }

  setTarget(npc: NpcEntity, x: number, z: number): void {
    npc.target.set(x, npc.mesh.position.y, z);
  }

  hasArrived(npc: NpcEntity): boolean {
    const dx = npc.target.x - npc.mesh.position.x;
    const dz = npc.target.z - npc.mesh.position.z;
    return Math.sqrt(dx * dx + dz * dz) < ARRIVE_EPS;
  }

  removeNpc(id: string): void {
    const npc = this.npcs.get(id);
    if (!npc) return;
    this.scene.remove(npc.mesh);
    npc.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material?.dispose();
      }
    });
    npc.state = 'gone';
    this.npcs.delete(id);
  }

  update(deltaTime: number): void {
    for (const npc of this.npcs.values()) {
      if (npc.state === 'gone') continue;
      const pos = npc.mesh.position;
      const dx = npc.target.x - pos.x;
      const dz = npc.target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < ARRIVE_EPS) continue;

      const step = Math.min(NPC_SPEED * deltaTime, dist);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;

      if (dist > 0.02) {
        npc.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  private createNpcMesh(colorIndex: number): THREE.Group {
    const group = new THREE.Group();
    const color = NPC_COLORS[colorIndex];
    const bodyMat = new THREE.MeshStandardMaterial({ color });

    const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const body = new THREE.Mesh(capsuleGeo, bodyMat);
    body.position.y = 0.28 + 0.45; // radius + half the cylindrical length, off the floor
    group.add(body);

    // Small dark "nose" so facing direction is visible even though a
    // capsule alone is rotationally symmetric.
    const noseGeo = new THREE.ConeGeometry(0.08, 0.18, 8);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.05, 0.3);
    group.add(nose);

    return group;
  }
}
