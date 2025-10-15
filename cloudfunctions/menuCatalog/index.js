const cloud = require('wx-server-sdk');
const { COLLECTIONS, DEFAULT_ADMIN_ROLES } = require('common-config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const dbCommand = db.command;

const ADMIN_ROLES = [...new Set([...DEFAULT_ADMIN_ROLES, 'superadmin'])];
const ensuredCollections = new Set();

const ACTIONS = {
  LIST: 'listCatalog',
  ADMIN_LIST: 'adminListCatalog',
  CREATE_SECTION: 'createSection',
  CREATE_CATEGORY: 'createCategory',
  CREATE_ITEM: 'createItem',
  UPDATE_SECTION: 'updateSection',
  UPDATE_CATEGORY: 'updateCategory',
  UPDATE_ITEM: 'updateItem'
};

function resolveAction(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed) {
      const normalized = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
      if (normalized === 'adminlist' || normalized === 'listadmin') {
        return ACTIONS.ADMIN_LIST;
      }
      if (normalized === 'createsection') {
        return ACTIONS.CREATE_SECTION;
      }
      if (normalized === 'createcategory') {
        return ACTIONS.CREATE_CATEGORY;
      }
      if (normalized === 'createitem') {
        return ACTIONS.CREATE_ITEM;
      }
      if (normalized === 'updatesection') {
        return ACTIONS.UPDATE_SECTION;
      }
      if (normalized === 'updatecategory') {
        return ACTIONS.UPDATE_CATEGORY;
      }
      if (normalized === 'updateitem') {
        return ACTIONS.UPDATE_ITEM;
      }
      if (normalized === 'list' || normalized === 'listcatalog') {
        return ACTIONS.LIST;
      }
      return trimmed;
    }
  }
  return ACTIONS.LIST;
}

function isCollectionNotFoundError(error) {
  if (!error) return false;
  if (error.errCode === -502005 || error.code === 'ResourceNotFound') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /collection\s+not\s+exists/i.test(message) || /ResourceNotFound/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error) return false;
  if (error.errCode === -502006 || error.code === 'ResourceExists') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /already\s+exists/i.test(message);
}

async function ensureCollection(name) {
  if (!name || ensuredCollections.has(name)) {
    return;
  }
  try {
    await db
      .collection(name)
      .limit(1)
      .get();
    ensuredCollections.add(name);
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
    if (typeof db.createCollection !== 'function') {
      throw error;
    }
    try {
      await db.createCollection(name);
      ensuredCollections.add(name);
    } catch (createError) {
      if (isCollectionAlreadyExistsError(createError)) {
        ensuredCollections.add(name);
        return;
      }
      throw createError;
    }
  }
}

async function ensureAdmin(openid) {
  if (!openid) {
    throw new Error('未获取到用户身份');
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .get()
    .catch(() => null);
  const member = doc && doc.data;
  if (!member) {
    throw new Error('账号不存在');
  }
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    throw new Error('无权访问管理员功能');
  }
  return member;
}

async function fetchAll(collectionName, where = {}, options = {}) {
  await ensureCollection(collectionName);
  const limit = Math.max(20, Math.min(100, Number(options.limit) || 100));
  let offset = 0;
  let hasMore = true;
  const result = [];
  while (hasMore) {
    const snapshot = await db
      .collection(collectionName)
      .where(where)
      .skip(offset)
      .limit(limit)
      .get();
    const data = Array.isArray(snapshot.data) ? snapshot.data : [];
    result.push(...data);
    if (data.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }
  return result;
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .replace(/[^0-9a-zA-Z_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function resolveSortOrder(value, defaultValue = 1000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultValue;
  }
  return Math.max(-100000, Math.min(100000, Math.floor(numeric)));
}

function resolveOptionalSortOrder(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return resolveSortOrder(numeric);
}

function resolveTimeSortOrder(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const candidate = resolveOptionalSortOrder(values[i]);
    if (typeof candidate === 'number') {
      return candidate;
    }
  }
  return undefined;
}

function toPositiveInteger(value, defaultValue = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return defaultValue;
  }
  return Math.max(1, Math.floor(numeric));
}

function toNonNegativeInteger(value, defaultValue = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return defaultValue;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizePriceFen(value) {
  if (value == null) {
    return 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const sanitized = trimmed.replace(/[^0-9.-]/g, '');
    const numeric = Number(sanitized);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    if (trimmed.includes('.')) {
      return Math.max(0, Math.round(numeric * 100));
    }
    return Math.max(0, Math.round(numeric));
  }
  return 0;
}

function normalizeVariantInput(variant) {
  if (!variant) {
    return null;
  }
  const label = typeof variant.label === 'string' ? variant.label.trim() : '';
  const unit = typeof variant.unit === 'string' ? variant.unit.trim() : '';
  let price = normalizePriceFen(variant.price);
  if (!price && typeof variant.priceYuan !== 'undefined') {
    price = normalizePriceFen(Number(variant.priceYuan) * 100);
  }
  if (!price && typeof variant.price_yuan !== 'undefined') {
    price = normalizePriceFen(Number(variant.price_yuan) * 100);
  }
  if (!price && typeof variant.priceYuan === 'string') {
    price = normalizePriceFen(Number(variant.priceYuan) * 100);
  }
  if (!price && typeof variant.price === 'string') {
    price = normalizePriceFen(variant.price);
  }
  if (!price) {
    return null;
  }
  return {
    label,
    unit,
    price
  };
}

function normalizeVariants(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const variants = input
    .map(normalizeVariantInput)
    .filter(Boolean);
  if (!variants.length) {
    return [];
  }
  return variants;
}

function isRecordEnabled(record, { includeInactive = false } = {}) {
  const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
  if (includeInactive) {
    return status !== 'archived' && status !== 'deleted';
  }
  if (!status) {
    return true;
  }
  return ['active', 'enabled', 'online', 'published'].includes(status);
}

function normalizeSectionRecord(record) {
  if (!record) {
    return null;
  }
  const sectionId = normalizeIdentifier(record.sectionId || record.id || record.slug || record.key || record.code);
  const name = normalizeName(record.name || record.title || record.label || '');
  if (!sectionId || !name) {
    return null;
  }
  return {
    _id: record._id || '',
    sectionId,
    name,
    title: record.title ? normalizeName(record.title) : name,
    sortOrder: resolveSortOrder(record.sortOrder),
    status: typeof record.status === 'string' ? record.status : '',
    enabled: isRecordEnabled(record),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

function normalizeCategoryRecord(record) {
  if (!record) {
    return null;
  }
  const categoryId = normalizeIdentifier(record.categoryId || record.id || record.slug || record.code);
  const sectionId = normalizeIdentifier(record.sectionId || record.parentId || record.section || '');
  const name = normalizeName(record.name || record.title || record.label || '');
  if (!categoryId || !sectionId || !name) {
    return null;
  }
  const daySortOrder = resolveOptionalSortOrder(
    record.daySortOrder ?? (record.timeSort && (record.timeSort.daySortOrder ?? record.timeSort.dayOrder ?? record.timeSort.day))
  );
  const nightSortOrder = resolveOptionalSortOrder(
    record.nightSortOrder ??
      (record.timeSort && (record.timeSort.nightSortOrder ?? record.timeSort.nightOrder ?? record.timeSort.night))
  );
  const normalized = {
    _id: record._id || '',
    sectionId,
    categoryId,
    name,
    sortOrder: resolveSortOrder(record.sortOrder),
    status: typeof record.status === 'string' ? record.status : '',
    enabled: isRecordEnabled(record),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
  if (typeof daySortOrder === 'number') {
    normalized.daySortOrder = daySortOrder;
  }
  if (typeof nightSortOrder === 'number') {
    normalized.nightSortOrder = nightSortOrder;
  }
  return normalized;
}

function normalizeItemRecord(record) {
  if (!record) {
    return null;
  }
  const itemId = normalizeIdentifier(record.itemId || record.id || record.sku || record.code);
  const sectionId = normalizeIdentifier(record.sectionId || record.section || '');
  const categoryId = normalizeIdentifier(record.categoryId || record.category || record.cat || '');
  const title = normalizeName(record.title || record.name || '');
  if (!itemId || !sectionId || !categoryId || !title) {
    return null;
  }
  const variants = normalizeVariants(record.variants || record.options || []);
  if (!variants.length) {
    return null;
  }
  const minQuantity = toNonNegativeInteger(record.minQuantity || record.minimum || record.min || 0, 0);
  return {
    _id: record._id || '',
    itemId,
    sectionId,
    categoryId,
    title,
    desc: typeof record.desc === 'string' ? record.desc : record.description || '',
    img: typeof record.img === 'string' ? record.img : record.image || '',
    variants,
    minQuantity,
    sortOrder: resolveSortOrder(record.sortOrder),
    status: typeof record.status === 'string' ? record.status : '',
    enabled: isRecordEnabled(record),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

function sortByOrderAndTime(list) {
  return list.slice().sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : 1000;
    const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : 1000;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(a.createdAt) || 0;
    const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(b.createdAt) || 0;
    return timeA - timeB;
  });
}

function buildCatalogSections(sections, categories, items) {
  const enabledSections = sections.filter((section) => section.enabled);
  if (!enabledSections.length) {
    return [];
  }
  const enabledCategories = categories.filter((category) => category.enabled);
  const enabledItems = items.filter((item) => item.enabled);

  const categoriesBySection = enabledCategories.reduce((acc, category) => {
    if (!acc[category.sectionId]) {
      acc[category.sectionId] = [];
    }
    acc[category.sectionId].push(category);
    return acc;
  }, {});

  const itemsBySection = enabledItems.reduce((acc, item) => {
    if (!acc[item.sectionId]) {
      acc[item.sectionId] = [];
    }
    acc[item.sectionId].push(item);
    return acc;
  }, {});

  const itemsByCategory = enabledItems.reduce((acc, item) => {
    if (!acc[item.categoryId]) {
      acc[item.categoryId] = [];
    }
    acc[item.categoryId].push(item);
    return acc;
  }, {});

  return sortByOrderAndTime(enabledSections).map((section) => {
    const sectionCategories = sortByOrderAndTime(categoriesBySection[section.sectionId] || []);
    const sectionItems = sortByOrderAndTime(itemsBySection[section.sectionId] || []);
    const categorySet = new Set((itemsByCategory && sectionItems.length)
      ? sectionItems.map((item) => item.categoryId)
      : []);
    const normalizedCategories = sectionCategories
      .filter((category) => categorySet.size === 0 || categorySet.has(category.categoryId))
      .map((category) => {
        const normalized = { id: category.categoryId, name: category.name };
        if (typeof category.sortOrder === 'number') {
          normalized.sortOrder = category.sortOrder;
        }
        if (typeof category.daySortOrder === 'number') {
          normalized.daySortOrder = category.daySortOrder;
        }
        if (typeof category.nightSortOrder === 'number') {
          normalized.nightSortOrder = category.nightSortOrder;
        }
        return normalized;
      });
    const normalizedItems = sectionItems.map((item) => ({
      id: item.itemId,
      cat: item.categoryId,
      title: item.title,
      desc: item.desc || '',
      img: item.img || '',
      variants: item.variants.map((variant) => ({
        label: variant.label || '',
        unit: variant.unit || '',
        price: variant.price
      })),
      minQuantity: item.minQuantity || 0
    }));
    return {
      id: section.sectionId,
      title: section.title || section.name,
      categories: normalizedCategories,
      items: normalizedItems
    };
  }).filter((section) => section.items && section.items.length);
}

async function loadCatalogData(options = {}) {
  const includeInactive = !!options.includeInactive;
  const [sectionDocs, categoryDocs, itemDocs] = await Promise.all([
    fetchAll(COLLECTIONS.MENU_SECTIONS, {}, options),
    fetchAll(COLLECTIONS.MENU_CATEGORIES, {}, options),
    fetchAll(COLLECTIONS.MENU_ITEMS, {}, options)
  ]);
  const sections = sectionDocs.map(normalizeSectionRecord).filter(Boolean);
  const categories = categoryDocs.map(normalizeCategoryRecord).filter(Boolean);
  const items = itemDocs.map(normalizeItemRecord).filter(Boolean);

  if (!includeInactive) {
    return { sections, categories, items };
  }
  return {
    sections: sections.map((section) => ({ ...section, enabled: isRecordEnabled(section) })),
    categories: categories.map((category) => ({ ...category, enabled: isRecordEnabled(category) })),
    items: items.map((item) => ({ ...item, enabled: isRecordEnabled(item) }))
  };
}

async function listCatalog() {
  const data = await loadCatalogData({ includeInactive: false });
  const sections = buildCatalogSections(data.sections, data.categories, data.items);
  return {
    catalog: {
      sections,
      generatedAt: new Date().toISOString()
    }
  };
}

async function adminListCatalog(openid) {
  await ensureAdmin(openid);
  const data = await loadCatalogData({ includeInactive: true });
  const sections = buildCatalogSections(data.sections, data.categories, data.items);
  return {
    catalog: {
      sections,
      generatedAt: new Date().toISOString()
    },
    sectionsRaw: data.sections,
    categoriesRaw: data.categories,
    itemsRaw: data.items
  };
}

async function findSectionById(sectionId) {
  if (!sectionId) {
    return null;
  }
  const snapshot = await db
    .collection(COLLECTIONS.MENU_SECTIONS)
    .where({ sectionId })
    .limit(1)
    .get();
  const data = Array.isArray(snapshot.data) ? snapshot.data : [];
  return data.length ? data[0] : null;
}

async function findCategoryById(sectionId, categoryId) {
  if (!sectionId || !categoryId) {
    return null;
  }
  const snapshot = await db
    .collection(COLLECTIONS.MENU_CATEGORIES)
    .where({ sectionId, categoryId })
    .limit(1)
    .get();
  const data = Array.isArray(snapshot.data) ? snapshot.data : [];
  return data.length ? data[0] : null;
}

async function findItemById(itemId) {
  if (!itemId) {
    return null;
  }
  const snapshot = await db
    .collection(COLLECTIONS.MENU_ITEMS)
    .where({ itemId })
    .limit(1)
    .get();
  const data = Array.isArray(snapshot.data) ? snapshot.data : [];
  return data.length ? data[0] : null;
}

async function createSection(openid, input = {}) {
  const admin = await ensureAdmin(openid);
  const sectionId = normalizeIdentifier(input.sectionId || input.id || '');
  const name = normalizeName(input.name || input.title || '');
  if (!sectionId) {
    throw new Error('请输入一级类目标识');
  }
  if (!name) {
    throw new Error('请输入一级类目名称');
  }
  const existing = await findSectionById(sectionId);
  if (existing) {
    throw new Error('一级类目标识已存在');
  }
  const now = new Date();
  const record = {
    sectionId,
    name,
    title: normalizeName(input.title || name),
    sortOrder: resolveSortOrder(input.sortOrder, 1000),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: admin._id || admin.openid || '',
    updatedBy: admin._id || admin.openid || ''
  };
  const result = await db.collection(COLLECTIONS.MENU_SECTIONS).add({ data: record });
  return {
    section: { _id: result._id, ...record }
  };
}

async function createCategory(openid, input = {}) {
  await ensureAdmin(openid);
  const sectionId = normalizeIdentifier(input.sectionId || input.parentId || '');
  const categoryId = normalizeIdentifier(input.categoryId || input.id || '');
  const name = normalizeName(input.name || input.title || '');
  if (!sectionId) {
    throw new Error('请选择一级类目');
  }
  if (!categoryId) {
    throw new Error('请输入二级类目标识');
  }
  if (!name) {
    throw new Error('请输入二级类目名称');
  }
  const section = await findSectionById(sectionId);
  if (!section) {
    throw new Error('一级类目不存在');
  }
  const existing = await findCategoryById(sectionId, categoryId);
  if (existing) {
    throw new Error('二级类目标识已存在');
  }
  const daySortOrder = resolveTimeSortOrder(
    input.daySortOrder,
    input.dayOrder,
    input.timeSort && (input.timeSort.daySortOrder ?? input.timeSort.dayOrder ?? input.timeSort.day)
  );
  const nightSortOrder = resolveTimeSortOrder(
    input.nightSortOrder,
    input.nightOrder,
    input.timeSort && (input.timeSort.nightSortOrder ?? input.timeSort.nightOrder ?? input.timeSort.night)
  );
  let status = 'active';
  if (typeof input.enabled === 'boolean') {
    status = input.enabled ? 'active' : 'disabled';
  } else if (typeof input.status === 'string') {
    const normalizedStatus = input.status.trim().toLowerCase();
    if (normalizedStatus === 'active' || normalizedStatus === 'enabled' || normalizedStatus === 'online') {
      status = 'active';
    } else if (normalizedStatus === 'disabled' || normalizedStatus === 'inactive' || normalizedStatus === 'offline') {
      status = 'disabled';
    }
  }
  const now = new Date();
  const record = {
    sectionId,
    categoryId,
    name,
    sortOrder: resolveSortOrder(input.sortOrder, 1000),
    status,
    createdAt: now,
    updatedAt: now
  };
  if (typeof daySortOrder === 'number') {
    record.daySortOrder = daySortOrder;
  }
  if (typeof nightSortOrder === 'number') {
    record.nightSortOrder = nightSortOrder;
  }
  const result = await db.collection(COLLECTIONS.MENU_CATEGORIES).add({ data: record });
  return {
    category: { _id: result._id, ...record }
  };
}

async function createItem(openid, input = {}) {
  await ensureAdmin(openid);
  const sectionId = normalizeIdentifier(input.sectionId || input.section || '');
  const categoryId = normalizeIdentifier(input.categoryId || input.category || input.cat || '');
  const itemId = normalizeIdentifier(input.itemId || input.id || '');
  const title = normalizeName(input.title || input.name || '');
  if (!sectionId) {
    throw new Error('请选择一级类目');
  }
  if (!categoryId) {
    throw new Error('请选择二级类目');
  }
  if (!itemId) {
    throw new Error('请输入商品标识');
  }
  if (!title) {
    throw new Error('请输入商品名称');
  }
  const section = await findSectionById(sectionId);
  if (!section) {
    throw new Error('一级类目不存在');
  }
  const category = await findCategoryById(sectionId, categoryId);
  if (!category) {
    throw new Error('二级类目不存在');
  }
  const itemSnapshot = await db
    .collection(COLLECTIONS.MENU_ITEMS)
    .where({ itemId })
    .limit(1)
    .get();
  if (Array.isArray(itemSnapshot.data) && itemSnapshot.data.length) {
    throw new Error('商品标识已存在');
  }
  const variants = normalizeVariants(Array.isArray(input.variants) ? input.variants : [input.variant]);
  if (!variants.length) {
    throw new Error('请至少配置一个规格与价格');
  }
  const minQuantity = toNonNegativeInteger(input.minQuantity || input.minimum || 0, 0);
  const now = new Date();
  const record = {
    itemId,
    sectionId,
    categoryId,
    title,
    desc: typeof input.desc === 'string' ? input.desc : input.description || '',
    img: typeof input.img === 'string' ? input.img : input.image || '',
    variants,
    minQuantity,
    sortOrder: resolveSortOrder(input.sortOrder, 1000),
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const result = await db.collection(COLLECTIONS.MENU_ITEMS).add({ data: record });
  return {
    item: { _id: result._id, ...record }
  };
}

async function updateSection(openid, input = {}) {
  const admin = await ensureAdmin(openid);
  const sectionId = normalizeIdentifier(input.sectionId || input.id || '');
  if (!sectionId) {
    throw new Error('请选择一级类目');
  }
  const existing = await findSectionById(sectionId);
  if (!existing) {
    throw new Error('一级类目不存在');
  }
  const updates = {};
  const name = normalizeName(input.name || input.title || '');
  if (name) {
    updates.name = name;
    updates.title = normalizeName(input.title || name);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
    if (input.sortOrder !== '' && input.sortOrder !== null) {
      const currentOrder =
        typeof existing.sortOrder === 'number' ? existing.sortOrder : 1000;
      updates.sortOrder = resolveSortOrder(input.sortOrder, currentOrder);
    }
  }
  if (typeof input.enabled === 'boolean') {
    updates.status = input.enabled ? 'active' : 'disabled';
  } else if (typeof input.status === 'string') {
    const status = input.status.trim().toLowerCase();
    if (status === 'active' || status === 'enabled' || status === 'online') {
      updates.status = 'active';
    } else if (status === 'disabled' || status === 'inactive' || status === 'offline') {
      updates.status = 'disabled';
    }
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('未检测到需要保存的修改');
  }
  const now = new Date();
  updates.updatedAt = now;
  updates.updatedBy = admin._id || admin.openid || '';
  const collection = db.collection(COLLECTIONS.MENU_SECTIONS);
  if (existing._id) {
    await collection.doc(existing._id).update({ data: updates });
  } else {
    await collection.where({ sectionId }).update({ data: updates });
  }
  return { sectionId, updated: true };
}

async function updateCategory(openid, input = {}) {
  const admin = await ensureAdmin(openid);
  const sectionId = normalizeIdentifier(input.sectionId || input.parentId || '');
  const categoryId = normalizeIdentifier(input.categoryId || input.id || '');
  if (!sectionId) {
    throw new Error('请选择一级类目');
  }
  if (!categoryId) {
    throw new Error('请选择二级类目');
  }
  const existing = await findCategoryById(sectionId, categoryId);
  if (!existing) {
    throw new Error('二级类目不存在');
  }
  const updates = {};
  const name = normalizeName(input.name || input.title || '');
  if (name) {
    updates.name = name;
    updates.title = normalizeName(input.title || name);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
    if (input.sortOrder !== '' && input.sortOrder !== null) {
      const currentOrder =
        typeof existing.sortOrder === 'number' ? existing.sortOrder : 1000;
      updates.sortOrder = resolveSortOrder(input.sortOrder, currentOrder);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'daySortOrder')) {
    const value = resolveOptionalSortOrder(input.daySortOrder);
    updates.daySortOrder = typeof value === 'number' ? value : dbCommand.remove();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'nightSortOrder')) {
    const value = resolveOptionalSortOrder(input.nightSortOrder);
    updates.nightSortOrder = typeof value === 'number' ? value : dbCommand.remove();
  }
  if (typeof input.enabled === 'boolean') {
    updates.status = input.enabled ? 'active' : 'disabled';
  } else if (typeof input.status === 'string') {
    const status = input.status.trim().toLowerCase();
    if (status === 'active' || status === 'enabled' || status === 'online') {
      updates.status = 'active';
    } else if (status === 'disabled' || status === 'inactive' || status === 'offline') {
      updates.status = 'disabled';
    }
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('未检测到需要保存的修改');
  }
  const now = new Date();
  updates.updatedAt = now;
  updates.updatedBy = admin._id || admin.openid || '';
  const collection = db.collection(COLLECTIONS.MENU_CATEGORIES);
  if (existing._id) {
    await collection.doc(existing._id).update({ data: updates });
  } else {
    await collection.where({ sectionId, categoryId }).update({ data: updates });
  }
  return { sectionId, categoryId, updated: true };
}

async function updateItem(openid, input = {}) {
  const admin = await ensureAdmin(openid);
  const itemId = normalizeIdentifier(input.itemId || input.id || '');
  if (!itemId) {
    throw new Error('请选择商品');
  }
  const existing = await findItemById(itemId);
  if (!existing) {
    throw new Error('商品不存在');
  }
  const sectionId = normalizeIdentifier(input.sectionId || existing.sectionId || '');
  const categoryId = normalizeIdentifier(input.categoryId || existing.categoryId || '');
  if (!sectionId) {
    throw new Error('请选择一级类目');
  }
  if (!categoryId) {
    throw new Error('请选择二级类目');
  }
  if (sectionId !== existing.sectionId) {
    const section = await findSectionById(sectionId);
    if (!section) {
      throw new Error('一级类目不存在');
    }
  }
  if (categoryId !== existing.categoryId) {
    const category = await findCategoryById(sectionId, categoryId);
    if (!category) {
      throw new Error('二级类目不存在');
    }
  }
  const updates = {};
  const title = normalizeName(input.title || input.name || '');
  if (title) {
    updates.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'desc')) {
    updates.desc = typeof input.desc === 'string' ? input.desc : '';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'image') || Object.prototype.hasOwnProperty.call(input, 'img')) {
    const image = typeof input.image === 'string' ? input.image : typeof input.img === 'string' ? input.img : '';
    updates.img = image || '';
  }
  if (sectionId !== existing.sectionId) {
    updates.sectionId = sectionId;
  }
  if (categoryId !== existing.categoryId) {
    updates.categoryId = categoryId;
  }
  let variantsInput = [];
  if (Array.isArray(input.variants) && input.variants.length) {
    variantsInput = input.variants;
  } else if (input.variant) {
    variantsInput = [input.variant];
  } else if (
    Object.prototype.hasOwnProperty.call(input, 'priceYuan') ||
    Object.prototype.hasOwnProperty.call(input, 'variantLabel') ||
    Object.prototype.hasOwnProperty.call(input, 'variantUnit')
  ) {
    variantsInput = [
      {
        label: input.variantLabel,
        unit: input.variantUnit,
        priceYuan: input.priceYuan
      }
    ];
  }
  if (variantsInput.length) {
    const variants = normalizeVariants(variantsInput);
    if (!variants.length) {
      throw new Error('请提供有效的规格与价格');
    }
    updates.variants = variants;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'minQuantity')) {
    updates.minQuantity = toNonNegativeInteger(input.minQuantity, 0);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
    if (input.sortOrder !== '' && input.sortOrder !== null) {
      const currentOrder =
        typeof existing.sortOrder === 'number' ? existing.sortOrder : 1000;
      updates.sortOrder = resolveSortOrder(input.sortOrder, currentOrder);
    }
  }
  if (typeof input.enabled === 'boolean') {
    updates.status = input.enabled ? 'active' : 'disabled';
  } else if (typeof input.status === 'string') {
    const status = input.status.trim().toLowerCase();
    if (status === 'active' || status === 'enabled' || status === 'online') {
      updates.status = 'active';
    } else if (status === 'disabled' || status === 'inactive' || status === 'offline') {
      updates.status = 'disabled';
    }
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('未检测到需要保存的修改');
  }
  if (!updates.title) {
    updates.title = existing.title;
  }
  const now = new Date();
  updates.updatedAt = now;
  updates.updatedBy = admin._id || admin.openid || '';
  const collection = db.collection(COLLECTIONS.MENU_ITEMS);
  if (existing._id) {
    await collection.doc(existing._id).update({ data: updates });
  } else {
    await collection.where({ itemId }).update({ data: updates });
  }
  return { itemId, updated: true };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = resolveAction(event.action || event.type || event.operation || event.op);
  switch (action) {
    case ACTIONS.LIST:
      return listCatalog();
    case ACTIONS.ADMIN_LIST:
      return adminListCatalog(OPENID);
    case ACTIONS.CREATE_SECTION:
      return createSection(OPENID, event.section || event.data || {});
    case ACTIONS.CREATE_CATEGORY:
      return createCategory(OPENID, event.category || event.data || {});
    case ACTIONS.CREATE_ITEM:
      return createItem(OPENID, event.item || event.data || {});
    case ACTIONS.UPDATE_SECTION:
      return updateSection(OPENID, event.section || event.data || {});
    case ACTIONS.UPDATE_CATEGORY:
      return updateCategory(OPENID, event.category || event.data || {});
    case ACTIONS.UPDATE_ITEM:
      return updateItem(OPENID, event.item || event.data || {});
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};
