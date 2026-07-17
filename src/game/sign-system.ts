import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';

export interface SignData {
  signId: string;
  text: string;
  mesh: THREE.Group;
  isPlaced: boolean;
  isHeld: boolean;
}

export class SignSystem {
  signs: Map<string, SignData> = new Map();

  constructor(scene: THREE.Scene, physics: PhysicsSystem) {
    this.createSigns(scene, physics);
    console.log('Created wooden signs:', this.signs.size);
    if (this.signs.size < 6) {
      console.error(`告示牌生成失敗：預期 6，實際 ${this.signs.size}`);
    }
  }

  private createSigns(scene: THREE.Scene, physics: PhysicsSystem): void {
    const positions: [number, number][] = [
      [3, 0], [4.5, 0], [3, 1.5], [4.5, 1.5], [3, 3], [4.5, 3]
    ];

    for (let i = 0; i < 6; i++) {
      const id = `sign-${i + 1}`;
      const [x, z] = positions[i];
      const sign = this.createSignMesh(id, `可編輯告示牌 ${i + 1}`);
      sign.position.set(x, 0, z);
      scene.add(sign);

      // Physics collider (fixed body)
      const boardW = 1.2;
      const totalH = 1.6;
      physics.createStaticCuboid(x, totalH / 2, z, boardW / 2, totalH / 2, 0.08);

      this.signs.set(id, {
        signId: id,
        text: `告示牌 ${i + 1}`,
        mesh: sign,
        isPlaced: true,
        isHeld: false,
      });
    }
  }

  private createSignMesh(id: string, defaultText: string): THREE.Group {
    const group = new THREE.Group();
    group.userData.signId = id;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x654321 });

    // Board (1.2 x 0.7 x 0.06)
    const boardGeo = new THREE.BoxGeometry(1.2, 0.7, 0.06);
    const board = new THREE.Mesh(boardGeo, woodMat);
    board.position.y = 1.35;
    group.add(board);

    // Left post
    const postGeo = new THREE.BoxGeometry(0.06, 1.6, 0.06);
    const leftPost = new THREE.Mesh(postGeo, frameMat);
    leftPost.position.set(-0.55, 0.8, 0);
    group.add(leftPost);

    // Right post
    const rightPost = new THREE.Mesh(postGeo, frameMat);
    rightPost.position.set(0.55, 0.8, 0);
    group.add(rightPost);

    // Text on board face
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFF8DC';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(defaultText, 128, 64);

    const textTex = new THREE.CanvasTexture(canvas);
    const textGeo = new THREE.PlaneGeometry(1.1, 0.6);
    const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true });
    const textMesh = new THREE.Mesh(textGeo, textMat);
    textMesh.position.set(0, 1.35, 0.035);
    group.add(textMesh);

    return group;
  }
}
