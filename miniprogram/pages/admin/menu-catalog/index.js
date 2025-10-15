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
    sectionForm: {
      sectionId: '',
      name: '',
      sortOrder: ''
    },
    sectionEditForm: {
      sectionId: '',
      name: '',
      sortOrder: ''
    },
    categoryForm: {
      sectionId: '',
      categoryId: '',
      name: '',
      sortOrder: '',
      daySortOrder: '',
      nightSortOrder: ''
    },
    categoryEditForm: {
      sectionId: '',
      categoryId: '',
      name: '',
      sortOrder: '',
      daySortOrder: '',
      nightSortOrder: ''
    },
    itemForm: {
      sectionId: '',
      categoryId: '',
      itemId: '',
      title: '',
      desc: '',
      image: '',
      variantLabel: '',
      variantUnit: '',
      priceYuan: '',
      minQuantity: ''
    },
    itemEditForm: {
      sectionId: '',
      categoryId: '',
      itemId: '',
      title: '',
      desc: '',
      image: '',
      variantLabel: '',
      variantUnit: '',
      priceYuan: '',
      minQuantity: '',
      enabled: true
    },
    currentItems: []
  },

  onLoad() {
    this.loadCatalog();
  },

  buildSectionEditForm(section) {
    if (!section) {
      return { sectionId: '', name: '', sortOrder: '' };
    }
    return {
      sectionId: section.sectionId || '',
      name: section.name || '',
      sortOrder: typeof section.sortOrder === 'number' ? `${section.sortOrder}` : section.sortOrder || ''
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
        nightSortOrder: ''
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
          : category.nightSortOrder || ''
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
        variantLabel: '',
        variantUnit: '',
        priceYuan: '',
        minQuantity: '',
        enabled: true
      };
    }
    const firstVariant = Array.isArray(item.variants) && item.variants.length ? item.variants[0] : null;
    const priceFen = firstVariant ? firstVariant.price : undefined;
    return {
      sectionId: item.sectionId || sectionId || '',
      categoryId: item.categoryId || categoryId || '',
      itemId: item.itemId || '',
      title: item.title || '',
      desc: item.desc || '',
      image: item.image || item.img || '',
      variantLabel: firstVariant ? firstVariant.label || '' : item.variantLabel || '',
      variantUnit: firstVariant ? firstVariant.unit || '' : item.variantUnit || '',
      priceYuan:
        typeof item.priceYuan === 'string' && item.priceYuan
          ? item.priceYuan
          : typeof priceFen === 'number'
          ? formatPriceFenToYuan(priceFen)
          : '',
      minQuantity:
        typeof item.minQuantity === 'number' && item.minQuantity > 0
          ? `${item.minQuantity}`
          : item.minQuantity || '',
      enabled: item.enabled !== false
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
            enabled: section.enabled !== false
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
          enabled: category.enabled !== false,
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
          enabled: item.enabled !== false,
          sortOrder: normalizeSortOrder(item.sortOrder),
          variants: Array.isArray(item.variants)
            ? item.variants.map((variant) => ({
                label: typeof variant.label === 'string' ? variant.label : '',
                unit: typeof variant.unit === 'string' ? variant.unit : '',
                price: Number(variant.price || 0),
                priceLabel: formatVariantPrice(variant.price || 0)
              }))
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
        itemEditForm
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
      sortOrder: ''
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
      nightSortOrder: ''
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
      variantLabel: '',
      variantUnit: '',
      priceYuan: '',
      minQuantity: ''
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
      itemEditForm
    });
  },

  handleSelectCategory(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedCategoryId) {
      return;
    }
    const currentItems = this.data.itemsByCategory[id] || [];
    const itemForm = { ...this.data.itemForm, categoryId: id };
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
      itemEditForm
    });
  },

  handleSelectItem(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedItemId) {
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

  handleSectionFormInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      sectionForm: { ...this.data.sectionForm, [field]: event.detail.value }
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

  handleCategoryEditInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    this.setData({
      categoryEditForm: { ...this.data.categoryEditForm, [field]: event.detail.value }
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
        sortOrder: form.sortOrder
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
        nightSortOrder: form.nightSortOrder
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
    const priceYuan = (form.priceYuan || '').trim();
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
    if (!priceYuan) {
      wx.showToast({ title: '请输入价格', icon: 'none' });
      return;
    }
    const minQuantity = (form.minQuantity || '').trim();
    this.setData({ updatingItem: true });
    try {
      await AdminMenuCatalogService.updateItem({
        sectionId,
        categoryId,
        itemId,
        title,
        desc: form.desc || '',
        image: form.image || '',
        variant: {
          label: (form.variantLabel || '').trim() || (form.variantUnit || '').trim() || title,
          unit: (form.variantUnit || '').trim(),
          priceYuan
        },
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
        sortOrder: form.sortOrder
      });
      wx.showToast({ title: '已新增', icon: 'success' });
      this.setData({
        sectionForm: { sectionId: '', name: '', sortOrder: '' },
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
        nightSortOrder: form.nightSortOrder
      });
      wx.showToast({ title: '已新增', icon: 'success' });
      this.setData({
        categoryForm: {
          sectionId,
          categoryId: '',
          name: '',
          sortOrder: '',
          daySortOrder: '',
          nightSortOrder: ''
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
    const priceYuan = (form.priceYuan || '').trim();
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
    if (!priceYuan) {
      wx.showToast({ title: '请输入价格', icon: 'none' });
      return;
    }
    const variantLabel = (form.variantLabel || '').trim();
    const variantUnit = (form.variantUnit || '').trim();
    const minQuantityNumeric = Number(form.minQuantity || 0);
    const payload = {
      sectionId,
      categoryId,
      itemId,
      title,
      desc: form.desc || '',
      img: form.image || '',
      variants: [
        {
          label: variantLabel || variantUnit || title,
          unit: variantUnit,
          priceYuan
        }
      ]
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
          variantLabel: '',
          variantUnit: '',
          priceYuan: '',
          minQuantity: ''
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
