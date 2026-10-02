/**
 * OmniTRAF Surabaya - DOM Scheduler (Phase 1 Refactor)
 * Bertanggung jawab khusus untuk smartUpdateDOM, pending DOM writes queue,
 * RAF batching, disconnected node eviction, dan DOM write cleanup.
 */

import { diagnostics } from './diagnostics.js';

const pendingDomWrites = new Map();
let domWriteFrameId = null;

export function clearPendingDomWrites() {
  if (domWriteFrameId) {
    cancelAnimationFrame(domWriteFrameId);
    domWriteFrameId = null;
  }
  pendingDomWrites.clear();
}

export function flushPendingDomWrites() {
  if (domWriteFrameId) {
    cancelAnimationFrame(domWriteFrameId);
    domWriteFrameId = null;
  }
  if (pendingDomWrites.size === 0) return;

  pendingDomWrites.forEach(({ content }, el) => {
    if (!el || (typeof el.isConnected === 'boolean' && !el.isConnected)) return;
    el.textContent = content;
    diagnostics.recordDomUpdate();
  });
  pendingDomWrites.clear();
}

export function smartUpdateDOM(element, newContent, options = {}) {
  if (!element) return false;
  const immediate = options.immediate || false;
  const content = newContent == null ? '' : String(newContent);
  const currentVal = element.textContent;

  if (currentVal === content) {
    return false; // No change needed
  }

  if (immediate) {
    element.textContent = content;
    diagnostics.recordDomUpdate();
    return true;
  }

  // Queue write in RAF to batch layout operations
  // Bound check: if pending queue exceeds 100 entries, flush immediately to prevent unbounded growth
  if (pendingDomWrites.size > 100) {
    flushPendingDomWrites();
  }

  pendingDomWrites.set(element, { content });

  if (!domWriteFrameId) {
    domWriteFrameId = requestAnimationFrame(() => {
      domWriteFrameId = null;
      flushPendingDomWrites();
    });
  }
  return true;
}
