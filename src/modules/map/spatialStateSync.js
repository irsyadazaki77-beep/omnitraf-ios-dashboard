/**
 * OmniTRAF Surabaya - Spatial State Sync
 * Bertanggung jawab khusus untuk memproyeksikan state perubahan dari StateStore
 * ke dalam layer & marker Leaflet (StateStore -> Spatial Adapter -> Map Projection).
 * Map adalah PROJECTION MURNI dan BUKAN source of truth.
 */

import { toIncidentMarkerProjection, toSignalMarkerProjection, toEmergencyVehicleProjection } from './spatialDomainAdapter.js';
import { markerManager } from './markerManager.js';
import { popupManager } from './popupManager.js';

export class SpatialStateSync {
  constructor() {}

  /**
   * Sync active emergencies from stateStore to map layers
   */
  syncActiveEmergencies(layerGroupsMap, maps, activeEmergencies, activeEmergencyMarkers) {
    const ROUTES_DB_CLIENT = {
      "route-soetomo": [
        { name: "Bundaran Waru", lat: -7.3510, lng: 112.7290 },
        { name: "Jl. Ahmad Yani (DOLOG)", lat: -7.3450, lng: 112.7300 },
        { name: "Simpang Jemursari", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-jemursari" },
        { name: "Simpang Jemursari Waypoint", lat: -7.3100, lng: 112.7335 },
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
        { name: "Simpang Jemursari", lat: -7.3180, lng: 112.7330, isIntersection: true, id: "node-jemursari" },
        { name: "Simpang Jemursari Waypoint", lat: -7.3100, lng: 112.7335 },
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

    if (!Array.isArray(activeEmergencies) || activeEmergencies.length === 0) {
      layerGroupsMap.forEach((groups) => {
        const simGroup = groups['emergency-sim-route'];
        if (simGroup) simGroup.clearLayers();
      });
      if (activeEmergencyMarkers) {
        activeEmergencyMarkers.clear();
      }
      return;
    }

    activeEmergencies.forEach(rawEmg => {
      const emg = toEmergencyVehicleProjection(rawEmg);
      const routePoints = ROUTES_DB_CLIENT[emg.routeId] || ROUTES_DB_CLIENT["route-soetomo"];
      const latlngs = routePoints.map(pt => [pt.lat, pt.lng]);

      layerGroupsMap.forEach((groups, containerId) => {
        const simGroup = groups['emergency-sim-route'];
        const map = maps.get(containerId);
        if (!simGroup || !map) return;

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

      const markerId = emg.id;
      let existingMarkerInfo = activeEmergencyMarkers.get(markerId);
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
        const markers = [];
        maps.forEach((map, containerId) => {
          const simGroup = layerGroupsMap.get(containerId)?.['emergency-sim-route'];
          if (simGroup) {
            const marker = L.marker(emg.position, { icon: customIcon, zIndexOffset: 2000 }).addTo(simGroup);
            marker.bindPopup(popupManager.createEmergencyPopupContent(emg, isPmk), { maxWidth: 300 });
            markers.push({ mapId: containerId, marker });
          }
        });

        activeEmergencyMarkers.set(markerId, { markers, lastPos: emg.position });
      } else {
        existingMarkerInfo.markers.forEach(({ marker }) => {
          marker.setLatLng(emg.position);
          if (marker.isPopupOpen()) {
            marker.setPopupContent(popupManager.createEmergencyPopupContent(emg, isPmk));
          }
        });
        existingMarkerInfo.lastPos = emg.position;
      }
    });
  }

  /**
   * Sync incident updates via MarkerManager diffing
   */
  syncIncidents(layerGroupsMap, incidents) {
    if (!Array.isArray(incidents)) return;

    const projectedIncidents = incidents
      .filter(inc => inc.status !== "ARCHIVED")
      .map(toIncidentMarkerProjection);

    layerGroupsMap.forEach((groups) => {
      const incidentGroup = groups['warn-points'];
      const masterCluster = groups['master-cluster'];
      if (!incidentGroup) return;

      markerManager.syncIncidentMarkers(
        incidentGroup,
        masterCluster,
        projectedIncidents,
        (inc) => popupManager.createIncidentPopupContent(inc)
      );
    });
  }

  /**
   * Sync intersections state from server without recreating markers
   */
  syncIntersections(intersectionMarkersMap, intersections) {
    if (!Array.isArray(intersections)) return;

    intersections.forEach(node => {
      const stored = intersectionMarkersMap.get(node.id);
      if (stored && stored.marker) {
        const p = stored.feature.properties;
        const projection = toSignalMarkerProjection(stored.feature, node);

        // In-place update marker icon
        markerManager.updateSignalMarker(node.id, projection.stateColor);

        // Update popup content with sanitized projection
        stored.marker.setPopupContent(popupManager.createIntersectionPopupContent(p, node));
      }
    });
  }

  /**
   * Sync device status (Edge nodes) with map indicators
   */
  syncDeviceVisuals(devices) {
    if (!devices || typeof document === 'undefined') return;

    devices.forEach(dev => {
      let nodeId = null;
      if (dev.deviceId === 'NODE-EDGE-01') nodeId = 'node-wonokromo';
      else if (dev.deviceId === 'NODE-EDGE-02') nodeId = 'node-darmo';
      else if (dev.deviceId === 'NODE-EDGE-03') nodeId = 'node-tunjungan';
      else if (dev.deviceId === 'NODE-CTRL-01') nodeId = 'node-jemursari';

      if (!nodeId) return;

      const markerEl = document.getElementById(`signal-marker-${nodeId}`);
      if (markerEl) {
        const ripple = markerEl.querySelector('.signal-ripple');
        const core = markerEl.querySelector('.signal-core');
        if (ripple && core) {
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
          } else {
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
}

export const spatialStateSync = new SpatialStateSync();
