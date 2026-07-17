import { STAMPS, StampInfo } from './stamp-data';
import { PackageData, createStampVisual, createOverweightLabel } from './package-data';
import { InteractableObject } from './interactable-object';

export type MinigameResult = 'completed' | 'cancelled';

export class StampMinigame {
  private overlay: HTMLElement | null = null;
  private pkg: PackageData;
  private obj: InteractableObject;
  private onComplete: (result: MinigameResult) => void;
  private draggedStamp: StampInfo | null = null;
  private dragEl: HTMLElement | null = null;

  constructor(pkg: PackageData, obj: InteractableObject, onComplete: (result: MinigameResult) => void) {
    this.pkg = pkg;
    this.obj = obj;
    this.onComplete = onComplete;
    this.createUI();
  }

  private createUI(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'stamp-minigame-overlay';
    this.overlay.innerHTML = `
      <div class="stamp-game-container">
        <div class="stamp-game-header">
          <h2>貼郵票工作桌</h2>
          <p class="stamp-instruction">查看地址，選擇正確郵票拖到郵票框</p>
        </div>
        <div class="stamp-game-body">
          <div class="address-panel">
            <div class="address-card">
              <p class="address-recipient">${this.pkg.recipientName}</p>
              <p class="address-street">${this.pkg.streetLine}</p>
              <p class="address-dest">${this.pkg.destinationName}</p>
            </div>
            <div class="stamp-target" id="stamp-drop-zone">
              <span>將郵票拖到此處</span>
            </div>
          </div>
          <div class="stamps-panel">
            ${STAMPS.map(s => `
              <div class="stamp-item" data-stamp-id="${s.stampId}" draggable="false">
                <span class="stamp-icon">${s.icon}</span>
                <span class="stamp-name">${s.displayName}</span>
              </div>
            `).join('')}
            ${this.getOverweightButtonHtml()}
          </div>
        </div>
        <div class="stamp-game-footer">
          <p>Esc：取消</p>
          <p id="stamp-feedback"></p>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    // Event listeners
    this.overlay.querySelectorAll('.stamp-item').forEach(el => {
      el.addEventListener('mousedown', (e) => this.onStampMouseDown(e as MouseEvent, el as HTMLElement));
    });

    // Overweight label button
    const owBtn = this.overlay.querySelector('#overweight-label-btn');
    if (owBtn) {
      owBtn.addEventListener('click', () => this.onOverweightLabelClick());
    }

    document.addEventListener('keydown', this.onKeyDown);
  }

  private getOverweightButtonHtml(): string {
    if (!this.pkg.hasBeenWeighed) {
      return `<div class="stamp-item overweight-disabled"><span class="stamp-icon">⚖️</span><span class="stamp-name">請先秤重</span></div>`;
    }
    if (!this.pkg.isOverweight) {
      return `<div class="stamp-item overweight-disabled"><span class="stamp-icon">✓</span><span class="stamp-name">重量正常</span></div>`;
    }
    if (this.pkg.hasOverweightLabel) {
      return `<div class="stamp-item overweight-disabled"><span class="stamp-icon">⚠️</span><span class="stamp-name">已貼過重標示</span></div>`;
    }
    return `<div class="stamp-item overweight-btn" id="overweight-label-btn"><span class="stamp-icon">⚠️</span><span class="stamp-name">貼過重貼紙</span></div>`;
  }

  private onOverweightLabelClick(): void {
    if (!this.pkg.hasBeenWeighed || !this.pkg.isOverweight || this.pkg.hasOverweightLabel) return;

    this.pkg.hasOverweightLabel = true;

    // Create and attach overweight label mesh to the package
    const labelMesh = createOverweightLabel(this.obj.width, this.obj.height);
    this.obj.mesh.add(labelMesh);
    this.pkg.overweightLabelMesh = labelMesh;

    // Visual feedback
    const feedback = this.overlay?.querySelector('#stamp-feedback') as HTMLElement;
    if (feedback) {
      feedback.textContent = '✓ 過重標示已貼上';
      feedback.style.color = '#ff8844';
    }
    const btn = this.overlay?.querySelector('#overweight-label-btn');
    if (btn) {
      btn.classList.add('overweight-disabled');
      btn.innerHTML = '<span class="stamp-icon">⚠️</span><span class="stamp-name">已貼過重標示</span>';
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      this.close('cancelled');
    }
  };

  private onStampMouseDown(e: MouseEvent, el: HTMLElement): void {
    e.preventDefault();
    const stampId = el.dataset.stampId!;
    this.draggedStamp = STAMPS.find(s => s.stampId === stampId) || null;
    if (!this.draggedStamp) return;

    // Create drag element
    this.dragEl = el.cloneNode(true) as HTMLElement;
    this.dragEl.classList.add('stamp-dragging');
    this.dragEl.style.position = 'fixed';
    this.dragEl.style.pointerEvents = 'none';
    this.dragEl.style.zIndex = '10001';
    document.body.appendChild(this.dragEl);
    this.moveDragEl(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent) => this.moveDragEl(ev.clientX, ev.clientY);
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.onStampDrop(ev);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private moveDragEl(x: number, y: number): void {
    if (!this.dragEl) return;
    this.dragEl.style.left = `${x - 30}px`;
    this.dragEl.style.top = `${y - 30}px`;
  }

  private onStampDrop(e: MouseEvent): void {
    // Remove drag element
    if (this.dragEl) {
      this.dragEl.remove();
      this.dragEl = null;
    }

    if (!this.draggedStamp) return;

    // Check if dropped on target
    const dropZone = document.getElementById('stamp-drop-zone');
    if (!dropZone) return;

    const rect = dropZone.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      // Dropped on target - check answer
      if (this.draggedStamp.stampId === this.pkg.requiredStampId) {
        this.onCorrectStamp();
      } else {
        this.onWrongStamp();
      }
    }
    this.draggedStamp = null;
  }

  private onCorrectStamp(): void {
    const feedback = this.overlay?.querySelector('#stamp-feedback') as HTMLElement;
    const dropZone = document.getElementById('stamp-drop-zone');
    if (feedback) {
      feedback.textContent = '✓ 貼票完成！';
      feedback.style.color = '#44ff44';
    }
    if (dropZone) {
      dropZone.style.borderColor = '#44ff44';
      dropZone.style.background = 'rgba(0,255,0,0.1)';
      dropZone.innerHTML = `<span class="stamp-icon">${this.draggedStamp!.icon}</span>`;
    }

    // Update package data
    this.pkg.isStamped = true;
    this.pkg.appliedStampId = this.draggedStamp!.stampId;

    // Add stamp visual to box mesh
    const stampMesh = createStampVisual(this.draggedStamp!.stampId, this.obj.width);
    // Position on top of box (local to mesh)
    stampMesh.position.y = this.obj.height / 2 + 0.002;
    this.obj.mesh.add(stampMesh);
    this.pkg.stampVisualMesh = stampMesh;

    // Auto close after delay
    setTimeout(() => this.close('completed'), 1000);
  }

  private onWrongStamp(): void {
    const feedback = this.overlay?.querySelector('#stamp-feedback') as HTMLElement;
    const dropZone = document.getElementById('stamp-drop-zone');
    if (feedback) {
      feedback.textContent = '✗ 郵票與地址不符，請重新確認';
      feedback.style.color = '#ff4444';
    }
    if (dropZone) {
      dropZone.classList.add('shake');
      dropZone.style.borderColor = '#ff4444';
      setTimeout(() => {
        dropZone.classList.remove('shake');
        dropZone.style.borderColor = '';
      }, 500);
    }
    setTimeout(() => {
      if (feedback) feedback.textContent = '';
    }, 2000);
  }

  private close(result: MinigameResult): void {
    document.removeEventListener('keydown', this.onKeyDown);
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.dragEl) {
      this.dragEl.remove();
      this.dragEl = null;
    }
    this.onComplete(result);
  }
}
