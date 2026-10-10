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
import { authManager } from '../core/authManager.js';
import { generateForecastSnapshot } from './forecastEngine.js';
import { SeededRandom } from '../../shared/seededRandom.js';

export class TrafficEngine {
  constructor() {
    this.localSimRandom = new SeededRandom('omnitraf-traffic-local-fallback');
    this.localSimInterval = null;
    this.graceTimer = null;
    this._localSimulationRunning = false;
    this._isInitialized = false;
    this._unsubscribeCallbacks = [];
    this._priorityIncidentSignature = null;

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
    this._syncDashboardCapabilities();
    authManager.onAuthChange(() => this._syncDashboardCapabilities());

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

  _syncDashboardCapabilities() {
    const admin = authManager.hasRole('ADMIN');
    const operator = authManager.hasRole(['OPERATOR', 'ADMIN']);
    const chaosButton = document.getElementById('btnToggleChaos');
    const simulationTools = document.getElementById('dashboardSimulationTools');
    if (chaosButton) chaosButton.hidden = !admin;
    if (simulationTools) simulationTools.hidden = !operator;
    document.querySelectorAll('#view-dashboard [data-capability="simulation:control"]').forEach((element) => {
      element.hidden = !operator;
    });
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
    const emergencies = (state.activeEmergencies || []).filter(e => (e.vehicleId || e.id) && !['ARRIVED', 'COMPLETED', 'CANCELLED', 'TERMINAL_ARCHIVED'].includes(String(e.status).toUpperCase()));

    this._renderHeaderAndBriefing(state, telemetry, emergencies);
    this._renderApillTimers(intersections, isGreenWave);
    this._renderChaosUI(isChaos, chaosLevel);
    this._renderKpiMetrics(telemetry, state);
    this._renderEmergencyList(emergencies);
    this._renderCorridorRanking(state);
    this._renderIncidentTimeline(state.incidents || []);
    this._renderNotifications(state.incidents || []);
    document.getElementById('emergencyGreenWaveHud')?.classList.toggle('is-hidden', !state.greenWaveActive);
    const recommendation = document.getElementById("widgetAiRec");
    if (recommendation) recommendation.hidden = Boolean(state.dismissedRecommendation);
  }

  _renderNotifications(incidents) {
    const container = document.getElementById('notifListContainer');
    if (!container) return;
    const signature = JSON.stringify(incidents);
    if (container.dataset.snapshot === signature) return;
    container.dataset.snapshot = signature;
    const cards = incidents.map(incident => {
      const card = document.createElement('article'); card.className = 'notif-item-card glass-soft';
      const title = document.createElement('strong'); title.textContent = incident.title || 'Insiden simulasi';
      const detail = document.createElement('p'); detail.textContent = `${incident.location || 'Lokasi tidak tersedia'} · ${incident.status || 'Status tidak tersedia'}`;
      const note = document.createElement('p'); note.textContent = incident.notes || incident.description || 'Skenario pada simulator.';
      const link = document.createElement('a'); link.href = '#incidents'; link.className = 'btn btn-ghost compact'; link.textContent = 'Buka daftar insiden';
      link.addEventListener('click', () => document.getElementById('closeNotifDrawer')?.click());
      card.appendChild(title); card.appendChild(detail); card.appendChild(note); card.appendChild(link); return card;
    });
    if (!cards.length) { const empty = document.createElement('p'); empty.textContent = 'Belum ada insiden dalam sesi ini.'; cards.push(empty); }
    container.replaceChildren(...cards);
  }

  _renderIncidentTimeline(incidents) {
    const timeline = document.querySelector('#card-incidents .timeline');
    if (!timeline) return;
    const signature = JSON.stringify(incidents);
    if (timeline.dataset.snapshot === signature) return;
    timeline.dataset.snapshot = signature;
    const badge = document.querySelector('#card-incidents .pill');
    if (badge) badge.textContent = `${incidents.filter(item => !['RESOLVED', 'ARCHIVED'].includes(String(item.status).toUpperCase())).length} aktif`;
    const rows = incidents.slice(0, 3).map(incident => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'timeline-dot ' + (['RESOLVED', 'ARCHIVED'].includes(String(incident.status).toUpperCase()) ? 'success' : 'warning');
      const copy = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = incident.title || 'Insiden simulasi';
      const detail = document.createElement('small');
      const date = new Date(incident.reportedAt || incident.createdAt || NaN);
      const time = Number.isNaN(date.getTime()) ? 'Waktu tidak tersedia' : date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
      detail.textContent = `${incident.location || 'Lokasi tidak tersedia'} · ${time} · ${incident.status || 'Status tidak tersedia'}`;
      copy.appendChild(title); copy.appendChild(detail); li.appendChild(dot); li.appendChild(copy); return li;
    });
    if (!rows.length) { const empty = document.createElement('li'); empty.textContent = 'Belum ada insiden dalam sesi ini.'; rows.push(empty); }
    timeline.replaceChildren(...rows);
  }

  /**
   * Render Header Status & Operational Briefing Bar
   */
  _renderHeaderAndBriefing(state, telemetry, emergencies) {
    const isConnected = state.connectionStatus === 'connected';
    const isResync = state.connectionStatus === 'resyncing';
    const activeIncidents = (Array.isArray(state.incidents) ? state.incidents : [])
      .filter((incident) => !['RESOLVED', 'ARCHIVED'].includes(String(incident.status || '').toUpperCase()));
    const priorityIncidents = activeIncidents.filter((incident) =>
      ['critical', 'danger', 'high'].includes(String(incident.severity || '').toLowerCase())
    );
    const rawLoad = telemetry.congestionIndex ?? telemetry.networkLoad;
    const hasLoad = rawLoad !== undefined && rawLoad !== null && Number.isFinite(Number(rawLoad));
    const load = hasLoad ? Number(rawLoad) : 0;
    // System health reports connectivity and network load only. Incident severity is
    // surfaced separately in the priority strip so an incident cannot mask a degraded stream.
    const systemStatus = state.connectionStatus === 'auth_failed' ? 'DEMO' : ['offline', 'fallback', 'degraded', 'auth_failed'].includes(state.connectionStatus) ? 'DEGRADED'
      : (!hasLoad || state.isStaleData || ['connecting', 'reconnecting', 'resyncing'].includes(state.connectionStatus)) ? 'WARNING'
        : load >= 75 ? 'ADVISORY' : 'NORMAL';
    this._smartUpdateDOM('dashSystemState', systemStatus, `system-state-text status-${systemStatus.toLowerCase()}`);
    this._renderPriorityIncidents(priorityIncidents);
    
    // A live socket only confirms a connection to this prototype's simulator,
    // not to the real SITS infrastructure.
    const provText = isConnected ? 'SIMULASI • STREAM SERVER' : isResync ? 'SINKRON ULANG • SIMULASI' : 'SIMULASI LOKAL';
    const provClass = 'provenance-badge simulated';
    
    this._smartUpdateDOM('dashHeaderProv', provText, provClass);
    this._smartUpdateDOM('briefingProvenance', isConnected ? 'SIMULASI SERVER' : 'SIMULASI LOKAL', provClass);
    const freshness = document.getElementById('dashDataFreshness');
    if (freshness) {
      const freshnessLabel = state.connectionStatus === 'auth_failed' ? 'DEMO LOKAL · MASUK UNTUK STREAM' : state.isStaleData
        ? (isConnected ? 'STREAM SIMULATOR · DATA LAMA' : 'SERVER TERPUTUS · SIMULASI LOKAL')
        : isConnected ? 'STREAM SIMULATOR TERHUBUNG' : 'SIMULASI LOKAL';
      freshness.textContent = freshnessLabel;
      freshness.className = `data-freshness-pill ${state.isStaleData ? 'is-stale' : isConnected ? 'is-live' : 'is-offline'}`;
      freshness.setAttribute('aria-label', state.connectionStatus === 'auth_failed' ? 'Demo lokal berjalan; masuk untuk menggunakan stream server' : state.isStaleData
        ? (isConnected ? 'Stream server simulasi tersambung, tetapi data yang diterima sudah lama' : 'Server simulasi terputus; tampilan menggunakan simulasi lokal')
        : isConnected ? 'Stream server simulasi tersambung dan data diperbarui' : 'Simulasi lokal berjalan tanpa koneksi server');
      const lastUpdate = state.lastTelemetryTime;
      if (lastUpdate) {
        const parsed = new Date(lastUpdate);
        if (!Number.isNaN(parsed.getTime())) {
          freshness.title = `Pembaruan terakhir ${parsed.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB`;
        }
      }
    }
    
    // Local Time Clock
    const nowStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
    this._smartUpdateDOM('dashLocalTime', nowStr);

    // Briefing Grid Metrics
    const congestionRaw = telemetry.congestionIndex ?? telemetry.networkLoad;
    const congestion = congestionRaw !== undefined && congestionRaw !== null && Number.isFinite(Number(congestionRaw)) ? Number(congestionRaw) : null;
    const congestionText = congestion === null ? 'Data belum tersedia' : `${congestion}% — ${congestion >= 75 ? 'Beban tinggi' : congestion >= 60 ? 'Beban sedang' : 'Beban rendah'}`;
    this._smartUpdateDOM('briefingCongestionVal', congestionText);
    this._smartUpdateDOM('dashCongestionValue', congestion === null ? '—' : String(congestion));
    this._smartUpdateDOM('dashCongestionGauge', congestion === null ? '—' : `${congestion}%`);
    const gaugeRing = document.querySelector('#bentoCardCongestion .gauge-fill-ring');
    if (gaugeRing) gaugeRing.style.strokeDashoffset = String(congestion === null
      ? 238.76
      : 238.76 * (1 - Math.max(0, Math.min(100, congestion)) / 100));
    this._smartUpdateDOM('networkLoad', telemetry.networkLoad ?? (congestion === null ? '—' : `${congestion}%`));
    this._smartUpdateDOM('dashWaitValue', String(telemetry.avgWaitTime ?? '--'));
    this._smartUpdateDOM('dashIntersectionCount', String((state.intersections || []).length));
    this._smartUpdateDOM('dashEmergencyCount', String(emergencies?.length || 0));
    this._smartUpdateDOM('briefingCorridorsVal', `${(state.intersections || []).length} simpang dalam model`);
    this._smartUpdateDOM('briefingCorridorsSub', `${activeIncidents.length} insiden aktif`);

    // Show infrastructure health only when a value has an explicit source.
    // Former demo literals looked like measured uptime, camera counts and latency.
    const setMetric = (id, value) => this._smartUpdateDOM(id, value === null || value === undefined ? '—' : String(value));
    setMetric('sitsUptimeVal', null);
    const cameraMetrics = state.cctvCamerasMetrics;
    const measuredCameraCount = cameraMetrics && typeof cameraMetrics === 'object' ? Object.keys(cameraMetrics).length : 0;
    const cameraCount = measuredCameraCount > 0 ? measuredCameraCount : null;
    setMetric('sitsCctvCount', cameraCount);
    const devices = Array.isArray(state.devices) ? state.devices : [];
    setMetric('sitsIotCount', devices.length || null);
    const apiLatency = telemetry.apiLatencyMs ?? telemetry.latencyMs;
    setMetric('latencyVal', apiLatency !== null && apiLatency !== undefined && Number.isFinite(Number(apiLatency))
      ? `${Math.round(Number(apiLatency))} ms · sim` : null);
    const latencyPath = document.getElementById('latencyPath');
    if (latencyPath) latencyPath.hidden = true;

    if (Array.isArray(emergencies) && emergencies.length > 0) {
      const firstEmg = emergencies[0];
      this._smartUpdateDOM('briefingAlertVal', `Priority ${firstEmg.vehicleId || firstEmg.vehicle || 'vehicle'} active`);
      this._smartUpdateDOM('briefingAlertSub', firstEmg.ETA ? `Model ETA ${firstEmg.ETA}` : 'Route status shown in emergency workflow');
    } else {
      this._smartUpdateDOM('briefingAlertVal', 'Kondisi Koridor Normal');
      this._smartUpdateDOM('briefingAlertSub', 'Simulator siap untuk skenario demonstrasi');
    }
  }

  _renderPriorityIncidents(incidents) {
    const strip = document.getElementById('criticalIncidentStrip');
    const list = document.getElementById('criticalIncidentList');
    const count = document.getElementById('criticalIncidentCount');
    if (!strip || !list) return;
    strip.hidden = incidents.length === 0;
    const signature = JSON.stringify(incidents.map(({ id, title, location, severity, status }) => ({ id, title, location, severity, status })));
    if (signature === this._priorityIncidentSignature) return;
    this._priorityIncidentSignature = signature;
    if (count) count.textContent = String(incidents.length);
    list.replaceChildren();
    incidents.slice(0, 3).forEach((incident) => {
      const item = document.createElement('article');
      item.className = 'critical-incident-item';
      item.setAttribute('role', 'listitem');
      const details = document.createElement('div');
      details.className = 'critical-incident-copy';
      const title = document.createElement('strong');
      title.textContent = incident.title || 'Traffic incident';
      const location = document.createElement('span');
      location.textContent = incident.location || 'Location unavailable';
      const severity = document.createElement('small');
      severity.textContent = `${String(incident.severity || 'critical').toUpperCase()} · ${String(incident.status || 'ACTIVE').replaceAll('_', ' ')}`;
      details.append(title, location, severity);
      const inspect = document.createElement('a');
      inspect.href = '#incidents';
      inspect.className = 'btn btn-ghost compact';
      inspect.textContent = 'Inspect';
      inspect.setAttribute('aria-label', `Inspect incident ${incident.title || incident.id || ''}`);
      item.append(details, inspect);
      list.appendChild(item);
    });
  }

  /**
   * 1. Rendering Timer APILL dengan Smart DOM Diffing
   */
  _renderApillTimers(intersections, isGreenWave) {
    if (!Array.isArray(intersections) || intersections.length === 0) return;

    // Simpang Wonokromo
    const nodeW = intersections.find(n => n.id === "node-wonokromo") || intersections[0];
    if (nodeW) {
      const slider = document.getElementById('greenRange');
      const scheduled = nodeW.pendingGreenSplit ?? nodeW.greenSplit;
      if (slider && document.activeElement !== slider && scheduled != null) {
        slider.value = String(scheduled);
        slider.dataset.acknowledgedValue = String(scheduled);
      }
      this._smartUpdateDOM('greenValue', nodeW.pendingGreenSplit == null ? `${nodeW.greenSplit} dtk` : `${nodeW.greenSplit} dtk · berikutnya ${nodeW.pendingGreenSplit} dtk`);
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

      // Sync active state of lights in modal
      const wonoRedEl = document.getElementById("wonokromoRed");
      const wonoYellowEl = document.getElementById("wonokromoYellow");
      const wonoGreenEl = document.getElementById("wonokromoGreen");
      if (wonoRedEl && wonoYellowEl && wonoGreenEl) {
        wonoRedEl.classList.toggle("active", !isGreenWave && nodeW.state === "red");
        wonoYellowEl.classList.toggle("active", !isGreenWave && nodeW.state === "yellow");
        wonoGreenEl.classList.toggle("active", isGreenWave || nodeW.state === "green");
      }
    }

    // Simpang Jemursari
    const nodeM = intersections.find(n => n.id === "node-jemursari") || intersections[1];
    if (nodeM) {
      if (isGreenWave) {
        this._smartUpdateDOM("jemursariBadge", "GREEN WAVE (HIJAU)", "status-badge green");
        this._smartUpdateDOM("jemursariGreenTime", "∞");
        this._smartUpdateDOM("jemursariRedTime", "0s");
      } else if (nodeM.state === "green") {
        this._smartUpdateDOM("jemursariBadge", `HIJAU (${nodeM.timer}s)`, "status-badge green");
        this._smartUpdateDOM("jemursariGreenTime", `${nodeM.timer}s`);
        this._smartUpdateDOM("jemursariRedTime", "0s");
      } else {
        this._smartUpdateDOM("jemursariBadge", `MERAH (${nodeM.timer}s)`, "status-badge red");
        this._smartUpdateDOM("jemursariGreenTime", "0s");
        this._smartUpdateDOM("jemursariRedTime", `${nodeM.timer}s`);
      }

      // Sync active state of lights in modal
      const margoRedEl = document.getElementById("jemursariRed");
      const margoYellowEl = document.getElementById("jemursariYellow");
      const margoGreenEl = document.getElementById("jemursariGreen");
      if (margoRedEl && margoYellowEl && margoGreenEl) {
        margoRedEl.classList.toggle("active", !isGreenWave && nodeM.state === "red");
        margoYellowEl.classList.toggle("active", !isGreenWave && nodeM.state === "yellow");
        margoGreenEl.classList.toggle("active", isGreenWave || nodeM.state === "green");
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
    const validMetric = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const avgWaitTime = validMetric(telemetry.avgWaitTime) ? Number(telemetry.avgWaitTime) : null;
    const networkLoad = validMetric(telemetry.networkLoad) ? Number(telemetry.networkLoad) : null;
    const co2SavedKg = validMetric(telemetry.co2SavedKg) ? Number(telemetry.co2SavedKg) : null;
    const sitsSignal = validMetric(telemetry.sitsSignal) ? Number(telemetry.sitsSignal) : null;

    const avgWaitCard = this._findKpiCard("Rata-rata Waktu Tunggu");
    if (avgWaitCard) {
      const counter = avgWaitCard.querySelector(".counter-val") || avgWaitCard.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, avgWaitTime === null ? '—' : String(avgWaitTime));
    }

    const netLoadCard = this._findKpiCard("Beban Jaringan");
    if (netLoadCard) {
      const counter = netLoadCard.querySelector(".counter-val") || netLoadCard.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, networkLoad === null ? '—' : `${networkLoad}%`);
    }

    const co2Card = this._findKpiCard("Reduksi Emisi");
    if (co2Card) {
      const counter = co2Card.querySelector(".counter-val") || co2Card.querySelector("h2");
      if (counter) this._smartUpdateDOM(counter, co2SavedKg === null ? '—' : `${Math.round(co2SavedKg).toLocaleString('id-ID')} kg`);
      const ring = co2Card.querySelector('.gauge-fill-ring');
      if (ring) ring.style.strokeDashoffset = co2SavedKg === null ? '238.76' : String(238.76 * (1 - Math.max(0, Math.min(100, co2SavedKg)) / 100));
    }

    const sitsSignalEl = document.getElementById("sitsStatusText");
    if (sitsSignalEl) {
      this._smartUpdateDOM(sitsSignalEl, state.connectionStatus === 'connected' && sitsSignal !== null ? `${sitsSignal}%` : '—');
    }
  }

  _renderCorridorRanking(state) {
    if (!document.getElementById('widgetLeaderboard')) return;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    const ranked = generateForecastSnapshot(hour, state).corridorBreakdown
      .map(row => ({ ...row, risk: Math.min(100, Math.round(row.volume / row.capacity * 100)) }))
      .sort((a, b) => b.risk - a.risk);
    ranked.slice(0, 5).forEach((row, index) => {
      const el = document.getElementById(`leadRoad-${index}`);
      if (!el) return;
      const label = el.querySelector('span');
      const value = el.querySelector('strong');
      if (label) label.textContent = `${index + 1}. ${row.name}`;
      if (value) value.textContent = `${row.risk}/100`;
    });
    document.querySelectorAll('.corridor-list > div').forEach((el, index) => {
      const row = ranked[index];
      if (!row) return;
      el.querySelector('span').textContent = row.name;
      el.querySelector('strong').textContent = `${row.risk}/100`;
      el.querySelector('i').style.setProperty('--value', `${row.risk}%`);
    });
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
      this._smartUpdateDOM(countEl, `${emergencies.length} skenario demo`);
    }

    // Dynamic sync for dashboard Emergency Priority card
    const titleEl = document.getElementById("dashEmergencyTitle");
    const etaEl = document.getElementById("dashEmergencyEta");
    const routeEl = document.getElementById("dashEmergencyRoute");
    const badgeEl = document.getElementById("dashEmergencyBadge");
    const iconEl = document.getElementById("dashEmergencyIcon");

    if (titleEl) {
      if (emergencies.length > 0) {
        const emg = emergencies[0];
        const isFinished = ["ARRIVED", "COMPLETED", "CANCELLED"].includes(emg.status);
        this._smartUpdateDOM(titleEl, `Skenario demo: ${emg.vehicleId || 'ID simulasi belum tersedia'}${emg.vehicleType ? ` (${emg.vehicleType})` : ''}`);
        const eta = emg.ETA !== undefined && emg.ETA !== null && emg.ETA !== '' ? `ETA model ${emg.ETA}` : 'ETA model belum tersedia';
        const speed = emg.speed !== undefined && emg.speed !== null && Number.isFinite(Number(emg.speed)) ? ` • Kecepatan model: ${emg.speed} km/j` : '';
        if (etaEl) this._smartUpdateDOM(etaEl, isFinished ? `Status simulasi: ${emg.status}` : `${eta}${speed}`);
        if (routeEl) this._smartUpdateDOM(routeEl, emg.routeId ? `Rute simulasi: ${emg.routeId.replace('route-', '').toUpperCase()}` : 'Rute simulasi belum tersedia');
        if (badgeEl) this._smartUpdateDOM(badgeEl, 'SIMULASI', 'pill pill-ai');
        if (iconEl) iconEl.className = isFinished ? 'emergency-icon' : 'emergency-icon pulse-red';
      } else {
        this._smartUpdateDOM(titleEl, 'Tidak ada skenario prioritas aktif');
        if (etaEl) this._smartUpdateDOM(etaEl, 'Simulator siap untuk demonstrasi');
        if (routeEl) this._smartUpdateDOM(routeEl, 'Tidak ada armada atau koridor lapangan yang terhubung');
        if (badgeEl) this._smartUpdateDOM(badgeEl, 'DEMO', 'pill pill-ai');
        if (iconEl) iconEl.className = 'emergency-icon';
      }
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
        targetId: 'corridor-ayani-darmo',
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
    this.localSimRandom.reset('omnitraf-traffic-local-fallback');
    const initialState = stateStore.getState();
    this.localSimTimeMs = Number(initialState.timestampMs || initialState.telemetry?.timestampMs) || Date.now();
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
      this.localSimTimeMs += 1000;
      const newVehicles = (Number.isFinite(Number(curTel.vehiclesToday)) ? Number(curTel.vehiclesToday) : 0) + this.localSimRandom.rangeInt(1, 4);
      const newCo2 = (Number.isFinite(Number(curTel.co2SavedKg)) ? Number(curTel.co2SavedKg) : 0) + 0.2;
      const newFuel = (Number.isFinite(Number(curTel.fuelSavedLiters)) ? Number(curTel.fuelSavedLiters) : 0) + 0.08;
      const timeStr = new Date(this.localSimTimeMs).toLocaleTimeString('id-ID') + ' WIB';

      const nowLocal = this.localSimTimeMs;
      const updatedIntersections = (curState.intersections || []).map(node => {
        const nextNode = { ...node };

        if (curState.greenWaveActive && (nextNode.id === "node-wonokromo" || nextNode.id === "node-jemursari" || nextNode.id === "node-darmo")) {
          nextNode.state = "green";
          nextNode.timer = "∞";
          nextNode.status = "Green Wave";
          return nextNode;
        }

        if (nextNode.isOverrideActive && nextNode.overrideStartTime && nextNode.overrideDuration > 0) {
          const rem = nextNode.overrideDuration - Math.floor((nowLocal - nextNode.overrideStartTime) / 1000);
          if (rem > 0) {
            nextNode.state = "green";
            nextNode.timer = rem;
            nextNode.status = `Manual Override (${rem}s)`;
            return nextNode;
          } else {
            nextNode.isOverrideActive = false;
            nextNode.overrideStartTime = null;
            nextNode.overrideDuration = 0;
            nextNode.state = "yellow";
            nextNode.timer = nextNode.yellowDuration || 3;
            nextNode.status = "Transisi Setelah Override";
            nextNode.cycleStartTime = nowLocal + ((nextNode.yellowDuration || 3) * 1000);
            return nextNode;
          }
        }

        if (!nextNode.cycleStartTime) nextNode.cycleStartTime = nowLocal;
        const yellowDur = nextNode.yellowDuration || 3;
        const redDur = nextNode.redDuration || 25;
        const greenDur = nextNode.greenSplit || 35;
        const totalDur = greenDur + yellowDur + redDur;

        nextNode.yellowDuration = yellowDur;
        nextNode.redDuration = redDur;
        nextNode.totalCycleTime = totalDur;

        const elapsedMs = Math.max(0, nowLocal - nextNode.cycleStartTime);
        const elapsedSec = Math.floor(elapsedMs / 1000);
        let cycleSec = elapsedSec % totalDur;

        if (cycleSec === 0 && nextNode.pendingGreenSplit) {
          nextNode.greenSplit = nextNode.pendingGreenSplit;
          nextNode.pendingGreenSplit = null;
          nextNode.totalCycleTime = nextNode.greenSplit + yellowDur + redDur;
        }

        const activeGreen = nextNode.greenSplit || 35;
        const activeYellow = nextNode.yellowDuration || 3;
        const activeTotal = activeGreen + activeYellow + (nextNode.redDuration || 25);

        if (cycleSec < activeGreen) {
          nextNode.state = "green";
          nextNode.timer = activeGreen - cycleSec;
          nextNode.status = curState.isChaosMode ? "Merayap" : "Lancar";
        } else if (cycleSec < activeGreen + activeYellow) {
          nextNode.state = "yellow";
          nextNode.timer = (activeGreen + activeYellow) - cycleSec;
          nextNode.status = "Transisi";
        } else {
          nextNode.state = "red";
          nextNode.timer = activeTotal - cycleSec;
          nextNode.status = curState.isChaosMode ? "Macet Total" : "Padat";
        }

        return nextNode;
      });

      // Handle chaos level decay in local simulation
      let nextChaosLevel = curState.chaosLevel;
      let nextIsChaos = curState.isChaosMode;
      if (curState.isChaosMode && nextChaosLevel > 0 && this.localSimRandom.chance(0.1)) {
        nextChaosLevel--;
        if (nextChaosLevel <= 0) {
          nextIsChaos = false;
          if (typeof window.showToast === "function") {
            window.showToast("State simulator kembali dari skenario gangguan.");
          }
        }
      }

      // Sinkronkan ke StateStore sebagai Single Source of Truth
      updateTrafficState({
        isChaosMode: nextIsChaos,
        chaosLevel: nextChaosLevel,
        intersections: updatedIntersections,
        networkLoad: nextIsChaos ? this.localSimRandom.rangeInt(90, 97) : this.localSimRandom.rangeInt(65, 72),
        avgWaitTime: nextIsChaos ? this.localSimRandom.rangeInt(100, 114) : this.localSimRandom.rangeInt(38, 43),
        congestionIndex: nextIsChaos ? this.localSimRandom.rangeInt(88, 95) : this.localSimRandom.rangeInt(58, 63),
        vehiclesToday: newVehicles,
        co2SavedKg: Math.round(newCo2),
        fuelSavedLiters: Math.round(newFuel),
        timestamp: timeStr,
        timestampMs: nowLocal
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
    this._bindSimulationSpeedControl();
    this._bindDashboardRefresh();
  }

  _bindDashboardRefresh() {
    document.addEventListener('click', async (event) => {
      const button = event.target?.closest('#view-dashboard [data-action="refresh"]');
      if (!button || button.disabled) return;
      event.preventDefault();
      const previousText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Refreshing…';
      try {
        const result = await socketClient.requestResync();
        if (result?.status !== 'SUCCESS') throw new Error(result?.error || 'Snapshot simulator belum berhasil disinkronkan.');
        if (typeof window.showToast === 'function') window.showToast('Data simulator berhasil disinkronkan.');
      } catch (error) {
        if (typeof window.showToast === 'function') window.showToast(`Refresh gagal: ${error.message}`, 'danger');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = previousText;
      }
    });
  }

  _bindSimulationSpeedControl() {
    // The dashboard is mounted lazily, so delegate from document instead of
    // binding to a node that may not exist during TrafficEngine.init().
    const speedSteps = [0.5, 1, 1.5, 2, 4];
    const nearestStep = (multiplier) => speedSteps.reduce((best, value, index) =>
      Math.abs(value - multiplier) < Math.abs(speedSteps[best] - multiplier) ? index : best, 0);
    const label = (index) => `${speedSteps[index]}x`;
    const getControls = () => ({
      input: document.getElementById('simulationSpeedRange'),
      output: document.getElementById('simSpeedVal')
    });

    const initial = Number(stateStore.getState().speedMultiplier ?? stateStore.getState().simConfig?.speedMultiplier);
    this._acknowledgedSpeedIndex = Number.isFinite(initial) && initial > 0 ? nearestStep(initial) : 1;

    document.addEventListener('input', (event) => {
      if (event.target?.id !== 'simulationSpeedRange') return;
      const index = Number(event.target.value);
      const controls = getControls();
      if (controls.output && Number.isInteger(index) && speedSteps[index] !== undefined) controls.output.textContent = label(index);
    });

    document.addEventListener('change', async (event) => {
      const input = event.target;
      if (input?.id !== 'simulationSpeedRange') return;
      const index = Number(input.value);
      const controls = getControls();
      if (!Number.isInteger(index) || speedSteps[index] === undefined) {
        input.value = String(this._acknowledgedSpeedIndex);
        if (controls.output) controls.output.textContent = label(this._acknowledgedSpeedIndex);
        return;
      }
      if (this._simulationSpeedPending) {
        input.value = String(this._acknowledgedSpeedIndex);
        if (controls.output) controls.output.textContent = label(this._acknowledgedSpeedIndex);
        return;
      }
      if (!authManager.hasRole(['OPERATOR', 'ADMIN'])) {
        input.value = String(this._acknowledgedSpeedIndex);
        if (controls.output) controls.output.textContent = label(this._acknowledgedSpeedIndex);
        if (typeof window.showToast === 'function') window.showToast('Kontrol kecepatan hanya tersedia untuk Operator dan Admin.', 'warning');
        return;
      }

      const requestedIndex = index;
      this._simulationSpeedPending = true;
      input.disabled = true;
      input.setAttribute('aria-busy', 'true');
      try {
        const result = await commandLayer.dispatchCommand({
          action: 'simulation:control',
          targetType: 'simulation-runtime-identifier',
          targetId: 'simulation-runtime',
          payload: { operation: 'set_speed', speedMultiplier: speedSteps[requestedIndex] }
        });
        const durableMultiplier = Number(result?.data?.speedMultiplier ?? speedSteps[requestedIndex]);
        this._acknowledgedSpeedIndex = Number.isFinite(durableMultiplier) && durableMultiplier > 0
          ? nearestStep(durableMultiplier)
          : requestedIndex;
        input.value = String(this._acknowledgedSpeedIndex);
        if (controls.output) controls.output.textContent = label(this._acknowledgedSpeedIndex);
        if (typeof window.showToast === 'function') window.showToast(`Kecepatan simulasi diperbarui: ${label(this._acknowledgedSpeedIndex)}.`);
      } catch (error) {
        input.value = String(this._acknowledgedSpeedIndex);
        if (controls.output) controls.output.textContent = label(this._acknowledgedSpeedIndex);
        if (typeof window.showToast === 'function') window.showToast(`Kecepatan simulasi tidak berubah: ${error.message}`, 'danger');
      } finally {
        this._simulationSpeedPending = false;
        input.disabled = false;
        input.removeAttribute('aria-busy');
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
      btnToggleChaos.addEventListener("click", async () => {
        const current = stateStore.getState().isChaosMode;
        const target = !current;
        btnToggleChaos.disabled = true;

        try {
          await commandLayer.dispatchCommand({
            action: 'chaos:toggle',
            targetType: 'system',
            targetId: 'global-network',
            payload: { active: target }
          }, true); // high-impact simulation control requires confirmation
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
            targetId: 'global-audio',
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
