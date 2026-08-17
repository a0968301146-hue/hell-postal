import * as THREE from 'three';

// Convention: North = -Z, East = +X, South = +Z, West = -X.
const DIRECTIONS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];

export class CompassUI {
  private el: HTMLElement;
  private headingEl: HTMLElement;
  private degreesEl: HTMLElement;
  private forward = new THREE.Vector3();

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'compass';

    this.headingEl = document.createElement('div');
    this.headingEl.id = 'compass-heading';
    this.el.appendChild(this.headingEl);

    this.degreesEl = document.createElement('div');
    this.degreesEl.id = 'compass-degrees';
    this.el.appendChild(this.degreesEl);

    document.body.appendChild(this.el);
  }

  update(camera: THREE.Camera): void {
    camera.getWorldDirection(this.forward);
    let deg = THREE.MathUtils.radToDeg(Math.atan2(this.forward.x, -this.forward.z));
    if (deg < 0) deg += 360;

    const index = Math.round(deg / 45) % 8;
    this.headingEl.textContent = DIRECTIONS[index];
    this.degreesEl.textContent = `${Math.round(deg)}°`;
  }
}
