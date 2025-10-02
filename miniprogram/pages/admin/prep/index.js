const { AdminService } = require('../../../services/api');

Page({
  data: {
    statusOptions: [
      { value: 'pendingAdmin', label: '待备餐' },
      { value: 'pendingMember', label: '待会员确认' },
      { value: 'completed', label: '已完成' },
      { value: 'all', label: '全部' }
    ],
    currentStatus: 'pendingAdmin',
    orders: [],
    loading: false,
    confirmingId: '',
    pendingAdminCount: 0
  },

  onLoad() {
    this.loadOrders();
  },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true });
    try {
      const response = await AdminService.listMealOrders({
        status: this.data.currentStatus,
        page: 1,
        pageSize: 30
      });
      const orders = Array.isArray(response.orders) ? response.orders : [];
      this.setData({
        orders,
        pendingAdminCount: Number(response.pendingAdminCount || 0)
      });
    } catch (error) {
      console.error('[admin-prep] load orders failed', error);
      wx.showToast({ title: '获取订单失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  handleStatusChange(event) {
    const { value } = event.currentTarget.dataset;
    if (!value || value === this.data.currentStatus) {
      return;
    }
    this.setData({ currentStatus: value }, () => {
      this.loadOrders();
    });
  },

  handleReload() {
    this.loadOrders();
  },

  async handleConfirm(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.confirmingId) {
      return;
    }
    this.setData({ confirmingId: id });
    try {
      await AdminService.confirmMealOrder(id);
      wx.showToast({ title: '已通知会员确认', icon: 'success' });
      this.loadOrders();
    } catch (error) {
      console.error('[admin-prep] confirm order failed', error);
    } finally {
      this.setData({ confirmingId: '' });
    }
  },

  onPullDownRefresh() {
    this.loadOrders();
  }
});
