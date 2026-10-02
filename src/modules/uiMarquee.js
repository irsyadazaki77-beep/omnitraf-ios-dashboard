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
      "MODE PROTOTIPE: Rekayasa lalu lintas Simpang Wonokromo sedang disimulasikan.",
      "MODE PROTOTIPE: Prioritas darurat pada rute RSU Dr. Soetomo adalah skenario simulasi.",
      "KAMERA SIMULASI: Visual dan deteksi kendaraan dibuat oleh OmniTRAF, bukan feed CCTV SITS.",
      "ESTIMASI MODEL: Angka emisi dan bahan bakar adalah keluaran simulasi, bukan pengukuran kota."
    ];

    this._setupStoreListeners();
  }

  _setupStoreListeners() {
    stateStore.subscribe('state:isChaosMode', ({ value }) => {
      if (value) {
        this.setAnnouncements([
          "SIMULASI KEOS: Skenario lonjakan kemacetan aktif pada model jaringan jalan.",
          "SIMULASI DARURAT: Siklus sinyal model menyesuaikan beban skenario.",
          "DEMO: Tidak ada unit Dishub atau Satlantas yang benar-benar diterjunkan."
        ], "danger");
      } else {
        this.resetToDefault();
      }
    });

    stateStore.subscribe('traffic:green-wave', ({ active }) => {
      if (active) {
        this.setAnnouncements([
          "SIMULASI GREEN WAVE: Model koridor Jl. A. Yani → Raya Darmo dikunci hijau.",
          "SIMULASI RUTE DARURAT: Prioritas ambulans hanya berlaku di model OmniTRAF."
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
            "OPTIMASI MODEL: Durasi hijau simpang berubah berdasarkan telemetri simulasi.",
            "MODE PROTOTIPE: Status kamera tidak merepresentasikan perangkat SITS."
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

    const fragment = document.createDocumentFragment();
    (Array.isArray(messages) ? messages : []).forEach(message => {
      const item = document.createElement('span');
      item.textContent = message == null ? '' : String(message);
      fragment.appendChild(item);
    });
    this.contentEl.replaceChildren(fragment);

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
