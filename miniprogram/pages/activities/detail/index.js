import { ActivityService } from '../../../services/api';
import { decorateActivity } from '../../../shared/activity';
const { buildCloudAssetUrl } = require('../../../shared/asset-paths.js');

const app = getApp();

const THANKSGIVING_EVENT_IDS = new Set(['479859146924a70404e4f40e1530f51d'].map((id) => id.toLowerCase()));
const THANKSGIVING_EVENT_TITLE_KEYWORDS = ['BHK56 感恩节', 'BHK56感恩', '感恩节捡漏夜'];
const THANKSGIVING_BACKGROUND_IMAGE = buildCloudAssetUrl('background', '3.jpg');
const THANKSGIVING_SHARE_COVER_IMAGE = buildCloudAssetUrl('background', 'cover-20251102.jpg');

const THANKSGIVING_CUSTOM_CONTENT = {
  heroBadge: '感恩节限定',
  heroTitle: '酒隐之茄 · BHK56 感恩夜',
  heroTagline: '15席内购 · 购票送一支BHK56',
  time: '时间：2024年11月28日 19:30 - 23:30（仅此一晚）',
  entry: '形式：购票入席 · 限量15席',
  dressCode: '风格：Smart Casual / 茄客礼仪',
  feature: '票面赠送 BHK56（市价约￥3500），以门票玩法打造“捡漏”惊喜。',
  tickets: [
    {
      name: 'BHK56 感恩礼遇票',
      price: '￥3500 · 仅15席',
      description:
        '购票即赠1支 BHK56（约￥3500）+ 独立雪茄位 + 软饮畅饮 + 49元五年白兰地畅饮，入场即可回本'
    },
    {
      name: '修仙会员加码',
      price: '筑基/结丹权益',
      description: '筑基期额外+1次随机立减，结丹期额外+3次随机立减，可与分享助力叠加'
    }
  ],
  perks: [
    '伴手礼：BHK56 x1（市价约￥3500），票到手即回本',
    '低成本畅饮：软饮无限 + 49元五年白兰地畅饮，控制成本又有仪式感',
    '限量席位：仅15张门票，售罄即止，制造稀缺冲动',
    '玩法加持：默认3次转盘立减，最低可砍至￥1288，幸运又不失真实'
  ],
  bargain: {
    basePrice: '￥3500 起',
    floorPrice: '￥1288 封顶底价',
    defaultChances: 3,
    mechanic: '内置转盘含￥88 / ￥168 / ￥266 / ￥388 等立减档位，营造“欧皇”体验',
    shareBoost: '每邀请1位好友助力并完成砍价，+1次抽取立减机会（最多叠加3次）',
    membershipBoost: ['筑基期：额外+1次立减机会', '结丹期：额外+3次立减机会', '更高境界：可解锁隐藏彩蛋减免'],
    controlNote: '系统控盘确保底价不低于￥1288，既保留惊喜又守住利润'
  },
  shareHooks: [
    '分享自动生成“3500送BHK56·仅15席”标题，朋友圈一眼击中痛点',
    '好友助力你得额外抽1次，好友也同步获得新手立减，双向诱因',
    '实时席位/倒计时提醒，制造“机不可失”紧迫感'
  ],
  scarcity: '仅剩席位数与预计售罄时间实时露出，促成当场决策',
  backgroundImage: THANKSGIVING_BACKGROUND_IMAGE,
  shareImage: THANKSGIVING_SHARE_COVER_IMAGE
};

const HALLOWEEN_EVENT_IDS = new Set(
  [
    'activity_202510_halloween',
    'activity_20251031_halloween',
    'activity_202510_halloween_private',
    'activity_202410_halloween',
    'activity_20241031_halloween',
    'activity_202410_halloween_private'
  ].map((id) => id.toLowerCase())
);
const HALLOWEEN_EVENT_TITLE_KEYWORDS = ['酒隐之茄——万圣节私人派对', '万圣节私人派对'];
const HALLOWEEN_BACKGROUND_IMAGE = buildCloudAssetUrl('background', 'activity-29251031-2.jpg');
const HALLOWEEN_SHARE_COVER_IMAGE = buildCloudAssetUrl('background', 'cover-20251031.jpg');

const HALLOWEEN_CUSTOM_CONTENT = {
  title: '酒隐之茄——万圣节私人派对',
  time: '时间：2025年10月31日19:00通宵。',
  entry: '邀请制',
  dressCode: 'Cosplay或Smart Casual',
  feature: '关闭大门、全店包场、包房唱K共享。',
  tickets: [
    {
      name: '酒友票',
      price: '599元',
      description:
        '畅饮酒水特调、长相思、雷司令、干红、白兰地吧台自取，不含威士忌与古巴朗姆。（一瓶长相思值回票价）'
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

function matchesThanksgivingActivity(activity = {}) {
  const id = typeof activity.id === 'string' ? activity.id.trim().toLowerCase() : '';
  const title = typeof activity.title === 'string' ? activity.title.trim() : '';
  const matchesId = !!id && THANKSGIVING_EVENT_IDS.has(id);
  const matchesTitle = title && THANKSGIVING_EVENT_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
  return matchesId || matchesTitle;
}

function resolveThanksgivingCustomContent(activity) {
  if (!activity || !matchesThanksgivingActivity(activity)) {
    return null;
  }
  return {
    ...THANKSGIVING_CUSTOM_CONTENT,
    tickets: THANKSGIVING_CUSTOM_CONTENT.tickets.map((ticket) => ({ ...ticket })),
    perks: THANKSGIVING_CUSTOM_CONTENT.perks.slice(),
    shareHooks: THANKSGIVING_CUSTOM_CONTENT.shareHooks.slice(),
    bargain: THANKSGIVING_CUSTOM_CONTENT.bargain
      ? { ...THANKSGIVING_CUSTOM_CONTENT.bargain, membershipBoost: THANKSGIVING_CUSTOM_CONTENT.bargain.membershipBoost.slice() }
      : null,
    backgroundImage: THANKSGIVING_CUSTOM_CONTENT.backgroundImage
  };
}

function matchesHalloweenActivity(activity = {}) {
  const id = typeof activity.id === 'string' ? activity.id.trim().toLowerCase() : '';
  const title = typeof activity.title === 'string' ? activity.title.trim() : '';
  const matchesId =
    !!id && (HALLOWEEN_EVENT_IDS.has(id) || (id.includes('halloween') && id.includes('activity')));
  const matchesTitle = title && HALLOWEEN_EVENT_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
  return matchesId || matchesTitle;
}

function resolveHalloweenCustomContent(activity) {
  if (!activity) {
    return null;
  }
  if (!matchesHalloweenActivity(activity)) {
    return null;
  }
  return {
    ...HALLOWEEN_CUSTOM_CONTENT,
    tickets: HALLOWEEN_CUSTOM_CONTENT.tickets.map((ticket) => ({ ...ticket })),
    backgroundImage: HALLOWEEN_BACKGROUND_IMAGE
  };
}

function buildShareImage(activity) {
  if (matchesThanksgivingActivity(activity)) {
    return THANKSGIVING_SHARE_COVER_IMAGE;
  }
  if (matchesHalloweenActivity(activity)) {
    return HALLOWEEN_SHARE_COVER_IMAGE;
  }
  if (activity && typeof activity.coverImage === 'string' && activity.coverImage.trim()) {
    return activity.coverImage;
  }
  return '';
}

function buildHalloweenFallbackActivity(id) {
  if (!id) {
    return null;
  }
  if (!matchesHalloweenActivity({ id })) {
    return null;
  }
  const fallbackActivity = decorateActivity({
    id,
    title: HALLOWEEN_CUSTOM_CONTENT.title,
    status: 'published'
  });
  const specialActivity = resolveHalloweenCustomContent(fallbackActivity);
  return {
    activity: fallbackActivity,
    specialActivity
  };
}

function buildThanksgivingFallbackActivity(id) {
  if (!id || !matchesThanksgivingActivity({ id })) {
    return null;
  }
  const fallbackActivity = decorateActivity({ id, title: THANKSGIVING_CUSTOM_CONTENT.heroTitle, status: 'published' });
  const specialActivity = resolveThanksgivingCustomContent(fallbackActivity);
  return { activity: fallbackActivity, specialActivity };
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
    specialActivity: null,
    immersiveMode: false,
    navHeight: 0
  },

  onLoad(options = {}) {
    const id = typeof options.id === 'string' ? options.id.trim() : '';
    this.activityId = id;

    const immersiveMode = matchesThanksgivingActivity({ id }) || matchesHalloweenActivity({ id });
    this.setData({ immersiveMode });
    if (immersiveMode) {
      this.ensureNavMetrics();
    }

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
    const fallback =
      buildThanksgivingFallbackActivity(this.activityId) ||
      buildHalloweenFallbackActivity(this.activityId);
    if (fallback) {
      this.setData({
        loading: false,
        error: '',
        activity: fallback.activity,
        specialActivity: fallback.specialActivity,
        immersiveMode: true
      });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const response = await ActivityService.detail(this.activityId);
      const activity = decorateActivity(response && response.activity);
      if (!activity) {
        throw new Error('活动不存在或已下架');
      }
      const specialActivity = resolveThanksgivingCustomContent(activity) || resolveHalloweenCustomContent(activity);
      const immersiveMode = !!specialActivity;
      if (immersiveMode) {
        this.ensureNavMetrics();
      }
      this.setData({ activity, specialActivity, loading: false, immersiveMode });
    } catch (error) {
      console.error('[activities:detail] fetch failed', error);
      const fallback =
        buildThanksgivingFallbackActivity(this.activityId) ||
        buildHalloweenFallbackActivity(this.activityId);
      if (fallback) {
        this.setData({
          loading: false,
          error: '',
          activity: fallback.activity,
          specialActivity: fallback.specialActivity,
          immersiveMode: true
        });
        return;
      }
      this.setData({
        loading: false,
        error: (error && (error.errMsg || error.message)) || '活动暂不可用',
        specialActivity: null,
        immersiveMode: false
      });
    }
  },

  handleRetry() {
    if (this.data.loading) {
      return;
    }
    this.fetchActivity();
  },

  ensureNavMetrics() {
    try {
      const { customNav = {}, safeArea = {} } = (app && app.globalData) || {};
      const statusBarHeight = customNav.statusBarHeight ?? safeArea.top ?? 0;
      const navHeight = customNav.navHeight || (statusBarHeight + 44);
      if (navHeight && navHeight !== this.data.navHeight) {
        this.setData({ navHeight });
      }
    } catch (err) {
      // Ignore failures to resolve navigation metrics.
    }
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
