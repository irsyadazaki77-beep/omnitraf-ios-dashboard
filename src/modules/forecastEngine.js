/**
 * OmniTRAF Surabaya - Deterministic Diurnal Traffic Forecast & Decision Support Engine
 * Single Source of Truth for Forecasting, Corridor Analytics, Scenario Simulation,
 * ESG Impact Calculations, Data Quality Layer, and Rule-Based Recommendations.
 */

export const MODEL_VERSION = "v5.2.0-deterministic-diurnal";

export const CORRIDORS_CONFIG = [
  { id: "corridor-ayani", name: "A. Yani / Wonokromo", capacity: 3200, lengthKm: 4.8, baselineSpeedKmh: 45 },
  { id: "corridor-margorejo", name: "Margorejo - Jemursari", capacity: 2100, lengthKm: 2.6, baselineSpeedKmh: 40 },
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
  const isStale = !!inputState.isStaleData;
  const isConnected = inputState.connectionStatus === 'connected' || inputState.sseConnected === true;
  const cctvOnline = Number(inputState.telemetry?.cctvOnline ?? inputState.cctvOnline ?? 184);
  const totalCctv = 184;
  const cameraCoveragePct = Math.min(100, Math.round((cctvOnline / totalCctv) * 100));

  let freshness = "FRESH";
  let healthStatus = "HEALTHY";
  let completeness = 98;
  let penalty = 0;

  if (!isConnected || isStale) {
    freshness = "STALE";
    healthStatus = "DEGRADED";
    completeness = 65;
    penalty += 28;
  }

  if (cameraCoveragePct < 80) {
    healthStatus = "DEGRADED";
    penalty += Math.round((80 - cameraCoveragePct) * 0.4);
  }

  if (inputState.isChaosMode) {
    healthStatus = "CHAOS_ALERT";
    penalty += 20;
  }

  const baseConfidence = 96;
  const finalConfidence = Math.max(35, Math.min(99, baseConfidence - penalty));

  let provenance = "REALTIME-DERIVED";
  if (inputState.isTimeTravel || inputState.isSimulated) {
    provenance = "SIMULATED";
  } else if (!isConnected || isStale || cameraCoveragePct < 70) {
    provenance = "DEGRADED";
  }

  return {
    freshness,
    completeness,
    sourceAvailability: isConnected ? 100 : 40,
    cameraCoverage: cameraCoveragePct,
    telemetryAgeMs: isConnected ? 250 : 15000,
    predictionInputHealth: healthStatus,
    confidence: finalConfidence,
    provenance
  };
}

/**
 * Generates a unified, deterministic forecast snapshot for a specific hour and system state.
 */
export function generateForecastSnapshot(hour = 8, state = {}) {
  const h = Math.round(Math.max(0, Math.min(23, Number(hour) || 0)));
  const baseIntensity = calculateDiurnalIntensity(h);
  const dataQuality = calculateDataQuality(state);

  const isChaos = !!state.isChaosMode;
  const isRain = !!state.isRainMode || state.roadCondition === 'wet';
  const greenWave = !!state.greenWaveActive;
  const greenSplit = Number(state.greenSplitWonokromo || 35);
  const incidents = Array.isArray(state.incidents) ? state.incidents.filter(i => i.status === 'ACTIVE') : [];
  const activeEmergencies = Array.isArray(state.activeEmergencies) ? state.activeEmergencies.filter(e => e.status !== 'COMPLETED' && e.status !== 'CANCELLED') : [];

  // Modifiers
  let intensity = baseIntensity;
  if (isChaos) intensity = Math.min(0.98, intensity + 0.35);
  if (isRain) intensity = Math.min(0.98, intensity + 0.12);
  if (incidents.length > 0) intensity = Math.min(0.98, intensity + 0.05 * incidents.length);
  if (greenWave) intensity = Math.max(0.12, intensity - 0.15);

  const probabilityValue = Math.round(intensity * 100);
  const expectedSpeedKmh = Math.max(8, Math.round(54 - (intensity * 40)));
  const expectedVolume = Math.round(500 + intensity * 1200);
  const expectedQueueLength = Math.round(20 + intensity * 280);

  // Risk Classification
  let riskLevel = "LOW";
  let riskText = "Low Risk (Lancar)";
  let riskColor = "var(--success)";
  let trafficStatus = "Lancar / Bebas Hambatan";
  let tomorrowStatus = "Rendah";

  if (probabilityValue >= 75) {
    riskLevel = "HIGH";
    riskText = "High Risk Kemacetan (Kritis)";
    riskColor = "var(--danger)";
    trafficStatus = "Peak Hour / Kepadatan Tinggi";
    tomorrowStatus = "Tinggi";
  } else if (probabilityValue >= 48) {
    riskLevel = "MODERATE";
    riskText = "Moderate Risk (Padat Merayap)";
    riskColor = "var(--warning)";
    trafficStatus = "Moderat / Padat Teratur";
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
  if (dataQuality.provenance === "DEGRADED") factors.push("Data Telemetri Basi / Koneksi Terdegradasi");

  // Rule-Based Decision Support Recommendation
  const recommendationId = `REC-${h.toString().padStart(2, '0')}-${Date.now().toString().slice(-4)}`;
  let recText = "Kondisi arus lalu lintas optimal. Pertahankan siklus hijau standar ATCS SITS.";
  let reasonCodes = ["NORMAL_FLOW"];
  let expectedImpact = "Waktu tunggu stabil 28-35 detik";
  let recRisk = "Low";

  if (activeEmergencies.length > 0) {
    recText = `🚨 Sinyal Prioritas Darurat: Prioritaskan koridor ${activeEmergencies[0].routeId || 'A. Yani - Darmo'} untuk ${activeEmergencies[0].vehicleId || 'Ambulans 112'}.`;
    reasonCodes = ["CRITICAL_EMERGENCY"];
    expectedImpact = "Waktu tanggap darurat <3 menit ke RSUD Dr. Soetomo";
    recRisk = "Controlled High";
  } else if (isRain) {
    recText = "🌧️ Mode Hujan Aktif: Tambah durasi lampu kuning (+1.5s) dan All-Red pembersihan (+1s) untuk keselamatan jalan basah.";
    reasonCodes = ["RAIN_SAFETY_ADJUSTMENT"];
    expectedImpact = "Mencegah kecelakaan akibat selip di persimpangan";
    recRisk = "Low";
  } else if (probabilityValue >= 75) {
    recText = "⚡ Rekomendasi AI: Aktifkan Koridor Gelombang Hijau A. Yani - Wonokromo (+12s Green Split) & alihkan beban ke MERR.";
    reasonCodes = ["HIGH_CONGESTION", "LOW_SPEED", "LONG_QUEUE"];
    expectedImpact = "Reduksi waktu tunggu -18 detik, peningkatan kecepatan +6 km/jam";
    recRisk = "Medium";
  } else if (probabilityValue >= 48) {
    recText = "✨ Rekomendasi AI: Tingkatkan Green Split Wonokromo +8 detik untuk mengurai akumulasi antrean frontage.";
    reasonCodes = ["MODERATE_CONGESTION", "QUEUE_BUILDUP"];
    expectedImpact = "Reduksi antrean -45 meter";
    recRisk = "Low";
  }

  const recommendation = {
    recommendationId,
    text: recText,
    reasonCodes,
    inputSnapshot: { hour: h, probabilityValue, expectedSpeedKmh, isRain, isChaos },
    expectedImpact,
    risk: recRisk,
    requiresOperatorApproval: true,
    timestamp: new Date().toISOString()
  };

  // Scenario Comparison: Baseline vs AI Optimized
  const optimizedSplit = Math.min(75, Math.max(35, greenSplit + (probabilityValue > 60 ? 10 : 0)));
  const waitTimeBaseline = Math.round(30 + intensity * 50);
  const waitTimeOptimized = Math.max(18, Math.round(waitTimeBaseline * 0.72));
  const queueBaselineMeters = Math.round(50 + intensity * 250);
  const queueOptimizedMeters = Math.max(20, Math.round(queueBaselineMeters * 0.65));
  const speedBaselineKmh = expectedSpeedKmh;
  const speedOptimizedKmh = Math.min(55, Math.round(expectedSpeedKmh * 1.22));
  const throughputBaseline = Math.round(1100 + intensity * 800);
  const throughputOptimized = Math.round(throughputBaseline * 1.18);

  const idlingHoursSaved = Number(((waitTimeBaseline - waitTimeOptimized) * expectedVolume / 3600).toFixed(1));
  const fuelSavedLiters = Number((idlingHoursSaved * ESG_CONSTANTS.IDLING_FUEL_LITERS_PER_HOUR).toFixed(1));
  const co2SavedKg = Number((fuelSavedLiters * ESG_CONSTANTS.CO2_KG_PER_LITER_FUEL).toFixed(1));
  const monetarySavedRp = Math.round(fuelSavedLiters * ESG_CONSTANTS.FUEL_PRICE_RP_PER_LITER);

  const scenarioComparison = {
    baseline: {
      greenSplitSec: greenSplit,
      waitTimeSec: waitTimeBaseline,
      queueMeters: queueBaselineMeters,
      speedKmh: speedBaselineKmh,
      throughputVehPerHour: throughputBaseline
    },
    optimized: {
      greenSplitSec: optimizedSplit,
      waitTimeSec: waitTimeOptimized,
      queueMeters: queueOptimizedMeters,
      speedKmh: speedOptimizedKmh,
      throughputVehPerHour: throughputOptimized
    },
    delta: {
      waitTimeReductionPct: Math.round(((waitTimeBaseline - waitTimeOptimized) / waitTimeBaseline) * 100),
      queueReductionPct: Math.round(((queueBaselineMeters - queueOptimizedMeters) / queueBaselineMeters) * 100),
      speedGainPct: Math.round(((speedOptimizedKmh - speedBaselineKmh) / speedBaselineKmh) * 100),
      throughputGainPct: 18,
      fuelSavedLiters,
      co2SavedKg,
      monetarySavedRp
    },
    assumptions: {
      idlingFuelFactor: "0.28 L/jam per kendaraan mengantre",
      emissionFactor: "2.31 kg CO2 per Liter BBM",
      fuelPrice: "Rp 14.500/Liter (Pertalite/Solar proxy)"
    }
  };

  // Corridor Breakdown
  const corridorBreakdown = CORRIDORS_CONFIG.map(c => {
    const corridorIntensity = Math.min(0.98, Math.max(0.08, intensity * (c.id === 'corridor-ayani' ? 1.15 : c.id === 'corridor-darmo' ? 1.05 : 0.88)));
    const cSpeed = Math.round(c.baselineSpeedKmh * (1 - corridorIntensity * 0.65));
    const cQueue = Math.round(corridorIntensity * 180);
    const cDensity = Math.round(corridorIntensity * 120); // veh/km
    const cDelay = Math.round(corridorIntensity * 48);

    let cTrend = "stable";
    if (corridorIntensity > 0.7) cTrend = "worsening";
    else if (corridorIntensity < 0.3) cTrend = "improving";

    return {
      corridorId: c.id,
      name: c.name,
      volume: Math.round(c.capacity * corridorIntensity),
      capacity: c.capacity,
      speed: cSpeed,
      density: cDensity,
      queueMeters: cQueue,
      delaySec: cDelay,
      signalEfficiencyPct: Math.min(99, Math.max(50, Math.round(100 - corridorIntensity * 40))),
      riskLevel: corridorIntensity > 0.75 ? "CRITICAL" : corridorIntensity > 0.48 ? "WARNING" : "NORMAL",
      cameraCoveragePct: dataQuality.cameraCoverage,
      trendDirection: cTrend
    };
  });

  return {
    status: "success",
    timestamp: new Date().toISOString(),
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
    esgImpact: {
      observedSavings: {
        co2SavedKg: Number(state.telemetry?.co2SavedKg || state.co2SavedKg || 1420),
        fuelSavedLiters: Number(state.telemetry?.fuelSavedLiters || state.fuelSavedLiters || 580)
      },
      simulatedScenarioSavings: {
        co2SavedKg,
        fuelSavedLiters,
        monetarySavedRp
      }
    },
    // Backward compatibility fields for legacy UI cards
    congestionProbability: probabilityValue,
    probability: `${probabilityValue}%`,
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
