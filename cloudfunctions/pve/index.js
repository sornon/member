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

const BASE_ATTRIBUTE_KEYS = ['constitution', 'strength', 'spirit', 'root', 'agility', 'insight'];
const COMBAT_STAT_KEYS = [
  'maxHp',
  'physicalAttack',
  'magicAttack',
  'physicalDefense',
  'magicDefense',
  'speed',
  'accuracy',
  'dodge',
  'critRate',
  'critDamage',
  'finalDamageBonus',
  'finalDamageReduction',
  'lifeSteal',
  'healingBonus',
  'healingReduction',
  'controlHit',
  'controlResist',
  'physicalPenetration',
  'magicPenetration'
];

const COMBAT_STAT_LABELS = {
  maxHp: '生命值',
  physicalAttack: '物理攻击',
  magicAttack: '法术攻击',
  physicalDefense: '物理防御',
  magicDefense: '法术防御',
  speed: '速度',
  accuracy: '命中',
  dodge: '闪避值',
  critRate: '暴击率',
  critDamage: '暴击伤害',
  finalDamageBonus: '最终增伤',
  finalDamageReduction: '最终减伤',
  lifeSteal: '吸血',
  healingBonus: '治疗强化',
  healingReduction: '治疗削弱',
  controlHit: '控制命中',
  controlResist: '控制抗性',
  physicalPenetration: '破甲',
  magicPenetration: '法穿'
};

const ATTRIBUTE_CONFIG = [
  { key: 'constitution', label: '体质', type: 'number', step: 1 },
  { key: 'strength', label: '力量', type: 'number', step: 1 },
  { key: 'spirit', label: '灵力', type: 'number', step: 1 },
  { key: 'root', label: '根骨', type: 'number', step: 1 },
  { key: 'agility', label: '敏捷', type: 'number', step: 1 },
  { key: 'insight', label: '悟性', type: 'number', step: 1 }
];

const BASELINE_ATTRIBUTES = {
  constitution: 20,
  strength: 16,
  spirit: 16,
  root: 18,
  agility: 12,
  insight: 12
};

const REALM_PHASES = [
  {
    id: 'qi_refining',
    name: '炼气期',
    short: '炼气',
    range: [1, 30],
    perLevel: { constitution: 2, strength: 2, spirit: 2, root: 2, agility: 1, insight: 1 },
    breakthroughBonus: {}
  },
  {
    id: 'foundation',
    name: '筑基期',
    short: '筑基',
    range: [31, 60],
    perLevel: { constitution: 2.5, strength: 2.4, spirit: 2.5, root: 2.4, agility: 1.4, insight: 1.3 },
    breakthroughBonus: {
      maxHp: 0.05,
      physicalAttack: 0.05,
      magicAttack: 0.05,
      physicalDefense: 0.05,
      magicDefense: 0.05,
      speed: 0.02,
      accuracy: 0.02
    }
  },
  {
    id: 'golden_core',
    name: '金丹期',
    short: '金丹',
    range: [61, 90],
    perLevel: { constitution: 3, strength: 2.8, spirit: 3, root: 2.8, agility: 1.6, insight: 1.5 },
    breakthroughBonus: {
      maxHp: 0.08,
      physicalAttack: 0.08,
      magicAttack: 0.08,
      physicalDefense: 0.08,
      magicDefense: 0.08,
      speed: 0.03,
      accuracy: 0.03
    }
  },
  {
    id: 'nascent_soul',
    name: '元婴期',
    short: '元婴',
    range: [91, 100],
    perLevel: { constitution: 3.5, strength: 3.2, spirit: 3.4, root: 3.2, agility: 1.8, insight: 1.7 },
    breakthroughBonus: {
      maxHp: 0.12,
      physicalAttack: 0.12,
      magicAttack: 0.12,
      physicalDefense: 0.12,
      magicDefense: 0.12,
      speed: 0.04,
      accuracy: 0.04
    }
  }
];

const REALM_BONUS_TARGETS = [
  'maxHp',
  'physicalAttack',
  'magicAttack',
  'physicalDefense',
  'magicDefense',
  'speed',
  'accuracy'
];

let membershipLevelsCache = null;

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
    stats: { strength: 6, agility: 3, critRate: 0.015 },
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
    stats: { strength: 12, spirit: 6, agility: 4, critRate: 0.03 },
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
    stats: { strength: 18, critRate: 0.05, critDamage: 0.2 },
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
    stats: { constitution: 10, root: 8, physicalDefense: 18 },
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
    stats: { constitution: 14, root: 12, finalDamageReduction: 0.04 },
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
    stats: { agility: 12, root: 10, dodge: 18, dodgeChance: 0.05 },
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
    stats: { spirit: 8, insight: 6, critRate: 0.02 },
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
    stats: { insight: 10, spirit: 6, critDamage: 0.15 },
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
    stats: { strength: 12, agility: 10, insight: 8, critRate: 0.06, finalDamageBonus: 0.04 },
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
    effects: { physicalAttackMultiplier: 0.12, speed: 8 },
    levelScaling: { physicalAttackMultiplier: 0.04, speed: 2 },
    tags: ['输出', '常驻'],
    maxLevel: 5
  },
  {
    id: 'stone_skin',
    name: '磐石护体',
    rarity: 'common',
    description: '引山岳之力护体，提升防御并获得护盾。',
    effects: { physicalDefenseMultiplier: 0.2, shield: 120 },
    levelScaling: { physicalDefenseMultiplier: 0.05, shield: 40 },
    tags: ['防御', '护盾'],
    maxLevel: 5
  },
  {
    id: 'aerial_step',
    name: '凌空步',
    rarity: 'rare',
    description: '掌握凌空而行的诀窍，大幅提升身法与气血。',
    effects: { agility: 8, maxHpMultiplier: 0.08 },
    levelScaling: { agility: 3, maxHpMultiplier: 0.03 },
    tags: ['身法', '生存'],
    maxLevel: 5
  },
  {
    id: 'thunder_anthem',
    name: '霆鸣决',
    rarity: 'rare',
    description: '以雷霆之势击溃敌人，攻击提升并附带雷击。',
    effects: { physicalAttackMultiplier: 0.2, bonusDamage: 70, critRate: 0.04 },
    levelScaling: { physicalAttackMultiplier: 0.05, bonusDamage: 25, critRate: 0.01 },
    tags: ['输出', '爆发'],
    maxLevel: 5
  },
  {
    id: 'phoenix_flare',
    name: '朱焰冲霄',
    rarity: 'epic',
    description: '化身朱焰，攻击与暴击伤害大幅提升。',
    effects: { critDamage: 0.3, finalDamageBonus: 0.06 },
    levelScaling: { critDamage: 0.08, finalDamageBonus: 0.02 },
    tags: ['暴击', '高爆发'],
    maxLevel: 5
  },
  {
    id: 'celestial_barrier',
    name: '星幕结界',
    rarity: 'epic',
    description: '星光化为屏障，为自身提供护盾与暴击率。',
    effects: { shield: 180, maxHpMultiplier: 0.12, finalDamageReduction: 0.06 },
    levelScaling: { shield: 45, maxHpMultiplier: 0.03, finalDamageReduction: 0.015 },
    tags: ['防御', '暴击'],
    maxLevel: 5
  },
  {
    id: 'dragon_roar',
    name: '龙吟破军',
    rarity: 'legendary',
    description: '以龙吟震慑四方，攻击暴涨并附加剧烈震荡。',
    effects: { physicalAttackMultiplier: 0.25, critRate: 0.07, bonusDamage: 120 },
    levelScaling: { physicalAttackMultiplier: 0.06, critRate: 0.015, bonusDamage: 45 },
    tags: ['传说', '暴击'],
    maxLevel: 5
  },
  {
    id: 'time_dilation',
    name: '御时术',
    rarity: 'legendary',
    description: '暂借时光伟力，提升身法并大幅提高闪避概率。',
    effects: { speedMultiplier: 0.15, dodge: 20, dodgeChance: 0.1 },
    levelScaling: { speedMultiplier: 0.04, dodge: 6, dodgeChance: 0.025 },
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
    stats: {
      maxHp: 900,
      physicalAttack: 110,
      magicAttack: 60,
      physicalDefense: 70,
      magicDefense: 55,
      speed: 45,
      accuracy: 105,
      dodge: 90,
      critRate: 0.05,
      critDamage: 1.4,
      finalDamageBonus: 0,
      finalDamageReduction: 0.05,
      lifeSteal: 0,
      controlHit: 20,
      controlResist: 10,
      physicalPenetration: 6,
      magicPenetration: 0
    },
    special: { shield: 30, bonusDamage: 12, dodgeChance: 0.02 },
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
    stats: {
      maxHp: 1150,
      physicalAttack: 135,
      magicAttack: 160,
      physicalDefense: 82,
      magicDefense: 70,
      speed: 90,
      accuracy: 120,
      dodge: 120,
      critRate: 0.08,
      critDamage: 1.55,
      finalDamageBonus: 0.08,
      finalDamageReduction: 0.04,
      lifeSteal: 0.05,
      controlHit: 35,
      controlResist: 20,
      physicalPenetration: 12,
      magicPenetration: 18
    },
    special: { shield: 20, bonusDamage: 40, dodgeChance: 0.04 },
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
    stats: {
      maxHp: 1800,
      physicalAttack: 220,
      magicAttack: 110,
      physicalDefense: 150,
      magicDefense: 120,
      speed: 65,
      accuracy: 125,
      dodge: 110,
      critRate: 0.1,
      critDamage: 1.6,
      finalDamageBonus: 0.05,
      finalDamageReduction: 0.12,
      lifeSteal: 0.03,
      controlHit: 40,
      controlResist: 40,
      physicalPenetration: 20,
      magicPenetration: 8
    },
    special: { shield: 120, bonusDamage: 55, dodgeChance: 0.03 },
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
    stats: {
      maxHp: 2000,
      physicalAttack: 210,
      magicAttack: 240,
      physicalDefense: 120,
      magicDefense: 150,
      speed: 120,
      accuracy: 135,
      dodge: 150,
      critRate: 0.12,
      critDamage: 1.7,
      finalDamageBonus: 0.12,
      finalDamageReduction: 0.08,
      lifeSteal: 0.07,
      controlHit: 60,
      controlResist: 50,
      physicalPenetration: 18,
      magicPenetration: 26,
      critResist: 0.03
    },
    special: { shield: 80, bonusDamage: 80, dodgeChance: 0.08 },
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

function findRealmPhaseForLevel(level) {
  return (
    REALM_PHASES.find((phase) => level >= phase.range[0] && level <= phase.range[1]) ||
    REALM_PHASES[REALM_PHASES.length - 1]
  );
}

function resolveRealmBonus(level) {
  const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const bonuses = {};
  REALM_PHASES.forEach((phase) => {
    if (target >= phase.range[0]) {
      const values = phase.breakthroughBonus || {};
      REALM_BONUS_TARGETS.forEach((key) => {
        bonuses[key] = (bonuses[key] || 0) + (values[key] || 0);
      });
    }
  });
  return bonuses;
}

function calculateBaseAttributesForLevel(level = 1) {
  const value = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const totals = { ...BASELINE_ATTRIBUTES };
  if (value <= 1) {
    return BASE_ATTRIBUTE_KEYS.reduce((acc, key) => {
      acc[key] = Math.round(totals[key] || 0);
      return acc;
    }, {});
  }

  for (let lvl = 2; lvl <= value; lvl += 1) {
    const phase = findRealmPhaseForLevel(lvl);
    BASE_ATTRIBUTE_KEYS.forEach((key) => {
      const growth = phase.perLevel && typeof phase.perLevel[key] === 'number' ? phase.perLevel[key] : 0;
      totals[key] = (totals[key] || 0) + growth;
    });
  }

  return BASE_ATTRIBUTE_KEYS.reduce((acc, key) => {
    acc[key] = Math.round(totals[key] || 0);
    return acc;
  }, {});
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

function getAttributePointRewardForLevel() {
  return 5;
}

function syncAttributesWithMemberLevel(attributes, member, levels) {
  if (!attributes) {
    return false;
  }
  const { sorted, current, next } = resolveMemberLevelInfo(levels, member);
  const levelOrder = current ? current.order || sorted.indexOf(current) + 1 : 1;
  const experience = Math.max(0, Math.floor(Number(member.experience) || 0));
  const baseStats = calculateBaseAttributesForLevel(levelOrder);
  const realmPhase = findRealmPhaseForLevel(levelOrder);
  const realmBonus = resolveRealmBonus(levelOrder);
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
      bonusPoints += getAttributePointRewardForLevel();
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

  if (attributes.realmId !== realmPhase.id) {
    attributes.realmId = realmPhase.id;
    changed = true;
  }
  if (attributes.realmName !== realmPhase.name) {
    attributes.realmName = realmPhase.name;
    changed = true;
  }
  if (attributes.realmShort !== realmPhase.short) {
    attributes.realmShort = realmPhase.short;
    changed = true;
  }
  if (!attributes.realmBonus || !areStatsEqual(attributes.realmBonus, realmBonus)) {
    attributes.realmBonus = realmBonus;
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
  const realmBonus = resolveRealmBonus(1);
  const realmPhase = findRealmPhaseForLevel(1);
  return {
    level: 1,
    experience: 0,
    attributePoints: 0,
    lastSyncedLevel: 1,
    levelId: '',
    levelLabel: '',
    levelName: '',
    levelShort: '',
    nextLevelId: '',
    nextLevelLabel: '',
    experienceThreshold: 0,
    nextExperienceThreshold: null,
    maxLevel: MAX_LEVEL,
    base,
    trained: BASE_ATTRIBUTE_KEYS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {}),
    realmId: realmPhase.id,
    realmName: realmPhase.name,
    realmShort: realmPhase.short,
    realmBonus
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
    trained: mergeStats(payload.trained, defaults.trained),
    realmBonus: mergeStats(payload.realmBonus, defaults.realmBonus)
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
  const enemies = ENEMY_LIBRARY.map((enemy) => decorateEnemy(enemy, attributeSummary));
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

  const equipmentSummary = sumEquipmentBonuses(equipment);
  const skillSummary = aggregateSkillEffects(skills);

  const baseTotals = {};
  baseConfig.forEach((attr) => {
    const key = attr.key;
    baseTotals[key] =
      (combinedBase[key] || 0) + (equipmentSummary.base[key] || 0) + (skillSummary.base[key] || 0);
  });

  const realmBonus = attributes.realmBonus || {};
  const derived = calculateDerivedStatBlock(baseTotals, realmBonus, equipmentSummary, skillSummary);
  const finalStats = derived.finalStats;

  const combatPower = calculateCombatPower(finalStats, derived.special);

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
    baseTotals,
    equipmentBonus: equipmentSummary,
    skillBonus: skillSummary,
    derivedSummary: derived,
    skillSummary: {
      shield: derived.special.shield,
      bonusDamage: derived.special.bonusDamage,
      dodgeChance: derived.special.dodgeChance
    },
    finalStats,
    attributeList: baseConfig.map((attr) => ({
      key: attr.key,
      label: attr.label,
      step: attr.step || 1,
      value: baseTotals[attr.key] || 0,
      base: Number(base[attr.key]) || 0,
      trained: Number(trained[attr.key]) || 0,
      equipment: equipmentSummary.base[attr.key] || 0,
      skill: skillSummary.base[attr.key] || 0,
      type: attr.type,
      formattedValue: formatStatDisplay(attr.key, baseTotals[attr.key] || 0),
      formattedBase: formatStatDisplay(attr.key, Number(base[attr.key]) || 0),
      formattedTrained: formatStatDisplay(attr.key, Number(trained[attr.key]) || 0, true),
      formattedEquipment: formatStatDisplay(attr.key, equipmentSummary.base[attr.key] || 0, true),
      formattedSkill: formatStatDisplay(attr.key, skillSummary.base[attr.key] || 0, true)
    })),
    combatStats: COMBAT_STAT_KEYS.map((key) => {
      const multiplier = derived.combinedMultipliers[key] || 1;
      return {
        key,
        label: resolveCombatStatLabel(key),
        value: finalStats[key],
        base: derived.baseStats[key] || 0,
        equipment: derived.equipmentAdditive[key] || 0,
        skill: derived.skillAdditive[key] || 0,
        multiplier,
        formattedValue: formatStatDisplay(key, finalStats[key]),
        formattedBase: formatStatDisplay(key, derived.baseStats[key] || 0),
        formattedEquipment: formatStatDisplay(key, derived.equipmentAdditive[key] || 0, true),
        formattedSkill: formatStatDisplay(key, derived.skillAdditive[key] || 0, true),
        formattedMultiplier: multiplier && multiplier !== 1 ? `${Math.round((multiplier - 1) * 10000) / 100}%` : ''
      };
    })
  };
}

function createBonusSummary() {
  const base = {};
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    base[key] = 0;
  });
  const combatAdditive = {};
  const combatMultipliers = {};
  COMBAT_STAT_KEYS.forEach((key) => {
    combatAdditive[key] = 0;
    combatMultipliers[key] = 1;
  });
  return {
    base,
    combatAdditive,
    combatMultipliers,
    special: { shield: 0, bonusDamage: 0, dodgeChance: 0 }
  };
}

function cloneBonusSummary(summary = createBonusSummary()) {
  const cloned = createBonusSummary();
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    cloned.base[key] = summary.base && typeof summary.base[key] === 'number' ? summary.base[key] : 0;
  });
  COMBAT_STAT_KEYS.forEach((key) => {
    cloned.combatAdditive[key] =
      summary.combatAdditive && typeof summary.combatAdditive[key] === 'number'
        ? summary.combatAdditive[key]
        : 0;
    cloned.combatMultipliers[key] =
      summary.combatMultipliers && typeof summary.combatMultipliers[key] === 'number'
        ? summary.combatMultipliers[key]
        : 1;
  });
  cloned.special.shield = summary.special && typeof summary.special.shield === 'number' ? summary.special.shield : 0;
  cloned.special.bonusDamage =
    summary.special && typeof summary.special.bonusDamage === 'number' ? summary.special.bonusDamage : 0;
  cloned.special.dodgeChance =
    summary.special && typeof summary.special.dodgeChance === 'number' ? summary.special.dodgeChance : 0;
  return cloned;
}

function applyBonus(summary, key, value) {
  if (!summary || value == null || value === 0) {
    return;
  }
  if (BASE_ATTRIBUTE_KEYS.includes(key)) {
    summary.base[key] = (summary.base[key] || 0) + value;
    return;
  }
  if (key.endsWith('Multiplier')) {
    const target = key.replace('Multiplier', '');
    if (COMBAT_STAT_KEYS.includes(target)) {
      summary.combatMultipliers[target] = (summary.combatMultipliers[target] || 1) * (1 + value);
    }
    return;
  }
  if (COMBAT_STAT_KEYS.includes(key)) {
    summary.combatAdditive[key] = (summary.combatAdditive[key] || 0) + value;
    return;
  }
  if (key === 'shield' || key === 'bonusDamage' || key === 'dodgeChance') {
    summary.special[key] = (summary.special[key] || 0) + value;
  }
}

function mergeBonusSummary(target, source) {
  if (!source) {
    return target;
  }
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    target.base[key] = (target.base[key] || 0) + (source.base[key] || 0);
  });
  COMBAT_STAT_KEYS.forEach((key) => {
    target.combatAdditive[key] = (target.combatAdditive[key] || 0) + (source.combatAdditive[key] || 0);
    target.combatMultipliers[key] = (target.combatMultipliers[key] || 1) * (source.combatMultipliers[key] || 1);
  });
  target.special.shield = (target.special.shield || 0) + (source.special.shield || 0);
  target.special.bonusDamage = (target.special.bonusDamage || 0) + (source.special.bonusDamage || 0);
  target.special.dodgeChance = (target.special.dodgeChance || 0) + (source.special.dodgeChance || 0);
  return target;
}

function flattenBonusSummary(summary) {
  const result = {};
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    if (summary.base[key]) {
      result[key] = summary.base[key];
    }
  });
  COMBAT_STAT_KEYS.forEach((key) => {
    if (summary.combatAdditive[key]) {
      result[key] = (result[key] || 0) + summary.combatAdditive[key];
    }
    if (summary.combatMultipliers[key] && summary.combatMultipliers[key] !== 1) {
      result[`${key}Multiplier`] = (summary.combatMultipliers[key] || 1) - 1;
    }
  });
  if (summary.special.shield) {
    result.shield = (result.shield || 0) + summary.special.shield;
  }
  if (summary.special.bonusDamage) {
    result.bonusDamage = (result.bonusDamage || 0) + summary.special.bonusDamage;
  }
  if (summary.special.dodgeChance) {
    result.dodgeChance = (result.dodgeChance || 0) + summary.special.dodgeChance;
  }
  return result;
}

function sumEquipmentBonuses(equipment) {
  const summary = createBonusSummary();
  if (!equipment || typeof equipment !== 'object') {
    return summary;
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
      applyBonus(summary, key, bonus[key]);
    });
  });

  return summary;
}

function aggregateSkillEffects(skills) {
  const summary = createBonusSummary();
  if (!skills || typeof skills !== 'object') {
    return summary;
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
    mergeBonusSummary(summary, effects);
  });

  return summary;
}

function resolveCombatStatLabel(key) {
  return COMBAT_STAT_LABELS[key] || key;
}

function resolveAttributeLabel(key) {
  const attr = ATTRIBUTE_CONFIG.find((item) => item.key === key);
  if (attr) {
    return attr.label;
  }
  return resolveCombatStatLabel(key);
}

function deriveBaseCombatStats(baseAttributes, realmBonus = {}) {
  const attributes = baseAttributes || {};
  const constitution = Number(attributes.constitution) || 0;
  const strength = Number(attributes.strength) || 0;
  const spirit = Number(attributes.spirit) || 0;
  const root = Number(attributes.root) || 0;
  const agility = Number(attributes.agility) || 0;
  const insight = Number(attributes.insight) || 0;
  const stats = {};
  COMBAT_STAT_KEYS.forEach((key) => {
    stats[key] = 0;
  });

  stats.maxHp = 500 + constitution * 100 + root * 20;
  stats.physicalAttack = 50 + strength * 2;
  stats.magicAttack = 50 + spirit * 2;
  stats.physicalDefense = 40 + root * 1 + strength * 0.2;
  stats.magicDefense = 40 + root * 1 + spirit * 0.2;
  stats.speed = 80 + agility * 1;
  stats.accuracy = 100 + insight * 1;
  stats.dodge = 80 + agility * 0.9 + insight * 0.4;
  stats.critRate = 0.05 + insight * 0.001;
  stats.critDamage = 1.5 + insight * 0.0015;
  stats.finalDamageBonus = 0;
  stats.finalDamageReduction = Math.min(0.4, root * 0.001 + constitution * 0.0003);
  stats.lifeSteal = 0;
  stats.healingBonus = spirit * 0.005;
  stats.healingReduction = 0;
  stats.controlHit = insight * 0.5 + spirit * 0.3;
  stats.controlResist = root * 0.6;
  stats.physicalPenetration = strength * 0.05;
  stats.magicPenetration = spirit * 0.05;

  REALM_BONUS_TARGETS.forEach((key) => {
    if (typeof stats[key] === 'number') {
      const bonus = realmBonus && typeof realmBonus[key] === 'number' ? realmBonus[key] : 0;
      if (bonus) {
        stats[key] = stats[key] * (1 + bonus);
      }
    }
  });

  return stats;
}

function calculateDerivedStatBlock(baseAttributes, realmBonus, equipmentSummary, skillSummary) {
  const baseStats = deriveBaseCombatStats(baseAttributes, realmBonus);
  const finalStats = {};
  const equipmentAdditive = {};
  const skillAdditive = {};
  const equipmentMultipliers = {};
  const skillMultipliers = {};
  const combinedAdditive = {};
  const combinedMultipliers = {};

  COMBAT_STAT_KEYS.forEach((key) => {
    const eqAdd = equipmentSummary.combatAdditive[key] || 0;
    const skAdd = skillSummary.combatAdditive[key] || 0;
    const eqMul = equipmentSummary.combatMultipliers[key] || 1;
    const skMul = skillSummary.combatMultipliers[key] || 1;
    equipmentAdditive[key] = eqAdd;
    skillAdditive[key] = skAdd;
    equipmentMultipliers[key] = eqMul;
    skillMultipliers[key] = skMul;
    combinedAdditive[key] = eqAdd + skAdd;
    combinedMultipliers[key] = eqMul * skMul;
    let value = (baseStats[key] || 0) + combinedAdditive[key];
    value *= combinedMultipliers[key];
    finalStats[key] = formatStatResult(key, value);
  });

  const special = {
    shield: (equipmentSummary.special.shield || 0) + (skillSummary.special.shield || 0),
    bonusDamage: (equipmentSummary.special.bonusDamage || 0) + (skillSummary.special.bonusDamage || 0),
    dodgeChance: (equipmentSummary.special.dodgeChance || 0) + (skillSummary.special.dodgeChance || 0)
  };

  return {
    finalStats,
    baseStats,
    equipmentAdditive,
    skillAdditive,
    equipmentMultipliers,
    skillMultipliers,
    combinedAdditive,
    combinedMultipliers,
    special
  };
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
    const value = baseValue * multiplier;
    if (
      BASE_ATTRIBUTE_KEYS.includes(key) ||
      ['speed', 'accuracy', 'dodge', 'physicalDefense', 'magicDefense', 'physicalAttack', 'magicAttack'].includes(key)
    ) {
      result[key] = Math.round(value);
      return;
    }
    if (key.endsWith('Multiplier')) {
      result[key] = Number(value.toFixed(4));
      return;
    }
    if (
      key === 'critRate' ||
      key === 'finalDamageBonus' ||
      key === 'finalDamageReduction' ||
      key === 'lifeSteal' ||
      key === 'healingBonus' ||
      key === 'healingReduction'
    ) {
      result[key] = Number(value.toFixed(4));
      return;
    }
    if (key === 'critDamage') {
      result[key] = Number(value.toFixed(2));
      return;
    }
    if (key === 'bonusDamage' || key === 'shield') {
      result[key] = Math.round(value);
      return;
    }
    if (key === 'dodgeChance') {
      result[key] = Number(value.toFixed(4));
      return;
    }
    result[key] = Math.round(value);
  });
  return result;
}

function resolveSkillEffects(definition, level = 1) {
  const effects = definition.effects || {};
  const scaling = definition.levelScaling || {};
  const maxLevel = definition.maxLevel || 5;
  const clampedLevel = Math.min(maxLevel, Math.max(1, level));
  const extraLevel = clampedLevel - 1;
  const summary = createBonusSummary();

  Object.keys(effects).forEach((key) => {
    const baseValue = effects[key] || 0;
    const scaleValue = scaling[key] || 0;
    const total = baseValue + scaleValue * extraLevel;
    applyBonus(summary, key, total);
  });

  Object.keys(scaling).forEach((key) => {
    if (effects[key]) {
      return;
    }
    const extra = (scaling[key] || 0) * extraLevel;
    applyBonus(summary, key, extra);
  });

  return summary;
}

function calculateCombatPower(stats, special = {}) {
  if (!stats) return 0;
  const maxHp = Number(stats.maxHp) || 0;
  const physicalAttack = Number(stats.physicalAttack) || 0;
  const magicAttack = Number(stats.magicAttack) || 0;
  const physicalDefense = Number(stats.physicalDefense) || 0;
  const magicDefense = Number(stats.magicDefense) || 0;
  const speed = Number(stats.speed) || 0;
  const accuracy = Number(stats.accuracy) || 0;
  const dodge = Number(stats.dodge) || 0;
  const critRate = clamp(Number(stats.critRate) || 0, 0, 0.95);
  const critDamage = Math.max(1.2, Number(stats.critDamage) || 1.5);
  const finalDamageBonus = Number(stats.finalDamageBonus) || 0;
  const finalDamageReduction = Number(stats.finalDamageReduction) || 0;
  const lifeSteal = Number(stats.lifeSteal) || 0;
  const healingBonus = Number(stats.healingBonus) || 0;
  const controlHit = Number(stats.controlHit) || 0;
  const controlResist = Number(stats.controlResist) || 0;
  const physicalPenetration = Number(stats.physicalPenetration) || 0;
  const magicPenetration = Number(stats.magicPenetration) || 0;
  const shield = special.shield || 0;
  const bonusDamage = special.bonusDamage || 0;
  const dodgeChance = special.dodgeChance || 0;

  const power =
    maxHp * 0.35 +
    (physicalAttack + magicAttack) * 1.8 +
    (physicalDefense + magicDefense) * 1.45 +
    speed * 1.2 +
    accuracy * 0.9 +
    dodge * 2.5 +
    critRate * 520 +
    (critDamage - 1) * 180 +
    finalDamageBonus * 650 -
    finalDamageReduction * 480 +
    lifeSteal * 420 +
    healingBonus * 380 +
    controlHit * 1.1 +
    controlResist * 1.1 +
    physicalPenetration * 2.2 +
    magicPenetration * 2.2 +
    shield * 0.25 +
    bonusDamage * 1.4 +
    dodgeChance * 620;
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
  const flattened = flattenBonusSummary(effects);
  return {
    skillId: entry.skillId,
    name: definition.name,
    rarity: definition.rarity,
    rarityLabel: resolveRarityLabel(definition.rarity),
    rarityColor: resolveRarityColor(definition.rarity),
    description: definition.description,
    level: entry.level || 1,
    maxLevel: resolveSkillMaxLevel(entry.skillId),
    effectsSummary: formatStatsText(flattened),
    tags: definition.tags || [],
    obtainedAt: entry.obtainedAt,
    obtainedAtText: formatDateTime(entry.obtainedAt),
    equipped: Array.isArray(profile.skills && profile.skills.equipped)
      ? profile.skills.equipped.includes(entry.skillId)
      : false
  };
}
function decorateEnemy(enemy, attributeSummary) {
  const combatPower = calculateCombatPower(enemy.stats, enemy.special || {});
  const playerPower = calculateCombatPower(attributeSummary.finalStats || {}, attributeSummary.skillSummary || {});
  const difficulty = resolveDifficultyLabel(playerPower, combatPower);
  const rewards = normalizeDungeonRewards(enemy.rewards);
  return {
    id: enemy.id,
    name: enemy.name,
    description: enemy.description,
    level: enemy.level,
    stats: enemy.stats,
    special: enemy.special || {},
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
    } else if (key.endsWith('Multiplier')) {
      const target = key.replace('Multiplier', '');
      const label = resolveAttributeLabel(target);
      texts.push(`${label} +${Math.round(value * 10000) / 100}%`);
    } else {
      const label = resolveAttributeLabel(key);
      texts.push(`${label} ${formatStatDisplay(key, value, true)}`);
    }
  });
  return texts;
}
function buildBattleSetup(profile, enemy) {
  const attributes = calculateAttributes(profile.attributes, profile.equipment, profile.skills);
  const player = createPlayerCombatant(attributes);
  const enemyCombatant = createEnemyCombatant(enemy);
  return { player, enemy: enemyCombatant, attributes };
}

function runBattleSimulation({ player, enemy, attributes }) {
  const log = [];
  const playerStats = player.stats;
  const enemyStats = enemy.stats;
  const playerSpecial = player.special || {};
  const enemySpecial = enemy.special || {};
  let playerHp = playerStats.maxHp + (playerSpecial.shield || 0);
  let enemyHp = enemyStats.maxHp + (enemySpecial.shield || 0);
  let round = 1;
  const maxRounds = 30;
  const playerFirst = playerStats.speed >= enemyStats.speed;
  let attacker = playerFirst ? 'player' : 'enemy';

  while (playerHp > 0 && enemyHp > 0 && round <= maxRounds) {
    if (attacker === 'player') {
      const result = executeAttack(playerStats, playerSpecial, enemyStats, enemySpecial);
      if (result.dodged) {
        log.push(`第${round}回合：敌方闪避了你的攻势`);
      } else {
        enemyHp -= result.damage;
        log.push(
          `第${round}回合：你造成 ${Math.max(0, Math.round(result.damage))} 点伤害${
            result.crit ? '（暴击）' : ''
          }，敌方剩余 ${Math.max(0, Math.round(enemyHp))}`
        );
        if (result.heal > 0) {
          const healed = Math.min(result.heal, Math.max(0, playerStats.maxHp - playerHp));
          playerHp = Math.min(playerStats.maxHp, playerHp + result.heal);
          if (healed > 0) {
            log.push(`灵血回流，你回复了 ${Math.round(healed)} 点生命`);
          }
        }
      }
      attacker = 'enemy';
      if (enemyHp <= 0) {
        break;
      }
    } else {
      const result = executeAttack(enemyStats, enemySpecial, playerStats, playerSpecial);
      if (result.dodged) {
        log.push(`第${round}回合：你闪避了敌方的攻势`);
      } else {
        playerHp -= result.damage;
        log.push(
          `第${round}回合：敌方造成 ${Math.max(0, Math.round(result.damage))} 点伤害${
            result.crit ? '（暴击）' : ''
          }，你剩余 ${Math.max(0, Math.round(playerHp))}`
        );
        if (result.heal > 0) {
          const healed = Math.min(result.heal, Math.max(0, enemyStats.maxHp - enemyHp));
          enemyHp = Math.min(enemyStats.maxHp, enemyHp + result.heal);
          if (healed > 0) {
            log.push(`敌方吸取灵力，回复了 ${Math.round(healed)} 点生命`);
          }
        }
      }
      attacker = 'player';
      round += 1;
    }
  }

  const victory = enemyHp <= 0 && playerHp > 0;
  const draw = !victory && playerHp > 0 && enemyHp > 0;

  const rewards = calculateBattleRewards(attributes, enemy.meta || enemy, { victory, draw });

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
      enemy: calculateCombatPower(enemyStats, enemySpecial)
    }
  };
}

function createPlayerCombatant(attributes) {
  const final = attributes.finalStats || {};
  const special = attributes.skillSummary || {};
  return {
    stats: {
      maxHp: Number(final.maxHp) || 0,
      physicalAttack: Number(final.physicalAttack) || 0,
      magicAttack: Number(final.magicAttack) || 0,
      physicalDefense: Number(final.physicalDefense) || 0,
      magicDefense: Number(final.magicDefense) || 0,
      speed: Number(final.speed) || 0,
      accuracy: Number(final.accuracy) || 0,
      dodge: Number(final.dodge) || 0,
      critRate: clamp(Number(final.critRate) || 0, 0, 0.95),
      critDamage: Math.max(1.2, Number(final.critDamage) || 1.5),
      finalDamageBonus: Number(final.finalDamageBonus) || 0,
      finalDamageReduction: Number(final.finalDamageReduction) || 0,
      lifeSteal: Number(final.lifeSteal) || 0,
      healingBonus: Number(final.healingBonus) || 0,
      healingReduction: Number(final.healingReduction) || 0,
      controlHit: Number(final.controlHit) || 0,
      controlResist: Number(final.controlResist) || 0,
      physicalPenetration: Number(final.physicalPenetration) || 0,
      magicPenetration: Number(final.magicPenetration) || 0,
      critResist: Number(final.critResist) || 0
    },
    special: {
      shield: special.shield || 0,
      bonusDamage: special.bonusDamage || 0,
      dodgeChance: clamp(special.dodgeChance || 0, 0, 0.5)
    }
  };
}

function createEnemyCombatant(enemy) {
  const stats = normalizeEnemyStats(enemy.stats || {});
  const special = enemy.special || {};
  return {
    stats,
    special: {
      shield: special.shield || 0,
      bonusDamage: special.bonusDamage || 0,
      dodgeChance: clamp(special.dodgeChance || 0, 0, 0.6)
    },
    meta: enemy
  };
}

function normalizeEnemyStats(stats = {}) {
  return {
    maxHp: Number(stats.maxHp || stats.hp || 0),
    physicalAttack: Number(stats.physicalAttack || stats.attack || 0),
    magicAttack: Number(stats.magicAttack || 0),
    physicalDefense: Number(stats.physicalDefense || stats.defense || 0),
    magicDefense: Number(stats.magicDefense || 0),
    speed: Number(stats.speed || 0),
    accuracy: Number(stats.accuracy || 110),
    dodge: Number(stats.dodge || 0),
    critRate: clamp(Number(stats.critRate || 0.05), 0, 0.95),
    critDamage: Math.max(1.2, Number(stats.critDamage || 1.5)),
    finalDamageBonus: Number(stats.finalDamageBonus || 0),
    finalDamageReduction: Number(stats.finalDamageReduction || 0),
    lifeSteal: Number(stats.lifeSteal || 0),
    healingBonus: Number(stats.healingBonus || 0),
    healingReduction: Number(stats.healingReduction || 0),
    controlHit: Number(stats.controlHit || 0),
    controlResist: Number(stats.controlResist || 0),
    physicalPenetration: Number(stats.physicalPenetration || 0),
    magicPenetration: Number(stats.magicPenetration || 0),
    critResist: Number(stats.critResist || 0)
  };
}

function executeAttack(attacker, attackerSpecial, defender, defenderSpecial) {
  const offensiveSpecial = attackerSpecial || {};
  const defensiveSpecial = defenderSpecial || {};
  const accuracy = Number(attacker.accuracy || 100);
  const dodge = Number(defender.dodge || 0);
  const baseHitChance = clamp(0.85 + (accuracy - dodge) * 0.005, 0.2, 0.99);
  if (Math.random() > baseHitChance) {
    return { dodged: true, damage: 0, crit: false, heal: 0 };
  }
  if (Math.random() < clamp(defensiveSpecial.dodgeChance || 0, 0, 0.8)) {
    return { dodged: true, damage: 0, crit: false, heal: 0 };
  }

  const physicalAttack = Math.max(0, Number(attacker.physicalAttack) || 0);
  const magicAttack = Math.max(0, Number(attacker.magicAttack) || 0);
  const physicalPenetrationRating = Math.max(0, Number(attacker.physicalPenetration) || 0);
  const magicPenetrationRating = Math.max(0, Number(attacker.magicPenetration) || 0);
  const physicalPenetration = clamp(physicalPenetrationRating * 0.005, 0, 0.6);
  const magicPenetration = clamp(magicPenetrationRating * 0.005, 0, 0.6);

  const physicalDefense = Math.max(0, Number(defender.physicalDefense) || 0);
  const magicDefense = Math.max(0, Number(defender.magicDefense) || 0);
  const effectivePhysicalDefense = physicalDefense * (1 - physicalPenetration);
  const effectiveMagicDefense = magicDefense * (1 - magicPenetration);

  const basePhysical = physicalAttack > 0 ? Math.max(physicalAttack * 0.25, physicalAttack - effectivePhysicalDefense) : 0;
  const baseMagic = magicAttack > 0 ? Math.max(magicAttack * 0.25, magicAttack - effectiveMagicDefense) : 0;
  const usingMagic = baseMagic > basePhysical;
  let damage = usingMagic ? baseMagic : basePhysical;
  damage *= 0.9 + Math.random() * 0.2;

  const bonusDamage = Number(offensiveSpecial.bonusDamage) || 0;
  if (bonusDamage) {
    damage += bonusDamage;
  }

  const critChance = clamp((Number(attacker.critRate) || 0) - (Number(defender.critResist) || 0), 0.05, 0.95);
  const crit = Math.random() < critChance;
  if (crit) {
    damage *= Math.max(1.2, Number(attacker.critDamage) || 1.5);
  }

  const finalDamageBonus = Number(attacker.finalDamageBonus) || 0;
  const finalDamageReduction = clamp(Number(defender.finalDamageReduction) || 0, 0, 0.9);
  const finalMultiplier = Math.max(0.1, 1 + finalDamageBonus - finalDamageReduction);
  damage *= finalMultiplier;

  damage = Math.max(1, damage);

  const lifeSteal = clamp(Number(attacker.lifeSteal) || 0, 0, 0.6);
  const healingBonus = Number(attacker.healingBonus) || 0;
  const healingReduction = Number(defender.healingReduction) || 0;
  const healingMultiplier = clamp(1 + healingBonus - healingReduction, 0, 2);
  const heal = Math.max(0, damage * lifeSteal * healingMultiplier);

  return { damage, crit, dodged: false, heal };
}

function calculateBattleRewards(attributes, enemy, { victory, draw, enemyStats }) {
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

  const insight = (attributes.baseTotals && attributes.baseTotals.insight) || 0;
  const insightBonus = Math.min(0.25, insight * 0.002);
  const stones = Math.round(baseStones * (1 + insightBonus / 2));
  const attributePoints = rewardConfig.attributePoints || 0;
  const loot = resolveBattleLoot(enemy.loot || [], insight);
  return { exp: 0, stones, attributePoints, loot };
}

function resolveBattleLoot(loot, insight) {
  if (!Array.isArray(loot) || !loot.length) {
    return [];
  }
  const results = [];
  loot.forEach((item) => {
    const chance = item.chance || 0;
    const insightBonus = Math.min(0.2, insight * 0.0015);
    const roll = Math.random();
    if (roll < chance + insightBonus) {
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
    return Number(Math.max(0, Math.min(0.95, value)).toFixed(4));
  }
  if (key === 'critDamage') {
    return Number(Math.max(1.2, value).toFixed(2));
  }
  if (key === 'finalDamageBonus') {
    return Number(Math.max(-0.5, Math.min(1.5, value)).toFixed(4));
  }
  if (key === 'finalDamageReduction') {
    return Number(Math.max(0, Math.min(0.9, value)).toFixed(4));
  }
  if (key === 'lifeSteal') {
    return Number(Math.max(0, Math.min(0.6, value)).toFixed(4));
  }
  if (key === 'healingBonus' || key === 'healingReduction') {
    return Number(value.toFixed(4));
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
  if (
    key === 'finalDamageBonus' ||
    key === 'finalDamageReduction' ||
    key === 'lifeSteal' ||
    key === 'healingBonus' ||
    key === 'healingReduction'
  ) {
    return `${prefix}${Math.round(abs * 10000) / 100}%`;
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
