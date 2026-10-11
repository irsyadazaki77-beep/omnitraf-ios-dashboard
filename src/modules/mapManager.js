/**
 * OmniTRAF Surabaya - Map Manager (Enterprise GIS Engine with Leaflet.js)
 * High-Performance Basemap, Marker Clustering, Z-Index/Map-Pane Management,
 * Spatial Projection Architecture, and 60 FPS Normalized Euclidean Distance Animation.
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
  SITS_CCTV_CAMERAS_GEOJSON
} from '../config/surabayaCoords.js';
import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { Disposer } from '../core/disposer.js';
import { diagnostics } from '../core/diagnostics.js';
import { CAMERA_DEFINITIONS } from './cctv/cameraRegistry.js';

import { createCartoTileLayer, getBasemapTileUrl, safeAddLayers, createClusterGroup, layerManager } from './map/layerManager.js';
import { markerManager } from './map/markerManager.js';
import { popupManager } from './map/popupManager.js';
import { mapControls } from './map/mapControls.js';
import { emergencyRouteAnimator, calculateDistance } from './map/emergencyRouteAnimator.js';
import { spatialStateSync } from './map/spatialStateSync.js';
import { toSignalMarkerProjection, toIncidentMarkerProjection } from './map/spatialDomainAdapter.js';
import {
  geoJsonToLeaflet,
  leafletToGeoJson,
  validateGeoJson,
  calculateVisualDistance,
  calculateOperationalDistanceMeters
} from './map/coordinateUtils.js';

export {
  createCartoTileLayer,
  safeAddLayers,
  createClusterGroup,
  calculateDistance,
  calculateVisualDistance,
  calculateOperationalDistanceMeters,
  geoJsonToLeaflet,
  leafletToGeoJson,
  validateGeoJson,
  layerManager,
  markerManager,
  popupManager,
  mapControls,
  emergencyRouteAnimator,
  spatialStateSync
};

/**
 * Map speed to level of service (LOS), dynamic colors, density classes and labels
 * @param {number} speed - actual or simulated speed in km/h
 * @returns {Object} { vc, los, color, densityClass, label }
 */
export function getCorridorLOS(speed) {
  let vc, los, color, densityClass, label;
  if (speed <= 14) {
    vc = 0.89;
    los = "F";
    color = "#7f1d1d"; // Dark Red
    densityClass = "los-f-gridlock";
    label = "Gridlock / Macet Total (LOS F)";
  } else if (speed <= 25) {
    vc = 0.78;
    los = "D/E";
    color = "#f97316"; // Orange
    densityClass = "los-de-congested";
    label = "Padat (LOS D/E)";
  } else if (speed <= 40) {
    vc = 0.58;
    los = "C";
    color = "#eab308"; // Yellow
    densityClass = "los-c-moderate";
    label = "Padat Lancar (LOS C)";
  } else {
    vc = 0.28;
    los = "A/B";
    color = "#22c55e"; // Green/Emerald
    densityClass = "los-ab-smooth";
    label = "Lancar (LOS A/B)";
  }
  return { vc, los, color, densityClass, label };
}

export class MapManager {
  constructor() {
    /** @type {Map<string, L.Map>} Map instance storage keyed by container ID */
    this.maps = new Map();
    this.tileLayers = new Map();
    this.isActive = false;
    this._invalidateTimer = null;
    this.disposer = new Disposer('MapManager');
    this.activationDisposer = new Disposer('MapManager-activation');

    /** Store references to corridor GeoJSON layers across map instances */
    this.corridorGeoJsonLayers = [];

    this.activeEmergencyMarkers = new Map();

    this.layerGroupsMap = new Map();
    this.intersectionMarkersMap = new Map();
    this.weatherWidgets = new Map();
    this.currentRoadCondition = 'dry'; // 'dry' | 'wet'

    // Subsystem delegates
    this.layerManager = layerManager;
    this.markerManager = markerManager;
    this.popupManager = popupManager;
    this.mapControls = mapControls;
    this.emergencyRouteAnimator = emergencyRouteAnimator;
    this.spatialStateSync = spatialStateSync;
    this._setupStoreListeners();
    this._setupWindowListeners();

    if (typeof window !== 'undefined') {
      window.handleCorridorCctv = (corridorId) => {
        stateStore.setState({ currentView: 'cctv' });
        soundManager.play('click');
        if (typeof window.showToast === 'function') {
          window.showToast(`Membuka adegan kamera simulasi untuk koridor: ${corridorId}`);
        }
      };
      window.handleCorridorApill = (corridorId) => {
        stateStore.setState({ currentView: 'signals' });
        soundManager.play('click');
        if (typeof window.showToast === 'function') {
          window.showToast(`Menampilkan state fase sinyal demo untuk koridor: ${corridorId}; APILL tidak terhubung.`);
        }
      };
    }
  }

  get currentLayerMode() {
    return this.layerManager.currentMode;
  }

  set currentLayerMode(mode) {
    this.layerManager.currentMode = mode;
  }

  get emergency112Sim() {
    return this.emergencyRouteAnimator.emergency112Sim;
  }

  _setupStoreListeners() {
    this.disposer.addStoreSubscription(stateStore, 'state:currentView', ({ value }) => {
      this.initAllMaps();
      this.debouncedInvalidateSize(200);
    });

    this.disposer.addStoreSubscription(stateStore, 'traffic:green-wave', ({ active }) => {
      this.updateGreenWaveVisuals(active);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:isChaosMode', ({ value }) => {
      this.updateChaosVisuals(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:activeEmergencies', ({ value }) => {
      this.syncActiveEmergenciesFromState(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:incidents', ({ value }) => {
      this.updateIncidentsOnMap(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:intersections', ({ value }) => {
      this.syncIntersectionsFromState(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:devices', ({ value }) => {
      this.updateDeviceMapVisuals(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:theme', ({ value }) => {
      this.updateTileTheme(value);
    });
  }

  _setupWindowListeners() {
    if (typeof window === 'undefined') return;

    this.disposer.addEventListener(window, 'resize', () => {
      this.debouncedInvalidateSize(200);
    });

    this.disposer.addEventListener(document, 'visibilitychange', () => {
      if (!document.hidden) this.debouncedInvalidateSize(200);
    });
  }

  debouncedInvalidateSize(delay = 150) {
    if (this._invalidateTimer) {
      clearTimeout(this._invalidateTimer);
    }
    this._invalidateTimer = setTimeout(() => {
      this.invalidateSize();
      this._invalidateTimer = null;
    }, delay);
  }

  updateDeviceMapVisuals(devices) {
    this.spatialStateSync.syncDeviceVisuals(devices);
  }

  init() {
    // Left empty since activate() manages dynamic bindings cleanly on activation
  }

  activate() {
    this.deactivate(); // Ensure deterministic cleanup first
    this.isActive = true;

    this.initAllMaps();
    this._bindZoomControls();
    this._bindLandmarkHUDClose();
    this.activationDisposer.addEventListener(window, 'omnitraf:entity-focus', (event) => this._handleEntityFocus(event.detail));
    this.mapControls.bindToolbarAndDrawer(
      this.activationDisposer,
      this.maps,
      this.layerManager,
      () => this.startEmergency112Simulation()
    );

    setTimeout(() => {
      this.invalidateSize();
    }, 150);

  }

  deactivate() {
    this.isActive = false;
    if (this._invalidateTimer) {
      clearTimeout(this._invalidateTimer);
      this._invalidateTimer = null;
    }
    this.stopEmergency112Simulation();
    this.popupManager.unbindCctvLiveSync();
    this.activationDisposer.clear();
  }

  _bindZoomControls() {
    if (typeof document === 'undefined') return;
    const zoomInBtns = document.querySelectorAll("#btnMapZoomIn, #btnFullMapZoomIn, .btn-zoom-in");
    const zoomOutBtns = document.querySelectorAll("#btnMapZoomOut, #btnFullMapZoomOut, .btn-zoom-out");
    const zoomResetBtns = document.querySelectorAll("#btnMapZoomReset, #btnFullMapReset, .btn-zoom-reset");

    zoomInBtns.forEach(btn => {
      this.activationDisposer.addEventListener(btn, "click", () => {
        this.mapControls.zoomIn(this.maps);
        soundManager.play('click');
      });
    });

    zoomOutBtns.forEach(btn => {
      this.activationDisposer.addEventListener(btn, "click", () => {
        this.mapControls.zoomOut(this.maps);
        soundManager.play('click');
      });
    });

    zoomResetBtns.forEach(btn => {
      this.activationDisposer.addEventListener(btn, "click", () => {
        this.resetViewport();
        soundManager.play('click');
        if (typeof window.showToast === 'function') {
          window.showToast("✓ Viewport peta dipusatkan kembali ke Surabaya.");
        }
      });
    });

    const search = document.getElementById('mapIntersectionSearch');
    const clearSearch = document.getElementById('mapSearchClear');
    if (search) {
      this.activationDisposer.addEventListener(search, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        const query = search.value.trim().toLocaleLowerCase();
        if (!query) return;
        const match = (stateStore.getState().intersections || []).find((node) =>
          `${node.name || ''} ${node.id || ''}`.toLocaleLowerCase().includes(query)
        );
        if (match) this.flyToIntersection(match.id || match.name);
        else if (typeof window.showToast === 'function') window.showToast('Simpang tidak ditemukan pada model.', 'warning');
      });
      this.activationDisposer.addEventListener(search, 'input', () => {
        if (clearSearch) clearSearch.hidden = !search.value;
      });
    }
    if (clearSearch && search) this.activationDisposer.addEventListener(clearSearch, 'click', () => {
      search.value = '';
      clearSearch.hidden = true;
      search.focus();
    });

    const inspector = document.getElementById('mapEntityInspector');
    const closeInspector = document.getElementById('btnCloseMapInspector');
    if (closeInspector && inspector) this.activationDisposer.addEventListener(closeInspector, 'click', () => {
      inspector.hidden = true;
      document.getElementById('mapIntersectionSearch')?.focus({ preventScroll: true });
    });
    const inspectorLinks = document.getElementById('mapInspectorLinks');
    if (inspectorLinks) this.activationDisposer.addEventListener(inspectorLinks, 'click', (event) => {
      const link = event.target.closest('a[data-view]');
      if (!link || !this.selectedMapEntity) return;
      const route = link.dataset.view;
      const kind = route === 'cctv' ? 'cctv' : this.selectedMapEntity.kind;
      const id = route === 'cctv' ? this.selectedMapEntity.cameraId : this.selectedMapEntity.id;
      if (!id) return;
      const focus = { kind, id, route };
      stateStore.setState({ pendingEntityFocus: focus });
      if (window.location.hash === `#${route}`) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('omnitraf:entity-focus', { detail: focus }));
        stateStore.setState({ pendingEntityFocus: null });
      }
    });

    const roadConditionToggles = document.querySelectorAll(
      '#btnToggleRoadCond-dashboardMapBox, #btnToggleRoadCond-map-surabaya'
    );
    roadConditionToggles.forEach((roadConditionToggle) => {
      const syncLabel = () => {
        const isWet = this.currentRoadCondition === 'wet';
        roadConditionToggle.textContent = isWet ? 'Ganti ke kering' : 'Ganti ke hujan';
        roadConditionToggle.setAttribute('aria-label', `Ganti kondisi jalan simulasi saat ini ${isWet ? 'basah' : 'kering'}`);
      };
      syncLabel();
      this.activationDisposer.addEventListener(roadConditionToggle, 'click', (event) => {
        event.stopPropagation();
        this.toggleRoadCondition();
        soundManager.play('click');
      });
    });
  }

  _handleEntityFocus(request) {
    if (!request || request.route !== 'map') return;
    let target = null;
    if (request.kind === 'intersection') target = this.intersectionMarkersMap.get(String(request.id))?.marker;
    if (request.kind === 'incident') {
      for (const groups of this.layerGroupsMap.values()) {
        target = groups['warn-points']?._omniIncidentMarkers?.get(String(request.id))?.marker;
        if (target) break;
      }
    }
    if (request.kind === 'cctv') {
      for (const groups of this.layerGroupsMap.values()) {
        groups['landmark-group']?.eachLayer((layer) => {
          if (layer._omniCameraId === String(request.id)) target = layer;
        });
        if (target) break;
      }
    }
    if (!target) {
      if (typeof window.showToast === 'function') window.showToast('Entity tidak tersedia pada peta yang dimuat.', 'warning');
      return;
    }
    const map = this.maps.get('map-surabaya');
    if (!map) return;
    const open = () => target.openPopup?.();
    const latlng = target.getLatLng?.();
    if (latlng) map.flyTo(latlng, 17, { duration: .8 });
    const cluster = this.layerGroupsMap.get('map-surabaya')?.['master-cluster'];
    if (cluster?.zoomToShowLayer) cluster.zoomToShowLayer(target, open);
    else setTimeout(open, 500);
  }

  _bindLandmarkHUDClose() {
    if (typeof document === 'undefined') return;
    const closeBtn = document.getElementById("btnCloseLandmarkCard");
    const card = document.getElementById("landmarkDetailCard");
    if (closeBtn && card) {
      this.activationDisposer.addEventListener(closeBtn, "click", () => {
        card.classList.add("is-hidden");
        soundManager.play('click');
      });
    }
  }

  initAllMaps() {
    if (typeof document === 'undefined') return;
    const containers = ['map-surabaya', 'dashboardMapBox'];
    containers.forEach(id => {
      if (document.getElementById(id)) {
        this.initMap(id);
      }
    });
  }

  initMap(containerId = 'map-surabaya') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container || typeof L === 'undefined') return;

    // Fast-path: Invalidate existing map instead of recreating
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

    // 2. Base Tile Layer
    const currentTheme = stateStore.getState().theme || 'dark';
    const isDark = currentTheme === 'dark';
    const tileLayer = createCartoTileLayer(isDark).addTo(map);

    this.tileLayers.set(containerId, tileLayer);

    // 3. Register Layer Groups & Marker Cluster
    const masterCluster = createClusterGroup('master').addTo(map);
    const layerGroups = this.layerManager.registerLayers(containerId, map, masterCluster);
    this.layerGroupsMap.set(containerId, layerGroups);
    this.maps.set(containerId, map);

    map.on('popupopen', (e) => {
      this._handlePopupOpen(e, containerId);
    });
    map.on('popupclose', (e) => {
      this._handlePopupClose(e, containerId);
    });
    map.on('contextmenu', (e) => {
      if (e.originalEvent) e.originalEvent.preventDefault();
      const menu = document.getElementById('mapContextMenu');
      if (!menu) return;
      this.mapControls.setLastRightClickLatLng(e.latlng);
      menu.style.display = 'flex';
      const x = Math.min(window.innerWidth - 220, e.originalEvent.clientX);
      const y = Math.min(window.innerHeight - 240, e.originalEvent.clientY);
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.setAttribute('aria-hidden', 'false');
    });

    // 4. Render spatial datasets using GeoJSON & projections
    this.drawCorridors(map, layerGroups['road-glows'], layerGroups['minor-roads']);
    this.drawRiver(map, layerGroups['map-river']);
    this.drawDistricts(map, layerGroups['district-zones']);
    this.drawIncidents(map, layerGroups['warn-points'], masterCluster);
    this.drawLandmarksAndCctv(map, layerGroups['landmark-group'], masterCluster);
    this.drawIntersections(map, layerGroups['signal-points'], masterCluster);
    this.drawDensityHeatmap(map, layerGroups['density-heat']);
    this.createMapLayerSwitcher(map, containerId);
    this.createWeatherWidget(map, containerId);

    // Record diagnostics
    let totalLayers = Object.keys(layerGroups).length;
    diagnostics.recordMapLayersCount(totalLayers);

    setTimeout(() => map.invalidateSize(), 250);
  }

  drawCorridors(map, glowGroup, minorGroup) {
    if (!map) return;

    const corridorGeoJson = L.geoJSON(SURABAYA_CORRIDORS_GEOJSON, {
      style: (feature) => {
        const speed = feature.properties.speed || 30;
        const los = getCorridorLOS(speed);
        return {
          color: los.color,
          weight: (feature.properties.weight || 5) + 4,
          opacity: 0.4,
          className: 'corridor-neon-glow',
          lineCap: 'round',
          lineJoin: 'round'
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const speed = p.speed || 30;
        const los = getCorridorLOS(speed);
        layer.bindPopup(this.popupManager.createCorridorPopupContent(p, los), { maxWidth: 300 });
      }
    });

    const coreGeoJson = L.geoJSON(SURABAYA_CORRIDORS_GEOJSON, {
      style: (feature) => {
        const speed = feature.properties.speed || 30;
        const los = getCorridorLOS(speed);
        return {
          color: los.color,
          weight: feature.properties.weight || 5,
          opacity: 0.95,
          className: los.densityClass,
          lineCap: 'round',
          lineJoin: 'round'
        };
      }
    });

    glowGroup.addLayer(corridorGeoJson);
    glowGroup.addLayer(coreGeoJson);

    this.corridorGeoJsonLayers.push({ glow: corridorGeoJson, core: coreGeoJson });
    this.layerManager.corridorGeoJsonLayers = this.corridorGeoJsonLayers;

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

  drawDistricts(map, districtGroup) {
    if (!map) return;
    const districtGeoJson = L.geoJSON(SURABAYA_DISTRICTS_GEOJSON, {
      style: (feature) => ({
        color: feature.properties.color || '#38bdf8',
        weight: 1.5,
        opacity: 0.45,
        fillColor: feature.properties.color || '#38bdf8',
        fillOpacity: 0.04
      }),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`📍 Wilayah: ${feature.properties.name}`, { sticky: true });
      }
    });
    districtGroup.addLayer(districtGeoJson);
  }

  drawIncidents(map, incidentGroup, masterCluster) {
    if (!map) return;

    const incidentGeoJson = L.geoJSON(SURABAYA_INCIDENTS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const marker = L.marker(latlng, { icon: this.markerManager.createIncidentIcon('warning', feature.properties.name) });
        marker._omniMarkerType = 'incident';
        marker._omniEntityId = feature.properties.id;
        return marker;
      },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(this.popupManager.createIncidentPopupContent(feature.properties), { maxWidth: 300 });
      }
    });

    const layers = [];
    incidentGeoJson.eachLayer(layer => {
      layers.push(layer);
      if (incidentGroup) incidentGroup.addLayer(layer);
      if (masterCluster) masterCluster.addLayer(layer);
    });
  }

  drawLandmarksAndCctv(map, landmarkGroup, masterCluster) {
    if (!map) return;

    const cctvGeoJson = L.geoJSON(SITS_CCTV_CAMERAS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const p = feature.properties;
        const cctvIcon = L.divIcon({
          className: 'custom-cctv-div-icon',
          html: `<div class="leaflet-cctv-marker">📷 ${p.name}</div>`,
          iconSize: [120, 24],
          iconAnchor: [60, 12]
        });
        const marker = L.marker(latlng, { icon: cctvIcon });
        marker._omniMarkerType = 'cctv';
        marker._omniEntityId = p.id;
        marker._omniCameraId = CAMERA_DEFINITIONS.find((camera) => camera.name.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 4).some((part) => p.name.toLocaleLowerCase().includes(part)))?.id || null;
        marker.feature = feature;
        return marker;
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <div class="ios-popup-card cctv-popup">
            <div class="ios-popup-header">
              <span class="cctv-live-tag">KAMERA SIMULASI</span>
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
        marker._omniMarkerType = 'landmark';
        marker.bindTooltip(p.name, { sticky: true });
        return marker;
      }
    });

    cctvGeoJson.eachLayer(layer => {
      if (landmarkGroup) landmarkGroup.addLayer(layer);
      if (masterCluster) masterCluster.addLayer(layer);
    });
    landmarkGeoJson.eachLayer(layer => {
      if (landmarkGroup) landmarkGroup.addLayer(layer);
      if (masterCluster) masterCluster.addLayer(layer);
    });
  }

  drawIntersections(map, signalGroup, masterCluster) {
    if (!map) return;

    const signalGeoJson = L.geoJSON(SITS_INTERSECTIONS_GEOJSON, {
      pointToLayer: (feature, latlng) => {
        const liveStateNode = stateStore.getState().intersections?.find(n => n.id === feature.properties.id);
        const projection = toSignalMarkerProjection(feature, liveStateNode);

        const nodeIcon = this.markerManager.createSignalIcon(projection.id, projection.stateColor);
        const marker = L.marker(latlng, { icon: nodeIcon });
        marker._omniMarkerType = 'signal';
        marker._omniEntityId = projection.id;

        this.intersectionMarkersMap.set(projection.id, { marker, feature, latlng, id: projection.id, name: projection.name });
        this.markerManager.intersectionMarkersMap.set(projection.id, { marker, feature, latlng, id: projection.id, name: projection.name });

        marker.bindPopup(this.popupManager.createIntersectionPopupContent(feature.properties, liveStateNode), { maxWidth: 300 });
        return marker;
      }
    });

    signalGeoJson.eachLayer(layer => {
      if (signalGroup) signalGroup.addLayer(layer);
      if (masterCluster) masterCluster.addLayer(layer);
    });
  }

  updateGreenWaveVisuals(active) {
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

  updateCorridorLoadByHour(hour) {
    const h = Number(hour);
    const isPeak = (h >= 7 && h <= 9) || (h >= 16 && h <= 19);
    const isMid = (h >= 10 && h <= 15) || (h >= 20 && h <= 21);

    this.corridorGeoJsonLayers.forEach(({ glow, core }) => {
      if (glow && typeof glow.setStyle === 'function') {
        glow.setStyle((feature) => {
          const defaultSpeed = feature.properties.speed || 30;
          let speed = defaultSpeed;
          if (isPeak) {
            speed = Math.max(8, Math.round(defaultSpeed * 0.35));
          } else if (isMid) {
            speed = Math.max(16, Math.round(defaultSpeed * 0.7));
          } else {
            speed = Math.round(defaultSpeed * 1.15);
          }
          const los = getCorridorLOS(speed);
          return {
            color: los.color,
            weight: (feature.properties.weight || 5) + 4,
            opacity: 0.4
          };
        });
      }
      if (core && typeof core.setStyle === 'function') {
        core.setStyle((feature) => {
          const defaultSpeed = feature.properties.speed || 30;
          let speed = defaultSpeed;
          if (isPeak) {
            speed = Math.max(8, Math.round(defaultSpeed * 0.35));
          } else if (isMid) {
            speed = Math.max(16, Math.round(defaultSpeed * 0.7));
          } else {
            speed = Math.round(defaultSpeed * 1.15);
          }
          const los = getCorridorLOS(speed);
          return {
            color: los.color,
            weight: feature.properties.weight || 5,
            opacity: 0.95,
            className: los.densityClass
          };
        });
      }
    });
  }

  zoomIn() {
    this.mapControls.zoomIn(this.maps);
  }

  zoomOut() {
    this.mapControls.zoomOut(this.maps);
  }

  resetView() {
    this.resetViewport();
  }

  toggleLayer(layerKey, isVisible) {
    this.layerManager.toggleLayer(this.maps, layerKey, isVisible);
  }

  updateTileTheme(theme) {
    const isDark = theme === 'dark';
    const tileUrl = getBasemapTileUrl(isDark);

    this.tileLayers.forEach(tileLayer => {
      if (tileLayer && tileLayer.setUrl) {
        tileLayer.setUrl(tileUrl);
      }
    });
  }

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

  drawDensityHeatmap(map, heatmapGroup) {
    if (!map || !heatmapGroup) return;

    if (typeof heatmapGroup.clearLayers === 'function') {
      heatmapGroup.clearLayers();
    }

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
      const outerCircle = L.circle([pt.lat, pt.lng], {
        radius: pt.radius,
        color: pt.color,
        fillColor: pt.color,
        fillOpacity: 0.18,
        weight: 1.5,
        dashArray: '4, 4'
      });

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

  setMapLayerMode(mode) {
    this.layerManager.setMode(this.maps, mode);

    if (typeof document !== 'undefined') {
      document.querySelectorAll('.map-layer-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layerMode === mode);
      });
    }

    if (typeof window.showToast === 'function') {
      const label = mode === 'flow' ? 'Traffic Flow (Arus Jalan)' : mode === 'heat' ? 'Heatmap Kepadatan Arus' : mode === 'nodes' ? 'SITS Node Markers' : 'Seluruh Lapisan Spasial';
      window.showToast(`Lapisan peta demo: ${label}`);
    }
  }

  createMapLayerSwitcher(map, containerId) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const existing = container.querySelector('.map-layer-mode-switcher');
    if (existing) existing.remove();
    // Layer presets are owned by the map workspace disclosure in the view.
  }

  createWeatherWidget(map, containerId) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const existing = container.querySelector('.map-weather-micro-widget');
    if (existing) existing.remove();
    this.weatherWidgets.delete(containerId);
  }

  toggleRoadCondition() {
    const next = this.currentRoadCondition === 'dry' ? 'wet' : 'dry';
    this.setRoadCondition(next);
  }

  setRoadCondition(condition) {
    this.currentRoadCondition = condition;
    const isWet = condition === 'wet';

    this.maps.forEach((map, containerId) => {
      this.createWeatherWidget(map, containerId);
    });
    document.querySelectorAll('#btnToggleRoadCond-dashboardMapBox, #btnToggleRoadCond-map-surabaya').forEach((toggle) => {
      toggle.textContent = isWet ? 'Ganti ke kering' : 'Ganti ke hujan';
      toggle.setAttribute('aria-label', `Ganti kondisi jalan simulasi saat ini ${isWet ? 'basah' : 'kering'}`);
    });

    stateStore.setState({ roadCondition: condition, isRainMode: isWet });

    if (typeof window.showToast === 'function') {
      if (isWet) {
        window.showToast("Skenario cuaca hujan demo; tidak ada sensor atau perubahan sinyal APILL nyata.", "warning");
      } else {
        window.showToast("Skenario cuaca demo berubah ke kondisi kering; tidak ada sensor nyata yang terhubung.");
      }
    }
  }

  flyToIntersection(idOrName) {
    this.mapControls.flyToIntersection(this.maps, this.layerGroupsMap, this.intersectionMarkersMap, idOrName);
  }

  startEmergency112Simulation(onUpdate, onComplete) {
    this.emergencyRouteAnimator.start(this.maps, this.layerGroupsMap, onUpdate, onComplete);
  }

  stopEmergency112Simulation(isFinished = false) {
    this.emergencyRouteAnimator.stop(this.layerGroupsMap, isFinished);
  }

  syncActiveEmergenciesFromState(activeEmergencies) {
    this.spatialStateSync.syncActiveEmergencies(
      this.layerGroupsMap,
      this.maps,
      activeEmergencies,
      this.activeEmergencyMarkers
    );
  }

  updateIncidentsOnMap(incidents) {
    this.spatialStateSync.syncIncidents(this.layerGroupsMap, incidents);
  }

  syncIntersectionsFromState(intersections) {
    this.spatialStateSync.syncIntersections(this.intersectionMarkersMap, intersections);
  }

  flyToLocation(locationName) {
    this.mapControls.flyToLocation(this.maps, locationName);
  }

  resetViewport(containerId = null) {
    this.mapControls.resetViewport(this.maps, containerId, () => this.clearSelection());
  }

  clearSelection() {
    this.maps.forEach(map => {
      map.closePopup();
    });

    if (typeof document !== 'undefined') {
      const landmarkCard = document.getElementById("landmarkDetailCard");
      if (landmarkCard) {
        landmarkCard.classList.add("is-hidden");
        landmarkCard.style.display = "none";
      }

      document.querySelectorAll('.leaflet-marker-selected').forEach(el => {
        el.classList.remove('leaflet-marker-selected');
      });
    }
  }

  flyToIncident(locationOrCoords, title = "Insiden Lalu Lintas") {
    this.mapControls.flyToIncident(this.maps, this.layerGroupsMap, locationOrCoords, title);
  }

  startEmergencyAmbulanceSimulation(onUpdate, onComplete) {
    return this.startEmergency112Simulation(onUpdate, onComplete);
  }

  _handlePopupOpen(e, containerId) {
    this.popupManager.bindCorridorActions(e.popup);
    this.popupManager.bindCctvLiveSync(e.popup);
    if (containerId !== 'map-surabaya') return;
    const marker = e.popup?._source;
    if (!marker?._omniMarkerType) return;
    marker.getElement?.()?.classList.add('leaflet-marker-selected');
    this._renderMapInspector(marker);
  }

  _handlePopupClose(e, containerId) {
    this.popupManager.unbindCctvLiveSync(e.popup);
    if (containerId !== 'map-surabaya') return;
    e.popup?._source?.getElement?.()?.classList.remove('leaflet-marker-selected');
    const inspector = document.getElementById('mapEntityInspector');
    if (inspector) inspector.hidden = true;
  }

  _renderMapInspector(marker) {
    const inspector = document.getElementById('mapEntityInspector');
    const title = document.getElementById('mapInspectorTitle');
    const summary = document.getElementById('mapInspectorSummary');
    const properties = document.getElementById('mapInspectorProperties');
    const links = document.getElementById('mapInspectorLinks');
    if (!inspector || !title || !summary || !properties) return;
    const state = stateStore.getState();
    const kind = marker._omniMarkerType;
    const id = marker._omniEntityId;
    let entity = null;
    let name = marker.getPopup?.()?.getContent?.()?.toString?.() || '';
    let rows = [];
    if (kind === 'signal') {
      entity = (state.intersections || []).find((item) => item.id === id) || {};
      name = entity.name || id || 'Simpang';
      rows = [['Fase', entity.state || 'Belum tersedia'], ['Sisa fase', entity.timer == null ? 'Belum tersedia' : String(entity.timer) + ' dtk'], ['Waktu tunggu', entity.waitTime == null ? 'Belum tersedia' : String(entity.waitTime) + ' dtk'], ['Green split', entity.greenSplit == null ? 'Belum tersedia' : String(entity.greenSplit) + ' dtk']];
      summary.textContent = 'Kondisi simpang dari state simulasi.';
    } else if (kind === 'incident') {
      entity = (state.incidents || []).find((item) => String(item.id) === String(id)) || marker.data || {};
      name = entity.title || 'Insiden simulasi';
      rows = [['Status', entity.status || 'Belum tersedia'], ['Keparahan', entity.severity || 'Belum tersedia'], ['Lokasi', entity.location || 'Belum tersedia']];
      summary.textContent = entity.notes || 'Detail insiden pada model simulasi.';
    } else if (kind === 'cctv') {
      name = marker.feature?.properties?.name || 'Kamera simulasi';
      rows = [['Status', 'Feed sintetis'], ['Sumber', 'Simulasi lokal']];
      summary.textContent = 'Visual dan deteksi kamera berasal dari simulator, bukan CCTV lapangan.';
    } else {
      name = marker.feature?.properties?.name || 'Entity peta';
      rows = [['Sumber', 'Model simulasi']];
      summary.textContent = 'Entity pada peta simulasi.';
    }
    const cameraName = marker.feature?.properties?.name || '';
    const relatedCamera = kind === 'cctv'
      ? CAMERA_DEFINITIONS.find((camera) => camera.name.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 4).some((part) => cameraName.toLocaleLowerCase().includes(part)))?.id
      : CAMERA_DEFINITIONS.find((camera) => camera.nodeId === id)?.id
        || Object.entries(state.cctvCamerasMetrics || {}).find(([, camera]) => String(camera.nodeId || camera.intersectionId || '') === String(id))?.[0];
    this.selectedMapEntity = { kind: kind === 'incident' ? 'incident' : 'intersection', id, cameraId: relatedCamera };
    title.textContent = name;
    properties.replaceChildren(...rows.flatMap(([label, value]) => {
      const group = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      group.append(dt, dd);
      return [group];
    }));
    if (links) {
      links.hidden = false;
      const signalLink = links.querySelector('[data-view="signals"]');
      const incidentLink = links.querySelector('[data-view="incidents"]');
      const cameraLink = links.querySelector('[data-view="cctv"]');
      if (signalLink) signalLink.hidden = kind !== 'signal';
      if (incidentLink) incidentLink.hidden = kind !== 'incident';
      if (cameraLink) cameraLink.hidden = !relatedCamera;
    }
    inspector.hidden = false;
  }

  destroy() {
    this.deactivate();
    this.disposer.clear();
    this.maps.forEach(map => map.remove());
    this.maps.clear();
    this.tileLayers.clear();
    this.corridorGeoJsonLayers = [];
    this.layerManager.corridorGeoJsonLayers = [];
    this.markerManager.clear();
  }
}

export const mapManager = new MapManager();
