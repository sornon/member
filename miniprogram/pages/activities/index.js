import { ActivityService } from '../../services/api';
import { decorateActivity } from '../../shared/activity';

Page({
  data: {
    loading: true,
    activities: [],
    error: ''
  },

  onShow() {
    this.fetchActivities();
  },

  async fetchActivities() {
    this.setData({ loading: true, error: '' });
    try {
      const response = await ActivityService.list();
      const list = Array.isArray(response && response.activities) ? response.activities : [];
      const activities = list.map((item) => decorateActivity(item)).filter(Boolean);
      this.setData({ activities, loading: false });
    } catch (error) {
      console.error('[activities] fetch failed', error);
      this.setData({
        loading: false,
        error: (error && (error.errMsg || error.message)) || '加载失败，请稍后重试'
      });
    }
  },

  handleRetry() {
    if (this.data.loading) {
      return;
    }
    this.fetchActivities();
  },

  handleActivityTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/activities/detail/index?id=${id}` });
  }
});
