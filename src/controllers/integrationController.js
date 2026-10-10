import { stateStore } from '../core/stateStore.js';

const DEMO_ENDPOINTS = new Set([
  '/sits/api/v1/telemetry',
  '/sits/api/v1/incidents',
  '/sits/api/v1/preemption'
]);
const MAX_PAYLOAD_LENGTH = 8192;
const MAX_LOG_LINES = 80;

export class IntegrationController {
  constructor() {
    this._isInitialized = false;
    this.requestSequence = 0;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this.root = document.getElementById('view-integration');
    if (!this.root) return;

    this.terminal = this.root.querySelector('#terminalLogs');
    this.terminalInput = this.root.querySelector('#terminalCommandInput');
    this.endpoint = this.root.querySelector('#apiEndpoint');
    this.payload = this.root.querySelector('#apiPayloadEditor');
    this.validateTag = this.root.querySelector('#apiJsonValidateTag');
    this.sendButton = this.root.querySelector('#btnSendApiRequest');
    this.statusBadge = this.root.querySelector('#apiStatusBadge');
    this.response = this.root.querySelector('#apiResponseContent');

    this.terminalInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._runTerminalCommand(this.terminalInput.value);
    });
    this.payload?.addEventListener('input', () => this._validatePayload());
    this.sendButton?.addEventListener('click', () => this._sendDemoRequest());
    this._validatePayload();
  }

  _appendTerminalLine(message, tone = 'neutral') {
    if (!this.terminal) return;
    const line = document.createElement('div');
    line.className = `terminal-line is-${tone}`;
    line.textContent = String(message);
    this.terminal.append(line);
    while (this.terminal.children.length > MAX_LOG_LINES) this.terminal.firstElementChild?.remove();
    this.terminal.scrollTop = this.terminal.scrollHeight;
  }

  async _runTerminalCommand(rawCommand) {
    const command = String(rawCommand || '').trim().toLowerCase();
    if (!command) return;
    this.terminalInput.value = '';
    this._appendTerminalLine(`demo> ${command}`, 'info');

    switch (command) {
      case '/help':
        this._appendTerminalLine('Perintah lokal: /help, /clear, /ping, /status. Tidak ada shell atau perintah sistem.', 'info');
        break;
      case '/clear':
        this.terminal?.replaceChildren();
        this._appendTerminalLine('[DEMO] Log terminal lokal dibersihkan.', 'neutral');
        break;
      case '/ping':
        try {
          const started = Date.now();
          const response = await fetch('/api/state/snapshot', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error(response.status === 401 ? 'Masuk untuk memeriksa endpoint server.' : `HTTP ${response.status}`);
          await response.json();
          this._appendTerminalLine(`[SERVER SIMULATOR] GET /api/state/snapshot → HTTP ${response.status}, ${Date.now() - started} ms. Ini hanya memeriksa server OmniTRAF lokal.`, 'success');
        } catch (error) { this._appendTerminalLine(`Pemeriksaan server gagal: ${error.message}`, 'warning'); }
        break;
      case '/status': {
        const state = stateStore.getState();
        this._appendTerminalLine(`[DEMO] State simulator: ${state.isStaleData ? 'STALE' : 'tersedia'}; ${state.intersections?.length || 0} simpang model; ${state.incidents?.length || 0} insiden.`, 'info');
        break;
      }
      default:
        this._appendTerminalLine('Perintah tidak dikenal. Gunakan /help.', 'warning');
    }
  }

  _parsePayload() {
    const raw = this.payload?.value ?? '{}';
    if (raw.length > MAX_PAYLOAD_LENGTH) throw new Error(`Payload melebihi batas ${MAX_PAYLOAD_LENGTH} karakter.`);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { throw new Error('JSON tidak valid. Periksa tanda kutip, koma, dan kurung.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Payload harus berupa object JSON.');
    }
    return parsed;
  }

  _validatePayload() {
    if (!this.payload || !this.validateTag || !this.sendButton) return false;
    try {
      this._parsePayload();
      this.validateTag.textContent = 'JSON VALID';
      this.validateTag.dataset.state = 'valid';
      this.payload.removeAttribute('aria-invalid');
      this.sendButton.disabled = false;
      this.sendButton.removeAttribute('title');
      return true;
    } catch (error) {
      this.validateTag.textContent = 'JSON INVALID';
      this.validateTag.dataset.state = 'invalid';
      this.payload.setAttribute('aria-invalid', 'true');
      this.sendButton.disabled = true;
      this.sendButton.title = error.message;
      return false;
    }
  }

  _buildDemoResponse(endpoint, payload, requestId) {
    const state = stateStore.getState();
    const meta = {
      simulationOnly: true,
      source: 'OmniTRAF local simulation state',
      requestId
    };

    if (endpoint === '/sits/api/v1/telemetry') {
      return {
        status: 'simulated', meta,
        data: {
          provenance: state.lastTelemetrySource || 'SIMULATED',
          stateVersion: state.stateVersion ?? null,
          intersections: state.intersections?.length ?? 0,
          connectedDevices: state.devices?.filter((device) => !['OFFLINE', 'FAULT'].includes(String(device.healthLevel || device.status || '').toUpperCase())).length ?? 0,
          stale: Boolean(state.isStaleData)
        },
        request: payload
      };
    }
    if (endpoint === '/sits/api/v1/incidents') {
      return {
        status: 'simulated', meta,
        data: (state.incidents || []).map(({ id, title, status, severity, priority }) => ({ id, title, status, severity: severity || priority })),
        request: payload
      };
    }
    if (endpoint === '/sits/api/v1/preemption') {
      return {
        status: 'simulated', meta,
        data: (state.activeEmergencies || []).map(({ id, vehicleId, status, route, incidentId }) => ({ id, vehicleId, status, route, incidentId })),
        request: payload
      };
    }
    throw new Error('Endpoint tidak terdaftar pada allowlist sandbox.');
  }

  async _sendDemoRequest() {
    if (!this.sendButton || this.sendButton.disabled) return;
    const endpoint = this.endpoint?.value;
    if (!DEMO_ENDPOINTS.has(endpoint)) {
      this._showError('Endpoint tidak diizinkan oleh sandbox lokal.');
      return;
    }

    let payload;
    try { payload = this._parsePayload(); }
    catch (error) { this._validatePayload(); this._showError(error.message); return; }

    this.sendButton.disabled = true;
    this.sendButton.setAttribute('aria-busy', 'true');
    this.sendButton.textContent = 'Menjalankan simulasi…';
    this._setStatus('LOADING');
    if (this.response) this.response.textContent = 'Menyiapkan respons lokal…';
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    try {
      const requestId = `sandbox-${++this.requestSequence}`;
      const result = this._buildDemoResponse(endpoint, payload, requestId);
      if (this.response) this.response.textContent = JSON.stringify(result, null, 2);
      this._setStatus('CONTOH LOKAL');
      this._appendTerminalLine(`[CONTOH LOKAL] Input ${endpoint} → respons simulasi (request ${requestId}).`, 'success');
    } catch (error) {
      this._showError(error.message || 'Permintaan sandbox gagal.');
    } finally {
      this.sendButton.disabled = !this._validatePayload();
      this.sendButton.removeAttribute('aria-busy');
      this.sendButton.textContent = 'Jalankan contoh lokal';
    }
  }

  _setStatus(status) {
    if (this.statusBadge) this.statusBadge.textContent = status;
    if (this.statusBadge) this.statusBadge.dataset.state = status.startsWith('SIMULATED') ? 'success' : status;
  }

  _showError(message) {
    this._setStatus('ERROR');
    if (this.response) this.response.textContent = JSON.stringify({ status: 'error', simulationOnly: true, message }, null, 2);
  }
}

export const integrationController = new IntegrationController();
