import { resolveTimestamp } from './pending-attributes';

const STORAGE_BADGE_STORAGE_KEY = 'storageBadgeState';
const STORAGE_BADGE_DEBUG_KEY = 'storageBadgeDebug';
const DEBUG_CACHE_TTL = 1000;

let debugOverride = null;
let cachedDebugValue = false;
let cachedDebugReadAt = 0;

function parseDebugFlag(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return false;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'off') {
      return false;
    }
    return true;
  }
  return false;
}

function readDebugFlagFromStorage() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return false;
  }
  try {
    const stored = wx.getStorageSync(STORAGE_BADGE_DEBUG_KEY);
    return parseDebugFlag(stored);
  } catch (error) {
    console.warn('[storage-notifications] read debug flag failed', error);
    return false;
  }
}

function isDebugEnabled() {
  if (debugOverride !== null) {
    return debugOverride;
  }
  const now = Date.now();
  if (!cachedDebugReadAt || now - cachedDebugReadAt > DEBUG_CACHE_TTL) {
    cachedDebugValue = readDebugFlagFromStorage();
    cachedDebugReadAt = now;
  }
  return cachedDebugValue;
}

function debugLog(...args) {
  if (!isDebugEnabled()) {
    return;
  }
  try {
    console.info('[storage-notifications]', ...args);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log('[storage-notifications]', ...args);
  }
}

function summarizeItemForDebug(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const fields = [
    'storageCategory',
    'storageSerial',
    'storageBadgeKey',
    'storageKey',
    'inventoryId',
    'inventoryKey',
    'storageId',
    'itemId',
    'id',
    '_id',
    'slot',
    'slotLabel',
    'obtainedAt',
    'obtainTime',
    'obtainTimestamp',
    'obtainDate',
    'obtainDateTime',
    'timestamp',
    'new',
    'isNew',
    'hasNew',
    'hasNewBadge'
  ];
  const summary = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      summary[field] = item[field];
    }
  });
  return summary;
}

function summarizeStateSnapshot(state, keys = null) {
  const snapshot = snapshotState(state);
  const listKeys = Array.isArray(keys) ? keys : null;
  if (!listKeys || !listKeys.length) {
    return {
      debugEnabled: isDebugEnabled(),
      initialized: snapshot.initialized,
      acknowledgedCount: Object.keys(snapshot.acknowledged || {}).length,
      latestCount: Object.keys(snapshot.latest || {}).length
    };
  }
  const acknowledged = {};
  const latest = {};
  listKeys.forEach((key) => {
    if (typeof key !== 'string' || !key) {
      return;
    }
    acknowledged[key] = Number(snapshot.acknowledged[key]) || 0;
    latest[key] = Number(snapshot.latest[key]) || 0;
  });
  return {
    debugEnabled: isDebugEnabled(),
    initialized: snapshot.initialized,
    acknowledged,
    latest
  };
}

const FALLBACK_STATE = {
  acknowledged: {},
  latest: {},
  initialized: false
};

function snapshotState(state) {
  const acknowledged =
    state && state.acknowledged && typeof state.acknowledged === 'object'
      ? { ...state.acknowledged }
      : {};
  const latest =
    state && state.latest && typeof state.latest === 'object' ? { ...state.latest } : {};
  const initialized = !!(state && state.initialized);
  return { acknowledged, latest, initialized };
}

function readPersistedState() {
  if (typeof wx === 'undefined' || !wx) {
    return null;
  }
  if (typeof wx.getStorageSync !== 'function') {
    return null;
  }
  try {
    const stored = wx.getStorageSync(STORAGE_BADGE_STORAGE_KEY);
    if (!stored || typeof stored !== 'object') {
      return null;
    }
    const snapshot = snapshotState(stored);
    return snapshot;
  } catch (error) {
    console.warn('[storage-notifications] read persisted badge state failed', error);
    return null;
  }
}

function persistState(state) {
  if (typeof wx === 'undefined' || !wx) {
    return;
  }
  if (typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    const snapshot = snapshotState(state);
    wx.setStorageSync(STORAGE_BADGE_STORAGE_KEY, snapshot);
  } catch (error) {
    console.warn('[storage-notifications] persist badge state failed', error);
  }
}

export function setStorageNotificationDebug(enabled) {
  const desired = !!enabled;
  debugOverride = desired;
  cachedDebugValue = desired;
  cachedDebugReadAt = Date.now();
  if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') {
    try {
      wx.setStorageSync(STORAGE_BADGE_DEBUG_KEY, desired ? 1 : 0);
    } catch (error) {
      console.warn('[storage-notifications] persist debug flag failed', error);
    }
  }
  debugLog('debug flag updated', { enabled: desired });
  return desired;
}

export function refreshStorageNotificationDebugFlag() {
  debugOverride = null;
  cachedDebugReadAt = 0;
  const enabled = isDebugEnabled();
  debugLog('debug flag refreshed', { enabled });
  return enabled;
}

export function getStorageNotificationDebugInfo(options = {}) {
  const state = ensureState();
  const keys = Array.isArray(options.keys) ? options.keys : null;
  return summarizeStateSnapshot(state, keys);
}

function getAppInstance() {
  if (typeof getApp !== 'function') {
    return null;
  }
  try {
    return getApp();
  } catch (error) {
    console.warn('[storage-notifications] getApp failed', error);
    return null;
  }
}

function ensureState() {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    if (!FALLBACK_STATE._hydratedFromStorage) {
      const persisted = readPersistedState();
      if (persisted) {
        FALLBACK_STATE.acknowledged = persisted.acknowledged;
        FALLBACK_STATE.latest = persisted.latest;
        FALLBACK_STATE.initialized = persisted.initialized;
      }
      Object.defineProperty(FALLBACK_STATE, '_hydratedFromStorage', {
        value: true,
        writable: true,
        enumerable: false
      });
    }
    return FALLBACK_STATE;
  }
  const globalState = app.globalData.storageBadge;
  if (!globalState || typeof globalState !== 'object') {
    app.globalData.storageBadge = {
      acknowledged: {},
      latest: {},
      initialized: false
    };
    return app.globalData.storageBadge;
  }
  if (!globalState.acknowledged || typeof globalState.acknowledged !== 'object') {
    globalState.acknowledged = {};
  }
  if (!globalState.latest || typeof globalState.latest !== 'object') {
    globalState.latest = {};
  }
  if (typeof globalState.initialized !== 'boolean') {
    globalState.initialized = false;
  }
  if (!globalState._hydratedFromStorage) {
    const persisted = readPersistedState();
    if (persisted) {
      if (!globalState.acknowledged) {
        globalState.acknowledged = {};
      }
      if (!globalState.latest) {
        globalState.latest = {};
      }
      Object.assign(globalState.acknowledged, persisted.acknowledged);
      Object.assign(globalState.latest, persisted.latest);
      if (persisted.initialized) {
        globalState.initialized = true;
      }
    }
    Object.defineProperty(globalState, '_hydratedFromStorage', {
      value: true,
      writable: true,
      enumerable: false
    });
  }
  return globalState;
}

function writeState(state) {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    const snapshot = snapshotState(state);
    FALLBACK_STATE.acknowledged = snapshot.acknowledged;
    FALLBACK_STATE.latest = snapshot.latest;
    FALLBACK_STATE.initialized = snapshot.initialized;
    persistState(snapshot);
    return;
  }
  app.globalData.storageBadge = state;
  persistState(state);
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? String(time) : '';
  }
  return '';
}

function isEquipmentCategoryKey(value) {
  return normalizeString(value) === 'equipment';
}

function isEquipmentItem(item, categoryKey = '') {
  if (!item || typeof item !== 'object') {
    return false;
  }
  if (isEquipmentCategoryKey(categoryKey)) {
    return true;
  }
  if (isEquipmentCategoryKey(item.storageCategory)) {
    return true;
  }
  const kind = normalizeString(item.kind);
  if (kind === 'equipment') {
    return true;
  }
  return false;
}

function isTruthy(value) {
  if (!value) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value !== 0 : false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '' && value !== '0' && value.toLowerCase() !== 'false';
  }
  return false;
}

function collectItemKeyAliases(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }
  const category = normalizeString(item.storageCategory) || 'storage';
  const candidateFields = [
    item.storageSerial,
    item.serialId,
    item.serial,
    item.sequenceId,
    item.entryId,
    item.badgeId,
    item.storageBadgeKey,
    item.storageKey,
    item.inventoryId,
    item.inventoryKey,
    item.storageId,
    item.itemId,
    item.id,
    item._id,
    item.badgeKey,
    item.slot
  ];
  const aliases = [];
  const seen = new Set();

  candidateFields.forEach((field) => {
    const value = normalizeString(field);
    if (!value) {
      return;
    }
    const primary = `${category}:${value}`;
    if (!seen.has(primary)) {
      aliases.push(primary);
      seen.add(primary);
    }
    if (value.includes(':')) {
      const parts = value.split(':');
      const explicitCategory = normalizeString(parts[0]);
      const explicitId = normalizeString(parts.slice(1).join(':'));
      if (explicitCategory && explicitId) {
        const compact = `${explicitCategory}:${explicitId}`;
        if (!seen.has(compact)) {
          aliases.push(compact);
          seen.add(compact);
        }
        const nested = `${category}:${explicitCategory}:${explicitId}`;
        if (!seen.has(nested)) {
          aliases.push(nested);
          seen.add(nested);
        }
      }
    }
  });

  return aliases;
}

function buildItemKey(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const aliases = collectItemKeyAliases(item);
  if (aliases.length) {
    debugLog('buildItemKey', {
      primary: aliases[0],
      aliases,
      item: summarizeItemForDebug(item)
    });
    return aliases[0];
  }
  debugLog('buildItemKey: missing aliases', {
    item: summarizeItemForDebug(item)
  });
  return '';
}

function extractItemTimestamp(item) {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  const timestamp = resolveTimestamp(
    item.obtainedAt ||
      item.obtainTime ||
      item.obtainedAtText ||
      item.updatedAt ||
      item.createdAt ||
      item.timestamp ||
      0
  );
  return timestamp || 0;
}

function collectStorageItemsFromCategories(categories) {
  if (!Array.isArray(categories)) {
    return [];
  }
  const items = [];
  categories.forEach((category) => {
    if (!category || !Array.isArray(category.items)) {
      return;
    }
    const categoryKey = normalizeString(category.key);
    if (isEquipmentCategoryKey(categoryKey)) {
      return;
    }
    category.items.forEach((item) => {
      if (isEquipmentItem(item, categoryKey)) {
        return;
      }
      const key = buildItemKey(item);
      if (!key) {
        return;
      }
      items.push({
        key,
        obtainedAt: extractItemTimestamp(item),
        isNew: isTruthy(item && (item.isNew || item.new || item.hasNewBadge || item.hasNew)),
        item
      });
    });
  });
  debugLog('collectStorageItemsFromCategories', {
    count: items.length,
    keys: items.map((entry) => entry.key)
  });
  return items;
}

export function extractNewStorageItemsFromProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return [];
  }
  const equipment = profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : {};
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  const categories = Array.isArray(storage.categories) ? storage.categories : [];
  return collectStorageItemsFromCategories(categories);
}

function ensureLatestState(state, items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const acknowledged = state.acknowledged || {};
  const previousLatest = state.latest || {};
  const nextLatest = {};
  const seenKeys = new Set();
  const touched = [];
  const { pruneMissing = false, initialize = list.length > 0 } = options;
  let mutated = false;

  if (!list.length) {
    if (initialize && !state.initialized) {
      state.initialized = true;
      mutated = true;
    }
    state.latest = previousLatest;
    if (mutated) {
      writeState(state);
    }
    return;
  }

  list.forEach((entry) => {
    if (!entry || !entry.key) {
      return;
    }
    if (entry.item && migrateBadgeStateForItem(entry, state)) {
      mutated = true;
    }
    seenKeys.add(entry.key);
    touched.push(entry.key);
    const previous = Number(previousLatest[entry.key]) || 0;
    const obtainedAt = Number(entry.obtainedAt) || 0;
    const candidate = obtainedAt || previous;
    if (candidate) {
      nextLatest[entry.key] = candidate;
      if (candidate !== previous) {
        mutated = true;
      }
    } else if (previous) {
      nextLatest[entry.key] = previous;
    }
    if (!state.initialized && !entry.isNew) {
      const ackValue = Number(acknowledged[entry.key]) || 0;
      const baseline = candidate || Date.now();
      if (!ackValue || ackValue < baseline) {
        acknowledged[entry.key] = baseline;
        mutated = true;
      }
    }
  });

  if (pruneMissing) {
    Object.keys(previousLatest).forEach((key) => {
      if (!seenKeys.has(key)) {
        mutated = true;
      }
    });
    Object.keys(acknowledged).forEach((key) => {
      if (!seenKeys.has(key)) {
        delete acknowledged[key];
        mutated = true;
      }
    });
  }

  state.latest = nextLatest;
  if (initialize && !state.initialized) {
    state.initialized = true;
    mutated = true;
  }

  if (isDebugEnabled()) {
    const summary = touched.map((key) => ({
      key,
      previousLatest: Number(previousLatest[key]) || 0,
      nextLatest: Number(nextLatest[key]) || 0,
      acknowledged: Number(acknowledged[key]) || 0
    }));
    debugLog('ensureLatestState', {
      initialize,
      pruneMissing,
      mutated,
      summary
    });
  }

  if (mutated) {
    writeState(state);
  }
}

function migrateBadgeStateForItem(entry, state) {
  if (!entry || !entry.item || !entry.key) {
    return false;
  }
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const aliases = collectItemKeyAliases(entry.item);
  let mutated = false;

  aliases.forEach((alias) => {
    if (!alias || alias === entry.key) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(acknowledged, alias)) {
      const ackValue = Number(acknowledged[alias]) || 0;
      if (ackValue) {
        const current = Number(acknowledged[entry.key]) || 0;
        if (!current || current < ackValue) {
          acknowledged[entry.key] = ackValue;
        }
      }
      delete acknowledged[alias];
      mutated = true;
    }
    if (Object.prototype.hasOwnProperty.call(latest, alias)) {
      const latestValue = Number(latest[alias]) || 0;
      if (latestValue) {
        const currentLatest = Number(latest[entry.key]) || 0;
        if (!currentLatest || currentLatest < latestValue) {
          latest[entry.key] = latestValue;
        }
      }
      delete latest[alias];
      mutated = true;
    }
  });

  return mutated;
}

function itemHasExplicitNewFlag(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }
  if (isEquipmentItem(item)) {
    return false;
  }
  return isTruthy(item.isNew) || isTruthy(item.new) || isTruthy(item.hasNewBadge) || isTruthy(item.hasNew);
}

export function shouldDisplayStorageItemNew(item) {
  if (!item) {
    return false;
  }
  if (isEquipmentItem(item)) {
    return false;
  }
  const state = ensureState();
  const key = buildItemKey(item);
  if (!key) {
    return itemHasExplicitNewFlag(item);
  }
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const initialized = !!state.initialized;
  const ackTime = Number(acknowledged[key]) || 0;
  const latestTime = Number(latest[key]) || 0;
  const obtainedAt = Math.max(extractItemTimestamp(item), latestTime);
  let result;
  if (!initialized) {
    result = itemHasExplicitNewFlag(item) && !ackTime;
  } else if (!ackTime) {
    result = true;
  } else if (obtainedAt && ackTime < obtainedAt) {
    result = true;
  } else {
    result = false;
  }

  debugLog('shouldDisplayStorageItemNew', {
    key,
    initialized,
    ackTime,
    latestTime,
    obtainedAt,
    explicitNew: itemHasExplicitNewFlag(item),
    result,
    aliases: collectItemKeyAliases(item),
    item: summarizeItemForDebug(item)
  });

  return result;
}

export function acknowledgeStorageItems(items) {
  const list = Array.isArray(items) ? items : [items];
  if (!list.length) {
    return;
  }
  const state = ensureState();
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  let mutated = false;
  const acknowledgedEntries = [];

  list.forEach((item) => {
    if (!item) {
      return;
    }
    if (isEquipmentItem(item)) {
      debugLog('acknowledgeStorageItems: skip equipment item', {
        item: summarizeItemForDebug(item)
      });
      return;
    }
    const key = buildItemKey(item);
    if (!key) {
      debugLog('acknowledgeStorageItems: missing key', {
        item: summarizeItemForDebug(item)
      });
      return;
    }
    const ackTime = Number(acknowledged[key]) || 0;
    const obtainedAt = extractItemTimestamp(item);
    const latestTime = Number(latest[key]) || 0;
    const newAck = Math.max(obtainedAt, latestTime, Date.now());
    if (!acknowledged[key] || acknowledged[key] < newAck) {
      acknowledged[key] = newAck;
      mutated = true;
    }
    if (!latest[key] || latest[key] < obtainedAt) {
      latest[key] = obtainedAt || latestTime || newAck;
      mutated = true;
    }
    acknowledgedEntries.push({
      key,
      previousAck: ackTime,
      newAck,
      latestTime,
      obtainedAt,
      aliases: collectItemKeyAliases(item)
    });
  });

  if (mutated) {
    writeState(state);
  }

  if (acknowledgedEntries.length) {
    debugLog('acknowledgeStorageItems', {
      entries: acknowledgedEntries,
      state: summarizeStateSnapshot(state, acknowledgedEntries.map((entry) => entry.key))
    });
  }
}

export function syncStorageBadgeStateFromProfile(profile) {
  const state = ensureState();
  const items = extractNewStorageItemsFromProfile(profile);
  ensureLatestState(state, items, { pruneMissing: true, initialize: true });
}

export function normalizeStorageItemIdForBadge(item) {
  return buildItemKey(item);
}
