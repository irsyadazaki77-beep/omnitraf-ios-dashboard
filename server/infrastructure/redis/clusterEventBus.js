import { randomUUID } from 'node:crypto';

export const CLUSTER_CHANNELS = Object.freeze({
  snapshot: 'omnitraf:events:snapshot',
  cctv: 'omnitraf:events:cctv',
  traffic: 'omnitraf:events:traffic',
  incident: 'omnitraf:events:incident',
  signal: 'omnitraf:events:signal',
  emergency: 'omnitraf:events:emergency',
  device: 'omnitraf:events:device',
  command: 'omnitraf:events:command',
  commandRequest: 'omnitraf:commands:request'
});

export class ClusterEventBus {
  constructor(redisManager, instanceId, { maxRecent = 2000, ttlMs = 60_000, now = Date.now } = {}) {
    this.redis = redisManager;
    this.instanceId = instanceId;
    this.maxRecent = maxRecent;
    this.ttlMs = ttlMs;
    this.now = now;
    this.recent = new Map();
    this.eventsPublished = 0;
    this.eventsReceived = 0;
    this.duplicateEventsDropped = 0;
  }

  async publish(channel, type, sequence, payload) {
    const envelope = this.createEnvelope(type, sequence, payload);
    await this.publishEnvelope(channel, envelope);
    return envelope;
  }

  createEnvelope(type, sequence, payload) {
    return { eventId: randomUUID(), type, sourceInstanceId: this.instanceId, timestamp: new Date(this.now()).toISOString(), sequence, payload };
  }

  async publishEnvelope(channel, envelope) {
    await this.redis.publish(channel, envelope);
    this.eventsPublished++;
    this._remember(envelope.eventId);
    return true;
  }

  async subscribe(channel, listener) {
    return this.redis.subscribe(channel, (message) => {
      let envelope;
      try { envelope = JSON.parse(message); } catch (_) { return; }
      if (!envelope?.eventId || envelope.sourceInstanceId === this.instanceId) return;
      this._prune();
      if (this.recent.has(envelope.eventId)) { this.duplicateEventsDropped++; return; }
      this._remember(envelope.eventId);
      this.eventsReceived++;
      listener(envelope);
    });
  }

  _remember(eventId) {
    this._prune();
    this.recent.delete(eventId);
    this.recent.set(eventId, this.now() + this.ttlMs);
    while (this.recent.size > this.maxRecent) this.recent.delete(this.recent.keys().next().value);
  }
  _prune() {
    const now = this.now();
    for (const [eventId, expiresAt] of this.recent) {
      if (expiresAt <= now) this.recent.delete(eventId);
      else break;
    }
  }
  getMetrics() { return { eventsPublished: this.eventsPublished, eventsReceived: this.eventsReceived, duplicateEventsDropped: this.duplicateEventsDropped }; }
}
