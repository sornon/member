import { resolveTimestamp } from './pending-attributes';

const BADGE_STORAGE_KEY = 'globalBadgeState';
const FALLBACK_STATE = {
  latest: {},
  acknowledged: {},
  _hydrated: false
};

function snapshotState(state) {
  const latest = state && state.latest && typeof state.latest === 'object' ? { ...state.latest } : {};
  const acknowledged =
    state && state.acknowledged && typeof state.acknowledged === 'object' ? { ...state.acknowledged } : {};
  return { latest, acknowledged };
}

function readPersistedState() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return null;
  }
  try {
    const stored = wx.getStorageSync(BADGE_STORAGE_KEY);
    if (!stored || typeof stored !== 'object') {
      return null;
    }
    const snapshot = snapshotState(stored);
    return snapshot;
  } catch (error) {
    console.warn('[badge-center] read persisted badge state failed', error);
    return null;
  }
}

function persistState(state) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    const snapshot = snapshotState(state);
    wx.setStorageSync(BADGE_STORAGE_KEY, snapshot);
  } catch (error) {
    console.warn('[badge-center] persist badge state failed', error);
  }
}

function getAppInstance() {
  if (typeof getApp !== 'function') {
    return null;
  }
  try {
    return getApp();
  } catch (error) {
    console.warn('[badge-center] getApp failed', error);
    return null;
  }
}

function ensureState() {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    if (!FALLBACK_STATE._hydrated) {
      const persisted = readPersistedState();
      if (persisted) {
        FALLBACK_STATE.latest = persisted.latest;
        FALLBACK_STATE.acknowledged = persisted.acknowledged;
      }
      FALLBACK_STATE._hydrated = true;
    }
    return FALLBACK_STATE;
  }
  if (!app.globalData.badgeCenter) {
    app.globalData.badgeCenter = {
      latest: {},
      acknowledged: {},
      _hydrated: false
    };
  }
  const state = app.globalData.badgeCenter;
  if (!state._hydrated) {
    const persisted = readPersistedState();
    if (persisted) {
      Object.assign(state.latest, persisted.latest);
      Object.assign(state.acknowledged, persisted.acknowledged);
    }
    state._hydrated = true;
  }
  if (!state.latest || typeof state.latest !== 'object') {
    state.latest = {};
  }
  if (!state.acknowledged || typeof state.acknowledged !== 'object') {
    state.acknowledged = {};
  }
  return state;
}

function normalizeKey(key) {
  if (typeof key === 'string') {
    const trimmed = key.trim();
    return trimmed;
  }
  if (typeof key === 'number' && Number.isFinite(key)) {
    return String(key);
  }
  return '';
}

function normalizeSignature(value, { prefix = 'badge' } = {}) {
  if (value === null || typeof value === 'undefined') {
    return `${prefix}:none`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || `${prefix}:none`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return `${prefix}:none`;
    }
    return `${prefix}:${value}`;
  }
  if (typeof value === 'boolean') {
    return `${prefix}:${value ? '1' : '0'}`;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (item === null || typeof item === 'undefined') {
          return '';
        }
        if (typeof item === 'string') {
          return item.trim();
        }
        if (typeof item === 'number' && Number.isFinite(item)) {
          return String(item);
        }
        return '';
      })
      .filter(Boolean)
      .sort();
    return `${prefix}:${parts.length ? parts.join('|') : 'none'}`;
  }
  try {
    const json = JSON.stringify(value);
    return json ? `${prefix}:${json}` : `${prefix}:none`;
  } catch (error) {
    console.warn('[badge-center] normalize signature failed', error);
    return `${prefix}:none`;
  }
}

function writeState(state) {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    FALLBACK_STATE.latest = { ...state.latest };
    FALLBACK_STATE.acknowledged = { ...state.acknowledged };
    FALLBACK_STATE._hydrated = true;
    persistState(FALLBACK_STATE);
    return;
  }
  app.globalData.badgeCenter = state;
  persistState(state);
}

export function updateBadgeSignature(key, signature, options = {}) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return `${options.prefix || 'badge'}:none`;
  }
  const state = ensureState();
  const latest = state.latest;
  const acknowledged = state.acknowledged;
  const normalizedSignature = normalizeSignature(signature, { prefix: options.prefix || normalizedKey });
  const previous = typeof latest[normalizedKey] === 'string' ? latest[normalizedKey] : '';
  let mutated = false;
  if (previous !== normalizedSignature) {
    latest[normalizedKey] = normalizedSignature;
    mutated = true;
  }
  if (options.initializeAck && typeof acknowledged[normalizedKey] === 'undefined') {
    acknowledged[normalizedKey] = normalizedSignature;
    mutated = true;
  } else if (options.resetAck) {
    if (acknowledged[normalizedKey] !== normalizedSignature) {
      acknowledged[normalizedKey] = normalizedSignature;
      mutated = true;
    }
  }
  if (mutated) {
    writeState(state);
  }
  return normalizedSignature;
}

export function updateBadgeEntries(key, entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const normalized = [];
  list.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const entryKey = normalizeKey(entry.key);
    if (!entryKey) {
      return;
    }
    const timestamp = resolveTimestamp(entry.timestamp || entry.obtainedAt || entry.updatedAt || 0) || 0;
    normalized.push({ key: entryKey, timestamp });
  });
  if (!normalized.length) {
    return updateBadgeSignature(key, `${options.prefix || normalizeKey(key) || 'entries'}:none`, options);
  }
  normalized.sort((a, b) => {
    if (a.key === b.key) {
      return (a.timestamp || 0) - (b.timestamp || 0);
    }
    return a.key < b.key ? -1 : 1;
  });
  const latestTimestamp = normalized.reduce((max, entry) => Math.max(max, entry.timestamp || 0), 0);
  const payload = normalized.map((entry) => `${entry.key}:${entry.timestamp || 0}`).join('|');
  const signature = `${options.prefix || normalizeKey(key) || 'entries'}:${normalized.length}:${latestTimestamp}:${payload}`;
  updateBadgeSignature(key, signature, options);
  return signature;
}

export function shouldShowBadge(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return false;
  }
  const state = ensureState();
  const latest = typeof state.latest[normalizedKey] === 'string' ? state.latest[normalizedKey] : '';
  const acknowledged = typeof state.acknowledged[normalizedKey] === 'string' ? state.acknowledged[normalizedKey] : '';
  if (!latest) {
    return false;
  }
  return latest !== acknowledged;
}

export function acknowledgeBadge(keys) {
  const state = ensureState();
  const list = Array.isArray(keys) ? keys : [keys];
  let mutated = false;
  list.forEach((key) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      return;
    }
    const latest = typeof state.latest[normalizedKey] === 'string' ? state.latest[normalizedKey] : '';
    if (typeof state.acknowledged[normalizedKey] === 'string') {
      if (state.acknowledged[normalizedKey] !== latest) {
        state.acknowledged[normalizedKey] = latest;
        mutated = true;
      }
    } else {
      state.acknowledged[normalizedKey] = latest;
      mutated = true;
    }
  });
  if (mutated) {
    writeState(state);
  }
}

export function buildIdListSignature(list = [], prefix = 'ids') {
  const normalized = Array.isArray(list)
    ? list
        .map((value) => {
          if (value === null || typeof value === 'undefined') {
            return '';
          }
          const str = String(value).trim();
          return str;
        })
        .filter(Boolean)
    : [];
  normalized.sort();
  const unique = [];
  let previous = '';
  normalized.forEach((value) => {
    if (value !== previous) {
      unique.push(value);
      previous = value;
    }
  });
  return `${prefix}:${unique.length ? unique.join('|') : 'none'}`;
}

export function buildBooleanSignature(value, prefix = 'flag') {
  return `${prefix}:${value ? '1' : '0'}`;
}

export function buildNumericSignature(value, prefix = 'value') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `${prefix}:0`;
  }
  return `${prefix}:${numeric}`;
}

export function combineSignatures(signatures = [], prefix = 'combined') {
  const valid = Array.isArray(signatures)
    ? signatures.filter((value) => typeof value === 'string' && value.trim())
    : [];
  if (!valid.length) {
    return `${prefix}:none`;
  }
  const sorted = [...new Set(valid)].sort();
  return `${prefix}:${sorted.join('||')}`;
}

export function getBadgeSignature(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return '';
  }
  const state = ensureState();
  return typeof state.latest[normalizedKey] === 'string' ? state.latest[normalizedKey] : '';
}

export function touchBadge(key, options = {}) {
  const timestamp = Date.now();
  return updateBadgeSignature(key, `${options.prefix || normalizeKey(key) || 'touch'}:${timestamp}`, options);
}
