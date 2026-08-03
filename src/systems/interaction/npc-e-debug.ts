/** Structured tracer + ON-SCREEN debug panel for "raycast hits NPC, prompt
 * shows, but a real physical E press does nothing" debugging ("Fix trusted
 * keyboard NPC interaction" round) — activated via a URL query param
 * (?debugNpcE=1), checked at RUNTIME rather than a build-time constant, so
 * it can be turned on directly on the deployed production site without a
 * rebuild — the whole point being to let a real user capture a real trace
 * from their own machine/IME/keyboard, not just a synthetic test run.
 * Renders into an actual DOM panel (not console-only — spec: "不要只輸出
 * console，因為我要直接從正式站畫面確認"), pinned to the left edge of the
 * screen, updated once per real E press. */

let cachedEnabled: boolean | null = null;

/** Cached after the first check — the query string doesn't change mid
 * play-session, and re-parsing location.search on every keypress would be
 * wasteful. */
export function isNpcEDebugEnabled(): boolean {
  if (cachedEnabled === null) {
    cachedEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugNpcE') === '1';
  }
  return cachedEnabled;
}

let panelEl: HTMLElement | null = null;

function ensurePanel(): HTMLElement {
  if (panelEl) return panelEl;
  const el = document.createElement('div');
  el.id = 'npc-e-debug-panel';
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:99999',
    'width:380px', 'max-height:92vh', 'overflow-y:auto',
    'background:rgba(8,10,18,0.94)', 'color:#c8f0d0', 'border:1px solid #4a9a6a', 'border-radius:6px',
    'padding:10px 12px', 'font:11px/1.5 "Consolas",monospace', 'white-space:pre-wrap',
    'pointer-events:none', 'user-select:text',
  ].join(';');
  document.body.appendChild(el);
  panelEl = el;
  return el;
}

function formatTrace(data: Record<string, unknown>, indent = ''): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      lines.push(formatTrace(value as Record<string, unknown>, indent + '  '));
    } else {
      lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

/** Renders ONE structured trace — both to console (for anyone still reading
 * devtools) and to the on-screen panel (the primary output this round asks
 * for). No-op entirely unless ?debugNpcE=1 is present, so this costs
 * nothing in the shipped default experience. */
export function logNpcEDebug(section: string, data: Record<string, unknown>): void {
  if (!isNpcEDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[NPC-E-DEBUG] ${section}`, data);
  const panel = ensurePanel();
  const timestamp = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  panel.textContent = `NPC E-Debug — ${timestamp}\n${section}\n${'='.repeat(30)}\n${formatTrace(data)}`;
}
