import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { createThreeRenderer } from '../adapters/three/three-renderer';
import { HUD } from '../systems/hud';
import { PauseManager } from '../core/pause-manager';
import { SettingsManager } from '../systems/settings';
import { InteractableObject } from '../shared/types/interactable';
import { PlayerInteractionData, createPlayerInteractionData } from '../core/game-state';
import { GameEventBus } from '../core/game-events';
import { createLogisticsScene, SceneData } from '../systems/world-layout';

/** The engine/UI-level singletons every system is built from — created ONCE
 * per game session (see createGameContext below) and injected into each
 * system's own constructor by app/game-app.ts, rather than systems reaching
 * out to globals. Systems still take their OWN specific dependencies as
 * individual constructor params (unchanged from before this refactor) —
 * GameContext is where game-app.ts reads those params FROM, not a
 * service-locator systems call into directly. */
export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  physics: PhysicsSystem;
  hud: HUD;
  pauseManager: PauseManager;
  settingsManager: SettingsManager;
  playerData: PlayerInteractionData;
  interactables: Map<string, InteractableObject>;
  /** Non-interactable scene surfaces (floors) World Layout handed back when
   * building the level — see logistics-layout-data.ts-driven
   * createLogisticsScene(). */
  sceneData: SceneData;
  events: GameEventBus;
}

/** Builds every engine-level singleton in the correct order (physics must
 * finish async init before anything touches it) and builds the level
 * geometry (World Layout's createLogisticsScene) last, once physics exists
 * for it to register colliders against. */
export async function createGameContext(): Promise<GameContext> {
  const { scene, camera, renderer } = createThreeRenderer();

  const physics = new PhysicsSystem();
  await physics.init();

  const hud = new HUD();
  const pauseManager = new PauseManager();
  const settingsManager = new SettingsManager(camera, renderer);
  const playerData = createPlayerInteractionData();
  const events = new GameEventBus();

  const sceneData = createLogisticsScene(scene, physics);

  return {
    scene, camera, renderer, physics, hud, pauseManager, settingsManager, playerData,
    interactables: sceneData.interactables, sceneData, events,
  };
}
