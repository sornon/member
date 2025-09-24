const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTION = 'pvePlayers';

const ATTRIBUTE_KEYS = ['hp', 'mp', 'atk', 'def', 'crit', 'agi', 'spi'];
const EQUIPMENT_SLOTS = ['weapon', 'armor', 'focus', 'accessory', 'boots'];

const EQUIPMENT_LIBRARY = {
  'weapon.bamboo-sword': {
    id: 'weapon.bamboo-sword',
    name: '青竹木剑',
    slot: 'weapon',
    rarity: 'C',
    stats: { atk: 35, crit: 1 },
    description: '入门弟子常用的轻剑，注入灵气后可提升基础攻击。'
  },
  'weapon.dragon-edge': {
    id: 'weapon.dragon-edge',
    name: '游龙剑骨',
    slot: 'weapon',
    rarity: 'SR',
    stats: { atk: 120, crit: 6 },
    bonuses: { element: 'fire', damageBoost: 0.1 },
    description: '蕴含火龙剑意的利刃，能够大幅提升爆发伤害。'
  },
  'armor.spirit-robe': {
    id: 'armor.spirit-robe',
    name: '灵丝法袍',
    slot: 'armor',
    rarity: 'R',
    stats: { hp: 240, def: 48, spi: 8 },
    description: '以灵丝编织的防具，对元素与控制具备抵抗力。'
  },
  'armor.dragon-scale': {
    id: 'armor.dragon-scale',
    name: '龙鳞圣甲',
    slot: 'armor',
    rarity: 'UR',
    stats: { hp: 520, def: 120, spi: 18 },
    description: '王级龙族蜕落之鳞打造，化解大量伤害。'
  },
  'focus.spirit-bell': {
    id: 'focus.spirit-bell',
    name: '灵鸣铃',
    slot: 'focus',
    rarity: 'SR',
    stats: { mp: 180, spi: 12 },
    description: '持铃御法，能够快速回复灵力并稳定施法。'
  },
  'accessory.aurora-ring': {
    id: 'accessory.aurora-ring',
    name: '极光戒',
    slot: 'accessory',
    rarity: 'SSR',
    stats: { crit: 8, atk: 60 },
    bonuses: { damageBoost: 0.08 },
    description: '聚拢极光的戒指，使每次出剑都带有破甲之势。'
  },
  'boots.cloudstep': {
    id: 'boots.cloudstep',
    name: '踏云靴',
    slot: 'boots',
    rarity: 'R',
    stats: { agi: 22, hp: 120 },
    description: '轻若鸿毛的靴子，让身法犹如腾云驾雾。'
  }
};

const SKILL_LIBRARY = {
  'skill.spirit-slash': {
    id: 'skill.spirit-slash',
    name: '灵气断魂斩',
    rarity: 'C',
    type: 'active',
    element: 'wood',
    cost: 40,
    description: '以灵气凝刃的基础剑法，对单体造成 120% 攻击伤害。',
    stats: {}
  },
  'skill.moon-ward': {
    id: 'skill.moon-ward',
    name: '皎月护心',
    rarity: 'R',
    type: 'passive',
    element: 'water',
    description: '每回合恢复少量灵力，并提升最大气血。',
    stats: { hp: 180, mp: 60 }
  },
  'skill.thunder-chain': {
    id: 'skill.thunder-chain',
    name: '雷霆锁链',
    rarity: 'SR',
    type: 'active',
    element: 'lightning',
    cost: 65,
    description: '释放雷电连锁，对三名敌人造成伤害并有 30% 概率麻痹。',
    stats: {}
  },
  'skill.dragons-roar': {
    id: 'skill.dragons-roar',
    name: '真龙长吟',
    rarity: 'SSR',
    type: 'active',
    element: 'fire',
    cost: 90,
    description: '召唤龙魂轰击，对全体造成 240% 火系伤害并降低防御。',
    stats: {}
  },
  'skill.lotus-barrier': {
    id: 'skill.lotus-barrier',
    name: '玄莲结界',
    rarity: 'SR',
    type: 'passive',
    element: 'earth',
    description: '战斗开始获得吸收等同防御 120% 的护盾，提升神识。',
    stats: { def: 36, spi: 12 }
  },
  'skill.void-step': {
    id: 'skill.void-step',
    name: '虚空遁形',
    rarity: 'UR',
    type: 'passive',
    element: 'void',
    description: '提升身法与会心，首次受到致命伤害时保留 1 点气血。',
    stats: { agi: 28, crit: 9 }
  },
  'skill.creation-field': {
    id: 'skill.creation-field',
    name: '鸿蒙界域',
    rarity: 'LR',
    type: 'active',
    element: 'origin',
    cost: 120,
    description: '展开鸿蒙之界，令时间停止 2 秒并重置技能冷却。',
    stats: {}
  }
};

const SKILL_RATES = [
  { rarity: 'LR', rate: 0.002 },
  { rarity: 'UR', rate: 0.018 },
  { rarity: 'SSR', rate: 0.06 },
  { rarity: 'SR', rate: 0.12 },
  { rarity: 'R', rate: 0.25 },
  { rarity: 'C', rate: 0.55 }
];

const DUPLICATE_FRAGMENT_REWARDS = {
  C: 2,
  R: 5,
  SR: 15,
  SSR: 40,
  UR: 80,
  LR: 150
};

const STAGES = [
  {
    id: 'stage.spring-1',
    order: 1,
    name: '灵泉试炼·启程',
    recommendedPower: 850,
    enemyPower: 780,
    element: 'water',
    rewards: {
      spiritStones: [220, 280],
      equipment: ['armor.spirit-robe', 'boots.cloudstep'],
      fragments: [{ skillId: 'skill.moon-ward', amount: [2, 4] }]
    }
  },
  {
    id: 'stage.spring-2',
    order: 2,
    name: '丹火秘境·炉心',
    recommendedPower: 1200,
    enemyPower: 1180,
    element: 'fire',
    rewards: {
      spiritStones: [320, 420],
      equipment: ['weapon.dragon-edge'],
      fragments: [{ skillId: 'skill.thunder-chain', amount: [3, 5] }]
    }
  },
  {
    id: 'stage.sky-1',
    order: 3,
    name: '金丹天梯·九天',
    recommendedPower: 1600,
    enemyPower: 1680,
    element: 'wind',
    rewards: {
      spiritStones: [420, 560],
      equipment: ['accessory.aurora-ring', 'armor.dragon-scale'],
      fragments: [{ skillId: 'skill.void-step', amount: [2, 3] }]
    }
  }
];

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';

  switch (action) {
    case 'profile':
      return getProfile(OPENID);
    case 'allocateAttributes':
      return allocateAttributes(OPENID, event.distribution || {});
    case 'drawSkills':
      return drawSkills(OPENID, event.count || 1);
    case 'equipItem':
      return equipItem(OPENID, event.itemId);
    case 'equipSkill':
      return equipSkill(OPENID, event.skillId, event.slotType || 'active', event.slotIndex);
    case 'startBattle':
      return startBattle(OPENID, event.stageId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function getProfile(openid) {
  const profile = await ensureProfile(openid);
  return decorateProfile(profile);
}

async function allocateAttributes(openid, distribution) {
  const profile = await ensureProfile(openid);
  const freePoints = profile.freePoints || 0;
  const sanitized = sanitizeDistribution(distribution);
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error('请选择要分配的属性点');
  }
  if (total > freePoints) {
    throw new Error('自由属性点不足');
  }

  const allocated = profile.allocatedAttributes || {};
  ATTRIBUTE_KEYS.forEach((key) => {
    allocated[key] = (allocated[key] || 0) + (sanitized[key] || 0);
  });

  profile.allocatedAttributes = allocated;
  profile.freePoints = freePoints - total;
  profile.updatedAt = new Date();

  await db.collection(COLLECTION).doc(openid).update({
    data: {
      allocatedAttributes: allocated,
      freePoints: profile.freePoints,
      updatedAt: profile.updatedAt
    }
  });

  return decorateProfile(profile);
}

async function drawSkills(openid, count) {
  if (![1, 10].includes(count)) {
    throw new Error('仅支持单抽或十连');
  }
  const profile = await ensureProfile(openid);
  const stonesRequired = count === 10 ? 1700 : 180;
  if ((profile.resources?.spiritStones || 0) < stonesRequired) {
    throw new Error('灵石不足，无法抽取技能');
  }

  profile.resources.spiritStones -= stonesRequired;
  const pity = profile.pity || { sr: 0, ssr: 0 };
  const ownedSkills = profile.skills.owned || [];
  const fragments = profile.inventory.skillFragments || {};
  const results = [];

  for (let i = 0; i < count; i += 1) {
    pity.sr += 1;
    pity.ssr += 1;
    const rarity = resolveRarity(pity);
    if (rarity === 'SR') {
      pity.sr = 0;
    }
    if (['SSR', 'UR', 'LR'].includes(rarity)) {
      pity.ssr = 0;
    }
    const skill = drawSkillByRarity(rarity);
    if (!skill) continue;
    const owned = ownedSkills.find((item) => item.skillId === skill.id);
    if (owned) {
      owned.copies = (owned.copies || 1) + 1;
      owned.fragments = (owned.fragments || 0) + DUPLICATE_FRAGMENT_REWARDS[skill.rarity];
      fragments[skill.id] = (fragments[skill.id] || 0) + DUPLICATE_FRAGMENT_REWARDS[skill.rarity];
      results.push({ type: 'duplicate', skill: decorateSkill(owned), fragments: DUPLICATE_FRAGMENT_REWARDS[skill.rarity] });
    } else {
      ownedSkills.push({
        skillId: skill.id,
        rarity: skill.rarity,
        level: 1,
        copies: 1,
        fragments: 0,
        acquiredAt: new Date()
      });
      results.push({ type: 'new', skill: decorateSkill({ skillId: skill.id, rarity: skill.rarity, level: 1 }) });
    }
  }

  profile.skills.owned = ownedSkills;
  profile.inventory.skillFragments = fragments;
  profile.pity = pity;
  profile.updatedAt = new Date();

  await db.collection(COLLECTION).doc(openid).update({
    data: {
      'resources.spiritStones': profile.resources.spiritStones,
      'skills.owned': ownedSkills,
      'inventory.skillFragments': fragments,
      pity,
      updatedAt: profile.updatedAt
    }
  });

  const decorated = decorateProfile(profile);
  decorated.lastDrawResults = results;
  return decorated;
}

async function equipItem(openid, itemId) {
  if (!itemId || !EQUIPMENT_LIBRARY[itemId]) {
    throw new Error('装备不存在');
  }
  const profile = await ensureProfile(openid);
  const item = EQUIPMENT_LIBRARY[itemId];
  const inventory = profile.inventory.equipment || [];
  const hasItem = inventory.find((entry) => entry.itemId === itemId);
  if (!hasItem) {
    inventory.push({ itemId, level: 1, acquiredAt: new Date() });
  }
  profile.equipment[item.slot] = { itemId, level: hasItem ? hasItem.level : 1 };
  profile.inventory.equipment = inventory;
  profile.updatedAt = new Date();

  await db.collection(COLLECTION).doc(openid).update({
    data: {
      equipment: profile.equipment,
      'inventory.equipment': inventory,
      updatedAt: profile.updatedAt
    }
  });

  return decorateProfile(profile);
}

async function equipSkill(openid, skillId, slotType, slotIndex) {
  if (!skillId || !SKILL_LIBRARY[skillId]) {
    throw new Error('技能不存在');
  }
  const profile = await ensureProfile(openid);
  const owned = profile.skills.owned || [];
  const exists = owned.find((item) => item.skillId === skillId);
  if (!exists) {
    throw new Error('尚未拥有该技能');
  }
  const loadout = profile.skills.loadout || { active: [], passive: [] };
  const type = slotType === 'passive' ? 'passive' : 'active';
  const definition = SKILL_LIBRARY[skillId];
  if (type === 'active' && definition.type !== 'active') {
    throw new Error('该技能不可设置为主动');
  }
  if (type === 'passive' && definition.type !== 'passive') {
    throw new Error('该技能不可设置为被动');
  }
  const maxSlots = type === 'active' ? 5 : 3;
  let slots = Array.isArray(loadout[type]) ? [...loadout[type]] : [];
  const index = typeof slotIndex === 'number' ? slotIndex : slots.indexOf(skillId);
  if (index >= 0 && index < maxSlots) {
    slots[index] = skillId;
  } else {
    if (slots.includes(skillId)) {
      // already equipped, nothing to change
    } else if (slots.length < maxSlots) {
      slots.push(skillId);
    } else {
      slots[maxSlots - 1] = skillId;
    }
  }
  slots = slots.slice(0, maxSlots);
  loadout[type] = slots;
  profile.skills.loadout = loadout;
  profile.updatedAt = new Date();

  await db.collection(COLLECTION).doc(openid).update({
    data: {
      'skills.loadout': loadout,
      updatedAt: profile.updatedAt
    }
  });

  return decorateProfile(profile);
}

async function startBattle(openid, stageId) {
  const stage = STAGES.find((item) => item.id === stageId);
  if (!stage) {
    throw new Error('副本不存在');
  }
  const profile = await ensureProfile(openid);
  const decorated = decorateProfile(profile);
  const clearedOrders = decorated.progress.highestClearedOrder || 0;
  if (stage.order > clearedOrders + 1) {
    throw new Error('尚未解锁该副本');
  }

  const playerPower = decorated.combatPower;
  const enemyPower = stage.enemyPower;
  let victory = false;
  if (playerPower >= stage.recommendedPower * 1.05) {
    victory = true;
  } else if (playerPower >= stage.recommendedPower * 0.8) {
    const ratio = playerPower / stage.recommendedPower;
    victory = Math.random() < Math.min(0.95, ratio);
  } else {
    const ratio = playerPower / stage.recommendedPower;
    victory = Math.random() < Math.max(0.05, ratio * 0.6);
  }

  const rewards = { spiritStones: 0, equipment: null, fragments: [] };
  if (victory) {
    const stoneReward = randomRange(stage.rewards.spiritStones[0], stage.rewards.spiritStones[1]);
    profile.resources.spiritStones += stoneReward;
    rewards.spiritStones = stoneReward;

    if (stage.rewards.equipment && stage.rewards.equipment.length) {
      const dropId = stage.rewards.equipment[Math.floor(Math.random() * stage.rewards.equipment.length)];
      const equipmentDef = EQUIPMENT_LIBRARY[dropId];
      if (equipmentDef) {
        const inventory = profile.inventory.equipment || [];
        const existing = inventory.find((item) => item.itemId === dropId);
        if (existing) {
          existing.level = (existing.level || 1) + 1;
        } else {
          inventory.push({ itemId: dropId, level: 1, acquiredAt: new Date() });
        }
        profile.inventory.equipment = inventory;
        rewards.equipment = decorateEquipment({ itemId: dropId, level: existing ? existing.level : 1 });
      }
    }

    if (Array.isArray(stage.rewards.fragments)) {
      stage.rewards.fragments.forEach((fragment) => {
        const amount = randomRange(fragment.amount[0], fragment.amount[1]);
        profile.inventory.skillFragments[fragment.skillId] =
          (profile.inventory.skillFragments[fragment.skillId] || 0) + amount;
        rewards.fragments.push({
          skill: decorateSkill({ skillId: fragment.skillId }),
          amount
        });
      });
    }

    if (!profile.progress.clearedStageIds.includes(stageId)) {
      profile.progress.clearedStageIds.push(stageId);
      profile.progress.highestClearedOrder = Math.max(profile.progress.highestClearedOrder || 0, stage.order);
      profile.freePoints += 4; // 每次首通给予自由属性奖励
    }
  } else {
    const consolation = Math.floor(stage.rewards.spiritStones[0] * 0.2);
    profile.resources.spiritStones += consolation;
    rewards.spiritStones = consolation;
  }

  profile.progress.lastBattleAt = new Date();
  profile.updatedAt = new Date();

  await db.collection(COLLECTION).doc(openid).update({
    data: {
      resources: profile.resources,
      progress: profile.progress,
      'inventory.equipment': profile.inventory.equipment,
      'inventory.skillFragments': profile.inventory.skillFragments,
      freePoints: profile.freePoints,
      updatedAt: profile.updatedAt
    }
  });

  const freshProfile = decorateProfile(profile);
  return {
    victory,
    playerPower,
    enemyPower,
    rewards,
    profile: freshProfile
  };
}

async function ensureProfile(openid) {
  let snapshot;
  try {
    snapshot = await db.collection(COLLECTION).doc(openid).get();
  } catch (error) {
    snapshot = null;
  }

  if (snapshot && snapshot.data) {
    return normalizeProfile(snapshot.data);
  }

  const now = new Date();
  const defaultProfile = {
    _id: openid,
    baseAttributes: {
      hp: 900,
      mp: 260,
      atk: 90,
      def: 70,
      crit: 6,
      agi: 8,
      spi: 8
    },
    allocatedAttributes: ATTRIBUTE_KEYS.reduce((obj, key) => ({ ...obj, [key]: 0 }), {}),
    freePoints: 24,
    equipment: EQUIPMENT_SLOTS.reduce((obj, slot) => ({ ...obj, [slot]: null }), {}),
    inventory: {
      equipment: [{ itemId: 'weapon.bamboo-sword', level: 1, acquiredAt: now }],
      skillFragments: {},
      materials: {}
    },
    skills: {
      owned: [
        { skillId: 'skill.spirit-slash', rarity: 'C', level: 1, copies: 1, fragments: 0, acquiredAt: now },
        { skillId: 'skill.moon-ward', rarity: 'R', level: 1, copies: 1, fragments: 0, acquiredAt: now }
      ],
      loadout: {
        active: ['skill.spirit-slash'],
        passive: ['skill.moon-ward']
      }
    },
    resources: {
      spiritStones: 2200,
      weaponStones: 0,
      armorStones: 0,
      arcaneDust: 0
    },
    pity: { sr: 0, ssr: 0 },
    progress: {
      clearedStageIds: [],
      highestClearedOrder: 0
    },
    createdAt: now,
    updatedAt: now
  };

  await db.collection(COLLECTION).doc(openid).set({
    data: defaultProfile
  });
  return normalizeProfile(defaultProfile);
}

function sanitizeDistribution(distribution) {
  const result = {};
  ATTRIBUTE_KEYS.forEach((key) => {
    const value = Number(distribution[key] || 0);
    result[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  });
  return result;
}

function resolveRarity(pity) {
  if (pity.ssr >= 90) {
    return 'SSR';
  }
  if (pity.sr >= 30) {
    return 'SR';
  }
  const rand = Math.random();
  let acc = 0;
  for (const entry of SKILL_RATES) {
    acc += entry.rate;
    if (rand < acc) {
      return entry.rarity;
    }
  }
  return 'C';
}

function drawSkillByRarity(rarity) {
  const pool = Object.values(SKILL_LIBRARY).filter((skill) => skill.rarity === rarity);
  if (!pool.length) {
    return Object.values(SKILL_LIBRARY)[0];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function decorateProfile(profile) {
  const normalized = normalizeProfile(profile);
  const base = normalized.baseAttributes || {};
  const allocated = normalized.allocatedAttributes || {};
  const equipmentStats = calculateEquipmentStats(normalized);
  const passiveStats = calculatePassiveSkillStats(normalized);

  const attributes = {};
  ATTRIBUTE_KEYS.forEach((key) => {
    attributes[key] = Math.round((base[key] || 0) + (allocated[key] || 0) + (equipmentStats[key] || 0) + (passiveStats[key] || 0));
  });

  const combatPower = calculateCombatPower(attributes, normalized);

  const decoratedEquipment = {};
  EQUIPMENT_SLOTS.forEach((slot) => {
    const equipped = normalized.equipment[slot];
    if (equipped && EQUIPMENT_LIBRARY[equipped.itemId]) {
      decoratedEquipment[slot] = decorateEquipment(equipped);
    } else {
      decoratedEquipment[slot] = null;
    }
  });

  const ownedSkills = (normalized.skills.owned || []).map((entry) => decorateSkill(entry));
  const loadout = normalized.skills.loadout || { active: [], passive: [] };

  const stageStates = STAGES.map((stage) => ({
    id: stage.id,
    name: stage.name,
    recommendedPower: stage.recommendedPower,
    element: stage.element,
    order: stage.order,
    cleared: normalized.progress.clearedStageIds.includes(stage.id),
    unlocked: stage.order <= (normalized.progress.highestClearedOrder || 0) + 1
  }));

  return {
    attributes,
    baseAttributes: base,
    allocatedAttributes: allocated,
    freePoints: normalized.freePoints,
    equipment: decoratedEquipment,
    inventory: {
      equipment: (normalized.inventory.equipment || []).map((entry) => decorateEquipment(entry)),
      skillFragments: normalized.inventory.skillFragments,
      materials: normalized.inventory.materials || {}
    },
    skills: {
      owned: ownedSkills,
      loadout,
      slots: {
        active: 5,
        passive: 3
      }
    },
    resources: normalized.resources,
    pity: normalized.pity,
    combatPower,
    progress: normalized.progress,
    stages: stageStates,
    updatedAt: normalized.updatedAt
  };
}

function calculateEquipmentStats(profile) {
  const totals = ATTRIBUTE_KEYS.reduce((obj, key) => ({ ...obj, [key]: 0 }), {});
  EQUIPMENT_SLOTS.forEach((slot) => {
    const equipped = profile.equipment[slot];
    if (equipped && EQUIPMENT_LIBRARY[equipped.itemId]) {
      const item = EQUIPMENT_LIBRARY[equipped.itemId];
      ATTRIBUTE_KEYS.forEach((key) => {
        if (item.stats && item.stats[key]) {
          totals[key] += item.stats[key] * (1 + 0.05 * ((equipped.level || 1) - 1));
        }
      });
    }
  });
  return totals;
}

function calculatePassiveSkillStats(profile) {
  const totals = ATTRIBUTE_KEYS.reduce((obj, key) => ({ ...obj, [key]: 0 }), {});
  const loadout = profile.skills.loadout || { passive: [] };
  (loadout.passive || []).forEach((skillId) => {
    const skill = SKILL_LIBRARY[skillId];
    if (skill && skill.type === 'passive' && skill.stats) {
      ATTRIBUTE_KEYS.forEach((key) => {
        if (skill.stats[key]) {
          totals[key] += skill.stats[key];
        }
      });
    }
  });
  return totals;
}

function calculateCombatPower(attributes, profile) {
  const basePower =
    attributes.hp / 12 +
    attributes.mp / 15 +
    attributes.atk * 2.6 +
    attributes.def * 1.9 +
    attributes.crit * 24 +
    attributes.agi * 18 +
    attributes.spi * 15;
  const activeCount = (profile.skills.loadout?.active || []).length;
  const passiveCount = (profile.skills.loadout?.passive || []).length;
  return Math.round(basePower + activeCount * 35 + passiveCount * 45);
}

function decorateEquipment(entry) {
  if (!entry || !EQUIPMENT_LIBRARY[entry.itemId]) {
    return null;
  }
  const def = EQUIPMENT_LIBRARY[entry.itemId];
  return {
    ...def,
    level: entry.level || 1,
    stats: ATTRIBUTE_KEYS.reduce((obj, key) => {
      const base = def.stats?.[key] || 0;
      const levelBonus = base * 0.05 * ((entry.level || 1) - 1);
      return base || levelBonus ? { ...obj, [key]: Math.round(base + levelBonus) } : obj;
    }, {}),
    acquiredAt: entry.acquiredAt || null
  };
}

function decorateSkill(entry) {
  if (!entry) return null;
  const def = SKILL_LIBRARY[entry.skillId];
  if (!def) {
    return {
      id: entry.skillId,
      name: '未知技能',
      rarity: entry.rarity || 'C',
      level: entry.level || 1,
      description: '数值策划待补充',
      type: entry.type || 'active'
    };
  }
  return {
    ...def,
    level: entry.level || 1,
    rarity: def.rarity,
    copies: entry.copies || 1,
    fragments: entry.fragments || 0,
    acquiredAt: entry.acquiredAt || null
  };
}

function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeProfile(profile) {
  const normalized = { ...profile };
  normalized.inventory = normalized.inventory || { equipment: [], skillFragments: {}, materials: {} };
  normalized.inventory.equipment = normalized.inventory.equipment || [];
  normalized.inventory.skillFragments = normalized.inventory.skillFragments || {};
  normalized.skills = normalized.skills || { owned: [], loadout: { active: [], passive: [] } };
  normalized.skills.owned = normalized.skills.owned || [];
  normalized.skills.loadout = normalized.skills.loadout || { active: [], passive: [] };
  normalized.resources = normalized.resources || { spiritStones: 0 };
  normalized.pity = normalized.pity || { sr: 0, ssr: 0 };
  normalized.progress = normalized.progress || { clearedStageIds: [], highestClearedOrder: 0 };
  normalized.progress.clearedStageIds = normalized.progress.clearedStageIds || [];
  normalized.progress.highestClearedOrder = normalized.progress.highestClearedOrder || 0;
  normalized.equipment = normalized.equipment || EQUIPMENT_SLOTS.reduce((obj, slot) => ({ ...obj, [slot]: null }), {});
  normalized.baseAttributes = normalized.baseAttributes || ATTRIBUTE_KEYS.reduce((obj, key) => ({ ...obj, [key]: 0 }), {});
  normalized.allocatedAttributes = normalized.allocatedAttributes || ATTRIBUTE_KEYS.reduce((obj, key) => ({ ...obj, [key]: 0 }), {});
  normalized.freePoints = Number.isFinite(normalized.freePoints) ? normalized.freePoints : 0;
  return normalized;
}
