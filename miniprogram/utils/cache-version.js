const DEFAULT_CACHE_VERSIONS = {
  global: 1,
  menu: 1
};

export const CACHE_VERSION_STORAGE_KEY = 'systemCacheVersions';
export const MENU_CATALOG_STORAGE_KEY = 'membershipMenuCatalog';
export const MENU_CART_STORAGE_KEY = 'membershipMenuCart';

function toCacheVersionNumber(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const fallbackNumeric = Number(fallback);
    if (!Number.isFinite(fallbackNumeric)) {
      return 1;
    }
    return Math.max(0, Math.floor(fallbackNumeric));
  }
  if (numeric >= Number.MAX_SAFE_INTEGER) {
    return 1;
  }
  return Math.max(0, Math.floor(numeric));
}

function safeGetStorage(key) {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return null;
  }
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    console.warn(`[cache-version] read storage ${key} failed`, error);
    return null;
  }
}

function safeSetStorage(key, value) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    console.warn(`[cache-version] write storage ${key} failed`, error);
  }
}

function safeRemoveStorage(key) {
  if (typeof wx === 'undefined' || !wx) {
    return;
  }
  if (typeof wx.removeStorageSync === 'function') {
    try {
      wx.removeStorageSync(key);
      return;
    } catch (error) {
      console.warn(`[cache-version] remove storage ${key} failed`, error);
    }
  }
  if (typeof wx.setStorageSync === 'function') {
    try {
      wx.setStorageSync(key, '');
    } catch (error) {
      console.warn(`[cache-version] fallback clear storage ${key} failed`, error);
    }
  }
}

function safeClearStorage() {
  if (typeof wx === 'undefined' || !wx) {
    return;
  }
  if (typeof wx.clearStorageSync === 'function') {
    try {
      wx.clearStorageSync();
      return;
    } catch (error) {
      console.warn('[cache-version] clear storage failed', error);
    }
  }
  if (typeof wx.getStorageInfoSync === 'function' && typeof wx.removeStorageSync === 'function') {
    try {
      const info = wx.getStorageInfoSync();
      if (info && Array.isArray(info.keys)) {
        info.keys.forEach((key) => {
          try {
            wx.removeStorageSync(key);
          } catch (removeError) {
            console.warn(`[cache-version] remove storage ${key} failed`, removeError);
          }
        });
        return;
      }
    } catch (error) {
      console.warn('[cache-version] enumerate storage keys failed', error);
    }
  }
  safeRemoveStorage(CACHE_VERSION_STORAGE_KEY);
  safeRemoveStorage(MENU_CATALOG_STORAGE_KEY);
  safeRemoveStorage(MENU_CART_STORAGE_KEY);
}

export function normalizeCacheVersions(raw, defaults = DEFAULT_CACHE_VERSIONS) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const fallback = defaults && typeof defaults === 'object' ? defaults : DEFAULT_CACHE_VERSIONS;
  const keys = new Set([
    ...Object.keys(fallback),
    ...Object.keys(base)
  ]);
  const versions = {};
  keys.forEach((key) => {
    versions[key] = toCacheVersionNumber(base[key], fallback[key] || 1);
  });
  return versions;
}

export function getStoredCacheVersions() {
  const stored = safeGetStorage(CACHE_VERSION_STORAGE_KEY);
  if (!stored || typeof stored !== 'object') {
    return null;
  }
  return normalizeCacheVersions(stored);
}

export function setStoredCacheVersions(versions) {
  if (!versions || typeof versions !== 'object') {
    safeRemoveStorage(CACHE_VERSION_STORAGE_KEY);
    return;
  }
  const snapshot = normalizeCacheVersions(versions);
  safeSetStorage(CACHE_VERSION_STORAGE_KEY, snapshot);
}

export function diffCacheVersions(remote, local) {
  const normalizedRemote = normalizeCacheVersions(remote);
  const previous = local ? normalizeCacheVersions(local) : null;
  if (!previous) {
    return Object.keys(normalizedRemote);
  }
  const keys = new Set([
    ...Object.keys(normalizedRemote),
    ...Object.keys(previous)
  ]);
  const mismatched = [];
  keys.forEach((key) => {
    if (normalizedRemote[key] !== previous[key]) {
      mismatched.push(key);
    }
  });
  return mismatched;
}

export function clearCachesForScopes(scopes = []) {
  const queue = Array.isArray(scopes) ? scopes : [scopes];
  const normalized = Array.from(
    new Set(
      queue
        .map((scope) => (typeof scope === 'string' ? scope.trim() : ''))
        .filter((scope) => scope)
    )
  );
  if (!normalized.length) {
    return;
  }
  if (normalized.includes('global')) {
    safeClearStorage();
    return;
  }
  normalized.forEach((scope) => {
    if (scope === 'menu') {
      safeRemoveStorage(MENU_CATALOG_STORAGE_KEY);
      safeRemoveStorage(MENU_CART_STORAGE_KEY);
    }
  });
}

export function applyCacheVersionUpdate(remoteVersions = {}) {
  const normalizedRemote = normalizeCacheVersions(remoteVersions);
  const stored = getStoredCacheVersions();
  const mismatched = diffCacheVersions(normalizedRemote, stored);
  if (mismatched.includes('global')) {
    clearCachesForScopes(['global']);
  } else if (mismatched.length) {
    clearCachesForScopes(mismatched);
  }
  setStoredCacheVersions(normalizedRemote);
  return { versions: normalizedRemote, mismatched };
}

export function getDefaultCacheVersions() {
  return normalizeCacheVersions(DEFAULT_CACHE_VERSIONS);
}
