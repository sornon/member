import { PveService, MemberService } from '../../services/api';
import { formatStones } from '../../utils/format';
import { sanitizeEquipmentProfile } from '../../utils/equipment';

const ALLOCATABLE_KEYS = ['constitution', 'strength', 'spirit', 'root', 'agility', 'insight'];

Page({
  data: {
    loading: true,
    profile: null,
    activeTab: 'character',
    drawing: false,
    resetting: false,
    stoneBalance: 0,
    formattedStoneBalance: formatStones(0),
    equipmentTooltip: null
  },

  applyProfile(profile, extraState = {}) {
    const sanitizedProfile = sanitizeEquipmentProfile(profile);
    const updates = { ...extraState, profile: sanitizedProfile };
    const tooltip = this.data ? this.data.equipmentTooltip : null;
    if (tooltip && tooltip.item) {
      const itemId = tooltip.item.itemId;
      const equipment = sanitizedProfile && sanitizedProfile.equipment;
      const inSlots =
        equipment &&
        Array.isArray(equipment.slots) &&
        equipment.slots.some((slot) => slot && slot.item && slot.item.itemId === itemId);
      const inInventory =
        equipment &&
        Array.isArray(equipment.inventory) &&
        equipment.inventory.some((item) => item && item.itemId === itemId);
      if (!inSlots && !inInventory) {
        updates.equipmentTooltip = null;
      }
    }
    this.setData(updates);
    return sanitizedProfile;
  },

  onLoad(options = {}) {
    const initialTab = this.normalizeTab(options.tab);
    if (initialTab) {
      this.setData({ activeTab: initialTab });
    }
  },

  onShow() {
    this.fetchProfile();
    this.refreshStoneBalance();
  },

  onPullDownRefresh() {
    Promise.all([this.fetchProfile(false), this.refreshStoneBalance()])
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  async fetchProfile(showLoading = true) {
    if (this.data.loading && !showLoading) {
      showLoading = true;
    }
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const profile = await PveService.profile();
      this.applyProfile(profile, { loading: false });
    } catch (error) {
      console.error('[role] load profile failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
    return null;
  },

  normalizeTab(tab) {
    if (typeof tab !== 'string') {
      return '';
    }
    const value = tab.toLowerCase();
    if (value === 'character' || value === 'role') {
      return 'character';
    }
    if (value === 'equipment' || value === 'equip' || value === 'bag') {
      return 'equipment';
    }
    if (value === 'skill' || value === 'skills') {
      return 'skill';
    }
    return '';
  },

  handleTabChange(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset : {};
    const target = this.normalizeTab(dataset.tab);
    if (target && target !== this.data.activeTab) {
      this.setData({ activeTab: target });
    }
  },

  async refreshStoneBalance() {
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.globalData && app.globalData.memberInfo && app.globalData.memberInfo.stoneBalance != null) {
        this.setStoneBalance(app.globalData.memberInfo.stoneBalance);
      }
      const member = await MemberService.getMember();
      if (member && typeof member.stoneBalance !== 'undefined') {
        this.setStoneBalance(member.stoneBalance);
        if (app && app.globalData) {
          app.globalData.memberInfo = { ...(app.globalData.memberInfo || {}), ...member };
        }
      }
    } catch (error) {
      console.error('[role] refresh stone balance failed', error);
    }
  },

  setStoneBalance(balance) {
    const value = Number(balance) || 0;
    this.setData({
      stoneBalance: value,
      formattedStoneBalance: formatStones(value)
    });
  },

  handleOpenStones() {
    wx.navigateTo({ url: '/pages/stones/stones' });
  },

  async handleDrawSkill() {
    if (this.data.drawing) return;
    this.setData({ drawing: true });
    try {
      const res = await PveService.drawSkill();
      this.applyProfile(res.profile, { drawing: false });
      if (res.acquiredSkill) {
        wx.showToast({
          title: `${res.acquiredSkill.rarityLabel}·${res.acquiredSkill.name}`,
          icon: 'success'
        });
      } else {
        wx.showToast({ title: '抽卡完成', icon: 'success' });
      }
    } catch (error) {
      console.error('[role] draw skill failed', error);
      wx.showToast({ title: error.errMsg || '抽卡失败', icon: 'none' });
      this.setData({ drawing: false });
    }
  },

  async handleEquipSkill(event) {
    const skillId = event.currentTarget.dataset.skillId;
    if (!skillId) return;
    try {
      const res = await PveService.equipSkill({ skillId });
      this.applyProfile(res.profile);
      wx.showToast({ title: '已装备', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] equip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleUnequipSkill(event) {
    const slot = Number(event.currentTarget.dataset.slot);
    if (!Number.isFinite(slot)) return;
    try {
      const res = await PveService.equipSkill({ skillId: '', slot });
      this.applyProfile(res.profile);
    } catch (error) {
      console.error('[role] unequip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleEquipItem(options = {}) {
    const dataset =
      (options && options.currentTarget && options.currentTarget.dataset) ||
      (options && typeof options === 'object' ? options : {}) || {};
    const itemId = typeof dataset.itemId === 'string' ? dataset.itemId : '';
    const slot = typeof dataset.slot === 'string' ? dataset.slot.trim() : '';
    if (!itemId) return false;
    try {
      const res = await PveService.equipItem({ itemId, slot });
      this.applyProfile(res.profile);
      wx.showToast({ title: '装备成功', icon: 'success', duration: 1200 });
      return true;
    } catch (error) {
      console.error('[role] equip item failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
      return false;
    }
  },

  async handleUnequipItem(options = {}) {
    const dataset =
      (options && options.currentTarget && options.currentTarget.dataset) ||
      (options && typeof options === 'object' ? options : {}) || {};
    const slot = typeof dataset.slot === 'string' ? dataset.slot.trim() : '';
    if (!slot) return false;
    try {
      const res = await PveService.equipItem({ slot, itemId: '' });
      this.applyProfile(res.profile);
      wx.showToast({ title: '已卸下', icon: 'success', duration: 1200 });
      return true;
    } catch (error) {
      console.error('[role] unequip item failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
      return false;
    }
  },

  handleEquipmentTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const rawItem = dataset.item;
    if (!rawItem) {
      this.closeEquipmentTooltip();
      return;
    }
    const slot = (typeof dataset.slot === 'string' && dataset.slot.trim()) || rawItem.slot || '';
    const source = dataset.source || 'inventory';
    const currentTooltip = this.data && this.data.equipmentTooltip;
    if (
      currentTooltip &&
      currentTooltip.item &&
      rawItem.itemId &&
      currentTooltip.item.itemId === rawItem.itemId &&
      currentTooltip.source === source &&
      currentTooltip.slot === slot
    ) {
      this.closeEquipmentTooltip();
      return;
    }
    const tooltip = {
      visible: true,
      source,
      slot,
      slotLabel: dataset.slotLabel || rawItem.slotLabel || '',
      item: { ...rawItem }
    };
    this.setData({ equipmentTooltip: tooltip });
  },

  closeEquipmentTooltip() {
    this.setData({ equipmentTooltip: null });
  },

  async handleEquipFromTooltip() {
    const tooltip = this.data.equipmentTooltip;
    if (!tooltip || !tooltip.item || !tooltip.item.itemId) {
      return;
    }
    const slot =
      (typeof tooltip.slot === 'string' && tooltip.slot.trim()) ||
      (typeof tooltip.item.slot === 'string' ? tooltip.item.slot : '');
    const success = await this.handleEquipItem({
      itemId: tooltip.item.itemId,
      slot
    });
    if (success) {
      this.closeEquipmentTooltip();
    }
  },

  async handleUnequipFromTooltip(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const tooltip = this.data.equipmentTooltip;
    const slot =
      (typeof dataset.slot === 'string' && dataset.slot.trim()) ||
      (tooltip && (tooltip.slot || (tooltip.item && tooltip.item.slot))) ||
      '';
    if (!slot) {
      return;
    }
    const success = await this.handleUnequipItem({ slot });
    if (success) {
      this.closeEquipmentTooltip();
    }
  },

  noop() {},

  handleAllocate(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'auto') {
      this.autoAllocate();
      return;
    }
    const profile = this.data.profile;
    if (!profile || !profile.attributes || profile.attributes.attributePoints <= 0) {
      wx.showToast({ title: '暂无可用属性点', icon: 'none' });
      return;
    }
    const options = (profile.attributes.attributeList || []).filter((item) =>
      ALLOCATABLE_KEYS.includes(item.key)
    );
    if (!options.length) {
      wx.showToast({ title: '暂无可分配属性', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: options.map((item) => `${item.label} +${item.step}`),
      success: ({ tapIndex }) => {
        const target = options[tapIndex];
        if (target) {
          this.allocatePoints({ [target.key]: 1 });
        }
      }
    });
  },

  handleResetAttributes() {
    const profile = this.data.profile;
    const attributes = profile && profile.attributes;
    const available = attributes ? Number(attributes.respecAvailable || 0) : 0;
    if (!attributes || available <= 0) {
      wx.showToast({ title: '洗点次数不足', icon: 'none' });
      return;
    }
    if (this.data.resetting) {
      return;
    }
    const content = `洗点将返还所有已分配的属性点，本次后剩余 ${available - 1} 次。`;
    wx.showModal({
      title: '确认洗点',
      content,
      confirmText: '立即洗点',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          this.performResetAttributes();
        }
      }
    });
  },

  async performResetAttributes() {
    if (this.data.resetting) {
      return;
    }
    this.setData({ resetting: true });
    try {
      const res = await PveService.resetAttributes();
      const updatedProfile = res && res.profile ? res.profile : this.data.profile;
      this.applyProfile(updatedProfile, { resetting: false });
      wx.showToast({ title: '洗点完成', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] reset attributes failed', error);
      wx.showToast({ title: error.errMsg || '洗点失败', icon: 'none' });
      this.setData({ resetting: false });
    }
  },

  async autoAllocate() {
    const profile = this.data.profile;
    if (!profile || !profile.attributes) return;
    const points = Number(profile.attributes.attributePoints || 0);
    if (points <= 0) {
      wx.showToast({ title: '暂无可用属性点', icon: 'none' });
      return;
    }
    const keys = (profile.attributes.attributeList || [])
      .filter((item) => ALLOCATABLE_KEYS.includes(item.key))
      .map((item) => item.key);
    if (!keys.length) {
      wx.showToast({ title: '暂无可分配属性', icon: 'none' });
      return;
    }
    const allocations = {};
    const base = Math.floor(points / keys.length);
    let remainder = points % keys.length;
    keys.forEach((key) => {
      allocations[key] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder -= 1;
      }
    });
    await this.allocatePoints(allocations);
  },

  async allocatePoints(allocations) {
    if (!allocations || !Object.keys(allocations).length) {
      return;
    }
    try {
      const res = await PveService.allocatePoints(allocations);
      this.applyProfile(res.profile);
      wx.showToast({ title: '属性已分配', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] allocate points failed', error);
      wx.showToast({ title: error.errMsg || '分配失败', icon: 'none' });
    }
  }
});
