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

  handleBattle(event) {
    const { id: enemyId, locked } = event.currentTarget.dataset || {};
    if (!enemyId || locked) return;
    const enemies = (this.data.profile && this.data.profile.enemies) || [];
    const enemy = enemies.find((item) => item.id === enemyId) || null;
    this.setData({ battleLoading: true, selectedEnemyId: enemyId });
    wx.navigateTo({
      url: `/pages/pvp/battle?mode=pve&enemyId=${enemyId}`,
      events: {
        battleComplete: (payload = {}) => {
          if (payload.mode !== 'pve') {
            return;
          }
          const nextState = {};
          if (payload.profile) {
            nextState.profile = payload.profile;
          }
          if (payload.battle) {
            nextState.battleResult = payload.battle;
          }
          if (Object.keys(nextState).length) {
            this.setData(nextState);
          }
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battle:launch', {
            mode: 'pve',
            enemyId,
            enemy,
            playerProfile: this.data.profile
          });
        }
      },
      fail: (error) => {
        console.error('[pve] navigate to battle failed', error);
        wx.showToast({ title: '无法进入战斗', icon: 'none' });
      },
      complete: () => {
        this.setData({ battleLoading: false, selectedEnemyId: '' });
      }
    });
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
