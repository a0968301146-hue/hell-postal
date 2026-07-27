import * as THREE from 'three';
import { InteractableObject } from '../shared/types/interactable';

const BELT_SPEED = 2.5; // m/s along the slope, top -> bottom
const CAPTURE_MARGIN = 0.3; // extra length past the physical ramp ends still counts as "on belt"
const SURFACE_MIN = -0.1; // how far below the belt centerline still counts as resting on it
const SURFACE_MAX = 0.55; // how far above the belt centerline still counts (catches thrown/stacked cargo of varying sizes)
const TEXTURE_SCROLL_SPEED = 0.6; // purely visual "is it running" cue

/**
 * Drives cargo down the ramp: any dynamic object whose center falls inside
 * the ramp's oriented capture volume gets its velocity forced along the
 * downhill direction every frame, so it can't stall, snag on friction, or
 * slide back upward mid-belt. Not a real conveyor mesh animation — just
 * enough for the prototype to visibly and functionally "run".
 */
export class ConveyorSystem {
  private interactables: Map<string, InteractableObject>;
  private center: THREE.Vector3;
  private alongDir: THREE.Vector3; // unit vector, top -> bottom
  private upDir: THREE.Vector3; // unit vector, perpendicular to the slope, pointing up off its surface
  private halfWidth: number;
  private halfLength: number;
  private texture: THREE.Texture | null;
  private onFirstUse?: () => void;
  private hasFiredFirstUse = false;

  constructor(
    interactables: Map<string, InteractableObject>,
    topPos: THREE.Vector3,
    bottomPos: THREE.Vector3,
    width: number,
    texture: THREE.Texture | null = null,
    onFirstUse?: () => void
  ) {
    this.interactables = interactables;
    this.onFirstUse = onFirstUse;
    this.center = topPos.clone().add(bottomPos).multiplyScalar(0.5);
    this.alongDir = bottomPos.clone().sub(topPos).normalize();
    // alongDir has no X component (the ramp only tilts around X), so a
    // perpendicular "up off the surface" direction stays in the YZ plane too.
    this.upDir = new THREE.Vector3(0, -this.alongDir.z, this.alongDir.y).normalize();
    if (this.upDir.y < 0) this.upDir.negate(); // keep it pointing generally upward
    this.halfWidth = width / 2;
    this.halfLength = topPos.distanceTo(bottomPos) / 2;
    this.texture = texture;
  }

  update(deltaTime: number): void {
    if (this.texture) {
      this.texture.offset.y -= TEXTURE_SCROLL_SPEED * deltaTime;
    }

    const belt = this.alongDir.clone().multiplyScalar(BELT_SPEED);
    const rel = new THREE.Vector3();

    for (const obj of this.interactables.values()) {
      if (obj.isHeld || !obj.rigidBody || !obj.mesh.visible) continue;

      rel.copy(obj.mesh.position).sub(this.center);
      const widthCoord = rel.x;
      const alongCoord = rel.dot(this.alongDir);
      const upCoord = rel.dot(this.upDir);

      if (Math.abs(widthCoord) > this.halfWidth) continue;
      if (Math.abs(alongCoord) > this.halfLength + CAPTURE_MARGIN) continue;
      if (upCoord < SURFACE_MIN || upCoord > SURFACE_MAX) continue;

      const currentVel = obj.rigidBody.linvel();
      obj.rigidBody.setLinvel({ x: belt.x, y: currentVel.y, z: belt.z }, true);

      if (!this.hasFiredFirstUse) {
        this.hasFiredFirstUse = true;
        this.onFirstUse?.();
      }
    }
  }
}
