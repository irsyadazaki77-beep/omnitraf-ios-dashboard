/**
 * OmniTRAF Surabaya - SITS Intelligent Traffic Control Engine
 * Entry point utama aplikasi yang mengorkestrasikan seluruh modular controller dengan:
 * - Lazy initialization untuk view berat (Map, CCTV, Analytics, Reports, Devices, dll)
 * - Single initialization & idempotent lifecycle guards
 * - View transition activate/deactivate lifecycle & deterministic cleanup
 * - Internal runtime diagnostics integration
 */

import { stateStore, flushPendingDomWrites } from './core/stateStore.js';
import { soundManager } from './core/soundManager.js';
import { socketClient } from './core/socketClient.js';
import { authManager } from './core/authManager.js';
import { diagnostics } from './core/diagnostics.js';
import { runReleaseHealthCheck } from './core/healthCheck.js';
import { viewLoader } from './core/viewLoader.js';
import { trafficEngine } from './modules/trafficEngine.js';
import { chatSystem } from './modules/chatSystem.js';
import { uiMarquee } from './modules/uiMarquee.js';

import { navigationController } from './controllers/navigationController.js';
import { signalsController } from './controllers/signalsController.js';
import { incidentController } from './controllers/incidentController.js';
import { emergencyController } from './controllers/emergencyController.js';
import { tourShortcutsController } from './controllers/tourShortcutsController.js';
import { analyticsController } from './controllers/analyticsController.js';
import { deviceController } from './controllers/deviceController.js';
import { reportController } from './controllers/reportController.js';
import { pwaController } from './controllers/pwaController.js';
import { mapManager } from './modules/mapManager.js';
import { cctvController } from './modules/cctvController.js';

export class App {
  constructor() {
    this.isInitialized = false;
    this.activeControllers = new Set();
    this.currentView = 'dashboard';
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.info("🚦 [OmniTRAF] Menginisialisasi SITS Command Center Surabaya Kernel...");

    // 0. Global Frontend Error Boundary, Accessibility & Health Check
    diagnostics.startLongTaskObserver();
    this._initGlobalErrorBoundary();
    this._initAccessibleModalHandlers();
    runReleaseHealthCheck();

    // 1. Mount the first view alongside independent shell template requests.
    const initialView = stateStore.getState().currentView || (window.location.hash.slice(1) || 'dashboard');
    await Promise.all([
      viewLoader.mountView(initialView),
      viewLoader.mountShellComponents()
    ]);

    // 2. Core Network & Socket Infrastructure
    if (socketClient && typeof socketClient.getSocket === 'function') {
      socketClient.getSocket();
    }

    // 3. Core UI & Shell Modules (First Paint Critical Path)
    if (soundManager && typeof soundManager.init === 'function') soundManager.init();
    if (uiMarquee && typeof uiMarquee.init === 'function') uiMarquee.init();
    if (chatSystem && typeof chatSystem.init === 'function') chatSystem.init();
    if (navigationController && typeof navigationController.init === 'function') navigationController.init();
    if (tourShortcutsController && typeof tourShortcutsController.init === 'function') tourShortcutsController.init();
    if (pwaController && typeof pwaController.init === 'function') pwaController.init();
    if (trafficEngine && typeof trafficEngine.init === 'function') trafficEngine.init();

    // 4. Lazy View Activator Subscription
    stateStore.subscribe('state:currentView', async ({ value, prev }) => {
      await this._handleViewTransition(value, prev);
    });

    // Initial View Activate
    await this._handleViewTransition(initialView, null);

    // 5. Expose Global Bridges & Terminal Diagnostics
    this._exposeGlobalBridges();

    console.info("✓ [OmniTRAF] Kernel SITS Surabaya beroperasi secara optimal.");
  }

  /**
   * Orchestrate Lazy Init & View Lifecycle
   */
  async _handleViewTransition(newView, oldView) {
    this.currentView = newView;

    // Deactivate previous controllers if needed
    if (oldView && oldView !== newView) {
      this._deactivateViewModules(oldView, newView);
      // Flush pending DOM writes to prevent detached DOM memory retainers
      flushPendingDomWrites();
    }

    // Lazy load & mount HTML partial into DOM
    const { isFirstMount } = await viewLoader.mountView(newView);

    // Dynamic Socket Channel Subscription Management (Langkah 4 & 13)
    this._manageSocketChannelSubscriptions(newView, oldView);

    // Lazy load & activate target view modules
    this._activateViewModules(newView, isFirstMount);

    // If switching to Map view or Dashboard, trigger Leaflet size invalidation
    const cleanId = (newView || '').replace('#', '').replace('view-', '');
    if (cleanId === 'map' || cleanId === 'dashboard') {
      if (mapManager && typeof mapManager.debouncedInvalidateSize === 'function') {
        mapManager.debouncedInvalidateSize(120);
      }
    }
  }

  _manageSocketChannelSubscriptions(newView, oldView) {
    if (!socketClient || typeof socketClient.subscribeChannels !== 'function') return;

    const cleanNew = (newView || '').replace('#', '').replace('view-', '');
    const cleanOld = (oldView || '').replace('#', '').replace('view-', '');

    const VIEW_CHANNELS = {
      'dashboard': ['room:dashboard', 'room:traffic', 'room:signals', 'room:incidents', 'room:emergency', 'room:cctv:all'],
      'map': ['room:traffic', 'room:incidents', 'room:emergency'],
      'cctv': ['room:cctv:all', 'room:cctv:dashCameraCanvas', 'room:cctv:cctvCanvas1', 'room:cctv:cctvCanvas2', 'room:cctv:cctvCanvas3', 'room:cctv:cctvCanvas4'],
      'signals': ['room:signals', 'room:traffic'],
      'incidents': ['room:incidents'],
      'emergency': ['room:emergency', 'room:traffic'],
      'emergencies': ['room:emergency', 'room:traffic'],
      'analytics': ['room:analytics', 'room:traffic'],
      'prediction': ['room:analytics'],
      'devices': ['room:devices'],
      'reports': ['room:audit']
    };

    const neededChannels = VIEW_CHANNELS[cleanNew] || ['room:dashboard', 'room:traffic'];
    const oldChannels = VIEW_CHANNELS[cleanOld] || [];

    // Find channels no longer needed
    const toUnsubscribe = oldChannels.filter(ch => !neededChannels.includes(ch));
    if (toUnsubscribe.length > 0) {
      socketClient.unsubscribeChannels(toUnsubscribe);
    }

    // Subscribe to newly required channels
    socketClient.subscribeChannels(neededChannels);
  }

  _activateViewModules(view, isFirstMount = false) {
    diagnostics.recordInit('view:' + view);
    const cleanView = (view || '').replace('#', '').replace('view-', '');

    switch (cleanView) {
      case 'dashboard':
        this._safeInitAndActivate('mapManager', mapManager);
        this._safeInitAndActivate('cctvController', cctvController);
        this._safeInitAndActivate('signalsController', signalsController);
        this._safeInitAndActivate('incidentController', incidentController);
        this._safeInitAndActivate('emergencyController', emergencyController);
        break;

      case 'map':
        this._safeInitAndActivate('mapManager', mapManager);
        break;

      case 'cctv':
        this._safeInitAndActivate('cctvController', cctvController);
        break;

      case 'signals':
        this._safeInitAndActivate('signalsController', signalsController);
        break;

      case 'incidents':
        this._safeInitAndActivate('incidentController', incidentController);
        break;

      case 'emergency':
      case 'emergencies':
        this._safeInitAndActivate('emergencyController', emergencyController);
        break;

      case 'analytics':
      case 'prediction':
        this._safeInitAndActivate('analyticsController', analyticsController);
        break;

      case 'devices':
        this._safeInitAndActivate('deviceController', deviceController);
        break;

      case 'reports':
        this._safeInitAndActivate('reportController', reportController);
        break;

      default:
        break;
    }
  }

  _deactivateViewModules(oldView, newView) {
    const cleanOld = (oldView || '').replace('#', '').replace('view-', '');
    const cleanNew = (newView || '').replace('#', '').replace('view-', '');

    const VIEW_CONTROLLERS = {
      'dashboard': ['mapManager', 'cctvController', 'signalsController', 'incidentController', 'emergencyController'],
      'map': ['mapManager'],
      'cctv': ['cctvController'],
      'signals': ['signalsController'],
      'incidents': ['incidentController'],
      'emergency': ['emergencyController'],
      'emergencies': ['emergencyController'],
      'analytics': ['analyticsController'],
      'prediction': ['analyticsController'],
      'devices': ['deviceController'],
      'reports': ['reportController']
    };

    const oldCtrls = VIEW_CONTROLLERS[cleanOld] || [];
    const newCtrls = VIEW_CONTROLLERS[cleanNew] || [];

    const controllers = {
      mapManager,
      cctvController,
      signalsController,
      incidentController,
      emergencyController,
      analyticsController,
      deviceController,
      reportController
    };

    oldCtrls.forEach(ctrlName => {
      if (!newCtrls.includes(ctrlName)) {
        const ctrl = controllers[ctrlName];
        if (ctrl && typeof ctrl.deactivate === 'function') {
          ctrl.deactivate();
        }
      }
    });
  }

  _safeInitAndActivate(name, ctrl) {
    if (!ctrl) return;
    try {
      if (typeof ctrl.init === 'function') {
        ctrl.init();
      }
      if (typeof ctrl.activate === 'function') {
        ctrl.activate();
      }
      this.activeControllers.add(name);
    } catch (err) {
      console.warn(`[App] Failed to init/activate ${name}:`, err);
    }
  }

  _exposeGlobalBridges() {
    window.stateStore = stateStore;
    window.mapManager = mapManager;
    window.trafficEngine = trafficEngine;
    window.soundManager = soundManager;
    window.diagnostics = diagnostics;

    window.resolveDynamicIncident = (id) => {
      if (incidentController && typeof incidentController.resolveIncident === 'function') {
        incidentController.resolveIncident(id);
      }
    };

    window.acknowledgeIncident = (id) => {
      if (incidentController && typeof incidentController.updateIncidentStatus === 'function') {
        incidentController.updateIncidentStatus(id, "ACKNOWLEDGED");
      }
    };

    window.openIncidentDetail = (id, loc, time, desc) => {
      if (incidentController && typeof incidentController.openIncidentDetail === 'function') {
        incidentController.openIncidentDetail(id, loc, time, desc);
      }
    };

    window.dismissAiRecommendation = () => {
      const card = document.getElementById("ai-rec-card") || document.querySelector(".ai-rec-card");
      if (card) {
        card.style.opacity = "0";
        setTimeout(() => { card.style.display = "none"; }, 300);
      }
      if (typeof window.showToast === "function") {
        window.showToast("Rekomendasi AI diabaikan untuk siklus ini.");
      }
      soundManager.play('click');
    };

    // Delegated listener survives lazy view remounts and works with the strict CSP.
    document.addEventListener('click', (event) => {
      if (event.target.closest('#btnDismissAiRec')) window.dismissAiRecommendation();
    });

    window.showToast = (msg, type = "normal") => {
      this._showToastNotification(msg, type);
    };

    // Diagnostic console helpers & Auth
    window.getDiagnostics = () => diagnostics.getMetrics();
    window.authManager = authManager;
    authManager.ensureActiveSession().catch(() => {});
  }

  _showToastNotification(msg, type = "normal") {
    const toast = document.getElementById("toast");
    const stack = document.getElementById("toastStack");

    if (stack) {
      const item = document.createElement("div");
      item.className = `toast-item glass-panel ${type === 'warning' || type === 'alert' ? 'toast-alert' : ''}`;
      item.style.cssText = `
        padding: 10px 14px;
        border-radius: 8px;
        margin-bottom: 8px;
        font-size: 12px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid var(--border);
        color: var(--text);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: fadeIn 0.2s ease-out;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      const icon = type === 'warning' || type === 'alert' ? '⚠️' : '✓';
      const iconEl = document.createElement('span');
      iconEl.textContent = icon;
      const messageEl = document.createElement('span');
      messageEl.textContent = msg == null ? '' : String(msg);
      item.append(iconEl, messageEl);
      stack.appendChild(item);

      setTimeout(() => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(-10px)';
        item.style.transition = 'all 0.3s ease';
        setTimeout(() => item.remove(), 300);
      }, 3500);
    } else if (toast) {
      const msgEl = toast.querySelector(".toast-message");
      if (msgEl) msgEl.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => {
        toast.classList.remove("show");
      }, 3000);
    }
  }

  _initGlobalErrorBoundary() {
    window.addEventListener('error', (event) => {
      console.warn("🛡️ [OmniTRAF Boundary] Global Error Handled:", event.error || event.message);
      diagnostics.recordApiError();
      if (typeof diagnostics.logEvent === 'function') {
        diagnostics.logEvent({
          level: 'ERROR',
          category: 'fault',
          component: 'ui_shell',
          event: 'UNCAUGHT_WINDOW_ERROR',
          errorCode: 'WINDOW_ERROR',
          message: event.message || 'Uncaught client error',
          details: { filename: event.filename, lineno: event.lineno, colno: event.colno }
        });
      }
      this._showToastNotification("Terjadi kendala pada sistem UI. Operasi dilanjutkan secara aman.", "warning");
      event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.warn("🛡️ [OmniTRAF Boundary] Unhandled Promise Rejection:", event.reason);
      diagnostics.recordApiError();
      if (typeof diagnostics.logEvent === 'function') {
        diagnostics.logEvent({
          level: 'WARN',
          category: 'fault',
          component: 'async_boundary',
          event: 'UNHANDLED_PROMISE_REJECTION',
          errorCode: 'UNHANDLED_REJECTION',
          message: event.reason?.message || String(event.reason || 'Unhandled rejection'),
          details: { reason: String(event.reason) }
        });
      }
      this._showToastNotification("Penundaan koneksi data terdeteksi. Mencoba ulang...", "warning");
      event.preventDefault();
    });
  }

  _initAccessibleModalHandlers() {
    const dialogSelector = '[role="dialog"][aria-modal="true"]';
    const openerByDialog = new WeakMap();
    let activeDialog = null;

    const isDialogVisible = (dialog) => {
      if (dialog.id === 'notifDrawer') return dialog.classList.contains('open');
      return dialog.classList.contains('show') || dialog.classList.contains('open') ||
        dialog.classList.contains('active') || (dialog.style.display !== 'none' &&
          window.getComputedStyle(dialog).display !== 'none');
    };

    const getFocusableElements = (dialog) => Array.from(dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('aria-hidden'));

    const closeDialog = (dialog) => {
      const closeButton = dialog.querySelector('.modal-close, .notif-drawer-close-btn, [data-dialog-close]');
      if (closeButton) {
        closeButton.click();
        return;
      }
      dialog.classList.remove('active', 'show', 'open');
      dialog.style.display = 'none';
    };

    const syncDialogs = () => {
      const dialogs = Array.from(document.querySelectorAll(dialogSelector));
      const visibleDialogs = dialogs.filter(isDialogVisible);
      const nextActiveDialog = visibleDialogs[visibleDialogs.length - 1] || null;

      dialogs.forEach((dialog) => dialog.setAttribute('aria-hidden', isDialogVisible(dialog) ? 'false' : 'true'));

      if (activeDialog && activeDialog !== nextActiveDialog && !isDialogVisible(activeDialog)) {
        const opener = openerByDialog.get(activeDialog);
        if (opener?.isConnected) opener.focus();
      }

      if (nextActiveDialog && nextActiveDialog !== activeDialog) {
        openerByDialog.set(nextActiveDialog, document.activeElement);
        const focusTarget = getFocusableElements(nextActiveDialog)[0];
        if (focusTarget) focusTarget.focus();
        else {
          nextActiveDialog.setAttribute('tabindex', '-1');
          nextActiveDialog.focus();
        }
      }
      activeDialog = nextActiveDialog;
    };

    // Templates are mounted after app initialization, and modal state changes are class/style mutations.
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const dialogStateObserver = new MutationObserver(syncDialogs);
      const mountObserver = new MutationObserver(() => {
        observeDialogs();
        syncDialogs();
      });
      const observedDialogs = new WeakSet();
      const observeDialogs = () => {
        document.querySelectorAll(dialogSelector).forEach((dialog) => {
          if (observedDialogs.has(dialog)) return;
          observedDialogs.add(dialog);
          dialogStateObserver.observe(dialog, {
            attributes: true,
            attributeFilter: ['class', 'style']
          });
        });
      };
      mountObserver.observe(document.body, { childList: true });
      ['modalsContainer', 'drawersContainer'].forEach((id) => {
        const mountPoint = document.getElementById(id);
        if (mountPoint) mountObserver.observe(mountPoint, { childList: true });
      });
      // Discover the initial dialogs before watching only their own open/close state.
      observeDialogs();
    }
    syncDialogs();

    document.addEventListener('keydown', (e) => {
      if (activeDialog && e.key === 'Tab') {
        const focusable = getFocusableElements(activeDialog);
        if (focusable.length === 0) {
          e.preventDefault();
          activeDialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }

      if (e.key === 'Escape' && activeDialog) {
        e.preventDefault();
        closeDialog(activeDialog);
        return;
      }

      if (e.key === 'Escape') {
        const drawer = document.getElementById('sidebar');
        const backdrop = document.getElementById('drawerBackdrop');
        if (drawer && drawer.classList.contains('open-mobile')) {
          drawer.classList.remove('open');
          drawer.classList.remove('open-mobile');
          document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
          if (backdrop) backdrop.classList.remove('show');
          if (backdrop) backdrop.classList.remove('active');
          if (backdrop) backdrop.style.display = 'none';
          document.getElementById('menuToggle')?.focus();
        }
      }
    });

    // Dismiss dialogs when the user clicks the backdrop outside the dialog content.
    document.addEventListener('click', (e) => {
      if (e.target?.matches?.('.modal-overlay[role="dialog"][aria-modal="true"]') && isDialogVisible(e.target)) closeDialog(e.target);
    });
  }
}

export const app = new App();

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => app.init());
  } else {
    app.init();
  }
}
