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
    this.feedbackTone = 'click';
    this.ambientVolume = 0.3;
    this.ambientEnabled = false;
    this.ambientSource = null;
    this.ambientGain = null;
    this.ambientFilter = null;
    this.muteListeners = new Set();
    this._isInitialized = false;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    try {
      this.isMuted = window.localStorage.getItem('omnitraf.audio.enabled') === 'false';
    } catch (_) {}

    // Unlock AudioContext on first user interaction to comply with browser autoplay policy
    const unlock = () => {
      this._ensureContext();
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      if (this.ambientEnabled) this._startAmbient();
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    const muteBtn = document.getElementById("audioToggle") || 
                    document.getElementById("btnToggleAudio") || 
                    document.getElementById("soundToggle");
    if (muteBtn) {
      this.muteButton = muteBtn;
      this._syncMuteButton();

      muteBtn.addEventListener("click", () => {
        const isUnmuted = this.toggleMute();
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
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()?.catch?.(() => {});
      }
      return this.audioCtx;
    } catch (_) {
      return null;
    }
  }

  toggleMute() {
    return !this.setMuted(!this.isMuted);
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    this._syncMuteButton();
    this._syncAmbientGain();
    if (this.isMuted) {
      for (const listener of this.muteListeners) {
        try { listener(true); } catch (_) {}
      }
    }
    try { window.localStorage.setItem('omnitraf.audio.enabled', String(!this.isMuted)); } catch (_) {}
    return this.isMuted;
  }

  onMuteChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.muteListeners.add(listener);
    return () => this.muteListeners.delete(listener);
  }

  _syncMuteButton() {
    const muteBtn = this.muteButton;
    if (!muteBtn) return;
    const enabled = !this.isMuted;
    muteBtn.classList.toggle('muted', !enabled);
    const icon = muteBtn.querySelector('.audio-icon, .squircle-btn-icon');
    if (icon) icon.textContent = enabled ? '🔊' : '🔇';
    muteBtn.setAttribute('aria-pressed', String(!enabled));
    muteBtn.setAttribute('aria-label', enabled ? 'Nonaktifkan suara' : 'Aktifkan suara');
    muteBtn.setAttribute('title', enabled ? 'Audio Aktif (Klik untuk Mute)' : 'Audio Nonaktif (Klik untuk Unmute)');
  }

  setVolume(vol) {
    const value = Number(vol);
    if (!Number.isFinite(value)) return this.volume;
    this.volume = Math.max(0, Math.min(1, value));
    return this.volume;
  }

  setFeedbackTone(tone) {
    if (!['click', 'cyber', 'retro'].includes(tone)) return false;
    this.feedbackTone = tone;
    return true;
  }

  async setAmbientEnabled(enabled) {
    this.ambientEnabled = Boolean(enabled);
    if (!this.ambientEnabled) {
      this._stopAmbient();
      return true;
    }
    const context = this._ensureContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended') await context.resume();
      return this._startAmbient();
    } catch (_) {
      return false;
    }
  }

  setAmbientVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) return this.ambientVolume;
    this.ambientVolume = Math.max(0, Math.min(1, volume));
    this._syncAmbientGain();
    return this.ambientVolume;
  }

  _startAmbient() {
    if (!this.ambientEnabled || this.ambientSource) return Boolean(this.ambientSource);
    const context = this._ensureContext();
    if (!context?.createBuffer || !context.createBufferSource) return false;
    try {
      const sampleRate = context.sampleRate || 44100;
      const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * 0.035;

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      this.ambientSource = source;
      this.ambientGain = gain;
      this.ambientFilter = filter;
      this._syncAmbientGain();
      source.start();
      return true;
    } catch (_) {
      this._stopAmbient();
      return false;
    }
  }

  _stopAmbient() {
    const source = this.ambientSource;
    const filter = this.ambientFilter;
    const gain = this.ambientGain;
    this.ambientSource = null;
    this.ambientGain = null;
    this.ambientFilter = null;
    if (!source) return;
    try { source.stop(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
    try { filter?.disconnect(); } catch (_) {}
    try { gain?.disconnect(); } catch (_) {}
  }

  _syncAmbientGain() {
    if (!this.ambientGain || !this.audioCtx) return;
    const value = this.isMuted ? 0 : 0.12 * this.ambientVolume;
    try { this.ambientGain.gain.setTargetAtTime(value, this.audioCtx.currentTime, 0.04); }
    catch (_) { this.ambientGain.gain.value = value; }
  }

  play(type = 'click') {
    if (this.isMuted || this.volume === 0) return;
    const soundType = type === 'click' ? this.feedbackTone : type;

    try {
      const ctx = this._ensureContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (soundType === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (soundType === 'cyber') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.06);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.14);
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (soundType === 'retro') {
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
    if (this.isMuted || this.volume === 0) return;
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
