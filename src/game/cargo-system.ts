import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { InteractableObject, createInteractableObject } from './interactable-object';
import { CargoData, CargoSize, CargoType, createCargoData, pickCargoSize, pickLargeCargoSize } from './cargo-data';
import { FRONT_OFFICE, BACK_AREA, CARGO_SPAWN_CONFIG, LARGE_CARGO_SPAWN_POSITIONS } from './logistics-layout-data';

const CARGO_COLORS = [0x8b5a2b, 0xa0703a, 0x7a4e24, 0x966032, 0x8b6f47, 0x9a7040];
// Single consistent color for ALL large cargo — a deliberately different
// palette family (steel blue-grey) from normal cargo's browns, so large
// freight reads as visually distinct at a glance, per spec section 十.
const LARGE_CARGO_COLOR = 0x4a6fa5;

// Kept clear of the conveyor's own footprint (width 1.6, so |x| < ~0.9) —
// the back zone spawns cargo either side of the belt, never on it.
const RAMP_EXCLUSION_HALF_WIDTH = 1.0;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gridPositions(minX: number, maxX: number, minZ: number, maxZ: number, spacing: number): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  for (let x = minX + spacing / 2; x <= maxX - spacing / 2 + 0.001; x += spacing) {
    for (let z = minZ + spacing / 2; z <= maxZ - spacing / 2 + 0.001; z += spacing) {
      positions.push({ x, z });
    }
  }
  return positions;
}

export class CargoSystem {
  cargoDataMap: Map<string, CargoData> = new Map();
  private nextId = 1;
  private nextLargeId = 1;

  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>) {
    const frontSpots = shuffle(
      gridPositions(CARGO_SPAWN_CONFIG.frontZone.minX, CARGO_SPAWN_CONFIG.frontZone.maxX, CARGO_SPAWN_CONFIG.frontZone.minZ, CARGO_SPAWN_CONFIG.frontZone.maxZ, 0.6)
    ).slice(0, CARGO_SPAWN_CONFIG.frontOfficeCount);

    const backSpots = shuffle(
      gridPositions(CARGO_SPAWN_CONFIG.backZone.minX, CARGO_SPAWN_CONFIG.backZone.maxX, CARGO_SPAWN_CONFIG.backZone.minZ, CARGO_SPAWN_CONFIG.backZone.maxZ, 0.7)
        .filter(p => Math.abs(p.x) > RAMP_EXCLUSION_HALF_WIDTH)
    ).slice(0, CARGO_SPAWN_CONFIG.backAreaCount);

    for (const spot of frontSpots) this.spawnOne(scene, physics, interactables, spot.x, spot.z, FRONT_OFFICE.floorY);
    for (const spot of backSpots) this.spawnOne(scene, physics, interactables, spot.x, spot.z, BACK_AREA.floorY);

    // Large cargo — fixed spots in the back area's "大型貨物區" (zone-large),
    // not random like normal cargo, so the 4 items never overlap at spawn.
    LARGE_CARGO_SPAWN_POSITIONS.forEach((spot, i) => {
      this.spawnLarge(scene, physics, interactables, spot.x, spot.z, BACK_AREA.floorY, i);
    });
  }

  getCargoData(id: string): CargoData | undefined {
    return this.cargoDataMap.get(id);
  }

  private spawnOne(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    x: number, z: number, floorY: number
  ): void {
    const id = `cargo-normal-${this.nextId++}`;
    const size = pickCargoSize();
    const color = CARGO_COLORS[this.nextId % CARGO_COLORS.length];
    this.buildCargoItem(scene, physics, interactables, id, 'normal', size, x, z, floorY, color);
  }

  private spawnLarge(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    x: number, z: number, floorY: number, presetIndex: number
  ): void {
    const id = `cargo-large-${this.nextLargeId++}`;
    const size = pickLargeCargoSize(presetIndex);
    this.buildCargoItem(scene, physics, interactables, id, 'large', size, x, z, floorY, LARGE_CARGO_COLOR);
  }

  private buildCargoItem(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    id: string, cargoType: CargoType, size: CargoSize, x: number, z: number, floorY: number, color: number
  ): void {
    const y = floorY + size.height / 2 + 0.02;

    const geo = new THREE.BoxGeometry(size.width, size.height, size.depth);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    const data = createCargoData(id, cargoType);
    const obj = createInteractableObject(id, data.displayName, mesh, size.width, size.height, size.depth);
    const density = 250;
    const { body, collider } = physics.createBoxBody(x, y, z, size.width / 2, size.height / 2, size.depth / 2, density);
    obj.rigidBody = body;
    obj.collider = collider;

    interactables.set(id, obj);
    this.cargoDataMap.set(id, data);
  }
}
