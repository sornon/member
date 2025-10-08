import { resolveTimestamp } from './pending-attributes';

const fallbackState = { acknowledged: {}, latest: {} };

function getAppInstance() {
  if (typeof getApp !== 'function') {
    return null;
  }
  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function ensureState() {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    return fallbackState;
  }
  const globalState = app.globalData.storageBadge;
  if (!globalState || typeof globalState !== 'object') {
    app.globalData.storageBadge = { acknowledged: {}, latest: {} };
    return app.globalData.storageBadge;
  }
  if (!globalState.acknowledged || typeof globalState.acknowledged !== 'object') {
    globalState.acknowledged = {};
  }
  if (!globalState.latest || typeof globalState.latest !== 'object') {
    globalState.latest = {};
  }
  return globalState;
}

function writeState(state) {
  const app = getAppInstance();
  if (!app || !app.globalData) {
    fallbackState.acknowledged = { ...state.acknowledged };
    fallbackState.latest = { ...state.latest };
    return;
  }
  app.globalData.storageBadge = state;
}

function normalizeStorageInventoryId(source) {
  if (!source) {
    return '';
  }
  if (typeof source === 'string') {
    return source.trim();
  }
  const candidates = [
    source.inventoryId,
    source.storageKey,
    source.id,
    source._id
  ];
  const category =
    typeof source.storageCategory === 'string' && source.storageCategory
      ? source.storageCategory
      : 'storage';
  if (source.itemId) {
    candidates.push(`${category}:${source.itemId}`);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function collectNewStorageItems(storageCategories = []) {
  const seen = new Map();
  storageCategories.forEach((category) => {
    if (!category || !Array.isArray(category.items)) {
      return;
    }
    category.items.forEach((item) => {
      if (!item || !item.isNew) {
        return;
      }
      const id = normalizeStorageInventoryId(item);
      if (!id) {
        return;
      }
      const obtainedAt = resolveTimestamp(
        item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || 0
      );
      const existing = seen.get(id);
      if (!existing || obtainedAt > existing.obtainedAt) {
        seen.set(id, { id, obtainedAt });
      }
    });
  });
  return Array.from(seen.values());
}

export function extractNewStorageItemsFromProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return [];
  }
  const equipment = profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : {};
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  const categories = Array.isArray(storage.categories) ? storage.categories : [];
  return collectNewStorageItems(categories);
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

function setLatestItems(state, items) {
  const latest = {};
  items.forEach((item) => {
    if (!item || !item.id) {
      return;
    }
    const normalizedTime = resolveTimestamp(item.obtainedAt || 0);
    const previous = latest[item.id];
    if (previous === undefined || normalizedTime > previous) {
      latest[item.id] = normalizedTime;
    }
  });
  const prevLatest = state.latest || {};
  const prevKeys = Object.keys(prevLatest);
  const nextKeys = Object.keys(latest);
  let changed = prevKeys.length !== nextKeys.length;
  if (!changed) {
    for (let i = 0; i < nextKeys.length; i += 1) {
      const key = nextKeys[i];
      if (prevLatest[key] !== latest[key]) {
        changed = true;
        break;
      }
    }
  }
  state.latest = latest;
  let pruned = false;
  const acknowledged = state.acknowledged || {};
  Object.keys(acknowledged).forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(latest, id)) {
      delete acknowledged[id];
      pruned = true;
    }
  });
  if (changed || pruned) {
    writeState(state);
  }
}

function hasUnseenItem(items, acknowledged) {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || !item.id) {
      continue;
    }
    const obtainedAt = resolveTimestamp(item.obtainedAt || 0);
    const ack = acknowledged[item.id] || 0;
    if (!ack) {
      return true;
    }
    if (obtainedAt && ack < obtainedAt) {
      return true;
    }
  }
  return false;
}

export function shouldShowStorageBadge(member) {
  const state = ensureState();
  let items;
  if (member) {
    items = extractNewStorageItemsFromMember(member);
    setLatestItems(state, items);
  } else {
    const latest = state.latest || {};
    items = Object.keys(latest).map((id) => ({ id, obtainedAt: latest[id] }));
  }
  if (!items.length) {
    return false;
  }
  const acknowledged = state.acknowledged || {};
  return hasUnseenItem(items, acknowledged);
}

export function shouldDisplayStorageItemNew(item) {
  if (!item || !item.isNew) {
    return false;
  }
  const state = ensureState();
  const id = normalizeStorageInventoryId(item);
  if (!id) {
    return true;
  }
  const obtainedAt = resolveTimestamp(item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || 0);
  const ack = state.acknowledged[id] || 0;
  if (!ack) {
    return true;
  }
  if (obtainedAt) {
    return ack < obtainedAt;
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
  let changed = false;
  list.forEach((item) => {
    if (!item) {
      return;
    }
    const id = normalizeStorageInventoryId(item);
    if (!id) {
      return;
    }
    const obtainedAt = resolveTimestamp(
      item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || 0
    );
    const ackTime = obtainedAt || Date.now();
    const current = acknowledged[id] || 0;
    if (!current || ackTime >= current) {
      acknowledged[id] = ackTime;
      changed = true;
    }
  });
  if (changed) {
    writeState(state);
  }
}

export function syncStorageBadgeStateFromProfile(profile) {
  const state = ensureState();
  const items = extractNewStorageItemsFromProfile(profile);
  setLatestItems(state, items);
}

export function normalizeStorageItemIdForBadge(item) {
  return normalizeStorageInventoryId(item);
}
