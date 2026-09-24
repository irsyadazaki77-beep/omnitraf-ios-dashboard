/**
 * OmniTRAF Surabaya - Incidents & Context Menu Controller
 * Mengelola deteksi insiden real-time, resolusi insiden (PATCH API & State Sync),
 * modal detail kronologi insiden, disposisi petugas 112, serta context menu interaktif peta.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { mapManager } from '../modules/mapManager.js';

export class IncidentController {
  constructor() {
    this.selectedIntersection = null;
  }

  init() {
    this._bindContextMenu();
    this._bindIncidentModal();
    this._bindIncidentFilterChips();
    this._bindExportCsv();
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
          socketClient.emit('signal:override', { intersectionId: 'node-wonokromo', duration: 45 });
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
        window.showToast("🚨 Petugas Patroli Dishub & SITS 112 didisposisikan ke lokasi insiden.");
        soundManager.play('alert');
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
    const targetCards = [];
    const cards = document.querySelectorAll(".incident-card, .incident-log-item, .ops-card, .incident-item");
    cards.forEach(card => {
      if (card.innerHTML.includes(`resolveDynamicIncident(${id})`) || card.dataset.id == id || card.id === `incident-${id}`) {
        targetCards.push(card);
      }
    });

    targetCards.forEach(card => {
      const btns = card.querySelectorAll('button[onclick*="resolveDynamicIncident"], .resolve-btn, .resolve-notif-btn');
      btns.forEach(b => {
        b.disabled = true;
        b.dataset.origText = b.textContent;
        b.textContent = "Memproses...";
      });
    });

    try {
      const response = await fetch(`/api/incidents/${id}/resolve`, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          incidentId: id,
          resolvedAt: new Date().toISOString(),
          operator: 'Command Center SITS Surabaya'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const resData = await response.json();

      stateStore.setState((prev) => {
        const updatedIncidents = (prev.incidents || []).map(inc => {
          if (String(inc.id) === String(id)) {
            return { ...inc, status: 'RESOLVED', resolvedAt: resData.timestamp };
          }
          return inc;
        });
        return { incidents: updatedIncidents };
      });

      targetCards.forEach(card => {
        card.classList.add("resolved");
        card.classList.remove("unresolved");
        const pill = card.querySelector(".pill");
        if (pill) {
          pill.textContent = "Selesai";
          pill.className = "pill pill-success";
        }
        const btns = card.querySelectorAll('button[onclick*="resolveDynamicIncident"], .resolve-btn, .resolve-notif-btn');
        btns.forEach(b => {
          b.disabled = true;
          b.textContent = "✓ Selesai";
          b.style.opacity = "0.6";
          b.classList.add("resolved-btn");
        });
        card.style.borderColor = "rgba(34, 197, 94, 0.4)";
      });

      window.showToast(`Insiden #${id} berhasil diselesaikan. Status: RESOLVED.`);
      soundManager.play('success');

    } catch (err) {
      console.warn("Incident API local fallback resolution:", err);

      // Graceful local optimistic resolution
      targetCards.forEach(card => {
        card.classList.add("resolved");
        card.classList.remove("unresolved");
        const pill = card.querySelector(".pill");
        if (pill) {
          pill.textContent = "Selesai";
          pill.className = "pill pill-success";
        }
        const btns = card.querySelectorAll('button[onclick*="resolveDynamicIncident"], .resolve-btn, .resolve-notif-btn');
        btns.forEach(b => {
          b.disabled = true;
          b.textContent = "✓ Selesai";
          b.style.opacity = "0.6";
          b.classList.add("resolved-btn");
        });
      });

      window.showToast(`Insiden #${id} ditandai selesai (Local Sync).`);
      soundManager.play('success');
    }
  }
}

export const incidentController = new IncidentController();
