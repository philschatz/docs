/**
 * Lightweight imperative toast — no context or provider needed.
 * Usage: showToast('Link copied to clipboard')
 */

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div');
    container.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, durationMs = 2000) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText =
    'background:var(--color-popover,#1f1f1f);color:var(--color-popover-foreground,#fff);padding:8px 16px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transition:opacity .15s ease;pointer-events:auto;';
  getContainer().appendChild(el);

  // fade in
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });

  // fade out & remove
  setTimeout(() => {
    el.style.opacity = '0';
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // safety net if transitionend doesn't fire
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}
