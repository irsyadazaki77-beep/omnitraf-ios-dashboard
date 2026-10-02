/** Deterministic once-only scheduler driven by simulation timestamps. */
export class SimulationScheduler {
  constructor() {
    this.sequence = 0;
    this.queue = [];
  }

  schedule(at, type, payload = null) {
    if (!Number.isFinite(at) || at < 0) throw new TypeError('event timestamp must be finite and non-negative');
    if (typeof type !== 'string' || !type.trim()) throw new TypeError('event type is required');
    let safePayload;
    if (!isFiniteJson(payload)) throw new TypeError('event payload cannot contain non-finite numbers');
    try { safePayload = payload === null ? null : JSON.parse(JSON.stringify(payload)); }
    catch { throw new TypeError('event payload must be JSON serializable'); }
    const event = Object.freeze({ at, type, payload: safePayload, sequence: ++this.sequence });
    this.queue.push(event);
    this.queue.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
    return event;
  }

  drainThrough(now) {
    if (!Number.isFinite(now)) throw new TypeError('scheduler time must be finite');
    let count = 0;
    while (count < this.queue.length && this.queue[count].at <= now) count++;
    return this.queue.splice(0, count);
  }

  clear() { this.sequence = 0; this.queue.length = 0; }
  get size() { return this.queue.length; }
  getSnapshot() { return { sequence: this.sequence, queue: this.queue.map(event => ({ ...event })) }; }
  restoreSnapshot(snapshot) {
    if (!snapshot || !Number.isInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.queue)) throw new TypeError('invalid scheduler snapshot');
    const priorSequence = this.sequence;
    this.clear();
    try {
      const sequences = new Set();
      for (const event of snapshot.queue) {
        if (!Number.isInteger(event.sequence) || event.sequence <= 0 || event.sequence > snapshot.sequence || sequences.has(event.sequence)) throw new TypeError('invalid scheduled event sequence');
        sequences.add(event.sequence);
        if (!Number.isFinite(event.at) || event.at < 0 || typeof event.type !== 'string' || !event.type.trim()) throw new TypeError('invalid scheduled event');
        let payload;
        try { payload = event.payload === null ? null : JSON.parse(JSON.stringify(event.payload)); }
        catch { throw new TypeError('invalid scheduled event payload'); }
        if (!isFiniteJson(payload)) throw new TypeError('invalid scheduled event payload');
        this.queue.push(Object.freeze({ at: event.at, type: event.type, payload, sequence: event.sequence }));
      }
      this.queue.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
      this.sequence = snapshot.sequence;
    } catch (error) {
      this.clear();
      this.sequence = priorSequence;
      throw error;
    }
  }
}

function isFiniteJson(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteJson);
  if (value && typeof value === 'object') return Object.values(value).every(isFiniteJson);
  return true;
}
