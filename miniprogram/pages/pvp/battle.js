import { PvpService } from '../../services/api';

function formatDateTime(date) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function transformRounds(battle) {
  if (!battle) return [];
  const playerId = battle.player ? battle.player.memberId : '';
  const opponentId = battle.opponent ? battle.opponent.memberId : '';
  return (battle.rounds || []).map((round, idx) => {
    const actorName = round.actorId === playerId ? battle.player.displayName : battle.opponent.displayName;
    const targetName = round.targetId === playerId ? battle.player.displayName : battle.opponent.displayName;
    return {
      ...round,
      index: idx,
      actorName,
      targetName,
      description: round.dodged ? `${actorName} 的攻击被 ${targetName} 闪避` : `${actorName} 对 ${targetName} 造成 ${round.damage} 点伤害${round.crit ? '（暴击）' : ''}`
    };
  });
}

Page({
  data: {
    loading: true,
    matchId: '',
    battle: null,
    rounds: [],
    error: ''
  },

  onLoad(options = {}) {
    if (options.matchId) {
      this.setData({ matchId: options.matchId });
      this.fetchBattle(options.matchId);
    }
  },

  onPullDownRefresh() {
    if (!this.data.matchId) {
      wx.stopPullDownRefresh();
      return;
    }
    this.fetchBattle(this.data.matchId)
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  async fetchBattle(matchId) {
    this.setData({ loading: true, error: '' });
    try {
      const battle = await PvpService.battleReplay(matchId);
      this.setData({
        loading: false,
        battle: {
          ...battle,
          createdAtText: formatDateTime(battle.createdAt)
        },
        rounds: transformRounds(battle)
      });
    } catch (error) {
      console.error('[pvp] load battle failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
    }
  },

  formatDateTime
});
