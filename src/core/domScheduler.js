/**
 * OmniTRAF Surabaya - DOM Scheduler (Phase 1 Refactor)
 * Bertanggung jawab khusus untuk smartUpdateDOM, pending DOM writes queue,
 * RAF batching, disconnected node eviction, dan DOM write cleanup.
 */

import { diagnostics } from './diagnostics.js';

const pendingDomWrites = new Map();
let domWriteFrameId = null;
let cancelDomWriteFrame = null;

export function clearPendingDomWrites() {
  if (domWriteFrameId !== null) {
    cancelDomWriteFrame?.(domWriteFrameId);
    domWriteFrameId = null;
    cancelDomWriteFrame = null;
  }
  pendingDomWrites.clear();
}

export function flushPendingDomWrites() {
  if (domWriteFrameId !== null) {
    cancelDomWriteFrame?.(domWriteFrameId);
    domWriteFrameId = null;
    cancelDomWriteFrame = null;
  }
  if (pendingDomWrites.size === 0) return;
  diagnostics.recordDomBatch();

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
  if (pendingDomWrites.has(element)) {
    diagnostics.recordCoalescedDomUpdate();
  } else if (pendingDomWrites.size >= 500) {
    const oldest = pendingDomWrites.keys().next().value;
    pendingDomWrites.delete(oldest);
    diagnostics.recordCoalescedDomUpdate();
  }

  pendingDomWrites.set(element, { content });

  if (domWriteFrameId === null) {
    const hasAnimationFrame = typeof requestAnimationFrame === 'function';
    const requestFrame = hasAnimationFrame ? requestAnimationFrame : callback => setTimeout(callback, 16);
    cancelDomWriteFrame = hasAnimationFrame ? cancelAnimationFrame : clearTimeout;
    domWriteFrameId = requestFrame(() => {
      domWriteFrameId = null;
      cancelDomWriteFrame = null;
      flushPendingDomWrites();
    });
  }
  return true;
}
