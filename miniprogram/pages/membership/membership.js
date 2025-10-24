import { MemberService, PveService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatCurrency, formatExperience, levelBadgeColor } from '../../utils/format';
import { syncStorageBadgeStateFromProfile } from '../../utils/storage-notifications';

function normalizePercentage(progress) {
  if (!progress || typeof progress.percentage !== 'number') {
    return 0;
  }
  const value = Number(progress.percentage);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function buildWidthStyle(width) {
  const safeWidth = typeof width === 'number' && Number.isFinite(width) ? width : 0;
  return `width: ${safeWidth}%;`;
}

function buildRealmKey(level = {}) {
  if (!level) {
    return '';
  }
  if (level.realmId) {
    return String(level.realmId);
  }
  const realm = typeof level.realm === 'string' ? level.realm : '';
  const order =
    typeof level.realmOrder === 'number'
      ? level.realmOrder
      : typeof level.order === 'number'
      ? level.order
      : '';
  if (!realm && order === '') {
    return '';
  }
  return `${realm}_${order}`;
}

function decorateLevels(levels = [], options = {}) {
  const claimedLevelRewards = Array.isArray(options.claimedLevelRewards)
    ? options.claimedLevelRewards
    : [];
  const claimsSet = new Set(claimedLevelRewards);
  const experience = Number(options.memberExperience || 0);
  return levels
    .filter(Boolean)
    .map((level) => {
      const color = levelBadgeColor(level.realmOrder || level.order || 1);
      const experienceRequirement = formatExperience(
        typeof level.threshold === 'undefined' || level.threshold === null
          ? 0
          : level.threshold
      );
      const hasRewards =
        typeof level.hasRewards === 'boolean'
          ? level.hasRewards
          : (Array.isArray(level.rewards) && level.rewards.length > 0) ||
            (Array.isArray(level.virtualRewards) && level.virtualRewards.length > 0) ||
            !!level.milestoneReward;
      const reached =
        typeof level.reached === 'boolean'
          ? level.reached
          : experience >= (typeof level.threshold === 'number' ? level.threshold : 0);
      const claimed = typeof level.claimed === 'boolean' ? level.claimed : claimsSet.has(level._id);
      const claimable =
        typeof level.claimable === 'boolean'
          ? level.claimable
          : hasRewards && reached && !claimed;
      return {
        ...level,
        badgeColor: color,
        badgeStyle: `background: ${color};`,
        experienceRequirement,
        hasRewards,
        reached,
        claimed,
        claimable
      };
    });
}

function resolveVisibleLevels(levels = []) {
  const normalizedLevels = Array.isArray(levels) ? levels.filter(Boolean) : [];
  if (!normalizedLevels.length) {
    return [];
  }
  const firstUnclaimedIndex = normalizedLevels.findIndex(
    (level) => level && level.hasRewards && !level.claimed
  );
  if (firstUnclaimedIndex === -1) {
    return [];
  }
  const firstUnclaimedLevel = normalizedLevels[firstUnclaimedIndex];
  return firstUnclaimedLevel ? [firstUnclaimedLevel] : [];
}

function resolveVisibleRealms(realms = [], options = {}) {
  const { currentLevel, nextLevel } = options;
  if (!Array.isArray(realms) || realms.length === 0) {
    return [];
  }
  const currentKey = buildRealmKey(currentLevel);
  let currentIndex = realms.findIndex((realm) => realm && realm.realmKey === currentKey);
  if (currentIndex === -1 && currentLevel && currentLevel.realm) {
    currentIndex = realms.findIndex((realm) => realm && realm.realm === currentLevel.realm);
  }
  if (currentIndex === -1 && nextLevel) {
    const nextKey = buildRealmKey(nextLevel);
    const nextIndex = realms.findIndex((realm) => realm && realm.realmKey === nextKey);
    if (nextIndex > 0) {
      currentIndex = nextIndex - 1;
    }
  }
  if (currentIndex < 0) {
    currentIndex = 0;
  }
  const visible = [];
  if (realms[currentIndex]) {
    visible.push(realms[currentIndex]);
  }
  const nextRealm = realms[currentIndex + 1];
  if (nextRealm) {
    visible.push(nextRealm);
  }
  return visible;
}

Page({
  data: {
    loading: true,
    member: null,
    currentExperience: formatExperience(0),
    progress: null,
    nextLevelRemainingExperience: formatExperience(0),
    levels: [],
    realms: [],
    currentLevel: null,
    nextLevel: null,
    upcomingMilestone: null,
    pendingBreakthroughLevelId: '',
    breakthroughLevel: null,
    breakthroughRewardText: '',
    breakthroughLoading: false,
    progressWidth: 0,
    progressStyle: buildWidthStyle(0),
    visibleLevels: [],
    claimedLevelRewards: [],
    visibleRealms: []
  },

  claimingReward: false,

  onShow() {
    this.attachMemberRealtime();
    ensureMemberWatcher().catch(() => {
      // ignore; fetchData will report if necessary
    });
    this.fetchData();
  },

  onHide() {
    this.detachMemberRealtime();
  },

  onUnload() {
    this.detachMemberRealtime();
  },

  attachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      return;
    }
    this.unsubscribeMemberRealtime = subscribeMemberRealtime((event) => {
      if (
        !event ||
        (event.type !== 'memberChanged' && event.type !== 'memberSnapshot' && event.type !== 'memberExtrasChanged')
      ) {
        return;
      }
      this.fetchData({ showLoading: false });
    });
  },

  detachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      this.unsubscribeMemberRealtime();
      this.unsubscribeMemberRealtime = null;
    }
  },

  async fetchData(options = {}) {
    if (this.fetchingData) {
      this.pendingFetchData = true;
      return;
    }
    this.fetchingData = true;
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const [member, progress] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress()
      ]);
      const rawLevels = Array.isArray(progress.levels) ? progress.levels : [];
      const progressMember = progress && progress.member ? progress.member : {};
      const mergedMember = { ...member, ...progressMember };
      const claimedLevelRewards = Array.isArray(progress.claimedLevelRewards)
        ? progress.claimedLevelRewards
        : Array.isArray(mergedMember.claimedLevelRewards)
        ? mergedMember.claimedLevelRewards
        : [];
      const levels = decorateLevels(rawLevels, {
        claimedLevelRewards,
        memberExperience: mergedMember.experience || progressMember.experience || 0
      });
      const realmMap = {};
      levels.forEach((lvl) => {
        if (!lvl) return;
        const key = buildRealmKey(lvl);
        if (!key) return;
        if (!realmMap[key]) {
          realmMap[key] = {
            realm: lvl.realm,
            realmShort: lvl.realmShort || '',
            order: lvl.realmOrder || lvl.order || 0,
            description: lvl.realmDescription || '',
            start: typeof lvl.threshold === 'number' ? lvl.threshold : 0,
            end: typeof lvl.threshold === 'number' ? lvl.threshold : 0,
            milestoneReward: lvl.milestoneReward || '',
            milestoneType: lvl.milestoneType || '',
            milestoneThreshold: lvl.milestoneReward ? lvl.threshold : 0,
            realmKey: key,
            reached: !!lvl.reached
          };
        } else if (typeof lvl.threshold === 'number') {
          realmMap[key].start = Math.min(realmMap[key].start, lvl.threshold);
          realmMap[key].end = Math.max(realmMap[key].end, lvl.threshold);
          if (lvl.milestoneReward) {
            realmMap[key].milestoneReward = lvl.milestoneReward;
            realmMap[key].milestoneType = lvl.milestoneType || realmMap[key].milestoneType;
            realmMap[key].milestoneThreshold = lvl.threshold;
          }
        }
        if (!realmMap[key].reached && lvl.reached) {
          realmMap[key].reached = true;
        }
        if (!realmMap[key].milestoneReward && lvl.milestoneReward) {
          realmMap[key].milestoneReward = lvl.milestoneReward;
          realmMap[key].milestoneType = lvl.milestoneType || realmMap[key].milestoneType;
          realmMap[key].milestoneThreshold = lvl.threshold;
        }
      });

      const realms = Object.values(realmMap).sort((a, b) => a.order - b.order);
      const currentLevel = progress.currentLevel || null;
      const nextLevel = progress.nextLevel || null;
      const nextDiff = progress && typeof progress.nextDiff === 'number' ? progress.nextDiff : 0;
      const nextLevelRemainingExperience = formatExperience(nextDiff);
      const currentOrder = currentLevel && currentLevel.order ? currentLevel.order : 0;
      const upcomingMilestone = levels.find((lvl) => lvl.order > currentOrder && lvl.milestoneReward) || null;
      const width = normalizePercentage(progress);
      const visibilityOptions = {
        currentLevel,
        nextLevel
      };
      const visibleLevels = resolveVisibleLevels(levels, visibilityOptions);
      const visibleRealms = resolveVisibleRealms(realms, visibilityOptions);
      mergedMember.claimedLevelRewards = claimedLevelRewards;
      const pendingBreakthroughLevelId =
        typeof mergedMember.pendingBreakthroughLevelId === 'string'
          ? mergedMember.pendingBreakthroughLevelId
          : '';
      const breakthroughLevel = pendingBreakthroughLevelId
        ? rawLevels.find((lvl) => lvl && lvl._id === pendingBreakthroughLevelId) || null
        : null;
      const breakthroughRewardText = breakthroughLevel && breakthroughLevel.milestoneReward
        ? breakthroughLevel.milestoneReward
        : breakthroughLevel
        ? '筑基背景 + 任意120元内饮品券'
        : '';
      mergedMember.pendingBreakthroughLevelId = pendingBreakthroughLevelId;

      this.setData({
        loading: false,
        member: mergedMember,
        currentExperience: formatExperience(mergedMember.experience ?? progressMember.experience ?? 0),
        progress,
        nextLevelRemainingExperience,
        levels,
        realms,
        currentLevel,
        nextLevel,
        upcomingMilestone,
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        visibleLevels,
        visibleRealms,
        claimedLevelRewards,
        pendingBreakthroughLevelId,
        breakthroughLevel,
        breakthroughRewardText
      });
    } catch (error) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        progressWidth: width,
        progressStyle: buildWidthStyle(width)
      });
      this.refreshVisibility();
    }
    this.fetchingData = false;
    if (this.pendingFetchData) {
      this.pendingFetchData = false;
      this.fetchData({ showLoading: false });
    }
  },

  async refreshStorageBadgeState() {
    try {
      const profile = await PveService.profile();
      syncStorageBadgeStateFromProfile(profile);
    } catch (error) {
      console.warn('[membership] refresh storage badge failed', error);
    }
  },

  refreshVisibility() {
    const options = {
      currentLevel: this.data.currentLevel,
      nextLevel: this.data.nextLevel
    };
    const visibleLevels = resolveVisibleLevels(this.data.levels, options);
    const visibleRealms = resolveVisibleRealms(this.data.realms, options);
    this.setData({ visibleLevels, visibleRealms });
  },

  async onClaimReward(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const levelId = dataset.levelId;
    if (!levelId || this.claimingReward) {
      return;
    }
    this.claimingReward = true;
    wx.showLoading({ title: '领取中...', mask: true });
    try {
      await MemberService.claimLevelReward(levelId);
      await Promise.all([this.fetchData({ showLoading: false }), this.refreshStorageBadgeState()]);
      wx.hideLoading();
      wx.showToast({ title: '领取成功', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '领取失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.claimingReward = false;
    }
  },

  async handleBreakthrough() {
    if (this.data.breakthroughLoading || !this.data.pendingBreakthroughLevelId) {
      return;
    }
    this.setData({ breakthroughLoading: true });
    try {
      await MemberService.breakthrough();
      wx.showToast({ title: '突破成功', icon: 'success' });
      await this.fetchData({ showLoading: false });
    } catch (error) {
      console.error('[membership] breakthrough failed', error);
      wx.showToast({ title: (error && error.errMsg) || '突破失败', icon: 'none' });
    } finally {
      this.setData({ breakthroughLoading: false });
    }
  },

  formatCurrency,
  formatExperience
});
