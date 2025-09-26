import { MemberService } from '../../services/api';
import { formatCurrency, formatExperience, levelBadgeColor } from '../../utils/format';

Page({
  data: {
    loading: true,
    member: null,
    progress: null,
    levels: [],
    realms: [],
    currentLevel: null,
    nextLevel: null,
    upcomingMilestone: null
  },

  onShow() {
    this.fetchData();
  },

  async fetchData() {
    this.setData({ loading: true });
    try {
      const [member, progress] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress()
      ]);
      const levels = progress.levels || [];
      const realmMap = {};
      levels.forEach((lvl) => {
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

      this.setData({
        loading: false,
        member,
        progress,
        levels,
        realms,
        currentLevel,
        nextLevel,
        upcomingMilestone
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  formatCurrency,
  formatExperience,
  levelBadgeColor,

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
