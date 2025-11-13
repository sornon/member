'use strict';

const DEFAULT_PHASES = [
  {
    threshold: 0.75,
    effect: {
      type: 'shield',
      amountPercent: 0.12,
      summary: '古灵护佑：获得护盾并短暂抵御伤害'
    }
  },
  {
    threshold: 0.5,
    effect: {
      type: 'summon',
      bonus: {
        finalDamageBonus: 0.12,
        healingBonus: 0.08,
        speed: 25
      },
      summary: '灵藤相助：灵根抽芽提升攻势'
    }
  },
  {
    threshold: 0.25,
    effect: {
      type: 'enrage',
      bonus: {
        finalDamageBonus: 0.25,
        finalDamageReduction: -0.08,
        speed: 40
      },
      summary: '灵息暴走：暴怒之灵释放终焉之力'
    }
  }
];

const BOSS_DEFINITIONS = Object.freeze({
  ancient_spirit_tree: {
    id: 'ancient_spirit_tree',
    name: '上古灵木',
    level: 65,
    description: '沉眠于灵泉之畔的古木化形，能操控藤蔓与火焰灵息。',
    element: 'wood',
    hp: 52000,
    stats: {
      maxHp: 52000,
      physicalAttack: 420,
      magicAttack: 480,
      physicalDefense: 260,
      magicDefense: 290,
      speed: 165,
      accuracy: 180,
      dodge: 110,
      critRate: 0.18,
      critDamage: 1.65,
      finalDamageBonus: 0.18,
      finalDamageReduction: 0.12,
      controlHit: 30,
      controlResist: 35,
      lifeSteal: 0.08,
      healingBonus: 0.12
    },
    special: {
      bonusDamage: 65,
      healOnHit: 120,
      damageReflection: 0.05,
      shieldPower: 0.12
    },
    skills: [
      { id: 'spell_burning_burst', level: 30 },
      { id: 'spell_frost_bolt', level: 32 },
      { id: 'spell_thunder_chain', level: 28 },
      { id: 'spell_frost_prison', level: 27 },
      { id: 'body_bronze_skin', level: 26 }
    ],
    phases: DEFAULT_PHASES,
    enraged: {
      threshold: 0.1,
      bonus: {
        finalDamageBonus: 0.35,
        speed: 55,
        accuracy: 30
      },
      summary: '灵魄觉醒：终章必杀'
    }
  }
});

function clone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item));
  }
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((key) => {
      result[key] = clone(value[key]);
    });
    return result;
  }
  return value;
}

function getBossDefinition(bossId) {
  const key = typeof bossId === 'string' ? bossId.trim() : '';
  const definition = BOSS_DEFINITIONS[key];
  return definition ? clone(definition) : null;
}

function listBossDefinitions() {
  return Object.keys(BOSS_DEFINITIONS).map((key) => clone(BOSS_DEFINITIONS[key]));
}

module.exports = {
  getBossDefinition,
  listBossDefinitions,
  BOSS_DEFINITIONS
};
