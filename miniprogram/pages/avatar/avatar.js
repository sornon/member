import { AvatarService } from '../../services/api';

Page({
  data: {
    loading: true,
    categories: [],
    activeCategoryIndex: 0,
    equipped: {},
    assetsByCategory: {}
  },

  onShow() {
    this.fetchAssets();
  },

  async fetchAssets() {
    this.setData({ loading: true });
    try {
      const data = await AvatarService.listAssets();
      this.setData({
        loading: false,
        categories: data.categories || [],
        activeCategoryIndex: 0,
        equipped: data.equipped || {},
        assetsByCategory: data.assetsByCategory || {}
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleCategoryChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ activeCategoryIndex: index });
  },

  handleEquip(event) {
    const { categoryId, assetId } = event.currentTarget.dataset;
    this.setData({
      equipped: {
        ...this.data.equipped,
        [categoryId]: assetId
      }
    });
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
  }
});
