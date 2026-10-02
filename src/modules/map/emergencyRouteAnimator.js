/**
 * OmniTRAF Surabaya - Emergency Route Animator
 * Bertanggung jawab khusus untuk 60 FPS Normalized Euclidean Distance Animation
 * bagi simulasi armada darurat 112 dan preemption display.
 *
 * Pemisahan arsitektur:
 * - Route points & trajectory model
 * - Normalized progress: 0.0 -> 1.0
 * - Segment & local interpolation (visual approximation)
 * - Single RAF owner loop dengan cleanup deterministik
 */

import { stateStore } from '../../core/stateStore.js';
import { soundManager } from '../../core/soundManager.js';
import { calculateVisualDistance } from './coordinateUtils.js';

export function calculateDistance(p1, p2) {
  return calculateVisualDistance(p1, p2);
}

export class EmergencyRouteAnimator {
  constructor() {
    this.emergency112Sim = {
      active: false,
      marker: null,
      routePoints: [],
      latlngs: [],
      clearedNodes: new Set(),
      pastNodes: new Set(),
      totalDurationSec: 40,
      startTime: 0,
      animId: null
    };
  }

  /**
   * Start 112 emergency route simulation across maps
   */
  start(maps, layerGroupsMap, onUpdate, onComplete) {
    this.stop(layerGroupsMap);

    const ROUTE_POINTS = [
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
    ];

    const latlngs = ROUTE_POINTS.map(pt => [pt.lat, pt.lng]);

    // Render polyline rute darurat berpendar neon
    layerGroupsMap.forEach((groups, containerId) => {
      const simGroup = groups['emergency-sim-route'];
      const map = maps.get(containerId);
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

    maps.forEach((map, containerId) => {
      const simGroup = layerGroupsMap.get(containerId)?.['emergency-sim-route'];
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
      startTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      onUpdate,
      onComplete
    };

    // Aktifkan Green Wave global di traffic engine
    stateStore.setState({ emergency112Active: true });
    stateStore.publish('traffic:green-wave', { active: true });
    soundManager.play('siren');

    // Tampilkan Floating Telemetry HUD
    this._renderEmergencyHud(true, (isFin) => this.stop(layerGroupsMap, isFin));

    // Single RAF owner loop for emergency simulation
    const runSimStep = (timestamp) => {
      if (!this.emergency112Sim.active) return;

      const sim = this.emergency112Sim;
      const elapsed = (timestamp - sim.startTime) / 1000;
      const progressRatio = Math.min(1, elapsed / sim.totalDurationSec);

      // Normalized Progress: 0.0 -> 1.0 mapped to segments
      const numSegments = ROUTE_POINTS.length - 1;
      const totalProgress = progressRatio * numSegments;
      const currentSeg = Math.min(numSegments - 1, Math.floor(totalProgress));
      const segFraction = totalProgress - currentSeg;

      const p1 = ROUTE_POINTS[currentSeg];
      const p2 = ROUTE_POINTS[currentSeg + 1] || ROUTE_POINTS[currentSeg];

      // Lerp koordinat visual
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

        // 2. Ambulans sudah melewati simpang: Kembalikan ke siklus normal
        if (sim.clearedNodes.has(pt.id) && !sim.pastNodes.has(pt.id)) {
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
        this.stop(layerGroupsMap, true);
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
      window.showToast(`Simulasi green wave: ${nodeName} ditampilkan sebagai prioritas; APILL tidak terhubung.`, 'warning');
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
      window.showToast(`Skenario demo di ${nodeName} selesai; state simulator dikembalikan.`);
    }
  }

  _renderEmergencyHud(show, onStopFn) {
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
              <small>ETA SIMULASI • RSUD SOETOMO</small>
              <strong id="efh-eta" class="efh-val-primary">02:40</strong>
            </div>
            <div class="efh-stat">
              <small>KECEPATAN SIMULASI</small>
              <strong id="efh-speed" class="efh-val-speed">78 km/j</strong>
            </div>
            <div class="efh-stat efh-stat-wide">
              <small>STATUS CLEARANCE SIMPANG</small>
              <strong id="efh-node" class="efh-val-node">Simpang Jemursari: PREEMPTING</strong>
            </div>
          </div>
          <div class="efh-progress-bar">
            <div class="efh-progress-fill" id="efh-progress"></div>
          </div>
        `;

        const closeBtn = hud.querySelector('.efh-close-btn');
        if (closeBtn && typeof onStopFn === 'function') {
          closeBtn.addEventListener('click', () => {
            onStopFn(false);
            soundManager.play('click');
          });
        }

        parent.appendChild(hud);
      }
    });
  }

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
   * Stop simulation cleanly
   */
  stop(layerGroupsMap, isFinished = false) {
    if (this.emergency112Sim && this.emergency112Sim.animId) {
      cancelAnimationFrame(this.emergency112Sim.animId);
      this.emergency112Sim.animId = null;
    }

    this.emergency112Sim.active = false;

    // Bersihkan rute dan marker dari layer
    if (layerGroupsMap) {
      layerGroupsMap.forEach(groups => {
        const simGroup = groups['emergency-sim-route'];
        if (simGroup) simGroup.clearLayers();
      });
    }

    this._renderEmergencyHud(false);

    // Kembalikan status sinyal ke siklus normal
    stateStore.setState({ emergency112Active: false });
    stateStore.publish('traffic:green-wave', { active: false });

    // Hapus seluruh kelas clearance dari marker simpang di DOM
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.pulse-green-wave-clearance').forEach(el => {
        el.classList.remove('pulse-green-wave-clearance');
      });
    }

    if (isFinished) {
      soundManager.play('success');
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Skenario kendaraan demo mencapai tujuan; tidak ada ambulans atau sinyal nyata yang terlibat.');
      }
    }
  }
}

export const emergencyRouteAnimator = new EmergencyRouteAnimator();
