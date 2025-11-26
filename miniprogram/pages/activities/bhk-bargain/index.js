import { ActivityService, MemberService, WalletService } from '../../../services/api';
import { AVATAR_IMAGE_BASE_PATH, buildCloudAssetUrl } from '../../../shared/asset-paths';
import { buildTitleImageUrl, normalizeTitleId } from '../../../shared/titles';

const TARGET_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';
const THANKSGIVING_RIGHT_ID = 'thanksgiving-pass';
const DEFAULT_SEGMENTS = [120, 180, 200, 260, 320, 500];
const DEFAULT_LOCATION = {
  name: '酒隐之茄',
  address: '北京市朝阳区百子湾路16号4号楼B座102',
  latitude: 39.8943,
  longitude: 116.5146
};
const COUNTDOWN_INTERVAL = 1000;
const ENCOURAGEMENTS = [
  '好友助力价格还能更低，赶紧喊上小伙伴！',
  '邀请好友帮砍，惊爆价就在前面！',
  '继续分享，越多人助力越容易砍到底！',
  '呼朋唤友来助力，价格还能再低！',
  '好友助力价格还能更低，快去求助一下吧~'
];
const DIVINE_HAND_KEYWORDS = ['结丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'];
const REALM_REWARD_RULES = [
  { keyword: '炼气', bonus: 1, label: '炼气奖励' },
  { keyword: '筑基', bonus: 4, label: '筑基奖励' },
  { keyword: '结丹', bonus: 4, label: '结丹奖励' }
];
const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;
const DEFAULT_HERO_IMAGE = buildCloudAssetUrl('background', 'activity-20251127-3.jpg');

function resolveNavHeight() {
  const app = getApp();
  const { customNav = {}, safeArea = {} } = (app && app.globalData) || {};
  const statusBarHeight = customNav.statusBarHeight ?? safeArea.top ?? 0;
  const navHeight = customNav.navHeight || (statusBarHeight ? statusBarHeight + 44 : 0);
  return navHeight > 0 ? navHeight : 64;
}

function normalizeBargainConfig(config = {}) {
  const startPrice = Number(config.startPrice) || 3500;
  const baseAttempts = Number.isFinite(config.baseAttempts) ? config.baseAttempts : 3;
  const segments = Array.isArray(config.segments) && config.segments.length ? config.segments : DEFAULT_SEGMENTS;
  const assistRewardRange = config.assistRewardRange || { min: 60, max: 180 };
  const assistAttemptCap = Number.isFinite(config.assistAttemptCap) ? config.assistAttemptCap : 6;
  const stock = Number.isFinite(config.stock) ? config.stock : 0;
  const endsAt = config.endsAt || '';
  // 感恩节主题的背景图需固定为本地常量，避免云端沿用旧活动（如万圣节）的 heroImage 覆盖
  const heroImage = DEFAULT_HERO_IMAGE;
  const perks = Array.isArray(config.perks) ? config.perks : [];
  const vipBonuses = Array.isArray(config.vipBonuses) ? config.vipBonuses : [];
  const displaySegments = Array.isArray(config.displaySegments) ? config.displaySegments : [];
  const floorPrice = Number.isFinite(config.floorPrice) ? Math.max(0, config.floorPrice) : 998;
  return {
    startPrice,
    baseAttempts,
    segments,
    assistRewardRange,
    assistAttemptCap,
    stock,
    endsAt,
    heroImage,
    perks,
    vipBonuses,
    displaySegments,
    floorPrice
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

function resolveRealmTier(realmName = '', memberBoost = 0) {
  const normalized = (realmName || '').trim();
  if (!normalized) {
    return null;
  }
  const isDivine = DIVINE_HAND_KEYWORDS.some((keyword) => normalized.includes(keyword)) || Number(memberBoost) >= 3;
  if (isDivine) {
    return { type: 'divine', label: '神之一手', bonus: 0 };
  }
  const matched = REALM_REWARD_RULES.find((item) => normalized.includes(item.keyword));
  if (matched) {
    return { ...matched, type: 'boost' };
  }
  return null;
}

function normalizeRealmReward(session = {}) {
  const realmName = (session.memberRealm || '').trim();
  const baseReward = {
    type: 'none',
    label: realmName ? `${realmName} 奖励` : '境界奖励',
    description: '认证修仙境界即可解锁额外砍价奖励',
    total: 0,
    remaining: 0,
    ready: false,
    used: false,
    realmName
  };

  const sessionReward = session.realmReward;
  if (sessionReward && typeof sessionReward === 'object') {
    const type = sessionReward.type === 'divine' ? 'divine' : sessionReward.type === 'boost' ? 'boost' : 'none';
    const total = Number.isFinite(sessionReward.total) ? Math.max(0, Math.floor(sessionReward.total)) : 0;
    const remaining = Number.isFinite(sessionReward.remaining)
      ? Math.max(0, Math.floor(sessionReward.remaining))
      : total;
    const ready =
      typeof sessionReward.ready === 'boolean'
        ? sessionReward.ready
        : type === 'divine'
          ? false
          : remaining > 0;
    const used = Boolean(sessionReward.used);
    return {
      ...baseReward,
      type,
      label: sessionReward.label || baseReward.label,
      description:
        sessionReward.description ||
        (type === 'divine' ? '必中隐藏奖池，直接抵达 998 底价' : '境界额外砍价次数'),
      total,
      remaining,
      ready: used ? false : ready,
      used
    };
  }

  const tier = resolveRealmTier(realmName, session.memberBoost);
  if (!tier) {
    return baseReward;
  }

  if (tier.type === 'divine') {
    const remaining = Number.isFinite(session.divineHandRemaining)
      ? Math.max(0, Math.floor(session.divineHandRemaining))
      : session.remainingSpins <= 0
        ? 1
        : 0;
    const used = Boolean(session.divineHandUsed);
    return {
      ...baseReward,
      type: 'divine',
      label: '神之一手',
      description: '所有奖励用尽后仍可必中神秘奖池，直降至 998 底价',
      total: Math.max(1, remaining),
      remaining,
      ready: remaining > 0 && !used,
      used
    };
  }

  const total = tier.bonus;
  const remaining = Number.isFinite(session.realmBonusRemaining)
    ? Math.max(0, Math.floor(session.realmBonusRemaining))
    : total;
  return {
    ...baseReward,
    type: 'boost',
    label: `${tier.label} +${total}`,
    description: '境界额外砍价次数，先用完再触发神之一手',
    total,
    remaining,
    ready: remaining > 0
  };
}

function normalizeShareContext(context = {}) {
  if (!context || typeof context !== 'object') {
    return null;
  }
  const helpers = (Array.isArray(context.helpers) ? context.helpers : []).map((helper) => {
    const titleId = normalizeTitleId(helper.titleId || helper.titleName || '');
    const titleImage = buildTitleImageUrl(titleId);
    return {
      ...helper,
      titleId,
      titleImage
    };
  });
  return { ...context, helpers };
}

function resolveMysteryLanding(displaySegments = []) {
  if (!Array.isArray(displaySegments) || !displaySegments.length) {
    return 0;
  }
  const index = displaySegments.findIndex((item) => item && (item.isMystery || (item.label || '').includes('?')));
  return index >= 0 ? index : displaySegments.length - 1;
}

function resolveTimelineCapability() {
  const canShareTimeline =
    (typeof wx.canIUse === 'function' && wx.canIUse('shareTimeline')) || typeof wx.shareTimeline === 'function';
  if (!canShareTimeline) {
    return { supported: false, message: '当前微信版本不支持朋友圈小程序卡片，请从右上角菜单分享' };
  }

  let envVersion = 'release';
  if (typeof wx.getAccountInfoSync === 'function') {
    try {
      const accountInfo = wx.getAccountInfoSync();
      envVersion = (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion) || 'release';
    } catch (error) {
      console.warn('[bhk-bargain] getAccountInfoSync failed', error);
    }
  }

  if (envVersion !== 'release') {
    return {
      supported: true,
      envVersion,
      message: '朋友圈卡片只会拉起线上正式版，请发布正式版后在正式版内测试'
    };
  }

  return { supported: true, envVersion };
}

function isCloudPermissionDenied(error) {
  const code = typeof error === 'object' && error ? error.errCode : null;
  const message = (error && (error.errMsg || error.message || '')) || '';
  if (code === -501023) {
    return true;
  }
  const normalized = message.toLowerCase();
  return normalized.includes('permission denied') || normalized.includes('unauthenticated access');
}

Page({
  data: {
    loading: true,
    navHeight: 64,
    member: null,
    defaultAvatar: DEFAULT_AVATAR,
    activity: null,
    bargain: null,
    countdown: '',
    countdownTarget: 0,
    stockRemaining: 0,
    basePrice: 3500,
    currentPrice: 3500,
    totalDiscount: 0,
    remainingSpins: 0,
    baseSpins: 0,
    memberBoost: 0,
    memberRealm: '',
    memberTitleImage: '',
    memberTitleName: '',
    realmReward: normalizeRealmReward(),
    divineHandReady: false,
    floorReached: false,
    spinning: false,
    resultOverlay: null,
    segments: DEFAULT_SEGMENTS,
    displaySegments: [],
    floorPrice: 998,
    activeSegmentIndex: -1,
    showRules: false,
    heroImage: DEFAULT_HERO_IMAGE,
    perks: [],
    mapLocation: DEFAULT_LOCATION,
    shareContext: null,
    memberId: '',
    processingPurchase: false,
    ticketOwned: false,
    shareTimelineSupported: true,
    shareTimelineMessage: '',
    singlePageMode: false
  },

  onLoad(options = {}) {
    const id = typeof options.id === 'string' ? options.id.trim() : '';
    if (id && id !== TARGET_ACTIVITY_ID) {
      wx.redirectTo({ url: `/pages/activities/detail/index?id=${id}` });
      return;
    }
    this.setData({ navHeight: resolveNavHeight() });
    this.shareId = typeof options.shareId === 'string' ? options.shareId.trim() : '';
    this.activityId = TARGET_ACTIVITY_ID;
    this._singlePageMarked = false;
    this.setupTimelineCapability();
    this.enableTimelineShare();
    this.bootstrap();
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

  normalizeMapLocation(activity = {}) {
    const address = activity.locationAddress || activity.location || DEFAULT_LOCATION.address;
    const name = activity.locationName || activity.location || DEFAULT_LOCATION.name;
    const latitude = Number(activity.locationLat);
    const longitude = Number(activity.locationLng);
    const hasValidCoords =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      longitude > 115 &&
      longitude < 118 &&
      latitude > 39 &&
      latitude < 41;
    const isLegacyShanghai = /上海|长宁/.test(`${address}${name}`);

    if (isLegacyShanghai) {
      return DEFAULT_LOCATION;
    }

    if (hasValidCoords) {
      return { name: name || DEFAULT_LOCATION.name, address: address || DEFAULT_LOCATION.address, latitude, longitude };
    }

    return { ...DEFAULT_LOCATION, name: name || DEFAULT_LOCATION.name, address: address || DEFAULT_LOCATION.address };
  },

  normalizeSession(session = {}, bargain = {}) {
    const basePrice = Number(bargain.startPrice) || this.data.basePrice || 3500;
    const currentPrice = Number.isFinite(session.currentPrice) ? session.currentPrice : basePrice;
    const realmReward = normalizeRealmReward(session);
    const remainingSpins = Math.max(0, Number(session.remainingSpins) || 0);
    const divineHandReady =
      realmReward && realmReward.type === 'divine'
        ? Boolean(!realmReward.used && (session.divineHandReady || realmReward.ready))
        : false;
    const floorPrice = Number.isFinite(bargain.floorPrice) ? bargain.floorPrice : this.data.floorPrice;
    const floorReached =
      Boolean(session.floorReached) || (Number.isFinite(currentPrice) && Number.isFinite(floorPrice) && currentPrice <= floorPrice);
    const stockRemaining = Number.isFinite(session.stockRemaining)
      ? session.stockRemaining
      : Number.isFinite(bargain.stock)
        ? bargain.stock
        : this.data.stockRemaining;
    return {
      currentPrice,
      totalDiscount: Number.isFinite(session.totalDiscount) ? session.totalDiscount : basePrice - currentPrice,
      remainingSpins,
      baseSpins: Number.isFinite(session.baseSpins) ? session.baseSpins : bargain.baseAttempts,
      memberBoost: Number.isFinite(session.memberBoost) ? session.memberBoost : 0,
      memberRealm: session.memberRealm || '',
      realmReward,
      divineHandReady,
      floorReached,
      stockRemaining,
      ticketOwned: Boolean(session.ticketOwned || session.hasTicket || session.purchased)
    };
  },

  applySession(session = {}, bargain = {}, activity = this.data.activity, extras = {}) {
    const displaySegments = this.normalizeDisplaySegments(bargain.displaySegments, bargain.segments);
    const countdownTarget = bargain.endsAt ? Date.parse(bargain.endsAt) : 0;
    const mapLocation = this.normalizeMapLocation(activity);
    const realmReward = session.realmReward || normalizeRealmReward(session);
    const divineHandReady =
      typeof session.divineHandReady === 'boolean'
        ? session.divineHandReady
        : realmReward && realmReward.type === 'divine' && realmReward.ready && !realmReward.used;
    const shareContext = normalizeShareContext(
      typeof extras.shareContext === 'undefined' ? this.data.shareContext : extras.shareContext
    );
    const ticketOwned =
      typeof session.ticketOwned === 'boolean'
        ? session.ticketOwned
        : typeof extras.ticketOwned === 'boolean'
          ? extras.ticketOwned
          : this.data.ticketOwned;
    const stockRemaining = Number.isFinite(session.stockRemaining)
      ? session.stockRemaining
      : Number.isFinite(extras.stockRemaining)
        ? extras.stockRemaining
        : Number.isFinite(bargain.stock)
          ? bargain.stock
          : this.data.stockRemaining;

    this.setData({
      loading: false,
      activity,
      bargain,
      stockRemaining,
      basePrice: bargain.startPrice,
      currentPrice: session.currentPrice,
      totalDiscount: session.totalDiscount,
      remainingSpins: session.remainingSpins,
      baseSpins: session.baseSpins,
      memberBoost: session.memberBoost,
      memberRealm: session.memberRealm,
      realmReward,
      divineHandReady,
      floorReached: session.floorReached,
      segments: bargain.segments,
      displaySegments,
      floorPrice: bargain.floorPrice,
      countdownTarget,
      countdown: countdownTarget ? formatCountdownText(countdownTarget) : '敬请期待',
      heroImage: bargain.heroImage || DEFAULT_HERO_IMAGE,
      perks: bargain.perks,
      mapLocation,
      shareContext,
      memberId: session.memberId || this.data.memberId,
      ticketOwned
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

  handleOpenLocation() {
    const mapLocation = this.data.mapLocation || DEFAULT_LOCATION;
    if (!mapLocation || !Number.isFinite(mapLocation.latitude) || !Number.isFinite(mapLocation.longitude)) {
      wx.showToast({ title: '暂无法打开地图', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: Number(mapLocation.latitude),
      longitude: Number(mapLocation.longitude),
      name: mapLocation.name || '活动地点',
      address: mapLocation.address || mapLocation.name || '',
      scale: 18
    });
  },

  pickEncouragement() {
    const list = ENCOURAGEMENTS;
    if (!Array.isArray(list) || !list.length) {
      return '好友助力价格还能更低，快去求助一下吧~';
    }
    const index = Math.floor(Math.random() * list.length);
    return list[index] || list[0];
  },

  markSinglePageMode(reason) {
    if (this._singlePageMarked) {
      return true;
    }
    this._singlePageMarked = true;
    if (reason) {
      console.warn('[bhk-bargain] enter single page fallback', reason);
    }
    this.setData({ loading: false, activity: null, bargain: null, singlePageMode: true });
    return true;
  },

  async bootstrap() {
    this.setData({ loading: true, resultOverlay: null });
    if (this.isSinglePageMode()) {
      this.markSinglePageMode('wx.cloud unavailable');
      return;
    }
    await Promise.all([this.ensureMemberProfile(), this.ensureTicketOwnershipFromRights()]);
    return this.fetchActivityStatus({ keepLoading: true });
  },

  async ensureMemberProfile() {
    if (this._singlePageMarked) {
      return null;
    }
    if (this._ensureMemberPromise) {
      return this._ensureMemberPromise;
    }
    const app = getApp();
    try {
      const cachedMember = app && app.globalData ? app.globalData.memberInfo : null;
      if (cachedMember && cachedMember._id) {
        this.applyMemberProfile(cachedMember);
        return cachedMember;
      }
    } catch (error) {
      console.error('[bhk-bargain] read cached member failed', error);
    }

    const promise = MemberService.getMember()
      .then((member) => {
        try {
          if (app && app.globalData) {
            app.globalData.memberInfo = member;
          }
        } catch (error) {
          console.error('[bhk-bargain] cache member failed', error);
        }
        this.applyMemberProfile(member);
        return member;
      })
      .catch((error) => {
        console.error('[bhk-bargain] ensure member failed', error);
        if (isCloudPermissionDenied(error)) {
          this.markSinglePageMode('member profile permission denied');
        }
        return null;
      })
      .finally(() => {
        this._ensureMemberPromise = null;
      });

    this._ensureMemberPromise = promise;
    return promise;
  },

  applyMemberProfile(member) {
    if (!member || typeof member !== 'object') {
      return;
    }
    const titleId = normalizeTitleId(
      member.appearanceTitle || (member.title && (member.title.id || member.title.titleId)) || member.titleId || ''
    );
    const titleImage = buildTitleImageUrl(titleId);
    const titleName = member.titleName || (member.title && (member.title.name || member.title.titleName)) || '';
    const realmName =
      (member.level && member.level.realm) || member.realm || (member.levelName ? member.levelName : '');
    this.setData({
      member,
      memberRealm: realmName || this.data.memberRealm,
      memberTitleImage: titleImage,
      memberTitleName: titleName
    });
  },

  async ensureTicketOwnershipFromRights() {
    if (this._singlePageMarked) {
      return null;
    }
    try {
      const rights = await MemberService.getRights();
      const hasTicket = Array.isArray(rights)
        ? rights.some((item) => (item.rightId || item.key || '').trim() === THANKSGIVING_RIGHT_ID)
        : false;
      if (hasTicket) {
        this._rightSynced = true;
        this.setData({ ticketOwned: true });
      }
      return rights;
    } catch (error) {
      console.error('[bhk-bargain] fetch rights failed', error);
      if (isCloudPermissionDenied(error)) {
        this.markSinglePageMode('rights permission denied');
      }
      return null;
    }
  },

  async fetchActivityStatus(options = {}) {
    const keepLoading = options && options.keepLoading;
    if (!keepLoading) {
      this.setData({ loading: true, resultOverlay: null });
    }
    if (this._singlePageMarked) {
      this.setData({ loading: false, activity: null, bargain: null, singlePageMode: true });
      return null;
    }
    try {
      const response = await ActivityService.bargainStatus(this.activityId, { shareId: this.shareId });
      const activity = response && response.activity ? response.activity : null;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      this.applySession(session, bargain, activity, {
        shareContext: response && response.shareContext,
        ticketOwned: this.data.ticketOwned,
        stockRemaining: this.data.stockRemaining
      });
    } catch (error) {
      console.error('[bhk-bargain] fetch activity failed', error);
      if (isCloudPermissionDenied(error)) {
        this.markSinglePageMode('activity status permission denied');
        return null;
      }
      this.setData({ loading: false, activity: null, bargain: null, singlePageMode: this.isSinglePageMode() || this.data.singlePageMode });
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
    const { spinning, remainingSpins, divineHandReady } = this.data;
    if (spinning || (remainingSpins <= 0 && !divineHandReady)) {
      return;
    }
    if (divineHandReady) {
      await this.triggerDivineHand();
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
      this.settleMarquee(landingIndex, () => {
        this.applySession(
          session,
          bargain,
          response && response.activity ? response.activity : this.data.activity
        );
        this.setData({ spinning: false, resultOverlay: overlay });
      });
    } catch (error) {
      console.error('[bhk-bargain] spin failed', error);
      wx.showToast({ title: error.errMsg || '抽奖失败', icon: 'none' });
      this.clearMarquee();
      this.setData({ spinning: false });
    }
  },

  async triggerDivineHand() {
    if (this.data.spinning || !this.data.divineHandReady) {
      return;
    }
    this.setData({ spinning: true, resultOverlay: null });
    this.startMarquee();
    try {
      const response = await ActivityService.bargainDivineHand(this.activityId);
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      const landingIndex = Number.isFinite(response && response.landingIndex)
        ? response.landingIndex
        : resolveMysteryLanding(bargain.displaySegments);
      const overlay = {
        amount: Number.isFinite(response && response.amount) ? response.amount : 0,
        message: (response && response.message) || '神之一手！必中隐藏奖池，直达底价'
      };
      this.settleMarquee(landingIndex, () => {
        this.applySession(
          session,
          bargain,
          response && response.activity ? response.activity : this.data.activity
        );
        this.setData({ spinning: false, resultOverlay: overlay });
      });
    } catch (error) {
      console.error('[bhk-bargain] divine hand failed', error);
      wx.showToast({ title: error.errMsg || '神之一手不可用', icon: 'none' });
      this.clearMarquee();
      this.setData({ spinning: false });
    }
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  async handleAssist() {
    if (!this.shareId && !(this.data.shareContext && this.data.shareContext.ownerId)) {
      wx.showToast({ title: '助力链接无效', icon: 'none' });
      return;
    }

    const shareId = this.shareId || (this.data.shareContext && this.data.shareContext.ownerId);
    if (!shareId) {
      wx.showToast({ title: '助力链接无效', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '助力中...', mask: true });
    try {
      const response = await ActivityService.bargainAssist(this.activityId, { shareId });
      const activity = response && response.activity ? response.activity : this.data.activity;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      this.applySession(session, bargain, activity, { shareContext: response && response.shareContext });
      wx.showToast({ title: '助力成功，双方+1次', icon: 'success' });
    } catch (error) {
      console.error('[bhk-bargain] assist failed', error);
      wx.showToast({ title: error.errMsg || '助力失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handlePurchase() {
    if (this.data.ticketOwned) {
      wx.showToast({ title: '已获得通行证，无需重复购票', icon: 'none' });
      return;
    }
    if (this.data.stockRemaining <= 0) {
      wx.showToast({ title: '已售罄，感谢关注', icon: 'none' });
      return;
    }
    if (this.data.remainingSpins > 0 && !this.data.floorReached) {
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

  async confirmPurchase() {
    if (this.data.processingPurchase) {
      return;
    }

    // 最新库存/购票状态兜底，避免售罄后仍发起支付
    try {
      const response = await ActivityService.bargainStatus(this.activityId, { shareId: this.shareId });
      const activity = response && response.activity ? response.activity : this.data.activity;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      this.applySession(session, bargain, activity, {
        shareContext: response && response.shareContext,
        ticketOwned: this.data.ticketOwned,
        stockRemaining: this.data.stockRemaining
      });

      if (session.ticketOwned) {
        wx.showToast({ title: '已获得通行证，无需重复购票', icon: 'none' });
        return;
      }
      if (session.stockRemaining <= 0) {
        wx.showToast({ title: '席位已售罄，暂不可支付', icon: 'none' });
        return;
      }
    } catch (error) {
      console.warn('[bhk-bargain] preflight purchase check failed', error);
    }

    const amountYuan = Number(this.data.currentPrice);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
      wx.showToast({ title: '票价无效，暂无法支付', icon: 'none' });
      return;
    }

    const amountInCents = Math.round(amountYuan * 100);
    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      wx.showToast({ title: '票价异常，暂无法支付', icon: 'none' });
      return;
    }

    this.setData({ processingPurchase: true });
    wx.showLoading({ title: '创建订单', mask: true });
    try {
      const result = await WalletService.createRecharge(amountInCents);
      wx.hideLoading();

      if (result.payment && result.payment.paySign === 'MOCK_SIGN') {
        wx.showModal({
          title: '提示',
          content: '当前为示例支付参数，请在云函数 wallet 中接入真实微信支付后再发起支付。',
          showCancel: false
        });
        return;
      }

      const { transactionId } = result;
      wx.requestPayment({
        ...result.payment,
        success: async () => {
          try {
            await WalletService.completeRecharge(transactionId);
            wx.showToast({ title: '支付成功，席位已锁定', icon: 'success' });
            await this.handlePostPaymentSuccess();
          } catch (error) {
            wx.showToast({ title: '支付状态更新失败', icon: 'none' });
            await this.handlePostPaymentSuccess();
          } finally {
            this.fetchActivityStatus({ keepLoading: false });
          }
        },
        fail: (error) => {
          const errMsg = error && error.errMsg ? error.errMsg : '';
          const isCancelled = errMsg.includes('cancel');
          wx.showToast({ title: isCancelled ? '支付已取消' : '支付未完成', icon: 'none' });
          (async () => {
            if (!transactionId) {
              return;
            }
            try {
              await WalletService.failRecharge(transactionId, {
                reason: isCancelled ? '用户取消支付' : errMsg || '支付未完成'
              });
            } catch (failureError) {
              // ignore failRecharge errors in UI flow
            }
          })();
        }
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.errMsg || '支付发起失败', icon: 'none' });
    } finally {
      this.setData({ processingPurchase: false });
    }
  },

  async handlePostPaymentSuccess() {
    let confirmSucceeded = false;
    try {
      const response = await ActivityService.bargainConfirmPurchase(this.activityId);
      const activity = response && response.activity ? response.activity : this.data.activity;
      const bargain = normalizeBargainConfig(response && response.bargainConfig);
      const session = this.normalizeSession(response && response.session, bargain);
      this.applySession(session, bargain, activity, {
        shareContext: response && response.shareContext,
        ticketOwned: true,
        stockRemaining: session.stockRemaining
      });
      confirmSucceeded = true;
    } catch (error) {
      console.error('[bhk-bargain] confirm purchase failed', error);
      const errMsg = (error && (error.errMsg || error.message)) || '';
      const soldOut = errMsg.includes('售罄') || errMsg.includes('stock');
      wx.showToast({ title: soldOut ? '席位已售罄，订单未扣减库存' : '购票状态同步失败', icon: 'none' });
      if (!soldOut) {
        this.setData({
          ticketOwned: true,
          stockRemaining: Math.max(0, Number.isFinite(this.data.stockRemaining) ? this.data.stockRemaining - 1 : 0)
        });
        confirmSucceeded = true;
      }
    }
    if (confirmSucceeded) {
      try {
        await this.ensureThanksgivingRight();
      } catch (error) {
        console.error('[bhk-bargain] sync right failed', error);
        wx.showToast({ title: '权益同步异常，请稍后在权益页查看', icon: 'none' });
      }
    }
  },

  async ensureThanksgivingRight() {
    if (this._rightSynced || this._grantingRight) {
      return null;
    }
    this._grantingRight = true;
    try {
      const result = await MemberService.grantRight({
        rightId: THANKSGIVING_RIGHT_ID,
        key: THANKSGIVING_RIGHT_ID,
        title: '感恩节通行证',
        name: '感恩节通行证',
        description: 'BHK56 感恩节限量品鉴会门票，含活动简介与入场凭证。',
        remarks: '支付成功后自动发放，凭此权益入场。',
        status: 'active',
        meta: {
          source: 'bhk-bargain-thanksgiving',
          activityId: this.activityId,
          activityTitle: (this.data.activity && this.data.activity.title) || 'BHK56 感恩节限量品鉴会'
        }
      });
      this._rightSynced = true;
      return result;
    } finally {
      this._grantingRight = false;
    }
  },

  enableTimelineShare() {
    const capability = this.timelineCapability;
    if (!capability || !capability.supported) {
      return;
    }

    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      });
    }
  },

  setupTimelineCapability() {
    const capability = resolveTimelineCapability();
    this.timelineCapability = capability;
    this.setData({
      shareTimelineSupported: capability.supported,
      shareTimelineMessage: capability.message || ''
    });
  },

  navigateToRights() {
    wx.navigateTo({ url: '/pages/rights/rights' });
  },

  handleShareToTimeline() {
    const capability = this.timelineCapability;
    if (!capability || !capability.supported) {
      wx.showToast({
        title: capability?.message || '当前微信版本不支持朋友圈分享，请升级微信客户端',
        icon: 'none'
      });
      return;
    }

    if (capability.envVersion && capability.envVersion !== 'release') {
      wx.showModal({
        title: '请在正式版内分享',
        content: '朋友圈卡片只会拉起线上正式版。请先发布正式版并在正式版内测试分享效果。',
        showCancel: false
      });
      return;
    }

    const payload = this.buildShareTimelinePayload();
    if (wx.shareTimeline && payload) {
      wx.shareTimeline(payload);
      return;
    }
    wx.showToast({
      title: '微信客户端暂不支持，请升级后再试',
      icon: 'none'
    });
  },

  onShareAppMessage() {
    const title = (this.data.activity && this.data.activity.title) || 'BHK56 限量品鉴会砍价购票';
    const query = this.buildShareQuery();
    const path = `/pages/activities/bhk-bargain/index?${query}`;
    return {
      title,
      path,
      imageUrl: this.data.heroImage
    };
  },

  onShareTimeline() {
    return this.buildShareTimelinePayload();
  },

  isSinglePageMode() {
    try {
      if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
        return true;
      }
    } catch (error) {
      console.warn('[bhk-bargain] single page detection failed', error);
      return false;
    }
    return false;
  },

  buildShareQuery() {
    const shareId = this.data.memberId || (this.data.member && this.data.member._id) || '';
    return shareId ? `id=${this.activityId}&shareId=${shareId}` : `id=${this.activityId}`;
  },

  buildShareTimelinePayload() {
    const title = (this.data.activity && this.data.activity.title) || 'BHK56 限量品鉴会砍价购票';
    const query = this.buildShareQuery();
    const payload = { title, query };
    if (this.data.heroImage) {
      payload.imageUrl = this.data.heroImage;
    }
    return payload;
  }
});
