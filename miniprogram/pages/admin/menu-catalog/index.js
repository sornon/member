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

Page({
  data: {
    loading: false,
    savingSection: false,
    savingCategory: false,
    savingItem: false,
    sections: [],
    categoriesBySection: {},
    itemsByCategory: {},
    selectedSectionId: '',
    selectedSectionName: '',
    selectedCategoryId: '',
    selectedCategoryName: '',
    sectionForm: {
      sectionId: '',
      name: '',
      sortOrder: ''
    },
    categoryForm: {
      sectionId: '',
      categoryId: '',
      name: '',
      sortOrder: ''
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
    currentItems: []
  },

  onLoad() {
    this.loadCatalog();
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
        const normalized = {
          sectionId,
          categoryId,
          name,
          sortOrder: normalizeSortOrder(category.sortOrder),
          enabled: category.enabled !== false
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
        categoryForm,
        itemForm,
        currentItems
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
    this.setData({
      selectedSectionId: id,
      selectedSectionName: this.resolveSectionName(id),
      selectedCategoryId: nextCategoryId,
      selectedCategoryName: this.resolveCategoryName(id, nextCategoryId),
      currentItems,
      categoryForm,
      itemForm
    });
  },

  handleSelectCategory(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedCategoryId) {
      return;
    }
    const currentItems = this.data.itemsByCategory[id] || [];
    const itemForm = { ...this.data.itemForm, categoryId: id };
    this.setData({
      selectedCategoryId: id,
      selectedCategoryName: this.resolveCategoryName(this.data.selectedSectionId, id),
      currentItems,
      itemForm
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
        sectionForm: { sectionId: '', name: '', sortOrder: '' }
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
        sortOrder: form.sortOrder
      });
      wx.showToast({ title: '已新增', icon: 'success' });
      this.setData({
        categoryForm: {
          sectionId,
          categoryId: '',
          name: '',
          sortOrder: ''
        }
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
        }
      });
      await this.loadCatalog();
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, '新增失败'), icon: 'none' });
    } finally {
      this.setData({ savingItem: false });
    }
  }
});
