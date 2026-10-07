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
import { tourShortcutsController } from './controllers/tourShortcutsController.js';
import { pwaController } from './controllers/pwaController.js';

const isViteRuntime = Boolean(import.meta.env);

const controllerLoaders = {
  mapManager: async () => {
    if (isViteRuntime) {
      await import('./../css/views/map.css');
      await import('leaflet/dist/leaflet.css');
      await import('leaflet.markercluster/dist/MarkerCluster.css');
      await import('leaflet.markercluster/dist/MarkerCluster.Default.css');
      const leaflet = await import('leaflet');
      if (typeof window !== 'undefined') window.L = leaflet.default;
      await import('leaflet.markercluster');
    }
    return import('./modules/mapManager.js');
  },
  cctvController: async () => { if (isViteRuntime) await import('../css/views/cctv.css'); return import('./modules/cctvController.js'); },
  signalsController: async () => { if (isViteRuntime) await import('../css/views/signals.css'); return import('./controllers/signalsController.js'); },
  incidentController: async () => { if (isViteRuntime) await import('../css/views/incidents.css'); return import('./controllers/incidentController.js'); },
  emergencyController: async () => { if (isViteRuntime) await import('../css/views/emergencies.css'); return import('./controllers/emergencyController.js'); },
  analyticsController: async () => { if (isViteRuntime) await import('../css/views/analytics.css'); return import('./controllers/analyticsController.js'); },
  deviceController: async () => { if (isViteRuntime) await import('../css/views/devices.css'); return import('./controllers/deviceController.js'); },
  reportController: async () => { if (isViteRuntime) await import('../css/views/reports.css'); return import('./controllers/reportController.js'); }
};

export class App {
  constructor() {
    this.isInitialized = false;
    this.activeControllers = new Set();
    this.currentView = 'dashboard';
    this.navigationId = 0;
    this.controllerPromises = new Map();
    this.controllerModules = new Map();
    this.initializedControllers = new Set();
    this.mapObserver = null;
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
    const navigationId = ++this.navigationId;
    this.currentView = newView;
    if (String(newView).replace('#', '').replace('view-', '') !== 'dashboard') {
      this.mapObserver?.disconnect();
      this.mapObserver = null;
    }

    // Deactivate previous controllers if needed
    if (oldView && oldView !== newView) {
      this._deactivateViewModules(oldView, newView);
      // Flush pending DOM writes to prevent detached DOM memory retainers
      flushPendingDomWrites();
    }

    // Lazy load & mount HTML partial into DOM
    this._showViewLoading(newView);
    const { isFirstMount, success } = await viewLoader.mountView(newView, {
      shouldActivate: () => navigationId === this.navigationId
    });
    if (navigationId !== this.navigationId) return;
    if (!success) {
      this._showViewLoadError(newView, () => this._handleViewTransition(newView, oldView));
      return;
    }

    // Dynamic Socket Channel Subscription Management (Langkah 4 & 13)
    this._manageSocketChannelSubscriptions(newView, oldView);

    // Lazy load & activate target view modules
    try {
      await this._activateViewModules(newView, isFirstMount);
    } catch (error) {
      if (navigationId === this.navigationId) this._showViewLoadError(newView, () => this._handleViewTransition(newView, oldView));
      console.error(`[App] Unable to load view modules for ${newView}:`, error);
      return;
    }
    if (navigationId !== this.navigationId) return;
    const loadingStatus = document.getElementById('viewLoadStatus');
    if (loadingStatus) loadingStatus.hidden = true;

    // If switching to Map view or Dashboard, trigger Leaflet size invalidation
    const cleanId = (newView || '').replace('#', '').replace('view-', '');
    if (cleanId === 'map' || cleanId === 'dashboard') {
      this.controllerModules.get('mapManager')?.debouncedInvalidateSize?.(120);
    }
  }

  _manageSocketChannelSubscriptions(newView, oldView) {
    if (!socketClient || typeof socketClient.subscribeChannels !== 'function') return;

    const cleanNew = (newView || '').replace('#', '').replace('view-', '');
    const cleanOld = (oldView || '').replace('#', '').replace('view-', '');

    const VIEW_CHANNELS = {
      'dashboard': ['room:dashboard', 'room:traffic', 'room:signals', 'room:incidents', 'room:emergency', 'room:cctv:dashCameraCanvas'],
      'map': ['room:traffic', 'room:incidents', 'room:emergency'],
      'cctv': ['room:cctv:dashCameraCanvas', 'room:cctv:cctvCanvas1', 'room:cctv:cctvCanvas2', 'room:cctv:cctvCanvas3', 'room:cctv:cctvCanvas4'],
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

  async _activateViewModules(view, isFirstMount = false) {
    diagnostics.recordInit('view:' + view);
    const cleanView = (view || '').replace('#', '').replace('view-', '');

    const viewControllers = {
      dashboard: ['cctvController', 'signalsController', 'incidentController', 'emergencyController'],
      map: ['mapManager'], cctv: ['cctvController'], signals: ['mapManager', 'signalsController'],
      incidents: ['mapManager', 'incidentController'], emergency: ['emergencyController'], emergencies: ['emergencyController'],
      analytics: ['analyticsController'], prediction: ['analyticsController'],
      devices: ['deviceController'], reports: ['reportController']
    };
    const navigationId = this.navigationId;
    const names = viewControllers[cleanView] || [];
    if (cleanView === 'dashboard' && isViteRuntime) await import('../css/views/dashboard.css');
    await Promise.all(names.map((name) => this._loadController(name)));
    if (navigationId !== this.navigationId) return;
    for (const name of names) this._safeInitAndActivate(name, this.controllerModules.get(name));
    if (cleanView === 'dashboard') {
      this._scheduleDashboardMap(navigationId);
      this._scheduleIncidentPrefetch(navigationId);
    }
  }

  _scheduleIncidentPrefetch(navigationId) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
    const prefetch = () => {
      if (navigationId !== this.navigationId || this.currentView !== 'dashboard') return;
      this._loadController('incidentController').catch(() => {});
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(prefetch, { timeout: 4000 });
    else setTimeout(prefetch, 1500);
  }

  _scheduleDashboardMap(navigationId) {
    this.mapObserver?.disconnect();
    const target = document.getElementById('dashboardMapBox');
    if (!target || typeof IntersectionObserver === 'undefined') {
      this._activateMapIfCurrent(navigationId);
      return;
    }
    this.mapObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.mapObserver?.disconnect();
      this.mapObserver = null;
      this._activateMapIfCurrent(navigationId);
    }, { rootMargin: '120px' });
    this.mapObserver.observe(target);
  }

  async _activateMapIfCurrent(navigationId) {
    try {
      const controller = await this._loadController('mapManager');
      if (navigationId !== this.navigationId || this.currentView !== 'dashboard') return;
      this._safeInitAndActivate('mapManager', controller);
    } catch (error) {
      if (navigationId === this.navigationId) this._showViewLoadError('dashboard map', () => this._activateMapIfCurrent(this.navigationId));
      console.error('[App] Unable to load the dashboard map module:', error);
    }
  }

  _loadController(name) {
    if (this.controllerModules.has(name)) return Promise.resolve(this.controllerModules.get(name));
    if (!this.controllerPromises.has(name)) {
      const loader = controllerLoaders[name];
      if (!loader) return Promise.reject(new Error(`Unknown controller: ${name}`));
      const pending = loader().then((module) => {
        const controller = module[name] || module.default;
        if (!controller) throw new Error(`Controller export missing: ${name}`);
        this.controllerModules.set(name, controller);
        if (name === 'mapManager') window.mapManager = controller;
        return controller;
      }).catch((error) => {
        this.controllerPromises.delete(name);
        throw error;
      });
      this.controllerPromises.set(name, pending);
    }
    return this.controllerPromises.get(name);
  }

  _showViewLoading(view) {
    const container = document.getElementById('viewContainer');
    if (!container) return;
    let status = document.getElementById('viewLoadStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'viewLoadStatus';
      status.className = 'view-load-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      if (typeof container.prepend === 'function') {
        container.prepend(status);
      } else if (typeof container.appendChild === 'function') {
        container.appendChild(status);
      }
    }
    const label = `Loading ${String(view).replace('#', '')}…`;
    if (typeof status.replaceChildren === 'function' && typeof document.createTextNode === 'function') {
      status.replaceChildren(document.createTextNode(label));
    } else {
      status.textContent = label;
    }
    status.hidden = false;
    const errorPanel = document.getElementById('viewLoadError');
    if (errorPanel) errorPanel.hidden = true;
  }

  _showViewLoadError(view, retry) {
    const container = document.getElementById('viewContainer');
    if (!container) return;
    let panel = document.getElementById('viewLoadError');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'viewLoadError';
      panel.className = 'view-load-error';
      panel.setAttribute('role', 'alert');
      if (typeof container.prepend === 'function') {
        container.prepend(panel);
      } else if (typeof container.appendChild === 'function') {
        container.appendChild(panel);
      }
    }
    if (typeof panel.replaceChildren === 'function') {
      panel.replaceChildren();
    } else {
      panel.textContent = '';
    }
    const message = document.createElement('p');
    message.textContent = `Unable to load ${String(view).replace('#', '')}. Check the connection and retry.`;
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', retry, { once: true });
    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = 'Reload application';
    reloadButton.addEventListener('click', () => window.location.reload(), { once: true });
    if (typeof panel.append === 'function') {
      panel.append(message, retryButton, reloadButton);
    } else {
      panel.appendChild?.(message);
      panel.appendChild?.(retryButton);
      panel.appendChild?.(reloadButton);
    }
    panel.hidden = false;
  }

  _deactivateViewModules(oldView, newView) {
    const cleanOld = (oldView || '').replace('#', '').replace('view-', '');
    const cleanNew = (newView || '').replace('#', '').replace('view-', '');

    const VIEW_CONTROLLERS = {
      'dashboard': ['mapManager', 'cctvController', 'signalsController', 'incidentController', 'emergencyController'],
      'map': ['mapManager'],
      'cctv': ['cctvController'],
      'signals': ['mapManager', 'signalsController'],
      'incidents': ['mapManager', 'incidentController'],
      'emergency': ['emergencyController'],
      'emergencies': ['emergencyController'],
      'analytics': ['analyticsController'],
      'prediction': ['analyticsController'],
      'devices': ['deviceController'],
      'reports': ['reportController']
    };

    const oldCtrls = VIEW_CONTROLLERS[cleanOld] || [];
    const newCtrls = VIEW_CONTROLLERS[cleanNew] || [];

    oldCtrls.forEach(ctrlName => {
      if (!newCtrls.includes(ctrlName)) {
        const ctrl = this.controllerModules.get(ctrlName);
        if (ctrl && typeof ctrl.deactivate === 'function') {
          ctrl.deactivate();
        }
      }
    });
  }

  _safeInitAndActivate(name, ctrl) {
    if (!ctrl) return;
    try {
      if (!this.initializedControllers.has(name) && typeof ctrl.init === 'function') {
        ctrl.init();
      }
      this.initializedControllers.add(name);
      if (typeof ctrl.activate === 'function') {
        ctrl.activate();
      }
      this.activeControllers.add(name);
    } catch (err) {
      console.warn(`[App] Failed to init/activate ${name}:`, err);
    }
  }

  _exposeGlobalBridges() {
    // Compatibility bridge for inline/legacy integrations; modules should import dependencies directly.
    window.stateStore = stateStore;
    if (this.controllerModules.has('mapManager')) {
      window.mapManager = this.controllerModules.get('mapManager');
    }
    window.trafficEngine = trafficEngine;
    window.soundManager = soundManager;
    window.diagnostics = diagnostics;

    window.resolveDynamicIncident = (id) => {
      this._loadController('incidentController').then((controller) => controller.resolveIncident?.(id)).catch(() => {});
    };

    window.acknowledgeIncident = (id) => {
      this._loadController('incidentController').then((controller) => controller.updateIncidentStatus?.(id, "ACKNOWLEDGED")).catch(() => {});
    };

    window.openIncidentDetail = (id, loc, time, desc) => {
      this._loadController('incidentController').then((controller) => controller.openIncidentDetail?.(id, loc, time, desc)).catch(() => {});
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
        navigationController.closeMobileSidebar();
      }
    });

    // Dismiss dialogs when the user clicks the backdrop outside the dialog content.
    document.addEventListener('click', (e) => {
      if (e.target?.matches?.('.modal-overlay[role="dialog"][aria-modal="true"]') && isDialogVisible(e.target)) closeDialog(e.target);
    });
  }
}

export const app = new App();
