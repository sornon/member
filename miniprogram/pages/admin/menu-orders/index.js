import { AdminMenuOrderService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

const STATUS_TABS = [
  { id: 'submitted', label: '待备餐' },
  { id: 'pendingMember', label: '待会员确认' },
  { id: 'all', label: '全部' }
];

const STATUS_LABELS = {
  submitted: '待备餐',
  pendingMember: '待会员确认',
  paid: '已完成',
  cancelled: '已取消'
};

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

function decorateOrder(order) {
  if (!order) {
    return null;
  }
  const id = order._id || order.id || '';
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const price = Number(item.price || 0);
        const quantity = Math.max(1, Number(item.quantity || 0));
        const amount = Number.isFinite(item.amount) ? Number(item.amount) : price * quantity;
        return {
          ...item,
          price,
          quantity,
          amount,
          amountLabel: formatCurrency(amount),
          priceLabel: formatCurrency(price)
        };
      })
    : [];
  const totalAmount = Number(order.totalAmount || 0);
  const shortId = id ? id.slice(-6).toUpperCase() : '';
  return {
    ...order,
    _id: id,
    items,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount),
    statusLabel: STATUS_LABELS[order.status] || '处理中',
    createdAtLabel: formatDateTime(order.createdAt),
    adminConfirmedAtLabel: formatDateTime(order.adminConfirmedAt),
    memberConfirmedAtLabel: formatDateTime(order.memberConfirmedAt),
    shortId
  };
}

function showConfirmDialog({ title = '提示', content = '', confirmText = '确定' }) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText: '取消',
      success: (res) => resolve(res || { confirm: false, cancel: true }),
      fail: () => resolve({ confirm: false, cancel: true })
    });
  });
}

Page({
  data: {
    statusTabs: STATUS_TABS,
    activeStatus: STATUS_TABS[0].id,
    orders: [],
    loading: false,
    processingId: ''
  },

  onShow() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  async loadOrders() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true });
    try {
      const response = await AdminMenuOrderService.listPrepOrders({
        status: this.data.activeStatus,
        pageSize: 100
      });
      const orders = Array.isArray(response.orders) ? response.orders.map(decorateOrder).filter(Boolean) : [];
      this.setData({ orders });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '加载失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleStatusChange(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.activeStatus) {
      return;
    }
    this.setData({
      activeStatus: id
    });
    this.loadOrders();
  },

  async handleMarkReady(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.processingId === id) {
      return;
    }
    const confirm = await showConfirmDialog({
      title: '确认备餐',
      content: '确认将此订单推送给会员进行余额扣费？',
      confirmText: '确认推送'
    });
    if (!confirm.confirm) {
      return;
    }
    this.setData({ processingId: id });
    try {
      await AdminMenuOrderService.markOrderReady(id, '管理员确认备餐');
      wx.showToast({ title: '已推送', icon: 'success' });
      await this.loadOrders();
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '操作失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ processingId: '' });
    }
  },

  formatCurrency
});
