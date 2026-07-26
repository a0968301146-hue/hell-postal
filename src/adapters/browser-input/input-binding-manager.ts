// Centralized key-binding data + lookup, per spec section 七 ("按鍵設定不得
// 繼續散落硬編碼在不同系統" / "建立集中輸入設定資料"). Every system that reads
// a specific key (PlayerController, PickupSystem, InteractionSystem,
// ManualUI) should call InputBindingManager.matches(action, event.code)
// instead of comparing event.code to a hardcoded literal.
//
// NOTE (disclosed rewiring status — see completion report for the full
// list): "interact" (站台/拿取 E) and "pickupPlace" (拿取/放置) are two
// separate bindable entries per spec's requested list, but in the existing
// architecture both are actually driven by ONE physical key/handler
// (InteractionSystem's single 'KeyE' branch does both raycAST pickup AND
// station interaction — there is no separate PickupSystem key listener for
// "pick up"). Rather than leave one of the two silently dead, both bindings
// are wired to the SAME handler: changing either one rebinds that shared E
// action. "cancel" is stored here but NOT wired — placement-cancel is
// currently a right mouse button, not a keyboard code, and doesn't fit this
// code-based rebind flow without a larger PickupSystem change.

export type InputAction =
  | 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight'
  | 'sprint' | 'jump' | 'interact' | 'pickupPlace' | 'chargeThrow'
  | 'cancel' | 'openManual';

export const DEFAULT_BINDINGS: Record<InputAction, string> = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
  pickupPlace: 'KeyE',
  chargeThrow: 'KeyQ',
  cancel: 'Escape',
  openManual: 'Tab',
};

export const ACTION_ORDER: InputAction[] = [
  'moveForward', 'moveBackward', 'moveLeft', 'moveRight',
  'sprint', 'jump', 'interact', 'pickupPlace', 'chargeThrow', 'cancel', 'openManual',
];

export const ACTION_LABELS: Record<InputAction, string> = {
  moveForward: '前進',
  moveBackward: '後退',
  moveLeft: '向左移動',
  moveRight: '向右移動',
  sprint: '跑步',
  jump: '跳躍',
  interact: '互動',
  pickupPlace: '拾取／放置',
  chargeThrow: '蓄力投擲',
  cancel: '取消',
  openManual: '開啟物流手冊',
};

/** Actions currently wired to real gameplay behavior (see class doc above
 * for "interact"/"pickupPlace" sharing one handler, and "cancel" not being
 * wired). Used by the UI to label unwired rows honestly rather than
 * implying every rebind takes effect. */
export const UNWIRED_ACTIONS: ReadonlySet<InputAction> = new Set(['cancel']);

function readableKeyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const specials: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', Tab: 'Tab',
    ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt',
  };
  return specials[code] ?? code;
}

export interface RebindResult {
  ok: boolean;
  conflictWith?: InputAction;
}

export class InputBindingManager {
  private bindings: Record<InputAction, string>;

  constructor(saved?: Partial<Record<InputAction, string>>) {
    this.bindings = { ...DEFAULT_BINDINGS, ...saved };
  }

  get(action: InputAction): string {
    return this.bindings[action];
  }

  getLabel(action: InputAction): string {
    return readableKeyName(this.bindings[action]);
  }

  getAll(): Record<InputAction, string> {
    return { ...this.bindings };
  }

  /** True if `code` matches the action's currently bound key. */
  matches(action: InputAction, code: string): boolean {
    return this.bindings[action] === code;
  }

  /** First action (other than `exceptAction`) currently bound to `code`, if any. */
  findConflict(code: string, exceptAction: InputAction): InputAction | null {
    for (const action of ACTION_ORDER) {
      if (action === exceptAction) continue;
      if (this.bindings[action] === code) return action;
    }
    return null;
  }

  rebind(action: InputAction, code: string): RebindResult {
    const conflict = this.findConflict(code, action);
    if (conflict) return { ok: false, conflictWith: conflict };
    this.bindings[action] = code;
    return { ok: true };
  }

  resetToDefaults(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
  }
}

export { readableKeyName };
