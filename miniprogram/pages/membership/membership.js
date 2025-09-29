import { MemberService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatCurrency, formatExperience, levelBadgeColor } from '../../utils/format';

const ADMIN_ROLE_KEYWORDS = ['admin', 'developer', 'superadmin'];

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

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles
    .map((role) => (typeof role === 'string' ? role.trim() : ''))
    .filter((role) => !!role);
}

function isAdminRoleList(roles = []) {
  const normalized = normalizeRoles(roles).map((role) => role.toLowerCase());
  return normalized.some((role) => ADMIN_ROLE_KEYWORDS.includes(role));
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

function resolveVisibleLevels(levels = [], options = {}) {
  const { isAdmin, showPastLevels, currentLevel, nextLevel } = options;
  if (isAdmin || showPastLevels) {
    return [...levels];
  }
  const currentId = currentLevel && currentLevel._id ? currentLevel._id : '';
  const nextId = nextLevel && nextLevel._id ? nextLevel._id : '';
  return levels.filter((level) => level && (level._id === currentId || level._id === nextId));
}

Page({
  data: {
    loading: true,
    member: null,
    progress: null,
    levels: [],
    realms: [],
    currentLevel: null,
    nextLevel: null,
    upcomingMilestone: null,
    progressWidth: 0,
    progressStyle: buildWidthStyle(0),
    isAdmin: false,
    showPastLevels: false,
    visibleLevels: [],
    claimedLevelRewards: []
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
      if (!event || (event.type !== 'memberChanged' && event.type !== 'memberSnapshot')) {
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
      rawLevels.forEach((lvl) => {
        if (!lvl) return;
        const key = lvl.realmId || `${lvl.realm || ''}_${lvl.realmOrder || lvl.order}`;
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
            milestoneThreshold: lvl.milestoneReward ? lvl.threshold : 0
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
        if (!realmMap[key].milestoneReward && lvl.milestoneReward) {
          realmMap[key].milestoneReward = lvl.milestoneReward;
          realmMap[key].milestoneType = lvl.milestoneType || realmMap[key].milestoneType;
          realmMap[key].milestoneThreshold = lvl.threshold;
        }
      });

      const realms = Object.values(realmMap).sort((a, b) => a.order - b.order);
      const currentLevel = progress.currentLevel || null;
      const nextLevel = progress.nextLevel || null;
      const currentOrder = currentLevel && currentLevel.order ? currentLevel.order : 0;
      const upcomingMilestone = levels.find((lvl) => lvl.order > currentOrder && lvl.milestoneReward) || null;
      const width = normalizePercentage(progress);
      const isAdmin = isAdminRoleList(mergedMember.roles);
      const visibleLevels = resolveVisibleLevels(levels, {
        isAdmin,
        showPastLevels: this.data.showPastLevels,
        currentLevel,
        nextLevel
      });
      mergedMember.claimedLevelRewards = claimedLevelRewards;

      this.setData({
        loading: false,
        member: mergedMember,
        progress,
        levels,
        realms,
        currentLevel,
        nextLevel,
        upcomingMilestone,
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        isAdmin,
        visibleLevels,
        claimedLevelRewards
      });
    } catch (error) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        progressWidth: width,
        progressStyle: buildWidthStyle(width)
      });
      this.refreshVisibleLevels();
    }
    this.fetchingData = false;
    if (this.pendingFetchData) {
      this.pendingFetchData = false;
      this.fetchData({ showLoading: false });
    }
  },

  refreshVisibleLevels() {
    const visibleLevels = resolveVisibleLevels(this.data.levels, {
      isAdmin: this.data.isAdmin,
      showPastLevels: this.data.showPastLevels,
      currentLevel: this.data.currentLevel,
      nextLevel: this.data.nextLevel
    });
    this.setData({ visibleLevels });
  },

  onTogglePastLevels() {
    if (this.data.isAdmin) {
      return;
    }
    const nextShow = !this.data.showPastLevels;
    const visibleLevels = resolveVisibleLevels(this.data.levels, {
      isAdmin: this.data.isAdmin,
      showPastLevels: nextShow,
      currentLevel: this.data.currentLevel,
      nextLevel: this.data.nextLevel
    });
    this.setData({
      showPastLevels: nextShow,
      visibleLevels
    });
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
      await this.fetchData({ showLoading: false });
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

  formatCurrency,
  formatExperience
});
