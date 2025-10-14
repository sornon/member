import { AdminService } from '../../../services/api';

const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: '',
  maxParticipants: 64,
  ruleLink: '',
  announcement: ''
};

const TOURNAMENT_FIELDS = [
  'enabled',
  'registrationStart',
  'registrationEnd',
  'maxParticipants',
  'ruleLink',
  'announcement'
];

const DEFAULT_FEATURES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT }
};

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
    if (Object.prototype.hasOwnProperty.call(config, 'maxParticipants')) {
      const numeric = Number(config.maxParticipants);
      if (Number.isFinite(numeric) && numeric > 0) {
        const clamped = Math.max(2, Math.min(512, Math.round(numeric)));
        normalized.maxParticipants = clamped;
      }
    }
    if (Object.prototype.hasOwnProperty.call(config, 'ruleLink')) {
      normalized.ruleLink = trimToString(config.ruleLink);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'announcement')) {
      normalized.announcement = trimToString(config.announcement);
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
    registrationEnd: normalized.registrationEnd,
    maxParticipants:
      typeof normalized.maxParticipants === 'number' && Number.isFinite(normalized.maxParticipants)
        ? String(normalized.maxParticipants)
        : '',
    ruleLink: normalized.ruleLink,
    announcement: normalized.announcement
  };
}

function mergeTournamentConfig(base, updates) {
  const normalizedBase = cloneImmortalTournament(base);
  const merged = { ...normalizedBase };
  if (updates && typeof updates === 'object') {
    TOURNAMENT_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        merged[field] = updates[field];
      }
    });
  }
  return normalizeImmortalTournament(merged);
}

function isSameTournamentConfig(a, b) {
  const normalizedA = normalizeImmortalTournament(a);
  const normalizedB = normalizeImmortalTournament(b);
  return (
    normalizedA.enabled === normalizedB.enabled &&
    normalizedA.registrationStart === normalizedB.registrationStart &&
    normalizedA.registrationEnd === normalizedB.registrationEnd &&
    normalizedA.maxParticipants === normalizedB.maxParticipants &&
    normalizedA.ruleLink === normalizedB.ruleLink &&
    normalizedA.announcement === normalizedB.announcement
  );
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
    tournamentSavingFields: {},
    tournamentError: '',
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
        tournamentSavingFields: {},
        tournamentError: '',
        error: '',
        updating: {}
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: resolveErrorMessage(error, '加载失败，请稍后重试'),
        tournamentSaving: false,
        tournamentSavingFields: {},
        tournamentError: '',
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

  handleTournamentFieldBlur(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field || !TOURNAMENT_FIELDS.includes(field) || field === 'enabled') {
      return;
    }
    const currentDraft = { ...this.data.tournamentDraft };
    const rawValue = currentDraft[field];
    const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (trimmedValue !== rawValue) {
      currentDraft[field] = trimmedValue;
      this.setData({ tournamentDraft: currentDraft });
    }

    const previousConfig = cloneImmortalTournament(this.data.features.immortalTournament);
    const updates = {};
    if (field === 'maxParticipants') {
      if (!trimmedValue) {
        updates.maxParticipants = DEFAULT_IMMORTAL_TOURNAMENT.maxParticipants;
      } else {
        const numeric = Number(trimmedValue);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          this.setData({ tournamentError: '请填写有效的参赛人数上限' });
          this.setData({
            tournamentDraft: buildTournamentDraft(previousConfig)
          });
          return;
        }
        updates.maxParticipants = numeric;
      }
    } else {
      updates[field] = trimmedValue;
    }

    const nextConfig = mergeTournamentConfig(previousConfig, updates);
    if (isSameTournamentConfig(previousConfig, nextConfig)) {
      return;
    }

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
      if (field === 'maxParticipants') {
        const raw = updates[field];
        if (raw === '' || raw == null) {
          payload[field] = DEFAULT_IMMORTAL_TOURNAMENT.maxParticipants;
        } else {
          const numeric = Number(raw);
          if (Number.isFinite(numeric) && numeric > 0) {
            payload[field] = numeric;
          }
        }
        return;
      }
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

    const pendingFields = { ...this.data.tournamentSavingFields };
    fields.forEach((field) => {
      pendingFields[field] = true;
    });

    this.setData({
      tournamentSaving: true,
      tournamentSavingFields: pendingFields,
      tournamentError: ''
    });

    try {
      const result = await AdminService.updateImmortalTournamentSettings(payload);
      const features = normalizeFeatures(result && result.features);
      const nextSavingFields = { ...this.data.tournamentSavingFields };
      fields.forEach((field) => {
        delete nextSavingFields[field];
      });
      const hasPending = Object.keys(nextSavingFields).length > 0;
      this.setData({
        features,
        tournamentDraft: buildTournamentDraft(features.immortalTournament),
        tournamentSaving: hasPending,
        tournamentSavingFields: nextSavingFields,
        tournamentError: ''
      });
      const toastTitle = options.toastTitle === false ? '' : options.toastTitle || '已更新';
      if (typeof toastTitle === 'string' && toastTitle) {
        wx.showToast({ title: toastTitle, icon: 'success', duration: 800 });
      }
      return features;
    } catch (error) {
      const nextSavingFields = { ...this.data.tournamentSavingFields };
      fields.forEach((field) => {
        delete nextSavingFields[field];
      });
      const hasPending = Object.keys(nextSavingFields).length > 0;
      const fallback = cloneImmortalTournament(previous);
      this.setData({
        features: { ...this.data.features, immortalTournament: fallback },
        tournamentDraft: buildTournamentDraft(fallback),
        tournamentSaving: hasPending,
        tournamentSavingFields: nextSavingFields,
        tournamentError: resolveErrorMessage(error, '保存失败，请稍后重试')
      });
      wx.showToast({ title: '保存失败', icon: 'none', duration: 1200 });
      throw error;
    }
  }
});
