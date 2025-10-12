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

function formatInteger(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.round(num));
}

function describeTimelineEntry(entry, actorName, targetName) {
  if (entry && entry.summary && entry.summary.text) {
    return entry.summary.text;
  }
  const events = Array.isArray(entry && entry.events) ? entry.events : [];
  const damageEvent = events.find((event) => event && event.type === 'damage');
  if (damageEvent) {
    const value = formatInteger(damageEvent.value);
    const critText = damageEvent.crit ? '（暴击）' : '';
    return `${actorName} 对 ${targetName} 造成 ${value} 点伤害${critText}`;
  }
  const healEvent = events.find((event) => event && event.type === 'heal');
  if (healEvent) {
    const value = formatInteger(healEvent.value);
    return `${actorName} 为 ${targetName} 回复 ${value} 点生命`;
  }
  const dodgeEvent = events.find((event) => event && event.type === 'dodge');
  if (dodgeEvent) {
    return `${targetName} 闪避了 ${actorName} 的攻击`;
  }
  return `${actorName} 与 ${targetName} 交锋。`;
}

function transformRounds(battle) {
  if (!battle) return [];
  const playerId = battle.player ? battle.player.memberId : '';
  const opponentId = battle.opponent ? battle.opponent.memberId : '';
  const playerName = (battle.player && battle.player.displayName) || '我方';
  const opponentName = (battle.opponent && battle.opponent.displayName) || '对手';
  const timeline = Array.isArray(battle.timeline)
    ? battle.timeline.filter((entry) => entry && typeof entry === 'object')
    : [];
  if (timeline.length) {
    return timeline.map((entry, idx) => {
      const actorId = entry.actorId || (entry.actor && entry.actor.id) || '';
      const actorSide = entry.actorSide || (entry.actor && entry.actor.side) || (actorId === opponentId ? 'opponent' : 'player');
      const targetId = entry.targetId || (entry.target && entry.target.id) || '';
      const targetSide = (entry.target && entry.target.side) || (actorSide === 'player' ? 'opponent' : 'player');
      const actorName =
        actorId === playerId
          ? playerName
          : actorId === opponentId
          ? opponentName
          : actorSide === 'player'
          ? playerName
          : opponentName;
      const targetName =
        targetId === playerId
          ? playerName
          : targetId === opponentId
          ? opponentName
          : targetSide === 'player'
          ? playerName
          : opponentName;
      const state = entry.state && typeof entry.state === 'object' ? entry.state : {};
      const targetState = targetSide === 'player' ? state.player : state.opponent || state.enemy || {};
      const targetHp = targetState && targetState.hp ? targetState.hp : {};
      const remainingHp = Number.isFinite(targetHp.after) ? Math.max(0, Math.round(targetHp.after)) : '';
      return {
        index: idx,
        round: entry.round || idx + 1,
        actorName,
        targetName,
        description: describeTimelineEntry(entry, actorName, targetName),
        targetRemainingHp: remainingHp
      };
    });
  }
  const legacyRounds = Array.isArray(battle.legacyRounds)
    ? battle.legacyRounds
    : Array.isArray(battle.rounds) && !Number.isFinite(battle.rounds)
    ? battle.rounds
    : [];
  return legacyRounds.map((round, idx) => {
    const actorName = round.actorId === playerId ? playerName : opponentName;
    const targetName = round.targetId === playerId ? playerName : opponentName;
    return {
      ...round,
      index: idx,
      actorName,
      targetName,
      description: round.dodged
        ? `${actorName} 的攻击被 ${targetName} 闪避`
        : `${actorName} 对 ${targetName} 造成 ${formatInteger(round.damage)} 点伤害${round.crit ? '（暴击）' : ''}`
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
