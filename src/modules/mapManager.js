/**
 * OmniTRAF Surabaya - Map Manager (Enterprise GIS Engine with Leaflet.js)
 * High-Performance Basemap, Marker Clustering, Z-Index/Map-Pane Management,
 * and 60 FPS Normalized Euclidean Distance Animation for Emergency Vehicles.
 */

import {
  SURABAYA_CENTER,
  SITS_INTERSECTIONS_GEOJSON,
  SURABAYA_CORRIDORS_GEOJSON,
  MINOR_ROADS_GEOJSON,
  KALIMAS_RIVER_GEOJSON,
  SURABAYA_DISTRICTS_GEOJSON,
  SURABAYA_INCIDENTS_GEOJSON,
  SURABAYA_LANDMARKS_GEOJSON,
  SITS_CCTV_CAMERAS_GEOJSON,
  EMERGENCY_PATHS_GEOJSON
} from '../config/surabayaCoords.js';
import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';

/**
 * Helper menghitung jarak Euclidean antar dua titik koordinat [lng, lat]
 * Digunakan untuk menormalisasi kecepatan marker kendaraan darurat di sepanjang segmen GeoJSON
 * @param {[number, number]} p1 - [lng, lat] titik awal
 * @param {[number, number]} p2 - [lng, lat] titik tujuan
 * @returns {number} Jarak geometris dalam derajat desimal
 */
function calculateDistance(p1, p2) {
  if (!p1 || !p2) return 0.00001;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Helper untuk membuat Tile Layer CartoDB berkinerja tinggi
 * @param {boolean} isDark - Apakah tema saat ini gelap
 * @returns {L.TileLayer} TileLayer instance
 */
function createCartoTileLayer(isDark) {
  // Menggunakan URL template standard tanpa {r} literal untuk mencegah error 404 pada layar non-retina
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

  return L.tileLayer(tileUrl, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> — SITS Surabaya GIS Engine',
    subdomains: 'abcd',
    maxZoom: 19,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 3
  });
}

/**
 * Robust helper to safely add multiple layers to a layer group or marker cluster group.
 * This function bypasses any issues with version mismatches, stub objects, or missing prototype methods.
 * @param {L.LayerGroup|L.MarkerClusterGroup} group - Target layer group
 * @param {L.Layer[]} layers - Array of Leaflet layers to add
 */
function safeAddLayers(group, layers) {
  if (!group || !layers || !layers.length) return;
  if (typeof group.addLayers === 'function') {
    try {
      group.addLayers(layers);
    } catch (err) {
      console.warn('[MapManager] Failed to call group.addLayers, falling back to loop:', err);
      layers.forEach(layer => {
        if (layer && typeof group.addLayer === 'function') {
          group.addLayer(layer);
        }
      });
    }
  } else {
    layers.forEach(layer => {
      if (layer && typeof group.addLayer === 'function') {
        group.addLayer(layer);
      }
    });
  }
}

/**
 * Helper untuk membuat Marker Cluster Group atau Layer Group fallback
 * @param {string} clusterType - Tipe kluster (cctv, landmarks, incidents, signals)
 * @returns {L.MarkerClusterGroup|L.LayerGroup}
 */
function createClusterGroup(clusterType = 'cctv') {
  if (typeof L !== 'undefined' && typeof L.markerClusterGroup === 'function') {
    return L.markerClusterGroup({
      maxClusterRadius: 120,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 16,
      animate: true,
      animateAddingMarkers: false,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let sizeClass = 'cluster-small';
        if (count > 12) sizeClass = 'cluster-large';
        else if (count > 4) sizeClass = 'cluster-medium';

        let typeClass = `cluster-${clusterType}`;
        return L.divIcon({
          html: `<div class="omni-cluster-bubble ${sizeClass} ${typeClass}"><span>${count}</span></div>`,
          className: 'omni-cluster-icon',
          iconSize: L.point(40, 40),
          iconAnchor: [20, 20]
        });
      }
    });
  }
  
  // Graceful fallback to avoid fatal TypeError if MarkerCluster script is not loaded
  return L.layerGroup();
}

export class MapManager {
  constructor() {
    /** @type {Map<string, L.Map>} Map instance storage keyed by container ID */
    this.maps = new Map();
    this.tileLayers = new Map();
    this.animFrameId = null;
    this.lastAnimTime = 0;

    /** Store references to corridor GeoJSON layers across map instances */
    this.corridorGeoJsonLayers = [];

    /** Emergency responder markers for each map instance */
    this.emergencyMarkers = [];
    this.emergencySpeedMultiplier = 1.0;

    this.layerGroupsMap = new Map();
    this.intersectionMarkersMap = new Map();
    this.densityHeatmapGroups = new Map();
    this.weatherWidgets = new Map();
    this.currentRoadCondition = 'dry'; // 'dry' | 'wet'
    this.currentLayerMode = 'flow'; // 'flow' | 'heat' | 'nodes' | 'all'

    // Emergency 112 Simulation State
    this.emergency112Sim = {
      active: false,
      marker: null,
      routePoints: [],
      latlngs: [],
      clearedNodes: new Set(),
      totalDurationSec: 40,
      startTime: 0,
      animId: null
    };

    this._injectZIndexStyles();
    this._setupStoreListeners();
  }

  /**
   * Menyuntikkan style z-index presisi tinggi untuk menghindari tabrakan layout
   * antara visualisasi peta kustom dan antarmuka Command Center OmniTRAF
   */
  _injectZIndexStyles() {
    if (typeof document === 'undefined') return;
    const styleId = 'omnitraf-map-z-index-adjustments';
    if (document.getElementById(styleId)) return;

    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      /* High-Performance GIS Z-Index & Overlay Adjustments */
      .map-zoom-controls-overlay,
      .map-zoom-controls {
        z-index: 1005 !important;
      }
      .landmark-detail-card-overlay,
      .landmark-detail-card {
        z-index: 1006 !important;
      }
      .legend {
        z-index: 1004 !important;
      }
      .map-overview {
        z-index: 1004 !important;
      }
      .map-layer-deck {
        z-index: 1007 !important;
      }
      .map-floating-ctrl-btn {
        z-index: 1008 !important;
      }
      .map-floating-actions-group {
        z-index: 1008 !important;
      }
      /* Floating Map Layer Switcher */
      .map-layer-mode-switcher {
        position: absolute;
        top: 14px;
        left: 14px;
        z-index: 1009 !important;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        border-radius: 30px;
        background: rgba(10, 20, 36, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(0, 229, 255, 0.25);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
      }
      .mlm-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--text-muted);
        padding: 0 4px 0 6px;
      }
      .map-layer-pill-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: transparent;
        border: 1px solid transparent;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .map-layer-pill-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
      }
      .map-layer-pill-btn.active {
        background: rgba(0, 229, 255, 0.2);
        border-color: rgba(0, 229, 255, 0.5);
        color: #00e5ff;
        font-weight: 700;
        box-shadow: 0 0 12px rgba(0, 229, 255, 0.3);
      }
      .map-layer-pill-btn .pill-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      /* Map Weather Micro-Widget */
      .map-weather-micro-widget {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 1009 !important;
        background: rgba(10, 20, 36, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 8px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 220px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
      .mww-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .mww-weather-col {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mww-icon {
        font-size: 20px;
        line-height: 1;
      }
      .mww-temp {
        font-size: 13px;
        font-weight: 800;
        color: #ffffff;
        display: block;
        line-height: 1.1;
      }
      .mww-hum {
        font-size: 10px;
        color: var(--text-muted);
      }
      .mww-cond-toggle {
        font-size: 10.5px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.2s;
      }
      .mww-cond-toggle.dry-active {
        background: rgba(34, 197, 94, 0.18);
        border: 1px solid rgba(34, 197, 94, 0.4);
        color: #22c55e;
      }
      .mww-cond-toggle.wet-active {
        background: rgba(14, 165, 233, 0.22);
        border: 1px solid rgba(14, 165, 233, 0.6);
        color: #38bdf8;
      }
      .mww-bottom {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 4px;
        margin-top: 2px;
      }
      .mww-impact-text {
        font-size: 9.5px;
        color: var(--text-muted);
        line-height: 1.25;
        display: block;
      }
      /* Floating Telemetry HUD for Ambulance 112 Simulator */
      .emergency-floating-hud {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1011 !important;
        background: rgba(5, 12, 24, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1.5px solid #ef4444;
        border-radius: 16px;
        padding: 12px 18px;
        width: 90%;
        max-width: 620px;
        box-shadow: 0 12px 40px rgba(239, 68, 68, 0.35), 0 0 20px rgba(0, 0, 0, 0.8);
        animation: slideUpHud 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes slideUpHud {
        from { opacity: 0; transform: translate(-50%, 20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .efh-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .efh-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ef4444;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.5px;
      }
      .efh-pulse-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        box-shadow: 0 0 10px #ef4444;
        animation: pulseGlow 1s infinite;
      }
      .efh-close-btn {
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(239, 68, 68, 0.5);
        color: #ef4444;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .efh-close-btn:hover {
        background: #ef4444;
        color: #ffffff;
      }
      .efh-body {
        display: grid;
        grid-template-columns: 1fr 1fr 1.6fr;
        gap: 12px;
        margin-bottom: 8px;
      }
      .efh-stat small {
        display: block;
        font-size: 9.5px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .efh-val-primary {
        font-size: 17px;
        font-weight: 800;
        color: #00e5ff;
        font-family: 'Share Tech Mono', monospace;
      }
      .efh-val-speed {
        font-size: 17px;
        font-weight: 800;
        color: #f59e0b;
        font-family: 'Share Tech Mono', monospace;
      }
      .efh-val-node {
        font-size: 13px;
        font-weight: 800;
        color: #22c55e;
        display: block;
        line-height: 1.2;
      }
      .efh-progress-bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
      }
      .efh-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #ef4444, #f59e0b, #22c55e);
        width: 0%;
        transition: width 0.3s linear;
      }
      /* Ambulance Beacon Icon */
      .emergency-112-ambulance-icon {
        background: transparent;
        border: none;
      }
      .amb-siren-beacon {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0f172a;
        border: 2px solid #ef4444;
        border-radius: 20px;
        padding: 3px 8px;
        box-shadow: 0 0 16px rgba(239, 68, 68, 0.8), inset 0 0 8px rgba(239, 68, 68, 0.4);
      }
      .amb-body {
        font-size: 11px;
        font-weight: 900;
        color: #ffffff;
        white-space: nowrap;
      }
      .amb-flash-light {
        position: absolute;
        top: -4px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .amb-flash-light.red {
        left: 6px;
        background: #ef4444;
        box-shadow: 0 0 8px #ef4444;
        animation: flashRed 0.4s infinite alternate;
      }
      .amb-flash-light.blue {
        right: 6px;
        background: #00e5ff;
        box-shadow: 0 0 8px #00e5ff;
        animation: flashBlue 0.4s infinite alternate;
      }
      @keyframes flashRed {
        from { opacity: 0.2; }
        to { opacity: 1; filter: drop-shadow(0 0 6px #ef4444); }
      }
      @keyframes flashBlue {
        from { opacity: 1; filter: drop-shadow(0 0 6px #00e5ff); }
        to { opacity: 0.2; }
      }
      .pulse-green-wave-clearance {
        animation: rippleClearance 1.2s infinite ease-out !important;
      }
      @keyframes rippleClearance {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.8); }
        70% { transform: scale(1.4); box-shadow: 0 0 0 24px rgba(34, 197, 94, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
      /* Mengatur urutan pane leaflet */
      .leaflet-pane {
        z-index: 400 !important;
      }
      .leaflet-tile-pane {
        z-index: 200 !important;
      }
      .leaflet-overlay-pane {
        z-index: 450 !important;
      }
      .leaflet-marker-pane {
        z-index: 600 !important;
      }
      .leaflet-shadow-pane {
        z-index: 500 !important;
      }
      .leaflet-popup-pane {
        z-index: 1010 !important;
      }
      .leaflet-control-container {
        z-index: 1002 !important;
      }
      /* Glowing Neon Polyline & Flowing Traffic Dash Animation */
      .corridor-neon-glow {
        filter: drop-shadow(0 0 8px currentColor) drop-shadow(0 0 14px currentColor);
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .corridor-congested-flow {
        stroke-dasharray: 10, 14;
        animation: flowDashAnim 1.2s linear infinite;
      }
      .corridor-smooth-flow {
        stroke-dasharray: 12, 10;
        animation: flowDashAnim 0.7s linear infinite;
      }
      @keyframes flowDashAnim {
        from { stroke-dashoffset: 48; }
        to { stroke-dashoffset: 0; }
      }
      /* Modern Holographic Sci-Fi Leaflet Popup Card */
      .leaflet-popup-content-wrapper {
        background: rgba(5, 11, 20, 0.92) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        border: 1.5px solid rgba(0, 229, 255, 0.45) !important;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), 0 0 24px rgba(0, 229, 255, 0.25) !important;
        border-radius: 14px !important;
        padding: 0 !important;
        color: #fff !important;
      }
      .leaflet-popup-tip {
        background: rgba(5, 11, 20, 0.92) !important;
        border: 1px solid rgba(0, 229, 255, 0.45) !important;
      }
      .leaflet-popup-close-button {
        color: #94a3b8 !important;
        font-size: 16px !important;
        padding: 6px 8px !important;
        transition: color 0.2s !important;
      }
      .leaflet-popup-close-button:hover {
        color: #ef4444 !important;
      }
      .ios-popup-card {
        padding: 14px 16px;
      }
      .ios-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(0, 229, 255, 0.2);
      }
      .ios-popup-subtitle {
        font-family: 'Share Tech Mono', monospace;
        font-size: 9.5px;
        color: #00e5ff;
        letter-spacing: 0.5px;
      }
      .ios-popup-title {
        margin: 0 0 10px 0;
        font-size: 13.5px;
        font-weight: 700;
        color: #ffffff;
      }
      .ios-popup-info-grid {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ios-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
      }
      .ios-info-label {
        color: var(--text-muted);
      }
      .ios-info-value {
        font-family: 'Share Tech Mono', monospace;
        font-weight: 700;
      }
      /* Enterprise chat integration layer safety */
      .staff-chat-panel {
        z-index: 10000 !important;
      }
      .toast-stack-container {
        z-index: 100002 !important;
      }
      .modal-overlay {
        z-index: 999999 !important;
      }
    `;
    document.head.appendChild(styleEl);
  }

  _setupStoreListeners() {
    stateStore.subscribe('state:currentView', ({ value }) => {
      this.initAllMaps();
      setTimeout(() => this.invalidateSize(), 200);
    });

    stateStore.subscribe('traffic:green-wave', ({ active }) => {
      this.updateGreenWaveVisuals(active);
    });

    stateStore.subscribe('state:isChaosMode', ({ value }) => {
      this.updateChaosVisuals(value);
    });

    stateStore.subscribe('state:activeEmergencies', ({ value }) => {
      this.syncActiveEmergenciesFromState(value);
    });

    stateStore.subscribe('state:incidents', ({ value }) => {
      this.updateIncidentsOnMap(value);
    });

    stateStore.subscribe('state:devices', ({ value }) => {
      this.updateDeviceMapVisuals(value);
    });
  }

  updateDeviceMapVisuals(devices) {
    if (!devices || typeof document === 'undefined') return;
    devices.forEach(dev => {
      let nodeId = null;
      if (dev.deviceId === 'NODE-EDGE-01') nodeId = 'node-wonokromo';
      else if (dev.deviceId === 'NODE-EDGE-02') nodeId = 'node-darmo';
      else if (dev.deviceId === 'NODE-EDGE-03') nodeId = 'node-tunjungan';
      else if (dev.deviceId === 'NODE-CTRL-01') nodeId = 'node-margorejo';

      if (!nodeId) return;

      const markerEl = document.getElementById(`signal-marker-${nodeId}`);
      if (markerEl) {
        const ripple = markerEl.querySelector('.signal-ripple');
        const core = markerEl.querySelector('.signal-core');
        if (ripple && core) {
          // Reset classes
          ripple.className = 'signal-ripple';
          core.className = 'signal-core';

          if (dev.healthLevel === 'OFFLINE' || dev.healthLevel === 'STALE') {
            ripple.style.borderColor = '#64748b';
            ripple.style.boxShadow = 'none';
            core.style.backgroundColor = '#64748b';
            core.style.boxShadow = '0 0 8px #64748b';
          } else if (dev.healthLevel === 'DEGRADED') {
            ripple.classList.add('ripple-warning');
            core.classList.add('node-warning');
            ripple.style.borderColor = '';
            ripple.style.boxShadow = '';
            core.style.backgroundColor = '';
            core.style.boxShadow = '';
          } else { // HEALTHY / ONLINE
            ripple.classList.add('ripple-success');
            core.classList.add('node-success');
            ripple.style.borderColor = '';
            ripple.style.boxShadow = '';
            core.style.backgroundColor = '';
            core.style.boxShadow = '';
          }
        }
      }
    });
  }

  /**
   * Main initializer called by App orchestrator
   */
  init() {
    this.initAllMaps();
    this._bindZoomControls();
    this._bindLandmarkHUDClose();
  }

  _bindZoomControls() {
    const zoomInBtns = document.querySelectorAll("#btnMapZoomIn, .btn-zoom-in");
    const zoomOutBtns = document.querySelectorAll("#btnMapZoomOut, .btn-zoom-out");
    const zoomResetBtns = document.querySelectorAll("#btnMapZoomReset, .btn-zoom-reset");

    zoomInBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.maps.forEach(map => map.zoomIn());
        soundManager.play('click');
      });
    });

    zoomOutBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.maps.forEach(map => map.zoomOut());
        soundManager.play('click');
      });
    });

    zoomResetBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.maps.forEach(map => map.setView([SURABAYA_CENTER.lat, SURABAYA_CENTER.lng], SURABAYA_CENTER.zoom));
        soundManager.play('click');
      });
    });
  }

  _bindLandmarkHUDClose() {
    const closeBtn = document.getElementById("btnCloseLandmarkCard");
    const card = document.getElementById("landmarkDetailCard");
    if (closeBtn && card) {
      closeBtn.addEventListener("click", () => {
        card.classList.add("is-hidden");
        soundManager.play('click');
      });
    }
  }

  /**
   * Inisialisasi seluruh kontainer peta Leaflet yang tersedia di DOM
   */
  initAllMaps() {
    const containers = ['map-surabaya', 'dashboardMapBox'];
    containers.forEach(id => {
      if (document.getElementById(id)) {
        this.initMap(id);
      }
    });
  }

  /**
   * Inisialisasi peta Leaflet untuk kontainer tertentu
   * @param {string} [containerId='map-surabaya']
   */
  initMap(containerId = 'map-surabaya') {
    const container = document.getElementById(containerId);
    if (!container || typeof L === 'undefined') return;

    // Jika peta untuk kontainer ini sudah diinisialisasi, validasi ukuran saja
    if (this.maps.has(containerId)) {
      const existingMap = this.maps.get(containerId);
      try {
        existingMap.invalidateSize(true);
      } catch (err) {
        console.warn(`[MapManager] Invalidate error for ${containerId}:`, err);
      }
      return;
    }

    // 1. Instansiasi Leaflet Map
    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      tapTolerance: 15,
      touchZoom: true,
      bounceAtZoomLimits: false,
      preferCanvas: true
    }).setView([SURABAYA_CENTER.lat, SURABAYA_CENTER.lng], SURABAYA_CENTER.zoom);

    // 2. Base Tile Layer (CartoDB Dark Matter / Positron)
    const currentTheme = stateStore.getState().theme || 'dark';
    const isDark = currentTheme === 'dark';
    const tileLayer = createCartoTileLayer(isDark).addTo(map);

    this.tileLayers.set(containerId, tileLayer);

    // 3. Inisialisasi Layer Groups & Marker Cluster Groups untuk kontainer ini
    const layerGroups = {
      'district-zones': L.layerGroup().addTo(map),
      'map-river': L.layerGroup().addTo(map),
      'road-glows': L.layerGroup().addTo(map),
      'minor-roads': L.layerGroup().addTo(map),
      'density-heat': L.layerGroup(),
      'warn-points': createClusterGroup('incidents').addTo(map),
      'landmark-group': createClusterGroup('landmarks').addTo(map),
      'signal-points': createClusterGroup('signals').addTo(map),
      'emergency-sim-route': L.layerGroup().addTo(map)
    };

    this.layerGroupsMap.set(containerId, layerGroups);
    this.maps.set(containerId, map);

    map.on('popupopen', (e) => {
      this._handlePopupOpen(e, containerId);
    });
    map.on('popupclose', (e) => {
      this._handlePopupClose(e, containerId);
    });

    // 4. Render seluruh data geospasial menggunakan parser L.geoJSON()
    this.drawCorridors(map, layerGroups['road-glows'], layerGroups['minor-roads']);
    this.drawRiver(map, layerGroups['map-river']);
    this.drawDistricts(map, layerGroups['district-zones']);
    this.drawIncidents(map, layerGroups['warn-points']);
    this.drawLandmarksAndCctv(map, layerGroups['landmark-group']);
    this.drawIntersections(map, layerGroups['signal-points']);
    this.drawDensityHeatmap(map, layerGroups['density-heat']);
    this.setupEmergencyVehicleMarkers(map);
    this.createMapLayerSwitcher(map, containerId);
    this.createWeatherWidget(map, containerId);

    // Mulai loop animasi requestAnimationFrame jika belum berjalan
    if (!this.animFrameId) {
      this.startEmergencyVehicleAnimation();
    }

    setTimeout(() => map.invalidateSize(), 250);
  }

  /**
   * Render Koridor Utama dan Sekunder dari GeoJSON LineString
   */
  drawCorridors(map, glowGroup, minorGroup) {
    if (!map) return;

    // A. Koridor Arteri Utama (L.geoJSON with Neon Glow & Animated Traffic Dash)
    const corridorGeoJson = L.geoJSON(SURABAYA_CORRIDORS_GEOJSON, {
      style: (feature) => {
        const isCongested = (feature.properties.speed || 30) < 20 || feature.properties.color === '#ef4444';
        return {
          color: isCongested ? '#ef4444' : (feature.properties.color || '#00e5ff'),
          weight: (feature.properties.weight || 5) + 4,
          opacity: 0.45,
          className: 'corridor-neon-glow',
          lineCap: 'round',
          lineJoin: 'round'
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const popupContent = `
          <div class="ios-popup-card">
            <div class="ios-popup-header">
              <span class="cctv-live-tag"><span class="live-dot"></span> REALTIME SITS</span>
              <span class="ios-popup-subtitle">KORIDOR GEOSPASIAL</span>
            </div>
            <h4 class="ios-popup-title">🛣️ ${p.name}</h4>
            <div class="ios-popup-info-grid">
              <div class="ios-info-row">
                <span class="ios-info-label">Status Koridor:</span>
                <span class="ios-info-value" style="color:${p.color}; font-weight:800;">${p.status}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val" style="color:#00e5ff;">${p.speed} km/jam</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Sistem Integrasi:</span>
                <span class="ios-info-value">Surabaya Integrated Traffic System</span>
              </div>
            </div>
          </div>
        `;
        layer.bindPopup(popupContent, { maxWidth: 300 });
      }
    });

    // Layer garis inti (core lines with active flowing dash)
    const coreGeoJson = L.geoJSON(SURABAYA_CORRIDORS_GEOJSON, {
      style: (feature) => {
        const isCongested = (feature.properties.speed || 30) < 20 || feature.properties.color === '#ef4444';
        return {
          color: isCongested ? '#FF453A' : (feature.properties.color || '#00e5ff'),
          weight: feature.properties.weight || 5,
          opacity: 0.95,
          className: isCongested ? 'corridor-congested-flow' : 'corridor-smooth-flow',
          lineCap: 'round',
          lineJoin: 'round'
        };
      }
    });

    glowGroup.addLayer(corridorGeoJson);
    glowGroup.addLayer(coreGeoJson);

    this.corridorGeoJsonLayers.push({ glow: corridorGeoJson, core: coreGeoJson });

    // B. Jalan Sekunder (L.geoJSON)
    const minorGeoJson = L.geoJSON(MINOR_ROADS_GEOJSON, {
      style: (feature) => ({
        color: feature.properties.color || '#f59e0b',
        weight: 3.5,
        opacity: 0.75,
        dashArray: '6, 4'
      }),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`🛣️ ${feature.properties.name}`, { sticky: true });
      }
    });

    minorGroup.addLayer(minorGeoJson);
  }

  /**
   * Render Sungai Kalimas dari GeoJSON LineString
   */
  drawRiver(map, riverGroup) {
    if (!map) return;

    const riverGeoJson = L.geoJSON(KALIMAS_RIVER_GEOJSON, {
      style: {
        color: '#0284c7',
        weight: 5,
        opacity: 0.7,
        dashArray: '8, 4'
      },
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`🌊 ${feature.properties.name}`, { sticky: true });
      }
    });

    riverGroup.addLayer(riverGeoJson);
  }

  /**
   * Render Batas Wilayah Distrik dari GeoJSON Polygon
   */
  drawDistricts(map, districtGroup) {
    if (!map) return;

    const districtGeoJson = L.geoJSON(SURABAYA_DISTRICTS_GEOJSON, {
      style: (feature) => ({
        color: feature.properties.color || '#38bdf8',
        weight: 1,
        dashArray: '4, 4',
        fillColor: feature.properties.color || '#38bdf8',
        fillOpacity: 0.05
      }),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`📍 Wilayah: ${feature.properties.name}`, { sticky: true });
      }
    });

    districtGroup.addLayer(districtGeoJson);
  }

  /**
   * Render Titik Peringatan Insiden dari GeoJSON Point ke Cluster Group
   */
  drawIncidents(map, incidentGroup) {
    if (!map) return;

    const incidentGeoJson = L.geoJSON(SURABAYA_INCIDENTS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const customIcon = L.divIcon({
          className: 'custom-incident-div-icon',
          html: `<div class="leaflet-incident-marker" title="${feature.properties.name}">⚠️</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        return L.marker(latlng, { icon: customIcon });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <div class="ios-popup-card incident-popup">
            <div class="ios-popup-header alert">
              <span class="alert-pill">⚠️ INSIDEN LALU LINTAS</span>
              <span class="ios-popup-subtitle">SIAGA SITS 112</span>
            </div>
            <h4 class="ios-popup-title">${p.name}</h4>
            <div class="ios-popup-info-grid">
              <div class="ios-info-row">
                <span class="ios-info-label">Jenis Insiden:</span>
                <span class="ios-info-value highlight-red">${p.jenis}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Status Penanganan:</span>
                <span class="ios-info-value highlight-amber">${p.est} (${p.petugas})</span>
              </div>
            </div>
          </div>
        `, { maxWidth: 300 });
      }
    });

    // Masukkan marker ke cluster secara berkelompok untuk keandalan maksimal menggunakan robust helper
    const layers = [];
    incidentGeoJson.eachLayer(layer => {
      layers.push(layer);
    });
    safeAddLayers(incidentGroup, layers);
  }

  /**
   * Render CCTV & Landmark dari GeoJSON Point ke Cluster Group
   */
  drawLandmarksAndCctv(map, landmarkGroup) {
    if (!map) return;

    // 1. CCTV Cameras (GeoJSON)
    const cctvGeoJson = L.geoJSON(SITS_CCTV_CAMERAS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const p = feature.properties;
        const cctvIcon = L.divIcon({
          className: 'custom-cctv-div-icon',
          html: `<div class="leaflet-cctv-marker">📷 ${p.name}</div>`,
          iconSize: [120, 24],
          iconAnchor: [60, 12]
        });
        return L.marker(latlng, { icon: cctvIcon });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <div class="ios-popup-card cctv-popup">
            <div class="ios-popup-header">
              <span class="cctv-live-tag"><span class="live-dot"></span> LIVE SITS</span>
              <span class="ios-popup-subtitle">CCTV COMPUTER VISION</span>
            </div>
            <h4 class="ios-popup-title">📷 ${p.name}</h4>
            <div class="ios-popup-info-grid">
              <div class="ios-info-row">
                <span class="ios-info-label">Status Antrean:</span>
                <span class="ios-info-value status-badge ${p.statusClass}">${p.status}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Ruas & Arah Jalur:</span>
                <span class="ios-info-value">${p.ruas}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val">${p.speed}</span>
              </div>
            </div>
          </div>
        `, { maxWidth: 300 });
      }
    });

    // 2. Landmarks (GeoJSON)
    const landmarkGeoJson = L.geoJSON(SURABAYA_LANDMARKS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const p = feature.properties;
        const lmIcon = L.divIcon({
          className: 'custom-lm-div-icon',
          html: `<div class="leaflet-landmark-marker">🏛️ ${p.name}</div>`,
          iconSize: [120, 20],
          iconAnchor: [60, 10]
        });
        const marker = L.marker(latlng, { icon: lmIcon });
        marker.bindTooltip(p.name, { sticky: true });
        return marker;
      }
    });

    // Masukkan marker ke cluster secara berkelompok menggunakan robust helper
    const layers = [];
    cctvGeoJson.eachLayer(layer => {
      layers.push(layer);
    });
    landmarkGeoJson.eachLayer(layer => {
      layers.push(layer);
    });

    safeAddLayers(landmarkGroup, layers);
  }

  /**
   * Render Node Sinyal APILL dari GeoJSON Point ke Cluster Group
   */
  drawIntersections(map, signalGroup) {
    if (!map) return;

    const signalGeoJson = L.geoJSON(SITS_INTERSECTIONS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const p = feature.properties;
        const statusClass = p.status === 'danger' ? 'ripple-danger' : p.status === 'warning' ? 'ripple-warning' : 'ripple-success';
        const nodeClass = p.status === 'danger' ? 'node-danger' : p.status === 'warning' ? 'node-warning' : 'node-success';

        const nodeIcon = L.divIcon({
          className: 'custom-signal-div-icon',
          html: `
            <div class="leaflet-signal-node-wrapper" id="signal-marker-${p.id}">
              <span class="signal-ripple ${statusClass}"></span>
              <span class="signal-core ${nodeClass}"></span>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker(latlng, { icon: nodeIcon });
        
        // Simpan referensi marker untuk flyTo & live preemption
        this.intersectionMarkersMap.set(p.id, { marker, feature, latlng, id: p.id, name: p.name });

        marker.bindPopup(`
          <div class="ios-popup-card">
            <div class="ios-popup-header">
              <span class="cctv-live-tag"><span class="live-dot"></span> NODE APILL</span>
              <span class="ios-popup-subtitle">${p.district}</span>
            </div>
            <h4 class="ios-popup-title">🚦 ${p.name}</h4>
            <div class="ios-popup-info-grid">
              <div class="ios-info-row">
                <span class="ios-info-label">Fase Hijau Adaptif:</span>
                <span class="ios-info-value" style="color:${p.color}; font-weight:800;">${p.defaultGreen} dtk</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val" style="color:#22c55e; font-weight:800;">28 km/jam</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Waktu Tunggu Antrean:</span>
                <span class="ios-info-value">${p.currentWait} dtk</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Status Siklus:</span>
                <span class="ios-info-value" style="color:var(--primary); font-weight:700;">🟢 SIKLUS ADAPTIF AKTIF</span>
              </div>
            </div>
          </div>
        `, { maxWidth: 300 });
        return marker;
      }
    });

    // Masukkan marker ke cluster secara berkelompok untuk performa visual optimal menggunakan robust helper
    const layers = [];
    signalGeoJson.eachLayer(layer => {
      layers.push(layer);
    });
    safeAddLayers(signalGroup, layers);
  }

  /**
   * Mengatur Marker Armada Tanggap Darurat 112 untuk Map Instance tertentu
   */
  setupEmergencyVehicleMarkers(map) {
    const ambCoords = EMERGENCY_PATHS_GEOJSON.ambulance.geometry.coordinates;
    const fireCoords = EMERGENCY_PATHS_GEOJSON.fire.geometry.coordinates;

    const ambIcon = L.divIcon({
      className: 'custom-veh-div-icon',
      html: `<div class="leaflet-vehicle-pill ambulance"><span class="v-icon">🚑</span><span>Ambulans 02</span><span class="v-speed-badge">62 km/j</span></div>`,
      iconSize: [120, 26],
      iconAnchor: [60, 13]
    });

    const ambMarker = L.marker([ambCoords[0][1], ambCoords[0][0]], { icon: ambIcon, zIndexOffset: 1000 }).addTo(map);
    ambMarker.bindPopup(`
      <div class="ios-popup-card vehicle-popup">
        <div class="ios-popup-header">
          <span class="cctv-live-tag" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;"><span class="live-dot" style="background:#ef4444;"></span> DARURAT 112</span>
          <span class="ios-popup-subtitle">KORIDOR PRIORITAS</span>
        </div>
        <h4 class="ios-popup-title">🚑 Ambulans 02 RSU Dr. Soetomo</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan Real-time:</span>
            <span class="ios-info-value speed-val" style="color:#ef4444; font-weight:800;">62 km/jam</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Status Preemption:</span>
            <span class="ios-info-value">Sinyal Hijau Otomatis Aktif</span>
          </div>
        </div>
      </div>
    `, { maxWidth: 300 });

    const fireIcon = L.divIcon({
      className: 'custom-veh-div-icon',
      html: `<div class="leaflet-vehicle-pill fire"><span class="v-icon">🚒</span><span>Pemadam 04</span><span class="v-speed-badge">55 km/j</span></div>`,
      iconSize: [120, 26],
      iconAnchor: [60, 13]
    });

    const fireMarker = L.marker([fireCoords[0][1], fireCoords[0][0]], { icon: fireIcon, zIndexOffset: 1000 }).addTo(map);
    fireMarker.bindPopup(`
      <div class="ios-popup-card vehicle-popup">
        <div class="ios-popup-header">
          <span class="cctv-live-tag" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;"><span class="live-dot" style="background:#f59e0b;"></span> SIAGA DARURAT</span>
          <span class="ios-popup-subtitle">DISPOSISI PMK</span>
        </div>
        <h4 class="ios-popup-title">🚒 Pemadam 04 Kota Surabaya</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan Real-time:</span>
            <span class="ios-info-value speed-val" style="color:#f59e0b; font-weight:800;">55 km/jam</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Koridor Tujuan:</span>
            <span class="ios-info-value">Mayjen Sungkono - HR Muhammad</span>
          </div>
        </div>
      </div>
    `, { maxWidth: 300 });

    this.emergencyMarkers.push({
      map,
      ambulance: ambMarker,
      fire: fireMarker,
      ambSeg: 0,
      ambProgress: 0,
      fireSeg: 0,
      fireProgress: 0
    });
  }

  /**
   * Animasi Pergerakan Armada Tanggap Darurat 60 FPS menggunakan requestAnimationFrame
   * Fisika pergerakan dinormalisasi menggunakan jarak Euclidean sehingga kecepatan visual konstan & stabil.
   */
  startEmergencyVehicleAnimation() {
    const ambCoords = EMERGENCY_PATHS_GEOJSON.ambulance.geometry.coordinates; // [[lng, lat], ...]
    const fireCoords = EMERGENCY_PATHS_GEOJSON.fire.geometry.coordinates;

    // Kecepatan linear ternormalisasi (derajat geometris per detik)
    const ambLinearSpeed = 0.0036; // ~60 km/jam visual speed
    const fireLinearSpeed = 0.0028; // ~50 km/jam visual speed

    const animateStep = (timestamp) => {
      if (!this.lastAnimTime) this.lastAnimTime = timestamp;
      const dt = Math.min(0.1, Math.max(0.001, (timestamp - this.lastAnimTime) / 1000));
      this.lastAnimTime = timestamp;

      // Kecepatan linear ternormalisasi dengan pengali dinamis prioritas darurat
      const mult = this.emergencySpeedMultiplier || 1.0;
      const ambLinearSpeed = 0.0036 * mult; // 60 km/jam -> ~150 km/jam saat Green Wave
      const fireLinearSpeed = 0.0028 * mult;

      // Jalankan animasi jika document aktif
      if (!document.hidden) {
        this.emergencyMarkers.forEach(group => {
          // --- 1. AMBULANS 02 TWEENING WITH EUCLIDEAN NORMALIZATION ---
          let p1Amb = ambCoords[group.ambSeg];
          let p2Amb = ambCoords[group.ambSeg + 1] || ambCoords[0];
          let distAmb = calculateDistance(p1Amb, p2Amb);

          // Tambahkan progress sebanding dengan jarak asli segmen
          group.ambProgress += (dt * ambLinearSpeed) / distAmb;

          while (group.ambProgress >= 1) {
            group.ambProgress -= 1;
            group.ambSeg = (group.ambSeg + 1) % (ambCoords.length - 1);
            p1Amb = ambCoords[group.ambSeg];
            p2Amb = ambCoords[group.ambSeg + 1] || ambCoords[0];
            distAmb = calculateDistance(p1Amb, p2Amb);
          }

          // Linear Interpolation (Lerp)
          const lngAmb = p1Amb[0] + (p2Amb[0] - p1Amb[0]) * group.ambProgress;
          const latAmb = p1Amb[1] + (p2Amb[1] - p1Amb[1]) * group.ambProgress;

          if (group.ambulance) {
            group.ambulance.setLatLng([latAmb, lngAmb]);
          }

          // --- 2. PEMADAM 04 TWEENING WITH EUCLIDEAN NORMALIZATION ---
          let p1Fire = fireCoords[group.fireSeg];
          let p2Fire = fireCoords[group.fireSeg + 1] || fireCoords[0];
          let distFire = calculateDistance(p1Fire, p2Fire);

          group.fireProgress += (dt * fireLinearSpeed) / distFire;

          while (group.fireProgress >= 1) {
            group.fireProgress -= 1;
            group.fireSeg = (group.fireSeg + 1) % (fireCoords.length - 1);
            p1Fire = fireCoords[group.fireSeg];
            p2Fire = fireCoords[group.fireSeg + 1] || fireCoords[0];
            distFire = calculateDistance(p1Fire, p2Fire);
          }

          const lngFire = p1Fire[0] + (p2Fire[0] - p1Fire[0]) * group.fireProgress;
          const latFire = p1Fire[1] + (p2Fire[1] - p1Fire[1]) * group.fireProgress;

          if (group.fire) {
            group.fire.setLatLng([latFire, lngFire]);
          }
        });
      }

      this.animFrameId = requestAnimationFrame(animateStep);
    };

    this.animFrameId = requestAnimationFrame(animateStep);
  }

  /**
   * Visualisasi Gelombang Hijau Darurat (Emergency Green Wave)
   */
  updateGreenWaveVisuals(active) {
    this.emergencySpeedMultiplier = active ? 2.5 : 1.0;

    this.corridorGeoJsonLayers.forEach(({ glow, core }) => {
      if (active) {
        core.setStyle((feature) => {
          if (feature.properties.isEmergencyCorridor) {
            return { color: '#22c55e', weight: 9, opacity: 1 };
          }
          return {};
        });
        glow.setStyle((feature) => {
          if (feature.properties.isEmergencyCorridor) {
            return { color: '#22c55e', weight: 16, opacity: 0.8 };
          }
          return {};
        });
      } else {
        core.setStyle((feature) => ({
          color: feature.properties.color || '#3b82f6',
          weight: feature.properties.weight || 5,
          opacity: 0.9
        }));
        glow.setStyle((feature) => ({
          color: feature.properties.color || '#3b82f6',
          weight: (feature.properties.weight || 5) + 3,
          opacity: 0.35
        }));
      }
    });
  }

  /**
   * Visualisasi Mode Keos / Kemacetan Total Surabaya
   */
  updateChaosVisuals(isChaos) {
    this.corridorGeoJsonLayers.forEach(({ glow, core }) => {
      if (isChaos) {
        core.setStyle({ color: '#ef4444', weight: 7 });
        glow.setStyle({ color: '#ef4444', opacity: 0.6 });
      } else {
        core.setStyle((feature) => ({
          color: feature.properties.color || '#3b82f6',
          weight: feature.properties.weight || 5
        }));
        glow.setStyle((feature) => ({
          color: feature.properties.color || '#3b82f6',
          opacity: 0.35
        }));
      }
    });
  }

  /**
   * Update visual koridor berdasarkan jam Time-Travel (00:00 - 23:00)
   */
  updateCorridorLoadByHour(hour) {
    const h = Math.max(0, Math.min(23, Number(hour) || 0));
    const isPeakMorning = (h >= 7 && h <= 9);
    const isPeakEvening = (h >= 16 && h <= 19);
    const isNight = (h >= 22 || h <= 5);

    let color = '#38bdf8';
    let weightGlow = 8;
    if (isPeakMorning || isPeakEvening) {
      color = '#ef4444';
      weightGlow = 14;
    } else if (h >= 11 && h <= 14) {
      color = '#f59e0b';
      weightGlow = 10;
    } else if (isNight) {
      color = '#10b981';
      weightGlow = 6;
    }

    this.corridorGeoJsonLayers.forEach(({ glow, core }) => {
      glow.setStyle((feature) => {
        const isCongested = (isPeakMorning || isPeakEvening) && (feature.properties.id === 'corridor-ayani' || feature.properties.id === 'corridor-darmo');
        return {
          color: isCongested ? '#ef4444' : color,
          weight: isCongested ? weightGlow + 4 : weightGlow,
          opacity: isCongested ? 0.7 : 0.4
        };
      });
      core.setStyle((feature) => {
        const isCongested = (isPeakMorning || isPeakEvening) && (feature.properties.id === 'corridor-ayani' || feature.properties.id === 'corridor-darmo');
        return {
          color: isCongested ? '#ef4444' : color,
          weight: isCongested ? 7 : 5,
          opacity: 0.95
        };
      });
    });
  }

  /**
   * Kontrol Zoom In untuk seluruh peta aktif
   */
  zoomIn() {
    this.maps.forEach(map => map.zoomIn());
  }

  /**
   * Kontrol Zoom Out untuk seluruh peta aktif
   */
  zoomOut() {
    this.maps.forEach(map => map.zoomOut());
  }

  /**
   * Reset Tampilan Peta ke Pusat Kota Surabaya
   */
  resetView() {
    this.maps.forEach(map => {
      map.setView([SURABAYA_CENTER.lat, SURABAYA_CENTER.lng], SURABAYA_CENTER.zoom, { animate: true });
    });
  }

  /**
   * Toggle Visibilitas Layer Spasial
   */
  toggleLayer(layerKey, isVisible) {
    this.layerGroupsMap.forEach((groups, containerId) => {
      const map = this.maps.get(containerId);
      const group = groups[layerKey];
      if (!map || !group) return;

      if (isVisible) {
        if (!map.hasLayer(group)) map.addLayer(group);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    });
  }

  /**
   * Update Tema Tile Peta (Light / Dark CartoDB)
   */
  updateTileTheme(theme) {
    const isDark = theme === 'dark';
    const tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

    this.tileLayers.forEach(tileLayer => {
      if (tileLayer && tileLayer.setUrl) {
        tileLayer.setUrl(tileUrl);
      }
    });
  }

  /**
   * Invalidate Size untuk memastikan render responsif tanpa bug container
   * @param {string} [containerId]
   */
  invalidateSize(containerId) {
    if (containerId && this.maps.has(containerId)) {
      try {
        const map = this.maps.get(containerId);
        map.invalidateSize(true);
      } catch (err) {
        console.warn(`[MapManager] invalidateSize error for ${containerId}:`, err);
      }
      return;
    }
    this.maps.forEach((map, id) => {
      try {
        map.invalidateSize(true);
      } catch (err) {
        console.warn(`[MapManager] invalidateSize error for ${id}:`, err);
      }
    });
  }

  /**
   * Render Lapisan Heatmap Kepadatan Arus Spasial Surabaya (Density Hotspots)
   */
  drawDensityHeatmap(map, heatmapGroup) {
    if (!map || !heatmapGroup) return;

    const DENSITY_HEATMAP_POINTS = [
      { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, radius: 420, color: "#ef4444", density: 1680, vcr: "0.88", level: "Kritis (88%)" },
      { name: "Bundaran Waru (Masjid Al-Akbar)", lat: -7.3510, lng: 112.7290, radius: 520, color: "#ef4444", density: 1950, vcr: "0.94", level: "Macet Parah (94%)" },
      { name: "Simpang Raya Darmo - Polrestabes", lat: -7.2810, lng: 112.7395, radius: 340, color: "#f59e0b", density: 1250, vcr: "0.68", level: "Padat Merayap (68%)" },
      { name: "Simpang A. Yani - Jemursari", lat: -7.3180, lng: 112.7315, radius: 380, color: "#ef4444", density: 1540, vcr: "0.82", level: "Kritis (82%)" },
      { name: "Simpang Tunjungan / Siola", lat: -7.2625, lng: 112.7375, radius: 280, color: "#22c55e", density: 820, vcr: "0.38", level: "Lancar (38%)" },
      { name: "Simpang Kertajaya - Dharmawangsa", lat: -7.2710, lng: 112.7565, radius: 310, color: "#f59e0b", density: 1100, vcr: "0.55", level: "Sedang (55%)" },
      { name: "Simpang MERR - Kertajaya Indah", lat: -7.2740, lng: 112.7815, radius: 320, color: "#3b82f6", density: 950, vcr: "0.45", level: "Terkendali (45%)" },
      { name: "Simpang Mayjen Sungkono - TVRI", lat: -7.2895, lng: 112.7160, radius: 300, color: "#f59e0b", density: 1180, vcr: "0.60", level: "Sedang (60%)" }
    ];

    DENSITY_HEATMAP_POINTS.forEach(pt => {
      // Outer glow circle
      const outerCircle = L.circle([pt.lat, pt.lng], {
        radius: pt.radius,
        color: pt.color,
        fillColor: pt.color,
        fillOpacity: 0.18,
        weight: 1.5,
        dashArray: '4, 4'
      });

      // Core concentrated circle
      const coreCircle = L.circle([pt.lat, pt.lng], {
        radius: pt.radius * 0.45,
        color: pt.color,
        fillColor: pt.color,
        fillOpacity: 0.45,
        weight: 2
      });

      const popupContent = `
        <div class="ios-popup-card">
          <div class="ios-popup-header">
            <span class="cctv-live-tag" style="background: ${pt.color}22; color: ${pt.color};"><span class="live-dot" style="background:${pt.color};"></span> HEATMAP KEPADATAN</span>
            <span class="ios-popup-subtitle">SENSOR SPASIAL SITS</span>
          </div>
          <h4 class="ios-popup-title">🔥 ${pt.name}</h4>
          <div class="ios-popup-info-grid">
            <div class="ios-info-row">
              <span class="ios-info-label">Intensitas Beban:</span>
              <span class="ios-info-value" style="color:${pt.color}; font-weight:800;">${pt.level}</span>
            </div>
            <div class="ios-info-row">
              <span class="ios-info-label">Volume Kendaraan:</span>
              <span class="ios-info-value">${pt.density} kend/jam</span>
            </div>
            <div class="ios-info-row">
              <span class="ios-info-label">Derajat Kejenuhan (V/C):</span>
              <span class="ios-info-value" style="font-weight:700;">${pt.vcr}</span>
            </div>
          </div>
        </div>
      `;

      outerCircle.bindPopup(popupContent, { maxWidth: 300 });
      coreCircle.bindPopup(popupContent, { maxWidth: 300 });

      heatmapGroup.addLayer(outerCircle);
      heatmapGroup.addLayer(coreCircle);
    });
  }

  /**
   * Mode Toggle Layer: Traffic Flow vs Kepadatan/Heatmap vs SITS Node Markers
   * @param {'flow'|'heat'|'nodes'|'all'} mode
   */
  setMapLayerMode(mode) {
    this.currentLayerMode = mode;

    this.layerGroupsMap.forEach((groups, containerId) => {
      const map = this.maps.get(containerId);
      if (!map) return;

      const flowGlow = groups['road-glows'];
      const minorRoads = groups['minor-roads'];
      const heatGroup = groups['density-heat'];
      const signals = groups['signal-points'];
      const landmarks = groups['landmark-group'];

      if (mode === 'flow') {
        if (flowGlow && !map.hasLayer(flowGlow)) map.addLayer(flowGlow);
        if (minorRoads && !map.hasLayer(minorRoads)) map.addLayer(minorRoads);
        if (heatGroup && map.hasLayer(heatGroup)) map.removeLayer(heatGroup);
        if (signals && !map.hasLayer(signals)) map.addLayer(signals);
      } else if (mode === 'heat') {
        if (heatGroup && !map.hasLayer(heatGroup)) map.addLayer(heatGroup);
        if (flowGlow && map.hasLayer(flowGlow)) map.removeLayer(flowGlow);
        if (signals && !map.hasLayer(signals)) map.addLayer(signals);
      } else if (mode === 'nodes') {
        if (heatGroup && map.hasLayer(heatGroup)) map.removeLayer(heatGroup);
        if (flowGlow && map.hasLayer(flowGlow)) map.removeLayer(flowGlow);
        if (signals && !map.hasLayer(signals)) map.addLayer(signals);
        if (landmarks && !map.hasLayer(landmarks)) map.addLayer(landmarks);
      } else if (mode === 'all') {
        if (flowGlow && !map.hasLayer(flowGlow)) map.addLayer(flowGlow);
        if (minorRoads && !map.hasLayer(minorRoads)) map.addLayer(minorRoads);
        if (heatGroup && !map.hasLayer(heatGroup)) map.addLayer(heatGroup);
        if (signals && !map.hasLayer(signals)) map.addLayer(signals);
      }
    });

    // Update active state on pill buttons
    document.querySelectorAll('.map-layer-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layerMode === mode);
    });

    if (typeof window.showToast === 'function') {
      const label = mode === 'flow' ? 'Traffic Flow (Arus Jalan)' : mode === 'heat' ? 'Heatmap Kepadatan Arus' : mode === 'nodes' ? 'SITS Node Markers' : 'Seluruh Lapisan Spasial';
      window.showToast(`Lapisan Peta SITS: ${label}`);
    }
  }

  /**
   * Membuat Floating Layer Switcher Controls pada Container Peta
   */
  createMapLayerSwitcher(map, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const existing = container.querySelector('.map-layer-mode-switcher');
    if (existing) existing.remove();

    const switcher = document.createElement('div');
    switcher.className = 'map-layer-mode-switcher glass-panel';
    switcher.innerHTML = `
      <span class="mlm-label hide-mobile">LAPISAN:</span>
      <button class="map-layer-pill-btn active" data-layer-mode="flow" type="button" title="Arus Koridor Lalu Lintas">
        <span class="pill-dot" style="background:#00e5ff;"></span> Arus Koridor
      </button>
      <button class="map-layer-pill-btn" data-layer-mode="heat" type="button" title="Heatmap Kepadatan Kendaraan">
        <span class="pill-dot" style="background:#ef4444;"></span> Heatmap
      </button>
      <button class="map-layer-pill-btn" data-layer-mode="nodes" type="button" title="Marker Persimpangan & Kamera SITS">
        <span class="pill-dot" style="background:#22c55e;"></span> Node SITS
      </button>
    `;

    switcher.querySelectorAll('.map-layer-pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.layerMode;
        this.setMapLayerMode(mode);
        soundManager.play('click');
      });
    });

    container.appendChild(switcher);
  }

  /**
   * Widget Mikro Cuaca & Kondisi Jalan Surabaya di Sudut Peta
   */
  createWeatherWidget(map, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const existing = container.querySelector('.map-weather-micro-widget');
    if (existing) existing.remove();

    const isWet = this.currentRoadCondition === 'wet';

    const widget = document.createElement('div');
    widget.className = 'map-weather-micro-widget glass-panel';
    widget.innerHTML = `
      <div class="mww-top">
        <div class="mww-weather-col">
          <span class="mww-icon">${isWet ? '🌧️' : '🌤️'}</span>
          <div>
            <strong class="mww-temp">${isWet ? '28°C' : '31°C'}</strong>
            <small class="mww-hum">RH ${isWet ? '88%' : '76%'}</small>
          </div>
        </div>
        <div class="mww-condition-col">
          <button class="mww-cond-toggle ${isWet ? 'wet-active' : 'dry-active'}" id="btnToggleRoadCond-${containerId}" type="button" title="Klik untuk simulasi cuaca hujan/kering">
            <span class="road-dot"></span> Aspal ${isWet ? 'Basah (Hujan)' : 'Kering'}
          </button>
        </div>
      </div>
      <div class="mww-bottom">
        <small class="mww-impact-text">
          ${isWet ? '⚠️ Kompensasi AI: Waktu Kuning +1.5s • All-Red +1.0s (Jarak Aman Pengereman)' : '✓ Koefisien Gesek: 1.0x (Optimal) • Waktu Siklus Standar'}
        </small>
      </div>
    `;

    const btn = widget.querySelector(`#btnToggleRoadCond-${containerId}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleRoadCondition();
        soundManager.play('click');
      });
    }

    container.appendChild(widget);
    this.weatherWidgets.set(containerId, widget);
  }

  /**
   * Toggle Kondisi Jalan (Kering <-> Basah)
   */
  toggleRoadCondition() {
    const next = this.currentRoadCondition === 'dry' ? 'wet' : 'dry';
    this.setRoadCondition(next);
  }

  /**
   * Mengatur Kondisi Jalan & Memengaruhi Waktu Siklus Lampu
   * @param {'dry'|'wet'} condition
   */
  setRoadCondition(condition) {
    this.currentRoadCondition = condition;
    const isWet = condition === 'wet';

    // Perbarui widget di seluruh kontainer peta
    this.maps.forEach((map, containerId) => {
      this.createWeatherWidget(map, containerId);
    });

    // Update global topbar weather widget if exists
    const wTemp = document.getElementById("weatherTemp");
    const wIcon = document.getElementById("weatherIcon");
    if (wTemp) wTemp.textContent = isWet ? "28°C (Hujan)" : "31°C";
    if (wIcon) wIcon.textContent = isWet ? "🌧" : "☀";

    // Informasikan status adaptif ke Traffic Engine
    stateStore.setState({ roadCondition: condition, isRainMode: isWet });

    if (typeof window.showToast === 'function') {
      if (isWet) {
        window.showToast("🌧️ Sensor Cuaca: Hujan terdeteksi. SITS mengompensasi durasi lampu kuning +1.5s untuk keselamatan pengereman!", "warning");
      } else {
        window.showToast("☀️ Sensor Cuaca: Permukaan jalan kering normal. Sinyal SITS kembali ke siklus reguler.");
      }
    }
  }

  /**
   * Smooth Fly-To Animation dengan Zoom Mulus & Popup Interaktif Lengkap
   * @param {string} idOrName - ID atau Nama Persimpangan SITS
   */
  flyToIntersection(idOrName) {
    if (!idOrName) return;

    let targetCoord = null;
    let targetProp = null;

    for (const feature of SITS_INTERSECTIONS_GEOJSON.features) {
      const p = feature.properties;
      if (p.id === idOrName || p.name.toLowerCase().includes(String(idOrName).toLowerCase())) {
        targetCoord = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
        targetProp = p;
        break;
      }
    }

    if (!targetCoord) {
      this.flyToLocation(idOrName);
      return;
    }

    this.maps.forEach((map, containerId) => {
      map.flyTo(targetCoord, 17, { duration: 1.2, easeLinearity: 0.25 });

      setTimeout(() => {
        const stored = this.intersectionMarkersMap.get(targetProp.id);
        if (stored && stored.marker) {
          try {
            const group = this.layerGroupsMap.get(containerId)?.['signal-points'];
            if (group && typeof group.zoomToShowLayer === 'function') {
              group.zoomToShowLayer(stored.marker, () => {
                stored.marker.openPopup();
              });
            } else {
              stored.marker.openPopup();
            }
          } catch {
            stored.marker.openPopup();
          }
        }
      }, 700);
    });
  }

  /**
   * Simulasi Rute Tanggap Darurat 112 (Bundaran Waru -> RSUD Dr. Soetomo)
   * Dilengkapi deteksi radius 200m untuk Green Wave Clearance otomatis di Margorejo, Wonokromo, & Darmo.
   */
  startEmergency112Simulation(onUpdate, onComplete) {
    this.stopEmergency112Simulation();

    const ROUTE_POINTS = [
      { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
      { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
      { name: "Simpang Margorejo", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-margorejo" },
      { name: "Simpang Jemursari", lat: -7.3100, lng: 112.7335, isIntersection: true, id: "node-jemursari" },
      { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
      { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
      { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
      { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
      { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
      { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
    ];

    const latlngs = ROUTE_POINTS.map(pt => [pt.lat, pt.lng]);

    // Render polyline rute darurat berpendar neon
    this.layerGroupsMap.forEach((groups, containerId) => {
      const simGroup = groups['emergency-sim-route'];
      const map = this.maps.get(containerId);
      if (!simGroup || !map) return;

      simGroup.clearLayers();

      // Glow polyline
      L.polyline(latlngs, {
        color: '#22c55e',
        weight: 12,
        opacity: 0.5,
        lineCap: 'round',
        className: 'pulse-emergency-route-glow'
      }).addTo(simGroup);

      // Core polyline with animated dashes
      L.polyline(latlngs, {
        color: '#00e5ff',
        weight: 5,
        opacity: 1,
        dashArray: '8, 8',
        className: 'emergency-route-active'
      }).addTo(simGroup);

      // Zoom ke rute darurat
      map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], maxZoom: 15 });
    });

    // Buat marker ambulans dengan sirene animasi dan efek pulse radar
    const ambIcon = L.divIcon({
      className: 'emergency-112-ambulance-icon',
      html: `
        <div style="position: relative; width: 44px; height: 28px;">
          <div class="amb-radar-ring"></div>
          <div class="amb-radar-ring ring-delay"></div>
          <div class="amb-siren-beacon">
            <span class="amb-flash-light red"></span>
            <span class="amb-flash-light blue"></span>
            <span class="amb-body">🚑 112</span>
          </div>
        </div>
      `,
      iconSize: [44, 28],
      iconAnchor: [22, 14]
    });

    const startCoord = latlngs[0];
    const ambMarker = L.marker(startCoord, { icon: ambIcon, zIndexOffset: 2000 });

    this.maps.forEach((map, containerId) => {
      const simGroup = this.layerGroupsMap.get(containerId)?.['emergency-sim-route'];
      if (simGroup) simGroup.addLayer(ambMarker);
    });

    this.emergency112Sim = {
      active: true,
      marker: ambMarker,
      routePoints: ROUTE_POINTS,
      latlngs,
      currentSeg: 0,
      segProgress: 0,
      clearedNodes: new Set(),
      pastNodes: new Set(),
      totalDurationSec: 40,
      startTime: performance.now(),
      onUpdate,
      onComplete
    };

    // Aktifkan Green Wave global di traffic engine
    stateStore.setState({ emergency112Active: true });
    stateStore.publish('traffic:green-wave', { active: true });
    soundManager.play('siren');

    // Tampilkan Floating Telemetry HUD
    this._renderEmergencyHud(true);

    // Jalankan loop animasi interpolasi posisi
    const runSimStep = (timestamp) => {
      if (!this.emergency112Sim.active) return;

      const sim = this.emergency112Sim;
      const elapsed = (timestamp - sim.startTime) / 1000;
      const progressRatio = Math.min(1, elapsed / sim.totalDurationSec);

      // Total segmen
      const numSegments = ROUTE_POINTS.length - 1;
      const totalProgress = progressRatio * numSegments;
      const currentSeg = Math.min(numSegments - 1, Math.floor(totalProgress));
      const segFraction = totalProgress - currentSeg;

      const p1 = ROUTE_POINTS[currentSeg];
      const p2 = ROUTE_POINTS[currentSeg + 1] || ROUTE_POINTS[currentSeg];

      // Lerp koordinat
      const curLat = p1.lat + (p2.lat - p1.lat) * segFraction;
      const curLng = p1.lng + (p2.lng - p1.lng) * segFraction;

      if (sim.marker) {
        sim.marker.setLatLng([curLat, curLng]);
      }

      // Deteksi radius 200 meter ke persimpangan (Green Wave Estafet)
      const APPROX_200M_DEG = 0.0019;
      const APPROX_LEAVE_DEG = 0.0028;

      ROUTE_POINTS.forEach(pt => {
        if (!pt.isIntersection) return;

        const dLat = pt.lat - curLat;
        const dLng = pt.lng - curLng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        // 1. Dekati simpang: Otomatis berubah HIJAU PRIORITAS
        if (dist <= APPROX_200M_DEG && !sim.clearedNodes.has(pt.id)) {
          sim.clearedNodes.add(pt.id);
          this._triggerIntersectionGreenWaveClearance(pt.id, pt.name);
        }

        // 2. Ambulans sudah melewati simpang: Kembalikan ke siklus normal (Estafet)
        if (sim.clearedNodes.has(pt.id) && !sim.pastNodes.has(pt.id)) {
          // Jika segmen sudah melewati titik simpang dan jaraknya menjauh > 250m
          const ptSegIdx = ROUTE_POINTS.findIndex(p => p.id === pt.id);
          if (currentSeg > ptSegIdx && dist > APPROX_LEAVE_DEG) {
            sim.pastNodes.add(pt.id);
            this._restoreIntersectionNormalCycle(pt.id, pt.name);
          }
        }
      });

      // Hitung telemetri HUD
      const etaSeconds = Math.max(0, Math.round((1 - progressRatio) * 165));
      const speedKmh = Math.round(58 + Math.sin(timestamp / 400) * 6);

      let nextNodeText = "RSU Dr. Soetomo: UGD ARRIVAL";
      for (let i = currentSeg; i < ROUTE_POINTS.length; i++) {
        if (ROUTE_POINTS[i].isIntersection && !sim.clearedNodes.has(ROUTE_POINTS[i].id)) {
          nextNodeText = `Simpang ${ROUTE_POINTS[i].name.replace('Simpang ', '')}: HIJAU PRIORITAS`;
          break;
        }
      }

      this._updateEmergencyHud({
        etaSeconds,
        speedKmh,
        nextIntersection: nextNodeText,
        progressPct: Math.round(progressRatio * 100)
      });

      if (typeof sim.onUpdate === 'function') {
        sim.onUpdate({ etaSeconds, speedKmh, nextIntersection: nextNodeText, progressPct: Math.round(progressRatio * 100) });
      }

      if (progressRatio >= 1) {
        this.stopEmergency112Simulation(true);
        if (typeof sim.onComplete === 'function') sim.onComplete();
        return;
      }

      this.emergency112Sim.animId = requestAnimationFrame(runSimStep);
    };

    this.emergency112Sim.animId = requestAnimationFrame(runSimStep);
  }

  /**
   * Preemption Clearance Otomatis Simpang APILL
   */
  _triggerIntersectionGreenWaveClearance(nodeId, nodeName) {
    const el = document.getElementById(`signal-marker-${nodeId}`);
    if (el) {
      el.classList.add('pulse-green-wave-clearance');
    }

    soundManager.play('siren');

    if (typeof window.showToast === 'function') {
      window.showToast(`🚨 GREEN WAVE ESTAFET: ${nodeName} OTOMATIS HIJAU PRIORITAS!`, 'warning');
    }
  }

  /**
   * Pemulihan Siklus Normal APILL setelah Ambulans Melintas
   */
  _restoreIntersectionNormalCycle(nodeId, nodeName) {
    const el = document.getElementById(`signal-marker-${nodeId}`);
    if (el) {
      el.classList.remove('pulse-green-wave-clearance');
    }

    if (typeof window.showToast === 'function') {
      window.showToast(`✓ ${nodeName}: Ambulans telah lewat, lampu kembali ke siklus normal.`);
    }
  }

  syncActiveEmergenciesFromState(activeEmergencies) {
    const ROUTES_DB_CLIENT = {
      "route-soetomo": [
        { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
        { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
        { name: "Simpang Margorejo", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-margorejo" },
        { name: "Simpang Jemursari", lat: -7.3100, lng: 112.7335 },
        { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
        { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
        { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
        { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
        { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
        { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
      ],
      "route-yani-darmo": [
        { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
        { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
        { name: "Simpang Margorejo", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-margorejo" },
        { name: "Simpang Jemursari", lat: -7.3100, lng: 112.7335 },
        { name: "Simpang Wonokromo (DTC)", lat: -7.2985, lng: 112.7345, isIntersection: true, id: "node-wonokromo" },
        { name: "Marmoyo / KBD", lat: -7.2920, lng: 112.7370 },
        { name: "Simpang Raya Darmo - Diponegoro", lat: -7.2810, lng: 112.7395, isIntersection: true, id: "node-darmo" },
        { name: "Jl. Urip Sumoharjo", lat: -7.2760, lng: 112.7430 },
        { name: "Jl. Ngagel - Dinoyo", lat: -7.2720, lng: 112.7480 },
        { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
      ],
      "route-merr-soetomo": [
        { name: "MERR Kertajaya", lat: -7.2850, lng: 112.7830 },
        { name: "Simpang MERR Kertajaya", lat: -7.2710, lng: 112.7565, isIntersection: true, id: "node-merr" },
        { name: "Gubeng", lat: -7.2645, lng: 112.7635 },
        { name: "RSUD Dr. Soetomo (UGD)", lat: -7.2690, lng: 112.7635, isEnd: true }
      ]
    };

    // 1. Clear any active emergency simulation route/vehicle markers on all maps if array is empty
    if (!Array.isArray(activeEmergencies) || activeEmergencies.length === 0) {
      this.layerGroupsMap.forEach((groups) => {
        const simGroup = groups['emergency-sim-route'];
        if (simGroup) simGroup.clearLayers();
      });
      this._renderEmergencyHud(false);
      if (this.activeEmergencyMarkers) {
        this.activeEmergencyMarkers.clear();
      }
      return;
    }

    // 2. Initialize our tracking map if not already present
    this.activeEmergencyMarkers = this.activeEmergencyMarkers || new Map();

    // 3. For each active emergency in the server-canonical state, render/update its route and marker
    activeEmergencies.forEach(emg => {
      const routePoints = ROUTES_DB_CLIENT[emg.routeId] || ROUTES_DB_CLIENT["route-soetomo"];
      const latlngs = routePoints.map(pt => [pt.lat, pt.lng]);

      // Ensure glowing corridor line is drawn on the map
      this.layerGroupsMap.forEach((groups, containerId) => {
        const simGroup = groups['emergency-sim-route'];
        const map = this.maps.get(containerId);
        if (!simGroup || !map) return;

        // Draw once if empty
        if (simGroup.getLayers().length === 0) {
          L.polyline(latlngs, {
            color: '#22c55e',
            weight: 12,
            opacity: 0.5,
            lineCap: 'round',
            className: 'pulse-emergency-route-glow'
          }).addTo(simGroup);

          L.polyline(latlngs, {
            color: '#00e5ff',
            weight: 5,
            opacity: 1,
            dashArray: '8, 8',
            className: 'emergency-route-active'
          }).addTo(simGroup);

          map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], maxZoom: 15 });
        }
      });

      // Render/update the vehicle marker
      const markerId = emg.id;
      let existingMarkerInfo = this.activeEmergencyMarkers.get(markerId);

      const isPmk = emg.vehicleType === "PMK";
      const iconHtml = `
        <div style="position: relative; width: 44px; height: 28px;">
          <div class="amb-radar-ring ${isPmk ? 'pmk' : ''}"></div>
          <div class="amb-radar-ring ring-delay ${isPmk ? 'pmk' : ''}"></div>
          <div class="amb-siren-beacon">
            <span class="amb-flash-light red"></span>
            <span class="amb-flash-light blue"></span>
            <span class="amb-body">${isPmk ? '🚒' : '🚑'} ${emg.vehicleId}</span>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'emergency-112-ambulance-icon',
        html: iconHtml,
        iconSize: [44, 28],
        iconAnchor: [22, 14]
      });

      if (!existingMarkerInfo) {
        // Create new markers on all maps
        const markers = [];
        this.maps.forEach((map, containerId) => {
          const simGroup = this.layerGroupsMap.get(containerId)?.['emergency-sim-route'];
          if (simGroup) {
            const marker = L.marker(emg.currentPosition, { icon: customIcon, zIndexOffset: 2000 }).addTo(simGroup);
            
            const popupContent = `
              <div class="ios-popup-card vehicle-popup">
                <div class="ios-popup-header">
                  <span class="cctv-live-tag alert"><span class="live-dot"></span> PRIORITAS UTAMA</span>
                  <span class="ios-popup-subtitle">${emg.vehicleType.toUpperCase()} STATUS: ${emg.status}</span>
                </div>
                <h4 class="ios-popup-title">${isPmk ? '🚒' : '🚑'} ${emg.vehicleId}</h4>
                <div class="ios-popup-info-grid">
                  <div class="ios-info-row">
                    <span class="ios-info-label">Kecepatan:</span>
                    <span class="ios-info-value speed-val" style="color: #ef4444; font-weight: 800;">${emg.speed} km/jam</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Asal:</span>
                    <span class="ios-info-value">${emg.origin}</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Tujuan:</span>
                    <span class="ios-info-value">${emg.destination}</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Simpang Depan:</span>
                    <span class="ios-info-value text-primary-2">${emg.nextIntersection || 'Menuju UGD'}</span>
                  </div>
                </div>
              </div>
            `;
            marker.bindPopup(popupContent, { maxWidth: 300 });
            markers.push({ mapId: containerId, marker });
          }
        });

        this.activeEmergencyMarkers.set(markerId, { markers, lastPos: emg.currentPosition });
      } else {
        // Update marker position on all maps
        existingMarkerInfo.markers.forEach(({ marker }) => {
          marker.setLatLng(emg.currentPosition);
          
          // Dynamically update popup contents if open
          if (marker.isPopupOpen()) {
            const popupContent = `
              <div class="ios-popup-card vehicle-popup">
                <div class="ios-popup-header">
                  <span class="cctv-live-tag alert"><span class="live-dot"></span> PRIORITAS UTAMA</span>
                  <span class="ios-popup-subtitle">${emg.vehicleType.toUpperCase()} STATUS: ${emg.status}</span>
                </div>
                <h4 class="ios-popup-title">${isPmk ? '🚒' : '🚑'} ${emg.vehicleId}</h4>
                <div class="ios-popup-info-grid">
                  <div class="ios-info-row">
                    <span class="ios-info-label">Kecepatan:</span>
                    <span class="ios-info-value speed-val" style="color: #ef4444; font-weight: 800;">${emg.speed} km/jam</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Asal:</span>
                    <span class="ios-info-value">${emg.origin}</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Tujuan:</span>
                    <span class="ios-info-value">${emg.destination}</span>
                  </div>
                  <div class="ios-info-row">
                    <span class="ios-info-label">Simpang Depan:</span>
                    <span class="ios-info-value text-primary-2">${emg.nextIntersection || 'Menuju UGD'}</span>
                  </div>
                </div>
              </div>
            `;
            marker.setPopupContent(popupContent);
          }
        });
        existingMarkerInfo.lastPos = emg.currentPosition;
      }

      // Update the floating telemetry HUD
      this._renderEmergencyHud(true);
      this._updateEmergencyHud({
        etaSeconds: Math.round(emg.progress >= 1.0 ? 0 : (1 - emg.progress) * 165),
        speedKmh: emg.speed,
        nextIntersection: emg.status === "ARRIVED" ? "RSUD Dr. Soetomo: UGD ARRIVAL" : emg.nextIntersection,
        progressPct: Math.round(emg.progress * 100)
      });
    });
  }

  updateIncidentsOnMap(incidents) {
    if (!Array.isArray(incidents)) return;

    this.layerGroupsMap.forEach((groups, containerId) => {
      const map = this.maps.get(containerId);
      const incidentGroup = groups['warn-points'];
      if (!map || !incidentGroup) return;

      incidentGroup.clearLayers();

      const layers = [];
      incidents.forEach(inc => {
        // Only render non-archived incidents on map
        if (inc.status === "ARCHIVED") return;

        const severity = inc.severity || "warning";
        const customIcon = L.divIcon({
          className: 'custom-incident-div-icon',
          html: `<div class="leaflet-incident-marker ${severity === 'danger' ? 'danger' : 'warning'}" style="background: ${severity === 'danger' ? '#ef4444' : '#f59e0b'};" title="${inc.title}">⚠️</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        // Use coordinate if provided, else fallback to a default coordinate based on ID
        const coords = inc.coordinates || [-7.2985, 112.7345];
        const marker = L.marker(coords, { icon: customIcon });

        const popupContent = `
          <div class="ios-popup-card incident-popup">
            <div class="ios-popup-header alert">
              <span class="alert-pill">⚠️ INSIDEN ${inc.category ? inc.category.toUpperCase() : 'TRAFFIC'}</span>
              <span class="ios-popup-subtitle">STATUS: ${inc.status}</span>
            </div>
            <h4 class="ios-popup-title">${inc.title}</h4>
            <div class="ios-popup-info-grid">
              <div class="ios-info-row">
                <span class="ios-info-label">Lokasi:</span>
                <span class="ios-info-value">${inc.location || 'Surabaya'}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Unit Disposisi:</span>
                <span class="ios-info-value text-primary-2" style="color: #00e5ff;">${inc.assignedUnit || 'Belum Ditugaskan'}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Keterangan:</span>
                <span class="ios-info-value" style="font-family: inherit; font-weight: normal; color: #cbd5e1;">${inc.notes || 'Hambatan lajur terdeteksi.'}</span>
              </div>
            </div>
          </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 300 });
        layers.push(marker);
      });

      // Use Leaflet's native layer addition or safeAddLayers
      layers.forEach(l => l.addTo(incidentGroup));
    });
  }

  /**
   * Render Floating Telemetry HUD di Atas Peta
   */
  _renderEmergencyHud(show) {
    const containers = ['map-surabaya', 'dashboardMapBox'];

    containers.forEach(id => {
      const parent = document.getElementById(id);
      if (!parent) return;

      let hud = parent.querySelector('.emergency-floating-hud');
      if (!show) {
        if (hud) hud.remove();
        return;
      }

      if (!hud) {
        hud = document.createElement('div');
        hud.className = 'emergency-floating-hud glass-panel';
        hud.innerHTML = `
          <div class="efh-header">
            <div class="efh-title-wrap">
              <span class="efh-pulse-dot"></span>
              <strong>SIMULASI RUTE TANGGAP DARURAT 112</strong>
            </div>
            <button class="efh-close-btn" type="button" title="Hentikan Simulasi">✕ Hentikan</button>
          </div>
          <div class="efh-body">
            <div class="efh-stat">
              <small>ETA RSUD SOETOMO</small>
              <strong id="efh-eta" class="efh-val-primary">02:40</strong>
            </div>
            <div class="efh-stat">
              <small>KECEPATAN LIVE</small>
              <strong id="efh-speed" class="efh-val-speed">78 km/j</strong>
            </div>
            <div class="efh-stat efh-stat-wide">
              <small>STATUS CLEARANCE SIMPANG</small>
              <strong id="efh-node" class="efh-val-node">Simpang Margorejo: PREEMPTING</strong>
            </div>
          </div>
          <div class="efh-progress-bar">
            <div class="efh-progress-fill" id="efh-progress"></div>
          </div>
        `;

        hud.querySelector('.efh-close-btn').addEventListener('click', () => {
          this.stopEmergency112Simulation(false);
          soundManager.play('click');
        });

        parent.appendChild(hud);
      }
    });
  }

  /**
   * Update Data Floating Telemetry HUD
   */
  _updateEmergencyHud({ etaSeconds, speedKmh, nextIntersection, progressPct }) {
    const mins = Math.floor(etaSeconds / 60);
    const secs = etaSeconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    document.querySelectorAll('#efh-eta').forEach(el => el.textContent = timeStr);
    document.querySelectorAll('#efh-speed').forEach(el => el.textContent = `${speedKmh} km/j`);
    document.querySelectorAll('#efh-node').forEach(el => el.textContent = nextIntersection);
    document.querySelectorAll('#efh-progress').forEach(el => el.style.width = `${progressPct}%`);
  }

  /**
   * Hentikan Simulasi Rute Tanggap Darurat 112
   */
  stopEmergency112Simulation(isFinished = false) {
    if (this.emergency112Sim && this.emergency112Sim.animId) {
      cancelAnimationFrame(this.emergency112Sim.animId);
    }

    this.emergency112Sim.active = false;

    // Bersihkan rute dan marker dari layer
    this.layerGroupsMap.forEach(groups => {
      const simGroup = groups['emergency-sim-route'];
      if (simGroup) simGroup.clearLayers();
    });

    this._renderEmergencyHud(false);

    // Kembalikan status sinyal ke siklus normal
    stateStore.setState({ emergency112Active: false });
    stateStore.publish('traffic:green-wave', { active: false });

    // Hapus seluruh kelas clearance dari marker simpang di DOM
    document.querySelectorAll('.pulse-green-wave-clearance').forEach(el => {
      el.classList.remove('pulse-green-wave-clearance');
    });

    // Hapus kelas animasi preemption pada marker
    document.querySelectorAll('.pulse-green-wave-clearance').forEach(el => {
      el.classList.remove('pulse-green-wave-clearance');
    });

    if (isFinished) {
      soundManager.play('success');
      if (typeof window.showToast === 'function') {
        window.showToast('✅ AMBULANS 112 TIBA DI RSUD DR. SOETOMO! Seluruh sinyal kembali ke siklus normal.');
      }
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast('Simulasi Tanggap Darurat 112 dihentikan.');
      }
    }
  }

  /**
   * Pan dan Zoom ke Lokasi Spesifik
   */
  flyToLocation(locationName) {
    let target = [SURABAYA_CENTER.lat, SURABAYA_CENTER.lng];
    let targetZoom = 15;

    const locLower = (locationName || '').toLowerCase();
    if (locLower.includes('wonokromo')) target = [-7.2985, 112.7345];
    else if (locLower.includes('tunjungan') || locLower.includes('siola')) target = [-7.2625, 112.7375];
    else if (locLower.includes('darmo')) target = [-7.2810, 112.7395];
    else if (locLower.includes('soetomo') || locLower.includes('rsud')) target = [-7.2690, 112.7635];
    else if (locLower.includes('merr')) target = [-7.2740, 112.7815];

    this.maps.forEach(map => {
      map.flyTo(target, targetZoom, { duration: 1.5, easeLinearity: 0.25 });
    });
  }

  /**
   * Update visualisasi warna/tebal garis koridor pada peta berdasarkan jam Time-Travel (00:00 - 23:00)
   * Menyesuaikan kondisi jam sibuk pagi (07:00-09:00) dan sore (17:00-19:00)
   */
  updateCorridorLoadByHour(hour) {
    const isPeak = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19);
    const isMid = (hour >= 10 && hour <= 15) || (hour >= 20 && hour <= 21);

    const color = isPeak ? '#ef4444' : (isMid ? '#f59e0b' : '#10b981');
    const weight = isPeak ? 8 : (isMid ? 5 : 4);
    const opacity = isPeak ? 0.95 : (isMid ? 0.8 : 0.7);

    // Update tracked corridor layers
    this.corridorGeoJsonLayers.forEach(({ glow, core }) => {
      if (glow && typeof glow.setStyle === 'function') {
        glow.setStyle({ color, weight: weight + 4, opacity: opacity * 0.5 });
      }
      if (core && typeof core.setStyle === 'function') {
        core.setStyle({
          color,
          weight,
          opacity,
          className: isPeak ? 'corridor-congested-flow' : 'corridor-smooth-flow'
        });
      }
    });

    this.layerGroupsMap.forEach(groups => {
      const roadGroup = groups['road-glows'] || groups['corridors'];
      if (roadGroup) {
        roadGroup.eachLayer(layer => {
          if (typeof layer.setStyle === 'function') {
            layer.setStyle({ color, weight, opacity });
          }
        });
      }
    });
  }

  /**
   * Alias untuk memulai simulasi ambulans darurat dari form aktuator
   */
  startEmergencyAmbulanceSimulation(onUpdate, onComplete) {
    return this.startEmergency112Simulation(onUpdate, onComplete);
  }

  _handlePopupOpen(e, containerId) {
    const popup = e.popup;
    const node = popup.getElement();
    if (!node) return;

    // Check if it's a CCTV popup
    const titleEl = node.querySelector('.ios-popup-title');
    if (titleEl && titleEl.textContent.includes('CCTV')) {
      const name = titleEl.textContent.replace('📷 ', '').trim();
      
      const state = stateStore.getState();
      const metricsMap = state.cctvCamerasMetrics || {};
      
      let matchedCamId = null;
      let matchedCam = null;

      for (const [camId, cam] of Object.entries(metricsMap)) {
        if (name.toLowerCase().includes(cam.name.toLowerCase()) || cam.name.toLowerCase().includes(name.toLowerCase())) {
          matchedCamId = camId;
          matchedCam = cam;
          break;
        }
      }

      if (matchedCam) {
        popup._liveSyncInterval = setInterval(() => {
          const freshState = stateStore.getState();
          const freshCam = freshState.cctvCamerasMetrics?.[matchedCamId];
          if (!freshCam) return;

          const infoGrid = node.querySelector('.ios-popup-info-grid');
          if (infoGrid) {
            infoGrid.innerHTML = `
              <div class="ios-info-row">
                <span class="ios-info-label">Status Kamera:</span>
                <span class="ios-info-value" style="color:${freshCam.status === 'ONLINE' ? '#10b981' : '#f59e0b'}; font-weight:800;">${freshCam.status}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Volume Kendaraan:</span>
                <span class="ios-info-value" style="color:#00e5ff; font-weight:800;">${freshCam.metrics.vehicleCount} Unit</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Panjang Antrean:</span>
                <span class="ios-info-value" style="color:#ef4444; font-weight:700;">${freshCam.metrics.queueLengthMeters} Meter</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val" style="color:#22c55e;">${freshCam.metrics.estimatedAverageSpeed} km/jam</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kepadatan Jalan:</span>
                <span class="ios-info-value" style="color:#f59e0b;">${freshCam.metrics.trafficDensity}%</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Resiko Insiden:</span>
                <span class="ios-info-value" style="color:${freshCam.metrics.incidentRisk > 70 ? '#ef4444' : '#10b981'};">${freshCam.metrics.incidentRisk}%</span>
              </div>
            `;
          }
        }, 300);
      }
    }
  }

  _handlePopupClose(e, containerId) {
    const popup = e.popup;
    if (popup._liveSyncInterval) {
      clearInterval(popup._liveSyncInterval);
      delete popup._liveSyncInterval;
    }
  }

  /**
   * Cleanup resource saat destroy
   */
  destroy() {
    this.stopEmergency112Simulation();
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.maps.forEach(map => map.remove());
    this.maps.clear();
    this.tileLayers.clear();
  }
}

export const mapManager = new MapManager();
