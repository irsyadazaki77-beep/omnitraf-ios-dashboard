/**
 * OmniTRAF Surabaya - Quick Tour & Keyboard Shortcuts Controller
 * Mengatur panduan interaktif (Tour SITS), penutupan modal & drawer via ESC,
 * pembukaan modal arsitektur/algoritma engine, serta event listener pintasan keyboard global.
 */

import { soundManager } from '../core/soundManager.js';

export class TourShortcutsController {
  constructor() {
    this.currentStep = 0;
    this.tourSteps = [
      {
        title: "Langkah 1: Topbar Status & Operasional SITS",
        text: "Memantau jam operasional WIB, status koneksi 184 node CCTV, serta informasi cuaca BMKG Kota Surabaya."
      },
      {
        title: "Langkah 2: Peta Geospasial Arteri Surabaya",
        text: "Peta interaktif Leaflet menyajikan koridor utama A. Yani, Darmo, Basuki Rahmat, dan rute Green Wave aktif."
      },
      {
        title: "Langkah 3: Manajemen APILL & Green Split",
        text: "Optimasi fase sinyal lampu lalu lintas adaptif otomatis berbasis AI untuk meminimalkan antrean kendaraan."
      },
      {
        title: "Langkah 4: Jaringan CCTV Edge Computer Vision",
        text: "Kamera SITS terintegrasi model deteksi objek YOLOv8 dengan kalkulasi kecepatan dan klasifikasi kendaraan."
      },
      {
        title: "Langkah 5: Koordinasi Cepat Dishub & 112",
        text: "Kanal chat real-time untuk sinergi petugas lapangan, operator ATCS, dan unit tanggap darurat ambulans."
      }
    ];
  }

  init() {
    this._bindQuickTourTooltip();
    this._bindQuickTourOverlay();
    this._bindShortcutsModal();
    this._bindEngineInfoModal();
    this._bindGlobalKeydown();
  }

  /**
   * 1. Floating Quick Tour Tooltip (#quickTourTooltip & #btnCloseTour)
   */
  _bindQuickTourTooltip() {
    const tooltip = document.getElementById("quickTourTooltip");
    const closeBtn = document.getElementById("btnCloseTour");

    if (closeBtn && tooltip) {
      closeBtn.addEventListener("click", () => {
        tooltip.style.display = "none";
        soundManager.play('click');
        if (typeof window.showToast === "function") {
          window.showToast("Panduan SITS ditutup.");
        }
      });
    }
  }

  /**
   * 2. Quick Tour Walkthrough Overlay (#quickTourOverlay)
   */
  _bindQuickTourOverlay() {
    const tourOverlay = document.getElementById("quickTourOverlay");
    const btnQuickTour = document.getElementById("btnQuickTour");
    const btnTourNext = document.getElementById("btnTourNext");
    const btnTourPrev = document.getElementById("btnTourPrev");
    const tourTitle = document.getElementById("tourStepTitle");
    const tourText = document.getElementById("tourStepText");
    const tourIndicator = document.getElementById("tourStepIndicator");
    const tourCard = document.getElementById("tourStepCard");

    // Add Close (✕) button to Tour Card if not present
    if (tourCard && !document.getElementById("btnCloseTourOverlay")) {
      const closeX = document.createElement("button");
      closeX.id = "btnCloseTourOverlay";
      closeX.innerHTML = "&times;";
      closeX.style.cssText = "position: absolute; top: 8px; right: 10px; background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; line-height: 1;";
      closeX.addEventListener("click", () => {
        if (tourOverlay) tourOverlay.style.display = "none";
        soundManager.play('click');
      });
      tourCard.appendChild(closeX);
    }

    const renderTourStep = () => {
      if (!tourTitle || !tourText || !tourIndicator) return;
      const step = this.tourSteps[this.currentStep];
      tourTitle.textContent = step.title;
      tourText.textContent = step.text;
      tourIndicator.textContent = `${this.currentStep + 1} / ${this.tourSteps.length}`;
      if (btnTourPrev) btnTourPrev.style.visibility = this.currentStep === 0 ? "hidden" : "visible";
      if (btnTourNext) btnTourNext.textContent = this.currentStep === this.tourSteps.length - 1 ? "Selesai" : "Lanjut";
    };

    const startTour = () => {
      this.currentStep = 0;
      if (tourOverlay) {
        tourOverlay.style.display = "block";
        renderTourStep();
      }
      soundManager.play('click');
    };

    if (btnQuickTour) {
      btnQuickTour.addEventListener("click", startTour);
    }

    if (btnTourNext && tourOverlay) {
      btnTourNext.addEventListener("click", () => {
        if (this.currentStep < this.tourSteps.length - 1) {
          this.currentStep++;
          renderTourStep();
          soundManager.play('click');
        } else {
          tourOverlay.style.display = "none";
          if (typeof window.showToast === "function") {
            window.showToast("Panduan Quick Tour SITS selesai.");
          }
          soundManager.play('success');
        }
      });
    }

    if (btnTourPrev) {
      btnTourPrev.addEventListener("click", () => {
        if (this.currentStep > 0) {
          this.currentStep--;
          renderTourStep();
          soundManager.play('click');
        }
      });
    }

    if (tourOverlay) {
      tourOverlay.addEventListener("click", (e) => {
        if (e.target === tourOverlay) {
          tourOverlay.style.display = "none";
          soundManager.play('click');
        }
      });
    }
  }

  /**
   * 3. Modal Pintasan Keyboard (#keyboardShortcutsModal)
   */
  _bindShortcutsModal() {
    const shortcutsModal = document.getElementById("keyboardShortcutsModal");
    const btnShow = document.getElementById("btnShowShortcuts");
    const closeBtn = document.getElementById("closeShortcutsModal");

    if (btnShow && shortcutsModal) {
      btnShow.addEventListener("click", () => {
        shortcutsModal.style.display = "flex";
        shortcutsModal.classList.add("show");
        soundManager.play('click');
      });
    }

    if (closeBtn && shortcutsModal) {
      closeBtn.addEventListener("click", () => {
        shortcutsModal.classList.remove("show");
        setTimeout(() => { shortcutsModal.style.display = "none"; }, 200);
        soundManager.play('click');
      });
    }
  }

  /**
   * 4. Modal Algoritma & Arsitektur OmniTRAF (#engineInfoModal)
   */
  _bindEngineInfoModal() {
    const engineModal = document.getElementById("engineInfoModal");
    const openBtn1 = document.getElementById("btnOpenEngineModal");
    const openBtn2 = document.getElementById("navAboutEngine");
    const closeBtn = document.getElementById("closeEngineModal");

    const openEngine = (e) => {
      if (e) e.preventDefault();
      if (engineModal) {
        engineModal.style.display = "flex";
        engineModal.classList.add("show");
        soundManager.play('click');
      }
    };

    const closeEngine = () => {
      if (engineModal) {
        engineModal.classList.remove("show");
        setTimeout(() => { engineModal.style.display = "none"; }, 200);
        soundManager.play('click');
      }
    };

    if (openBtn1) openBtn1.addEventListener("click", openEngine);
    if (openBtn2) openBtn2.addEventListener("click", openEngine);
    if (closeBtn) closeBtn.addEventListener("click", closeEngine);

    // Close on overlay backdrop click
    if (engineModal) {
      engineModal.addEventListener("click", (e) => {
        if (e.target === engineModal) {
          closeEngine();
        }
      });
    }

    // Live Webster interactive sandbox in Engine Modal
    const lostTimeInput = document.getElementById("websterLostTime");
    const flowRatioInput = document.getElementById("websterFlowRatio");
    const optResult = document.getElementById("websterOptCycleResult");
    const calcSteps = document.getElementById("websterCalcSteps");

    const updateWebsterCalc = () => {
      const L = parseFloat(lostTimeInput?.value) || 12;
      const Y = Math.min(0.95, Math.max(0.1, parseFloat(flowRatioInput?.value) || 0.72));
      const C0 = Math.round((1.5 * L + 5) / (1 - Y));

      if (optResult) optResult.textContent = `${C0} detik`;
      if (calcSteps) {
        calcSteps.textContent = `C₀ = (1.5 × ${L} + 5) / (1 - ${Y.toFixed(2)}) = ${(1.5 * L + 5).toFixed(1)} / ${(1 - Y).toFixed(2)} = ${C0}s`;
      }
    };

    if (lostTimeInput) lostTimeInput.addEventListener("input", updateWebsterCalc);
    if (flowRatioInput) flowRatioInput.addEventListener("input", updateWebsterCalc);
  }

  /**
   * 5. Global Keyboard Event Listener
   */
  _bindGlobalKeydown() {
    window.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;

      const key = e.key.toLowerCase();
      if (key === "k") {
        const chaosToggle = document.getElementById("btnToggleChaos") || document.getElementById("chaosModeToggle");
        if (chaosToggle) chaosToggle.click();
      } else if (key === "t") {
        document.getElementById("btnQuickTour")?.click();
      } else if (key === "m") {
        document.querySelector('.nav-item[data-view="map"]')?.click();
      } else if (key === "d") {
        document.querySelector('.nav-item[data-view="dashboard"]')?.click();
      } else if (key === "c") {
        document.querySelector('.nav-item[data-view="cctv"]')?.click();
      } else if (key === "s") {
        document.querySelector('.nav-item[data-view="signals"]')?.click();
      } else if (key === "e") {
        document.querySelector('.nav-item[data-view="emergency"]')?.click();
      } else if (key === "a") {
        document.querySelector('.nav-item[data-view="analytics"]')?.click();
      } else if (key === "p") {
        document.querySelector('.nav-item[data-view="prediction"]')?.click();
      } else if (key === "i") {
        document.querySelector('.nav-item[data-view="incidents"]')?.click();
      } else if (key === "r") {
        if (typeof window.showToast === "function") {
          window.showToast("🔄 Menyinkronkan ulang data telemetri SITS...");
        }
        soundManager.play('click');
      } else if (key === "escape") {
        // 1. Close all active modals
        const activeModals = [
          'reportModal',
          'engineInfoModal',
          'incidentDetailModal',
          'keyboardShortcutsModal',
          'signalIntelModal',
          'cctvZoomModal',
          'esgTargetModal'
        ];

        activeModals.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.classList.remove("show");
            el.style.display = "none";
          }
        });

        document.querySelectorAll(".modal-overlay.show, .modal-overlay[style*='display: flex'], .modal-overlay[style*='display: block']").forEach(m => {
          m.classList.remove("show");
          m.style.display = "none";
        });

        // 2. Close Tour Overlay
        const tourOverlay = document.getElementById("quickTourOverlay");
        if (tourOverlay) tourOverlay.style.display = "none";

        // 3. Close Context Menu
        const contextMenu = document.getElementById("mapContextMenu");
        if (contextMenu) contextMenu.style.display = "none";

        // 4. Close Notification Drawer
        const notifDrawer = document.getElementById("notifDrawer");
        const notifBackdrop = document.getElementById("notifDrawerBackdrop");
        if (notifDrawer) notifDrawer.classList.remove("open");
        if (notifBackdrop) {
          notifBackdrop.style.display = "none";
          notifBackdrop.classList.remove("active");
        }

        // 5. Close Mobile Sidebar Drawer
        const sidebar = document.querySelector(".sidebar, .app-sidebar");
        const drawerBackdrop = document.getElementById("drawerBackdrop");
        if (sidebar) sidebar.classList.remove("open-mobile");
        if (drawerBackdrop) {
          drawerBackdrop.style.display = "none";
          drawerBackdrop.classList.remove("active");
        }

        soundManager.play('click');
      }
    });
  }
}

export const tourShortcutsController = new TourShortcutsController();
