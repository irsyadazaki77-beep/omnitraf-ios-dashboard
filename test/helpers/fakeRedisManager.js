export class FakeRedisState {
  constructor() { this.values = new Map(); this.subscribers = new Map(); }
}

export class FakeRedisManager {
  constructor(sharedState, name = 'fake-instance') {
    this.shared = sharedState;
    this.name = name;
    this.connected = true;
  }
  isConnected() { return this.connected; }
  getHealth() { return { status: this.connected ? 'CONNECTED' : 'UNAVAILABLE', configured: true, lastError: null }; }
  _purge(key) {
    const entry = this.shared.values.get(key);
    if (entry?.expiresAt && entry.expiresAt <= Date.now()) this.shared.values.delete(key);
  }
  async set(key, value, ...options) {
    this._purge(key);
    if (options.includes('NX') && this.shared.values.has(key)) return null;
    const px = options.indexOf('PX');
    const ex = options.indexOf('EX');
    const ttl = px >= 0 ? Number(options[px + 1]) : ex >= 0 ? Number(options[ex + 1]) * 1000 : 0;
    this.shared.values.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl : null });
    return 'OK';
  }
  async get(key) { this._purge(key); return this.shared.values.get(key)?.value ?? null; }
  async eval(script, keys = [], args = []) {
    const key = keys[0]; this._purge(key);
    const entry = this.shared.values.get(key);
    if (script.includes("'INCR'")) {
      const count = Number(entry?.value || 0) + 1;
      this.shared.values.set(key, { value: String(count), expiresAt: entry?.expiresAt || Date.now() + Number(args[0]) });
      return [count, Math.max(0, (entry?.expiresAt || Date.now() + Number(args[0])) - Date.now())];
    }
    if (script.includes("'PEXPIRE'")) {
      if (entry?.value !== args[0]) return 0;
      entry.expiresAt = Date.now() + Number(args[1]); return 1;
    }
    if (script.includes("'DEL'")) {
      if (entry?.value !== args[0]) return 0;
      this.shared.values.delete(key); return 1;
    }
    if (script.includes("'EX'")) {
      if (entry?.value !== args[0]) return 0;
      this.shared.values.set(key, { value: args[1], expiresAt: Date.now() + Number(args[2]) * 1000 });
      return 'OK';
    }
    throw new Error(`Unsupported fake Redis script: ${script}`);
  }
  async publish(channel, payload) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const subscriber of this.shared.subscribers.get(channel) || []) queueMicrotask(() => subscriber(message));
    return 1;
  }
  async subscribe(channel, listener) {
    if (!this.shared.subscribers.has(channel)) this.shared.subscribers.set(channel, new Set());
    this.shared.subscribers.get(channel).add(listener);
    return () => this.shared.subscribers.get(channel)?.delete(listener);
  }
  async incrementWindow(key, windowMs) { return this.eval("redis.call('INCR')", [key], [String(windowMs)]); }
}
