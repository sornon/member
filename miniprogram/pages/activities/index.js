import { ActivityService } from '../../services/api';
import { decorateActivity } from '../../shared/activity';
const { ensureHomeEntryEnabled } = require('../../utils/home-entry-guard');

function resolveActivityRoute(activity = {}) {
  if (!activity || typeof activity !== 'object') {
    return '/pages/activities/detail/index';
  }
  const activityType = typeof activity.activityType === 'string' ? activity.activityType.trim() : '';
  if (activityType === 'bargain') {
    return '/pages/activities/bhk-bargain/index';
  }
  return '/pages/activities/detail/index';
}

Page({
  data: {
    homeEntryBlocked: false,
    loading: true,
    activities: [],
    error: ''
  },

  onLoad() {
    if (!ensureHomeEntryEnabled('activities')) {
      this.setData({ homeEntryBlocked: true });
      return;
    }
  },

  onShow() {
    if (this.data.homeEntryBlocked) {
      return;
    }
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

  handleViewDetail(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const activity = Array.isArray(this.data.activities) ? this.data.activities.find((item) => item && item.id === id) : null;
    const url = resolveActivityRoute(activity || {});
    wx.navigateTo({ url: `${url}?id=${id}` });
  }
});
