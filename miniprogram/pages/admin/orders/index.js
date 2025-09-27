import { AdminService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

function formatDateTime(value) {
  if (!value) return '';
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (error) {
      date = null;
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mm}`;
}

function describeStatus(status) {
  switch (status) {
    case 'paid':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已过期';
    default:
      return '待支付';
  }
}

function decorateOrder(order) {
  if (!order) return null;
  const totalAmount = Number(order.totalAmount || 0);
  const stoneReward = Number(order.stoneReward || 0);
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const price = Number(item.price || 0);
        const quantity = Number(item.quantity || 0);
        const amount = Number(item.amount || price * quantity || 0);
        return {
          ...item,
          priceLabel: formatCurrency(price),
          amountLabel: formatCurrency(amount)
        };
      })
    : [];
  const stoneRewardLabel = `${Math.max(0, Math.floor(stoneReward))} 枚`;
  return {
    ...order,
    items,
    totalAmount,
    stoneReward,
    totalAmountLabel: formatCurrency(totalAmount),
    stoneRewardLabel,
    statusLabel: order.statusLabel || describeStatus(order.status),
    createdAtLabel: order.createdAtLabel || formatDateTime(order.createdAt),
    updatedAtLabel: order.updatedAtLabel || formatDateTime(order.updatedAt),
    confirmedAtLabel: order.confirmedAtLabel || formatDateTime(order.confirmedAt)
  };
}

Page({
  data: {
    keyword: '',
    orders: [],
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    refreshing: false
  },

  onShow() {
    this.loadOrders({ reset: true });
  },

  handleStatusTap(event) {
    const { id, status } = event.currentTarget.dataset || {};
    if (!id) return;
    if (status !== 'pending' && status !== 'created') {
      return;
    }
    wx.navigateTo({
      url: `/pages/admin/charge/index?orderId=${encodeURIComponent(id)}`
    });
  },

  async loadOrders({ reset = false, page = null } = {}) {
    if (this.data.loading) return;
    const targetPage = page || (reset ? 1 : this.data.page);
    const previousOrders = reset ? [] : this.data.orders;
    if (reset) {
      this.setData({ loading: true, refreshing: true, page: 1, orders: [] });
    } else {
      this.setData({ loading: true });
    }
    try {
      const response = await AdminService.listChargeOrders({
        page: targetPage,
        pageSize: this.data.pageSize,
        keyword: (this.data.keyword || '').trim()
      });
      const fetched = (response.orders || []).map(decorateOrder);
      this.setData({
        loading: false,
        refreshing: false,
        page: response.page || targetPage,
        pageSize: response.pageSize || this.data.pageSize,
        total: response.total || 0,
        orders: reset ? fetched : previousOrders.concat(fetched)
      });
    } catch (error) {
      this.setData({ loading: false, refreshing: false });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' });
  },

  handleSearch() {
    this.loadOrders({ reset: true });
  },

  handleResetFilters() {
    if (!this.data.keyword) {
      this.loadOrders({ reset: true });
      return;
    }
    this.setData({ keyword: '' });
    this.loadOrders({ reset: true });
  },

  onPullDownRefresh() {
    this.loadOrders({ reset: true });
  },

  onReachBottom() {
    if (this.data.loading) return;
    if (this.data.orders.length >= this.data.total) {
      return;
    }
    const nextPage = this.data.page + 1;
    this.loadOrders({ page: nextPage });
  }
});
