import { MemberService, WalletService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

const STATUS_LABELS = {
  pending: '待备餐',
  preparing: '备餐中',
  awaitingMember: '待会员确认',
  paid: '已结算',
  cancelled: '已取消'
};

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (error) {
      date = null;
    }
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date) {
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
  if (!order) return null;
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const price = Number(item.price || 0);
        const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)) || 1);
        const amount = Number(item.amount || price * quantity || 0);
        return {
          ...item,
          quantity,
          price,
          amount,
          priceLabel: formatCurrency(price),
          amountLabel: formatCurrency(amount)
        };
      })
    : [];
  const totalAmount = Number(order.totalAmount || 0);
  const status = order.status || 'pending';
  const createdAt = order.createdAt || order.createdAtLabel || null;
  return {
    ...order,
    items,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount),
    statusLabel: STATUS_LABELS[status] || '未知状态',
    createdAtLabel: formatDateTime(createdAt),
    canConfirm: status === 'awaitingMember'
  };
}

Page({
  data: {
    categories: [],
    activeCategoryId: '',
    cart: {},
    cartList: [],
    totalAmount: 0,
    totalAmountLabel: formatCurrency(0),
    totalQuantity: 0,
    note: '',
    menuLoading: false,
    orderSubmitting: false,
    ordersLoading: false,
    orders: [],
    payingOrderId: '',
    currentTab: 'menu'
  },

  onLoad() {
    this.loadMenu();
    this.loadOrders();
  },

  onPullDownRefresh() {
    Promise.all([this.loadMenu(), this.loadOrders()]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadMenu() {
    if (this.data.menuLoading) {
      return Promise.resolve();
    }
    this.setData({ menuLoading: true });
    try {
      const response = await MemberService.listMealMenu();
      const categories = Array.isArray(response.categories)
        ? response.categories.map((category) => ({
            ...category,
            items: Array.isArray(category.items)
              ? category.items.map((item) => ({
                  ...item,
                  priceLabel: formatCurrency(item.price || 0),
                  tags: Array.isArray(item.tags) ? item.tags : []
                }))
              : []
          }))
        : [];
      const activeCategoryId = this.data.activeCategoryId || (categories[0] && categories[0].id) || '';
      this.setData({ categories, activeCategoryId, menuLoading: false });
    } catch (error) {
      this.setData({ menuLoading: false });
    }
  },

  async loadOrders() {
    if (this.data.ordersLoading) {
      return Promise.resolve();
    }
    this.setData({ ordersLoading: true });
    try {
      const response = await MemberService.listMealOrders({ page: 1, pageSize: 20 });
      const orders = Array.isArray(response.orders) ? response.orders.map(decorateOrder) : [];
      this.setData({ orders, ordersLoading: false });
    } catch (error) {
      this.setData({ ordersLoading: false });
    }
  },

  handleTabChange(event) {
    const { tab } = event.currentTarget.dataset || {};
    if (!tab || tab === this.data.currentTab) {
      return;
    }
    this.setData({ currentTab: tab });
  },

  handleCategorySelect(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.activeCategoryId) {
      return;
    }
    this.setData({ activeCategoryId: id });
  },

  handleIncrease(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) return;
    this.adjustCartQuantity(id, 1);
  },

  handleDecrease(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) return;
    this.adjustCartQuantity(id, -1);
  },

  adjustCartQuantity(itemId, delta) {
    if (!itemId || !delta) {
      return;
    }
    const item = this.findMenuItem(itemId);
    if (!item) {
      wx.showToast({ title: '菜品已更新，请刷新菜单', icon: 'none' });
      return;
    }
    const nextCart = { ...this.data.cart };
    const existing = nextCart[itemId] || { item, quantity: 0 };
    const nextQuantity = Math.max(0, (existing.quantity || 0) + delta);
    if (nextQuantity <= 0) {
      delete nextCart[itemId];
    } else {
      nextCart[itemId] = { item, quantity: nextQuantity };
    }
    this.recalculateCart(nextCart);
  },

  recalculateCart(cart) {
    const entries = Object.keys(cart).map((key) => {
      const entry = cart[key];
      if (!entry || !entry.item) {
        return null;
      }
      const quantity = Math.max(1, Math.floor(Number(entry.quantity || 0)) || 1);
      const price = Number(entry.item.price || 0);
      const amount = price * quantity;
      return {
        ...entry,
        item: entry.item,
        quantity,
        amount,
        amountLabel: formatCurrency(amount)
      };
    }).filter(Boolean);
    let totalAmount = 0;
    let totalQuantity = 0;
    entries.forEach((entry) => {
      totalAmount += entry.amount;
      totalQuantity += entry.quantity;
    });
    this.setData({
      cart,
      cartList: entries,
      totalAmount,
      totalAmountLabel: formatCurrency(totalAmount),
      totalQuantity
    });
  },

  findMenuItem(itemId) {
    if (!itemId) return null;
    for (const category of this.data.categories) {
      if (!category || !Array.isArray(category.items)) continue;
      const found = category.items.find((item) => item.id === itemId);
      if (found) {
        return found;
      }
    }
    return null;
  },

  handleNoteInput(event) {
    this.setData({ note: event.detail.value || '' });
  },

  async handleSubmitOrder() {
    if (this.data.orderSubmitting) {
      return;
    }
    if (!this.data.cartList.length) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' });
      return;
    }
    this.setData({ orderSubmitting: true });
    try {
      const items = this.data.cartList.map((entry) => ({
        itemId: entry.item.id,
        quantity: entry.quantity
      }));
      await MemberService.createMealOrder({
        items,
        note: this.data.note
      });
      wx.showToast({ title: '订单已提交', icon: 'success' });
      this.clearCart();
      this.loadOrders();
    } catch (error) {
      // handled globally by service
    } finally {
      this.setData({ orderSubmitting: false });
    }
  },

  clearCart() {
    this.setData({
      cart: {},
      cartList: [],
      totalAmount: 0,
      totalAmountLabel: formatCurrency(0),
      totalQuantity: 0,
      note: ''
    });
  },

  async handleConfirmPayment(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) return;
    if (this.data.payingOrderId) return;
    const target = this.data.orders.find((order) => order._id === id || order.id === id);
    const amountLabel = target ? target.totalAmountLabel : '';
    wx.showModal({
      title: '确认扣款',
      content: amountLabel ? `确认使用钱包余额支付 ${amountLabel} 吗？` : '确认使用钱包余额支付该订单吗？',
      confirmText: '确认支付',
      cancelText: '暂不',
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        this.setData({ payingOrderId: id });
        try {
          await WalletService.payMealOrder(id);
          wx.showToast({ title: '扣款成功', icon: 'success' });
          this.loadOrders();
        } catch (error) {
          // error handled by cloud function toast
        } finally {
          this.setData({ payingOrderId: '' });
        }
      }
    });
  }
});
