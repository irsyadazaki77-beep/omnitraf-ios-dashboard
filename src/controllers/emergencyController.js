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

export class EmergencyController {
  constructor() {
    this.preemptTimer = null;
  }

  init() {
    this._bindEmergencyActuatorForm();
    this._bind112SimulationButtons();
  }

  _bindEmergencyActuatorForm() {
    const form = document.getElementById("emergencyActuatorForm");
    const respTypeInput = document.getElementById("respType");
    const respRouteInput = document.getElementById("respRoute");
    const respNameInput = document.getElementById("respName");
    const countdownContainer = document.getElementById("preemptCountdownContainer");
    const countdownText = document.getElementById("preemptCountdownText");
    const progressCircle = document.getElementById("preemptProgressCircle");
    const emergencyListGrid = document.getElementById("emergencyListGrid");
    const activePriorityCount = document.getElementById("activePriorityCount");

    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const type = respTypeInput ? respTypeInput.value : "Ambulans";
      const route = respRouteInput ? respRouteInput.value : "route-yani-darmo";
      const name = respNameInput && respNameInput.value.trim() ? respNameInput.value.trim() : "Ambulans SITS-08";

      // Activate Green Wave in Traffic Engine & Socket
      trafficEngine.setGreenWave(true);
      socketClient.emit('emergency:activate', { code: name, route });

      // Start Countdown UI
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
            window.showToast(`Prioritas Koridor Darurat ${name} telah selesai. Sinyal SITS kembali adaptif.`);
          }
        }
      }, 1000);

      // Add emergency card item to feed
      if (emergencyListGrid) {
        const newCard = document.createElement("div");
        newCard.className = "emergency-card-item pulse-red-border";
        newCard.innerHTML = `
          <div class="em-header">
            <span class="badge-em red">🚨 ${name} (${type})</span>
            <strong class="em-status">PRIORITY GRANTED</strong>
          </div>
          <p>Rute: ${route.replace('route-', '').replace(/-/g, ' ').toUpperCase()} (Koridor Darurat)</p>
          <div class="em-meta-row">
            <div><small>ETA</small><strong>1m 15s</strong></div>
            <div><small>Kecepatan</small><strong>75 km/jam</strong></div>
            <div><small>Signal Overrides</small><strong class="green-text">Active (Preemption Aktif)</strong></div>
          </div>
        `;
        emergencyListGrid.insertBefore(newCard, emergencyListGrid.firstChild);
      }

      if (activePriorityCount) {
        activePriorityCount.textContent = "3 Active priority";
      }

      // GIS Simulation in Leaflet Map
      if (typeof mapManager?.startEmergencyAmbulanceSimulation === 'function') {
        mapManager.startEmergencyAmbulanceSimulation();
      }

      soundManager.play('alert');
      if (typeof window.showToast === "function") {
        window.showToast(`🚨 Prioritas Sinyal Diberikan: Mengawal ${name} sepanjang Koridor Darurat`, "warning");
      }
    });
  }

  _bind112SimulationButtons() {
    const btnStart = document.getElementById("btnStart112Sim");
    const btnStop = document.getElementById("btnStop112Sim");

    if (btnStart) {
      btnStart.addEventListener("click", () => {
        btnStart.disabled = true;
        if (btnStop) btnStop.disabled = false;

        const curView = stateStore.getState().currentView;
        if (curView === 'emergency') {
          const mapNav = document.querySelector('[data-view="map"]');
          if (mapNav) mapNav.click();
        }

        trafficEngine.setGreenWave(true);
        mapManager.startEmergency112Simulation(
          () => {},
          () => {
            btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
            trafficEngine.setGreenWave(false);
          }
        );
      });
    }

    if (btnStop) {
      btnStop.addEventListener("click", () => {
        mapManager.stopEmergency112Simulation(false);
        trafficEngine.setGreenWave(false);
        if (btnStart) btnStart.disabled = false;
        btnStop.disabled = true;
        soundManager.play('click');
      });
    }
  }
}

export const emergencyController = new EmergencyController();
