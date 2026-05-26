const HOME_ENTRIES_STORAGE_KEY = 'home-entries-visibility';

const DEFAULT_HOME_ENTRY_VISIBILITY = Object.freeze({
  activities: true,
  mall: true,
  secretRealm: false,
  rights: true,
  guild: false,
  pvp: false,
  trading: false
});

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : defaultValue;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)) return false;
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) return true;
    return defaultValue;
  }
  return value == null ? defaultValue : !!value;
}

function normalizeHomeEntries(entries) {
  const source = entries && typeof entries === 'object' ? entries : {};
  return Object.keys(DEFAULT_HOME_ENTRY_VISIBILITY).reduce((acc, key) => {
    acc[key] = toBoolean(source[key], DEFAULT_HOME_ENTRY_VISIBILITY[key]);
    return acc;
  }, {});
}

function loadHomeEntries() {
  let source = null;
  try {
    const app = getApp();
    source = app && app.globalData ? app.globalData.homeEntries : null;
  } catch (error) {}
  if (source && typeof source === 'object') {
    return normalizeHomeEntries(source);
  }
  try {
    const cached = wx.getStorageSync(HOME_ENTRIES_STORAGE_KEY);
    if (cached && typeof cached === 'string') {
      return normalizeHomeEntries(JSON.parse(cached));
    }
    return normalizeHomeEntries(cached);
  } catch (error) {
    return normalizeHomeEntries(null);
  }
}

function blockAndBack() {
  wx.showToast({ title: '该入口暂未开放', icon: 'none' });
  setTimeout(() => {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  }, 150);
}

function ensureHomeEntryEnabled(key) {
  const entries = loadHomeEntries();
  const enabled = entries[key] !== false;
  if (!enabled) {
    blockAndBack();
  }
  return enabled;
}

module.exports = {
  ensureHomeEntryEnabled
};
