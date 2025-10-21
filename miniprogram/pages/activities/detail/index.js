import { ActivityService } from '../../../services/api';
import { decorateActivity } from '../../../shared/activity';

function buildShareImage(activity) {
  if (activity && typeof activity.coverImage === 'string' && activity.coverImage.trim()) {
    return activity.coverImage;
  }
  return '';
}

function buildShareTitle(activity) {
  if (activity && typeof activity.title === 'string' && activity.title.trim()) {
    return activity.title;
  }
  return '精彩活动';
}

function buildSharePath(id) {
  const activityId = typeof id === 'string' ? id.trim() : '';
  return `/pages/activities/detail/index?id=${activityId}`;
}

Page({
  data: {
    loading: true,
    activity: null,
    error: ''
  },

  onLoad(options = {}) {
    const id = typeof options.id === 'string' ? options.id.trim() : '';
    this.activityId = id;

    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      });
    }

    if (!id) {
      this.setData({
        loading: false,
        error: '活动不存在或已下架'
      });
      return;
    }

    this.fetchActivity();
  },

  async fetchActivity() {
    if (!this.activityId) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const response = await ActivityService.detail(this.activityId);
      const activity = decorateActivity(response && response.activity);
      if (!activity) {
        throw new Error('活动不存在或已下架');
      }
      this.setData({ activity, loading: false });
    } catch (error) {
      console.error('[activities:detail] fetch failed', error);
      this.setData({
        loading: false,
        error: (error && (error.errMsg || error.message)) || '活动暂不可用'
      });
    }
  },

  handleRetry() {
    if (this.data.loading) {
      return;
    }
    this.fetchActivity();
  },

  handleShareToTimeline() {
    const { activity } = this.data;
    const id = activity ? activity.id : this.activityId || '';
    if (!id) {
      return;
    }
    if (wx.shareTimeline) {
      wx.shareTimeline({
        title: buildShareTitle(activity),
        query: `id=${id}`,
        imageUrl: buildShareImage(activity)
      });
      return;
    }
    wx.showToast({
      title: '请使用右上角菜单分享至朋友圈',
      icon: 'none'
    });
  },

  onShareAppMessage() {
    const { activity } = this.data;
    const id = activity ? activity.id : this.activityId || '';
    return {
      title: buildShareTitle(activity),
      path: buildSharePath(id),
      imageUrl: buildShareImage(activity)
    };
  },

  onShareTimeline() {
    const { activity } = this.data;
    const id = activity ? activity.id : this.activityId || '';
    return {
      title: buildShareTitle(activity),
      query: `id=${id}`,
      imageUrl: buildShareImage(activity)
    };
  }
});
