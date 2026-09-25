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
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._bindEmergencyActuatorForm();
    this._bind112SimulationButtons();
    this._setupStoreListeners();
  }

  _bindEmergencyActuatorForm() {
    const form = document.getElementById("emergencyActuatorForm");
    const respTypeInput = document.getElementById("respType");
    const respRouteInput = document.getElementById("respRoute");
    const respNameInput = document.getElementById("respName");

    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const type = respTypeInput ? respTypeInput.value : "Ambulans";
      const route = respRouteInput ? respRouteInput.value : "route-soetomo";
      const name = respNameInput && respNameInput.value.trim() ? respNameInput.value.trim() : "AMB-02";

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "PROCESSING...";
      }

      try {
        const response = await commandLayer.dispatchCommand({
          action: 'emergency:activate',
          targetType: 'emergency',
          targetId: name,
          payload: { code: name, route }
        }, true); // High risk! Employs confirmation guard.

        if (response && response.success) {
          if (typeof window.showToast === "function") {
            window.showToast(`🚨 DISPATCH BERHASIL: Sinyal Prioritas diaktifkan untuk ${name}!`, "success");
          }
        }
      } catch (err) {
        console.warn("[EmergencyController] Emergency activation error:", err);
        if (typeof window.showToast === "function") {
          window.showToast(`❌ Gagal: ${err.message || 'Server sibuk atau tidak merespons.'}`, "danger");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Kirim Sinyal Prioritas";
        }
      }
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
      btnStart.addEventListener("click", async () => {
        btnStart.disabled = true;
        if (btnStop) btnStop.disabled = false;

        const curView = stateStore.getState().currentView;
        if (curView === 'emergency') {
          const mapNav = document.querySelector('[data-view="map"]');
          if (mapNav) mapNav.click();
        }

        try {
          await commandLayer.dispatchCommand({
            action: 'emergency:activate',
            targetType: 'emergency',
            targetId: 'AMB-112',
            payload: { code: 'AMB-112', route: 'route-soetomo' }
          }, true); // High risk confirmation modal!
        } catch (err) {
          btnStart.disabled = false;
          if (btnStop) btnStop.disabled = true;
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Dispatch Ditolak: ${err.message}`, "danger");
          }
        }
      });
    }

    if (btnStop) {
      btnStop.addEventListener("click", async () => {
        try {
          await commandLayer.dispatchCommand({
            action: 'emergency:cancel',
            targetType: 'emergency',
            targetId: 'AMB-112',
            payload: { id: 'AMB-112' }
          }, false); // low risk cancel
          if (btnStart) btnStart.disabled = false;
          btnStop.disabled = true;
          soundManager.play('click');
        } catch (err) {
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal membatalkan: ${err.message}`, "danger");
          }
        }
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
