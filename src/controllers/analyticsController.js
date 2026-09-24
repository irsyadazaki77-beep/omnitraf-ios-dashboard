/**
 * OmniTRAF Surabaya - Traffic Analytics & AI Prediction Controller
 * Mengendalikan slider Time-Travel 24 jam, AI Hour-by-Hour Congestion Forecasting,
 * switch rentang waktu grafik SVG morphing, konfigurasi target ESG, serta kalkulator simulasi dampak BBM & CO2.
 */

import { soundManager } from '../core/soundManager.js';
import { mapManager } from '../modules/mapManager.js';

export class AnalyticsController {
  constructor() {
    this.forecastCache = new Map();
  }

  init() {
    this._bindTimeTravelSlider();
    this._bindPredictionSlider();
    this._bindTrendsTabSwitching();
    this._bindEsgTargetConfig();
    this._bindEsgCalculator();
  }

  /**
   * 1. 24-Hour Time-Travel Simulator (#timeTravelRange)
   */
  _bindTimeTravelSlider() {
    const slider = document.getElementById("timeTravelRange");
    const timeVal = document.getElementById("timeTravelTimeVal");
    const statusText = document.getElementById("timeTravelStatusText");
    const hourBadge = document.getElementById("analyticsHourBadge");
    const totalVehicles = document.getElementById("analyticsTotalVehicles");
    const peakHourText = document.getElementById("analyticsPeakHourText");
    const avgSpeed = document.getElementById("analyticsAvgSpeed");
    const volumeTrend = document.getElementById("analyticsVolumeTrend");
    const speedTrend = document.getElementById("analyticsSpeedTrend");

    if (!slider) return;

    const applyHourState = (hour, isEventChange = false) => {
      const timeStr = `${String(hour).padStart(2, '0')}:00 WIB`;
      if (timeVal) timeVal.textContent = timeStr;
      if (hourBadge) hourBadge.textContent = `🕒 ${timeStr}`;

      const isPeakMorning = (hour >= 7 && hour <= 9);
      const isPeakEvening = (hour >= 16 && hour <= 19);
      const isBusinessHours = (hour >= 11 && hour <= 14);
      const isNight = (hour >= 22 || hour <= 5);

      let statusStr = "Arus Normal Terkendali";
      let statusColor = "#0284c7";
      let vehicleCount = "72.400";
      let peakStr = "Arus Teratur SITS";
      let speedStr = "36 km/jam";
      let volTrendStr = "+2,1%";
      let spdTrendStr = "+4%";

      if (isPeakMorning) {
        statusStr = "Jam Puncak Sibuk Pagi";
        statusColor = "#ef4444";
        vehicleCount = "138.450";
        peakStr = "07:00–09:00 (Puncak Pagi)";
        speedStr = "18 km/jam";
        volTrendStr = "+18,4%";
        spdTrendStr = "-16%";
      } else if (isPeakEvening) {
        statusStr = "Jam Puncak Sibuk Sore";
        statusColor = "#ef4444";
        vehicleCount = "142.800";
        peakStr = "16:00–19:00 (Puncak Sore)";
        speedStr = "16 km/jam";
        volTrendStr = "+22,1%";
        spdTrendStr = "-22%";
      } else if (isBusinessHours) {
        statusStr = "Arus Niaga Siang Hari";
        statusColor = "#f59e0b";
        vehicleCount = "96.500";
        peakStr = "11:00–14:00 (Arus Niaga)";
        speedStr = "32 km/jam";
        volTrendStr = "+6,8%";
        spdTrendStr = "-3%";
      } else if (isNight) {
        statusStr = "Arus Lengang / Bebas Hambatan";
        statusColor = "#10b981";
        vehicleCount = "24.300";
        peakStr = "22:00–05:00 (Lengang)";
        speedStr = "52 km/jam";
        volTrendStr = "-42,5%";
        spdTrendStr = "+35%";
      }

      if (statusText) {
        statusText.textContent = statusStr;
        statusText.style.color = statusColor;
      }

      if (totalVehicles) totalVehicles.textContent = vehicleCount;
      if (peakHourText) peakHourText.textContent = peakStr;
      if (avgSpeed) avgSpeed.textContent = speedStr;
      if (volumeTrend) volumeTrend.textContent = volTrendStr;
      if (speedTrend) speedTrend.textContent = spdTrendStr;

      // Update warna & ketebalan koridor di peta geospasial
      if (mapManager && typeof mapManager.updateCorridorLoadByHour === 'function') {
        mapManager.updateCorridorLoadByHour(hour);
      }

      if (isEventChange) {
        soundManager.play('click');
        if (typeof window.showToast === "function") {
          window.showToast(`⏳ Time-Travel SITS: Pukul ${timeStr} (${statusStr}).`);
        }
      }
    };

    slider.addEventListener("input", (e) => {
      const hour = parseInt(e.target.value, 10) || 0;
      applyHourState(hour, false);
    });

    slider.addEventListener("change", (e) => {
      const hour = parseInt(e.target.value, 10) || 0;
      applyHourState(hour, true);
    });

    // Inisialisasi awal slider
    applyHourState(parseInt(slider.value, 10) || 8, false);
  }

  /**
   * 2. AI Hour-by-Hour Congestion Forecasting (#predictionTimeSlider)
   */
  _bindPredictionSlider() {
    const slider = document.getElementById("predictionTimeSlider");
    const sliderTimeLabel = document.getElementById("sliderTimeLabel");
    const sliderRiskLabel = document.getElementById("sliderRiskLabel");
    const predictSpeedVal = document.getElementById("predictSpeedVal");
    const predictProbVal = document.getElementById("predictProbVal");
    const predictRecText = document.getElementById("predictRecText");
    const predTomorrowStatus = document.getElementById("predTomorrowStatus");

    if (!slider) return;

    const fetchOrComputeForecast = async (hour) => {
      const timeStr = `${String(hour).padStart(2, '0')}:00 WIB`;
      if (sliderTimeLabel) sliderTimeLabel.textContent = timeStr;

      // Check cache first
      if (this.forecastCache.has(hour)) {
        const cached = this.forecastCache.get(hour);
        updatePredictionUI(cached);
        return;
      }

      // Try fetching from backend API
      try {
        const res = await fetch(`/api/prediction/v1/forecast?hour=${hour}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.success) {
            this.forecastCache.set(hour, json);
            updatePredictionUI(json);
            return;
          }
        }
      } catch {
        // Fallback to local mathematical model if offline or error
      }

      // Local mathematical heuristic fallback
      const isPeakMorning = (hour >= 6 && hour <= 9);
      const isPeakEvening = (hour >= 16 && hour <= 19);
      const isNight = (hour >= 22 || hour <= 5);

      let speed = "32 km/jam";
      let prob = "45%";
      let risk = "Status: Beban Normal / Stabil";
      let tomorrowStatus = "Sedang";
      let rec = "Pertahankan siklus fase sinyal adaptif SITS standar.";

      if (isPeakMorning) {
        speed = "14 km/jam";
        prob = "88%";
        risk = "Status: High Risk Kemacetan (Pagi)";
        tomorrowStatus = "Tinggi";
        rec = "Aktifkan Koridor Hijau A. Yani - Wonokromo & Alihkan beban lalu lintas ke MERR.";
      } else if (isPeakEvening) {
        speed = "16 km/jam";
        prob = "92%";
        risk = "Status: High Risk Kemacetan (Sore)";
        tomorrowStatus = "Tinggi";
        rec = "Perpanjang fase Green Split simpang Darmo & Maksimalkan kapasitas lajur cepat.";
      } else if (isNight) {
        speed = "48 km/jam";
        prob = "12%";
        risk = "Status: Low Risk / Arus Lengang";
        tomorrowStatus = "Rendah";
        rec = "Modulasi lampu Flashing Amber (Hati-Hati) pada simpang sekunder.";
      }

      const fallbackData = {
        speed,
        probability: prob,
        riskLabel: risk,
        tomorrowStatus,
        recommendation: rec
      };

      this.forecastCache.set(hour, fallbackData);
      updatePredictionUI(fallbackData);
    };

    const updatePredictionUI = (data) => {
      if (sliderRiskLabel && data.riskLabel) {
        sliderRiskLabel.textContent = data.riskLabel;
      }
      if (predictSpeedVal && data.speed) {
        predictSpeedVal.textContent = data.speed;
      }
      if (predictProbVal && data.probability) {
        predictProbVal.textContent = data.probability;
      }
      if (predictRecText && data.recommendation) {
        predictRecText.textContent = data.recommendation;
      }
      if (predTomorrowStatus && data.tomorrowStatus) {
        predTomorrowStatus.textContent = data.tomorrowStatus;
      }
    };

    slider.addEventListener("input", (e) => {
      const hour = parseInt(e.target.value, 10) || 0;
      fetchOrComputeForecast(hour);
    });

    slider.addEventListener("change", () => {
      soundManager.play('click');
    });

    // Inisialisasi awal
    fetchOrComputeForecast(parseInt(slider.value, 10) || 8);
  }

  /**
   * 3. Traffic Trends Segmented Tabs & SVG Spline Morphing
   */
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

  /**
   * 4. Form Konfigurasi Target ESG (#esgConfigForm)
   */
  _bindEsgTargetConfig() {
    const form = document.getElementById("esgConfigForm");
    const input = document.getElementById("esgCo2TargetInput");
    const progressFill = document.getElementById("esgProgressFill");
    const progressText = document.getElementById("esgProgressText");

    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const targetVal = Math.max(500, parseInt(input?.value, 10) || 2000);
      const currentSavedCo2 = 1420; // baseline SITS Surabaya reduction
      const percentage = Math.min(100, Math.round((currentSavedCo2 / targetVal) * 100));

      if (progressFill) {
        progressFill.style.width = `${percentage}%`;
      }
      if (progressText) {
        progressText.textContent = `${percentage}%`;
      }

      soundManager.play('success');
      if (typeof window.showToast === "function") {
        window.showToast(`🌱 Target reduksi CO₂ diperbarui: ${targetVal.toLocaleString('id-ID')} kg/hari (Progres: ${percentage}%).`);
      }
    });
  }

  /**
   * 5. Kalkulator Simulasi Dampak ESG & Penghematan BBM (#esgSignalOptSlider)
   */
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

    slider.addEventListener("change", () => {
      soundManager.play('click');
    });

    // Inisialisasi awal
    recalculate(parseInt(slider.value, 10) || 24);
  }
}

export const analyticsController = new AnalyticsController();
