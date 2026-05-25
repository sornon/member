import { AdminService } from '../../../services/api';

const STATUS_OPTIONS = ['active', 'inactive'];
const TYPE_OPTIONS = ['ticket', 'coupon'];

function buildEmptyForm() {
  return {
    rightId: '',
    name: '',
    description: '',
    status: 'active',
    type: 'ticket'
  };
}

Page({
  data: {
    loading: false,
    rights: [],
    form: buildEmptyForm(),
    editingId: '',
    statusOptions: STATUS_OPTIONS,
    typeOptions: TYPE_OPTIONS
  },

  onShow() {
    this.loadRights();
  },

  async loadRights() {
    this.setData({ loading: true });
    try {
      const res = await AdminService.listRightsMaster();
      this.setData({
        rights: Array.isArray(res && res.rights) ? res.rights : [],
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || error.message || '加载失败', icon: 'none' });
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) return;
    this.setData({ [`form.${field}`]: (event.detail && event.detail.value) || '' });
  },

  onStatusChange(event) {
    const index = Number(event.detail.value);
    this.setData({ 'form.status': STATUS_OPTIONS[index] || 'active' });
  },

  onTypeChange(event) {
    const index = Number(event.detail.value);
    this.setData({ 'form.type': TYPE_OPTIONS[index] || 'ticket' });
  },

  startCreate() {
    this.setData({ editingId: '', form: buildEmptyForm() });
  },

  startEdit(event) {
    const item = (event.currentTarget.dataset && event.currentTarget.dataset.item) || {};
    this.setData({
      editingId: item.id || '',
      form: {
        rightId: item.rightId || '',
        name: item.name || '',
        description: item.description || '',
        status: item.status || 'active',
        type: item.type || 'ticket'
      }
    });
  },

  async save() {
    const { editingId, form } = this.data;
    if (!form.rightId || !form.name) {
      wx.showToast({ title: '请填写权益ID和名称', icon: 'none' });
      return;
    }

    try {
      if (editingId) {
        await AdminService.updateRightsMaster(editingId, form);
      } else {
        await AdminService.createRightsMaster(form);
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.startCreate();
      this.loadRights();
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    }
  },

  async remove(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) return;
    try {
      await AdminService.deleteRightsMaster(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadRights();
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '删除失败', icon: 'none' });
    }
  }
});
