import { stateStore } from '../core/stateStore.js';
import { Disposer } from '../core/disposer.js';
import { City3DScene } from './city3dScene.js';
import { CAMERA_DEFINITIONS } from './cctv/cameraRegistry.js';

class City3DController {
  constructor() {
    this.scene = null;
    this.disposer = new Disposer('City3DController');
    this._isInitialized = false;
  }

  init() { this._isInitialized = true; }

  activate() {
    this.deactivate();
    const host = document.getElementById('city3dCanvasHost');
    if (!host) return;
    this._fillCameraPicker();
    this._bindControls();
    this.disposer.addStoreSubscription(stateStore, 'state:changed', () => { this.scene?.updateState(stateStore.getState()); this.setStatus(); });
    this.disposer.addStoreSubscription(stateStore, 'state:resynced', () => { this.scene?.updateState(stateStore.getState()); this.setStatus(); });
    this.disposer.addEventListener(window, 'omnitraf:entity-focus', (event) => {
      if (event.detail?.route !== 'city3d') return;
      const state = stateStore.getState();
      const id = String(event.detail.id);
      const match = event.detail.kind === 'intersection'
        ? state.intersections?.find((item) => String(item.id) === id)
        : event.detail.kind === 'incident' ? state.incidents?.find((item) => String(item.id) === id)
          : event.detail.kind === 'cctv' ? CAMERA_DEFINITIONS.find((item) => item.id === id)
            : state.devices?.find((item) => String(item.deviceId || item.id) === id);
      if (match) this.showInspector({ kind: event.detail.kind, id, name: match.name || match.title || match.deviceName || id, data: match });
    });
    try {
      const fallback = document.getElementById('city3dFallback');
      if (fallback) fallback.hidden = true;
      this.scene = new City3DScene(host, {
        onFallback: () => { if (fallback) fallback.hidden = false; },
        onFps: (fps) => { const label = document.getElementById('city3dFps'); if (label) label.textContent = `${fps} FPS`; },
        onCamera: (camera) => this.renderCameraPreview(camera),
        onSelect: (entity) => {
          if (entity.kind === 'camera') {
            const select = document.getElementById('city3dCameraSelect');
            if (select) select.value = entity.id;
            this.scene?.setVirtualCamera(entity.id);
          }
          this.showInspector(entity);
        }
      });
      document.querySelectorAll('#view-city3d [data-camera-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.cameraView === 'isometric'));
      this.scene.updateState(stateStore.getState());
      this.setStatus();
    } catch (error) {
      console.warn('[City3D] WebGL renderer could not start; 2D fallback remains available.', error);
      const fallback = document.getElementById('city3dFallback'); if (fallback) fallback.hidden = false;
      const status = document.getElementById('city3dDataStatus'); if (status) status.textContent = 'WebGL unavailable · use 2D map';
      this.scene?.dispose(); this.scene = null;
    }
  }

  _fillCameraPicker() {
    const select = document.getElementById('city3dCameraSelect');
    if (!select) return;
    const cameras = CAMERA_DEFINITIONS.filter((camera) => !camera.id.includes('Zoom') && camera.id !== 'dashCameraCanvas');
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Tidak ada kamera';
    select.replaceChildren(placeholder, ...cameras.map((camera) => {
      const option = document.createElement('option'); option.value = camera.id; option.textContent = `${camera.code} · ${camera.shortName}`; return option;
    }));
  }

  _bindControls() {
    document.querySelectorAll('#view-city3d [data-camera-view]').forEach((button) => this.disposer.addEventListener(button, 'click', () => {
      this.scene?.setView(button.dataset.cameraView);
      document.querySelectorAll('#view-city3d [data-camera-view]').forEach((item) => item.classList.toggle('is-active', item === button));
    }));
    const cameraSelect = document.getElementById('city3dCameraSelect');
    if (cameraSelect) this.disposer.addEventListener(cameraSelect, 'change', () => this.scene?.setVirtualCamera(cameraSelect.value));
    const reset = document.getElementById('city3dResetCamera');
    if (reset) this.disposer.addEventListener(reset, 'click', () => {
      this.scene?.setView('isometric');
      document.querySelector('#view-city3d [data-camera-view="isometric"]')?.click();
    });
    document.querySelectorAll('#view-city3d [data-city3d-layer]').forEach((input) => this.disposer.addEventListener(input, 'change', () => this.scene?.setLayer(input.dataset.city3dLayer, input.checked)));
    const close = document.getElementById('city3dInspectorClose');
    if (close) this.disposer.addEventListener(close, 'click', () => { const inspector = document.getElementById('city3dInspector'); if (inspector) inspector.hidden = true; });
  }

  setStatus() {
    const state = stateStore.getState();
    const status = document.getElementById('city3dDataStatus');
    if (status) status.textContent = state.isStaleData ? 'SIMULATED · STATE STALE' : `SIMULATED · ${state.connectionStatus === 'connected' ? 'STREAM SIMULATOR' : 'SIMULATOR LOCAL'}`;
  }

  renderCameraPreview(camera) {
    const preview = document.getElementById('city3dCctvPreview');
    if (!preview) return;
    preview.replaceChildren();
    const title = document.createElement('strong'); title.textContent = `Virtual camera · ${camera.name}`;
    const label = document.createElement('span'); label.textContent = 'Sudut pandang dirender dari scene sintetis yang sama; bukan feed CCTV lapangan.';
    preview.append(title, label);
  }

  showInspector(entity) {
    const inspector = document.getElementById('city3dInspector');
    const title = document.getElementById('city3dInspectorTitle');
    const summary = document.getElementById('city3dInspectorSummary');
    const properties = document.getElementById('city3dInspectorProperties');
    const links = document.getElementById('city3dInspectorLinks');
    if (!inspector || !title || !summary || !properties || !entity) return;
    const kind = entity.kind || 'vehicle';
    const data = entity.data || {};
    title.textContent = entity.name || (kind === 'vehicle' ? `Agen ${entity.type}` : 'Entity simulasi');
    summary.textContent = kind === 'vehicle' ? 'Agen kendaraan visual sintetis. Animasi mengikuti kepadatan model dan tidak merepresentasikan kendaraan individual yang terdeteksi.' : 'Entity ditempatkan pada geometri representatif dan memakai state simulator.';
    const rows = kind === 'intersection' ? [['Fase', data.state || 'Belum tersedia'], ['Green split', data.greenSplit == null ? '—' : `${data.greenSplit} dtk`], ['Antrean model', data.queueVehicles == null ? '—' : `${Math.round(data.queueVehicles)} kendaraan`], ['Arus model', data.corridor?.speedKmh == null ? '—' : `${data.corridor.speedKmh} km/jam`]]
      : kind === 'incident' ? [['Status', data.status || 'ACTIVE'], ['Severity', data.severity || '—'], ['Lokasi', data.location || '—']]
        : kind === 'camera' ? [['Feed', 'Virtual view'], ['Provenance', 'SIMULATED'], ['Intersection', entity.nodeId || 'Representasi scene']]
          : kind === 'device' ? [['Status', data.status || data.healthLevel || '—'], ['Provenance', 'SIMULATED']]
            : [['Tipe', entity.type || 'kendaraan'], ['Kecepatan animasi', `${Math.round((entity.speed || 0) * 10)} unit visual`], ['Sumber', 'Agen sintetis']];
    properties.replaceChildren(...rows.map(([label, value]) => { const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = String(value); row.append(dt, dd); return row; }));
    links.replaceChildren();
    const route = kind === 'intersection' ? 'signals' : kind === 'incident' ? 'incidents' : kind === 'camera' ? 'cctv' : kind === 'device' ? 'devices' : null;
    if (route) {
      const link = document.createElement('a'); link.href = `#${route}`; link.dataset.view = route;
      if (kind === 'intersection' || kind === 'incident' || kind === 'camera' || kind === 'device') { link.dataset.entityKind = kind === 'camera' ? 'cctv' : kind; link.dataset.entityId = String(entity.id); }
      link.textContent = route === 'signals' ? 'Buka sinyal' : route === 'incidents' ? 'Buka insiden' : route === 'cctv' ? 'Buka CCTV' : 'Buka perangkat';
      links.append(link); links.hidden = false;
    } else links.hidden = true;
    inspector.hidden = false;
  }

  deactivate() {
    this.disposer.clear();
    this.scene?.dispose(); this.scene = null;
  }
}

export const city3dController = new City3DController();
