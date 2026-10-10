/**
 * OmniTRAF Surabaya - Map Popups & Overlays Manager
 * Bertanggung jawab khusus untuk format template popup Leaflet yang aman (sanitized),
 * card insiden/CCTV/sinyal/koridor, serta single-owner live sync lifecycle (tidak ada multiple setInterval bocor).
 */

import { stateStore, escapeHtml } from '../../core/stateStore.js';

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

    let popupColor = '#22c55e';
    let statusLabel = 'JALAN (HIJAU)';
    if (stateColor === 'red') {
      popupColor = '#ef4444';
      statusLabel = 'BERHENTI (MERAH)';
    } else if (stateColor === 'yellow') {
      popupColor = '#f59e0b';
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
          <span class="cctv-live-tag" style="background: ${popupColor}22; color: ${popupColor}; border: 1px solid ${popupColor}44;">
            <span class="live-dot" style="background: ${popupColor};"></span> NODE APILL
          </span>
          <span class="ios-popup-subtitle">${safeDistrict}</span>
        </div>
        <h4 class="ios-popup-title" style="margin-top: 6px; font-size: 13.5px; font-weight: 700; color: #ffffff;">🚦 ${safeName}</h4>
        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Sinyal Aktif:</span>
            <span class="ios-info-value" style="color: ${popupColor}; font-weight: 800; text-transform: uppercase;">${statusLabel}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Durasi Timer Sisa:</span>
            <span class="ios-info-value speed-val" style="color: #00e5ff; font-weight: 800;">${safeTimer} dtk</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Fase Hijau Adaptif:</span>
            <span class="ios-info-value" style="font-weight: 800;">${safeGreen} dtk</span>
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
          <span class="alert-pill" style="background: ${severity === 'danger' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'}; color: ${severity === 'danger' ? '#ef4444' : '#f59e0b'}; padding: 2px 6px; border-radius: 4px; font-weight: bold;">⚠️ INSIDEN ${safeCat}</span>
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
            <span class="ios-info-value text-primary-2" style="color: #00e5ff; font-weight: bold;">${safeUnit}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Keterangan:</span>
            <span class="ios-info-value" style="font-family: inherit; font-weight: normal; color: #cbd5e1;">${safeNotes}</span>
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
            <span class="ios-info-value speed-val" style="color: #ef4444; font-weight: 800;">${safeSpeed}</span>
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
    const lastUpdatedStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + " WIB";

    return `
      <div class="ios-popup-card">
        <div class="ios-popup-header">
          <span class="cctv-live-tag" style="background: ${los.color}22; color: ${los.color}; border: 1px solid ${los.color}44;">
            <span class="live-dot" style="background: ${los.color};"></span> ESTIMASI SIMULASI
          </span>
          <span class="ios-popup-subtitle">KORIDOR GEOSPASIAL</span>
        </div>
        <h4 class="ios-popup-title" style="margin-top: 6px; font-size: 13.5px; font-weight: 700; color: #ffffff;">🛣️ ${safeName}</h4>
        
        <div class="vc-progress-container" style="margin-top: 10px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-bottom: 4px;">
            <span>V/C Ratio (Derajat Kejenuhan)</span>
            <strong style="color: ${los.color}">${(los.vc).toFixed(2)}</strong>
          </div>
          <div class="mini-progress-bar" style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; width: 100%;">
            <div style="width: ${los.vc * 100}%; background: ${los.color}; height: 100%; border-radius: 3px; transition: width 0.5s ease-out;"></div>
          </div>
        </div>

        <div class="ios-popup-info-grid">
          <div class="ios-info-row">
            <span class="ios-info-label">Kecepatan Estimasi:</span>
            <span class="ios-info-value speed-val" style="color: #00e5ff; font-weight:800;">${speed} km/jam</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Tingkat Kepadatan:</span>
            <span class="ios-info-value" style="color: ${los.color}; font-weight: 800;">${escapeHtml(los.label)}</span>
          </div>
          <div class="ios-info-row">
            <span class="ios-info-label">Pembaruan Terakhir:</span>
            <span class="ios-info-value" style="color: var(--text-muted);">${lastUpdatedStr}</span>
          </div>
        </div>

        <div class="popup-action-buttons" style="display: flex; gap: 6px; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
          <button class="popup-action-btn btn-cctv" data-corridor="${safeId}" style="flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: rgba(0, 229, 255, 0.15); border: 1px solid rgba(0, 229, 255, 0.4); color: #00e5ff; font-size: 10.5px; font-weight: 700; padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
            📹 Lihat CCTV
          </button>
          <button class="popup-action-btn btn-apill" data-corridor="${safeId}" style="flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); color: #22c55e; font-size: 10.5px; font-weight: 700; padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
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
                <span class="ios-info-value" style="color:${status === 'ONLINE' ? '#10b981' : '#f59e0b'}; font-weight:800;">${status}</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Volume Kendaraan:</span>
                <span class="ios-info-value" style="color:#00e5ff; font-weight:800;">${vCount} Unit</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Panjang Antrean:</span>
                <span class="ios-info-value" style="color:#ef4444; font-weight:700;">${qLen} Meter</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kecepatan Rata-Rata:</span>
                <span class="ios-info-value speed-val" style="color:#22c55e;">${avgSpeed} km/jam</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Kepadatan Jalan:</span>
                <span class="ios-info-value" style="color:#f59e0b;">${density}%</span>
              </div>
              <div class="ios-info-row">
                <span class="ios-info-label">Resiko Insiden:</span>
                <span class="ios-info-value" style="color:${risk > 70 ? '#ef4444' : '#10b981'};">${risk}%</span>
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
