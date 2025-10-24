import { ensureBadgeState, writeBadgeState } from './storage-notifications';
import { normalizeAvatarUnlocks } from './avatar-catalog';
import { normalizeTitleId } from '../shared/titles';
import { normalizeBackgroundId } from '../shared/backgrounds';

const BADGE_PREFIX = 'badge:';

export const BADGE_KEYS = {
  HOME_AVATAR: 'home:avatar',
  HOME_NICKNAME: 'home:nickname',
  HOME_REALM: 'home:realm',
  HOME_STONES: 'home:stones',
  HOME_NAV_WALLET: 'home:nav:wallet',
  HOME_NAV_ORDER: 'home:nav:order',
  HOME_NAV_RESERVATION: 'home:nav:reservation',
  HOME_NAV_ROLE: 'home:nav:role',
  HOME_NAV_EQUIPMENT: 'home:nav:equipment',
  HOME_NAV_STORAGE: 'home:nav:storage',
  HOME_NAV_SKILL: 'home:nav:skill',
  HOME_NAV_ADMIN: 'home:nav:admin',
  HOME_AVATAR_TAB_AVATAR: 'home:avatar-tab:avatar',
  HOME_AVATAR_TAB_FRAME: 'home:avatar-tab:frame',
  HOME_AVATAR_TAB_TITLE: 'home:avatar-tab:title',
  HOME_AVATAR_TAB_BACKGROUND: 'home:avatar-tab:background',
  HOME_ACTIVITY: 'home:activity',
  ROLE_TAB_CHARACTER: 'role:tab:character',
  ROLE_TAB_EQUIPMENT: 'role:tab:equipment',
  ROLE_TAB_STORAGE: 'role:tab:storage',
  ROLE_TAB_SKILL: 'role:tab:skill',
  STORAGE_TAB_EQUIPMENT: 'storage:tab:equipment',
  STORAGE_TAB_QUEST: 'storage:tab:quest',
  STORAGE_TAB_MATERIAL: 'storage:tab:material',
  STORAGE_TAB_CONSUMABLE: 'storage:tab:consumable',
  RESERVATION_NOTIFICATION: 'reservation:notification',
  ORDER_NOTIFICATION: 'order:notification'
};

const listeners = new Set();
let cachedSnapshot = null;

function normalizeVersion(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    if (Number.isInteger(value)) {
      return value;
    }
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return normalizeVersion(numeric);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return normalizeVersion(parsed);
    }
    return 0;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? normalizeVersion(time) : 0;
  }
  return 0;
}

function buildStorageKey(key) {
  if (typeof key !== 'string' || !key.trim()) {
    return '';
  }
  const trimmed = key.trim();
  if (trimmed.startsWith(BADGE_PREFIX)) {
    return trimmed;
  }
  return `${BADGE_PREFIX}${trimmed}`;
}

function buildSnapshotFromState(state) {
  const latest = (state && state.latest) || {};
  const acknowledged = (state && state.acknowledged) || {};
  const meta = (state && state.meta) || {};
  const keys = new Set([
    ...Object.keys(latest),
    ...Object.keys(acknowledged)
  ]);
  const snapshot = {};
  keys.forEach((rawKey) => {
    const key = rawKey.startsWith(BADGE_PREFIX) ? rawKey.slice(BADGE_PREFIX.length) : rawKey;
    const latestValue = normalizeVersion(latest[rawKey]);
    const ackValue = normalizeVersion(acknowledged[rawKey]);
    snapshot[key] = {
      latest: latestValue,
      acknowledged: ackValue,
      show: latestValue > ackValue,
      meta: meta[rawKey] && typeof meta[rawKey] === 'object' ? { ...meta[rawKey] } : {}
    };
  });
  cachedSnapshot = snapshot;
  return snapshot;
}

function notifyListeners() {
  const snapshot = getBadgeSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[badge-center] listener error', error);
    }
  });
}

function ensureMetaContainer(state) {
  if (!state.meta || typeof state.meta !== 'object') {
    state.meta = {};
  }
  return state.meta;
}

function ensureEntryMeta(metaContainer, storageKey) {
  if (!metaContainer[storageKey] || typeof metaContainer[storageKey] !== 'object') {
    metaContainer[storageKey] = {};
  }
  return metaContainer[storageKey];
}

export function getBadgeSnapshot() {
  if (cachedSnapshot) {
    return { ...cachedSnapshot };
  }
  const state = ensureBadgeState();
  return buildSnapshotFromState(state);
}

export function subscribeBadge(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  listener(getBadgeSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function shouldShowBadge(key, snapshot) {
  const store = snapshot || getBadgeSnapshot();
  const entry = store[key];
  return !!(entry && entry.show);
}

export function updateBadgeState(key, options = {}) {
  const storageKey = buildStorageKey(key);
  if (!storageKey) {
    return;
  }
  const state = ensureBadgeState();
  const latest = state.latest || {};
  const metaContainer = ensureMetaContainer(state);
  const entryMeta = ensureEntryMeta(metaContainer, storageKey);
  let mutated = false;
  let desiredVersion = normalizeVersion(options.version);
  if (options.fingerprint !== undefined) {
    if (entryMeta.fingerprint !== options.fingerprint) {
      entryMeta.fingerprint = options.fingerprint;
      mutated = true;
      if (!desiredVersion) {
        desiredVersion = normalizeVersion(Date.now());
      }
    }
  }
  if (options.meta && typeof options.meta === 'object') {
    const entries = Object.entries(options.meta);
    entries.forEach(([metaKey, metaValue]) => {
      if (entryMeta[metaKey] !== metaValue) {
        entryMeta[metaKey] = metaValue;
        mutated = true;
      }
    });
  }
  if (desiredVersion && (!latest[storageKey] || normalizeVersion(latest[storageKey]) < desiredVersion)) {
    latest[storageKey] = desiredVersion;
    mutated = true;
  }
  if (options.clear === true) {
    if (latest[storageKey]) {
      delete latest[storageKey];
      mutated = true;
    }
    if (state.acknowledged && state.acknowledged[storageKey]) {
      delete state.acknowledged[storageKey];
      mutated = true;
    }
    delete metaContainer[storageKey];
  } else if (mutated) {
    metaContainer[storageKey] = entryMeta;
  }
  if (mutated) {
    writeBadgeState(state);
    notifyListeners();
  }
}

export function acknowledgeBadge(key, options = {}) {
  const storageKey = buildStorageKey(key);
  if (!storageKey) {
    return;
  }
  const state = ensureBadgeState();
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  const currentAck = normalizeVersion(acknowledged[storageKey]);
  let desiredAck = normalizeVersion(options.version);
  if (!desiredAck) {
    const fallback = normalizeVersion(latest[storageKey]) || normalizeVersion(Date.now());
    desiredAck = fallback;
  }
  if (!currentAck || currentAck < desiredAck) {
    acknowledged[storageKey] = desiredAck;
    writeBadgeState(state);
    notifyListeners();
  }
}

export function acknowledgeBadges(keys = []) {
  if (!Array.isArray(keys)) {
    acknowledgeBadge(keys);
    return;
  }
  const state = ensureBadgeState();
  const acknowledged = state.acknowledged || {};
  const latest = state.latest || {};
  let mutated = false;
  keys.forEach((key) => {
    const storageKey = buildStorageKey(key);
    if (!storageKey) {
      return;
    }
    const latestValue = normalizeVersion(latest[storageKey]) || normalizeVersion(Date.now());
    const currentAck = normalizeVersion(acknowledged[storageKey]);
    if (!currentAck || currentAck < latestValue) {
      acknowledged[storageKey] = latestValue;
      mutated = true;
    }
  });
  if (mutated) {
    writeBadgeState(state);
    notifyListeners();
  }
}

export function acknowledgeByPrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix.trim()) {
    return;
  }
  const snapshot = getBadgeSnapshot();
  const keys = Object.keys(snapshot).filter((key) => key.startsWith(prefix));
  acknowledgeBadges(keys);
}

export function clearBadge(key) {
  updateBadgeState(key, { clear: true });
}

function dedupeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function buildAppearanceFingerprint(member = {}) {
  const avatarUnlocks = normalizeAvatarUnlocks(member.avatarUnlocks || []);
  const frames = Array.isArray(member.avatarFrameUnlocks) ? dedupeList(member.avatarFrameUnlocks) : [];
  const backgroundUnlocks = Array.isArray(member.backgroundUnlocks)
    ? dedupeList(member.backgroundUnlocks.map((id) => normalizeBackgroundId(id)))
    : [];
  const titleSource = [];
  if (Array.isArray(member.titleUnlocks)) {
    member.titleUnlocks.forEach((id) => {
      const normalized = normalizeTitleId(id || '');
      if (normalized) {
        titleSource.push(normalized);
      }
    });
  }
  if (member.extras && Array.isArray(member.extras.titleUnlocks)) {
    member.extras.titleUnlocks.forEach((id) => {
      const normalized = normalizeTitleId(id || '');
      if (normalized && !titleSource.includes(normalized)) {
        titleSource.push(normalized);
      }
    });
  }
  const titleUnlocks = dedupeList(titleSource);
  const payload = {
    avatars: avatarUnlocks.slice().sort(),
    frames: frames.slice().sort(),
    backgrounds: backgroundUnlocks.slice().sort(),
    titles: titleUnlocks.slice().sort()
  };
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return '';
  }
}

export function syncAppearanceBadges(member) {
  const fingerprint = buildAppearanceFingerprint(member);
  if (fingerprint) {
    updateBadgeState(BADGE_KEYS.HOME_AVATAR, { fingerprint });
    updateBadgeState(BADGE_KEYS.HOME_AVATAR_TAB_AVATAR, { fingerprint });
    updateBadgeState(BADGE_KEYS.HOME_AVATAR_TAB_FRAME, { fingerprint: `${fingerprint}|frame` });
    updateBadgeState(BADGE_KEYS.HOME_AVATAR_TAB_TITLE, { fingerprint: `${fingerprint}|title` });
    updateBadgeState(BADGE_KEYS.HOME_AVATAR_TAB_BACKGROUND, { fingerprint: `${fingerprint}|background` });
  }
}

export function syncReservationBadges(badges = {}) {
  const memberVersion = normalizeVersion(badges.memberVersion || badges.member);
  const memberSeenVersion = normalizeVersion(badges.memberSeenVersion || badges.memberSeen);
  const adminVersion = normalizeVersion(badges.adminVersion || badges.admin);
  const adminSeenVersion = normalizeVersion(badges.adminSeenVersion || badges.adminSeen);
  if (memberVersion) {
    updateBadgeState(BADGE_KEYS.HOME_NAV_RESERVATION, {
      version: memberVersion,
      meta: { pendingCount: normalizeVersion(badges.pendingApprovalCount) }
    });
    if (memberSeenVersion && memberSeenVersion >= memberVersion) {
      acknowledgeBadge(BADGE_KEYS.HOME_NAV_RESERVATION, { version: memberSeenVersion });
    }
  }
  if (adminVersion) {
    updateBadgeState(BADGE_KEYS.HOME_NAV_ADMIN, {
      version: adminVersion,
      meta: { pendingCount: normalizeVersion(badges.pendingApprovalCount) }
    });
    if (adminSeenVersion && adminSeenVersion >= adminVersion) {
      acknowledgeBadge(BADGE_KEYS.HOME_NAV_ADMIN, { version: adminSeenVersion });
    }
  }
}

export function syncRoleBadge(hasPendingAttributes) {
  if (hasPendingAttributes) {
    updateBadgeState(BADGE_KEYS.HOME_NAV_ROLE, { version: Date.now() });
    updateBadgeState(BADGE_KEYS.ROLE_TAB_CHARACTER, { version: Date.now() });
  } else {
    acknowledgeBadges([BADGE_KEYS.HOME_NAV_ROLE, BADGE_KEYS.ROLE_TAB_CHARACTER]);
  }
}

export function syncStoneBadge(balance) {
  const version = normalizeVersion(balance);
  if (version) {
    updateBadgeState(BADGE_KEYS.HOME_STONES, { version });
  }
}

export function syncRealmBadge(hasPendingRewards) {
  if (hasPendingRewards) {
    updateBadgeState(BADGE_KEYS.HOME_REALM, { version: Date.now() });
  } else {
    acknowledgeBadge(BADGE_KEYS.HOME_REALM);
  }
}

export function syncOrderBadge(latestVersion, options = {}) {
  const version = normalizeVersion(latestVersion || options.version);
  if (version) {
    updateBadgeState(BADGE_KEYS.HOME_NAV_ORDER, { version, meta: options.meta });
  }
  if (options.seenVersion) {
    acknowledgeBadge(BADGE_KEYS.HOME_NAV_ORDER, { version: options.seenVersion });
  }
}

export function syncWalletBadge(version) {
  const normalized = normalizeVersion(version);
  if (normalized) {
    updateBadgeState(BADGE_KEYS.HOME_NAV_WALLET, { version: normalized });
  }
}

export function syncActivityBadge(version, meta = {}) {
  const normalized = normalizeVersion(version);
  if (normalized) {
    updateBadgeState(BADGE_KEYS.HOME_ACTIVITY, { version: normalized, meta });
  }
}

export function syncStorageCategoryBadge(key, version, meta = {}) {
  if (!key) {
    return;
  }
  updateBadgeState(`storage:tab:${key}`, { version, meta });
  updateBadgeState(BADGE_KEYS.HOME_NAV_STORAGE, { version });
  updateBadgeState(BADGE_KEYS.ROLE_TAB_STORAGE, { version });
}

export function syncEquipmentBadge(version, meta = {}) {
  updateBadgeState(BADGE_KEYS.HOME_NAV_EQUIPMENT, { version, meta });
  updateBadgeState(BADGE_KEYS.ROLE_TAB_EQUIPMENT, { version, meta });
}

export function syncSkillBadge(version, meta = {}) {
  updateBadgeState(BADGE_KEYS.HOME_NAV_SKILL, { version, meta });
  updateBadgeState(BADGE_KEYS.ROLE_TAB_SKILL, { version, meta });
}

export function markNicknameBadge(member) {
  if (member && member.nickName) {
    updateBadgeState(BADGE_KEYS.HOME_NICKNAME, {
      fingerprint: `${member._id || member.id || ''}|${member.nickName}`
    });
  }
}

// 首次访问时为头像与昵称亮起红点，满足“新用户初次进入需提示”要求。
export function ensureFirstVisitBadges() {
  const state = ensureBadgeState();
  const metaContainer = ensureMetaContainer(state);
  const storageKey = buildStorageKey('center:meta');
  const centerMeta = ensureEntryMeta(metaContainer, storageKey);
  if (centerMeta.firstVisitApplied) {
    return;
  }
  const now = Date.now();
  state.latest[buildStorageKey(BADGE_KEYS.HOME_AVATAR)] = now;
  state.latest[buildStorageKey(BADGE_KEYS.HOME_NICKNAME)] = now;
  centerMeta.firstVisitApplied = now;
  writeBadgeState(state);
  notifyListeners();
}

export function resetBadgeCache() {
  cachedSnapshot = null;
}

// Initialize snapshot cache at module load.
getBadgeSnapshot();
