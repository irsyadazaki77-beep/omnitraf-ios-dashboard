/**
 * OmniTRAF Surabaya - Adaptive Traffic Engine Configuration
 * Nilai batas kendali lampu lalu lintas (Green Split), siklus adaptif ATCS,
 * serta parameter darurat Kota Surabaya.
 */

export const TRAFFIC_LIMITS = {
  MIN_GREEN_SPLIT: 15, // Detik minimal fase hijau untuk keselamatan pejalan kaki
  MAX_GREEN_SPLIT: 90, // Detik maksimal fase hijau batas kejenuhan
  DEFAULT_GREEN_SPLIT: 35, // Nilai baku Simpang Wonokromo
  YELLOW_DURATION: 3,  // Standar durasi lampu kuning SITS
  ALL_RED_CLEARANCE: 2, // Waktu pembersihan simpang (semua merah)
  MIN_CYCLE_LENGTH: 60,
  MAX_CYCLE_LENGTH: 150
};

export const APILL_PHASES = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red"
};

// Level of Service (LOS) berdasarkan delay rata-rata per kendaraan (PKJI / HCM)
export const LEVEL_OF_SERVICE = {
  A: { maxDelay: 10, label: "Sangat Lancar", color: "#22c55e" },
  B: { maxDelay: 20, label: "Lancar", color: "#10b981" },
  C: { maxDelay: 35, label: "Ramai Lancar", color: "#eab308" },
  D: { maxDelay: 55, label: "Padat Terkendali", color: "#f97316" },
  E: { maxDelay: 80, label: "Padat Merayap", color: "#ef4444" },
  F: { maxDelay: Infinity, label: "Macet Total / Gridlock", color: "#b91c1c" }
};

export const SSE_CONFIG = {
  ENDPOINT: "/api/stream-traffic",
  RECONNECT_INTERVAL_MS: 3000,
  POLL_FALLBACK_INTERVAL_MS: 1500
};

export const CHAOS_MODE_CONFIG = {
  MAX_LEVEL: 4,
  RESOLUTION_STEP_MS: 2800,
  GRIDLOCK_SPEED_KMH: 4,
  SURGE_WAIT_TIME_SECONDS: 118,
  GLITCH_FREQUENCY_PCT: 85
};

export const EMERGENCY_CORRIDORS = {
  SOETOMO: {
    id: "route-soetomo",
    name: "Jalur Cepat RSU Dr. Soetomo",
    nodes: ["node-margorejo", "node-wonokromo", "node-darmo", "node-diponegoro"],
    lockPhase: APILL_PHASES.GREEN
  }
};
