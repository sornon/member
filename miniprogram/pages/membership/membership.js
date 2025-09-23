import { MemberService } from '../../services/api';
import { formatCurrency, levelBadgeColor } from '../../utils/format';

Page({
  data: {
    loading: true,
    member: null,
    progress: null,
    levels: []
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
      this.setData({
        loading: false,
        member,
        progress,
        levels: progress.levels || []
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  formatCurrency,
  levelBadgeColor
});
