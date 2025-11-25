import { ActivityService, MemberService } from '../../../services/api';
import { buildCloudAssetUrl } from '../../../shared/asset-paths';

const TARGET_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';
const DEFAULT_SEGMENTS = [120, 180, 200, 260, 320, 500];
const COUNTDOWN_INTERVAL = 1000;

function resolveRealmOrder(level = {}) {
  const { realmOrder, order } = level || {};
  if (Number.isFinite(realmOrder)) {
    return Math.max(1, Math.floor(realmOrder));
  }
  if (Number.isFinite(order)) {
    return Math.max(1, Math.floor(order));
  }
  return 1;
}

function normalizeBargainConfig(config = {}) {
  const startPrice = Number(config.startPrice) || 3500;
  const floorPrice = Number(config.floorPrice) || 1288;
  const baseAttempts = Number.isFinite(config.baseAttempts) ? config.baseAttempts : 3;
  const segments = Array.isArray(config.segments) && config.segments.length ? config.segments : DEFAULT_SEGMENTS;
  const assistRewardRange = config.assistRewardRange || { min: 60, max: 180 };
  const assistAttemptCap = Number.isFinite(config.assistAttemptCap) ? config.assistAttemptCap : 6;
  const stock = Number.isFinite(config.stock) ? config.stock : 15;
  const endsAt = config.endsAt || '';
  const heroImage = config.heroImage || buildCloudAssetUrl('background', 'cover-20251102.jpg');
  const perks = Array.isArray(config.perks) ? config.perks : [];
  const vipBonuses = Array.isArray(config.vipBonuses) ? config.vipBonuses : [];
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
    vipBonuses
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
    priceFloor: 1288,
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
    this.fetchMemberBoost();
    this.fetchActivity();
  },

  onUnload() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  async fetchMemberBoost() {
    try {
      const progress = await MemberService.getLevelProgress();
      const level = progress && progress.currentLevel ? progress.currentLevel : null;
      const realmOrder = resolveRealmOrder(level);
      const boost = realmOrder >= 7 ? 2 : realmOrder >= 4 ? 1 : 0;
      const realm = (level && (level.realm || level.realmName)) || '';
      this.setData({ memberBoost: boost, memberRealm: realm });
      this.recalculateSpins(boost);
    } catch (error) {
      console.warn('[bhk-bargain] resolve member boost failed', error);
    }
  },

  async fetchActivity() {
    this.setData({ loading: true, resultOverlay: null });
    try {
      const response = await ActivityService.detail(this.activityId);
      const activity = response && response.activity ? response.activity : null;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const remainingSpins = bargain.baseAttempts + this.data.memberBoost + this.data.assistSpins;
      const remainingDiscount = Math.max(0, bargain.startPrice - bargain.floorPrice);
      const countdownTarget = bargain.endsAt ? Date.parse(bargain.endsAt) : 0;
      this.setData({
        loading: false,
        activity,
        bargain,
        stockRemaining: bargain.stock,
        basePrice: bargain.startPrice,
        currentPrice: bargain.startPrice,
        priceFloor: bargain.floorPrice,
        totalDiscount: 0,
        remainingDiscount,
        remainingSpins,
        baseSpins: bargain.baseAttempts,
        segments: bargain.segments,
        assistLimit: bargain.assistAttemptCap,
        countdownTarget,
        countdown: countdownTarget ? formatCountdownText(countdownTarget) : '敬请期待',
        heroImage: bargain.heroImage,
        perks: bargain.perks
      });
      this.startCountdown();
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

  recalculateSpins(boost = this.data.memberBoost) {
    const { baseSpins, assistSpins } = this.data;
    const updated =
      Math.max(0, Number(baseSpins || 0)) + Math.max(0, Number(boost || 0)) + Math.max(0, Number(assistSpins || 0));
    this.setData({ remainingSpins: updated });
  },

  handleSpin() {
    const { spinning, remainingSpins, segments, currentPrice, priceFloor, totalDiscount } = this.data;
    if (spinning || remainingSpins <= 0) {
      return;
    }
    const slice = segments[Math.floor(Math.random() * segments.length)] || 0;
    const availableCut = Math.max(0, currentPrice - priceFloor);
    const cut = Math.min(slice, availableCut);
    const nextPrice = Math.max(priceFloor, currentPrice - cut);
    this.setData({ spinning: true });
    setTimeout(() => {
      const nextRemainingSpins = Math.max(0, remainingSpins - 1);
      const nextTotalDiscount = totalDiscount + cut;
      const remainingDiscount = Math.max(0, nextPrice - priceFloor);
      this.setData({
        spinning: false,
        remainingSpins: nextRemainingSpins,
        currentPrice: nextPrice,
        totalDiscount: nextTotalDiscount,
        remainingDiscount,
        resultOverlay: {
          amount: cut,
          message: cut > 0 ? '恭喜砍价成功！' : '再接再厉，继续抽取优惠~'
        }
      });
    }, 900);
  },

  closeResultOverlay() {
    this.setData({ resultOverlay: null });
  },

  handleRecordAssist() {
    const { assistSpins, assistLimit, shareCount, bargain, currentPrice, priceFloor, totalDiscount } = this.data;
    if (assistSpins >= assistLimit) {
      wx.showToast({ title: '助力次数已达上限', icon: 'none' });
      return;
    }
    const range = (bargain && bargain.assistRewardRange) || { min: 60, max: 180 };
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 0;
    const reward = Math.floor(Math.random() * (max - min + 1)) + min;
    const availableCut = Math.max(0, currentPrice - priceFloor);
    const cut = Math.min(reward, availableCut);
    const nextPrice = Math.max(priceFloor, currentPrice - cut);
    const remainingDiscount = Math.max(0, nextPrice - priceFloor);
    const record = {
      id: `${Date.now()}_${assistSpins}`,
      amount: cut,
      avatar: buildCloudAssetUrl('avatar', 'default.png'),
      nickname: `助力好友 ${shareCount + 1}`
    };
    const helperRecords = [record, ...this.data.helperRecords].slice(0, 6);
    this.setData({
      assistSpins: assistSpins + 1,
      shareCount: shareCount + 1,
      remainingSpins: this.data.remainingSpins + 1,
      currentPrice: nextPrice,
      totalDiscount: totalDiscount + cut,
      remainingDiscount,
      helperRecords
    });
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
