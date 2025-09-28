import { MemberService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatCurrency, formatExperience, levelBadgeColor } from '../../utils/format';

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

function decorateLevels(levels = []) {
  return levels
    .filter(Boolean)
    .map((level) => {
      const color = levelBadgeColor(level.realmOrder || level.order || 1);
      return {
        ...level,
        badgeColor: color,
        badgeStyle: `background: ${color};`
      };
    });
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
    progressStyle: buildWidthStyle(0)
  },

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
      const levels = decorateLevels(rawLevels);
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

      this.setData({
        loading: false,
        member,
        progress,
        levels,
        realms,
        currentLevel,
        nextLevel,
        upcomingMilestone,
        progressWidth: width,
        progressStyle: buildWidthStyle(width)
      });
    } catch (error) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        progressWidth: width,
        progressStyle: buildWidthStyle(width)
      });
    }
    this.fetchingData = false;
    if (this.pendingFetchData) {
      this.pendingFetchData = false;
      this.fetchData({ showLoading: false });
    }
  },

  formatCurrency,
  formatExperience,

  formatDiscount(value) {
    const numeric = typeof value === 'number' ? value : 1;
    const discount = numeric * 10;
    if (Number.isNaN(discount)) {
      return '10';
    }
    if (Math.abs(discount - Math.round(discount)) < 0.001) {
      return `${Math.round(discount)}`;
    }
    return discount.toFixed(1);
  }
});
