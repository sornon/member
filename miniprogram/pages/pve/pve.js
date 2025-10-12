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
    const { id: enemyId, locked, index } = event.currentTarget.dataset || {};
    if (!enemyId || locked) {
      return;
    }
    if (this.data.battleLoading) {
      return;
    }
    const enemies = (this.data.profile && this.data.profile.enemies) || [];
    let enemyPreview = null;
    const resolvedIndex = Number(index);
    if (Number.isInteger(resolvedIndex) && resolvedIndex >= 0 && resolvedIndex < enemies.length) {
      enemyPreview = enemies[resolvedIndex];
    } else {
      enemyPreview = enemies.find((item) => item && item.id === enemyId) || null;
    }
    this.setData({ battleLoading: true, selectedEnemyId: enemyId });
    wx.navigateTo({
      url: '/pages/battle/play?mode=pve',
      events: {
        battleFinished: (payload = {}) => {
          const nextState = {};
          if (payload.profile) {
            nextState.profile = payload.profile;
          }
          if (payload.battle) {
            nextState.battleResult = payload.battle;
            const outcome = (payload.battle && payload.battle.outcome) || {};
            const participants = (payload.battle && payload.battle.participants) || {};
            const playerId = participants.player ? participants.player.id || participants.player.memberId : '';
            const draw = !!(outcome.draw || outcome.result === 'draw');
            const victory = outcome.result
              ? outcome.result === 'victory'
              : !draw && outcome.winnerId
              ? outcome.winnerId === playerId || !playerId
              : false;
            wx.showToast({
              title: draw ? '势均力敌' : victory ? '秘境胜利' : '战斗结束',
              icon: 'success'
            });
          }
          if (Object.keys(nextState).length) {
            this.setData(nextState);
          }
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', {
            mode: 'pve',
            source: 'live',
            enemyId,
            enemyPreview
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
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
