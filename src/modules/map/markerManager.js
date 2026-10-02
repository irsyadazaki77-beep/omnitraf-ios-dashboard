/**
 * OmniTRAF Surabaya - Map Marker Manager
 * Bertanggung jawab khusus untuk lifecycle marker (CREATE -> ATTACH -> UPDATE -> HIDE -> REMOVE -> DESTROY)
 * dengan stable identity diffing (added, updated, removed) dan marker reuse.
 */

export class MarkerManager {
  constructor() {
    /** @type {Map<string, { marker: L.Marker, data: Object, containerId: string }>} */
    this.markers = new Map();
    /** Keyed by node id: { marker, feature, latlng, id, name } */
    this.intersectionMarkersMap = new Map();
  }

  /**
   * Helper untuk membuat icon APILL
   */
  createSignalIcon(nodeId, stateColor) {
    let rippleClass = 'ripple-success';
    let nodeClass = 'node-success';
    if (stateColor === 'red') {
      rippleClass = 'ripple-danger';
      nodeClass = 'node-danger';
    } else if (stateColor === 'yellow') {
      rippleClass = 'ripple-warning';
      nodeClass = 'node-warning';
    }

    return L.divIcon({
      className: 'custom-signal-div-icon',
      html: `
        <div class="leaflet-signal-node-wrapper" id="signal-marker-${nodeId}">
          <span class="signal-ripple ${rippleClass}"></span>
          <span class="signal-core ${nodeClass}"></span>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  /**
   * Update marker APILL secara in-place tanpa recreate marker
   */
  updateSignalMarker(nodeId, stateColor) {
    // 1. Direct DOM fast path
    this.updateSignalMarkerDOM(nodeId, stateColor);

    // 2. Icon instance update so future unclustering / pan retains correct styling
    const stored = this.intersectionMarkersMap.get(nodeId);
    if (stored && stored.marker) {
      stored.marker.setIcon(this.createSignalIcon(nodeId, stateColor));
    }
  }

  /**
   * Direct DOM update for high-speed 60fps rendering without Leaflet layout thrash
   */
  updateSignalMarkerDOM(nodeId, stateColor) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`signal-marker-${nodeId}`);
    if (!el) return;

    let rippleClass = 'ripple-success';
    let nodeClass = 'node-success';
    if (stateColor === 'red') {
      rippleClass = 'ripple-danger';
      nodeClass = 'node-danger';
    } else if (stateColor === 'yellow') {
      rippleClass = 'ripple-warning';
      nodeClass = 'node-warning';
    }

    const ripple = el.querySelector('.signal-ripple');
    const core = el.querySelector('.signal-core');
    if (ripple && core) {
      ripple.className = `signal-ripple ${rippleClass}`;
      core.className = `signal-core ${nodeClass}`;
    }
  }

  createIncidentIcon(severity, title) {
    return L.divIcon({
      className: 'custom-incident-div-icon',
      html: `<div class="leaflet-incident-marker ${severity === 'danger' ? 'danger' : 'warning'}" style="background: ${severity === 'danger' ? '#ef4444' : '#f59e0b'};" title="${title || ''}">⚠️</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  /**
   * Diffing Marker Collection: hitung added, updated, removed berdasarkan stable identity.
   * @template T
   * @param {Map<string, T>} currentMap
   * @param {Array<T>} nextList
   * @param {(item: T) => string} getId
   * @returns {{ added: T[], updated: T[], removed: T[] }}
   */
  diffEntities(currentMap, nextList, getId) {
    const nextMap = new Map();
    nextList.forEach(item => {
      const id = getId(item);
      if (id) nextMap.set(id, item);
    });

    const added = [];
    const updated = [];
    const removed = [];

    // Deteksi updated dan removed
    currentMap.forEach((existingItem, id) => {
      if (nextMap.has(id)) {
        updated.push(nextMap.get(id));
      } else {
        removed.push(existingItem);
      }
    });

    // Deteksi added
    nextMap.forEach((newItem, id) => {
      if (!currentMap.has(id)) {
        added.push(newItem);
      }
    });

    return { added, updated, removed };
  }

  /**
   * Sync incident markers via diffing to avoid recreating the entire collection
   */
  syncIncidentMarkers(layerGroup, masterCluster, nextIncidents, createPopupFn) {
    if (!layerGroup) return;

    // Track active incident markers on this layer group
    if (!layerGroup._omniIncidentMarkers) {
      layerGroup._omniIncidentMarkers = new Map();
    }
    const currentMap = layerGroup._omniIncidentMarkers;

    // Non-archived only
    const validIncidents = (nextIncidents || []).filter(inc => inc.status !== 'ARCHIVED');

    const diff = this.diffEntities(currentMap, validIncidents, (inc) => inc.id);

    // 1. Remove markers that are no longer present
    diff.removed.forEach(item => {
      const id = item?.id || item?.data?.id;
      const entry = currentMap.get(id);
      if (entry) {
        if (masterCluster && masterCluster.hasLayer(entry.marker)) {
          masterCluster.removeLayer(entry.marker);
        }
        if (layerGroup.hasLayer(entry.marker)) {
          layerGroup.removeLayer(entry.marker);
        }
        currentMap.delete(id);
      }
    });

    // 2. Update existing markers (reuse marker instance)
    diff.updated.forEach(inc => {
      const entry = currentMap.get(inc.id);
      if (entry && entry.marker) {
        const severity = inc.severity || 'warning';
        entry.marker.setIcon(this.createIncidentIcon(severity, inc.title));
        if (typeof createPopupFn === 'function') {
          entry.marker.setPopupContent(createPopupFn(inc));
        }
        if (inc.coordinates && Array.isArray(inc.coordinates)) {
          entry.marker.setLatLng(inc.coordinates);
        }
        entry.data = inc;
      }
    });

    // 3. Add newly created markers
    diff.added.forEach(inc => {
      const severity = inc.severity || 'warning';
      const coords = inc.coordinates || [-7.2985, 112.7345];
      const marker = L.marker(coords, { icon: this.createIncidentIcon(severity, inc.title) });
      marker._omniMarkerType = 'incident';
      marker._omniEntityId = inc.id;

      if (typeof createPopupFn === 'function') {
        marker.bindPopup(createPopupFn(inc), { maxWidth: 300 });
      }

      layerGroup.addLayer(marker);
      if (masterCluster) {
        masterCluster.addLayer(marker);
      }
      currentMap.set(inc.id, { marker, data: inc });
    });
  }

  clear() {
    this.markers.clear();
    this.intersectionMarkersMap.clear();
  }
}

export const markerManager = new MarkerManager();
