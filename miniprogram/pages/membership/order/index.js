import { MenuOrderService } from '../../../services/api';
import { formatCurrency, formatStones } from '../../../utils/format';
import {
  categories as rawDrinkCategories,
  items as rawDrinkItems,
  softDrinks,
  diningCategories as rawDiningCategories,
  diningItems as rawDiningItems
} from '../../../shared/menu-data';

const SECTION_META = {
  drinks: { id: 'drinks', title: '酒水' },
  dining: { id: 'dining', title: '用餐' }
};

const SECTION_ORDER = ['drinks', 'dining'];
const TWELVE_HOURS_IN_MS = 12 * 60 * 60 * 1000;

function normalizeSection(value) {
  if (typeof value === 'string') {
    const key = value.toLowerCase();
    if (SECTION_META[key]) {
      return key;
    }
  }
  return SECTION_ORDER[0];
}

function createEmptyCategoryTotals() {
  return SECTION_ORDER.reduce((acc, section) => {
    acc[section] = 0;
    return acc;
  }, {});
}

function normalizeCategoryTotals(input) {
  const totals = createEmptyCategoryTotals();
  if (input && typeof input === 'object') {
    SECTION_ORDER.forEach((section) => {
      const value = Number(input[section] || 0);
      totals[section] = Number.isFinite(value) && value > 0 ? value : 0;
    });
  }
  return totals;
}

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
  const category = (overrides.cat || item.cat || '').trim();
  if (!category) {
    return null;
  }
  const section = normalizeSection(overrides.section || item.section);
  return {
    id: item.id,
    cat: category,
    section,
    title: typeof item.title === 'string' ? item.title : '',
    desc: typeof item.desc === 'string' ? item.desc : '',
    img: typeof item.img === 'string' ? item.img : '',
    variants
  };
}

function pushNormalizedItem(target, item, overrides = {}) {
  const normalized = normalizeItem(item, overrides);
  if (normalized) {
    target.push(normalized);
  }
}

function buildSection(sectionId, categories, baseItems, options = {}) {
  const items = [];
  const extras = Array.isArray(options.extras) ? options.extras : [];
  const primaryItems = Array.isArray(baseItems) ? baseItems : [];
  const sectionMeta = SECTION_META[sectionId] || { title: '' };
  primaryItems.forEach((item) => {
    pushNormalizedItem(items, item, { section: sectionId });
  });
  extras.forEach((extra) => {
    if (!extra) {
      return;
    }
    const { item, overrides = {} } = extra;
    if (item) {
      pushNormalizedItem(items, item, { section: sectionId, ...overrides });
    } else {
      pushNormalizedItem(items, extra, { section: sectionId });
    }
  });
  const itemMap = {};
  const categoryItems = {};
  items.forEach((menuItem) => {
    itemMap[menuItem.id] = menuItem;
    if (!categoryItems[menuItem.cat]) {
      categoryItems[menuItem.cat] = [];
    }
    categoryItems[menuItem.cat].push(menuItem);
  });
  const filteredCategories = Array.isArray(categories)
    ? categories.filter((cat) => categoryItems[cat.id] && categoryItems[cat.id].length)
    : [];
  const defaultCategoryId = filteredCategories.length ? filteredCategories[0].id : '';
  return {
    id: sectionId,
    title: sectionMeta.title,
    categories: filteredCategories,
    categoryItems,
    items,
    itemMap,
    defaultCategoryId
  };
}

function getDrinkCategoryOrder(now = new Date()) {
  const hour = now.getHours();
  const dayOrder = [
    'coffee',
    'snack',
    'ws',
    'sig',
    'soft',
    'rose',
    'white',
    'red',
    'rum',
    'rare',
    'easter'
  ];
  const nightOrder = [
    'ws',
    'sig',
    'rum',
    'snack',
    'white',
    'red',
    'rose',
    'rare',
    'soft',
    'coffee',
    'easter'
  ];
  return hour >= 9 && hour < 17 ? dayOrder : nightOrder;
}

function sortDrinkCategories(categories, now = new Date()) {
  if (!Array.isArray(categories)) {
    return [];
  }
  const order = getDrinkCategoryOrder(now);
  const position = order.reduce((acc, id, index) => {
    acc[id] = index;
    return acc;
  }, {});
  return [...categories].sort((a, b) => {
    const indexA = position[a.id];
    const indexB = position[b.id];
    if (typeof indexA === 'number' && typeof indexB === 'number') {
      return indexA - indexB;
    }
    if (typeof indexA === 'number') {
      return -1;
    }
    if (typeof indexB === 'number') {
      return 1;
    }
    return 0;
  });
}

function buildMenuSections(now = new Date()) {
  const sections = [];
  const softDrinkExtras = Array.isArray(softDrinks)
    ? softDrinks.map((drink) => ({
        item: {
          ...drink,
          desc: drink.desc || '',
          img: drink.img || ''
        },
        overrides: { cat: 'soft' }
      }))
    : [];
  const builders = {
    drinks: () =>
      buildSection('drinks', sortDrinkCategories(rawDrinkCategories, now), rawDrinkItems, {
        extras: softDrinkExtras
      }),
    dining: () => buildSection('dining', rawDiningCategories, rawDiningItems)
  };
  SECTION_ORDER.forEach((sectionId) => {
    if (!SECTION_META[sectionId]) {
      return;
    }
    const builder = builders[sectionId];
    if (typeof builder === 'function') {
      sections.push(builder());
    }
  });
  return sections;
}

const MENU_SECTIONS = buildMenuSections();
const SECTION_MAP = MENU_SECTIONS.reduce((acc, section) => {
  if (section && section.id) {
    acc[section.id] = section;
  }
  return acc;
}, {});
const ITEM_MAP = MENU_SECTIONS.reduce((acc, section) => {
  if (section && Array.isArray(section.items)) {
    section.items.forEach((item) => {
      acc[item.id] = item;
    });
  }
  return acc;
}, {});
const TABS = MENU_SECTIONS.map((section) => ({ id: section.id, title: section.title }));
const DEFAULT_TAB_ID = TABS.length ? TABS[0].id : '';
const DEFAULT_SECTION = DEFAULT_TAB_ID ? SECTION_MAP[DEFAULT_TAB_ID] : null;
const DEFAULT_CATEGORY_ID = DEFAULT_SECTION ? DEFAULT_SECTION.defaultCategoryId : '';
const DEFAULT_CATEGORIES = DEFAULT_SECTION ? DEFAULT_SECTION.categories : [];
const DEFAULT_VISIBLE_ITEMS =
  DEFAULT_SECTION && DEFAULT_CATEGORY_ID ? DEFAULT_SECTION.categoryItems[DEFAULT_CATEGORY_ID] || [] : [];

function resolveTimestamp(value) {
  if (!value) {
    return NaN;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? NaN : time;
  }
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? NaN : time;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      if (date instanceof Date) {
        const time = date.getTime();
        return Number.isNaN(time) ? NaN : time;
      }
    } catch (error) {
      return NaN;
    }
  }
  return NaN;
}

function formatDateTime(value) {
  const timestamp = resolveTimestamp(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const date = new Date(timestamp);
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
        const fallbackMenu = item.menuId && ITEM_MAP[item.menuId] ? ITEM_MAP[item.menuId] : null;
        const section = normalizeSection(item.categoryType || (fallbackMenu ? fallbackMenu.section : ''));
        return {
          ...item,
          section,
          sectionTitle: SECTION_META[section].title,
          price,
          quantity,
          amount,
          amountLabel: formatCurrency(amount),
          priceLabel: formatCurrency(price)
        };
      })
    : [];
  const groupedItems = groupLinesBySection(items);
  const totalAmount = Number(order.totalAmount || 0);
  const categoryTotals = normalizeCategoryTotals(order.categoryTotals);
  if (items.length) {
    const computedTotals = calculateSectionTotals(items);
    SECTION_ORDER.forEach((section) => {
      if (!categoryTotals[section] && computedTotals[section]) {
        categoryTotals[section] = computedTotals[section];
      }
    });
  }
  const stoneRewardRaw = Number(
    Object.prototype.hasOwnProperty.call(order, 'stoneReward') ? order.stoneReward : order.totalAmount
  );
  const stoneReward = Math.max(0, Math.floor(stoneRewardRaw));
  const createdAtTimestamp = resolveTimestamp(order.createdAt);
  const adminRemark = typeof order.adminRemark === 'string' ? order.adminRemark : '';
  const cancelRemark = typeof order.cancelRemark === 'string' ? order.cancelRemark : '';
  const cancelledAtLabel = formatDateTime(order.cancelledAt);
  const cancelledByRole = typeof order.cancelledByRole === 'string' ? order.cancelledByRole : '';
  let cancelledByLabel = '';
  if (cancelledByRole === 'admin') {
    cancelledByLabel = '管理员';
  } else if (cancelledByRole === 'member') {
    cancelledByLabel = '会员';
  }
  const canConfirm = order.status === 'pendingMember';
  const canCancel = order.status === 'pendingMember';
  return {
    ...order,
    _id: id,
    items,
    groupedItems,
    categoryTotals,
    totalAmount,
    totalAmountLabel: formatCurrency(totalAmount),
    stoneReward,
    stoneRewardLabel: formatStones(stoneReward),
    statusLabel: STATUS_LABELS[order.status] || '处理中',
    createdAtLabel: formatDateTime(order.createdAt),
    adminConfirmedAtLabel: formatDateTime(order.adminConfirmedAt),
    memberConfirmedAtLabel: formatDateTime(order.memberConfirmedAt),
    cancelledAtLabel,
    cancelledByLabel,
    adminRemark,
    cancelRemark,
    createdAtTimestamp,
    canConfirm,
    canCancel
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
    const price = Number(line.price || 0);
    const amount = price * quantity;
    const section = normalizeSection(line.section);
    return {
      ...line,
      section,
      sectionTitle: SECTION_META[section].title,
      price,
      quantity,
      amount,
      amountLabel: formatCurrency(amount),
      priceLabel: formatCurrency(price)
    };
  });
}

function computeCartTotal(cart) {
  return cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

function groupLinesBySection(lines) {
  return SECTION_ORDER.map((section) => {
    const sectionLines = lines.filter((line) => normalizeSection(line.section) === section);
    if (!sectionLines.length) {
      return null;
    }
    return {
      section,
      title: SECTION_META[section].title,
      items: sectionLines
    };
  }).filter(Boolean);
}

function calculateSectionTotals(lines) {
  const totals = createEmptyCategoryTotals();
  lines.forEach((line) => {
    const amount = Number(line.amount);
    const resolvedAmount = Number.isFinite(amount) ? amount : Number(line.price || 0) * Number(line.quantity || 0);
    const section = normalizeSection(line.section);
    if (resolvedAmount > 0) {
      totals[section] += resolvedAmount;
    }
  });
  return totals;
}

Page({
  data: {
    tabs: TABS,
    activeTab: DEFAULT_TAB_ID,
    categories: DEFAULT_CATEGORIES,
    activeCategory: DEFAULT_CATEGORY_ID,
    visibleItems: DEFAULT_VISIBLE_ITEMS,
    cart: [],
    cartGroups: [],
    cartSectionTotals: createEmptyCategoryTotals(),
    cartTotal: 0,
    cartTotalLabel: formatCurrency(0),
    cartStoneReward: 0,
    cartStoneRewardLabel: formatStones(0),
    remark: '',
    submitting: false,
    loadingOrders: false,
    orders: [],
    displayOrders: [],
    hasMoreOrders: false,
    showingAllOrders: false,
    confirmingId: '',
    cancellingId: ''
  },

  onLoad() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  applySectionState(sectionId, categoryId) {
    const section = SECTION_MAP[sectionId];
    if (!section) {
      this.setData({
        categories: [],
        activeCategory: '',
        visibleItems: []
      });
      return;
    }
    const nextCategory = categoryId && section.categoryItems[categoryId] ? categoryId : section.defaultCategoryId;
    this.setData({
      categories: section.categories,
      activeCategory: nextCategory,
      visibleItems: nextCategory ? section.categoryItems[nextCategory] || [] : []
    });
  },

  handleSelectTab(event) {
    const { id } = event.currentTarget.dataset || {};
    const tabId = typeof id === 'string' ? id : '';
    if (!tabId || tabId === this.data.activeTab) {
      return;
    }
    this.setData({ activeTab: tabId });
    this.applySectionState(tabId);
  },

  handleSelectCategory(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.activeCategory) {
      return;
    }
    const section = SECTION_MAP[this.data.activeTab];
    if (!section || !section.categoryItems[id]) {
      return;
    }
    this.setData({
      activeCategory: id,
      visibleItems: section.categoryItems[id] || []
    });
  },

  updateCartState(nextCart) {
    const decorated = decorateCart(nextCart);
    const total = computeCartTotal(decorated);
    const sectionTotals = calculateSectionTotals(decorated);
    const stoneReward = Math.max(0, Math.floor(total));
    this.setData({
      cart: decorated,
      cartGroups: groupLinesBySection(decorated),
      cartSectionTotals: sectionTotals,
      cartTotal: total,
      cartTotalLabel: formatCurrency(total),
      cartStoneReward: stoneReward,
      cartStoneRewardLabel: formatStones(stoneReward)
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
    const cart = this.data.cart.map((line) => ({ ...line }));
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
        quantity: 1,
        section: item.section
      });
    }
    this.updateCartState(cart);
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
    this.updateCartState(cart);
  },

  handleClearCart() {
    this.updateCartState([]);
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
      quantity: line.quantity,
      categoryType: line.section
    }));
    try {
      await MenuOrderService.createOrder({
        items,
        remark: this.data.remark,
        categoryTotals: this.data.cartSectionTotals
      });
      wx.showToast({ title: '订单已提交', icon: 'success' });
      this.updateCartState([]);
      this.setData({ remark: '' });
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
      const sortedOrders = orders
        .slice()
        .sort((a, b) => {
          const timeA = Number.isFinite(a.createdAtTimestamp) ? a.createdAtTimestamp : 0;
          const timeB = Number.isFinite(b.createdAtTimestamp) ? b.createdAtTimestamp : 0;
          return timeB - timeA;
        });
      const now = Date.now();
      const threshold = now - TWELVE_HOURS_IN_MS;
      const recentOrders = sortedOrders.filter((order) => {
        const timestamp = order.createdAtTimestamp;
        return Number.isFinite(timestamp) && timestamp >= threshold;
      });
      const fallbackOrders = recentOrders.length ? recentOrders : sortedOrders.slice(0, 1);
      const showingAllOrders = this.data.showingAllOrders && sortedOrders.length > 0;
      const displayOrders = showingAllOrders ? sortedOrders : fallbackOrders;
      const hasMoreOrders = !showingAllOrders && sortedOrders.length > displayOrders.length;
      this.setData({
        orders: sortedOrders,
        displayOrders,
        hasMoreOrders,
        showingAllOrders
      });
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

  handleShowMoreOrders() {
    if (!this.data.hasMoreOrders || this.data.showingAllOrders) {
      return;
    }
    const allOrders = Array.isArray(this.data.orders) ? this.data.orders.slice() : [];
    this.setData({
      showingAllOrders: true,
      displayOrders: allOrders,
      hasMoreOrders: false
    });
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

  async handleCancelOrder(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.cancellingId === id) {
      return;
    }
    const result = await showConfirmDialog({
      title: '取消订单',
      content: '确定取消本次消费吗？',
      confirmText: '确认取消'
    });
    if (!result.confirm) {
      return;
    }
    this.setData({ cancellingId: id });
    try {
      await MenuOrderService.cancelOrder(id);
      wx.showToast({ title: '订单已取消', icon: 'success' });
      await this.loadOrders();
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '取消失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ cancellingId: '' });
    }
  },

  formatCurrency
});
