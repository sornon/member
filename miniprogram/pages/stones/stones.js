import { StoneService } from '../../services/api';
import { formatDate, formatStones, formatStoneChange } from '../../utils/format';

Page({
  data: {
    loading: true,
    summary: null
  },

  onShow() {
    this.fetchSummary();
  },

  async fetchSummary() {
    this.setData({ loading: true });
    try {
      const summary = await StoneService.summary();
      this.setData({ summary, loading: false });
    } catch (error) {
      console.error('[stones:summary]', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
    }
  },

  formatDate,
  formatStones,
  formatStoneChange,

  formatSource(source) {
    if (!source) return '';
    if (source === 'task') return '任务奖励';
    if (source === 'adjust') return '后台调整';
    if (source === 'spend') return '商城消费';
    if (source === 'manual') return '运营发放';
    return source;
  }
});
