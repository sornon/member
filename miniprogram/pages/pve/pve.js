import { PveService } from '../../services/api';

Page({
  data: {
    loading: true,
    profile: null,
    battleResult: null,
    battleLoading: false,
    selectedEnemyId: ''
  },

  onShow() {
    this.fetchProfile();
  },

  onPullDownRefresh() {
    this.fetchProfile(false)
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

  async handleBattle(event) {
    const { id: enemyId, locked } = event.currentTarget.dataset || {};
    if (!enemyId || locked) return;
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

  handleHistoryTap(event) {
    const { index } = event.currentTarget.dataset || {};
    const historyIndex = Number(index);
    if (!Number.isInteger(historyIndex) || historyIndex < 0) {
      return;
    }
    const history = (this.data.profile && this.data.profile.battleHistory) || [];
    const record = history[historyIndex];
    if (!record || record.type !== 'battle') {
      return;
    }
    wx.navigateTo({
      url: '/pages/pve/history',
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('historyRecord', { record });
        }
      }
    });
  }
});
