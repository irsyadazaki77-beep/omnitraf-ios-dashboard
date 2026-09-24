/**
 * OmniTRAF Surabaya - Signals & Intersections Controller
 * Mengendalikan slider sinyal (green split & phase durations), manual override,
 * kalkulator metode Webster, dan pengalihan tata letak (Tabel/Grid) persimpangan terpantau.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { TRAFFIC_LIMITS } from '../config/trafficConfig.js';
import { mapManager } from '../modules/mapManager.js';
import { SITS_INTERSECTIONS } from '../config/surabayaCoords.js';

export class SignalsController {
  constructor() {
    this.isGridView = false;
  }

  init() {
    this._bindDashboardSignalSlider();
    this._bindSignalsViewSliders();
    this._bindWebsterCalculator();
    this._bindIntersectionLayoutToggle();
    this._bindForceOverrideButtons();
    this._bindTableSearchAndClick();
    this._setupStoreSubscriptions();
  }

  _setupStoreSubscriptions() {
    stateStore.subscribe('state:greenSplitWonokromo', ({ value }) => {
      const greenValEl = document.getElementById("greenValue");
      if (greenValEl) greenValEl.textContent = `${value} dtk`;

      const dashboardSlider = document.getElementById("greenRange") || document.getElementById("greenSplitSlider");
      if (dashboardSlider && parseInt(dashboardSlider.value, 10) !== value) {
        dashboardSlider.value = value;
      }

      const tooltip = document.getElementById("sliderTooltip");
      if (tooltip) tooltip.textContent = `${value}s`;

      this._updateDashboardTimeline(value);
    });
  }

  _updateDashboardTimeline(greenSec) {
    const totalCycle = 90;
    const greenPct = Math.min(80, Math.max(20, Math.round((greenSec / totalCycle) * 100)));
    const yellowPct = 10;
    const redPct = Math.max(10, 100 - greenPct - yellowPct);

    const redSec = document.querySelector("#dashboardPhaseTimeline .phase-red");
    const yellowSec = document.querySelector("#dashboardPhaseTimeline .phase-yellow");
    const greenSecEl = document.querySelector("#dashboardPhaseTimeline .phase-green");

    if (redSec) redSec.style.width = `${redPct}%`;
    if (yellowSec) yellowSec.style.width = `${yellowPct}%`;
    if (greenSecEl) greenSecEl.style.width = `${greenPct}%`;
  }

  /**
   * 1. Dashboard Signal Slider (Simpang Wonokromo)
   */
  _bindDashboardSignalSlider() {
    const slider = document.getElementById("greenRange") || document.getElementById("greenSplitSlider");
    const tooltip = document.getElementById("sliderTooltip");
    const valDisplay = document.getElementById("greenValue");

    if (!slider) return;

    slider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (tooltip) tooltip.textContent = `${val}s`;
      if (valDisplay) valDisplay.textContent = `${val} dtk`;

      stateStore.setState({ greenSplitWonokromo: val });
      this._updateDashboardTimeline(val);

      socketClient.emit('green-split:update', {
        value: val,
        intersectionId: "node-wonokromo"
      });
    });

    slider.addEventListener("change", () => {
      soundManager.play('click');
      if (typeof window.showToast === "function") {
        window.showToast(`Durasi Green Split Simpang Wonokromo disetel ke ${slider.value}s.`);
      }
    });
  }

  /**
   * 2. View 4 Signals Console Sliders (Wonokromo, Tunjungan, etc.)
   */
  _bindSignalsViewSliders() {
    const sliders = document.querySelectorAll("#view-signals .sig-slide");
    sliders.forEach((slider, idx) => {
      slider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        const parent = slider.closest(".signal-sliders");
        const prevRow = slider.previousElementSibling;
        if (prevRow && prevRow.querySelector("strong")) {
          prevRow.querySelector("strong").textContent = `${val} dtk`;
        }

        // Update cycle ring if present
        const card = slider.closest(".widget");
        const cycleNum = card ? card.querySelector(".cycle-number") : null;
        if (cycleNum) cycleNum.textContent = `${val}`;

        // Update timeline in widget
        const timeline = parent ? parent.querySelector(".phase-timeline-bar") : null;
        if (timeline) {
          const greenSec = timeline.querySelector(".phase-green");
          const redSec = timeline.querySelector(".phase-red");
          if (greenSec && redSec) {
            const greenPct = Math.min(75, Math.max(25, Math.round((val / 90) * 100)));
            greenSec.style.width = `${greenPct}%`;
            redSec.style.width = `${100 - greenPct - 10}%`;
          }
        }
      });

      slider.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        soundManager.play('click');
        if (typeof window.showToast === "function") {
          window.showToast(`Fase Sinyal disesuaikan ke ${val} detik.`);
        }
      });
    });
  }

  /**
   * 3. Manual Override Buttons
   */
  _bindForceOverrideButtons() {
    document.querySelectorAll(".force-override-btn").forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        const nodeIds = ["node-wonokromo", "node-tunjungan", "node-darmo", "node-margorejo"];
        const targetId = nodeIds[idx] || "node-wonokromo";
        const card = btn.closest(".widget");
        const name = card ? (card.querySelector("h2")?.textContent || targetId) : targetId;

        socketClient.emit('signal:override', { intersectionId: targetId, duration: 45 });
        
        btn.textContent = "✓ Override Aktif (45s)";
        btn.classList.add("btn-danger");
        soundManager.play('alert');

        if (typeof window.showToast === "function") {
          window.showToast(`🛠️ Manual Override Aktif: ${name} dikunci HIJAU 45 detik!`, "warning");
        }

        setTimeout(() => {
          btn.textContent = "Terapkan Manual Override";
          btn.classList.remove("btn-danger");
        }, 5000);
      });
    });
  }

  /**
   * 4. Webster Method Interactive Sandbox Calculator
   */
  _bindWebsterCalculator() {
    const calcWebster = () => {
      const inputL = document.getElementById("websterLostTime");
      const inputY = document.getElementById("websterFlowRatio");
      const resVal = document.getElementById("websterOptCycleResult");
      const resFormula = document.getElementById("websterCalcSteps");

      if (!inputL || !inputY || !resVal) return;

      const L = Math.max(4, Math.min(30, parseFloat(inputL.value) || 12));
      const Y = Math.max(0.1, Math.min(0.95, parseFloat(inputY.value) || 0.72));

      // Formula: C_0 = (1.5 * L + 5) / (1 - Y)
      const numerator = 1.5 * L + 5;
      const denominator = 1 - Y;
      const cOpt = Math.round(numerator / denominator);

      resVal.textContent = `${cOpt} detik`;
      if (resFormula) {
        resFormula.textContent = `C₀ = (1.5 × ${L} + 5) / (1 - ${Y.toFixed(2)}) = ${numerator.toFixed(1)} / ${denominator.toFixed(2)} = ${cOpt}s`;
      }
    };

    const inputL = document.getElementById("websterLostTime");
    const inputY = document.getElementById("websterFlowRatio");
    if (inputL) inputL.addEventListener("input", calcWebster);
    if (inputY) inputY.addEventListener("input", calcWebster);
    calcWebster();
  }

  /**
   * 5. Intersection Layout Toggle (Table vs Grid Cards)
   */
  _bindIntersectionLayoutToggle() {
    const btnToggle = document.getElementById("btnToggleIntersectionsLayout");
    const tableWrap = document.querySelector("#intersections .table-wrap");
    const panel = document.getElementById("intersections");

    if (!btnToggle || !tableWrap || !panel) return;

    // Create container for grid cards if not already present
    let gridContainer = document.getElementById("intersectionCardsGrid");
    if (!gridContainer) {
      gridContainer = document.createElement("div");
      gridContainer.id = "intersectionCardsGrid";
      gridContainer.className = "intersection-cards-grid";
      gridContainer.style.display = "none";
      gridContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
      gridContainer.style.gap = "14px";
      gridContainer.style.marginTop = "14px";
      panel.insertBefore(gridContainer, tableWrap.nextSibling);
    }

    const renderGridCards = () => {
      const rows = Array.from(document.querySelectorAll("#intersectionTable tr"));
      gridContainer.innerHTML = rows.map((r) => {
        const cells = r.querySelectorAll("td");
        if (cells.length < 4) return "";
        const name = cells[0].textContent.trim();
        const status = cells[1].textContent.trim();
        const density = cells[2].textContent.trim();
        const waitTime = cells[3].textContent.trim();
        const densityClass = r.dataset.density || "moderate";

        return `
          <div class="intersection-card-item glass-soft" data-name="${name}" style="padding: 14px; border-radius: 12px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s ease;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <strong style="font-size: 13px; color: var(--text);">${name}</strong>
              <span class="tag tag-${densityClass}">${density}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--text-muted);">
              <span>Status: <strong style="color: var(--success);">${status}</strong></span>
              <span>Waktu Tunggu: <strong style="color: var(--text);">${waitTime}</strong></span>
            </div>
            <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
              <button class="btn btn-ghost compact fly-btn" style="font-size: 10.5px; padding: 3px 8px;">🛰️ Fokus di Peta</button>
            </div>
          </div>
        `;
      }).join("");

      gridContainer.querySelectorAll(".intersection-card-item").forEach(card => {
        card.addEventListener("click", () => {
          const name = card.dataset.name;
          soundManager.play('click');
          if (typeof window.showToast === "function") {
            window.showToast(`🛰️ Navigasi kamera ke: ${name}`);
          }
          mapManager.flyToIntersection(name);
        });
      });
    };

    btnToggle.addEventListener("click", () => {
      this.isGridView = !this.isGridView;
      soundManager.play('click');

      if (this.isGridView) {
        btnToggle.textContent = "Tabel View";
        tableWrap.style.display = "none";
        renderGridCards();
        gridContainer.style.display = "grid";
      } else {
        btnToggle.textContent = "Grid/Tabel";
        gridContainer.style.display = "none";
        tableWrap.style.display = "block";
      }
    });
  }

  /**
   * 6. Table Search & Click to Fly
   */
  _bindTableSearchAndClick() {
    const tableRows = document.querySelectorAll("#intersectionTable tr");
    tableRows.forEach(row => {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const nameCell = row.cells[0];
        const name = nameCell ? nameCell.textContent.trim() : row.textContent.trim();
        soundManager.play('click');
        if (typeof window.showToast === "function") {
          window.showToast(`🛰️ Navigasi kamera ke: ${name}`);
        }
        mapManager.flyToIntersection(name);
      });
    });
  }
}

export const signalsController = new SignalsController();
