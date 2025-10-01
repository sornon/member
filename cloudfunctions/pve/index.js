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

const STORAGE_CATEGORY_DEFINITIONS = [
  { key: 'equipment', label: '装备', baseCapacity: 100, perUpgrade: 20 },
  { key: 'quest', label: '任务', baseCapacity: 100, perUpgrade: 20 },
  { key: 'material', label: '材料', baseCapacity: 100, perUpgrade: 20 },
  { key: 'consumable', label: '道具', baseCapacity: 100, perUpgrade: 20 }
];
const STORAGE_CATEGORY_KEYS = STORAGE_CATEGORY_DEFINITIONS.map((item) => item.key);
const STORAGE_DEFAULT_BASE_CAPACITY =
  STORAGE_CATEGORY_DEFINITIONS.length > 0 ? STORAGE_CATEGORY_DEFINITIONS[0].baseCapacity : 100;
const STORAGE_DEFAULT_PER_UPGRADE =
  STORAGE_CATEGORY_DEFINITIONS.length > 0 ? STORAGE_CATEGORY_DEFINITIONS[0].perUpgrade : 20;

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
  'critResist',
  'finalDamageBonus',
  'finalDamageReduction',
  'lifeSteal',
  'healingBonus',
  'healingReduction',
  'controlHit',
  'controlResist',
  'physicalPenetration',
  'magicPenetration',
  'comboRate',
  'block',
  'counterRate',
  'damageReduction',
  'healingReceived',
  'rageGain',
  'controlStrength',
  'shieldPower',
  'summonPower',
  'elementalVulnerability'
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
  critResist: '抗暴击',
  finalDamageBonus: '最终增伤',
  finalDamageReduction: '最终减伤',
  lifeSteal: '吸血',
  healingBonus: '治疗强化',
  healingReduction: '治疗削弱',
  controlHit: '控制命中',
  controlResist: '控制抗性',
  physicalPenetration: '破甲',
  magicPenetration: '法穿',
  comboRate: '连击率',
  block: '格挡',
  counterRate: '反击率',
  damageReduction: '减伤',
  healingReceived: '受疗加成',
  rageGain: '怒气获取',
  controlStrength: '控制强度',
  shieldPower: '护盾强度',
  summonPower: '召唤物强度',
  elementalVulnerability: '元素易伤'
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

const EQUIPMENT_SLOTS = {
  weapon: {
    key: 'weapon',
    label: '武器',
    mainAttributes: [
      { key: 'physicalAttack', weight: 50, coefficient: 1.2 },
      { key: 'finalDamageBonus', weight: 35, coefficient: 1 },
      { key: 'comboRate', weight: 15, coefficient: 1 }
    ],
    subTags: ['offense', 'crit', 'speed']
  },
  helm: {
    key: 'helm',
    label: '头部',
    mainAttributes: [
      { key: 'physicalDefense', weight: 45, coefficient: 1.05 },
      { key: 'magicDefense', weight: 35, coefficient: 1.05 },
      { key: 'block', weight: 20, coefficient: 1 }
    ],
    subTags: ['defense', 'control', 'support']
  },
  chest: {
    key: 'chest',
    label: '衣服',
    mainAttributes: [
      { key: 'maxHpMultiplier', weight: 40, coefficient: 1.1 },
      { key: 'damageReduction', weight: 40, coefficient: 1.05 },
      { key: 'shieldPower', weight: 20, coefficient: 1 }
    ],
    subTags: ['defense', 'support']
  },
  boots: {
    key: 'boots',
    label: '鞋履',
    mainAttributes: [
      { key: 'speed', weight: 60, coefficient: 1.15 },
      { key: 'dodge', weight: 25, coefficient: 1.05 },
      { key: 'accuracy', weight: 15, coefficient: 1 }
    ],
    subTags: ['speed', 'evasion', 'control']
  },
  belt: {
    key: 'belt',
    label: '腰带',
    mainAttributes: [
      { key: 'maxHpMultiplier', weight: 40, coefficient: 1 },
      { key: 'healingReceived', weight: 30, coefficient: 1 },
      { key: 'healingBonus', weight: 30, coefficient: 1 }
    ],
    subTags: ['defense', 'support']
  },
  bracer: {
    key: 'bracer',
    label: '护腕',
    mainAttributes: [
      { key: 'physicalAttack', weight: 50, coefficient: 1 },
      { key: 'counterRate', weight: 30, coefficient: 1 },
      { key: 'block', weight: 20, coefficient: 1 }
    ],
    subTags: ['offense', 'crit', 'defense']
  },
  orb: {
    key: 'orb',
    label: '宝珠',
    mainAttributes: [
      { key: 'magicAttack', weight: 45, coefficient: 1.15 },
      { key: 'controlHit', weight: 35, coefficient: 1.05 },
      { key: 'finalDamageBonus', weight: 20, coefficient: 1 }
    ],
    subTags: ['arcane', 'control', 'support']
  },
  necklace: {
    key: 'necklace',
    label: '项圈',
    mainAttributes: [
      { key: 'controlHit', weight: 40, coefficient: 1 },
      { key: 'healingBonus', weight: 35, coefficient: 1 },
      { key: 'rageGain', weight: 25, coefficient: 1 }
    ],
    subTags: ['support', 'control', 'speed']
  },
  token: {
    key: 'token',
    label: '信物',
    mainAttributes: [
      { key: 'allAttributes', weight: 50, coefficient: 1 },
      { key: 'damageReduction', weight: 30, coefficient: 1 },
      { key: 'shieldPower', weight: 20, coefficient: 1 }
    ],
    subTags: ['support', 'defense']
  },
  puppet: {
    key: 'puppet',
    label: '傀儡',
    mainAttributes: [
      { key: 'counterRate', weight: 35, coefficient: 1 },
      { key: 'shieldPower', weight: 35, coefficient: 1 },
      { key: 'summonPower', weight: 30, coefficient: 1 }
    ],
    subTags: ['defense', 'support']
  },
  focus: {
    key: 'focus',
    label: '法器',
    mainAttributes: [
      { key: 'magicAttack', weight: 45, coefficient: 1.1 },
      { key: 'finalDamageBonus', weight: 35, coefficient: 1.05 },
      { key: 'elementalVulnerability', weight: 20, coefficient: 1 }
    ],
    subTags: ['arcane', 'offense', 'control']
  },
  treasure: {
    key: 'treasure',
    label: '秘宝',
    mainAttributes: [
      { key: 'finalDamageBonus', weight: 28, coefficient: 1.05 },
      { key: 'finalDamageReduction', weight: 20, coefficient: 1 },
      { key: 'damageReduction', weight: 18, coefficient: 1 },
      { key: 'shieldPower', weight: 8, coefficient: 1 },
      { key: 'critRate', weight: 16, coefficient: 1 },
      { key: 'critResist', weight: 10, coefficient: 1 }
    ],
    subTags: ['offense', 'defense', 'support']
  }
};

const EQUIPMENT_SLOT_LABELS = Object.keys(EQUIPMENT_SLOTS).reduce((map, key) => {
  map[key] = EQUIPMENT_SLOTS[key].label;
  return map;
}, {});

const IGNORED_EQUIPMENT_SLOTS = new Set(['accessory', 'armor']);

function isIgnoredEquipmentSlot(slot) {
  return typeof slot === 'string' && IGNORED_EQUIPMENT_SLOTS.has(slot);
}

const EQUIPMENT_QUALITY_CONFIG = {
  mortal: { key: 'mortal', label: '凡品', color: '#8d9099', mainCoefficient: 0.8, subCount: 0, subTierRange: ['common'], dropWeight: 42 },
  inferior: { key: 'inferior', label: '下品', color: '#63a86c', mainCoefficient: 1, subCount: 0, subTierRange: ['common'], dropWeight: 34 },
  standard: { key: 'standard', label: '中品', color: '#3c9bd4', mainCoefficient: 1.1, subCount: 1, subTierRange: ['common'], dropWeight: 28 },
  superior: { key: 'superior', label: '上品', color: '#7f6bff', mainCoefficient: 1.25, subCount: 1, subTierRange: ['common', 'rare'], dropWeight: 18 },
  excellent: { key: 'excellent', label: '极品', color: '#ff985a', mainCoefficient: 1.4, subCount: 2, subTierRange: ['common', 'rare'], dropWeight: 12 },
  immortal: { key: 'immortal', label: '仙品', color: '#f05d7d', mainCoefficient: 1.6, subCount: 2, subTierRange: ['common', 'rare', 'advanced'], dropWeight: 6 },
  perfect: { key: 'perfect', label: '完美', color: '#d4a93c', mainCoefficient: 1.85, subCount: 2, subTierRange: ['rare', 'advanced'], dropWeight: 3 },
  primordial: { key: 'primordial', label: '先天', color: '#f7baff', mainCoefficient: 2.05, subCount: 3, subTierRange: ['rare', 'advanced', 'legendary'], dropWeight: 1 },
  relic: {
    key: 'relic',
    label: '至宝',
    color: '#6cf4ff',
    mainCoefficient: 2.3,
    subCount: 3,
    subTierRange: ['advanced', 'legendary'],
    guaranteeLegendaryAffix: true,
    dropWeight: 0.2
  }
};

const EQUIPMENT_AFFIX_TIER_MULTIPLIER = {
  common: 0.85,
  rare: 1,
  advanced: 1.25,
  legendary: 1.55
};

const EQUIPMENT_ATTRIBUTE_RULES = {
  physicalAttack: { type: 'flat', base: 32, perLevel: 6.4, precision: 0 },
  magicAttack: { type: 'flat', base: 32, perLevel: 6.4, precision: 0 },
  physicalDefense: { type: 'flat', base: 26, perLevel: 4.2, precision: 0 },
  magicDefense: { type: 'flat', base: 26, perLevel: 4.2, precision: 0 },
  maxHp: { type: 'flat', base: 420, perLevel: 70, precision: 0 },
  maxHpMultiplier: { type: 'percent', base: 0.08, perLevel: 0.0025, precision: 4 },
  finalDamageBonus: { type: 'percent', base: 0.05, perLevel: 0.0018, precision: 4 },
  finalDamageReduction: { type: 'percent', base: 0.04, perLevel: 0.0016, precision: 4 },
  comboRate: { type: 'percent', base: 0.08, perLevel: 0.0022, precision: 4 },
  block: { type: 'percent', base: 0.1, perLevel: 0.0022, precision: 4 },
  counterRate: { type: 'percent', base: 0.12, perLevel: 0.0024, precision: 4 },
  damageReduction: { type: 'percent', base: 0.12, perLevel: 0.0024, precision: 4 },
  critRate: { type: 'percent', base: 0.05, perLevel: 0.0015, precision: 4 },
  critResist: { type: 'percent', base: 0.04, perLevel: 0.0012, precision: 4 },
  speed: { type: 'flat', base: 22, perLevel: 1.5, precision: 0 },
  accuracy: { type: 'flat', base: 18, perLevel: 1.4, precision: 0 },
  dodge: { type: 'flat', base: 20, perLevel: 1.6, precision: 0 },
  controlHit: { type: 'flat', base: 28, perLevel: 2.4, precision: 0 },
  controlResist: { type: 'flat', base: 24, perLevel: 2.2, precision: 0 },
  controlStrength: { type: 'percent', base: 0.09, perLevel: 0.0023, precision: 4 },
  healingBonus: { type: 'percent', base: 0.1, perLevel: 0.0025, precision: 4 },
  healingReceived: { type: 'percent', base: 0.1, perLevel: 0.0025, precision: 4 },
  rageGain: { type: 'percent', base: 0.14, perLevel: 0.003, precision: 4 },
  shieldPower: { type: 'percent', base: 0.14, perLevel: 0.003, precision: 4 },
  summonPower: { type: 'percent', base: 0.14, perLevel: 0.0032, precision: 4 },
  elementalVulnerability: { type: 'percent', base: 0.12, perLevel: 0.0026, precision: 4 },
  bonusDamage: { type: 'flat', base: 90, perLevel: 12, precision: 0 },
  shield: { type: 'flat', base: 220, perLevel: 28, precision: 0 },
  dodgeChance: { type: 'percent', base: 0.08, perLevel: 0.0018, precision: 4 },
  lifeSteal: { type: 'percent', base: 0.06, perLevel: 0.0016, precision: 4 },
  physicalPenetration: { type: 'flat', base: 22, perLevel: 2.2, precision: 0 },
  magicPenetration: { type: 'flat', base: 22, perLevel: 2.2, precision: 0 },
  constitution: { type: 'flat', base: 18, perLevel: 2.2, precision: 0 },
  strength: { type: 'flat', base: 18, perLevel: 2.2, precision: 0 },
  spirit: { type: 'flat', base: 18, perLevel: 2.2, precision: 0 },
  root: { type: 'flat', base: 18, perLevel: 2.2, precision: 0 },
  agility: { type: 'flat', base: 18, perLevel: 2, precision: 0 },
  insight: { type: 'flat', base: 18, perLevel: 2, precision: 0 },
  allAttributes: { type: 'composite', base: 8, perLevel: 1.6, precision: 0, components: BASE_ATTRIBUTE_KEYS }
};

const EQUIPMENT_AFFIX_RULES = {
  physicalAttack: { key: 'physicalAttack', tags: ['offense'], scale: 0.55 },
  magicAttack: { key: 'magicAttack', tags: ['offense', 'arcane'], scale: 0.55 },
  physicalDefense: { key: 'physicalDefense', tags: ['defense'], scale: 0.6 },
  magicDefense: { key: 'magicDefense', tags: ['defense'], scale: 0.6 },
  maxHp: { key: 'maxHp', tags: ['defense'], scale: 0.5 },
  maxHpMultiplier: { key: 'maxHpMultiplier', tags: ['defense', 'support'], scale: 0.6 },
  finalDamageBonus: { key: 'finalDamageBonus', tags: ['offense', 'arcane'], scale: 0.55 },
  finalDamageReduction: { key: 'finalDamageReduction', tags: ['defense'], scale: 0.55 },
  damageReduction: { key: 'damageReduction', tags: ['defense'], scale: 0.55 },
  critRate: { key: 'critRate', tags: ['offense', 'crit'], scale: 0.7 },
  critDamage: { key: 'critDamage', tags: ['offense', 'crit'], scale: 0.75 },
  critResist: { key: 'critResist', tags: ['defense'], scale: 0.6 },
  comboRate: { key: 'comboRate', tags: ['offense', 'crit'], scale: 0.65 },
  speed: { key: 'speed', tags: ['speed'], scale: 0.6 },
  dodge: { key: 'dodge', tags: ['speed', 'evasion'], scale: 0.6 },
  accuracy: { key: 'accuracy', tags: ['speed', 'control'], scale: 0.55 },
  controlHit: { key: 'controlHit', tags: ['control'], scale: 0.65 },
  controlResist: { key: 'controlResist', tags: ['defense', 'control'], scale: 0.6 },
  controlStrength: { key: 'controlStrength', tags: ['control'], scale: 0.7 },
  block: { key: 'block', tags: ['defense'], scale: 0.65 },
  counterRate: { key: 'counterRate', tags: ['defense', 'offense'], scale: 0.65 },
  shieldPower: { key: 'shieldPower', tags: ['defense', 'support'], scale: 0.7 },
  summonPower: { key: 'summonPower', tags: ['support'], scale: 0.7 },
  healingBonus: { key: 'healingBonus', tags: ['support'], scale: 0.7 },
  healingReceived: { key: 'healingReceived', tags: ['support', 'defense'], scale: 0.7 },
  rageGain: { key: 'rageGain', tags: ['support', 'speed'], scale: 0.65 },
  elementalVulnerability: { key: 'elementalVulnerability', tags: ['offense', 'arcane'], scale: 0.65 },
  lifeSteal: { key: 'lifeSteal', tags: ['offense', 'support'], scale: 0.6 },
  physicalPenetration: { key: 'physicalPenetration', tags: ['offense'], scale: 0.6 },
  magicPenetration: { key: 'magicPenetration', tags: ['offense', 'arcane'], scale: 0.6 },
  bonusDamage: { key: 'bonusDamage', tags: ['offense'], scale: 0.5 },
  shield: { key: 'shield', tags: ['defense', 'support'], scale: 0.5 },
  dodgeChance: { key: 'dodgeChance', tags: ['evasion'], scale: 0.55 },
  constitution: { key: 'constitution', tags: ['defense'], scale: 0.5 },
  strength: { key: 'strength', tags: ['offense'], scale: 0.5 },
  spirit: { key: 'spirit', tags: ['support', 'arcane'], scale: 0.5 },
  root: { key: 'root', tags: ['defense'], scale: 0.5 },
  agility: { key: 'agility', tags: ['speed'], scale: 0.5 },
  insight: { key: 'insight', tags: ['control', 'crit'], scale: 0.5 },
  allAttributes: { key: 'allAttributes', tags: ['support'], scale: 0.5 }
};

const EQUIPMENT_SET_LIBRARY = {
  berserker_shadow: {
    id: 'berserker_shadow',
    name: '狂暴之影',
    bonuses: {
      2: {
        stats: { critRate: 0.15, critDamage: 0.25 },
        description: '暴击率 +15%，暴击伤害 +25%'
      },
      4: {
        stats: { finalDamageBonus: 0.1 },
        description:
          '暴击后触发 60% 概率的追加攻击，追加攻击享受 50% 最终增伤，并在 5 秒内获得额外 10% 最终增伤（不可叠加）。',
        notes: ['追加攻击继承暴击与连击判定', '额外增伤持续期间仅刷新，不叠加']
      }
    }
  },
  immovable_bulwark: {
    id: 'immovable_bulwark',
    name: '不动壁垒',
    bonuses: {
      2: {
        stats: { maxHpMultiplier: 0.22, damageReduction: 0.15 },
        description: '生命上限 +22%，减伤 +15%'
      },
      4: {
        stats: { counterRate: 0.4, shieldPower: 0.2 },
        description: '受击必定反击（冷却 1 回合），反击伤害 +60%，触发时自身获得 20% 格挡（2 回合）。',
        notes: ['反击冷却 1 回合，无法叠加', '格挡加成可被驱散']
      }
    }
  },
  swift_convergence: {
    id: 'swift_convergence',
    name: '迅疾震慑',
    bonuses: {
      2: {
        stats: { speedMultiplier: 0.22, controlHitMultiplier: 0.18 },
        description: '速度 +22%，控制命中 +18%'
      },
      4: {
        stats: { controlStrength: 0.12 },
        description:
          '先手施加控制后延长 1 回合；若控制失败，自身立即获得 30% 速度加成和 20% 控制命中（持续 1 回合）。',
        notes: ['延长效果对免疫目标无效', '失败补偿的增益不可叠加']
      }
    }
  },
  sacred_aegis: {
    id: 'sacred_aegis',
    name: '圣愈庇护',
    bonuses: {
      2: {
        stats: { healingBonus: 0.25, healingReceived: 0.15 },
        description: '治疗量 +25%，受疗 +15%'
      },
      4: {
        stats: { damageReduction: 0.12, healingReduction: -0.25 },
        description: '我方获得治疗时赋予 12% 减伤庇护（可叠 3 层），同时敌方受疗 -25%。',
        notes: ['庇护效果最多叠加 3 层', '减疗效果对首领单位折半']
      }
    }
  },
  shadow_maze: {
    id: 'shadow_maze',
    name: '影缚迷踪',
    bonuses: {
      2: {
        stats: { dodgeMultiplier: 0.18, accuracyMultiplier: 0.1 },
        description: '闪避 +18%，命中 +10%'
      },
      4: {
        stats: { physicalPenetration: 35 },
        description: '闪避成功后 2 秒内速度 +30%，下一次攻击附带 50% 破甲；若命中目标触发控制，延长控制 0.5 回合。',
        notes: ['破甲效果以实际命中判定为准', '延长控制仅对非免疫目标生效']
      }
    }
  },
  scorching_inferno: {
    id: 'scorching_inferno',
    name: '灼心焚天',
    bonuses: {
      2: {
        stats: { magicAttackMultiplier: 0.2, finalDamageBonus: 0.1 },
        description: '道法伤害 +20%，最终增伤 +10%'
      },
      4: {
        stats: { elementalVulnerability: 0.12, finalDamageBonus: 0.12 },
        description: '技能命中时点燃目标，使其在 3 秒内承受额外 12% 最终伤害，并降低其火焰抗性 15%。',
        notes: ['点燃效果不可叠加，仅刷新持续时间']
      }
    }
  }
};

const EQUIPMENT_LIBRARY = [
  {
    id: 'mortal_weapon_staff',
    name: '青竹练气杖',
    slot: 'weapon',
    quality: 'mortal',
    levelRequirement: 1,
    description: '青竹制成的入门木杖，帮助新修士稳定出手。',
    mainAttribute: { key: 'physicalAttack', coefficient: 0.98 },
    tags: ['凡品', '入门'],
    refineScale: 0.04
  },
  {
    id: 'mortal_weapon_sabre',
    name: '赤铜灵锋',
    slot: 'weapon',
    quality: 'mortal',
    levelRequirement: 4,
    description: '赤铜淬炼的短刃，注重攻击倍率的稳步提升。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.26 },
    tags: ['凡品', '进阶'],
    refineScale: 0.04
  },
  {
    id: 'mortal_weapon_crossbow',
    name: '飞星散弩',
    slot: 'weapon',
    quality: 'mortal',
    levelRequirement: 7,
    description: '便携散弩，鼓励修士在圆满阶段尝试连击。',
    mainAttribute: { key: 'comboRate', coefficient: 0.6 },
    tags: ['凡品', '连击'],
    refineScale: 0.04
  },
  {
    id: 'mortal_helm_headband',
    name: '羊皮束额',
    slot: 'helm',
    quality: 'mortal',
    levelRequirement: 1,
    description: '柔软羊皮束额，可缓解早期副本的物理冲击。',
    mainAttribute: { key: 'physicalDefense', coefficient: 0.93 },
    tags: ['凡品', '防御'],
    refineScale: 0.04
  },
  {
    id: 'mortal_helm_veil',
    name: '凝露纱冠',
    slot: 'helm',
    quality: 'mortal',
    levelRequirement: 4,
    description: '缀有凝露的纱冠，加强对灵力怪物的抵抗力。',
    mainAttribute: { key: 'magicDefense', coefficient: 0.76 },
    tags: ['凡品', '法防'],
    refineScale: 0.04
  },
  {
    id: 'mortal_helm_mask',
    name: '烁纹面甲',
    slot: 'helm',
    quality: 'mortal',
    levelRequirement: 7,
    description: '烁纹雕刻的面甲，搭配反击流提升格挡。',
    mainAttribute: { key: 'block', coefficient: 0.6 },
    tags: ['凡品', '格挡'],
    refineScale: 0.04
  },
  {
    id: 'mortal_chest_robe',
    name: '初阳布袍',
    slot: 'chest',
    quality: 'mortal',
    levelRequirement: 1,
    description: '轻薄布袍，为新手提供基础生命倍率。',
    mainAttribute: { key: 'maxHpMultiplier', coefficient: 0.71 },
    tags: ['凡品', '耐久'],
    refineScale: 0.04
  },
  {
    id: 'mortal_chest_plate',
    name: '定岩护甲',
    slot: 'chest',
    quality: 'mortal',
    levelRequirement: 4,
    description: '以山岩为芯的护甲，强调中期的防御倍率。',
    mainAttribute: { key: 'damageReduction', coefficient: 0.55 },
    tags: ['凡品', '减伤'],
    refineScale: 0.04
  },
  {
    id: 'mortal_chest_mantle',
    name: '沁灵罩衣',
    slot: 'chest',
    quality: 'mortal',
    levelRequirement: 7,
    description: '沁灵纹路的罩衣，强化护盾相关词条。',
    mainAttribute: { key: 'shieldPower', coefficient: 0.6 },
    tags: ['凡品', '护盾'],
    refineScale: 0.04
  },
  {
    id: 'mortal_boots_cloth',
    name: '踪风布鞋',
    slot: 'boots',
    quality: 'mortal',
    levelRequirement: 1,
    description: '布鞋轻盈，帮助修士在炼气初期抢占先手。',
    mainAttribute: { key: 'speed', coefficient: 0.7 },
    tags: ['凡品', '速度'],
    refineScale: 0.04
  },
  {
    id: 'mortal_boots_lightstep',
    name: '翎痕轻履',
    slot: 'boots',
    quality: 'mortal',
    levelRequirement: 4,
    description: '镶嵌羽翎的轻履，引导中期尝试闪避流。',
    mainAttribute: { key: 'dodge', coefficient: 0.6 },
    tags: ['凡品', '闪避'],
    refineScale: 0.04
  },
  {
    id: 'mortal_boots_balance',
    name: '乾衡行靴',
    slot: 'boots',
    quality: 'mortal',
    levelRequirement: 7,
    description: '行靴稳固脚步，在圆满阶段补足命中阈值。',
    mainAttribute: { key: 'accuracy', coefficient: 0.71 },
    tags: ['凡品', '命中'],
    refineScale: 0.04
  },
  {
    id: 'mortal_belt_rope',
    name: '绳结束带',
    slot: 'belt',
    quality: 'mortal',
    levelRequirement: 1,
    description: '朴素束带，搭配衣装提升基础生命。',
    mainAttribute: { key: 'maxHpMultiplier', coefficient: 0.6 },
    tags: ['凡品', '生命'],
    refineScale: 0.04
  },
  {
    id: 'mortal_belt_ring',
    name: '知风木环',
    slot: 'belt',
    quality: 'mortal',
    levelRequirement: 4,
    description: '木环刻录风纹，提高治疗端的受疗系数。',
    mainAttribute: { key: 'healingReceived', coefficient: 0.58 },
    tags: ['凡品', '治疗'],
    refineScale: 0.04
  },
  {
    id: 'mortal_belt_wrap',
    name: '灵息法缠',
    slot: 'belt',
    quality: 'mortal',
    levelRequirement: 7,
    description: '灵息缠绕的腰带，让治疗在圆满阶段更稳定。',
    mainAttribute: { key: 'healingBonus', coefficient: 0.63 },
    tags: ['凡品', '治疗'],
    refineScale: 0.04
  },
  {
    id: 'mortal_bracer_stone',
    name: '砭石护腕',
    slot: 'bracer',
    quality: 'mortal',
    levelRequirement: 1,
    description: '镶嵌砭石的护腕，强化初段的基础攻击。',
    mainAttribute: { key: 'physicalAttack', coefficient: 0.94 },
    tags: ['凡品', '输出'],
    refineScale: 0.04
  },
  {
    id: 'mortal_bracer_echo',
    name: '回鸣臂缚',
    slot: 'bracer',
    quality: 'mortal',
    levelRequirement: 4,
    description: '回声灵纹缠绕的臂缚，中段尝试反击流派。',
    mainAttribute: { key: 'counterRate', coefficient: 0.52 },
    tags: ['凡品', '反击'],
    refineScale: 0.04
  },
  {
    id: 'mortal_bracer_leaf',
    name: '护山叶铠',
    slot: 'bracer',
    quality: 'mortal',
    levelRequirement: 7,
    description: '以灵叶铸成的护臂，兼顾格挡与防御。',
    mainAttribute: { key: 'block', coefficient: 0.51 },
    tags: ['凡品', '格挡'],
    refineScale: 0.04
  },
  {
    id: 'mortal_orb_amber',
    name: '琥珀聚灵',
    slot: 'orb',
    quality: 'mortal',
    levelRequirement: 1,
    description: '琥珀封存灵息，巩固法系入门的法攻基数。',
    mainAttribute: { key: 'magicAttack', coefficient: 1.02 },
    tags: ['凡品', '术法'],
    refineScale: 0.04
  },
  {
    id: 'mortal_orb_calm',
    name: '清魂定珠',
    slot: 'orb',
    quality: 'mortal',
    levelRequirement: 4,
    description: '清魂之珠，中期堆叠控制命中的关键素材。',
    mainAttribute: { key: 'controlHit', coefficient: 0.36 },
    tags: ['凡品', '控制'],
    refineScale: 0.04
  },
  {
    id: 'mortal_orb_flame',
    name: '炎脉注灵',
    slot: 'orb',
    quality: 'mortal',
    levelRequirement: 7,
    description: '灌注炎脉的灵珠，让术法输出获得额外加成。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.11 },
    tags: ['凡品', '术法'],
    refineScale: 0.04
  },
  {
    id: 'mortal_necklace_rune',
    name: '灵纹索坠',
    slot: 'necklace',
    quality: 'mortal',
    levelRequirement: 1,
    description: '灵纹牵引心神，为控制职业提供命中底座。',
    mainAttribute: { key: 'controlHit', coefficient: 0.42 },
    tags: ['凡品', '控制'],
    refineScale: 0.04
  },
  {
    id: 'mortal_necklace_care',
    name: '慈流颈环',
    slot: 'necklace',
    quality: 'mortal',
    levelRequirement: 4,
    description: '慈流回旋的颈环，中期治疗的稳固支点。',
    mainAttribute: { key: 'healingBonus', coefficient: 0.6 },
    tags: ['凡品', '治疗'],
    refineScale: 0.04
  },
  {
    id: 'mortal_necklace_fang',
    name: '斗志牙牌',
    slot: 'necklace',
    quality: 'mortal',
    levelRequirement: 7,
    description: '铭刻斗志的牙牌，加快怒气循环。',
    mainAttribute: { key: 'rageGain', coefficient: 0.57 },
    tags: ['凡品', '怒气'],
    refineScale: 0.04
  },
  {
    id: 'mortal_token_oath',
    name: '初悟令符',
    slot: 'token',
    quality: 'mortal',
    levelRequirement: 1,
    description: '初悟之人佩戴的令符，平衡六维基础成长。',
    mainAttribute: { key: 'allAttributes', coefficient: 0.94 },
    tags: ['凡品', '平衡'],
    refineScale: 0.04
  },
  {
    id: 'mortal_token_banner',
    name: '碧甲战旗',
    slot: 'token',
    quality: 'mortal',
    levelRequirement: 4,
    description: '小型战旗，为团队提供持续的防御倍率。',
    mainAttribute: { key: 'damageReduction', coefficient: 0.46 },
    tags: ['凡品', '防御'],
    refineScale: 0.04
  },
  {
    id: 'mortal_token_shield',
    name: '灵盾石佩',
    slot: 'token',
    quality: 'mortal',
    levelRequirement: 7,
    description: '灵盾石雕成的佩饰，强化护盾型流派。',
    mainAttribute: { key: 'shieldPower', coefficient: 0.54 },
    tags: ['凡品', '护盾'],
    refineScale: 0.04
  },
  {
    id: 'mortal_puppet_wood',
    name: '木魈守偶',
    slot: 'puppet',
    quality: 'mortal',
    levelRequirement: 1,
    description: '木魈化灵的小傀儡，入门反击流的伙伴。',
    mainAttribute: { key: 'counterRate', coefficient: 0.57 },
    tags: ['凡品', '反击'],
    refineScale: 0.04
  },
  {
    id: 'mortal_puppet_vine',
    name: '雾藤护灵',
    slot: 'puppet',
    quality: 'mortal',
    levelRequirement: 4,
    description: '雾藤缠绕的护灵，为队伍提供额外护盾支援。',
    mainAttribute: { key: 'shieldPower', coefficient: 0.52 },
    tags: ['凡品', '护盾'],
    refineScale: 0.04
  },
  {
    id: 'mortal_puppet_feather',
    name: '羽翎侍从',
    slot: 'puppet',
    quality: 'mortal',
    levelRequirement: 7,
    description: '羽翎构筑的侍灵，提前体验召唤规模化。',
    mainAttribute: { key: 'summonPower', coefficient: 0.55 },
    tags: ['凡品', '召唤'],
    refineScale: 0.04
  },
  {
    id: 'mortal_focus_brush',
    name: '霜毫法笔',
    slot: 'focus',
    quality: 'mortal',
    levelRequirement: 1,
    description: '寒霜之毫制成的法笔，稳固术法基础。',
    mainAttribute: { key: 'magicAttack', coefficient: 1.02 },
    tags: ['凡品', '术法'],
    refineScale: 0.04
  },
  {
    id: 'mortal_focus_mirror',
    name: '银辉法鉴',
    slot: 'focus',
    quality: 'mortal',
    levelRequirement: 4,
    description: '银辉流转的法鉴，中期提升法术强度倍率。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.08 },
    tags: ['凡品', '术法'],
    refineScale: 0.04
  },
  {
    id: 'mortal_focus_bell',
    name: '烈脉骨铃',
    slot: 'focus',
    quality: 'mortal',
    levelRequirement: 7,
    description: '骨铃震荡烈脉，让术法穿透提前成型。',
    mainAttribute: { key: 'magicPenetration', coefficient: 0.043 },
    tags: ['凡品', '法穿'],
    refineScale: 0.04
  },
  {
    id: 'mortal_treasure_dawn',
    name: '破晓灵盘',
    slot: 'treasure',
    quality: 'mortal',
    levelRequirement: 1,
    description: '破晓之光凝成的灵盘，帮助输出突破暴击线。',
    mainAttribute: { key: 'critRate', coefficient: 0.88 },
    tags: ['凡品', '暴击'],
    refineScale: 0.04
  },
  {
    id: 'mortal_treasure_ward',
    name: '守心石印',
    slot: 'treasure',
    quality: 'mortal',
    levelRequirement: 4,
    description: '石印稳固心神，为队伍提供抗暴击保障。',
    mainAttribute: { key: 'critResist', coefficient: 1.18 },
    tags: ['凡品', '抗压'],
    refineScale: 0.04
  },
  {
    id: 'mortal_treasure_flare',
    name: '流火坠玉',
    slot: 'treasure',
    quality: 'mortal',
    levelRequirement: 7,
    description: '流火淬玉之作，圆满阶段的团队减伤核心。',
    mainAttribute: { key: 'damageReduction', coefficient: 0.56 },
    tags: ['凡品', '减伤'],
    refineScale: 0.04
  },
  {
    id: 'novice_sword',
    name: '青竹剑',
    slot: 'weapon',
    quality: 'inferior',
    levelRequirement: 1,
    description: '以万年青竹制成的入门木剑，轻巧易上手。',
    mainAttribute: { key: 'physicalAttack', coefficient: 0.9 },
    subAttributes: [{ key: 'critRate', tier: 'common' }],
    tags: ['入门', '轻灵'],
    refineScale: 0.05
  },
  {
    id: 'apprentice_helm',
    name: '护灵冠',
    slot: 'helm',
    quality: 'inferior',
    levelRequirement: 1,
    description: '镶嵌护灵符的头冠，能稍许缓冲灵识冲击。',
    mainAttribute: { key: 'physicalDefense' },
    subAttributes: [{ key: 'block', tier: 'common' }],
    tags: ['入门', '防护'],
    refineScale: 0.05
  },
  {
    id: 'apprentice_robe',
    name: '灵纹道袍',
    slot: 'chest',
    quality: 'inferior',
    levelRequirement: 1,
    description: '绣有基础灵纹的道袍，可抵挡初阶灵力冲击。',
    mainAttribute: { key: 'maxHpMultiplier', coefficient: 0.9 },
    subAttributes: [{ key: 'damageReduction', tier: 'common' }],
    tags: ['护体'],
    refineScale: 0.05
  },
  {
    id: 'lightstep_boots',
    name: '轻跃靴',
    slot: 'boots',
    quality: 'inferior',
    levelRequirement: 1,
    description: '以妖兽筋骨缝制，令步伐轻盈。',
    mainAttribute: { key: 'speed' },
    subAttributes: [{ key: 'dodge', tier: 'common' }],
    tags: ['身法'],
    refineScale: 0.05
  },
  {
    id: 'spirit_belt',
    name: '聚灵束带',
    slot: 'belt',
    quality: 'inferior',
    levelRequirement: 1,
    description: '束带内缝灵丝，可稳定气血与灵息。',
    mainAttribute: { key: 'healingReceived' },
    subAttributes: [{ key: 'maxHp', tier: 'common' }],
    tags: ['续航'],
    refineScale: 0.05
  },
  {
    id: 'initiate_bracers',
    name: '练骨护腕',
    slot: 'bracer',
    quality: 'inferior',
    levelRequirement: 1,
    description: '用以稳固腕力的皮质护腕。',
    mainAttribute: { key: 'physicalAttack', coefficient: 0.8 },
    subAttributes: [{ key: 'block', tier: 'common' }],
    tags: ['入门'],
    refineScale: 0.05
  },
  {
    id: 'initiate_orb',
    name: '启明灵珠',
    slot: 'orb',
    quality: 'inferior',
    levelRequirement: 1,
    description: '蕴含微量灵光的灵珠，助力凝神。',
    mainAttribute: { key: 'magicAttack', coefficient: 0.9 },
    subAttributes: [{ key: 'controlHit', tier: 'common' }],
    tags: ['入门', '术法'],
    refineScale: 0.05
  },
  {
    id: 'spirit_ring',
    name: '聚灵戒',
    slot: 'necklace',
    quality: 'inferior',
    levelRequirement: 1,
    description: '简易聚灵阵刻印于戒身，辅助修行者凝聚灵气。',
    mainAttribute: { key: 'healingBonus', coefficient: 0.9 },
    subAttributes: [{ key: 'insight', tier: 'common' }],
    tags: ['入门'],
    refineScale: 0.05
  },
  {
    id: 'oath_token',
    name: '誓盟信符',
    slot: 'token',
    quality: 'inferior',
    levelRequirement: 1,
    description: '刻有宗门誓约的信符，激励持有者稳固心性。',
    mainAttribute: { key: 'allAttributes', coefficient: 0.8 },
    subAttributes: [{ key: 'damageReduction', tier: 'common' }],
    tags: ['入门', '团队'],
    refineScale: 0.05
  },
  {
    id: 'wooden_puppet',
    name: '木灵傀儡',
    slot: 'puppet',
    quality: 'inferior',
    levelRequirement: 1,
    description: '木灵催生的简陋傀儡，可在战斗中分担压力。',
    mainAttribute: { key: 'counterRate', coefficient: 0.8 },
    subAttributes: [{ key: 'shieldPower', tier: 'common' }],
    tags: ['入门', '防御'],
    refineScale: 0.05
  },
  {
    id: 'initiate_focus',
    name: '初华法镜',
    slot: 'focus',
    quality: 'inferior',
    levelRequirement: 1,
    description: '以灵晶打磨的法镜，能略微聚焦法力。',
    mainAttribute: { key: 'magicAttack', coefficient: 0.9 },
    subAttributes: [{ key: 'finalDamageBonus', tier: 'common' }],
    tags: ['入门', '术法'],
    refineScale: 0.05
  },
  {
    id: 'initiate_treasure',
    name: '护息秘简',
    slot: 'treasure',
    quality: 'inferior',
    levelRequirement: 1,
    description: '记录呼吸吐纳之法的秘简，护持气机。',
    mainAttribute: { key: 'finalDamageReduction', coefficient: 0.9 },
    subAttributes: [{ key: 'shield', tier: 'common' }],
    tags: ['入门', '护持'],
    refineScale: 0.05
  },
  {
    id: 'spirit_blade',
    name: '灵光剑',
    slot: 'weapon',
    quality: 'superior',
    levelRequirement: 8,
    description: '由灵矿铸造的利刃，剑身流转灵光，出手凌厉。',
    mainAttribute: { key: 'physicalAttack', coefficient: 1.05 },
    subAttributes: [
      { key: 'critRate', tier: 'rare' },
      { key: 'comboRate', tier: 'common' }
    ],
    uniqueEffects: [{ description: '暴击时额外获得 5% 怒气回复。', stats: { rageGain: 0.05 } }],
    setId: 'berserker_shadow',
    tags: ['输出', '暴击'],
    refineScale: 0.07
  },
  {
    id: 'stormwrath_bracers',
    name: '风雷护腕',
    slot: 'bracer',
    quality: 'excellent',
    levelRequirement: 12,
    description: '风雷灵纹交织的护腕，激发近战潜能。',
    mainAttribute: { key: 'comboRate', coefficient: 1.05 },
    subAttributes: [
      { key: 'critDamage', tier: 'rare' },
      { key: 'physicalPenetration', tier: 'rare' }
    ],
    setId: 'berserker_shadow',
    tags: ['爆发', '近战'],
    refineScale: 0.08
  },
  {
    id: 'abyssal_focus',
    name: '渊光法器',
    slot: 'focus',
    quality: 'immortal',
    levelRequirement: 16,
    description: '摄取深渊之光锻造，可撕裂敌方护罩。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.15 },
    subAttributes: [
      { key: 'elementalVulnerability', tier: 'advanced' },
      { key: 'magicPenetration', tier: 'rare' }
    ],
    uniqueEffects: [{ description: '法术命中时额外造成 60 点焚蚀伤害。', stats: { bonusDamage: 60 } }],
    setId: 'berserker_shadow',
    tags: ['术法', '爆发'],
    refineScale: 0.09
  },
  {
    id: 'shadow_talisman',
    name: '影殇秘符',
    slot: 'treasure',
    quality: 'immortal',
    levelRequirement: 18,
    description: '秘符引动阴翳之力，加速连击的节奏。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.1 },
    subAttributes: [
      { key: 'critRate', tier: 'advanced' },
      { key: 'comboRate', tier: 'advanced' }
    ],
    uniqueEffects: [{ description: '连击后 4 秒内暴击率 +12%。', stats: { critRate: 0.12 } }],
    setId: 'berserker_shadow',
    tags: ['暴击', '连击'],
    refineScale: 0.1
  },
  {
    id: 'starsea_mail',
    name: '星海甲',
    slot: 'chest',
    quality: 'superior',
    levelRequirement: 10,
    description: '凝聚星辰碎屑炼制而成，能在战斗中缓释星辉。',
    mainAttribute: { key: 'maxHpMultiplier', coefficient: 1.1 },
    subAttributes: [
      { key: 'damageReduction', tier: 'rare' },
      { key: 'shieldPower', tier: 'rare' }
    ],
    uniqueEffects: [{ description: '每 12 秒获得一层星辉护盾，吸收 180 点伤害。', stats: { shield: 180 } }],
    setId: 'immovable_bulwark',
    tags: ['稳固', '星辉护佑'],
    refineScale: 0.07
  },
  {
    id: 'stoneheart_belt',
    name: '磐心束带',
    slot: 'belt',
    quality: 'excellent',
    levelRequirement: 12,
    description: '以山岳之髓织造，稳如磐石。',
    mainAttribute: { key: 'damageReduction', coefficient: 1.05 },
    subAttributes: [
      { key: 'healingReceived', tier: 'rare' },
      { key: 'block', tier: 'rare' }
    ],
    setId: 'immovable_bulwark',
    tags: ['减伤', '稳固'],
    refineScale: 0.08
  },
  {
    id: 'guardian_token',
    name: '玄龟信物',
    slot: 'token',
    quality: 'immortal',
    levelRequirement: 14,
    description: '玄龟甲片雕琢而成，蕴含坚毅守护之意。',
    mainAttribute: { key: 'allAttributes', coefficient: 1.1 },
    subAttributes: [
      { key: 'shieldPower', tier: 'advanced' },
      { key: 'damageReduction', tier: 'advanced' }
    ],
    uniqueEffects: [{ description: '队友受到控制时，为其提供 8% 减伤（4 秒）。' }],
    setId: 'immovable_bulwark',
    tags: ['团队', '护持'],
    refineScale: 0.09
  },
  {
    id: 'ironwall_puppet',
    name: '铁壁傀儡',
    slot: 'puppet',
    quality: 'excellent',
    levelRequirement: 15,
    description: '以玄铁塑形的防御傀儡，擅长替主人承受攻击。',
    mainAttribute: { key: 'counterRate', coefficient: 1.05 },
    subAttributes: [
      { key: 'shieldPower', tier: 'rare' },
      { key: 'block', tier: 'rare' }
    ],
    uniqueEffects: [{ description: '每次反击额外附带 20% 护盾强化。', stats: { shieldPower: 0.2 } }],
    setId: 'immovable_bulwark',
    tags: ['防御', '反击'],
    refineScale: 0.08
  },
  {
    id: 'void_silk',
    name: '虚丝羽衣',
    slot: 'boots',
    quality: 'superior',
    levelRequirement: 14,
    description: '虚空灵蛛吐丝织就，既轻若鸿羽，又可化去钝击。',
    mainAttribute: { key: 'speed', coefficient: 1.15 },
    subAttributes: [
      { key: 'dodge', tier: 'rare' },
      { key: 'accuracy', tier: 'common' }
    ],
    uniqueEffects: [{ description: '闪避成功后 2 秒内速度 +30%。' }],
    setId: 'swift_convergence',
    tags: ['闪避', '轻盈'],
    refineScale: 0.08
  },
  {
    id: 'chronos_orb',
    name: '缚时宝珠',
    slot: 'orb',
    quality: 'excellent',
    levelRequirement: 16,
    description: '凝练时间碎片，可加速术式的牵引。',
    mainAttribute: { key: 'controlHit', coefficient: 1.1 },
    subAttributes: [
      { key: 'controlStrength', tier: 'rare' },
      { key: 'speed', tier: 'rare' }
    ],
    setId: 'swift_convergence',
    tags: ['控制', '身法'],
    refineScale: 0.09
  },
  {
    id: 'skyline_necklace',
    name: '穹辉项链',
    slot: 'necklace',
    quality: 'excellent',
    levelRequirement: 16,
    description: '项链捕捉高空灵光，激发操控欲望。',
    mainAttribute: { key: 'rageGain', coefficient: 1.1 },
    subAttributes: [
      { key: 'controlHit', tier: 'rare' },
      { key: 'speed', tier: 'rare' }
    ],
    setId: 'swift_convergence',
    tags: ['怒气', '控制'],
    refineScale: 0.09
  },
  {
    id: 'starlit_visor',
    name: '星辉面纱',
    slot: 'helm',
    quality: 'immortal',
    levelRequirement: 17,
    description: '星辉薄纱遮面，令持有者心神澄澈。',
    mainAttribute: { key: 'dodge', coefficient: 1.1 },
    subAttributes: [
      { key: 'controlResist', tier: 'advanced' },
      { key: 'controlHit', tier: 'rare' }
    ],
    setId: 'swift_convergence',
    tags: ['控场', '身法'],
    refineScale: 0.09
  },
  {
    id: 'lumina_belt',
    name: '灵晖腰带',
    slot: 'belt',
    quality: 'excellent',
    levelRequirement: 15,
    description: '储存温润灵光的腰带，庇护队友。',
    mainAttribute: { key: 'healingReceived', coefficient: 1.1 },
    subAttributes: [
      { key: 'healingBonus', tier: 'rare' },
      { key: 'damageReduction', tier: 'rare' }
    ],
    setId: 'sacred_aegis',
    tags: ['治疗', '续航'],
    refineScale: 0.08
  },
  {
    id: 'aegis_orb',
    name: '护华灵珠',
    slot: 'orb',
    quality: 'immortal',
    levelRequirement: 17,
    description: '纯净灵泉凝成的宝珠，回荡治愈乐章。',
    mainAttribute: { key: 'healingBonus', coefficient: 1.2 },
    subAttributes: [
      { key: 'healingReceived', tier: 'advanced' },
      { key: 'shieldPower', tier: 'advanced' }
    ],
    uniqueEffects: [{ description: '治疗暴击时为目标附加 8% 减伤（6 秒）。' }],
    setId: 'sacred_aegis',
    tags: ['治疗', '庇护'],
    refineScale: 0.09
  },
  {
    id: 'serene_token',
    name: '澄心法印',
    slot: 'token',
    quality: 'immortal',
    levelRequirement: 17,
    description: '法印流转安神之力，稳固团队节奏。',
    mainAttribute: { key: 'allAttributes', coefficient: 1.05 },
    subAttributes: [
      { key: 'healingReceived', tier: 'advanced' },
      { key: 'damageReduction', tier: 'rare' }
    ],
    setId: 'sacred_aegis',
    tags: ['团队', '治疗'],
    refineScale: 0.09
  },
  {
    id: 'guardian_puppet',
    name: '圣辉侍灵',
    slot: 'puppet',
    quality: 'perfect',
    levelRequirement: 18,
    description: '圣辉化身的侍灵，为主人抵挡一切创伤。',
    mainAttribute: { key: 'shieldPower', coefficient: 1.15 },
    subAttributes: [
      { key: 'summonPower', tier: 'advanced' },
      { key: 'healingReceived', tier: 'advanced' }
    ],
    uniqueEffects: [{ description: '每 10 秒为生命最低的队友提供 120 点护盾。', stats: { shield: 120 } }],
    setId: 'sacred_aegis',
    tags: ['护盾', '治疗'],
    refineScale: 0.09
  },
  {
    id: 'shade_boots',
    name: '影缚靴',
    slot: 'boots',
    quality: 'immortal',
    levelRequirement: 16,
    description: '暗影织就的靴子，步伐神出鬼没。',
    mainAttribute: { key: 'dodge', coefficient: 1.15 },
    subAttributes: [
      { key: 'speed', tier: 'advanced' },
      { key: 'accuracy', tier: 'rare' }
    ],
    setId: 'shadow_maze',
    tags: ['闪避', '游击'],
    refineScale: 0.09
  },
  {
    id: 'umbra_bracers',
    name: '迷踪护腕',
    slot: 'bracer',
    quality: 'immortal',
    levelRequirement: 16,
    description: '护腕藏匿阴影之力，擅长反制。',
    mainAttribute: { key: 'counterRate', coefficient: 1.1 },
    subAttributes: [
      { key: 'dodge', tier: 'advanced' },
      { key: 'critRate', tier: 'rare' }
    ],
    setId: 'shadow_maze',
    tags: ['反击', '游击'],
    refineScale: 0.09
  },
  {
    id: 'veil_treasure',
    name: '幽幕秘宝',
    slot: 'treasure',
    quality: 'perfect',
    levelRequirement: 18,
    description: '秘宝遮蔽天机，让敌人难以捕捉身形。',
    mainAttribute: { key: 'damageReduction', coefficient: 1.1 },
    subAttributes: [
      { key: 'dodge', tier: 'advanced' },
      { key: 'dodgeChance', tier: 'advanced' }
    ],
    uniqueEffects: [{ description: '闪避成功后下一次攻击附带 50% 破甲。', stats: { physicalPenetration: 30 } }],
    setId: 'shadow_maze',
    tags: ['闪避', '破甲'],
    refineScale: 0.1
  },
  {
    id: 'phantom_focus',
    name: '幻踪法器',
    slot: 'focus',
    quality: 'perfect',
    levelRequirement: 18,
    description: '法器引动幻影之术，擅于扰乱敌阵。',
    mainAttribute: { key: 'elementalVulnerability', coefficient: 1.1 },
    subAttributes: [
      { key: 'controlHit', tier: 'advanced' },
      { key: 'speed', tier: 'rare' }
    ],
    setId: 'shadow_maze',
    tags: ['控场', '游击'],
    refineScale: 0.1
  },
  {
    id: 'dragonbone_sabre',
    name: '龙骨刀',
    slot: 'weapon',
    quality: 'immortal',
    levelRequirement: 18,
    description: '以远古蛟龙之骨打磨而成，刀啸之间风雷激荡。',
    mainAttribute: { key: 'physicalAttack', coefficient: 1.2 },
    subAttributes: [
      { key: 'critDamage', tier: 'advanced' },
      { key: 'finalDamageBonus', tier: 'advanced' },
      { key: 'comboRate', tier: 'rare' }
    ],
    uniqueEffects: [{ description: '释放武技后下一次攻击附带 80 点龙息伤害。', stats: { bonusDamage: 80 } }],
    setId: 'scorching_inferno',
    tags: ['爆发', '传奇猎获'],
    refineScale: 0.1
  },
  {
    id: 'inferno_orb',
    name: '炽心宝珠',
    slot: 'orb',
    quality: 'relic',
    levelRequirement: 20,
    description: '炽烈火心化为宝珠，焚烧一切阻碍。',
    mainAttribute: { key: 'magicAttack', coefficient: 1.25 },
    subAttributes: [
      { key: 'finalDamageBonus', tier: 'legendary' },
      { key: 'elementalVulnerability', tier: 'advanced' },
      { key: 'rageGain', tier: 'advanced' }
    ],
    setId: 'scorching_inferno',
    tags: ['术法', '爆发'],
    refineScale: 0.12
  },
  {
    id: 'ember_focus',
    name: '炽焰法器',
    slot: 'focus',
    quality: 'relic',
    levelRequirement: 20,
    description: '法器内封存不灭的火焰，点燃敌人心魂。',
    mainAttribute: { key: 'elementalVulnerability', coefficient: 1.2 },
    subAttributes: [
      { key: 'finalDamageBonus', tier: 'legendary' },
      { key: 'comboRate', tier: 'advanced' },
      { key: 'magicPenetration', tier: 'advanced' }
    ],
    uniqueEffects: [
      {
        description: '技能命中时点燃目标，使其在 3 秒内承受额外 12% 最终伤害，并降低其火焰抗性 15%。',
        stats: { finalDamageBonus: 0.12, elementalVulnerability: 0.15 }
      }
    ],
    setId: 'scorching_inferno',
    tags: ['焚烧', '术法'],
    refineScale: 0.12
  },
  {
    id: 'phoenix_plume',
    name: '凤羽灵坠',
    slot: 'treasure',
    quality: 'relic',
    levelRequirement: 20,
    description: '传闻采自南明离火凤凰的一缕尾羽，可唤醒血脉之力。',
    mainAttribute: { key: 'finalDamageBonus', coefficient: 1.2 },
    subAttributes: [
      { key: 'critRate', tier: 'legendary' },
      { key: 'critDamage', tier: 'legendary' },
      { key: 'finalDamageReduction', tier: 'advanced' }
    ],
    uniqueEffects: [
      {
        description: '释放必杀技时获得凤凰灼心：6 秒内最终增伤 +15%，生命低于 30% 时额外获得 20% 减伤。',
        stats: { finalDamageBonus: 0.15, damageReduction: 0.2 }
      }
    ],
    setId: 'scorching_inferno',
    tags: ['传说', '高爆发'],
    refineScale: 0.12
  }
];

function resolveEquipmentQualityConfig(quality) {
  return EQUIPMENT_QUALITY_CONFIG[quality] || EQUIPMENT_QUALITY_CONFIG.inferior;
}

function resolveEquipmentQualityLabel(quality) {
  return resolveEquipmentQualityConfig(quality).label;
}

function resolveEquipmentQualityColor(quality) {
  return resolveEquipmentQualityConfig(quality).color;
}

function resolveEquipmentSlotConfig(slot) {
  return EQUIPMENT_SLOTS[slot] || null;
}

function resolveEquipmentAffixRule(key) {
  return EQUIPMENT_AFFIX_RULES[key] || null;
}

function resolveAttributeRule(key) {
  return EQUIPMENT_ATTRIBUTE_RULES[key] || null;
}

function finalizeAttributeValue(rule, value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (!rule) {
    return Math.round(value);
  }
  const precision =
    typeof rule.precision === 'number'
      ? rule.precision
      : rule.type === 'percent'
      ? 4
      : 0;
  if (precision > 0) {
    return Number(value.toFixed(precision));
  }
  return Math.round(value);
}

function computeEquipmentAttributeValue({
  key,
  level,
  qualityMultiplier = 1,
  slotCoefficient = 1,
  scale = 1,
  tierMultiplier = 1,
  variance = 0,
  refineMultiplier = 1
}) {
  if (!key) {
    return null;
  }
  const rule = resolveAttributeRule(key);
  if (!rule) {
    const baseValue = qualityMultiplier * slotCoefficient * scale * tierMultiplier * refineMultiplier * (1 + variance);
    return { key, value: finalizeAttributeValue(null, baseValue), rule: null };
  }
  const base = (rule.base || 0) + (Math.max(1, level) - 1) * (rule.perLevel || 0);
  let value = base * qualityMultiplier * slotCoefficient * scale * tierMultiplier;
  value *= 1 + variance;
  value *= refineMultiplier;
  return { key, value: finalizeAttributeValue(rule, value), rule };
}

function applyComputedAttribute(target, computed) {
  if (!computed || !target) {
    return;
  }
  const { key, value, rule } = computed;
  if (!Number.isFinite(value) || value === 0) {
    return;
  }
  if (rule && rule.type === 'composite' && Array.isArray(rule.components)) {
    rule.components.forEach((component) => {
      target[component] = (target[component] || 0) + value;
    });
    return;
  }
  target[key] = (target[key] || 0) + value;
}

function applyStatValue(target, key, value) {
  if (!target || key == null || value == null || value === 0) {
    return;
  }
  const rule = resolveAttributeRule(key);
  if (rule && rule.type === 'composite' && Array.isArray(rule.components)) {
    rule.components.forEach((component) => {
      target[component] = (target[component] || 0) + value;
    });
    return;
  }
  if (typeof value === 'number' && rule) {
    target[key] = (target[key] || 0) + finalizeAttributeValue(rule, value);
    return;
  }
  target[key] = (target[key] || 0) + value;
}

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

const CONSUMABLE_LIBRARY = [
  {
    id: 'respec_talisman',
    name: '洗点灵符',
    description: '注入灵力的玉符，使用后可额外获得一次洗点机会。',
    effects: { respecAvailable: 1 }
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
      { type: 'skill', skillId: 'phoenix_flare', chance: 0.05 },
      { type: 'consumable', consumableId: 'respec_talisman', chance: 0.08 }
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
const CONSUMABLE_MAP = buildMap(CONSUMABLE_LIBRARY);
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

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';
  const actorId = resolveActorId(OPENID, event);

  switch (action) {
    case 'profile':
      return getProfile(actorId);
    case 'battle':
      return simulateBattle(actorId, event.enemyId);
    case 'drawSkill':
      return drawSkill(actorId);
    case 'equipSkill':
      return equipSkill(actorId, event);
    case 'equipItem':
      return equipItem(actorId, event);
    case 'upgradeStorage':
      return upgradeStorage(actorId, event);
    case 'listEquipmentCatalog':
      return listEquipmentCatalog(actorId);
    case 'adminInspectProfile':
      return inspectProfileForAdmin(actorId, event.memberId);
    case 'grantEquipment':
      return grantEquipment(actorId, event);
    case 'removeEquipment':
      return removeEquipment(actorId, event);
    case 'updateEquipmentAttributes':
      return updateEquipmentAttributes(actorId, event);
    case 'allocatePoints':
      return allocatePoints(actorId, event.allocations || {});
    case 'resetAttributes':
      return resetAttributes(actorId);
    default:
      throw createError('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }
};

async function getProfile(actorId) {
  const member = await ensureMember(actorId);
  const levels = await loadMembershipLevels();
  const profile = await ensurePveProfile(actorId, member, levels);
  return decorateProfile(member, profile);
}

async function simulateBattle(actorId, enemyId) {
  const member = await ensureMember(actorId);
  const levels = await loadMembershipLevels();
  const profile = await ensurePveProfile(actorId, member, levels);
  const enemy = ENEMY_MAP[enemyId];
  if (!enemy) {
    throw createError('ENEMY_NOT_FOUND', '未找到指定的副本目标');
  }

  const battleSetup = buildBattleSetup(profile, enemy);
  const result = runBattleSimulation(battleSetup);

  const now = new Date();
  const updatedProfile = applyBattleOutcome(profile, result, enemy, now, member, levels);
  const updates = { pveProfile: _.set(updatedProfile), updatedAt: now };
  if (result.rewards && result.rewards.stones > 0) {
    updates.stoneBalance = _.inc(result.rewards.stones);
  }

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({ data: updates });

  if (result.rewards && result.rewards.stones > 0) {
    await recordStoneTransaction(actorId, result, enemy, now).catch(() => {});
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

async function drawSkill(actorId) {
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
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

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
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

async function equipSkill(actorId, event) {
  const { skillId, slot } = event;
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
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

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function equipItem(actorId, event) {
  const { itemId, slot: rawSlot } = event;
  const inventoryId =
    event && typeof event.inventoryId === 'string' && event.inventoryId.trim() ? event.inventoryId.trim() : '';
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const inventory = Array.isArray(profile.equipment.inventory) ? profile.equipment.inventory : [];
  const slots =
    profile.equipment && typeof profile.equipment.slots === 'object' && profile.equipment.slots
      ? profile.equipment.slots
      : createEmptySlotMap();

  const slot = typeof rawSlot === 'string' ? rawSlot.trim() : '';

  if (!itemId) {
    if (!slot) {
      throw createError('SLOT_REQUIRED', '请选择要卸下的装备槽位');
    }
    if (!Object.prototype.hasOwnProperty.call(EQUIPMENT_SLOTS, slot)) {
      throw createError('INVALID_SLOT', '装备槽位不存在');
    }
    const currentEntry = slots[slot];
    if (!currentEntry || !currentEntry.itemId) {
      throw createError('SLOT_EMPTY', '该槽位暂无装备');
    }

    slots[slot] = null;
    profile.equipment.slots = slots;

    if (currentEntry) {
      const normalizedEntry = normalizeEquipmentInventoryItem(currentEntry, new Date()) || {
        ...createEquipmentInventoryEntry(currentEntry.itemId, new Date())
      };
      if (normalizedEntry && normalizedEntry.inventoryId) {
        const existingIndex = inventory.findIndex((entry) => entry.inventoryId === normalizedEntry.inventoryId);
        if (existingIndex >= 0) {
          inventory.splice(existingIndex, 1);
        }
      }
      if (normalizedEntry) {
        inventory.push(normalizedEntry);
      }
    }

    const now = new Date();
    profile.battleHistory = appendHistory(
      profile.battleHistory,
      {
        type: 'equipment-change',
        createdAt: now,
        detail: {
          slot,
          itemId: currentEntry.itemId,
          inventoryId: currentEntry.inventoryId || '',
          action: 'unequip'
        }
      },
      MAX_BATTLE_HISTORY
    );

    profile.equipment.inventory = inventory;
    await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
      data: {
        pveProfile: _.set(profile),
        updatedAt: now
      }
    });

    const decorated = decorateProfile(member, profile);
    return { profile: decorated };
  }
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    throw createError('ITEM_NOT_FOUND', '装备不存在');
  }
  let index = -1;
  if (inventoryId) {
    index = inventory.findIndex((entry) => entry.inventoryId === inventoryId);
  }
  if (index < 0) {
    index = inventory.findIndex((entry) => entry.itemId === itemId);
  }
  if (index < 0) {
    throw createError('ITEM_NOT_OWNED', '尚未拥有该装备，无法装备');
  }

  if (slot && slot !== definition.slot) {
    throw createError('SLOT_MISMATCH', '装备与槽位不匹配');
  }

  const now = new Date();
  const entry = inventory.splice(index, 1)[0];
  const normalizedEntry = normalizeEquipmentInventoryItem(entry, now) || createEquipmentInventoryEntry(itemId, now);
  const targetSlot = definition.slot;
  const previous = slots[targetSlot];
  if (previous && previous.itemId) {
    const previousNormalized = normalizeEquipmentInventoryItem(previous, now);
    if (previousNormalized) {
      if (previousNormalized.inventoryId) {
        const existingIndex = inventory.findIndex((record) => record.inventoryId === previousNormalized.inventoryId);
        if (existingIndex >= 0) {
          inventory.splice(existingIndex, 1);
        }
      }
      inventory.push(previousNormalized);
    }
  }
  slots[targetSlot] = normalizedEntry ? { ...normalizedEntry } : null;
  profile.equipment.slots = slots;
  profile.equipment.inventory = inventory;

  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: {
        itemId,
        slot: definition.slot,
        inventoryId: normalizedEntry && normalizedEntry.inventoryId ? normalizedEntry.inventoryId : '',
        action: 'equip'
      }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function upgradeStorage(actorId, event = {}) {
  const category =
    event && typeof event.category === 'string' && event.category.trim() ? event.category.trim() : '';
  if (!category) {
    throw createError('CATEGORY_REQUIRED', '请选择要升级的储物类型');
  }
  if (!STORAGE_CATEGORY_KEYS.includes(category)) {
    throw createError('INVALID_CATEGORY', '储物类型不存在');
  }
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const storage = profile.equipment && typeof profile.equipment.storage === 'object' ? profile.equipment.storage : {};
  const current = Math.max(0, Math.floor(Number(storage.upgrades || 0)));
  const rawAvailable =
    storage && typeof storage.upgradeAvailable !== 'undefined' ? Number(storage.upgradeAvailable) : null;
  const rawLimit = storage && typeof storage.upgradeLimit !== 'undefined' ? Number(storage.upgradeLimit) : null;
  const available =
    rawAvailable !== null && Number.isFinite(rawAvailable) ? Math.max(0, Math.floor(rawAvailable)) : null;
  const limit = rawLimit !== null && Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : null;
  if (available !== null && available <= 0) {
    throw createError('NO_STORAGE_UPGRADES', '储物空间升级次数不足');
  }
  if (limit !== null && current >= limit) {
    throw createError('NO_STORAGE_UPGRADES', '储物空间升级次数不足');
  }
  const next = current + 1;
  const nextAvailable = available !== null ? Math.max(0, available - 1) : null;
  const updatedStorage = { ...storage, upgrades: next };
  if (nextAvailable !== null) {
    updatedStorage.upgradeAvailable = nextAvailable;
  }
  profile.equipment.storage = updatedStorage;
  const now = new Date();
  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });
  const decorated = decorateProfile(member, profile);
  const baseCapacity = STORAGE_DEFAULT_BASE_CAPACITY;
  const perUpgrade = STORAGE_DEFAULT_PER_UPGRADE;
  const capacity = baseCapacity + perUpgrade * next;
  return {
    profile: decorated,
    storage: {
      category,
      upgrades: next,
      capacity,
      upgradeAvailable: nextAvailable,
      upgradeLimit: limit
    }
  };
}

async function allocatePoints(actorId, allocations) {
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
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

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function resetAttributes(actorId) {
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const attrs = profile.attributes || {};
  let available = Math.max(0, Math.floor(Number(attrs.respecAvailable) || 0));
  if (available <= 0) {
    const legacyLimit = Math.max(0, Math.floor(Number(attrs.respecLimit) || 0));
    const legacyUsed = Math.max(0, Math.floor(Number(attrs.respecUsed) || 0));
    available = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
  }
  if (available <= 0) {
    throw createError('NO_RESPEC_AVAILABLE', '洗点次数不足');
  }

  const trained = attrs.trained || {};
  let refundedPoints = 0;
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    const value = Number(trained[key]) || 0;
    const step = findAttributeStep(key) || 1;
    if (step > 0 && value !== 0) {
      refundedPoints += Math.max(0, Math.round(value / step));
    }
    trained[key] = 0;
  });

  attrs.trained = BASE_ATTRIBUTE_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  attrs.attributePoints = Math.max(0, Math.floor(Number(attrs.attributePoints) || 0)) + refundedPoints;
  attrs.respecAvailable = available - 1;
  attrs.respecLimit = 0;
  attrs.respecUsed = 0;
  profile.attributes = attrs;

  const now = new Date();
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'respec',
      createdAt: now,
      detail: { refundedPoints }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function listEquipmentCatalog(actorId) {
  const member = await ensureMember(actorId);
  ensureAdminAccess(member);
  const items = EQUIPMENT_LIBRARY.map((item) => ({
    id: item.id,
    name: item.name,
    slot: item.slot,
    slotLabel: EQUIPMENT_SLOT_LABELS[item.slot] || '',
    quality: item.quality,
    qualityLabel: resolveEquipmentQualityLabel(item.quality),
    qualityColor: resolveEquipmentQualityColor(item.quality),
    levelRequirement: item.levelRequirement || 1,
    tags: item.tags || []
  }));
  return { items };
}

async function inspectProfileForAdmin(actorId, memberId) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);
  const targetId = typeof memberId === 'string' && memberId.trim() ? memberId.trim() : '';
  if (!targetId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }
  const targetMember = await ensureMember(targetId);
  const rawProfile = targetMember.pveProfile;
  if (!rawProfile || typeof rawProfile !== 'object') {
    return { profile: null };
  }
  const now = new Date();
  const normalizedProfile = normalizeProfileWithoutEquipmentDefaults(rawProfile, now);
  const decorated = decorateProfile({ ...targetMember, pveProfile: normalizedProfile }, normalizedProfile);
  return { profile: decorated };
}

async function grantEquipment(actorId, event = {}) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);
  const memberId = typeof event.memberId === 'string' && event.memberId.trim() ? event.memberId.trim() : '';
  if (!memberId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }
  const itemId = typeof event.itemId === 'string' && event.itemId.trim() ? event.itemId.trim() : '';
  if (!itemId) {
    throw createError('ITEM_ID_REQUIRED', '请选择装备');
  }
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    throw createError('ITEM_NOT_FOUND', '装备不存在');
  }
  const targetMember = await ensureMember(memberId);
  const now = new Date();
  const profile = normalizeProfileWithoutEquipmentDefaults(targetMember.pveProfile, now);
  const inventory = Array.isArray(profile.equipment.inventory) ? profile.equipment.inventory : [];
  const entry = createEquipmentInventoryEntry(itemId, now);
  if (!entry) {
    throw createError('ITEM_NOT_FOUND', '装备不存在');
  }
  inventory.push(entry);
  profile.equipment.inventory = inventory;
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: { itemId, slot: definition.slot || '', action: 'grant' }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(memberId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile({ ...targetMember, pveProfile: profile }, profile);
  const granted = decorateEquipmentInventoryEntry(entry, profile.equipment.slots);
  return { profile: decorated, granted };
}

async function removeEquipment(actorId, event = {}) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);
  const memberId = typeof event.memberId === 'string' && event.memberId.trim() ? event.memberId.trim() : '';
  if (!memberId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }
  const itemId = typeof event.itemId === 'string' && event.itemId.trim() ? event.itemId.trim() : '';
  if (!itemId) {
    throw createError('ITEM_ID_REQUIRED', '请选择要删除的装备');
  }
  const inventoryId =
    typeof event.inventoryId === 'string' && event.inventoryId.trim() ? event.inventoryId.trim() : '';
  const targetMember = await ensureMember(memberId);
  const now = new Date();
  const profile = normalizeProfileWithoutEquipmentDefaults(targetMember.pveProfile, now);
  const inventory = Array.isArray(profile.equipment.inventory) ? profile.equipment.inventory : [];
  let index = -1;
  if (inventoryId) {
    index = inventory.findIndex((record) => record.inventoryId === inventoryId);
  }
  if (index < 0) {
    index = inventory.findIndex((record) => record.itemId === itemId);
  }
  if (index < 0) {
    throw createError('ITEM_NOT_FOUND', '会员未拥有该装备');
  }
  const definition = EQUIPMENT_MAP[itemId];
  inventory.splice(index, 1);
  profile.equipment.inventory = inventory;
  const slots =
    profile.equipment && typeof profile.equipment.slots === 'object'
      ? profile.equipment.slots
      : createEmptySlotMap();
  Object.keys(slots).forEach((slotKey) => {
    const slotEntry = slots[slotKey];
    if (!slotEntry) {
      return;
    }
    if (inventoryId) {
      if (slotEntry && slotEntry.inventoryId === inventoryId) {
        slots[slotKey] = null;
      }
      return;
    }
    if (slotEntry.itemId === itemId) {
      slots[slotKey] = null;
    }
  });
  profile.equipment.slots = slots;
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: { itemId, slot: (definition && definition.slot) || '', action: 'remove' }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(memberId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decorated = decorateProfile({ ...targetMember, pveProfile: profile }, profile);
  return { profile: decorated };
}

async function updateEquipmentAttributes(actorId, event = {}) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);
  const memberId = typeof event.memberId === 'string' && event.memberId.trim() ? event.memberId.trim() : '';
  if (!memberId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }
  const itemId = typeof event.itemId === 'string' && event.itemId.trim() ? event.itemId.trim() : '';
  if (!itemId) {
    throw createError('ITEM_ID_REQUIRED', '请选择装备');
  }
  const rawAttributes = event.attributes && typeof event.attributes === 'object' ? { ...event.attributes } : {};
  if (typeof event.refine !== 'undefined' && typeof rawAttributes.refine === 'undefined') {
    rawAttributes.refine = event.refine;
  }
  if (typeof event.level !== 'undefined' && typeof rawAttributes.level === 'undefined') {
    rawAttributes.level = event.level;
  }
  if (typeof event.favorite !== 'undefined' && typeof rawAttributes.favorite === 'undefined') {
    rawAttributes.favorite = event.favorite;
  }
  const inventoryId =
    typeof event.inventoryId === 'string' && event.inventoryId.trim() ? event.inventoryId.trim() : '';
  const targetMember = await ensureMember(memberId);
  const now = new Date();
  const profile = normalizeProfileWithoutEquipmentDefaults(targetMember.pveProfile, now);
  const inventory = Array.isArray(profile.equipment.inventory) ? profile.equipment.inventory : [];
  let index = -1;
  if (inventoryId) {
    index = inventory.findIndex((record) => record.inventoryId === inventoryId);
  }
  if (index < 0) {
    index = inventory.findIndex((record) => record.itemId === itemId);
  }
  if (index < 0) {
    throw createError('ITEM_NOT_FOUND', '会员未拥有该装备');
  }
  const entry = { ...inventory[index] };
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(rawAttributes, 'refine')) {
    const value = Number(rawAttributes.refine);
    const nextRefine = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (entry.refine !== nextRefine) {
      entry.refine = nextRefine;
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawAttributes, 'level')) {
    const value = Number(rawAttributes.level);
    const nextLevel = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
    if (entry.level !== nextLevel) {
      entry.level = nextLevel;
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawAttributes, 'favorite')) {
    const favorite = !!rawAttributes.favorite;
    if (!!entry.favorite !== favorite) {
      entry.favorite = favorite;
      changed = true;
    }
  }
  if (!changed) {
    const decoratedProfile = decorateProfile({ ...targetMember, pveProfile: profile }, profile);
    const updated = decorateEquipmentInventoryEntry(entry, profile.equipment.slots);
    return { profile: decoratedProfile, updated };
  }
  inventory[index] = entry;
  profile.equipment.inventory = inventory;
  const definition = EQUIPMENT_MAP[itemId];
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: {
        itemId,
        slot: (definition && definition.slot) || '',
        action: 'update',
        refine: entry.refine,
        level: entry.level
      }
    },
    MAX_BATTLE_HISTORY
  );

  await db.collection(COLLECTIONS.MEMBERS).doc(memberId).update({
    data: {
      pveProfile: _.set(profile),
      updatedAt: now
    }
  });

  const decoratedProfile = decorateProfile({ ...targetMember, pveProfile: profile }, profile);
  const updated = decorateEquipmentInventoryEntry(entry, profile.equipment.slots);
  return { profile: decoratedProfile, updated };
}

function resolveActorId(openid, event = {}) {
  const fromEvent =
    event && typeof event.actorId === 'string' && event.actorId.trim() ? event.actorId.trim() : '';
  const fromContext = typeof openid === 'string' && openid.trim() ? openid.trim() : '';
  const resolved = fromEvent || fromContext;
  if (!resolved) {
    throw createError('UNAUTHENTICATED', '缺少身份信息');
  }
  return resolved;
}

async function ensureMember(memberId) {
  const normalizedId =
    typeof memberId === 'string'
      ? memberId.trim()
      : typeof memberId === 'number' && Number.isFinite(memberId)
      ? String(memberId)
      : '';

  if (!normalizedId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }

  const snapshot = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(normalizedId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw createError('MEMBER_NOT_FOUND', '会员信息不存在，请先完成注册');
  }
  return snapshot.data;
}

function isAdminMember(member) {
  if (!member || typeof member !== 'object') {
    return false;
  }
  const roles = Array.isArray(member.roles) ? member.roles : [];
  return roles.includes('admin') || roles.includes('developer');
}

function ensureAdminAccess(member) {
  if (!isAdminMember(member)) {
    throw createError('FORBIDDEN', '仅管理员可执行该操作');
  }
}

async function ensurePveProfile(actorId, member, levelCache) {
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
    await db.collection(COLLECTIONS.MEMBERS).doc(actorId).update({
      data: {
        pveProfile: _.set(profile),
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
    respecAvailable: 1,
    realmId: realmPhase.id,
    realmName: realmPhase.name,
    realmShort: realmPhase.short,
    realmBonus
  };
}

function createEmptySlotMap() {
  const slots = {};
  Object.keys(EQUIPMENT_SLOTS).forEach((slot) => {
    slots[slot] = null;
  });
  return slots;
}

function buildDefaultEquipment(now = new Date()) {
  const defaults = [
    'novice_sword',
    'apprentice_helm',
    'apprentice_robe',
    'lightstep_boots',
    'spirit_belt',
    'initiate_bracers',
    'initiate_orb',
    'spirit_ring',
    'oath_token',
    'wooden_puppet',
    'initiate_focus',
    'initiate_treasure'
  ];
  const generated = defaults
    .map((itemId) => createEquipmentInventoryEntry(itemId, now))
    .filter((entry) => !!entry);
  const slots = createEmptySlotMap();
  const inventory = [];
  generated.forEach((entry) => {
    const definition = EQUIPMENT_MAP[entry.itemId];
    if (definition && definition.slot && !slots[definition.slot]) {
      slots[definition.slot] = { ...entry };
    } else {
      inventory.push({ ...entry });
    }
  });
  return { inventory, slots };
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

function normalizeProfileWithoutEquipmentDefaults(profile, now = new Date()) {
  const payload = typeof profile === 'object' && profile ? profile : {};
  return {
    attributes: normalizeAttributes(payload.attributes),
    equipment: normalizeEquipment(payload.equipment, now, { includeDefaults: false }),
    skills: normalizeSkills(payload.skills, now),
    battleHistory: normalizeHistory(payload.battleHistory, MAX_BATTLE_HISTORY),
    skillHistory: normalizeHistory(payload.skillHistory, MAX_SKILL_HISTORY)
  };
}

function normalizeAttributes(attributes) {
  const defaults = buildDefaultAttributes();
  const payload = typeof attributes === 'object' && attributes ? attributes : {};
  const rawAvailable = Number(payload.respecAvailable);
  const hasNewField = Object.prototype.hasOwnProperty.call(payload, 'respecAvailable');
  const hasLegacyField =
    Object.prototype.hasOwnProperty.call(payload, 'respecLimit') ||
    Object.prototype.hasOwnProperty.call(payload, 'respecUsed');
  const normalizedNewField = Number.isFinite(rawAvailable) ? Math.max(0, Math.floor(rawAvailable)) : null;
  const legacyLimit = Math.max(0, Math.floor(Number(payload.respecLimit) || 0));
  const legacyUsed = Math.max(0, Math.floor(Number(payload.respecUsed) || 0));
  const legacyAvailable = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
  let respecAvailable;
  if (hasNewField && normalizedNewField !== null) {
    respecAvailable = normalizedNewField;
  } else if (hasLegacyField) {
    respecAvailable = legacyAvailable;
  } else if (hasNewField) {
    respecAvailable = 0;
  } else {
    respecAvailable = Math.max(0, Math.floor(Number(defaults.respecAvailable || 0)));
  }
  return {
    level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(payload.level) || defaults.level || 1))),
    experience: Math.max(0, Math.floor(Number(payload.experience) || 0)),
    attributePoints: Math.max(0, Math.floor(Number(payload.attributePoints) || 0)),
    respecAvailable,
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

function normalizeEquipment(equipment, now = new Date(), options = {}) {
  const includeDefaults = options && options.includeDefaults !== false;
  const defaults = includeDefaults ? buildDefaultEquipment(now) : { inventory: [], slots: createEmptySlotMap() };
  const payload = typeof equipment === 'object' && equipment ? equipment : {};
  const rawInventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  const normalizedInventory = [];
  const seenInventoryIds = new Set();

  const trackInventory = (entry) => {
    if (!entry || !entry.inventoryId || seenInventoryIds.has(entry.inventoryId)) {
      return;
    }
    normalizedInventory.push(entry);
    seenInventoryIds.add(entry.inventoryId);
  };

  rawInventory.forEach((item) => {
    const normalizedItem = normalizeEquipmentInventoryItem(item, now);
    if (normalizedItem) {
      trackInventory(normalizedItem);
    }
  });

  (defaults.inventory || []).forEach((entry) => {
    if (entry) {
      trackInventory({ ...entry });
    }
  });

  const availableById = new Map();
  const availableByItemId = {};
  normalizedInventory.forEach((entry) => {
    availableById.set(entry.inventoryId, entry);
    if (!availableByItemId[entry.itemId]) {
      availableByItemId[entry.itemId] = [];
    }
    availableByItemId[entry.itemId].push(entry);
  });

  const claimEntry = (entry) => {
    if (!entry || !entry.inventoryId) {
      return entry || null;
    }
    const claimed = availableById.get(entry.inventoryId);
    if (!claimed) {
      return entry;
    }
    availableById.delete(entry.inventoryId);
    const list = availableByItemId[entry.itemId] || [];
    const index = list.findIndex((candidate) => candidate.inventoryId === entry.inventoryId);
    if (index >= 0) {
      list.splice(index, 1);
    }
    return claimed;
  };

  const claimByItemId = (itemId) => {
    const list = availableByItemId[itemId];
    if (!list || !list.length) {
      return null;
    }
    const entry = list.shift();
    if (entry && entry.inventoryId) {
      availableById.delete(entry.inventoryId);
    }
    return entry ? { ...entry } : null;
  };

  const resolvedSlots = createEmptySlotMap();
  const rawSlots = payload.slots || {};

  Object.keys(resolvedSlots).forEach((slot) => {
    const raw = rawSlots[slot];
    let normalizedEntry = null;
    if (raw && typeof raw === 'object' && raw.itemId) {
      const candidate = normalizeEquipmentInventoryItem(raw, now);
      if (candidate) {
        normalizedEntry = { ...candidate };
      }
    } else if (typeof raw === 'string' && raw) {
      normalizedEntry = claimByItemId(raw);
    }
    if (!normalizedEntry && defaults.slots && defaults.slots[slot]) {
      normalizedEntry = { ...defaults.slots[slot] };
    }
    if (normalizedEntry) {
      const claimed = claimEntry(normalizedEntry);
      resolvedSlots[slot] = claimed ? { ...claimed } : { ...normalizedEntry };
    } else {
      resolvedSlots[slot] = null;
    }
  });

  Object.keys(rawSlots || {}).forEach((slot) => {
    if (isIgnoredEquipmentSlot(slot)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(resolvedSlots, slot)) {
      return;
    }
    const raw = rawSlots[slot];
    let normalizedEntry = null;
    if (raw && typeof raw === 'object' && raw.itemId) {
      const candidate = normalizeEquipmentInventoryItem(raw, now);
      if (candidate) {
        normalizedEntry = { ...candidate };
      }
    } else if (typeof raw === 'string' && raw) {
      normalizedEntry = claimByItemId(raw);
    }
    resolvedSlots[slot] = normalizedEntry ? { ...normalizedEntry } : null;
  });

  const remainingInventory = Array.from(availableById.values()).map((entry) => ({ ...entry }));

  const rawStorage = payload.storage && typeof payload.storage === 'object' ? payload.storage : {};
  let storageUpgrades = 0;
  if (rawStorage && typeof rawStorage.upgrades === 'number') {
    const numeric = Number(rawStorage.upgrades);
    storageUpgrades = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  } else if (rawStorage && typeof rawStorage.upgrades === 'object') {
    storageUpgrades = STORAGE_CATEGORY_KEYS.reduce((acc, key) => {
      const value = Number(rawStorage.upgrades[key]);
      if (Number.isFinite(value) && value > acc) {
        return Math.max(0, Math.floor(value));
      }
      return acc;
    }, 0);
  }
  const normalizedStorage = {};
  if (rawStorage && typeof rawStorage === 'object') {
    Object.keys(rawStorage).forEach((key) => {
      if (key === 'upgrades' || key === 'upgradeAvailable' || key === 'upgradeLimit') {
        return;
      }
      normalizedStorage[key] = rawStorage[key];
    });
  }
  normalizedStorage.upgrades = storageUpgrades;
  if (rawStorage && typeof rawStorage.upgradeAvailable !== 'undefined') {
    const availableNumeric = Number(rawStorage.upgradeAvailable);
    if (Number.isFinite(availableNumeric)) {
      normalizedStorage.upgradeAvailable = Math.max(0, Math.floor(availableNumeric));
    }
  }
  if (rawStorage && typeof rawStorage.upgradeLimit !== 'undefined') {
    const limitNumeric = Number(rawStorage.upgradeLimit);
    if (Number.isFinite(limitNumeric)) {
      normalizedStorage.upgradeLimit = Math.max(0, Math.floor(limitNumeric));
    }
  }

  return {
    inventory: remainingInventory,
    slots: resolvedSlots,
    storage: normalizedStorage
  };
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
  const obtainedAt = item.obtainedAt ? new Date(item.obtainedAt) : now;
  const inventoryId = resolveEquipmentInventoryId(item, itemId, obtainedAt);
  return {
    inventoryId,
    itemId,
    quality: definition.quality,
    level,
    refine,
    obtainedAt,
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

function generateEquipmentInventoryId(itemId, obtainedAt = new Date()) {
  const timestamp = obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `eq-${itemId}-${timestamp}-${random}`;
}

function resolveEquipmentInventoryId(item, itemId, obtainedAt = new Date()) {
  const candidates = [
    item && item.inventoryId,
    item && item.instanceId,
    item && item.entryId,
    item && item.id,
    item && item._id
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  const timestamp = obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  return `eq-${itemId}-${timestamp}`;
}

function createEquipmentInventoryEntry(itemId, obtainedAt = new Date()) {
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    return null;
  }
  const safeObtainedAt = obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt : new Date();
  return {
    inventoryId: generateEquipmentInventoryId(itemId, safeObtainedAt),
    itemId,
    quality: definition.quality,
    level: 1,
    refine: 0,
    obtainedAt: safeObtainedAt,
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
  const equipmentSummary = decorateEquipment(profile, attributeSummary.equipmentBonus);
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
  let respecAvailable = Math.max(0, Math.floor(Number(attributes.respecAvailable) || 0));
  if (respecAvailable <= 0) {
    const legacyLimit = Math.max(0, Math.floor(Number(attributes.respecLimit) || 0));
    const legacyUsed = Math.max(0, Math.floor(Number(attributes.respecUsed) || 0));
    respecAvailable = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
  }

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
    respecAvailable,
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
    special: { shield: 0, bonusDamage: 0, dodgeChance: 0 },
    sets: [],
    notes: []
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
  cloned.sets = Array.isArray(summary.sets) ? [...summary.sets] : [];
  cloned.notes = Array.isArray(summary.notes) ? [...summary.notes] : [];
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
  if (Array.isArray(source.notes) && source.notes.length) {
    target.notes.push(...source.notes);
  }
  if (Array.isArray(source.sets) && source.sets.length) {
    target.sets.push(...source.sets);
  }
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
  const setCounters = {};

  Object.keys(slots).forEach((slot) => {
    if (isIgnoredEquipmentSlot(slot)) {
      return;
    }
    const slotEntry = slots[slot];
    const itemId =
      typeof slotEntry === 'string'
        ? slotEntry
        : slotEntry && typeof slotEntry === 'object' && slotEntry.itemId
        ? slotEntry.itemId
        : '';
    if (!itemId) return;
    const definition = EQUIPMENT_MAP[itemId];
    if (!definition) return;
    const refine =
      slotEntry && typeof slotEntry.refine === 'number' ? Math.max(0, Math.floor(slotEntry.refine)) : 0;
    const detail = calculateEquipmentStats(definition, refine);
    const bonusStats = detail.stats || {};
    Object.keys(bonusStats).forEach((key) => {
      applyBonus(summary, key, bonusStats[key]);
    });
    if (detail.extraDescriptions && detail.extraDescriptions.length) {
      summary.notes.push(...detail.extraDescriptions);
    }
    if (detail.setId) {
      setCounters[detail.setId] = (setCounters[detail.setId] || 0) + 1;
    }
  });

  const activeSets = [];
  Object.keys(setCounters).forEach((setId) => {
    const count = setCounters[setId];
    const definition = EQUIPMENT_SET_LIBRARY[setId];
    if (!definition) {
      return;
    }
    const setDetail = { setId, name: definition.name, count, effects: [] };
    const twoPiece = definition.bonuses && definition.bonuses[2];
    if (count >= 2 && twoPiece) {
      if (twoPiece.stats) {
        Object.keys(twoPiece.stats).forEach((key) => {
          applyBonus(summary, key, twoPiece.stats[key]);
        });
      }
      setDetail.effects.push({ pieces: 2, description: twoPiece.description });
      if (twoPiece.notes) {
        summary.notes.push(...twoPiece.notes);
      }
    }
    const fourPiece = definition.bonuses && definition.bonuses[4];
    if (count >= 4 && fourPiece) {
      if (fourPiece.stats) {
        Object.keys(fourPiece.stats).forEach((key) => {
          applyBonus(summary, key, fourPiece.stats[key]);
        });
      }
      setDetail.effects.push({ pieces: 4, description: fourPiece.description });
      if (fourPiece.notes) {
        summary.notes.push(...fourPiece.notes);
      }
    }
    activeSets.push(setDetail);
  });

  summary.sets = activeSets;
  summary.notes = summary.notes.filter((note, index, list) => typeof note === 'string' && note && list.indexOf(note) === index);

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
  stats.critResist = Math.min(0.25, root * 0.0008 + constitution * 0.0002);
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
  if (!definition) {
    return { stats: {}, mainAttribute: null, subAttributes: [], uniqueEffects: [], extraDescriptions: [], setId: null };
  }
  const qualityConfig = resolveEquipmentQualityConfig(definition.quality);
  const slotConfig = resolveEquipmentSlotConfig(definition.slot) || {};
  const level = Math.max(1, Math.floor(Number(definition.levelRequirement) || 1));
  const refineMultiplier = 1 + Math.max(0, refine) * (definition.refineScale || 0.07);
  const stats = {};
  let mainAttribute = null;
  const subAttributes = [];
  const uniqueEffects = [];
  const extraDescriptions = [];

  const mainAttrDefinition = definition.mainAttribute || {};
  const slotMainCandidates = Array.isArray(slotConfig.mainAttributes) ? slotConfig.mainAttributes : [];
  const resolvedMainKey =
    mainAttrDefinition.key || (slotMainCandidates.length ? slotMainCandidates[0].key : null);
  if (resolvedMainKey) {
    const slotEntry = slotMainCandidates.find((item) => item.key === resolvedMainKey) || { coefficient: 1 };
    const scale = typeof mainAttrDefinition.coefficient === 'number' ? mainAttrDefinition.coefficient : 1;
    const tierMultiplier = mainAttrDefinition.tier
      ? EQUIPMENT_AFFIX_TIER_MULTIPLIER[mainAttrDefinition.tier] || 1
      : 1;
    const variance = Number(mainAttrDefinition.variance) || 0;
    const computed = computeEquipmentAttributeValue({
      key: resolvedMainKey,
      level,
      qualityMultiplier: qualityConfig.mainCoefficient || 1,
      slotCoefficient: slotEntry.coefficient || 1,
      scale,
      tierMultiplier,
      variance,
      refineMultiplier
    });
    applyComputedAttribute(stats, computed);
    if (computed) {
      mainAttribute = {
        key: resolvedMainKey,
        value: computed.value,
        label: resolveAttributeLabel(resolvedMainKey),
        display: formatStatDisplay(resolvedMainKey, computed.value, true),
        tier: mainAttrDefinition.tier || null
      };
    }
  }

  const subAttrDefinitions = Array.isArray(definition.subAttributes) ? definition.subAttributes : [];
  subAttrDefinitions.forEach((affix, index) => {
    if (!affix || !affix.key) {
      return;
    }
    const rule = resolveEquipmentAffixRule(affix.key) || {};
    const tierRange = qualityConfig.subTierRange || [];
    const fallbackTier = tierRange[Math.min(index, tierRange.length - 1)] || 'common';
    const tier = affix.tier || fallbackTier;
    const tierMultiplier = EQUIPMENT_AFFIX_TIER_MULTIPLIER[tier] || 1;
    const scale = typeof affix.scale === 'number' ? affix.scale : rule.scale || 1;
    const variance = Number(affix.variance) || 0;
    const computed = computeEquipmentAttributeValue({
      key: affix.key,
      level,
      qualityMultiplier: qualityConfig.mainCoefficient || 1,
      slotCoefficient: 1,
      scale,
      tierMultiplier,
      variance,
      refineMultiplier
    });
    applyComputedAttribute(stats, computed);
    subAttributes.push({
      key: affix.key,
      tier,
      value: computed ? computed.value : 0,
      label: resolveAttributeLabel(affix.key),
      display: computed ? formatStatDisplay(affix.key, computed.value, true) : ''
    });
  });

  const uniques = Array.isArray(definition.uniqueEffects) ? definition.uniqueEffects : [];
  uniques.forEach((effect) => {
    if (!effect) return;
    if (effect.stats && typeof effect.stats === 'object') {
      Object.keys(effect.stats).forEach((key) => {
        applyStatValue(stats, key, effect.stats[key]);
      });
    }
    if (effect.description) {
      extraDescriptions.push(effect.description);
    }
    uniqueEffects.push({ description: effect.description || '', stats: effect.stats || null });
  });

  if (definition.extraStats && typeof definition.extraStats === 'object') {
    Object.keys(definition.extraStats).forEach((key) => {
      applyStatValue(stats, key, definition.extraStats[key]);
    });
  }

  return {
    stats,
    mainAttribute,
    subAttributes,
    uniqueEffects,
    extraDescriptions,
    quality: definition.quality || 'inferior',
    levelRequirement: level,
    setId: definition.setId || null
  };
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
  const critResist = Number(stats.critResist) || 0;
  const finalDamageBonus = Number(stats.finalDamageBonus) || 0;
  const finalDamageReduction = Number(stats.finalDamageReduction) || 0;
  const lifeSteal = Number(stats.lifeSteal) || 0;
  const healingBonus = Number(stats.healingBonus) || 0;
  const controlHit = Number(stats.controlHit) || 0;
  const controlResist = Number(stats.controlResist) || 0;
  const physicalPenetration = Number(stats.physicalPenetration) || 0;
  const magicPenetration = Number(stats.magicPenetration) || 0;
  const comboRate = Number(stats.comboRate) || 0;
  const block = Number(stats.block) || 0;
  const counterRate = Number(stats.counterRate) || 0;
  const damageReduction = Number(stats.damageReduction) || 0;
  const healingReceived = Number(stats.healingReceived) || 0;
  const rageGain = Number(stats.rageGain) || 0;
  const controlStrength = Number(stats.controlStrength) || 0;
  const shieldPower = Number(stats.shieldPower) || 0;
  const summonPower = Number(stats.summonPower) || 0;
  const elementalVulnerability = Number(stats.elementalVulnerability) || 0;
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
    critResist * 360 +
    lifeSteal * 420 +
    healingBonus * 380 +
    controlHit * 1.1 +
    controlResist * 1.1 +
    physicalPenetration * 2.2 +
    magicPenetration * 2.2 +
    comboRate * 520 +
    block * 380 +
    counterRate * 480 +
    damageReduction * 360 +
    healingReceived * 340 +
    rageGain * 320 +
    controlStrength * 300 +
    shieldPower * 260 +
    summonPower * 240 +
    elementalVulnerability * 320 +
    shield * 0.25 +
    bonusDamage * 1.4 +
    dodgeChance * 620;
  return Math.round(power);
}

function decorateEquipment(profile, summary = null) {
  const equipment = profile.equipment || {};
  const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const slots = equipment.slots || {};
  const equippedInventoryIds = new Set();
  const slotDetails = [];
  Object.keys(EQUIPMENT_SLOT_LABELS).forEach((slot) => {
    if (isIgnoredEquipmentSlot(slot)) {
      return;
    }
    const entry = slots[slot];
    const decorated = entry
      ? decorateEquipmentInventoryEntry(entry, { equipped: true, slotKey: slot })
      : null;
    if (decorated) {
      if (decorated.inventoryId) {
        equippedInventoryIds.add(decorated.inventoryId);
      } else {
        equippedInventoryIds.add(`slot:${slot}:${decorated.itemId}`);
      }
    }
    slotDetails.push({
      slot,
      slotLabel: EQUIPMENT_SLOT_LABELS[slot],
      item: decorated || null
    });
  });
  Object.keys(slots).forEach((slot) => {
    if (isIgnoredEquipmentSlot(slot)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(EQUIPMENT_SLOT_LABELS, slot)) {
      return;
    }
    const entry = slots[slot];
    const decorated = entry
      ? decorateEquipmentInventoryEntry(entry, { equipped: true, slotKey: slot })
      : null;
    if (decorated) {
      if (decorated.inventoryId) {
        equippedInventoryIds.add(decorated.inventoryId);
      } else {
        equippedInventoryIds.add(`slot:${slot}:${decorated.itemId}`);
      }
    }
    slotDetails.push({ slot, slotLabel: slot, item: decorated || null });
  });

  const list = inventory
    .map((entry) => {
      const decorated = decorateEquipmentInventoryEntry(entry, { equipped: false });
      if (!decorated) {
        return null;
      }
      if (decorated.inventoryId && equippedInventoryIds.has(decorated.inventoryId)) {
        decorated.equipped = true;
      }
      return decorated;
    })
    .filter((item) => !!item);

  const bonusSummary = summary || sumEquipmentBonuses(equipment);
  const storagePayload = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  const totalUpgrades = Math.max(0, Math.floor(Number(storagePayload.upgrades || 0)));
  const baseCapacity = STORAGE_DEFAULT_BASE_CAPACITY;
  const perUpgrade = STORAGE_DEFAULT_PER_UPGRADE;
  const capacity = baseCapacity + perUpgrade * totalUpgrades;
  const rawCategories = Array.isArray(storagePayload.categories) ? storagePayload.categories : [];
  const categoryMap = {};
  let totalUsed = 0;
  rawCategories.forEach((category) => {
    if (!category || typeof category !== 'object') {
      return;
    }
    const key = typeof category.key === 'string' ? category.key : '';
    if (!key) {
      return;
    }
    const items = Array.isArray(category.items) ? category.items.map((item) => ({ ...item })) : [];
    categoryMap[key] = items;
    totalUsed += items.length;
  });
  const equipmentItems = list.map((item) => ({ ...item }));
  const previousEquipment = categoryMap.equipment ? categoryMap.equipment.length : 0;
  categoryMap.equipment = equipmentItems;
  totalUsed = totalUsed - previousEquipment + equipmentItems.length;
  const definedKeys = new Set(STORAGE_CATEGORY_DEFINITIONS.map((item) => item.key));
  const storageCategories = STORAGE_CATEGORY_DEFINITIONS.map((definition) => {
    const items = categoryMap[definition.key]
      ? categoryMap[definition.key].map((item) => ({ ...item }))
      : [];
    return {
      key: definition.key,
      label: definition.label,
      baseCapacity,
      perUpgrade,
      upgrades: totalUpgrades,
      capacity,
      used: items.length,
      remaining: Math.max(capacity - items.length, 0),
      items
    };
  });
  rawCategories.forEach((category) => {
    if (!category || typeof category !== 'object') {
      return;
    }
    const key = typeof category.key === 'string' ? category.key : '';
    if (!key || definedKeys.has(key)) {
      return;
    }
    const items = categoryMap[key] ? categoryMap[key].map((item) => ({ ...item })) : [];
    storageCategories.push({
      key,
      label: typeof category.label === 'string' ? category.label : key,
      baseCapacity,
      perUpgrade,
      upgrades: totalUpgrades,
      capacity,
      used: items.length,
      remaining: Math.max(capacity - items.length, 0),
      items
    });
  });
  const upgradeAvailableNumeric =
    typeof storagePayload.upgradeAvailable !== 'undefined' ? Number(storagePayload.upgradeAvailable) : null;
  const upgradeLimitNumeric =
    typeof storagePayload.upgradeLimit !== 'undefined' ? Number(storagePayload.upgradeLimit) : null;
  const summaryPayload = {
    baseCapacity,
    perUpgrade,
    upgrades: totalUpgrades,
    capacity,
    used: totalUsed,
    remaining: Math.max(capacity - totalUsed, 0)
  };
  if (upgradeAvailableNumeric !== null && Number.isFinite(upgradeAvailableNumeric)) {
    summaryPayload.upgradeAvailable = Math.max(0, Math.floor(upgradeAvailableNumeric));
  }
  if (upgradeLimitNumeric !== null && Number.isFinite(upgradeLimitNumeric)) {
    summaryPayload.upgradeLimit = Math.max(0, Math.floor(upgradeLimitNumeric));
  }
  return {
    slots: slotDetails,
    inventory: list,
    storage: { summary: summaryPayload, categories: storageCategories },
    bonus: {
      sets: Array.isArray(bonusSummary && bonusSummary.sets) ? bonusSummary.sets : [],
      notes: Array.isArray(bonusSummary && bonusSummary.notes) ? bonusSummary.notes : []
    }
  };
}

function decorateEquipmentInventoryEntry(entry, options = {}) {
  if (!entry) {
    return null;
  }
  const payload = typeof entry === 'object' ? entry : { itemId: entry };
  const definition = EQUIPMENT_MAP[payload.itemId];
  if (!definition) {
    return null;
  }
  const detail = calculateEquipmentStats(definition, payload.refine || 0);
  const stats = detail.stats || {};
  const statTexts = formatStatsText({ ...stats });
  const breakdownTexts = [];
  const notes = [];
  if (detail.mainAttribute) {
    breakdownTexts.push(
      `${detail.mainAttribute.label} ${formatStatDisplay(detail.mainAttribute.key, detail.mainAttribute.value, true)}`
    );
  }
  detail.subAttributes.forEach((affix) => {
    if (!affix.label) {
      return;
    }
    breakdownTexts.push(`${affix.label} ${formatStatDisplay(affix.key, affix.value, true)}`);
  });
  detail.uniqueEffects.forEach((effect) => {
    if (effect.description) {
      notes.push(`特效：${effect.description}`);
    }
  });
  const setDefinition = definition.setId ? EQUIPMENT_SET_LIBRARY[definition.setId] : null;
  if (setDefinition) {
    breakdownTexts.push(`套装：${setDefinition.name}`);
  }
  const combinedTexts = [...statTexts, ...breakdownTexts];
  const displayTexts = combinedTexts.filter((text, index, list) => text && list.indexOf(text) === index);
  const equipped = !!(options && options.equipped);
  return {
    inventoryId: payload.inventoryId,
    itemId: payload.itemId,
    name: definition.name,
    quality: definition.quality,
    qualityLabel: resolveEquipmentQualityLabel(definition.quality),
    qualityColor: resolveEquipmentQualityColor(definition.quality),
    description: definition.description,
    slot: definition.slot,
    slotLabel: EQUIPMENT_SLOT_LABELS[definition.slot] || '装备',
    stats,
    statsText: displayTexts,
    mainAttribute: detail.mainAttribute,
    subAttributes: detail.subAttributes,
    uniqueEffects: detail.uniqueEffects,
    level: payload.level || 1,
    refine: payload.refine || 0,
    refineLabel: payload.refine ? `精炼 +${payload.refine}` : '未精炼',
    levelRequirement: definition.levelRequirement || 1,
    tags: definition.tags || [],
    obtainedAt: payload.obtainedAt,
    obtainedAtText: formatDateTime(payload.obtainedAt),
    setId: definition.setId || null,
    setName: setDefinition ? setDefinition.name : '',
    equipped,
    equippedSlot: options && options.slotKey ? options.slotKey : '',
    favorite: !!payload.favorite,
    notes: notes.filter((note, index, list) => note && list.indexOf(note) === index)
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
        quality: definition ? definition.quality : 'mortal',
        qualityLabel: definition ? resolveEquipmentQualityLabel(definition.quality) : resolveEquipmentQualityLabel('mortal'),
        qualityColor: definition ? resolveEquipmentQualityColor(definition.quality) : resolveEquipmentQualityColor('mortal')
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
    if (item.type === 'consumable') {
      const definition = CONSUMABLE_MAP[item.consumableId];
      return {
        type: 'consumable',
        consumableId: item.consumableId,
        chance: item.chance,
        label: definition ? definition.name : '道具',
        description: definition ? definition.description : ''
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
      const detail = entry.detail || {};
      const definition = detail.itemId ? EQUIPMENT_MAP[detail.itemId] : null;
      const slotLabel = detail.slot ? EQUIPMENT_SLOT_LABELS[detail.slot] || '装备' : '';
      let summary;
      if (detail.action === 'unequip') {
        summary = slotLabel ? `${slotLabel} · 卸下` : '卸下装备';
      } else if (definition) {
        const resolvedSlot = EQUIPMENT_SLOT_LABELS[definition.slot] || slotLabel || '装备';
        summary = `${resolvedSlot} · ${definition.name}`;
      } else {
        summary = slotLabel ? `${slotLabel} · 装备变动` : '装备变动';
      }
      return {
        type: 'equipment',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        summary
      };
    }
    if (entry.type === 'consumable') {
      const detail = entry.detail || {};
      const consumable = CONSUMABLE_MAP[detail.consumableId] || { name: '道具' };
      let summary = `获得道具：${consumable.name}`;
      if (detail.effect === 'respecAvailable' && detail.amount) {
        summary += `（洗点次数 +${detail.amount}）`;
      }
      return {
        type: 'consumable',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        detail,
        summary
      };
    }
    if (entry.type === 'respec') {
      const detail = entry.detail || {};
      const refunded = Math.max(0, Math.floor(Number(detail.refundedPoints) || 0));
      const summary = refunded > 0 ? `洗点返还属性点 ${refunded}` : '洗点完成';
      return {
        type: 'respec',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        detail,
        summary
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
      } else if (item.type === 'consumable' && CONSUMABLE_MAP[item.consumableId]) {
        results.push({ type: 'consumable', consumableId: item.consumableId });
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
      if (item.type === 'consumable') {
        applyConsumableReward(updated, item.consumableId, now);
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

function applyConsumableReward(profile, consumableId, now) {
  const definition = CONSUMABLE_MAP[consumableId];
  if (!definition) {
    return;
  }
  if (!profile.attributes) {
    profile.attributes = buildDefaultAttributes();
  }
  const availableIncrease = definition.effects && definition.effects.respecAvailable ? definition.effects.respecAvailable : 0;
  if (availableIncrease > 0) {
    const attrs = profile.attributes;
    const currentAvailable = Math.max(0, Math.floor(Number(attrs.respecAvailable) || 0));
    const legacyLimit = Math.max(0, Math.floor(Number(attrs.respecLimit) || 0));
    const legacyUsed = Math.max(0, Math.floor(Number(attrs.respecUsed) || 0));
    const legacyAvailable = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
    const baseAvailable = Math.max(currentAvailable, legacyAvailable);
    attrs.respecAvailable = baseAvailable + availableIncrease;
    attrs.respecLimit = 0;
    attrs.respecUsed = 0;
    profile.attributes = attrs;
    profile.battleHistory = appendHistory(
      profile.battleHistory,
      {
        type: 'consumable',
        createdAt: now,
        detail: { consumableId, effect: 'respecAvailable', amount: availableIncrease }
      },
      MAX_BATTLE_HISTORY
    );
  }
}

async function recordStoneTransaction(actorId, result, enemy, now) {
  if (!result.rewards || !result.rewards.stones) {
    return;
  }
  await db.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
    data: {
      memberId: actorId,
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
            quality: def ? def.quality : 'mortal',
            qualityLabel: def
              ? resolveEquipmentQualityLabel(def.quality)
              : resolveEquipmentQualityLabel('mortal'),
            qualityColor: def
              ? resolveEquipmentQualityColor(def.quality)
              : resolveEquipmentQualityColor('mortal')
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
        if (item.type === 'consumable') {
          const def = CONSUMABLE_MAP[item.consumableId];
          return {
            type: 'consumable',
            consumableId: item.consumableId,
            name: def ? def.name : '道具',
            description: def ? def.description : ''
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
  if (key === 'critResist') {
    return Number(Math.max(0, Math.min(0.8, value)).toFixed(4));
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
  if (
    [
      'comboRate',
      'block',
      'counterRate',
      'damageReduction',
      'healingReceived',
      'rageGain',
      'controlStrength',
      'shieldPower',
      'summonPower',
      'elementalVulnerability'
    ].includes(key)
  ) {
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
    key === 'healingReduction' ||
    key === 'critResist' ||
    [
      'comboRate',
      'block',
      'counterRate',
      'damageReduction',
      'healingReceived',
      'rageGain',
      'controlStrength',
      'shieldPower',
      'summonPower',
      'elementalVulnerability'
    ].includes(key)
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
    const hasConsumable = rewards.loot.some((item) => item.type === 'consumable');
    if (hasConsumable) {
      parts.push('洗点次数 +1');
    }
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
