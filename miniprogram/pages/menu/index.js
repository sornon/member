import { MealService, WalletService } from '../../services/api';
import { formatCurrency } from '../../utils/format';

Page({
  data: {
    loadingMenu: true,
    loadingOrder: true,
    categories: [],
    activeCategoryId: '',
    cart: {},
    note: '',
    submitting: false,
    order: null,
    totalQuantity: 0,
    totalAmount: 0,
    cartTotalLabel: formatCurrency(0),
    confirming: false
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    await Promise.all([this.loadMenu(), this.loadLatestOrder()]);
  },

  async loadMenu() {
    this.setData({ loadingMenu: true });
    try {
      const result = await MealService.getMenu();
      const rawCategories = Array.isArray(result.categories) ? result.categories : [];
      const categories = rawCategories.map((category) => ({
        ...category,
        items: Array.isArray(category.items)
          ? category.items.map((item) => ({
              ...item,
              priceLabel: formatCurrency(item.price || 0)
            }))
          : []
      }));
      const activeCategoryId = categories.length ? categories[0].id : '';
      this.setData({
        categories,
        activeCategoryId,
        loadingMenu: false
      });
    } catch (error) {
      console.error('[meal] load menu failed', error);
      this.setData({ loadingMenu: false });
    }
  },

  async loadLatestOrder() {
    this.setData({ loadingOrder: true });
    try {
      const result = await MealService.getLatestOrder();
      const order = result && result.order ? this.decorateOrder(result.order) : null;
      this.setData({ order, loadingOrder: false });
      this.updateGlobalMealBadges(result && result.mealOrderBadges);
      this.markMealBadgeAsSeenIfNeeded(result && result.mealOrderBadges);
    } catch (error) {
      console.error('[meal] load latest order failed', error);
      this.setData({ loadingOrder: false });
    }
  },

  decorateOrder(order) {
    if (!order) return null;
    const items = Array.isArray(order.items)
      ? order.items.map((item) => ({
          ...item,
          subtotalLabel: item.subtotalLabel || formatCurrency(item.subtotal || 0)
        }))
      : [];
    return {
      ...order,
      items,
      totalLabel: order.totalLabel || formatCurrency(order.totalAmount || 0)
    };
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
      console.error('[meal] update global badges failed', error);
    }
  },

  async markMealBadgeAsSeenIfNeeded(badges) {
    if (!badges) return;
    const memberVersion = Number(badges.memberVersion || 0);
    const seenVersion = Number(badges.memberSeenVersion || 0);
    if (memberVersion > seenVersion) {
      try {
        const result = await MealService.markMemberSeen();
        if (result && result.mealOrderBadges) {
          this.updateGlobalMealBadges(result.mealOrderBadges);
        }
      } catch (error) {
        console.error('[meal] mark badges seen failed', error);
      }
    }
  },

  handleCategoryTap(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || id === this.data.activeCategoryId) {
      return;
    }
    this.setData({ activeCategoryId: id });
  },

  handleIncrease(event) {
    const { itemId } = event.currentTarget.dataset;
    if (!itemId) return;
    const quantity = this.data.cart[itemId] || 0;
    const newCart = { ...this.data.cart, [itemId]: quantity + 1 };
    this.setData({ cart: newCart }, () => {
      this.updateTotals();
    });
  },

  handleDecrease(event) {
    const { itemId } = event.currentTarget.dataset;
    if (!itemId) return;
    const quantity = this.data.cart[itemId] || 0;
    if (quantity <= 0) return;
    const newQuantity = quantity - 1;
    const newCart = { ...this.data.cart };
    if (newQuantity <= 0) {
      delete newCart[itemId];
    } else {
      newCart[itemId] = newQuantity;
    }
    this.setData({ cart: newCart }, () => {
      this.updateTotals();
    });
  },

  updateTotals() {
    const cart = this.data.cart || {};
    let totalQuantity = 0;
    let totalAmount = 0;
    Object.keys(cart).forEach((itemId) => {
      const quantity = Number(cart[itemId] || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return;
      }
      const item = this.findMenuItemById(itemId);
      if (!item) {
        return;
      }
      totalQuantity += quantity;
      totalAmount += Number(item.price || 0) * quantity;
    });
    this.setData({
      totalQuantity,
      totalAmount,
      cartTotalLabel: formatCurrency(totalAmount)
    });
  },

  findMenuItemById(itemId) {
    const { categories } = this.data;
    if (!Array.isArray(categories) || !categories.length) {
      return null;
    }
    for (const category of categories) {
      if (!category || !Array.isArray(category.items)) continue;
      const found = category.items.find((item) => item.id === itemId);
      if (found) {
        return found;
      }
    }
    return null;
  },

  handleNoteInput(event) {
    const value = event.detail.value || '';
    this.setData({ note: value.slice(0, 200) });
  },

  async handleSubmit() {
    if (this.data.submitting) {
      return;
    }
    const items = this.normalizeCartItems();
    if (!items.length) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const payload = {
        items,
        note: this.data.note
      };
      const result = await MealService.submitOrder(payload);
      wx.showToast({ title: '已提交点单', icon: 'success' });
      this.setData({
        cart: {},
        note: '',
        totalAmount: 0,
        totalQuantity: 0,
        cartTotalLabel: formatCurrency(0)
      });
      const order = result && result.order ? this.decorateOrder(result.order) : null;
      this.setData({ order });
      this.updateGlobalMealBadges(result && result.mealOrderBadges);
    } catch (error) {
      console.error('[meal] submit order failed', error);
    } finally {
      this.setData({ submitting: false });
    }
  },

  normalizeCartItems() {
    const cart = this.data.cart || {};
    const items = [];
    Object.keys(cart).forEach((itemId) => {
      const quantity = Number(cart[itemId] || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return;
      }
      const menuItem = this.findMenuItemById(itemId);
      if (!menuItem) {
        return;
      }
      items.push({
        itemId,
        quantity
      });
    });
    return items;
  },

  async handleConfirmPayment() {
    const { order, confirming } = this.data;
    if (!order || order.status !== 'adminConfirmed' || confirming) {
      return;
    }
    this.setData({ confirming: true });
    try {
      await WalletService.payWithBalance(order._id, order.totalAmount, { orderType: 'meal' });
      wx.showToast({ title: '余额已扣除', icon: 'success' });
      await this.loadLatestOrder();
    } catch (error) {
      console.error('[meal] confirm payment failed', error);
    } finally {
      this.setData({ confirming: false });
    }
  }
});
