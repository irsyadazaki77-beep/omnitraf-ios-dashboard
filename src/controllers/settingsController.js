import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';

const PREFERENCE_KEY = 'omnitraf.preferences.v1';
const DEFAULTS = Object.freeze({
  volume: 0.7,
  tone: 'click',
  ambientVolume: 0.3,
  ambientEnabled: false,
  voiceEnabled: false
});

function readPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      volume: Number.isFinite(Number(parsed.volume)) ? Math.min(1, Math.max(0, Number(parsed.volume))) : DEFAULTS.volume,
      tone: ['click', 'cyber', 'retro'].includes(parsed.tone) ? parsed.tone : DEFAULTS.tone,
      ambientVolume: Number.isFinite(Number(parsed.ambientVolume)) ? Math.min(1, Math.max(0, Number(parsed.ambientVolume))) : DEFAULTS.ambientVolume,
      ambientEnabled: parsed.ambientEnabled === true,
      voiceEnabled: parsed.voiceEnabled === true
    };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export class SettingsController {
  restorePreferences() {
    this.preferences = readPreferences();
    soundManager.setVolume(this.preferences.volume);
    soundManager.setFeedbackTone(this.preferences.tone);
    soundManager.setAmbientVolume(this.preferences.ambientVolume);
    soundManager.ambientEnabled = this.preferences.ambientEnabled;
    if (!this._unsubscribeIncidents) {
    this._incidentSnapshot = this._snapshotIncidents(stateStore.getState().incidents);
    this._unsubscribeIncidents = stateStore.subscribe('state:incidents', ({ value }) => this._handleIncidentUpdate(value));
    this._unsubscribeMute = soundManager.onMuteChange((muted) => { if (muted) this._cancelSpeech(); });
    }
  }
  constructor() {
    this._isInitialized = false;
    this.preferences = { ...DEFAULTS };
    this._incidentSnapshot = new Map();
    this._announcedIncidents = new Set();
    this._lastSpokenAt = 0;
    this._unsubscribeIncidents = null;
    this._unsubscribeMute = null;
  }

  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this.preferences = readPreferences();
    soundManager.setVolume(this.preferences.volume);
    soundManager.setFeedbackTone(this.preferences.tone);
    soundManager.setAmbientVolume(this.preferences.ambientVolume);

    const mute = document.getElementById('settingsMute');
    const theme = document.getElementById('settingsTheme');
    const previewTone = document.getElementById('previewAudioTone');
    const resetPreferences = document.getElementById('resetUiPreferences');
    if (mute) {
      const sync = () => { mute.textContent = soundManager.isMuted ? 'Aktifkan suara' : 'Matikan suara'; mute.setAttribute('aria-pressed', String(!soundManager.isMuted)); };
      mute.addEventListener('click', () => { soundManager.toggleMute(); sync(); });
      this._unsubscribeSettingsMute?.();
      this._unsubscribeSettingsMute = soundManager.onMuteChange(sync);
      sync();
    }
    if (theme) theme.addEventListener('click', () => document.getElementById('themeToggle')?.click());
    previewTone?.addEventListener('click', () => {
      if (soundManager.isMuted) {
        this._setStatus('audioPreferenceStatus', 'Aktifkan suara interaksi sebelum mendengar pratinjau.');
        return;
      }
      soundManager.play('click');
      this._setStatus('audioPreferenceStatus', `Pratinjau nada ${toneLabel(this.preferences.tone)}.`);
    });
    resetPreferences?.addEventListener('click', () => this.resetPreferences());
    const volume = document.getElementById('audioVolumeRange');
    const tone = document.getElementById('audioToneSelector');
    const ambientVolume = document.getElementById('ambientVolumeRange');
    const ambientEnabled = document.getElementById('chkAmbientSoundscape');
    const voiceEnabled = document.getElementById('chkVoiceAlerts');

    if (volume) {
      volume.value = String(Math.round(this.preferences.volume * 100));
      volume.addEventListener('input', () => {
        this.preferences.volume = soundManager.setVolume(Number(volume.value) / 100);
        this._persist();
        this._updateOutput('audioVolumeOutput', `${volume.value}%`);
      });
      this._updateOutput('audioVolumeOutput', `${volume.value}%`);
    }
    if (tone) {
      tone.value = this.preferences.tone;
      tone.addEventListener('change', () => {
        if (!soundManager.setFeedbackTone(tone.value)) return;
        this.preferences.tone = tone.value;
        this._persist();
        soundManager.play('click');
      });
    }
    if (ambientVolume) {
      ambientVolume.value = String(Math.round(this.preferences.ambientVolume * 100));
      ambientVolume.addEventListener('input', () => {
        this.preferences.ambientVolume = soundManager.setAmbientVolume(Number(ambientVolume.value) / 100);
        this._persist();
        this._updateOutput('ambientVolumeOutput', `${ambientVolume.value}%`);
      });
      this._updateOutput('ambientVolumeOutput', `${ambientVolume.value}%`);
    }
    if (ambientEnabled) {
      const syncAmbientLabel = () => {
        const label = ambientEnabled.closest('label')?.querySelector('.settings-chk-text');
        if (label) label.textContent = ambientEnabled.checked ? 'Aktif' : 'Nonaktif';
      };
      ambientEnabled.checked = this.preferences.ambientEnabled;
      syncAmbientLabel();
      soundManager.ambientEnabled = this.preferences.ambientEnabled;
      if (this.preferences.ambientEnabled) {
        soundManager.setAmbientEnabled(true).then((started) => {
          if (!started) this._setStatus('ambientSoundscapeStatus', 'Ambience menunggu interaksi audio browser.');
          else this._setStatus('ambientSoundscapeStatus', 'Ambience simulasi aktif.');
        });
      }
      ambientEnabled.addEventListener('change', async () => {
        const enabled = ambientEnabled.checked;
        const started = await soundManager.setAmbientEnabled(enabled);
        if (enabled && !started) {
          ambientEnabled.checked = false;
          this.preferences.ambientEnabled = false;
          this._persist();
          syncAmbientLabel();
          this._setStatus('ambientSoundscapeStatus', 'Audio ambience tidak tersedia pada browser ini.');
          return;
        }
        this.preferences.ambientEnabled = enabled;
        this._persist();
        syncAmbientLabel();
        this._setStatus('ambientSoundscapeStatus', enabled ? 'Ambience simulasi aktif.' : 'Ambience simulasi berhenti.');
      });
    }

    const speechAvailable = typeof window.speechSynthesis !== 'undefined' &&
      typeof window.SpeechSynthesisUtterance === 'function';
    if (voiceEnabled) {
      voiceEnabled.disabled = !speechAvailable;
      voiceEnabled.checked = speechAvailable && this.preferences.voiceEnabled;
      voiceEnabled.addEventListener('change', () => {
        const label = voiceEnabled.closest('label')?.querySelector('.settings-chk-text');
        if (label) label.textContent = voiceEnabled.checked ? 'Aktif' : 'Nonaktif';
        this.preferences.voiceEnabled = speechAvailable && voiceEnabled.checked;
        this._persist();
        if (!this.preferences.voiceEnabled) this._cancelSpeech();
        this._setStatus('voiceAlertStatus', !speechAvailable
          ? 'Sintesis suara tidak didukung browser ini.'
          : this.preferences.voiceEnabled ? 'Alert prioritas dibacakan; telemetry rutin tidak dibacakan.' : 'Pembacaan alert nonaktif.');
      });
      this._setStatus('voiceAlertStatus', !speechAvailable
        ? 'Sintesis suara tidak didukung browser ini.'
          : this.preferences.voiceEnabled ? 'Alert prioritas dibacakan; telemetry rutin tidak dibacakan.' : 'Pembacaan alert nonaktif.');
      const label = voiceEnabled.closest('label')?.querySelector('.settings-chk-text');
      if (label) label.textContent = voiceEnabled.checked ? 'Aktif' : 'Nonaktif';
    }


  }

  _snapshotIncidents(incidents) {
    const snapshot = new Map();
    const rows = Array.isArray(incidents) ? incidents : Object.values(incidents || {});
    for (const incident of rows) {
      if (!incident || !incident.id) continue;
      snapshot.set(String(incident.id), this._incidentFingerprint(incident));
    }
    return snapshot;
  }

  _incidentFingerprint(incident) {
    return `${String(incident.status || '').toUpperCase()}|${String(incident.severity || incident.priority || '').toUpperCase()}`;
  }

  _handleIncidentUpdate(incidents) {
    const next = this._snapshotIncidents(incidents);
    const rows = Array.isArray(incidents) ? incidents : Object.values(incidents || {});
    const candidates = rows.filter((incident) => {
      if (!incident?.id) return false;
      const id = String(incident.id);
      const previous = this._incidentSnapshot.get(id);
      const fingerprint = this._incidentFingerprint(incident);
      if (previous === fingerprint) return false;
      const isPriority = /CRITICAL|HIGH|P1|URGENT/.test(fingerprint);
      const isActive = /ACTIVE|DETECTED|ACKNOWLEDGED/.test(fingerprint);
      return isPriority && isActive && !this._announcedIncidents.has(id);
    });
    this._incidentSnapshot = next;
    if (candidates.length) this._speakPriorityIncident(candidates[0]);
  }

  _speakPriorityIncident(incident) {
    if (!this.preferences.voiceEnabled || soundManager.isMuted || typeof window.speechSynthesis === 'undefined') return;
    const id = String(incident.id);
    const now = Date.now();
    if (now - this._lastSpokenAt < 12000) return;
    const title = String(incident.title || incident.type || 'insiden simulasi').slice(0, 120);
    const utterance = new window.SpeechSynthesisUtterance(`Alert prioritas simulasi: ${title}`);
    utterance.rate = 1;
    utterance.volume = Math.min(1, soundManager.volume);
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      this._lastSpokenAt = now;
      this._announcedIncidents.add(id);
      if (this._announcedIncidents.size > 200) this._announcedIncidents.delete(this._announcedIncidents.values().next().value);
    } catch (_) {
      this._setStatus('voiceAlertStatus', 'Browser menolak pemutaran suara. Aktifkan dari interaksi pengguna.');
    }
  }

  _cancelSpeech() {
    try { window.speechSynthesis?.cancel?.(); } catch (_) {}
  }

  _persist() {
    try { window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(this.preferences)); } catch (_) {}
  }

  async resetPreferences() {
    this.preferences = { ...DEFAULTS };
    soundManager.setMuted(false);
    soundManager.setVolume(DEFAULTS.volume);
    soundManager.setFeedbackTone(DEFAULTS.tone);
    soundManager.setAmbientVolume(DEFAULTS.ambientVolume);
    await soundManager.setAmbientEnabled(false);
    this._persist();
    if (typeof window.speechSynthesis !== 'undefined') this._cancelSpeech();

    const volume = document.getElementById('audioVolumeRange');
    const tone = document.getElementById('audioToneSelector');
    const ambientVolume = document.getElementById('ambientVolumeRange');
    const ambient = document.getElementById('chkAmbientSoundscape');
    const voice = document.getElementById('chkVoiceAlerts');
    if (volume) volume.value = String(DEFAULTS.volume * 100);
    if (tone) tone.value = DEFAULTS.tone;
    if (ambientVolume) ambientVolume.value = String(DEFAULTS.ambientVolume * 100);
    if (ambient) ambient.checked = false;
    if (voice) voice.checked = false;
    for (const [id, value] of [['audioVolumeOutput', '70%'], ['ambientVolumeOutput', '30%']]) this._updateOutput(id, value);
    const ambientLabel = ambient?.closest('label')?.querySelector('.settings-chk-text');
    if (ambientLabel) ambientLabel.textContent = 'Nonaktif';
    const voiceLabel = voice?.closest('label')?.querySelector('.settings-chk-text');
    if (voiceLabel) voiceLabel.textContent = 'Nonaktif';
    this._setStatus('audioPreferenceStatus', 'Preferensi audio dan aksesibilitas dikembalikan ke nilai awal.');
    this._setStatus('ambientSoundscapeStatus', 'Ambience simulasi berhenti.');
    this._setStatus('voiceAlertStatus', 'Pembacaan alert nonaktif.');

    try {
      localStorage.setItem('omnitraf.audio.enabled', 'true');
    } catch (_) {}
    document.dispatchEvent(new Event('omnitraf:reset-ui-preferences'));
    window.showToast?.('Preferensi antarmuka dikembalikan ke nilai awal.', 'success');
  }

  _setStatus(id, message) {
    const status = document.getElementById(id);
    if (status) status.textContent = message;
  }

  _updateOutput(id, value) {
    const output = document.getElementById(id);
    if (output) output.textContent = value;
  }
}

function toneLabel(tone) {
  return ({ click: 'klik mekanis', cyber: 'digital', retro: 'retro' })[tone] || 'klik mekanis';
}

export const settingsController = new SettingsController();
