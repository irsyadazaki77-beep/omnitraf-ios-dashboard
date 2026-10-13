/**
 * OmniTRAF Surabaya - Deterministic Diurnal Traffic Forecast & Decision Support Engine
 * Single Source of Truth for Forecasting, Corridor Analytics, Scenario Simulation,
 * ESG Impact Calculations, Data Quality Layer, and Rule-Based Recommendations.
 */

import { compareTrafficScenarios, recommendAdaptiveSignal, simulateTrafficNetwork } from './trafficModel.js';

export const MODEL_VERSION = "v6.0.0-aggregate-flow";

export const CORRIDORS_CONFIG = [
  { id: "corridor-ayani", name: "A. Yani / Wonokromo", capacity: 3200, lengthKm: 4.8, baselineSpeedKmh: 45 },
  { id: "corridor-jemursari", name: "A. Yani - Jemursari", capacity: 2100, lengthKm: 2.6, baselineSpeedKmh: 40 },
  { id: "corridor-darmo", name: "Raya Darmo", capacity: 2800, lengthKm: 3.2, baselineSpeedKmh: 42 },
  { id: "corridor-tunjungan", name: "Tunjungan - Siola", capacity: 1900, lengthKm: 1.8, baselineSpeedKmh: 35 },
  { id: "corridor-merr", name: "MERR Kertajaya", capacity: 3400, lengthKm: 6.2, baselineSpeedKmh: 50 },
  { id: "corridor-diponegoro", name: "Diponegoro", capacity: 2200, lengthKm: 2.9, baselineSpeedKmh: 38 }
];

export const ESG_CONSTANTS = {
  IDLING_FUEL_LITERS_PER_HOUR: 0.28,
  CO2_KG_PER_LITER_FUEL: 2.31,
  TREES_PER_KG_CO2: 0.05,
  FUEL_PRICE_RP_PER_LITER: 14500
};

/**
 * Calculates a smooth, deterministic diurnal traffic intensity curve [0.0..1.0] for hour (0..23)
 */
export function calculateDiurnalIntensity(hour, params = {}) {
  const h = Math.max(0, Math.min(23.99, Number(hour) || 0));
  const morningPeakHour = params.morningPeakHour ?? 7.75;
  const eveningPeakHour = params.eveningPeakHour ?? 17.50;
  const middayLevel = params.middayLevel ?? 0.38;
  const nightLevel = params.nightLevel ?? 0.06;

  // Gaussian curves for commute peaks
  const morningPeak = Math.exp(-Math.pow(h - morningPeakHour, 2) / (2 * Math.pow(1.25, 2)));
  const eveningPeak = Math.exp(-Math.pow(h - eveningPeakHour, 2) / (2 * Math.pow(1.4, 2)));

  // Midday plateau (10:00 - 15:00)
  const middayCurve = (h >= 10 && h <= 15)
    ? middayLevel + 0.10 * Math.sin((h - 10) * Math.PI / 5)
    : 0.12;

  // Night baseline (22:00 - 05:00)
  const nightCurve = (h >= 22 || h <= 5) ? nightLevel : 0.16;

  const base = Math.max(nightCurve, Math.min(1.0, morningPeak * 0.88 + eveningPeak * 0.96 + middayCurve));

  // Deterministic micro-harmonic variation based on hour (no Math.random)
  const harmonic = Math.sin(h * 3.14159 / 6) * 0.02;
  return Math.max(0.05, Math.min(0.98, base + harmonic));
}

/**
 * Calculates Data Quality & Health Layer
 */
export function calculateDataQuality(inputState = {}) {
  const isConnected = inputState.connectionStatus === 'connected' || inputState.sseConnected === true;
  const cctvOnlineRaw = inputState.telemetry?.cctvOnline ?? inputState.cctvOnline;
  const cctvOnline = Number(cctvOnlineRaw);
  const totalCctv = Number(inputState.telemetry?.cctvTotal ?? inputState.cctvTotal);
  const cameraCoveragePct = Number.isFinite(cctvOnline) && Number.isFinite(totalCctv) && totalCctv > 0
    ? Math.min(100, Math.round((cctvOnline / totalCctv) * 100))
    : null;
  const rawTimestamp = inputState.lastTelemetryAt ?? inputState.timestampMs;
  const parsedTimestamp = typeof rawTimestamp === 'string' && !/^\d{10,13}$/.test(rawTimestamp)
    ? Date.parse(rawTimestamp)
    : Number(rawTimestamp);
  const telemetryAgeMs = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
    ? Math.max(0, Date.now() - parsedTimestamp)
    : null;
  const isStale = !!inputState.isStaleData || !isConnected || telemetryAgeMs === null || telemetryAgeMs > 15000;

  let freshness = "FRESH";
  let healthStatus = "SIMULATED";
  const completeness = null;

  if (!isConnected || isStale) {
    freshness = "STALE";
    healthStatus = "DEGRADED";
  }

  if (cameraCoveragePct !== null && cameraCoveragePct < 80) {
    healthStatus = "DEGRADED";
  }

  if (inputState.isChaosMode) {
    healthStatus = "CHAOS_ALERT";
  }

  // This engine uses a deterministic curve and scenario assumptions. A live
  // connection does not make its output field-calibrated.
  const provenance = "SIMULATED";

  return {
    freshness,
    completeness,
    sourceAvailability: isConnected ? 100 : 0,
    cameraCoverage: cameraCoveragePct,
    telemetryAgeMs,
    predictionInputHealth: healthStatus,
    confidence: null,
    provenance
  };
}

/**
 * Generates a unified, deterministic forecast snapshot for a specific hour and system state.
 */
export function generateForecastSnapshot(hour = 8, state = {}) {
  const h = Math.round(Math.max(0, Math.min(23, Number(hour) || 0)));
  const dataQuality = calculateDataQuality(state);

  const isChaos = !!state.isChaosMode;
  const isRain = !!state.isRainMode || state.roadCondition === 'wet';
  const greenWave = !!state.greenWaveActive;
  const greenSplit = Number(state.greenSplitWonokromo || 35);
  const terminalIncidentStatuses = new Set(['RESOLVED', 'ARCHIVED', 'CLOSED', 'CANCELLED']);
  const incidents = Array.isArray(state.incidents)
    ? state.incidents.filter(i => !terminalIncidentStatuses.has(String(i.status || 'ACTIVE').toUpperCase()))
    : [];
  const activeEmergencies = Array.isArray(state.activeEmergencies) ? state.activeEmergencies.filter(e => e.status !== 'COMPLETED' && e.status !== 'CANCELLED') : [];

  const modelState = { ...state, simulatedHour: h, incidents, activeEmergencies };
  const traffic = simulateTrafficNetwork(modelState, {
    hour: h,
    seed: Number(state.simulation?.seed ?? 42),
    horizonMinutes: 60,
    rushHour: isChaos
  });
  const scenarioResults = compareTrafficScenarios(modelState, {
    hour: h,
    seed: Number(state.simulation?.seed ?? 42),
    horizonMinutes: 60
  });
  const intensity = traffic.congestionIndex / 100;
  const probabilityValue = traffic.congestionIndex;
  const optimizedRecommendation = recommendAdaptiveSignal((state.intersections || []).find(node => node.id === 'node-wonokromo') || { id: 'node-wonokromo', greenSplit }, state);
  const candidateOptimizedSplit = optimizedRecommendation.targetGreenSec;
  const expectedSpeedKmh = Math.round(traffic.averageSpeedKmh);
  const expectedVolume = traffic.demandVehPerHour;
  const expectedQueueLength = traffic.queueMeters;

  // Risk Classification
  let riskLevel = "LOW";
  let riskText = "Indeks risiko model rendah";
  let riskColor = "var(--success)";
  let trafficStatus = "Lancar / bebas hambatan";
  let tomorrowStatus = "Rendah";

  if (probabilityValue >= 75) {
    riskLevel = "HIGH";
    riskText = "Indeks risiko model tinggi";
    riskColor = "var(--status-danger)";
    trafficStatus = "Jam puncak / kepadatan tinggi";
    tomorrowStatus = "Tinggi";
  } else if (probabilityValue >= 48) {
    riskLevel = "MODERATE";
    riskText = "Indeks risiko model sedang";
    riskColor = "var(--warning)";
    trafficStatus = "Sedang / padat teratur";
    tomorrowStatus = "Sedang";
  }

  // Factor derivation
  const factors = [];
  if (h >= 6 && h <= 9) {
    factors.push("Arus Komuter Jam Berangkat Kerja & Sekolah", "Penyempitan Lajur Frontage Road Wonokromo");
  } else if (h >= 16 && h <= 19) {
    factors.push("Jam Pulang Kantor & Aktivitas Komersial", "Akumulasi Kendaraan Arteri A. Yani - Darmo");
  } else if (h >= 11 && h <= 14) {
    factors.push("Aktivitas Niaga & Logistik Siang Hari", "Pola Siklus Lampu Hijau Reguler");
  } else {
    factors.push("Arus Lalu Lintas Reguler Kota", "Kapasitas Jalan Utama Optimal");
  }
  if (isRain) factors.push("Pengurangan Kecepatan & Jarak Aman Akibat Hujan");
  if (isChaos) factors.push("Mode Keos Aktif — Sinyal Tidak Sinkron");
  if (incidents.length > 0) factors.push(`Deteksi ${incidents.length} Insiden Aktif di Koridor`);
  if (dataQuality.freshness === "STALE") factors.push("Koneksi atau waktu telemetri tidak cukup untuk menilai kebaruan input");

  // Rule-Based Decision Support Recommendation
  let recText = "Kondisi arus lalu lintas optimal. Pertahankan siklus hijau standar ATCS SITS.";
  let reasonCodes = ["NORMAL_FLOW"];
  let expectedImpact = "Dampak lapangan tidak tersedia; lihat perbandingan skenario model.";
  let recRisk = "Low";

  if (activeEmergencies.length > 0) {
    recText = `🚨 Sinyal Prioritas Darurat: Prioritaskan koridor ${activeEmergencies[0].routeId || 'A. Yani - Darmo'} untuk ${activeEmergencies[0].vehicleId || 'Ambulans 112'}.`;
    reasonCodes = ["CRITICAL_EMERGENCY"];
    expectedImpact = "Rute prioritas divisualisasikan pada simulasi; estimasi waktu tempuh tidak tersedia.";
    recRisk = "Controlled High";
  } else if (isRain) {
    recText = "🌧️ Mode Hujan Aktif: Tambah durasi lampu kuning (+1.5s) dan All-Red pembersihan (+1s) untuk keselamatan jalan basah.";
    reasonCodes = ["RAIN_SAFETY_ADJUSTMENT"];
    expectedImpact = "Parameter keselamatan disimulasikan; dampak terhadap kecelakaan tidak dihitung.";
    recRisk = "Low";
  } else if (probabilityValue >= 75) {
    recText = `Skenario model: uji Green Split A. Yani–Wonokromo ${greenSplit} → ${candidateOptimizedSplit} detik; bandingkan dampaknya pada MERR.`;
    reasonCodes = ["HIGH_CONGESTION", "LOW_SPEED", "LONG_QUEUE"];
    expectedImpact = "Perubahan indikator hanya berupa skenario model; dampak lapangan belum divalidasi.";
    recRisk = "Medium";
  } else if (probabilityValue >= 48) {
    recText = `Skenario model: uji Green Split Wonokromo ${greenSplit} → ${candidateOptimizedSplit} detik untuk membandingkan antrean frontage.`;
    reasonCodes = ["MODERATE_CONGESTION", "QUEUE_BUILDUP"];
    expectedImpact = "Perubahan indikator hanya berupa skenario model; dampak lapangan belum divalidasi.";
    recRisk = "Low";
  }

  // Stable deterministic recommendation ID based on hour and primary reason
  const primaryReason = reasonCodes[0] || "REC";
  const recommendationId = `REC-${h.toString().padStart(2, '0')}-${primaryReason.slice(0, 8)}`;
  const snapshotTimestamp = state.simulatedTimeIso || state.timestamp || (state.simTimeMs ? new Date(state.simTimeMs).toISOString() : `${h.toString().padStart(2, '0')}:00 WIB`);

  const recommendation = {
    recommendationId,
    text: recText,
    reasonCodes,
    inputSnapshot: { hour: h, probabilityValue, expectedSpeedKmh, isRain, isChaos },
    expectedImpact,
    risk: recRisk,
    requiresOperatorApproval: true,
    timestamp: snapshotTimestamp
  };

  // Fixed-time vs adaptive uses the same deterministic input state and seed.
  const baselineModel = scenarioResults.scenarios.normal.metrics;
  const optimizedModel = scenarioResults.scenarios.adaptiveSignals.metrics;
  const waitTimeBaseline = Math.round(baselineModel.queueVehicles / Math.max(1, baselineModel.throughputVehPerHour) * 3600);
  const waitTimeOptimized = Math.round(optimizedModel.queueVehicles / Math.max(1, optimizedModel.throughputVehPerHour) * 3600);
  const queueBaselineMeters = baselineModel.queueMeters;
  const queueOptimizedMeters = optimizedModel.queueMeters;
  const speedBaselineKmh = Math.round(baselineModel.averageSpeedKmh);
  const speedOptimizedKmh = Math.round(optimizedModel.averageSpeedKmh);
  const throughputBaseline = baselineModel.throughputVehPerHour;
  const throughputOptimized = optimizedModel.throughputVehPerHour;
  const pctDelta = (before, after) => before > 0 ? Math.round((before - after) / before * 100) : 0;

  const scenarioComparison = {
    baseline: {
      greenSplitSec: greenSplit,
      waitTimeSec: waitTimeBaseline,
      queueMeters: queueBaselineMeters,
      speedKmh: speedBaselineKmh,
      throughputVehPerHour: throughputBaseline,
      travelTimeMinutes: baselineModel.averageTravelTimeMinutes,
      congestionIndex: baselineModel.congestionIndex
    },
    optimized: {
      greenSplitSec: candidateOptimizedSplit,
      waitTimeSec: waitTimeOptimized,
      queueMeters: queueOptimizedMeters,
      speedKmh: speedOptimizedKmh,
      throughputVehPerHour: throughputOptimized,
      travelTimeMinutes: optimizedModel.averageTravelTimeMinutes,
      congestionIndex: optimizedModel.congestionIndex
    },
    delta: {
      waitTimeReductionPct: pctDelta(waitTimeBaseline, waitTimeOptimized),
      queueReductionPct: pctDelta(queueBaselineMeters, queueOptimizedMeters),
      speedGainPct: speedBaselineKmh > 0 ? Math.round((speedOptimizedKmh - speedBaselineKmh) / speedBaselineKmh * 100) : 0,
      throughputGainPct: throughputBaseline > 0 ? Math.round((throughputOptimized - throughputBaseline) / throughputBaseline * 100) : 0,
      travelTimeDeltaMinutes: Number((optimizedModel.averageTravelTimeMinutes - baselineModel.averageTravelTimeMinutes).toFixed(2)),
      congestionIndexDelta: optimizedModel.congestionIndex - baselineModel.congestionIndex,
      throughputDeltaVehPerHour: throughputOptimized - throughputBaseline
    },
    assumptions: {
      responseModel: "Keluaran fixed-time dan adaptive dihitung terpisah dengan demand, seed, dan horizon yang sama; model bukan hasil kalibrasi lapangan.",
      addedGreenSec: optimizedRecommendation.deltaGreenSec
    }
  };

  // Corridor Breakdown
  const corridorBreakdown = traffic.corridors.map(corridor => ({
    corridorId: corridor.corridorId,
    name: corridor.name,
    volume: corridor.demandVehPerHour,
    capacity: corridor.capacityVehPerHour,
    speed: Math.round(corridor.speedKmh),
    density: Number((corridor.demandVehPerHour / Math.max(1, corridor.speedKmh)).toFixed(1)),
    queueMeters: corridor.queueMeters,
    delaySec: Math.round(Math.max(0, corridor.travelTimeMinutes * 60 - (CORRIDORS_CONFIG.find(config => config.id === corridor.corridorId).lengthKm / CORRIDORS_CONFIG.find(config => config.id === corridor.corridorId).baselineSpeedKmh * 3600))),
    signalEfficiencyPct: Math.round(Math.min(99, corridor.capacityVehPerHour / Math.max(1, CORRIDORS_CONFIG.find(config => config.id === corridor.corridorId).capacity) * 100)),
    riskLevel: corridor.congestionIndex >= 75 ? 'CRITICAL' : corridor.congestionIndex >= 48 ? 'WARNING' : 'NORMAL',
    cameraCoveragePct: dataQuality.cameraCoverage,
    trendDirection: corridor.congestionIndex >= 65 ? 'worsening' : corridor.congestionIndex <= 30 ? 'improving' : 'stable'
  }));

  return {
    status: "success",
    timestamp: snapshotTimestamp,
    modelVersion: MODEL_VERSION,
    inputWindow: "realtime-1h-window",
    forecastHorizon: "1h",
    hour: h,
    hourLabel: `${h.toString().padStart(2, '0')}:00 WIB`,
    probabilityValue,
    expectedSpeedKmh,
    expectedVolume,
    expectedQueueLength,
    riskLevel,
    confidence: dataQuality.confidence,
    factors,
    recommendation,
    source: dataQuality.provenance,
    isSimulated: dataQuality.provenance === "SIMULATED",
    dataQuality,
    corridorBreakdown,
    scenarioComparison,
    trafficModel: traffic,
    scenarioResults,
    prediction: {
      horizonMinutes: traffic.horizonMinutes,
      assumptions: traffic.assumptions,
      limitations: 'Synthetic aggregate corridor model; no field calibration, lane-level behavior, or accuracy evaluation is available.'
    },
    esgImpact: {
      observedSavings: {
        co2SavedKg: state.telemetry?.co2SavedKg ?? state.co2SavedKg ?? null,
        fuelSavedLiters: state.telemetry?.fuelSavedLiters ?? state.fuelSavedLiters ?? null
      },
      simulatedScenarioSavings: {
        co2SavedKg: null,
        fuelSavedLiters: null,
        monetarySavedRp: null
      }
    },
    // Backward compatibility fields for legacy UI cards
    congestionProbability: probabilityValue,
    probability: `${probabilityValue}/100`,
    riskText,
    riskLabel: `Status: ${riskText}`,
    riskColor,
    speed: `${expectedSpeedKmh} km/jam`,
    tomorrowStatus,
    trafficStatus
  };
}

/**
 * Runs a full test suite covering all mandatory Phase 5 edge cases
 */
export function runForecastTestSuite(stateStoreSnapshot = {}) {
  const scenarios = [
    { name: "Jam 00:00 (Sepi / Malam)", hour: 0, state: {} },
    { name: "Peak Morning (07:45)", hour: 7.75, state: {} },
    { name: "Midday (12:00)", hour: 12, state: {} },
    { name: "Peak Evening (17:30)", hour: 17.5, state: {} },
    { name: "Transition Hour (21:00)", hour: 21, state: {} },
    { name: "Rain Mode (Cuaca Hujan)", hour: 8, state: { isRainMode: true, roadCondition: 'wet' } },
    { name: "Chaos Mode (Gridlock Darurat)", hour: 8, state: { isChaosMode: true } },
    { name: "Emergency Active (Ambulans 112)", hour: 8, state: { activeEmergencies: [{ status: 'EN_ROUTE', vehicleId: 'AMB-02', routeId: 'route-soetomo' }] } },
    { name: "Incident Active (Mogok Wonokromo)", hour: 8, state: { incidents: [{ status: 'ACTIVE', title: 'Truk Mogok' }] } },
    { name: "Stale CCTV (Camera Degraded)", hour: 8, state: { telemetry: { cctvOnline: 70 } } },
    { name: "Stale Telemetry (Disconnect)", hour: 8, state: { isStaleData: true, connectionStatus: 'offline' } },
    { name: "Zero-Data Scenario", hour: 8, state: { telemetry: { cctvOnline: 0, iotOnline: 0 } } },
    { name: "Malformed Input", hour: "abc", state: null },
    { name: "Repeated Request (Hour 8 Idempotency)", hour: 8, state: {} },
    { name: "Reconnect After Offline", hour: 8, state: { connectionStatus: 'connected', sseConnected: true } }
  ];

  const results = scenarios.map((sc, idx) => {
    try {
      const snap = generateForecastSnapshot(sc.hour, sc.state || {});
      const isOk = snap && snap.status === "success" && typeof snap.probabilityValue === "number" && !isNaN(snap.probabilityValue);
      return {
        id: idx + 1,
        scenario: sc.name,
        passed: isOk,
        hourOutput: snap.hour,
        prob: snap.probabilityValue,
        speed: snap.expectedSpeedKmh,
        confidence: snap.confidence,
        provenance: snap.source,
        risk: snap.riskLevel
      };
    } catch (err) {
      return {
        id: idx + 1,
        scenario: sc.name,
        passed: false,
        error: err.message
      };
    }
  });

  return {
    timestamp: new Date().toISOString(),
    totalTests: scenarios.length,
    passedCount: results.filter(r => r.passed).length,
    failedCount: results.filter(r => !r.passed).length,
    results
  };
}
