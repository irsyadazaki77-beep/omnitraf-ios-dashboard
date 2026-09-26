/**
 * OmniTRAF Surabaya - Adaptive Traffic Engine (Phase 2 Master Architecture)
 * Logika SITS Surabaya yang sepenuhnya reaktif berbasis StateStore sebagai Single Source of Truth.
 *
 * Alur Data:
 * Backend State → Socket.io → StateStore → TrafficEngine Subscriptions → UI (Smart DOM Diffing)
 *
 * Prinsip:
 * - Tidak ada dual-tick / timer acceleration saat connected ke backend.
 * - Local Simulator hanya aktif setelah grace period (3000ms) saat koneksi offline.
 * - Local Simulator selalu melanjutkan dari state terakhir (Last Known Good State) di StateStore.
 * - Seluruh intervensi operator (Green Wave, Chaos, Preempt, Green Split) memiliki acknowledgement dari server.
 */

import { stateStore, updateTrafficState, updateSignalState } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { commandLayer } from '../core/commandLayer.js';

export class TrafficEngine {
  constructor() {
    this.localSimInterval = null;
    this.graceTimer = null;
    this._localSimulationRunning = false;
    this._isInitialized = false;
    this._unsubscribeCallbacks = [];

    this.yellowDuration = 3;
    this.redDurationBase = 25;
    this.isRainMode = false;
  }

  /**
   * Helper mutasi DOM pintar untuk mencegah DOM Thrashing & Layout Recalculation yang tidak perlu.
   * @param {string|HTMLElement} target - ID elemen string atau instance HTMLElement
   * @param {string|null} [text=null] - Nilai teks baru
   * @param {string|null} [className=null] - Nilai class CSS baru
   */
  _smartUpdateDOM(target, text = null, className = null) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    if (text !== null && el.textContent !== text) {
      el.textContent = text;
      el.classList.add('value-flash');
      setTimeout(() => el.classList.remove('value-flash'), 400);
    }

    if (className !== null && el.className !== className) {
      el.className = className;
    }
  }

  /**
   * Inisialisasi reaktif Traffic Engine (Idempotent)
   */
  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    console.info("🚀 [TrafficEngine] Menginisialisasi Unified Reactive Traffic Engine (Phase 2)...");

    this._setupStoreSubscriptions();
    this._bindControls();

    // Render snapshot awal dari StateStore
    this._renderFromState(stateStore.getState());

    // Evaluasi koneksi awal: jika dalam 3.5 detik tidak ada koneksi, jadwalkan simulasi lokal
    this.graceTimer = setTimeout(() => {
      const currentState = stateStore.getState();
      if (!currentState.sseConnected && currentState.connectionStatus !== 'connected' && currentState.connectionStatus !== 'resyncing') {
        this.startLocalSimulation();
      }
    }, 3500);
  }

  _setupStoreSubscriptions() {
    // 1. Dengarkan pembaruan telemetri & traffic dari StateStore
    const unTraffic = stateStore.subscribe("traffic:update", () => {
      const state = stateStore.getState();
      this._renderFromState(state);
    });

    const unResynced = stateStore.subscribe("state:resynced", () => {
      const state = stateStore.getState();
      this._renderFromState(state);
    });

    // 2. Dengarkan perubahan status socket untuk mengontrol simulator lokal & grace period
    const unSocket = stateStore.subscribe("socket:status", (envelope) => {
      const status = envelope?.payload?.status || envelope;
      
      if (status === "connected" || status === "resyncing") {
        if (this.graceTimer) {
          clearTimeout(this.graceTimer);
          this.graceTimer = null;
        }
        this.stopLocalSimulation();
      } else if (status === "offline" || status === "fallback" || status === "reconnecting") {
        // Jangan langsung menjalankan simulasi; tunggu grace period 3000ms
        if (!this._localSimulationRunning && !this.graceTimer) {
          this.graceTimer = setTimeout(() => {
            this.graceTimer = null;
            const cur = stateStore.getState();
            if (cur.connectionStatus === "offline" || cur.connectionStatus === "fallback" || cur.connectionStatus === "reconnecting") {
              this.startLocalSimulation();
            }
          }, 3000);
        }
      }
    });

    // 3. Subscription khusus untuk parameter slider & cuaca
    const unGreenSplit = stateStore.subscribe("state:greenSplitWonokromo", ({ value }) => {
      this._smartUpdateDOM("greenValue", `${value} dtk`);
    });

    const unRain = stateStore.subscribe("state:isRainMode", ({ value }) => {
      this.setWeatherAdaptation(value);
    });

    this._unsubscribeCallbacks.push(unTraffic, unResynced, unSocket, unGreenSplit, unRain);
  }

  /**
   * Render seluruh komponen UI berdasarkan StateStore Snapshot (Single Source of Truth)
   * @param {Object} state
   */
  _renderFromState(state) {
    if (!state) return;

    const telemetry = state.telemetry || {};
    const intersections = state.intersections || [];
    const isChaos = !!state.isChaosMode;
    const chaosLevel = state.chaosLevel || 0;
    const isGreenWave = !!state.greenWaveActive;
    const emergencies = state.activeEmergencies || [];

    this._renderHeaderAndBriefing(state, telemetry, emergencies);
    this._renderApillTimers(intersections, isGreenWave);
    this._renderChaosUI(isChaos, chaosLevel);
    this._renderKpiMetrics(telemetry, state);
    this._renderEmergencyList(emergencies);
  }

  /**
   * Render Header Status & Operational Briefing Bar
   */
  _renderHeaderAndBriefing(state, telemetry, emergencies) {
    const isConnected = state.connectionStatus === 'connected';
    const isResync = state.connectionStatus === 'resyncing';
    
    // Header Status Strip
    const provText = isConnected ? 'SITS GATEWAY LIVE' : isResync ? 'RESYNCING SITS' : 'SIMULATED CACHE';
    const provClass = isConnected ? 'provenance-badge live' : isResync ? 'provenance-badge derived' : 'provenance-badge simulated';
    
    this._smartUpdateDOM('dashHeaderProv', provText, provClass);
    this._smartUpdateDOM('briefingProvenance', isConnected ? 'REALTIME SITS' : 'LOCAL SIMULATION', provClass);
    
    // Local Time Clock
    const nowStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
    this._smartUpdateDOM('dashLocalTime', nowStr);

    // Briefing Grid Metrics
    const congestion = telemetry.congestionIndex ?? telemetry.networkLoad ?? 68;
    const congestionText = `${congestion}% — ${congestion >= 75 ? 'Macet Total' : congestion >= 60 ? 'Beban Sedang-Tinggi' : 'Lancar'}`;
    this._smartUpdateDOM('briefingCongestionVal', congestionText);

    if (Array.isArray(emergencies) && emergencies.length > 0) {
      const firstEmg = emergencies[0];
      this._smartUpdateDOM('briefingAlertVal', `Prioritas ${firstEmg.vehicleId || 'Ambulans'} Aktif`);
      this._smartUpdateDOM('briefingAlertSub', `ETA ${firstEmg.ETA || '1m 45s'} • Rute Prioritas Hijau`);
    } else {
      this._smartUpdateDOM('briefingAlertVal', 'Kondisi Koridor Normal');
      this._smartUpdateDOM('briefingAlertSub', 'Sistem Siaga Dispatch 112');
    }
  }

  /**
   * 1. Rendering Timer APILL dengan Smart DOM Diffing
   */
  _renderApillTimers(intersections, isGreenWave) {
    if (!Array.isArray(intersections) || intersections.length === 0) return;

    // Simpang Wonokromo
    const nodeW = intersections.find(n => n.id === "node-wonokromo") || intersections[0];
    if (nodeW) {
      if (isGreenWave) {
        this._smartUpdateDOM("wonokromoBadge", "GREEN WAVE (HIJAU)", "status-badge green");
        this._smartUpdateDOM("wonokromoGreenTime", "∞");
        this._smartUpdateDOM("wonokromoYellowTime", "0s");
        this._smartUpdateDOM("wonokromoRedTime", "0s");
      } else if (nodeW.state === "green") {
        this._smartUpdateDOM("wonokromoBadge", `HIJAU (${nodeW.timer}s)`, "status-badge green");
        this._smartUpdateDOM("wonokromoGreenTime", `${nodeW.timer}s`);
        this._smartUpdateDOM("wonokromoYellowTime", "0s");
        this._smartUpdateDOM("wonokromoRedTime", "0s");
      } else if (nodeW.state === "yellow") {
        this._smartUpdateDOM("wonokromoBadge", `KUNING (${nodeW.timer}s)`, "status-badge yellow");
        this._smartUpdateDOM("wonokromoGreenTime", "0s");
        this._smartUpdateDOM("wonokromoYellowTime", `${nodeW.timer}s`);
        this._smartUpdateDOM("wonokromoRedTime", "0s");
      } else {
        this._smartUpdateDOM("wonokromoBadge", `MERAH (${nodeW.timer}s)`, "status-badge red");
        this._smartUpdateDOM("wonokromoGreenTime", "0s");
        this._smartUpdateDOM("wonokromoYellowTime", "0s");
        this._smartUpdateDOM("wonokromoRedTime", `${nodeW.timer}s`);
      }
    }

    // Simpang Margorejo
    const nodeM = intersections.find(n => n.id === "node-margorejo") || intersections[1];
    if (nodeM) {
      if (isGreenWave) {
        this._smartUpdateDOM("margorejoBadge", "GREEN WAVE (HIJAU)", "status-badge green");
        this._smartUpdateDOM("margorejoGreenTime", "∞");
        this._smartUpdateDOM("margorejoRedTime", "0s");
      } else if (nodeM.state === "green") {
        this._smartUpdateDOM("margorejoBadge", `HIJAU (${nodeM.timer}s)`, "status-badge green");
        this._smartUpdateDOM("margorejoGreenTime", `${nodeM.timer}s`);
        this._smartUpdateDOM("margorejoRedTime", "0s");
      } else {
        this._smartUpdateDOM("margorejoBadge", `MERAH (${nodeM.timer}s)`, "status-badge red");
        this._smartUpdateDOM("margorejoGreenTime", "0s");
        this._smartUpdateDOM("margorejoRedTime", `${nodeM.timer}s`);
      }
    }

    // Update Phase Cycle Numbers pada Widget Sinyal
    intersections.forEach((node, idx) => {
      const cycleText = typeof node.timer === "number" ? String(node.timer) : "∞";
      this._smartUpdateDOM(`cycleVal${idx + 1}`, cycleText);
    });
  }

  /**
   * 2. Render UI Mode Keos (Chaos Mode)
   */
  _renderChaosUI(isChaos, chaosLevel) {
    const sirenBanner = document.getElementById("sirenBanner");
    const btnToggle = document.getElementById("btnToggleChaos");

    if (isChaos) {
      if (!document.body.classList.contains("chaos-active")) {
        document.body.classList.add("chaos-active");
      }
      if (sirenBanner && !sirenBanner.classList.contains("show")) {
        sirenBanner.classList.add("show");
      }
      if (btnToggle) {
        this._smartUpdateDOM(btnToggle, `⚠️ NONAKTIFKAN KEOS (${chaosLevel})`, "control-btn-danger active");
      }
    } else {
      if (document.body.classList.contains("chaos-active")) {
        document.body.classList.remove("chaos-active");
      }
      if (sirenBanner && sirenBanner.classList.contains("show")) {
        sirenBanner.classList.remove("show");
      }
      if (btnToggle) {
        this._smartUpdateDOM(btnToggle, "⚠️ MODE KEOS", "control-btn-danger");
      }
    }

    this._toggleDeviceTableChaos(isChaos);
  }

  /**
   * 3. Render Metric KPI Dashboard
   */
  _renderKpiMetrics(telemetry, state) {
    const avgWaitTime = telemetry.avgWaitTime ?? 42;
    const networkLoad = telemetry.networkLoad ?? 72;
    const co2SavedKg = telemetry.co2SavedKg ?? 1420;
    const sitsSignal = telemetry.sitsSignal ?? 94;

    const avgWaitCard = this._findKpiCard("Rata-rata Waktu Tunggu");
    if (avgWaitCard) {
      const counter = avgWaitCard.querySelector(".counter-val") || avgWaitCard.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, `${avgWaitTime}s`);
    }

    const netLoadCard = this._findKpiCard("Beban Jaringan");
    if (netLoadCard) {
      const counter = netLoadCard.querySelector(".counter-val") || netLoadCard.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, `${networkLoad}%`);
    }

    const co2Card = this._findKpiCard("Reduksi Emisi");
    if (co2Card) {
      const counter = co2Card.querySelector(".counter-val") || co2Card.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, `${Math.round(co2SavedKg).toLocaleString('id-ID')} kg`);
    }

    const sitsSignalEl = document.getElementById("sitsStatusText");
    if (sitsSignalEl) {
      if (state.connectionStatus === 'connected') {
        this._smartUpdateDOM(sitsSignalEl, `${sitsSignal}%`);
      }
    }
  }

  _findKpiCard(titleKeyword) {
    const cards = document.querySelectorAll(".stat-card");
    for (const c of cards) {
      const titleEl = c.querySelector("h3") || c.querySelector("p");
      if (titleEl && titleEl.textContent.includes(titleKeyword)) {
        return c;
      }
    }
    return null;
  }

  /**
   * 4. Render Active Emergency List Feed
   */
  _renderEmergencyList(emergencies) {
    if (!Array.isArray(emergencies)) return;
    const countEl = document.getElementById("activePriorityCount");
    if (countEl) {
      this._smartUpdateDOM(countEl, `${emergencies.length} Active priority`);
    }
  }

  _toggleDeviceTableChaos(isChaos) {
    const rows = document.querySelectorAll(".devices-table tbody tr");
    rows.forEach(r => {
      if (isChaos) {
        r.classList.add("chaos-device-warning");
      } else {
        r.classList.remove("chaos-device-warning");
      }
    });
  }

  /**
   * Mengatur status Emergency Green Wave secara global dengan Acknowledged Server Sync
   * @param {boolean} active
   */
  async setGreenWave(active) {
    const isBool = !!active;
    const chk = document.getElementById("chkGreenWave");

    try {
      await commandLayer.dispatchCommand({
        action: 'green-wave:toggle',
        targetType: 'system',
        targetId: 'green-wave-corridor',
        payload: { active: isBool }
      }, isBool); // High risk confirmation guard when activating (isBool === true)

      if (chk && chk.checked !== isBool) {
        chk.checked = isBool;
      }
    } catch (err) {
      console.error("[TrafficEngine] Green wave change failed:", err);
      if (chk) {
        chk.checked = !isBool;
      }
      if (typeof window.showToast === "function") {
        window.showToast(`❌ Gagal: ${err.message}`, "danger");
      }
    }
  }

  /**
   * Preempt Spesifik Persimpangan untuk Koridor Prioritas Darurat
   */
  async preemptIntersection(nodeId, state = 'green', durationSec = 45) {
    if (socketClient.isConnected()) {
      try {
        const response = await socketClient.emitWithAck('signal:override', { intersectionId: nodeId, duration: durationSec }, 4000);
        if (response && response.success) {
          updateSignalState(nodeId, {
            state,
            timer: durationSec,
            status: "Preempt Clearance (Acknowledged)"
          }, 'server');
        } else {
          throw new Error("Server rejected signal override");
        }
      } catch (err) {
        console.error("[TrafficEngine] Preempt intersection server ack timeout/error:", err);
        if (typeof window.showToast === "function") {
          window.showToast(`❌ Gagal override sinyal ${nodeId}: Server tidak merespons.`, "danger");
        }
      }
    } else {
      updateSignalState(nodeId, {
        state,
        timer: durationSec,
        status: "Preempt Clearance"
      }, 'controller');
    }
  }

  /**
   * Mengatur adaptasi cuaca terhadap waktu kuning & buffer all-red
   */
  setWeatherAdaptation(isRain) {
    this.isRainMode = !!isRain;
    this.yellowDuration = this.isRainMode ? 4.5 : 3.0;
  }

  /**
   * Memulai Loop Simulasi Lokal Offline (Meneruskan State Terakhir dari StateStore)
   */
  startLocalSimulation() {
    if (this._localSimulationRunning) return;
    this._localSimulationRunning = true;
    console.info("⚡ [TrafficEngine] Local Simulation Loop Active (Melanjutkan dari Last Known Good State).");

    if (this.localSimInterval) clearInterval(this.localSimInterval);

    this.localSimInterval = setInterval(() => {
      const curState = stateStore.getState();
      // Guard mutlak: hentikan seketika jika backend terhubung
      if (curState.connectionStatus === 'connected' || curState.connectionStatus === 'resyncing') {
        this.stopLocalSimulation();
        return;
      }

      const curTel = curState.telemetry || {};
      const newVehicles = (curTel.vehiclesToday || 128540) + Math.floor(Math.random() * 4) + 1;
      const newCo2 = (curTel.co2SavedKg || 1420) + 0.2;
      const newFuel = (curTel.fuelSavedLiters || 580) + 0.08;
      const timeStr = new Date().toLocaleTimeString('id-ID') + ' WIB';

      const updatedIntersections = (curState.intersections || []).map(node => {
        const nextNode = { ...node };

        if (curState.greenWaveActive && (nextNode.id === "node-wonokromo" || nextNode.id === "node-margorejo" || nextNode.id === "node-darmo")) {
          nextNode.state = "green";
          nextNode.timer = "∞";
          nextNode.status = "Green Wave";
          return nextNode;
        }

        let curTimer = typeof nextNode.timer === "string" ? (nextNode.greenSplit || 35) : nextNode.timer;
        curTimer--;

        if (curTimer <= 0) {
          if (nextNode.state === "green") {
            nextNode.state = "yellow";
            curTimer = Math.round(this.yellowDuration);
          } else if (nextNode.state === "yellow") {
            nextNode.state = "red";
            curTimer = nextNode.id === "node-wonokromo" ? this.redDurationBase : 25;
          } else {
            nextNode.state = "green";
            curTimer = nextNode.id === "node-wonokromo" ? (curState.greenSplitWonokromo || 35) : (nextNode.greenSplit || 30);
          }
        }

        nextNode.timer = curTimer;
        if (nextNode.state === "red") nextNode.status = curState.isChaosMode ? "Macet Total" : "Padat";
        else if (nextNode.state === "yellow") nextNode.status = "Transisi";
        else nextNode.status = curState.isChaosMode ? "Merayap" : "Lancar";

        return nextNode;
      });

      // Handle chaos level decay in local simulation
      let nextChaosLevel = curState.chaosLevel;
      let nextIsChaos = curState.isChaosMode;
      if (curState.isChaosMode && nextChaosLevel > 0 && Math.random() < 0.1) {
        nextChaosLevel--;
        if (nextChaosLevel <= 0) {
          nextIsChaos = false;
          if (typeof window.showToast === "function") {
            window.showToast("Sistem ATCS Surabaya pulih otomatis dari Mode Keos.");
          }
        }
      }

      // Sinkronkan ke StateStore sebagai Single Source of Truth
      updateTrafficState({
        isChaosMode: nextIsChaos,
        chaosLevel: nextChaosLevel,
        intersections: updatedIntersections,
        networkLoad: nextIsChaos ? Math.floor(90 + Math.random() * 8) : Math.floor(65 + Math.random() * 8),
        avgWaitTime: nextIsChaos ? Math.floor(100 + Math.random() * 15) : Math.floor(38 + Math.random() * 6),
        congestionIndex: nextIsChaos ? Math.floor(88 + Math.random() * 8) : Math.floor(58 + Math.random() * 6),
        vehiclesToday: newVehicles,
        co2SavedKg: Math.round(newCo2),
        fuelSavedLiters: Math.round(newFuel),
        timestamp: timeStr
      }, 'local-simulator');

    }, 1000);
  }

  /**
   * Menghentikan Loop Simulasi Lokal saat server Socket online kembali
   */
  stopLocalSimulation() {
    this._localSimulationRunning = false;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.localSimInterval) {
      clearInterval(this.localSimInterval);
      this.localSimInterval = null;
    }
  }

  /**
   * Bind DOM Events & Controls
   */
  _bindControls() {
    this._bindGreenWaveToggle();
    this._bindChaosMode();
    this._bindSignalModal();
    this._bindAiRecommendationButtons();
  }

  _bindGreenWaveToggle() {
    const chkGreenWave = document.getElementById("chkGreenWave");
    if (!chkGreenWave) return;

    chkGreenWave.addEventListener("change", (e) => {
      const isActive = e.target.checked;
      this.setGreenWave(isActive);
      soundManager.play('click');
    });
  }

  _bindChaosMode() {
    const btnToggleChaos = document.getElementById("btnToggleChaos");
    const btnMuteSiren = document.getElementById("btnMuteSiren");

    if (btnToggleChaos) {
      btnToggleChaos.addEventListener("click", async () => {
        const current = stateStore.getState().isChaosMode;
        const target = !current;
        btnToggleChaos.disabled = true;

        try {
          await commandLayer.dispatchCommand({
            action: 'chaos:toggle',
            targetType: 'system',
            targetId: 'atcs-chaos-sim',
            payload: { active: target }
          }, false); // low-risk simulation toggle
        } catch (err) {
          console.warn("[TrafficEngine] Chaos toggle failed:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal: ${err.message}`, "danger");
          }
        } finally {
          btnToggleChaos.disabled = false;
        }
        soundManager.play('click');
      });
    }

    if (btnMuteSiren) {
      btnMuteSiren.addEventListener("click", async () => {
        const currentMuted = !!stateStore.getState().isSirenMuted;
        const targetMuted = !currentMuted;
        btnMuteSiren.disabled = true;

        try {
          await commandLayer.dispatchCommand({
            action: 'siren:mute',
            targetType: 'system',
            targetId: 'siren-sound-node',
            payload: { muted: targetMuted }
          }, false); // low-risk
          this._smartUpdateDOM(btnMuteSiren, targetMuted ? "Unmute Sirine" : "Mute Sirine");
        } catch (err) {
          console.warn("[TrafficEngine] Siren mute failed:", err);
        } finally {
          btnMuteSiren.disabled = false;
        }
        soundManager.play('click');
      });
    }
  }

  _bindAiRecommendationButtons() {
    const buttons = document.querySelectorAll('button[data-action="simulate"], button[data-action="apply-ai"], .btn-apply-ai, #btnApplyAiRec');
    buttons.forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "PROCESSING...";

        try {
          const recId = "REC-AI-" + Date.now().toString().slice(-4);
          await commandLayer.dispatchCommand({
            action: 'ai:apply-recommendation',
            targetType: 'intersection',
            targetId: 'node-wonokromo',
            payload: { recommendationId: recId }
          }, false); // low-risk
          
          if (typeof window.showToast === "function") {
            window.showToast("✓ Rekomendasi AI berhasil diterapkan oleh Operator!");
          }
        } catch (err) {
          console.warn("[TrafficEngine] AI recommendation failed:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal: ${err.message}`, "danger");
          }
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
        soundManager.play('success');
      });
    });
  }

  _bindSignalModal() {
    const signalIntelModal = document.getElementById("signalIntelModal");
    const closeSignalIntelModal = document.getElementById("closeSignalIntelModal");

    document.querySelectorAll('button[data-action="system-check"]').forEach(btn => {
      btn.addEventListener("click", () => {
        if (signalIntelModal) {
          signalIntelModal.style.display = "flex";
          signalIntelModal.classList.add("show");
        }
        soundManager.play('click');
      });
    });

    if (closeSignalIntelModal && signalIntelModal) {
      closeSignalIntelModal.addEventListener("click", () => {
        signalIntelModal.style.display = "none";
        signalIntelModal.classList.remove("show");
      });

      signalIntelModal.addEventListener("click", (e) => {
        if (e.target === signalIntelModal) {
          signalIntelModal.style.display = "none";
          signalIntelModal.classList.remove("show");
        }
      });
    }
  }

  destroy() {
    this.stopLocalSimulation();
    this._unsubscribeCallbacks.forEach(un => {
      if (typeof un === 'function') un();
    });
    this._unsubscribeCallbacks = [];
  }
}

export const trafficEngine = new TrafficEngine();
