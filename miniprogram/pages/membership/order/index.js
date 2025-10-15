import { MenuOrderService, MenuCatalogService } from '../../../services/api';
import { formatCurrency, formatStones } from '../../../utils/format';
import menuData from '../../../shared/menu-data';

let SECTION_META = {};
let SECTION_ORDER = [];
let MENU_SECTIONS = [];
let SECTION_MAP = {};
let ITEM_MAP = {};
let TABS = [];
let DEFAULT_TAB_ID = '';
let DEFAULT_SECTION = null;
let DEFAULT_CATEGORY_ID = '';
let DEFAULT_CATEGORIES = [];
let DEFAULT_VISIBLE_ITEMS = [];

const TWELVE_HOURS_IN_MS = 12 * 60 * 60 * 1000;

function normalizeSection(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && SECTION_META[trimmed]) {
      return trimmed;
    }
    const lowercase = trimmed.toLowerCase();
    const matched = SECTION_ORDER.find(
      (sectionId) => sectionId === trimmed || sectionId.toLowerCase() === lowercase
    );
    if (matched) {
      return matched;
    }
  }
  return SECTION_ORDER.length ? SECTION_ORDER[0] : '';
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

function extractMinQuantityFromTitle(title) {
  if (typeof title !== 'string') {
    return 0;
  }
  const match = title.match(/[（(]\s*(\d+)\s*串起\s*[）)]/);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
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
  const title = typeof item.title === 'string' ? item.title : '';
  const minQuantityOverride = overrides.minQuantity || item.minQuantity || item.minimum;
  const numericMin = Number(minQuantityOverride || 0);
  const minQuantity = Number.isFinite(numericMin) && numericMin > 0
    ? Math.max(1, Math.floor(numericMin))
    : extractMinQuantityFromTitle(title);
  return {
    id: item.id,
    cat: category,
    section,
    title,
    desc: typeof item.desc === 'string' ? item.desc : '',
    img: typeof item.img === 'string' ? item.img : '',
    variants,
    minQuantity
  };
}

function pushNormalizedItem(target, item, overrides = {}) {
  const normalized = normalizeItem(item, overrides);
  if (normalized) {
    target.push(normalized);
  }
}

function normalizeCategoryInput(category) {
  if (!category) {
    return null;
  }
  const candidates = [category.id, category.categoryId, category.cat];
  let id = '';
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      id = candidate.trim();
      break;
    }
  }
  const nameCandidates = [category.name, category.title, category.label];
  let name = '';
  for (let i = 0; i < nameCandidates.length; i += 1) {
    const candidate = nameCandidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      name = candidate.trim();
      break;
    }
  }
  if (!id || !name) {
    return null;
  }
  const sortOrder = Number(category.sortOrder);
  return {
    id,
    name,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined
  };
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
  const normalizedCategories = Array.isArray(categories)
    ? categories.map((cat) => normalizeCategoryInput(cat)).filter(Boolean)
    : [];
  const filteredCategories = normalizedCategories.filter(
    (cat) => categoryItems[cat.id] && categoryItems[cat.id].length
  );
  filteredCategories.sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : 1000;
    const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : 1000;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  const defaultCategoryId = filteredCategories.length ? filteredCategories[0].id : '';
  return {
    id: sectionId,
    title: sectionMeta.title,
    categories: filteredCategories.map((cat) => ({ id: cat.id, name: cat.name })),
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractSectionsFromRaw(raw, now = new Date()) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw.sections) && raw.sections.length) {
    return raw.sections
      .map((section) => {
        const id = typeof section.id === 'string' ? section.id.trim() : '';
        const title = typeof section.title === 'string' ? section.title.trim() : '';
        if (!id || !title) {
          return null;
        }
        const categories = ensureArray(section.categories);
        return {
          id,
          title,
          categories: id === 'drinks' ? sortDrinkCategories(categories, now) : categories,
          items: ensureArray(section.items),
          extras: ensureArray(section.extras)
        };
      })
      .filter(Boolean);
  }
  const sections = [];
  const drinksCategories = ensureArray(raw.categories);
  const drinksItems = ensureArray(raw.items);
  const legacySoftDrinks = ensureArray(raw.softDrinks);
  if (drinksCategories.length || drinksItems.length || legacySoftDrinks.length) {
    sections.push({
      id: 'drinks',
      title: '酒水',
      categories: sortDrinkCategories(drinksCategories, now),
      items: drinksItems,
      extras: legacySoftDrinks.map((drink) => ({
        item: {
          ...drink,
          desc: drink.desc || '',
          img: drink.img || ''
        },
        overrides: { cat: (drink.cat || drink.categoryId || 'soft').trim() || 'soft' }
      }))
    });
  }
  const diningCategories = ensureArray(raw.diningCategories);
  const diningItems = ensureArray(raw.diningItems);
  if (diningCategories.length || diningItems.length) {
    sections.push({
      id: 'dining',
      title: '用餐',
      categories: diningCategories,
      items: diningItems,
      extras: []
    });
  }
  return sections;
}

function rebuildMenuContext(raw, now = new Date()) {
  const sectionsInput = extractSectionsFromRaw(raw, now);
  SECTION_META = {};
  SECTION_ORDER = [];
  MENU_SECTIONS = [];
  SECTION_MAP = {};
  ITEM_MAP = {};
  TABS = [];
  DEFAULT_TAB_ID = '';
  DEFAULT_SECTION = null;
  DEFAULT_CATEGORY_ID = '';
  DEFAULT_CATEGORIES = [];
  DEFAULT_VISIBLE_ITEMS = [];

  sectionsInput.forEach((sectionInput) => {
    const id = sectionInput.id;
    const title = sectionInput.title;
    if (!id || !title) {
      return;
    }
    SECTION_META[id] = { id, title };
    SECTION_ORDER.push(id);
    const normalizedItems = ensureArray(sectionInput.items).map((item) => ({
      ...item,
      section: item.section || id
    }));
    const section = buildSection(id, sectionInput.categories, normalizedItems, {
      extras: sectionInput.extras
    });
    if (section.items.length) {
      MENU_SECTIONS.push(section);
    }
  });

  MENU_SECTIONS.forEach((section) => {
    SECTION_MAP[section.id] = section;
    section.items.forEach((item) => {
      ITEM_MAP[item.id] = item;
    });
  });
  TABS = MENU_SECTIONS.map((section) => ({ id: section.id, title: section.title }));
  DEFAULT_TAB_ID = TABS.length ? TABS[0].id : '';
  DEFAULT_SECTION = DEFAULT_TAB_ID ? SECTION_MAP[DEFAULT_TAB_ID] : null;
  DEFAULT_CATEGORY_ID = DEFAULT_SECTION ? DEFAULT_SECTION.defaultCategoryId : '';
  DEFAULT_CATEGORIES = DEFAULT_SECTION ? DEFAULT_SECTION.categories : [];
  DEFAULT_VISIBLE_ITEMS =
    DEFAULT_SECTION && DEFAULT_CATEGORY_ID
      ? DEFAULT_SECTION.categoryItems[DEFAULT_CATEGORY_ID] || []
      : [];
  return {
    tabs: TABS,
    defaultTabId: DEFAULT_TAB_ID,
    defaultCategories: DEFAULT_CATEGORIES,
    defaultCategoryId: DEFAULT_CATEGORY_ID,
    defaultVisibleItems: DEFAULT_VISIBLE_ITEMS
  };
}

const INITIAL_MENU_STATE = rebuildMenuContext(menuData);

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

function normalizePriceAdjustmentInfo(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const previousAmount = Number(record.previousAmount || record.previous || 0);
  const newAmount = Number(record.newAmount || record.amount || 0);
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    return null;
  }
  const remark = typeof record.remark === 'string' ? record.remark : '';
  const adjustedAt = record.adjustedAt || record.updatedAt || null;
  return {
    previousAmount,
    newAmount,
    remark,
    adjustedAt,
    adjustedAtLabel: formatDateTime(adjustedAt)
  };
}

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
        const sectionMeta = SECTION_META[section] || { title: '' };
        return {
          ...item,
          section,
          sectionTitle: sectionMeta.title,
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
  const priceAdjustment = normalizePriceAdjustmentInfo(order.adminPriceAdjustment || order.priceAdjustment);
  const originalTotalAmount = Number(order.originalTotalAmount || 0) ||
    (priceAdjustment ? Number(priceAdjustment.previousAmount || 0) : 0);
  const priceAdjusted = !!priceAdjustment &&
    ((Number.isFinite(priceAdjustment.previousAmount) && priceAdjustment.previousAmount !== priceAdjustment.newAmount) ||
      (Number.isFinite(originalTotalAmount) && originalTotalAmount > 0 && originalTotalAmount !== totalAmount));
  const priceAdjustmentRemark = priceAdjustment
    ? priceAdjustment.remark
    : typeof order.priceAdjustmentRemark === 'string'
    ? order.priceAdjustmentRemark
    : '';
  const priceAdjustmentVisible = priceAdjusted || !!priceAdjustmentRemark;
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
    originalTotalAmount,
    originalTotalAmountLabel: originalTotalAmount ? formatCurrency(originalTotalAmount) : '',
    priceAdjusted,
    priceAdjustmentRemark,
    priceAdjustmentUpdatedAtLabel: priceAdjustment ? priceAdjustment.adjustedAtLabel : '',
    priceAdjustmentVisible,
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
    const minQuantity = Math.max(1, Number(line.minQuantity || 1));
    const quantity = Math.max(minQuantity, Number(line.quantity || minQuantity));
    const price = Number(line.price || 0);
    const amount = price * quantity;
    const section = normalizeSection(line.section);
    const sectionMeta = SECTION_META[section] || { title: '' };
    return {
      ...line,
      minQuantity,
      section,
      sectionTitle: sectionMeta.title,
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
    if (!SECTION_META[section]) {
      return null;
    }
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
    if (resolvedAmount > 0 && Object.prototype.hasOwnProperty.call(totals, section)) {
      totals[section] += resolvedAmount;
    }
  });
  return totals;
}

Page({
  data: {
    tabs: INITIAL_MENU_STATE.tabs,
    activeTab: INITIAL_MENU_STATE.defaultTabId,
    categories: INITIAL_MENU_STATE.defaultCategories,
    activeCategory: INITIAL_MENU_STATE.defaultCategoryId,
    visibleItems: INITIAL_MENU_STATE.defaultVisibleItems,
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
    menuLoading: false,
    orders: [],
    displayOrders: [],
    hasMoreOrders: false,
    showingAllOrders: false,
    confirmingId: '',
    cancellingId: ''
  },

  onLoad() {
    this.loadCatalog();
    this.loadOrders();
  },

  async loadCatalog() {
    if (this.data.menuLoading) {
      return;
    }
    this.setData({ menuLoading: true });
    try {
      const response = await MenuCatalogService.listCatalog();
      const catalog = response && response.catalog ? response.catalog : null;
      if (catalog && Array.isArray(catalog.sections)) {
        const state = rebuildMenuContext(catalog, new Date());
        const tabs = Array.isArray(state.tabs) ? state.tabs : [];
        const nextActiveTab = state.defaultTabId || (tabs.length ? tabs[0].id : '');
        const nextActiveCategory = state.defaultCategoryId;
        this.setData({
          tabs,
          activeTab: nextActiveTab,
          categories: state.defaultCategories,
          activeCategory: nextActiveCategory,
          visibleItems: state.defaultVisibleItems,
          cartSectionTotals: createEmptyCategoryTotals()
        });
        if (nextActiveTab) {
          this.applySectionState(nextActiveTab, nextActiveCategory);
        }
        if (Array.isArray(this.data.cart) && this.data.cart.length) {
          this.updateCartState(this.data.cart.map((line) => ({ ...line })));
        }
      }
    } catch (error) {
      console.error('[order] load catalog failed', error);
    } finally {
      this.setData({ menuLoading: false });
    }
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
    const minQuantity = Math.max(1, Number(item.minQuantity || 0) || 1);
    if (existingIndex >= 0) {
      cart[existingIndex] = {
        ...cart[existingIndex],
        minQuantity,
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
        quantity: minQuantity,
        section: item.section,
        minQuantity
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
    const item = ITEM_MAP[cart[index].itemId];
    const minQuantity = Math.max(
      1,
      Number(cart[index].minQuantity || 0) || 0,
      item ? Number(item.minQuantity || 0) || 0 : 0
    );
    const nextQuantity = cart[index].quantity + numericDelta;
    if (numericDelta < 0 && minQuantity > 1) {
      if (nextQuantity < minQuantity) {
        cart.splice(index, 1);
      } else {
        cart[index].quantity = nextQuantity;
        cart[index].minQuantity = minQuantity;
      }
    } else if (nextQuantity <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].quantity = nextQuantity;
      cart[index].minQuantity = minQuantity;
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
