const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  STONE_TRANSACTIONS: 'stoneTransactions'
};

const MAX_LEVEL = 100;
const MAX_SKILL_SLOTS = 3;
const MAX_BATTLE_HISTORY = 15;
const MAX_SKILL_HISTORY = 30;

const BASE_ATTRIBUTE_GROWTH = {
  hp: { base: 1200, perLevel: 180 },
  attack: { base: 120, perLevel: 12 },
  defense: { base: 80, perLevel: 9 },
  speed: { base: 60, perLevel: 3 },
  luck: { base: 10, perLevel: 1 },
  critRate: { base: 0.05, perLevel: 0.002 },
  critDamage: { base: 1.5, perLevel: 0.015 }
};

let membershipLevelsCache = null;

const ATTRIBUTE_CONFIG = [
  { key: 'hp', label: '气血', type: 'number', step: 45 },
  { key: 'attack', label: '攻击', type: 'number', step: 6 },
  { key: 'defense', label: '防御', type: 'number', step: 6 },
  { key: 'speed', label: '身法', type: 'number', step: 3 },
  { key: 'luck', label: '灵运', type: 'number', step: 2 },
  { key: 'critRate', label: '暴击率', type: 'percentage', step: 0.01 },
  { key: 'critDamage', label: '暴击伤害', type: 'multiplier', step: 0.04 }
];

const RARITY_CONFIG = {
  common: { key: 'common', label: '常见', color: '#9aa4b5', weight: 60 },
  rare: { key: 'rare', label: '稀有', color: '#4ab1a7', weight: 25 },
  epic: { key: 'epic', label: '史诗', color: '#8f65ff', weight: 10 },
  legendary: { key: 'legendary', label: '传说', color: '#ffa940', weight: 5 }
};

const EQUIPMENT_SLOT_LABELS = {
  weapon: '武器',
  armor: '护具',
  accessory: '饰品'
};

const EQUIPMENT_LIBRARY = [
  {
    id: 'novice_sword',
    name: '青竹剑',
    slot: 'weapon',
    rarity: 'common',
    levelRequirement: 1,
    description: '以万年青竹制成的入门木剑，轻巧易上手。',
    stats: { attack: 18, speed: 4 },
    tags: ['入门', '轻灵'],
    refineScale: 0.08
  },
  {
    id: 'spirit_blade',
    name: '灵光剑',
    slot: 'weapon',
    rarity: 'rare',
    levelRequirement: 6,
    description: '由灵矿铸造的利刃，剑身流转灵光，出手凌厉。',
    stats: { attack: 42, critRate: 0.05, speed: 6 },
    tags: ['输出', '暴击'],
    refineScale: 0.09
  },
  {
    id: 'dragonbone_sabre',
    name: '龙骨刀',
    slot: 'weapon',
    rarity: 'epic',
    levelRequirement: 12,
    description: '以远古蛟龙之骨打磨而成，刀啸之间风雷激荡。',
    stats: { attack: 68, critRate: 0.08, critDamage: 0.25 },
    tags: ['爆发', '传奇猎获'],
    refineScale: 0.1
  },
  {
    id: 'apprentice_robe',
    name: '灵纹道袍',
    slot: 'armor',
    rarity: 'common',
    levelRequirement: 1,
    description: '绣有基础灵纹的道袍，可抵挡初阶灵力冲击。',
    stats: { hp: 320, defense: 22 },
    tags: ['护体'],
    refineScale: 0.06
  },
  {
    id: 'starsea_mail',
    name: '星海甲',
    slot: 'armor',
    rarity: 'rare',
    levelRequirement: 7,
    description: '凝聚星辰碎屑炼制而成，能在战斗中缓释星辉。',
    stats: { hp: 520, defense: 40, critRate: 0.02 },
    tags: ['稳固', '星辉护佑'],
    refineScale: 0.07
  },
  {
    id: 'void_silk',
    name: '虚丝羽衣',
    slot: 'armor',
    rarity: 'epic',
    levelRequirement: 14,
    description: '虚空灵蛛吐丝织就，既轻若鸿羽，又可化去钝击。',
    stats: { hp: 720, defense: 55, speed: 8 },
    tags: ['闪避', '轻盈'],
    refineScale: 0.08
  },
  {
    id: 'spirit_ring',
    name: '聚灵戒',
    slot: 'accessory',
    rarity: 'common',
    levelRequirement: 1,
    description: '简易聚灵阵刻印于戒身，辅助修行者凝聚灵气。',
    stats: { attack: 12, luck: 8, critRate: 0.02 },
    tags: ['入门'],
    refineScale: 0.07
  },
  {
    id: 'jade_talisman',
    name: '青霄玉佩',
    slot: 'accessory',
    rarity: 'rare',
    levelRequirement: 8,
    description: '玉佩蕴含青霄雷意，为持有者带来敏锐感知。',
    stats: { defense: 24, luck: 12, critDamage: 0.12 },
    tags: ['暴击', '雷意'],
    refineScale: 0.08
  },
  {
    id: 'phoenix_plume',
    name: '凤羽灵坠',
    slot: 'accessory',
    rarity: 'legendary',
    levelRequirement: 18,
    description: '传闻采自南明离火凤凰的一缕尾羽，可唤醒血脉之力。',
    stats: { attack: 35, speed: 12, critRate: 0.08, critDamage: 0.25 },
    tags: ['传说', '高爆发'],
    refineScale: 0.1
  }
];

const SKILL_LIBRARY = [
  {
    id: 'spirit_surge',
    name: '灵息引',
    rarity: 'common',
    description: '调动灵息贯通四肢，提升攻击与身法。',
    effects: { attackMultiplier: 0.12, speed: 6 },
    levelScaling: { attackMultiplier: 0.04, speed: 2 },
    tags: ['输出', '常驻'],
    maxLevel: 5
  },
  {
    id: 'stone_skin',
    name: '磐石护体',
    rarity: 'common',
    description: '引山岳之力护体，提升防御并获得护盾。',
    effects: { defenseMultiplier: 0.18, shield: 80 },
    levelScaling: { defenseMultiplier: 0.06, shield: 35 },
    tags: ['防御', '护盾'],
    maxLevel: 5
  },
  {
    id: 'aerial_step',
    name: '凌空步',
    rarity: 'rare',
    description: '掌握凌空而行的诀窍，大幅提升身法与气血。',
    effects: { speed: 15, hpMultiplier: 0.08 },
    levelScaling: { speed: 4, hpMultiplier: 0.03 },
    tags: ['身法', '生存'],
    maxLevel: 5
  },
  {
    id: 'thunder_anthem',
    name: '霆鸣决',
    rarity: 'rare',
    description: '以雷霆之势击溃敌人，攻击提升并附带雷击。',
    effects: { attackMultiplier: 0.18, bonusDamage: 50 },
    levelScaling: { attackMultiplier: 0.05, bonusDamage: 22 },
    tags: ['输出', '爆发'],
    maxLevel: 5
  },
  {
    id: 'phoenix_flare',
    name: '朱焰冲霄',
    rarity: 'epic',
    description: '化身朱焰，攻击与暴击伤害大幅提升。',
    effects: { attackMultiplier: 0.28, critDamage: 0.45 },
    levelScaling: { attackMultiplier: 0.07, critDamage: 0.15 },
    tags: ['暴击', '高爆发'],
    maxLevel: 5
  },
  {
    id: 'celestial_barrier',
    name: '星幕结界',
    rarity: 'epic',
    description: '星光化为屏障，为自身提供护盾与暴击率。',
    effects: { shield: 160, defenseMultiplier: 0.22, critRate: 0.05 },
    levelScaling: { shield: 55, defenseMultiplier: 0.05, critRate: 0.02 },
    tags: ['防御', '暴击'],
    maxLevel: 5
  },
  {
    id: 'dragon_roar',
    name: '龙吟破军',
    rarity: 'legendary',
    description: '以龙吟震慑四方，攻击暴涨并附加剧烈震荡。',
    effects: { attackMultiplier: 0.32, critRate: 0.08, bonusDamage: 100 },
    levelScaling: { attackMultiplier: 0.08, critRate: 0.02, bonusDamage: 45 },
    tags: ['传说', '暴击'],
    maxLevel: 5
  },
  {
    id: 'time_dilation',
    name: '御时术',
    rarity: 'legendary',
    description: '暂借时光伟力，提升身法并大幅提高闪避概率。',
    effects: { speed: 20, speedMultiplier: 0.15, dodgeChance: 0.1 },
    levelScaling: { speed: 6, speedMultiplier: 0.04, dodgeChance: 0.02 },
    tags: ['身法', '闪避'],
    maxLevel: 5
  }
];

const ENEMY_LIBRARY = [
  {
    id: 'spirit_sprout',
    name: '灵芽傀儡',
    level: 1,
    description: '由木灵催生的守园傀儡，行动迟缓但防御扎实。',
    stats: { hp: 900, attack: 110, defense: 68, speed: 42, critRate: 0.04, critDamage: 1.5 },
    rewards: { stones: 18, attributePoints: 0 },
    loot: [
      { type: 'equipment', itemId: 'starsea_mail', chance: 0.08 },
      { type: 'skill', skillId: 'aerial_step', chance: 0.06 }
    ]
  },
  {
    id: 'ember_wraith',
    name: '炽火幽灵',
    level: 7,
    description: '灵火凝聚的亡魂，速度极快且攻击灼热。',
    stats: { hp: 1150, attack: 160, defense: 74, speed: 72, critRate: 0.08, critDamage: 1.6 },
    rewards: { stones: 32, attributePoints: 1 },
    loot: [
      { type: 'equipment', itemId: 'spirit_blade', chance: 0.12 },
      { type: 'skill', skillId: 'phoenix_flare', chance: 0.05 }
    ]
  },
  {
    id: 'abyssal_titan',
    name: '渊狱巨灵',
    level: 15,
    description: '行走于渊狱的巨灵，攻击沉重无比，防御如壁。',
    stats: { hp: 1800, attack: 210, defense: 110, speed: 58, critRate: 0.1, critDamage: 1.7 },
    rewards: { stones: 48, attributePoints: 2 },
    loot: [
      { type: 'equipment', itemId: 'dragonbone_sabre', chance: 0.08 },
      { type: 'equipment', itemId: 'void_silk', chance: 0.1 },
      { type: 'skill', skillId: 'dragon_roar', chance: 0.04 }
    ]
  },
  {
    id: 'chronos_weaver',
    name: '缚时织者',
    level: 20,
    description: '掌控时间缝隙的神秘存在，拥有不可思议的闪避能力。',
    stats: { hp: 2000, attack: 230, defense: 120, speed: 90, critRate: 0.12, critDamage: 1.75, dodgeChance: 0.08 },
    rewards: { stones: 66, attributePoints: 3 },
    loot: [
      { type: 'equipment', itemId: 'phoenix_plume', chance: 0.05 },
      { type: 'skill', skillId: 'time_dilation', chance: 0.05 }
    ]
  }
];

const EQUIPMENT_MAP = buildMap(EQUIPMENT_LIBRARY);
const SKILL_MAP = buildMap(SKILL_LIBRARY);
const ENEMY_MAP = buildMap(ENEMY_LIBRARY);

async function loadMembershipLevels() {
  if (membershipLevelsCache && membershipLevelsCache.length) {
    return membershipLevelsCache;
  }
  const snapshot = await db
    .collection('membershipLevels')
    .orderBy('order', 'asc')
    .limit(200)
    .get();
  membershipLevelsCache = Array.isArray(snapshot.data) ? snapshot.data : [];
  return membershipLevelsCache;
}

function sortLevels(levels = []) {
  return [...levels].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function resolveMemberLevelInfo(levels = [], member = {}) {
  const sorted = sortLevels(levels);
  if (!sorted.length) {
    return { sorted, current: null, next: null };
  }
  const levelId = member.levelId || member.level || '';
  let current = sorted.find((level) => level._id === levelId);
  if (!current) {
    current = sorted[0];
  }
  const index = sorted.findIndex((level) => level._id === current._id);
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  return { sorted, current, next, index };
}

function calculateBaseAttributesForLevel(level = 1) {
  const value = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return {
    hp: Math.round(BASE_ATTRIBUTE_GROWTH.hp.base + (value - 1) * BASE_ATTRIBUTE_GROWTH.hp.perLevel),
    attack: Math.round(BASE_ATTRIBUTE_GROWTH.attack.base + (value - 1) * BASE_ATTRIBUTE_GROWTH.attack.perLevel),
    defense: Math.round(BASE_ATTRIBUTE_GROWTH.defense.base + (value - 1) * BASE_ATTRIBUTE_GROWTH.defense.perLevel),
    speed: Math.round(BASE_ATTRIBUTE_GROWTH.speed.base + (value - 1) * BASE_ATTRIBUTE_GROWTH.speed.perLevel),
    luck: Math.round(BASE_ATTRIBUTE_GROWTH.luck.base + (value - 1) * BASE_ATTRIBUTE_GROWTH.luck.perLevel),
    critRate: Number(
      (
        BASE_ATTRIBUTE_GROWTH.critRate.base +
        (value - 1) * BASE_ATTRIBUTE_GROWTH.critRate.perLevel
      ).toFixed(4)
    ),
    critDamage: Number(
      (
        BASE_ATTRIBUTE_GROWTH.critDamage.base +
        (value - 1) * BASE_ATTRIBUTE_GROWTH.critDamage.perLevel
      ).toFixed(2)
    )
  };
}

function areStatsEqual(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    const aValue = Number(a[key]) || 0;
    const bValue = Number(b[key]) || 0;
    if (Math.abs(aValue - bValue) > 0.0001) {
      return false;
    }
  }
  return true;
}

function getAttributePointRewardForLevel(level) {
  const value = Math.max(1, Math.floor(level));
  return 3 + Math.floor(value / 3);
}

function syncAttributesWithMemberLevel(attributes, member, levels) {
  if (!attributes) {
    return false;
  }
  const { sorted, current, next } = resolveMemberLevelInfo(levels, member);
  const levelOrder = current ? current.order || sorted.indexOf(current) + 1 : 1;
  const experience = Math.max(0, Math.floor(Number(member.experience) || 0));
  const baseStats = calculateBaseAttributesForLevel(levelOrder);
  let changed = false;

  const maxLevel = Math.min(MAX_LEVEL, sorted.length || MAX_LEVEL);
  if (attributes.maxLevel !== maxLevel) {
    attributes.maxLevel = maxLevel;
    changed = true;
  }

  if (attributes.level !== levelOrder) {
    attributes.level = levelOrder;
    changed = true;
  }

  if (attributes.experience !== experience) {
    attributes.experience = experience;
    changed = true;
  }

  if (!areStatsEqual(attributes.base, baseStats)) {
    attributes.base = baseStats;
    changed = true;
  } else {
    attributes.base = baseStats;
  }

  const lastSyncedLevel = Math.max(1, Math.floor(Number(attributes.lastSyncedLevel || attributes.level || 1)));
  if (levelOrder > lastSyncedLevel) {
    let bonusPoints = 0;
    for (let lvl = lastSyncedLevel + 1; lvl <= levelOrder; lvl += 1) {
      bonusPoints += getAttributePointRewardForLevel(lvl);
    }
    if (bonusPoints > 0) {
      attributes.attributePoints = (attributes.attributePoints || 0) + bonusPoints;
      changed = true;
    }
  }
  if (attributes.lastSyncedLevel !== levelOrder) {
    attributes.lastSyncedLevel = levelOrder;
    changed = true;
  }

  const levelId = current ? current._id || '' : '';
  if (attributes.levelId !== levelId) {
    attributes.levelId = levelId;
    changed = true;
  }
  const levelLabel = current ? current.displayName || current.name || `第${levelOrder}级` : `第${levelOrder}级`;
  if (attributes.levelLabel !== levelLabel) {
    attributes.levelLabel = levelLabel;
    changed = true;
  }
  if (attributes.levelName !== levelLabel) {
    attributes.levelName = levelLabel;
    changed = true;
  }
  const levelShort = current ? current.name || levelLabel : levelLabel;
  if (attributes.levelShort !== levelShort) {
    attributes.levelShort = levelShort;
    changed = true;
  }
  const realmName = current ? current.realm || '' : '';
  if (attributes.realmName !== realmName) {
    attributes.realmName = realmName;
    changed = true;
  }
  const realmShort = current ? current.realmShort || '' : '';
  if (attributes.realmShort !== realmShort) {
    attributes.realmShort = realmShort;
    changed = true;
  }
  const realmId = current ? current.realmId || '' : '';
  if (attributes.realmId !== realmId) {
    attributes.realmId = realmId;
    changed = true;
  }

  const nextLevelId = next ? next._id || '' : '';
  if (attributes.nextLevelId !== nextLevelId) {
    attributes.nextLevelId = nextLevelId;
    changed = true;
  }
  const nextLevelLabel = next ? next.displayName || next.name || '' : '';
  if (attributes.nextLevelLabel !== nextLevelLabel) {
    attributes.nextLevelLabel = nextLevelLabel;
    changed = true;
  }

  const experienceThreshold = current ? Math.max(0, Math.floor(Number(current.threshold) || 0)) : 0;
  if (attributes.experienceThreshold !== experienceThreshold) {
    attributes.experienceThreshold = experienceThreshold;
    changed = true;
  }
  const nextThreshold = next ? Math.max(0, Math.floor(Number(next.threshold) || 0)) : null;
  if (
    (typeof attributes.nextExperienceThreshold === 'number' ? attributes.nextExperienceThreshold : null) !==
    (nextThreshold === null ? null : nextThreshold)
  ) {
    attributes.nextExperienceThreshold = nextThreshold === null ? null : nextThreshold;
    changed = true;
  }

  return changed;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';

  switch (action) {
    case 'profile':
      return getProfile(OPENID);
    case 'battle':
      return simulateBattle(OPENID, event.enemyId);
    case 'drawSkill':
      return drawSkill(OPENID);
    case 'equipSkill':
      return equipSkill(OPENID, event);
    case 'equipItem':
      return equipItem(OPENID, event);
    case 'allocatePoints':
      return allocatePoints(OPENID, event.allocations || {});
    default:
      throw createError('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }
};

async function getProfile(openid) {
  const member = await ensureMember(openid);
  const levels = await loadMembershipLevels();
  const profile = await ensurePveProfile(openid, member, levels);
  return decorateProfile(member, profile);
}

async function simulateBattle(openid, enemyId) {
  const member = await ensureMember(openid);
  const levels = await loadMembershipLevels();
  const profile = await ensurePveProfile(openid, member, levels);
  const enemy = ENEMY_MAP[enemyId];
  if (!enemy) {
    throw createError('ENEMY_NOT_FOUND', '未找到指定的副本目标');
  }

  const battleSetup = buildBattleSetup(profile, enemy);
  const result = runBattleSimulation(battleSetup);

  const now = new Date();
  const updatedProfile = applyBattleOutcome(profile, result, enemy, now, member, levels);
  const updates = { pveProfile: updatedProfile, updatedAt: now };
  if (result.rewards && result.rewards.stones > 0) {
    updates.stoneBalance = _.inc(result.rewards.stones);
  }

  await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({ data: updates });

  if (result.rewards && result.rewards.stones > 0) {
    await recordStoneTransaction(openid, result, enemy, now).catch(() => {});
  }

  const decorated = decorateProfile(
    { ...member, stoneBalance: (member.stoneBalance || 0) + (result.rewards ? result.rewards.stones : 0) },
    updatedProfile
  );
  return {
    battle: formatBattleResult(result),
    profile: decorated
  };
}

async function drawSkill(openid) {
  const member = await ensureMember(openid);
  const profile = await ensurePveProfile(openid, member);
  const now = new Date();

  const roll = rollSkill();
  const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
  let existing = inventory.find((entry) => entry.skillId === roll.skill.id);
  let isNew = false;
  if (existing) {
    const maxLevel = resolveSkillMaxLevel(roll.skill.id);
    const nextLevel = Math.min(maxLevel, (existing.level || 1) + 1);
    if (nextLevel > (existing.level || 1)) {
      existing.level = nextLevel;
    }
    existing.duplicates = (existing.duplicates || 0) + 1;
    existing.obtainedAt = now;
  } else {
    isNew = true;
    existing = createSkillInventoryEntry(roll.skill.id, now);
    inventory.push(existing);
  }

  profile.skills.drawCount = (profile.skills.drawCount || 0) + 1;
  profile.skills.lastDrawAt = now;
  profile.skillHistory = appendHistory(
    profile.skillHistory,
    {
      type: 'draw',
      createdAt: now,
      detail: {
        skillId: roll.skill.id,
        rarity: roll.skill.rarity,
        level: existing.level,
        isNew
      }
    },
    MAX_SKILL_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({
    data: {
      pveProfile: profile,
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  const decoratedSkill = decorateSkillInventoryEntry(existing, profile);
  return {
    acquiredSkill: {
      ...decoratedSkill,
      isNew,
      rarity: roll.skill.rarity,
      rarityLabel: resolveRarityLabel(roll.skill.rarity),
      rarityColor: resolveRarityColor(roll.skill.rarity)
    },
    profile: decorated
  };
}

async function equipSkill(openid, event) {
  const { skillId, slot } = event;
  const member = await ensureMember(openid);
  const profile = await ensurePveProfile(openid, member);
  const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
  const equipped = Array.isArray(profile.skills.equipped) ? [...profile.skills.equipped] : [];

  if (skillId) {
    const hasSkill = inventory.some((entry) => entry.skillId === skillId);
    if (!hasSkill) {
      throw createError('SKILL_NOT_OWNED', '尚未拥有该技能，无法装备');
    }
  }

  if (typeof slot === 'number' && slot >= 0 && slot < MAX_SKILL_SLOTS) {
    if (skillId) {
      equipped[slot] = skillId;
    } else {
      equipped[slot] = '';
    }
  } else if (skillId) {
    if (!equipped.includes(skillId)) {
      if (equipped.length >= MAX_SKILL_SLOTS) {
        throw createError('SKILL_SLOT_FULL', `最多装备 ${MAX_SKILL_SLOTS} 个技能`);
      }
      equipped.push(skillId);
    }
  }

  const normalizedEquipped = equipped
    .filter((id, index) => typeof id === 'string' && id && equipped.indexOf(id) === index && SKILL_MAP[id])
    .slice(0, MAX_SKILL_SLOTS);
  while (normalizedEquipped.length < MAX_SKILL_SLOTS) {
    normalizedEquipped.push('');
  }

  profile.skills.equipped = normalizedEquipped;
  const now = new Date();
  profile.skillHistory = appendHistory(
    profile.skillHistory,
    {
      type: 'equip',
      createdAt: now,
      detail: { skillId, slot: typeof slot === 'number' ? slot : null }
    },
    MAX_SKILL_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({
    data: {
      pveProfile: profile,
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function equipItem(openid, event) {
  const { itemId } = event;
  const member = await ensureMember(openid);
  const profile = await ensurePveProfile(openid, member);
  const inventory = Array.isArray(profile.equipment.inventory) ? profile.equipment.inventory : [];
  const slots = profile.equipment.slots || {};

  if (!itemId) {
    throw createError('ITEM_REQUIRED', '请选择要装备的装备');
  }
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    throw createError('ITEM_NOT_FOUND', '装备不存在');
  }
  const hasItem = inventory.some((entry) => entry.itemId === itemId);
  if (!hasItem) {
    throw createError('ITEM_NOT_OWNED', '尚未拥有该装备，无法装备');
  }

  slots[definition.slot] = itemId;
  profile.equipment.slots = slots;

  const now = new Date();
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: { itemId, slot: definition.slot }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({
    data: {
      pveProfile: profile,
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function allocatePoints(openid, allocations) {
  const member = await ensureMember(openid);
  const profile = await ensurePveProfile(openid, member);
  const attrs = profile.attributes || {};
  const available = Math.max(0, Math.floor(attrs.attributePoints || 0));
  const sanitized = sanitizeAllocations(allocations);
  const total = Object.values(sanitized).reduce((acc, value) => acc + value, 0);
  if (total <= 0) {
    throw createError('INVALID_ALLOCATION', '请选择要分配的属性点');
  }
  if (total > available) {
    throw createError('ALLOCATION_EXCEEDS', '剩余属性点不足');
  }

  const trained = attrs.trained || {};
  Object.keys(sanitized).forEach((key) => {
    trained[key] = (trained[key] || 0) + sanitized[key] * findAttributeStep(key);
  });

  attrs.trained = trained;
  attrs.attributePoints = available - total;
  profile.attributes = attrs;

  const now = new Date();
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'allocate',
      createdAt: now,
      detail: { allocations: sanitized }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({
    data: {
      pveProfile: profile,
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function ensureMember(openid) {
  const snapshot = await db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw createError('MEMBER_NOT_FOUND', '会员信息不存在，请先完成注册');
  }
  return snapshot.data;
}

async function ensurePveProfile(openid, member, levelCache) {
  const now = new Date();
  let profile = member.pveProfile;
  let changed = false;
  if (!profile || typeof profile !== 'object') {
    profile = buildDefaultProfile(now);
    changed = true;
  } else {
    const normalized = normalizeProfile(profile, now);
    if (JSON.stringify(normalized) !== JSON.stringify(profile)) {
      profile = normalized;
      changed = true;
    } else {
      profile = normalized;
    }
  }

  const levels = Array.isArray(levelCache) ? levelCache : await loadMembershipLevels();
  if (syncAttributesWithMemberLevel(profile.attributes, member, levels)) {
    changed = true;
  }

  if (changed) {
    await db.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: {
        pveProfile: profile,
        updatedAt: now
      }
    });
  }

  return profile;
}
function buildDefaultProfile(now = new Date()) {
  return {
    attributes: buildDefaultAttributes(),
    equipment: buildDefaultEquipment(now),
    skills: buildDefaultSkills(now),
    battleHistory: [],
    skillHistory: []
  };
}

function buildDefaultAttributes() {
  const base = calculateBaseAttributesForLevel(1);
  return {
    level: 1,
    experience: 0,
    attributePoints: 0,
    lastSyncedLevel: 1,
    levelId: '',
    levelLabel: '',
    levelName: '',
    levelShort: '',
    realmId: '',
    realmName: '',
    realmShort: '',
    nextLevelId: '',
    nextLevelLabel: '',
    experienceThreshold: 0,
    nextExperienceThreshold: null,
    maxLevel: MAX_LEVEL,
    base,
    trained: {
      hp: 0,
      attack: 0,
      defense: 0,
      speed: 0,
      luck: 0,
      critRate: 0,
      critDamage: 0
    }
  };
}

function buildDefaultEquipment(now = new Date()) {
  const defaults = ['novice_sword', 'apprentice_robe', 'spirit_ring'];
  const inventory = defaults.map((itemId) => createEquipmentInventoryEntry(itemId, now));
  return {
    inventory,
    slots: {
      weapon: 'novice_sword',
      armor: 'apprentice_robe',
      accessory: 'spirit_ring'
    }
  };
}

function buildDefaultSkills(now = new Date()) {
  const defaultSkill = createSkillInventoryEntry('spirit_surge', now);
  return {
    inventory: [defaultSkill],
    equipped: ['spirit_surge'],
    lastDrawAt: null,
    drawCount: 0
  };
}

function normalizeProfile(profile, now = new Date()) {
  return {
    attributes: normalizeAttributes(profile.attributes),
    equipment: normalizeEquipment(profile.equipment, now),
    skills: normalizeSkills(profile.skills, now),
    battleHistory: normalizeHistory(profile.battleHistory, MAX_BATTLE_HISTORY),
    skillHistory: normalizeHistory(profile.skillHistory, MAX_SKILL_HISTORY)
  };
}

function normalizeAttributes(attributes) {
  const defaults = buildDefaultAttributes();
  const payload = typeof attributes === 'object' && attributes ? attributes : {};
  return {
    level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(payload.level) || defaults.level || 1))),
    experience: Math.max(0, Math.floor(Number(payload.experience) || 0)),
    attributePoints: Math.max(0, Math.floor(Number(payload.attributePoints) || 0)),
    lastSyncedLevel: Math.max(
      1,
      Math.min(
        MAX_LEVEL,
        Math.floor(Number(payload.lastSyncedLevel || payload.level || defaults.lastSyncedLevel || 1))
      )
    ),
    levelId: typeof payload.levelId === 'string' ? payload.levelId : defaults.levelId,
    levelLabel: typeof payload.levelLabel === 'string' ? payload.levelLabel : defaults.levelLabel,
    levelName: typeof payload.levelName === 'string' ? payload.levelName : defaults.levelName,
    levelShort: typeof payload.levelShort === 'string' ? payload.levelShort : defaults.levelShort,
    realmId: typeof payload.realmId === 'string' ? payload.realmId : defaults.realmId,
    realmName: typeof payload.realmName === 'string' ? payload.realmName : defaults.realmName,
    realmShort: typeof payload.realmShort === 'string' ? payload.realmShort : defaults.realmShort,
    nextLevelId: typeof payload.nextLevelId === 'string' ? payload.nextLevelId : defaults.nextLevelId,
    nextLevelLabel: typeof payload.nextLevelLabel === 'string' ? payload.nextLevelLabel : defaults.nextLevelLabel,
    experienceThreshold: Math.max(0, Math.floor(Number(payload.experienceThreshold) || 0)),
    nextExperienceThreshold:
      typeof payload.nextExperienceThreshold === 'number' && !Number.isNaN(payload.nextExperienceThreshold)
        ? Math.max(0, Math.floor(payload.nextExperienceThreshold))
        : null,
    maxLevel: Math.max(
      1,
      Math.min(MAX_LEVEL, Math.floor(Number(payload.maxLevel || defaults.maxLevel || MAX_LEVEL)))
    ),
    base: mergeStats(payload.base, defaults.base),
    trained: mergeStats(payload.trained, defaults.trained)
  };
}

function normalizeEquipment(equipment, now = new Date()) {
  const defaults = buildDefaultEquipment(now);
  const payload = typeof equipment === 'object' && equipment ? equipment : {};
  const inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  const normalizedInventory = [];
  const seen = new Set();
  inventory.forEach((item) => {
    const normalizedItem = normalizeEquipmentInventoryItem(item, now);
    if (normalizedItem && !seen.has(normalizedItem.itemId)) {
      normalizedInventory.push(normalizedItem);
      seen.add(normalizedItem.itemId);
    }
  });
  defaults.inventory.forEach((item) => {
    if (!seen.has(item.itemId)) {
      normalizedInventory.push(item);
      seen.add(item.itemId);
    }
  });

  const slots = { ...defaults.slots };
  const rawSlots = payload.slots || {};
  Object.keys(slots).forEach((slot) => {
    const candidate = typeof rawSlots[slot] === 'string' ? rawSlots[slot] : '';
    if (candidate && EQUIPMENT_MAP[candidate]) {
      slots[slot] = candidate;
      if (!normalizedInventory.find((entry) => entry.itemId === candidate)) {
        normalizedInventory.push(createEquipmentInventoryEntry(candidate, now));
      }
    }
  });

  return { inventory: normalizedInventory, slots };
}

function normalizeSkills(skills, now = new Date()) {
  const defaults = buildDefaultSkills(now);
  const payload = typeof skills === 'object' && skills ? skills : {};
  const rawInventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  const inventory = [];
  const seen = new Set();

  rawInventory.forEach((entry) => {
    const normalizedEntry = normalizeSkillInventoryEntry(entry, now);
    if (normalizedEntry && !seen.has(normalizedEntry.skillId)) {
      inventory.push(normalizedEntry);
      seen.add(normalizedEntry.skillId);
    }
  });

  defaults.inventory.forEach((entry) => {
    if (!seen.has(entry.skillId)) {
      inventory.push(entry);
      seen.add(entry.skillId);
    }
  });

  let equipped = Array.isArray(payload.equipped) ? payload.equipped.filter((id) => typeof id === 'string' && id) : [];
  equipped = equipped.filter((id, index) => SKILL_MAP[id] && equipped.indexOf(id) === index).slice(0, MAX_SKILL_SLOTS);
  if (!equipped.length) {
    equipped = defaults.equipped.slice(0, MAX_SKILL_SLOTS);
  }
  while (equipped.length < MAX_SKILL_SLOTS) {
    equipped.push('');
  }

  equipped = equipped.map((id) => {
    if (id && !inventory.find((entry) => entry.skillId === id)) {
      inventory.push(createSkillInventoryEntry(id, now));
    }
    return id;
  });

  return {
    inventory,
    equipped,
    lastDrawAt: payload.lastDrawAt ? new Date(payload.lastDrawAt) : null,
    drawCount: Math.max(0, Math.floor(Number(payload.drawCount) || defaults.drawCount || 0))
  };
}

function normalizeHistory(history, maxLength) {
  if (!Array.isArray(history)) {
    return [];
  }
  const normalized = history
    .map((entry) => ({
      ...entry,
      createdAt: entry && entry.createdAt ? new Date(entry.createdAt) : new Date()
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return normalized.slice(0, maxLength);
}

function mergeStats(source, defaults) {
  const result = { ...defaults };
  const payload = typeof source === 'object' && source ? source : {};
  Object.keys(result).forEach((key) => {
    if (typeof payload[key] === 'number') {
      result[key] = payload[key];
    } else if (typeof payload[key] === 'string' && payload[key].trim()) {
      const numeric = Number(payload[key]);
      if (!Number.isNaN(numeric)) {
        result[key] = numeric;
      }
    }
  });
  return result;
}

function normalizeEquipmentInventoryItem(item, now = new Date()) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const itemId = item.itemId || item.id || '';
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    return null;
  }
  const level = Math.max(1, Math.floor(Number(item.level) || 1));
  const refine = Math.max(0, Math.floor(Number(item.refine) || 0));
  return {
    itemId,
    rarity: definition.rarity,
    level,
    refine,
    obtainedAt: item.obtainedAt ? new Date(item.obtainedAt) : now,
    favorite: !!item.favorite
  };
}

function normalizeSkillInventoryEntry(entry, now = new Date()) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const skillId = entry.skillId || entry.id || '';
  const definition = SKILL_MAP[skillId];
  if (!definition) {
    return null;
  }
  const maxLevel = resolveSkillMaxLevel(skillId);
  const level = Math.min(maxLevel, Math.max(1, Math.floor(Number(entry.level) || 1)));
  const duplicates = Math.max(0, Math.floor(Number(entry.duplicates) || 0));
  return {
    skillId,
    rarity: definition.rarity,
    level,
    duplicates,
    obtainedAt: entry.obtainedAt ? new Date(entry.obtainedAt) : now,
    favorite: !!entry.favorite
  };
}

function createEquipmentInventoryEntry(itemId, obtainedAt = new Date()) {
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    return null;
  }
  return {
    itemId,
    rarity: definition.rarity,
    level: 1,
    refine: 0,
    obtainedAt,
    favorite: false
  };
}

function createSkillInventoryEntry(skillId, obtainedAt = new Date()) {
  const definition = SKILL_MAP[skillId];
  if (!definition) {
    return null;
  }
  return {
    skillId,
    rarity: definition.rarity,
    level: 1,
    duplicates: 0,
    obtainedAt,
    favorite: false
  };
}
function decorateProfile(member, profile) {
  const { attributes, equipment, skills } = profile;
  const attributeSummary = calculateAttributes(attributes, equipment, skills);
  const equipmentSummary = decorateEquipment(profile);
  const skillsSummary = decorateSkills(profile);
  const enemies = ENEMY_LIBRARY.map((enemy) => decorateEnemy(enemy, attributeSummary.finalStats));
  const battleHistory = decorateBattleHistory(profile.battleHistory, profile);
  const skillHistory = decorateSkillHistory(profile.skillHistory);

  return {
    memberId: member._id || member.id || '',
    attributes: attributeSummary,
    equipment: equipmentSummary,
    skills: skillsSummary,
    enemies,
    battleHistory,
    skillHistory,
    rarityConfig: decorateRarityConfig(),
    metadata: {
      maxSkillSlots: MAX_SKILL_SLOTS,
      maxLevel: attributeSummary.maxLevel || MAX_LEVEL
    }
  };
}

function calculateAttributes(attributes, equipment, skills) {
  const baseConfig = ATTRIBUTE_CONFIG;
  const base = attributes.base || {};
  const trained = attributes.trained || {};

  const combinedBase = {};
  baseConfig.forEach((attr) => {
    combinedBase[attr.key] = (Number(base[attr.key]) || 0) + (Number(trained[attr.key]) || 0);
  });

  const equipmentBonus = sumEquipmentBonuses(equipment);
  const skillEffects = aggregateSkillEffects(skills);
  const finalStats = {};

  baseConfig.forEach((attr) => {
    const key = attr.key;
    const baseValue = combinedBase[key] || 0;
    const equipmentValue = equipmentBonus[key] || 0;
    const skillAdditive = skillEffects.additive[key] || 0;
    const multiplier = skillEffects.multipliers[key] || 1;
    finalStats[key] = formatStatResult(key, (baseValue + equipmentValue + skillAdditive) * multiplier);
  });

  const combatPower = calculateCombatPower(finalStats, skillEffects);

  const experience = Math.max(0, Math.floor(Number(attributes.experience) || 0));
  const level = Math.max(1, Math.floor(Number(attributes.level) || 1));
  const maxLevel = Math.max(
    level,
    Math.min(MAX_LEVEL, Math.floor(Number(attributes.maxLevel || MAX_LEVEL)))
  );
  const experienceThreshold = Math.max(0, Math.floor(Number(attributes.experienceThreshold) || 0));
  const hasNext =
    typeof attributes.nextExperienceThreshold === 'number' &&
    !Number.isNaN(attributes.nextExperienceThreshold);
  const nextThreshold = hasNext
    ? Math.max(0, Math.floor(Number(attributes.nextExperienceThreshold)))
    : null;
  const expForLevel =
    nextThreshold !== null ? Math.max(nextThreshold - experienceThreshold, 0) : 0;
  const expProgress =
    nextThreshold !== null && expForLevel > 0
      ? Math.min(1, Math.max(0, (experience - experienceThreshold) / expForLevel))
      : 1;
  const experienceNeeded =
    nextThreshold !== null ? Math.max(nextThreshold - experience, 0) : 0;
  const nextLevel = nextThreshold !== null ? Math.min(maxLevel, level + 1) : level;
  const levelLabel = attributes.levelLabel || attributes.levelName || `第${level}级`;
  const levelShort = attributes.levelShort || levelLabel;
  const realmName = attributes.realmName || '';
  const realmShort = attributes.realmShort || '';
  const nextLevelLabel = attributes.nextLevelLabel || '';

  return {
    level,
    levelLabel,
    levelName: levelLabel,
    levelShort,
    levelId: attributes.levelId || '',
    realmId: attributes.realmId || '',
    realmName,
    realmShort,
    experience,
    attributePoints: Math.max(0, Math.floor(Number(attributes.attributePoints) || 0)),
    nextLevel,
    nextLevelId: attributes.nextLevelId || '',
    nextLevelLabel,
    nextLevelExp: nextThreshold,
    currentLevelExp: experienceThreshold,
    experienceNeeded,
    experienceProgress: Math.round(expProgress * 100),
    maxLevel,
    combatPower,
    baseTotals: combinedBase,
    equipmentBonus,
    skillBonus: skillEffects.additive,
    skillMultipliers: skillEffects.multipliers,
    skillSummary: {
      shield: skillEffects.shield,
      bonusDamage: skillEffects.bonusDamage,
      dodgeChance: skillEffects.dodgeChance
    },
    finalStats,
    attributeList: baseConfig.map((attr) => ({
      key: attr.key,
      label: attr.label,
      step: attr.step || 1,
      value: finalStats[attr.key],
      base: combinedBase[attr.key] || 0,
      equipment: equipmentBonus[attr.key] || 0,
      skill: skillEffects.additive[attr.key] || 0,
      type: attr.type,
      formattedValue: formatStatDisplay(attr.key, finalStats[attr.key]),
      formattedBase: formatStatDisplay(attr.key, combinedBase[attr.key] || 0),
      formattedEquipment: formatStatDisplay(attr.key, equipmentBonus[attr.key] || 0, true),
      formattedSkill: formatSkillBonus(attr.key, skillEffects)
    }))
  };
}

function formatSkillBonus(key, skillEffects) {
  const additive = skillEffects.additive[key] || 0;
  const multiplier = skillEffects.multipliers[key] || 1;
  const parts = [];
  if (additive) {
    parts.push(formatStatDisplay(key, additive, true));
  }
  if (multiplier && multiplier !== 1) {
    const delta = multiplier - 1;
    parts.push(`${Math.round(delta * 10000) / 100}%`);
  }
  return parts.join(' / ');
}

function sumEquipmentBonuses(equipment) {
  const result = {
    hp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    luck: 0,
    critRate: 0,
    critDamage: 0
  };
  if (!equipment || typeof equipment !== 'object') {
    return result;
  }
  const slots = equipment.slots || {};
  const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const inventoryMap = inventory.reduce((map, item) => {
    map[item.itemId] = item;
    return map;
  }, {});

  Object.keys(slots).forEach((slot) => {
    const itemId = slots[slot];
    if (!itemId) return;
    const definition = EQUIPMENT_MAP[itemId];
    if (!definition) return;
    const owned = inventoryMap[itemId] || { itemId, refine: 0 };
    const bonus = calculateEquipmentStats(definition, owned.refine || 0);
    Object.keys(bonus).forEach((key) => {
      result[key] = (result[key] || 0) + (bonus[key] || 0);
    });
  });
  return result;
}

function aggregateSkillEffects(skills) {
  const additive = { hp: 0, attack: 0, defense: 0, speed: 0, luck: 0, critRate: 0, critDamage: 0 };
  const multipliers = { hp: 1, attack: 1, defense: 1, speed: 1, luck: 1, critRate: 1, critDamage: 1 };
  let bonusDamage = 0;
  let shield = 0;
  let dodgeChance = 0;

  if (!skills || typeof skills !== 'object') {
    return { additive, multipliers, bonusDamage, shield, dodgeChance };
  }

  const inventory = Array.isArray(skills.inventory) ? skills.inventory : [];
  const equipped = Array.isArray(skills.equipped) ? skills.equipped : [];
  const inventoryMap = inventory.reduce((map, entry) => {
    map[entry.skillId] = entry;
    return map;
  }, {});

  equipped.forEach((skillId) => {
    if (!skillId) return;
    const entry = inventoryMap[skillId] || { skillId, level: 1 };
    const definition = SKILL_MAP[skillId];
    if (!definition) return;
    const effects = resolveSkillEffects(definition, entry.level || 1);
    Object.keys(effects.additive).forEach((key) => {
      additive[key] = (additive[key] || 0) + (effects.additive[key] || 0);
    });
    Object.keys(effects.multipliers).forEach((key) => {
      multipliers[key] = (multipliers[key] || 1) * (effects.multipliers[key] || 1);
    });
    bonusDamage += effects.bonusDamage || 0;
    shield += effects.shield || 0;
    dodgeChance += effects.dodgeChance || 0;
  });

  return { additive, multipliers, bonusDamage, shield, dodgeChance };
}

function calculateEquipmentStats(definition, refine = 0) {
  if (!definition || !definition.stats) {
    return {};
  }
  const multiplier = 1 + Math.max(0, refine) * (definition.refineScale || 0.07);
  const result = {};
  Object.keys(definition.stats).forEach((key) => {
    const baseValue = definition.stats[key];
    if (typeof baseValue !== 'number') return;
    if (key === 'critRate' || key === 'critDamage') {
      result[key] = Number((baseValue * multiplier).toFixed(4));
    } else if (key === 'luck') {
      result[key] = Math.round(baseValue * multiplier);
    } else {
      result[key] = Math.round(baseValue * multiplier);
    }
  });
  return result;
}

function resolveSkillEffects(definition, level = 1) {
  const effects = definition.effects || {};
  const scaling = definition.levelScaling || {};
  const maxLevel = definition.maxLevel || 5;
  const clampedLevel = Math.min(maxLevel, Math.max(1, level));
  const extraLevel = clampedLevel - 1;

  const additive = { hp: 0, attack: 0, defense: 0, speed: 0, luck: 0, critRate: 0, critDamage: 0 };
  const multipliers = { hp: 1, attack: 1, defense: 1, speed: 1, luck: 1, critRate: 1, critDamage: 1 };
  let bonusDamage = 0;
  let shield = 0;
  let dodgeChance = 0;

  Object.keys(effects).forEach((key) => {
    const baseValue = effects[key];
    const scalingValue = scaling[key] || 0;
    const total = baseValue + scalingValue * extraLevel;
    applySkillEffect(additive, multipliers, key, total);
    if (key === 'bonusDamage') {
      bonusDamage += total;
    } else if (key === 'shield') {
      shield += total;
    } else if (key === 'dodgeChance') {
      dodgeChance += total;
    }
  });

  Object.keys(scaling).forEach((key) => {
    if (effects[key]) {
      return;
    }
    const total = (scaling[key] || 0) * extraLevel;
    applySkillEffect(additive, multipliers, key, total);
    if (key === 'bonusDamage') {
      bonusDamage += total;
    } else if (key === 'shield') {
      shield += total;
    } else if (key === 'dodgeChance') {
      dodgeChance += total;
    }
  });

  return { additive, multipliers, bonusDamage, shield, dodgeChance };
}

function applySkillEffect(additive, multipliers, key, value) {
  if (!value) return;
  if (key.endsWith('Multiplier')) {
    const target = key.replace('Multiplier', '');
    multipliers[target] = (multipliers[target] || 1) * (1 + value);
    return;
  }
  if (key === 'critRate' || key === 'critDamage' || key === 'luck') {
    additive[key] = (additive[key] || 0) + value;
    return;
  }
  if (key === 'hp' || key === 'attack' || key === 'defense' || key === 'speed') {
    additive[key] = (additive[key] || 0) + value;
  }
}

function calculateCombatPower(stats, skillEffects) {
  if (!stats) return 0;
  const hp = Number(stats.hp) || 0;
  const attack = Number(stats.attack) || 0;
  const defense = Number(stats.defense) || 0;
  const speed = Number(stats.speed) || 0;
  const luck = Number(stats.luck) || 0;
  const critRate = clamp(Number(stats.critRate) || 0, 0, 1);
  const critDamage = Math.max(1, Number(stats.critDamage) || 1.5);
  const shield = skillEffects.shield || 0;
  const bonusDamage = skillEffects.bonusDamage || 0;
  const dodgeChance = skillEffects.dodgeChance || 0;
  const power =
    hp * 0.4 +
    attack * 2.2 +
    defense * 1.8 +
    speed * 1.5 +
    luck * 1.3 +
    critRate * 400 +
    critDamage * 120 +
    shield * 0.3 +
    bonusDamage * 1.5 +
    dodgeChance * 600;
  return Math.round(power);
}

function decorateEquipment(profile) {
  const equipment = profile.equipment || {};
  const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const slots = equipment.slots || {};
  const list = inventory
    .map((entry) => decorateEquipmentInventoryEntry(entry, slots))
    .filter((item) => !!item);
  const slotDetails = Object.keys(EQUIPMENT_SLOT_LABELS).map((slot) => {
    const itemId = slots[slot];
    const item = list.find((entry) => entry.itemId === itemId);
    return {
      slot,
      slotLabel: EQUIPMENT_SLOT_LABELS[slot],
      item: item || null
    };
  });
  return {
    slots: slotDetails,
    inventory: list
  };
}

function decorateEquipmentInventoryEntry(entry, slots = {}) {
  const definition = EQUIPMENT_MAP[entry.itemId];
  if (!definition) {
    return null;
  }
  const stats = calculateEquipmentStats(definition, entry.refine || 0);
  const statTexts = formatStatsText({ ...stats });
  const equipped = Object.values(slots || {}).includes(entry.itemId);
  return {
    itemId: entry.itemId,
    name: definition.name,
    rarity: definition.rarity,
    rarityLabel: resolveRarityLabel(definition.rarity),
    rarityColor: resolveRarityColor(definition.rarity),
    description: definition.description,
    slot: definition.slot,
    slotLabel: EQUIPMENT_SLOT_LABELS[definition.slot] || '装备',
    stats,
    statsText: statTexts,
    refine: entry.refine || 0,
    refineLabel: entry.refine ? `精炼 +${entry.refine}` : '未精炼',
    levelRequirement: definition.levelRequirement || 1,
    tags: definition.tags || [],
    obtainedAt: entry.obtainedAt,
    obtainedAtText: formatDateTime(entry.obtainedAt),
    equipped
  };
}

function decorateSkills(profile) {
  const skills = profile.skills || {};
  const inventory = Array.isArray(skills.inventory) ? skills.inventory : [];
  const equippedIds = Array.isArray(skills.equipped) ? skills.equipped : [];
  const inventoryList = inventory
    .map((entry) => decorateSkillInventoryEntry(entry, profile))
    .filter((item) => !!item);
  const equipped = equippedIds.map((skillId, index) => {
    const item = inventoryList.find((entry) => entry.skillId === skillId);
    return {
      slot: index,
      skillId,
      detail: item || null
    };
  });

  return {
    inventory: inventoryList,
    equipped,
    lastDrawAt: skills.lastDrawAt,
    lastDrawAtText: formatDateTime(skills.lastDrawAt),
    drawCount: skills.drawCount || 0
  };
}

function decorateSkillInventoryEntry(entry, profile) {
  if (!entry) {
    return null;
  }
  const definition = SKILL_MAP[entry.skillId];
  if (!definition) {
    return null;
  }
  const effects = resolveSkillEffects(definition, entry.level || 1);
  return {
    skillId: entry.skillId,
    name: definition.name,
    rarity: definition.rarity,
    rarityLabel: resolveRarityLabel(definition.rarity),
    rarityColor: resolveRarityColor(definition.rarity),
    description: definition.description,
    level: entry.level || 1,
    maxLevel: resolveSkillMaxLevel(entry.skillId),
    effectsSummary: formatStatsText({
      ...effects.additive,
      bonusDamage: effects.bonusDamage,
      shield: effects.shield,
      dodgeChance: effects.dodgeChance
    }),
    tags: definition.tags || [],
    obtainedAt: entry.obtainedAt,
    obtainedAtText: formatDateTime(entry.obtainedAt),
    equipped: Array.isArray(profile.skills && profile.skills.equipped)
      ? profile.skills.equipped.includes(entry.skillId)
      : false
  };
}
function decorateEnemy(enemy, playerStats) {
  const combatPower = calculateCombatPower(enemy.stats, {
    shield: 0,
    bonusDamage: 0,
    dodgeChance: enemy.stats.dodgeChance || 0
  });
  const playerPower = calculateCombatPower(playerStats, { shield: 0, bonusDamage: 0, dodgeChance: 0 });
  const difficulty = resolveDifficultyLabel(playerPower, combatPower);
  const rewards = normalizeDungeonRewards(enemy.rewards);
  return {
    id: enemy.id,
    name: enemy.name,
    description: enemy.description,
    level: enemy.level,
    stats: enemy.stats,
    rewards,
    rewardsText: formatRewardText(rewards),
    loot: decorateEnemyLoot(enemy.loot || []),
    combatPower,
    difficulty,
    recommendedPower: combatPower
  };
}

function normalizeDungeonRewards(rewards = {}) {
  return {
    exp: 0,
    stones: Math.max(0, Math.floor(Number(rewards.stones) || 0)),
    attributePoints: Math.max(0, Math.floor(Number(rewards.attributePoints) || 0))
  };
}

function decorateEnemyLoot(loot) {
  if (!Array.isArray(loot)) {
    return [];
  }
  return loot.map((item) => {
    if (item.type === 'equipment') {
      const definition = EQUIPMENT_MAP[item.itemId];
      return {
        type: 'equipment',
        itemId: item.itemId,
        chance: item.chance,
        label: definition ? definition.name : '装备',
        rarity: definition ? definition.rarity : 'common',
        rarityLabel: definition ? resolveRarityLabel(definition.rarity) : '常见'
      };
    }
    if (item.type === 'skill') {
      const definition = SKILL_MAP[item.skillId];
      return {
        type: 'skill',
        skillId: item.skillId,
        chance: item.chance,
        label: definition ? definition.name : '技能',
        rarity: definition ? definition.rarity : 'common',
        rarityLabel: definition ? resolveRarityLabel(definition.rarity) : '常见'
      };
    }
    return item;
  });
}

function decorateBattleHistory(history, profile) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((entry) => {
    if (entry.type === 'battle') {
      const enemy = ENEMY_MAP[entry.enemyId] || { name: entry.enemyName || '未知对手' };
      return {
        type: 'battle',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        enemyId: entry.enemyId,
        enemyName: enemy.name,
        result: entry.result,
        resultLabel: entry.result === 'win' ? '胜利' : entry.result === 'lose' ? '失利' : '战斗',
        rewards: entry.rewards,
        rewardsText: formatRewardText(entry.rewards),
        rounds: entry.rounds,
        combatPower: entry.combatPower,
        log: entry.log || []
      };
    }
    if (entry.type === 'allocate') {
      return {
        type: 'allocate',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        detail: entry.detail,
        summary: formatAllocationText(entry.detail && entry.detail.allocations)
      };
    }
    if (entry.type === 'equipment-change') {
      const definition = EQUIPMENT_MAP[entry.detail && entry.detail.itemId];
      return {
        type: 'equipment',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        summary: definition ? `${EQUIPMENT_SLOT_LABELS[definition.slot] || '装备'} · ${definition.name}` : '装备变动'
      };
    }
    return {
      ...entry,
      createdAtText: formatDateTime(entry.createdAt)
    };
  });
}

function decorateSkillHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((entry) => {
    if (entry.type === 'draw') {
      const detail = entry.detail || {};
      const skill = SKILL_MAP[detail.skillId] || { name: '未知技能', rarity: 'common' };
      return {
        type: 'draw',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        summary: `${detail.isNew ? '获得' : '升阶'}：${skill.name}（${resolveRarityLabel(skill.rarity)}）`,
        detail
      };
    }
    if (entry.type === 'equip') {
      const detail = entry.detail || {};
      const skill = SKILL_MAP[detail.skillId] || { name: '技能' };
      return {
        type: 'equip',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        summary: detail.skillId ? `装备技能：${skill.name}` : '卸下技能',
        detail
      };
    }
    return {
      ...entry,
      createdAtText: formatDateTime(entry.createdAt)
    };
  });
}

function decorateRarityConfig() {
  return Object.keys(RARITY_CONFIG).map((key) => ({
    key,
    label: RARITY_CONFIG[key].label,
    color: RARITY_CONFIG[key].color,
    weight: RARITY_CONFIG[key].weight
  }));
}

function formatStatsText(stats) {
  if (!stats || typeof stats !== 'object') {
    return [];
  }
  const texts = [];
  Object.keys(stats).forEach((key) => {
    const value = stats[key];
    if (value == null || value === 0) {
      return;
    }
    if (key === 'bonusDamage') {
      texts.push(`额外伤害 +${Math.round(value)}`);
    } else if (key === 'shield') {
      texts.push(`护盾 +${Math.round(value)}`);
    } else if (key === 'dodgeChance') {
      texts.push(`闪避率 +${Math.round(value * 100)}%`);
    } else {
      texts.push(formatStatDisplay(key, value, true));
    }
  });
  return texts;
}
function buildBattleSetup(profile, enemy) {
  const attributes = calculateAttributes(profile.attributes, profile.equipment, profile.skills);
  const playerStats = {
    hp: Number(attributes.finalStats.hp) || 0,
    attack: Number(attributes.finalStats.attack) || 0,
    defense: Number(attributes.finalStats.defense) || 0,
    speed: Number(attributes.finalStats.speed) || 0,
    luck: Number(attributes.finalStats.luck) || 0,
    critRate: clamp(Number(attributes.finalStats.critRate) || 0, 0, 1),
    critDamage: Math.max(1.2, Number(attributes.finalStats.critDamage) || 1.5),
    shield: attributes.skillSummary.shield || 0,
    bonusDamage: attributes.skillSummary.bonusDamage || 0,
    dodgeChance: clamp((attributes.skillSummary.dodgeChance || 0) + Math.min(0.15, attributes.finalStats.luck * 0.001), 0, 0.5)
  };

  const enemyStats = {
    hp: enemy.stats.hp,
    attack: enemy.stats.attack,
    defense: enemy.stats.defense,
    speed: enemy.stats.speed,
    critRate: enemy.stats.critRate || 0.08,
    critDamage: enemy.stats.critDamage || 1.5,
    dodgeChance: clamp(enemy.stats.dodgeChance || 0, 0, 0.4)
  };

  return { player: playerStats, enemy: enemyStats, attributes };
}

function runBattleSimulation({ player, enemy, attributes }) {
  const log = [];
  let playerHp = player.hp + player.shield;
  let enemyHp = enemy.hp;
  let round = 1;
  const maxRounds = 30;
  const playerFirst = player.speed >= enemy.speed;
  let attacker = playerFirst ? 'player' : 'enemy';
  const basePlayerDamage = Math.max(5, player.attack - enemy.defense * 0.35);
  const baseEnemyDamage = Math.max(5, enemy.attack - player.defense * 0.35);

  while (playerHp > 0 && enemyHp > 0 && round <= maxRounds) {
    if (attacker === 'player') {
      const { damage, crit, extra } = calculatePlayerDamage({ player, enemy, basePlayerDamage });
      enemyHp -= damage;
      log.push(
        `第${round}回合：你造成 ${Math.max(0, Math.round(damage))} 点伤害${
          crit ? '（暴击）' : ''
        }，敌方剩余 ${Math.max(0, Math.round(enemyHp))}`
      );
      if (extra) {
        log.push(`灵息共鸣触发，额外震荡伤害 ${Math.round(extra)} 点`);
      }
      attacker = 'enemy';
      if (enemyHp <= 0) {
        break;
      }
    } else {
      const dodged = Math.random() < player.dodgeChance;
      if (dodged) {
        log.push(`第${round}回合：你闪避了敌方的攻势`);
      } else {
        const { damage, crit } = calculateEnemyDamage({ player, enemy, baseEnemyDamage });
        playerHp -= damage;
        log.push(
          `第${round}回合：敌方造成 ${Math.max(0, Math.round(damage))} 点伤害${
            crit ? '（暴击）' : ''
          }，你剩余 ${Math.max(0, Math.round(playerHp))}`
        );
      }
      attacker = 'player';
      round += 1;
    }
  }

  const victory = enemyHp <= 0 && playerHp > 0;
  const draw = !victory && playerHp > 0 && enemyHp > 0;

  const rewards = calculateBattleRewards(attributes, enemy, { victory, draw });

  return {
    victory,
    draw,
    rounds: round,
    log,
    rewards,
    remaining: {
      playerHp: Math.max(0, Math.round(playerHp)),
      enemyHp: Math.max(0, Math.round(enemyHp))
    },
    combatPower: {
      player: attributes.combatPower,
      enemy: calculateCombatPower(enemy, { shield: 0, bonusDamage: 0, dodgeChance: enemy.dodgeChance })
    }
  };
}

function calculatePlayerDamage({ player, enemy, basePlayerDamage }) {
  const variance = 0.85 + Math.random() * 0.3;
  const critChance = clamp(player.critRate + Math.min(0.25, player.luck * 0.0025), 0, 0.85);
  const crit = Math.random() < critChance;
  let damage = basePlayerDamage * variance + player.bonusDamage;
  if (crit) {
    damage *= player.critDamage;
  }
  let extra = 0;
  if (Math.random() < Math.min(0.2, player.luck * 0.002)) {
    extra = Math.max(10, player.attack * 0.2);
    damage += extra;
  }
  damage = Math.max(8, damage);
  return { damage, crit, extra };
}

function calculateEnemyDamage({ player, enemy, baseEnemyDamage }) {
  const variance = 0.9 + Math.random() * 0.25;
  const crit = Math.random() < enemy.critRate;
  let damage = baseEnemyDamage * variance;
  if (crit) {
    damage *= enemy.critDamage;
  }
  damage = Math.max(6, damage);
  return { damage, crit };
}

function calculateBattleRewards(attributes, enemy, { victory, draw }) {
  const rewardConfig = (enemy && enemy.rewards) || {};
  const baseStones = Math.max(0, Math.floor(Number(rewardConfig.stones) || 0));

  if (!victory) {
    return {
      exp: 0,
      stones: draw ? Math.round(baseStones * 0.3) : 0,
      attributePoints: 0,
      loot: []
    };
  }

  const luckBonus = Math.min(0.3, (attributes.finalStats.luck || 0) * 0.003);
  const stones = Math.round(baseStones * (1 + luckBonus / 2));
  const attributePoints = rewardConfig.attributePoints || 0;
  const loot = resolveBattleLoot(enemy.loot || [], attributes.finalStats.luck || 0);
  return { exp: 0, stones, attributePoints, loot };
}

function resolveBattleLoot(loot, luck) {
  if (!Array.isArray(loot) || !loot.length) {
    return [];
  }
  const results = [];
  loot.forEach((item) => {
    const chance = item.chance || 0;
    const luckBonus = Math.min(0.2, luck * 0.0015);
    const roll = Math.random();
    if (roll < chance + luckBonus) {
      if (item.type === 'equipment' && EQUIPMENT_MAP[item.itemId]) {
        results.push({ type: 'equipment', itemId: item.itemId });
      } else if (item.type === 'skill' && SKILL_MAP[item.skillId]) {
        results.push({ type: 'skill', skillId: item.skillId });
      }
    }
  });
  return results;
}

function applyBattleOutcome(profile, result, enemy, now, member, levels = []) {
  const updated = normalizeProfile(profile, now);
  updated.attributes.attributePoints =
    (updated.attributes.attributePoints || 0) + (result.rewards.attributePoints || 0);

  if (Array.isArray(result.rewards.loot)) {
    result.rewards.loot.forEach((item) => {
      if (item.type === 'equipment') {
        ensureEquipmentOwned(updated, item.itemId, now);
      }
      if (item.type === 'skill') {
        ensureSkillOwned(updated, item.skillId, now);
      }
    });
  }

  syncAttributesWithMemberLevel(updated.attributes, member || {}, levels);

  updated.battleHistory = appendHistory(
    updated.battleHistory,
    {
      type: 'battle',
      createdAt: now,
      enemyId: enemy.id,
      enemyName: enemy.name,
      result: result.victory ? 'win' : result.draw ? 'draw' : 'lose',
      rounds: result.rounds,
      rewards: result.rewards,
      log: result.log,
      combatPower: result.combatPower
    },
    MAX_BATTLE_HISTORY
  );

  return updated;
}

function ensureEquipmentOwned(profile, itemId, now) {
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    return;
  }
  profile.equipment = profile.equipment || buildDefaultEquipment(now);
  profile.equipment.inventory = profile.equipment.inventory || [];
  const existing = profile.equipment.inventory.find((entry) => entry.itemId === itemId);
  if (existing) {
    existing.refine = Math.min(10, (existing.refine || 0) + 1);
    existing.obtainedAt = now;
  } else {
    profile.equipment.inventory.push(createEquipmentInventoryEntry(itemId, now));
  }
}

function ensureSkillOwned(profile, skillId, now) {
  const definition = SKILL_MAP[skillId];
  if (!definition) {
    return;
  }
  profile.skills = profile.skills || buildDefaultSkills(now);
  profile.skills.inventory = profile.skills.inventory || [];
  const existing = profile.skills.inventory.find((entry) => entry.skillId === skillId);
  if (existing) {
    const maxLevel = resolveSkillMaxLevel(skillId);
    existing.level = Math.min(maxLevel, (existing.level || 1) + 1);
    existing.duplicates = (existing.duplicates || 0) + 1;
    existing.obtainedAt = now;
  } else {
    profile.skills.inventory.push(createSkillInventoryEntry(skillId, now));
  }
}

async function recordStoneTransaction(openid, result, enemy, now) {
  if (!result.rewards || !result.rewards.stones) {
    return;
  }
  await db.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
    data: {
      memberId: openid,
      amount: result.rewards.stones,
      type: 'earn',
      source: 'pve',
      description: `击败 ${enemy.name}`,
      createdAt: now,
      meta: {
        enemyId: enemy.id,
        enemyLevel: enemy.level,
        battleRounds: result.rounds
      }
    }
  });
}

function formatBattleResult(result) {
  const rawRewards = result.rewards || {};
  const rewards = {
    exp: rawRewards.exp || 0,
    stones: rawRewards.stones || 0,
    attributePoints: rawRewards.attributePoints || 0,
    loot: Array.isArray(rawRewards.loot) ? rawRewards.loot : []
  };
  return {
    victory: result.victory,
    draw: result.draw,
    rounds: result.rounds,
    log: result.log,
    rewards: {
      exp: rewards.exp,
      stones: rewards.stones,
      attributePoints: rewards.attributePoints,
      loot: rewards.loot.map((item) => {
        if (item.type === 'equipment') {
          const def = EQUIPMENT_MAP[item.itemId];
          return {
            type: 'equipment',
            itemId: item.itemId,
            name: def ? def.name : '装备',
            rarity: def ? def.rarity : 'common',
            rarityLabel: def ? resolveRarityLabel(def.rarity) : '常见'
          };
        }
        if (item.type === 'skill') {
          const def = SKILL_MAP[item.skillId];
          return {
            type: 'skill',
            skillId: item.skillId,
            name: def ? def.name : '技能',
            rarity: def ? def.rarity : 'common',
            rarityLabel: def ? resolveRarityLabel(def.rarity) : '常见'
          };
        }
        return item;
      })
    },
    rewardsText: formatRewardText(rewards),
    remaining: result.remaining,
    combatPower: result.combatPower
  };
}
function rollSkill() {
  const rarity = selectSkillRarity();
  const pool = SKILL_LIBRARY.filter((skill) => skill.rarity === rarity);
  const skill = pool[Math.floor(Math.random() * pool.length)];
  return { rarity, skill };
}

function selectSkillRarity() {
  const weights = Object.values(RARITY_CONFIG).map((item) => item.weight || 0);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = Math.random() * total;
  for (const key of Object.keys(RARITY_CONFIG)) {
    const weight = RARITY_CONFIG[key].weight || 0;
    if (roll < weight) {
      return key;
    }
    roll -= weight;
  }
  return 'common';
}

function appendHistory(history, entry, maxLength) {
  const list = Array.isArray(history) ? [...history] : [];
  list.unshift(entry);
  if (list.length > maxLength) {
    return list.slice(0, maxLength);
  }
  return list;
}

function sanitizeAllocations(allocations) {
  const result = {};
  if (!allocations || typeof allocations !== 'object') {
    return result;
  }
  Object.keys(allocations).forEach((key) => {
    const config = ATTRIBUTE_CONFIG.find((attr) => attr.key === key);
    if (!config) {
      return;
    }
    const value = Math.max(0, Math.floor(Number(allocations[key]) || 0));
    if (value > 0) {
      result[key] = value;
    }
  });
  return result;
}

function findAttributeStep(key) {
  const config = ATTRIBUTE_CONFIG.find((attr) => attr.key === key);
  return config ? config.step || 1 : 1;
}

function formatStatResult(key, value) {
  if (key === 'critRate') {
    return Number(value.toFixed(4));
  }
  if (key === 'critDamage') {
    return Number(value.toFixed(2));
  }
  return Math.round(value);
}

function formatStatDisplay(key, value, signed = false) {
  const prefix = signed ? (value > 0 ? '+' : value < 0 ? '-' : '') : '';
  const abs = signed ? Math.abs(value) : value;
  if (key === 'critRate') {
    return `${prefix}${Math.round(abs * 10000) / 100}%`;
  }
  if (key === 'critDamage') {
    return `${prefix}${Math.round(abs * 100)}%`;
  }
  return `${prefix}${Math.round(abs)}`;
}

function formatDateTime(date) {
  if (!date) {
    return '';
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) {
    return '';
  }
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function formatRewardText(rewards = {}) {
  const parts = [];
  const exp = Math.max(0, Math.floor(Number(rewards.exp) || 0));
  if (exp > 0) {
    parts.push(`修为 +${exp}`);
  } else {
    parts.push('修为不可提升');
  }
  const stones = Math.max(0, Math.floor(Number(rewards.stones) || 0));
  if (stones > 0) {
    parts.push(`灵石 +${stones}`);
  }
  const attributePoints = Math.max(0, Math.floor(Number(rewards.attributePoints) || 0));
  if (attributePoints > 0) {
    parts.push(`属性点 +${attributePoints}`);
  }
  if (Array.isArray(rewards.loot) && rewards.loot.length) {
    parts.push('获得掉落');
  }
  return parts.join(' · ');
}

function formatAllocationText(allocations = {}) {
  const parts = [];
  Object.keys(allocations).forEach((key) => {
    const config = ATTRIBUTE_CONFIG.find((attr) => attr.key === key);
    if (!config) return;
    parts.push(`${config.label} +${allocations[key] * findAttributeStep(key)}`);
  });
  return parts.join('，');
}

function resolveDifficultyLabel(playerPower, enemyPower) {
  if (!playerPower) {
    return '未知';
  }
  const ratio = enemyPower / playerPower;
  if (ratio < 0.7) return '轻松';
  if (ratio < 1) return '均衡';
  if (ratio < 1.35) return '挑战';
  if (ratio < 1.7) return '艰难';
  return '绝境';
}

function resolveRarityColor(rarity) {
  return (RARITY_CONFIG[rarity] && RARITY_CONFIG[rarity].color) || '#9aa4b5';
}

function resolveRarityLabel(rarity) {
  return (RARITY_CONFIG[rarity] && RARITY_CONFIG[rarity].label) || '常见';
}

function resolveSkillMaxLevel(skillId) {
  const definition = SKILL_MAP[skillId];
  return definition ? definition.maxLevel || 5 : 5;
}

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.errMsg = message || code;
  return error;
}

function buildMap(list) {
  const map = {};
  list.forEach((item) => {
    map[item.id] = item;
  });
  return map;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
