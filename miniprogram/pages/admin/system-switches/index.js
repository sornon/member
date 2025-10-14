import { AdminService } from '../../../services/api';

const DEFAULT_FEATURES = {
  cashierEnabled: true
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

function normalizeFeatures(features) {
  const normalized = { ...DEFAULT_FEATURES };
  if (features && typeof features === 'object') {
    if (Object.prototype.hasOwnProperty.call(features, 'cashierEnabled')) {
      normalized.cashierEnabled = toBoolean(features.cashierEnabled, true);
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
      const result = await AdminService.getSystemFeatures();
      const features = normalizeFeatures(result && result.features);
      this.setData({
        loading: false,
        features,
        error: '',
        updating: {}
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: resolveErrorMessage(error, '加载失败，请稍后重试'),
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
  }
});
