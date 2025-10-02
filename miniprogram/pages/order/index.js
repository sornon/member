const { listMenuCategories, findMenuItemById } = require('../../shared/menu.js');
const { formatCurrency } = require('../../utils/format');
const { MemberService } = require('../../services/api');

Page({
  data: {
    activeTab: 'menu',
    menuCategories: [],
    cartQuantities: {},
    cartItems: [],
    cartTotal: 0,
    cartTotalLabel: formatCurrency(0),
    cartTotalCount: 0,
    cartNote: '',
    submitting: false,
    loadingOrders: false,
    orders: [],
    pendingMemberCount: 0,
    confirmingId: ''
  },

  onLoad() {
    this.loadMenu();
  },

  onShow() {
    if (this.data.activeTab === 'orders') {
      this.loadOrders();
    }
  },

  async loadMenu() {
    try {
      const categories = listMenuCategories();
      this.setData({ menuCategories: categories });
    } catch (error) {
      console.error('[order] load menu failed', error);
      wx.showToast({ title: '菜单加载失败', icon: 'none' });
    }
  },

  handleTabChange(event) {
    const { tab } = event.currentTarget.dataset;
    if (!tab || tab === this.data.activeTab) {
      return;
    }
    this.setData({ activeTab: tab });
    if (tab === 'orders') {
      this.loadOrders();
    }
  },

  handleIncrease(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    const quantities = { ...this.data.cartQuantities };
    const current = quantities[id] || 0;
    const next = Math.min(current + 1, 60);
    quantities[id] = next;
    this.setData({ cartQuantities: quantities });
    this.updateCartState();
  },

  handleDecrease(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    const quantities = { ...this.data.cartQuantities };
    const current = quantities[id] || 0;
    if (current <= 0) {
      return;
    }
    const next = Math.max(0, current - 1);
    if (next === 0) {
      delete quantities[id];
    } else {
      quantities[id] = next;
    }
    this.setData({ cartQuantities: quantities });
    this.updateCartState();
  },

  handleNoteInput(event) {
    this.setData({ cartNote: event.detail.value || '' });
  },

  updateCartState() {
    const quantities = this.data.cartQuantities;
    const items = [];
    let totalAmount = 0;
    let totalCount = 0;

    Object.keys(quantities).forEach((id) => {
      const quantity = quantities[id];
      if (!quantity) {
        return;
      }
      const menuItem = findMenuItemById(id);
      if (!menuItem) {
        return;
      }
      const price = Number(menuItem.price) || 0;
      const lineTotal = price * quantity;
      totalAmount += lineTotal;
      totalCount += quantity;
      items.push({
        id,
        name: menuItem.name,
        quantity,
        price,
        total: lineTotal,
        priceLabel: formatCurrency(price),
        totalLabel: formatCurrency(lineTotal)
      });
    });

    items.sort((a, b) => a.name.localeCompare(b.name));

    this.setData({
      cartItems: items,
      cartTotal: totalAmount,
      cartTotalLabel: formatCurrency(totalAmount),
      cartTotalCount: totalCount
    });
  },

  async handleSubmitOrder() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.cartItems.length) {
      wx.showToast({ title: '请选择菜品', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const payloadItems = this.data.cartItems.map((item) => ({
        itemId: item.id,
        quantity: item.quantity
      }));
      const note = this.data.cartNote.trim();
      await MemberService.createMealOrder({ items: payloadItems, note });
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.setData({
        cartQuantities: {},
        cartItems: [],
        cartTotal: 0,
        cartTotalLabel: formatCurrency(0),
        cartTotalCount: 0,
        cartNote: '',
        activeTab: 'orders'
      });
      this.loadOrders();
    } catch (error) {
      console.error('[order] submit order failed', error);
    } finally {
      this.setData({ submitting: false });
    }
  },

  async loadOrders() {
    if (this.data.loadingOrders) {
      return;
    }
    this.setData({ loadingOrders: true });
    try {
      const response = await MemberService.listMealOrders({ status: 'all', page: 1, pageSize: 30 });
      const orders = Array.isArray(response.orders) ? response.orders : [];
      this.setData({
        orders,
        pendingMemberCount: Number(response.pendingMemberCount || 0)
      });
    } catch (error) {
      console.error('[order] load orders failed', error);
      wx.showToast({ title: '订单加载失败', icon: 'none' });
    } finally {
      this.setData({ loadingOrders: false });
    }
  },

  handleRefreshOrders() {
    this.loadOrders();
  },

  async handleConfirmOrder(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    if (this.data.confirmingId) {
      return;
    }
    this.setData({ confirmingId: id });
    try {
      const updated = await MemberService.confirmMealOrder(id);
      wx.showToast({ title: '扣费成功', icon: 'success' });
      const orders = this.data.orders.map((order) => {
        if (order._id === id) {
          return updated;
        }
        return order;
      });
      const pendingMemberCount = Math.max(
        0,
        orders.filter((order) => order && order.status === 'pendingMember').length
      );
      this.setData({ orders, pendingMemberCount });
    } catch (error) {
      console.error('[order] confirm order failed', error);
    } finally {
      this.setData({ confirmingId: '' });
    }
  }
});
