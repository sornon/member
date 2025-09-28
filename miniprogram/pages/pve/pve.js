import { PveService, MemberService } from '../../services/api';
import { formatStones } from '../../utils/format';

const ALLOCATABLE_KEYS = ['hp', 'attack', 'defense', 'speed', 'luck'];

Page({
  data: {
    loading: true,
    profile: null,
    battleResult: null,
    battleLoading: false,
    selectedEnemyId: '',
    drawing: false,
    activeTab: 'character',
    stoneBalance: 0,
    formattedStoneBalance: formatStones(0)
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
      this.setData({ profile, loading: false });
    } catch (error) {
      console.error('[pve] load profile failed', error);
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
    if (value === 'dungeon' || value === 'secret' || value === 'mystic') {
      return 'dungeon';
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
      console.error('[pve] refresh stone balance failed', error);
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

  async handleBattle(event) {
    const enemyId = event.currentTarget.dataset.id;
    if (!enemyId) return;
    this.setData({ battleLoading: true, selectedEnemyId: enemyId });
    try {
      const res = await PveService.battle(enemyId);
      this.setData({
        profile: res.profile,
        battleResult: res.battle,
        battleLoading: false,
        selectedEnemyId: ''
      });
      wx.showToast({
        title: res.battle && res.battle.victory ? '秘境胜利' : '战斗结束',
        icon: 'success'
      });
    } catch (error) {
      console.error('[pve] battle failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.setData({ battleLoading: false, selectedEnemyId: '' });
    }
  },

  async handleDrawSkill() {
    if (this.data.drawing) return;
    this.setData({ drawing: true });
    try {
      const res = await PveService.drawSkill();
      this.setData({ profile: res.profile, drawing: false });
      if (res.acquiredSkill) {
        wx.showToast({
          title: `${res.acquiredSkill.rarityLabel}·${res.acquiredSkill.name}`,
          icon: 'success'
        });
      } else {
        wx.showToast({ title: '抽卡完成', icon: 'success' });
      }
    } catch (error) {
      console.error('[pve] draw skill failed', error);
      wx.showToast({ title: error.errMsg || '抽卡失败', icon: 'none' });
      this.setData({ drawing: false });
    }
  },

  async handleEquipSkill(event) {
    const skillId = event.currentTarget.dataset.skillId;
    if (!skillId) return;
    try {
      const res = await PveService.equipSkill({ skillId });
      this.setData({ profile: res.profile });
      wx.showToast({ title: '已装备', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[pve] equip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleUnequipSkill(event) {
    const slot = Number(event.currentTarget.dataset.slot);
    if (!Number.isFinite(slot)) return;
    try {
      const res = await PveService.equipSkill({ skillId: '', slot });
      this.setData({ profile: res.profile });
    } catch (error) {
      console.error('[pve] unequip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleEquipItem(event) {
    const itemId = event.currentTarget.dataset.itemId;
    if (!itemId) return;
    try {
      const res = await PveService.equipItem(itemId);
      this.setData({ profile: res.profile });
      wx.showToast({ title: '装备成功', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[pve] equip item failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

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
      this.setData({ profile: res.profile });
      wx.showToast({ title: '属性已分配', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[pve] allocate points failed', error);
      wx.showToast({ title: error.errMsg || '分配失败', icon: 'none' });
    }
  }
});
