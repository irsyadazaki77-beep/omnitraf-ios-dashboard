/**
 * OmniTRAF Surabaya - System Release Health Check (Phase 10)
 * Startup verification for critical DOM elements, state store,
 * core modules, and network readiness without blocking dashboard booting.
 */

import { stateStore } from './stateStore.js';
import { diagnostics } from './diagnostics.js';

export function runReleaseHealthCheck() {
  const startTime = performance.now();
  const checks = [];

  // 1. Critical DOM Structure Check
  const requiredDomIds = [
    'sidebar',
    'toast',
    'toastStack',
    'mainContent',
    'statusCapsule'
  ];

  let missingDom = 0;
  requiredDomIds.forEach(id => {
    if (!document.getElementById(id)) {
      missingDom++;
      checks.push({ name: `DOM:${id}`, status: 'FAIL', detail: `Missing element #${id}` });
    }
  });

  if (missingDom === 0) {
    checks.push({ name: 'DOM Structural Integrity', status: 'PASS', detail: 'All critical container IDs mounted' });
  }

  // 2. StateStore Verification
  if (stateStore && typeof stateStore.getState === 'function') {
    const state = stateStore.getState();
    if (state && typeof state.currentView === 'string') {
      checks.push({ name: 'StateStore Canonical Kernel', status: 'PASS', detail: `Active view: ${state.currentView}` });
    } else {
      checks.push({ name: 'StateStore Canonical Kernel', status: 'WARN', detail: 'State store mounted with default fallback' });
    }
  } else {
    checks.push({ name: 'StateStore Canonical Kernel', status: 'FAIL', detail: 'StateStore module unreachable' });
  }

  // 3. Service Worker & Offline PWA Capabilty
  if ('serviceWorker' in navigator) {
    checks.push({ name: 'PWA Service Worker Engine', status: 'PASS', detail: 'Service worker API supported' });
  } else {
    checks.push({ name: 'PWA Service Worker Engine', status: 'WARN', detail: 'Service worker not supported in current environment' });
  }

  // 4. Record Diagnostics
  const durationMs = (performance.now() - startTime).toFixed(2);
  const passedCount = checks.filter(c => c.status === 'PASS').length;
  diagnostics.recordInit(`healthcheck:${passedCount}/${checks.length}`);

  console.info(`🛡️ [OmniTRAF Release Health Check] Passed ${passedCount}/${checks.length} checks in ${durationMs}ms`);
  
  return {
    success: passedCount === checks.length,
    passedCount,
    totalCount: checks.length,
    durationMs,
    checks
  };
}
