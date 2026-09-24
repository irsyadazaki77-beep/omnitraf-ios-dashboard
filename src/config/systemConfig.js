/**
 * OmniTRAF Surabaya - Central System Configuration
 * Konfigurasi terpusat untuk API endpoints, metrik default dashboard,
 * batas ambang sensor, dan parameter operasional SITS Kota Surabaya.
 */

export const SYSTEM_CONFIG = {
  APP_NAME: "OmniTRAF Surabaya SITS",
  VERSION: "2.4.0-PROD",
  AUTHORITY: "Dinas Perhubungan Pemerintah Kota Surabaya",
  UPTD: "UPTD SITS Command Center Surabaya",
  TIMEZONE: "Asia/Jakarta",

  API: {
    STREAM_TRAFFIC: "/api/stream-traffic",
    PREDICTION_FORECAST: "/api/prediction/v1/forecast",
    DEVICE_PING: "/api/devices/ping",
    DEVICE_CONFIG: "/api/devices/config",
    INCIDENT_RESOLVE: "/api/incidents/:id/resolve",
    TERMINAL_EXEC: "/api/terminal/execute",
    SITS_TELEMETRY: "/sits/api/v1/telemetry"
  },

  DEFAULT_METRICS: {
    CONGESTION_INDEX: 58,
    AVG_WAIT_TIME_SEC: 42,
    CO2_SAVED_KG: 1420,
    FUEL_SAVED_LITERS: 580,
    VEHICLES_TODAY: 128540,
    SITS_UPTIME_PCT: 99.4,
    CCTV_ONLINE_COUNT: 184,
    IOT_SENSORS_COUNT: 312,
    DEFAULT_ESG_TARGET_KG: 2000
  },

  CORRIDOR_PRESETS: [
    {
      id: "yani-wonokromo",
      name: "Jl. Ahmad Yani - Wonokromo",
      baseSpeed: 38,
      peakLoad: 94
    },
    {
      id: "darmo-basra",
      name: "Jl. Raya Darmo - Basuki Rahmat",
      baseSpeed: 42,
      peakLoad: 89
    },
    {
      id: "merr-soekarno",
      name: "Koridor MERR (Dr. Ir. H. Soekarno)",
      baseSpeed: 45,
      peakLoad: 84
    },
    {
      id: "mayjend-hr",
      name: "Jl. Mayjend Sungkono - HR Muhammad",
      baseSpeed: 34,
      peakLoad: 86
    }
  ]
};
