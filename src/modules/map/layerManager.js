/**
 * OmniTRAF Surabaya - Map Layer Manager
 * Mengelola pendaftaran layer, visibilitas (mode switcher & drawer toggles),
 * tile basemap, GeoJSON corridors, minor roads, river, districts, dan heatmap.
 */

import {
  SURABAYA_CORRIDORS_GEOJSON,
  MINOR_ROADS_GEOJSON,
  KALIMAS_RIVER_GEOJSON,
  SURABAYA_DISTRICTS_GEOJSON
} from '../../config/surabayaCoords.js';

export const TILE_CONFIG = {
  provider: 'CARTO',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  subdomains: 'abcd',
  maxZoom: 19,
  darkUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  lightUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  openStreetMapUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
};

export function getBasemapTileUrl(isDark) {
  const cartoKey = typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_CARTO_BASEMAP_KEY : '';
  if (!cartoKey) return TILE_CONFIG.openStreetMapUrl;
  const styleUrl = isDark ? TILE_CONFIG.darkUrl : TILE_CONFIG.lightUrl;
  return `${styleUrl}?key=${encodeURIComponent(cartoKey)}`;
}

export function createCartoTileLayer(isDark) {
  const cartoKey = typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_CARTO_BASEMAP_KEY : '';
  const tileUrl = getBasemapTileUrl(isDark);
  const attribution = cartoKey
    ? `${TILE_CONFIG.attribution} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`
    : TILE_CONFIG.attribution;

  const layerOptions = {
    className: cartoKey ? '' : 'omni-osm-tile',
    attribution,
    maxZoom: TILE_CONFIG.maxZoom,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 3
  };
  // An explicit `undefined` overrides Leaflet's default `abc` subdomains and
  // crashes tile URL generation. OSM uses a single host, so omit the option.
  if (cartoKey) layerOptions.subdomains = TILE_CONFIG.subdomains;

  const layer = L.tileLayer(tileUrl, layerOptions);

  // Isolated tile error handling so network tile drops do not crash the spatial engine
  if (layer && typeof layer.on === 'function') {
    layer.on('tileerror', (error) => {
      // Isolated warning: Basemap tile error does not mutate state or crash GIS rendering
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[LayerManager] Basemap tile load failure (isolated):', error?.coords);
      }
    });
  }

  return layer;
}

export function safeAddLayers(group, layers) {
  if (!group || !layers || !layers.length) return;
  if (typeof group.addLayers === 'function') {
    try {
      group.addLayers(layers);
      return;
    } catch (err) {
      console.warn('[LayerManager] Failed to call group.addLayers, falling back to loop:', err);
    }
  }
  layers.forEach(layer => {
    if (layer && typeof group.addLayer === 'function') {
      group.addLayer(layer);
    }
  });
}

export function createClusterGroup(clusterType = 'cctv') {
  if (typeof L !== 'undefined' && typeof L.markerClusterGroup === 'function') {
    return L.markerClusterGroup({
      maxClusterRadius: 80,
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

        // Optimized cluster classification using structured marker metadata instead of parsing HTML
        const markers = cluster.getAllChildMarkers();
        let hasSignal = false;
        let hasCctv = false;
        let hasIncident = false;

        for (let i = 0; i < markers.length; i++) {
          const mType = markers[i]._omniMarkerType;
          if (mType === 'signal') hasSignal = true;
          else if (mType === 'cctv') hasCctv = true;
          else if (mType === 'incident') hasIncident = true;
          else {
            // Fallback for markers without explicit _omniMarkerType
            const html = markers[i].options?.icon?.options?.html || '';
            if (html.includes('leaflet-signal-node-wrapper') || html.includes('signal-marker-')) hasSignal = true;
            else if (html.includes('leaflet-cctv-marker') || html.includes('cctv-popup')) hasCctv = true;
            else if (html.includes('leaflet-incident-marker')) hasIncident = true;
          }
          if (hasSignal && hasCctv && hasIncident) break;
        }

        let typeClass = `cluster-${clusterType}`;
        if (clusterType === 'master') {
          if (hasIncident && !hasSignal && !hasCctv) typeClass = 'cluster-incidents';
          else if (hasSignal && !hasIncident && !hasCctv) typeClass = 'cluster-signals';
          else if (hasCctv && !hasIncident && !hasSignal) typeClass = 'cluster-cctv';
          else typeClass = 'cluster-mixed';
        }

        return L.divIcon({
          html: `<div class="omni-cluster-bubble ${sizeClass} ${typeClass}" role="img" aria-label="Cluster berisi ${count} aset"><span aria-hidden="true">${count}</span></div>`,
          className: 'omni-cluster-icon',
          iconSize: L.point(40, 40),
          iconAnchor: [20, 20]
        });
      }
    });
  }

  return L.layerGroup();
}

export class LayerManager {
  constructor() {
    /** @type {Map<string, Object<string, L.LayerGroup>>} Container-keyed layer registries */
    this.layerRegistries = new Map();
    /** References to corridor layers for dynamic styling */
    this.corridorGeoJsonLayers = [];
    this.currentMode = 'flow';
    this.visibility = {
      'district-zones': true,
      'map-river': true,
      'road-glows': true,
      'minor-roads': true,
      'density-heat': false,
      'warn-points': true,
      'landmark-group': false,
      'signal-points': true,
      'emergency-sim-route': true
    };
  }

  /**
   * Register layer group for a container
   */
  registerLayers(containerId, map, masterCluster) {
    const layers = {
      'district-zones': L.layerGroup().addTo(map),
      'map-river': L.layerGroup().addTo(map),
      'road-glows': L.layerGroup().addTo(map),
      'minor-roads': L.layerGroup().addTo(map),
      'density-heat': L.layerGroup(),
      'warn-points': L.layerGroup(),
      'landmark-group': L.layerGroup(),
      'signal-points': L.layerGroup(),
      'emergency-sim-route': L.layerGroup().addTo(map),
      'master-cluster': masterCluster
    };

    this.layerRegistries.set(containerId, layers);
    return layers;
  }

  getLayers(containerId) {
    return this.layerRegistries.get(containerId) || null;
  }

  /**
   * Layer toggle implementation without recreating map
   */
  toggleLayer(maps, layerKey, isVisible) {
    this.visibility[layerKey] = isVisible;

    this.layerRegistries.forEach((groups, containerId) => {
      const map = maps.get(containerId);
      const group = groups[layerKey];
      if (!map || !group) return;

      const masterCluster = groups['master-cluster'];
      const isSubPointLayer = ['warn-points', 'landmark-group', 'signal-points'].includes(layerKey);

      if (isVisible) {
        if (isSubPointLayer && masterCluster) {
          group.eachLayer(layer => {
            if (!masterCluster.hasLayer(layer)) {
              masterCluster.addLayer(layer);
            }
          });
        } else {
          if (!map.hasLayer(group)) map.addLayer(group);
        }
      } else {
        if (isSubPointLayer && masterCluster) {
          group.eachLayer(layer => {
            if (masterCluster.hasLayer(layer)) {
              masterCluster.removeLayer(layer);
            }
          });
        } else {
          if (map.hasLayer(group)) map.removeLayer(group);
        }
      }
    });
  }

  /**
   * Set map mode (flow | heat | nodes | all) with clear lifecycle transition
   */
  setMode(maps, mode) {
    this.currentMode = mode;

    if (mode === 'flow') {
      this.toggleLayer(maps, 'road-glows', true);
      this.toggleLayer(maps, 'minor-roads', true);
      this.toggleLayer(maps, 'density-heat', false);
      this.toggleLayer(maps, 'signal-points', true);
      this.toggleLayer(maps, 'landmark-group', false);
      this.toggleLayer(maps, 'warn-points', true);
    } else if (mode === 'heat') {
      this.toggleLayer(maps, 'road-glows', false);
      this.toggleLayer(maps, 'minor-roads', false);
      this.toggleLayer(maps, 'density-heat', true);
      this.toggleLayer(maps, 'signal-points', true);
      this.toggleLayer(maps, 'landmark-group', false);
      this.toggleLayer(maps, 'warn-points', true);
    } else if (mode === 'nodes') {
      this.toggleLayer(maps, 'road-glows', false);
      this.toggleLayer(maps, 'minor-roads', false);
      this.toggleLayer(maps, 'density-heat', false);
      this.toggleLayer(maps, 'signal-points', true);
      this.toggleLayer(maps, 'landmark-group', true);
      this.toggleLayer(maps, 'warn-points', true);
    } else if (mode === 'all') {
      this.toggleLayer(maps, 'road-glows', true);
      this.toggleLayer(maps, 'minor-roads', true);
      this.toggleLayer(maps, 'density-heat', true);
      this.toggleLayer(maps, 'signal-points', true);
      this.toggleLayer(maps, 'landmark-group', true);
      this.toggleLayer(maps, 'warn-points', true);
    }
  }

  clearContainer(containerId) {
    const groups = this.layerRegistries.get(containerId);
    if (groups) {
      Object.values(groups).forEach(g => {
        if (g && typeof g.clearLayers === 'function') {
          g.clearLayers();
        }
      });
    }
    this.layerRegistries.delete(containerId);
  }
}

export const layerManager = new LayerManager();
