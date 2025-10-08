import { resolveTimestamp } from './pending-attributes';

const fallbackState = { acknowledged: {}, latest: {}, initialized: false };

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
    app.globalData.storageBadge = { acknowledged: {}, latest: {}, initialized: false };
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
    fallbackState.acknowledged = { ...state.acknowledged };
    fallbackState.latest = { ...state.latest };
    fallbackState.initialized = !!state.initialized;
    return;
  }
  app.globalData.storageBadge = state;
}

function coerceIdentifierCandidate(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || '';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) {
      return '';
    }
    return String(Math.trunc(value));
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? String(time) : '';
  }
  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const str = value.toString();
      if (typeof str === 'string') {
        const trimmed = str.trim();
        if (trimmed && trimmed !== '[object Object]') {
          return trimmed;
        }
      }
    }
  }
  return '';
}

function pushUnique(list, value) {
  if (!value) {
    return;
  }
  if (!list.includes(value)) {
    list.push(value);
  }
}

function buildLegacyHints(source, category) {
  const hints = {};
  if (category) {
    hints.category = category;
  }
  const inventoryId = coerceIdentifierCandidate(source && source.inventoryId);
  if (inventoryId) {
    hints.inventoryId = inventoryId;
  }
  const itemId = coerceIdentifierCandidate(source && source.itemId);
  if (itemId) {
    hints.itemId = itemId;
  }
  const storageKey = coerceIdentifierCandidate(source && source.storageKey);
  if (storageKey) {
    hints.storageKey = storageKey;
  }
  return Object.keys(hints).length ? hints : null;
}

function mergeLegacyHints(target, source) {
  if (!source) {
    return target || null;
  }
  const result = target ? { ...target } : {};
  if (source.category && !result.category) {
    result.category = source.category;
  }
  if (source.inventoryId && !result.inventoryId) {
    result.inventoryId = source.inventoryId;
  }
  if (source.itemId && !result.itemId) {
    result.itemId = source.itemId;
  }
  if (source.storageKey && !result.storageKey) {
    result.storageKey = source.storageKey;
  }
  return Object.keys(result).length ? result : null;
}

function buildStorageIdCandidates(source, category) {
  const candidates = [];
  if (!source) {
    return candidates;
  }
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
    return candidates;
  }
  const normalizedCategory = typeof category === 'string' && category ? category.trim() : 'storage';
  const colonPrefix = normalizedCategory ? `${normalizedCategory}:` : '';
  const addCandidate = (value, options = {}) => {
    const candidate = coerceIdentifierCandidate(value);
    if (!candidate) {
      return;
    }
    if (options.prefixCategory && colonPrefix) {
      const prefixed = candidate.startsWith(colonPrefix) ? candidate : `${colonPrefix}${candidate}`;
      pushUnique(candidates, prefixed);
    }
    pushUnique(candidates, candidate);
  };

  addCandidate(source.inventoryId, { prefixCategory: true });
  addCandidate(source.id);
  addCandidate(source._id);
  addCandidate(source.itemId, { prefixCategory: true });
  addCandidate(source.storageId);
  addCandidate(source.inventoryKey);
  addCandidate(source.storageKey);

  return candidates;
}

function resolveStorageIdentifier(source) {
  const category =
    source && typeof source.storageCategory === 'string' && source.storageCategory
      ? source.storageCategory.trim()
      : 'storage';
  const candidates = buildStorageIdCandidates(source, category);
  const hints = buildLegacyHints(source, category);
  if (!candidates.length) {
    return { id: '', aliases: [], hints };
  }
  const [id, ...aliases] = candidates;
  return { id, aliases, hints };
}

function normalizeStorageInventoryId(source) {
  const resolved = resolveStorageIdentifier(source);
  return resolved.id;
}

function buildLegacyKeyCandidates(hints) {
  if (!hints || typeof hints !== 'object') {
    return [];
  }
  const candidates = [];
  const category = typeof hints.category === 'string' && hints.category ? hints.category : '';
  const dashPrefix = category ? `${category}-` : '';
  const addExact = (value) => {
    if (value && typeof value === 'string') {
      candidates.push({ type: 'exact', key: value });
    }
  };
  const addPrefix = (value) => {
    if (value && typeof value === 'string') {
      if (dashPrefix) {
        candidates.push({ type: 'prefix', key: `${dashPrefix}${value}-` });
      }
      candidates.push({ type: 'prefix', key: `${value}-` });
    }
  };
  addExact(hints.storageKey);
  addPrefix(hints.inventoryId);
  addPrefix(hints.itemId);
  return candidates;
}

function findLegacyKeyInMap(map, hints) {
  if (!map || typeof map !== 'object') {
    return null;
  }
  const candidates = buildLegacyKeyCandidates(hints);
  if (!candidates.length) {
    return null;
  }
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!key) {
      continue;
    }
    for (let j = 0; j < candidates.length; j += 1) {
      const candidate = candidates[j];
      if (!candidate || !candidate.key) {
        continue;
      }
      if (candidate.type === 'exact') {
        if (key === candidate.key) {
          return key;
        }
      } else if (key.startsWith(candidate.key)) {
        return key;
      }
    }
  }
  return null;
}

function resolveAcknowledgedEntry(acknowledged, id, aliases = [], hints = null) {
  if (!acknowledged || typeof acknowledged !== 'object' || !id) {
    return { value: 0, present: false, changed: false };
  }

  const assignFromKey = (key) => {
    const rawValue = acknowledged[key];
    const timestamp = resolveTimestamp(rawValue || 0);
    let changed = false;
    if (key === id) {
      if (acknowledged[id] !== timestamp) {
        acknowledged[id] = timestamp;
        changed = true;
      }
    } else {
      acknowledged[id] = timestamp;
      delete acknowledged[key];
      changed = true;
    }
    return { value: timestamp, present: true, changed };
  };

  if (Object.prototype.hasOwnProperty.call(acknowledged, id)) {
    return assignFromKey(id);
  }

  for (let i = 0; i < aliases.length; i += 1) {
    const alias = aliases[i];
    if (!alias || alias === id) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(acknowledged, alias)) {
      return assignFromKey(alias);
    }
  }

  const legacyKey = findLegacyKeyInMap(acknowledged, hints);
  if (legacyKey) {
    return assignFromKey(legacyKey);
  }

  return { value: 0, present: false, changed: false };
}

function readLatestTimestamp(latest, id, aliases = [], hints = null) {
  if (!latest || typeof latest !== 'object' || !id) {
    return 0;
  }
  if (Object.prototype.hasOwnProperty.call(latest, id)) {
    return resolveTimestamp(latest[id] || 0);
  }
  for (let i = 0; i < aliases.length; i += 1) {
    const alias = aliases[i];
    if (!alias || alias === id) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(latest, alias)) {
      return resolveTimestamp(latest[alias] || 0);
    }
  }
  const legacyKey = findLegacyKeyInMap(latest, hints);
  if (legacyKey) {
    return resolveTimestamp(latest[legacyKey] || 0);
  }
  return 0;
}

function collectStorageSnapshots(storageCategories = []) {
  const seen = new Map();
  storageCategories.forEach((category) => {
    if (!category || !Array.isArray(category.items)) {
      return;
    }
    category.items.forEach((item) => {
      if (!item) {
        return;
      }
      const { id, aliases, hints } = resolveStorageIdentifier(item);
      if (!id) {
        return;
      }
      const obtainedAt = resolveTimestamp(
        item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || 0
      );
      const existing = seen.get(id);
      if (!existing) {
        seen.set(id, { id, obtainedAt, isNew: !!item.isNew, aliases: aliases || [], hints });
        return;
      }
      if (obtainedAt > existing.obtainedAt) {
        existing.obtainedAt = obtainedAt;
      }
      if (item.isNew && !existing.isNew) {
        existing.isNew = true;
      }
      if (aliases && aliases.length) {
        const aliasSet = new Set(existing.aliases || []);
        aliases.forEach((alias) => {
          if (alias) {
            aliasSet.add(alias);
          }
        });
        existing.aliases = Array.from(aliasSet);
      }
      if (hints) {
        existing.hints = mergeLegacyHints(existing.hints, hints);
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
  return collectStorageSnapshots(categories);
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
  const acknowledged = state.acknowledged || {};
  const prevLatest = state.latest || {};
  const initialized = !!state.initialized;
  const explicitNew = new Set();
  let ackMutated = false;

  items.forEach((item) => {
    if (!item || !item.id) {
      return;
    }
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const hints = item.hints || null;
    if (item.isNew) {
      explicitNew.add(item.id);
    }
    const prevTime = readLatestTimestamp(prevLatest, item.id, aliases, hints);
    const normalizedTime = resolveTimestamp(item.obtainedAt || 0);
    const candidateTime = normalizedTime || prevTime || 0;
    const previous = latest[item.id];
    if (previous === undefined || candidateTime > previous) {
      latest[item.id] = candidateTime;
    }
    const ackEntry = resolveAcknowledgedEntry(acknowledged, item.id, aliases, hints);
    if (ackEntry.changed) {
      ackMutated = true;
    }
    if (!initialized) {
      const ackTime = candidateTime || Date.now();
      if (!explicitNew.has(item.id) && (!ackEntry.present || ackEntry.value < ackTime)) {
        acknowledged[item.id] = ackTime;
        ackMutated = true;
      }
    } else if (prevTime && !ackEntry.present) {
      acknowledged[item.id] = prevTime;
      ackMutated = true;
    }
  });

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

  let pruned = false;
  Object.keys(acknowledged).forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(latest, id)) {
      delete acknowledged[id];
      pruned = true;
    }
  });

  state.latest = latest;
  state.acknowledged = acknowledged;
  if (!state.initialized) {
    state.initialized = true;
    changed = true;
  }
  if (changed || pruned || ackMutated) {
    writeState(state);
  }
}

function hasUnseenItem(items, state) {
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const initialized = !!state.initialized;
  let mutated = false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || !item.id) {
      continue;
    }
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const hints = item.hints || null;
    const ackEntry = resolveAcknowledgedEntry(acknowledged, item.id, aliases, hints);
    if (ackEntry.changed) {
      mutated = true;
    }
    if (!initialized) {
      if (item.isNew && !ackEntry.present) {
        if (mutated) {
          writeState(state);
        }
        return true;
      }
      continue;
    }
    if (!ackEntry.present || !ackEntry.value) {
      if (mutated) {
        writeState(state);
      }
      return true;
    }
    const latestTime = readLatestTimestamp(latest, item.id, aliases, hints);
    const obtainedAt = resolveTimestamp(item.obtainedAt || latestTime || 0);
    if ((obtainedAt && ackEntry.value < obtainedAt) || (latestTime && ackEntry.value < latestTime)) {
      if (mutated) {
        writeState(state);
      }
      return true;
    }
  }
  if (mutated) {
    writeState(state);
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
  return hasUnseenItem(items, state);
}

export function shouldDisplayStorageItemNew(item) {
  if (!item) {
    return false;
  }
  const state = ensureState();
  const { id, aliases, hints } = resolveStorageIdentifier(item);
  if (!id) {
    return !!item.isNew;
  }
  const initialized = !!state.initialized;
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const ackEntry = resolveAcknowledgedEntry(acknowledged, id, aliases, hints);
  const latestTime = readLatestTimestamp(latest, id, aliases, hints);
  const obtainedAt = resolveTimestamp(
    item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || latestTime || 0
  );
  const mutated = ackEntry.changed;
  if (!initialized) {
    if (mutated) {
      writeState(state);
    }
    return !!item.isNew && !ackEntry.present;
  }
  if (!ackEntry.present || !ackEntry.value) {
    if (mutated) {
      writeState(state);
    }
    return true;
  }
  if ((obtainedAt && ackEntry.value < obtainedAt) || (latestTime && ackEntry.value < latestTime)) {
    if (mutated) {
      writeState(state);
    }
    return true;
  }
  if (mutated) {
    writeState(state);
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
  let changed = false;
  list.forEach((item) => {
    if (!item) {
      return;
    }
    const { id, aliases, hints } = resolveStorageIdentifier(item);
    if (!id) {
      return;
    }
    const ackEntry = resolveAcknowledgedEntry(acknowledged, id, aliases, hints);
    if (ackEntry.changed) {
      changed = true;
    }
    const obtainedAt = resolveTimestamp(
      item.obtainedAt || item.obtainedAtText || item.updatedAt || item.createdAt || 0
    );
    const latestTime = readLatestTimestamp(latest, id, aliases, hints);
    const ackTime = obtainedAt || latestTime || Date.now();
    if (!ackEntry.present || ackTime >= ackEntry.value) {
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
