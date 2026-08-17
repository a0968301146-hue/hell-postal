import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { PlayerController } from '../player';
import { SettingsManager } from '../settings';
import { BACK_AREA } from '../world-layout';
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

/** East-North corner of the main hall (spec二: 房間東北方), inset from both
 * walls so the table reads as a deliberate corner fixture rather than
 * blocking the north cargo-chute doorway (centered x -1.8..1.8) or the east
 * wall's own pier opening (PIER starts exactly at BACK_AREA.maxX). */
const MASCOT_POS_X = BACK_AREA.maxX - 2.5;
const MASCOT_POS_Z = BACK_AREA.minZ + 2.5;

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
 * element's actual rendered size every frame. */
const PANEL_HALF_WIDTH_PX = 190;
const PANEL_TOP_MARGIN_PX = 24;

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
 * content (spec三: 每次互動隨機抽取一筆話語，只避免與上一筆重複). Once open,
 * this class still owns its OWN keydown listener, just for content-advance/
 * close only now — same "shared raycast to open, then a self-contained modal
 * listener while active" shape every other locked mini-UI in this codebase
 * already uses (AfterWorkStorySystem's own dialogue input, PalletSystem's
 * F-key rope listener, etc.), not a second independent input architecture
 * (spec三/九).
 */
export class MascotGuideSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private playerController: PlayerController;
  private settingsManager: SettingsManager;
  private getCurrentDay: () => number = () => 1;

  private uiHandle: MascotGuideUiHandle;
  private uiAnchorWorldPos: THREE.Vector3;

  private uiState: MascotUiState = 'closed';
  private activeEntry: MascotGuideEntry | null = null;
  private lineIndex = 0;
  /** id of the entry shown last time the panel opened — passed to
   * pickRandomEntry() so the immediate-next pick never repeats it (spec三:
   * "至少避免上一筆內容立即再次出現"), reset to null on close is NOT needed
   * since consecutive OPENS (not closes) are what must differ. */
  private lastEntryId: string | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, playerController: PlayerController, settingsManager: SettingsManager,
    getCurrentDay?: () => number
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.playerData = playerData;
    this.playerController = playerController;
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

  /** Called by InteractionSystem once it's already confirmed the player is
   * empty-handed and aiming at the rabbit (spec九: 避免玩家同時操作貨物 — the
   * SAME "heldCount===0" gate the bulletin board's own onOpenUpgradeMenu call
   * site already enforces before ever calling this). Goes straight to a
   * random entry's content — no category/entry selection step anymore. */
  open(): void {
    if (this.uiState !== 'closed') return;
    const entry = this.pickRandomEntry();
    if (!entry) return; // no content available at all (shouldn't happen — MASCOT_GUIDE_ENTRIES is never empty)
    this.playerData.state = 'stamping-minigame';
    this.playerController.setInputEnabled(false);
    showMascotGuideUi(this.uiHandle);
    this.beginEntry(entry);
  }

  close(): void {
    if (this.uiState === 'closed') return;
    this.uiState = 'closed';
    this.activeEntry = null;
    hideMascotGuideUi(this.uiHandle);
    this.playerData.state = 'empty-handed';
    this.playerController.setInputEnabled(true);
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
   * correctly placed regardless of which direction the player is looking. */
  update(camera: THREE.PerspectiveCamera): void {
    if (this.uiState === 'closed') return;
    const projected = this.uiAnchorWorldPos.clone().project(camera);
    // Behind the camera — clamp off-screen rather than showing a mirrored
    // panel (a genuine edge case: the player can still look away with the
    // mouse while movement is locked, see this class's own doc comment).
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

  private onKeyDown(event: KeyboardEvent): void {
    if (this.uiState === 'closed' || event.repeat) return;

    if (event.code === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    const bindings = this.settingsManager.inputBindings;
    const isAdvanceKey = event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code);
    if (!isAdvanceKey) return;
    event.preventDefault();
    this.advanceContent();
  }

  private beginEntry(entry: MascotGuideEntry): void {
    this.activeEntry = entry;
    this.lastEntryId = entry.id;
    this.lineIndex = 0;
    this.uiState = 'content';
    renderMascotContent(this.uiHandle, entry.title, entry.lines[0], entry.lines.length === 1);
  }

  private advanceContent(): void {
    if (!this.activeEntry) return;
    if (this.lineIndex >= this.activeEntry.lines.length - 1) {
      this.close();
      return;
    }
    this.lineIndex++;
    const isLast = this.lineIndex === this.activeEntry.lines.length - 1;
    renderMascotContent(this.uiHandle, this.activeEntry.title, this.activeEntry.lines[this.lineIndex], isLast);
  }
}
