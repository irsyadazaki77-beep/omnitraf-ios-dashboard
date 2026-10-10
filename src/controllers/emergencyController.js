/**
 * OmniTRAF Surabaya - Emergency Priority & 112 Dispatch Controller
 * Mengelola form preemption darurat (Ambulans/Damkar), penguncian Green Wave pada koridor
 * A. Yani → Darmo, animasi countdown preemption, serta simulasi GIS rute 112 di peta Leaflet.
 */

import { stateStore, escapeHtml } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { trafficEngine } from '../modules/trafficEngine.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';
import { authManager } from '../core/authManager.js';

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
    this._syncRoleCapabilities();
    this.disposer.add(authManager.onAuthChange(() => this._syncRoleCapabilities()));

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
      hud.classList.toggle("is-hidden", !isGw);
    }
    this._syncStopControls();
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

  _syncRoleCapabilities() {
    const canOperate = authManager.hasRole(['OPERATOR', 'ADMIN']);
    document.querySelectorAll('#view-emergency .emergency-dispatch-btn, #view-emergency .emergency-stop-btn, #view-emergency #emergencyActuatorForm, #btnConfirmGreenWaveModal, #btnRevertEmergencyGw')
      .forEach((control) => { control.hidden = !canOperate; });
    const permissionNote = document.getElementById('emergencyPermissionNote');
    if (permissionNote) permissionNote.hidden = canOperate;
    this._syncStopControls();
  }

  _syncStopControls() {
    const state = stateStore.getState();
    const active = !!state.greenWaveActive || (state.activeEmergencies || []).some((emergency) =>
      !['ARRIVED', 'COMPLETED', 'CANCELLED', 'TERMINAL_ARCHIVED'].includes(String(emergency.status || '').toUpperCase())
    );
    const stopButtons = [document.getElementById('btnStop112Sim'), document.getElementById('btnRevertEmergencyGw')].filter(Boolean);
    stopButtons.forEach((button) => {
      button.disabled = !active;
      button.setAttribute('aria-disabled', String(!active));
      button.title = active ? 'Hentikan skenario prioritas aktif' : 'Tidak ada skenario prioritas aktif';
    });
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
    const form = document.getElementById('emergencyActuatorForm');
    if (form && !form.reportValidity()) return;
    const route = document.getElementById('respRoute');
    const target = document.getElementById('gwSelectedRoute');
    const vehicle = document.getElementById('gwSelectedVehicle');
    if (target) target.textContent = route?.selectedOptions[0]?.textContent || 'Koridor A. Yani–Darmo';
    if (vehicle) vehicle.textContent = document.getElementById('respName')?.value.trim() || 'AMB-112';

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
   * Jalankan skenario koridor prioritas di simulator
   */
  async activateGreenWaveWithSafetyTimer(durationSec = 300) {
    try {
      const respType = document.getElementById("respType")?.value || "Ambulans";
      const respRoute = document.getElementById("respRoute")?.value || "route-yani-darmo";
      const respName = document.getElementById("respName")?.value.trim() || "AMB-112";

      await commandLayer.dispatchCommand({
        action: 'emergency:activate',
        targetType: 'emergency',
        targetId: respName,
        payload: { code: respName, route: respRoute, type: respType }
      }, false);

      this.remainingGreenWaveSec = durationSec;
      if (typeof window.showToast === "function") {
        window.showToast(`Skenario prioritas ${respRoute.replace('route-', '').toUpperCase()} aktif di simulator; 112, GPS, dan APILL tidak terhubung.`, "warning");
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
      const terminal = new Set(['ARRIVED', 'COMPLETED', 'CANCELLED', 'TERMINAL_ARCHIVED']);
      const active = activeEmergencies.filter((emergency) => emergency && !terminal.has(String(emergency.status || '').toUpperCase()));
      let completed = 0;
      const failures = [];

      for (const emergency of active) {
        const id = emergency.vehicleId || emergency.id;
        if (!id) continue;
        try {
          await commandLayer.dispatchCommand({
            action: 'emergency:cancel',
            targetType: 'emergency',
            targetId: String(id),
            payload: { id: String(id) }
          }, false);
          completed += 1;
        } catch (error) {
          failures.push({ id, error });
        }
      }

      if (active.length === 0 && stateStore.getState().greenWaveActive) {
        await commandLayer.dispatchCommand({
          action: 'green-wave:toggle',
          targetType: 'system',
          targetId: 'corridor-ayani-darmo',
          payload: { active: false }
        });
        completed = 1;
      }

      if (failures.length > 0) {
        const detail = `${completed} command berhasil, ${failures.length} gagal`;
        throw new Error(`Pembatalan belum tuntas (${detail}): ${failures[0].error.message}`);
      }
      if (completed === 0) {
        if (typeof window.showToast === "function") window.showToast('Tidak ada prioritas aktif pada simulator.');
        return;
      }

      soundManager.play('success');
      if (typeof window.showToast === "function") {
        window.showToast(isAutoTimeout
          ? `Timer berakhir; ${completed} aksi simulasi dibatalkan dan dikonfirmasi server.`
          : `${completed} aksi prioritas simulasi dibatalkan dan dikonfirmasi server; infrastruktur fisik tidak terhubung.`);
      }
    } catch (err) {
      console.warn("[EmergencyController] Cancel error:", err);
      if (typeof window.showToast === 'function') window.showToast(`Pembatalan simulasi gagal: ${err.message}`, 'danger');
      soundManager.play('alert');
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
        const form = document.getElementById('emergencyActuatorForm');
        form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('respType')?.focus({ preventScroll: true });
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
      this._syncStopControls();
    });

    // Reactive Green Wave HUD and local timer sync
    this.disposer.addStoreSubscription(stateStore, 'state:greenWaveActive', ({ value }) => {
      this._syncStopControls();
      const hud = document.getElementById("emergencyGreenWaveHud");
      const timerDisplay = document.getElementById("emergencyGwCountdown");
      const chkGreenWave = document.getElementById("chkGreenWave");

      if (chkGreenWave) {
        chkGreenWave.checked = !!value;
      }

      if (value) {
        if (hud) hud.classList.remove("is-hidden");
        soundManager.play('siren');
        
        if (timerDisplay) timerDisplay.textContent = 'SIMULASI';

      } else {
        if (hud) hud.classList.add("is-hidden");
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

    const list = Array.isArray(activeEmergencies) ? activeEmergencies.filter(e => (e.vehicleId || e.id) && !['ARRIVED', 'COMPLETED', 'CANCELLED', 'TERMINAL_ARCHIVED'].includes(String(e.status).toUpperCase())) : [];
    
    if (activePriorityCount) {
      activePriorityCount.textContent = `${list.length} aktif`;
      activePriorityCount.className = list.length ? 'pill pill-danger' : 'pill pill-live';
    }

    if (list.length === 0) {
      emergencyListGrid.innerHTML = `
        <div class="glass-panel p-6 text-center text-slate-400">
          <p><strong>Tidak ada prioritas aktif.</strong><br>Pilih skenario dan rute, lalu mulai simulasi dengan sesi Operator/Admin.</p>
        </div>
      `;
      return;
    }

    list.forEach(emg => {
      const card = document.createElement("div");
      const isPmk = emg.vehicleType === "PMK";
      const isFinished = ["ARRIVED", "COMPLETED", "CANCELLED"].includes(emg.status);
      const safeVehicleId = escapeHtml(emg.vehicleId || 'ID simulasi belum tersedia');
      const vehicleTypeLabel = { AMBULANCE: 'Ambulans', AMBULANS: 'Ambulans', PMK: 'Pemadam', PATROL: 'Patroli' };
      const safeVehicleType = escapeHtml(vehicleTypeLabel[String(emg.vehicleType || '').toUpperCase()] || emg.vehicleType || 'Armada demo');
      const statusLabel = {
        REQUESTED: 'Prioritas diminta', VERIFIED: 'Permintaan diverifikasi', DISPATCHED: 'Unit didisposisikan',
        ROUTE_PREEMPTION: 'Koridor simulasi disiapkan', EN_ROUTE: 'Menuju lokasi (simulasi)',
        ARRIVED: 'Tiba (simulasi)', COMPLETED: 'Selesai (simulasi)', CANCELLED: 'Dibatalkan', TERMINAL_ARCHIVED: 'Diarsipkan'
      };
      const rawStatus = String(emg.status || 'ACTIVE').toUpperCase();
      const safeStatus = escapeHtml(statusLabel[rawStatus] || 'Status simulasi');
      const safeRoute = escapeHtml(emg.routeId ? emg.routeId.replace('route-', '').toUpperCase() : 'SURABAYA CORRIDOR');
      const safeEta = escapeHtml(emg.ETA || (isFinished ? '—' : 'Belum ada estimasi'));
      const safeSpeed = Number.isFinite(Number(emg.speed)) ? escapeHtml(emg.speed) : 'Belum tersedia';
      const safeIntersection = escapeHtml(emg.nextIntersection || (isFinished ? 'Rute selesai' : 'Belum ada data lokasi'));
      const progressByStatus = {
        REQUESTED: 2, VERIFIED: 2, DISPATCHED: 3, ROUTE_PREEMPTION: 4,
        EN_ROUTE: 5, ARRIVED: 6, COMPLETED: 6, CANCELLED: 6, TERMINAL_ARCHIVED: 6
      };
      const currentStep = progressByStatus[rawStatus] || 1;
      const terminalLabel = rawStatus === 'ARRIVED' ? 'Kendaraan tiba'
        : rawStatus === 'CANCELLED' ? 'Prioritas dibatalkan'
          : rawStatus === 'TERMINAL_ARCHIVED' ? 'Skenario diarsipkan' : 'Prioritas dilepas';
      const progressSteps = ['Kendaraan terdeteksi', 'Prioritas diminta', 'Unit didisposisikan', 'Koridor simulasi disiapkan', 'Kendaraan menuju lokasi', terminalLabel];
      const progressHtml = progressSteps.map((label, index) => {
        const step = index + 1;
        const terminalCancelled = rawStatus === 'CANCELLED' || rawStatus === 'TERMINAL_ARCHIVED';
        const stateClass = terminalCancelled && step === currentStep ? 'is-cancelled' : step < currentStep ? 'is-complete' : step === currentStep ? 'is-current' : '';
        return `<li class="emergency-progress-step ${stateClass}">${label}</li>`;
      }).join('');

      card.className = `emergency-card-item ${isFinished ? 'is-finished' : ''}`;
      card.innerHTML = `
        <div class="em-header">
          <span class="badge-em ${isPmk ? 'amber' : 'red'}">${safeVehicleId} · ${safeVehicleType}</span>
          <strong class="em-status ${isFinished ? 'is-finished' : 'is-active'}">${safeStatus}</strong>
        </div>
        <p>Rute simulasi: ${safeRoute}</p>
        <div class="em-meta-row">
          <div><small>ETA</small><strong>${safeEta}</strong></div>
          <div><small>Kecepatan model</small><strong>${safeSpeed}${safeSpeed === 'Belum tersedia' ? '' : ' km/jam'}</strong></div>
          <div><small>Posisi berikutnya</small><strong class="${isFinished ? 'text-slate-400' : 'text-emerald-400'}">${safeIntersection}</strong></div>
        </div>
        <ol class="emergency-progress" aria-label="Progres skenario prioritas, status ${safeStatus}">${progressHtml}</ol>
      `;
      emergencyListGrid.appendChild(card);
    });
  }
}

export const emergencyController = new EmergencyController();
