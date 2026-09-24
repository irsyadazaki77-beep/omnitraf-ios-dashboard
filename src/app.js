/**
 * OmniTRAF Surabaya - SITS Intelligent Traffic Control Engine
 * Entry point utama aplikasi yang mengorkestrasikan seluruh modular controller:
 * - State Management (stateStore.js)
 * - Network Gateway (socketClient.js)
 * - GIS Mapping (mapManager.js)
 * - Reactive Traffic Engine (trafficEngine.js)
 * - Canvas YOLOv8 Vision (cctvController.js)
 * - Staff Coordination Chat (chatSystem.js)
 * - Announcement Ticker (uiMarquee.js)
 * - Navigation & Shell (navigationController.js)
 * - Signals & Webster (signalsController.js)
 * - Incident & Context Menu (incidentController.js)
 * - Emergency Preemption & 112 (emergencyController.js)
 * - Tour & Keyboard Shortcuts (tourShortcutsController.js)
 * - Analytics & AI Forecast (analyticsController.js)
 * - IoT Devices & Latency (deviceController.js)
 * - Reports & Executive Export (reportController.js)
 * - PWA & Offline Support (pwaController.js)
 */

import { stateStore } from './core/stateStore.js';
import { soundManager } from './core/soundManager.js';
import { socketClient } from './core/socketClient.js';
import { mapManager } from './modules/mapManager.js';
import { trafficEngine } from './modules/trafficEngine.js';
import { cctvController } from './modules/cctvController.js';
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

export class App {
  constructor() {
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.info("🚦 [OmniTRAF] Menginisialisasi SITS Command Center Surabaya...");

    // 1. Inisialisasi Socket & Network Gateway
    if (socketClient && typeof socketClient.getSocket === 'function') {
      socketClient.getSocket();
    }

    // 2. Inisialisasi Core Modules dengan safe guards
    if (soundManager && typeof soundManager.init === 'function') {
      soundManager.init();
    }
    if (uiMarquee && typeof uiMarquee.init === 'function') {
      uiMarquee.init();
    }
    if (chatSystem && typeof chatSystem.init === 'function') {
      chatSystem.init();
    }
    if (mapManager && typeof mapManager.init === 'function') {
      mapManager.init();
    }
    if (trafficEngine && typeof trafficEngine.init === 'function') {
      trafficEngine.init();
    }
    if (cctvController && typeof cctvController.init === 'function') {
      cctvController.init();
    }

    // 3. Inisialisasi Modular Controllers dengan safe guards
    if (navigationController && typeof navigationController.init === 'function') {
      navigationController.init();
    }
    if (signalsController && typeof signalsController.init === 'function') {
      signalsController.init();
    }
    if (incidentController && typeof incidentController.init === 'function') {
      incidentController.init();
    }
    if (emergencyController && typeof emergencyController.init === 'function') {
      emergencyController.init();
    }
    if (tourShortcutsController && typeof tourShortcutsController.init === 'function') {
      tourShortcutsController.init();
    }
    if (analyticsController && typeof analyticsController.init === 'function') {
      analyticsController.init();
    }
    if (deviceController && typeof deviceController.init === 'function') {
      deviceController.init();
    }
    if (reportController && typeof reportController.init === 'function') {
      reportController.init();
    }
    if (pwaController && typeof pwaController.init === 'function') {
      pwaController.init();
    }

    // 4. Ekspos Bridge Global untuk Integrasi DOM & Inline Handlers
    this._exposeGlobalBridges();

    console.info("✓ [OmniTRAF] Seluruh subsistem SITS Surabaya siap dan online.");
  }

  _exposeGlobalBridges() {
    window.stateStore = stateStore;
    window.mapManager = mapManager;
    window.trafficEngine = trafficEngine;
    window.soundManager = soundManager;

    window.resolveDynamicIncident = (id) => {
      incidentController.resolveIncident(id);
    };

    window.openIncidentDetail = (id, loc, time, desc) => {
      incidentController.openIncidentDetail(id, loc, time, desc);
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
}

export const app = new App();

// Auto-start on DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => app.init());
} else {
  app.init();
}
