import { AdminService } from '../../../services/api';

const SECTION_LABELS = {
  level: '等级成长/属性曲线',
  equipment: '装备强化成长',
  skill: '技能资源与控制',
  pve: 'PVE 秘境与怪物',
  pvp: 'PVP 赛季与匹配'
};

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  const segments = path.split('.');
  let current = obj;
  for (let i = 0; i < segments.length; i += 1) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[segments[i]];
  }
  return current;
}

function setValueByPath(obj, path, value) {
  const segments = path.split('.');
  let target = obj;
  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (i === segments.length - 1) {
      target[key] = value;
      return;
    }
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target[key] = { ...target[key] };
    Object.setPrototypeOf(target[key], Object.prototype);
    target = target[key];
  }
}

function flattenConfig(source = {}, prefix = '') {
  const fields = [];
  const walk = (value, path) => {
    const currentPath = path;
    if (Array.isArray(value)) {
      fields.push({ path: currentPath, type: 'json', defaultValue: value });
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => {
        walk(value[key], currentPath ? `${currentPath}.${key}` : key);
      });
      return;
    }
    fields.push({
      path: currentPath,
      type: typeof value === 'number' ? 'number' : 'text',
      defaultValue: value
    });
  };
  walk(source, prefix);
  return fields;
}

function buildSections(defaults = {}, staging = {}) {
  return Object.keys(SECTION_LABELS).map((key) => {
    const base = defaults[key] || {};
    const fields = flattenConfig(base);
    return {
      key,
      title: SECTION_LABELS[key] || key,
      fields: fields.map((field) => ({
        ...field,
        hint: `默认值：${field.defaultValue === undefined ? '无' : field.defaultValue}`,
        value: getValueByPath(staging[key] || {}, field.path),
        displayValue:
          field.type === 'json'
            ? (() => {
                const current = getValueByPath(staging[key] || {}, field.path);
                if (!current) return '';
                try {
                  return JSON.stringify(current, null, 2);
                } catch (error) {
                  return '';
                }
              })()
            : undefined
      }))
    };
  });
}

Page({
  data: {
    loading: true,
    saving: false,
    testing: false,
    applying: false,
    sections: [],
    stagingConfig: {},
    activeConfig: {},
    defaults: {},
    activeMetadata: {},
    stagingMetadata: {},
    testReport: null,
    testRounds: 12
  },

  onLoad() {
    this.loadConfig();
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const result = await AdminService.getBalanceConfig();
      const defaults = result && result.defaults ? result.defaults : {};
      const stagingConfig = (result && result.staging && result.staging.config) || defaults;
      const sections = buildSections(defaults, stagingConfig);
      this.setData({
        sections,
        defaults,
        stagingConfig,
        activeConfig: (result && result.active && result.active.config) || defaults,
        activeMetadata: (result && result.active && result.active.metadata) || {},
        stagingMetadata: (result && result.staging && result.staging.metadata) || {},
        loading: false
      });
    } catch (error) {
      console.error('load balance config failed', error);
      wx.showToast({ title: '加载配置失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  handleRoundsChange(event) {
    const value = Number(event.detail.value);
    this.setData({ testRounds: Number.isFinite(value) ? value : this.data.testRounds });
  },

  handleFieldChange(event) {
    const { section, path, type } = event.currentTarget.dataset;
    const rawValue = event.detail.value;
    const nextConfig = clone(this.data.stagingConfig || {});
    const sectionConfig = clone(nextConfig[section] || {});
    let value = rawValue;
    if (type === 'number') {
      const numeric = Number(rawValue);
      value = Number.isFinite(numeric) ? numeric : rawValue;
    } else if (type === 'json') {
      try {
        value = rawValue ? JSON.parse(rawValue) : {};
      } catch (error) {
        wx.showToast({ title: 'JSON 解析失败', icon: 'none' });
        return;
      }
    }
    setValueByPath(sectionConfig, path, value);
    nextConfig[section] = sectionConfig;
    const sections = this.data.sections.map((item) => {
      if (item.key !== section) return item;
      return {
        ...item,
        fields: item.fields.map((field) =>
          field.path === path
            ? {
                ...field,
                value: type === 'json' ? value : value,
                displayValue: type === 'json' ? rawValue : field.displayValue
              }
            : field
        )
      };
    });
    this.setData({ stagingConfig: nextConfig, sections });
  },

  async handleSaveDraft() {
    this.setData({ saving: true });
    try {
      const response = await AdminService.saveBalanceDraft(this.data.stagingConfig || {});
      wx.showToast({ title: '已暂存', icon: 'success' });
      const stagingMetadata = {
        updatedBy: response.staging && response.staging.updatedBy,
        updatedByName: response.staging && response.staging.updatedByName,
        updatedAt: new Date()
      };
      this.setData({ stagingMetadata });
    } catch (error) {
      console.error('save balance draft failed', error);
      wx.showToast({ title: error.message || '暂存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async handleTestDraft() {
    this.setData({ testing: true, testReport: null });
    try {
      const report = await AdminService.testBalanceDraft({ rounds: this.data.testRounds });
      const seedText = report && Array.isArray(report.seeds) ? report.seeds.join(', ') : '';
      this.setData({ testReport: { ...report, seedText } });
    } catch (error) {
      console.error('test balance draft failed', error);
      wx.showToast({ title: error.message || '测试失败', icon: 'none' });
    } finally {
      this.setData({ testing: false });
    }
  },

  async handleApplyGlobal() {
    wx.showModal({
      title: '应用到全局',
      content: '确定将暂存的平衡性配置应用到全局吗？',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ applying: true });
        try {
          await AdminService.applyBalanceConfig();
          wx.showToast({ title: '已应用到全局', icon: 'success' });
          this.loadConfig();
        } catch (error) {
          console.error('apply balance config failed', error);
          wx.showToast({ title: error.message || '应用失败', icon: 'none' });
        } finally {
          this.setData({ applying: false });
        }
      }
    });
  }
});
