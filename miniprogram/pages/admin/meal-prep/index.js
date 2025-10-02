import { AdminService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

const STATUS_TABS = [
  { id: 'pending', label: '待备餐' },
  { id: 'preparing', label: '备餐中' },
  { id: 'awaitingMember', label: '待确认' },
  { id: 'paid', label: '已结算' },
  { id: 'all', label: '全部' }
];

const STATUS_LABELS = {
  pending: '待备餐',
  preparing: '备餐中',
  awaitingMember: '待会员确认',
  paid: '已结算',
  cancelled: '已取消'
};

function formatDateTime(value) {
  if (!value) return '';
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (error) {
      date = null;
    }
  } else {
    const parsed = new Date(value);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date) return '';
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mm}`;
}

function decorateOrder(order) {
  if (!order) return null;
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)) || 1);
        const price = Number(item.price || 0);
        const amount = Number(item.amount || price * quantity || 0);
        return {
          ...item,
          quantity,
          amount,
          amountLabel: formatCurrency(amount)
        };
      })
    : [];
  const totalAmount = Number(order.totalAmount || 0);
  const status = order.status || 'pending';
  const memberName = order.memberName || (order.member && order.member.nickName) || '';
  return {
    ...order,
    items,
    memberName,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount),
    statusLabel: STATUS_LABELS[status] || '未知状态',
    createdAtLabel: formatDateTime(order.createdAt || order.createdAtLabel),
    updatedAtLabel: formatDateTime(order.updatedAt || order.updatedAtLabel)
  };
}

Page({
  data: {
    statusTabs: STATUS_TABS,
    activeStatus: 'pending',
    orders: [],
    loading: false,
    statusCounts: {},
    actionLoading: ''
  },

  onShow() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadOrders() {
    if (this.data.loading) {
      return Promise.resolve();
    }
    this.setData({ loading: true });
    try {
      const response = await AdminService.listMealOrders({
        status: this.data.activeStatus,
        page: 1,
        pageSize: 50
      });
      const orders = Array.isArray(response.orders) ? response.orders.map(decorateOrder) : [];
      const counts = response.statusCounts || {};
      const statusTabs = STATUS_TABS.map((tab) => ({
        ...tab,
        count: typeof counts[tab.id] === 'number' ? counts[tab.id] : undefined
      }));
      this.setData({
        orders,
        statusCounts: counts,
        statusTabs,
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleStatusTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.activeStatus) {
      return;
    }
    this.setData({ activeStatus: id });
    this.loadOrders();
  },

  async handleStartPrep(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.actionLoading) {
      return;
    }
    this.setData({ actionLoading: id });
    try {
      await AdminService.markMealOrderPreparing(id);
      wx.showToast({ title: '已标记备餐', icon: 'success' });
      this.loadOrders();
    } catch (error) {
      // handled by cloud
    } finally {
      this.setData({ actionLoading: '' });
    }
  },

  async handleRequestPayment(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.actionLoading) {
      return;
    }
    wx.showModal({
      title: '通知会员确认',
      content: '确认已完成核对，通知会员确认扣款吗？',
      confirmText: '通知',
      cancelText: '再等等',
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        this.setData({ actionLoading: id });
        try {
          await AdminService.requestMealOrderPayment(id);
          wx.showToast({ title: '已通知会员', icon: 'success' });
          this.loadOrders();
        } catch (error) {
          // handled globally
        } finally {
          this.setData({ actionLoading: '' });
        }
      }
    });
  }
});
