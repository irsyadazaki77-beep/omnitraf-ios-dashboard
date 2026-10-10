/**
 * OmniTRAF Surabaya - Incidents & Context Menu Controller
 * Mengelola skenario insiden pada prototipe, sinkronisasi state demo,
 * modal kronologi contoh, serta context menu interaktif peta.
 */

import { stateStore, updateIncidentState, escapeHtml } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { commandLayer } from '../core/commandLayer.js';
import { authManager } from '../core/authManager.js';
import { Disposer } from '../core/disposer.js';

const TERMINAL_INCIDENT_STATUSES = new Set(['RESOLVED', 'ARCHIVED', 'CLOSED', 'CANCELLED']);

export class IncidentController {
  constructor() {
    this.selectedIntersection = null;
    this._isInitialized = false;
    this.disposer = new Disposer('IncidentController');
    this._authUnsubscribe = null;
    this.incidentFilters = { category: 'all', severity: 'all', status: 'all', search: '' };
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this._authUnsubscribe = authManager.onAuthChange(() => {
      const incidents = stateStore.getState().incidents || [];
      this._renderIncidentListUI(incidents);
      this._renderNotificationDrawer(incidents);
      const dispatch = document.getElementById('btnIncidentDispatch');
      const selected = incidents.find(incident => String(incident.id) === String(this.activeIncidentId));
      if (dispatch) dispatch.hidden = !authManager.hasRole(['OPERATOR', 'ADMIN'])
        || !selected || TERMINAL_INCIDENT_STATUSES.has(String(selected.status || '').toUpperCase());
    });
  }

  activate() {
    this.deactivate(); // Ensure clean slate before binding

    this._resetIncidentFilters();
    this._bindIncidentModal();
    this._bindIncidentFilterChips();
    this._setupStoreListeners();
    this._registerGlobalHandlers();

    // Initial sync / render immediately on activation
    const state = stateStore.getState();
    this._renderIncidentListUI(state.incidents);
    this._renderNotificationDrawer(state.incidents);
    this.disposer.addEventListener(window, 'omnitraf:entity-focus', (event) => {
      if (event.detail?.kind !== 'incident') return;
      const target = document.getElementById(`incident-${event.detail.id}`);
      if (!target) return;
      target.tabIndex = -1;
      target.classList.add('entity-search-focus');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const dispatch = document.getElementById('btnIncidentDispatch');
    const selectedIncident = state.incidents?.find(incident => String(incident.id) === String(this.activeIncidentId));
    if (dispatch) dispatch.hidden = !authManager.hasRole(['OPERATOR', 'ADMIN'])
      || !selectedIncident || TERMINAL_INCIDENT_STATUSES.has(String(selectedIncident.status || '').toUpperCase());
  }

  deactivate() {
    this.disposer.clear();
  }

  _registerGlobalHandlers() {
    if (typeof window === 'undefined') return;

    window.resolveDynamicIncident = (id) => this.resolveIncident(id);
    window.dispatchIncident = (id) => this.dispatchIncident(id);
    window.openIncidentOnMap = (loc, title) => window.mapManager?.flyToIncident(loc, title);
    window.openIncidentDetail = (id, loc, time, desc) => this.openIncidentDetail(id, loc, time, desc);
  }

  /**
   * Dispatch Tim Lapangan (Transition from BARU -> DITANGANI)
   */
  async dispatchIncident(id) {
    try {
      const incident = (stateStore.getState().incidents || []).find((item) => String(item.id) === String(id));
      const currentStatus = String(incident?.status || 'ACTIVE').toUpperCase();
      const nextStatus = ({
        ACTIVE: 'ACKNOWLEDGED',
        ACKNOWLEDGED: 'DISPATCHED',
        DISPATCHED: 'RESPONDING',
        'DISPATCHED/RESPONDING': 'RESPONDING',
        CONTAINED: 'MITIGATED',
        RESPONDING: 'MITIGATED',
        MITIGATED: 'RESOLVED'
      })[currentStatus];
      if (!nextStatus) throw new Error(`Tidak ada transisi berikutnya dari status ${currentStatus}.`);
      const action = nextStatus === 'ACKNOWLEDGED' ? 'incident:acknowledge'
        : nextStatus === 'RESOLVED' ? 'incident:resolve' : 'incident:dispatch';
      const payload = { assignedUnit: 'Unit Demo', notes: 'Tahap penanganan berubah pada simulator; tidak ada petugas lapangan yang dihubungi.' };
      if (action === 'incident:dispatch') payload.status = nextStatus;
      await commandLayer.dispatchCommand({
        action,
        targetType: 'incident',
        targetId: id,
        payload
      }, false); // low risk

      window.showToast(`Skenario #${id}: ${nextStatus.replaceAll('_', ' ')}. Tidak ada petugas lapangan yang dihubungi.`, 'success');
      soundManager.play('alert');
    } catch (err) {
      console.warn("[IncidentController] Dispatch error:", err);
      window.showToast(`Aksi simulasi gagal diproses: ${err.message}`, "danger");
      soundManager.play('alert');
    }
  }

  /**
   * 2. Detail Modal Insiden & Disposisi Petugas
   */
  _bindIncidentModal() {
    const incModal = document.getElementById("incidentDetailModal");
    const closeInc = document.getElementById("closeIncidentModal");
    const btnIncClose = document.getElementById("btnIncidentClose");
    const btnIncDispatch = document.getElementById("btnIncidentDispatch");

    const closeModal = () => {
      if (incModal) {
        incModal.classList.remove("show");
        setTimeout(() => { incModal.style.display = "none"; }, 200);
      }
    };

    if (closeInc) this.disposer.addEventListener(closeInc, "click", closeModal);
    if (btnIncClose) this.disposer.addEventListener(btnIncClose, "click", closeModal);

    if (incModal) {
      this.disposer.addEventListener(incModal, "click", (e) => {
        if (e.target === incModal) closeModal();
      });
    }

    if (btnIncDispatch) {
      this.disposer.addEventListener(btnIncDispatch, "click", () => {
        closeModal();
        if (this.activeIncidentId) {
          this.dispatchIncident(this.activeIncidentId);
        } else {
          window.showToast("Status skenario diperbarui pada simulator; tidak ada petugas yang dihubungi.");
          soundManager.play('alert');
        }
      });
    }
  }

  /**
   * 3. Filter Chips pada View Insiden
   */
  _bindIncidentFilterChips() {
    document.querySelectorAll(".incident-filter-bar .filter-chip").forEach(chip => {
      this.disposer.addEventListener(chip, "click", () => {
        document.querySelectorAll(".incident-filter-bar .filter-chip").forEach(c => {
          c.classList.remove("active");
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add("active");
        chip.setAttribute('aria-pressed', 'true');
        this.incidentFilters.category = chip.dataset.incFilter || 'all';
        this._applyIncidentFilters();
        soundManager.play('click');
      });
    });

    const search = document.getElementById('incidentSearch');
    const severity = document.getElementById('incidentSeverityFilter');
    const status = document.getElementById('incidentStatusFilter');
    if (search) this.disposer.addEventListener(search, 'input', () => {
      this.incidentFilters.search = search.value.trim().toLocaleLowerCase();
      this._applyIncidentFilters();
    });
    if (severity) this.disposer.addEventListener(severity, 'change', () => {
      this.incidentFilters.severity = severity.value;
      this._applyIncidentFilters();
    });
    if (status) this.disposer.addEventListener(status, 'change', () => {
      this.incidentFilters.status = status.value;
      this._applyIncidentFilters();
    });
  }

  _resetIncidentFilters() {
    this.incidentFilters = { category: 'all', severity: 'all', status: 'all', search: '' };
    const search = document.getElementById('incidentSearch');
    const severity = document.getElementById('incidentSeverityFilter');
    const status = document.getElementById('incidentStatusFilter');
    if (search) search.value = '';
    if (severity) severity.value = 'all';
    if (status) status.value = 'all';
    document.querySelectorAll('.incident-filter-bar .filter-chip').forEach((chip) => {
      const selected = chip.dataset.incFilter === 'all';
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
  }

  _applyIncidentFilters() {
    const items = [...document.querySelectorAll('#incidentLogsList .incident-log-item')];
    let visibleCount = 0;
    items.forEach((item) => {
      const matchesCategory = this.incidentFilters.category === 'all'
        || item.dataset.incidentCategory === this.incidentFilters.category;
      const matchesSeverity = this.incidentFilters.severity === 'all'
        || item.dataset.incidentSeverity === this.incidentFilters.severity;
      const matchesStatus = this.incidentFilters.status === 'all'
        || item.dataset.incidentStatus === this.incidentFilters.status;
      const matchesSearch = !this.incidentFilters.search
        || item.textContent.toLocaleLowerCase().includes(this.incidentFilters.search);
      const visible = matchesCategory && matchesSeverity && matchesStatus && matchesSearch;
      item.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const count = document.getElementById('incidentFilterCount');
    if (count) count.textContent = `${visibleCount} / ${items.length} ditampilkan`;
    const empty = document.getElementById('incidentFilterEmpty');
    if (empty) empty.hidden = visibleCount > 0 || items.length === 0;
  }

  /**
   * Buka Modal Kronologi Insiden
   */
  openIncidentDetail(id, loc = "Jl. Raya Darmo", time = "Baru saja", desc = "Kendaraan mogok / hambatan lajur terdeteksi sensor SITS.") {
    this.activeIncidentId = id;
    const modal = document.getElementById("incidentDetailModal");
    const heading = document.getElementById("incModalHeading");
    const locationEl = document.getElementById("incModalLocation");
    const timeEl = document.getElementById("incModalTime");
    const descEl = document.getElementById("incModalDesc");
    const actionButton = document.getElementById('btnIncidentDispatch');

    const incident = (stateStore.getState().incidents || []).find(item => String(item.id) === String(id));
    if (incident) {
      loc = incident.location || 'Lokasi belum tersedia';
      const date = new Date(incident.reportedAt || incident.createdAt || NaN);
      time = Number.isNaN(date.getTime()) ? 'Waktu belum tersedia' : `${date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
      const notes = incident.notes || incident.description || 'Deskripsi belum tersedia';
      desc = `${notes}\nStatus: ${incident.status || 'Belum tersedia'} · Sumber: ${incident.source || 'Simulasi'}\nUnit: ${incident.assignedUnit || 'Belum ditugaskan'}`;
      if (actionButton) {
        actionButton.textContent = this._incidentWorkflowAction(incident.status);
        actionButton.hidden = TERMINAL_INCIDENT_STATUSES.has(String(incident.status || '').toUpperCase())
          || !authManager.hasRole(['OPERATOR', 'ADMIN']);
      }
    } else if (actionButton) {
      actionButton.hidden = true;
    }
    if (heading) heading.textContent = incident?.title || `Detail Insiden #${id}`;
    if (locationEl) locationEl.textContent = loc;
    if (timeEl) timeEl.textContent = time;
    if (descEl) descEl.textContent = desc;

    if (modal) {
      modal.style.display = "flex";
      modal.classList.add("show");
    }
    soundManager.play('click');
  }

  /**
   * Resolusi Insiden secara Dinamis & Sinkronisasi State
   */
  async resolveIncident(id) {
    try {
      await commandLayer.dispatchCommand({
        action: 'incident:resolve',
        targetType: 'incident',
        targetId: id,
        payload: { incidentId: id }
      }, false); // low risk

      window.showToast(`✓ Insiden #${id} berhasil diselesaikan.`, 'success');
      soundManager.play('success');
    } catch (err) {
      console.warn("Incident resolution error:", err);
      window.showToast(`❌ Gagal menyelesaikan insiden: ${err.message}`, "danger");
      soundManager.play('alert');
    }
  }

  async updateIncidentStatus(id, newStatus, assignedUnit = null, notes = null) {
    try {
      const action = newStatus === 'ACKNOWLEDGED' ? 'incident:acknowledge' :
                     (newStatus === 'RESOLVED' ? 'incident:resolve' : 'incident:dispatch');
      await commandLayer.dispatchCommand({
        action,
        targetType: 'incident',
        targetId: id,
        payload: { status: newStatus, assignedUnit, notes }
      }, false); // low risk

      window.showToast(`✓ Insiden #${id} diperbarui ke ${newStatus}.`, 'success');
      soundManager.play('success');
    } catch (err) {
      console.warn(`[IncidentController] Gagal memperbarui status ke ${newStatus}:`, err);
      window.showToast(`❌ Gagal mengubah status: ${err.message}`, "danger");
      soundManager.play('alert');
    }
  }

  _setupStoreListeners() {
    this.disposer.addStoreSubscription(stateStore, 'state:incidents', ({ value }) => {
      this._renderIncidentListUI(value);
      this._renderNotificationDrawer(value);
    });
  }

  _renderNotificationDrawer(incidents) {
    const notifContainer = document.getElementById("notifListContainer");
    if (!notifContainer) return;

    const list = Array.isArray(incidents) ? incidents : [];
    const canOperate = authManager.hasRole(['OPERATOR', 'ADMIN']);
    notifContainer.innerHTML = "";
    if (list.length === 0) {
      notifContainer.innerHTML = '<p class="text-muted" style="margin:0;">Belum ada skenario demo.</p>';
      return;
    }

    list.forEach(inc => {
      const isResolved = TERMINAL_INCIDENT_STATUSES.has(String(inc.status || '').toUpperCase());
      const normalizedStatus = String(inc.status || 'ACTIVE').toUpperCase();
      const isDispatched = ["DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING", "MITIGATED"].includes(normalizedStatus);
      const workflowAction = this._incidentWorkflowAction(inc.status);

      let badgeClass = "red";
      let badgeLabel = "⚠️ BARU (Open)";
      if (isDispatched) {
        badgeClass = "yellow";
        badgeLabel = normalizedStatus === 'MITIGATED' ? "🛠️ Dimitigasi" : "🚔 Ditangani";
      } else if (normalizedStatus === 'ACKNOWLEDGED') {
        badgeClass = "yellow";
        badgeLabel = "✓ Diakui · menunggu disposisi";
      } else if (isResolved) {
        badgeClass = "green";
        badgeLabel = "✅ Selesai";
      }

      let responseTimeStr = "";
      if (inc.reportedAt) {
        const startMs = new Date(inc.reportedAt).getTime();
        const endMs = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
        const diffMin = Math.max(1, Math.round((endMs - startMs) / 60000));
        responseTimeStr = `${diffMin} menit`;
      }

      const card = document.createElement("article");
      card.className = "notif-item-card glass-soft";
      card.style.cssText = "padding: 12px; border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px;";

      const safeTitle = escapeHtml(inc.title);
      const safeLocation = escapeHtml(inc.location);
      const safeNotes = escapeHtml(inc.notes || 'Skenario contoh pada simulator; bukan laporan lapangan.');

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="status-badge ${badgeClass}">${badgeLabel}</span>
          <small style="font-size: 10px; color: var(--text-muted);">${inc.reportedAt ? new Date(inc.reportedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Baru saja'}</small>
        </div>
        <strong style="font-size: 12.5px; color: var(--text);">${safeTitle} - ${safeLocation}</strong>
        <p style="margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4;">${safeNotes}</p>
        
        ${isResolved ? `
          <div style="font-size: 10.5px; color: var(--success); font-weight: 600;">
            ✓ Skenario selesai${responseTimeStr ? ` · Durasi: ${responseTimeStr}` : ''}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
          <button class="btn btn-ghost compact btn-map-shortcut" style="padding: 4px 8px; font-size: 10.5px;">
            📍 Buka di Peta
          </button>
          
          ${!isResolved && canOperate ? `
            <button class="btn btn-primary compact incident-dispatch-btn" style="padding: 4px 8px; font-size: 10.5px;">${workflowAction}</button>
          ` : ''}
        </div>
      `;

      notifContainer.appendChild(card);
      card.querySelector('.btn-map-shortcut')?.addEventListener('click', () => window.mapManager?.flyToIncident(inc.location || '', inc.title || ''));
      card.querySelector('.incident-dispatch-btn')?.addEventListener('click', () => this.dispatchIncident(inc.id));
      card.querySelector('.incident-resolve-btn')?.addEventListener('click', () => this.resolveIncident(inc.id));
    });
  }

  _renderIncidentListUI(incidents) {
    const listContainer = document.querySelector(".incident-logs-list");
    const unresolvedBadge = document.querySelector("#view-incidents .pill-danger");

    if (!listContainer) return;

    listContainer.innerHTML = "";

    const list = Array.isArray(incidents) ? incidents : [];
    const canOperate = authManager.hasRole(['OPERATOR', 'ADMIN']);
    
    // Count unresolved alerts (status not RESOLVED and not ARCHIVED)
    const unresolvedCount = list.filter(inc => !TERMINAL_INCIDENT_STATUSES.has(String(inc.status || '').toUpperCase())).length;
    const activeSummary = document.getElementById('summaryActiveIncidents');
    if (activeSummary) activeSummary.textContent = `${unresolvedCount} aktif`;
    if (unresolvedBadge) {
      unresolvedBadge.textContent = `${unresolvedCount} aktif`;
      unresolvedBadge.className = unresolvedCount > 0 ? 'pill pill-danger' : 'pill pill-live';
    }

    if (list.length === 0) {
      listContainer.innerHTML = `
        <div class="glass-panel p-6 text-center text-slate-400">
          <p><strong>Network saat ini clear.</strong><br>Tidak ada skenario insiden aktif.</p>
        </div>
      `;
      const filterCount = document.getElementById('incidentFilterCount');
      if (filterCount) filterCount.textContent = '0 insiden';
      const filterEmpty = document.getElementById('incidentFilterEmpty');
      if (filterEmpty) filterEmpty.hidden = true;
      return;
    }

    list.forEach(inc => {
      const isResolved = TERMINAL_INCIDENT_STATUSES.has(String(inc.status || '').toUpperCase());
      const workflowAction = this._incidentWorkflowAction(inc.status);
      
      const item = document.createElement("div");
      item.className = `incident-log-item ${isResolved ? 'resolved' : 'unresolved'}`;
      item.id = `incident-${inc.id}`;
      item.dataset.incidentCategory = String(inc.category || 'general').toLocaleLowerCase();
      item.dataset.incidentSeverity = String(inc.severity || 'info').toLocaleLowerCase();
      item.dataset.incidentStatus = String(inc.status || 'ACTIVE').toUpperCase();

      const safeTitle = escapeHtml(inc.title || 'Insiden simulasi');
      const safeLocation = escapeHtml(inc.location || 'Lokasi belum tersedia');
      const safeNotes = escapeHtml(inc.notes || 'Skenario contoh pada simulator; bukan laporan lapangan.');
      const categoryLabels = { ACCIDENT: 'Kecelakaan', WEATHER: 'Cuaca', CONGESTION: 'Kepadatan', ROADBLOCK: 'Hambatan jalan' };
      const rawCategory = String(inc.category || 'GENERAL').toUpperCase();
      const safeCategory = escapeHtml(categoryLabels[rawCategory] || 'Umum');
      const safeUnit = escapeHtml(inc.assignedUnit || 'Belum ada disposisi');
      const severityLabels = { CRITICAL: 'Kritis', DANGER: 'Kritis', HIGH: 'Tinggi', WARNING: 'Peringatan', MEDIUM: 'Sedang', INFO: 'Informasi', LOW: 'Rendah' };
      const rawSeverity = String(inc.severity || inc.priority || 'INFO').toUpperCase();
      const safeSeverity = escapeHtml(severityLabels[rawSeverity] || 'Belum diklasifikasikan');
      const severityClass = ['CRITICAL', 'DANGER', 'HIGH'].includes(rawSeverity) ? 'is-critical'
        : ['WARNING', 'MEDIUM'].includes(rawSeverity) ? 'is-warning' : 'is-neutral';
      const statusLabels = {
        ACTIVE: 'Baru', ACKNOWLEDGED: 'Diakui', DISPATCHED: 'Unit simulasi ditugaskan',
        RESPONDING: 'Respons simulasi', 'DISPATCHED/RESPONDING': 'Respons simulasi',
        MITIGATED: 'Terkendali', RESOLVED: 'Selesai', ARCHIVED: 'Diarsipkan', CLOSED: 'Ditutup', CANCELLED: 'Dibatalkan'
      };
      const safeStatus = escapeHtml(statusLabels[String(inc.status || 'ACTIVE').toUpperCase()] || 'Status simulasi');

      let responseTimeStr = "";
      if (inc.reportedAt && Number.isFinite(new Date(inc.reportedAt).getTime())) {
        const startMs = new Date(inc.reportedAt).getTime();
        const endMs = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
        const diffMin = Math.max(1, Math.round((endMs - startMs) / 60000));
        responseTimeStr = `${diffMin} menit`;
      }

      const reportedTime = inc.reportedAt && Number.isFinite(new Date(inc.reportedAt).getTime())
        ? new Date(inc.reportedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB'
        : 'Waktu simulasi belum tersedia';
      const sourceLabel = escapeHtml(inc.source || inc.provenance || 'Model simulasi');
      item.innerHTML = `
        <div class="inc-meta">
          <div class="incident-status-group">
            <span class="incident-severity ${severityClass}">${safeSeverity}</span>
            <span class="incident-status-pill">${safeStatus}</span>
          </div>
          <span class="inc-time">${reportedTime}</span>
        </div>
        <h3 class="incident-title">${safeTitle}</h3>
        <p class="incident-location">${safeLocation}</p>
        <p class="incident-notes">${safeNotes}</p>
        <div class="inc-meta-row">
          <span>Kategori <strong>${safeCategory}</strong></span>
          <span>Sumber <strong>${sourceLabel}</strong></span>
          <span>Disposisi <strong>${safeUnit}</strong></span>
          ${responseTimeStr ? `<span>Durasi simulasi <strong>${responseTimeStr}</strong></span>` : ''}
        </div>
        <div class="inc-actions">
          <button type="button" class="btn btn-ghost compact btn-map-shortcut">📍 Buka di Peta</button>

          ${!isResolved && canOperate ? `
            <button type="button" class="btn btn-primary compact dispatch-btn">
              ${workflowAction}
            </button>
          ` : ''}
          <button type="button" class="btn btn-ghost compact incident-detail-btn" aria-label="Lihat detail ${safeTitle}">
            Lihat detail
          </button>
          ${isResolved ? '<span class="incident-resolved-state" role="status">✓ Selesai</span>' : ''}
        </div>
      `;
      listContainer.appendChild(item);
      item.querySelector('.btn-map-shortcut')?.addEventListener('click', () => window.mapManager?.flyToIncident(inc.location || '', inc.title || ''));
      item.querySelector('.dispatch-btn')?.addEventListener('click', () => this.dispatchIncident(inc.id));
      item.querySelector('.resolve-btn')?.addEventListener('click', () => this.resolveIncident(inc.id));
      item.querySelector('.incident-detail-btn')?.addEventListener('click', () => this.openIncidentDetail(inc.id, inc.location || '', inc.reportedAt || '', inc.notes || ''));
    });

    this._applyIncidentFilters();
    // Dashboard timeline is rendered by TrafficEngine from the same state snapshot.
  }

  _incidentWorkflowAction(status) {
    const current = String(status || 'ACTIVE').toUpperCase();
    return ({
      ACTIVE: 'Akui skenario',
      ACKNOWLEDGED: 'Disposisi simulasi',
      DISPATCHED: 'Mulai respons simulasi',
      'DISPATCHED/RESPONDING': 'Lanjutkan respons simulasi',
      CONTAINED: 'Tandai mitigasi simulasi',
      RESPONDING: 'Tandai mitigasi',
      MITIGATED: 'Selesaikan skenario'
    })[current] || 'Lanjutkan alur simulasi';
  }

  _renderDashboardTimeline(incidents) {
    const timelineEl = document.querySelector("#card-incidents .timeline");
    const countBadge = document.querySelector("#card-incidents .pill-danger");
    if (!timelineEl) return;

    const list = Array.isArray(incidents) ? incidents : [];
    const activeList = list.filter(inc => !TERMINAL_INCIDENT_STATUSES.has(String(inc.status || '').toUpperCase()));

    if (countBadge) {
      countBadge.textContent = `${activeList.length} Alert`;
      countBadge.className = activeList.length > 0 ? "pill pill-danger" : "pill pill-live";
    }

    if (list.length === 0) {
      timelineEl.innerHTML = `<li style="color: var(--text-dim); padding: 8px 0;">Tidak ada kronologi insiden aktif.</li>`;
      return;
    }

    timelineEl.innerHTML = "";
    // Display up to 3 most recent incidents
    list.slice(0, 3).forEach(inc => {
      const isResolved = TERMINAL_INCIDENT_STATUSES.has(String(inc.status || '').toUpperCase());
      const normalizedStatus = String(inc.status || 'ACTIVE').toUpperCase();
      const isDispatched = ["DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING", "MITIGATED"].includes(normalizedStatus);

      let dotClass = "danger pulse-red-dot";
      if (isDispatched) dotClass = "warning";
      else if (isResolved) dotClass = "success";

      const safeTitle = escapeHtml(inc.title || 'Insiden Lalu Lintas');
      const safeLocation = escapeHtml(inc.location || 'Koridor demo');

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="timeline-dot ${dotClass}"></span>
        <div>
          <strong>${safeTitle}</strong>
          <small>${safeLocation} • ${isResolved ? 'selesai' : (normalizedStatus === 'ACKNOWLEDGED' ? 'diakui · menunggu disposisi' : (inc.reportedAt ? new Date(inc.reportedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'baru saja'))}</small>
        </div>
      `;
      timelineEl.appendChild(li);
    });
  }
}

export const incidentController = new IncidentController();
