/**
 * OmniTRAF Surabaya - Signals View DOM Adapter (Phase 1 Refactor)
 * Mengisolasi DOM access dan selectors dari SignalsController.
 */

export class SignalsViewAdapter {
  getGreenValueEl() {
    return document.getElementById("greenValue");
  }

  getDashboardSlider() {
    return document.getElementById("greenRange") || document.getElementById("greenSplitSlider");
  }

  getSliderTooltip() {
    return document.getElementById("sliderTooltip");
  }

  getIntersectionCards() {
    return document.querySelectorAll("#view-signals .signals-intersection-card");
  }

  getOverrideModal() {
    return document.getElementById("manualOverrideModal");
  }

  updateGreenSplit(value) {
    const greenValEl = this.getGreenValueEl();
    if (greenValEl) greenValEl.textContent = `${value} dtk`;

    const dashboardSlider = this.getDashboardSlider();
    if (dashboardSlider && parseInt(dashboardSlider.value, 10) !== value) {
      dashboardSlider.value = value;
    }

    const tooltip = this.getSliderTooltip();
    if (tooltip) tooltip.textContent = `${value}s`;
  }
}

export const signalsView = new SignalsViewAdapter();
