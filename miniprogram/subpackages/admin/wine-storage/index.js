import { AdminService } from '../../../services/api';
import { formatDate, formatMemberDisplayName } from '../../../utils/format';

const EXPIRY_OPTIONS = [
  { value: '7d', label: '7天' },
  { value: '3m', label: '3个月' },
  { value: '1y', label: '1年' }
];

function toPositiveInteger(value) {
  if (value == null || value === '') {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.floor(numeric));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return 0;
}

function normalizeWineEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) {
        return null;
      }
      const rawQuantity = Number(item.quantity || 0);
      const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
      const expiresAtDate = item.expiresAt ? new Date(item.expiresAt) : null;
      const expiresAtValid = expiresAtDate && !Number.isNaN(expiresAtDate.getTime()) ? expiresAtDate : null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : `wine_${index}`,
        name,
        quantity,
        expiresAt: expiresAtValid ? expiresAtValid.toISOString() : '',
        expiresAtText: expiresAtValid ? formatDate(expiresAtValid) : '—',
        expiresAtTimestamp: expiresAtValid ? expiresAtValid.getTime() : Number.POSITIVE_INFINITY
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.expiresAtTimestamp - b.expiresAtTimestamp);
}

function calculateTotal(entries = []) {
  return entries.reduce((sum, entry) => sum + (Number.isFinite(entry.quantity) ? entry.quantity : 0), 0);
}

Page({
  data: {
    keyword: '',
    loadingMembers: false,
    members: [],
    selectedMember: null,
    selectedMemberId: '',
    storageLoading: false,
    storageEntries: [],
    storageTotal: 0,
    expiryOptions: EXPIRY_OPTIONS,
    form: {
      name: '',
      quantity: '',
      expiryOption: EXPIRY_OPTIONS[1].value
    },
    submitting: false,
    removingId: ''
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' });
  },

  async handleSearch() {
    const { keyword } = this.data;
    if (this.data.loadingMembers) {
      return;
    }
    this.setData({ loadingMembers: true });
    try {
      const result = await AdminService.listMembers({ keyword, page: 1, pageSize: 20 });
      const members = Array.isArray(result.members)
        ? result.members.map((member) => ({
            ...member,
            displayName: formatMemberDisplayName(member.nickName, member.realName, '未命名会员')
          }))
        : [];
      this.setData({ members, loadingMembers: false });
    } catch (error) {
      console.error('[wine-storage] load members failed', error);
      this.setData({ loadingMembers: false });
      wx.showToast({ title: '加载会员失败', icon: 'none' });
    }
  },

  handleSelectMember(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.loadingMembers) {
      return;
    }
    const member = this.data.members.find((item) => item && item._id === id);
    if (!member) {
      return;
    }
    this.setData({
      selectedMember: member,
      selectedMemberId: member._id,
      storageEntries: [],
      storageTotal: 0,
      form: {
        name: '',
        quantity: '',
        expiryOption: this.data.form.expiryOption || EXPIRY_OPTIONS[1].value
      }
    });
    this.loadWineStorage(member._id);
  },

  async loadWineStorage(memberId) {
    if (!memberId) {
      return;
    }
    this.setData({ storageLoading: true });
    try {
      const result = await AdminService.listWineStorage(memberId);
      const entries = normalizeWineEntries(result && result.entries);
      const totalQuantity = Number.isFinite(result && result.totalQuantity)
        ? Math.max(0, Math.floor(result.totalQuantity))
        : calculateTotal(entries);
      this.setData({
        storageEntries: entries,
        storageTotal: totalQuantity,
        storageLoading: false
      });
    } catch (error) {
      console.error('[wine-storage] load storage failed', error);
      this.setData({ storageLoading: false });
      wx.showToast({ title: '加载存酒失败', icon: 'none' });
    }
  },

  handleNameInput(event) {
    this.setData({ 'form.name': event.detail.value || '' });
  },

  handleQuantityInput(event) {
    this.setData({ 'form.quantity': event.detail.value || '' });
  },

  handleExpiryChange(event) {
    const value = event.detail.value || '';
    this.setData({ 'form.expiryOption': value || EXPIRY_OPTIONS[1].value });
  },

  async handleAddStorage() {
    if (this.data.submitting) {
      return;
    }
    const member = this.data.selectedMember;
    if (!member || !member._id) {
      wx.showToast({ title: '请先选择会员', icon: 'none' });
      return;
    }
    const name = (this.data.form.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入存酒名称', icon: 'none' });
      return;
    }
    const quantity = toPositiveInteger(this.data.form.quantity);
    if (!quantity) {
      wx.showToast({ title: '请输入有效数量', icon: 'none' });
      return;
    }
    const expiryOption = this.data.form.expiryOption || EXPIRY_OPTIONS[1].value;

    this.setData({ submitting: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const result = await AdminService.addWineStorage(member._id, { name, quantity, expiryOption });
      const entries = normalizeWineEntries(result && result.entries);
      const totalQuantity = Number.isFinite(result && result.totalQuantity)
        ? Math.max(0, Math.floor(result.totalQuantity))
        : calculateTotal(entries);
      this.setData({
        storageEntries: entries,
        storageTotal: totalQuantity,
        'form.name': '',
        'form.quantity': '',
        submitting: false
      });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });
    } catch (error) {
      console.error('[wine-storage] add storage failed', error);
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  handleRemoveEntry(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || !this.data.selectedMember || this.data.removingId) {
      return;
    }
    wx.showModal({
      title: '删除存酒',
      content: '确定删除这条存酒记录吗？',
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          this.removeWineEntry(id);
        }
      }
    });
  },

  async removeWineEntry(entryId) {
    const member = this.data.selectedMember;
    if (!member || !member._id) {
      return;
    }
    this.setData({ removingId: entryId });
    wx.showLoading({ title: '删除中', mask: true });
    try {
      const result = await AdminService.removeWineStorage(member._id, entryId);
      const entries = normalizeWineEntries(result && result.entries);
      const totalQuantity = Number.isFinite(result && result.totalQuantity)
        ? Math.max(0, Math.floor(result.totalQuantity))
        : calculateTotal(entries);
      this.setData({
        storageEntries: entries,
        storageTotal: totalQuantity,
        removingId: ''
      });
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (error) {
      console.error('[wine-storage] remove storage failed', error);
      wx.hideLoading();
      this.setData({ removingId: '' });
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  handleResetSelection() {
    this.setData({
      selectedMember: null,
      selectedMemberId: '',
      storageEntries: [],
      storageTotal: 0,
      form: {
        name: '',
        quantity: '',
        expiryOption: this.data.form.expiryOption || EXPIRY_OPTIONS[1].value
      }
    });
  }
});
