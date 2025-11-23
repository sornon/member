import { AdminMenuCatalogService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

function extractErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  if (error.errMsg) {
    return error.errMsg;
  }
  if (error.message) {
    return error.message;
  }
  return fallback;
}

function normalizeSortOrder(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.floor(numeric);
}

function resolveEnabledFlag(entry = {}) {
  if (!entry || typeof entry !== 'object') {
    return true;
  }
  if (typeof entry.enabled === 'boolean') {
    return entry.enabled;
  }
  if (typeof entry.isEnabled === 'boolean') {
    return entry.isEnabled;
  }
  const status = typeof entry.status === 'string' ? entry.status.trim().toLowerCase() : '';
  if (status === 'disabled' || status === 'inactive' || status === 'offline' || status === 'archived' || status === 'deleted') {
    return false;
  }
  return true;
}

function sortByOrder(list, options = {}) {
  const nameKey = options.nameKey || 'name';
  const orderKey = options.orderKey || 'sortOrder';
  return list
    .slice()
    .sort((a, b) => {
      const orderA = Number.isFinite(a[orderKey]) ? a[orderKey] : normalizeSortOrder(a[orderKey]) || 1000;
      const orderB = Number.isFinite(b[orderKey]) ? b[orderKey] : normalizeSortOrder(b[orderKey]) || 1000;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const nameA = a[nameKey] ? `${a[nameKey]}` : '';
      const nameB = b[nameKey] ? `${b[nameKey]}` : '';
      return nameA.localeCompare(nameB, 'zh-Hans-CN');
    });
}

function formatVariantPrice(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '￥0';
  }
  return formatCurrency(numeric);
}

function formatPriceFenToYuan(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  const fen = Math.round(numeric);
  const yuan = fen / 100;
  if (Number.isInteger(yuan)) {
    return `${yuan}`;
  }
  return (fen / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function createEmptyVariantFormEntry() {
  return {
    label: '',
    unit: '',
    priceYuan: ''
  };
}

function mapVariantsToFormEntries(variants) {
  if (!Array.isArray(variants) || !variants.length) {
    return [createEmptyVariantFormEntry()];
  }
  const mapped = variants
    .map((variant) => ({
      label: typeof variant.label === 'string' ? variant.label : '',
      unit: typeof variant.unit === 'string' ? variant.unit : '',
      priceYuan:
        typeof variant.priceYuan === 'string' && variant.priceYuan.trim()
          ? variant.priceYuan.trim()
          : formatPriceFenToYuan(variant.price || 0)
    }))
    .filter((entry) => entry.label || entry.unit || entry.priceYuan);
  return mapped.length ? mapped : [createEmptyVariantFormEntry()];
}

function normalizeVariantFormEntries(list) {
  if (!Array.isArray(list) || !list.length) {
    return [createEmptyVariantFormEntry()];
  }
  const normalized = list.map((entry = {}) => ({
    label: typeof entry.label === 'string' ? entry.label : '',
    unit: typeof entry.unit === 'string' ? entry.unit : '',
    priceYuan: typeof entry.priceYuan === 'string' ? entry.priceYuan : ''
  }));
  return normalized.length ? normalized : [createEmptyVariantFormEntry()];
}

function normalizeVariantPayloadEntries(formEntries, title) {
  const entries = normalizeVariantFormEntries(formEntries);
  const variants = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const unit = typeof entry.unit === 'string' ? entry.unit.trim() : '';
    const priceText = typeof entry.priceYuan === 'string' ? entry.priceYuan.trim() : '';
    if (!label && !unit && !priceText) {
      continue;
    }
    if (!priceText) {
      return { variants: [], errorMessage: `请填写第${i + 1}条规格的价格` };
    }
    const priceNumeric = Number(priceText);
    if (!Number.isFinite(priceNumeric) || priceNumeric <= 0) {
      return { variants: [], errorMessage: `第${i + 1}条规格价格需大于0` };
    }
    variants.push({
      label: label || unit || title,
      unit,
      priceYuan: priceText
    });
  }
  return { variants };
}

function createIdleDragState() {
  return {
    dragging: false,
    draggingItemId: '',
    draggingSnapshot: null,
    draggingIndex: -1,
    placeholderIndex: -1,
    placeholderHeight: 0,
    overlayTop: 0,
    initialOverlayTop: 0,
    startClientY: 0,
    listTop: 0,
    listHeight: 0,
    itemRects: [],
    displayItems: []
  };
}

function buildDragDisplayItems(items = [], draggingItemId, placeholderIndex) {
  if (!Array.isArray(items) || !items.length || !draggingItemId) {
    return [];
  }
  const draggingItem = items.find((item) => item && item.itemId === draggingItemId);
  if (!draggingItem) {
    return [];
  }
  const filtered = items.filter((item) => item && item.itemId !== draggingItemId);
  let insertIndex = Number(placeholderIndex);
  if (!Number.isFinite(insertIndex) || insertIndex < 0) {
    insertIndex = 0;
  }
  if (insertIndex > filtered.length) {
    insertIndex = filtered.length;
  }
  const placeholder = { ...draggingItem, isPlaceholder: true };
  const result = filtered.slice();
  result.splice(insertIndex, 0, placeholder);
  return result;
}

Page({
  data: {
    loading: false,
    savingSection: false,
    savingCategory: false,
    savingItem: false,
    updatingSection: false,
    updatingCategory: false,
    updatingItem: false,
    sections: [],
    categoriesBySection: {},
    itemsByCategory: {},
    selectedSectionId: '',
    selectedSectionName: '',
    selectedCategoryId: '',
    selectedCategoryName: '',
    selectedItemId: '',
    showCreateSectionForm: false,
    showCreateCategoryForm: false,
    showCreateItemForm: false,
    reorderingItems: false,
    dragState: createIdleDragState(),
    sectionForm: {
      sectionId: '',
      name: '',
      sortOrder: '',
      enabled: true
    },
    sectionEditForm: {
      sectionId: '',
      name: '',
      sortOrder: '',
      enabled: true
    },
    categoryForm: {
      sectionId: '',
      categoryId: '',
      name: '',
      sortOrder: '',
      daySortOrder: '',
      nightSortOrder: '',
      enabled: true
    },
    categoryEditForm: {
      sectionId: '',
      categoryId: '',
      name: '',
      sortOrder: '',
      daySortOrder: '',
      nightSortOrder: '',
      enabled: true
    },
    itemForm: {
      sectionId: '',
      categoryId: '',
      itemId: '',
      title: '',
      desc: '',
      image: '',
      minQuantity: '',
      variants: [createEmptyVariantFormEntry()]
    },
    itemEditForm: {
      sectionId: '',
      categoryId: '',
      itemId: '',
      title: '',
      desc: '',
      image: '',
      minQuantity: '',
      enabled: true,
      variants: [createEmptyVariantFormEntry()]
    },
    currentItems: []
  },

  onLoad() {
    this.loadCatalog();
  },

  buildSectionEditForm(section) {
    if (!section) {
      return { sectionId: '', name: '', sortOrder: '', enabled: true };
    }
    return {
      sectionId: section.sectionId || '',
      name: section.name || '',
      sortOrder: typeof section.sortOrder === 'number' ? `${section.sortOrder}` : section.sortOrder || '',
      enabled: resolveEnabledFlag(section)
    };
  },

  buildCategoryEditForm(sectionId, category) {
    if (!sectionId || !category) {
      return {
        sectionId: sectionId || '',
        categoryId: '',
        name: '',
        sortOrder: '',
        daySortOrder: '',
        nightSortOrder: '',
        enabled: true
      };
    }
    return {
      sectionId,
      categoryId: category.categoryId || '',
      name: category.name || '',
      sortOrder:
        typeof category.sortOrder === 'number' ? `${category.sortOrder}` : category.sortOrder || '',
      daySortOrder:
        typeof category.daySortOrder === 'number'
          ? `${category.daySortOrder}`
          : category.daySortOrder || '',
      nightSortOrder:
        typeof category.nightSortOrder === 'number'
          ? `${category.nightSortOrder}`
          : category.nightSortOrder || '',
      enabled: resolveEnabledFlag(category)
    };
  },

  buildItemEditForm(sectionId, categoryId, item) {
    if (!item) {
      return {
        sectionId: sectionId || '',
        categoryId: categoryId || '',
        itemId: '',
        title: '',
        desc: '',
        image: '',
        minQuantity: '',
        enabled: true,
        variants: [createEmptyVariantFormEntry()]
      };
    }
    return {
      sectionId: item.sectionId || sectionId || '',
      categoryId: item.categoryId || categoryId || '',
      itemId: item.itemId || '',
      title: item.title || '',
      desc: item.desc || '',
      image: item.image || item.img || '',
      minQuantity:
        typeof item.minQuantity === 'number' && item.minQuantity > 0
          ? `${item.minQuantity}`
          : item.minQuantity || '',
      enabled: resolveEnabledFlag(item),
      variants: mapVariantsToFormEntries(item.variants)
    };
  },

  async loadCatalog() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true });
    try {
      const response = await AdminMenuCatalogService.listCatalog();
      const sectionsRaw = Array.isArray(response.sectionsRaw) ? response.sectionsRaw : [];
      const categoriesRaw = Array.isArray(response.categoriesRaw) ? response.categoriesRaw : [];
      const itemsRaw = Array.isArray(response.itemsRaw) ? response.itemsRaw : [];

      const sections = sortByOrder(
        sectionsRaw
          .map((section) => ({
            sectionId: section.sectionId,
            name: section.title || section.name || section.sectionId,
            sortOrder: normalizeSortOrder(section.sortOrder),
            enabled: resolveEnabledFlag(section)
          }))
          .filter((section) => section.sectionId && section.name),
        { nameKey: 'name', orderKey: 'sortOrder' }
      );

      const categoriesBySection = {};
      categoriesRaw.forEach((category) => {
        const sectionId = category.sectionId;
        const categoryId = category.categoryId;
        const name = category.name || categoryId;
        if (!sectionId || !categoryId || !name) {
          return;
        }
        const daySortOrder = normalizeSortOrder(category.daySortOrder);
        const nightSortOrder = normalizeSortOrder(category.nightSortOrder);
        const normalized = {
          sectionId,
          categoryId,
          name,
          sortOrder: normalizeSortOrder(category.sortOrder),
          enabled: resolveEnabledFlag(category),
          daySortOrder,
          nightSortOrder,
          daySortOrderText: typeof daySortOrder === 'number' ? `${daySortOrder}` : '',
          nightSortOrderText: typeof nightSortOrder === 'number' ? `${nightSortOrder}` : ''
        };
        if (!categoriesBySection[sectionId]) {
          categoriesBySection[sectionId] = [];
        }
        categoriesBySection[sectionId].push(normalized);
      });
      Object.keys(categoriesBySection).forEach((sectionId) => {
        categoriesBySection[sectionId] = sortByOrder(categoriesBySection[sectionId], {
          nameKey: 'name',
          orderKey: 'sortOrder'
        });
      });

      const itemsByCategory = {};
      itemsRaw.forEach((item) => {
        const sectionId = item.sectionId;
        const categoryId = item.categoryId;
        const itemId = item.itemId;
        const title = item.title || itemId;
        if (!sectionId || !categoryId || !itemId || !title) {
          return;
        }
        const normalized = {
          sectionId,
          categoryId,
          itemId,
          title,
          desc: item.desc || '',
          minQuantity: Number(item.minQuantity || 0) > 0 ? Math.floor(Number(item.minQuantity)) : 0,
          enabled: resolveEnabledFlag(item),
          sortOrder: normalizeSortOrder(item.sortOrder),
          variants: Array.isArray(item.variants)
            ? item.variants.map((variant) => {
                const label = typeof variant.label === 'string' ? variant.label : '';
                const unit = typeof variant.unit === 'string' ? variant.unit : '';
                const rawPrice = Number(variant.price || variant.priceFen || 0);
                let price = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice) : 0;
                if (!price && typeof variant.priceYuan !== 'undefined') {
                  const priceYuanNumeric = Number(variant.priceYuan);
                  if (Number.isFinite(priceYuanNumeric) && priceYuanNumeric > 0) {
                    price = Math.round(priceYuanNumeric * 100);
                  }
                }
                const priceYuanText =
                  typeof variant.priceYuan === 'string' && variant.priceYuan.trim()
                    ? variant.priceYuan.trim()
                    : price
                    ? formatPriceFenToYuan(price)
                    : '';
                return {
                  label,
                  unit,
                  price,
                  priceLabel: formatVariantPrice(price),
                  priceYuan: priceYuanText
                };
              })
            : []
        };
        if (normalized.variants.length) {
          const firstVariant = normalized.variants[0];
          normalized.variantLabel = firstVariant.label || '';
          normalized.variantUnit = firstVariant.unit || '';
          normalized.priceFen = Number(firstVariant.price || 0);
          normalized.priceYuan = formatPriceFenToYuan(firstVariant.price || 0);
        } else {
          normalized.variantLabel = '';
          normalized.variantUnit = '';
          normalized.priceFen = 0;
          normalized.priceYuan = '';
        }
        normalized.image = typeof item.image === 'string' ? item.image : item.img || '';
        if (!itemsByCategory[categoryId]) {
          itemsByCategory[categoryId] = [];
        }
        itemsByCategory[categoryId].push(normalized);
      });
      Object.keys(itemsByCategory).forEach((categoryId) => {
        itemsByCategory[categoryId] = sortByOrder(itemsByCategory[categoryId], {
          nameKey: 'title',
          orderKey: 'sortOrder'
        });
      });

      const previousSectionId = this.data.selectedSectionId;
      const selectedSectionId = sections.some((section) => section.sectionId === previousSectionId)
        ? previousSectionId
        : sections.length
        ? sections[0].sectionId
        : '';
      const availableCategories = selectedSectionId
        ? categoriesBySection[selectedSectionId] || []
        : [];
      const previousCategoryId = this.data.selectedCategoryId;
      const selectedCategoryId = availableCategories.some(
        (category) => category.categoryId === previousCategoryId
      )
        ? previousCategoryId
        : availableCategories.length
        ? availableCategories[0].categoryId
        : '';
      const currentItems = selectedCategoryId ? itemsByCategory[selectedCategoryId] || [] : [];
      const previousItemId = this.data.selectedItemId;
      const selectedItemId = currentItems.some((item) => item.itemId === previousItemId)
        ? previousItemId
        : currentItems.length
        ? currentItems[0].itemId
        : '';

      const sectionEditForm = this.buildSectionEditForm(
        sections.find((section) => section.sectionId === selectedSectionId)
      );
      const categoryEditForm = this.buildCategoryEditForm(
        selectedSectionId,
        availableCategories.find((category) => category.categoryId === selectedCategoryId)
      );
      const itemEditForm = this.buildItemEditForm(
        selectedSectionId,
        selectedCategoryId,
        currentItems.find((item) => item.itemId === selectedItemId)
      );

      const categoryForm = { ...this.data.categoryForm };
      if (!categoryForm.sectionId || categoryForm.sectionId !== selectedSectionId) {
        categoryForm.sectionId = selectedSectionId || '';
      }
      const itemForm = { ...this.data.itemForm };
      if (itemForm.sectionId !== selectedSectionId) {
        itemForm.sectionId = selectedSectionId || '';
      }
      if (itemForm.categoryId !== selectedCategoryId) {
        itemForm.categoryId = selectedCategoryId || '';
      }
      itemForm.variants = normalizeVariantFormEntries(itemForm.variants);

      this.setData({
        sections,
        categoriesBySection,
        itemsByCategory,
        selectedSectionId,
        selectedSectionName: this.resolveSectionNameFromList(sections, selectedSectionId),
        selectedCategoryId,
        selectedCategoryName: this.resolveCategoryNameFromList(availableCategories, selectedCategoryId),
        selectedItemId,
        categoryForm,
        itemForm,
        currentItems,
        sectionEditForm,
        categoryEditForm,
        itemEditForm,
        dragState: createIdleDragState()
      });
    } catch (error) {
      console.error('[admin menu] load catalog failed', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleRefresh() {
    this.loadCatalog();
  },

  handleToggleCreateSectionForm() {
    const show = !this.data.showCreateSectionForm;
    const baseForm = {
      sectionId: '',
      name: '',
      sortOrder: '',
      enabled: true
    };
    this.setData({
      showCreateSectionForm: show,
      sectionForm: show ? { ...baseForm } : baseForm
    });
  },

  handleToggleCreateCategoryForm() {
    const show = !this.data.showCreateCategoryForm;
    const baseForm = {
      sectionId: this.data.selectedSectionId || '',
      categoryId: '',
      name: '',
      sortOrder: '',
      daySortOrder: '',
      nightSortOrder: '',
      enabled: true
    };
    this.setData({
      showCreateCategoryForm: show,
      categoryForm: show ? { ...baseForm } : baseForm
    });
  },

  handleToggleCreateItemForm() {
    const show = !this.data.showCreateItemForm;
    const baseForm = {
      sectionId: this.data.selectedSectionId || '',
      categoryId: this.data.selectedCategoryId || '',
      itemId: '',
      title: '',
      desc: '',
      image: '',
      minQuantity: '',
      variants: [createEmptyVariantFormEntry()]
    };
    this.setData({
      showCreateItemForm: show,
      itemForm: show ? { ...baseForm } : baseForm
    });
  },

  resolveSectionNameFromList(list, sectionId) {
    if (!sectionId || !Array.isArray(list)) {
      return '';
    }
    const found = list.find((item) => item.sectionId === sectionId);
    return found ? found.name : '';
  },

  resolveCategoryNameFromList(list, categoryId) {
    if (!categoryId || !Array.isArray(list)) {
      return '';
    }
    const found = list.find((item) => item.categoryId === categoryId);
    return found ? found.name : '';
  },

  resolveSectionName(sectionId) {
    return this.resolveSectionNameFromList(this.data.sections, sectionId);
  },

  resolveCategoryName(sectionId, categoryId) {
    const categories = this.data.categoriesBySection[sectionId] || [];
    return this.resolveCategoryNameFromList(categories, categoryId);
  },

  handleSelectSection(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedSectionId) {
      return;
    }
    const categories = this.data.categoriesBySection[id] || [];
    const nextCategoryId = categories.length ? categories[0].categoryId : '';
    const currentItems = nextCategoryId ? this.data.itemsByCategory[nextCategoryId] || [] : [];
    const categoryForm = { ...this.data.categoryForm, sectionId: id };
    const itemForm = { ...this.data.itemForm, sectionId: id, categoryId: nextCategoryId || '' };
    itemForm.variants = normalizeVariantFormEntries(itemForm.variants);
    const section = this.data.sections.find((entry) => entry.sectionId === id);
    const sectionEditForm = this.buildSectionEditForm(section);
    const selectedItemId = currentItems.length ? currentItems[0].itemId : '';
    const nextCategory = categories.find((category) => category.categoryId === nextCategoryId);
    const categoryEditForm = this.buildCategoryEditForm(id, nextCategory);
    const itemEditForm = this.buildItemEditForm(
      id,
      nextCategoryId,
      currentItems.find((item) => item.itemId === selectedItemId)
    );
    this.setData({
      selectedSectionId: id,
      selectedSectionName: this.resolveSectionName(id),
      selectedCategoryId: nextCategoryId,
      selectedCategoryName: this.resolveCategoryName(id, nextCategoryId),
      currentItems,
      categoryForm,
      itemForm,
      selectedItemId,
      sectionEditForm,
      categoryEditForm,
      itemEditForm,
      dragState: createIdleDragState()
    });
  },

  handleSelectCategory(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedCategoryId) {
      return;
    }
    const currentItems = this.data.itemsByCategory[id] || [];
    const itemForm = { ...this.data.itemForm, categoryId: id };
    itemForm.variants = normalizeVariantFormEntries(itemForm.variants);
    const selectedItemId = currentItems.length ? currentItems[0].itemId : '';
    const categories = this.data.categoriesBySection[this.data.selectedSectionId] || [];
    const selectedCategory = categories.find((category) => category.categoryId === id);
    const categoryEditForm = this.buildCategoryEditForm(this.data.selectedSectionId, selectedCategory);
    const itemEditForm = this.buildItemEditForm(
      this.data.selectedSectionId,
      id,
      currentItems.find((item) => item.itemId === selectedItemId)
    );
    this.setData({
      selectedCategoryId: id,
      selectedCategoryName: this.resolveCategoryName(this.data.selectedSectionId, id),
      currentItems,
      itemForm,
      selectedItemId,
      categoryEditForm,
      itemEditForm,
      dragState: createIdleDragState()
    });
  },

  handleSelectItem(event) {
    const { id } = event.currentTarget.dataset || {};
    if (
      !id ||
      id === this.data.selectedItemId ||
      this.data.dragState.dragging ||
      this.data.reorderingItems
    ) {
      return;
    }
    const item = (this.data.currentItems || []).find((entry) => entry.itemId === id);
    const itemEditForm = this.buildItemEditForm(
      this.data.selectedSectionId,
      this.data.selectedCategoryId,
      item
    );
    this.setData({
      selectedItemId: id,
      itemEditForm
    });
  },

  handleItemDragStart(event) {
    if (this.data.reorderingItems || this.data.dragState.dragging) {
      return;
    }
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const items = this.data.currentItems || [];
    if (!Array.isArray(items) || items.length < 2) {
      return;
    }
    const itemIndex = items.findIndex((item) => item.itemId === id);
    if (itemIndex < 0) {
      return;
    }
    const touch =
      (event && event.touches && event.touches[0]) ||
      (event && event.changedTouches && event.changedTouches[0]);
    if (!touch) {
      return;
    }
    const clientY =
      typeof touch.clientY === 'number' ? touch.clientY : typeof touch.pageY === 'number' ? touch.pageY : undefined;
    if (!Number.isFinite(clientY)) {
      return;
    }
    const query = wx.createSelectorQuery().in(this);
    query.select('.item-list').boundingClientRect();
    query.selectAll('.item-card-wrapper').boundingClientRect();
    query.exec((res = []) => {
      const listRect = res[0];
      const itemRects = res[1];
      if (!listRect || !Array.isArray(itemRects) || !itemRects[itemIndex]) {
        return;
      }
      const targetRect = itemRects[itemIndex];
      const placeholderHeight = targetRect.height || 0;
      const overlayTop = (targetRect.top || 0) - (listRect.top || 0);
      const displayItems = buildDragDisplayItems(items, id, itemIndex);
      const dragState = {
        dragging: true,
        draggingItemId: id,
        draggingSnapshot: items[itemIndex],
        draggingIndex: itemIndex,
        placeholderIndex: itemIndex,
        placeholderHeight,
        overlayTop,
        initialOverlayTop: overlayTop,
        startClientY: clientY,
        listTop: listRect.top || 0,
        listHeight: listRect.height || 0,
        itemRects,
        displayItems
      };
      this.setData({ dragState });
      if (wx.vibrateShort && typeof wx.vibrateShort === 'function') {
        wx.vibrateShort({ type: 'light' });
      }
    });
  },

  handleItemDragMove(event) {
    const dragState = this.data.dragState || {};
    if (!dragState.dragging) {
      return;
    }
    const touch =
      (event && event.touches && event.touches[0]) ||
      (event && event.changedTouches && event.changedTouches[0]);
    if (!touch) {
      return;
    }
    const clientY =
      typeof touch.clientY === 'number' ? touch.clientY : typeof touch.pageY === 'number' ? touch.pageY : undefined;
    if (!Number.isFinite(clientY)) {
      return;
    }
    const deltaY = clientY - dragState.startClientY;
    const maxTop = Math.max(0, (dragState.listHeight || 0) - (dragState.placeholderHeight || 0));
    const nextOverlayTop = Math.max(0, Math.min((dragState.initialOverlayTop || 0) + deltaY, maxTop));
    const placeholderIndex = this.computePlaceholderIndex(nextOverlayTop, dragState);
    if (
      nextOverlayTop === dragState.overlayTop &&
      placeholderIndex === dragState.placeholderIndex
    ) {
      return;
    }
    const displayItems = buildDragDisplayItems(
      this.data.currentItems || [],
      dragState.draggingItemId,
      placeholderIndex
    );
    this.setData({
      dragState: {
        ...dragState,
        overlayTop: nextOverlayTop,
        placeholderIndex,
        displayItems
      }
    });
  },

  computePlaceholderIndex(overlayTop, dragState) {
    if (!dragState || !Array.isArray(dragState.itemRects) || !dragState.itemRects.length) {
      return 0;
    }
    const relativeMiddle = overlayTop + (dragState.placeholderHeight || 0) / 2;
    const positions = [];
    for (let i = 0; i < dragState.itemRects.length; i += 1) {
      if (i === dragState.draggingIndex) {
        continue;
      }
      const rect = dragState.itemRects[i];
      positions.push({
        index: i,
        top: (rect.top || 0) - (dragState.listTop || 0),
        height: rect.height || 0
      });
    }
    if (!positions.length) {
      return 0;
    }
    let placeholderIndex = positions.length;
    for (let i = 0; i < positions.length; i += 1) {
      const entry = positions[i];
      if (relativeMiddle < entry.top + entry.height / 2) {
        placeholderIndex = i;
        break;
      }
    }
    if (placeholderIndex < 0) {
      return 0;
    }
    if (placeholderIndex > positions.length) {
      return positions.length;
    }
    return placeholderIndex;
  },

  async handleItemDragEnd() {
    const dragState = this.data.dragState || {};
    if (!dragState.dragging) {
      return;
    }
    await this.finalizeItemDrag();
  },

  async finalizeItemDrag() {
    const dragState = this.data.dragState || {};
    const items = this.data.currentItems || [];
    const fromIndex = dragState.draggingIndex;
    if (!Array.isArray(items) || !items.length || fromIndex < 0 || fromIndex >= items.length) {
      this.setData({ dragState: createIdleDragState() });
      return;
    }
    let targetIndex = Number(dragState.placeholderIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      targetIndex = 0;
    }
    if (targetIndex > items.length - 1) {
      targetIndex = items.length - 1;
    }
    if (targetIndex === fromIndex) {
      this.setData({ dragState: createIdleDragState() });
      return;
    }
    const previousOrderMap = {};
    items.forEach((item) => {
      if (item && item.itemId) {
        previousOrderMap[item.itemId] = normalizeSortOrder(item.sortOrder);
      }
    });
    const working = items.slice();
    const [moved] = working.splice(fromIndex, 1);
    if (!moved) {
      this.setData({ dragState: createIdleDragState() });
      return;
    }
    const clampedIndex = Math.max(0, Math.min(targetIndex, working.length));
    working.splice(clampedIndex, 0, moved);
    const updatedItems = working.map((item, index) => ({
      ...item,
      sortOrder: index + 1
    }));
    const nextItemsByCategory = {
      ...this.data.itemsByCategory,
      [this.data.selectedCategoryId]: updatedItems
    };
    this.setData({
      currentItems: updatedItems,
      itemsByCategory: nextItemsByCategory,
      dragState: createIdleDragState()
    });
    try {
      await this.persistItemOrder(updatedItems, previousOrderMap);
    } catch (error) {
      console.error('[admin menu] persist drag order failed', error);
      this.handleRefresh();
    }
  },

  async persistItemOrder(items, previousOrderMap = {}) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    const updates = [];
    const sectionId = this.data.selectedSectionId || '';
    const categoryId = this.data.selectedCategoryId || '';
    if (!sectionId || !categoryId) {
      return;
    }
    items.forEach((item) => {
      if (!item || !item.itemId) {
        return;
      }
      const sortOrder = normalizeSortOrder(item.sortOrder);
      if (!Number.isFinite(sortOrder)) {
        return;
      }
      if (
        previousOrderMap &&
        Object.prototype.hasOwnProperty.call(previousOrderMap, item.itemId) &&
        previousOrderMap[item.itemId] === sortOrder
      ) {
        return;
      }
      updates.push({
        itemId: item.itemId,
        sectionId,
        categoryId,
        sortOrder
      });
    });
    if (!updates.length) {
      return;
    }
    this.setData({ reorderingItems: true });
    if (wx.showLoading && typeof wx.showLoading === 'function') {
      wx.showLoading({ title: '保存排序', mask: true });
    }
    try {
      // 顺序执行，避免云函数并发写入导致冲突
      for (let i = 0; i < updates.length; i += 1) {
        const payload = updates[i];
        await AdminMenuCatalogService.updateItem(payload);
      }
      if (wx.hideLoading && typeof wx.hideLoading === 'function') {
        wx.hideLoading();
      }
      wx.showToast({ title: '排序已更新', icon: 'success' });
    } catch (error) {
      if (wx.hideLoading && typeof wx.hideLoading === 'function') {
        wx.hideLoading();
      }
      wx.showToast({ title: extractErrorMessage(error, '保存排序失败'), icon: 'none' });
      throw error;
    } finally {
      this.setData({ reorderingItems: false });
    }
  },

  handleSectionFormInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      sectionForm: { ...this.data.sectionForm, [field]: event.detail.value }
    });
  },

  handleSectionFormSwitchChange(event) {
    this.setData({
      sectionForm: { ...this.data.sectionForm, enabled: !!event.detail.value }
    });
  },

  handleCategoryFormInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      categoryForm: { ...this.data.categoryForm, [field]: event.detail.value }
    });
  },

  handleCategoryFormSwitchChange(event) {
    this.setData({
      categoryForm: { ...this.data.categoryForm, enabled: !!event.detail.value }
    });
  },

  handleItemFormInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      itemForm: { ...this.data.itemForm, [field]: event.detail.value }
    });
  },

  handleSectionEditInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      sectionEditForm: { ...this.data.sectionEditForm, [field]: event.detail.value }
    });
  },

  handleSectionEditSwitchChange(event) {
    this.setData({
      sectionEditForm: { ...this.data.sectionEditForm, enabled: !!event.detail.value }
    });
  },

  handleCategoryEditInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      categoryEditForm: { ...this.data.categoryEditForm, [field]: event.detail.value }
    });
  },

  handleCategoryEditSwitchChange(event) {
    this.setData({
      categoryEditForm: { ...this.data.categoryEditForm, enabled: !!event.detail.value }
    });
  },

  handleItemEditInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      itemEditForm: { ...this.data.itemEditForm, [field]: event.detail.value }
    });
  },

  updateVariantFormList(formKey, updater) {
    if (!formKey) {
      return;
    }
    const form = { ...(this.data[formKey] || {}) };
    const source = normalizeVariantFormEntries(form.variants);
    const draft = source.map((entry) => ({ ...entry }));
    const next = typeof updater === 'function' ? updater(draft) : draft;
    form.variants = normalizeVariantFormEntries(next);
    this.setData({ [formKey]: form });
  },

  handleVariantInput(event) {
    const { form: formKey, index, field } = event.currentTarget.dataset || {};
    if (!formKey || typeof index === 'undefined' || typeof field !== 'string') {
      return;
    }
    this.updateVariantFormList(formKey, (variants) => {
      const position = Number(index);
      if (!Number.isFinite(position) || position < 0) {
        return variants;
      }
      if (!variants[position]) {
        variants[position] = createEmptyVariantFormEntry();
      }
      variants[position] = {
        ...variants[position],
        [field]: event.detail.value
      };
      return variants;
    });
  },

  handleAddVariant(event) {
    const { form: formKey } = event.currentTarget.dataset || {};
    if (!formKey) {
      return;
    }
    this.updateVariantFormList(formKey, (variants) => {
      variants.push(createEmptyVariantFormEntry());
      return variants;
    });
  },

  handleRemoveVariant(event) {
    const { form: formKey, index } = event.currentTarget.dataset || {};
    if (!formKey || typeof index === 'undefined') {
      return;
    }
    this.updateVariantFormList(formKey, (variants) => {
      const position = Number(index);
      if (!Number.isFinite(position) || position < 0) {
        return variants;
      }
      return variants.filter((_, idx) => idx !== position);
    });
  },

  handleItemEditSwitchChange(event) {
    this.setData({
      itemEditForm: { ...this.data.itemEditForm, enabled: !!event.detail.value }
    });
  },

  async handleUpdateSection() {
    if (this.data.updatingSection) {
      return;
    }
    const form = this.data.sectionEditForm || {};
    const sectionId = (form.sectionId || '').trim();
    const name = (form.name || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请选择一级类目', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    this.setData({ updatingSection: true });
    try {
      await AdminMenuCatalogService.updateSection({
        sectionId,
        name,
        title: name,
        sortOrder: form.sortOrder,
        enabled: form.enabled !== false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ updatingSection: false });
    }
  },

  async handleUpdateCategory() {
    if (this.data.updatingCategory) {
      return;
    }
    const form = this.data.categoryEditForm || {};
    const sectionId = (form.sectionId || '').trim();
    const categoryId = (form.categoryId || '').trim();
    const name = (form.name || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请选择一级类目', icon: 'none' });
      return;
    }
    if (!categoryId) {
      wx.showToast({ title: '请选择二级类目', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    this.setData({ updatingCategory: true });
    try {
      await AdminMenuCatalogService.updateCategory({
        sectionId,
        categoryId,
        name,
        title: name,
        sortOrder: form.sortOrder,
        daySortOrder: form.daySortOrder,
        nightSortOrder: form.nightSortOrder,
        enabled: form.enabled !== false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ updatingCategory: false });
    }
  },

  async handleUpdateItem() {
    if (this.data.updatingItem) {
      return;
    }
    const form = this.data.itemEditForm || {};
    const sectionId = (form.sectionId || '').trim();
    const categoryId = (form.categoryId || '').trim();
    const itemId = (form.itemId || '').trim();
    const title = (form.title || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请选择一级类目', icon: 'none' });
      return;
    }
    if (!categoryId) {
      wx.showToast({ title: '请选择二级类目', icon: 'none' });
      return;
    }
    if (!itemId) {
      wx.showToast({ title: '请选择商品', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    const minQuantity = (form.minQuantity || '').trim();
    const { variants, errorMessage } = normalizeVariantPayloadEntries(form.variants, title);
    if (errorMessage) {
      wx.showToast({ title: errorMessage, icon: 'none' });
      return;
    }
    if (!variants.length) {
      wx.showToast({ title: '请至少配置一个规格价格', icon: 'none' });
      return;
    }
    this.setData({ updatingItem: true });
    try {
      await AdminMenuCatalogService.updateItem({
        sectionId,
        categoryId,
        itemId,
        title,
        desc: form.desc || '',
        image: form.image || '',
        variants,
        variant: variants[0],
        minQuantity,
        enabled: form.enabled !== false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ updatingItem: false });
    }
  },

  async handleCreateSection() {
    if (this.data.savingSection) {
      return;
    }
    const form = this.data.sectionForm || {};
    const sectionId = (form.sectionId || '').trim();
    const name = (form.name || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请输入标识', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    this.setData({ savingSection: true });
    try {
      await AdminMenuCatalogService.createSection({
        sectionId,
        name,
        title: name,
        sortOrder: form.sortOrder,
        enabled: form.enabled !== false
      });
      wx.showToast({ title: '已新增', icon: 'success' });
      this.setData({
        sectionForm: { sectionId: '', name: '', sortOrder: '', enabled: true },
        showCreateSectionForm: false
      });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '新增失败'), icon: 'none' });
    } finally {
      this.setData({ savingSection: false });
    }
  },

  async handleCreateCategory() {
    if (this.data.savingCategory) {
      return;
    }
    const form = this.data.categoryForm || {};
    const sectionId = (form.sectionId || this.data.selectedSectionId || '').trim();
    const categoryId = (form.categoryId || '').trim();
    const name = (form.name || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请选择一级类目', icon: 'none' });
      return;
    }
    if (!categoryId) {
      wx.showToast({ title: '请输入标识', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    this.setData({ savingCategory: true });
    try {
      await AdminMenuCatalogService.createCategory({
        sectionId,
        categoryId,
        name,
        title: name,
        sortOrder: form.sortOrder,
        daySortOrder: form.daySortOrder,
        nightSortOrder: form.nightSortOrder,
        enabled: form.enabled !== false
      });
      wx.showToast({ title: '已新增', icon: 'success' });
      this.setData({
        categoryForm: {
          sectionId,
          categoryId: '',
          name: '',
          sortOrder: '',
          daySortOrder: '',
          nightSortOrder: '',
          enabled: true
        },
        showCreateCategoryForm: false
      });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '新增失败'), icon: 'none' });
    } finally {
      this.setData({ savingCategory: false });
    }
  },

  async handleCreateItem() {
    if (this.data.savingItem) {
      return;
    }
    const form = this.data.itemForm || {};
    const sectionId = (form.sectionId || this.data.selectedSectionId || '').trim();
    const categoryId = (form.categoryId || this.data.selectedCategoryId || '').trim();
    const itemId = (form.itemId || '').trim();
    const title = (form.title || '').trim();
    if (!sectionId) {
      wx.showToast({ title: '请选择一级类目', icon: 'none' });
      return;
    }
    if (!categoryId) {
      wx.showToast({ title: '请选择二级类目', icon: 'none' });
      return;
    }
    if (!itemId) {
      wx.showToast({ title: '请输入商品标识', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请输入商品名称', icon: 'none' });
      return;
    }
    const minQuantityNumeric = Number(form.minQuantity || 0);
    const { variants, errorMessage } = normalizeVariantPayloadEntries(form.variants, title);
    if (errorMessage) {
      wx.showToast({ title: errorMessage, icon: 'none' });
      return;
    }
    if (!variants.length) {
      wx.showToast({ title: '请至少配置一个规格价格', icon: 'none' });
      return;
    }
    const payload = {
      sectionId,
      categoryId,
      itemId,
      title,
      desc: form.desc || '',
      img: form.image || '',
      variants
    };
    if (Number.isFinite(minQuantityNumeric) && minQuantityNumeric > 0) {
      payload.minQuantity = Math.floor(minQuantityNumeric);
    }
    this.setData({ savingItem: true });
    try {
      await AdminMenuCatalogService.createItem(payload);
      wx.showToast({ title: '商品已新增', icon: 'success' });
      this.setData({
        itemForm: {
          sectionId,
          categoryId,
          itemId: '',
          title: '',
          desc: '',
          image: '',
          minQuantity: '',
          variants: [createEmptyVariantFormEntry()]
        },
        showCreateItemForm: false
      });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '新增失败'), icon: 'none' });
    } finally {
      this.setData({ savingItem: false });
    }
  }
});
