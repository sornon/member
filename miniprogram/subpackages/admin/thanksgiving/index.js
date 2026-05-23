import { AdminService } from '../../../services/api';

function normalizeActivities(list = []) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && item.id)
    .map((item) => ({
      id: item.id,
      title: item.title || '未命名砍价活动',
      status: item.status || 'draft',
      statusLabel: item.statusLabel || '草稿',
      periodLabel: item.periodLabel || '未设置活动时间',
      template: item.template || '',
      summary: item.summary || ''
    }));
}

Page({
  data: {
    loading: true,
    error: '',
    activities: []
  },

  onLoad() {
    this.loadActivities();
  },

  async loadActivities() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await AdminService.listActivities({ includeArchived: true });
      const all = normalizeActivities(result && result.activities);
      const activities = all.filter((item) => item.template === 'thanksgiving-bargain' || item.status !== 'archived');
      this.setData({ loading: false, activities });
    } catch (error) {
      console.error('[admin/bargain] load activities failed', error);
      this.setData({ loading: false, error: (error && error.errMsg) || error.message || '加载失败，请稍后重试' });
    }
  },

  handleRefresh() {
    if (this.data.loading) return;
    this.loadActivities();
  },

  handleActivityTap(event) {
    const { id, title } = event.currentTarget.dataset || {};
    if (!id) return;
    wx.navigateTo({
      url: `/subpackages/admin/thanksgiving-dashboard/index?activityId=${encodeURIComponent(id)}&title=${encodeURIComponent(
        title || '砍价活动'
      )}`
    });
  }
});
