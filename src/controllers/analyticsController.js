/**
 * OmniTRAF Surabaya - Traffic Analytics & AI Prediction Controller
 * Controls 24-Hour Time-Travel Simulator, AI Congestion Forecasting,
 * Single Forecast Snapshot Sync, Scenario Comparison (Kondisi dasar vs optimasi model),
 * Corridor-Level Analytics, ESG Green Mobility Monitor, and Model Test Suite.
 */

import { soundManager } from '../core/soundManager.js';
import { stateStore, escapeHtml } from '../core/stateStore.js';
import { generateForecastSnapshot, runForecastTestSuite, MODEL_VERSION } from '../modules/forecastEngine.js';
import { Disposer } from '../core/disposer.js';
import { buildAnalyticsSeries } from '../modules/analyticsSeries.js';

export class AnalyticsController {
  constructor() {
    this.forecastCache = new Map();
    this.currentHour = 8;
    this._isInitialized = false;
    this.disposer = new Disposer('AnalyticsController');
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
  }

  activate() {
    this.deactivate(); // Ensure clean slate before binding
    this.active = true;

    this._bindSlidersAndSnapshotSync();
    this._bindTrendsTabSwitching();
    this._bindCorridorDropdown();
    this._bindEsgTargetConfig();
    this._bindEsgCalculator();
    this._bindEsgMethodologyModal();
    this._bindTestSuiteRunner();
    this._setupStoreListeners();

    this.refreshCurrentHourSnapshot();
  }

  deactivate() {
    this.active = false;
    this._forecastRequestToken = (this._forecastRequestToken || 0) + 1;
    this.abortController?.abort();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.sliderTimer);
    this.disposer.clear();
  }

  _setupStoreListeners() {
    this.disposer.addStoreSubscription(stateStore, "traffic:update", () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => { if (this.active) this.refreshCurrentHourSnapshot(); }, 250);
    });

    this.disposer.addStoreSubscription(stateStore, "state:stale-changed", () => {
      this.refreshCurrentHourSnapshot();
    });
  }

  /**
   * Bind Corridor Selection Dropdown to update prediction chart curves per corridor
   */
  _bindCorridorDropdown() {
    const select = document.getElementById("analyticsCorridorSelect");
    if (!select) return;

    select.value = this.corridorId || 'corridor-ayani';
    this.disposer.addEventListener(select, 'change', () => {
      this.corridorId = select.value;
      this.refreshCurrentHourSnapshot(this.currentHour, true);
    });
  }

  /**
   * Bind ESG Methodology Modal Info Button
   */
  _bindEsgMethodologyModal() {
    const btnInfo = document.getElementById("btnEsgMethodology");
    const modal = document.getElementById("esgMethodologyModal");
    const closeBtn = document.getElementById("closeEsgMethodologyModal");
    const understandBtn = document.getElementById("btnUnderstandEsgModal");

    if (!btnInfo || !modal) return;

    const openModal = () => {
      modal.style.display = "flex";
      modal.classList.add("show");
      soundManager.play('click');
    };

    const closeModal = () => {
      modal.style.display = "none";
      modal.classList.remove("show");
    };

    this.disposer.addEventListener(btnInfo, "click", openModal);
    if (closeBtn) this.disposer.addEventListener(closeBtn, "click", closeModal);
    if (understandBtn) this.disposer.addEventListener(understandBtn, "click", closeModal);

    this.disposer.addEventListener(modal, "click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  /**
   * Refreshes the forecast snapshot for current selected hour and updates all UI cards simultaneously
   */
  async refreshCurrentHourSnapshot(hour = this.currentHour, isUserAction = false) {
    const targetHour = Math.round(Math.max(0, Math.min(23, Number(hour) || 0)));
    this.currentHour = targetHour;
    
    // Increment request token for out-of-order sequence check
    this._forecastRequestToken = (this._forecastRequestToken || 0) + 1;
    const currentToken = this._forecastRequestToken;

    const currentState = stateStore.getState();

    // One client snapshot drives every model panel; no separate server sample can drift.
    const snapshot = generateForecastSnapshot(targetHour, { ...currentState, isTimeTravel: isUserAction });
    if (currentToken !== this._forecastRequestToken || !this.active) return;

    this._applyForecastSnapshotToUI(snapshot);
    this._renderSeries(currentState);

    if (isUserAction) {
      soundManager.play('click');
    }
  }

  _applyForecastSnapshotToUI(snapshot) {
    if (!snapshot) return;

    const hour = snapshot.hour;
    const timeStr = snapshot.hourLabel || `${String(hour).padStart(2, '0')}:00 WIB`;

    // 1. Sync Slider Values
    const ttSlider = document.getElementById("timeTravelRange");
    const predSlider = document.getElementById("predictionTimeSlider");
    if (ttSlider && Number(ttSlider.value) !== hour) ttSlider.value = hour;
    if (predSlider && Number(predSlider.value) !== hour) predSlider.value = hour;

    // 2. Time-Travel Header & Hour Badges
    const ttTimeVal = document.getElementById("timeTravelTimeVal");
    const hourBadge = document.getElementById("analyticsHourBadge");
    const predTimeLabel = document.getElementById("sliderTimeLabel");

    if (ttTimeVal) ttTimeVal.textContent = timeStr;
    if (hourBadge) hourBadge.textContent = `🕒 ${timeStr}`;
    if (predTimeLabel) predTimeLabel.textContent = timeStr;

    // 3. Status Labels & Risk Colors
    const statusText = document.getElementById("timeTravelStatusText");
    const sliderRiskLabel = document.getElementById("sliderRiskLabel");
    const predTomorrowStatus = document.getElementById("predTomorrowStatus");

    if (statusText) {
      statusText.textContent = snapshot.riskText || snapshot.trafficStatus;
      statusText.style.color = snapshot.riskColor || "var(--primary)";
    }
    if (sliderRiskLabel) {
      const riskLabels = { HIGH: 'Risiko macet tinggi', MODERATE: 'Risiko macet sedang', LOW: 'Risiko macet rendah' };
      sliderRiskLabel.textContent = `Status: ${riskLabels[snapshot.riskLevel] || 'Risiko belum tersedia'}`;
    }
    if (predTomorrowStatus) {
      predTomorrowStatus.textContent = snapshot.tomorrowStatus || "Sedang";
    }

    // 4. Metrics Cards (volume, speed, and model risk index)
    const totalVehicles = document.getElementById("analyticsTotalVehicles");
    const peakHourText = document.getElementById("analyticsPeakHourText");
    const avgSpeed = document.getElementById("analyticsAvgSpeed");
    const volumeTrend = document.getElementById("analyticsVolumeTrend");
    const speedTrend = document.getElementById("analyticsSpeedTrend");
    const predictSpeedVal = document.getElementById("predictSpeedVal");
    const predictProbVal = document.getElementById("predictProbVal");

    if (totalVehicles) totalVehicles.textContent = Number(snapshot.expectedVolume).toLocaleString('id-ID');
    if (peakHourText) peakHourText.textContent = snapshot.hourLabel;
    if (avgSpeed) avgSpeed.textContent = `${snapshot.expectedSpeedKmh} km/jam`;
    if (volumeTrend) volumeTrend.hidden = true;
    if (speedTrend) speedTrend.hidden = true;
    if (predictSpeedVal) predictSpeedVal.textContent = `${snapshot.expectedSpeedKmh} km/jam`;
    if (predictProbVal) predictProbVal.textContent = `${snapshot.probabilityValue}/100`;

    // 5. Data Quality, Provenance, and Model Version Tags
    this._updateDataQualityBadges(snapshot);

    // 6. Rule-Based Recommendation Card
    this._updateRecommendationCard(snapshot);

    // 7. Scenario Comparison Card (Kondisi dasar vs optimasi model)
    this._updateScenarioComparisonCard(snapshot);

    // 8. Corridor-Level Analytics Breakdown
    this._updateCorridorBreakdownTable(snapshot);

    // 9. ESG Impact Sync
    this._updateEsgMetricsFromSnapshot(snapshot);

    // 10. Geospatial Map Overlay Update
    if (window.mapManager && typeof window.mapManager.updateCorridorLoadByHour === 'function') {
      window.mapManager.updateCorridorLoadByHour(hour);
    }
  }

  _updateDataQualityBadges(snapshot) {
    const dq = snapshot.dataQuality || {};
    const provenance = snapshot.source || dq.provenance || "SIMULATED";

    // Update or inject quality badges in prediction header
    let qualityBadge = document.getElementById("analyticsDataQualityBadge");
    if (!qualityBadge) {
      const parentHead = document.querySelector("#card-analytics .section-head") || document.querySelector("#view-analytics .section-head");
      if (parentHead) {
        qualityBadge = document.createElement("div");
        qualityBadge.id = "analyticsDataQualityBadge";
        qualityBadge.className = "quality-badge-wrap";
        qualityBadge.style.cssText = "display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap;";
        parentHead.appendChild(qualityBadge);
      }
    }

    if (qualityBadge) {
      const provColor = provenance === 'DEGRADED' ? 'var(--warning)' : 'var(--status-warning)';
      qualityBadge.innerHTML = `
        <span class="badge provenance-badge simulated" style="border-color: ${provColor};">
          SUMBER: ${escapeHtml(({ 'REALTIME-DERIVED': 'STREAM SIMULATOR', SIMULATED: 'MODEL LOKAL', DEGRADED: 'MODEL · INPUT TIDAK TERKINI' })[provenance] || 'MODEL SIMULASI')}
        </span>
        <span class="badge provenance-badge simulated">
          MODEL: ${escapeHtml(snapshot.modelVersion || MODEL_VERSION)}
        </span>
      `;
    }
  }

  _updateRecommendationCard(snapshot) {
    const recTextEl = document.getElementById("predictRecText");
    const rec = snapshot.recommendation;

    if (recTextEl && rec) {
      recTextEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
          <strong style="color: var(--primary-2); font-size: 11px;">[ID: ${escapeHtml(rec.recommendationId || 'REC-AI')}]</strong>
          <span style="font-size: 10px; color: var(--text-muted);">Dampak model: ${escapeHtml(rec.expectedImpact)}</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${escapeHtml(rec.text)}</div>
        <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
          ${(Array.isArray(rec.reasonCodes) ? rec.reasonCodes : []).map(r => `<span style="font-size: 9.5px; padding: 2px 6px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: var(--primary-2); border-radius: 4px;">${escapeHtml(r)}</span>`).join('')}
        </div>
      `;
    }
  }

  _updateScenarioComparisonCard(snapshot) {
    const sc = snapshot.scenarioComparison;
    if (!sc) return;

    const container = document.querySelector('.view-pane.active .analytics-expanded, .view-pane.active .prediction-panel');
    if (!container) return;
    let scenarioCard = container.querySelector('[data-scenario-comparison]');
    if (!scenarioCard) {

      if (container) {
        scenarioCard = document.createElement("article");
        scenarioCard.dataset.scenarioComparison = "true";
        scenarioCard.className = "glass-panel model-dynamic";
        scenarioCard.style.cssText = "margin-top: 16px; padding: 20px; border-left: 4px solid #00e5ff;";
        container.insertBefore(scenarioCard, container.firstChild);
      }
    }

    if (scenarioCard) {
      scenarioCard.innerHTML = `
        <div class="section-head compact" style="margin-bottom: 12px;">
          <div>
            <h2>⚖️ Simulasi Skenario: Kondisi dasar vs optimasi model (${escapeHtml(snapshot.hourLabel)})</h2>
            <p>Perbandingan jaringan simulasi pada jam terpilih. Filter koridor hanya mengubah grafik dan KPI yang terikat pada filter tersebut.</p>
          </div>
          <span class="badge" style="background: rgba(0, 229, 255, 0.15); color: var(--primary-2); font-weight: 700; padding: 4px 10px; border-radius: 8px;">Model skenario deterministik</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 12px;">
          <div style="background: var(--panel-soft); padding: 14px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">📊 KONDISI DASAR SIMULASI</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Waktu Tunggu:</span><strong>${escapeHtml(sc.baseline.waitTimeSec)} detik</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Panjang Antrean:</span><strong>${escapeHtml(sc.baseline.queueMeters)} m</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Kecepatan Rerata:</span><strong>${escapeHtml(sc.baseline.speedKmh)} km/jam</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between;">
              <span>Kendaraan per jam:</span><strong>${escapeHtml(sc.baseline.throughputVehPerHour)} kend/jam</strong>
            </div>
          </div>

          <div style="background: var(--panel-soft); padding: 14px; border-radius: 10px; border: 1px solid rgba(0, 229, 255, 0.3);">
            <div style="font-size: 11px; font-weight: 800; color: var(--primary-2); text-transform: uppercase; margin-bottom: 8px;">✨ SKENARIO SPLIT KANDIDAT</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Waktu Tunggu:</span><strong style="color: #10b981;">${escapeHtml(sc.optimized.waitTimeSec)} detik (-${escapeHtml(sc.delta.waitTimeReductionPct)}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Panjang Antrean:</span><strong style="color: #10b981;">${escapeHtml(sc.optimized.queueMeters)} m (-${escapeHtml(sc.delta.queueReductionPct)}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Kecepatan Rerata:</span><strong style="color: var(--primary-2);">${escapeHtml(sc.optimized.speedKmh)} km/jam (+${escapeHtml(sc.delta.speedGainPct)}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between;">
              <span>Kendaraan per jam:</span><strong style="color: var(--primary-2);">${escapeHtml(sc.optimized.throughputVehPerHour)} kend/jam (+${escapeHtml(sc.delta.throughputGainPct)}%)</strong>
            </div>
          </div>

          <div style="background: var(--panel-soft); padding: 14px; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.3);">
            <div style="font-size: 11px; font-weight: 800; color: #10b981; text-transform: uppercase; margin-bottom: 8px;">🌱 DAMPAK TURUNAN SIMULASI</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>BBM model:</span><strong style="color: #10b981;">${escapeHtml(sc.delta.fuelSavedLiters)} liter</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>CO₂ model:</span><strong style="color: #34d399;">${escapeHtml(sc.delta.co2SavedKg)} kg</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Nilai biaya model:</span><strong style="color: #f59e0b;">Rp ${Number(sc.delta.monetarySavedRp || 0).toLocaleString('id-ID')}</strong>
            </div>
            <small style="color: var(--text-muted); font-size: 10px; display: block; margin-top: 6px;">${escapeHtml(sc.assumptions.responseModel)} Faktor BBM, emisi, dan harga juga merupakan asumsi; bukan hasil ukur.</small>
          </div>
        </div>
      `;
    }
  }

  _updateCorridorBreakdownTable(snapshot) {
    const list = snapshot.corridorBreakdown;
    if (!Array.isArray(list) || list.length === 0) return;

    let corridorCard = document.getElementById("analyticsCorridorBreakdownCard");
    if (!corridorCard) {
      const container = document.querySelector("#view-analytics .analytics-expanded");
      if (container) {
        corridorCard = document.createElement("article");
        corridorCard.id = "analyticsCorridorBreakdownCard";
        corridorCard.className = "glass-panel model-dynamic";
        corridorCard.style.cssText = "margin-top: 16px; padding: 20px;";
        container.appendChild(corridorCard);
      }
    }

    if (corridorCard) {
      corridorCard.innerHTML = `
        <div class="section-head compact" style="margin-bottom: 12px;">
          <div>
            <h2>🛣️ Kinerja koridor & prioritas model</h2>
            <p>Pemantauan beban, kecepatan, kepadatan, dan tingkat risiko operasional per koridor utama Surabaya.</p>
          </div>
          <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--primary-2); font-weight: 700; padding: 4px 10px; border-radius: 8px;">Peringkat risiko model</span>
        </div>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); text-align: left;">
                <th style="padding: 8px;">Koridor Utama</th>
                <th style="padding: 8px;">Volume / Kapasitas</th>
                <th style="padding: 8px;">Kecepatan</th>
                <th style="padding: 8px;">Kepadatan</th>
                <th style="padding: 8px;">Antrean</th>
                <th style="padding: 8px;">Tundaan</th>
                <th style="padding: 8px;">Efisiensi model</th>
                <th style="padding: 8px;">Status Risiko</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(c => {
                const riskBadge = c.riskLevel === 'CRITICAL' ? '<span style="color:#ef4444; font-weight:800;">🔴 KRITIS</span>' : c.riskLevel === 'WARNING' ? '<span style="color:#f59e0b; font-weight:800;">🟡 WASPADA</span>' : '<span style="color:#10b981; font-weight:800;">🟢 NORMAL</span>';
                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 10px 8px; font-weight: 700; color: var(--text);">${escapeHtml(c.name)}</td>
                    <td style="padding: 10px 8px;">${escapeHtml(c.volume)} / ${escapeHtml(c.capacity)} veh/h</td>
                    <td style="padding: 10px 8px; color: var(--primary-2); font-weight: 700;">${escapeHtml(c.speed)} km/h</td>
                    <td style="padding: 10px 8px;">${escapeHtml(c.density)} veh/km</td>
                    <td style="padding: 10px 8px;">${escapeHtml(c.queueMeters)} m</td>
                    <td style="padding: 10px 8px;">${escapeHtml(c.delaySec)}s</td>
                    <td style="padding: 10px 8px; color: #10b981; font-weight: 700;">${escapeHtml(c.signalEfficiencyPct)}%</td>
                    <td style="padding: 10px 8px;">${riskBadge}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  _updateEsgMetricsFromSnapshot(snapshot) {
    const esg = snapshot.esgImpact;
    if (!esg) return;

    const formatMetric = (value) => {
      if (value === null || value === undefined || value === '') return '—';
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue.toLocaleString('id-ID') : '—';
    };

    const co2SavedEl = document.getElementById("co2Saved");
    const fuelSavedEl = document.getElementById("fuelSaved");

    if (co2SavedEl) {
      co2SavedEl.innerHTML = `
        <span>${escapeHtml(formatMetric(esg.observedSavings?.co2SavedKg))} kg</span>
        <small class="esg-source-note">Teramati di simulator • skenario model: ${escapeHtml(formatMetric(esg.simulatedScenarioSavings?.co2SavedKg))} kg</small>
      `;
    }
    if (fuelSavedEl) {
      fuelSavedEl.innerHTML = `
        <span>${escapeHtml(formatMetric(esg.observedSavings?.fuelSavedLiters))} Liter</span>
        <small class="esg-source-note">Teramati di simulator • skenario model: ${escapeHtml(formatMetric(esg.simulatedScenarioSavings?.fuelSavedLiters))} L</small>
      `;
    }
  }

  _bindSlidersAndSnapshotSync() {
    const ttSlider = document.getElementById("timeTravelRange");
    const predSlider = document.getElementById("predictionTimeSlider");

    if (ttSlider) {
      this.disposer.addEventListener(ttSlider, "input", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        clearTimeout(this.sliderTimer);
        this.sliderTimer = setTimeout(() => { if (this.active) this.refreshCurrentHourSnapshot(hour, false); }, 180);
      });
      this.disposer.addEventListener(ttSlider, "change", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        clearTimeout(this.sliderTimer);
        this.refreshCurrentHourSnapshot(hour, true);
      });
    }

    if (predSlider) {
      this.disposer.addEventListener(predSlider, "input", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        clearTimeout(this.sliderTimer);
        this.sliderTimer = setTimeout(() => { if (this.active) this.refreshCurrentHourSnapshot(hour, false); }, 180);
      });
      this.disposer.addEventListener(predSlider, "change", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        clearTimeout(this.sliderTimer);
        this.refreshCurrentHourSnapshot(hour, true);
      });
    }
  }

  _bindTrendsTabSwitching() {
    document.querySelectorAll('.time-range-seg-btn').forEach(button => {
      const available = button.dataset.range === 'today';
      button.disabled = !available;
      button.title = available ? 'Profil model selama 24 jam' : 'Histori belum tersedia; simulator hanya menyediakan profil 24 jam.';
      button.setAttribute('aria-pressed', String(available));
    });
  }

  _renderSeries(state) {
    const root = document.getElementById('view-analytics');
    if (!root?.classList.contains('active')) return;
    const series = buildAnalyticsSeries(state, this.corridorId);
    const selected = series.points[this.currentHour];
    const set = (id, value) => { const el = root.querySelector(`#${id}`); if (el) el.textContent = value; };
    set('analyticsTotalVehicles', series.totalVolume.toLocaleString('id-ID'));
    set('analyticsPeakHourText', `${String(series.peak.hour).padStart(2, '0')}:00–${String(series.peak.hour + 1).padStart(2, '0')}:00`);
    set('analyticsAvgSpeed', `${series.averageSpeed} km/jam`);
    const svg = root.querySelector('#trendChart');
    const max = Math.ceil(Math.max(...series.points.map(point => point.volume)) / 500) * 500;
    const x = hour => 64 + hour * 28;
    const y = value => 220 - value / max * 175;
    const path = series.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.hour)} ${y(point.volume)}`).join(' ');
    if (svg) {
      svg.innerHTML = `<title>Volume model ${escapeHtml(series.corridor.name)} selama 24 jam</title>
        ${[0, .25, .5, .75, 1].map(ratio => `<line x1="64" y1="${y(max * ratio)}" x2="708" y2="${y(max * ratio)}" class="series-grid"/><text x="56" y="${y(max * ratio) + 4}" text-anchor="end">${Math.round(max * ratio)}</text>`).join('')}
        <text x="64" y="24">Kendaraan/jam · model sintetis</text><path d="${path}" class="series-line" fill="none"/>
        ${[0, 4, 8, 12, 16, 20, 23].map(hour => `<text x="${x(hour)}" y="248" text-anchor="middle">${String(hour).padStart(2, '0')}:00</text>`).join('')}
        ${series.points.map(point => `<circle cx="${x(point.hour)}" cy="${y(point.volume)}" r="${point.hour === this.currentHour ? 6 : 4}" class="series-point"><title>${point.hour}:00 WIB · ${point.volume} kendaraan/jam · ${point.speed} km/jam · indeks ${point.risk}/100</title></circle>`).join('')}`;
    }
    let detail = root.querySelector('#analyticsSeriesDetail');
    if (!detail) {
      detail = document.createElement('details'); detail.id = 'analyticsSeriesDetail'; detail.className = 'series-detail';
      svg?.parentElement?.appendChild(detail);
    }
    if (detail) detail.innerHTML = `<summary>Data per jam: ${escapeHtml(series.corridor.name)}</summary><p>${String(this.currentHour).padStart(2,'0')}:00 WIB: ${selected.volume.toLocaleString('id-ID')} kendaraan/jam; ${selected.speed} km/jam. Total merupakan penjumlahan 24 interval satu jam, bukan histori lapangan.</p><div class="table-scroll"><table><thead><tr><th>Jam WIB</th><th>Kendaraan/jam</th><th>Kecepatan</th><th>Indeks risiko</th></tr></thead><tbody>${series.points.map(point => `<tr><td>${String(point.hour).padStart(2,'0')}:00</td><td>${point.volume}</td><td>${point.speed} km/jam</td><td>${point.risk}/100</td></tr>`).join('')}</tbody></table></div>`;
    set('analyticsHourBadge', `${series.corridor.name} · ${String(this.currentHour).padStart(2,'0')}:00 WIB`);
  }

  _bindEsgTargetConfig() {
    const form = document.getElementById("esgConfigForm");
    const input = document.getElementById("esgCo2TargetInput");
    try { const saved = localStorage.getItem("omnitraf.esgTarget"); if (input && saved) input.value = saved; } catch (_) {}
    const progressFill = document.getElementById("esgProgressFill");
    const progressText = document.getElementById("esgProgressText");

    if (!form) return;

    this.disposer.addEventListener(form, "submit", (e) => {
      e.preventDefault();
      const targetVal = Number(input?.value);
      if (!Number.isFinite(targetVal) || targetVal < 500) { input?.reportValidity(); return; }
      try { localStorage.setItem("omnitraf.esgTarget", String(targetVal)); } catch (_) {}
      const rawCo2 = stateStore.getState().telemetry?.co2SavedKg;
      const currentSavedCo2 = rawCo2 == null ? NaN : Number(rawCo2);
      if (!Number.isFinite(currentSavedCo2)) {
        if (typeof window.showToast === 'function') window.showToast('Data estimasi CO₂ simulator belum tersedia.', 'warning');
        return;
      }
      const percentage = Math.min(100, Math.round((currentSavedCo2 / targetVal) * 100));

      if (progressFill) progressFill.style.width = `${percentage}%`;
      if (progressText) progressText.textContent = `${percentage}%`;

      soundManager.play('success');
      if (typeof window.showToast === "function") {
        window.showToast(`🌱 Target reduksi CO₂ diperbarui: ${targetVal.toLocaleString('id-ID')} kg/hari (Progres: ${percentage}%).`);
      }
    });
  }

  _bindEsgCalculator() {
    const slider = document.getElementById("esgSignalOptSlider");
    const sliderVal = document.getElementById("esgOptSliderVal");
    const queueHoursSaved = document.getElementById("esgQueueHoursSaved");
    const calcFuelSaved = document.getElementById("esgCalcFuelSaved");
    const calcCo2Saved = document.getElementById("esgCalcCo2Saved");
    const calcMoneySaved = document.getElementById("esgCalcMoneySaved");

    if (!slider) return;

    const recalculate = (optPct) => {
      if (sliderVal) sliderVal.textContent = `${optPct}%`;

      const hours = optPct * 125;
      const fuel = hours * 0.28;
      const co2 = fuel * 2.31;
      const money = Math.round(fuel * 14500);

      if (queueHoursSaved) queueHoursSaved.textContent = `${hours.toLocaleString('id-ID')} Jam`;
      if (calcFuelSaved) calcFuelSaved.textContent = `${fuel.toFixed(1).replace('.', ',')} L`;
      if (calcCo2Saved) calcCo2Saved.textContent = `${co2.toFixed(1).replace('.', ',')} Kg`;
      if (calcMoneySaved) calcMoneySaved.textContent = `Rp ${money.toLocaleString('id-ID')}`;
    };

    this.disposer.addEventListener(slider, "input", (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      recalculate(val);
    });

    // Initial
    recalculate(parseInt(slider.value, 10) || 24);
  }

  _bindTestSuiteRunner() {
    let runnerBtn = document.getElementById("btnRunForecastTestSuite");
    if (!runnerBtn) {
      const parentHead = document.querySelector("#view-prediction .prediction-panel .section-head");
      if (parentHead) {
        runnerBtn = document.createElement("button");
        runnerBtn.id = "btnRunForecastTestSuite";
        runnerBtn.className = "btn btn-ghost compact";
        runnerBtn.style.cssText = "margin-top: 6px;";
        runnerBtn.innerHTML = "🧪 Evaluasi 15 skenario model";
        parentHead.appendChild(runnerBtn);
      }
    }

    if (runnerBtn) {
      this.disposer.addEventListener(runnerBtn, "click", async () => {
        runnerBtn.disabled = true;
        runnerBtn.textContent = "⏳ Memproses 15 Skenario Uji...";

        try {
          const res = await fetch("/api/prediction/v1/test-cases");
          let report = null;
          if (res.ok) {
            const json = await res.json();
            report = json.testReport;
          }
          if (!report) {
            report = runForecastTestSuite(stateStore.getState());
          }

          soundManager.play("success");
          if (typeof window.showToast === "function") {
            window.showToast(`✅ Evaluasi model selesai: ${report.passedCount}/${report.totalTests} skenario sesuai.`, "success");
          }
        } catch (err) {
          console.error("Test Suite Error:", err);
        } finally {
          runnerBtn.disabled = false;
          runnerBtn.innerHTML = "🧪 Evaluasi 15 skenario model";
        }
      });
    }
  }
}

export const analyticsController = new AnalyticsController();
