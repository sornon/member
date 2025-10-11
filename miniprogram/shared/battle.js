const { buildCloudAssetUrl, CHARACTER_IMAGE_BASE_PATH } = require('./asset-paths');

const DEFAULT_BACKGROUND_VIDEO = buildCloudAssetUrl('video', 'battle_default.mp4');
const DEFAULT_PLAYER_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/male-b-1.png`;
const DEFAULT_OPPONENT_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/female-c-1.png`;

const PLAYER_SKILL_ROTATION = ['流云剑诀', '星河落斩', '落霞破影', '雷霆贯体'];
const OPPONENT_SKILL_ROTATION = ['幽影突袭', '寒魄碎骨', '血焰冲锋', '枯藤缠袭'];

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function resolvePortrait(source, fallback) {
  if (!source) {
    return fallback;
  }
  if (typeof source === 'string' && source.trim()) {
    return source;
  }
  if (source.avatarUrl) {
    return source.avatarUrl;
  }
  if (source.portrait) {
    return source.portrait;
  }
  return fallback;
}

function buildHpState(maxHp, currentHp) {
  const normalizedMax = Math.max(1, toNumber(maxHp, currentHp || 1));
  const normalizedCurrent = clamp(toNumber(currentHp, normalizedMax), 0, normalizedMax);
  const percent = clamp(Math.round((normalizedCurrent / normalizedMax) * 100), 0, 100);
  return { max: normalizedMax, current: normalizedCurrent, percent };
}

function extractNumberFromLog(log, pattern) {
  const match = log.match(pattern);
  if (!match || match.length < 2) {
    return 0;
  }
  return formatNumber(Number(match[1]));
}

function parsePveTotals(log = []) {
  return log.reduce(
    (acc, entry) => {
      if (typeof entry !== 'string') {
        return acc;
      }
      acc.playerDamageTaken += extractNumberFromLog(entry, /敌方造成\s+(\d+)/);
      acc.enemyDamageTaken += extractNumberFromLog(entry, /你造成\s+(\d+)/);
      acc.playerHeal += extractNumberFromLog(entry, /你回复了\s+(\d+)/);
      acc.enemyHeal += extractNumberFromLog(entry, /敌方.*回复了\s+(\d+)/);
      return acc;
    },
    { playerDamageTaken: 0, enemyDamageTaken: 0, playerHeal: 0, enemyHeal: 0 }
  );
}

function parseRoundFromLog(entry, fallback) {
  const match = typeof entry === 'string' ? entry.match(/第(\d+)回合/) : null;
  if (match && match[1]) {
    return Number(match[1]);
  }
  return fallback;
}

function buildPveActions(battle = {}, context = {}) {
  const log = Array.isArray(battle.log) ? battle.log : [];
  const remainingPlayerHp = toNumber(battle.remaining && battle.remaining.playerHp, 0);
  const remainingEnemyHp = toNumber(battle.remaining && battle.remaining.enemyHp, 0);
  const totals = parsePveTotals(log);
  const playerMaxHp = Math.max(remainingPlayerHp + totals.playerDamageTaken - totals.playerHeal, remainingPlayerHp, 1);
  const enemyMaxHp = Math.max(remainingEnemyHp + totals.enemyDamageTaken - totals.enemyHeal, remainingEnemyHp, 1);
  let playerHp = playerMaxHp;
  let enemyHp = enemyMaxHp;
  let playerSkillIndex = 0;
  let enemySkillIndex = 0;

  const actions = [];
  log.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry) {
      return;
    }
    const round = parseRoundFromLog(entry, Math.floor(index / 2) + 1);
    const effects = [];
    let actor = 'player';
    let target = 'opponent';
    let damage = 0;
    let heal = 0;
    let type = 'attack';
    let title = '';
    let description = entry;
    if (/敌方闪避/.test(entry)) {
      actor = 'player';
      target = 'opponent';
      type = 'dodge';
      title = `第${round}回合 · 连击未果`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else if (/你闪避了敌方/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      type = 'dodge';
      title = `第${round}回合 · 身法化影`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else if (/你造成/.test(entry)) {
      actor = 'player';
      target = 'opponent';
      damage = extractNumberFromLog(entry, /你造成\s+(\d+)/);
      const crit = /暴击/.test(entry);
      const skillName = PLAYER_SKILL_ROTATION[playerSkillIndex % PLAYER_SKILL_ROTATION.length];
      playerSkillIndex += 1;
      title = `第${round}回合 · ${skillName}`;
      if (crit) {
        effects.push({ type: 'crit', label: '暴击' });
      }
      description = `你施展「${skillName}」，对敌方造成 ${damage} 点伤害${crit ? '（暴击）' : ''}。`;
      enemyHp = clamp(enemyHp - damage, 0, enemyMaxHp);
    } else if (/敌方造成/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      damage = extractNumberFromLog(entry, /敌方造成\s+(\d+)/);
      const crit = /暴击/.test(entry);
      const skillName = OPPONENT_SKILL_ROTATION[enemySkillIndex % OPPONENT_SKILL_ROTATION.length];
      enemySkillIndex += 1;
      title = `第${round}回合 · ${skillName}`;
      if (crit) {
        effects.push({ type: 'crit', label: '暴击' });
      }
      description = `敌方发动「${skillName}」，对你造成 ${damage} 点伤害${crit ? '（暴击）' : ''}。`;
      playerHp = clamp(playerHp - damage, 0, playerMaxHp);
    } else if (/灵血回流/.test(entry)) {
      actor = 'player';
      target = 'player';
      type = 'heal';
      heal = extractNumberFromLog(entry, /回复了\s+(\d+)/);
      title = `第${round}回合 · 灵血回流`;
      effects.push({ type: 'heal', label: '治疗' });
      description = `被动「灵血回流」触发，你回复了 ${heal} 点生命。`;
      playerHp = clamp(playerHp + heal, 0, playerMaxHp);
    } else if (/敌方吸取灵力/.test(entry)) {
      actor = 'opponent';
      target = 'opponent';
      type = 'heal';
      heal = extractNumberFromLog(entry, /回复了\s+(\d+)/);
      title = `第${round}回合 · 吸血诀`;
      effects.push({ type: 'heal', label: '吸血' });
      description = `敌方吸取灵力，恢复 ${heal} 点生命。`;
      enemyHp = clamp(enemyHp + heal, 0, enemyMaxHp);
    } else if (/挑战失败/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      type = 'result';
      title = `第${round}回合 · 持久战`;
      description = entry;
    } else {
      title = `第${round}回合 · 战斗流转`;
    }
    const hp = {
      player: buildHpState(playerMaxHp, playerHp),
      opponent: buildHpState(enemyMaxHp, enemyHp)
    };
    actions.push({
      id: `pve-${index}`,
      round,
      actor,
      target,
      type,
      damage,
      heal,
      description,
      title,
      effects,
      hp,
      raw: entry
    });
  });

  if (battle.victory || battle.draw || log.length) {
    const outcomeTitle = battle.victory ? '胜利' : battle.draw ? '势均力敌' : '惜败';
    const hp = {
      player: buildHpState(playerMaxHp, remainingPlayerHp || playerHp),
      opponent: buildHpState(enemyMaxHp, remainingEnemyHp || enemyHp)
    };
    actions.push({
      id: 'pve-result',
      round: toNumber(battle.rounds, actions.length + 1),
      actor: battle.victory ? 'player' : battle.draw ? 'neutral' : 'opponent',
      target: 'neutral',
      type: 'result',
      description: battle.victory
        ? '你成功击败敌人，秘境更进一步。'
        : battle.draw
        ? '双方筋疲力尽，战斗以平局告终。'
        : '战斗告一段落，敌人仍旧伺机而动。',
      title: `战斗结果 · ${outcomeTitle}`,
      effects: [],
      hp
    });
  }

  const playerName = (context && context.playerName) || '你';
  const opponentName = (context && context.opponentName) || '秘境之敌';

  return {
    player: {
      id: 'player',
      name: playerName,
      hp: buildHpState(playerMaxHp, playerMaxHp),
      portrait: resolvePortrait(context && context.playerPortrait, DEFAULT_PLAYER_IMAGE),
      combatPower: toNumber(battle.combatPower && battle.combatPower.player),
      summary: {
        damageDealt: totals.enemyDamageTaken,
        damageTaken: totals.playerDamageTaken,
        heal: totals.playerHeal
      }
    },
    opponent: {
      id: 'opponent',
      name: opponentName,
      hp: buildHpState(enemyMaxHp, enemyMaxHp),
      portrait: resolvePortrait(context && context.opponentPortrait, DEFAULT_OPPONENT_IMAGE),
      combatPower: toNumber(battle.combatPower && battle.combatPower.enemy),
      summary: {
        damageDealt: totals.playerDamageTaken,
        damageTaken: totals.enemyDamageTaken,
        heal: totals.enemyHeal
      }
    },
    actions,
    backgroundVideo: context && context.backgroundVideo ? context.backgroundVideo : DEFAULT_BACKGROUND_VIDEO,
    result: {
      victory: !!battle.victory,
      draw: !!battle.draw,
      rounds: toNumber(battle.rounds, actions.length),
      rewards: battle.rewards || null
    }
  };
}

function buildPvpActions(battle = {}, context = {}) {
  const rounds = Array.isArray(battle.rounds) ? battle.rounds : [];
  const playerName = (battle.player && battle.player.displayName) || (context && context.playerName) || '我方';
  const opponentName = (battle.opponent && battle.opponent.displayName) || (context && context.opponentName) || '对手';
  const playerId = battle.player ? battle.player.memberId : '';
  const opponentId = battle.opponent ? battle.opponent.memberId : '';
  const playerMaxHp = Math.max(toNumber(battle.player && battle.player.maxHp, 1), 1);
  const opponentMaxHp = Math.max(toNumber(battle.opponent && battle.opponent.maxHp, 1), 1);
  let playerHp = playerMaxHp;
  let opponentHp = opponentMaxHp;
  let playerSkillIndex = 0;
  let opponentSkillIndex = 0;

  const actions = rounds.map((entry, index) => {
    const roundNumber = toNumber(entry.round, Math.floor(index / 2) + 1);
    const actorIsPlayer = entry.actorId === playerId;
    const actor = actorIsPlayer ? 'player' : 'opponent';
    const target = actorIsPlayer ? 'opponent' : 'player';
    const actorName = actorIsPlayer ? playerName : opponentName;
    const targetName = actorIsPlayer ? opponentName : playerName;
    const effects = [];
    let description = '';
    let title = '';
    let damage = formatNumber(entry.damage);
    let heal = formatNumber(entry.heal);
    const dodged = !!entry.dodged;

    if (dodged) {
      title = `第${roundNumber}回合 · 身法化解`;
      description = `${targetName} 看穿了 ${actorName} 的出手，轻巧闪避。`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else {
      const skillName = actorIsPlayer
        ? PLAYER_SKILL_ROTATION[playerSkillIndex % PLAYER_SKILL_ROTATION.length]
        : OPPONENT_SKILL_ROTATION[opponentSkillIndex % OPPONENT_SKILL_ROTATION.length];
      if (actorIsPlayer) {
        playerSkillIndex += 1;
      } else {
        opponentSkillIndex += 1;
      }
      title = `第${roundNumber}回合 · ${skillName}`;
      description = `${actorName} 施展「${skillName}」，对 ${targetName} 造成 ${damage} 点伤害`;
      if (entry.crit) {
        effects.push({ type: 'crit', label: '暴击' });
        description += '（暴击）';
      }
      description += '。';
    }

    if (heal > 0) {
      const healLabel = actorIsPlayer ? '灵息护体' : '嗜血之力';
      effects.push({ type: 'heal', label: '回复' });
      description += ` ${actorName} 的${healLabel}效果触发，恢复 ${heal} 点生命。`;
    }

    if (!dodged) {
      const remaining = clamp(toNumber(entry.targetRemainingHp, target === 'player' ? playerHp : opponentHp), 0, target === 'player' ? playerMaxHp : opponentMaxHp);
      if (target === 'player') {
        playerHp = remaining;
      } else {
        opponentHp = remaining;
      }
    }
    if (heal > 0) {
      if (actor === 'player') {
        playerHp = clamp(playerHp + heal, 0, playerMaxHp);
      } else {
        opponentHp = clamp(opponentHp + heal, 0, opponentMaxHp);
      }
    }

    const hp = {
      player: buildHpState(playerMaxHp, playerHp),
      opponent: buildHpState(opponentMaxHp, opponentHp)
    };

    return {
      id: `pvp-${index}`,
      round: roundNumber,
      actor,
      target,
      type: dodged ? 'dodge' : 'attack',
      damage,
      heal,
      description,
      title,
      effects,
      hp,
      raw: entry
    };
  });

  const hp = {
    player: buildHpState(playerMaxHp, toNumber(battle.player && battle.player.remainingHp, playerHp)),
    opponent: buildHpState(opponentMaxHp, toNumber(battle.opponent && battle.opponent.remainingHp, opponentHp))
  };

  actions.push({
    id: 'pvp-result',
    round: actions.length ? actions[actions.length - 1].round : 1,
    actor: battle.draw ? 'neutral' : battle.winnerId === playerId ? 'player' : 'opponent',
    target: 'neutral',
    type: 'result',
    damage: 0,
    heal: 0,
    title: battle.draw ? '战斗结果 · 平局' : battle.winnerId === playerId ? '战斗结果 · 胜利' : '战斗结果 · 惜败',
    description: battle.draw
      ? '双方斗得难分难解，本场切磋以平局收场。'
      : battle.winnerId === playerId
      ? '你技高一筹，成功拿下这场比武。'
      : '对手更胜一筹，继续修炼再战。',
    effects: [],
    hp
  });

  return {
    player: {
      id: playerId || 'player',
      name: playerName,
      hp: buildHpState(playerMaxHp, playerMaxHp),
      portrait: resolvePortrait(context && context.playerPortrait, DEFAULT_PLAYER_IMAGE),
      combatPower: toNumber(context && context.playerPower),
      summary: {
        damageDealt: rounds.reduce((total, entry) => (entry.actorId === playerId ? total + formatNumber(entry.damage) : total), 0),
        damageTaken: rounds.reduce((total, entry) => (entry.targetId === playerId ? total + formatNumber(entry.damage) : total), 0),
        heal: rounds.reduce((total, entry) => (entry.actorId === playerId ? total + formatNumber(entry.heal) : total), 0)
      }
    },
    opponent: {
      id: opponentId || 'opponent',
      name: opponentName,
      hp: buildHpState(opponentMaxHp, opponentMaxHp),
      portrait: resolvePortrait(context && context.opponentPortrait, DEFAULT_OPPONENT_IMAGE),
      combatPower: toNumber(context && context.opponentPower),
      summary: {
        damageDealt: rounds.reduce((total, entry) => (entry.actorId === opponentId ? total + formatNumber(entry.damage) : total), 0),
        damageTaken: rounds.reduce((total, entry) => (entry.targetId === opponentId ? total + formatNumber(entry.damage) : total), 0),
        heal: rounds.reduce((total, entry) => (entry.actorId === opponentId ? total + formatNumber(entry.heal) : total), 0)
      }
    },
    actions,
    backgroundVideo: context && context.backgroundVideo ? context.backgroundVideo : DEFAULT_BACKGROUND_VIDEO,
    result: {
      victory: !!(!battle.draw && battle.winnerId === playerId),
      draw: !!battle.draw,
      rounds: actions.length,
      rewards: null
    }
  };
}

function createBattleViewModel({ mode = 'pve', battle = {}, context = {} } = {}) {
  if (mode === 'pvp') {
    return buildPvpActions(battle, context);
  }
  return buildPveActions(battle, context);
}

module.exports = {
  createBattleViewModel,
  buildPveActions,
  buildPvpActions,
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_PLAYER_IMAGE,
  DEFAULT_OPPONENT_IMAGE
};
