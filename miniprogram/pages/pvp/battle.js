import { PvpService } from '../../services/api';

const PARTICIPANT_ALIASES = {
  player: ['player', 'self', 'member', 'attacker', 'initiator'],
  opponent: ['opponent', 'enemy', 'defender', 'target']
};

function resolveBattleParticipant(battle = {}, role = 'player') {
  const aliases = PARTICIPANT_ALIASES[role] || [role];
  const participants = (battle && battle.participants) || {};
  let candidate = null;
  for (let i = 0; i < aliases.length; i += 1) {
    const alias = aliases[i];
    if (alias && participants[alias]) {
      candidate = participants[alias];
      break;
    }
  }
  const fallback = role === 'player' ? battle.player : battle.opponent;
  const normalized = { ...(fallback || {}) };
  if (candidate && typeof candidate === 'object') {
    Object.keys(candidate).forEach((key) => {
      const value = candidate[key];
      if (value !== undefined) {
        normalized[key] = value;
      }
    });
  }
  if (!normalized.displayName) {
    normalized.displayName = role === 'player' ? '我方' : '对手';
  }
  if (!normalized.memberId && typeof normalized.id === 'string') {
    normalized.memberId = normalized.id;
  }
  if (!normalized.id && typeof normalized.memberId === 'string') {
    normalized.id = normalized.memberId;
  }
  if (!normalized.portrait) {
    const portraitCandidates = [];
    if (candidate && typeof candidate === 'object') {
      portraitCandidates.push(candidate.portrait, candidate.avatarUrl, candidate.url);
    }
    if (fallback && typeof fallback === 'object') {
      portraitCandidates.push(fallback.portrait, fallback.avatarUrl, fallback.url);
    }
    for (let i = 0; i < portraitCandidates.length; i += 1) {
      const portrait = portraitCandidates[i];
      if (typeof portrait === 'string' && portrait.trim()) {
        normalized.portrait = portrait;
        break;
      }
    }
  }
  return normalized;
}

function normalizeBattleOutcome(battle = {}, playerParticipant = {}, opponentParticipant = {}) {
  if (battle && battle.outcome && typeof battle.outcome === 'object') {
    return battle.outcome;
  }
  const legacy = (battle && battle.result) || {};
  const draw = !!legacy.draw;
  const playerId = playerParticipant.memberId || playerParticipant.id || '';
  let result = 'draw';
  if (!draw) {
    if (legacy.winnerId && legacy.winnerId === playerId) {
      result = 'victory';
    } else if (legacy.loserId && legacy.loserId === playerId) {
      result = 'defeat';
    } else if (legacy.winnerId && legacy.winnerId !== playerId) {
      result = 'defeat';
    } else if (legacy.loserId && legacy.loserId !== playerId) {
      result = 'victory';
    } else {
      result = 'victory';
    }
  }
  const timeline = Array.isArray(battle.timeline) ? battle.timeline : [];
  const rounds = Number.isFinite(legacy.rounds) ? legacy.rounds : timeline.length;
  const playerName = playerParticipant.displayName || '我方';
  const opponentName = opponentParticipant.displayName || '对手';
  let summaryText = '';
  if (draw) {
    summaryText = `${playerName}与${opponentName}的对决以平局收场。`;
  } else if (result === 'victory') {
    summaryText = `${playerName}击败了${opponentName}。`;
  } else {
    summaryText = `${opponentName}占据上风。`;
  }
  const summaryTitle =
    result === 'victory' ? '战斗结果 · 胜利' : result === 'defeat' ? '战斗结果 · 惜败' : '战斗结果 · 平局';
  return {
    winnerId: legacy.winnerId || null,
    loserId: legacy.loserId || null,
    draw,
    result,
    rounds,
    summary: {
      title: summaryTitle,
      text: summaryText
    }
  };
}

function buildHeaderPayload(outcome = {}) {
  const resultLabel = outcome.draw
    ? '战斗结果 · 平局'
    : outcome.result === 'victory'
    ? '战斗结果 · 胜利'
    : outcome.result === 'defeat'
    ? '战斗结果 · 惜败'
    : '战斗结果';
  const title = (outcome.summary && outcome.summary.title) || resultLabel;
  const subtitle = outcome.summary && outcome.summary.text ? outcome.summary.text : '';
  return {
    title,
    subtitle,
    resultLabel: outcome.draw
      ? '平局'
      : outcome.result === 'victory'
      ? '主角胜利'
      : outcome.result === 'defeat'
      ? '对手胜利'
      : '战斗结束'
  };
}

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
  const participants = battle.participants || {};
  const playerParticipant = participants.player || battle.player || {};
  const opponentParticipant = participants.opponent || battle.opponent || {};
  const playerId = playerParticipant.id || playerParticipant.memberId || '';
  const opponentId = opponentParticipant.id || opponentParticipant.memberId || '';
  const playerName =
    playerParticipant.displayName ||
    (battle.player && battle.player.displayName) ||
    '我方';
  const opponentName =
    opponentParticipant.displayName ||
    (battle.opponent && battle.opponent.displayName) ||
    '对手';
  const timeline = Array.isArray(battle.timeline) ? battle.timeline : [];

  if (timeline.length) {
    return timeline.map((entry, idx) => {
      const actorSide = entry.actor && entry.actor.side;
      const actorId = entry.actorId || (entry.actor && entry.actor.id);
      const actorName = entry.actor && entry.actor.displayName
        ? entry.actor.displayName
        : actorId === playerId || actorSide === 'player'
        ? playerName
        : actorId === opponentId || actorSide === 'opponent'
        ? opponentName
        : entry.actor && entry.actor.label
        ? entry.actor.label
        : '参战者';
      const target = entry.target || {};
      const targetId = entry.targetId || target.id;
      const targetSide = target.side;
      const targetName = target.displayName
        ? target.displayName
        : targetId === playerId || targetSide === 'player'
        ? playerName
        : targetId === opponentId || targetSide === 'opponent'
        ? opponentName
        : opponentName;
      const description = entry.summary && entry.summary.text
        ? entry.summary.text
        : entry.description
        ? entry.description
        : `${actorName} 对 ${targetName} 发动攻势。`;
      const afterState = entry.after || {};
      const hpSummary = {
        player:
          Number.isFinite(afterState.player) || Number.isFinite(afterState.self)
            ? Math.max(0, Math.round(Number.isFinite(afterState.player) ? afterState.player : afterState.self))
            : null,
        opponent:
          Number.isFinite(afterState.opponent) || Number.isFinite(afterState.enemy)
            ? Math.max(0, Math.round(Number.isFinite(afterState.opponent) ? afterState.opponent : afterState.enemy))
            : null
      };
      return {
        ...entry,
        index: idx,
        actorName,
        targetName,
        description,
        hpSummary
      };
    });
  }

  const legacyRounds = Array.isArray(battle.rounds) ? battle.rounds : [];
  return legacyRounds.map((round, idx) => {
    const actorId = round.actorId;
    const targetId = round.targetId;
    const actorName = actorId === playerId ? playerName : opponentName;
    const targetName = targetId === playerId ? playerName : opponentName;
    const damageText = Number.isFinite(round.damage) ? `${round.damage}` : '0';
    const hpSummary = {
      player: Number.isFinite(round.playerRemainingHp)
        ? Math.max(0, Math.round(round.playerRemainingHp))
        : null,
      opponent: Number.isFinite(round.targetRemainingHp)
        ? Math.max(0, Math.round(round.targetRemainingHp))
        : null
    };
    return {
      ...round,
      index: idx,
      actorName,
      targetName,
      description: round.dodged
        ? `${actorName} 的攻击被 ${targetName} 闪避`
        : `${actorName} 对 ${targetName} 造成 ${damageText} 点伤害${round.crit ? '（暴击）' : ''}`,
      hpSummary
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
      const playerParticipant = resolveBattleParticipant(battle, 'player');
      const opponentParticipant = resolveBattleParticipant(battle, 'opponent');
      const normalizedOutcome = normalizeBattleOutcome(battle, playerParticipant, opponentParticipant);
      const header = buildHeaderPayload(normalizedOutcome);
      const enhancedBattle = {
        ...battle,
        participants: {
          ...battle.participants,
          player: playerParticipant,
          opponent: opponentParticipant
        },
        outcome: normalizedOutcome,
        header,
        createdAtText: formatDateTime(battle.createdAt)
      };
      this.setData({
        loading: false,
        battle: enhancedBattle,
        rounds: transformRounds(enhancedBattle)
      });
    } catch (error) {
      console.error('[pvp] load battle failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
    }
  },

  formatDateTime
});
