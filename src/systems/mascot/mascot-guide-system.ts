import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { SettingsManager } from '../settings';
import { BACK_AREA, WALL_THICKNESS } from '../world-layout';
import { PLAYER_ROOM_DOOR } from '../../data/world/player-room-layout-data';
import { MascotGuideEntry, getAllAvailableMascotGuideEntries } from './mascot-guide-data';
import {
  createMascotGuideUi, showMascotGuideUi, hideMascotGuideUi, positionMascotGuideUi,
  renderMascotContent, MascotGuideUiHandle,
} from './mascot-guide-ui';

/** "新增兔子吉祥物" round — the rabbit's own fixed interactable id (spec二:
 * 固定放置，不需要玩家搬動). A single permanent instance, unlike the
 * per-day story NPCs — never spawned/despawned, built once at construction
 * and always present, matching the bulletin board / TV's own "permanent
 * fixture" convention (see interaction-system.ts's own BULLETIN_BOARD/
 * TELEVISION handling, which this round's own InteractionSystem changes
 * mirror exactly). */
export const MASCOT_INTERACTABLE_ID = 'rabbit-mascot';

/** "兔子吉祥物第三階段修改" round — moved from open-floor NE corner to
 * actually leaning against a real wall (spec一: "靠在牆壁旁／靠著牆"),
 * derived from the ACTUAL wall geometry world-layout-main-hall.ts's
 * buildBackArea() builds, not guessed:
 *
 * The north wall (z = BACK_AREA.minZ = 10) has two gaps cut into it —
 * CARGO_CHUTE_DOORWAY (west) and PLAYER_ROOM_DOOR (spec: 物流中心東北方牆角
 * 的新房間門口, centerX 7, halfWidth 1 → gap spans x 6..8) — leaving a real
 * SOLID segment from x = PLAYER_ROOM_DOOR's own right edge (8) to
 * BACK_AREA.maxX (10), thickness WALL_THICKNESS (0.2), i.e. the wall's own
 * face spans x 8..10, z 9.9..10.1. This is the actual wall the rabbit now
 * leans against — still the room's NE corner (just east of the new bedroom
 * door instead of centered in open floor), still nowhere near the
 * PLAYER_ROOM_DOOR gap or the east wall's own SEA_GATE opening (which starts
 * at z=12, south of this spot).
 *
 * MASCOT_POS_X sits at the midpoint of that 2m-wide solid segment (8..10).
 * MASCOT_POS_Z sits far enough south of the wall's own inner face (10.1) for
 * the table's north edge to clear it with a small real gap (not clipping),
 * close enough to read as "resting against the wall" rather than floating
 * in the middle of the room. */
const NORTH_WALL_INNER_FACE_Z = BACK_AREA.minZ + WALL_THICKNESS / 2;
const MASCOT_POS_X = (PLAYER_ROOM_DOOR.centerX + PLAYER_ROOM_DOOR.halfWidth + BACK_AREA.maxX) / 2;
const MASCOT_POS_Z = NORTH_WALL_INNER_FACE_Z + 0.35;

/** Small table (spec二: "小桌子／小平台", 現有風格最簡單合理的桌子 — plain
 * box top + 4 corner legs, same construction convention as every other small
 * table in this codebase). Height matches logistics-layout-data.ts's own
 * TV_TABLE_HEIGHT (0.75) rather than a low coffee-table height — real
 * WASD-only playtesting found the original 0.35m height sat the rabbit
 * ~0.9m below the player's own eye line, which at the ~1.5m distance a
 * player passes it at on their way out of the bedroom door requires a ~49°
 * downward glance to ever notice; a normal player walking through simply
 * never looks down that far and misses it entirely despite it rendering
 * correctly. Counter height cuts that to a much more natural ~19°. */
const TABLE_TOP_WIDTH = 0.5;
const TABLE_TOP_DEPTH = 0.5;
const TABLE_TOP_THICKNESS = 0.05;
const TABLE_HEIGHT = 0.75;
const TABLE_LEG_THICKNESS = 0.04;

/** Rabbit body (spec二: "大小約等同於小型包裹...不要做成大型NPC") — a plain
 * capsule + two ear boxes, matching this game's own "every character is a
 * plain primitive, no skeletal animation" convention (see
 * after-work-story-system.ts's own class doc comment). */
const RABBIT_BODY_RADIUS = 0.14;
const RABBIT_BODY_HEIGHT = 0.22; // capsule cylinder segment, excludes the two hemisphere caps
const RABBIT_EAR_HEIGHT = 0.16;
const RABBIT_EAR_WIDTH = 0.045;
const RABBIT_EAR_DEPTH = 0.03;

/** How far above the rabbit's own head the floating guide panel's anchor
 * point sits (spec三: "UI必須位於兔子的正上方"). */
const UI_ANCHOR_HEIGHT_ABOVE_HEAD = 0.35;

/** On-screen clamp for the panel's tracked position (see update() below) —
 * matches .mascot-guide-panel's own max-width/typical rendered height in
 * style.css closely enough to keep the panel fully on-screen at any
 * interaction distance/angle, without needing to measure the live DOM
 * element's actual rendered size every frame. Half-width shrunk to match
 * the smaller single-line panel ("兔子吉祥物第三階段修改" round spec五: 縮小
 * 到適合單句文字，不要像大型劇情對話框). */
const PANEL_HALF_WIDTH_PX = 150;
const PANEL_TOP_MARGIN_PX = 20;

/** "兔子吉祥物互動再次修改" round spec三 — walking this far from the rabbit
 * (horizontal XZ distance only, Y ignored per spec) while the bubble is
 * showing auto-closes it, no E press needed. */
const MASCOT_AUTO_CLOSE_DISTANCE_XZ = 5.0;

type MascotUiState = 'closed' | 'content';

/**
 * "新增兔子吉祥物" round — the rabbit mascot: a permanent, always-present
 * guide/lore character (spec一: "物流中心的吉祥物＋導覽者＋活歷史"), NOT part
 * of the daily special-NPC story/Choice system and NOT hard-bound to
 * ProtagonistDialogueSystem (spec一/八 — this class owns its own small
 * floating panel entirely, sharing no code with either).
 *
 * Interaction reuses the EXISTING shared InteractableObject/raycast pipeline
 * (spec三/八/十二: "沿用目前遊戲既有的Interactable/E interaction架構") — this
 * class only builds the mesh and registers it into the shared `interactables`
 * map with a fixed id; InteractionSystem itself resolves aiming/E-press and
 * calls `open()` here, the SAME "empty-handed-only, permanent fixture"
 * pattern already established for the bulletin board / television (see
 * interaction-system.ts's own BULLETIN_BOARD_INTERACTABLE_ID handling, which
 * this round's changes there mirror line-for-line).
 *
 * "兔子吉祥物互動方式修改" round — player-driven category/entry selection is
 * gone (spec一): E now goes straight from closed to a single random entry's
 * content (spec三: 每次互動隨機抽取一筆話語，只避免與上一筆重複).
 *
 * "兔子吉祥物第三階段修改" round — this is now an ENVIRONMENTAL prompt, not a
 * locked dialogue (spec七: "不要把兔子當成正式Dialogue"): open()/close() no
 * longer touch playerData.state or playerController input-lock at all (spec
 * 四: 玩家仍然可以正常WASD移動／不要鎖定玩家／不要進入劇情對話state), unlike
 * every other modal mini-UI in this codebase. It still owns its own document
 * keydown listener purely to catch E/Space/Escape while the small speech
 * bubble is showing, but that listener never blocks or intercepts movement
 * input — WASD keys are never touched here, only used elsewhere by
 * player-system.ts's own listener, which keeps running normally throughout.
 */
export class MascotGuideSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private settingsManager: SettingsManager;
  private getCurrentDay: () => number = () => 1;

  private uiHandle: MascotGuideUiHandle;
  private uiAnchorWorldPos: THREE.Vector3;

  private uiState: MascotUiState = 'closed';
  /** id of the entry shown last time the panel opened — passed to
   * pickRandomEntry() so the immediate-next pick never repeats it (spec三:
   * "至少避免上一筆內容立即再次出現"), reset to null on close is NOT needed
   * since consecutive OPENS (not closes) are what must differ. */
  private lastEntryId: string | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    settingsManager: SettingsManager, getCurrentDay?: () => number
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.settingsManager = settingsManager;
    if (getCurrentDay) this.getCurrentDay = getCurrentDay;

    this.uiAnchorWorldPos = this.buildMascot();
    this.uiHandle = createMascotGuideUi();

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  /** True while the guide panel is showing — read by other systems that
   * need to know a modal is active (mirrors AfterWorkStorySystem.isActive/
   * DreamComicSystem.isActive's own established "read-only public state"
   * convention), though nothing else needs it yet this round. */
  get isActive(): boolean {
    return this.uiState !== 'closed';
  }

  private buildMascot(): THREE.Vector3 {
    const floorY = BACK_AREA.floorY;

    // Table — plain box top + 4 corner legs.
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6234 });
    const table = new THREE.Group();
    const legH = TABLE_HEIGHT - TABLE_TOP_THICKNESS;
    const legGeo = new THREE.BoxGeometry(TABLE_LEG_THICKNESS, legH, TABLE_LEG_THICKNESS);
    const hw = TABLE_TOP_WIDTH / 2 - TABLE_LEG_THICKNESS / 2;
    const hd = TABLE_TOP_DEPTH / 2 - TABLE_LEG_THICKNESS / 2;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(lx, legH / 2, lz);
      table.add(leg);
    }
    const topGeo = new THREE.BoxGeometry(TABLE_TOP_WIDTH, TABLE_TOP_THICKNESS, TABLE_TOP_DEPTH);
    const top = new THREE.Mesh(topGeo, woodMat);
    top.position.y = TABLE_HEIGHT - TABLE_TOP_THICKNESS / 2;
    table.add(top);
    table.position.set(MASCOT_POS_X, floorY, MASCOT_POS_Z);
    this.scene.add(table);

    // Static collider for the table only (spec二: 不妨礙玩家動線 — the rabbit
    // itself never gets a collider/rigid body, matching "不參與一般貨物
    // Physics"; a small static footprint here just stops the player walking
    // straight through the table).
    this.physics.createStaticCuboid(
      MASCOT_POS_X, floorY + TABLE_HEIGHT / 2, MASCOT_POS_Z, TABLE_TOP_WIDTH / 2, TABLE_HEIGHT / 2, TABLE_TOP_DEPTH / 2
    );

    // Rabbit — sits centered on the table top, plain capsule body + two ear
    // boxes, cream/white fur.
    const furMat = new THREE.MeshStandardMaterial({ color: 0xf5ead8 });
    const rabbit = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(RABBIT_BODY_RADIUS, RABBIT_BODY_HEIGHT, 4, 8);
    const body = new THREE.Mesh(bodyGeo, furMat);
    const bodyLocalY = RABBIT_BODY_HEIGHT / 2 + RABBIT_BODY_RADIUS;
    body.position.y = bodyLocalY;
    rabbit.add(body);

    const earGeo = new THREE.BoxGeometry(RABBIT_EAR_WIDTH, RABBIT_EAR_HEIGHT, RABBIT_EAR_DEPTH);
    const earTopLocalY = bodyLocalY + RABBIT_BODY_RADIUS + RABBIT_EAR_HEIGHT / 2;
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, furMat);
      ear.position.set(ex * RABBIT_BODY_RADIUS * 0.5, earTopLocalY, 0);
      ear.rotation.z = ex * 0.15;
      rabbit.add(ear);
    }

    rabbit.position.set(MASCOT_POS_X, floorY + TABLE_HEIGHT, MASCOT_POS_Z);
    this.scene.add(rabbit);

    // Small warm accent light (same PointLight+emissive-sphere convention as
    // the player bedroom's own lamp, world-layout-side-rooms.ts) — this
    // corner of the hall sits far from the room's main light sources, and a
    // real playtest found the rabbit easy to walk right past unnoticed even
    // once raised to counter height. A warm glow gives it the same kind of
    // "something's here" visual cue in peripheral vision that the bulletin
    // board/TV get for free just by being large wall fixtures.
    const accentLight = new THREE.PointLight(0xffb060, 0.6, 4);
    accentLight.position.set(MASCOT_POS_X, floorY + TABLE_HEIGHT + 0.6, MASCOT_POS_Z);
    this.scene.add(accentLight);

    const rabbitTotalHeight = bodyLocalY + RABBIT_BODY_RADIUS + RABBIT_EAR_HEIGHT;
    const obj = createInteractableObject(
      MASCOT_INTERACTABLE_ID, '兔子', body, RABBIT_BODY_RADIUS * 2, rabbitTotalHeight, RABBIT_BODY_RADIUS * 2
    );
    // canPickUp=true only to satisfy the shared raycast filter's own
    // requirement — never actually meant to be picked up (same "permanent
    // fixture" pattern as the bulletin board / pallet racks / mail rack).
    obj.canPickUp = true;
    this.interactables.set(MASCOT_INTERACTABLE_ID, obj);

    return new THREE.Vector3(
      MASCOT_POS_X, floorY + TABLE_HEIGHT + rabbitTotalHeight + UI_ANCHOR_HEIGHT_ABOVE_HEAD, MASCOT_POS_Z
    );
  }

  /** Called by InteractionSystem EVERY time it's already confirmed the
   * player is empty-handed and aiming at the rabbit (spec一/十: same
   * dispatch site InteractionSystem already used before this round —
   * currentTarget.id === MASCOT_INTERACTABLE_ID + heldCount===0 — fires on
   * EVERY such E press, not just the first). Deliberately has no "already
   * open" guard anymore: closed→open and open→next-line are now the exact
   * same operation (pick a fresh random line, show it), so a second E press
   * while still aimed at the rabbit and the bubble already showing just
   * replaces the current line instead of no-op'ing (spec一: "對著兔子按E＝
   * 直接換下一句"). No player/input lock either way (spec五: 環境互動提示,
   * 玩家仍可正常WASD移動). */
  open(): void {
    const entry = this.pickRandomEntry();
    if (!entry) return; // no content available at all (shouldn't happen — MASCOT_GUIDE_ENTRIES is never empty)
    this.lastEntryId = entry.id;
    this.uiState = 'content';
    showMascotGuideUi(this.uiHandle);
    renderMascotContent(this.uiHandle, entry.lines[0]);
  }

  close(): void {
    if (this.uiState === 'closed') return;
    this.uiState = 'closed';
    hideMascotGuideUi(this.uiHandle);
  }

  /** Spec三: 每次互動從所有可用話語隨機抽取一筆，只避免與上一次連續重複——
   * no shuffle bag / history list, just a single "not equal to last shown
   * id" re-roll, which is trivially always satisfiable whenever more than
   * one entry is available. */
  private pickRandomEntry(): MascotGuideEntry | null {
    const pool = getAllAvailableMascotGuideEntries(this.getCurrentDay());
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    let candidate: MascotGuideEntry;
    do {
      candidate = pool[Math.floor(Math.random() * pool.length)];
    } while (candidate.id === this.lastEntryId);
    return candidate;
  }

  /** Must be called unconditionally every frame (matching every other
   * self-guarding system in this codebase, e.g. cargo-hook-system.ts) — a
   * no-op unless the guide panel is currently open. Repositions the DOM
   * panel to track the rabbit's own fixed world anchor point through the
   * current camera projection (spec三: "UI必須位於兔子的正上方"), so it stays
   * correctly placed regardless of which direction the player is looking.
   *
   * Also auto-closes once the player walks MASCOT_AUTO_CLOSE_DISTANCE_XZ
   * away (spec三/六: 離開兔子5公尺自動關閉, XZ-only, computed here rather than
   * adding a second per-frame query elsewhere). Uses camera.position for the
   * player's own XZ position rather than taking a playerData/physics
   * dependency just for this — player-system.ts's own update() sets
   * camera.position to the physics body's X/Z exactly (only Y differs, by a
   * fixed eye-height offset), so this is already the player's real world
   * position, not an approximation. */
  update(camera: THREE.PerspectiveCamera): void {
    if (this.uiState === 'closed') return;
    const distXZ = Math.hypot(camera.position.x - MASCOT_POS_X, camera.position.z - MASCOT_POS_Z);
    if (distXZ >= MASCOT_AUTO_CLOSE_DISTANCE_XZ) {
      this.close();
      return;
    }
    const projected = this.uiAnchorWorldPos.clone().project(camera);
    // Behind the camera — clamp off-screen rather than showing a mirrored
    // panel (a genuine edge case: the player can freely walk/turn away
    // while the bubble is up, spec四, so this triggers far more often now
    // than it would for a movement-locked modal).
    if (projected.z > 1) {
      positionMascotGuideUi(this.uiHandle, -9999, -9999);
      return;
    }
    const rawX = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const rawY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    // Clamp on-screen: the panel is anchored by its BOTTOM edge (CSS
    // translate(-50%,-100%)), so "top" in CSS terms sits a full panel-height
    // ABOVE the anchor point — at a normal interaction distance the anchor
    // can project close to the top of the viewport, pushing the entire
    // panel off-screen. Read the panel's own actual rendered height (it's
    // already in the DOM, just not necessarily visible) so the clamp works
    // regardless of how many lines/options are currently shown.
    const panelHeight = this.uiHandle.panel.offsetHeight;
    const x = Math.min(Math.max(rawX, PANEL_HALF_WIDTH_PX), window.innerWidth - PANEL_HALF_WIDTH_PX);
    const y = Math.max(rawY, panelHeight + PANEL_TOP_MARGIN_PX);
    positionMascotGuideUi(this.uiHandle, x, y);
  }

  /** Space/Escape always close the bubble outright. E is here too, but only
   * ever actually reaches this handler when the player is NOT aimed at the
   * rabbit — InteractionSystem's own dispatch (currentTarget.id ===
   * MASCOT_INTERACTABLE_ID) calls event.stopImmediatePropagation() before
   * this document-level listener ever sees an E press made WHILE aimed at
   * the rabbit, routing that case to open() instead (next-line, spec一/七).
   * So in practice: aimed + E → next line (via InteractionSystem→open());
   * not aimed + E → close (via here) — exactly spec二's "玩家轉身看向其他地方
   * 時E不應該換下一句". Deliberately does NOT touch WASD in any way — that's
   * handled entirely by player-system.ts's own separate listener. */
  private onKeyDown(event: KeyboardEvent): void {
    if (this.uiState === 'closed' || event.repeat) return;
    if (event.code === 'Escape') { event.preventDefault(); this.close(); return; }
    const bindings = this.settingsManager.inputBindings;
    const isCloseKey = event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code);
    if (!isCloseKey) return;
    event.preventDefault();
    this.close();
  }
}
