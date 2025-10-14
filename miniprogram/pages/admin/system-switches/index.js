import { AdminService } from '../../../services/api';

const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};

const TOURNAMENT_FIELDS = ['enabled', 'registrationStart', 'registrationEnd'];

const DEFAULT_FEATURES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT }
};

function showConfirmationModal({ title = '确认操作', content = '确认执行该操作？', confirmText = '确认', cancelText = '取消' } = {}) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      confirmColor: '#566aff',
      success: (res) => {
        resolve(!!(res && res.confirm));
      },
      fail: () => {
        resolve(false);
      }
    });
  });
}

function toBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return toBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function trimToString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  try {
    const text = String(value);
    return text.trim();
  } catch (error) {
    return '';
  }
}

function normalizeImmortalTournament(config) {
  const normalized = { ...DEFAULT_IMMORTAL_TOURNAMENT };
  if (config && typeof config === 'object') {
    if (Object.prototype.hasOwnProperty.call(config, 'enabled')) {
      normalized.enabled = toBoolean(config.enabled, normalized.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationStart')) {
      normalized.registrationStart = trimToString(config.registrationStart);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationEnd')) {
      normalized.registrationEnd = trimToString(config.registrationEnd);
    }
  }
  return normalized;
}

function cloneImmortalTournament(config) {
  const normalized = normalizeImmortalTournament(config);
  return { ...normalized };
}

function buildTournamentDraft(config) {
  const normalized = normalizeImmortalTournament(config);
  return {
    enabled: normalized.enabled,
    registrationStart: normalized.registrationStart,
    registrationEnd: normalized.registrationEnd
  };
}

function normalizeFeatures(features) {
  const normalized = {
    cashierEnabled: DEFAULT_FEATURES.cashierEnabled,
    immortalTournament: cloneImmortalTournament(DEFAULT_FEATURES.immortalTournament)
  };
  if (features && typeof features === 'object') {
    if (Object.prototype.hasOwnProperty.call(features, 'cashierEnabled')) {
      normalized.cashierEnabled = toBoolean(features.cashierEnabled, true);
    }
    if (Object.prototype.hasOwnProperty.call(features, 'immortalTournament')) {
      normalized.immortalTournament = cloneImmortalTournament(features.immortalTournament);
    }
  }
  return normalized;
}

function resolveErrorMessage(error, fallback = '操作失败，请稍后重试') {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error.errMsg && typeof error.errMsg === 'string') {
    const trimmed = error.errMsg.replace(/^(cloud:|cloud\.callFunction:fail)/i, '').replace(/^[^:]*:/, '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (error.message && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

Page({
  data: {
    loading: true,
    features: { ...DEFAULT_FEATURES },
    tournamentDraft: buildTournamentDraft(DEFAULT_FEATURES.immortalTournament),
    tournamentSaving: false,
    tournamentError: '',
    tournamentResetting: false,
    tournamentResetScope: '',
    tournamentResetError: '',
    updating: {},
    error: ''
  },

  onShow() {
    this.loadFeatures();
  },

  onPullDownRefresh() {
    this.loadFeatures({ showLoading: false, fromPullDown: true });
  },

  async loadFeatures(options = {}) {
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      this.setData({ loading: true, error: '', updating: {} });
    }
    try {
      const result = await AdminService.getSystemSettings();
      const features = normalizeFeatures(result && result.features);
      this.setData({
        loading: false,
        features,
        tournamentDraft: buildTournamentDraft(features.immortalTournament),
        tournamentSaving: false,
        tournamentError: '',
        tournamentResetting: false,
        tournamentResetScope: '',
        tournamentResetError: '',
        error: '',
        updating: {}
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: resolveErrorMessage(error, '加载失败，请稍后重试'),
        tournamentSaving: false,
        tournamentError: '',
        tournamentResetting: false,
        tournamentResetScope: '',
        tournamentResetError: '',
        updating: {}
      });
    } finally {
      if (options.fromPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  async handleFeatureToggle(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key) {
      return;
    }
    if (this.data.loading) {
      return;
    }
    if (this.data.updating[key]) {
      return;
    }

    const enabled = !!(event && event.detail && event.detail.value);
    const previousFeatures = normalizeFeatures(this.data.features);
    const updating = { ...this.data.updating, [key]: true };

    this.setData({
      features: { ...previousFeatures, [key]: enabled },
      updating,
      error: ''
    });

    try {
      const result = await AdminService.updateSystemFeature(key, enabled);
      const features = normalizeFeatures(result && result.features);
      const nextUpdating = { ...this.data.updating };
      delete nextUpdating[key];
      this.setData({
        features,
        updating: nextUpdating,
        error: ''
      });
      wx.showToast({ title: '已更新', icon: 'success', duration: 800 });
    } catch (error) {
      const nextUpdating = { ...this.data.updating };
      delete nextUpdating[key];
      this.setData({
        features: previousFeatures,
        updating: nextUpdating,
        error: resolveErrorMessage(error, '保存失败，请稍后重试')
      });
      wx.showToast({ title: '保存失败', icon: 'none', duration: 1200 });
    }
  },

  handleTournamentToggle(event) {
    if (this.data.tournamentSaving || this.data.tournamentResetting) {
      wx.showToast({ title: '正在保存，请稍候', icon: 'none', duration: 1000 });
      return;
    }
    const enabled = !!(event && event.detail && event.detail.value);
    const previous = cloneImmortalTournament(this.data.features.immortalTournament);
    if (previous.enabled === enabled) {
      this.setData({
        tournamentDraft: { ...this.data.tournamentDraft, enabled },
        tournamentError: ''
      });
      return;
    }

    this.setData({
      tournamentDraft: { ...this.data.tournamentDraft, enabled },
      features: { ...this.data.features, immortalTournament: { ...previous, enabled } },
      tournamentError: ''
    });

    this.saveTournamentSettings(
      { enabled },
      { previousTournament: previous, toastTitle: '已更新' }
    ).catch(() => {});
  },

  handleTournamentFieldChange(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field || !TOURNAMENT_FIELDS.includes(field) || field === 'enabled') {
      return;
    }
    const value = event && event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      tournamentDraft: { ...this.data.tournamentDraft, [field]: value },
      tournamentError: ''
    });
  },

  handleTournamentSubmit() {
    if (this.data.tournamentSaving || this.data.tournamentResetting) {
      return;
    }
    const previousConfig = cloneImmortalTournament(this.data.features.immortalTournament);
    const draft = { ...this.data.tournamentDraft };
    const sanitizedDraft = { ...draft };
    const updates = {};

    ['registrationStart', 'registrationEnd'].forEach((field) => {
      const rawValue = sanitizedDraft[field];
      const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (trimmedValue !== rawValue) {
        sanitizedDraft[field] = trimmedValue;
      }
      if (trimmedValue !== previousConfig[field]) {
        updates[field] = trimmedValue;
      }
    });

    if (Object.keys(updates).length === 0) {
      this.setData({ tournamentDraft: sanitizedDraft });
      wx.showToast({ title: '暂无改动', icon: 'none', duration: 1000 });
      return;
    }

    this.setData({ tournamentDraft: sanitizedDraft, tournamentError: '' });

    this.saveTournamentSettings(updates, {
      previousTournament: previousConfig,
      toastTitle: '已保存'
    }).catch(() => {});
  },

  async saveTournamentSettings(updates = {}, options = {}) {
    if (!updates || typeof updates !== 'object') {
      return null;
    }
    const fields = Object.keys(updates).filter((field) => TOURNAMENT_FIELDS.includes(field));
    if (!fields.length) {
      return null;
    }

    const payload = {};
    fields.forEach((field) => {
      if (typeof updates[field] === 'string') {
        payload[field] = updates[field].trim();
      } else {
        payload[field] = updates[field];
      }
    });

    if (!Object.keys(payload).length) {
      return null;
    }

    const previous = options.previousTournament
      ? cloneImmortalTournament(options.previousTournament)
      : cloneImmortalTournament(this.data.features.immortalTournament);

    if (this.data.tournamentSaving || this.data.tournamentResetting) {
      wx.showToast({ title: '正在保存，请稍候', icon: 'none', duration: 1000 });
      return null;
    }

    this.setData({
      tournamentSaving: true,
      tournamentError: ''
    });

    try {
      const result = await AdminService.updateImmortalTournamentSettings(payload);
      const features = normalizeFeatures(result && result.features);
      this.setData({
        features,
        tournamentDraft: buildTournamentDraft(features.immortalTournament),
        tournamentSaving: false,
        tournamentError: ''
      });
      const toastTitle = options.toastTitle === false ? '' : options.toastTitle || '已更新';
      if (typeof toastTitle === 'string' && toastTitle) {
        wx.showToast({ title: toastTitle, icon: 'success', duration: 800 });
      }
      return features;
    } catch (error) {
      const fallback = cloneImmortalTournament(previous);
      this.setData({
        features: { ...this.data.features, immortalTournament: fallback },
        tournamentDraft: buildTournamentDraft(fallback),
        tournamentSaving: false,
        tournamentError: resolveErrorMessage(error, '保存失败，请稍后重试')
      });
      wx.showToast({ title: '保存失败', icon: 'none', duration: 1200 });
      throw error;
    }
  },

  async handleTournamentReset(event) {
    const { scope } = event.currentTarget.dataset || {};
    const normalizedScope = scope === 'all' ? 'all' : 'season';
    if (this.data.tournamentResetting || this.data.tournamentSaving) {
      wx.showToast({ title: '正在处理中，请稍候', icon: 'none', duration: 1000 });
      return;
    }

    const confirm = await showConfirmationModal({
      title: normalizedScope === 'all' ? '重置所有届' : '重置当前届',
      content:
        normalizedScope === 'all'
          ? '此操作会清除所有届的比赛记录、赛季档案与榜单数据，并从第一届重新开始。是否继续？'
          : '将清空本届的比赛记录、邀战、榜单数据，并清除赛季档案。是否继续？',
      confirmText: '确认重置'
    });
    if (!confirm) {
      return;
    }

    this.setData({
      tournamentResetting: true,
      tournamentResetScope: normalizedScope,
      tournamentResetError: ''
    });

    try {
      await AdminService.resetImmortalTournament({ scope: normalizedScope === 'all' ? 'all' : 'season' });
      this.setData({ tournamentResetting: false, tournamentResetScope: '', tournamentResetError: '' });
      wx.showToast({
        title: normalizedScope === 'all' ? '已清空记录' : '已重置本届',
        icon: 'success',
        duration: 1000
      });
      this.loadFeatures({ showLoading: false });
    } catch (error) {
      this.setData({
        tournamentResetting: false,
        tournamentResetScope: '',
        tournamentResetError: resolveErrorMessage(error, '重置失败，请稍后重试')
      });
      wx.showToast({ title: '重置失败', icon: 'none', duration: 1200 });
    }
  }
});
