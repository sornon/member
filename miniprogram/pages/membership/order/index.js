import { MenuOrderService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';
import { categories as rawCategories, items as rawItems, softDrinks } from '../../../shared/menu-data';

function normalizeVariant(variant) {
  if (!variant) {
    return null;
  }
  const label = typeof variant.label === 'string' ? variant.label.trim() : '';
  const unit = typeof variant.unit === 'string' ? variant.unit.trim() : '';
  const price = Number(variant.price || 0);
  if (!label || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const comparableUnit = unit.replace(/^[^\w\u4e00-\u9fa5]+/, '');
  const displayLabel = label && label !== comparableUnit ? label : '';
  return {
    label,
    unit,
    price,
    priceLabel: formatCurrency(price),
    displayLabel
  };
}

function normalizeItem(item, overrides = {}) {
  if (!item || !item.id) {
    return null;
  }
  const variantsSource = Array.isArray(item.variants) ? item.variants : [];
  const variants = variantsSource
    .map(normalizeVariant)
    .filter(Boolean);
  if (!variants.length) {
    return null;
  }
  const category = overrides.cat || item.cat;
  if (!category) {
    return null;
  }
  return {
    id: item.id,
    cat: category,
    title: typeof item.title === 'string' ? item.title : '',
    desc: typeof item.desc === 'string' ? item.desc : '',
    img: typeof item.img === 'string' ? item.img : '',
    variants
  };
}

function buildMenuItems() {
  const list = [];
  rawItems.forEach((item) => {
    const normalized = normalizeItem(item);
    if (normalized) {
      list.push(normalized);
    }
  });
  if (Array.isArray(softDrinks)) {
    softDrinks.forEach((item) => {
      const normalized = normalizeItem(
        {
          ...item,
          desc: item.desc || '',
          img: item.img || ''
        },
        { cat: 'soft' }
      );
      if (normalized) {
        list.push(normalized);
      }
    });
  }
  return list;
}

const MENU_ITEMS = buildMenuItems();
const ITEM_MAP = MENU_ITEMS.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});
const CATEGORY_ITEMS = MENU_ITEMS.reduce((acc, item) => {
  if (!acc[item.cat]) {
    acc[item.cat] = [];
  }
  acc[item.cat].push(item);
  return acc;
}, {});
const CATEGORIES = rawCategories.filter((cat) => CATEGORY_ITEMS[cat.id] && CATEGORY_ITEMS[cat.id].length);
const DEFAULT_CATEGORY_ID = CATEGORIES.length ? CATEGORIES[0].id : '';

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

const STATUS_LABELS = {
  submitted: '待备餐',
  pendingMember: '待确认扣费',
  paid: '已完成',
  cancelled: '已取消'
};

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
  return {
    ...order,
    _id: id,
    items,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount),
    statusLabel: STATUS_LABELS[order.status] || '处理中',
    createdAtLabel: formatDateTime(order.createdAt),
    adminConfirmedAtLabel: formatDateTime(order.adminConfirmedAt),
    memberConfirmedAtLabel: formatDateTime(order.memberConfirmedAt)
  };
}

function showConfirmDialog(options) {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title || '提示',
      content: options.content || '',
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      success: (res) => resolve(res || { confirm: false, cancel: true }),
      fail: () => resolve({ confirm: false, cancel: true })
    });
  });
}

function decorateCart(cart) {
  return cart.map((line) => {
    const quantity = Math.max(1, Number(line.quantity || 1));
    const amount = line.price * quantity;
    return {
      ...line,
      quantity,
      amount,
      amountLabel: formatCurrency(amount),
      priceLabel: formatCurrency(line.price)
    };
  });
}

function computeCartTotal(cart) {
  return cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

Page({
  data: {
    categories: CATEGORIES,
    activeCategory: DEFAULT_CATEGORY_ID,
    visibleItems: DEFAULT_CATEGORY_ID ? CATEGORY_ITEMS[DEFAULT_CATEGORY_ID] || [] : [],
    cart: [],
    cartTotal: 0,
    cartTotalLabel: formatCurrency(0),
    remark: '',
    submitting: false,
    loadingOrders: false,
    orders: [],
    confirmingId: ''
  },

  onLoad() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  handleSelectCategory(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.activeCategory) {
      return;
    }
    this.setData({
      activeCategory: id,
      visibleItems: CATEGORY_ITEMS[id] || []
    });
  },

  handleAddToCart(event) {
    const { itemId, variantIndex } = event.currentTarget.dataset || {};
    if (!itemId || typeof variantIndex === 'undefined') {
      return;
    }
    const item = ITEM_MAP[itemId];
    if (!item) {
      return;
    }
    const variant = item.variants[variantIndex] || item.variants[0];
    if (!variant) {
      return;
    }
    const key = `${item.id}|${variant.label}`;
    const cart = [...this.data.cart];
    const existingIndex = cart.findIndex((line) => line.key === key);
    if (existingIndex >= 0) {
      cart[existingIndex] = {
        ...cart[existingIndex],
        quantity: cart[existingIndex].quantity + 1
      };
    } else {
      cart.push({
        key,
        itemId: item.id,
        title: item.title,
        spec: variant.label,
        unit: variant.unit || '',
        price: variant.price,
        quantity: 1
      });
    }
    const decorated = decorateCart(cart);
    const total = computeCartTotal(decorated);
    this.setData({
      cart: decorated,
      cartTotal: total,
      cartTotalLabel: formatCurrency(total)
    });
  },

  handleAdjustQuantity(event) {
    const { key, delta } = event.currentTarget.dataset || {};
    if (!key || !delta) {
      return;
    }
    const numericDelta = Number(delta);
    const cart = this.data.cart.map((line) => ({ ...line }));
    const index = cart.findIndex((line) => line.key === key);
    if (index < 0) {
      return;
    }
    const nextQuantity = cart[index].quantity + numericDelta;
    if (nextQuantity <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].quantity = nextQuantity;
    }
    const decorated = decorateCart(cart);
    const total = computeCartTotal(decorated);
    this.setData({
      cart: decorated,
      cartTotal: total,
      cartTotalLabel: formatCurrency(total)
    });
  },

  handleClearCart() {
    this.setData({
      cart: [],
      cartTotal: 0,
      cartTotalLabel: formatCurrency(0)
    });
  },

  handleRemarkInput(event) {
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ remark: value });
  },

  async handleSubmitOrder() {
    if (this.data.submitting || !this.data.cart.length) {
      return;
    }
    this.setData({ submitting: true });
    const items = this.data.cart.map((line) => ({
      menuId: line.itemId,
      title: line.title,
      spec: line.spec,
      unit: line.unit,
      price: line.price,
      quantity: line.quantity
    }));
    try {
      await MenuOrderService.createOrder({
        items,
        remark: this.data.remark
      });
      wx.showToast({ title: '订单已提交', icon: 'success' });
      this.setData({
        cart: [],
        cartTotal: 0,
        cartTotalLabel: formatCurrency(0),
        remark: ''
      });
      await this.loadOrders();
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '提交失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
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
      const response = await MenuOrderService.listOrders();
      const orders = Array.isArray(response.orders) ? response.orders.map(decorateOrder).filter(Boolean) : [];
      this.setData({ orders });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '加载订单失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ loadingOrders: false });
    }
  },

  async handleConfirmOrder(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.confirmingId === id) {
      return;
    }
    const result = await showConfirmDialog({
      title: '确认扣费',
      content: '确认从钱包余额中扣除本次消费吗？',
      confirmText: '确认扣费'
    });
    if (!result.confirm) {
      return;
    }
    this.setData({ confirmingId: id });
    try {
      const result = await MenuOrderService.confirmOrder(id);
      const stoneReward = Number(result && result.stoneReward ? result.stoneReward : 0);
      const message = stoneReward > 0 ? `扣费成功，灵石+${Math.floor(stoneReward)}` : '扣费成功';
      wx.showToast({ title: message, icon: 'success' });
      await this.loadOrders();
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '扣费失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ confirmingId: '' });
    }
  },

  formatCurrency
});
