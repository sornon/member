import { ActivityService } from '../../../services/api';
import { buildCloudAssetUrl } from '../../../shared/asset-paths';

const TARGET_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';
const DEFAULT_SEGMENTS = [120, 180, 200, 260, 320, 500];
const COUNTDOWN_INTERVAL = 1000;
const ENCOURAGEMENTS = [
  '好友助力价格还能更低，赶紧喊上小伙伴！',
  '邀请好友帮砍，惊爆价就在前面！',
  '继续分享，越多人助力越容易砍到底！',
  '呼朋唤友来助力，价格还能再低！',
  '好友助力价格还能更低，快去求助一下吧~'
];

function normalizeBargainConfig(config = {}) {
  const startPrice = Number(config.startPrice) || 3500;
  const configuredFloor = Number(config.floorPrice);
  const floorPrice = Number.isFinite(configuredFloor) ? Math.min(configuredFloor, 998) : 998;
  const baseAttempts = Number.isFinite(config.baseAttempts) ? config.baseAttempts : 3;
  const segments = Array.isArray(config.segments) && config.segments.length ? config.segments : DEFAULT_SEGMENTS;
  const assistRewardRange = config.assistRewardRange || { min: 60, max: 180 };
  const assistAttemptCap = Number.isFinite(config.assistAttemptCap) ? config.assistAttemptCap : 6;
  const stock = Number.isFinite(config.stock) ? config.stock : 15;
  const endsAt = config.endsAt || '';
  const heroImage = config.heroImage || buildCloudAssetUrl('background', 'cover-20251102.jpg');
  const perks = Array.isArray(config.perks) ? config.perks : [];
  const vipBonuses = Array.isArray(config.vipBonuses) ? config.vipBonuses : [];
  const displaySegments = Array.isArray(config.displaySegments) ? config.displaySegments : [];
  return {
    startPrice,
    floorPrice,
    baseAttempts,
    segments,
    assistRewardRange,
    assistAttemptCap,
    stock,
    endsAt,
    heroImage,
    perks,
    vipBonuses,
    displaySegments
  };
}

function formatCountdownText(targetTimestamp) {
  if (!targetTimestamp) {
    return '敬请期待';
  }
  const now = Date.now();
  const diff = Math.max(0, targetTimestamp - now);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

Page({
  data: {
    loading: true,
    activity: null,
    bargain: null,
    countdown: '',
    countdownTarget: 0,
    stockRemaining: 15,
    basePrice: 3500,
    currentPrice: 3500,
    priceFloor: 998,
    totalDiscount: 0,
    remainingDiscount: 0,
    remainingSpins: 0,
    baseSpins: 0,
    memberBoost: 0,
    memberRealm: '',
    assistSpins: 0,
    shareCount: 0,
    spinning: false,
    resultOverlay: null,
    segments: DEFAULT_SEGMENTS,
    displaySegments: [],
    activeSegmentIndex: -1,
    helperRecords: [],
    assistLimit: 6,
    showRules: false,
    heroImage: '',
    perks: []
  },

  onLoad(options = {}) {
    const id = typeof options.id === 'string' ? options.id.trim() : '';
    if (id && id !== TARGET_ACTIVITY_ID) {
      wx.redirectTo({ url: `/pages/activities/detail/index?id=${id}` });
      return;
    }
    this.activityId = TARGET_ACTIVITY_ID;
    this.fetchActivityStatus();
  },

  onUnload() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.clearMarquee();
  },

  normalizeDisplaySegments(displaySegments = [], fallbackSegments = []) {
    const source = Array.isArray(displaySegments) && displaySegments.length ? displaySegments : fallbackSegments;
    const normalized = (Array.isArray(source) ? source : DEFAULT_SEGMENTS).map((item) => {
      if (item && typeof item === 'object') {
        const amount = Number.isFinite(item.amount) ? Math.max(0, Math.floor(item.amount)) : null;
        const label = item.label || (amount !== null ? `-¥${amount}` : '???');
        return { amount, label, isMystery: Boolean(item.isMystery) || label.includes('?') };
      }
      const amount = Number(item);
      if (!Number.isFinite(amount)) {
        return { amount: null, label: '???', isMystery: true };
      }
      const safeAmount = Math.max(0, Math.floor(amount));
      return { amount: safeAmount, label: `-¥${safeAmount}` };
    });

    if (!normalized.find((segment) => segment && segment.isMystery)) {
      normalized.push({ amount: null, label: '???', isMystery: true });
    }

    return normalized;
  },

  normalizeSession(session = {}, bargain = {}) {
    const basePrice = Number(bargain.startPrice) || this.data.basePrice || 3500;
    const floor = Number(bargain.floorPrice) || this.data.priceFloor || 998;
    const currentPrice = Number.isFinite(session.currentPrice) ? session.currentPrice : basePrice;
    return {
      currentPrice,
      totalDiscount: Number.isFinite(session.totalDiscount) ? session.totalDiscount : basePrice - currentPrice,
      remainingSpins: Math.max(0, Number(session.remainingSpins) || 0),
      baseSpins: Number.isFinite(session.baseSpins) ? session.baseSpins : bargain.baseAttempts,
      memberBoost: Number.isFinite(session.memberBoost) ? session.memberBoost : 0,
      memberRealm: session.memberRealm || '',
      assistSpins: Math.max(0, Number(session.assistSpins) || 0),
      shareCount: Math.max(0, Number(session.shareCount) || 0),
      helperRecords: Array.isArray(session.helperRecords) ? session.helperRecords : [],
      remainingDiscount: Number.isFinite(session.remainingDiscount)
        ? Math.max(0, session.remainingDiscount)
        : Math.max(0, currentPrice - floor)
    };
  },

  applySession(session = {}, bargain = {}, activity = this.data.activity) {
    const displaySegments = this.normalizeDisplaySegments(bargain.displaySegments, bargain.segments);
    const countdownTarget = bargain.endsAt ? Date.parse(bargain.endsAt) : 0;
    this.setData({
      loading: false,
      activity,
      bargain,
      stockRemaining: bargain.stock,
      basePrice: bargain.startPrice,
      priceFloor: bargain.floorPrice,
      currentPrice: session.currentPrice,
      totalDiscount: session.totalDiscount,
      remainingDiscount: session.remainingDiscount,
      remainingSpins: session.remainingSpins,
      baseSpins: session.baseSpins,
      memberBoost: session.memberBoost,
      memberRealm: session.memberRealm,
      assistSpins: session.assistSpins,
      shareCount: session.shareCount,
      helperRecords: session.helperRecords,
      segments: bargain.segments,
      displaySegments,
      assistLimit: bargain.assistAttemptCap,
      countdownTarget,
      countdown: countdownTarget ? formatCountdownText(countdownTarget) : '敬请期待',
      heroImage: bargain.heroImage,
      perks: bargain.perks
    });
    this.startCountdown();
  },

  clearMarquee() {
    if (this.marqueeTimer) {
      clearInterval(this.marqueeTimer);
      this.marqueeTimer = null;
    }
  },

  startMarquee() {
    this.clearMarquee();
    const total = (this.data.displaySegments && this.data.displaySegments.length) || 1;
    let current = this.data.activeSegmentIndex >= 0 ? this.data.activeSegmentIndex : 0;
    this.setData({ activeSegmentIndex: current });
    this.marqueeTimer = setInterval(() => {
      current = (current + 1) % total;
      this.setData({ activeSegmentIndex: current });
    }, 120);
  },

  settleMarquee(targetIndex, callback) {
    const total = (this.data.displaySegments && this.data.displaySegments.length) || 1;
    const target = Math.max(0, Number(targetIndex) || 0) % total;
    const delay = 120 * (total * 2 + 2);
    setTimeout(() => {
      this.clearMarquee();
      this.setData({ activeSegmentIndex: target });
      if (typeof callback === 'function') {
        callback();
      }
    }, delay);
  },

  pickEncouragement() {
    const list = ENCOURAGEMENTS;
    if (!Array.isArray(list) || !list.length) {
      return '好友助力价格还能更低，快去求助一下吧~';
    }
    const index = Math.floor(Math.random() * list.length);
    return list[index] || list[0];
  },

  async fetchActivityStatus() {
    this.setData({ loading: true, resultOverlay: null });
    try {
      const response = await ActivityService.bargainStatus(this.activityId);
      const activity = response && response.activity ? response.activity : null;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      this.applySession(session, bargain, activity);
    } catch (error) {
      console.error('[bhk-bargain] fetch activity failed', error);
      this.setData({
        loading: false,
        activity: null,
        bargain: null
      });
    }
  },

  startCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    if (!this.data.countdownTarget) {
      return;
    }
    this.countdownTimer = setInterval(() => {
      this.setData({ countdown: formatCountdownText(this.data.countdownTarget) });
    }, COUNTDOWN_INTERVAL);
  },

  closeResultOverlay() {
    this.setData({ resultOverlay: null });
  },

  async handleSpin() {
    const { spinning, remainingSpins } = this.data;
    if (spinning || remainingSpins <= 0) {
      return;
    }
    this.setData({ spinning: true, resultOverlay: null });
    this.startMarquee();
    try {
      const response = await ActivityService.bargainSpin(this.activityId);
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      const landingIndex = Number.isFinite(response && response.landingIndex)
        ? response.landingIndex
        : (bargain.displaySegments || []).length - 1;
      const overlay = {
        amount: Number.isFinite(response && response.amount) ? response.amount : 0,
        message: (response && response.message) || this.pickEncouragement()
      };
      this.applySession(session, bargain, response && response.activity ? response.activity : this.data.activity);
      this.settleMarquee(landingIndex, () => {
        this.setData({ spinning: false, resultOverlay: overlay });
      });
    } catch (error) {
      console.error('[bhk-bargain] spin failed', error);
      wx.showToast({ title: error.errMsg || '抽奖失败', icon: 'none' });
      this.clearMarquee();
      this.setData({ spinning: false });
    }
  },

  async handleRecordAssist() {
    if (this.data.spinning) {
      return;
    }
    if (this.data.assistSpins >= this.data.assistLimit) {
      wx.showToast({ title: '助力次数已达上限', icon: 'none' });
      return;
    }
    this.setData({ spinning: true, resultOverlay: null });
    this.startMarquee();
    try {
      const response = await ActivityService.bargainAssist(this.activityId);
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      const landingIndex = Number.isFinite(response && response.landingIndex)
        ? response.landingIndex
        : (bargain.displaySegments || []).length - 1;
      const overlay = {
        amount: Number.isFinite(response && response.amount) ? response.amount : 0,
        message: (response && response.message) || this.pickEncouragement()
      };
      this.applySession(session, bargain, response && response.activity ? response.activity : this.data.activity);
      this.settleMarquee(landingIndex, () => {
        this.setData({ spinning: false, resultOverlay: overlay });
      });
    } catch (error) {
      console.error('[bhk-bargain] assist failed', error);
      wx.showToast({ title: error.errMsg || '助力失败', icon: 'none' });
      this.clearMarquee();
      this.setData({ spinning: false });
    }
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  handlePurchase() {
    if (this.data.stockRemaining <= 0) {
      wx.showToast({ title: '已售罄，感谢关注', icon: 'none' });
      return;
    }
    if (this.data.remainingSpins > 0 && this.data.currentPrice > this.data.priceFloor) {
      wx.showModal({
        title: '继续砍价？',
        content: '还有砍价机会未用完，确定现在以当前价购买吗？',
        confirmText: '确认购票',
        success: (res) => {
          if (res.confirm) {
            this.confirmPurchase();
          }
        }
      });
      return;
    }
    this.confirmPurchase();
  },

  confirmPurchase() {
    wx.showToast({
      title: '已锁定席位，稍后进入支付流程',
      icon: 'none'
    });
  },

  onShareAppMessage() {
    const title = (this.data.activity && this.data.activity.title) || 'BHK56 限量品鉴会砍价购票';
    const path = `/pages/activities/bhk-bargain/index?id=${this.activityId}`;
    return {
      title,
      path,
      imageUrl: this.data.heroImage
    };
  },

  onShareTimeline() {
    const title = (this.data.activity && this.data.activity.title) || 'BHK56 限量品鉴会砍价购票';
    return {
      title,
      query: `id=${this.activityId}`,
      imageUrl: this.data.heroImage
    };
  }
});
