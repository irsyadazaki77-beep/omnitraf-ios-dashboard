import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundManager, soundManager } from '../../src/core/soundManager.js';
import { SettingsController } from '../../src/controllers/settingsController.js';
import { IntegrationController } from '../../src/controllers/integrationController.js';

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
    this.oscillators = [];
  }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() {
    const source = { connect() {}, start() { this.started = true; }, stop() { this.stopped = true; }, disconnect() {} };
    this.sources.push(source);
    return source;
  }
  createBiquadFilter() { return { frequency: { value: 0 }, connect() {} }; }
  createGain() {
    return { gain: { value: 0, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  createOscillator() {
    const oscillator = { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

function withWindow(value, callback) {
  const previous = globalThis.window;
  const restore = () => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  };
  globalThis.window = value;
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('sound preferences preserve mute-at-zero and select a real feedback waveform', () => {
  withWindow({ AudioContext: FakeAudioContext }, () => {
    const manager = new SoundManager();
    assert.equal(manager.setVolume(0), 0);
    manager.play('click');
    assert.equal(manager.audioCtx, null, 'zero volume stays silent without creating an audio context');
    assert.equal(manager.setFeedbackTone('cyber'), true);
    manager.setVolume(1);
    manager.play('click');
    assert.equal(manager.audioCtx.oscillators[0].type, 'sawtooth');
    assert.equal(manager.setFeedbackTone('unknown'), false);
    assert.equal(manager.feedbackTone, 'cyber');
  });
});

test('ambient soundscape uses one loop, updates gain, and stops cleanly', async () => {
  await withWindow({ AudioContext: FakeAudioContext }, async () => {
    const manager = new SoundManager();
    assert.equal(await manager.setAmbientEnabled(true), true);
    assert.equal(await manager.setAmbientEnabled(true), true);
    assert.equal(manager.audioCtx.sources.length, 1);
    manager.setAmbientVolume(0);
    assert.equal(manager.ambientGain.gain.value, 0);
    assert.equal(await manager.setAmbientEnabled(false), true);
    assert.equal(manager.ambientSource, null);
    assert.equal(manager.audioCtx.sources[0].stopped, true);
  });
});

test('voice alert service only announces newly changed priority incidents when opted in and unmuted', () => {
  const controller = new SettingsController();
  const spoken = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  const fakeWindow = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance.text); } }
  };
  withWindow(fakeWindow, () => {
    controller.preferences.voiceEnabled = true;
    controller._incidentSnapshot = controller._snapshotIncidents([{ id: 'I-1', status: 'ACTIVE', severity: 'HIGH' }]);
    controller._handleIncidentUpdate([{ id: 'I-1', status: 'ACTIVE', severity: 'HIGH' }]);
    assert.deepEqual(spoken, [], 'an unchanged incident does not produce speech');
    controller._handleIncidentUpdate([
      { id: 'I-1', status: 'ACTIVE', severity: 'HIGH' },
      { id: 'I-2', title: 'Collision', status: 'ACTIVE', severity: 'CRITICAL' }
    ]);
    assert.deepEqual(spoken, ['Alert prioritas simulasi: Collision']);
    controller._handleIncidentUpdate([
      { id: 'I-1', status: 'ACTIVE', severity: 'HIGH' },
      { id: 'I-2', title: 'Collision', status: 'ACTIVE', severity: 'CRITICAL' }
    ]);
    assert.equal(spoken.length, 1, 'replayed state does not announce twice');
  });
});

test('settings controls persist normalized values and keep voice opt-in explicit', () => {
  const previousVolume = soundManager.volume;
  const previousTone = soundManager.feedbackTone;
  const previousAmbientVolume = soundManager.ambientVolume;
  const elements = new Map();
  const createElement = (value = '') => ({
    value,
    checked: false,
    disabled: false,
    textContent: '',
    listeners: {},
    closest() { return null; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; }
  });
  elements.set('audioVolumeRange', createElement());
  elements.set('audioToneSelector', createElement());
  elements.set('ambientVolumeRange', createElement());
  elements.set('chkAmbientSoundscape', createElement());
  elements.set('chkVoiceAlerts', createElement());
  for (const id of ['audioVolumeOutput', 'ambientVolumeOutput', 'ambientSoundscapeStatus', 'voiceAlertStatus']) elements.set(id, createElement());
  const storage = new Map();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const controller = new SettingsController();
  const fakeWindow = {
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    AudioContext: FakeAudioContext,
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { cancel() {}, speak() {} },
    setTimeout
  };
  try {
    globalThis.window = fakeWindow;
    globalThis.document = { getElementById: (id) => elements.get(id) || null };
    controller.init();
    assert.equal(elements.get('chkVoiceAlerts').checked, false, 'voice alerts stay disabled by default');

    const volume = elements.get('audioVolumeRange');
    volume.value = '0';
    volume.listeners.input();
    assert.equal(soundManager.volume, 0, 'zero remains a valid mute volume');

    const tone = elements.get('audioToneSelector');
    tone.value = 'retro';
    tone.listeners.change();
    assert.equal(soundManager.feedbackTone, 'retro');

    const voice = elements.get('chkVoiceAlerts');
    voice.checked = true;
    voice.listeners.change();
    const saved = JSON.parse(storage.get('omnitraf.preferences.v1'));
    assert.equal(saved.volume, 0);
    assert.equal(saved.tone, 'retro');
    assert.equal(saved.voiceEnabled, true);
    assert.equal(saved.ambientEnabled, false);
  } finally {
    controller._unsubscribeIncidents?.();
    controller._unsubscribeMute?.();
    soundManager.setVolume(previousVolume);
    soundManager.setFeedbackTone(previousTone);
    soundManager.setAmbientVolume(previousAmbientVolume);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('API sandbox accepts only object JSON within the input bound', () => {
  const controller = new IntegrationController();
  controller.payload = { value: '{"sample":true}' };
  assert.deepEqual(controller._parsePayload(), { sample: true });
  controller.payload.value = '[';
  assert.throws(() => controller._parsePayload(), /JSON tidak valid/);
  controller.payload.value = '[]';
  assert.throws(() => controller._parsePayload(), /object JSON/);
  controller.payload.value = ' '.repeat(8193);
  assert.throws(() => controller._parsePayload(), /melebihi batas/);
});

test('API sandbox responses are local, simulation-labeled, and reject endpoints outside the allowlist', () => {
  const controller = new IntegrationController();
  const response = controller._buildDemoResponse('/sits/api/v1/incidents', {}, 'sandbox-1');
  assert.equal(response.status, 'simulated');
  assert.equal(response.meta.simulationOnly, true);
  assert.equal(response.meta.source, 'OmniTRAF local simulation state');
  assert.throws(() => controller._buildDemoResponse('https://example.com', {}, 'sandbox-2'), /allowlist/);
});


test('terminal ping reports the actual simulator response and authentication failure', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new IntegrationController();
  controller.terminalInput = { value: '/ping' };
  const lines = [];
  controller._appendTerminalLine = message => lines.push(message);
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await controller._runTerminalCommand('/ping');
    assert.ok(lines.some(line => line.includes('HTTP 200')));
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await controller._runTerminalCommand('/ping');
    assert.ok(lines.some(line => line.includes('Masuk untuk memeriksa')));
  } finally { globalThis.fetch = originalFetch; }
});
