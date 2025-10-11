import { PveService, PvpService } from '../../services/api';
import { buildAvatarUrlById } from '../../utils/avatar-catalog';

const {
  resolveBackgroundById,
  resolveHighestUnlockedBackgroundByRealmOrder,
  getDefaultBackgroundId
} = require('../../shared/backgrounds.js');
const { CHARACTER_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');

const DEFAULT_PLAYER_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/male-b-1.png`;
const DEFAULT_OPPONENT_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/male-b-2.png`;
const DEFAULT_MAX_HP = 1200;
const MIN_EVENT_DURATION = 1200;
const MIN_PLAY_SECONDS = 10;

function clamp(value, min, max) {
  if (value == null || Number.isNaN(Number(value))) {
    return min;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function computeHpPercent(hp, maxHp) {
  if (!maxHp || maxHp <= 0) {
    return 0;
  }
  return clamp(Math.round((Math.max(0, hp) / maxHp) * 100), 0, 100);
}

function resolveAvatarImage(source, fallbackImage) {
  if (!source) {
    return fallbackImage;
  }
  const direct = source.avatarUrl || source.imageUrl || source.image || source.portrait;
  if (direct) {
    return direct;
  }
  let avatarId = '';
  if (typeof source.avatarId === 'string' && source.avatarId.trim()) {
    avatarId = source.avatarId.trim();
  } else if (source.memberSnapshot && typeof source.memberSnapshot.avatarId === 'string') {
    avatarId = source.memberSnapshot.avatarId.trim();
  } else if (source.appearance && typeof source.appearance.avatarId === 'string') {
    avatarId = source.appearance.avatarId.trim();
  } else if (source.avatar && typeof source.avatar.id === 'string') {
    avatarId = source.avatar.id.trim();
  }
  if (avatarId) {
    const url = buildAvatarUrlById(avatarId);
    if (url) {
      return url;
    }
    return `${CHARACTER_IMAGE_BASE_PATH}/${avatarId}.png`;
  }
  if (source.gender === 'female' || (source.profile && source.profile.gender === 'female')) {
    return `${CHARACTER_IMAGE_BASE_PATH}/female-b-1.png`;
  }
  return fallbackImage;
}

function resolveStatValue(stats, special, key) {
  if (stats && Object.prototype.hasOwnProperty.call(stats, key)) {
    return stats[key];
  }
  if (special && Object.prototype.hasOwnProperty.call(special, key)) {
    return special[key];
  }
  return null;
}

function formatStatValue(key, value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'number') {
    if (key.toLowerCase().includes('chance') || key.toLowerCase().includes('rate')) {
      return `${Math.round(value * 100)}%`;
    }
    if (key.toLowerCase().includes('multiplier')) {
      return `${Math.round(value * 100)}%`;
    }
    return `${Math.round(value)}`;
  }
  return `${value}`;
}

function buildAttributeList(actor) {
  const stats = actor.stats || {};
  const special = actor.special || {};
  const attributes = [];
  const entries = [
    ['attack', '攻击'],
    ['power', '灵力'],
    ['bonusDamage', '额外伤害'],
    ['defense', '防御'],
    ['resistance', '抗性'],
    ['speed', '速度'],
    ['agility', '身法'],
    ['accuracy', '命中'],
    ['dodge', '闪避'],
    ['critChance', '暴击'],
    ['crit', '暴击'],
    ['critDamage', '暴击伤害'],
    ['block', '格挡'],
    ['shield', '护盾']
  ];
  const used = new Set();
  entries.forEach(([key, label]) => {
    if (used.has(label)) {
      return;
    }
    const value = resolveStatValue(stats, special, key);
    if (value == null) {
      return;
    }
    const formatted = formatStatValue(key, value);
    if (!formatted) {
      return;
    }
    used.add(label);
    attributes.push({ label, value: formatted });
  });
  return attributes;
}

function normalizeActor(source = {}, defaults = {}) {
  const actor = {
    id: source.memberId || source.id || defaults.id || '',
    name: source.displayName || source.name || defaults.name || '神秘修者',
    title: source.tierName || source.rankName || source.title || '',
    realm: source.realmName || (source.realm && source.realm.name) || '',
    stats: source.stats || source.combatStats || source.attributes || {},
    special: source.special || {},
    buffs: Array.isArray(source.buffs) ? source.buffs : [],
    debuffs: Array.isArray(source.debuffs) ? source.debuffs : [],
    passives: Array.isArray(source.passives) ? source.passives : [],
    avatarUrl: source.avatarUrl || '',
    avatarId: source.avatarId || '',
    maxHp:
      Number(source.maxHp || source.hpMax || (source.stats && source.stats.maxHp) || source.remainingHp || 0) ||
      defaults.defaultMaxHp ||
      0,
    remainingHp: Number(source.remainingHp || source.hp || source.hpAfter || 0) || 0,
    image: resolveAvatarImage(source, defaults.fallbackImage || DEFAULT_PLAYER_IMAGE)
  };
  if (!actor.maxHp || actor.maxHp <= 0) {
    actor.maxHp = defaults.defaultMaxHp || DEFAULT_MAX_HP;
  }
  if (!actor.remainingHp || actor.remainingHp <= 0) {
    actor.remainingHp = actor.maxHp;
  }
  actor.attributes = buildAttributeList(actor);
  actor.hp = actor.maxHp;
  actor.hpPercent = 100;
  actor.animation = '';
  return actor;
}

function buildEffectTexts(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item) => {
      if (!item) {
        return '';
      }
      if (typeof item === 'string') {
        return item;
      }
      if (item.label) {
        return item.label;
      }
      if (item.name && item.effect) {
        return `${item.name}${item.effect}`;
      }
      if (item.name) {
        return item.name;
      }
      if (item.description) {
        return item.description;
      }
      if (item.effect) {
        return item.effect;
      }
      return '';
    })
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => text.trim());
}

function buildEventTags(event) {
  const tags = [];
  if (event.crit) {
    tags.push('暴击');
  }
  if (event.dodged) {
    tags.push('闪避');
  }
  if (event.skillType === 'ultimate') {
    tags.push('绝技');
  }
  if (event.skillType === 'passive') {
    tags.push('被动触发');
  }
  if (event.type === 'heal') {
    tags.push('治疗');
  }
  return tags;
}

function buildEventDescription({
  actorName,
  targetName,
  skillName,
  damage,
  heal,
  dodged,
  crit,
  buffs,
  debuffs,
  passives
}) {
  const segments = [];
  if (skillName) {
    segments.push(`${actorName}使用${skillName}`);
  } else {
    segments.push(`${actorName}发动攻击`);
  }
  if (dodged) {
    segments.push(`${targetName}成功闪避`);
  } else {
    if (damage > 0) {
      segments.push(`对${targetName}造成${damage}点伤害`);
    } else {
      segments.push('未造成伤害');
    }
    if (crit) {
      segments.push('引发暴击');
    }
  }
  if (heal > 0) {
    segments.push(`并回复${heal}点生命`);
  }
  if (passives && passives.length) {
    segments.push(`被动生效：${passives.join('、')}`);
  }
  if (buffs && buffs.length) {
    segments.push(`附加增益：${buffs.join('、')}`);
  }
  if (debuffs && debuffs.length) {
    segments.push(`施加减益：${debuffs.join('、')}`);
  }
  return segments.join('，');
}

function ensureMinimumDuration(events, minSeconds) {
  if (!Array.isArray(events) || !events.length) {
    return;
  }
  if (!minSeconds || minSeconds <= 0) {
    return;
  }
  const required = minSeconds * 1000;
  const total = events.reduce((sum, event) => sum + (event.duration || MIN_EVENT_DURATION), 0);
  if (total >= required) {
    return;
  }
  const diff = required - total;
  events[events.length - 1].duration = (events[events.length - 1].duration || MIN_EVENT_DURATION) + diff;
}

function resolveBattleBackground(payload, player) {
  const profile = payload.playerProfile || payload.profile || {};
  let backgroundId = '';
  if (profile.appearance && profile.appearance.backgroundId) {
    backgroundId = profile.appearance.backgroundId;
  } else if (typeof profile.backgroundId === 'string') {
    backgroundId = profile.backgroundId;
  } else if (profile.secretRealm && profile.secretRealm.backgroundId) {
    backgroundId = profile.secretRealm.backgroundId;
  }
  let background = null;
  if (backgroundId) {
    background = resolveBackgroundById(backgroundId);
  }
  if (!background) {
    const realmOrder =
      profile.realmOrder ||
      (profile.attributes && profile.attributes.realmOrder) ||
      (profile.realm && profile.realm.order) ||
      (player && player.stats && player.stats.realmOrder) ||
      1;
    background = resolveHighestUnlockedBackgroundByRealmOrder(realmOrder);
  }
  if (!background) {
    background = resolveBackgroundById(getDefaultBackgroundId());
  }
  if (!background) {
    return { image: '', video: '' };
  }
  return { image: background.image || '', video: background.video || '' };
}

function resolveActorRole(actorId, context) {
  if (!actorId) {
    return '';
  }
  const normalized = String(actorId);
  if (context.player.id && String(context.player.id) === normalized) {
    return 'player';
  }
  if (context.opponent.id && String(context.opponent.id) === normalized) {
    return 'opponent';
  }
  return '';
}

function normalizeStructuredRounds(rounds, context) {
  const events = [];
  rounds.forEach((round, index) => {
    if (!round || typeof round !== 'object') {
      return;
    }
    const actorRole = round.actorRole || resolveActorRole(round.actorId, context);
    const targetRole = actorRole === 'player' ? 'opponent' : 'player';
    if (actorRole !== 'player' && actorRole !== 'opponent') {
      return;
    }
    const actorState = context.state[actorRole];
    const targetState = context.state[targetRole];
    const damage = Math.max(0, Math.round(Number(round.damage || 0)));
    const heal = Math.max(0, Math.round(Number(round.heal || 0)));
    const dodged = round.dodged === true;
    const crit = round.crit === true;
    let targetAfter = targetState.hp;
    if (round.targetRemainingHp != null) {
      targetAfter = Math.max(0, Math.round(Number(round.targetRemainingHp)));
    } else if (!dodged) {
      targetAfter = Math.max(0, targetState.hp - damage);
    }
    let actorAfter = actorState.hp;
    if (round.actorRemainingHp != null) {
      actorAfter = Math.max(0, Math.round(Number(round.actorRemainingHp)));
    } else if (heal > 0) {
      actorAfter = Math.min(actorState.maxHp, actorState.hp + heal);
    }
    const buffs = buildEffectTexts(round.buffsApplied || round.buffs || []);
    const debuffs = buildEffectTexts(round.debuffsApplied || round.debuffs || []);
    const passives = buildEffectTexts(round.passives || round.passiveTriggers || []);
    const event = {
      id: `round-${index}`,
      index,
      round: round.round || index + 1,
      actorRole,
      actorName: actorRole === 'player' ? context.player.name : context.opponent.name,
      targetName: targetRole === 'player' ? context.player.name : context.opponent.name,
      skillName:
        round.skillName ||
        (round.skill && round.skill.name) ||
        (round.skill && round.skill.label) ||
        (round.type === 'skill' ? '战技释放' : '普通攻击'),
      skillType: round.skillType || round.type || '',
      description: buildEventDescription({
        actorName: actorRole === 'player' ? context.player.name : context.opponent.name,
        targetName: targetRole === 'player' ? context.player.name : context.opponent.name,
        skillName:
          round.skillName ||
          (round.skill && (round.skill.name || round.skill.label)) ||
          (round.type === 'skill' ? '战技释放' : '普通攻击'),
        damage,
        heal,
        dodged,
        crit,
        buffs,
        debuffs,
        passives
      }),
      damage,
      heal,
      crit,
      dodged,
      buffs,
      debuffs,
      passives,
      tags: buildEventTags({
        crit,
        dodged,
        type: round.type,
        skillType: round.skillType
      }),
      actorHp: { before: actorState.hp, after: actorAfter, max: actorState.maxHp },
      targetHp: { before: targetState.hp, after: targetAfter, max: targetState.maxHp },
      damageText: damage ? `伤害 -${damage}` : '',
      healText: heal ? `治疗 +${heal}` : '',
      duration: Math.max(MIN_EVENT_DURATION, Number(round.duration) || MIN_EVENT_DURATION),
      type: round.type || (round.skillName ? 'skill' : 'attack')
    };
    actorState.hp = actorAfter;
    targetState.hp = targetAfter;
    events.push(event);
  });
  return events;
}

function analyzeLogMaxHp(logs, remaining = {}) {
  let playerMax = Number(remaining.playerHp || 0) || 0;
  let opponentMax = Number(remaining.enemyHp || 0) || 0;
  logs.forEach((line) => {
    if (typeof line !== 'string') {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const playerHitMatch = trimmed.match(/你造成\s*(\d+)\s*点伤害.*敌方剩余\s*(\d+)/);
    if (playerHitMatch) {
      const damage = Number(playerHitMatch[1]);
      const remainingHp = Number(playerHitMatch[2]);
      opponentMax = Math.max(opponentMax, damage + remainingHp);
    }
    const enemyHitMatch = trimmed.match(/敌方造成\s*(\d+)\s*点伤害.*你剩余\s*(\d+)/);
    if (enemyHitMatch) {
      const damage = Number(enemyHitMatch[1]);
      const remainingHp = Number(enemyHitMatch[2]);
      playerMax = Math.max(playerMax, damage + remainingHp);
    }
  });
  return { playerMax, opponentMax };
}

function normalizeLogEvents(logs, context, remaining = {}) {
  const events = [];
  const { playerMax, opponentMax } = analyzeLogMaxHp(logs, remaining);
  if (playerMax > context.player.maxHp) {
    context.player.maxHp = playerMax;
  }
  if (opponentMax > context.opponent.maxHp) {
    context.opponent.maxHp = opponentMax;
  }
  context.state.player.maxHp = context.player.maxHp;
  context.state.opponent.maxHp = context.opponent.maxHp;
  context.state.player.hp = context.player.maxHp;
  context.state.opponent.hp = context.opponent.maxHp;
  let currentRound = 1;
  logs.forEach((line, index) => {
    if (typeof line !== 'string') {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const roundMatch = trimmed.match(/^第(\d+)回合/);
    if (roundMatch) {
      currentRound = Number(roundMatch[1]);
    }
    const playerDodgeMatch = trimmed.match(/^第(\d+)回合：敌方闪避了你的攻势/);
    if (playerDodgeMatch) {
      const round = Number(playerDodgeMatch[1]);
      events.push({
        id: `log-${index}`,
        round,
        actorRole: 'player',
        actorName: context.player.name,
        targetName: context.opponent.name,
        skillName: '普通攻击',
        description: trimmed,
        damage: 0,
        heal: 0,
        crit: false,
        dodged: true,
        buffs: [],
        debuffs: [],
        passives: [],
        tags: ['闪避'],
        actorHp: { before: context.state.player.hp, after: context.state.player.hp, max: context.state.player.maxHp },
        targetHp: { before: context.state.opponent.hp, after: context.state.opponent.hp, max: context.state.opponent.maxHp },
        damageText: '',
        healText: '',
        duration: MIN_EVENT_DURATION,
        type: 'attack'
      });
      return;
    }
    const enemyDodgeMatch = trimmed.match(/^第(\d+)回合：你闪避了敌方的攻势/);
    if (enemyDodgeMatch) {
      const round = Number(enemyDodgeMatch[1]);
      events.push({
        id: `log-${index}`,
        round,
        actorRole: 'opponent',
        actorName: context.opponent.name,
        targetName: context.player.name,
        skillName: '普通攻击',
        description: trimmed,
        damage: 0,
        heal: 0,
        crit: false,
        dodged: true,
        buffs: [],
        debuffs: [],
        passives: [],
        tags: ['闪避'],
        actorHp: { before: context.state.opponent.hp, after: context.state.opponent.hp, max: context.state.opponent.maxHp },
        targetHp: { before: context.state.player.hp, after: context.state.player.hp, max: context.state.player.maxHp },
        damageText: '',
        healText: '',
        duration: MIN_EVENT_DURATION,
        type: 'attack'
      });
      return;
    }
    const playerAttackMatch = trimmed.match(/^第(\d+)回合：你造成\s*(\d+)\s*点伤害(（暴击）)?，敌方剩余\s*(\d+)/);
    if (playerAttackMatch) {
      const round = Number(playerAttackMatch[1]);
      const damage = Number(playerAttackMatch[2]);
      const crit = !!playerAttackMatch[3];
      const targetAfter = Number(playerAttackMatch[4]);
      const targetBefore = Math.max(context.state.opponent.hp, targetAfter + damage);
      context.state.opponent.hp = targetAfter;
      context.state.opponent.maxHp = Math.max(context.state.opponent.maxHp, targetBefore);
      events.push({
        id: `log-${index}`,
        round,
        actorRole: 'player',
        actorName: context.player.name,
        targetName: context.opponent.name,
        skillName: '普通攻击',
        description: trimmed,
        damage,
        heal: 0,
        crit,
        dodged: false,
        buffs: [],
        debuffs: [],
        passives: [],
        tags: buildEventTags({ crit, dodged: false, type: 'attack' }),
        actorHp: { before: context.state.player.hp, after: context.state.player.hp, max: context.state.player.maxHp },
        targetHp: { before: targetBefore, after: targetAfter, max: context.state.opponent.maxHp },
        damageText: `伤害 -${damage}`,
        healText: '',
        duration: MIN_EVENT_DURATION,
        type: 'attack'
      });
      return;
    }
    const enemyAttackMatch = trimmed.match(/^第(\d+)回合：敌方造成\s*(\d+)\s*点伤害(（暴击）)?，你剩余\s*(\d+)/);
    if (enemyAttackMatch) {
      const round = Number(enemyAttackMatch[1]);
      const damage = Number(enemyAttackMatch[2]);
      const crit = !!enemyAttackMatch[3];
      const targetAfter = Number(enemyAttackMatch[4]);
      const targetBefore = Math.max(context.state.player.hp, targetAfter + damage);
      context.state.player.hp = targetAfter;
      context.state.player.maxHp = Math.max(context.state.player.maxHp, targetBefore);
      events.push({
        id: `log-${index}`,
        round,
        actorRole: 'opponent',
        actorName: context.opponent.name,
        targetName: context.player.name,
        skillName: '普通攻击',
        description: trimmed,
        damage,
        heal: 0,
        crit,
        dodged: false,
        buffs: [],
        debuffs: [],
        passives: [],
        tags: buildEventTags({ crit, dodged: false, type: 'attack' }),
        actorHp: { before: context.state.opponent.hp, after: context.state.opponent.hp, max: context.state.opponent.maxHp },
        targetHp: { before: targetBefore, after: targetAfter, max: context.state.player.maxHp },
        damageText: `伤害 -${damage}`,
        healText: '',
        duration: MIN_EVENT_DURATION,
        type: 'attack'
      });
      return;
    }
    const playerHealMatch = trimmed.match(/灵血回流，你回复了\s*(\d+)\s*点生命/);
    if (playerHealMatch) {
      const heal = Number(playerHealMatch[1]);
      const before = context.state.player.hp;
      const after = Math.min(context.state.player.maxHp, before + heal);
      context.state.player.hp = after;
      events.push({
        id: `log-${index}`,
        round: currentRound,
        actorRole: 'player',
        actorName: context.player.name,
        targetName: context.player.name,
        skillName: '灵血回流',
        description: trimmed,
        damage: 0,
        heal,
        crit: false,
        dodged: false,
        buffs: [],
        debuffs: [],
        passives: ['灵血回流'],
        tags: ['治疗', '被动触发'],
        actorHp: { before, after, max: context.state.player.maxHp },
        targetHp: { before: context.state.opponent.hp, after: context.state.opponent.hp, max: context.state.opponent.maxHp },
        damageText: '',
        healText: `治疗 +${heal}`,
        duration: MIN_EVENT_DURATION,
        type: 'heal'
      });
      return;
    }
    const enemyHealMatch = trimmed.match(/敌方吸取灵力，回复了\s*(\d+)\s*点生命/);
    if (enemyHealMatch) {
      const heal = Number(enemyHealMatch[1]);
      const before = context.state.opponent.hp;
      const after = Math.min(context.state.opponent.maxHp, before + heal);
      context.state.opponent.hp = after;
      events.push({
        id: `log-${index}`,
        round: currentRound,
        actorRole: 'opponent',
        actorName: context.opponent.name,
        targetName: context.opponent.name,
        skillName: '吸灵回补',
        description: trimmed,
        damage: 0,
        heal,
        crit: false,
        dodged: false,
        buffs: ['吸收灵力'],
        debuffs: [],
        passives: [],
        tags: ['治疗'],
        actorHp: { before, after, max: context.state.opponent.maxHp },
        targetHp: { before: context.state.player.hp, after: context.state.player.hp, max: context.state.player.maxHp },
        damageText: '',
        healText: `治疗 +${heal}`,
        duration: MIN_EVENT_DURATION,
        type: 'heal'
      });
      return;
    }
    events.push({
      id: `log-${index}`,
      round: currentRound,
      actorRole: 'system',
      actorName: '战况播报',
      targetName: '',
      skillName: '',
      description: trimmed,
      damage: 0,
      heal: 0,
      crit: false,
      dodged: false,
      buffs: [],
      debuffs: [],
      passives: [],
      tags: [],
      actorHp: { before: context.state.player.hp, after: context.state.player.hp, max: context.state.player.maxHp },
      targetHp: { before: context.state.opponent.hp, after: context.state.opponent.hp, max: context.state.opponent.maxHp },
      damageText: '',
      healText: '',
      duration: 800,
      type: 'info'
    });
  });
  return events;
}

function normalizeGenericTimeline(timeline, context) {
  const events = [];
  timeline.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const actorRole = entry.actorRole || resolveActorRole(entry.actorId, context) || entry.side;
    const targetRole = actorRole === 'player' ? 'opponent' : 'player';
    const actorState = context.state[actorRole] || context.state.player;
    const targetState = context.state[targetRole] || context.state.opponent;
    const damage = Math.max(0, Math.round(Number(entry.damage || entry.damageDealt || 0)));
    const heal = Math.max(0, Math.round(Number(entry.heal || entry.healAmount || 0)));
    const dodged = entry.dodged === true;
    const crit = entry.crit === true;
    let targetAfter = targetState.hp;
    if (entry.targetHpAfter != null) {
      targetAfter = Math.max(0, Math.round(Number(entry.targetHpAfter)));
    } else if (entry.targetHp != null) {
      targetAfter = Math.max(0, Math.round(Number(entry.targetHp)));
    } else if (!dodged) {
      targetAfter = Math.max(0, targetState.hp - damage);
    }
    let actorAfter = actorState.hp;
    if (entry.actorHpAfter != null) {
      actorAfter = Math.max(0, Math.round(Number(entry.actorHpAfter)));
    } else if (entry.actorHp != null) {
      actorAfter = Math.max(0, Math.round(Number(entry.actorHp)));
    } else if (heal > 0) {
      actorAfter = Math.min(actorState.maxHp, actorState.hp + heal);
    }
    const buffs = buildEffectTexts(entry.buffs || entry.buffApplied || entry.buffEffects || []);
    const debuffs = buildEffectTexts(entry.debuffs || entry.debuffApplied || entry.debuffEffects || []);
    const passives = buildEffectTexts(entry.passives || entry.passiveTriggers || []);
    const actorName = actorRole === 'opponent' ? context.opponent.name : context.player.name;
    const targetName = targetRole === 'opponent' ? context.opponent.name : context.player.name;
    events.push({
      id: `timeline-${index}`,
      index,
      round: entry.round || index + 1,
      actorRole: actorRole === 'opponent' ? 'opponent' : 'player',
      actorName,
      targetName,
      skillName: entry.skillName || entry.skill || entry.actionName || '',
      skillType: entry.skillType || entry.type || '',
      description: buildEventDescription({
        actorName,
        targetName,
        skillName: entry.skillName || entry.skill || entry.actionName || '',
        damage,
        heal,
        dodged,
        crit,
        buffs,
        debuffs,
        passives
      }),
      damage,
      heal,
      crit,
      dodged,
      buffs,
      debuffs,
      passives,
      tags: buildEventTags({ crit, dodged, type: entry.type, skillType: entry.skillType }),
      actorHp: { before: actorState.hp, after: actorAfter, max: actorState.maxHp },
      targetHp: { before: targetState.hp, after: targetAfter, max: targetState.maxHp },
      damageText: damage ? `伤害 -${damage}` : '',
      healText: heal ? `治疗 +${heal}` : '',
      duration: Math.max(MIN_EVENT_DURATION, Number(entry.duration) || MIN_EVENT_DURATION),
      type: entry.type || (entry.skillName ? 'skill' : 'attack')
    });
    actorState.hp = actorAfter;
    targetState.hp = targetAfter;
  });
  return events;
}

function buildBattleEvents(payload, context) {
  const battle = payload.battle || {};
  const timeline = Array.isArray(payload.timeline)
    ? payload.timeline
    : Array.isArray(battle.timeline)
    ? battle.timeline
    : null;
  const rounds = Array.isArray(payload.rounds)
    ? payload.rounds
    : Array.isArray(battle.rounds)
    ? battle.rounds
    : null;
  const log = Array.isArray(payload.log)
    ? payload.log
    : Array.isArray(battle.log)
    ? battle.log
    : [];
  const remaining = battle.remaining || payload.remaining || {};
  if (timeline && timeline.length) {
    return normalizeGenericTimeline(timeline, context);
  }
  if (rounds && rounds.length && typeof rounds[0] === 'object') {
    return normalizeStructuredRounds(rounds, context);
  }
  if (log.length) {
    return normalizeLogEvents(log, context, remaining);
  }
  return [];
}

function buildBattleSummary(payload, context) {
  const battle = payload.battle || payload || {};
  const result = battle.result || {};
  const victory = battle.victory || (!result.draw && result.winnerId && String(result.winnerId) === String(context.player.id));
  const draw = battle.draw || result.draw;
  const title = draw ? '势均力敌' : victory ? '战斗胜利' : '战斗结束';
  const subtitleParts = [];
  const rounds = Array.isArray(battle.rounds) ? battle.rounds.length : battle.rounds;
  if (Number.isFinite(rounds) && rounds > 0) {
    subtitleParts.push(`回合 ${rounds}`);
  }
  if (battle.seed) {
    subtitleParts.push(`种子 ${battle.seed}`);
  }
  const highlights = [];
  if (battle.rewards) {
    if (battle.rewards.stones) {
      highlights.push({ label: '灵石', value: `${battle.rewards.stones}` });
    }
    if (battle.rewards.attributePoints) {
      highlights.push({ label: '属性点', value: `${battle.rewards.attributePoints}` });
    }
    if (Array.isArray(battle.rewards.loot) && battle.rewards.loot.length) {
      highlights.push({ label: '战利品', value: battle.rewards.loot.map((item) => item.name || item.type || '奖励').join('、') });
    }
  }
  if (battle.remaining) {
    if (battle.remaining.playerHp != null) {
      highlights.push({ label: context.player.name, value: `${battle.remaining.playerHp}/${context.player.maxHp}` });
    }
    if (battle.remaining.enemyHp != null) {
      highlights.push({ label: context.opponent.name, value: `${battle.remaining.enemyHp}/${context.opponent.maxHp}` });
    }
  }
  if (battle.player && battle.player.damageDealt != null) {
    highlights.push({ label: `${context.player.name}输出`, value: `${battle.player.damageDealt}` });
  }
  if (battle.opponent && battle.opponent.damageDealt != null) {
    highlights.push({ label: `${context.opponent.name}输出`, value: `${battle.opponent.damageDealt}` });
  }
  return {
    title,
    subtitle: subtitleParts.join(' · '),
    highlights
  };
}

function transformBattlePayload(payload = {}, options = {}) {
  const battle = payload.battle || payload;
  const playbackMode = options.playbackMode || 'live';
  const playerSource =
    payload.playerProfile ||
    payload.player ||
    battle.player ||
    (payload.profile && payload.profile.combatSnapshot) ||
    {};
  const opponentSource =
    payload.opponentProfile ||
    payload.opponent ||
    payload.enemy ||
    battle.opponent ||
    {};
  const player = normalizeActor(playerSource, {
    id: 'player',
    name: playerSource.displayName || '主角',
    fallbackImage: DEFAULT_PLAYER_IMAGE,
    defaultMaxHp: DEFAULT_MAX_HP
  });
  const opponent = normalizeActor(opponentSource, {
    id: 'opponent',
    name: opponentSource.displayName || opponentSource.name || '对手',
    fallbackImage: DEFAULT_OPPONENT_IMAGE,
    defaultMaxHp: DEFAULT_MAX_HP
  });
  const context = {
    player,
    opponent,
    state: {
      player: { hp: player.maxHp, maxHp: player.maxHp },
      opponent: { hp: opponent.maxHp, maxHp: opponent.maxHp }
    }
  };
  const events = buildBattleEvents({
    battle,
    timeline: payload.timeline,
    rounds: payload.rounds,
    log: payload.log,
    remaining: payload.remaining
  }, context);
  ensureMinimumDuration(events, playbackMode === 'replay' ? 0 : MIN_PLAY_SECONDS);
  const background = resolveBattleBackground(payload, player);
  const summary = buildBattleSummary({
    battle,
    remaining: payload.remaining
  }, context);
  return { actors: { player, opponent }, events, background, summary };
}

function buildToastForBattle(payload, { player }) {
  const battle = payload && payload.battle ? payload.battle : payload;
  if (!battle) {
    return null;
  }
  if (battle.draw) {
    return { title: '平局收场', icon: 'success' };
  }
  if (battle.victory || (battle.result && battle.result.winnerId === player.id)) {
    return { title: '战斗胜利', icon: 'success' };
  }
  return { title: '战斗结束', icon: 'success' };
}

Page({
  data: {
    loading: true,
    title: '战斗演武',
    playbackMode: 'live',
    background: { image: '', video: '' },
    statusText: '布置战场中...',
    actors: {
      player: normalizeActor({}, { id: 'player', name: '我方修者', fallbackImage: DEFAULT_PLAYER_IMAGE }),
      opponent: normalizeActor({}, { id: 'opponent', name: '未知对手', fallbackImage: DEFAULT_OPPONENT_IMAGE })
    },
    timeline: [],
    displayedEvents: [],
    currentIndex: -1,
    lastEventId: '',
    skipCountdown: MIN_PLAY_SECONDS,
    canSkip: false,
    summary: null,
    state: 'idle',
    error: ''
  },

  onLoad(options = {}) {
    this.eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    this._countdownTimer = null;
    this._eventTimer = null;
    this._animationTimer = null;
    this._mode = options.mode || 'live';
    this._pendingPayload = null;
    if (this.eventChannel && this.eventChannel.on) {
      this.eventChannel.on('battle:launch', (payload = {}) => {
        this.launchBattle(payload);
      });
      this.eventChannel.on('battle:data', (payload = {}) => {
        this.initializeBattleScene(payload, payload.playbackMode || 'live');
      });
    }
    if (options.matchId) {
      this.loadPvpReplay(options.matchId);
      return;
    }
    if (options.record) {
      try {
        const decoded = decodeURIComponent(options.record);
        const parsed = JSON.parse(decoded);
        this.initializeBattleScene({ ...parsed, playbackMode: 'replay' }, 'replay');
        return;
      } catch (error) {
        console.warn('[battle] failed to parse record from query', error);
      }
    }
    if (!options.matchId && !options.record && !this.eventChannel) {
      this.setData({ loading: false, state: 'error', error: '未获取到战斗数据' });
    }
  },

  onUnload() {
    this.clearEventTimer();
    this.clearCountdown();
    if (this._animationTimer) {
      clearTimeout(this._animationTimer);
      this._animationTimer = null;
    }
  },

  clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  clearEventTimer() {
    if (this._eventTimer) {
      clearTimeout(this._eventTimer);
      this._eventTimer = null;
    }
  },

  launchBattle(payload = {}) {
    const mode = payload.mode || this._mode || 'live';
    this._mode = mode;
    if (mode === 'pve') {
      this.startPveBattle(payload);
      return;
    }
    if (mode === 'pvp') {
      this.startPvpBattle(payload);
      return;
    }
    if (mode === 'pvpReplay' && payload.matchId) {
      this.loadPvpReplay(payload.matchId);
      return;
    }
    if (payload.battle) {
      this.initializeBattleScene(payload, payload.playbackMode || (mode === 'replay' ? 'replay' : 'live'));
    }
  },

  async startPveBattle(payload) {
    const enemyId = payload.enemyId;
    if (!enemyId) {
      this.failAndExit('未找到秘境对手');
      return;
    }
    this.setData({
      loading: true,
      playbackMode: 'live',
      title: '秘境战斗',
      statusText: '秘境演算中...'
    });
    try {
      const result = await PveService.battle(enemyId);
      const scenePayload = {
        mode: 'pve',
        battle: result.battle,
        playerProfile: result.profile,
        enemy: payload.enemy || payload.opponent,
        playbackMode: 'live'
      };
      const toast = buildToastForBattle(result.battle, { player: scenePayload.playerProfile || {} });
      this.initializeBattleScene(scenePayload, 'live');
      if (this.eventChannel && typeof this.eventChannel.emit === 'function') {
        this.eventChannel.emit('battleComplete', {
          mode: 'pve',
          profile: result.profile,
          battle: result.battle,
          toast: toast ? toast.title : '',
          toastIcon: toast ? toast.icon : 'success'
        });
      }
      if (toast && toast.title) {
        wx.showToast({ title: toast.title, icon: toast.icon });
      }
    } catch (error) {
      console.error('[battle] pve battle failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.failAndExit(error.errMsg || '挑战失败');
    }
  },

  async startPvpBattle(payload) {
    const operation = payload.operation || 'random';
    let response = null;
    this.setData({
      loading: true,
      playbackMode: 'live',
      title: '比武战斗',
      statusText: '调度对手中...'
    });
    try {
      if (operation === 'friend' && payload.targetId) {
        response = await PvpService.matchFriend(payload.targetId);
      } else if (operation === 'acceptInvite' && payload.inviteId) {
        response = await PvpService.acceptInvite(payload.inviteId);
      } else {
        response = await PvpService.matchRandom();
      }
      const scenePayload = {
        mode: 'pvp',
        battle: response.battle,
        player: response.profile && response.profile.combatSnapshot ? response.profile.combatSnapshot : response.profile,
        playerProfile: response.profile,
        opponent: response.opponent,
        season: response.season,
        recentMatches: response.recentMatches,
        leaderboardPreview: response.leaderboardPreview,
        leaderboardUpdatedAt: response.leaderboardUpdatedAt,
        playbackMode: 'live'
      };
      this.initializeBattleScene(scenePayload, 'live');
      if (this.eventChannel && typeof this.eventChannel.emit === 'function') {
        const toast = buildToastForBattle(response.battle, {
          player: { id: response.profile ? response.profile.memberId : '' }
        });
        this.eventChannel.emit('battleComplete', {
          mode: 'pvp',
          battle: response.battle,
          profile: response.profile,
          season: response.season,
          recentMatches: response.recentMatches,
          leaderboardPreview: response.leaderboardPreview,
          leaderboardUpdatedAt: response.leaderboardUpdatedAt,
          toast: toast ? toast.title : '',
          toastIcon: toast ? toast.icon : 'success',
          clearChallenge: operation === 'friend',
          clearInvite: operation === 'acceptInvite'
        });
        if (toast && toast.title) {
          wx.showToast({ title: toast.title, icon: toast.icon });
        }
      }
    } catch (error) {
      console.error('[battle] pvp battle failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.failAndExit(error.errMsg || '挑战失败');
    }
  },

  async loadPvpReplay(matchId) {
    this.setData({
      loading: true,
      playbackMode: 'replay',
      title: '战斗回放',
      statusText: '读取战报中...'
    });
    try {
      const result = await PvpService.battleReplay(matchId);
      this.initializeBattleScene(
        {
          mode: 'pvpReplay',
          battle: result,
          player: result.player,
          opponent: result.opponent,
          playbackMode: 'replay'
        },
        'replay'
      );
    } catch (error) {
      console.error('[battle] replay load failed', error);
      wx.showToast({ title: error.errMsg || '战报加载失败', icon: 'none' });
      this.failAndExit(error.errMsg || '战报加载失败');
    }
  },

  startCountdown(seconds) {
    this.clearCountdown();
    if (!seconds || seconds <= 0) {
      this.setData({ skipCountdown: 0, canSkip: true });
      return;
    }
    this.setData({ skipCountdown: seconds, canSkip: false });
    this._countdownTimer = setInterval(() => {
      const next = Math.max(0, this.data.skipCountdown - 1);
      this.setData({ skipCountdown: next, canSkip: next <= 0 });
      if (next <= 0) {
        this.clearCountdown();
      }
    }, 1000);
  },

  scheduleNextEvent() {
    this.clearEventTimer();
    this._eventTimer = setTimeout(() => {
      this.advanceTimeline();
    }, 800);
  },

  advanceTimeline() {
    const { currentIndex, timeline, state } = this.data;
    const nextIndex = currentIndex + 1;
    if (!Array.isArray(timeline) || nextIndex >= timeline.length) {
      this.finishPlayback();
      return;
    }
    const event = timeline[nextIndex];
    this.applyEvent(event);
    this.setData({ currentIndex: nextIndex });
    this.clearEventTimer();
    this._eventTimer = setTimeout(() => {
      this.advanceTimeline();
    }, event.duration || MIN_EVENT_DURATION);
  },

  applyEvent(event = {}) {
    const players = { ...this.data.actors };
    const player = { ...players.player };
    const opponent = { ...players.opponent };
    const actor = event.actorRole === 'opponent' ? opponent : player;
    const target = event.actorRole === 'opponent' ? player : opponent;
    if (event.actorHp && typeof event.actorHp.after !== 'undefined') {
      actor.hp = Math.round(clamp(event.actorHp.after, 0, actor.maxHp));
    }
    if (event.targetHp && typeof event.targetHp.after !== 'undefined') {
      target.hp = Math.round(clamp(event.targetHp.after, 0, target.maxHp));
    }
    actor.hpPercent = computeHpPercent(actor.hp, actor.maxHp);
    target.hpPercent = computeHpPercent(target.hp, target.maxHp);
    const nextEvents = [...this.data.displayedEvents, event];
    const status = event.description || `${event.actorName}发动攻势`;
    this.setData({
      actors: { player, opponent },
      displayedEvents: nextEvents,
      lastEventId: event.id,
      statusText: status,
      state: 'playing'
    });
    this.triggerAnimation(event);
  },

  triggerAnimation(event) {
    if (this._animationTimer) {
      clearTimeout(this._animationTimer);
      this._animationTimer = null;
    }
    const player = { ...this.data.actors.player };
    const opponent = { ...this.data.actors.opponent };
    let playerAnimation = '';
    let opponentAnimation = '';
    if (event.actorRole === 'player') {
      playerAnimation = event.type === 'heal' ? 'heal' : 'attack';
      opponentAnimation = event.dodged ? 'dodge' : event.damage > 0 ? 'hit' : opponent.animation;
    } else if (event.actorRole === 'opponent') {
      opponentAnimation = event.type === 'heal' ? 'heal' : 'attack';
      playerAnimation = event.dodged ? 'dodge' : event.damage > 0 ? 'hit' : player.animation;
    } else {
      playerAnimation = 'focus';
      opponentAnimation = 'focus';
    }
    player.animation = playerAnimation;
    opponent.animation = opponentAnimation;
    this.setData({ actors: { player, opponent } });
    this._animationTimer = setTimeout(() => {
      player.animation = '';
      opponent.animation = '';
      this.setData({ actors: { player, opponent } });
      this._animationTimer = null;
    }, 600);
  },

  finishPlayback() {
    this.clearEventTimer();
    this.setData({ state: 'finished', statusText: '战斗结束' });
  },

  fastForward() {
    if (!this.data.canSkip) {
      return;
    }
    this.clearEventTimer();
    const { timeline, currentIndex } = this.data;
    for (let i = currentIndex + 1; i < timeline.length; i += 1) {
      this.applyEvent(timeline[i]);
    }
    this.finishPlayback();
  },

  handleSkip() {
    if (this.data.state === 'finished') {
      this.handleReturn();
      return;
    }
    if (!this.data.canSkip) {
      return;
    }
    this.fastForward();
  },

  handleReturn() {
    wx.navigateBack({ delta: 1 }).catch(() => {
      wx.switchTab({ url: '/pages/index/index' });
    });
  },

  handleVideoError() {
    this.setData({ statusText: '背景加载异常，已切换备用画面' });
  },

  initializeBattleScene(payload = {}, playbackMode = 'live') {
    const scene = transformBattlePayload(payload, { playbackMode });
    if (!scene.events || !scene.events.length) {
      this.failAndExit('未找到战斗过程');
      return;
    }
    const title = playbackMode === 'replay' ? '战斗回放' : '战斗演武';
    wx.setNavigationBarTitle({ title }).catch(() => {});
    this.setData({
      loading: false,
      title,
      playbackMode,
      background: scene.background,
      actors: scene.actors,
      timeline: scene.events,
      displayedEvents: [],
      currentIndex: -1,
      lastEventId: '',
      summary: scene.summary,
      statusText: '战斗即将开始',
      state: 'playing',
      canSkip: playbackMode === 'replay',
      skipCountdown: playbackMode === 'replay' ? 0 : MIN_PLAY_SECONDS
    });
    this.startCountdown(playbackMode === 'replay' ? 0 : MIN_PLAY_SECONDS);
    this.scheduleNextEvent();
  },

  failAndExit(message) {
    this.setData({ loading: false, state: 'error', error: message || '战斗加载失败' });
    setTimeout(() => {
      wx.navigateBack({ delta: 1 }).catch(() => {
        wx.switchTab({ url: '/pages/index/index' });
      });
    }, 1200);
  }
});
