/**
 * OmniTRAF Surabaya - Traffic Analytics & AI Prediction Controller (Phase 5)
 * Controls 24-Hour Time-Travel Simulator, AI Congestion Forecasting,
 * Single Forecast Snapshot Sync, Scenario Comparison (Baseline vs AI Optimized),
 * Corridor-Level Analytics, ESG Green Mobility Monitor, and Model Test Suite.
 */

import { soundManager } from '../core/soundManager.js';
import { mapManager } from '../modules/mapManager.js';
import { stateStore } from '../core/stateStore.js';
import { generateForecastSnapshot, runForecastTestSuite, MODEL_VERSION } from '../modules/forecastEngine.js';

export class AnalyticsController {
  constructor() {
    this.forecastCache = new Map();
    this.currentHour = 8;
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._bindSlidersAndSnapshotSync();
    this._bindTrendsTabSwitching();
    this._bindEsgTargetConfig();
    this._bindEsgCalculator();
    this._bindTestSuiteRunner();

    // Subscribe to stateStore updates (telemetry, connection status, stale data)
    stateStore.subscribe("traffic:update", () => {
      this.refreshCurrentHourSnapshot();
    });

    stateStore.subscribe("state:stale-changed", () => {
      this.refreshCurrentHourSnapshot();
    });

    // Initial render
    this.refreshCurrentHourSnapshot();
  }

  /**
   * Refreshes the forecast snapshot for current selected hour and updates all UI cards simultaneously
   */
  async refreshCurrentHourSnapshot(hour = this.currentHour, isUserAction = false) {
    this.currentHour = Math.round(Math.max(0, Math.min(23, Number(hour) || 0)));
    const currentState = stateStore.getState();

    // Generate snapshot locally or fetch from backend API
    let snapshot = null;
    try {
      const res = await fetch(`/api/prediction/v1/forecast?hour=${this.currentHour}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          snapshot = json;
        }
      }
    } catch {
      // Fallback
    }

    if (!snapshot) {
      snapshot = generateForecastSnapshot(this.currentHour, {
        ...currentState,
        isTimeTravel: isUserAction
      });
    }

    this._applyForecastSnapshotToUI(snapshot);

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
      sliderRiskLabel.textContent = snapshot.riskLabel || `Status: ${snapshot.riskText}`;
    }
    if (predTomorrowStatus) {
      predTomorrowStatus.textContent = snapshot.tomorrowStatus || "Sedang";
    }

    // 4. Metrics Cards (Total Vehicles, Speed, Volume, Probability)
    const totalVehicles = document.getElementById("analyticsTotalVehicles");
    const peakHourText = document.getElementById("analyticsPeakHourText");
    const avgSpeed = document.getElementById("analyticsAvgSpeed");
    const volumeTrend = document.getElementById("analyticsVolumeTrend");
    const speedTrend = document.getElementById("analyticsSpeedTrend");
    const predictSpeedVal = document.getElementById("predictSpeedVal");
    const predictProbVal = document.getElementById("predictProbVal");

    if (totalVehicles) totalVehicles.textContent = Number(snapshot.expectedVolume * 90).toLocaleString('id-ID');
    if (peakHourText) peakHourText.textContent = snapshot.factors?.[0] || "Arus Reguler SITS";
    if (avgSpeed) avgSpeed.textContent = `${snapshot.expectedSpeedKmh} km/jam`;
    if (volumeTrend) volumeTrend.textContent = snapshot.probabilityValue >= 75 ? "+22,4%" : snapshot.probabilityValue >= 48 ? "+8,1%" : "-15,2%";
    if (speedTrend) speedTrend.textContent = snapshot.expectedSpeedKmh <= 20 ? "-24%" : "+12%";
    if (predictSpeedVal) predictSpeedVal.textContent = `${snapshot.expectedSpeedKmh} km/jam`;
    if (predictProbVal) predictProbVal.textContent = `${snapshot.probabilityValue}%`;

    // 5. Data Quality, Provenance, and Model Version Tags
    this._updateDataQualityBadges(snapshot);

    // 6. Rule-Based Recommendation Card
    this._updateRecommendationCard(snapshot);

    // 7. Scenario Comparison Card (Baseline vs AI Optimized)
    this._updateScenarioComparisonCard(snapshot);

    // 8. Corridor-Level Analytics Breakdown
    this._updateCorridorBreakdownTable(snapshot);

    // 9. ESG Impact Sync
    this._updateEsgMetricsFromSnapshot(snapshot);

    // 10. Geospatial Map Overlay Update
    if (mapManager && typeof mapManager.updateCorridorLoadByHour === 'function') {
      mapManager.updateCorridorLoadByHour(hour);
    }
  }

  _updateDataQualityBadges(snapshot) {
    const dq = snapshot.dataQuality || {};
    const provenance = snapshot.source || dq.provenance || "REALTIME-DERIVED";
    const confidence = snapshot.confidence ?? dq.confidence ?? 94;

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
      const provColor = provenance === 'REALTIME-DERIVED' ? '#10b981' : provenance === 'DEGRADED' ? '#f59e0b' : '#38bdf8';
      qualityBadge.innerHTML = `
        <span class="badge" style="background: rgba(15, 23, 42, 0.8); border: 1px solid ${provColor}; color: ${provColor}; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 20px;">
          🏷️ SOURCE: ${provenance}
        </span>
        <span class="badge" style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(0, 229, 255, 0.4); color: #00e5ff; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 20px;">
          🎯 CONFIDENCE: ${confidence}%
        </span>
        <span class="badge" style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.15); color: #94a3b8; font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          ⚙️ MODEL: ${snapshot.modelVersion || MODEL_VERSION}
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
          <strong style="color: #00e5ff; font-size: 11px;">[ID: ${rec.recommendationId || 'REC-AI'}]</strong>
          <span style="font-size: 10px; color: var(--text-muted);">Impact: ${rec.expectedImpact}</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${rec.text}</div>
        <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
          ${(rec.reasonCodes || []).map(r => `<span style="font-size: 9.5px; padding: 2px 6px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; border-radius: 4px;">${r}</span>`).join('')}
        </div>
      `;
    }
  }

  _updateScenarioComparisonCard(snapshot) {
    const sc = snapshot.scenarioComparison;
    if (!sc) return;

    let scenarioCard = document.getElementById("analyticsScenarioCard");
    if (!scenarioCard) {
      const container = document.querySelector("#view-analytics .analytics-expanded") || document.querySelector("#view-prediction .prediction-panel");
      if (container) {
        scenarioCard = document.createElement("article");
        scenarioCard.id = "analyticsScenarioCard";
        scenarioCard.className = "glass-panel";
        scenarioCard.style.cssText = "margin-top: 16px; padding: 20px; border-left: 4px solid #00e5ff;";
        container.insertBefore(scenarioCard, container.firstChild);
      }
    }

    if (scenarioCard) {
      scenarioCard.innerHTML = `
        <div class="section-head compact" style="margin-bottom: 12px;">
          <div>
            <h2>⚖️ Simulasi Skenario: Baseline vs AI Optimized (${snapshot.hourLabel})</h2>
            <p>Eksplisit membandingkan parameter kondisi saat ini (Baseline) dengan rekayasa sinyal adaptif AI SITS.</p>
          </div>
          <span class="badge" style="background: rgba(0, 229, 255, 0.15); color: #00e5ff; font-weight: 700; padding: 4px 10px; border-radius: 8px;">Deterministic Scenario Model</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 12px;">
          <div style="background: rgba(15, 23, 42, 0.7); padding: 14px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">📊 BASELINE SITS</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Waktu Tunggu:</span><strong>${sc.baseline.waitTimeSec}s</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Panjang Antrean:</span><strong>${sc.baseline.queueMeters} m</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Kecepatan Rerata:</span><strong>${sc.baseline.speedKmh} km/h</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between;">
              <span>Throughput:</span><strong>${sc.baseline.throughputVehPerHour} veh/h</strong>
            </div>
          </div>

          <div style="background: rgba(15, 23, 42, 0.7); padding: 14px; border-radius: 10px; border: 1px solid rgba(0, 229, 255, 0.3);">
            <div style="font-size: 11px; font-weight: 800; color: #00e5ff; text-transform: uppercase; margin-bottom: 8px;">✨ AI OPTIMIZED</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Waktu Tunggu:</span><strong style="color: #10b981;">${sc.optimized.waitTimeSec}s (-${sc.delta.waitTimeReductionPct}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Panjang Antrean:</span><strong style="color: #10b981;">${sc.optimized.queueMeters} m (-${sc.delta.queueReductionPct}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Kecepatan Rerata:</span><strong style="color: #38bdf8;">${sc.optimized.speedKmh} km/h (+${sc.delta.speedGainPct}%)</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between;">
              <span>Throughput:</span><strong style="color: #38bdf8;">${sc.optimized.throughputVehPerHour} veh/h (+${sc.delta.throughputGainPct}%)</strong>
            </div>
          </div>

          <div style="background: rgba(15, 23, 42, 0.7); padding: 14px; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.3);">
            <div style="font-size: 11px; font-weight: 800; color: #10b981; text-transform: uppercase; margin-bottom: 8px;">🌱 IMPACT SCENARIO PROJECTION</div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>BBM Diselamatkan:</span><strong style="color: #10b981;">${sc.delta.fuelSavedLiters} Litres</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>CO₂ Tereduksi:</span><strong style="color: #34d399;">${sc.delta.co2SavedKg} Kg</strong>
            </div>
            <div style="font-size: 12px; color: var(--text); display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Nilai Subsidi:</span><strong style="color: #f59e0b;">Rp ${sc.delta.monetarySavedRp.toLocaleString('id-ID')}</strong>
            </div>
            <small style="color: var(--text-muted); font-size: 10px; display: block; margin-top: 6px;">Catatan: Angka ini merupakan estimasi simulasi berbasis asumsi PKJI / HCM.</small>
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
        corridorCard.className = "glass-panel";
        corridorCard.style.cssText = "margin-top: 16px; padding: 20px;";
        container.appendChild(corridorCard);
      }
    }

    if (corridorCard) {
      corridorCard.innerHTML = `
        <div class="section-head compact" style="margin-bottom: 12px;">
          <div>
            <h2>🛣️ Corridor-Level Mobility Analytics & Operational Priority</h2>
            <p>Pemantauan beban, kecepatan, kepadatan, dan tingkat risiko operasional per koridor utama Surabaya.</p>
          </div>
          <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 700; padding: 4px 10px; border-radius: 8px;">Operational Severity Ranking</span>
        </div>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); text-align: left;">
                <th style="padding: 8px;">Koridor Utama</th>
                <th style="padding: 8px;">Volume / Kapasitas</th>
                <th style="padding: 8px;">Kecepatan</th>
                <th style="padding: 8px;">Density</th>
                <th style="padding: 8px;">Queue Length</th>
                <th style="padding: 8px;">Delay</th>
                <th style="padding: 8px;">Signal Efficiency</th>
                <th style="padding: 8px;">Status Risiko</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(c => {
                const riskBadge = c.riskLevel === 'CRITICAL' ? '<span style="color:#ef4444; font-weight:800;">🔴 KRITIS</span>' : c.riskLevel === 'WARNING' ? '<span style="color:#f59e0b; font-weight:800;">🟡 WASPADA</span>' : '<span style="color:#10b981; font-weight:800;">🟢 NORMAL</span>';
                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 10px 8px; font-weight: 700; color: #ffffff;">${c.name}</td>
                    <td style="padding: 10px 8px;">${c.volume} / ${c.capacity} veh/h</td>
                    <td style="padding: 10px 8px; color: #00e5ff; font-weight: 700;">${c.speed} km/h</td>
                    <td style="padding: 10px 8px;">${c.density} veh/km</td>
                    <td style="padding: 10px 8px;">${c.queueMeters} m</td>
                    <td style="padding: 10px 8px;">${c.delaySec}s</td>
                    <td style="padding: 10px 8px; color: #10b981; font-weight: 700;">${c.signalEfficiencyPct}%</td>
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

    const co2SavedEl = document.getElementById("co2Saved");
    const fuelSavedEl = document.getElementById("fuelSaved");

    if (co2SavedEl) {
      co2SavedEl.innerHTML = `
        <span>${esg.observedSavings.co2SavedKg.toLocaleString('id-ID')} kg</span>
        <small style="font-size: 10px; color: #10b981; display: block;">(Observed Realtime) • Simulasi Scenario: ${esg.simulatedScenarioSavings.co2SavedKg} kg</small>
      `;
    }
    if (fuelSavedEl) {
      fuelSavedEl.innerHTML = `
        <span>${esg.observedSavings.fuelSavedLiters.toLocaleString('id-ID')} Liter</span>
        <small style="font-size: 10px; color: #10b981; display: block;">(Observed Realtime) • Simulasi Scenario: ${esg.simulatedScenarioSavings.fuelSavedLiters} L</small>
      `;
    }
  }

  _bindSlidersAndSnapshotSync() {
    const ttSlider = document.getElementById("timeTravelRange");
    const predSlider = document.getElementById("predictionTimeSlider");

    if (ttSlider) {
      ttSlider.addEventListener("input", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        this.refreshCurrentHourSnapshot(hour, false);
      });
      ttSlider.addEventListener("change", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        this.refreshCurrentHourSnapshot(hour, true);
      });
    }

    if (predSlider) {
      predSlider.addEventListener("input", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        this.refreshCurrentHourSnapshot(hour, false);
      });
      predSlider.addEventListener("change", (e) => {
        const hour = parseInt(e.target.value, 10) || 0;
        this.refreshCurrentHourSnapshot(hour, true);
      });
    }
  }

  _bindTrendsTabSwitching() {
    const buttons = document.querySelectorAll("#analyticsTimeRangeSegmented .time-range-seg-btn, .time-range-seg-btn");
    const pathPrimary = document.getElementById("chartPathPrimary");
    const pathMuted = document.getElementById("chartPathMuted");
    const pathCyan = document.getElementById("chartPathCyan");
    const chartArea = document.querySelector("#trendChart .chart-area");

    const PATH_PRESETS = {
      today: {
        primary: "M0 206 C65 200 100 132 158 92 S285 112 352 152 S530 115 760 96",
        muted: "M0 180 C80 185 155 166 252 120 S410 86 540 104 S650 85 760 72",
        cyan: "M0 228 C88 218 142 158 224 84 S350 180 468 168 S624 142 760 176",
        area: "M0 206 C65 200 100 132 158 92 S285 112 352 152 S530 115 760 96 L760 260 L0 260 Z"
      },
      "7d": {
        primary: "M0 160 C80 140 140 80 230 70 S380 130 490 85 S640 60 760 110",
        muted: "M0 195 C90 190 180 150 270 140 S440 110 560 125 S680 90 760 85",
        cyan: "M0 210 C70 190 160 110 250 100 S390 150 510 130 S650 95 760 140",
        area: "M0 160 C80 140 140 80 230 70 S380 130 490 85 S640 60 760 110 L760 260 L0 260 Z"
      },
      "30d": {
        primary: "M0 180 C100 160 200 120 300 110 S500 70 600 80 S700 95 760 60",
        muted: "M0 170 C95 165 190 140 310 130 S480 95 590 100 S690 80 760 75",
        cyan: "M0 220 C110 200 210 130 320 120 S470 110 580 90 S680 120 760 130",
        area: "M0 180 C100 160 200 120 300 110 S500 70 600 80 S700 95 760 60 L760 260 L0 260 Z"
      }
    };

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const range = btn.dataset.range || "today";
        const paths = PATH_PRESETS[range] || PATH_PRESETS.today;

        if (pathPrimary && paths.primary) pathPrimary.setAttribute("d", paths.primary);
        if (pathMuted && paths.muted) pathMuted.setAttribute("d", paths.muted);
        if (pathCyan && paths.cyan) pathCyan.setAttribute("d", paths.cyan);
        if (chartArea && paths.area) chartArea.setAttribute("d", paths.area);

        soundManager.play('click');
      });
    });
  }

  _bindEsgTargetConfig() {
    const form = document.getElementById("esgConfigForm");
    const input = document.getElementById("esgCo2TargetInput");
    const progressFill = document.getElementById("esgProgressFill");
    const progressText = document.getElementById("esgProgressText");

    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const targetVal = Math.max(500, parseInt(input?.value, 10) || 2000);
      const currentSavedCo2 = stateStore.getState().telemetry?.co2SavedKg || 1420;
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

    slider.addEventListener("input", (e) => {
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
        runnerBtn.innerHTML = "🧪 Jalankan Test Suite Model (15 Scenarios)";
        parentHead.appendChild(runnerBtn);
      }
    }

    if (runnerBtn) {
      runnerBtn.addEventListener("click", async () => {
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
            window.showToast(`✅ Model Verification Suite Complete: ${report.passedCount}/${report.totalTests} Scenarios Passed!`, "success");
          }
        } catch (err) {
          console.error("Test Suite Error:", err);
        } finally {
          runnerBtn.disabled = false;
          runnerBtn.innerHTML = "🧪 Jalankan Test Suite Model (15 Scenarios)";
        }
      });
    }
  }
}

export const analyticsController = new AnalyticsController();
