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

export class EmergencyController {
  constructor() {
    this.preemptTimer = null;
    this.greenWaveCountdownTimer = null;
    this.remainingGreenWaveSec = 300; // 5 minutes
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._bindEmergencyActuatorForm();
    this._bind112SimulationButtons();
    this._bindGreenWaveConfirmModal();
    this._bindHudRevertButton();
    this._setupStoreListeners();
  }

  activate() {
    this._bindEmergencyActuatorForm();
    this._bind112SimulationButtons();
    this._bindGreenWaveConfirmModal();
    this._bindHudRevertButton();
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

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
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
      };
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
      revertBtn.onclick = () => {
        this.deactivateGreenWaveToNormal();
      };
    }
  }

  /**
   * Aktifkan Koridor Darurat 112 & Jalankan Timer Keselamatan Otomatis (Maksimal 5 Menit)
   */
  async activateGreenWaveWithSafetyTimer(durationSec = 300) {
    try {
      await commandLayer.dispatchCommand({
        action: 'emergency:activate',
        targetType: 'emergency',
        targetId: 'AMB-112',
        payload: { code: 'AMB-112', route: 'route-yani-darmo' }
      }, false);

      trafficEngine.setGreenWave(true);
      this.remainingGreenWaveSec = durationSec;

      // Tampilkan HUD Darurat Merah di Bagian Atas
      const hud = document.getElementById("emergencyGreenWaveHud");
      const timerDisplay = document.getElementById("emergencyGwCountdown");

      if (hud) {
        hud.style.display = "block";
      }

      soundManager.play('siren');

      if (this.greenWaveCountdownTimer) clearInterval(this.greenWaveCountdownTimer);

      this.greenWaveCountdownTimer = setInterval(() => {
        this.remainingGreenWaveSec--;

        const mins = Math.floor(this.remainingGreenWaveSec / 60);
        const secs = this.remainingGreenWaveSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (timerDisplay) timerDisplay.textContent = formatted;

        if (this.remainingGreenWaveSec <= 0) {
          // Auto-revert safety trigger hit
          this.deactivateGreenWaveToNormal(true);
        }
      }, 1000);

      if (typeof window.showToast === "function") {
        window.showToast("🚨 KORIDOR DARURAT 112 AKTIF: Sinyal A. Yani - Darmo HIJAU | Simpang Tegak Lurus MERAH!", "alert");
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * Kembalikan Koridor Darurat ke Normal Adaptive Mode
   */
  async deactivateGreenWaveToNormal(isAutoTimeout = false) {
    if (this.greenWaveCountdownTimer) {
      clearInterval(this.greenWaveCountdownTimer);
      this.greenWaveCountdownTimer = null;
    }

    const hud = document.getElementById("emergencyGreenWaveHud");
    if (hud) {
      hud.style.display = "none";
    }

    try {
      await commandLayer.dispatchCommand({
        action: 'emergency:cancel',
        targetType: 'emergency',
        targetId: 'AMB-112',
        payload: { id: 'AMB-112' }
      }, false);

      trafficEngine.setGreenWave(false);
      soundManager.play('success');

      if (typeof window.showToast === "function") {
        if (isAutoTimeout) {
          window.showToast("⏱️ Timer Keselamatan 5 Menit Berakhir: Koridor Darurat 112 dinormalisasi otomatis ke mode adaptif.");
        } else {
          window.showToast("✓ Koridor Darurat 112 dinormalisasi kembali ke mode adaptif.");
        }
      }
    } catch (err) {
      console.warn("[EmergencyController] Cancel error:", err);
      trafficEngine.setGreenWave(false);
    }
  }

  _bindEmergencyActuatorForm() {
    const form = document.getElementById("emergencyActuatorForm");
    const respTypeInput = document.getElementById("respType");
    const respRouteInput = document.getElementById("respRoute");
    const respNameInput = document.getElementById("respName");

    if (!form) return;

    form.addEventListener("submit", (e) => {
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

    if (this.preemptTimer) clearInterval(this.preemptTimer);
    this.preemptTimer = setInterval(() => {
      seconds--;
      if (countdownText) countdownText.textContent = `${seconds}s`;
      if (progressCircle) {
        const pct = Math.round((seconds / maxSeconds) * 100);
        progressCircle.setAttribute("stroke-dasharray", `${pct}, 100`);
      }

      if (seconds <= 0) {
        clearInterval(this.preemptTimer);
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
      btnStart.addEventListener("click", () => {
        const curView = stateStore.getState().currentView;
        if (curView === 'emergency') {
          const mapNav = document.querySelector('[data-view="map"]');
          if (mapNav) mapNav.click();
        }
        this.openGreenWaveConfirmModal();
      });
    }

    if (btnStop) {
      btnStop.addEventListener("click", () => {
        this.deactivateGreenWaveToNormal();
      });
    }
  }

  _setupStoreListeners() {
    // Listen to changes in activeEmergencies to render the list dynamically in the UI panel!
    stateStore.subscribe('state:activeEmergencies', ({ value }) => {
      this._renderEmergencyListUI(value);
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
