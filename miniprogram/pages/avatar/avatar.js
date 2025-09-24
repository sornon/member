import { AvatarService } from '../../services/api';

Page({
  data: {
    loading: true,
    categories: [],
    activeCategoryIndex: 0,
    equipped: {},
    assetsByCategory: {},
    currentCategoryId: '',
    currentCategoryAssets: [],
    currentEquippedAssetId: ''
  },

  onShow() {
    this.fetchAssets();
  },

  async fetchAssets() {
    this.setData({ loading: true });
    try {
      const data = await AvatarService.listAssets();
      const categories = data.categories || [];
      const assetsByCategory = data.assetsByCategory || {};
      const equipped = data.equipped || {};
      const categoryState = this.computeCategoryState(
        categories,
        assetsByCategory,
        equipped,
        0
      );

      this.setData({
        loading: false,
        categories,
        assetsByCategory,
        equipped,
        ...categoryState
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleCategoryChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const { categories, assetsByCategory, equipped } = this.data;
    const categoryState = this.computeCategoryState(
      categories,
      assetsByCategory,
      equipped,
      index
    );

    this.setData(categoryState);
  },

  handleEquip(event) {
    const { categoryId, assetId } = event.currentTarget.dataset;
    if (!categoryId) {
      return;
    }

    const updatedEquipped = {
      ...this.data.equipped,
      [categoryId]: assetId
    };

    const patch = {
      equipped: updatedEquipped
    };

    if (categoryId === this.data.currentCategoryId) {
      patch.currentEquippedAssetId = assetId;
    }

    this.setData(patch);
  },

  async handleSave() {
    wx.showLoading({ title: '保存中', mask: true });
    try {
      await AvatarService.saveConfig(this.data.equipped);
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      // 错误提示已在服务层
    } finally {
      wx.hideLoading();
    }
  },

  computeCategoryState(categories, assetsByCategory, equipped, index) {
    const hasCategories = Array.isArray(categories) && categories.length > 0;
    const safeIndex = hasCategories && categories[index] ? index : 0;
    const category = hasCategories ? categories[safeIndex] : undefined;
    const currentCategoryId = category ? category._id : '';
    const currentCategoryAssets = currentCategoryId
      ? assetsByCategory[currentCategoryId] || []
      : [];
    const currentEquippedAssetId = currentCategoryId
      ? equipped[currentCategoryId] || ''
      : '';

    return {
      activeCategoryIndex: category ? safeIndex : 0,
      currentCategoryId,
      currentCategoryAssets,
      currentEquippedAssetId
    };
  }
});
