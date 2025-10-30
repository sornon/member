import { ActivityService } from '../../../services/api';
import { decorateActivity } from '../../../shared/activity';
const { buildCloudAssetUrl } = require('../../../shared/asset-paths.js');

const HALLOWEEN_EVENT_IDS = new Set(
  ['activity_202510_halloween', 'activity_20251031_halloween', 'activity_202510_halloween_private'].map((id) =>
    id.toLowerCase()
  )
);
const HALLOWEEN_EVENT_TITLE_KEYWORDS = ['酒隐之茄——万圣节私人派对', '万圣节古巴之夜'];
const HALLOWEEN_BACKGROUND_IMAGE = buildCloudAssetUrl('background', 'activity-29251031-2.jpg');

const HALLOWEEN_CUSTOM_CONTENT = {
  title: '酒隐之茄——万圣节私人派对',
  time: '时间：2025年10月31日19:00通宵。',
  entry: '邀请制',
  dressCode: 'cosplay或smart casual',
  feature: '关闭大门、全店包场、包房唱K共享。',
  tickets: [
    {
      name: '酒友票',
      price: '599元',
      description:
        '畅饮酒水特调、长相思、雷司令、干红、白兰地吧台自取，不含威士忌与古巴朗姆。（一瓶雷司令值回票价）'
    },
    {
      name: '茄友票',
      price: '899元',
      description: '无酒精特调&软饮畅饮，送一支养5年的世纪6。（一支值回票价）'
    },
    {
      name: '茄酒套票',
      price: '1298元',
      description: '酒友票+茄友票通票（又省200元）'
    }
  ]
};

function resolveHalloweenCustomContent(activity) {
  if (!activity) {
    return null;
  }
  const id = typeof activity.id === 'string' ? activity.id.trim().toLowerCase() : '';
  const title = typeof activity.title === 'string' ? activity.title.trim() : '';
  const matchesId = id && HALLOWEEN_EVENT_IDS.has(id);
  const matchesTitle = title && HALLOWEEN_EVENT_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
  if (!matchesId && !matchesTitle) {
    return null;
  }
  return {
    ...HALLOWEEN_CUSTOM_CONTENT,
    tickets: HALLOWEEN_CUSTOM_CONTENT.tickets.map((ticket) => ({ ...ticket })),
    backgroundImage: HALLOWEEN_BACKGROUND_IMAGE
  };
}

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
    error: '',
    specialActivity: null
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
      const specialActivity = resolveHalloweenCustomContent(activity);
      this.setData({ activity, specialActivity, loading: false });
    } catch (error) {
      console.error('[activities:detail] fetch failed', error);
      this.setData({
        loading: false,
        error: (error && (error.errMsg || error.message)) || '活动暂不可用',
        specialActivity: null
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
