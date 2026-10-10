/**
 * OmniTRAF Surabaya - Signals & Intersections Controller
 * Mengendalikan slider sinyal (green split & phase durations), manual override,
 * kalkulator metode Webster, dan pengalihan tata letak (Tabel/Grid) persimpangan terpantau.
 */

import { stateStore, escapeHtml } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { TRAFFIC_LIMITS } from '../config/trafficConfig.js';
import { SITS_INTERSECTIONS } from '../config/surabayaCoords.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';
import { signalsView } from '../ui/adapters/signalsView.js';
import { authManager } from '../core/authManager.js';

export class SignalsController {
  constructor() {
    this.isGridView = false;
    this._isInitialized = false;
    this._currentTargetNode = 'node-wonokromo';
    this.disposer = new Disposer('SignalsController');
    this.view = signalsView;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
  }

  activate() {
    this.deactivate(); // deterministic cleanup first

    this._ensureIntersectionCards();
    this._bindDashboardSignalSlider();
    this._bindSignalsViewSliders();
    this._bindWebsterCalculator();
    this._bindIntersectionLayoutToggle();
    this._bindForceOverrideButtons();
    this._bindAiRecommendationButtons();
    this._bindManualOverrideModal();
    this._bindTableSearchAndClick();
    this._bindIntersectionSearchAutocomplete();
    this._bindDashboardDensityFilterChips();
    this._setupStoreSubscriptions();
    this._syncRoleCapabilities();
    this.disposer.add(authManager.onAuthChange(() => this._syncRoleCapabilities()));
    this.disposer.addEventListener(window, 'omnitraf:entity-focus', (event) => {
      if (event.detail?.kind !== 'intersection') return;
      const target = [...document.querySelectorAll('#view-signals [data-intersection-id]')]
        .find((item) => item.dataset.intersectionId === String(event.detail.id));
      if (!target) return;
      target.tabIndex = target.tabIndex >= 0 ? target.tabIndex : -1;
      target.classList.add('entity-search-focus');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Initial sync via View Adapter
    const state = stateStore.getState();
    const greenSplit = state.greenSplitWonokromo;

    this.view.updateGreenSplit(greenSplit);
    this._updateDashboardTimeline(greenSplit);
    this._updateActiveOverrideBadges();
    this._renderSignalState();
  }

  deactivate() {
    this.disposer.clear();
  }

  _ensureIntersectionCards() {
    const grid = document.querySelector('#view-signals .signals-console-grid');
    const template = grid?.querySelector('.signals-intersection-card');
    if (!template) return;
    const nodes = stateStore.getState().intersections || [];
    for (const node of nodes) {
      if ([...grid.querySelectorAll('[data-intersection-id]')].some(card => card.dataset.intersectionId === node.id)) continue;
      const card = template.cloneNode(true);
      card.dataset.intersectionId = node.id;
      card.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      card.querySelector('h2').textContent = node.name || node.id;
      grid.appendChild(card);
    }
    grid.querySelectorAll('.signals-intersection-card').forEach(card => {
      if (!card.querySelector('[data-signal-command-status]')) {
        const status = document.createElement('p');
        status.dataset.signalCommandStatus = 'true';
        status.setAttribute('role', 'status');
        status.className = 'text-muted';
        card.querySelector('.signal-active-panel').after(status);
      }
      const sliders = [...card.querySelectorAll('.sig-slide')];
      sliders.slice(1).forEach(slider => { slider.previousElementSibling?.remove(); slider.remove(); });
      const slider = sliders[0];
      if (slider) {
        slider.setAttribute('aria-label', `Durasi hijau ${card.querySelector('h2').textContent}`);
        slider.previousElementSibling.querySelector('span').textContent = 'Durasi hijau konfigurasi';
      }
    });
  }

  _syncRoleCapabilities() {
    const canOperate = authManager.hasRole(['OPERATOR', 'ADMIN']);
    document.querySelectorAll('#view-signals .force-override-btn, #view-signals .sig-slide, #btnConfirmOverrideModal, #btnConfirmAiRecModal')
      .forEach((control) => { control.hidden = !canOperate; });
  }

  _setupStoreSubscriptions() {
    this.disposer.addStoreSubscription(stateStore, 'state:greenSplitWonokromo', ({ value }) => {
      this.view.updateGreenSplit(value);
      this._updateDashboardTimeline(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'traffic:update', () => {
      this._updateActiveOverrideBadges();
      this._renderSignalState();
    });
    this.disposer.addStoreSubscription(stateStore, 'state:resynced', () => this._renderSignalState());
  }

  _renderSignalState() {
    const state = stateStore.getState();
    const intersections = Array.isArray(state.intersections) ? state.intersections : [];
    const updatedAtRaw = state.lastTelemetryAt ?? state.lastTelemetryTime;
    const parsedUpdate = updatedAtRaw ? new Date(updatedAtRaw) : null;
    const updatedAt = parsedUpdate && !Number.isNaN(parsedUpdate.getTime())
      ? parsedUpdate.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';
    const phaseName = (phase) => ({ green: 'Hijau', yellow: 'Kuning', red: 'Merah' })[String(phase || '').toLowerCase()] || '—';
    const densityName = (node) => {
      const status = String(node.status || '').toLowerCase();
      if (status.includes('padat') || status.includes('heavy') || status.includes('high')) return 'high';
      if (status.includes('sedang') || status.includes('moderate')) return 'moderate';
      if (status.includes('lancar') || status.includes('normal') || status.includes('low')) return 'low';
      return 'unknown';
    };

    document.querySelectorAll('#view-signals .signals-intersection-card[data-intersection-id]').forEach((card) => {
      const node = intersections.find((item) => item.id === card.dataset.intersectionId);
      if (!node) return;
      const phase = String(node.state || '').toLowerCase();
      card.querySelector('[data-signal-phase]')?.replaceChildren(document.createTextNode(`Fase: ${phaseName(phase)}`));
      card.querySelector('[data-signal-wait]')?.replaceChildren(document.createTextNode(`Waktu tunggu: ${node.waitTime ?? '—'} detik`));
      card.querySelector('[data-signal-updated]')?.replaceChildren(document.createTextNode(`Update: ${updatedAt}`));
      const cycle = card.querySelector('.cycle-number');
      if (cycle && Number.isFinite(Number(node.timer))) cycle.textContent = String(node.timer);
      const splitSlider = card.querySelector('.sig-slide');
      const pending = node.pendingGreenSplit != null ? Number(node.pendingGreenSplit) : null;
      const greenSplit = Number(pending ?? node.greenSplit ?? node.signal?.greenSplit);
      const status = card.querySelector('[data-signal-command-status]');
      if (status) status.textContent = pending !== null
        ? `Dikonfirmasi server: ${pending} detik akan berlaku pada siklus berikutnya. Fase saat ini memakai ${node.greenSplit} detik.`
        : `Konfigurasi aktif: ${node.greenSplit ?? '—'} detik hijau. Sisa fase ditampilkan di atas.`;
      if (splitSlider && Number.isFinite(greenSplit) && splitSlider.dataset.commandPending !== 'true') {
        splitSlider.value = String(greenSplit);
        splitSlider.dataset.acknowledgedValue = String(greenSplit);
        this._renderSignalSliderPreview(splitSlider, greenSplit);
      }
      card.querySelectorAll('.signals-apill-lens').forEach((lens) => {
        lens.classList.toggle('active', lens.classList.contains(`lens-${phase}`));
      });
    });

    const table = document.getElementById('intersectionTable');
    if (!table || typeof table.replaceChildren !== 'function' || intersections.length === 0) return;
    table.replaceChildren(...intersections.map((node) => {
      const row = document.createElement('tr');


      row.setAttribute('aria-label', `Fokus peta ke ${node.name || node.id}`);
      const density = densityName(node);
      row.dataset.density = density;
      [node.name || node.id, `${phaseName(node.state)} · simulasi`, node.status || '—', node.waitTime === undefined ? '—' : `${node.waitTime} dtk`, updatedAt].forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 2) {
          const badge = document.createElement('span');
          badge.className = `tag ${density === 'high' ? 'tag-high' : density === 'moderate' ? 'tag-moderate' : density === 'low' ? 'tag-low' : ''}`;
          badge.textContent = String(value);
          cell.appendChild(badge);
        } else if (index === 0) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn btn-ghost compact';
          button.textContent = String(value);
          button.setAttribute('aria-label', `Fokus peta ke ${value}`);
          cell.appendChild(button);
        } else cell.textContent = String(value);
        row.appendChild(cell);
      });
      return row;
    }));
  }

  _updateActiveOverrideBadges() {
    const intersections = stateStore.getState().intersections || [];
    intersections.forEach((node) => {
      const card = [...document.querySelectorAll('#view-signals .signals-intersection-card[data-intersection-id]')]
        .find((candidate) => candidate.dataset.intersectionId === node.id);
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

    if (!slider || !slider.dataset) return;
    slider.dataset.acknowledgedValue = String(stateStore.getState().greenSplitWonokromo ?? slider.value);

    this.disposer.addEventListener(slider, "input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isInteger(val)) return;
      if (tooltip) tooltip.textContent = `${val}s`;
      if (valDisplay) valDisplay.textContent = `${val} dtk`;
      this._updateDashboardTimeline(val);
    });

    this.disposer.addEventListener(slider, "change", async (e) => {
      const val = parseInt(e.target.value, 10);
      const previous = Number(slider.dataset.acknowledgedValue ?? stateStore.getState().greenSplitWonokromo ?? slider.defaultValue);
      const min = Number(slider.min || 15);
      const max = Number(slider.max || 90);
      if (!Number.isInteger(val) || val < min || val > max) {
        slider.value = String(previous);
        this.view.updateGreenSplit(previous);
        this._updateDashboardTimeline(previous);
        return;
      }
      if (slider.dataset.commandPending === 'true') return;
      if (!authManager.hasRole(['OPERATOR', 'ADMIN'])) {
        slider.value = String(previous);
        this.view.updateGreenSplit(previous);
        this._updateDashboardTimeline(previous);
        return;
      }
      slider.dataset.commandPending = 'true';
      slider.disabled = true;
      slider.setAttribute('aria-busy', 'true');
      soundManager.play('click');
      try {
        await commandLayer.dispatchCommand({
          action: 'green-split:update',
          targetType: 'intersection',
          targetId: 'node-wonokromo',
          payload: { value: val }
        }, false); // low-risk
        slider.dataset.acknowledgedValue = String(val);
        if (typeof window.showToast === "function") {
          window.showToast(`Penyesuaian simulasi Green Split Wonokromo (${val}s) dikonfirmasi server.`);
        }
      } catch (err) {
        slider.value = String(previous);
        this.view.updateGreenSplit(previous);
        this._updateDashboardTimeline(previous);
        if (typeof window.showToast === "function") {
          window.showToast(`❌ Gagal menyetel Green Split: ${err.message}`, "danger");
        }
      } finally {
        delete slider.dataset.commandPending;
        slider.disabled = false;
        slider.removeAttribute('aria-busy');
      }
    });
  }

  /**
   * 2. View 4 Signals Console Sliders (Wonokromo, Tunjungan, etc.)
   */
  _bindSignalsViewSliders() {
    const sliders = document.querySelectorAll("#view-signals .sig-slide");
    sliders.forEach((slider, idx) => {
      slider.dataset.acknowledgedValue = slider.value;
      this.disposer.addEventListener(slider, "input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (Number.isInteger(val)) this._renderSignalSliderPreview(slider, val);
      });

      this.disposer.addEventListener(slider, "change", async (e) => {
        const val = parseInt(e.target.value, 10);
        const previous = Number(slider.dataset.acknowledgedValue ?? slider.defaultValue);
        const min = Number(slider.min || 15);
        const max = Number(slider.max || 90);
        if (!Number.isInteger(val) || val < min || val > max) {
          slider.value = String(previous);
          this._renderSignalSliderPreview(slider, previous);
          return;
        }
        if (slider.dataset.commandPending === 'true') return;
        if (!authManager.hasRole(['OPERATOR', 'ADMIN'])) {
          slider.value = String(previous);
          this._renderSignalSliderPreview(slider, previous);
          return;
        }
        slider.dataset.commandPending = 'true';
        slider.disabled = true;
        slider.setAttribute('aria-busy', 'true');
        soundManager.play('click');
        const targetId = slider.closest('[data-intersection-id]')?.dataset.intersectionId;
        if (!targetId) { delete slider.dataset.commandPending; slider.disabled = false; slider.removeAttribute('aria-busy'); return; }

        try {
          await commandLayer.dispatchCommand({
            action: 'green-split:update',
            targetType: 'intersection',
            targetId,
            payload: { value: val }
          }, false); // low-risk
          slider.dataset.acknowledgedValue = String(val);
          if (typeof window.showToast === "function") {
            window.showToast(`Green split simulasi ${targetId} (${val}s) dikonfirmasi server.`);
          }
        } catch (err) {
          slider.value = String(previous);
          this._renderSignalSliderPreview(slider, previous);
          if (typeof window.showToast === "function") {
            window.showToast(`❌ Gagal menyesuaikan sinyal: ${err.message}`, "danger");
          }
        } finally {
          delete slider.dataset.commandPending;
          slider.disabled = false;
          slider.removeAttribute('aria-busy');
        }
      });
    });
  }

  _renderSignalSliderPreview(slider, value) {
    const parent = slider.closest('.signal-sliders');
    const previousRow = slider.previousElementSibling;
    if (previousRow?.querySelector('strong')) previousRow.querySelector('strong').textContent = `${value} dtk`;
    const card = slider.closest('.widget');
    const timeline = parent?.querySelector('.phase-timeline-bar');
    const green = timeline?.querySelector('.phase-green');
    const red = timeline?.querySelector('.phase-red');
    if (green && red) {
      const greenPercent = Math.min(75, Math.max(25, Math.round((value / 90) * 100)));
      green.style.width = `${greenPercent}%`;
      red.style.width = `${100 - greenPercent - 10}%`;
    }
  }

  /**
   * 3. Manual Override Trigger Buttons -> Open Safeguard Modal
   */
  _bindForceOverrideButtons() {
    document.querySelectorAll(".force-override-btn").forEach((btn, idx) => {
      this.disposer.addEventListener(btn, "click", () => {
        const card = btn.closest('[data-intersection-id]');
        this._currentTargetNode = card?.dataset.intersectionId;
        if (!this._currentTargetNode) return;
        const targetName = card.querySelector('h2')?.textContent || this._currentTargetNode;

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

    if (closeBtn) this.disposer.addEventListener(closeBtn, "click", closeModal);
    if (cancelBtn) this.disposer.addEventListener(cancelBtn, "click", closeModal);

    this.disposer.addEventListener(modal, "click", (e) => {
      if (e.target === modal) closeModal();
    });

    if (slider) {
      this.disposer.addEventListener(slider, "input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (valDisplay) valDisplay.textContent = val;
        this._updateOverrideSafetyWarning(val);
      });
    }

    if (confirmBtn) {
      this.disposer.addEventListener(confirmBtn, "click", async () => {
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
            window.showToast(`Aksi simulasi: fase sinyal contoh diubah selama ${dur} detik; tidak mengendalikan APILL.`, "warning");
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
      });
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
        title.textContent = "RENTANG PARAMETER DEMO";
        title.style.color = "var(--success)";
      }
      if (text) {
        text.textContent = `Durasi ${val} detik berada pada rentang input simulasi. Nilai ini bukan standar keselamatan atau rekomendasi Dishub.`;
      }
    }
  }

  /**
   * Bind AI Recommendation Confirmation Modal
   */
  _bindAiRecommendationButtons() {
    const buttons = document.querySelectorAll('button[data-action="simulate"], button[data-action="apply-ai"], .btn-apply-ai, #btnApplyAiRec');
    buttons.forEach(btn => {
      this.disposer.addEventListener(btn, "click", () => {
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

    if (closeBtn) this.disposer.addEventListener(closeBtn, "click", closeModal);
    if (cancelBtn) this.disposer.addEventListener(cancelBtn, "click", closeModal);

    this.disposer.addEventListener(modal, "click", (e) => {
      if (e.target === modal) closeModal();
    });

    if (confirmBtn) {
      this.disposer.addEventListener(confirmBtn, "click", async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Menerapkan…";

        try {
          await commandLayer.dispatchCommand({
            action: 'ai:apply-recommendation',
            targetType: 'intersection',
            targetId: this._currentTargetNode || 'node-wonokromo',
            payload: { targetSplit: this._recommendedSplit }
          }, false); // low-risk

          closeModal();
          soundManager.play('success');
          if (typeof window.showToast === "function") {
            window.showToast("Rekomendasi model contoh diterapkan pada state simulasi; tidak dikirim ke APILL.");
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
      });
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

    const node = (stateStore.getState().intersections || []).find(item => item.id === nodeId);
    if (!node) { window.showToast?.('Simpang tidak tersedia. Muat ulang data.', 'warning'); return; }
    const current = Number(node.pendingGreenSplit ?? node.greenSplit ?? 35);
    const target = Math.max(10, Math.min(90, current + 8));
    this._recommendedSplit = target;
    const cycle = target + Number(node.redDuration ?? 25) + Number(node.yellowDuration ?? 3);
    if (title) title.textContent = `Pratinjau skenario: ${node.name || nodeName}`;
    if (volQ) volQ.textContent = 'Tidak tersedia';
    if (flowRatio) flowRatio.textContent = 'belum diukur';
    if (delaySaved) delaySaved.textContent = 'Belum dievaluasi';
    if (splitDiff) splitDiff.textContent = `${current} dtk → ${target} dtk (+${target - current})`;
    const update = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
    update('aiRecOldText', `${current} dtk`);
    update('aiRecNewText', `${target} dtk`);
    const oldBar = document.getElementById('aiRecBarOld');
    const newBar = document.getElementById('aiRecBarNew');
    if (oldBar) oldBar.style.width = `${current / cycle * 100}%`;
    if (newBar) newBar.style.width = `${(target - current) / cycle * 100}%`;

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
    if (inputL) this.disposer.addEventListener(inputL, "input", calcWebster);
    if (inputY) this.disposer.addEventListener(inputY, "input", calcWebster);
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
        const densityClass = ['low', 'moderate', 'high'].includes(r.dataset.density) ? r.dataset.density : 'moderate';
        const safeName = escapeHtml(name);
        const safeStatus = escapeHtml(status);
        const safeDensity = escapeHtml(density);
        const safeWaitTime = escapeHtml(waitTime);

        return `
          <div class="intersection-card-item glass-soft" data-name="${safeName}" style="padding: 14px; border-radius: 12px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s ease;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <strong style="font-size: 13px; color: var(--text);">${safeName}</strong>
              <span class="tag tag-${densityClass}">${safeDensity}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--text-muted);">
              <span>Status: <strong style="color: var(--success);">${safeStatus}</strong></span>
              <span>Waktu Tunggu: <strong style="color: var(--text);">${safeWaitTime}</strong></span>
            </div>
            <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
              <button class="btn btn-ghost compact fly-btn" style="font-size: 10.5px; padding: 3px 8px;">🛰️ Fokus di Peta</button>
            </div>
          </div>
        `;
      }).join("");

      gridContainer.querySelectorAll(".intersection-card-item").forEach(card => {
        this.disposer.addEventListener(card, "click", () => {
          const name = card.dataset.name;
          soundManager.play('click');
          if (typeof window.showToast === "function") {
            window.showToast(`🛰️ Navigasi kamera ke: ${name}`);
          }
          window.mapManager?.flyToIntersection(name);
        });
      });
    };

    this.disposer.addEventListener(btnToggle, "click", () => {
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
    const table = document.getElementById('intersectionTable');
    if (!table) return;
    this.disposer.addEventListener(table, 'click', (event) => {
      const row = event.target.closest('tr');
      if (!row || !table.contains(row)) return;
      const name = row.cells[0]?.textContent.trim() || row.textContent.trim();
      soundManager.play('click');
      window.mapManager?.flyToIntersection(name);
    });
    this.disposer.addEventListener(table, 'keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target.closest('tr[role="button"]');
      if (!row || !table.contains(row)) return;
      event.preventDefault();
      const name = row.cells[0]?.textContent.trim() || row.textContent.trim();
      window.mapManager?.flyToIntersection(name);
    });
  }

  /**
   * 7. Dashboard Intersection Search Autocomplete & Flight
   */
  _bindIntersectionSearchAutocomplete() {
    const searchInput = document.getElementById("intersectionSearch");
    const suggestionsDiv = document.getElementById("searchSuggestions");
    if (!searchInput || !suggestionsDiv) return;

    let activeIndex = -1;

    const renderSuggestions = (filtered) => {
      if (filtered.length === 0) {
        suggestionsDiv.innerHTML = `<div class="suggestion-item empty" style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">Tidak ada simpang ditemukan</div>`;
        suggestionsDiv.classList.remove("is-hidden");
        return;
      }

      suggestionsDiv.innerHTML = filtered.map((item, idx) => {
        const safeName = escapeHtml(item.name);
        const safeCorridor = escapeHtml(item.corridor || '');
        const safeDistrict = escapeHtml(item.district || '');
        const safeId = escapeHtml(item.id);
        const statusClass = ['success', 'warning', 'danger'].includes(item.status) ? item.status : 'success';
        return `
        <div class="suggestion-item" data-id="${safeId}" data-name="${safeName}" data-index="${idx}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; transition: background 0.15s ease;">
          <div>
            <strong style="color: var(--text);">${safeName}</strong>
            <div style="font-size: 10px; color: var(--text-muted);">${safeCorridor} • ${safeDistrict}</div>
          </div>
          <span class="tag tag-${statusClass}" style="font-size: 9px; padding: 1px 6px;">${statusClass === 'danger' ? 'Macet' : statusClass === 'warning' ? 'Padat' : 'Lancar'}</span>
        </div>
      `;
      }).join("");

      suggestionsDiv.classList.remove("is-hidden");
      activeIndex = -1;
    };

    const selectItem = (id, name) => {
      soundManager.play('click');
      searchInput.value = name;
      suggestionsDiv.classList.add("is-hidden");
      if (typeof window.showToast === "function") {
        window.showToast(`🛰️ Navigasi kamera ke: ${name}`);
      }
      window.mapManager?.flyToIntersection(id);
      searchInput.blur();
    };

    this.disposer.addEventListener(searchInput, "input", () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        suggestionsDiv.classList.add("is-hidden");
        return;
      }

      const filtered = SITS_INTERSECTIONS.filter(item => 
        item.name.toLowerCase().includes(q) || 
        (item.corridor && item.corridor.toLowerCase().includes(q)) || 
        (item.district && item.district.toLowerCase().includes(q))
      );

      renderSuggestions(filtered);
    });

    this.disposer.addEventListener(searchInput, "focus", () => {
      const q = searchInput.value.trim().toLowerCase();
      if (q) {
        const filtered = SITS_INTERSECTIONS.filter(item => 
          item.name.toLowerCase().includes(q) || 
          (item.corridor && item.corridor.toLowerCase().includes(q))
        );
        renderSuggestions(filtered);
      }
    });

    this.disposer.addEventListener(searchInput, "keydown", (e) => {
      const items = suggestionsDiv.querySelectorAll(".suggestion-item:not(.empty)");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length > 0) {
          if (activeIndex >= 0) {
            items[activeIndex].style.background = "";
            items[activeIndex].style.boxShadow = "";
          }
          activeIndex = (activeIndex + 1) % items.length;
          items[activeIndex].style.background = "rgba(0, 229, 255, 0.15)";
          items[activeIndex].style.boxShadow = "inset 3px 0 0 var(--primary-2)";
          items[activeIndex].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length > 0) {
          if (activeIndex >= 0) {
            items[activeIndex].style.background = "";
            items[activeIndex].style.boxShadow = "";
          }
          activeIndex = (activeIndex - 1 + items.length) % items.length;
          items[activeIndex].style.background = "rgba(0, 229, 255, 0.15)";
          items[activeIndex].style.boxShadow = "inset 3px 0 0 var(--primary-2)";
          items[activeIndex].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          items[activeIndex].click();
        } else {
          if (items.length > 0) {
            items[0].click();
          }
        }
      } else if (e.key === "Escape") {
        suggestionsDiv.classList.add("is-hidden");
        searchInput.blur();
      }
    });

    this.disposer.addEventListener(suggestionsDiv, "click", (e) => {
      const item = e.target.closest(".suggestion-item:not(.empty)");
      if (item) {
        const id = item.dataset.id;
        const name = item.dataset.name;
        selectItem(id, name);
      }
    });

    // Close when clicking outside
    this.disposer.addEventListener(document, "click", (e) => {
      if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
        suggestionsDiv.classList.add("is-hidden");
      }
    });
  }

  /**
   * 8. Dashboard Density Filter Chips (All / High / Moderate / Low)
   */
  _bindDashboardDensityFilterChips() {
    const chips = document.querySelectorAll("#view-dashboard .filter-chip");
    if (chips.length === 0) return;

    chips.forEach(chip => {
      this.disposer.addEventListener(chip, "click", () => {
        soundManager.play('click');
        chips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");

        const densityFilter = chip.dataset.filter; // "all", "high", "moderate", "low"
        
        const mapBox = document.getElementById("dashboardMapBox");
        if (mapBox) {
          mapBox.dataset.density = densityFilter;
        }

        if (typeof window.showToast === "function") {
          const label = densityFilter === "all" ? "semua tingkat kepadatan" : `tingkat kepadatan ${densityFilter.toUpperCase()}`;
          window.showToast(`Menyaring persimpangan: ${label}`);
        }

        if (window.mapManager && typeof window.mapManager.maps === "object") {
          window.mapManager.maps.forEach((map, containerId) => {
            const groups = window.mapManager.layerGroupsMap.get(containerId);
            const signalGroup = groups ? groups['signal-points'] : null;
            if (signalGroup) {
              signalGroup.eachLayer(layer => {
                const p = layer.options?.properties || (layer.feature && layer.feature.properties);
                if (!p) return;
                
                const status = p.status; // 'danger' (high), 'warning' (moderate), 'success' (low)
                let matches = false;
                if (densityFilter === "all") {
                  matches = true;
                } else if (densityFilter === "high" && status === "danger") {
                  matches = true;
                } else if (densityFilter === "moderate" && status === "warning") {
                  matches = true;
                } else if (densityFilter === "low" && status === "success") {
                  matches = true;
                }

                if (matches) {
                  if (!map.hasLayer(layer)) {
                    signalGroup.addLayer(layer);
                    const masterCluster = groups['master-cluster'];
                    if (masterCluster) masterCluster.addLayer(layer);
                  }
                } else {
                  if (map.hasLayer(layer)) {
                    signalGroup.removeLayer(layer);
                    const masterCluster = groups['master-cluster'];
                    if (masterCluster) masterCluster.removeLayer(layer);
                  }
                }
              });
            }
          });
        }
      });
    });
  }
}

export const signalsController = new SignalsController();
