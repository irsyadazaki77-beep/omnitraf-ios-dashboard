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
import { commandLayer } from '../core/commandLayer.js';

export class SignalsController {
  constructor() {
    this.isGridView = false;
    this._isInitialized = false;
    this._currentTargetNode = 'node-wonokromo';
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._bindDashboardSignalSlider();
    this._bindSignalsViewSliders();
    this._bindWebsterCalculator();
    this._bindIntersectionLayoutToggle();
    this._bindForceOverrideButtons();
    this._bindAiRecommendationButtons();
    this._bindManualOverrideModal();
    this._bindTableSearchAndClick();
    this._setupStoreSubscriptions();
  }

  activate() {
    this._bindDashboardSignalSlider();
    this._bindSignalsViewSliders();
    this._bindWebsterCalculator();
    this._bindIntersectionLayoutToggle();
    this._bindForceOverrideButtons();
    this._bindAiRecommendationButtons();
    this._bindManualOverrideModal();
    this._bindTableSearchAndClick();
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

    stateStore.subscribe('traffic:update', () => {
      this._updateActiveOverrideBadges();
    });
  }

  _updateActiveOverrideBadges() {
    const intersections = stateStore.getState().intersections || [];
    intersections.forEach((node, idx) => {
      const cards = document.querySelectorAll("#view-signals .signals-intersection-card");
      const card = cards[idx];
      if (!card) return;

      const overrideBtn = card.querySelector(".force-override-btn");
      if (!overrideBtn) return;

      if (node.isOverrideActive && typeof node.timer === "number") {
        overrideBtn.textContent = `🛠️ Override Aktif (${node.timer}s tersisa)`;
        overrideBtn.classList.add("btn-danger");
        overrideBtn.style.background = "var(--danger)";
      } else if (!overrideBtn.disabled) {
        overrideBtn.textContent = "Terapkan Manual Override";
        overrideBtn.classList.remove("btn-danger");
        overrideBtn.style.background = "";
      }
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
    });

    slider.addEventListener("change", async (e) => {
      const val = parseInt(e.target.value, 10);
      soundManager.play('click');
      try {
        await commandLayer.dispatchCommand({
          action: 'green-split:update',
          targetType: 'intersection',
          targetId: 'node-wonokromo',
          payload: { value: val }
        }, false); // low-risk
        if (typeof window.showToast === "function") {
          window.showToast(`✓ Penyesuaian Green Split Wonokromo (${val}s) dijadwalkan pada siklus berikutnya.`);
        }
      } catch (err) {
        if (typeof window.showToast === "function") {
          window.showToast(`❌ Gagal menyetel Green Split: ${err.message}`, "danger");
        }
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

      slider.addEventListener("change", async (e) => {
        const val = parseInt(e.target.value, 10);
        soundManager.play('click');
        const nodeIds = ["node-wonokromo", "node-tunjungan", "node-darmo", "node-margorejo"];
        const targetId = nodeIds[idx] || "node-wonokromo";

        try {
          await commandLayer.dispatchCommand({
            action: 'green-split:update',
            targetType: 'intersection',
            targetId,
            payload: { value: val }
          }, false); // low-risk
          if (typeof window.showToast === "function") {
            window.showToast(`✓ Sinyal ${targetId} disesuaikan ke ${val} detik.`);
          }
        } catch (err) {
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal menyesuaikan sinyal: ${err.message}`, "danger");
          }
        }
      });
    });
  }

  /**
   * 3. Manual Override Trigger Buttons -> Open Safeguard Modal
   */
  _bindForceOverrideButtons() {
    document.querySelectorAll(".force-override-btn").forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        const nodeIds = ["node-wonokromo", "node-tunjungan", "node-darmo", "node-margorejo"];
        const nodeNames = [
          "Simpang Wonokromo (Jl. Ahmad Yani)",
          "Simpang Tunjungan (Gedung Siola)",
          "Simpang Raya Darmo (Polisi Istimewa)",
          "Simpang Margorejo (Jl. Jemursari)"
        ];
        
        this._currentTargetNode = nodeIds[idx] || "node-wonokromo";
        const targetName = nodeNames[idx] || "Simpang Wonokromo (A. Yani)";

        this.openManualOverrideModal(this._currentTargetNode, targetName);
      });
    });
  }

  /**
   * Bind events inside Manual Override Modal
   */
  _bindManualOverrideModal() {
    const modal = document.getElementById("manualOverrideModal");
    const closeBtn = document.getElementById("closeOverrideModal");
    const cancelBtn = document.getElementById("btnCancelOverrideModal");
    const confirmBtn = document.getElementById("btnConfirmOverrideModal");
    const slider = document.getElementById("overrideDurationSlider");
    const valDisplay = document.getElementById("overrideDurationVal");

    if (!modal) return;

    const closeModal = () => {
      modal.style.display = "none";
      modal.classList.remove("show");
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    if (slider) {
      slider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        if (valDisplay) valDisplay.textContent = val;
        this._updateOverrideSafetyWarning(val);
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const dur = slider ? parseInt(slider.value, 10) : 45;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "EXECUTING...";

        try {
          soundManager.play('alert');
          await commandLayer.dispatchCommand({
            action: 'signal:override',
            targetType: 'intersection',
            targetId: this._currentTargetNode || 'node-wonokromo',
            payload: { duration: dur }
          }, true); // High risk confirmation

          closeModal();
          if (typeof window.showToast === "function") {
            window.showToast(`🛠️ Manual Override Aktif: Sinyal dikunci HIJAU selama ${dur} detik!`, "warning");
          }
        } catch (err) {
          console.warn("[SignalsController] Override failed:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Override Ditolak: ${err.message}`, "danger");
          }
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Eksekusi Lock HIJAU";
        }
      };
    }
  }

  openManualOverrideModal(nodeId = 'node-wonokromo', nodeName = 'Simpang Wonokromo (Jl. Ahmad Yani)') {
    this._currentTargetNode = nodeId;
    const modal = document.getElementById("manualOverrideModal");
    const nodeNameEl = document.getElementById("overrideNodeName");
    const slider = document.getElementById("overrideDurationSlider");
    const valDisplay = document.getElementById("overrideDurationVal");

    if (!modal) return;

    if (nodeNameEl) nodeNameEl.textContent = nodeName;
    if (slider) {
      slider.value = 45;
      if (valDisplay) valDisplay.textContent = 45;
      this._updateOverrideSafetyWarning(45);
    }

    modal.style.display = "flex";
    modal.classList.add("show");
    soundManager.play('click');
  }

  _updateOverrideSafetyWarning(val) {
    const warningBox = document.getElementById("overrideSafetyWarning");
    const icon = document.getElementById("overrideWarningIcon");
    const title = document.getElementById("overrideWarningTitle");
    const text = document.getElementById("overrideWarningText");

    if (!warningBox) return;

    if (val < 20) {
      warningBox.style.borderColor = "rgba(239, 68, 68, 0.5)";
      warningBox.style.background = "rgba(239, 68, 68, 0.12)";
      if (icon) icon.textContent = "⚠️";
      if (title) {
        title.textContent = "PERINGATAN KESELAMATAN (PEDESTRIAN HAZARD)";
        title.style.color = "#f87171";
      }
      if (text) {
        text.textContent = `Durasi ${val} detik terlalu pendek (< 20s). Berisiko membahayakan pejalan kaki yang belum selesai menyeberang di zebra cross.`;
      }
    } else if (val > 60) {
      warningBox.style.borderColor = "rgba(245, 158, 11, 0.5)";
      warningBox.style.background = "rgba(245, 158, 11, 0.12)";
      if (icon) icon.textContent = "⚠️";
      if (title) {
        title.textContent = "PERINGATAN ANTREAN PARAH (SPILLBACK RISK)";
        title.style.color = "#fbbf24";
      }
      if (text) {
        text.textContent = `Durasi ${val} detik melebihi 60 detik. Berpotensi memicu penumpukan antrean panjang pada lengan simpang yang tertahan (fase Merah).`;
      }
    } else {
      warningBox.style.borderColor = "var(--success-border)";
      warningBox.style.background = "var(--success-soft)";
      if (icon) icon.textContent = "✅";
      if (title) {
        title.textContent = "DURASI AMAN STANDAR DISHUB";
        title.style.color = "var(--success)";
      }
      if (text) {
        text.textContent = `Durasi ${val} detik berada pada rentang aman baku Dishub SITS Surabaya (20s - 60s) tanpa mengorbankan keselamatan penyeberang jalan.`;
      }
    }
  }

  /**
   * Bind AI Recommendation Confirmation Modal
   */
  _bindAiRecommendationButtons() {
    const buttons = document.querySelectorAll('button[data-action="simulate"], button[data-action="apply-ai"], .btn-apply-ai, #btnApplyAiRec');
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        this.openAiRecommendationModal('node-wonokromo', 'Simpang Wonokromo (A. Yani)');
      });
    });

    const modal = document.getElementById("aiRecommendationModal");
    const closeBtn = document.getElementById("closeAiRecModal");
    const cancelBtn = document.getElementById("btnCancelAiRecModal");
    const confirmBtn = document.getElementById("btnConfirmAiRecModal");

    if (!modal) return;

    const closeModal = () => {
      modal.style.display = "none";
      modal.classList.remove("show");
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "APPLYING...";

        try {
          await commandLayer.dispatchCommand({
            action: 'ai:apply-recommendation',
            targetType: 'intersection',
            targetId: this._currentTargetNode || 'node-wonokromo',
            payload: { targetSplit: 48 }
          }, false); // low-risk

          closeModal();
          soundManager.play('success');
          if (typeof window.showToast === "function") {
            window.showToast("✨ Rekomendasi Webster AI Disetujui: Green Split disesuaikan ke 48s pada siklus berikutnya!");
          }
        } catch (err) {
          console.warn("[SignalsController] AI recommendation failed:", err);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal: ${err.message}`, "danger");
          }
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "✓ Terapkan Pada Siklus Berikutnya";
        }
      };
    }
  }

  openAiRecommendationModal(nodeId = 'node-wonokromo', nodeName = 'Simpang Wonokromo (A. Yani)') {
    this._currentTargetNode = nodeId;
    const modal = document.getElementById("aiRecommendationModal");
    const title = document.getElementById("aiRecModalTitle");
    const volQ = document.getElementById("aiRecVolumeQ");
    const flowRatio = document.getElementById("aiRecFlowRatio");
    const delaySaved = document.getElementById("aiRecDelaySaved");
    const splitDiff = document.getElementById("aiRecSplitDiff");

    if (!modal) return;

    if (title) title.textContent = `Konfirmasi Optimasi Webster: ${nodeName}`;
    if (volQ) volQ.textContent = "2,450 smp/jam";
    if (flowRatio) flowRatio.textContent = "0.72";
    if (delaySaved) delaySaved.textContent = "-12.4 dtk/kend";
    if (splitDiff) splitDiff.textContent = "35s ➔ 48s (+13s)";

    modal.style.display = "flex";
    modal.classList.add("show");
    soundManager.play('click');
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
