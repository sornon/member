import { StoneService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatDate, formatStones, formatStoneChange } from '../../utils/format';

Page({
  data: {
    loading: true,
    summary: null
  },

  onShow() {
    this.attachMemberRealtime();
    ensureMemberWatcher().catch(() => {
      // ignore; fetchSummary will surface any issues
    });
    this.fetchSummary();
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
      if (!event || event.type !== 'memberChanged') {
        return;
      }
      this.fetchSummary({ showLoading: false });
    });
  },

  detachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      this.unsubscribeMemberRealtime();
      this.unsubscribeMemberRealtime = null;
    }
  },

  async fetchSummary(options = {}) {
    if (this.fetchingSummary) {
      this.pendingFetchSummary = true;
      return;
    }
    this.fetchingSummary = true;
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const summary = await StoneService.summary();
      this.setData({ summary, loading: false });
    } catch (error) {
      console.error('[stones:summary]', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
    }
    this.fetchingSummary = false;
    if (this.pendingFetchSummary) {
      this.pendingFetchSummary = false;
      this.fetchSummary({ showLoading: false });
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
