/**
 * OmniTRAF Surabaya - Adaptive Traffic Engine (Reactive Socket.io Architecture)
 * Logika SITS Surabaya yang sepenuhnya reaktif berbasis WebSockets & Offline Fallback Simulation.
 * Seluruh kalkulasi timer, siklus APILL, status Mode Keos, dan prioritas darurat
 * dihitung oleh server (Single Source of Truth) saat online, atau fallback simulation mulus saat offline.
 * Dilengkapi helper `_smartUpdateDOM` untuk mencegah DOM Thrashing / Layout Recalculations.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { mapManager } from './mapManager.js';

let socketInstance = null;

function getSocket() {
  if (socketInstance) return socketInstance;

  try {
    if (typeof window.io !== "undefined") {
      socketInstance = window.io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 4000
      });
      bindSocketEvents(socketInstance);
    } else {
      // Dynamic fallback import for ESM environment
      const script = document.createElement("script");
      script.src = "/socket.io/socket.io.js";
      script.onload = () => {
        if (typeof window.io !== "undefined" && !socketInstance) {
          socketInstance = window.io({
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 4000
          });
          bindSocketEvents(socketInstance);
        }
      };
      script.onerror = () => {
        console.info("[TrafficEngine] Backend Socket.io unavailable. Running Local Mock Simulation Fallback.");
        stateStore.setState({ sseConnected: false });
        stateStore.publish("socket:status", "fallback");
        stateStore.publish("socket:connected", false);
        trafficEngine.startLocalSimulation();
      };
      document.head.appendChild(script);
    }
  } catch (err) {
    console.warn("[TrafficEngine] Socket connection deferred:", err);
    stateStore.publish("socket:status", "fallback");
    trafficEngine.startLocalSimulation();
  }

  if (socketInstance) {
    bindSocketEvents(socketInstance);
  }

  return socketInstance;
}

function bindSocketEvents(socket) {
  if (!socket) return;

  socket.on('connect', () => {
    console.info("⚡ [TrafficEngine] Terhubung ke Backend Socket.io Real-Time Engine.");
    stateStore.setState({ sseConnected: true });
    stateStore.publish("socket:status", "connected");
    stateStore.publish("socket:connected", true);
    trafficEngine.stopLocalSimulation();
  });

  socket.on('reconnect_attempt', () => {
    stateStore.publish("socket:status", "reconnecting");
  });

  socket.on('reconnecting', () => {
    stateStore.publish("socket:status", "reconnecting");
  });

  socket.on('connect_error', () => {
    stateStore.setState({ sseConnected: false });
    stateStore.publish("socket:status", "fallback");
    stateStore.publish("socket:connected", false);
    trafficEngine.startLocalSimulation();
  });

  socket.on('disconnect', () => {
    console.warn("⚠️ [TrafficEngine] Koneksi Socket.io terputus dari server. Beralih ke Local Simulation.");
    stateStore.setState({ sseConnected: false });
    stateStore.publish("socket:status", "fallback");
    stateStore.publish("socket:connected", false);
    trafficEngine.startLocalSimulation();
  });

  // Handle Initial & Periodic Traffic State Updates from Server
  socket.on('traffic:init', (data) => {
    trafficEngine.handleServerStateUpdate(data);
  });

  socket.on('traffic:update', (data) => {
    trafficEngine.handleServerStateUpdate(data);
  });

  // System Toast Notifications from Server
  socket.on('system:toast', (data) => {
    if (data && data.message && typeof window.showToast === "function") {
      window.showToast(data.message);
      if (data.type === 'alert' || data.type === 'danger') {
        soundManager.play('alert');
      } else {
        soundManager.play('success');
      }
    }
  });

  socket.on('emergency:dispatch-alert', (data) => {
    if (data && typeof window.showToast === "function") {
      window.showToast(`🚨 DISPATCH AUTOMATION: ${data.code} (${data.vehicle}) diberikan Hak Utama.`);
      soundManager.play('alert');
    }
  });
}

export class TrafficEngine {
  constructor() {
    this.socket = null;
    this.lastState = null;
    this.localSimInterval = null;
    this._localSimulationRunning = false;
    this._initFallbackState();
    this._setupStoreListeners();
  }

  _initFallbackState() {
    this.mockState = {
      timestamp: new Date().toLocaleTimeString('id-ID') + ' WIB',
      networkLoad: 68,
      avgWaitTime: 39,
      congestionIndex: 58,
      co2SavedKg: 1428,
      fuelSavedLiters: 584,
      vehiclesToday: 128620,
      sitsUptime: 99.4,
      cctvOnline: 184,
      iotOnline: 312,
      sitsSignal: 96,
      aiScore: 94,
      aiConfidence: 96,
      isChaosMode: false,
      chaosLevel: 0,
      greenWaveActive: false,
      greenSplitWonokromo: 35,
      intersections: [
        { id: "node-wonokromo", name: "Simpang Wonokromo", state: "green", timer: 24, greenSplit: 35, waitTime: 42, status: "Normal" },
        { id: "node-margorejo", name: "Simpang Margorejo", state: "red", timer: 12, greenSplit: 28, waitTime: 36, status: "Lancar" },
        { id: "node-darmo", name: "Simpang Raya Darmo", state: "green", timer: 28, greenSplit: 42, waitTime: 28, status: "Lancar" },
        { id: "node-tunjungan", name: "Simpang Tunjungan", state: "yellow", timer: 3, greenSplit: 30, waitTime: 48, status: "Padat" },
        { id: "node-merr", name: "Simpang MERR Kertajaya", state: "green", timer: 35, greenSplit: 45, waitTime: 22, status: "Lancar" }
      ],
      activeEmergencies: [
        { id: "EMG-101", code: "AMB-01", route: "route-soetomo", vehicle: "Ambulans RSU Dr. Soetomo", status: "PRIORITAS AKTIF" }
      ]
    };
  }

  _setupStoreListeners() {
    stateStore.subscribe('state:greenSplitWonokromo', ({ value }) => {
      this._smartUpdateDOM("greenValue", `${value} dtk`);
    });

    stateStore.subscribe('state:isRainMode', ({ value }) => {
      this.setWeatherAdaptation(value);
    });
  }

  /**
   * Helper mutasi DOM pintar untuk mencegah DOM Thrashing & Layout Recalculation yang tidak perlu.
   * Hanya melakukan penulisan ke DOM jika textContent atau className mengalami perubahan riil.
   * @param {string|HTMLElement} target - ID elemen string atau instance HTMLElement
   * @param {string|null} [text=null] - Nilai teks baru
   * @param {string|null} [className=null] - Nilai class CSS baru
   */
  _smartUpdateDOM(target, text = null, className = null) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    if (text !== null && el.textContent !== text) {
      el.textContent = text;
    }

    if (className !== null && el.className !== className) {
      el.className = className;
    }
  }

  /**
   * Inisialisasi listener DOM dan koneksi Socket.io
   */
  init() {
    console.info("🚀 [TrafficEngine] Menginisialisasi Reactive Socket Traffic Engine...");

    this.socket = getSocket();

    this._bindGreenSplitSlider();
    this._bindGreenWaveToggle();
    this._bindChaosMode();
    this._bindSignalModal();
    this._bindEmergencyForm();
    this._bindEmergency112Simulation();
    this._bindForceOverrideButtons();
    this._bindAiRecommendationButtons();

    // Jalankan render initial state segera
    this.handleServerStateUpdate(this.mockState);

    // Jika socket belum terkoneksi setelah 2.5 detik, aktifkan simulasi offline otomatis
    setTimeout(() => {
      if (!stateStore.getState().sseConnected) {
        stateStore.publish("socket:status", "fallback");
        this.startLocalSimulation();
      }
    }, 2500);
  }

  /**
   * Mengatur status Emergency Green Wave secara global dan tersinkronisasi
   * @param {boolean} active
   */
  setGreenWave(active) {
    const isBool = !!active;
    stateStore.setState({ greenWaveActive: isBool });
    stateStore.publish('traffic:green-wave', { active: isBool });

    const chk = document.getElementById("chkGreenWave");
    if (chk && chk.checked !== isBool) {
      chk.checked = isBool;
    }

    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit('green-wave:toggle', { active: isBool });
    } else {
      // Local fallback simulation immediate synchronization
      const currentData = this.lastState || this.mockState;
      currentData.greenWaveActive = isBool;
      if (isBool) {
        currentData.intersections.forEach(node => {
          if (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo") {
            node.state = "green";
            node.timer = "∞";
            node.status = "Green Wave";
          }
        });
      } else {
        currentData.intersections.forEach(node => {
          if (typeof node.timer === "string") {
            node.timer = node.greenSplit || 35;
          }
        });
      }
      this.handleServerStateUpdate(currentData);
    }
  }

  /**
   * Preempt Spesifik Persimpangan untuk Koridor Prioritas Darurat (Green Wave Clearance)
   */
  preemptIntersection(nodeId, state = 'green', durationSec = 45) {
    const currentData = this.lastState || this.mockState;
    if (currentData && Array.isArray(currentData.intersections)) {
      currentData.intersections.forEach(node => {
        if (node.id === nodeId) {
          node.state = state;
          node.timer = durationSec;
          node.status = "Preempt Clearance";
        }
      });
      this.handleServerStateUpdate(currentData);
    }
    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit('signal:override', { intersectionId: nodeId, duration: durationSec });
    }
  }

  /**
   * Mengatur adaptasi cuaca terhadap waktu kuning & all-red APILL
   */
  setWeatherAdaptation(isRain) {
    this.isRainMode = !!isRain;
    this.yellowDuration = this.isRainMode ? 4.5 : 3.0;
    this.allRedBuffer = this.isRainMode ? 2.0 : 1.0;
  }

  /**
   * Memulai Loop Simulasi Lokal jika server Socket offline
   */
  startLocalSimulation() {
    if (this._localSimulationRunning) return;
    this._localSimulationRunning = true;
    console.info("⚡ [TrafficEngine] Local Mock Simulation Loop Active (Zero Backend Latency Fallback).");

    if (this.localSimInterval) clearInterval(this.localSimInterval);

    this.localSimInterval = setInterval(() => {
      if (stateStore.getState().sseConnected) {
        this.stopLocalSimulation();
        return;
      }

      const sim = this.mockState;
      sim.timestamp = new Date().toLocaleTimeString('id-ID') + ' WIB';
      sim.vehiclesToday += Math.floor(Math.random() * 4) + 1;
      sim.co2SavedKg += 0.2;
      sim.fuelSavedLiters += 0.08;

      // Advance APILL light timers
      sim.intersections.forEach(node => {
        if (sim.greenWaveActive && (node.id === "node-wonokromo" || node.id === "node-margorejo" || node.id === "node-darmo")) {
          node.state = "green";
          node.timer = "∞";
          node.status = "Green Wave";
          return;
        }

        if (typeof node.timer === "string") {
          node.timer = node.greenSplit || 30;
        }

        node.timer--;

        if (node.timer <= 0) {
          if (node.state === "green") {
            node.state = "yellow";
            node.timer = 3;
          } else if (node.state === "yellow") {
            node.state = "red";
            node.timer = 25;
          } else {
            node.state = "green";
            node.timer = node.greenSplit || 35;
          }
        }

        if (node.state === "red") node.status = sim.isChaosMode ? "Macet Total" : "Padat";
        else if (node.state === "yellow") node.status = "Transisi";
        else node.status = sim.isChaosMode ? "Merayap" : "Lancar";
      });

      this.handleServerStateUpdate(sim);
    }, 1000);
  }

  /**
   * Menghentikan Loop Simulasi Lokal saat server Socket online kembali
   */
  stopLocalSimulation() {
    this._localSimulationRunning = false;
    if (this.localSimInterval) {
      clearInterval(this.localSimInterval);
      this.localSimInterval = null;
    }
  }

  /**
   * Menangani pembaruan state real-time dari Socket.io Server (Single Source of Truth)
   * @param {Object} data - Snapshot state global dari backend
   */
  handleServerStateUpdate(data) {
    if (!data) return;
    this.lastState = data;

    // Update stateStore local copy
    stateStore.setState({
      isChaosMode: data.isChaosMode,
      chaosLevel: data.chaosLevel,
      greenWaveActive: data.greenWaveActive,
      greenSplitWonokromo: data.greenSplitWonokromo,
      telemetry: data,
      lastTelemetryTime: Date.now()
    }, false);

    stateStore.publish("telemetry:update", data);
    stateStore.publish("traffic:green-wave", { active: !!data.greenWaveActive });

    // Update DOM UI elements reactively with smart diffing
    this._renderApillTimers(data.intersections, data.greenWaveActive);
    this._renderChaosUI(data.isChaosMode, data.chaosLevel);
    this._renderKpiMetrics(data);
    this._renderEmergencyList(data.activeEmergencies);
  }

  /**
   * 1. Rendering Timer APILL dengan _smartUpdateDOM (Wonokromo, Margorejo, Darmo, Tunjungan, MERR)
   */
  _renderApillTimers(intersections, isGreenWave) {
    if (!intersections || !Array.isArray(intersections)) return;

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

    // Update Phase Cycle Numbers on Signal Dashboard Card
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
  _renderKpiMetrics(data) {
    const avgWaitCard = this._findKpiCard("Rata-rata Waktu Tunggu");
    if (avgWaitCard) {
      const counter = avgWaitCard.querySelector(".counter-val") || avgWaitCard.querySelector("h2");
      if (counter) {
        this._smartUpdateDOM(counter, `${data.avgWaitTime}s`);
      }
    }

    const netLoadCard = this._findKpiCard("Beban Jaringan");
    if (netLoadCard) {
      const counter = netLoadCard.querySelector(".counter-val") || netLoadCard.querySelector("h2");
      if (counter) {
        this._smartUpdateDOM(counter, `${data.networkLoad}%`);
      }
    }

    const co2Card = this._findKpiCard("Reduksi Emisi");
    if (co2Card) {
      const counter = co2Card.querySelector(".counter-val") || co2Card.querySelector("h2");
      if (counter) {
        this._smartUpdateDOM(counter, `${Math.round(data.co2SavedKg).toLocaleString('id-ID')} kg`);
      }
    }

    const sitsSignalEl = document.getElementById("sitsStatusText");
    if (sitsSignalEl) {
      this._smartUpdateDOM(sitsSignalEl, `${data.sitsSignal || 96}%`);
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
    if (!emergencies || !Array.isArray(emergencies)) return;
    const container = document.getElementById("emergencyListGrid");
    if (!container) return;

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
   * Bind DOM Events & Controls
   */
  _bindGreenSplitSlider() {
    const slider = document.getElementById("greenSplitSlider") || document.getElementById("greenRange");
    if (!slider) return;

    slider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      stateStore.setState({ greenSplitWonokromo: val });
      const tt = document.getElementById("sliderTooltip");
      if (tt) tt.textContent = `${val}s`;

      const socket = getSocket();
      if (socket && socket.connected) {
        socket.emit('green-split:update', { value: val, intersectionId: "node-wonokromo" });
      }
    });
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
      btnToggleChaos.addEventListener("click", () => {
        const current = stateStore.getState().isChaosMode;
        const target = !current;
        const socket = getSocket();
        if (socket && socket.connected) {
          socket.emit('chaos:toggle', { active: target });
        } else {
          this.mockState.isChaosMode = target;
          this.mockState.chaosLevel = target ? 4 : 0;
          this.handleServerStateUpdate(this.mockState);
          window.showToast(target ? '🔥 MODE KEOS SIMULASI AKTIF!' : 'Sistem pulih dari mode keos.');
        }
        soundManager.play('click');
      });
    }

    if (btnMuteSiren) {
      btnMuteSiren.addEventListener("click", () => {
        const muted = !stateStore.getState().isSirenMuted;
        stateStore.setState({ isSirenMuted: muted });
        this._smartUpdateDOM(btnMuteSiren, muted ? "Unmute Sirine" : "Mute Sirine");
        soundManager.play('click');
      });
    }
  }

  _bindAiRecommendationButtons() {
    document.querySelectorAll('button[data-action="simulate"], .btn-apply-ai').forEach(btn => {
      btn.addEventListener("click", () => {
        const socket = getSocket();
        if (socket && socket.connected) {
          socket.emit('ai:apply-recommendation', { intersectionId: 'node-wonokromo' });
        } else {
          const optimizedSplit = Math.floor(38 + Math.random() * 12);
          stateStore.setState({ greenSplitWonokromo: optimizedSplit });
          const slider = document.getElementById("greenSplitSlider");
          if (slider) slider.value = optimizedSplit;
          window.showToast(`✨ Rekomendasi AI Diterapkan: Green Split Wonokromo dioptimalkan ke ${optimizedSplit}s!`);
        }
        soundManager.play('success');
      });
    });
  }

  _bindForceOverrideButtons() {
    document.querySelectorAll(".force-override-btn").forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        const intersectionIds = ["node-wonokromo", "node-margorejo", "node-darmo", "node-tunjungan"];
        const targetId = intersectionIds[idx] || "node-wonokromo";
        const socket = getSocket();
        if (socket && socket.connected) {
          socket.emit('signal:override', { intersectionId: targetId, duration: 45 });
        } else {
          window.showToast(`🛠️ Manual Override Aktif: Durasi ${targetId} dikunci 45s!`);
        }
        soundManager.play('click');
      });
    });
  }

  _bindEmergencyForm() {
    const emergencyForm = document.getElementById("emergencyActuatorForm");

    if (emergencyForm) {
      emergencyForm.addEventListener("submit", (e) => {
        const typeInput = document.getElementById("respType");
        const routeInput = document.getElementById("respRoute");
        const nameInput = document.getElementById("respName");

        const code = nameInput ? nameInput.value.trim() : "AMB-02";
        const route = routeInput ? routeInput.value : "route-yani-darmo";

        this.setGreenWave(true);

        const socket = getSocket();
        if (socket && socket.connected) {
          socket.emit('emergency:activate', { code, route });
        }
      });
    }
  }

  _bindEmergency112Simulation() {
    const btnStart = document.getElementById("btnStart112Sim");
    const btnStop = document.getElementById("btnStop112Sim");

    if (btnStart) {
      btnStart.addEventListener("click", () => {
        btnStart.disabled = true;
        if (btnStop) btnStop.disabled = false;

        // Beralih ke view peta agar animasi dan HUD terlihat jelas
        const curView = stateStore.getState().currentView;
        if (curView === 'emergency') {
          const mapNav = document.querySelector('[data-view="map"]');
          if (mapNav) mapNav.click();
        }

        mapManager.startEmergency112Simulation(
          (telemetry) => {
            // Telemetry update hook
          },
          () => {
            btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
          }
        );
      });
    }

    if (btnStop) {
      btnStop.addEventListener("click", () => {
        mapManager.stopEmergency112Simulation(false);
        if (btnStart) btnStart.disabled = false;
        btnStop.disabled = true;
        soundManager.play('click');
      });
    }
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
}

export const trafficEngine = new TrafficEngine();
