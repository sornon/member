import { AdminService } from '../../../services/api';
import {
  normalizeCacheVersions as normalizeClientCacheVersions,
  getDefaultCacheVersions
} from '../../../utils/cache-version.js';

const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};

const TOURNAMENT_FIELDS = ['enabled', 'registrationStart', 'registrationEnd'];

const DEFAULT_RAGE_SETTINGS = {
  start: 0,
  turnGain: 20,
  basicAttackGain: 10,
  damageTakenMultiplier: 1.5,
  critGain: 1,
  critTakenGain: 1
};

const RAGE_FIELDS = [
  { key: 'start', label: '开局真气', hint: '战斗开始时的基础真气点数' },
  { key: 'turnGain', label: '每回合开始', hint: '每回合开始时自动恢复的真气' },
  { key: 'basicAttackGain', label: '普攻命中', hint: '普通攻击命中后获得的真气' },
  {
    key: 'damageTakenMultiplier',
    label: '承受伤害系数',
    hint: '掉血百分比 × 系数 × 真气上限'
  },
  { key: 'critGain', label: '造成暴击', hint: '造成暴击时额外获得的真气' },
  { key: 'critTakenGain', label: '遭受暴击', hint: '遭受暴击时额外获得的真气' }
];

const DEFAULT_CACHE_VERSIONS = getDefaultCacheVersions();
const CACHE_VERSION_SCOPES = [
  {
    key: 'global',
    title: '全局缓存',
    description: '刷新后会员端会清空所有本地缓存并写入新的版本号，适用于重要配置调整。',
    actionLabel: '刷新全局'
  },
  {
    key: 'menu',
    title: '菜单缓存',
    description: '更新点餐菜单缓存版本，会员端会在下次进入点餐页时重新拉取菜单数据。',
    actionLabel: '刷新菜单'
  }
];

const DEFAULT_FEATURES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT },
  cacheVersions: { ...DEFAULT_CACHE_VERSIONS }
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

function cloneRageSettings(settings = DEFAULT_RAGE_SETTINGS) {
  const normalized = {};
  RAGE_FIELDS.forEach(({ key }) => {
    const numeric = Number(settings && typeof settings === 'object' ? settings[key] : undefined);
    normalized[key] = Number.isFinite(numeric) ? numeric : DEFAULT_RAGE_SETTINGS[key];
  });
  return normalized;
}

function buildRageDraft(settings = DEFAULT_RAGE_SETTINGS) {
  const normalized = cloneRageSettings(settings);
  const draft = {};
  RAGE_FIELDS.forEach(({ key }) => {
    const value = normalized[key];
    draft[key] = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  });
  return draft;
}

function parseRageDraft(draft = {}) {
  const payload = {};
  for (let i = 0; i < RAGE_FIELDS.length; i += 1) {
    const { key, label } = RAGE_FIELDS[i];
    const rawValue = draft && Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : '';
    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '');
    if (!trimmed) {
      return { error: `${label} 不能为空`, payload: null };
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return { error: `${label} 需为有效数值`, payload: null };
    }
    if (numeric < 0) {
      return { error: `${label} 不能小于 0`, payload: null };
    }
    payload[key] = numeric;
  }
  return { error: '', payload };
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
    immortalTournament: cloneImmortalTournament(DEFAULT_FEATURES.immortalTournament),
    cacheVersions: normalizeClientCacheVersions(
      DEFAULT_FEATURES.cacheVersions,
      DEFAULT_CACHE_VERSIONS
    )
  };
  if (features && typeof features === 'object') {
    if (Object.prototype.hasOwnProperty.call(features, 'cashierEnabled')) {
      normalized.cashierEnabled = toBoolean(features.cashierEnabled, true);
    }
    if (Object.prototype.hasOwnProperty.call(features, 'immortalTournament')) {
      normalized.immortalTournament = cloneImmortalTournament(features.immortalTournament);
    }
    if (Object.prototype.hasOwnProperty.call(features, 'cacheVersions')) {
      normalized.cacheVersions = normalizeClientCacheVersions(
        features.cacheVersions,
        DEFAULT_CACHE_VERSIONS
      );
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
    tournamentRefreshingPlayers: false,
    tournamentRefreshError: '',
    tournamentRefreshSummary: '',
    updating: {},
    error: '',
    gameParameters: { rage: cloneRageSettings(DEFAULT_RAGE_SETTINGS) },
    rageDraft: buildRageDraft(DEFAULT_RAGE_SETTINGS),
    rageDefaults: buildRageDraft(DEFAULT_RAGE_SETTINGS),
    rageDefaultValues: cloneRageSettings(DEFAULT_RAGE_SETTINGS),
    rageSaving: false,
    rageError: '',
    rageFieldList: RAGE_FIELDS,
    cacheScopes: CACHE_VERSION_SCOPES,
    cacheRefreshing: {},
    cacheError: '',
    secretRealmResetting: false,
    secretRealmResetSummary: '',
    secretRealmResetError: ''
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
      const rageDefaultsSource =
        result && result.defaults && result.defaults.rageSettings
          ? result.defaults.rageSettings
          : DEFAULT_RAGE_SETTINGS;
      const responseRage =
        (result && result.rageSettings) ||
        (result && result.gameParameters && result.gameParameters.rage) ||
        DEFAULT_RAGE_SETTINGS;
      const rageDefaults = cloneRageSettings(rageDefaultsSource);
      const rageSettings = cloneRageSettings(responseRage);
      this.setData({
        loading: false,
        features,
        tournamentDraft: buildTournamentDraft(features.immortalTournament),
        tournamentSaving: false,
        tournamentError: '',
        tournamentResetting: false,
        tournamentResetScope: '',
        tournamentResetError: '',
        tournamentRefreshingPlayers: false,
        tournamentRefreshError: '',
        tournamentRefreshSummary: '',
        error: '',
        updating: {},
        gameParameters: { rage: rageSettings },
        rageDraft: buildRageDraft(rageSettings),
        rageDefaults: buildRageDraft(rageDefaults),
        rageDefaultValues: rageDefaults,
        rageSaving: false,
        rageError: '',
        cacheRefreshing: {},
        cacheError: '',
        secretRealmResetting: false,
        secretRealmResetSummary: '',
        secretRealmResetError: ''
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
        tournamentRefreshingPlayers: false,
        tournamentRefreshError: '',
        tournamentRefreshSummary: '',
        updating: {},
        rageSaving: false,
        cacheRefreshing: {},
        secretRealmResetting: false
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

  async handleCacheRefresh(event) {
    const { scope } = event.currentTarget.dataset || {};
    const key = typeof scope === 'string' ? scope.trim() : '';
    if (!key) {
      return;
    }
    if (this.data.cacheRefreshing && this.data.cacheRefreshing[key]) {
      return;
    }

    const nextRefreshing = { ...(this.data.cacheRefreshing || {}), [key]: true };
    this.setData({ cacheRefreshing: nextRefreshing, cacheError: '' });

    try {
      const result = await AdminService.bumpCacheVersion(key);
      const features = normalizeFeatures(result && result.features);
      const updatedRefreshing = { ...nextRefreshing };
      delete updatedRefreshing[key];
      this.setData({
        features,
        cacheRefreshing: updatedRefreshing,
        cacheError: ''
      });
      wx.showToast({ title: '已刷新', icon: 'success', duration: 800 });
    } catch (error) {
      const updatedRefreshing = { ...(this.data.cacheRefreshing || {}) };
      delete updatedRefreshing[key];
      this.setData({
        cacheRefreshing: updatedRefreshing,
        cacheError: resolveErrorMessage(error, '刷新失败，请稍后重试')
      });
      wx.showToast({ title: '刷新失败', icon: 'none', duration: 1200 });
    }
  },

  async handleSecretRealmReset() {
    if (this.data.secretRealmResetting) {
      return;
    }
    const confirmed = await showConfirmationModal({
      title: '重置秘境进度',
      content: '将清除所有会员的秘境通关记录，确认继续？',
      confirmText: '立即重置',
      cancelText: '取消'
    });
    if (!confirmed) {
      return;
    }

    this.setData({
      secretRealmResetting: true,
      secretRealmResetError: '',
      secretRealmResetSummary: ''
    });

    try {
      const result = await AdminService.resetSecretRealmProgress({ scope: 'global' });
      const updated = Number(result && result.updated);
      const processed = Number(result && result.processed);
      const total = Number(result && result.total);
      const resolvedUpdated = Number.isFinite(updated)
        ? updated
        : Number.isFinite(processed)
        ? processed
        : 0;
      const resolvedTotal = Number.isFinite(total)
        ? total
        : Number.isFinite(processed)
        ? processed
        : Number.isFinite(updated)
        ? updated
        : 0;
      const summary = resolvedTotal
        ? `已重置 ${resolvedUpdated} / ${resolvedTotal} 名会员的秘境进度`
        : `已重置 ${resolvedUpdated} 名会员的秘境进度`;
      this.setData({
        secretRealmResetting: false,
        secretRealmResetSummary: summary,
        secretRealmResetError: ''
      });
      wx.showToast({ title: '重置完成', icon: 'success', duration: 1200 });
    } catch (error) {
      this.setData({
        secretRealmResetting: false,
        secretRealmResetError: resolveErrorMessage(error, '重置失败，请稍后重试')
      });
      wx.showToast({ title: '操作失败', icon: 'none', duration: 1200 });
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

  handleRageFieldChange(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field || !Object.prototype.hasOwnProperty.call(this.data.rageDraft, field)) {
      return;
    }
    const value = event && event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      rageDraft: { ...this.data.rageDraft, [field]: value },
      rageError: ''
    });
  },

  handleRageReset() {
    this.setData({
      rageDraft: { ...this.data.rageDefaults },
      rageError: ''
    });
  },

  async handleRageSubmit() {
    if (this.data.rageSaving) {
      return;
    }
    const { error, payload } = parseRageDraft(this.data.rageDraft);
    if (error) {
      this.setData({ rageError: error });
      wx.showToast({ title: error, icon: 'none', duration: 1500 });
      return;
    }

    this.setData({ rageSaving: true, rageError: '' });

    try {
      const result = await AdminService.updateGameParameters({ rage: payload });
      const features = normalizeFeatures(result && result.features ? result.features : this.data.features);
      const rageDefaultsSource =
        result && result.defaults && result.defaults.rageSettings
          ? result.defaults.rageSettings
          : this.data.rageDefaultValues;
      const responseRage =
        (result && result.rageSettings) ||
        (result && result.gameParameters && result.gameParameters.rage) ||
        payload;
      const rageSettings = cloneRageSettings(responseRage);
      const rageDefaults = cloneRageSettings(rageDefaultsSource);

      this.setData({
        features,
        gameParameters: { rage: rageSettings },
        rageDraft: buildRageDraft(rageSettings),
        rageDefaults: buildRageDraft(rageDefaults),
        rageDefaultValues: rageDefaults,
        rageSaving: false,
        rageError: ''
      });
      wx.showToast({ title: '已更新', icon: 'success', duration: 800 });
    } catch (error) {
      this.setData({
        rageSaving: false,
        rageError: resolveErrorMessage(error, '保存失败，请稍后重试')
      });
      wx.showToast({ title: '保存失败', icon: 'none', duration: 1200 });
    }
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
  },

  async handleTournamentRefreshPlayers() {
    if (this.data.tournamentSaving || this.data.tournamentResetting) {
      wx.showToast({ title: '正在处理中，请稍候', icon: 'none', duration: 1000 });
      return;
    }
    if (this.data.tournamentRefreshingPlayers) {
      wx.showToast({ title: '刷新任务进行中', icon: 'none', duration: 1000 });
      return;
    }

    const confirm = await showConfirmationModal({
      title: '刷新玩家数据',
      content: '将重新同步所有参赛玩家的战斗属性，过程可能耗时较长，执行期间请勿重复操作。是否继续？',
      confirmText: '立即刷新'
    });
    if (!confirm) {
      return;
    }

    this.setData({
      tournamentRefreshingPlayers: true,
      tournamentRefreshError: '',
      tournamentRefreshSummary: '刷新任务进行中…'
    });

    const start = Date.now();
    const aggregator = {
      total: 0,
      processed: 0,
      refreshed: 0,
      failed: 0,
      firstError: ''
    };
    let cursor = '';
    let hasMore = true;

    const updateProgressSummary = () => {
      if (aggregator.total > 0) {
        const processed = Math.min(aggregator.processed, aggregator.total);
        return `刷新中：${processed}/${aggregator.total} 名玩家`;
      }
      if (aggregator.processed > 0) {
        return `刷新中：已处理 ${aggregator.processed} 名玩家`;
      }
      return '刷新任务进行中…';
    };

    try {
      while (hasMore) {
        const result = await AdminService.refreshImmortalTournamentPlayers({
          cursor,
          batchSize: 1,
          total: aggregator.total || undefined,
          processed: aggregator.processed,
          refreshed: aggregator.refreshed,
          failed: aggregator.failed
        });

        if (Number.isFinite(result && result.total)) {
          aggregator.total = Math.max(0, Number(result.total));
        }

        if (Number.isFinite(result && result.processedTotal)) {
          aggregator.processed = Math.max(aggregator.processed, Number(result.processedTotal));
        } else if (Number.isFinite(result && result.processed)) {
          aggregator.processed += Math.max(0, Number(result.processed));
        }

        if (Number.isFinite(result && result.refreshedTotal)) {
          aggregator.refreshed = Math.max(aggregator.refreshed, Number(result.refreshedTotal));
        } else if (Number.isFinite(result && result.refreshed)) {
          aggregator.refreshed += Math.max(0, Number(result.refreshed));
        }

        if (Number.isFinite(result && result.failedTotal)) {
          aggregator.failed = Math.max(aggregator.failed, Number(result.failedTotal));
        } else if (Number.isFinite(result && result.failed)) {
          aggregator.failed += Math.max(0, Number(result.failed));
        }

        if (!aggregator.firstError && result && Array.isArray(result.errors) && result.errors.length) {
          const firstError = result.errors.find((item) => item && item.message);
          if (firstError && firstError.message) {
            aggregator.firstError = firstError.message;
          }
        }

        this.setData({
          tournamentRefreshSummary: updateProgressSummary()
        });

        const nextCursor = result && typeof result.cursor === 'string' ? result.cursor : '';
        const moreFlag = !!(result && result.hasMore && nextCursor && nextCursor !== cursor);
        const remaining = Number.isFinite(result && result.remaining)
          ? Math.max(0, Number(result.remaining))
          : aggregator.total > 0
          ? Math.max(0, aggregator.total - aggregator.processed)
          : 0;

        if (moreFlag && (remaining > 0 || aggregator.total === 0)) {
          cursor = nextCursor;
          hasMore = true;
        } else {
          hasMore = false;
        }
      }

      const durationMs = Math.max(0, Date.now() - start);
      const durationSeconds = Math.max(0, Math.round(durationMs / 1000));
      let durationText = '';
      if (durationSeconds <= 1) {
        durationText = '约 1 秒';
      } else if (durationSeconds < 60) {
        durationText = `约 ${durationSeconds} 秒`;
      } else if (durationSeconds < 3600) {
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        durationText = seconds ? `约 ${minutes} 分 ${seconds} 秒` : `约 ${minutes} 分`;
      } else {
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        durationText = minutes ? `约 ${hours} 小时 ${minutes} 分` : `约 ${hours} 小时`;
      }

      const total = aggregator.total;
      const refreshed = aggregator.refreshed;
      const failed = aggregator.failed;
      const summaryText = total
        ? `已刷新 ${Math.min(refreshed, total)}/${total} 名玩家（${durationText}）`
        : refreshed
        ? `已刷新 ${refreshed} 名玩家（${durationText}）`
        : '暂无可刷新的玩家数据';
      const toastTitle = failed > 0
        ? total
          ? `已刷新 ${Math.min(refreshed, total)}/${total}`
          : `已刷新 ${refreshed}`
        : total
        ? '刷新完成'
        : refreshed > 0
        ? '刷新完成'
        : '暂无玩家';
      wx.showToast({ title: toastTitle, icon: failed > 0 || (!total && !refreshed) ? 'none' : 'success', duration: 1200 });

      let refreshError = '';
      if (failed > 0) {
        refreshError = aggregator.firstError || '部分玩家刷新失败，请稍后重试';
      }

      this.setData({
        tournamentRefreshingPlayers: false,
        tournamentRefreshSummary: summaryText,
        tournamentRefreshError: refreshError
      });
    } catch (error) {
      this.setData({
        tournamentRefreshingPlayers: false,
        tournamentRefreshError: resolveErrorMessage(error, '刷新失败，请稍后重试')
      });
      wx.showToast({ title: '刷新失败', icon: 'none', duration: 1200 });
    }
  }
});
