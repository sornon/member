import { MemberService, MenuOrderService, MenuCatalogService } from '../../../services/api';
import { formatCurrency, formatStones } from '../../../utils/format';
import {
  applyCacheVersionUpdate,
  MENU_CATALOG_STORAGE_KEY,
  MENU_CART_STORAGE_KEY
} from '../../../utils/cache-version.js';
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
const DRINKS_DAY_START_HOUR = 9;
const DRINKS_DAY_END_HOUR = 17;
const DRINKS_DAY_ORDER = [
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
const DRINKS_NIGHT_ORDER = [
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

const DRINK_VOUCHER_RIGHT_ID = 'right_realm_qi_drink';
const DRINK_VOUCHER_AMOUNT_LIMIT = 12000;
const CUBANEY_VOUCHER_RIGHT_ID = 'right_realm_core_cubaney_voucher';
const CUBANEY_VOUCHER_AMOUNT = 98000;
const CUBANEY_MENU_IDS = ['drinks_rum_cubaney-10'];
const CUBANEY_TITLE_KEYWORDS = ['古巴邑 10 年'];

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
  const daySortOrder = Number(category.daySortOrder);
  const nightSortOrder = Number(category.nightSortOrder);
  const normalized = {
    id,
    name,
    sortOrder: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : undefined
  };
  if (Number.isFinite(daySortOrder)) {
    normalized.daySortOrder = Math.floor(daySortOrder);
  }
  if (Number.isFinite(nightSortOrder)) {
    normalized.nightSortOrder = Math.floor(nightSortOrder);
  }
  return normalized;
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

function isDrinkDayPeriod(now = new Date()) {
  const hour = now.getHours();
  return hour >= DRINKS_DAY_START_HOUR && hour < DRINKS_DAY_END_HOUR;
}

function getDrinkCategoryOrder(now = new Date()) {
  return isDrinkDayPeriod(now) ? DRINKS_DAY_ORDER : DRINKS_NIGHT_ORDER;
}

function resolveCategorySortValue(category, key) {
  if (!category || !key) {
    return undefined;
  }
  const value = category[key];
  if (value === null || typeof value === 'undefined') {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
}

function resolveCategoryId(category) {
  if (!category) {
    return '';
  }
  if (typeof category.id === 'string' && category.id.trim()) {
    return category.id.trim();
  }
  if (typeof category.categoryId === 'string' && category.categoryId.trim()) {
    return category.categoryId.trim();
  }
  if (typeof category.cat === 'string' && category.cat.trim()) {
    return category.cat.trim();
  }
  return '';
}

function resolveCategoryName(category) {
  if (!category) {
    return '';
  }
  const candidates = [category.name, category.title, category.label];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function sortDrinkCategories(categories, now = new Date()) {
  if (!Array.isArray(categories)) {
    return [];
  }
  const isDay = isDrinkDayPeriod(now);
  const timeKey = isDay ? 'daySortOrder' : 'nightSortOrder';
  const fallbackOrder = isDay ? DRINKS_DAY_ORDER : DRINKS_NIGHT_ORDER;
  const fallbackPositions = fallbackOrder.reduce((acc, id, index) => {
    acc[id] = index;
    return acc;
  }, {});
  return [...categories].sort((a, b) => {
    const orderA = resolveCategorySortValue(a, timeKey);
    const orderB = resolveCategorySortValue(b, timeKey);
    if (typeof orderA === 'number' || typeof orderB === 'number') {
      if (typeof orderA === 'number' && typeof orderB === 'number' && orderA !== orderB) {
        return orderA - orderB;
      }
      if (typeof orderA === 'number' && typeof orderB !== 'number') {
        return -1;
      }
      if (typeof orderA !== 'number' && typeof orderB === 'number') {
        return 1;
      }
    }
    const baseOrderA = resolveCategorySortValue(a, 'sortOrder');
    const baseOrderB = resolveCategorySortValue(b, 'sortOrder');
    if (typeof baseOrderA === 'number' && typeof baseOrderB === 'number' && baseOrderA !== baseOrderB) {
      return baseOrderA - baseOrderB;
    }
    const idA = resolveCategoryId(a);
    const idB = resolveCategoryId(b);
    const indexA = typeof fallbackPositions[idA] === 'number' ? fallbackPositions[idA] : undefined;
    const indexB = typeof fallbackPositions[idB] === 'number' ? fallbackPositions[idB] : undefined;
    if (typeof indexA === 'number' && typeof indexB === 'number' && indexA !== indexB) {
      return indexA - indexB;
    }
    if (typeof indexA === 'number' && typeof indexB !== 'number') {
      return -1;
    }
    if (typeof indexA !== 'number' && typeof indexB === 'number') {
      return 1;
    }
    const nameA = resolveCategoryName(a);
    const nameB = resolveCategoryName(b);
    return nameA.localeCompare(nameB, 'zh-Hans-CN');
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
        const categories = ensureArray(section.categories)
          .map((cat) => normalizeCategoryInput(cat))
          .filter(Boolean);
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
  const drinksCategories = ensureArray(raw.categories)
    .map((cat) => normalizeCategoryInput(cat))
    .filter(Boolean);
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
  const diningCategories = ensureArray(raw.diningCategories)
    .map((cat) => normalizeCategoryInput(cat))
    .filter(Boolean);
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

function safeGetStorage(key) {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return null;
  }
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    console.warn(`[order] read storage ${key} failed`, error);
    return null;
  }
}

function safeSetStorage(key, value) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    console.warn(`[order] write storage ${key} failed`, error);
  }
}

function safeRemoveStorage(key) {
  if (typeof wx === 'undefined' || !wx) {
    return;
  }
  if (typeof wx.removeStorageSync === 'function') {
    try {
      wx.removeStorageSync(key);
    } catch (error) {
      console.warn(`[order] remove storage ${key} failed`, error);
    }
    return;
  }
  if (typeof wx.setStorageSync === 'function') {
    try {
      wx.setStorageSync(key, '');
    } catch (error) {
      console.warn(`[order] clear storage ${key} failed`, error);
    }
  }
}

function snapshotCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(catalog));
  } catch (error) {
    console.warn('[order] snapshot catalog failed', error);
    return null;
  }
}

function computeCatalogSignature(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return '';
  }
  const preferredKeys = ['signature', 'generatedAt', 'updatedAt', 'updated_at', 'version'];
  for (let i = 0; i < preferredKeys.length; i += 1) {
    const key = preferredKeys[i];
    const value = catalog[key];
    if (typeof value === 'string' && value.trim()) {
      return `${key}:${value.trim()}`;
    }
  }
  const timestampKeys = ['generatedAt', 'updatedAt', 'updated_at'];
  for (let i = 0; i < timestampKeys.length; i += 1) {
    const key = timestampKeys[i];
    const timestamp = resolveTimestamp(catalog[key]);
    if (Number.isFinite(timestamp)) {
      return `${key}:${timestamp}`;
    }
  }
  try {
    if (Array.isArray(catalog.sections)) {
      return JSON.stringify(catalog.sections);
    }
    return JSON.stringify(catalog);
  } catch (error) {
    console.warn('[order] compute catalog signature failed', error);
    return '';
  }
}

function readCatalogCache() {
  const stored = safeGetStorage(MENU_CATALOG_STORAGE_KEY);
  if (!stored || typeof stored !== 'object') {
    return null;
  }
  if (Array.isArray(stored.sections)) {
    return {
      catalog: stored,
      signature: stored.signature || computeCatalogSignature(stored)
    };
  }
  if (stored.catalog && typeof stored.catalog === 'object') {
    const catalog = stored.catalog;
    if (Array.isArray(catalog.sections)) {
      return {
        catalog,
        signature: stored.signature || computeCatalogSignature(catalog)
      };
    }
  }
  return null;
}

function writeCatalogCache(catalog) {
  const snapshot = snapshotCatalog(catalog);
  if (!snapshot || !Array.isArray(snapshot.sections)) {
    clearCatalogCache();
    return;
  }
  const payload = {
    version: 1,
    signature: computeCatalogSignature(snapshot),
    catalog: snapshot
  };
  safeSetStorage(MENU_CATALOG_STORAGE_KEY, payload);
}

function clearCatalogCache() {
  safeRemoveStorage(MENU_CATALOG_STORAGE_KEY);
}

function snapshotCartLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines
    .map((line) => {
      if (!line || typeof line !== 'object') {
        return null;
      }
      const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
      const spec = typeof line.spec === 'string' ? line.spec.trim() : '';
      if (!itemId || !spec) {
        return null;
      }
      const quantity = Number(line.quantity || 0);
      const minQuantity = Number(line.minQuantity || 0);
      const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
      const normalizedMin = Number.isFinite(minQuantity) && minQuantity > 0 ? Math.floor(minQuantity) : 0;
      if (!normalizedQuantity && !normalizedMin) {
        return null;
      }
      return {
        itemId,
        spec,
        quantity: Math.max(1, normalizedQuantity || normalizedMin || 1),
        minQuantity: Math.max(1, normalizedMin || 1)
      };
    })
    .filter(Boolean);
}

function readCartCache() {
  const stored = safeGetStorage(MENU_CART_STORAGE_KEY);
  if (!stored) {
    return [];
  }
  if (Array.isArray(stored)) {
    return stored;
  }
  if (stored && Array.isArray(stored.cart)) {
    return stored.cart;
  }
  return [];
}

function writeCartCache(lines) {
  const snapshot = snapshotCartLines(lines);
  if (!snapshot.length) {
    clearCartCache();
    return;
  }
  const payload = {
    version: 1,
    cart: snapshot,
    updatedAt: Date.now()
  };
  safeSetStorage(MENU_CART_STORAGE_KEY, payload);
}

function clearCartCache() {
  safeRemoveStorage(MENU_CART_STORAGE_KEY);
}

function resolveCartVariant(item, line) {
  if (!item || !Array.isArray(item.variants)) {
    return null;
  }
  const spec = line && typeof line.spec === 'string' ? line.spec.trim() : '';
  if (spec) {
    const matched = item.variants.find((variant) => variant && variant.label === spec);
    if (matched) {
      return matched;
    }
  }
  const price = Number(line && line.price);
  if (Number.isFinite(price) && price > 0) {
    const matchedByPrice = item.variants.find(
      (variant) => Number(variant && variant.price) === price
    );
    if (matchedByPrice) {
      return matchedByPrice;
    }
  }
  return item.variants[0] || null;
}

function resolveCartQuantities(line, item) {
  const candidates = [];
  if (line && typeof line.minQuantity !== 'undefined') {
    candidates.push(line.minQuantity);
  }
  if (item && typeof item.minQuantity !== 'undefined') {
    candidates.push(item.minQuantity);
  }
  const minQuantity = candidates.reduce((acc, value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.max(acc, Math.floor(numeric));
    }
    return acc;
  }, 1);
  const numericQuantity = Number(line && line.quantity);
  const resolvedQuantity =
    Number.isFinite(numericQuantity) && numericQuantity > 0
      ? Math.floor(numericQuantity)
      : minQuantity;
  return {
    minQuantity,
    quantity: Math.max(minQuantity, resolvedQuantity)
  };
}

function normalizeCartInputLine(line) {
  if (!line || typeof line !== 'object') {
    return null;
  }
  const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
  if (!itemId) {
    return null;
  }
  const item = ITEM_MAP[itemId];
  if (!item) {
    return null;
  }
  const variant = resolveCartVariant(item, line);
  if (!variant) {
    return null;
  }
  const quantities = resolveCartQuantities(line, item);
  return {
    key: `${item.id}|${variant.label}`,
    itemId: item.id,
    title: item.title,
    spec: variant.label,
    unit: variant.unit || '',
    price: variant.price,
    quantity: quantities.quantity,
    section: item.section,
    minQuantity: quantities.minQuantity
  };
}

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

function normalizeAppliedRights(source) {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const title = typeof entry.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : '权益抵扣';
      const amount = Number(entry.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return null;
      }
      const type = typeof entry.type === 'string' ? entry.type : '';
      const rightId = typeof entry.rightId === 'string' ? entry.rightId : '';
      return {
        ...entry,
        title,
        amount,
        amountLabel: formatCurrency(amount),
        type,
        rightId
      };
    })
    .filter(Boolean);
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
  const appliedRights = normalizeAppliedRights(order.appliedRights);
  let discountTotal = Number(order.discountTotal || 0);
  if ((!Number.isFinite(discountTotal) || discountTotal <= 0) && appliedRights.length) {
    discountTotal = appliedRights.reduce((sum, entry) => sum + entry.amount, 0);
  }
  discountTotal = Number.isFinite(discountTotal) ? Math.max(0, discountTotal) : 0;
  const discountTotalLabel = discountTotal > 0 ? formatCurrency(discountTotal) : '';
  const drinkVoucherApplied = appliedRights.some(
    (entry) => entry.type === 'drinkVoucher' || entry.rightId === 'right_realm_qi_drink'
  );
  const cubaneyVoucherApplied = appliedRights.some(
    (entry) => entry.type === 'cubaneyVoucher' || entry.rightId === CUBANEY_VOUCHER_RIGHT_ID
  );
  const voucherBadges = [];
  if (drinkVoucherApplied) {
    voucherBadges.push('饮品券已使用');
  }
  if (cubaneyVoucherApplied) {
    voucherBadges.push('古巴邑券已使用');
  }
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
  const showOriginalTotal =
    Number.isFinite(originalTotalAmount) &&
    originalTotalAmount > 0 &&
    originalTotalAmount !== totalAmount;
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
    appliedRights,
    discountTotal,
    discountTotalLabel,
    drinkVoucherApplied,
    cubaneyVoucherApplied,
    voucherBadges,
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
    canCancel,
    showOriginalTotal
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

function resolveDrinkVoucherCandidateForCart(cart, limit = DRINK_VOUCHER_AMOUNT_LIMIT, sectionId = 'drinks') {
  if (!Array.isArray(cart) || !cart.length) {
    return null;
  }
  let targetIndex = -1;
  let highestPrice = -1;
  cart.forEach((line, index) => {
    if (!line) {
      return;
    }
    const section = normalizeSection(line.section);
    if (section !== sectionId) {
      return;
    }
    const price = Number(line.price || 0);
    const quantity = Math.max(1, Math.floor(Number(line.quantity || 0)));
    const amount = Number(line.amount || price * quantity);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      price > limit ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }
    if (price > highestPrice) {
      highestPrice = price;
      targetIndex = index;
    }
  });
  if (targetIndex < 0) {
    return null;
  }
  const line = cart[targetIndex];
  const price = Number(line.price || 0);
  const quantity = Math.max(1, Math.floor(Number(line.quantity || 0)));
  const amount = Number(line.amount || price * quantity);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const discount = Math.min(limit, price, amount);
  if (discount <= 0) {
    return null;
  }
  return {
    index: targetIndex,
    line,
    price,
    quantity,
    amount,
    discount
  };
}

function buildDrinkVoucherPreview({ cart = [], total = 0, useVoucher = false, available = false } = {}) {
  const candidate = resolveDrinkVoucherCandidateForCart(cart, DRINK_VOUCHER_AMOUNT_LIMIT, 'drinks');
  const canApply = available && !!candidate;
  const shouldApply = canApply && useVoucher;
  const discountTotal = shouldApply && candidate ? candidate.discount : 0;
  const payableTotal = Math.max(0, total - discountTotal);
  return {
    candidate: candidate
      ? {
          key: candidate.line.key || '',
          title: candidate.line.title || '',
          spec: candidate.line.spec || '',
          unit: candidate.line.unit || '',
          price: candidate.price,
          priceLabel: formatCurrency(candidate.price),
          discount: candidate.discount,
          discountLabel: formatCurrency(candidate.discount)
        }
      : null,
    canApply,
    shouldApply,
    discountTotal,
    discountLabel: discountTotal > 0 ? formatCurrency(discountTotal) : '',
    payableTotal
  };
}

function resolveCubaneyVoucherCandidateForCart(cart, voucherAmount = CUBANEY_VOUCHER_AMOUNT) {
  if (!Array.isArray(cart) || !cart.length) {
    return null;
  }
  for (let index = 0; index < cart.length; index += 1) {
    const line = cart[index];
    if (!line) {
      continue;
    }
    const section = normalizeSection(line.section);
    if (section !== 'drinks') {
      continue;
    }
    const itemId = typeof line.itemId === 'string' ? line.itemId.trim().toLowerCase() : '';
    const title = typeof line.title === 'string' ? line.title : '';
    const spec = typeof line.spec === 'string' ? line.spec.trim() : '';
    const matchedMenu = CUBANEY_MENU_IDS.some((id) => id === itemId || (itemId && itemId.endsWith(id)));
    const matchedTitle = CUBANEY_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
    if (!matchedMenu && !matchedTitle) {
      continue;
    }
    if (spec && !/瓶/.test(spec)) {
      continue;
    }
    const price = Number(line.price || 0);
    const quantity = Math.max(1, Math.floor(Number(line.quantity || 0)));
    const amount = Number(line.amount || price * quantity);
    if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) {
      continue;
    }
    if (price < voucherAmount && amount < voucherAmount) {
      continue;
    }
    const discount = Math.min(voucherAmount, amount);
    if (discount <= 0) {
      continue;
    }
    return { index, line, price, quantity, amount, discount };
  }
  return null;
}

function buildCubaneyVoucherPreview({ cart = [], total = 0, useVoucher = false, available = false } = {}) {
  const candidate = resolveCubaneyVoucherCandidateForCart(cart, CUBANEY_VOUCHER_AMOUNT);
  const canApply = available && !!candidate;
  const shouldApply = canApply && useVoucher;
  const discountTotal = shouldApply && candidate ? candidate.discount : 0;
  const payableTotal = Math.max(0, total - discountTotal);
  return {
    candidate: candidate
      ? {
          key: candidate.line.key || '',
          title: candidate.line.title || '',
          spec: candidate.line.spec || '',
          unit: candidate.line.unit || '',
          price: candidate.price,
          priceLabel: formatCurrency(candidate.price),
          discount: candidate.discount,
          discountLabel: formatCurrency(candidate.discount)
        }
      : null,
    canApply,
    shouldApply,
    discountTotal,
    discountLabel: discountTotal > 0 ? formatCurrency(discountTotal) : '',
    payableTotal
  };
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
    cartDiscountTotal: 0,
    cartDiscountLabel: '',
    cartPayableTotal: 0,
    cartPayableLabel: formatCurrency(0),
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
    cancellingId: '',
    drinkVoucherAvailable: false,
    drinkVoucherLoading: false,
    drinkVoucherCanApply: false,
    drinkVoucherCandidate: null,
    drinkVoucherDiscount: 0,
    drinkVoucherDiscountLabel: '',
    useDrinkVoucher: true,
    cubaneyVoucherAvailable: false,
    cubaneyVoucherLoading: false,
    cubaneyVoucherCanApply: false,
    cubaneyVoucherCandidate: null,
    cubaneyVoucherDiscount: 0,
    cubaneyVoucherDiscountLabel: '',
    useCubaneyVoucher: true
  },

  async syncMenuCacheVersion() {
    if (this._menuCacheVersionPromise) {
      return this._menuCacheVersionPromise;
    }
    this._menuCacheVersionPromise = (async () => {
      try {
        const result = await MemberService.getCacheVersions();
        const payload =
          (result && (result.versions || result.cacheVersions)) ||
          (result && result.data && (result.data.versions || result.data.cacheVersions)) ||
          {};
        const update = applyCacheVersionUpdate(payload);
        try {
          const appInstance = getApp();
          if (appInstance && appInstance.globalData) {
            appInstance.globalData.cacheVersions = update.versions;
          }
        } catch (error) {
          console.warn('[order] update global cache versions failed', error);
        }
        return update;
      } catch (error) {
        console.warn('[order] sync cache versions failed', error);
        return null;
      } finally {
        this._menuCacheVersionPromise = null;
      }
    })();
    return this._menuCacheVersionPromise;
  },

  onLoad() {
    this._currentCatalogSignature = '';
    this._catalogHydrated = false;
    this._cartHydrated = false;
    this._manualDrinkVoucherPreference = null;
    this._manualCubaneyVoucherPreference = null;
    this._loadingVoucher = null;
    const cachePromise = this.syncMenuCacheVersion();
    cachePromise
      .then((result) => {
        const mismatched = (result && result.mismatched) || [];
        const restored = this.restoreCatalogFromCache();
        if (restored) {
          this.restoreCartFromCache();
        }
        const needsReload = !restored || mismatched.includes('menu') || !result;
        if (needsReload) {
          this.loadCatalog();
        }
      })
      .catch(() => {
        const restored = this.restoreCatalogFromCache();
        if (restored) {
          this.restoreCartFromCache();
        }
        this.loadCatalog();
      });
    this.loadOrders();
    this.loadVoucherStatus();
  },

  onShow() {
    if (this._cartHydrated) {
      this.refreshVoucherPreview();
    }
    this.loadVoucherStatus();
  },

  applyCatalogState(catalog, options = {}) {
    const state = rebuildMenuContext(catalog, new Date());
    const tabs = Array.isArray(state.tabs) ? state.tabs : [];
    const preserveSelection = !!options.preserveSelection;
    let nextActiveTab = state.defaultTabId || (tabs.length ? tabs[0].id : '');
    if (preserveSelection) {
      const currentTab = typeof this.data.activeTab === 'string' ? this.data.activeTab : '';
      if (currentTab && SECTION_MAP[currentTab]) {
        nextActiveTab = currentTab;
      }
    }
    let nextActiveCategory = state.defaultCategoryId;
    if (nextActiveTab && SECTION_MAP[nextActiveTab]) {
      const section = SECTION_MAP[nextActiveTab];
      if (preserveSelection) {
        const currentCategory = typeof this.data.activeCategory === 'string' ? this.data.activeCategory : '';
        if (currentCategory && section.categoryItems[currentCategory]) {
          nextActiveCategory = currentCategory;
        } else {
          nextActiveCategory = section.defaultCategoryId;
        }
      } else {
        nextActiveCategory = section.defaultCategoryId;
      }
    }
    this.setData({
      tabs,
      activeTab: nextActiveTab,
      cartSectionTotals: createEmptyCategoryTotals()
    });
    this.applySectionState(nextActiveTab, nextActiveCategory);
    this._catalogHydrated = true;
  },

  restoreCatalogFromCache() {
    const cached = readCatalogCache();
    if (!cached || !cached.catalog || !Array.isArray(cached.catalog.sections)) {
      return false;
    }
    this.applyCatalogState(cached.catalog, { preserveSelection: false });
    this._currentCatalogSignature = cached.signature || computeCatalogSignature(cached.catalog);
    return true;
  },

  restoreCartFromCache() {
    if (this._cartHydrated) {
      return false;
    }
    if (!MENU_SECTIONS.length || !Object.keys(ITEM_MAP).length) {
      return false;
    }
    const snapshots = readCartCache();
    this._cartHydrated = true;
    if (!Array.isArray(snapshots) || !snapshots.length) {
      return false;
    }
    const normalized = snapshots.map((line) => normalizeCartInputLine(line)).filter(Boolean);
    if (!normalized.length) {
      clearCartCache();
      return false;
    }
    this.updateCartState(normalized);
    return true;
  },

  reconcileCartWithMenu() {
    if (!MENU_SECTIONS.length || !Object.keys(ITEM_MAP).length) {
      return;
    }
    const currentCart = Array.isArray(this.data.cart) ? this.data.cart : [];
    if (!currentCart.length) {
      clearCartCache();
      return;
    }
    const normalized = currentCart.map((line) => normalizeCartInputLine(line)).filter(Boolean);
    this.updateCartState(normalized);
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
        const snapshot = snapshotCatalog(catalog) || catalog;
        const signature = computeCatalogSignature(snapshot);
        if (!this._catalogHydrated || signature !== this._currentCatalogSignature) {
          this.applyCatalogState(snapshot, { preserveSelection: this._catalogHydrated });
        } else {
          rebuildMenuContext(snapshot, new Date());
          const currentTab = typeof this.data.activeTab === 'string' ? this.data.activeTab : '';
          const currentCategory = typeof this.data.activeCategory === 'string' ? this.data.activeCategory : '';
          this.applySectionState(currentTab, currentCategory);
        }
        this._currentCatalogSignature = signature;
        writeCatalogCache(snapshot);
        if (!this._cartHydrated) {
          this.restoreCartFromCache();
        } else {
          this.reconcileCartWithMenu();
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

  updateCartState(nextCart, options = {}) {
    const skipCache = !!options.skipCache;
    const decorated = decorateCart(nextCart);
    const total = computeCartTotal(decorated);
    const sectionTotals = calculateSectionTotals(decorated);
    const drinkVoucherAvailable = !!this.data.drinkVoucherAvailable;
    const cubaneyVoucherAvailable = !!this.data.cubaneyVoucherAvailable;
    const useDrink = drinkVoucherAvailable ? !!this.data.useDrinkVoucher : false;
    const useCubaney = cubaneyVoucherAvailable ? !!this.data.useCubaneyVoucher : false;
    const voucherCart = decorated.map((line) => ({ ...line }));
    const drinkPreview = buildDrinkVoucherPreview({
      cart: voucherCart,
      total,
      useVoucher: useDrink,
      available: drinkVoucherAvailable
    });
    if (drinkPreview.shouldApply && drinkPreview.discountTotal > 0 && drinkPreview.candidate) {
      const targetIndex = voucherCart.findIndex((line) => line && line.key === drinkPreview.candidate.key);
      if (targetIndex >= 0) {
        const target = voucherCart[targetIndex];
        const currentAmount = Number(target.amount || target.price * target.quantity || 0);
        const discount = Number(drinkPreview.discountTotal || 0);
        const nextAmount = Math.max(0, currentAmount - discount);
        voucherCart[targetIndex] = {
          ...target,
          amount: nextAmount,
          discount: (Number(target.discount || 0) || 0) + discount
        };
      }
    }
    const totalAfterDrink = Math.max(0, total - drinkPreview.discountTotal);
    const cubaneyPreview = buildCubaneyVoucherPreview({
      cart: voucherCart,
      total: totalAfterDrink,
      useVoucher: useCubaney,
      available: cubaneyVoucherAvailable
    });
    const totalDiscount = drinkPreview.discountTotal + cubaneyPreview.discountTotal;
    const payableTotal = Math.max(0, total - totalDiscount);
    const stoneReward = Math.max(0, Math.floor(payableTotal));
    this.setData({
      cart: decorated,
      cartGroups: groupLinesBySection(decorated),
      cartSectionTotals: sectionTotals,
      cartTotal: total,
      cartTotalLabel: formatCurrency(total),
      cartDiscountTotal: totalDiscount,
      cartDiscountLabel: totalDiscount > 0 ? formatCurrency(totalDiscount) : '',
      cartPayableTotal: payableTotal,
      cartPayableLabel: formatCurrency(payableTotal),
      cartStoneReward: stoneReward,
      cartStoneRewardLabel: formatStones(stoneReward),
      drinkVoucherCanApply: drinkPreview.canApply,
      drinkVoucherCandidate: drinkPreview.candidate,
      drinkVoucherDiscount: drinkPreview.discountTotal,
      drinkVoucherDiscountLabel: drinkPreview.discountLabel,
      cubaneyVoucherCanApply: cubaneyPreview.canApply,
      cubaneyVoucherCandidate: cubaneyPreview.candidate,
      cubaneyVoucherDiscount: cubaneyPreview.discountTotal,
      cubaneyVoucherDiscountLabel: cubaneyPreview.discountLabel
    });
    if (!skipCache) {
      writeCartCache(decorated);
    }
  },

  refreshVoucherPreview() {
    const currentCart = Array.isArray(this.data.cart) ? this.data.cart.map((line) => ({ ...line })) : [];
    this.updateCartState(currentCart, { skipCache: true });
  },

  async loadVoucherStatus() {
    if (this._loadingVoucher) {
      return this._loadingVoucher;
    }
    this._loadingVoucher = (async () => {
      this.setData({ drinkVoucherLoading: true, cubaneyVoucherLoading: true });
      try {
        const rights = await MemberService.getRights();
        const drinkAvailable = Array.isArray(rights)
          ? rights.some(
              (right) =>
                right &&
                right.status === 'active' &&
                (right.type === 'drinkVoucher' || right.rightId === DRINK_VOUCHER_RIGHT_ID)
            )
          : false;
        const cubaneyAvailable = Array.isArray(rights)
          ? rights.some(
              (right) =>
                right &&
                right.status === 'active' &&
                (right.type === 'cubaneyVoucher' || right.rightId === CUBANEY_VOUCHER_RIGHT_ID)
            )
          : false;
        const drinkPreference =
          typeof this._manualDrinkVoucherPreference === 'boolean'
            ? this._manualDrinkVoucherPreference
            : null;
        const cubaneyPreference =
          typeof this._manualCubaneyVoucherPreference === 'boolean'
            ? this._manualCubaneyVoucherPreference
            : null;
        this.setData({
          drinkVoucherAvailable: drinkAvailable,
          useDrinkVoucher: drinkAvailable ? (drinkPreference === null ? true : drinkPreference) : false,
          drinkVoucherLoading: false,
          cubaneyVoucherAvailable: cubaneyAvailable,
          useCubaneyVoucher: cubaneyAvailable
            ? cubaneyPreference === null
              ? true
              : cubaneyPreference
            : false,
          cubaneyVoucherLoading: false
        });
      } catch (error) {
        this.setData({ drinkVoucherLoading: false, cubaneyVoucherLoading: false });
      } finally {
        this._loadingVoucher = null;
        this.refreshVoucherPreview();
      }
    })();
    return this._loadingVoucher;
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

  handleToggleDrinkVoucher(event) {
    if (!this.data.drinkVoucherAvailable) {
      return;
    }
    const useVoucher = !!(event && event.detail && event.detail.value);
    this._manualDrinkVoucherPreference = useVoucher;
    this.setData({ useDrinkVoucher: useVoucher });
    this.refreshVoucherPreview();
  },

  handleToggleCubaneyVoucher(event) {
    if (!this.data.cubaneyVoucherAvailable) {
      return;
    }
    const useVoucher = !!(event && event.detail && event.detail.value);
    this._manualCubaneyVoucherPreference = useVoucher;
    this.setData({ useCubaneyVoucher: useVoucher });
    this.refreshVoucherPreview();
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
    const useDrinkVoucher =
      this.data.drinkVoucherAvailable && this.data.useDrinkVoucher && this.data.drinkVoucherCanApply;
    const useCubaneyVoucher =
      this.data.cubaneyVoucherAvailable &&
      this.data.useCubaneyVoucher &&
      this.data.cubaneyVoucherCanApply;
    try {
      await MenuOrderService.createOrder({
        items,
        remark: this.data.remark,
        categoryTotals: this.data.cartSectionTotals,
        useDrinkVoucher,
        useCubaneyVoucher
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
