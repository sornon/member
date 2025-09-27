import { WalletService } from '../../../services/api';
import { formatCurrency, formatStones } from '../../../utils/format';

function formatDateTime(value) {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function mapOrder(order) {
  if (!order) return null;
  const total = Number(order.totalAmount || 0);
  const stoneReward = Number(order.stoneReward || total || 0);
  const status = order.status || 'pending';
  return {
    ...order,
    totalAmount: total,
    stoneReward,
    totalLabel: formatCurrency(total),
    stoneLabel: formatStones(stoneReward),
    createdAtLabel: formatDateTime(order.createdAt),
    expireAtLabel: formatDateTime(order.expireAt),
    status,
    statusLabel: status === 'pending' ? '待确认' : status === 'paid' ? '已完成' : status === 'expired' ? '已过期' : '已取消'
  };
}

Page({
  data: {
    orderId: '',
    loading: true,
    order: null,
    error: '',
    confirming: false
  },

  onLoad(options) {
    const { orderId } = options;
    if (!orderId) {
      wx.showToast({ title: '扣费单不存在', icon: 'none' });
      return;
    }
    this.setData({ orderId });
    this.loadOrder(orderId);
  },

  async loadOrder(orderId) {
    this.setData({ loading: true, error: '' });
    try {
      const result = await WalletService.loadChargeOrder(orderId);
      const order = mapOrder(result.order);
      this.setData({ order, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.errMsg || error.message || '扣费单不存在' });
    }
  },

  async handleConfirm() {
    if (!this.data.order || this.data.order.status !== 'pending' || this.data.confirming) {
      return;
    }
    this.setData({ confirming: true });
    try {
      const result = await WalletService.confirmChargeOrder(this.data.orderId);
      const stoneReward = result && Number(result.stoneReward || 0);
      const message = stoneReward && stoneReward > 0 ? `扣费成功，灵石+${stoneReward}` : '扣费成功';
      wx.showToast({ title: message, icon: 'success' });
      await this.loadOrder(this.data.orderId);
      setTimeout(() => {
        wx.navigateBack({});
      }, 800);
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '扣费失败', icon: 'none' });
      this.loadOrder(this.data.orderId);
    } finally {
      this.setData({ confirming: false });
    }
  },

  handleRetry() {
    if (!this.data.orderId) return;
    this.loadOrder(this.data.orderId);
  },

  formatCurrency,
  formatStones
});
