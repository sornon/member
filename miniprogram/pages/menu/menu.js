import { MemberService } from '../../services/api';
import { formatCurrency } from '../../utils/format';

const app = getApp();

function createEmptyCart() {
  return {
    items: {},
    totalQuantity: 0,
    totalAmount: 0,
    totalAmountLabel: formatCurrency(0)
  };
}

function computeCartState(items) {
  const itemList = Object.values(items || {});
  const totalQuantity = itemList.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalAmount = itemList.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  return {
    items,
    totalQuantity,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount)
  };
}

function formatOrderTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
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

function transformOrder(order) {
  if (!order) {
    return null;
  }
  const items = Array.isArray(order.items) ? order.items : [];
  const summary = items.map((item) => `${item.name || ''} ×${item.quantity || 0}`).join('、');
  const id = order.orderId || order._id || '';
  return {
    id,
    status: order.status || 'pendingAdmin',
    statusLabel: order.statusLabel || '',
    totalAmount: order.totalAmount || 0,
    totalAmountLabel: formatCurrency(order.totalAmount || 0),
    displayTime: order.displayTime || formatOrderTime(order.createdAtTs || Date.now()),
    memberNotes: order.memberNotes || '',
    adminNotes: order.adminNotes || '',
    items,
    itemSummary: summary,
    canConfirm: !!order.canConfirm,
    menuVersion: order.menuVersion || ''
  };
}

Page({
  data: {
    navHeight: 88,
    loading: true,
    menuLoading: false,
    ordersLoading: false,
    categories: [],
    activeCategoryId: '',
    visibleItems: [],
    menuVersion: '',
    cart: createEmptyCart(),
    notes: '',
    submitting: false,
    confirmProcessing: '',
    orders: [],
    refreshing: false
  },

  onLoad() {
    this.ensureNavMetrics();
    this.bootstrap();
  },

  onShow() {
    this.loadOrders({ markSeen: true });
  },

  onPullDownRefresh() {
    this.refreshAll().finally(() => {
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
      console.warn('[menu] resolve nav metrics failed', error);
    }
  },

  async bootstrap() {
    this.setData({ loading: true });
    await Promise.all([this.loadMenu(), this.loadOrders({ markSeen: true })]);
    this.setData({ loading: false });
  },

  async refreshAll() {
    this.setData({ refreshing: true });
    try {
      await Promise.all([this.loadMenu(), this.loadOrders({ markSeen: true })]);
    } finally {
      this.setData({ refreshing: false });
    }
  },

  async loadMenu() {
    this.setData({ menuLoading: true });
    try {
      const response = await MemberService.listMealMenu();
      const categories = (response && Array.isArray(response.categories) ? response.categories : []).map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description || '',
        order: category.order || 0,
        items: (Array.isArray(category.items) ? category.items : []).map((item) => ({
          id: item.id,
          categoryId: category.id,
          name: item.name,
          description: item.description || '',
          price: item.price || 0,
          priceLabel: formatCurrency(item.price || 0),
          unit: item.unit || '',
          spicy: item.spicy || 0,
          tags: Array.isArray(item.tags) ? item.tags : []
        }))
      }));
      const sorted = categories.sort((a, b) => (a.order || 0) - (b.order || 0));
      const nextActiveId = this.data.activeCategoryId || (sorted.length ? sorted[0].id : '');
      const visibleItems = this.resolveVisibleItems(sorted, nextActiveId);
      this.setData({
        categories: sorted,
        activeCategoryId: nextActiveId,
        visibleItems,
        menuVersion: response && response.version ? response.version : '',
        menuLoading: false
      });
    } catch (error) {
      console.error('[menu] load menu failed', error);
      wx.showToast({ title: '菜单加载失败', icon: 'none' });
      this.setData({ menuLoading: false });
    }
  },

  async loadOrders({ markSeen = false } = {}) {
    this.setData({ ordersLoading: true });
    try {
      const response = await MemberService.listMealOrders({ page: 1, pageSize: 20, markSeen });
      const orders = (response && Array.isArray(response.orders) ? response.orders : [])
        .map(transformOrder)
        .filter(Boolean);
      this.setData({ orders, ordersLoading: false });
      if (response && response.badges) {
        this.updateGlobalMealBadges(response.badges);
      }
    } catch (error) {
      console.error('[menu] load orders failed', error);
      wx.showToast({ title: '订单加载失败', icon: 'none' });
      this.setData({ ordersLoading: false });
    }
  },

  updateGlobalMealBadges(badges) {
    try {
      if (app && app.globalData && app.globalData.memberInfo) {
        app.globalData.memberInfo.mealOrderBadges = badges;
      }
    } catch (error) {
      console.warn('[menu] update global badges failed', error);
    }
  },

  handleCategoryTap(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || id === this.data.activeCategoryId) {
      return;
    }
    const visibleItems = this.resolveVisibleItems(this.data.categories, id);
    this.setData({ activeCategoryId: id, visibleItems });
  },

  resolveVisibleItems(categories, categoryId) {
    const target = (categories || []).find((item) => item.id === categoryId);
    return target && Array.isArray(target.items) ? target.items : [];
  },

  handleAddItem(event) {
    const { itemId } = event.currentTarget.dataset;
    if (!itemId) {
      return;
    }
    const menuItem = this.findMenuItem(itemId);
    if (!menuItem) {
      wx.showToast({ title: '菜品不存在', icon: 'none' });
      return;
    }
    const cartItems = { ...this.data.cart.items };
    const existing = cartItems[itemId] || {
      itemId,
      name: menuItem.name,
      price: menuItem.price,
      unit: menuItem.unit,
      quantity: 0,
      priceLabel: formatCurrency(menuItem.price || 0),
      totalPrice: 0,
      totalPriceLabel: formatCurrency(0)
    };
    existing.quantity += 1;
    existing.totalPrice = existing.quantity * (menuItem.price || 0);
    existing.totalPriceLabel = formatCurrency(existing.totalPrice);
    cartItems[itemId] = existing;
    this.setData({ cart: computeCartState(cartItems) });
  },

  handleDecreaseItem(event) {
    const { itemId } = event.currentTarget.dataset;
    if (!itemId) {
      return;
    }
    const cartItems = { ...this.data.cart.items };
    const existing = cartItems[itemId];
    if (!existing) {
      return;
    }
    existing.quantity -= 1;
    if (existing.quantity <= 0) {
      delete cartItems[itemId];
    } else {
      existing.totalPrice = existing.quantity * existing.price;
      existing.totalPriceLabel = formatCurrency(existing.totalPrice);
      cartItems[itemId] = existing;
    }
    this.setData({ cart: computeCartState(cartItems) });
  },

  handleNotesInput(event) {
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ notes: value });
  },

  async handleSubmitOrder() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.cart.totalQuantity) {
      wx.showToast({ title: '请选择菜品', icon: 'none' });
      return;
    }
    const items = Object.values(this.data.cart.items).map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity
    }));
    this.setData({ submitting: true });
    try {
      const response = await MemberService.createMealOrder({ items, notes: this.data.notes });
      if (response && response.badges) {
        this.updateGlobalMealBadges(response.badges);
      }
      wx.showToast({ title: '下单成功', icon: 'success' });
      this.setData({ cart: createEmptyCart(), notes: '' });
      await this.loadOrders({ markSeen: true });
    } catch (error) {
      console.error('[menu] submit order failed', error);
      const message = (error && error.errMsg) || '下单失败';
      wx.showToast({ title: message.replace('cloud.callFunction:fail ', ''), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async handleConfirmOrder(event) {
    const { orderId } = event.currentTarget.dataset;
    if (!orderId || this.data.confirmProcessing === orderId) {
      return;
    }
    this.setData({ confirmProcessing: orderId });
    try {
      const response = await MemberService.confirmMealOrder(orderId);
      if (response && response.badges) {
        this.updateGlobalMealBadges(response.badges);
      }
      wx.showToast({ title: '扣费成功', icon: 'success' });
      await this.loadOrders({ markSeen: true });
    } catch (error) {
      console.error('[menu] confirm order failed', error);
      const message = (error && error.errMsg) || '确认失败';
      wx.showToast({ title: message.replace('cloud.callFunction:fail ', ''), icon: 'none' });
    } finally {
      this.setData({ confirmProcessing: '' });
    }
  },

  handleRefreshOrders() {
    this.loadOrders({ markSeen: true });
  },

  findMenuItem(itemId) {
    for (const category of this.data.categories || []) {
      const found = (category.items || []).find((item) => item.id === itemId);
      if (found) {
        return found;
      }
    }
    return null;
  }
});
