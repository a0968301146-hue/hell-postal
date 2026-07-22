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
  hideLoadingScreen();
}

function hideLoadingScreen(): void {
  document.getElementById('loading-screen')?.classList.add('hidden');
}

function showLoadingError(message: string): void {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('loading-error');
    loadingScreen.innerHTML = `<p>遊戲初始化失敗，請重新整理頁面再試一次。</p><p>${message}</p>`;
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
    hideLoadingScreen();
  } catch (error) {
    console.error('遊戲初始化失敗:', error);
    showLoadingError(error instanceof Error ? error.message : String(error));
  }
}

init();
