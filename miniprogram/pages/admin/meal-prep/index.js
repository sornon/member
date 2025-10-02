import { AdminService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

const app = getApp();

function formatOrderTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function summarizeItems(items) {
  return (items || [])
    .map((item) => `${item.name || ''} ×${item.quantity || 0}`)
    .join('、');
}

function transformAdminOrder(order) {
  if (!order) {
    return null;
  }
  const items = Array.isArray(order.items) ? order.items : [];
  const id = order._id || order.orderId || '';
  return {
    id,
    memberId: order.memberId || '',
    memberName: order.memberName || '未登记',
    memberMobile: order.memberMobile || '',
    status: order.status || 'pendingAdmin',
    statusLabel: order.statusLabel || '',
    totalAmount: order.totalAmount || 0,
    totalAmountLabel: formatCurrency(order.totalAmount || 0),
    createdAtLabel: order.createdAtLabel || formatOrderTime(order.createdAt || Date.now()),
    confirmedAtLabel: order.confirmedAtLabel || '',
    memberConfirmedAtLabel: order.memberConfirmedAtLabel || '',
    memberNotes: order.memberNotes || '',
    adminNotes: order.adminNotes || '',
    menuVersion: order.menuVersion || '',
    items,
    itemSummary: summarizeItems(items),
    canConfirm: (order.status || 'pendingAdmin') === 'pendingAdmin'
  };
}

Page({
  data: {
    navHeight: 88,
    loading: true,
    listLoading: false,
    pendingOrders: [],
    awaitingOrders: [],
    confirmProcessing: ''
  },

  onLoad() {
    this.ensureNavMetrics();
    this.bootstrap();
  },

  onShow() {
    this.loadAllOrders();
  },

  onPullDownRefresh() {
    this.loadAllOrders()
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  ensureNavMetrics() {
    try {
      const { customNav = {} } = app.globalData || {};
      if (customNav.navHeight && customNav.navHeight !== this.data.navHeight) {
        this.setData({ navHeight: customNav.navHeight });
      }
    } catch (error) {
      console.warn('[meal-prep] resolve nav metrics failed', error);
    }
  },

  async bootstrap() {
    this.setData({ loading: true });
    await this.loadAllOrders();
    this.setData({ loading: false });
  },

  async loadAllOrders() {
    this.setData({ listLoading: true });
    try {
      const [pendingRes, awaitingRes] = await Promise.all([
        AdminService.listMealOrders({ status: 'pendingAdmin', page: 1, pageSize: 50 }),
        AdminService.listMealOrders({ status: 'awaitingMember', page: 1, pageSize: 50 })
      ]);
      const pendingOrders = (pendingRes && Array.isArray(pendingRes.orders) ? pendingRes.orders : [])
        .map(transformAdminOrder)
        .filter(Boolean);
      const awaitingOrders = (awaitingRes && Array.isArray(awaitingRes.orders) ? awaitingRes.orders : [])
        .map(transformAdminOrder)
        .filter(Boolean);
      this.setData({ pendingOrders, awaitingOrders, listLoading: false });
    } catch (error) {
      console.error('[meal-prep] load orders failed', error);
      wx.showToast({ title: '订单加载失败', icon: 'none' });
      this.setData({ listLoading: false });
    }
  },

  async handleConfirmTap(event) {
    const { orderId } = event.currentTarget.dataset;
    if (!orderId || this.data.confirmProcessing === orderId) {
      return;
    }
    const confirmResult = await wx.showModal({
      title: '确认备餐完成',
      content: '确认将订单推送给会员进行扣费？',
      confirmText: '确认',
      cancelText: '取消'
    });
    if (!confirmResult || !confirmResult.confirm) {
      return;
    }
    this.setData({ confirmProcessing: orderId });
    try {
      await AdminService.confirmMealOrder(orderId, '');
      wx.showToast({ title: '已推送会员确认', icon: 'success' });
      await this.loadAllOrders();
    } catch (error) {
      console.error('[meal-prep] confirm meal order failed', error);
      const message = (error && error.errMsg) || '确认失败';
      wx.showToast({ title: message.replace('cloud.callFunction:fail ', ''), icon: 'none' });
    } finally {
      this.setData({ confirmProcessing: '' });
    }
  }
});
