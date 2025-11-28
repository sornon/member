'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BALANCE_VERSION = 'v1';
let balanceVersion = DEFAULT_BALANCE_VERSION;

const LEVEL_CURVE_DEFAULTS = {
  version: 'v1',
  profiles: {
    v1: {
      defaults: {
        combatStats: {
          maxHp: 2860,
          physicalAttack: 82,
          magicAttack: 82,
          physicalDefense: 61,
          magicDefense: 61,
          speed: 92,
          accuracy: 112,
          dodge: 96,
          critRate: 0.062,
          critDamage: 1.52,
          finalDamageBonus: 0,
          finalDamageReduction: 0.024,
          lifeSteal: 0,
          healingBonus: 0.08,
          healingReduction: 0,
          controlHit: 11,
          controlResist: 11,
          physicalPenetration: 1,
          magicPenetration: 1,
          critResist: 0.0184,
          comboRate: 0,
          block: 0,
          counterRate: 0,
          damageReduction: 0,
          healingReceived: 0,
          rageGain: 0,
          controlStrength: 0,
          shieldPower: 0,
          summonPower: 0,
          elementalVulnerability: 0
        },
        specialStats: {
          shield: 0,
          bonusDamage: 0,
          dodgeChance: 0,
          healOnHit: 0,
          healOnKill: 0,
          damageReflection: 0,
          accuracyBonus: 0,
          speedBonus: 0,
          physicalPenetrationBonus: 0,
          magicPenetrationBonus: 0
        }
      },
      hitFormula: { base: 0.85, slope: 0.005, min: 0.2, max: 0.99 },
      penetration: { scale: 0.005, max: 0.6 },
      baseDamage: { minAttackRatio: 0.25, randomMin: 0.9, randomRange: 0.2, minDamage: 1 },
      crit: { min: 0.05, max: 0.95, damageMin: 1.2 },
      finalDamage: { minMultiplier: 0.1, bonusClamp: { min: -0.9, max: 2 }, reductionClamp: { min: 0, max: 0.9 } },
      healing: {
        lifeStealMax: 0.6,
        healingBonusClamp: { min: -1, max: 1.5 },
        healingReductionClamp: { min: -1, max: 1.5 },
        healingReceivedClamp: { min: -0.5, max: 1.5 }
      },
      mitigation: { damageReductionMax: 0.8 },
      procCaps: { comboRateMax: 1, blockMax: 1, counterRateMax: 1 },
      specialCaps: { dodgeChanceMax: 0.8, damageReflectionMax: 0.8 },
      statFloors: { critDamageMin: 1.2 }
    },
    v2: {
      defaults: {},
      hitFormula: { base: 0.87 },
      baseDamage: { randomMin: 0.95, randomRange: 0.22 },
      crit: { min: 0.07 }
    }
  }
};

const EQUIPMENT_CURVE_DEFAULTS = {
  version: 'v1',
  profiles: { v1: { slots: ['weapon', 'armor', 'accessory'], enhancement: { base: 1 } }, v2: {} }
};

const SKILL_CURVE_DEFAULTS = {
  version: 'v1',
  profiles: {
    v1: {
      resource: {
        defaults: {
          type: 'qi',
          baseMax: 100,
          startFraction: 0,
          startValue: 0,
          turnGain: 20,
          basicAttackGain: 10,
          damageTakenGain: 1.5,
          critGain: 1,
          critTakenGain: 1
        }
      },
      controlEffects: {
        stun: { summary: '眩晕', skip: true, disableBasic: true, disableActive: true, disableDodge: true },
        silence: { summary: '沉默', skip: false, disableBasic: false, disableActive: true, disableDodge: false },
        freeze: {
          summary: '冰冻',
          skip: true,
          disableBasic: true,
          disableActive: true,
          disableDodge: true,
          breakOnFire: true,
          fireDamageMultiplier: 0.1
        },
        sleep: {
          summary: '陷入沉睡',
          skip: true,
          disableBasic: true,
          disableActive: true,
          disableDodge: true,
          wakeOnDamage: true,
          turnResourceGain: 10
        }
      }
    },
    v2: {
      resource: {
        defaults: {
          turnGain: 24,
          basicAttackGain: 12,
          damageTakenGain: 1.8,
          startFraction: 0.1
        }
      },
      controlEffects: {
        sleep: { turnResourceGain: 14 }
      }
    }
  }
};

const PVE_CURVE_DEFAULTS = {
  version: 'v1',
  profiles: {
    v1: {
      maxLevel: 100,
      roundLimit: 20,
      cooldownMs: 10 * 1000,
      cooldownMessage: '您的上一场战斗还没结束，请稍后再战',
      secretRealm: {
        baseStats: {
          maxHp: 920,
          physicalAttack: 120,
          magicAttack: 120,
          physicalDefense: 68,
          magicDefense: 65,
          speed: 82,
          accuracy: 118,
          dodge: 88,
          critRate: 0.06,
          critDamage: 1.52,
          finalDamageBonus: 0.025,
          finalDamageReduction: 0.035,
          lifeSteal: 0.015,
          controlHit: 26,
          controlResist: 18,
          physicalPenetration: 9,
          magicPenetration: 9
        },
        tuning: {
          baseMultiplier: 1,
          floorGrowth: 0.08,
          realmGrowth: 0.34,
          normal: { base: 1, primary: 1.35, secondary: 1.15, off: 0.98, weak: 0.85 },
          boss: { base: 1.22, primary: 1.68, secondary: 1.34, tertiary: 1.15, off: 1, weak: 0.88 },
          special: { base: 1, growth: 0.07, boss: 1.5 },
          limits: {
            critRate: 0.45,
            critDamage: 2.15,
            finalDamageBonus: 0.4,
            finalDamageReduction: 0.55,
            lifeSteal: 0.18,
            accuracy: 520,
            dodge: 420
          }
        }
      }
    },
    v2: {
      roundLimit: 18,
      secretRealm: {
        tuning: {
          normal: { primary: 1.25 },
          limits: { finalDamageReduction: 0.5 }
        }
      }
    }
  }
};

const PVP_CONFIG_DEFAULTS = {
  version: 'v1',
  profiles: {
    v1: {
      roundLimit: 15,
      cooldownMs: 10 * 1000,
      cooldownMessage: '您的上一场战斗还没结束，请稍后再战',
      seasonLengthDays: 56,
      leaderboardCacheSize: 100,
      leaderboardSchemaVersion: 2,
      recentMatchLimit: 10,
      defaultRating: 1200,
      tiers: [
        { id: 'bronze', name: '青铜', min: 0, max: 999, color: '#c4723a', rewardKey: 'bronze' },
        { id: 'silver', name: '白银', min: 1000, max: 1499, color: '#c0c0c0', rewardKey: 'silver' },
        { id: 'gold', name: '黄金', min: 1500, max: 1999, color: '#d4af37', rewardKey: 'gold' },
        { id: 'platinum', name: '白金', min: 2000, max: 2399, color: '#e5f0ff', rewardKey: 'platinum' },
        { id: 'diamond', name: '钻石', min: 2400, max: 2799, color: '#7dd3fc', rewardKey: 'diamond' },
        { id: 'master', name: '宗师', min: 2800, max: Infinity, color: '#f472b6', rewardKey: 'master' }
      ],
      tierRewards: {
        bronze: { stones: 50, title: '青铜试剑者', coupon: null },
        silver: { stones: 80, title: '白银破阵者', coupon: 'coupon_pvp_silver' },
        gold: { stones: 120, title: '黄金斗剑士', coupon: 'coupon_pvp_gold' },
        platinum: { stones: 160, title: '白金灵刃', coupon: 'coupon_pvp_platinum' },
        diamond: { stones: 220, title: '钻石星耀者', coupon: 'coupon_pvp_diamond' },
        master: { stones: 320, title: '宗师武曲星', coupon: 'coupon_pvp_master' }
      }
    },
    v2: {
      roundLimit: 13
    }
  }
};

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? override : base;
  }
  if (typeof base !== 'object' || typeof override !== 'object' || !override) {
    return override !== undefined ? override : base;
  }
  const result = { ...base };
  Object.keys(override).forEach((key) => {
    result[key] = deepMerge(base[key], override[key]);
  });
  return result;
}

function pickProfile(config, fallbackProfile) {
  if (!config || typeof config !== 'object') {
    return { profile: fallbackProfile, version: balanceVersion };
  }
  const profileKey = typeof config.version === 'string' && config.version ? config.version : balanceVersion;
  const profiles = config.profiles && typeof config.profiles === 'object' ? config.profiles : null;
  const selected = profiles && profiles[balanceVersion] ? profiles[balanceVersion] : profiles && profiles[profileKey];
  if (selected) {
    return { profile: selected, version: profileKey || balanceVersion };
  }
  if (profiles) {
    const firstKey = Object.keys(profiles)[0];
    if (firstKey && profiles[firstKey]) {
      console.warn('[balance/config-loader] profile not found, fallback to first key', firstKey);
      return { profile: profiles[firstKey], version: firstKey };
    }
  }
  return { profile: fallbackProfile, version: balanceVersion };
}

function readConfigFromFile(fileName) {
  const baseDir = process.env.BALANCE_CONFIG_DIR || path.join(__dirname, '../config/balance');
  const resolved = path.join(baseDir, fileName);
  try {
    const content = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[balance/config-loader] failed to load ${fileName}, using defaults`, error && error.message);
    return null;
  }
}

function buildGetter(cacheKey, fileName, defaults) {
  let cache = null;
  const getter = function getConfig() {
    if (cache) {
      return cache;
    }
    const loaded = readConfigFromFile(fileName);
    const fallbackProfile = pickProfile(defaults, defaults.profiles[balanceVersion]).profile;
    const { profile, version } = pickProfile(loaded || {}, fallbackProfile);
    cache = deepMerge(fallbackProfile, profile || {});
    cache.version = version || balanceVersion;
    return cache;
  };
  getter.__reset = () => {
    cache = null;
  };
  return getter;
}

const getLevelCurveConfig = buildGetter('level', 'level-curves.json', LEVEL_CURVE_DEFAULTS);
const getEquipmentCurveConfig = buildGetter('equipment', 'equipment-curves.json', EQUIPMENT_CURVE_DEFAULTS);
const getSkillCurveConfig = buildGetter('skill', 'skill-curves.json', SKILL_CURVE_DEFAULTS);
const getPveCurveConfig = buildGetter('pve', 'pve-curves.json', PVE_CURVE_DEFAULTS);
const getPvpConfig = buildGetter('pvp', 'pvp-config.json', PVP_CONFIG_DEFAULTS);

function setBalanceVersion(version = DEFAULT_BALANCE_VERSION) {
  const normalized = typeof version === 'string' && version.trim() ? version.trim() : DEFAULT_BALANCE_VERSION;
  if (normalized === balanceVersion) {
    return balanceVersion;
  }
  balanceVersion = normalized;
  resetCache();
  return balanceVersion;
}

function resetCache() {
  getLevelCurveConfig.__reset();
  getEquipmentCurveConfig.__reset();
  getSkillCurveConfig.__reset();
  getPveCurveConfig.__reset();
  getPvpConfig.__reset();
}

function getBalanceVersion() {
  return balanceVersion;
}

module.exports = {
  getLevelCurveConfig,
  getEquipmentCurveConfig,
  getSkillCurveConfig,
  getPveCurveConfig,
  getPvpConfig,
  setBalanceVersion,
  getBalanceVersion,
  __resetBalanceCache: resetCache,
  DEFAULT_BALANCE_VERSION
};
