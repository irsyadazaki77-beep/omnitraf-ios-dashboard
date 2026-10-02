/**
 * OmniTRAF Surabaya - Seeded PRNG & Multi-Stream Deterministic Random Generator (Phase 19)
 * 
 * Implements Mulberry32 / SplitMix32 32-bit PRNG algorithms.
 * Given identical seed, produces the exact same sequence of pseudo-random numbers.
 * Supports isolated domain streams (traffic, cctv, devices, chaos, prediction)
 * so non-deterministic mutations in one domain do not perturb others.
 */

export class SeededRandom {
  /**
   * @param {number|string} [initialSeed=1337]
   */
  constructor(initialSeed = 1337) {
    validateSeed(initialSeed);
    this.initialSeed = this._hashSeed(initialSeed);
    this.state = this.initialSeed;
    this.callCount = 0;
  }

  _hashSeed(seed) {
    if (typeof seed === 'number' && !isNaN(seed)) {
      return seed >>> 0;
    }
    const str = String(seed || 'omnitraf-seed');
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    return hash >>> 0;
  }

  /**
   * Mulberry32 algorithm: fast, uniform distribution, 32-bit state.
   * Returns a float in [0, 1).
   */
  nextFloat() {
    this.callCount++;
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  next() {
    return this.nextFloat();
  }

  nextInt(min, max) {
    return this.rangeInt(min, max);
  }

  /**
   * Returns float in [min, max).
   */
  range(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new TypeError('random range bounds must be finite and ordered');
    return min + this.nextFloat() * (max - min);
  }

  /**
   * Returns integer in [min, max] inclusive.
   */
  rangeInt(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max === Number.MAX_SAFE_INTEGER) throw new TypeError('integer random range bounds must be safe integers and ordered');
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Returns true with given probability [0..1].
   */
  chance(prob) {
    if (!Number.isFinite(prob) || prob < 0 || prob > 1) throw new TypeError('probability must be in the range 0..1');
    return this.nextFloat() < prob;
  }

  /**
   * Pick random item from an array.
   */
  pick(array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    const idx = Math.floor(this.nextFloat() * array.length);
    return array[idx];
  }

  /**
   * Reset seed state to origin or a new seed.
   */
  reset(newSeed = null) {
    if (newSeed !== null) {
      validateSeed(newSeed);
      this.initialSeed = this._hashSeed(newSeed);
    }
    this.state = this.initialSeed;
    this.callCount = 0;
  }

  /**
   * Capture PRNG state.
   */
  getSnapshot() {
    return {
      initialSeed: this.initialSeed,
      state: this.state,
      callCount: this.callCount
    };
  }

  /**
   * Restore PRNG state.
   */
  restoreSnapshot(snapshot) {
    if (!snapshot || !Number.isInteger(snapshot.initialSeed) || snapshot.initialSeed < 0 || snapshot.initialSeed > 0xffffffff || !Number.isInteger(snapshot.state) || snapshot.state < 0 || snapshot.state > 0xffffffff || !Number.isSafeInteger(snapshot.callCount) || snapshot.callCount < 0) {
      throw new TypeError('invalid seeded random snapshot');
    }
    this.initialSeed = snapshot.initialSeed;
    this.state = snapshot.state;
    this.callCount = snapshot.callCount || 0;
  }
}

/**
 * Domain Random Stream Manager
 * Separates PRNG streams for distinct domains (traffic, cctv, devices, chaos, prediction)
 */
export class DeterministicRandomRegistry {
  constructor(masterSeed = 42) {
    validateSeed(masterSeed);
    this.masterSeed = masterSeed;
    this.streams = new Map();
  }

  getStream(domain = 'default') {
    if (!this.streams.has(domain)) {
      // Derive a deterministic child seed by mixing masterSeed and domain name
      const childSeed = this._deriveSeed(this.masterSeed, domain);
      this.streams.set(domain, new SeededRandom(childSeed));
    }
    return this.streams.get(domain);
  }

  _deriveSeed(master, domain) {
    const str = `${master}:${domain}`;
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  resetAll(masterSeed = null) {
    if (masterSeed !== null) {
      validateSeed(masterSeed);
      this.masterSeed = masterSeed;
      this.streams.clear();
    } else {
      for (const [domain, stream] of this.streams.entries()) {
        const childSeed = this._deriveSeed(this.masterSeed, domain);
        stream.reset(childSeed);
      }
    }
  }

  getSnapshot() {
    const streamsData = {};
    for (const [domain, stream] of this.streams.entries()) {
      streamsData[domain] = stream.getSnapshot();
    }
    return {
      masterSeed: this.masterSeed,
      streams: streamsData
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || !isSeed(snapshot.masterSeed) || !snapshot.streams || typeof snapshot.streams !== 'object' || Array.isArray(snapshot.streams)) {
      throw new TypeError('invalid random registry snapshot');
    }
    for (const streamData of Object.values(snapshot.streams)) {
      if (!streamData || !Number.isInteger(streamData.initialSeed) || !Number.isInteger(streamData.state) || !Number.isSafeInteger(streamData.callCount) || streamData.callCount < 0) {
        throw new TypeError('invalid random stream snapshot');
      }
    }
    this.masterSeed = snapshot.masterSeed;
    this.streams.clear();
    for (const [domain, streamData] of Object.entries(snapshot.streams)) {
      if (!domain) throw new TypeError('random stream name is required');
      const stream = this.getStream(domain);
      stream.restoreSnapshot(streamData);
    }
  }
}

export const defaultRandomRegistry = new DeterministicRandomRegistry(42);

function isSeed(seed) {
  return (typeof seed === 'string' && seed.length > 0) || (Number.isSafeInteger(seed) && seed >= 0);
}

function validateSeed(seed) {
  if (!isSeed(seed)) throw new TypeError('seed must be a non-negative safe integer or non-empty string');
}
