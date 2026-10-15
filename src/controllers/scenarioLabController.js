const STORAGE_KEY = 'omnitraf.scenarioLab.saved.v1';
const METRIC_LABELS = {
  averageSpeedKmh: 'Kecepatan rata-rata', averageTravelTimeMinutes: 'Waktu tempuh rata-rata',
  queueMeters: 'Panjang antrean', congestionIndex: 'Indeks kepadatan', throughputVehPerHour: 'Throughput'
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class ScenarioLabController {
  constructor() {
    this.initialized = false;
    this.active = false;
    this.sessionId = null;
    this.snapshot = null;
    this.comparison = null;
    this.presets = [];
    this.timer = null;
    this.stepping = false;
    this.playbackSpeed = 1;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    document.addEventListener('click', event => this._onClick(event));
    document.addEventListener('input', event => {
      if (event.target?.id === 'scenarioDemand') this._setText('scenarioDemandValue', `${Number(event.target.value).toFixed(2).replace('.', ',')}×`);
    });
    document.addEventListener('change', event => {
      if (event.target?.id === 'scenarioPreset') this._applyPreset(event.target.value);
      if (event.target?.id === 'scenarioSavedSelect') this._loadSaved(event.target.value);
    });
    window.addEventListener('hashchange', () => this._syncPreviewVisibility());
  }

  async activate() {
    if (!document.getElementById('scenarioLabPanel')) return;
    this.active = true;
    await this._loadPresets();
    this._renderSavedOptions();
    this._restorePreview();
    const savedSessionId = sessionStorage.getItem('omnitraf.scenarioLab.session');
    if (!this.sessionId && savedSessionId) {
      this.sessionId = savedSessionId;
      try { this._render(await this._request(`/api/scenario-lab/sessions/${encodeURIComponent(savedSessionId)}`)); }
      catch { this.sessionId = null; sessionStorage.removeItem('omnitraf.scenarioLab.session'); }
    }
  }

  deactivate() {
    this.active = false;
    this._stopTimer();
    if (this.sessionId && this.snapshot?.status === 'running') {
      this._control('pause').catch(() => {});
    }
  }

  async _request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    let payload = {};
    try { payload = await response.json(); } catch { /* API error body may not be JSON */ }
    if (!response.ok) throw new Error(payload.error?.message || payload.message || `Request gagal (${response.status})`);
    return payload.data || payload.extra?.data || payload.extra || {};
  }

  async _loadPresets() {
    try {
      const data = await this._request('/api/scenario-lab/presets');
      this.presets = data.presets || [];
      const corridor = document.getElementById('scenarioCorridor');
      if (corridor && data.corridors?.length > 0 && corridor.options.length === 1) {
        for (const item of data.corridors) corridor.add(new Option(item.name, item.id));
      }
      this._populateComparisons();
    } catch (error) { this._status(`Tidak dapat memuat preset: ${error.message}`, true); }
  }

  _populateComparisons() {
    for (const id of ['scenarioCompareBase', 'scenarioCompareAlt']) {
      const select = document.getElementById(id);
      if (!select || !this.presets.length) continue;
      const selected = select.value;
      select.replaceChildren(...this.presets.map(preset => new Option(preset.name, preset.id)));
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }
  }

  _applyPreset(id) {
    const preset = this.presets.find(item => item.id === id);
    if (!preset) return;
    const config = preset.config;
    this._value('scenarioDemand', config.demandMultiplier ?? 1);
    this._value('scenarioWeather', config.weather || 'clear');
    this._value('scenarioIncident', config.incidentSeverity || 'none');
    this._value('scenarioStrategy', config.signalStrategy || 'fixed');
    this._setText('scenarioDemandValue', `${Number(config.demandMultiplier ?? 1).toFixed(2).replace('.', ',')}×`);
  }

  _readConfig() {
    return {
      seed: Number(document.getElementById('scenarioSeed')?.value),
      hour: Number(document.getElementById('scenarioHour')?.value),
      horizonMinutes: Number(document.getElementById('scenarioHorizon')?.value),
      corridorId: document.getElementById('scenarioCorridor')?.value || 'all',
      demandMultiplier: Number(document.getElementById('scenarioDemand')?.value),
      weather: document.getElementById('scenarioWeather')?.value || 'clear',
      incidentSeverity: document.getElementById('scenarioIncident')?.value || 'none',
      signalStrategy: document.getElementById('scenarioStrategy')?.value || 'fixed'
    };
  }

  async _onClick(event) {
    if (event.target.closest?.('#scenarioPreviewReturn')) { window.location.hash = '#prediction'; return; }
    if (event.target.closest?.('#scenarioPreviewClose')) { sessionStorage.removeItem('omnitraf.scenarioLab.preview'); document.getElementById('scenarioLabPreview')?.remove(); return; }
    const speedBtn = event.target.closest?.('.scenario-speed-btn');
    if (speedBtn) {
      const speed = Number(speedBtn.getAttribute('data-speed')) || 1;
      this._setSpeed(speed);
      return;
    }
    const track = event.target.closest?.('#scenarioProgressTrack');
    if (track && this.sessionId) {
      await this._handleTrackClick(event, track);
      return;
    }
    const button = event.target.closest?.('[id^="scenario"]');
    if (!button) return;
    try {
      switch (button.id) {
        case 'scenarioRunButton': await this._createRun(); break;
        case 'scenarioPlayButton': await this._play(); break;
        case 'scenarioPauseButton': await this._pause(); break;
        case 'scenarioResetButton': await this._control('reset'); break;
        case 'scenarioReplayButton': await this._replay(); break;
        case 'scenarioSaveButton': this._saveConfig(); break;
        case 'scenarioCompareButton': await this._compare(); break;
        case 'scenarioExportJson': this._exportJson(); break;
        case 'scenarioExportCsv': this._exportCsv(); break;
        default: return;
      }
    } catch (error) { this._status(error.message, true); }
  }

  _setSpeed(speed) {
    this.playbackSpeed = speed;
    for (const btn of document.querySelectorAll('.scenario-speed-btn')) {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-speed')) === speed);
    }
    if (this.timer) {
      this._startTimer();
    }
  }

  async _handleTrackClick(event, track) {
    if (!this.snapshot || this.snapshot.status === 'idle') return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const targetPct = clickX / rect.width;
    const targetMinutes = Math.round(targetPct * (this.snapshot.config?.horizonMinutes || 30));
    const currentMinutes = this.snapshot.elapsedMinutes || 0;
    if (targetMinutes > currentMinutes) {
      const stepsToRun = targetMinutes - currentMinutes;
      for (let i = 0; i < stepsToRun; i++) {
        const data = await this._control('step');
        if (data.status !== 'running') break;
      }
    }
  }

  async _createRun() {
    const data = await this._request('/api/scenario-lab/sessions', { method: 'POST', body: JSON.stringify(this._readConfig()) });
    this.sessionId = data.id;
    sessionStorage.setItem('omnitraf.scenarioLab.session', data.id);
    this.comparison = null;
    await this._play();
  }

  async _play() {
    if (!this.sessionId) throw new Error('Buat skenario sebelum menjalankan timeline.');
    this._render(await this._control('play'));
    this._startTimer();
  }

  async _pause() {
    this._stopTimer();
    if (this.sessionId) this._render(await this._control('pause'));
  }

  async _replay() {
    if (!this.sessionId) return;
    this._stopTimer();
    this._render(await this._control('replay'));
    this._startTimer();
  }

  async _control(action) {
    const data = await this._request(`/api/scenario-lab/sessions/${encodeURIComponent(this.sessionId)}/control`, { method: 'POST', body: JSON.stringify({ action }) });
    this._render(data);
    return data;
  }

  _startTimer() {
    this._stopTimer();
    const interval = Math.max(50, Math.round(500 / (this.playbackSpeed || 1)));
    this.timer = window.setInterval(async () => {
      if (!this.active || this.stepping || !this.sessionId) return;
      this.stepping = true;
      try {
        const data = await this._control('step');
        if (data.status !== 'running') this._stopTimer();
      } catch (error) { this._stopTimer(); this._status(error.message, true); }
      finally { this.stepping = false; }
    }, interval);
  }

  _stopTimer() { if (this.timer) window.clearInterval(this.timer); this.timer = null; }

  async _compare() {
    const config = this._readConfig();
    const data = await this._request('/api/scenario-lab/compare', {
      method: 'POST', body: JSON.stringify({ baseline: this._value('scenarioCompareBase'), alternative: this._value('scenarioCompareAlt'), seed: config.seed, hour: config.hour, horizonMinutes: config.horizonMinutes, corridorId: config.corridorId })
    });
    this.comparison = data;
    this._renderComparison(data);
    for (const id of ['scenarioExportJson', 'scenarioExportCsv']) { const button = document.getElementById(id); if (button) button.disabled = false; }
    this._status(`Perbandingan selesai · seed ${data.seed} · initial state sama`);
  }

  _saveConfig() {
    const config = this._readConfig();
    const name = window.prompt('Nama konfigurasi skenario:', this.presets.find(item => item.id === this._value('scenarioPreset'))?.name || 'Skenario baru');
    if (!name?.trim()) return;
    const saved = this._readSaved();
    saved.push({ id: crypto.randomUUID(), name: name.trim(), config });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(-20)));
    this._renderSavedOptions();
    this._status('Konfigurasi disimpan di browser ini.');
  }

  _readSaved() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }

  _renderSavedOptions() {
    const select = document.getElementById('scenarioSavedSelect');
    if (!select) return;
    const saved = this._readSaved();
    select.replaceChildren(new Option('Pilih konfigurasi lokal', ''), ...saved.map(item => new Option(item.name, item.id)));
  }

  _loadSaved(id) {
    const item = this._readSaved().find(saved => saved.id === id);
    if (!item) return;
    const config = item.config;
    for (const [field, value] of Object.entries({ scenarioSeed: config.seed, scenarioHour: config.hour, scenarioHorizon: config.horizonMinutes, scenarioCorridor: config.corridorId, scenarioDemand: config.demandMultiplier, scenarioWeather: config.weather, scenarioIncident: config.incidentSeverity, scenarioStrategy: config.signalStrategy })) this._value(field, value);
    this._setText('scenarioDemandValue', `${Number(config.demandMultiplier).toFixed(2).replace('.', ',')}×`);
    this._status(`Konfigurasi “${item.name}” dimuat.`);
  }

  _render(data) {
    this.snapshot = data;
    const progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
    const track = document.getElementById('scenarioProgressTrack');
    if (track) track.setAttribute('aria-valuenow', String(progress));
    const fill = document.getElementById('scenarioProgressFill'); if (fill) fill.style.width = `${progress}%`;
    this._setText('scenarioTimelinePct', `${progress}%`);
    this._setText('scenarioTimelineLabel', `${data.status || 'idle'} · menit ${data.elapsedMinutes || 0}/${data.config?.horizonMinutes || 0} · seed ${data.config?.seed ?? '—'}`);
    const tickRoot = document.getElementById('scenarioTimelineTicks');
    if (tickRoot) tickRoot.replaceChildren(...[0, .25, .5, .75, 1].map(fraction => { const tick = document.createElement('span'); tick.textContent = `${Math.round((data.config?.horizonMinutes || 30) * fraction)} min`; return tick; }));
    const markerRoot = document.getElementById('scenarioEventMarkers');
    const eventList = document.getElementById('scenarioEventList');
    const markers = data.markers || [];
    if (markerRoot) {
      markerRoot.innerHTML = markers.map(marker => `<span class="scenario-event-marker" data-marker-minute="${Math.max(0, Math.min(100, marker.minute / Math.max(1, data.config?.horizonMinutes || 1) * 100))}" title="${escapeHtml(marker.label)} menit ${marker.minute}"></span>`).join('');
      markerRoot.querySelectorAll('[data-marker-minute]').forEach((marker) => { marker.style.left = `${Number(marker.dataset.markerMinute)}%`; });
    }
    if (eventList) eventList.textContent = markers.length ? markers.map(marker => `${marker.label} · menit ${marker.minute}`).join('  •  ') : 'Belum ada event pada run ini.';
    this._renderMetrics(data.metrics);
    this._renderCorridors(data.corridors || []);
    this._renderChart(data.timeline || []);
    if (data.metrics) this._saveAndMountPreview(data);
    else if (data.status === 'idle') { sessionStorage.removeItem('omnitraf.scenarioLab.preview'); document.getElementById('scenarioLabPreview')?.remove(); }
    const hasSession = Boolean(data.id);
    for (const id of ['scenarioPlayButton', 'scenarioPauseButton', 'scenarioResetButton', 'scenarioReplayButton']) { const button = document.getElementById(id); if (button) button.disabled = !hasSession; }
    for (const id of ['scenarioExportJson', 'scenarioExportCsv']) { const button = document.getElementById(id); if (button) button.disabled = !(data.metrics || this.comparison); }
    this._status(`Sandbox terisolasi · ${data.status || 'idle'} · simulator authoritative tidak berubah`);
    if (data.status === 'completed' || data.status === 'idle') this._stopTimer();
  }

  _renderMetrics(metrics) {
    if (!metrics) return;
    const values = [
      ['Kecepatan rata-rata', metrics.averageSpeedKmh, 'km/jam'],
      ['Antrean model', metrics.queueMeters, 'meter'],
      ['Indeks kepadatan', metrics.congestionIndex, '0–100'],
      ['Throughput', metrics.throughputVehPerHour, 'kendaraan/jam']
    ];
    const root = document.getElementById('scenarioMetricGrid');
    if (root) root.innerHTML = values.map(([label, value, unit]) => `<article class="scenario-metric-card"><span>${label}</span><strong>${escapeHtml(value ?? '—')}</strong><small>${unit}</small></article>`).join('');
  }

  _renderCorridors(corridors) {
    const root = document.getElementById('scenarioCorridorRows'); if (!root) return;
    root.innerHTML = corridors.length ? corridors.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.demandVehPerHour)} kend/jam</td><td>${escapeHtml(item.speedKmh)} km/jam</td><td>${escapeHtml(item.queueMeters)} m</td><td>${escapeHtml(item.congestionIndex)}/100</td><td>${escapeHtml(item.greenSplitSec)} dtk</td></tr>`).join('') : '<tr><td colspan="6">Belum ada hasil model.</td></tr>';
  }

  _renderChart(points) {
    const root = document.getElementById('scenarioTimelineChart'); if (!root) return;
    if (!points.length) { root.className = 'scenario-chart-empty'; root.textContent = 'Jalankan skenario untuk melihat seri metrik per menit.'; return; }
    root.className = '';
    const width = 720; const height = 160; const padX = 34; const padY = 16;
    const values = points.map(item => Math.max(0, Number(item.queueMeters) || 0));
    const maximum = Math.max(1, ...values) * 1.1;
    const position = (value, index) => `${padX + (points.length < 2 ? 0 : index / (points.length - 1) * (width - padX * 2))},${height - padY - value / maximum * (height - padY * 2)}`;
    const line = values.map(position).join(' ');
    const first = position(values[0], 0).split(',')[0]; const last = position(values.at(-1), values.length - 1).split(',')[0];
    root.innerHTML = `<svg class="scenario-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Antrean simulasi per menit"><defs><linearGradient id="scenarioQueueFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0ea5e9" stop-opacity=".22"/><stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/></linearGradient></defs><line class="scenario-chart-grid" x1="${padX}" x2="${width - padX}" y1="${padY}" y2="${padY}"/><line class="scenario-chart-grid" x1="${padX}" x2="${width - padX}" y1="${height / 2}" y2="${height / 2}"/><line class="scenario-chart-grid" x1="${padX}" x2="${width - padX}" y1="${height - padY}" y2="${height - padY}"/><polygon class="scenario-chart-area" points="${first},${height - padY} ${line} ${last},${height - padY}"/><polyline class="scenario-chart-line" points="${line}"/><text class="scenario-chart-label" x="${padX}" y="${height - 1}">menit 0</text><text class="scenario-chart-label" x="${width - padX}" y="${height - 1}" text-anchor="end">menit ${escapeHtml(points.at(-1).minute)}</text><text class="scenario-chart-label" x="2" y="${padY + 4}">${escapeHtml(Math.round(maximum))} m</text></svg>`;
  }

  _renderComparison(data) {
    const root = document.getElementById('scenarioComparisonResult'); if (!root) return;
    const delta = data.delta || {};
    root.hidden = false;
    const chartKeys = ['averageSpeedKmh', 'averageTravelTimeMinutes', 'queueMeters', 'congestionIndex', 'throughputVehPerHour'];
    root.innerHTML = `<div class="scenario-comparison-head"><div><span class="scenario-lab-kicker">SAME INITIAL STATE · SEED ${escapeHtml(data.seed)}</span><h3>${escapeHtml(data.baseline.name)} <span aria-hidden="true">→</span> ${escapeHtml(data.alternative.name)}</h3></div><span class="scenario-sim-label">SIMULATED</span></div><div class="scenario-delta-grid">${Object.entries(METRIC_LABELS).map(([key, label]) => `<div class="scenario-delta"><span>${label}</span><strong>${Number(delta[key] || 0) > 0 ? '+' : ''}${escapeHtml(delta[key] ?? 0)}${key === 'averageSpeedKmh' ? ' km/j' : key === 'averageTravelTimeMinutes' ? ' mnt' : key === 'queueMeters' ? ' m' : ''}</strong></div>`).join('')}</div><div class="scenario-compare-bars" role="img" aria-label="Perbandingan metrik baseline dan alternatif">${chartKeys.map(key => { const base = Number(data.baseline.metrics[key]) || 0; const alt = Number(data.alternative.metrics[key]) || 0; const max = Math.max(1, base, alt); const label = METRIC_LABELS[key]; return `<div class="scenario-compare-row"><span>${label}</span><div class="scenario-compare-track"><i class="baseline scenario-compare-fill" data-bar-width="${Math.max(0, Math.min(100, base / max * 100))}"></i><i class="alternative scenario-compare-fill" data-bar-width="${Math.max(0, Math.min(100, alt / max * 100))}"></i></div><small>${escapeHtml(base)} / ${escapeHtml(alt)}</small></div>`; }).join('')}<div class="scenario-compare-legend"><span><i class="baseline"></i>Baseline</span><span><i class="alternative"></i>Alternatif</span></div></div><div class="scenario-chart-heading"><span class="analytics-units-label">Baseline ${escapeHtml(data.baseline.metrics.averageSpeedKmh)} km/j · ${escapeHtml(data.baseline.metrics.queueMeters)} m antrean</span><span class="analytics-units-label">Alternatif ${escapeHtml(data.alternative.metrics.averageSpeedKmh)} km/j · ${escapeHtml(data.alternative.metrics.queueMeters)} m antrean</span></div>`;
    root.querySelectorAll('[data-bar-width]').forEach((bar) => { bar.style.width = `${Number(bar.dataset.barWidth)}%`; });
  }

  _saveAndMountPreview(data) {
    const preview = { id: data.id, config: data.config, metrics: data.metrics, status: data.status, provenance: 'SIMULATED' };
    sessionStorage.setItem('omnitraf.scenarioLab.preview', JSON.stringify(preview));
    this._mountPreview(preview);
  }

  _restorePreview() {
    try { const preview = JSON.parse(sessionStorage.getItem('omnitraf.scenarioLab.preview') || 'null'); if (preview?.metrics) this._mountPreview(preview); } catch { sessionStorage.removeItem('omnitraf.scenarioLab.preview'); }
  }

  _mountPreview(preview) {
    let ribbon = document.getElementById('scenarioLabPreview');
    if (!ribbon) {
      ribbon = document.createElement('aside');
      ribbon.id = 'scenarioLabPreview';
      ribbon.className = 'scenario-lab-preview-ribbon';
      ribbon.setAttribute('aria-label', 'Pratinjau metrik sandbox Scenario Lab');
      document.body.append(ribbon);
    }
    ribbon.innerHTML = `<span class="scenario-preview-kicker">LAB PREVIEW · ${escapeHtml(preview.status || 'SIMULATED')}</span><strong>${escapeHtml(preview.config?.seed ?? '—')} · ${escapeHtml(preview.config?.horizonMinutes ?? '—')} min</strong><span>${escapeHtml(preview.metrics.averageSpeedKmh)} km/jam <i>·</i> ${escapeHtml(preview.metrics.queueMeters)} m antrean</span><button type="button" id="scenarioPreviewReturn">Buka Scenario Lab</button><button type="button" id="scenarioPreviewClose" aria-label="Tutup pratinjau sandbox">×</button>`;
    this._syncPreviewVisibility();
  }

  _syncPreviewVisibility() {
    let ribbon = document.getElementById('scenarioLabPreview');
    if (!ribbon) {
      try {
        const preview = JSON.parse(sessionStorage.getItem('omnitraf.scenarioLab.preview') || 'null');
        if (preview?.metrics) { this._mountPreview(preview); return; }
      } catch { sessionStorage.removeItem('omnitraf.scenarioLab.preview'); }
    }
    if (ribbon) ribbon.hidden = window.location.hash === '#prediction';
  }

  _exportJson() {
    if (!this.snapshot && !this.comparison) return;
    const config = this.snapshot?.config || this._readConfig();
    const filenameId = this.snapshot?.id || new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`omnitraf-scenario-${filenameId}.json`, JSON.stringify({ scenario: config, result: this.snapshot, comparison: this.comparison }, null, 2), 'application/json');
  }

  _exportCsv() {
    if (!this.snapshot && !this.comparison) return;
    const config = this.snapshot?.config || this._readConfig();
    const lines = ['scenario_parameter,value', ...Object.entries(config).map(([key, value]) => `${key},${value}`), '', 'minute,demandVehPerHour,throughputVehPerHour,averageSpeedKmh,averageTravelTimeMinutes,queueMeters,congestionIndex,queueConservationResidual', ...(this.snapshot?.timeline || []).map(row => ['minute', 'demandVehPerHour', 'throughputVehPerHour', 'averageSpeedKmh', 'averageTravelTimeMinutes', 'queueMeters', 'congestionIndex', 'queueConservationResidual'].map(key => row[key] ?? '').join(','))];
    if (this.comparison) {
      lines.push('', 'comparison_metric,baseline,alternative,delta');
      for (const [key, label] of Object.entries(METRIC_LABELS)) lines.push(`${label},${this.comparison.baseline.metrics[key]},${this.comparison.alternative.metrics[key]},${this.comparison.delta[key]}`);
    }
    downloadFile(`omnitraf-scenario-${this.snapshot.id}.csv`, lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  _value(id, value) { const element = document.getElementById(id); if (element && value !== undefined) element.value = String(value); return element?.value; }
  _setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value; }
  _status(message, error = false) { const element = document.getElementById('scenarioLabStatus'); if (element) { element.textContent = message; element.classList.toggle('is-error', error); } }
}

export const scenarioLabController = new ScenarioLabController();
