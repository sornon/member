import { resolveTimestamp } from './pending-attributes';

const FALLBACK_STATE = {
  acknowledged: {},
  latest: {},
  initialized: false
};

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
  return globalState;
}

function writeState(state) {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    FALLBACK_STATE.acknowledged = { ...state.acknowledged };
    FALLBACK_STATE.latest = { ...state.latest };
    FALLBACK_STATE.initialized = !!state.initialized;
    return;
  }
  app.globalData.storageBadge = state;
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

function buildItemKey(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const category = normalizeString(item.storageCategory) || 'storage';
  const candidateFields = [
    item.badgeId,
    item.inventoryId,
    item.inventoryKey,
    item.storageKey,
    item.storageId,
    item.id,
    item._id,
    item.itemId,
    item.slot
  ];
  for (let i = 0; i < candidateFields.length; i += 1) {
    const value = normalizeString(candidateFields[i]);
    if (value) {
      return `${category}:${value}`;
    }
  }
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
    category.items.forEach((item) => {
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

export function extractNewStorageItemsFromMember(member) {
  if (!member || typeof member !== 'object') {
    return [];
  }
  const profile = member.pveProfile && typeof member.pveProfile === 'object' ? member.pveProfile : null;
  if (!profile) {
    return [];
  }
  return extractNewStorageItemsFromProfile(profile);
}

function ensureLatestState(state, items) {
  const acknowledged = state.acknowledged || {};
  const previousLatest = state.latest || {};
  const nextLatest = {};
  const seenKeys = new Set();
  let mutated = false;

  items.forEach((entry) => {
    if (!entry || !entry.key) {
      return;
    }
    seenKeys.add(entry.key);
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

  state.latest = nextLatest;
  if (!state.initialized) {
    state.initialized = true;
    mutated = true;
  }

  if (mutated) {
    writeState(state);
  }
}

function hasUnacknowledgedItems(items, state) {
  if (!items.length) {
    return false;
  }
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const initialized = !!state.initialized;

  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    if (!entry || !entry.key) {
      continue;
    }
    const ackTime = Number(acknowledged[entry.key]) || 0;
    const latestTime = Number(latest[entry.key]) || 0;
    const obtainedAt = Number(entry.obtainedAt) || 0;
    const effectiveLatest = Math.max(latestTime, obtainedAt);
    if (!initialized) {
      if (entry.isNew && !ackTime) {
        return true;
      }
      continue;
    }
    if (!ackTime || (effectiveLatest && ackTime < effectiveLatest)) {
      return true;
    }
  }
  return false;
}

export function shouldShowStorageBadge(member) {
  const state = ensureState();
  let items = [];
  if (member) {
    items = extractNewStorageItemsFromMember(member);
    if (items.length) {
      ensureLatestState(state, items);
    } else if (state.initialized && Object.keys(state.latest || {}).length) {
      // ensure we prune stale entries when nothing reported
      ensureLatestState(state, items);
    }
  } else {
    const latest = state.latest || {};
    items = Object.keys(latest).map((key) => ({ key, obtainedAt: Number(latest[key]) || 0 }));
  }
  return hasUnacknowledgedItems(items, state);
}

function itemHasExplicitNewFlag(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }
  return isTruthy(item.isNew) || isTruthy(item.new) || isTruthy(item.hasNewBadge) || isTruthy(item.hasNew);
}

export function shouldDisplayStorageItemNew(item) {
  if (!item) {
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

  if (!initialized) {
    return itemHasExplicitNewFlag(item) && !ackTime;
  }
  if (!ackTime) {
    return true;
  }
  if (obtainedAt && ackTime < obtainedAt) {
    return true;
  }
  return false;
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

  list.forEach((item) => {
    if (!item) {
      return;
    }
    const key = buildItemKey(item);
    if (!key) {
      return;
    }
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
  });

  if (mutated) {
    writeState(state);
  }
}

export function syncStorageBadgeStateFromProfile(profile) {
  const state = ensureState();
  const items = extractNewStorageItemsFromProfile(profile);
  ensureLatestState(state, items);
}

export function normalizeStorageItemIdForBadge(item) {
  return buildItemKey(item);
}
