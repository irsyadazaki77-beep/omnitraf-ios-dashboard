/**
 * OmniTRAF Surabaya - Emergency Priority & 112 Dispatch Controller
 * Mengelola form preemption darurat (Ambulans/Damkar), penguncian Green Wave pada koridor
 * A. Yani → Darmo, animasi countdown preemption, serta simulasi GIS rute 112 di peta Leaflet.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { trafficEngine } from '../modules/trafficEngine.js';
import { mapManager } from '../modules/mapManager.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';

export class EmergencyController {
  constructor() {
    this.preemptTimer = null;
    this.greenWaveCountdownTimer = null;
    this.remainingGreenWaveSec = 300; // 5 minutes
    this._isInitialized = false;
    this.disposer = new Disposer('EmergencyController');
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
  }

  activate() {
    this.deactivate(); // Ensure clean slate before binding

    this._bindEmergencyActuatorForm();
    this._bind112SimulationButtons();
    this._bindGreenWaveConfirmModal();
    this._bindHudRevertButton();
    this._setupStoreListeners();

    // Initial sync / render immediately on activation
    const state = stateStore.getState();
    this._renderEmergencyListUI(state.activeEmergencies);

    // Also trigger the state setup for greenWaveActive if it is active initially
    const isGw = state.greenWaveActive;
    const hud = document.getElementById("emergencyGreenWaveHud");
    const chkGreenWave = document.getElementById("chkGreenWave");
    if (chkGreenWave) {
      chkGreenWave.checked = !!isGw;
    }
    if (hud) {
      hud.style.display = isGw ? "block" : "none";
    }
  }

  deactivate() {
    if (this.greenWaveCountdownTimer) {
      clearInterval(this.greenWaveCountdownTimer);
      this.greenWaveCountdownTimer = null;
    }
    if (this.preemptTimer) {
      clearInterval(this.preemptTimer);
      this.preemptTimer = null;
    }
    this.disposer.clear();
  }

  /**
   * Bind Modal Konfirmasi Koridor Darurat 112
   */
  _bindGreenWaveConfirmModal() {
    const modal = document.getElementById("greenWaveConfirmModal");
    const closeBtn = document.getElementById("closeGreenWaveConfirmModal");
    const cancelBtn = document.getElementById("btnCancelGreenWaveModal");
    const confirmBtn = document.getElementById("btnConfirmGreenWaveModal");

    if (!modal) return;

    const closeModal = () => {
      modal.style.display = "none";
      modal.classList.remove("show");
    };

    if (closeBtn) this.disposer.addEventListener(closeBtn, "click", closeModal);
    if (cancelBtn) this.disposer.addEventListener(cancelBtn, "click", closeModal);

    this.disposer.addEventListener(modal, "click", (e) => {
      if (e.target === modal) closeModal();
    });

    if (confirmBtn) {
      this.disposer.addEventListener(confirmBtn, "click", async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "ACTIVATING...";

        try {
          await this.activateGreenWaveWithSafetyTimer(300); // 5 menit safety limit
          closeModal();
        } catch (err) {
          console.warn("[EmergencyController] Green wave activation error:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal mengaktifkan Green Wave: ${err.message}`, "danger");
          }
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "🚨 Aktifkan Koridor Darurat";
        }
      });
    }
  }

  openGreenWaveConfirmModal() {
    const modal = document.getElementById("greenWaveConfirmModal");
    if (!modal) return;

    modal.style.display = "flex";
    modal.classList.add("show");
    soundManager.play('click');
  }

  /**
   * Bind Tombol Pembatalan Instan pada Top Red HUD Banner
   */
  _bindHudRevertButton() {
    const revertBtn = document.getElementById("btnRevertEmergencyGw");
    if (revertBtn) {
      this.disposer.addEventListener(revertBtn, "click", () => {
        this.deactivateGreenWaveToNormal();
      });
    }
  }

  /**
   * Aktifkan Koridor Darurat 112
   */
  async activateGreenWaveWithSafetyTimer(durationSec = 300) {
    try {
      const respType = document.getElementById("respType")?.value || "Ambulans";
      const respRoute = document.getElementById("respRoute")?.value || "route-yani-darmo";
      const respName = document.getElementById("respName")?.value || "AMB-112";

      await commandLayer.dispatchCommand({
        action: 'emergency:activate',
        targetType: 'emergency',
        targetId: respName,
        payload: { code: respName, route: respRoute, type: respType }
      }, false);

      this.remainingGreenWaveSec = durationSec;
      if (typeof window.showToast === "function") {
        window.showToast(`🚨 PRIORITAS DARURAT AKTIF: Sinyal rute ${respRoute.replace('route-', '').toUpperCase()} dikunci Hijau!`, "alert");
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * Kembalikan Koridor Darurat ke Normal Adaptive Mode
   */
  async deactivateGreenWaveToNormal(isAutoTimeout = false) {
    try {
      const activeEmergencies = stateStore.getState().activeEmergencies || [];
      const respName = document.getElementById("respName")?.value || "AMB-112";
      
      // Cancel specifically respName, but if there are others, cancel them all to clear zombies
      const idsToCancel = new Set([respName, 'AMB-112']);
      activeEmergencies.forEach(e => {
        if (e.id) idsToCancel.add(e.id);
        if (e.vehicleId) idsToCancel.add(e.vehicleId);
      });

      for (const id of idsToCancel) {
        try {
          await commandLayer.dispatchCommand({
            action: 'emergency:cancel',
            targetType: 'emergency',
            targetId: id,
            payload: { id }
          }, false);
        } catch (e) {
          // Ignore failures for IDs that don't exist on backend
        }
      }

      soundManager.play('success');

      if (typeof window.showToast === "function") {
        if (isAutoTimeout) {
          window.showToast("⏱️ Timer Keselamatan 5 Menit Berakhir: Koridor Darurat dinormalisasi otomatis.");
        } else {
          window.showToast("✓ Seluruh Koridor Darurat dinormalisasi kembali ke mode adaptif.");
        }
      }
    } catch (err) {
      console.warn("[EmergencyController] Cancel error:", err);
    }
  }

  _bindEmergencyActuatorForm() {
    const form = document.getElementById("emergencyActuatorForm");
    if (!form) return;

    this.disposer.addEventListener(form, "submit", (e) => {
      e.preventDefault();
      // Buka modal konfirmasi sebelum pengaktifan
      this.openGreenWaveConfirmModal();
    });
  }

  _runLocalFallbackEmergency(name, type, route) {
    const countdownContainer = document.getElementById("preemptCountdownContainer");
    const countdownText = document.getElementById("preemptCountdownText");
    const progressCircle = document.getElementById("preemptProgressCircle");

    trafficEngine.setGreenWave(true);
    if (countdownContainer) {
      countdownContainer.classList.remove("is-hidden");
      countdownContainer.style.display = "flex";
    }

    let seconds = 15;
    const maxSeconds = 15;
    if (countdownText) countdownText.textContent = `${seconds}s`;

    if (this.preemptTimer) {
      clearInterval(this.preemptTimer);
      this.preemptTimer = null;
    }

    this.preemptTimer = this.disposer.setInterval(() => {
      seconds--;
      if (countdownText) countdownText.textContent = `${seconds}s`;
      if (progressCircle) {
        const pct = Math.round((seconds / maxSeconds) * 100);
        progressCircle.setAttribute("stroke-dasharray", `${pct}, 100`);
      }

      if (seconds <= 0) {
        clearInterval(this.preemptTimer);
        this.preemptTimer = null;
        if (countdownContainer) {
          countdownContainer.classList.add("is-hidden");
          countdownContainer.style.display = "none";
        }
        trafficEngine.setGreenWave(false);
        if (typeof window.showToast === "function") {
          window.showToast(`Prioritas Koridor Darurat ${name} telah selesai.`);
        }
      }
    }, 1000);
  }

  _bind112SimulationButtons() {
    const btnStart = document.getElementById("btnStart112Sim");
    const btnStop = document.getElementById("btnStop112Sim");

    if (btnStart) {
      this.disposer.addEventListener(btnStart, "click", () => {
        const curView = stateStore.getState().currentView;
        if (curView === 'emergency') {
          const mapNav = document.querySelector('[data-view="map"]');
          if (mapNav) mapNav.click();
        }
        this.openGreenWaveConfirmModal();
      });
    }

    if (btnStop) {
      this.disposer.addEventListener(btnStop, "click", () => {
        this.deactivateGreenWaveToNormal();
      });
    }
  }

  _setupStoreListeners() {
    // Listen to changes in activeEmergencies to render the list dynamically in the UI panel!
    this.disposer.addStoreSubscription(stateStore, 'state:activeEmergencies', ({ value }) => {
      this._renderEmergencyListUI(value);
    });

    // Reactive Green Wave HUD and local timer sync
    this.disposer.addStoreSubscription(stateStore, 'state:greenWaveActive', ({ value }) => {
      const hud = document.getElementById("emergencyGreenWaveHud");
      const timerDisplay = document.getElementById("emergencyGwCountdown");
      const chkGreenWave = document.getElementById("chkGreenWave");

      if (chkGreenWave) {
        chkGreenWave.checked = !!value;
      }

      if (value) {
        if (hud) hud.style.display = "block";
        soundManager.play('siren');
        
        if (!this.greenWaveCountdownTimer) {
          this.remainingGreenWaveSec = 300;
          this.greenWaveCountdownTimer = this.disposer.setInterval(() => {
            this.remainingGreenWaveSec--;
            const mins = Math.max(0, Math.floor(this.remainingGreenWaveSec / 60));
            const secs = Math.max(0, this.remainingGreenWaveSec % 60);
            const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            if (timerDisplay) timerDisplay.textContent = formatted;
            if (this.remainingGreenWaveSec <= 0) {
              this.deactivateGreenWaveToNormal(true);
            }
          }, 1000);
        }
      } else {
        if (hud) hud.style.display = "none";
        if (this.greenWaveCountdownTimer) {
          clearInterval(this.greenWaveCountdownTimer);
          this.greenWaveCountdownTimer = null;
        }
      }
    });
  }

  _renderEmergencyListUI(activeEmergencies) {
    const emergencyListGrid = document.getElementById("emergencyListGrid");
    const activePriorityCount = document.getElementById("activePriorityCount");

    if (!emergencyListGrid) return;

    emergencyListGrid.innerHTML = "";

    const list = Array.isArray(activeEmergencies) ? activeEmergencies : [];
    
    if (activePriorityCount) {
      activePriorityCount.textContent = `${list.length} Active priority`;
    }

    if (list.length === 0) {
      emergencyListGrid.innerHTML = `
        <div class="glass-panel p-6 text-center text-slate-400">
          <p>Tidak ada armada tanggap darurat aktif saat ini.</p>
        </div>
      `;
      return;
    }

    list.forEach(emg => {
      const card = document.createElement("div");
      const isPmk = emg.vehicleType === "PMK";
      const isFinished = ["ARRIVED", "COMPLETED", "CANCELLED"].includes(emg.status);
      card.className = `emergency-card-item pulse-red-border ${isFinished ? 'opacity-70' : ''}`;
      card.innerHTML = `
        <div class="em-header">
          <span class="badge-em red" style="background: ${isPmk ? '#f97316' : '#ef4444'};">🚨 ${emg.vehicleId} (${emg.vehicleType})</span>
          <strong class="em-status" style="color: ${isFinished ? '#22c55e' : '#ef4444'};">${emg.status}</strong>
        </div>
        <p>Rute: ${emg.routeId ? emg.routeId.replace('route-', '').toUpperCase() : 'SURABAYA CORRIDOR'}</p>
        <div class="em-meta-row">
          <div><small>ETA</small><strong>${emg.ETA || '0s'}</strong></div>
          <div><small>Kecepatan</small><strong>${emg.speed || 0} km/jam</strong></div>
          <div><small>Status Persimpangan</small><strong class="${isFinished ? 'text-slate-400' : 'text-emerald-400'}">${emg.nextIntersection || 'Selesai'}</strong></div>
        </div>
      `;
      emergencyListGrid.appendChild(card);
    });
  }
}

export const emergencyController = new EmergencyController();
