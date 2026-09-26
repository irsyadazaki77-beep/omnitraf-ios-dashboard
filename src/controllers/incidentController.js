/**
 * OmniTRAF Surabaya - Incidents & Context Menu Controller
 * Mengelola deteksi insiden real-time, resolusi insiden (PATCH API & State Sync),
 * modal detail kronologi insiden, disposisi petugas 112, serta context menu interaktif peta.
 */

import { stateStore, updateIncidentState } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { mapManager } from '../modules/mapManager.js';
import { commandLayer } from '../core/commandLayer.js';

export class IncidentController {
  constructor() {
    this.selectedIntersection = null;
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._bindContextMenu();
    this._bindIncidentModal();
    this._bindIncidentFilterChips();
    this._bindExportCsv();
    this._setupStoreListeners();
    this._registerGlobalHandlers();
  }

  activate() {
    this._bindContextMenu();
    this._bindIncidentModal();
    this._bindIncidentFilterChips();
    this._bindExportCsv();
    this._registerGlobalHandlers();
  }

  _registerGlobalHandlers() {
    if (typeof window === 'undefined') return;

    window.resolveDynamicIncident = (id) => this.resolveIncident(id);
    window.dispatchIncident = (id) => this.dispatchIncident(id);
    window.openIncidentOnMap = (loc, title) => mapManager.flyToIncident(loc, title);
    window.openIncidentDetail = (id, loc, time, desc) => this.openIncidentDetail(id, loc, time, desc);
  }

  /**
   * Dispatch Tim Lapangan (Transition from BARU -> DITANGANI)
   */
  async dispatchIncident(id) {
    try {
      await commandLayer.dispatchCommand({
        action: 'incident:acknowledge',
        targetType: 'incident',
        targetId: id,
        payload: {
          status: 'DISPATCHED/RESPONDING',
          assignedUnit: 'Patroli Dishub & Tim 112 Surabaya',
          notes: 'Tim lapangan & armada derek telah didisposisikan ke lokasi.'
        }
      }, false); // low risk

      window.showToast(`🚨 Tim Lapangan & SITS 112 didisposisikan ke lokasi insiden #${id}.`, 'success');
      soundManager.play('alert');
    } catch (err) {
      console.warn("[IncidentController] Dispatch error:", err);
      window.showToast(`❌ Gagal mendisposisi petugas: ${err.message}`, "danger");
      soundManager.play('alert');
    }
  }

  /**
   * 1. Interactive Map Context Menu (Right Click on Map or Markers)
   */
  _bindContextMenu() {
    const menu = document.getElementById("mapContextMenu");
    if (!menu) return;

    // Right-click listener on map containers and document
    const handleContextMenu = (e) => {
      const mapElem = e.target.closest("#map-surabaya, #dashboardMapBox, .leaflet-container");
      if (!mapElem) return;

      e.preventDefault();
      this.selectedIntersection = e.target.closest(".leaflet-marker-icon")?.dataset?.name || "Simpang Wonokromo (A. Yani)";

      const x = Math.min(window.innerWidth - 170, Math.max(10, e.clientX));
      const y = Math.min(window.innerHeight - 150, Math.max(10, e.clientY));

      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.style.display = "flex";
      menu.style.flexDirection = "column";
      menu.classList.add("show");
      soundManager.play('click');
    };

    document.addEventListener("contextmenu", handleContextMenu);

    // Hide context menu when clicking elsewhere
    document.addEventListener("click", (e) => {
      if (menu && menu.style.display !== "none" && !menu.contains(e.target)) {
        menu.style.display = "none";
        menu.classList.remove("show");
      }
    });

    // Handle context menu action buttons
    menu.querySelectorAll(".context-item").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.style.display = "none";
        menu.classList.remove("show");
        const action = btn.dataset.action;
        const target = this.selectedIntersection || "Simpang Wonokromo";

        if (action === "override-sinyal") {
          if (socketClient.isConnected()) {
            socketClient.emitWithAck('signal:override', { intersectionId: 'node-wonokromo', duration: 45 }, 4000).catch(() => {});
          }
          window.showToast(`🚦 Sinyal ${target} di-override: HIJAU 45s.`);
          soundManager.play('alert');
        } else if (action === "lapor-insiden") {
          this.openIncidentDetail("NEW-112", target, "Baru saja", `Laporan insiden kepadatan/hambatan lajur dilaporkan pada ${target}.`);
        } else if (action === "zoom-simpang") {
          mapManager.flyToIntersection(target);
          window.showToast(`🔍 Memperbesar kamera ke ${target}.`);
          soundManager.play('click');
        }
      });
    });
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

    if (closeInc) closeInc.addEventListener("click", closeModal);
    if (btnIncClose) btnIncClose.addEventListener("click", closeModal);

    if (btnIncDispatch) {
      btnIncDispatch.addEventListener("click", () => {
        closeModal();
        if (this.activeIncidentId) {
          this.updateIncidentStatus(this.activeIncidentId, "DISPATCHED/RESPONDING", "Patroli Dishub & Tim 112");
        } else {
          window.showToast("🚨 Petugas Patroli Dishub & SITS 112 didisposisikan ke lokasi insiden.");
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
      chip.addEventListener("click", () => {
        document.querySelectorAll(".incident-filter-bar .filter-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const filter = chip.dataset.incFilter || "all";
        
        document.querySelectorAll(".incident-log-item").forEach(item => {
          if (filter === "all") {
            item.style.display = "block";
          } else if (filter === "accident") {
            item.style.display = item.textContent.toLowerCase().includes("kecelakaan") ? "block" : "none";
          } else if (filter === "roadblock") {
            item.style.display = (item.textContent.toLowerCase().includes("penutupan") || item.textContent.toLowerCase().includes("galian")) ? "block" : "none";
          } else if (filter === "resolved") {
            item.style.display = item.classList.contains("resolved") ? "block" : "none";
          }
        });
        soundManager.play('click');
      });
    });
  }

  /**
   * 4. Export CSV Data Insiden
   */
  _bindExportCsv() {
    const btnExport = document.getElementById("btnExportCsv");
    if (!btnExport) return;

    btnExport.addEventListener("click", () => {
      const incidents = [
        { time: new Date().toLocaleTimeString('id-ID'), loc: "Simpang Wonokromo (Bemo)", type: "Antrean Padat Koridor", status: "Ditangani SITS 112", officer: "Regu Patroli Dishub Timur" },
        { time: "18:24:10", loc: "Jl. Darmo (Taman Bungkul)", type: "Volume Tinggi Jam Pulang", status: "Fase Hijau +12s", officer: "Operator ATCS Ruang Kontrol" },
        { time: "17:45:00", loc: "Margorejo Indah", type: "Pohon Tumbang Sebagian", status: "Selesai Ditangani", officer: "DLH & Satlantas Polrestabes" },
        { time: "16:30:15", loc: "Bundaran Waru (Masuk Kota)", type: "Penyempitan Lajur Tol", status: "Normal Kembali", officer: "PJR Polda Jatim" },
        { time: "15:10:02", loc: "Jl. Pemuda - Simpang Yos Sudarso", type: "Prioritas Rombongan Dinas", status: "Selesai", officer: "Satlantas Polrestabes Surabaya" }
      ];

      const csvHeader = "Waktu Laporkan,Lokasi Persimpangan,Tipe Insiden / Hambatan,Status Penanganan SITS,Unit Disposisi Petugas\n";
      let csvRows = "";
      incidents.forEach(inc => {
        csvRows += `"${inc.time}","${inc.loc}","${inc.type}","${inc.status}","${inc.officer}"\n`;
      });

      // Include UTF-8 BOM (\uFEFF) so Excel opens Indonesian accents and characters cleanly
      const bom = "\uFEFF";
      const blob = new Blob([bom + csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `OmniTRAF-SITS-Log-Insiden-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      if (typeof window.showToast === "function") {
        window.showToast("✓ Berkas CSV Log Insiden SITS Surabaya (UTF-8 Excel) berhasil diunduh.");
      }
      soundManager.play('success');
    });
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

    if (heading) heading.textContent = `Detail Insiden #${id}`;
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
      const action = newStatus === 'ACKNOWLEDGED' ? 'incident:acknowledge' : 'incident:resolve';
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
    stateStore.subscribe('state:incidents', ({ value }) => {
      this._renderIncidentListUI(value);
      this._renderNotificationDrawer(value);
    });
  }

  _renderNotificationDrawer(incidents) {
    const notifContainer = document.getElementById("notifListContainer");
    if (!notifContainer) return;

    const list = Array.isArray(incidents) ? incidents : [];
    if (list.length === 0) return;

    notifContainer.innerHTML = "";

    list.forEach(inc => {
      const isResolved = ["RESOLVED", "ARCHIVED"].includes(inc.status);
      const isDispatched = ["DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING", "ACKNOWLEDGED"].includes(inc.status);

      let badgeClass = "red";
      let badgeLabel = "⚠️ BARU (Open)";
      if (isDispatched) {
        badgeClass = "yellow";
        badgeLabel = "🚔 DITANGANI (Dispatched)";
      } else if (isResolved) {
        badgeClass = "green";
        badgeLabel = "✅ SELESAI (Resolved)";
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

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="status-badge ${badgeClass}">${badgeLabel}</span>
          <small style="font-size: 10px; color: var(--text-muted);">${inc.reportedAt ? new Date(inc.reportedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Baru saja'}</small>
        </div>
        <strong style="font-size: 12.5px; color: var(--text);">${inc.title} - ${inc.location}</strong>
        <p style="margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4;">${inc.notes || 'Hambatan lajur terdeteksi SITS 112.'}</p>
        
        ${isResolved ? `
          <div style="font-size: 10.5px; color: var(--success); font-weight: 600;">
            ✓ Selesai Ditangani | Response Time: ${responseTimeStr || '3 menit'}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
          <button class="btn btn-ghost compact btn-map-shortcut" style="padding: 4px 8px; font-size: 10.5px;" onclick="openIncidentOnMap('${inc.location.replace(/'/g, "\\'")}', '${inc.title.replace(/'/g, "\\'")}')">
            📍 Buka di Peta
          </button>
          
          ${!isResolved ? `
            ${!isDispatched ? `
              <button class="btn btn-primary compact" style="padding: 4px 8px; font-size: 10.5px;" onclick="dispatchIncident('${inc.id}')">🚀 Dispatch</button>
            ` : `
              <button class="btn btn-success compact" style="padding: 4px 8px; font-size: 10.5px; background: var(--success); border-color: var(--success);" onclick="resolveDynamicIncident('${inc.id}')">✓ Selesaikan</button>
            `}
          ` : ''}
        </div>
      `;

      notifContainer.appendChild(card);
    });
  }

  _renderIncidentListUI(incidents) {
    const listContainer = document.querySelector(".incident-logs-list");
    const unresolvedBadge = document.querySelector("#view-incidents .pill-danger");

    if (!listContainer) return;

    listContainer.innerHTML = "";

    const list = Array.isArray(incidents) ? incidents : [];
    
    // Count unresolved alerts (status not RESOLVED and not ARCHIVED)
    const unresolvedCount = list.filter(inc => !["RESOLVED", "ARCHIVED"].includes(inc.status)).length;
    if (unresolvedBadge) {
      unresolvedBadge.textContent = `${unresolvedCount} Unresolved Alerts`;
    }

    if (list.length === 0) {
      listContainer.innerHTML = `
        <div class="glass-panel p-6 text-center text-slate-400">
          <p>Tidak ada insiden lalu lintas terdeteksi saat ini.</p>
        </div>
      `;
      return;
    }

    list.forEach(inc => {
      const isResolved = ["RESOLVED", "ARCHIVED"].includes(inc.status);
      const isDispatched = ["DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING", "ACKNOWLEDGED"].includes(inc.status);
      
      const item = document.createElement("div");
      item.className = `incident-log-item ${isResolved ? 'resolved' : 'unresolved'}`;
      item.id = `incident-${inc.id}`;

      let statusBadgeHtml = `<span class="pill inc-badge-new" style="font-size: 11px; padding: 3px 8px;">⚠️ BARU (Open)</span>`;
      if (isDispatched) {
        statusBadgeHtml = `<span class="pill inc-badge-dispatched" style="font-size: 11px; padding: 3px 8px;">🚔 DITANGANI (${inc.assignedUnit || 'Patroli 112'})</span>`;
      } else if (isResolved) {
        statusBadgeHtml = `<span class="pill inc-badge-resolved" style="font-size: 11px; padding: 3px 8px;">✅ SELESAI (Resolved)</span>`;
      }

      let responseTimeStr = "";
      if (inc.reportedAt) {
        const startMs = new Date(inc.reportedAt).getTime();
        const endMs = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
        const diffMin = Math.max(1, Math.round((endMs - startMs) / 60000));
        responseTimeStr = `${diffMin} menit`;
      }

      item.innerHTML = `
        <div class="inc-meta" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          ${statusBadgeHtml}
          <span class="inc-time" style="font-size: 11px; color: var(--text-muted);">${inc.reportedAt ? new Date(inc.reportedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Baru saja'}</span>
        </div>
        <strong style="font-size: 14px; color: var(--text);">${inc.title} - ${inc.location}</strong>
        <p style="margin: 6px 0; font-size: 12px; color: var(--text-muted); line-height: 1.45;">${inc.notes || 'Hambatan lajur terdeteksi oleh sistem SITS Command Center 112.'}</p>
        
        <div class="inc-meta-row" style="margin-top: 8px; display: flex; gap: 16px; font-size: 11px; color: #94a3b8; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
          <div>Kategori: <strong style="color: var(--text);">${inc.category ? inc.category.toUpperCase() : 'UMUM'}</strong></div>
          <div>Unit Disposisi: <strong style="color: var(--cyan);">${inc.assignedUnit || 'Belum Ditugaskan'}</strong></div>
          ${isResolved ? `<div>Durasi Respon: <strong style="color: var(--success);">${responseTimeStr || '3 menit'}</strong></div>` : `<div>Durasi Berjalan: <strong style="color: var(--amber);">${responseTimeStr || '1 menit'}</strong></div>`}
        </div>

        <div class="inc-actions" style="margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-ghost compact btn-map-shortcut" style="padding: 5px 12px; font-size: 11.5px;" onclick="openIncidentOnMap('${inc.location.replace(/'/g, "\\'")}', '${inc.title.replace(/'/g, "\\'")}')">
            📍 Buka di Peta
          </button>

          ${!isResolved ? `
            ${!isDispatched ? `
              <button class="btn btn-primary compact dispatch-btn" style="padding: 5px 12px; font-size: 11.5px;" onclick="dispatchIncident('${inc.id}')">
                🚀 Kirim Tim Lapangan (Dispatch)
              </button>
            ` : `
              <button class="btn btn-success compact resolve-btn" style="padding: 5px 12px; font-size: 11.5px; background: var(--success); border-color: var(--success);" onclick="resolveDynamicIncident('${inc.id}')">
                ✓ Selesaikan Insiden
              </button>
            `}
            <button class="btn btn-ghost compact" style="padding: 5px 10px; font-size: 11px; color: var(--text-muted);" onclick="openIncidentDetail('${inc.id}', '${inc.location.replace(/'/g, "\\'")}', '${inc.reportedAt}', '${inc.notes ? inc.notes.replace(/'/g, "\\'") : ''}')">
              📋 Kronologi & Disposisi
            </button>
          ` : `
            <span class="text-emerald-400 font-semibold" style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--success);">
              ✓ Selesai Ditangani SITS | Response Time: ${responseTimeStr || '3 menit'}
            </span>
          `}
        </div>
      `;
      listContainer.appendChild(item);
    });
  }
}

export const incidentController = new IncidentController();
