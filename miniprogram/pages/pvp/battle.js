import { PvpService } from '../../services/api';

const VIDEO_BACKGROUND_URL =
  'https://assets.mixkit.co/videos/preview/mixkit-fantasy-game-landscape-illustration-12421-large.mp4';
const VIDEO_POSTER = '../../assets/background/3.jpg';
const CHARACTER_SPRITES = [
  '../../assets/character/male-b-1.png',
  '../../assets/character/male-b-2.png',
  '../../assets/character/male-b-5.png',
  '../../assets/character/male-c-1.png',
  '../../assets/character/male-c-2.png',
  '../../assets/character/male-c-3.png',
  '../../assets/character/female-b-1.png',
  '../../assets/character/female-b-2.png',
  '../../assets/character/female-b-4.png',
  '../../assets/character/female-c-1.png',
  '../../assets/character/female-c-2.png',
  '../../assets/character/female-c-3.png'
];

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

function resolveSprite(memberId, fallbackIndex = 0) {
  if (!CHARACTER_SPRITES.length) {
    return '';
  }
  if (!memberId) {
    return CHARACTER_SPRITES[fallbackIndex % CHARACTER_SPRITES.length];
  }
  let hash = 0;
  for (let i = 0; i < memberId.length; i += 1) {
    hash = (hash * 31 + memberId.charCodeAt(i)) % CHARACTER_SPRITES.length;
  }
  return CHARACTER_SPRITES[hash];
}

function buildParticipantState(participant, fallbackIndex = 0) {
  if (!participant) return null;
  const maxHp = Number.isFinite(participant.maxHp)
    ? participant.maxHp
    : Number.isFinite(participant.remainingHp)
    ? participant.remainingHp
    : 0;
  const remainingHp = Number.isFinite(participant.remainingHp) ? participant.remainingHp : maxHp;
  const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((remainingHp / maxHp) * 100))) : 0;
  const damageDealt = Number.isFinite(participant.damageDealt) ? participant.damageDealt : 0;
  const damageTaken = Number.isFinite(participant.damageTaken) ? participant.damageTaken : 0;
  const roundsWon = Number.isFinite(participant.roundsWon) ? participant.roundsWon : 0;
  const pointsAfter = Number.isFinite(participant.pointsAfter) ? participant.pointsAfter : participant.points || 0;
  const pointsDelta = Number.isFinite(participant.pointsDelta) ? participant.pointsDelta : 0;
  return {
    ...participant,
    maxHp,
    remainingHp,
    hpPercent,
    damageDealt,
    damageTaken,
    roundsWon,
    pointsAfter,
    pointsDelta,
    sprite: resolveSprite(participant.memberId, fallbackIndex)
  };
}

function transformRounds(battle) {
  if (!battle) return [];
  const playerId = battle.player ? battle.player.memberId : '';
  const opponentId = battle.opponent ? battle.opponent.memberId : '';
  const maxHpMap = {};
  const hpTracker = {};
  const participants = [battle.player, battle.opponent].filter((item) => item && item.memberId);
  participants.forEach((participant) => {
    const maxHp = Number.isFinite(participant.maxHp)
      ? participant.maxHp
      : Number.isFinite(participant.remainingHp)
      ? participant.remainingHp
      : 0;
    if (participant.memberId) {
      maxHpMap[participant.memberId] = maxHp;
      hpTracker[participant.memberId] = maxHp;
    }
  });
  return (battle.rounds || []).map((round, idx) => {
    const actorName = round.actorId === playerId ? battle.player.displayName : battle.opponent.displayName;
    const targetName = round.targetId === playerId ? battle.player.displayName : battle.opponent.displayName;
    const previousTargetHp = Number.isFinite(hpTracker[round.targetId]) ? hpTracker[round.targetId] : 0;
    const rawDamage = Number.isFinite(round.damage) ? round.damage : previousTargetHp - round.targetRemainingHp;
    const damage = round.dodged ? 0 : Math.max(0, Math.round(rawDamage || 0));
    const heal = Number.isFinite(round.heal) ? Math.max(0, Math.round(round.heal)) : 0;
    const newTargetHp = Number.isFinite(round.targetRemainingHp) ? round.targetRemainingHp : previousTargetHp - damage;
    hpTracker[round.targetId] = Math.max(0, newTargetHp);
    if (heal > 0) {
      const currentActorHp = Number.isFinite(hpTracker[round.actorId]) ? hpTracker[round.actorId] : maxHpMap[round.actorId] || 0;
      const actorMaxHp = maxHpMap[round.actorId] || currentActorHp;
      hpTracker[round.actorId] = Math.min(actorMaxHp, currentActorHp + heal);
    }
    const maxHp = maxHpMap[round.targetId] || 0;
    const remainingPercent = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hpTracker[round.targetId] / maxHp) * 100))) : 0;
    const tagType = round.dodged ? 'dodge' : round.crit ? 'crit' : heal > 0 ? 'heal' : damage > 0 ? 'hit' : 'normal';
    const statusText = round.dodged ? '闪避' : round.crit ? '暴击' : heal > 0 ? '治疗' : damage > 0 ? '命中' : '出手';
    const healDescription = heal > 0 ? `，并回复 ${heal} 点生命` : '';
    return {
      ...round,
      index: idx,
      actorName,
      targetName,
      isPlayerAction: round.actorId === playerId,
      description: round.dodged
        ? `${targetName} 闪避了 ${actorName} 的攻击`
        : `${actorName} 对 ${targetName} 造成 ${damage} 点伤害${round.crit ? '（暴击）' : ''}${healDescription}`,
      damage,
      heal,
      remainingPercent,
      statusText,
      tagType,
      targetHpBefore: previousTargetHp,
      targetHpAfter: Math.max(0, Math.round(hpTracker[round.targetId]))
    };
  });
}

Page({
  data: {
    loading: true,
    matchId: '',
    battle: null,
    rounds: [],
    playerState: null,
    opponentState: null,
    error: '',
    videoSrc: VIDEO_BACKGROUND_URL,
    videoPoster: VIDEO_POSTER
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
        rounds: transformRounds(battle),
        playerState: buildParticipantState(battle.player, 0),
        opponentState: buildParticipantState(battle.opponent, 1)
      });
    } catch (error) {
      console.error('[pvp] load battle failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({
        loading: false,
        error: error.errMsg || '加载失败',
        battle: null,
        rounds: [],
        playerState: null,
        opponentState: null
      });
    }
  },

  formatDateTime
});
