import { PveService } from '../../services/api';

function normalizeEquipmentLootEntries(lootList = []) {
  if (!Array.isArray(lootList) || !lootList.length) {
    return [];
  }
  const result = [];
  for (let i = 0; i < lootList.length; i += 1) {
    const entry = lootList[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const type = entry.type || 'equipment';
    if (type !== 'equipment') {
      continue;
    }
    const identifier =
      entry.id || entry.itemId || entry.label || entry.name || entry.itemName || `equipment-${i}`;
    const label = entry.label || entry.name || entry.itemName || '装备';
    const qualityColor =
      (typeof entry.qualityColor === 'string' && entry.qualityColor) ||
      (typeof entry.color === 'string' && entry.color) ||
      (typeof entry.rarityColor === 'string' && entry.rarityColor) ||
      '#f1f4ff';
    result.push({
      ...entry,
      id: identifier,
      label,
      qualityColor
    });
  }
  return result;
}

function extractEquipmentLootFromRewards(rewards) {
  if (!rewards || typeof rewards !== 'object') {
    return [];
  }
  const lootList = Array.isArray(rewards.loot) ? rewards.loot : [];
  return normalizeEquipmentLootEntries(lootList);
}

function decorateBattlePayload(entry = {}, fallbackRewards = null) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  const rewardsSource =
    (entry.rewards && typeof entry.rewards === 'object' && entry.rewards) || fallbackRewards;
  const decoratedRewards =
    rewardsSource && typeof rewardsSource === 'object'
      ? {
          ...rewardsSource,
          loot: Array.isArray(rewardsSource.loot)
            ? rewardsSource.loot.map((item) => (item && typeof item === 'object' ? { ...item } : item))
            : []
        }
      : null;
  const equipmentLoot = extractEquipmentLootFromRewards(decoratedRewards || rewardsSource || {});
  const decorated = {
    ...entry,
    equipmentLoot
  };
  if (decoratedRewards) {
    decorated.rewards = decoratedRewards;
  }
  return decorated;
}

function decorateHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  if (entry.type !== 'battle') {
    return { ...entry };
  }
  const battleRewards =
    entry.battle && typeof entry.battle === 'object' && entry.battle.rewards && typeof entry.battle.rewards === 'object'
      ? entry.battle.rewards
      : null;
  const decorated = decorateBattlePayload(entry, battleRewards);
  if (entry.battle && typeof entry.battle === 'object') {
    decorated.battle = decorateBattlePayload(entry.battle, decorated.rewards);
  }
  return decorated;
}

function decorateSecretRealmProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }
  const decoratedProfile = { ...profile };
  if (Array.isArray(profile.battleHistory)) {
    decoratedProfile.battleHistory = profile.battleHistory.map((entry) => decorateHistoryEntry(entry));
  }
  if (decoratedProfile.battleResult && typeof decoratedProfile.battleResult === 'object') {
    decoratedProfile.battleResult = decorateBattlePayload(decoratedProfile.battleResult);
  }
  return decoratedProfile;
}

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
      const decoratedProfile = decorateSecretRealmProfile(profile);
      this.setData({ profile: decoratedProfile, loading: false });
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
          let refreshProfile = false;
          if (payload.profile) {
            nextState.profile = decorateSecretRealmProfile(payload.profile);
          } else if (payload.type === 'pve') {
            refreshProfile = true;
          }
          if (payload.battle) {
            nextState.battleResult = decorateBattlePayload(payload.battle);
            const victory = !!payload.battle.victory;
            const draw = !!payload.battle.draw;
            // wx.showToast({
            //   title: draw ? '势均力敌' : victory ? '秘境胜利' : '战斗结束',
            //   icon: 'success'
            // });
          }
          if (Object.keys(nextState).length) {
            this.setData(nextState);
          }
          if (refreshProfile) {
            this.fetchProfile(false).catch(() => {});
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
