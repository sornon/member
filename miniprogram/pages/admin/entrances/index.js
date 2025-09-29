import { AdminService } from '../../../services/api';
import {
  buildEntranceOptionGroups,
  createDefaultEntranceConfig,
  formatEntranceTimestamp,
  formatEntranceUpdatedBy,
  mergeEntranceConfig
} from '../../../shared/entrance-config';

function resolveEntranceConfig(response, fallback) {
  if (response && typeof response === 'object') {
    const payload = response.config || response;
    if (payload && typeof payload === 'object') {
      return mergeEntranceConfig(createDefaultEntranceConfig(), payload);
    }
  }
  if (fallback && typeof fallback === 'object') {
    return mergeEntranceConfig(createDefaultEntranceConfig(), fallback);
  }
  return createDefaultEntranceConfig();
}

Page({
  data: {
    loading: true,
    saving: false,
    dirty: false,
    config: createDefaultEntranceConfig(),
    groups: buildEntranceOptionGroups(createDefaultEntranceConfig()),
    lastUpdatedAt: '',
    lastUpdatedBy: ''
  },

  onLoad() {
    this.loadSettings();
  },

  async onPullDownRefresh() {
    try {
      await this.loadSettings();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const response = await AdminService.getEntranceSettings();
      const config = resolveEntranceConfig(response, this.data.config);
      this.setData({
        loading: false,
        config,
        groups: buildEntranceOptionGroups(config),
        dirty: false,
        lastUpdatedAt: formatEntranceTimestamp(response && response.updatedAt),
        lastUpdatedBy: formatEntranceUpdatedBy(response && response.updatedByMember)
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
  },

  handleToggleChange(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset : {};
    const detail = event && event.detail ? event.detail : {};
    const group = dataset.group;
    const key = dataset.key;
    if (!group || !key) {
      return;
    }
    const enabled = !!detail.value;
    const currentGroup = (this.data.config && this.data.config[group]) || {};
    const previousValue = !!currentGroup[key];
    if (previousValue === enabled) {
      return;
    }
    const patch = { [group]: { [key]: enabled } };
    const updatedConfig = mergeEntranceConfig(this.data.config, patch);
    this.setData({
      config: updatedConfig,
      groups: buildEntranceOptionGroups(updatedConfig),
      dirty: true
    });
  },

  async handleSave() {
    if (this.data.saving || !this.data.dirty) {
      return;
    }
    this.setData({ saving: true });
    try {
      const response = await AdminService.updateEntranceSettings(this.data.config);
      const config = resolveEntranceConfig(response, this.data.config);
      this.setData({
        saving: false,
        dirty: false,
        config,
        groups: buildEntranceOptionGroups(config),
        lastUpdatedAt: formatEntranceTimestamp(response && response.updatedAt),
        lastUpdatedBy: formatEntranceUpdatedBy(response && response.updatedByMember)
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  }
});
