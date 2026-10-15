/**
 * OmniTRAF Surabaya - Map Popups & Overlays Manager
 * Bertanggung jawab khusus untuk format template popup Leaflet yang aman (sanitized),
 * card insiden/CCTV/sinyal/koridor, serta single-owner live sync lifecycle (tidak ada multiple setInterval bocor).
 */

import { stateStore, escapeHtml } from '../../core/stateStore.js';

const colorTone = (color) => ({ '#22c55e': 'green', '#ef4444': 'red', '#f59e0b': 'amber', '#3b82f6': 'blue' }[String(color || '').toLowerCase()] || 'green');

export class PopupManager {
  constructor() {
    /** @type {number|null} Single live sync timer ID */
    this._liveSyncTimer = null;
    /** @type {Object|null} Currently active popup metadata */
    this._activePopupContext = null;
  }

  createIntersectionPopupContent(properties, nodeState) {
    const p = properties || {};
    const node = nodeState || {};
    const stateColor = (node.state || 'green').toLowerCase();
    const stateTone = ['red', 'yellow'].includes(stateColor) ? stateColor : 'green';

    let statusLabel = 'JALAN (HIJAU)';
    if (stateColor === 'red') {
      statusLabel = 'BERHENTI (MERAH)';
    } else if (stateColor === 'yellow') {
      statusLabel = 'PERSIAPAN (KUNING)';
    }

    const safeName = escapeHtml(p.name || 'Simpang SITS');
    const safeDistrict = escapeHtml(p.district || 'Surabaya');
    const safeTimer = Number(node.timer !== undefined ? node.timer : (p.currentTimer || 35));
    const safeGreen = Number(node.greenSplit || p.defaultGreen || 35);
    const safeWait = Number(node.waitTime || p.currentWait || 30);

    return `
      <div class="ios-popup-card">
        <div class="ios-popup-header">
          <span class="cctv-live-tag traffic-tone-${stateTone}">
            <span class="live-dot"></span> NODE APILL
          </span>
          <span class="ios-popup-subtitle">${safeDistrict}</span>
        </div>
        <h4 class="ios-popup-title csp-style-fbf169d98e" >🚦 ${safeName}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Sinyal Aktif:</span>
            <span class="ios-info-value traffic-text-${stateTone} csp-style-state-label">${statusLabel}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Durasi Timer Sisa:</span>
            <span class="ios-info-value speed-val csp-style-a6b8d83f78" >${safeTimer} dtk</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Fase Hijau Adaptif:</span>
            <span class="ios-info-value csp-style-3387c613ea" >${safeGreen} dtk</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Waktu Tunggu Sektoral:</span>
            <span class="ios-info-value">${safeWait} dtk</span>
          </div>
        </div>
      </div>
    `;
  }

  createIncidentPopupContent(incident) {
    const inc = incident || {};
    const severity = inc.severity === 'danger' ? 'danger' : 'warning';
    const safeTitle = escapeHtml(inc.title || inc.name || 'Insiden');
    const safeCat = escapeHtml(inc.category ? inc.category.toUpperCase() : 'TRAFFIC');
    const safeStatus = escapeHtml(inc.status || 'ACTIVE');
    const safeLoc = escapeHtml(inc.location || 'Surabaya');
    const safeUnit = escapeHtml(inc.assignedUnit || inc.petugas || 'Belum Ditugaskan');
    const safeNotes = escapeHtml(inc.notes || inc.jenis || 'Hambatan lajur terdeteksi.');

    return `
      <div class="ios-popup-card incident-popup">
        <div class="ios-popup-header alert">
          <span class="alert-pill incident-tone-${severity}">⚠️ INSIDEN ${safeCat}</span>
          <span class="ios-popup-subtitle">STATUS: ${safeStatus}</span>
        </div>
        <h4 class="ios-popup-title">${safeTitle}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Lokasi:</span>
            <span class="ios-info-value">${safeLoc}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Unit Disposisi:</span>
            <span class="ios-info-value text-primary-2 csp-style-47a87f3205" >${safeUnit}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Keterangan:</span>
            <span class="ios-info-value csp-style-a2c5a3fe2e" >${safeNotes}</span>
          </div>
        </div>
      </div>
    `;
  }

  createEmergencyPopupContent(emg, isPmk = false) {
    const safeVehId = escapeHtml(emg.vehicleId || 'EMG-01');
    const safeVehType = escapeHtml((emg.vehicleType || 'AMBULANS').toUpperCase());
    const safeStatus = escapeHtml(emg.status || 'EN_ROUTE');
    const safeSpeed = emg.speed !== null && emg.speed !== undefined && emg.speed !== '' && Number.isFinite(Number(emg.speed))
      ? `${Number(emg.speed)} km/jam`
      : 'Belum tersedia';
    const safeOrigin = escapeHtml(emg.origin || '-');
    const safeDest = escapeHtml(emg.destination || '-');
    const safeNext = escapeHtml(emg.nextIntersection || 'Menuju UGD');

    return `
      <div class="ios-popup-card vehicle-popup">
        <div class="ios-popup-header">
          <span class="cctv-live-tag alert"><span class="live-dot"></span> PRIORITAS UTAMA</span>
          <span class="ios-popup-subtitle">${safeVehType} STATUS: ${safeStatus}</span>
        </div>
        <h4 class="ios-popup-title">${isPmk ? '🚒' : '🚑'} ${safeVehId}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan:</span>
            <span class="ios-info-value speed-val csp-style-f7dcd241ab" >${safeSpeed}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Asal:</span>
            <span class="ios-info-value">${safeOrigin}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Tujuan:</span>
            <span class="ios-info-value">${safeDest}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Simpang Depan:</span>
            <span class="ios-info-value text-primary-2">${safeNext}</span>
          </div>
        </div>
      </div>
    `;
  }

  createCorridorPopupContent(corridorProps, los) {
    const p = corridorProps || {};
    const safeName = escapeHtml(p.name || 'Koridor');
    const safeId = escapeHtml(p.id || '');
    const speed = Number(p.speed || 30);
    const tone = colorTone(los.color);
    const lastUpdatedStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + " WIB";

    return `
      <div class="ios-popup-card">
        <div class="ios-popup-header">
          <span class="cctv-live-tag heatmap-tone-${tone}">
            <span class="live-dot"></span> ESTIMASI SIMULASI
          </span>
          <span class="ios-popup-subtitle">KORIDOR GEOSPASIAL</span>
        </div>
        <h4 class="ios-popup-title csp-style-fbf169d98e" >🛣️ ${safeName}</h4>
        
        <div class="vc-progress-container csp-style-ef850091e1" >
          <div class="csp-style-a7eea97729" >
            <span>V/C Ratio (Derajat Kejenuhan)</span>
            <strong class="traffic-text-${tone} csp-style-state-label">${(los.vc).toFixed(2)}</strong>
          </div>
          <div class="mini-progress-bar csp-style-3ff06db502" >
            <div class="vc-progress-fill heatmap-fill-${tone}" data-width="${Math.max(0, Math.min(100, Number(los.vc) * 100))}"></div>
          </div>
        </div>

        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan Estimasi:</span>
            <span class="ios-info-value speed-val csp-style-e8c35b631c" >${speed} km/jam</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Tingkat Kepadatan:</span>
            <span class="ios-info-value traffic-text-${tone} csp-style-state-label">${escapeHtml(los.label)}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Pembaruan Terakhir:</span>
            <span class="ios-info-value csp-style-9d21da37c4" >${lastUpdatedStr}</span>
          </div>
        </div>

        <div class="popup-action-buttons csp-style-64c93d72dc" >
          <button class="popup-action-btn btn-cctv csp-style-b49ff614ab" data-corridor="${safeId}" >
            📹 Lihat CCTV
          </button>
          <button class="popup-action-btn btn-apill csp-style-3190f8efad" data-corridor="${safeId}" >
            🚦 Atur APILL
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Attach corridor actions without inline event handlers, which CSP blocks.
   */
  bindCorridorActions(popup) {
    const popupElement = popup?.getElement?.();
    if (!popupElement) return;

    popupElement.querySelectorAll('.btn-cctv:not([data-action-bound]), .btn-apill:not([data-action-bound])').forEach(button => {
      button.dataset.actionBound = 'true';
      button.addEventListener('click', () => {
        const handler = button.classList.contains('btn-cctv')
          ? window.handleCorridorCctv
          : window.handleCorridorApill;
        if (typeof handler === 'function') handler(button.dataset.corridor || '');
      });
    });
  }

  /**
   * Bind live CCTV telemetry sync to the currently open popup.
   * Utilizes a single timer owner to guarantee zero interval leaks.
   */
  bindCctvLiveSync(popup) {
    this.unbindCctvLiveSync(); // Ensure single active lifecycle owner

    const node = popup?.getElement();
    if (!node) return;

    const titleEl = node.querySelector('.ios-popup-title');
    if (titleEl && titleEl.textContent.includes('CCTV')) {
      const name = titleEl.textContent.replace('📷 ', '').trim();
      const state = stateStore.getState();
      const metricsMap = state.cctvCamerasMetrics || {};

      let matchedCamId = null;
      for (const [camId, cam] of Object.entries(metricsMap)) {
        if (name.toLowerCase().includes(cam.name.toLowerCase()) || cam.name.toLowerCase().includes(name.toLowerCase())) {
          matchedCamId = camId;
          break;
        }
      }

      if (matchedCamId) {
        this._activePopupContext = { popup, camId: matchedCamId };

        this._liveSyncTimer = setInterval(() => {
          if (!this._activePopupContext || !this._activePopupContext.popup) {
            this.unbindCctvLiveSync();
            return;
          }

          const currentNode = this._activePopupContext.popup.getElement();
          if (!currentNode) {
            this.unbindCctvLiveSync();
            return;
          }

          const freshState = stateStore.getState();
          const freshCam = freshState.cctvCamerasMetrics?.[this._activePopupContext.camId];
          if (!freshCam) return;

          const infoGrid = currentNode.querySelector('.ios-popup-info-grid');
          if (infoGrid) {
            const vCount = Number(freshCam.metrics.vehicleCount || 0);
            const qLen = Number(freshCam.metrics.queueLengthMeters || 0);
            const avgSpeed = Number(freshCam.metrics.estimatedAverageSpeed || 0);
            const density = Number(freshCam.metrics.trafficDensity || 0);
            const risk = Number(freshCam.metrics.incidentRisk || 0);
            const status = escapeHtml(freshCam.status || 'ONLINE');

            infoGrid.innerHTML = `
              <div class="ios-info-row">
                <span class="ios-info-label">Status Kamera:</span>
                <span class="ios-info-value traffic-text-${status === 'ONLINE' ? 'green' : 'amber'} csp-style-state-label">${status}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Volume Kendaraan:</span>
                <span class="ios-info-value csp-style-599033843d" >${vCount} Unit</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Panjang Antrean:</span>
                <span class="ios-info-value csp-style-a46f4d83f6" >${qLen} Meter</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val csp-style-0b9417d19e" >${avgSpeed} km/jam</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kepadatan Jalan:</span>
                <span class="ios-info-value csp-style-398922df1f" >${density}%</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Resiko Insiden:</span>
                <span class="ios-info-value ${risk > 70 ? 'traffic-text-red' : 'traffic-text-green'}">${risk}%</span>
              </div>
            `;
          }
        }, 300);
      }
    }
  }

  /**
   * Stop single live sync timer and clean popup state
   */
  unbindCctvLiveSync() {
    if (this._liveSyncTimer) {
      clearInterval(this._liveSyncTimer);
      this._liveSyncTimer = null;
    }
    this._activePopupContext = null;
  }
}

export const popupManager = new PopupManager();
