/**
 * OmniTRAF Surabaya - Sound & Audio Synthesizer
 * Menggunakan Web Audio API untuk sintesis suara umpan balik interaksi,
 * notifikasi radio operasional, dan simulasi sirine darurat Kota Surabaya.
 */

export class SoundManager {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.volume = 0.5;
  }

  init() {
    // Unlock AudioContext on first user interaction to comply with browser autoplay policy
    const unlock = () => {
      this._ensureContext();
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    const muteBtn = document.getElementById("audioToggle") || 
                    document.getElementById("btnToggleAudio") || 
                    document.getElementById("soundToggle");
    if (muteBtn) {
      const updateVisual = (unmuted) => {
        muteBtn.classList.toggle("muted", !unmuted);
        const icon = muteBtn.querySelector(".audio-icon, .squircle-btn-icon");
        if (icon) {
          icon.textContent = unmuted ? "🔊" : "🔇";
        }
        muteBtn.setAttribute("aria-label", unmuted ? "Nonaktifkan suara" : "Aktifkan suara");
        muteBtn.setAttribute("title", unmuted ? "Audio Aktif (Klik untuk Mute)" : "Audio Nonaktif (Klik untuk Unmute)");
      };

      updateVisual(!this.isMuted);

      muteBtn.addEventListener("click", () => {
        const isUnmuted = this.toggleMute();
        updateVisual(isUnmuted);
        if (isUnmuted) {
          this.play('click');
        }
        if (typeof window.showToast === "function") {
          window.showToast(`Audio Sistem: ${isUnmuted ? 'Aktif' : 'Nonaktif'}`);
        }
      });
    }
  }

  _ensureContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return !this.isMuted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0.5));
  }

  play(type = 'click') {
    if (this.isMuted) return;

    try {
      const ctx = this._ensureContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === 'cyber') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.06);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.14);
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'retro') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(880, now + 0.05);
        gain.gain.setValueAtTime(0.06 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.12 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.28);
      } else if (type === 'alert') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.2);
        gain.gain.setValueAtTime(0.1 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'dispatch') {
        // Radio beep chirp / squelch tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.setValueAtTime(1800, now + 0.05);
        osc.frequency.setValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.09 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'siren') {
        // European / Indo Ambulance Hi-Lo siren burst
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.linearRampToValueAtTime(950, now + 0.2);
        osc.frequency.linearRampToValueAtTime(700, now + 0.4);
        gain.gain.setValueAtTime(0.12 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.45);
      }
    } catch {
      // Audio context might be restricted by browser policy before user interaction
    }
  }

  playSiren(durationSec = 2) {
    if (this.isMuted) return;
    try {
      const ctx = this._ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      
      const cycles = Math.max(1, Math.floor(durationSec / 0.4));
      for (let i = 0; i < cycles; i++) {
        const t0 = now + i * 0.4;
        osc.frequency.setValueAtTime(650, t0);
        osc.frequency.linearRampToValueAtTime(920, t0 + 0.2);
        osc.frequency.linearRampToValueAtTime(650, t0 + 0.4);
      }
      gain.gain.setValueAtTime(0.12 * this.volume, now);
      gain.gain.setValueAtTime(0.12 * this.volume, now + durationSec - 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
      osc.start(now);
      osc.stop(now + durationSec);
    } catch {
      // Ignore audio error
    }
  }
}

export const soundManager = new SoundManager();
