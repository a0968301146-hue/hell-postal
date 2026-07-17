import './style.css';
import { Game } from './game/game';

function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function showWebGLError(): void {
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `<div id="webgl-error">目前瀏覽器或裝置不支援WebGL，無法啟動遊戲。</div>`;
  }
}

async function init(): Promise<void> {
  if (!isWebGLSupported()) {
    showWebGLError();
    return;
  }

  try {
    const game = new Game();
    await game.start();
  } catch (error) {
    console.error('遊戲初始化失敗:', error);
  }
}

init();
