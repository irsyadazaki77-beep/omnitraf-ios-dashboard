export class ScenarioRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const normalized = validateScenario(definition);
    if (this.definitions.has(normalized.id)) throw new TypeError(`duplicate scenario '${normalized.id}'`);
    this.definitions.set(normalized.id, normalized);
    return normalized;
  }

  get(id) { return this.definitions.get(id) || null; }
  list() { return Array.from(this.definitions.values()); }
}

export function validateScenario(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError('scenario definition must be an object');
  const { id, name, seed, startTime, durationMs, events = [], initialState } = definition;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new TypeError('scenario id is invalid');
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('scenario name is required');
  if (!(typeof seed === 'string' || Number.isSafeInteger(seed))) throw new TypeError('scenario seed must be a string or safe integer');
  if (!Number.isFinite(startTime) || startTime < 0) throw new TypeError('scenario startTime must be finite and non-negative');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new TypeError('scenario durationMs must be finite and positive');
  if (!Array.isArray(events)) throw new TypeError('scenario events must be an array');
  const normalizedEvents = events.map((event, index) => {
    if (!event || typeof event !== 'object' || !Number.isFinite(event.at) || event.at < 0 || event.at > durationMs) throw new TypeError(`scenario event ${index} has an invalid time`);
    if (typeof event.type !== 'string' || !event.type.trim()) throw new TypeError(`scenario event ${index} has an invalid type`);
    return { at: event.at, type: event.type, payload: copyPayload(event.payload ?? null), sourceOrder: index };
  }).sort((a, b) => a.at - b.at || a.sourceOrder - b.sourceOrder);
  const normalized = { id, name: name.trim(), seed, startTime, durationMs, events: normalizedEvents.map(({ sourceOrder, ...event }) => Object.freeze(event)) };
  if (initialState !== undefined) normalized.initialState = copyPayload(initialState);
  return Object.freeze(normalized);
}

function copyPayload(payload) {
  if (containsNonFinite(payload)) throw new TypeError('scenario event payload cannot contain NaN or Infinity');
  let copied;
  try { copied = payload === null ? null : JSON.parse(JSON.stringify(payload)); }
  catch { throw new TypeError('scenario event payload must be JSON serializable'); }
  return copied;
}

function containsNonFinite(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNonFinite);
  if (value && typeof value === 'object') return Object.values(value).some(containsNonFinite);
  return false;
}
