import { AdminService } from '../../../services/api';

Page({
  data: {
    loading: true,
    orders: [],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 0
    },
    confirmingId: '',
    refreshing: false
  },

  onShow() {
    this.fetchOrders();
  },

  async fetchOrders() {
    this.setData({ loading: true });
    try {
      const result = await AdminService.listMealOrders({ status: 'submitted', page: 1, pageSize: 20 });
      const orders = Array.isArray(result.orders)
        ? result.orders.map((order) => this.decorateOrder(order))
        : [];
      this.setData({
        orders,
        loading: false,
        pagination: result.pagination || this.data.pagination
      });
      if (result && result.mealOrderBadges) {
        this.updateGlobalMealBadges(result.mealOrderBadges);
      }
      await this.markOrdersRead();
    } catch (error) {
      console.error('[admin meal] fetch orders failed', error);
      this.setData({ loading: false });
    }
  },

  async markOrdersRead() {
    try {
      const result = await AdminService.markMealOrdersRead();
      if (result && result.mealOrderBadges) {
        this.updateGlobalMealBadges(result.mealOrderBadges);
      }
    } catch (error) {
      console.error('[admin meal] mark read failed', error);
    }
  },

  decorateOrder(order) {
    if (!order) {
      return null;
    }
    const items = Array.isArray(order.items)
      ? order.items.map((item) => ({
          ...item,
          subtotalLabel: item.subtotalLabel || `¥${((item.subtotal || 0) / 100).toFixed(2)}`
        }))
      : [];
    return {
      ...order,
      items,
      totalLabel: order.totalLabel || `¥${((order.totalAmount || 0) / 100).toFixed(2)}`,
      memberName: order.memberName || '匿名会员'
    };
  },

  async handleConfirm(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.confirmingId) {
      return;
    }
    this.setData({ confirmingId: id });
    try {
      const result = await AdminService.confirmMealOrder(id);
      wx.showToast({ title: '已确认备餐', icon: 'success' });
      if (result && result.order) {
        const orders = this.data.orders.filter((order) => order._id !== id);
        this.setData({ orders });
        this.markOrdersRead();
      } else {
        await this.fetchOrders();
      }
    } catch (error) {
      console.error('[admin meal] confirm order failed', error);
    } finally {
      this.setData({ confirmingId: '' });
    }
  },

  async handleRefresh() {
    if (this.data.refreshing) {
      return;
    }
    this.setData({ refreshing: true });
    try {
      await this.fetchOrders();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  updateGlobalMealBadges(badges) {
    if (!badges || typeof getApp !== 'function') {
      return;
    }
    try {
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.memberInfo = {
          ...(app.globalData.memberInfo || {}),
          mealOrderBadges: { ...(badges || {}) }
        };
      }
    } catch (error) {
      console.error('[admin meal] update global badges failed', error);
    }
  }
});
