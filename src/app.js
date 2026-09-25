/**
 * OmniTRAF Surabaya - SITS Intelligent Traffic Control Engine
 * Entry point utama aplikasi yang mengorkestrasikan seluruh modular controller dengan:
 * - Lazy initialization untuk view berat (Map, CCTV, Analytics, Reports, Devices, dll)
 * - Single initialization & idempotent lifecycle guards
 * - View transition activate/deactivate lifecycle & deterministic cleanup
 * - Internal runtime diagnostics integration
 */

import { stateStore } from './core/stateStore.js';
import { soundManager } from './core/soundManager.js';
import { socketClient } from './core/socketClient.js';
import { diagnostics } from './core/diagnostics.js';
import { runReleaseHealthCheck } from './core/healthCheck.js';
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

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.info("🚦 [OmniTRAF] Menginisialisasi SITS Command Center Surabaya Kernel...");

    // 0. Global Frontend Error Boundary, Accessibility & Health Check (Phase 9 & 10)
    this._initGlobalErrorBoundary();
    this._initAccessibleModalHandlers();
    runReleaseHealthCheck();

    // 1. Core Network & Socket Infrastructure
    if (socketClient && typeof socketClient.getSocket === 'function') {
      socketClient.getSocket();
    }

    // 2. Core UI & Shell Modules (First Paint Critical Path)
    if (soundManager && typeof soundManager.init === 'function') soundManager.init();
    if (uiMarquee && typeof uiMarquee.init === 'function') uiMarquee.init();
    if (chatSystem && typeof chatSystem.init === 'function') chatSystem.init();
    if (navigationController && typeof navigationController.init === 'function') navigationController.init();
    if (tourShortcutsController && typeof tourShortcutsController.init === 'function') tourShortcutsController.init();
    if (pwaController && typeof pwaController.init === 'function') pwaController.init();
    if (trafficEngine && typeof trafficEngine.init === 'function') trafficEngine.init();

    // 3. Lazy View Activator Subscription
    stateStore.subscribe('state:currentView', ({ value, prev }) => {
      this._handleViewTransition(value, prev);
    });

    // Initial View Activate
    const initialView = stateStore.getState().currentView || 'dashboard';
    this._handleViewTransition(initialView, null);

    // 4. Expose Global Bridges & Terminal Diagnostics
    this._exposeGlobalBridges();

    console.info("✓ [OmniTRAF] Kernel SITS Surabaya beroperasi secara optimal.");
  }

  /**
   * Orchestrate Lazy Init & View Lifecycle
   */
  _handleViewTransition(newView, oldView) {
    this.currentView = newView;

    // Deactivate previous controllers if needed
    if (oldView && oldView !== newView) {
      this._deactivateViewModules(oldView);
    }

    // Lazy load & activate target view modules
    this._activateViewModules(newView);
  }

  _activateViewModules(view) {
    diagnostics.recordInit('view:' + view);

    switch (view) {
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

  _deactivateViewModules(view) {
    switch (view) {
      case 'cctv':
        if (cctvController && typeof cctvController.deactivate === 'function') {
          cctvController.deactivate();
        }
        break;
      case 'analytics':
      case 'prediction':
        if (analyticsController && typeof analyticsController.deactivate === 'function') {
          analyticsController.deactivate();
        }
        break;
      case 'devices':
        if (deviceController && typeof deviceController.deactivate === 'function') {
          deviceController.deactivate();
        }
        break;
      default:
        break;
    }
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

    window.showToast = (msg, type = "normal") => {
      this._showToastNotification(msg, type);
    };

    // Diagnostic console helpers
    window.getDiagnostics = () => diagnostics.getMetrics();
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
      item.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
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
      this._showToastNotification("Terjadi kendala pada sistem UI. Operasi dilanjutkan secara aman.", "warning");
      event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.warn("🛡️ [OmniTRAF Boundary] Unhandled Promise Rejection:", event.reason);
      diagnostics.recordApiError();
      this._showToastNotification("Penundaan koneksi data terdeteksi. Mencoba ulang...", "warning");
      event.preventDefault();
    });
  }

  _initAccessibleModalHandlers() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeModals = document.querySelectorAll('.modal.active, .modal.show, .modal-backdrop.active, #emergencyModal.show, .dialog.open');
        activeModals.forEach(modal => {
          modal.classList.remove('active', 'show', 'open');
          if (modal.style) modal.style.display = 'none';
        });
        const drawer = document.getElementById('sidebar');
        const backdrop = document.getElementById('drawerBackdrop');
        if (drawer && drawer.classList.contains('open')) {
          drawer.classList.remove('open');
          if (backdrop) backdrop.classList.remove('show');
        }
      }
    });
  }
}

export const app = new App();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => app.init());
} else {
  app.init();
}
