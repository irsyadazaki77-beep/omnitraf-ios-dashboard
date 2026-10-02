// Mock minimal DOM & Leaflet environment for Node test runner
if (typeof globalThis.window === 'undefined') {
  globalThis.document = {
    readyState: 'complete',
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {} }; },
    head: { appendChild() {} },
    body: { appendChild() {} },
    hidden: false
  };
  globalThis.window = {
    document: globalThis.document,
    requestAnimationFrame(cb) { return setTimeout(cb, 16); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
  globalThis.L = {
    map: () => ({
      setView() { return this; },
      on() { return this; },
      addLayer() { return this; },
      removeLayer() { return this; },
      remove() { return this; },
      invalidateSize() { return this; },
      flyTo() { return this; },
      closePopup() { return this; },
      fitBounds() { return this; }
    }),
    tileLayer: () => ({
      addTo() { return this; },
      setUrl() { return this; },
      on() { return this; }
    }),
    layerGroup: () => ({
      addTo() { return this; },
      addLayer() { return this; },
      removeLayer() { return this; },
      clearLayers() { return this; },
      hasLayer() { return false; },
      eachLayer(cb) { return this; },
      getLayers() { return []; }
    }),
    markerClusterGroup: () => ({
      addTo() { return this; },
      addLayer() { return this; },
      removeLayer() { return this; },
      clearLayers() { return this; },
      hasLayer() { return false; },
      eachLayer(cb) { return this; }
    }),
    marker: (coords, options) => ({
      coords,
      options,
      bindPopup() { return this; },
      bindTooltip() { return this; },
      addTo() { return this; },
      setIcon(icon) { this.options = this.options || {}; this.options.icon = icon; return this; },
      setLatLng(ll) { this.coords = ll; return this; },
      setPopupContent() { return this; },
      isPopupOpen() { return false; },
      openPopup() { return this; }
    }),
    divIcon: (opts) => opts,
    polyline: (latlngs, opts) => ({
      latlngs,
      opts,
      addTo() { return this; }
    }),
    latLngBounds: () => ({}),
    circle: () => ({
      bindPopup() { return this; }
    }),
    geoJSON: (data, opts) => ({
      eachLayer(cb) {
        if (data && data.features) {
          data.features.forEach(f => {
            const mockLayer = {
              feature: f,
              bindPopup() {},
              bindTooltip() {},
              getLatLng() { return { distanceTo() { return 100; } }; }
            };
            cb(mockLayer);
          });
        }
      }
    }),
    point: (x, y) => ({ x, y })
  };
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  geoJsonToLeaflet,
  leafletToGeoJson,
  isValidLatitude,
  isValidLongitude,
  isValidGeoJsonCoord,
  isValidLeafletCoord,
  validateGeoJson,
  calculateVisualDistance,
  calculateOperationalDistanceMeters
} from '../../src/modules/map/coordinateUtils.js';

import {
  toSignalMarkerProjection,
  toIncidentMarkerProjection,
  toEmergencyVehicleProjection
} from '../../src/modules/map/spatialDomainAdapter.js';

import {
  SITS_INTERSECTIONS_GEOJSON,
  SURABAYA_CORRIDORS_GEOJSON,
  MINOR_ROADS_GEOJSON,
  KALIMAS_RIVER_GEOJSON,
  SURABAYA_DISTRICTS_GEOJSON,
  SURABAYA_INCIDENTS_GEOJSON,
  SURABAYA_LANDMARKS_GEOJSON,
  SITS_CCTV_CAMERAS_GEOJSON,
  EMERGENCY_PATHS_GEOJSON
} from '../../src/config/surabayaCoords.js';

import { mapManager, getCorridorLOS } from '../../src/modules/mapManager.js';
import { layerManager, TILE_CONFIG } from '../../src/modules/map/layerManager.js';
import { markerManager } from '../../src/modules/map/markerManager.js';
import { popupManager } from '../../src/modules/map/popupManager.js';
import { mapControls } from '../../src/modules/map/mapControls.js';
import { emergencyRouteAnimator } from '../../src/modules/map/emergencyRouteAnimator.js';
import { spatialStateSync } from '../../src/modules/map/spatialStateSync.js';

describe('FASE 6 — GIS & Spatial Intelligence Comprehensive Test Suite', () => {

  describe('1. Coordinate Conventions & Boundaries', () => {
    test('Boundary validation for valid and invalid lat/lng values', () => {
      assert.strictEqual(isValidLatitude(-7.2575), true);
      assert.strictEqual(isValidLatitude(95), false);
      assert.strictEqual(isValidLatitude(-91), false);
      assert.strictEqual(isValidLatitude(NaN), false);

      assert.strictEqual(isValidLongitude(112.7521), true);
      assert.strictEqual(isValidLongitude(181), false);
      assert.strictEqual(isValidLongitude(-185), false);
    });

    test('Explicit conversion: geoJsonToLeaflet ([lng, lat] -> [lat, lng])', () => {
      const geoJsonCoord = [112.7345, -7.2985]; // Wonokromo [lng, lat]
      const leafletCoord = geoJsonToLeaflet(geoJsonCoord);
      assert.deepEqual(leafletCoord, [-7.2985, 112.7345]);
    });

    test('Explicit conversion: leafletToGeoJson ([lat, lng] -> [lng, lat])', () => {
      const leafletCoord = [-7.2985, 112.7345];
      const geoJsonCoord = leafletToGeoJson(leafletCoord);
      assert.deepEqual(geoJsonCoord, [112.7345, -7.2985]);

      // Supports object input {lat, lng}
      const geoJsonFromObj = leafletToGeoJson({ lat: -7.2985, lng: 112.7345 });
      assert.deepEqual(geoJsonFromObj, [112.7345, -7.2985]);
    });

    test('Conversion throws meaningful error on invalid input or out of bounds', () => {
      assert.throws(() => geoJsonToLeaflet([200, 10]), /out of bounds/);
      assert.throws(() => leafletToGeoJson([100, 50]), /out of bounds/);
      assert.throws(() => geoJsonToLeaflet(null), /Invalid GeoJSON coordinate/);
    });
  });

  describe('2. GeoJSON Dataset Audit & Validation', () => {
    test('SITS Intersections FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SITS_INTERSECTIONS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
      assert.ok(result.featureCount >= 5);
    });

    test('Corridors LineString FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SURABAYA_CORRIDORS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
      assert.ok(result.featureCount >= 4);
    });

    test('Minor Roads LineString FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(MINOR_ROADS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('Kalimas River Feature is valid GeoJSON', () => {
      const result = validateGeoJson(KALIMAS_RIVER_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('Surabaya Districts Polygon FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SURABAYA_DISTRICTS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('Surabaya Incidents Point FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SURABAYA_INCIDENTS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('Surabaya Landmarks Point FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SURABAYA_LANDMARKS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('SITS CCTV Cameras Point FeatureCollection is valid GeoJSON', () => {
      const result = validateGeoJson(SITS_CCTV_CAMERAS_GEOJSON);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('Emergency Paths LineString is valid GeoJSON', () => {
      const ambRes = validateGeoJson(EMERGENCY_PATHS_GEOJSON.ambulance);
      assert.strictEqual(ambRes.valid, true, `Errors: ${ambRes.errors.join(', ')}`);
      const fireRes = validateGeoJson(EMERGENCY_PATHS_GEOJSON.fire);
      assert.strictEqual(fireRes.valid, true, `Errors: ${fireRes.errors.join(', ')}`);
    });
  });

  describe('3. Distance Helpers: Visual vs Operational Distance', () => {
    test('calculateVisualDistance computes Euclidean approximation for rendering', () => {
      const p1 = [112.7300, -7.3450];
      const p2 = [112.7345, -7.2985];
      const visualDist = calculateVisualDistance(p1, p2);
      assert.ok(visualDist > 0 && visualDist < 0.1);
    });

    test('calculateOperationalDistanceMeters computes Haversine distance in meters', () => {
      // Wonokromo to Bungkul is ~2.0 - 2.5 km
      const wonokromo = [-7.2985, 112.7345];
      const bungkul = [-7.2810, 112.7395];
      const distMeters = calculateOperationalDistanceMeters(wonokromo, bungkul);
      assert.ok(distMeters > 1800 && distMeters < 2400, `Distance was ${distMeters}m`);
    });
  });

  describe('4. Spatial Domain Adapter & Projections', () => {
    test('toSignalMarkerProjection transforms GeoJSON feature and live state into projection model', () => {
      const rawFeature = SITS_INTERSECTIONS_GEOJSON.features[0]; // Wonokromo
      const liveNodeState = { state: 'RED', timer: 12, greenSplit: 35, waitTime: 40 };

      const projection = toSignalMarkerProjection(rawFeature, liveNodeState);
      assert.strictEqual(projection.id, 'node-wonokromo');
      assert.strictEqual(projection.lat, -7.2985);
      assert.strictEqual(projection.lng, 112.7345);
      assert.strictEqual(projection.stateColor, 'red');
      assert.strictEqual(projection.timer, 12);
      assert.strictEqual(projection.statusLabel, 'BERHENTI (MERAH)');
      assert.strictEqual(projection.rippleClass, 'ripple-danger');
      assert.strictEqual(projection.popupColor, '#ef4444');
    });

    test('toIncidentMarkerProjection sanitizes and normalizes incident coordinates', () => {
      const inc = {
        id: 'INC-TEST-01',
        title: 'Tabrakan Ringan',
        severity: 'danger',
        coordinates: [-7.2880, 112.7380]
      };
      const proj = toIncidentMarkerProjection(inc);
      assert.strictEqual(proj.id, 'INC-TEST-01');
      assert.strictEqual(proj.severity, 'danger');
      assert.strictEqual(proj.lat, -7.2880);
      assert.strictEqual(proj.lng, 112.7380);
    });

    test('toEmergencyVehicleProjection creates normalized 0.0 -> 1.0 progress model', () => {
      const emg = {
        id: 'EMG-SIM-1',
        vehicleId: 'AMB-112',
        vehicleType: 'Ambulans',
        speed: 65,
        currentPosition: [-7.3180, 112.7330],
        progress: 0.45
      };
      const proj = toEmergencyVehicleProjection(emg);
      assert.strictEqual(proj.vehicleId, 'AMB-112');
      assert.strictEqual(proj.vehicleType, 'AMBULANS');
      assert.strictEqual(proj.progress, 0.45);
      assert.deepEqual(proj.position, [-7.3180, 112.7330]);
    });
  });

  describe('5. Marker Lifecycle & Diffing Engine', () => {
    test('diffEntities accurately identifies added, updated, and removed entities by stable identity', () => {
      const currentMap = new Map([
        ['item-1', { id: 'item-1', val: 'old' }],
        ['item-2', { id: 'item-2', val: 'stay' }]
      ]);

      const nextList = [
        { id: 'item-2', val: 'updated' },
        { id: 'item-3', val: 'new' }
      ];

      const diff = markerManager.diffEntities(currentMap, nextList, item => item.id);
      assert.strictEqual(diff.added.length, 1);
      assert.strictEqual(diff.added[0].id, 'item-3');

      assert.strictEqual(diff.updated.length, 1);
      assert.strictEqual(diff.updated[0].id, 'item-2');
      assert.strictEqual(diff.updated[0].val, 'updated');

      assert.strictEqual(diff.removed.length, 1);
      assert.strictEqual(diff.removed[0].id, 'item-1');
    });

    test('syncIncidentMarkers reuses marker instances without recreating all layers', () => {
      const mockLayerGroup = {
        _layers: new Set(),
        addLayer(l) { this._layers.add(l); },
        removeLayer(l) { this._layers.delete(l); },
        hasLayer(l) { return this._layers.has(l); }
      };

      const initialIncidents = [
        { id: 'inc-1', title: 'Genangan Air', severity: 'warning', coordinates: [-7.27, 112.74] },
        { id: 'inc-2', title: 'Pohon Tumbang', severity: 'danger', coordinates: [-7.28, 112.75] }
      ];

      markerManager.syncIncidentMarkers(mockLayerGroup, null, initialIncidents, () => 'popup');
      assert.strictEqual(mockLayerGroup._omniIncidentMarkers.size, 2);

      const marker1Before = mockLayerGroup._omniIncidentMarkers.get('inc-1').marker;

      // Update inc-1, remove inc-2, add inc-3
      const updatedIncidents = [
        { id: 'inc-1', title: 'Genangan Air Surut', severity: 'warning', coordinates: [-7.27, 112.74] },
        { id: 'inc-3', title: 'Truk Mogok', severity: 'danger', coordinates: [-7.29, 112.76] }
      ];

      markerManager.syncIncidentMarkers(mockLayerGroup, null, updatedIncidents, () => 'popup');
      assert.strictEqual(mockLayerGroup._omniIncidentMarkers.size, 2);
      assert.ok(!mockLayerGroup._omniIncidentMarkers.has('inc-2'), 'inc-2 must be removed');
      assert.ok(mockLayerGroup._omniIncidentMarkers.has('inc-3'), 'inc-3 must be added');

      const marker1After = mockLayerGroup._omniIncidentMarkers.get('inc-1').marker;
      assert.strictEqual(marker1Before, marker1After, 'Existing marker instance must be reused in-place');
    });
  });

  describe('6. Layer Registry & Mode Transitions', () => {
    test('LayerManager maintains tile provider configuration without hardcoding', () => {
      assert.strictEqual(TILE_CONFIG.provider, 'CARTO');
      assert.ok(TILE_CONFIG.darkUrl.includes('cartocdn.com'));
      assert.ok(TILE_CONFIG.lightUrl.includes('cartocdn.com'));
    });

    test('Mode transition (flow -> heat -> nodes -> all) switches layer visibility safely', () => {
      const mockMap = {
        _activeLayers: new Set(),
        addLayer(l) { this._activeLayers.add(l); },
        removeLayer(l) { this._activeLayers.delete(l); },
        hasLayer(l) { return this._activeLayers.has(l); }
      };

      const mockMaps = new Map([['test-map', mockMap]]);
      layerManager.registerLayers('test-map', mockMap, null);

      // Mode: flow
      layerManager.setMode(mockMaps, 'flow');
      assert.strictEqual(layerManager.currentMode, 'flow');
      assert.strictEqual(layerManager.visibility['road-glows'], true);
      assert.strictEqual(layerManager.visibility['density-heat'], false);

      // Mode: heat
      layerManager.setMode(mockMaps, 'heat');
      assert.strictEqual(layerManager.currentMode, 'heat');
      assert.strictEqual(layerManager.visibility['road-glows'], false);
      assert.strictEqual(layerManager.visibility['density-heat'], true);

      // Mode: nodes
      layerManager.setMode(mockMaps, 'nodes');
      assert.strictEqual(layerManager.currentMode, 'nodes');
      assert.strictEqual(layerManager.visibility['landmark-group'], true);

      // Mode: all
      layerManager.setMode(mockMaps, 'all');
      assert.strictEqual(layerManager.currentMode, 'all');
      assert.strictEqual(layerManager.visibility['road-glows'], true);
      assert.strictEqual(layerManager.visibility['density-heat'], true);
      assert.strictEqual(layerManager.visibility['landmark-group'], true);
    });
  });

  describe('7. Popups Lifecycle & XSS Sanitization', () => {
    test('createIncidentPopupContent sanitizes malicious tags', () => {
      const maliciousIncident = {
        id: 'inc-xss',
        title: '<script>alert("xss")</script>Tabrakan',
        category: 'traffic',
        severity: 'danger',
        location: '<img src=x onerror=alert(1)>',
        assignedUnit: '<b onmouseover=evil()>Unit 01</b>',
        notes: '<iframe src="evil.com"></iframe>'
      };

      const html = popupManager.createIncidentPopupContent(maliciousIncident);
      assert.ok(!html.includes('<script>'));
      assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
      assert.ok(!html.includes('<iframe'));
      assert.ok(html.includes('&lt;script&gt;'));
    });

    test('Single-timer CCTV live sync prevents memory leak on unbind', () => {
      popupManager.unbindCctvLiveSync();
      assert.strictEqual(popupManager._liveSyncTimer, null);
      assert.strictEqual(popupManager._activePopupContext, null);
    });
  });

  describe('8. MapManager Lifecycle & Separation of Concerns', () => {
    test('MapManager delegates to sub-managers with minimal footprint', () => {
      assert.ok(mapManager.layerManager);
      assert.ok(mapManager.markerManager);
      assert.ok(mapManager.popupManager);
      assert.ok(mapManager.mapControls);
      assert.ok(mapManager.emergencyRouteAnimator);
      assert.ok(mapManager.spatialStateSync);
    });

    test('getCorridorLOS calculates Level of Service independently from Leaflet', () => {
      const losF = getCorridorLOS(12);
      assert.strictEqual(losF.los, 'F');
      assert.strictEqual(losF.densityClass, 'los-f-gridlock');

      const losA = getCorridorLOS(50);
      assert.strictEqual(losA.los, 'A/B');
      assert.strictEqual(losA.densityClass, 'los-ab-smooth');
    });

    test('destroy clears map instances and resets sub-managers', () => {
      mapManager.destroy();
      assert.strictEqual(mapManager.isActive, false);
      assert.strictEqual(mapManager.maps.size, 0);
      assert.strictEqual(mapManager.corridorGeoJsonLayers.length, 0);
    });
  });
});
