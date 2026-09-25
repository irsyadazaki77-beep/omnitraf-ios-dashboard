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
        { time: new Date().toLocaleTimeString('id-ID'), loc: "Simpang Wonokromo (Bemo)", type: "Antrean Padat Koridor", status: "Ditangani SITS", officer: "Regu Patroli Dishub Timur" },
        { time: "18:24:10", loc: "Jl. Darmo (Taman Bungkul)", type: "Volume Tinggi Jam Pulang", status: "Fase Hijau +12s", officer: "Operator ATCS Ruang Kontrol" },
        { time: "17:45:00", loc: "Margorejo Indah", type: "Pohon Tumbang Sebagian", status: "Selesai Ditangani", officer: "DLH & Satlantas Polrestabes" },
        { time: "16:30:15", loc: "Bundaran Waru (Masuk Kota)", type: "Penyempitan Lajur Tol", status: "Normal Kembali", officer: "PJR Polda Jatim" },
        { time: "15:10:02", loc: "Jl. Pemuda - Simpang Yos Sudarso", type: "Prioritas Rombongan Dinas", status: "Selesai", officer: "Satlantas Polrestabes Surabaya" }
      ];

      let csvContent = "data:text/csv;charset=utf-8,Waktu,Lokasi,Tipe Insiden,Status Penanganan,Petugas\n";
      incidents.forEach(inc => {
        csvContent += `"${inc.time}","${inc.loc}","${inc.type}","${inc.status}","${inc.officer}"\n`;
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `OmniTRAF-SITS-Log-Insiden-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.showToast("✓ Berkas CSV Log Insiden berhasil diunduh.");
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
      const isAcknowledged = inc.status === "ACKNOWLEDGED";
      const isResponding = ["DISPATCHED", "RESPONDING", "DISPATCHED/RESPONDING"].includes(inc.status);
      
      const item = document.createElement("div");
      item.className = `incident-log-item ${isResolved ? 'resolved' : 'unresolved'}`;
      item.id = `incident-${inc.id}`;

      let badgeColor = "alert-red";
      if (inc.severity === "warning") badgeColor = "alert-orange";
      if (isResolved) badgeColor = "alert-green";

      let statusLabel = inc.status;
      if (isResolved) statusLabel = "SELESAI (RESOLVED)";
      else if (isAcknowledged) statusLabel = "DIKONFIRMASI (ACKNOWLEDGED)";
      else if (isResponding) statusLabel = "PROSES DISPOSISI (DISPATCHED)";

      item.innerHTML = `
        <div class="inc-meta">
          <span class="inc-type ${badgeColor}">⚠️ ${statusLabel} (#${inc.id})</span>
          <span class="inc-time">${inc.reportedAt ? new Date(inc.reportedAt).toLocaleTimeString('id-ID') : 'Baru saja'}</span>
        </div>
        <strong>${inc.title} - ${inc.location}</strong>
        <p>${inc.notes || 'Hambatan lajur terdeteksi oleh sistem SITS.'}</p>
        <div class="inc-meta-row" style="margin-top: 8px; display: flex; gap: 16px; font-size: 11px; color: #94a3b8;">
          <div>Kategori: <strong class="text-slate-300">${inc.category ? inc.category.toUpperCase() : 'UMUM'}</strong></div>
          <div>Unit Tugas: <strong class="text-sky-400">${inc.assignedUnit || 'Belum Ditugaskan'}</strong></div>
        </div>
        <div class="inc-actions" style="margin-top: 10px; display: flex; gap: 8px;">
          ${!isResolved ? `
            ${!isAcknowledged && !isResponding ? `
              <button class="btn btn-primary compact acknowledge-btn" style="background: #1e3a8a; border-color: #3b82f6; padding: 4px 8px; font-size: 11px;" onclick="acknowledgeIncident('${inc.id}')">Acknowledge</button>
            ` : ''}
            <button class="btn btn-ghost compact dispatch-btn" style="background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); padding: 4px 8px; font-size: 11px;" onclick="openIncidentDetail('${inc.id}', '${inc.location.replace(/'/g, "\\'")}', '${inc.reportedAt}', '${inc.notes ? inc.notes.replace(/'/g, "\\'") : ''}')">Disposisi Petugas</button>
            <button class="btn btn-primary compact resolve-btn" style="padding: 4px 8px; font-size: 11px;" onclick="resolveDynamicIncident('${inc.id}')">Mark as Resolved</button>
          ` : `
            <span class="text-emerald-400 font-semibold" style="display: flex; align-items: center; gap: 4px; font-size: 11.5px;">✓ Insiden Selesai ditangani SITS pada ${inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleTimeString('id-ID') : ''}</span>
          `}
        </div>
      `;
      listContainer.appendChild(item);
    });
  }
}

export const incidentController = new IncidentController();
