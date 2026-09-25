/**
 * OmniTRAF Surabaya - UI Marquee Banner Controller
 * Banner pengumuman sistem bergerak di bagian paling atas dasbor,
 * responsif terhadap insiden darurat, Mode Keos, dan pembaruan telemetri SITS.
 */

import { stateStore } from '../core/stateStore.js';

export class UiMarquee {
  constructor() {
    this.marqueeContainer = null;
    this.contentEl = null;
    this._isInitialized = false;
    this.defaultMessages = [
      "🚨 PEMBERITAHUAN: Rekayasa lalu lintas Simpang Wonokromo sedang berlangsung.",
      "⚡ SISTEM OVERRIDE: Prioritas Darurat otomatis aktif untuk rute RSU Dr. Soetomo.",
      "📹 CAMERA ONLINE: Integrasi 184 CCTV SITS Kota Surabaya siap inferensi AI.",
      "🌿 ESG IMPACT: Efisiensi waktu lampu merah mereduksi 1.420 kg emisi CO2 hari ini."
    ];

    this._setupStoreListeners();
  }

  _setupStoreListeners() {
    stateStore.subscribe('state:isChaosMode', ({ value }) => {
      if (value) {
        this.setAnnouncements([
          "🔥 SIAGA 1 (MODE KEOS): Terdeteksi lonjakan gridlock massal di seluruh arteri Kota Surabaya!",
          "⚠️ PROTOKOL DARURAT: Pembagian siklus sinyal dipaksa adaptif ke beban kritis.",
          "🚨 DISHUB & SATLANTAS: Unit patroli darurat diterjunkan ke koridor utama."
        ], "danger");
      } else {
        this.resetToDefault();
      }
    });

    stateStore.subscribe('traffic:green-wave', ({ active }) => {
      if (active) {
        this.setAnnouncements([
          "🚨 EMERGENCY GREEN WAVE AKTIF: Seluruh lampu koridor Jl. A. Yani → Raya Darmo dikunci HIJAU PERMANEN!",
          "🚑 RUTE DARURAT RSU DR. SOETOMO: Kendaraan umum diimbau memberikan prioritas jalur."
        ], "emergency");
      } else if (!stateStore.getState().isChaosMode) {
        this.resetToDefault();
      }
    });

    stateStore.subscribe('telemetry:update', (data) => {
      if (data && data.congestionIndex && !stateStore.getState().isChaosMode && !stateStore.getState().greenWaveActive) {
        if (data.congestionIndex > 75) {
          this.setAnnouncements([
            `⚠️ PERINGATAN KEMACETAN: Indeks kepadatan Kota Surabaya mencapai ${Math.round(data.congestionIndex)}%.`,
            "⚡ ATCS ADAPTIF: Durasi lampu hijau Simpang Wonokromo & Margorejo dioptimalkan otomatis.",
            "📹 184 CCTV SITS Surabaya beroperasi normal."
          ], "warning");
        }
      }
    });
  }

  /**
   * Inisialisasi referensi DOM marquee
   */
  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this.marqueeContainer = document.querySelector(".system-marquee");
    this.contentEl = document.querySelector(".system-marquee .marquee-content");
  }

  /**
   * Mengatur pesan pengumuman baru
   * @param {string[]} messages
   * @param {'normal' | 'warning' | 'emergency' | 'danger'} [priority='normal']
   */
  setAnnouncements(messages, priority = 'normal') {
    if (!this.contentEl) this.init();
    if (!this.contentEl) return;

    this.contentEl.innerHTML = messages
      .map(msg => `<span>${msg}</span>`)
      .join("");

    if (this.marqueeContainer) {
      this.marqueeContainer.dataset.priority = priority;
      if (priority === 'danger' || priority === 'emergency') {
        this.marqueeContainer.style.background = 'linear-gradient(90deg, rgba(239,68,68,0.35), rgba(185,28,28,0.25))';
      } else if (priority === 'warning') {
        this.marqueeContainer.style.background = 'linear-gradient(90deg, rgba(245,158,11,0.25), rgba(217,119,6,0.2))';
      } else {
        this.marqueeContainer.style.background = '';
      }
    }
  }

  resetToDefault() {
    this.setAnnouncements(this.defaultMessages, 'normal');
  }
}

export const uiMarquee = new UiMarquee();
