const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const {
  COLLECTIONS,
  realmConfigs,
  subLevelLabels,
  DEFAULT_ADMIN_ROLES,
  pickPortraitUrl,
  normalizeAvatarFrameValue,
  buildCloudAssetUrl
} = require('common-config');
const { createProxyHelpers } = require('admin-proxy');
const {
  DEFAULT_COMBAT_STATS,
  clamp,
  createCombatantFromAttributes,
  resolveCombatStats,
  resolveSpecialStats,
  calculateCombatPower,
  determineRoundOrder
} = require('combat-system');
const {
  buildSkillLoadout: buildRuntimeSkillLoadout,
  createActorRuntime,
  takeTurn: executeSkillTurn,
  configureResourceDefaults
} = require('skill-engine');
const {
  DEFAULT_GAME_PARAMETERS,
  buildResourceConfigOverrides,
  resolveGameParametersFromDocument,
  FEATURE_TOGGLE_DOC_ID
} = require('system-settings');
const { createBattlePayload } = require('battle-schema');
const {
  BASE_ATTRIBUTE_KEYS,
  COMBAT_STAT_KEYS,
  SKILL_TYPES,
  SKILL_DISCIPLINES,
  ELEMENT_CONFIG,
  SKILL_QUALITY_CONFIG,
  SKILL_LIBRARY,
  SKILL_MAP,
  SKILL_HIGHLIGHT_CATEGORY_LABELS,
  createBonusSummary,
  applyBonus,
  mergeBonusSummary,
  flattenBonusSummary,
  aggregateSkillEffects,
  resolveSkillEffects,
  formatSkillProgression,
  buildSkillHighlightSummaries,
  resolveSkillQualityColor,
  resolveSkillQualityLabel,
  resolveSkillTypeLabel,
  resolveSkillDisciplineLabel,
  resolveSkillElementLabel,
  resolveSkillMaxLevel
} = require('skill-model');

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'pve' });
const ensuredCollections = new Set();

const BACKGROUND_IDS = new Set([
  'realm_refining',
  'trial_spirit_test',
  'realm_foundation',
  'reward_foundation',
  'realm_core',
  'realm_nascent',
  'realm_divine',
  'realm_void',
  'realm_unity',
  'realm_great_vehicle',
  'realm_tribulation',
  'realm_ascension'
]);

function normalizeBackgroundId(id) {
  if (typeof id !== 'string') {
    return '';
  }
  const trimmed = id.trim();
  return BACKGROUND_IDS.has(trimmed) ? trimmed : '';
}

function resolveDateInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assertBattleCooldown(lastBattleAt, now = new Date()) {
  if (!lastBattleAt) {
    return;
  }
  const last = resolveDateInput(lastBattleAt);
  if (!last) {
    return;
  }
  if (now.getTime() - last.getTime() < BATTLE_COOLDOWN_MS) {
    throw createError('BATTLE_COOLDOWN_ACTIVE', BATTLE_COOLDOWN_MESSAGE);
  }
}

const MAX_LEVEL = 100;
const MAX_SKILL_SLOTS = 3;
const MAX_BATTLE_HISTORY = 15;
const MAX_SKILL_HISTORY = 30;
const BATTLE_HISTORY_LOG_LIMIT = 30;
const BATTLE_ARCHIVE_LOG_LIMIT = 120;
const BATTLE_ARCHIVE_MIGRATION_LIMIT = 2;
const BATTLE_ARCHIVE_COLLECTION =
  (COLLECTIONS && COLLECTIONS.MEMBER_BATTLE_ARCHIVE) || 'memberBattleArchive';
const DEFAULT_SKILL_DRAW_CREDITS = 1;
const BATTLE_COOLDOWN_MS = 10 * 1000;
const BATTLE_COOLDOWN_MESSAGE = '您的上一场战斗还没结束，请稍后再战';

const ENEMY_COMBAT_DEFAULTS = {
  ...DEFAULT_COMBAT_STATS,
  maxHp: 0,
  physicalAttack: 0,
  magicAttack: 0,
  physicalDefense: 0,
  magicDefense: 0,
  speed: 0,
  accuracy: 110,
  dodge: 0,
  critRate: 0.05,
  critDamage: 1.5
};

const SECRET_REALM_BACKGROUND_VIDEO = buildCloudAssetUrl('background', 'mijing.mp4');

const SECRET_REALM_BASE_STATS = {
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
};

const SECRET_REALM_TUNING = {
  baseMultiplier: 1,
  floorGrowth: 0.08,
  realmGrowth: 0.34,
  normal: {
    base: 1,
    primary: 1.35,
    secondary: 1.15,
    off: 0.98,
    weak: 0.85
  },
  boss: {
    base: 1.22,
    primary: 1.68,
    secondary: 1.34,
    tertiary: 1.15,
    off: 1,
    weak: 0.88
  },
  special: {
    base: 1,
    growth: 0.07,
    boss: 1.5
  },
  limits: {
    critRate: 0.45,
    critDamage: 2.15,
    finalDamageBonus: 0.4,
    finalDamageReduction: 0.55,
    lifeSteal: 0.18,
    accuracy: 520,
    dodge: 420
  }
};

const GLOBAL_PARAMETERS_TTL_MS = 60 * 1000;
let cachedGlobalParameters = null;
let cachedGlobalOverrides = null;
let cachedGlobalParametersExpiresAt = 0;

async function applyGlobalGameParameters() {
  const now = Date.now();
  if (cachedGlobalParameters && cachedGlobalParametersExpiresAt > now) {
    try {
      if (cachedGlobalOverrides) {
        configureResourceDefaults(cachedGlobalOverrides);
      }
      return cachedGlobalParameters;
    } catch (error) {
      console.error('[pve] reuse cached game parameters failed', error);
    }
  }

  try {
    const snapshot = await db
      .collection(COLLECTIONS.SYSTEM_SETTINGS)
      .doc(FEATURE_TOGGLE_DOC_ID)
      .get();
    const document = snapshot && snapshot.data ? snapshot.data : null;
    const parameters = resolveGameParametersFromDocument(document);
    const overrides = buildResourceConfigOverrides(parameters);
    configureResourceDefaults(overrides);
    cachedGlobalParameters = parameters;
    cachedGlobalOverrides = overrides;
    cachedGlobalParametersExpiresAt = Date.now() + GLOBAL_PARAMETERS_TTL_MS;
    return parameters;
  } catch (error) {
    if (!(error && error.errMsg && /not exist|not found/i.test(error.errMsg))) {
      console.error('[pve] load game parameters failed', error);
    }
    const fallback = DEFAULT_GAME_PARAMETERS;
    const overrides = buildResourceConfigOverrides(fallback);
    configureResourceDefaults(overrides);
    cachedGlobalParameters = fallback;
    cachedGlobalOverrides = overrides;
    cachedGlobalParametersExpiresAt = Date.now() + GLOBAL_PARAMETERS_TTL_MS;
    return fallback;
  }
}

function isCollectionNotFoundError(error) {
  if (!error) {
    return false;
  }
  if (error.errCode === -502005 || error.code === 'ResourceNotFound') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /collection\s+not\s+exists/i.test(message) || /ResourceNotFound/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error) {
    return false;
  }
  if (error.errCode === -502006 || error.code === 'ResourceExists') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /already\s+exists/i.test(message);
}

async function ensureCollection(name) {
  if (!name || ensuredCollections.has(name)) {
    return;
  }
  try {
    await db
      .collection(name)
      .limit(1)
      .get();
    ensuredCollections.add(name);
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
    if (typeof db.createCollection !== 'function') {
      throw error;
    }
    try {
      await db.createCollection(name);
      ensuredCollections.add(name);
    } catch (createError) {
      if (isCollectionAlreadyExistsError(createError)) {
        ensuredCollections.add(name);
        return;
      }
      throw createError;
    }
  }
}

const SECRET_REALM_ARCHETYPES = [
  {
    key: 'vitality_guardian',
    title: '灵木护卫',
    description: '借灵木之躯抵挡伤害，考验修士的持续输出。',
    primary: 'maxHp',
    secondary: ['physicalDefense', 'lifeSteal'],
    weak: ['speed'],
    damageType: 'physical',
    special: { shield: 48, bonusDamage: 12 }
  },
  {
    key: 'stone_monk',
    title: '破岩武僧',
    description: '以巨力碾碎护体真气，近战压迫极强。',
    primary: 'physicalAttack',
    secondary: ['physicalPenetration', 'finalDamageBonus'],
    weak: ['magicDefense'],
    damageType: 'physical',
    special: { bonusDamage: 32 }
  },
  {
    key: 'frost_magus',
    title: '凝霜术士',
    description: '汇聚寒霜之力，远程术法尖锐。',
    primary: 'magicAttack',
    secondary: ['magicPenetration', 'controlHit'],
    weak: ['physicalDefense'],
    damageType: 'magic',
    special: { bonusDamage: 28 }
  },
  {
    key: 'golden_defender',
    title: '金甲守军',
    description: '金甲不坏，重甲推进迫使修士寻找破绽。',
    primary: 'physicalDefense',
    secondary: ['maxHp', 'finalDamageReduction'],
    weak: ['dodge'],
    damageType: 'physical',
    special: { shield: 60 }
  },
  {
    key: 'spirit_warden',
    title: '灵盾护法',
    description: '灵盾庇护术法，擅长抵御元素冲击。',
    primary: 'magicDefense',
    secondary: ['controlResist', 'finalDamageReduction'],
    weak: ['physicalAttack'],
    damageType: 'magic',
    special: { shield: 72 }
  },
  {
    key: 'shadow_runner',
    title: '疾影游侠',
    description: '身法如电，抢占先机发动连击。',
    primary: 'speed',
    secondary: ['dodge'],
    weak: ['maxHp'],
    damageType: 'physical',
    special: { bonusDamage: 24, dodgeChance: 0.06 }
  },
  {
    key: 'sky_sharpshooter',
    title: '天眼射手',
    description: '洞察弱点百步穿杨，命中与暴击惊人。',
    primary: 'accuracy',
    secondary: ['critRate', 'critDamage'],
    weak: ['physicalDefense'],
    damageType: 'physical',
    special: { bonusDamage: 30 }
  },
  {
    key: 'phantom_trickster',
    title: '迷踪幻徒',
    description: '游走于虚实之间，靠高闪避消耗对手。',
    primary: 'dodge',
    secondary: ['speed', 'lifeSteal'],
    weak: ['physicalDefense'],
    damageType: 'magic',
    special: { dodgeChance: 0.1 }
  },
  {
    key: 'mind_binder',
    title: '心魄缚者',
    description: '以神识压制修士，控制命中惊人。',
    primary: 'controlHit',
    secondary: ['magicAttack', 'controlResist'],
    weak: ['speed'],
    damageType: 'magic',
    special: { bonusDamage: 26 }
  }
];

const SECRET_REALM_BOSS_ARCHETYPE = {
  key: 'realm_overseer',
  title: '镇境首领',
  description: '统御本境的强者，同时兼具爆发、守御与先手能力。',
  primary: ['maxHp', 'physicalAttack', 'magicAttack'],
  secondary: ['physicalDefense', 'magicDefense'],
  tertiary: ['speed'],
  damageType: 'hybrid',
  special: { shield: 140, bonusDamage: 60, dodgeChance: 0.08 }
};

const SECRET_REALM_ARCHETYPE_LABELS = SECRET_REALM_ARCHETYPES.reduce(
  (acc, archetype) => {
    if (archetype && archetype.key) {
      acc[archetype.key] = archetype.title || archetype.name || archetype.key;
    }
    return acc;
  },
  { [SECRET_REALM_BOSS_ARCHETYPE.key]: SECRET_REALM_BOSS_ARCHETYPE.title }
);

const SECRET_REALM_ARCHETYPE_SKILLS = Object.freeze({
  vitality_guardian: ['body_rockridge_guard', 'body_bronze_skin', 'sigil_taiyi_barrier'],
  stone_monk: ['sword_breaking_clouds', 'body_blood_fury', 'sword_flowing_strike'],
  frost_magus: ['spell_frost_bolt', 'spell_frost_tide', 'spell_frost_prison'],
  golden_defender: ['body_stone_bulwark', 'body_diamond_eternity', 'sigil_focus_talisman'],
  spirit_warden: ['sigil_void_respiration', 'sigil_purified_mind', 'spell_searing_comet'],
  shadow_runner: ['sword_flame_wings', 'sword_thunder_break', 'spell_thunder_chain'],
  sky_sharpshooter: ['sword_thousand_blades', 'sword_blazing_brand', 'sigil_corroding_mark'],
  phantom_trickster: ['sigil_heart_rot', 'sigil_soul_bind', 'spell_thunder_chain'],
  mind_binder: ['sigil_rupture_chain', 'sigil_taiyi_barrier', 'sigil_heart_rot'],
  realm_overseer: ['sword_immortal_domain', 'spell_pyrocataclysm', 'body_furnace_of_ruin']
});

const SECRET_REALM_LOOT_PRESETS = Object.freeze({
  1: {
    normal: {
      chance: 0.12,
      items: ['mortal_weapon_staff', 'mortal_bracer_stone', 'mortal_chest_robe']
    }
  },
  2: {
    normal: {
      chance: 0.12,
      items: ['mortal_boots_cloth', 'mortal_belt_rope', 'mortal_focus_brush']
    }
  },
  3: {
    normal: {
      chance: 0.12,
      items: ['mortal_helm_headband', 'mortal_treasure_dawn', 'mortal_puppet_wood']
    }
  },
  4: {
    normal: {
      chance: 0.13,
      items: ['mortal_weapon_sabre', 'mortal_bracer_echo', 'mortal_chest_plate']
    }
  },
  5: {
    normal: {
      chance: 0.13,
      items: ['mortal_boots_lightstep', 'mortal_belt_ring', 'mortal_orb_calm']
    }
  },
  6: {
    normal: {
      chance: 0.13,
      items: ['mortal_helm_veil', 'mortal_necklace_care', 'mortal_treasure_ward']
    }
  },
  7: {
    normal: {
      chance: 0.14,
      items: ['mortal_weapon_crossbow', 'mortal_bracer_leaf', 'mortal_chest_mantle']
    }
  },
  8: {
    normal: {
      chance: 0.14,
      items: ['mortal_boots_balance', 'mortal_belt_wrap', 'mortal_orb_flame']
    }
  },
  9: {
    normal: {
      chance: 0.14,
      items: ['mortal_helm_mask', 'mortal_necklace_fang', 'mortal_treasure_flare']
    }
  },
  10: {
    boss: {
      items: [
        { itemId: 'novice_sword', chance: 0.18 },
        { itemId: 'apprentice_robe', chance: 0.18 },
        { itemId: 'lightstep_boots', chance: 0.18 },
        { itemId: 'initiate_bracers', chance: 0.18 },
        { itemId: 'initiate_orb', chance: 0.18 },
        { itemId: 'spirit_ring', chance: 0.18 },
        { itemId: 'spirit_blade', chance: 0.08 }
      ]
    }
  },
  11: {
    normal: {
      chance: 0.11,
      items: ['starsea_mail', 'stoneheart_belt', 'guardian_token']
    }
  },
  12: {
    normal: {
      chance: 0.11,
      items: ['spirit_blade', 'stormwrath_bracers', 'ironwall_puppet']
    }
  },
  13: {
    normal: {
      chance: 0.11,
      items: ['void_silk', 'chronos_orb', 'skyline_necklace']
    }
  },
  14: {
    normal: {
      chance: 0.1,
      items: ['starlit_visor', 'shade_boots', 'umbra_bracers']
    }
  },
  15: {
    normal: {
      chance: 0.1,
      items: ['lumina_belt', 'aegis_orb', 'serene_token']
    }
  },
  16: {
    normal: {
      chance: 0.1,
      items: ['guardian_puppet', 'veil_treasure', 'phantom_focus']
    }
  },
  17: {
    normal: {
      chance: 0.09,
      items: ['abyssal_focus', 'shadow_talisman', 'dragonbone_sabre']
    }
  },
  18: {
    normal: {
      chance: 0.09,
      items: ['void_silk', 'chronos_orb', 'skyline_necklace']
    }
  },
  19: {
    normal: {
      chance: 0.09,
      items: ['lumina_belt', 'aegis_orb', 'guardian_token']
    }
  },
  20: {
    boss: {
      items: [
        { itemId: 'dragonbone_sabre', chance: 0.2 },
        { itemId: 'abyssal_focus', chance: 0.2 },
        { itemId: 'shadow_talisman', chance: 0.2 },
        { itemId: 'guardian_puppet', chance: 0.2 },
        { itemId: 'veil_treasure', chance: 0.18 },
        { itemId: 'aegis_orb', chance: 0.18 },
        { itemId: 'inferno_orb', chance: 0.07 },
        { itemId: 'ember_focus', chance: 0.07 },
        { itemId: 'phoenix_plume', chance: 0.07 }
      ]
    }
  },
  21: {
    normal: {
      chance: 0.09,
      items: ['dragonbone_sabre', 'shadow_talisman', 'abyssal_focus']
    }
  },
  22: {
    normal: {
      chance: 0.09,
      items: ['veil_treasure', 'phantom_focus', 'umbra_bracers']
    }
  },
  23: {
    normal: {
      chance: 0.09,
      items: ['chronos_orb', 'skyline_necklace', 'starlit_visor']
    }
  },
  24: {
    normal: {
      chance: 0.09,
      items: ['shade_boots', 'void_silk', 'guardian_puppet']
    }
  },
  25: {
    normal: {
      chance: 0.08,
      items: ['lumina_belt', 'aegis_orb', 'serene_token']
    }
  },
  26: {
    normal: {
      chance: 0.08,
      items: ['starsea_mail', 'stoneheart_belt', 'guardian_token']
    }
  },
  27: {
    normal: {
      chance: 0.08,
      items: ['stormwrath_bracers', 'spirit_blade', 'ironwall_puppet']
    }
  },
  28: {
    normal: {
      items: [
        { itemId: 'inferno_orb', chance: 0.06 },
        { itemId: 'ember_focus', chance: 0.06 },
        { itemId: 'phoenix_plume', chance: 0.06 }
      ]
    }
  },
  29: {
    normal: {
      chance: 0.09,
      items: ['dragonbone_sabre', 'abyssal_focus', 'shadow_talisman']
    }
  },
  30: {
    boss: {
      items: [
        { itemId: 'dragonbone_sabre', chance: 0.22 },
        { itemId: 'abyssal_focus', chance: 0.22 },
        { itemId: 'shadow_talisman', chance: 0.22 },
        { itemId: 'guardian_puppet', chance: 0.2 },
        { itemId: 'veil_treasure', chance: 0.2 },
        { itemId: 'aegis_orb', chance: 0.2 },
        { itemId: 'inferno_orb', chance: 0.08 },
        { itemId: 'ember_focus', chance: 0.08 },
        { itemId: 'phoenix_plume', chance: 0.08 }
      ]
    }
  }
});

function normalizeLootEntry(entry, baseChance) {
  if (typeof entry === 'string') {
    if (!Number.isFinite(baseChance) || baseChance <= 0) {
      return null;
    }
    return { type: 'equipment', itemId: entry, chance: baseChance };
  }
  if (entry && typeof entry === 'object') {
    const chance = Number.isFinite(entry.chance) ? entry.chance : baseChance;
    if (!Number.isFinite(chance) || chance <= 0) {
      return null;
    }
    const type = entry.type || 'equipment';
    if (type === 'equipment') {
      const itemId =
        typeof entry.itemId === 'string'
          ? entry.itemId
          : typeof entry.id === 'string'
          ? entry.id
          : '';
      if (!itemId) {
        return null;
      }
      return { type: 'equipment', itemId, chance };
    }
    if (type === 'skill') {
      const skillId =
        typeof entry.skillId === 'string'
          ? entry.skillId
          : typeof entry.id === 'string'
          ? entry.id
          : '';
      if (!skillId) {
        return null;
      }
      return { type: 'skill', skillId, chance };
    }
    if (type === 'consumable') {
      const consumableId =
        typeof entry.consumableId === 'string'
          ? entry.consumableId
          : typeof entry.id === 'string'
          ? entry.id
          : '';
      if (!consumableId) {
        return null;
      }
      return { type: 'consumable', consumableId, chance };
    }
  }
  return null;
}

function resolveSecretRealmLoot({ floorNumber, type }) {
  const preset = SECRET_REALM_LOOT_PRESETS[floorNumber];
  if (!preset) {
    return [];
  }
  const config = type === 'boss' ? preset.boss || preset.normal : preset.normal;
  if (!config) {
    return [];
  }
  const baseChance = Number.isFinite(config.chance) ? config.chance : NaN;
  const items = Array.isArray(config.items) ? config.items : [];
  return items
    .map((entry) => normalizeLootEntry(entry, baseChance))
    .filter(Boolean);
}

function buildSecretRealmLibrary() {
  if (!Array.isArray(realmConfigs) || !realmConfigs.length) {
    return [];
  }
  const perRealm = Array.isArray(subLevelLabels) && subLevelLabels.length ? subLevelLabels.length : 10;
  const labels = Array.isArray(subLevelLabels) && subLevelLabels.length ? subLevelLabels : new Array(perRealm).fill('一层').map((_, idx) => `${idx + 1}`);
  const floors = [];

  realmConfigs.forEach((realm, realmIndex) => {
    labels.forEach((label, subIndex) => {
      const type = subIndex === labels.length - 1 ? 'boss' : 'normal';
      const archetype =
        type === 'boss'
          ? SECRET_REALM_BOSS_ARCHETYPE
          : SECRET_REALM_ARCHETYPES[subIndex % SECRET_REALM_ARCHETYPES.length];
      floors.push(
        createSecretRealmEnemy({ realm, realmIndex, subIndex, label, type, archetype, perRealm })
      );
    });
  });

  return floors;
}

function createSecretRealmEnemy({ realm, realmIndex, subIndex, label, type, archetype, perRealm }) {
  const floorNumber = realmIndex * perRealm + subIndex + 1;
  const floorCode = subIndex + 1;
  const stageName = `${realm.name} · ${label}`;
  const scaling = resolveSecretRealmScaling({ realmIndex, subIndex, perRealm, type });
  const stats = generateSecretRealmStats(archetype, scaling, type);
  const special = generateSecretRealmSpecial(archetype, scaling, type);
  const attributes = deriveEnemyAttributesFromStats(stats, floorNumber);
  const rewards = resolveSecretRealmRewards({ floorNumber, type, scaling });
  const loot = resolveSecretRealmLoot({ floorNumber, type });
  const normalizedRealmId = realm.id || realm.realmId || `realm_${realmIndex + 1}`;
  const id = `secret_${normalizedRealmId}_${String(floorCode).padStart(2, '0')}`;
  const description = `${archetype.description}（${stageName}）`;
  const skills = resolveSecretRealmSkillSet(archetype.key);

  return {
    id,
    category: 'secretRealm',
    archetype: archetype.key,
    type,
    floor: floorNumber,
    floorLabel: `第${floorNumber}层`,
    stageName,
    stageLabel: label,
    realmId: normalizedRealmId,
    realmName: realm.name,
    realmShort: realm.shortName,
    realmOrder: realmIndex + 1,
    level: floorNumber,
    name: `${archetype.title}`,
    description,
    attributes,
    stats,
    special,
    skills,
    rewards,
    loot,
    meta: {
      scaling,
      suggestedRewards: rewards && rewards._model ? rewards._model : null
    }
  };
}

function resolveSecretRealmSkillSet(archetypeKey) {
  const preset = SECRET_REALM_ARCHETYPE_SKILLS[archetypeKey];
  if (!Array.isArray(preset) || !preset.length) {
    return [];
  }
  const seen = new Set();
  const skills = [];
  preset.forEach((entry) => {
    let skillId = '';
    if (typeof entry === 'string') {
      skillId = entry.trim();
    } else if (entry && typeof entry.skillId === 'string') {
      skillId = entry.skillId.trim();
    } else if (entry && typeof entry.id === 'string') {
      skillId = entry.id.trim();
    }
    if (!skillId || seen.has(skillId)) {
      return;
    }
    if (!SKILL_MAP[skillId]) {
      return;
    }
    seen.add(skillId);
    skills.push(skillId);
  });
  return skills;
}

function resolveSecretRealmScaling({ realmIndex, subIndex, perRealm, type }) {
  const floorIndex = realmIndex * perRealm + subIndex;
  const floorMultiplier = Math.pow(1 + SECRET_REALM_TUNING.floorGrowth, floorIndex);
  const realmMultiplier = Math.pow(1 + SECRET_REALM_TUNING.realmGrowth, realmIndex);
  const typeBase = type === 'boss' ? SECRET_REALM_TUNING.boss.base : SECRET_REALM_TUNING.normal.base;
  const stat = SECRET_REALM_TUNING.baseMultiplier * floorMultiplier * realmMultiplier * typeBase;
  const special =
    SECRET_REALM_TUNING.special.base *
    Math.pow(1 + SECRET_REALM_TUNING.special.growth, floorIndex) *
    realmMultiplier *
    (type === 'boss' ? SECRET_REALM_TUNING.special.boss : 1);
  return { stat, special, floorIndex };
}

function generateSecretRealmStats(archetype, scaling, type) {
  const stats = {};
  const primary = Array.isArray(archetype.primary) ? archetype.primary : [archetype.primary];
  const secondary = Array.isArray(archetype.secondary) ? archetype.secondary : archetype.secondary ? [archetype.secondary] : [];
  const tertiary = Array.isArray(archetype.tertiary) ? archetype.tertiary : archetype.tertiary ? [archetype.tertiary] : [];
  const weak = Array.isArray(archetype.weak) ? archetype.weak : archetype.weak ? [archetype.weak] : [];
  const tuning = type === 'boss' ? SECRET_REALM_TUNING.boss : SECRET_REALM_TUNING.normal;

  Object.keys(SECRET_REALM_BASE_STATS).forEach((key) => {
    const baseValue = SECRET_REALM_BASE_STATS[key];
    let value = baseValue * scaling.stat;
    if (primary.includes(key)) {
      value *= tuning.primary;
    } else if (secondary.includes(key)) {
      value *= tuning.secondary;
    } else if (tertiary.includes(key) && type === 'boss') {
      value *= SECRET_REALM_TUNING.boss.tertiary;
    } else if (weak.includes(key)) {
      value *= tuning.weak;
    } else {
      value *= tuning.off;
    }

    if (archetype.damageType === 'physical' && key === 'magicAttack') {
      value *= 0.72;
    }
    if (archetype.damageType === 'physical' && key === 'magicPenetration') {
      value *= 0.7;
    }
    if (archetype.damageType === 'magic' && key === 'physicalAttack') {
      value *= 0.72;
    }
    if (archetype.damageType === 'magic' && key === 'physicalPenetration') {
      value *= 0.7;
    }
    if (archetype.damageType === 'hybrid' && (key === 'physicalAttack' || key === 'magicAttack')) {
      value *= 1.08;
    }

    if (key === 'critRate') {
      value = Math.min(SECRET_REALM_TUNING.limits.critRate, value);
      stats[key] = Number(value.toFixed(4));
    } else if (key === 'critDamage') {
      value = Math.min(SECRET_REALM_TUNING.limits.critDamage, value);
      stats[key] = Number(value.toFixed(2));
    } else if (key === 'finalDamageBonus' || key === 'finalDamageReduction' || key === 'lifeSteal') {
      const limitKey = key;
      const limit = SECRET_REALM_TUNING.limits[limitKey];
      if (limit) {
        value = Math.min(limit, value);
      }
      stats[key] = Number(value.toFixed(4));
    } else {
      let rounded = Math.round(value);
      if (key === 'accuracy' && SECRET_REALM_TUNING.limits.accuracy) {
        rounded = Math.min(SECRET_REALM_TUNING.limits.accuracy, rounded);
      }
      if (key === 'dodge' && SECRET_REALM_TUNING.limits.dodge) {
        rounded = Math.min(SECRET_REALM_TUNING.limits.dodge, rounded);
      }
      stats[key] = Math.max(0, rounded);
    }
  });

  if (!stats.maxHp || stats.maxHp < 1) {
    stats.maxHp = Math.max(600, Math.round(SECRET_REALM_BASE_STATS.maxHp * scaling.stat));
  }
  if (!stats.accuracy || stats.accuracy < 100) {
    stats.accuracy = 100;
  }
  if (!stats.dodge || stats.dodge < 60) {
    stats.dodge = 60;
  }

  return stats;
}

function generateSecretRealmSpecial(archetype, scaling, type) {
  const special = {};
  const payload = archetype.special || {};
  Object.keys(payload).forEach((key) => {
    const base = payload[key];
    if (typeof base !== 'number') {
      return;
    }
    const value = base * scaling.special;
    if (key === 'dodgeChance') {
      special[key] = Math.min(0.4, Number(value.toFixed(4)));
    } else {
      special[key] = Math.round(value);
    }
  });

  if (type === 'boss') {
    special.bonusDamage = Math.max(special.bonusDamage || 0, Math.round(45 * scaling.special));
  }

  return special;
}

function deriveEnemyAttributesFromStats(statsSource, fallbackLevel = 1) {
  const stats = sanitizeNumericRecord(statsSource);
  const normalizedLevel = Math.max(1, Math.floor(Number(fallbackLevel) || 1));
  const fallbackBase = calculateBaseAttributesForLevel(normalizedLevel);
  if (!stats || !Object.keys(stats).length) {
    return fallbackBase;
  }

  const attributes = {};
  const speed = Number(stats.speed);
  if (Number.isFinite(speed)) {
    attributes.agility = Math.max(0, Math.round(speed - 80));
  }
  const accuracy = Number(stats.accuracy);
  if (Number.isFinite(accuracy)) {
    attributes.insight = Math.max(0, Math.round(accuracy - 100));
  }
  const physicalAttack = Number(stats.physicalAttack);
  if (Number.isFinite(physicalAttack)) {
    attributes.strength = Math.max(0, Math.round((physicalAttack - 50) / 2));
  }
  const magicAttack = Number(stats.magicAttack);
  if (Number.isFinite(magicAttack)) {
    attributes.spirit = Math.max(0, Math.round((magicAttack - 50) / 2));
  }

  const strengthComponent = Number.isFinite(attributes.strength) ? attributes.strength * 0.2 : 0;
  const spiritComponent = Number.isFinite(attributes.spirit) ? attributes.spirit * 0.2 : 0;
  const rootCandidates = [];
  const physicalDefense = Number(stats.physicalDefense);
  if (Number.isFinite(physicalDefense)) {
    rootCandidates.push(physicalDefense - 40 - strengthComponent);
  }
  const magicDefense = Number(stats.magicDefense);
  if (Number.isFinite(magicDefense)) {
    rootCandidates.push(magicDefense - 40 - spiritComponent);
  }
  if (rootCandidates.length) {
    const rootRaw = rootCandidates.reduce((sum, value) => sum + value, 0) / rootCandidates.length;
    attributes.root = Math.max(0, Math.round(rootRaw));
  }

  const rootContribution = Number.isFinite(attributes.root) ? attributes.root * 5 : 0;
  const maxHp = Number(stats.maxHp);
  if (Number.isFinite(maxHp)) {
    const constitutionRaw = (maxHp - 200 - rootContribution) / 20;
    attributes.constitution = Math.max(0, Math.round(constitutionRaw));
  }

  const resolved = { ...fallbackBase };
  BASE_ATTRIBUTE_KEYS.forEach((key) => {
    const value = Number(attributes[key]);
    if (Number.isFinite(value)) {
      resolved[key] = Math.max(0, Math.round(value));
    }
  });
  return sanitizeNumericRecord(resolved);
}

function resolveSecretRealmRewards({ floorNumber, type, scaling }) {
  const baseStones = 0;
  const attributePoints = 0;
  const suggested = {
    baseStones: Math.round(24 + floorNumber * 2.5),
    typeMultiplier: type === 'boss' ? 2 : 1,
    scaling: Number(scaling && scaling.stat ? scaling.stat.toFixed(3) : 1)
  };
  return { stones: baseStones, attributePoints, _model: suggested };
}

const STORAGE_BASE_CAPACITY = 100;
const STORAGE_PER_UPGRADE = 20;
const DEFAULT_STORAGE_UPGRADE_LIMIT = 20;
const STORAGE_CATEGORY_DEFINITIONS = [
  { key: 'equipment', label: '装备' },
  { key: 'quest', label: '任务' },
  { key: 'material', label: '材料' },
  { key: 'consumable', label: '道具' }
].map((definition) => ({
  ...definition,
  baseCapacity: STORAGE_BASE_CAPACITY,
  perUpgrade: STORAGE_PER_UPGRADE
}));
const STORAGE_CATEGORY_KEYS = STORAGE_CATEGORY_DEFINITIONS.map((item) => item.key);
const STORAGE_CATEGORY_LABEL_MAP = STORAGE_CATEGORY_DEFINITIONS.reduce((acc, item) => {
  if (item && item.key) {
    acc[item.key] = item.label || item.key;
  }
  return acc;
}, {});

const STORAGE_UPGRADE_AVAILABLE_KEYS = ['upgradeAvailable', 'upgradeRemaining', 'availableUpgrades', 'upgradeTokens'];
const STORAGE_UPGRADE_LIMIT_KEYS = ['upgradeLimit', 'maxUpgrades', 'limit'];

function toPositiveInt(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  const fallbackNumber = Number(fallback);
  if (Number.isFinite(fallbackNumber)) {
    return Math.max(0, Math.floor(fallbackNumber));
  }
  return 0;
}

function toOptionalPositiveInt(value) {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  return null;
}

function resolveStorageBaseCapacity(storage) {
  return toPositiveInt(storage && storage.baseCapacity, STORAGE_BASE_CAPACITY);
}

function resolveStoragePerUpgrade(storage) {
  return toPositiveInt(storage && storage.perUpgrade, STORAGE_PER_UPGRADE);
}

function resolveStorageUpgradeState(storage) {
  const raw = storage && storage.upgrades;
  let level = 0;
  if (typeof raw === 'number') {
    level = toPositiveInt(raw, 0);
  }
  if (raw && typeof raw === 'object') {
    STORAGE_CATEGORY_KEYS.forEach((key) => {
      level = Math.max(level, toPositiveInt(raw[key], 0));
    });
    if (Object.prototype.hasOwnProperty.call(raw, 'global')) {
      level = Math.max(level, toPositiveInt(raw.global, 0));
    }
  }
  if (storage && Object.prototype.hasOwnProperty.call(storage, 'globalUpgrades')) {
    level = Math.max(level, toPositiveInt(storage.globalUpgrades, 0));
  }
  const upgrades = {};
  STORAGE_CATEGORY_KEYS.forEach((key) => {
    upgrades[key] = level;
  });
  return { level, upgrades };
}

function extractStorageField(storage, keys) {
  if (!storage || typeof storage !== 'object') {
    return { value: null, key: null, container: null };
  }
  const containers = [
    { object: storage, container: null },
    { object: storage.meta, container: 'meta' },
    { object: storage.metadata, container: 'metadata' }
  ];
  for (let i = 0; i < containers.length; i += 1) {
    const { object, container } = containers[i];
    if (!object || typeof object !== 'object') {
      continue;
    }
    for (let j = 0; j < keys.length; j += 1) {
      const key = keys[j];
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        return { value: toOptionalPositiveInt(object[key]), key, container };
      }
    }
  }
  return { value: null, key: null, container: null };
}

function extractStorageUpgradeAvailable(storage) {
  return extractStorageField(storage, STORAGE_UPGRADE_AVAILABLE_KEYS);
}

function extractStorageUpgradeLimit(storage) {
  return extractStorageField(storage, STORAGE_UPGRADE_LIMIT_KEYS);
}

function resolveStorageUpgradeAvailable(storage) {
  const descriptor = extractStorageUpgradeAvailable(storage);
  return descriptor.value !== null ? descriptor.value : 0;
}

function resolveStorageUpgradeLimit(storage) {
  return extractStorageUpgradeLimit(storage).value;
}

async function loadMemberExtras(memberId) {
  if (!memberId) {
    return {
      avatarUnlocks: [],
      claimedLevelRewards: [],
      wineStorage: [],
      titleUnlocks: [],
      backgroundUnlocks: [],
      deliveredLevelRewards: []
    };
  }
  const collection = db.collection(COLLECTIONS.MEMBER_EXTRAS);
  const snapshot = await collection
    .doc(memberId)
    .get()
    .catch(() => null);
  if (snapshot && snapshot.data) {
    const extras = snapshot.data;
    if (!Array.isArray(extras.avatarUnlocks)) {
      extras.avatarUnlocks = [];
    }
    if (!Array.isArray(extras.claimedLevelRewards)) {
      extras.claimedLevelRewards = [];
    }
    if (!Array.isArray(extras.wineStorage)) {
      extras.wineStorage = [];
    }
    if (!Array.isArray(extras.titleUnlocks)) {
      extras.titleUnlocks = [];
    }
    if (!Array.isArray(extras.backgroundUnlocks)) {
      extras.backgroundUnlocks = [];
    }
    if (!Array.isArray(extras.deliveredLevelRewards)) {
      extras.deliveredLevelRewards = [];
    }
    if (!Array.isArray(extras.avatarCatalog)) {
      extras.avatarCatalog = [];
    }
    if (typeof extras.avatarAttributeBonus !== 'number' || Number.isNaN(extras.avatarAttributeBonus)) {
      extras.avatarAttributeBonus = 0;
    }
    return extras;
  }
  const now = new Date();
  const data = {
    avatarUnlocks: [],
    claimedLevelRewards: [],
    wineStorage: [],
    titleUnlocks: [],
    backgroundUnlocks: [],
    deliveredLevelRewards: [],
    avatarCatalog: [],
    avatarAttributeBonus: 0,
    createdAt: now,
    updatedAt: now
  };
  await collection
    .doc(memberId)
    .set({ data })
    .catch(() => {});
  return data;
}

async function updateMemberExtrasRecord(memberId, updates = {}) {
  if (!memberId || !updates || !Object.keys(updates).length) {
    return;
  }
  const collection = db.collection(COLLECTIONS.MEMBER_EXTRAS);
  const payload = { ...updates, updatedAt: new Date() };
  await collection
    .doc(memberId)
    .update({ data: payload })
    .catch(async (error) => {
      if (error && /not exist/i.test(error.errMsg || '')) {
        await collection
          .doc(memberId)
          .set({
            data: {
              ...payload,
              createdAt: new Date(),
              avatarUnlocks: [],
              claimedLevelRewards: [],
              wineStorage: [],
              titleUnlocks: [],
              backgroundUnlocks: [],
              deliveredLevelRewards: []
            }
          })
          .catch(() => {});
      }
    });
}

function setStorageField(target, descriptor, defaultKey, value) {
  if (!target || value == null) {
    return;
  }
  const key = (descriptor && descriptor.key) || defaultKey;
  const container = descriptor && descriptor.container ? descriptor.container : null;
  if (container === 'meta' || container === 'metadata') {
    const property = container;
    const existing = target[property] && typeof target[property] === 'object' ? target[property] : {};
    target[property] = { ...existing, [key]: value };
    target[defaultKey] = value;
    return;
  }
  target[key] = value;
  if (key !== defaultKey) {
    target[defaultKey] = value;
  }
}


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
    name: '结丹期',
    short: '结丹',
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

const EQUIPMENT_QUALITY_ORDER = [
  'mortal',
  'inferior',
  'standard',
  'superior',
  'excellent',
  'immortal',
  'perfect',
  'primordial',
  'relic'
];

const EQUIPMENT_QUALITY_RANK_MAP = EQUIPMENT_QUALITY_ORDER.reduce((map, key, index) => {
  map[key] = index + 1;
  return map;
}, {});

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

const EQUIPMENT_QUALITY_ICON_COUNTER = {};
EQUIPMENT_LIBRARY.forEach((item) => {
  const qualityKey = typeof item.quality === 'string' ? item.quality : '';
  const rank = EQUIPMENT_QUALITY_RANK_MAP[qualityKey] || 1;
  const iconId = (EQUIPMENT_QUALITY_ICON_COUNTER[qualityKey] || 0) + 1;
  EQUIPMENT_QUALITY_ICON_COUNTER[qualityKey] = iconId;
  item.qualityRank = rank;
  item.iconId = iconId;
});

function resolveEquipmentQualityConfig(quality) {
  return EQUIPMENT_QUALITY_CONFIG[quality] || EQUIPMENT_QUALITY_CONFIG.inferior;
}

function resolveEquipmentQualityLabel(quality) {
  return resolveEquipmentQualityConfig(quality).label;
}

function resolveEquipmentQualityColor(quality) {
  return resolveEquipmentQualityConfig(quality).color;
}

function resolveEquipmentQualityRank(quality) {
  const key = typeof quality === 'string' ? quality : '';
  return EQUIPMENT_QUALITY_RANK_MAP[key] || 1;
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

const CONSUMABLE_LIBRARY = [
  {
    id: 'respec_talisman',
    name: '洗点灵符',
    description: '注入灵力的玉符，使用后可额外获得一次洗点机会。',
    effects: { respecAvailable: 1 }
  }
];

const ENEMY_LIBRARY = buildSecretRealmLibrary();

const EQUIPMENT_MAP = buildMap(EQUIPMENT_LIBRARY);
const CONSUMABLE_MAP = buildMap(CONSUMABLE_LIBRARY);
const ENEMY_MAP = buildMap(ENEMY_LIBRARY);
const SECRET_REALM_MAX_FLOOR = ENEMY_LIBRARY.length
  ? ENEMY_LIBRARY[ENEMY_LIBRARY.length - 1].floor
  : 0;
const SECRET_REALM_RESET_BATCH_SIZE = 100;

function resolveEnemyTarget(enemyId) {
  if (enemyId == null) {
    return null;
  }
  let key = '';
  if (typeof enemyId === 'string') {
    key = enemyId.trim();
  } else if (Number.isFinite(enemyId)) {
    key = String(Math.floor(enemyId));
  }

  if (key && ENEMY_MAP[key]) {
    return ENEMY_MAP[key];
  }

  const numericKey = Number(key);
  if (Number.isFinite(numericKey)) {
    const floorNumber = Math.max(1, Math.floor(numericKey));
    const numericEnemy = ENEMY_LIBRARY.find((enemy) => enemy.floor === floorNumber);
    if (numericEnemy) {
      return numericEnemy;
    }
  }

  if (key) {
    const legacyMatch = key.match(/^(secret_[a-z0-9]+(?:_[a-z0-9]+)*_)(\d{1,2})$/i);
    if (legacyMatch) {
      const [, prefix, suffix] = legacyMatch;
      if (suffix.length === 1) {
        const paddedId = `${prefix}${suffix.padStart(2, '0')}`;
        if (ENEMY_MAP[paddedId]) {
          return ENEMY_MAP[paddedId];
        }
      }
    }

    const tailDigits = key.match(/(\d{1,3})$/);
    if (tailDigits) {
      const floorNumber = Number(tailDigits[1]);
      if (Number.isFinite(floorNumber)) {
        const fallbackEnemy = ENEMY_LIBRARY.find((enemy) => enemy.floor === floorNumber);
        if (fallbackEnemy) {
          return fallbackEnemy;
        }
      }
    }
  }

  return null;
}

function buildSecretRealmImageUrl(enemyId, folder) {
  if (typeof enemyId !== 'string') {
    return '';
  }
  const trimmed = enemyId.trim();
  if (!trimmed) {
    return '';
  }
  const fileName = trimmed.endsWith('.png') ? trimmed : `${trimmed}.png`;
  return buildCloudAssetUrl(folder, fileName);
}

function decorateEnemyVisuals(enemy) {
  if (!enemy || typeof enemy !== 'object') {
    return enemy;
  }
  const decorated = { ...enemy };
  const enemyId =
    (typeof decorated.id === 'string' && decorated.id.trim()) ||
    (typeof decorated.enemyId === 'string' && decorated.enemyId.trim()) ||
    '';

  if (decorated.category === 'secretRealm' && enemyId) {
    const resolvedAvatarUrl = buildSecretRealmImageUrl(enemyId, 'avatar');
    const resolvedPortraitUrl = buildSecretRealmImageUrl(enemyId, 'character');
    if (resolvedAvatarUrl && !decorated.avatarUrl) {
      decorated.avatarUrl = resolvedAvatarUrl;
    }
    if (resolvedAvatarUrl && !decorated.avatar) {
      decorated.avatar = resolvedAvatarUrl;
    }
    if (resolvedPortraitUrl && !decorated.portrait) {
      decorated.portrait = resolvedPortraitUrl;
    }
    if (resolvedPortraitUrl && !decorated.image) {
      decorated.image = resolvedPortraitUrl;
    }

    const scene = decorated.scene && typeof decorated.scene === 'object' ? { ...decorated.scene } : {};
    if (!scene.video) {
      scene.video = SECRET_REALM_BACKGROUND_VIDEO;
    }
    if (!scene.backgroundVideo) {
      scene.backgroundVideo = SECRET_REALM_BACKGROUND_VIDEO;
    }
    decorated.scene = scene;

    const background =
      decorated.background && typeof decorated.background === 'object'
        ? { ...decorated.background }
        : {};
    if (!background.video) {
      background.video = SECRET_REALM_BACKGROUND_VIDEO;
    }
    decorated.background = background;

    if (!decorated.backgroundVideo) {
      decorated.backgroundVideo = SECRET_REALM_BACKGROUND_VIDEO;
    }
  }

  return decorated;
}

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

function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a instanceof Date || b instanceof Date) {
    const aTime = a instanceof Date ? a.getTime() : new Date(a).getTime();
    const bTime = b instanceof Date ? b.getTime() : new Date(b).getTime();
    return aTime === bTime;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!deepEqual(a[key], b[key])) {
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
  const action =
    event && typeof event.action === 'string' && event.action.trim()
      ? event.action.trim()
      : 'profile';
  const { memberId: proxyMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const actorId = resolveActorId(proxyMemberId || OPENID, event);

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'profile':
      return getProfile(actorId, event);
    case 'battle':
      return simulateBattle(actorId, event.enemyId);
    case 'battleArchive':
    case 'battleReplay':
      return loadBattleArchive(actorId, event);
    case 'drawSkill':
      return drawSkill(actorId, event);
    case 'equipSkill':
      return equipSkill(actorId, event);
    case 'equipItem':
      return equipItem(actorId, event);
    case 'discardItem':
      return discardItem(actorId, event);
    case 'useStorageItem':
      return useStorageItem(actorId, event);
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
    case 'adminUpdateSecretRealm':
      return adminUpdateSecretRealmProgress(actorId, event);
    case 'adminResetSecretRealm':
      return adminResetSecretRealm(actorId, event);
    case 'allocatePoints':
      return allocatePoints(actorId, event.allocations || {});
    case 'resetAttributes':
      return resetAttributes(actorId);
    default:
      throw createError('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }
};

async function getProfile(actorId, options = {}) {
  const member = await ensureMember(actorId);
  const levels = await loadMembershipLevels();
  const profile = await ensurePveProfile(actorId, member, levels);
  if (options && options.refreshOnly) {
    return {
      success: true,
      memberId: actorId,
      refreshed: true,
      attributeSummary: profile && profile.attributeSummary ? profile.attributeSummary : null
    };
  }
  return decorateProfile(member, profile);
}

async function simulateBattle(actorId, enemyId) {
  const [member, levels] = await Promise.all([ensureMember(actorId), loadMembershipLevels()]);
  const profile = await ensurePveProfile(actorId, member, levels);
  const now = new Date();
  assertBattleCooldown(profile.lastBattleAt, now);
  const enemyDefinition = resolveEnemyTarget(enemyId);
  if (!enemyDefinition) {
    throw createError('ENEMY_NOT_FOUND', '未找到指定的副本目标');
  }

  const enemy = decorateEnemyVisuals(enemyDefinition);

  const secretRealmState = normalizeSecretRealm(profile.secretRealm || {});
  const highestUnlocked = secretRealmState.highestUnlockedFloor || 1;
  if (enemy.category === 'secretRealm' && enemy.floor > highestUnlocked) {
    throw createError('FLOOR_LOCKED', '请先通关上一层秘境');
  }

  const floorState =
    secretRealmState && secretRealmState.floors ? secretRealmState.floors[enemy.id] : null;
  const alreadyCleared = !!(floorState && floorState.clearedAt);

  await applyGlobalGameParameters();
  const battleSetup = buildBattleSetup(profile, enemy, member);
  const result = runBattleSimulation(battleSetup);

  if (alreadyCleared && result && result.rewards) {
    result.rewards = { exp: 0, stones: 0, attributePoints: 0, loot: [] };
  }

  const formattedBattle = formatBattleResult(result, {
    actorId,
    player: result && result.participants ? result.participants.player : null,
    opponent:
      result && result.participants
        ? result.participants.opponent || result.participants.enemy || null
        : null
  });

  const updatedProfile = applyBattleOutcome(profile, result, enemy, now, member, levels, formattedBattle);

  await offloadBattleHistoryEntries(actorId, updatedProfile, {
    now,
    enemy,
    battlePayload: formattedBattle
  });

  const extraUpdates = {};
  if (result.rewards && result.rewards.stones > 0) {
    extraUpdates.stoneBalance = _.inc(result.rewards.stones);
  }

  const savePromise = savePveProfile(actorId, updatedProfile, {
    now,
    extraUpdates,
    historyDoc: profile.__historyDoc
  });

  const shouldRecordStones = result.rewards && result.rewards.stones > 0;
  const recordPromise = shouldRecordStones
    ? recordStoneTransaction(actorId, result, enemy, now).catch((error) => {
        console.error('[pve] record stone transaction failed', error);
      })
    : null;

  if (recordPromise) {
    await Promise.all([savePromise, recordPromise]);
  } else {
    await savePromise;
  }

  return {
    battle: formattedBattle
  };
}

async function drawSkill(actorId, event = {}) {
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const now = new Date();

  let requestedCount =
    event && Object.prototype.hasOwnProperty.call(event, 'drawCount') ? event.drawCount : undefined;
  if (requestedCount === undefined && event && Object.prototype.hasOwnProperty.call(event, 'count')) {
    requestedCount = event.count;
  }
  const parsedCount = Number(requestedCount);
  const safeCount = Number.isFinite(parsedCount) ? Math.max(1, Math.min(10, Math.floor(parsedCount))) : 1;

  const draws = performSkillDraw(profile, safeCount, now);
  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

  const decoratedProfile = decorateProfile(member, profile);
  const acquiredSkills = draws.map((acquired) => {
    const decorated = acquired.decorated || { skillId: acquired.skillId };
    return {
      ...decorated,
      isNew: acquired.isNew,
      quality: acquired.quality,
      qualityLabel: acquired.qualityLabel,
      qualityColor: acquired.qualityColor
    };
  });

  return {
    acquiredSkill: acquiredSkills[0] || null,
    acquiredSkills,
    profile: decoratedProfile
  };
}

async function equipSkill(actorId, event) {
  const { skillId, slot } = event;
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
  const ownedSkillIds = new Set(
    inventory
      .map((entry) => (entry && typeof entry.skillId === 'string' ? entry.skillId.trim() : ''))
      .filter((id) => !!id)
  );
  const rawEquipped = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
  const normalizedSkillId = typeof skillId === 'string' ? skillId.trim() : '';
  const equipped = new Array(MAX_SKILL_SLOTS).fill('');
  const seen = new Set();

  for (let i = 0; i < MAX_SKILL_SLOTS; i += 1) {
    const id = rawEquipped[i];
    if (typeof id === 'string' && id && SKILL_MAP[id] && ownedSkillIds.has(id) && !seen.has(id)) {
      equipped[i] = id;
      seen.add(id);
    }
  }

  for (let i = MAX_SKILL_SLOTS; i < rawEquipped.length; i += 1) {
    const id = rawEquipped[i];
    if (typeof id !== 'string' || !id || !SKILL_MAP[id] || !ownedSkillIds.has(id) || seen.has(id)) {
      continue;
    }
    const emptyIndex = equipped.findIndex((slotId) => !slotId);
    if (emptyIndex >= 0) {
      equipped[emptyIndex] = id;
      seen.add(id);
    }
  }

  if (normalizedSkillId) {
    const hasSkill = ownedSkillIds.has(normalizedSkillId);
    if (!hasSkill) {
      throw createError('SKILL_NOT_OWNED', '尚未拥有该技能，无法装备');
    }
  }

  let resolvedSlot = null;
  if (typeof slot === 'number') {
    if (slot >= 0 && slot < MAX_SKILL_SLOTS) {
      resolvedSlot = slot;
    }
  } else if (typeof slot === 'string') {
    const parsedSlot = Number(slot);
    if (Number.isFinite(parsedSlot)) {
      const normalizedSlot = Math.floor(parsedSlot);
      if (normalizedSlot >= 0 && normalizedSlot < MAX_SKILL_SLOTS) {
        resolvedSlot = normalizedSlot;
      }
    }
  }

  if (resolvedSlot !== null) {
    if (normalizedSkillId) {
      for (let i = 0; i < MAX_SKILL_SLOTS; i += 1) {
        if (i !== resolvedSlot && equipped[i] === normalizedSkillId) {
          equipped[i] = '';
        }
      }
      equipped[resolvedSlot] = normalizedSkillId;
    } else {
      equipped[resolvedSlot] = '';
    }
  } else if (normalizedSkillId) {
    const alreadyEquipped = equipped.includes(normalizedSkillId);
    if (!alreadyEquipped) {
      const emptySlotIndex = equipped.findIndex((id) => !id);
      if (emptySlotIndex >= 0) {
        equipped[emptySlotIndex] = normalizedSkillId;
        resolvedSlot = emptySlotIndex;
      } else {
        const equippedCount = equipped.filter(
          (id) => typeof id === 'string' && id && SKILL_MAP[id] && ownedSkillIds.has(id)
        ).length;
        if (equippedCount >= MAX_SKILL_SLOTS) {
          throw createError('SKILL_SLOT_FULL', '技能槽位已满，请选择要替换的技能');
        }
        throw createError('SKILL_SLOT_INVALID', '技能槽位数据异常，请重试');
      }
    } else {
      resolvedSlot = equipped.indexOf(normalizedSkillId);
    }
  }

  const normalizedEquipped = equipped.map((id) =>
    typeof id === 'string' && id && SKILL_MAP[id] && ownedSkillIds.has(id) ? id : ''
  );
  for (let i = 0; i < MAX_SKILL_SLOTS; i += 1) {
    const id = normalizedEquipped[i];
    if (!id) {
      continue;
    }
    if (normalizedEquipped.indexOf(id) !== i) {
      normalizedEquipped[i] = '';
    }
  }

  profile.skills.equipped = normalizedEquipped;
  const now = new Date();
  profile.skillHistory = appendHistory(
    profile.skillHistory,
    {
      type: 'equip',
      createdAt: now,
      detail: { skillId: normalizedSkillId, slot: resolvedSlot }
    },
    MAX_SKILL_HISTORY
  );

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

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

    refreshAttributeSummary(profile);

    await savePveProfile(actorId, profile, { now });

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

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

async function discardItem(actorId, event = {}) {
  const inventoryId =
    event && typeof event.inventoryId === 'string' && event.inventoryId.trim() ? event.inventoryId.trim() : '';
  if (!inventoryId) {
    throw createError('INVENTORY_ID_REQUIRED', '缺少物品编号');
  }
  const category = event && typeof event.category === 'string' ? event.category.trim() : '';
  if (category === 'quest') {
    throw createError('QUEST_ITEM_LOCKED', '任务道具无法删除');
  }
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const equipment = profile.equipment || {};
  profile.equipment = equipment;
  const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  let removedEntry = null;
  let removedCategory = category || 'equipment';

  const findInventoryIndex = () => inventory.findIndex((entry) => entry && entry.inventoryId === inventoryId);
  let index = findInventoryIndex();
  if (index >= 0) {
    const candidate = inventory[index];
    const candidateCategory = category || (candidate && candidate.storageCategory) || 'equipment';
    if (candidateCategory === 'quest') {
      throw createError('QUEST_ITEM_LOCKED', '任务道具无法删除');
    }
    if (candidate && candidate.locked) {
      throw createError('ITEM_LOCKED', '该道具无法删除');
    }
    removedEntry = candidate;
    removedCategory = candidateCategory;
    inventory.splice(index, 1);
    profile.equipment.inventory = inventory;
  }

  if (!removedEntry) {
    const rawCategories = Array.isArray(storage.categories) ? storage.categories : [];
    let updatedCategories = null;
    for (let i = 0; i < rawCategories.length; i += 1) {
      const categoryEntry = rawCategories[i];
      if (!categoryEntry || typeof categoryEntry !== 'object') {
        continue;
      }
      if (category && categoryEntry.key !== category) {
        continue;
      }
      const items = Array.isArray(categoryEntry.items) ? categoryEntry.items : [];
      const itemIndex = items.findIndex((item) => item && item.inventoryId === inventoryId);
      if (itemIndex < 0) {
        continue;
      }
      const candidate = items[itemIndex];
      const candidateCategory = category || candidate.storageCategory || categoryEntry.key || '';
      if (candidateCategory === 'quest') {
        throw createError('QUEST_ITEM_LOCKED', '任务道具无法删除');
      }
      if (candidate && candidate.locked) {
        throw createError('ITEM_LOCKED', '该道具无法删除');
      }
      removedEntry = candidate;
      removedCategory = candidateCategory || categoryEntry.key || '';
      const clonedItems = items.slice();
      clonedItems.splice(itemIndex, 1);
      const clonedCategory = { ...categoryEntry, items: clonedItems };
      updatedCategories = rawCategories.map((entry, idx) => (idx === i ? clonedCategory : entry));
      break;
    }
    if (updatedCategories) {
      profile.equipment.storage = { ...storage, categories: updatedCategories };
      equipment.storage = profile.equipment.storage;
    }
  }

  if (!removedEntry) {
    throw createError('ITEM_NOT_FOUND', '未找到对应物品');
  }

  const slots =
    equipment.slots && typeof equipment.slots === 'object' ? { ...equipment.slots } : createEmptySlotMap();
  let slotChanged = false;
  Object.keys(slots).forEach((slotKey) => {
    const slotEntry = slots[slotKey];
    if (!slotEntry) {
      return;
    }
    const sameInventory = slotEntry.inventoryId && slotEntry.inventoryId === inventoryId;
    const sameItem = !slotEntry.inventoryId && removedEntry && slotEntry.itemId === removedEntry.itemId;
    if (sameInventory || sameItem) {
      slots[slotKey] = null;
      slotChanged = true;
    }
  });
  if (slotChanged) {
    profile.equipment.slots = slots;
  }

  const now = new Date();
  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: {
        action: 'discard',
        itemId: removedEntry && removedEntry.itemId ? removedEntry.itemId : '',
        inventoryId,
        category: removedCategory
      }
    },
    MAX_BATTLE_HISTORY
  );

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

  const decorated = decorateProfile(member, profile);
  return { profile: decorated };
}

function normalizeSkillDrawCreditValue(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(numeric));
  }
  return Math.max(0, Math.floor(Number(fallback) || 0));
}

function performSkillDraw(profile, count = 1, baseTime = new Date(), options = {}) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const base =
    baseTime instanceof Date && !Number.isNaN(baseTime.getTime()) ? new Date(baseTime.getTime()) : new Date();
  profile.skills = profile.skills || buildDefaultSkills(base);
  const skillsState = profile.skills;
  const consumeCredits = options && options.consumeCredits !== false;
  const availableCredits = normalizeSkillDrawCreditValue(
    Object.prototype.hasOwnProperty.call(skillsState, 'drawCredits')
      ? skillsState.drawCredits
      : DEFAULT_SKILL_DRAW_CREDITS,
    DEFAULT_SKILL_DRAW_CREDITS
  );

  if (!Object.prototype.hasOwnProperty.call(skillsState, 'drawCredits') || skillsState.drawCredits !== availableCredits) {
    skillsState.drawCredits = availableCredits;
  }

  if (consumeCredits) {
    if (availableCredits < safeCount) {
      throw createError('SKILL_DRAW_LIMIT', '技能抽取次数不足');
    }
    skillsState.drawCredits = availableCredits - safeCount;
  }

  const inventory = Array.isArray(skillsState.inventory) ? skillsState.inventory : [];
  const results = [];

  for (let i = 0; i < safeCount; i += 1) {
    const drawAt = new Date(base.getTime() + i);
    const roll = rollSkill();
    let entry = inventory.find((item) => item && item.skillId === roll.skill.id);
    let isNew = false;
    if (entry) {
      const maxLevel = resolveSkillMaxLevel(roll.skill.id);
      const nextLevel = Math.min(maxLevel, (entry.level || 1) + 1);
      if (nextLevel > (entry.level || 1)) {
        entry.level = nextLevel;
      }
      entry.duplicates = (entry.duplicates || 0) + 1;
      entry.obtainedAt = drawAt;
    } else {
      isNew = true;
      entry = createSkillInventoryEntry(roll.skill.id, drawAt);
      inventory.push(entry);
    }

    profile.skills.drawCount = (profile.skills.drawCount || 0) + 1;
    profile.skills.lastDrawAt = drawAt;
    profile.skillHistory = appendHistory(
      profile.skillHistory,
      {
        type: 'draw',
        createdAt: drawAt,
        detail: {
          skillId: roll.skill.id,
          quality: roll.skill.quality,
          level: entry.level,
          isNew
        }
      },
      MAX_SKILL_HISTORY
    );

    const decorated = decorateSkillInventoryEntry(entry, profile);
    const quality = roll.skill.quality || (decorated ? decorated.quality : 'linggan');
    results.push({
      skillId: roll.skill.id,
      isNew,
      quality,
      qualityLabel: resolveSkillQualityLabel(quality),
      qualityColor: resolveSkillQualityColor(quality),
      decorated
    });
  }

  return results;
}

async function useStorageItem(actorId, event = {}) {
  const inventoryId =
    event && typeof event.inventoryId === 'string' && event.inventoryId.trim() ? event.inventoryId.trim() : '';
  if (!inventoryId) {
    throw createError('INVENTORY_ID_REQUIRED', '缺少物品编号');
  }
  const actionKey =
    event && typeof event.actionKey === 'string' && event.actionKey.trim() ? event.actionKey.trim() : 'use';
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const equipment = profile.equipment || {};
  profile.equipment = equipment;
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  const rawCategories = Array.isArray(storage.categories) ? storage.categories : [];

  let targetItem = null;
  let categoryKey = '';
  let categoryIndex = -1;
  let itemIndex = -1;

  const categories = rawCategories.map((category, idx) => {
    if (!category || typeof category !== 'object') {
      return category;
    }
    const items = Array.isArray(category.items) ? category.items.map((item) => ({ ...item })) : [];
    const foundIndex = items.findIndex((item) => item && item.inventoryId === inventoryId);
    if (foundIndex >= 0) {
      targetItem = items[foundIndex];
      categoryKey = category.key || targetItem.storageCategory || '';
      categoryIndex = idx;
      itemIndex = foundIndex;
    }
    return { ...category, items };
  });

  if (!targetItem) {
    throw createError('ITEM_NOT_FOUND', '未找到对应物品');
  }

  const normalizedActions = Array.isArray(targetItem.actions)
    ? targetItem.actions
        .map((action) => ({
          key: typeof action.key === 'string' ? action.key : '',
          label: typeof action.label === 'string' ? action.label : '',
          primary: !!action.primary
        }))
        .filter((action) => action.key && action.label)
    : [];
  const resolvedAction = actionKey || (normalizedActions.length ? normalizedActions[0].key : '');
  if (!resolvedAction || resolvedAction !== 'use') {
    throw createError('ITEM_ACTION_NOT_SUPPORTED', '暂不支持该操作');
  }

  const usage = targetItem.usage && typeof targetItem.usage === 'object' ? { ...targetItem.usage } : null;
  if (!usage || typeof usage.type !== 'string') {
    throw createError('ITEM_NO_USAGE', '该道具无法使用');
  }

  const now = new Date();
  const result = {};
  let extras = null;
  let extrasChanged = false;
  const extrasUpdates = {};
  const memberUpdates = {};
  const ensureExtras = async () => {
    if (!extras) {
      extras = await loadMemberExtras(actorId);
    }
    return extras;
  };

  const removeItem = () => {
    if (categoryIndex >= 0 && itemIndex >= 0 && categories[categoryIndex]) {
      const items = Array.isArray(categories[categoryIndex].items) ? categories[categoryIndex].items : [];
      items.splice(itemIndex, 1);
      categories[categoryIndex] = { ...categories[categoryIndex], items };
    }
  };

  switch (usage.type) {
    case 'unlockTitle': {
      const extrasData = await ensureExtras();
      const titleId = typeof usage.titleId === 'string' ? usage.titleId.trim() : '';
      if (!titleId) {
        throw createError('ITEM_USAGE_INVALID', '道具目标无效');
      }
      const set = new Set(Array.isArray(extrasData.titleUnlocks) ? extrasData.titleUnlocks : []);
      const alreadyUnlocked = set.has(titleId);
      if (!alreadyUnlocked) {
        set.add(titleId);
        extrasUpdates.titleUnlocks = Array.from(set);
        extrasChanged = true;
      }
      if (!member.appearanceTitle) {
        memberUpdates.appearanceTitle = titleId;
      }
      result.unlockTitle = { titleId, alreadyUnlocked };
      removeItem();
      break;
    }
    case 'unlockBackground': {
      const extrasData = await ensureExtras();
      const backgroundId = normalizeBackgroundId(usage.backgroundId || '');
      if (!backgroundId) {
        throw createError('ITEM_USAGE_INVALID', '道具目标无效');
      }
      const set = new Set(Array.isArray(extrasData.backgroundUnlocks) ? extrasData.backgroundUnlocks : []);
      const alreadyUnlocked = set.has(backgroundId);
      if (!alreadyUnlocked) {
        set.add(backgroundId);
        extrasUpdates.backgroundUnlocks = Array.from(set);
        extrasChanged = true;
      }
      memberUpdates.appearanceBackground = backgroundId;
      result.unlockBackground = { backgroundId, alreadyUnlocked };
      removeItem();
      break;
    }
    case 'skillDraw': {
      const drawCount = Math.max(1, Math.floor(Number(usage.drawCount) || 1));
      const draws = performSkillDraw(profile, drawCount, now, { consumeCredits: false });
      result.acquiredSkills = draws.map((entry) => {
        const decorated = entry.decorated || null;
        if (decorated) {
          return {
            ...decorated,
            isNew: entry.isNew,
            quality: entry.quality,
            qualityLabel: entry.qualityLabel,
            qualityColor: entry.qualityColor
          };
        }
        return {
          skillId: entry.skillId,
          isNew: entry.isNew,
          quality: entry.quality,
          qualityLabel: entry.qualityLabel,
          qualityColor: entry.qualityColor
        };
      });
      removeItem();
      break;
    }
    case 'grantRight': {
      const rightId = typeof usage.rightId === 'string' ? usage.rightId.trim() : '';
      if (!rightId) {
        throw createError('ITEM_USAGE_INVALID', '道具目标无效');
      }
      const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
      const masterSnapshot = await db
        .collection(COLLECTIONS.RIGHTS_MASTER)
        .doc(rightId)
        .get()
        .catch(() => null);
      if (!masterSnapshot || !masterSnapshot.data) {
        throw createError('ITEM_USAGE_INVALID', '权益配置不存在');
      }
      const master = masterSnapshot.data;
      const validDays = Number(master.validDays || 0);
      const validUntil =
        Number.isFinite(validDays) && validDays > 0
          ? new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000)
          : null;
      const addResult = await rightsCollection.add({
        data: {
          memberId: actorId,
          rightId,
          status: 'active',
          issuedAt: now,
          validUntil,
          updatedAt: now,
          meta: {
            ...(master.meta || {}),
            grantedBy: 'storage-item',
            grantedFromInventory: inventoryId,
            grantedItemId: targetItem.itemId || '',
            grantedItemName: targetItem.name || master.name || ''
          }
        }
      });
      result.grantedRight = {
        memberRightId: addResult._id,
        rightId,
        name: master.name || ''
      };
      removeItem();
      break;
    }
    case 'grantRenameCredits': {
      const amount = Math.max(1, Math.floor(Number(usage.amount) || 0));
      if (amount <= 0) {
        throw createError('ITEM_USAGE_INVALID', '道具效果无效');
      }
      const currentCredits = Math.max(0, Math.floor(Number(member.renameCredits) || 0));
      const availableCards = Math.max(0, Math.floor(Number(member.renameCards) || 0));
      memberUpdates.renameCredits = _.inc(amount);
      if (availableCards > 0) {
        const decrement = Math.min(amount, availableCards);
        memberUpdates.renameCards = _.inc(-decrement);
        result.renameCards = Math.max(availableCards - decrement, 0);
      }
      result.renameCredits = currentCredits + amount;
      removeItem();
      break;
    }
    case 'grantSkillDrawCredits': {
      const amount = Math.max(1, Math.floor(Number(usage.amount) || 0));
      if (amount <= 0) {
        throw createError('ITEM_USAGE_INVALID', '道具效果无效');
      }
      profile.skills = profile.skills && typeof profile.skills === 'object' ? profile.skills : {};
      const drawCredits = Math.max(0, Math.floor(Number(profile.skills.drawCredits) || 0));
      profile.skills.drawCredits = drawCredits + amount;
      result.skillDrawCredits = profile.skills.drawCredits;
      removeItem();
      break;
    }
    case 'grantRespec': {
      const amount = Math.max(1, Math.floor(Number(usage.amount) || 0));
      if (amount <= 0) {
        throw createError('ITEM_USAGE_INVALID', '道具效果无效');
      }
      const attrs = profile.attributes && typeof profile.attributes === 'object' ? profile.attributes : {};
      const currentAvailable = Math.max(0, Math.floor(Number(attrs.respecAvailable) || 0));
      const legacyLimit = Math.max(0, Math.floor(Number(attrs.respecLimit) || 0));
      const legacyUsed = Math.max(0, Math.floor(Number(attrs.respecUsed) || 0));
      const legacyAvailable = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
      const baseAvailable = Math.max(currentAvailable, legacyAvailable);
      const nextAvailable = baseAvailable + amount;
      attrs.respecAvailable = nextAvailable;
      attrs.respecLimit = 0;
      attrs.respecUsed = 0;
      profile.attributes = attrs;
      result.respecAvailable = nextAvailable;
      removeItem();
      break;
    }
    default:
      throw createError('ITEM_USAGE_UNSUPPORTED', '暂不支持该道具');
  }

  storage.categories = categories;
  profile.equipment.storage = { ...storage, categories };

  profile.battleHistory = appendHistory(
    profile.battleHistory,
    {
      type: 'equipment-change',
      createdAt: now,
      detail: {
        action: 'use-storage-item',
        itemId: targetItem.itemId || '',
        inventoryId,
        category: categoryKey || targetItem.storageCategory || '',
        usage: usage.type
      }
    },
    MAX_BATTLE_HISTORY
  );

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now, extraUpdates: memberUpdates });

  if (extrasChanged) {
    await updateMemberExtrasRecord(actorId, extrasUpdates);
  }

  const decorated = decorateProfile({ ...member, ...memberUpdates }, profile);
  return { profile: decorated, ...result };
}

async function upgradeStorage(actorId, event = {}) {
  const category =
    event && typeof event.category === 'string' && event.category.trim() ? event.category.trim() : '';
  if (category && !STORAGE_CATEGORY_KEYS.includes(category)) {
    throw createError('INVALID_CATEGORY', '储物类型不存在');
  }
  const member = await ensureMember(actorId);
  const profile = await ensurePveProfile(actorId, member);
  const storage = profile.equipment && typeof profile.equipment.storage === 'object' ? profile.equipment.storage : {};
  const { level: currentLevel } = resolveStorageUpgradeState(storage);
  const baseCapacity = resolveStorageBaseCapacity(storage);
  const perUpgrade = resolveStoragePerUpgrade(storage);
  const upgradeAvailableDescriptor = extractStorageUpgradeAvailable(storage);
  const upgradeLimitDescriptor = extractStorageUpgradeLimit(storage);
  const upgradeAvailableRaw = upgradeAvailableDescriptor.value;
  const upgradeAvailable = upgradeAvailableRaw !== null ? upgradeAvailableRaw : 0;
  const upgradeLimit = upgradeLimitDescriptor.value;
  let normalizedLimit = upgradeLimit !== null && upgradeLimit > 0 ? upgradeLimit : null;
  if (normalizedLimit === null) {
    const fallbackLimitBase = currentLevel + upgradeAvailable;
    normalizedLimit = Math.max(DEFAULT_STORAGE_UPGRADE_LIMIT, fallbackLimitBase);
  }
  if (normalizedLimit !== null && currentLevel >= normalizedLimit) {
    throw createError('STORAGE_MAX_UPGRADES', '储物空间已达到上限');
  }
  if (upgradeAvailable <= 0) {
    throw createError('STORAGE_NO_UPGRADES', '升级次数不足');
  }
  const nextLevel = currentLevel + 1;
  if (normalizedLimit !== null && nextLevel > normalizedLimit) {
    throw createError('STORAGE_MAX_UPGRADES', '储物空间已达到上限');
  }
  let nextAvailable = null;
  if (upgradeAvailableRaw !== null) {
    nextAvailable = Math.max(upgradeAvailable - 1, 0);
    if (normalizedLimit !== null) {
      nextAvailable = Math.min(nextAvailable, Math.max(normalizedLimit - nextLevel, 0));
    }
  }
  const updatedUpgrades = {};
  STORAGE_CATEGORY_KEYS.forEach((key) => {
    updatedUpgrades[key] = nextLevel;
  });
  const updatedStorage = {
    ...storage,
    upgrades: updatedUpgrades,
    globalUpgrades: nextLevel,
    baseCapacity,
    perUpgrade
  };
  if (nextAvailable !== null) {
    setStorageField(updatedStorage, upgradeAvailableDescriptor, 'upgradeAvailable', nextAvailable);
  }
  if (normalizedLimit !== null) {
    setStorageField(updatedStorage, upgradeLimitDescriptor, 'upgradeLimit', normalizedLimit);
  }
  profile.equipment.storage = updatedStorage;
  const now = new Date();

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });
  const decorated = decorateProfile(member, profile);
  const capacity = baseCapacity + perUpgrade * nextLevel;
  const upgradesRemaining =
    normalizedLimit !== null ? Math.max(normalizedLimit - Math.min(normalizedLimit, nextLevel), 0) : null;
  const result = {
    upgrades: nextLevel,
    capacity
  };
  if (nextAvailable !== null) {
    result.upgradeAvailable = nextAvailable;
  }
  if (normalizedLimit !== null) {
    result.upgradeLimit = normalizedLimit;
    result.upgradesRemaining = upgradesRemaining;
  }
  if (category) {
    result.category = category;
  }
  return {
    profile: decorated,
    storage: result
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

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

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

  refreshAttributeSummary(profile);

  await savePveProfile(actorId, profile, { now });

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
    qualityRank: item.qualityRank || resolveEquipmentQualityRank(item.quality),
    iconId: item.iconId || 0,
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
  await attachHistoryToProfile(targetId, normalizedProfile);
  const decorated = decorateProfile(
    { ...targetMember, pveProfile: normalizedProfile },
    normalizedProfile,
    { viewer: admin }
  );
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
  await attachHistoryToProfile(memberId, profile);
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

  refreshAttributeSummary(profile);

  await savePveProfile(memberId, profile, { now });

  const decorated = decorateProfile({ ...targetMember, pveProfile: profile }, profile, { viewer: admin });
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
  await attachHistoryToProfile(memberId, profile);
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

  refreshAttributeSummary(profile);

  await savePveProfile(memberId, profile, { now });

  const decorated = decorateProfile({ ...targetMember, pveProfile: profile }, profile, { viewer: admin });
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
  await attachHistoryToProfile(memberId, profile);
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
    const decoratedProfile = decorateProfile(
      { ...targetMember, pveProfile: profile },
      profile,
      { viewer: admin }
    );
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

  refreshAttributeSummary(profile);

  await savePveProfile(memberId, profile, { now });

  const decoratedProfile = decorateProfile(
    { ...targetMember, pveProfile: profile },
    profile,
    { viewer: admin }
  );
  const updated = decorateEquipmentInventoryEntry(entry, profile.equipment.slots);
  return { profile: decoratedProfile, updated };
}

function serializeSecretRealmState(state) {
  const normalized = normalizeSecretRealm(state || {});
  const floors = normalized.floors || {};
  const serializedFloors = Object.keys(floors)
    .sort()
    .reduce((acc, id) => {
      const entry = floors[id] || {};
      const clearedAt = entry.clearedAt instanceof Date ? entry.clearedAt : entry.clearedAt ? new Date(entry.clearedAt) : null;
      const clearedAtTime = clearedAt && !Number.isNaN(clearedAt.getTime()) ? clearedAt.getTime() : null;
      const bestRounds = Number.isFinite(Number(entry.bestRounds)) ? Math.max(1, Math.floor(Number(entry.bestRounds))) : null;
      const victories = Number.isFinite(Number(entry.victories)) ? Math.max(0, Math.floor(Number(entry.victories))) : 0;
      acc[id] = { clearedAt: clearedAtTime, bestRounds, victories };
      return acc;
    }, {});
  return {
    highestUnlockedFloor: normalized.highestUnlockedFloor || 1,
    floors: serializedFloors
  };
}

function buildSecretRealmFloors(highestUnlockedFloor, existingFloors = {}, now = new Date(), { autoComplete = true } = {}) {
  const floors = {};
  const highest = Number.isFinite(Number(highestUnlockedFloor))
    ? Math.max(1, Math.floor(Number(highestUnlockedFloor)))
    : 1;

  ENEMY_LIBRARY.forEach((enemy) => {
    if (!enemy || enemy.category !== 'secretRealm') {
      return;
    }
    if (enemy.floor >= highest) {
      return;
    }
    const existing = existingFloors[enemy.id] || {};
    const clearedAt = existing.clearedAt instanceof Date ? existing.clearedAt : existing.clearedAt ? new Date(existing.clearedAt) : null;
    const normalizedClearedAt = clearedAt && !Number.isNaN(clearedAt.getTime()) ? clearedAt : now;
    const bestRounds = Number.isFinite(Number(existing.bestRounds))
      ? Math.max(1, Math.floor(Number(existing.bestRounds)))
      : null;
    let victories = Number.isFinite(Number(existing.victories))
      ? Math.max(0, Math.floor(Number(existing.victories)))
      : 0;
    if (autoComplete && victories <= 0) {
      victories = 1;
    }
    floors[enemy.id] = {
      clearedAt: normalizedClearedAt,
      bestRounds,
      victories
    };
  });

  return floors;
}

async function adminUpdateSecretRealmProgress(actorId, event = {}) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);

  const memberId =
    typeof event.memberId === 'string' && event.memberId.trim()
      ? event.memberId.trim()
      : '';
  if (!memberId) {
    throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
  }

  if (event.reset) {
    return adminResetSecretRealm(actorId, { scope: 'member', memberId });
  }

  const targetMember = await ensureMember(memberId);
  const now = new Date();
  const profile = normalizeProfileWithoutEquipmentDefaults(targetMember.pveProfile, now);
  await attachHistoryToProfile(memberId, profile);

  const currentSecretRealm = normalizeSecretRealm(profile.secretRealm || {}, now);
  const defaultState = buildDefaultSecretRealmState();
  const minFloor = defaultState.highestUnlockedFloor || 1;
  const maxFloor = SECRET_REALM_MAX_FLOOR > 0 ? SECRET_REALM_MAX_FLOOR : Number.MAX_SAFE_INTEGER;

  let desiredFloor = currentSecretRealm.highestUnlockedFloor || minFloor;
  if (Object.prototype.hasOwnProperty.call(event, 'highestUnlockedFloor')) {
    const numeric = Number(event.highestUnlockedFloor);
    if (Number.isFinite(numeric)) {
      desiredFloor = Math.max(minFloor, Math.min(maxFloor, Math.floor(numeric)));
    }
  }

  const autoComplete = event.autoComplete !== false;
  const nextFloors = buildSecretRealmFloors(desiredFloor, currentSecretRealm.floors || {}, now, {
    autoComplete
  });
  const nextState = {
    highestUnlockedFloor: desiredFloor,
    floors: nextFloors
  };

  const currentSignature = JSON.stringify(serializeSecretRealmState(currentSecretRealm));
  const nextSignature = JSON.stringify(serializeSecretRealmState(nextState));

  if (currentSignature === nextSignature) {
    const decoratedProfile = decorateProfile(
      { ...targetMember, pveProfile: profile },
      profile,
      { viewer: admin }
    );
    return { profile: decoratedProfile, changed: false };
  }

  profile.secretRealm = normalizeSecretRealm(nextState, now);
  refreshAttributeSummary(profile);

  await savePveProfile(memberId, profile, { now, historyDoc: profile.__historyDoc });

  const decoratedProfile = decorateProfile(
    { ...targetMember, pveProfile: profile },
    profile,
    { viewer: admin }
  );

  return { profile: decoratedProfile, changed: true };
}

async function adminResetSecretRealm(actorId, event = {}) {
  const admin = await ensureMember(actorId);
  ensureAdminAccess(admin);

  const scope = typeof event.scope === 'string' ? event.scope.trim().toLowerCase() : 'global';
  const memberId =
    typeof event.memberId === 'string' && event.memberId.trim()
      ? event.memberId.trim()
      : '';

  if (scope === 'member' || memberId) {
    const targetId = memberId || (typeof event.targetId === 'string' ? event.targetId.trim() : '');
    if (!targetId) {
      throw createError('MEMBER_ID_REQUIRED', '缺少会员编号');
    }
    const defaultState = buildDefaultSecretRealmState();
    const now = new Date();
    const targetMember = await ensureMember(targetId);
    const profile = normalizeProfileWithoutEquipmentDefaults(targetMember.pveProfile, now);
    await attachHistoryToProfile(targetId, profile);
    profile.secretRealm = normalizeSecretRealm(defaultState, now);
    refreshAttributeSummary(profile);
    await savePveProfile(targetId, profile, { now, historyDoc: profile.__historyDoc });
    const decoratedProfile = decorateProfile(
      { ...targetMember, pveProfile: profile },
      profile,
      { viewer: admin }
    );
    return {
      scope: 'member',
      memberId: targetId,
      profile: decoratedProfile
    };
  }

  const defaultSecretRealm = normalizeSecretRealm(buildDefaultSecretRealmState());
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const countResult = await membersCollection.count().catch(() => ({ total: 0 }));
  const total = countResult.total || 0;
  let processed = 0;
  let updated = 0;

  while (processed < total) {
    const snapshot = await membersCollection
      .skip(processed)
      .limit(SECRET_REALM_RESET_BATCH_SIZE)
      .field({ _id: true })
      .get()
      .catch(() => ({ data: [] }));

    const docs = snapshot && Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    const now = new Date();
    await Promise.all(
      docs.map((doc) => {
        const docId = doc && doc._id ? doc._id : '';
        if (!docId) {
          return Promise.resolve(false);
        }
        const resetState = {
          highestUnlockedFloor: defaultSecretRealm.highestUnlockedFloor || 1,
          floors: {}
        };
        return membersCollection
          .doc(docId)
          .update({
            data: {
              'pveProfile.secretRealm': _.set(resetState),
              updatedAt: now
            }
          })
          .then(() => {
            updated += 1;
            return true;
          })
          .catch((error) => {
            console.error('[pve] reset secret realm failed', docId, error);
            return false;
          });
      })
    );

    processed += docs.length;
    if (docs.length < SECRET_REALM_RESET_BATCH_SIZE) {
      break;
    }
  }

  return {
    scope: 'global',
    total,
    processed,
    updated
  };
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

  const normalizeRole = (role) => {
    if (!role) {
      return '';
    }
    if (typeof role === 'string') {
      return role.trim().toLowerCase();
    }
    if (typeof role === 'object') {
      if (typeof role.value === 'string') {
        return role.value.trim().toLowerCase();
      }
      if (typeof role.role === 'string') {
        return role.role.trim().toLowerCase();
      }
    }
    return '';
  };

  const normalizedRoles = [];
  if (Array.isArray(member.roles)) {
    member.roles.forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) {
        normalizedRoles.push(normalized);
      }
    });
  } else if (typeof member.roles === 'string') {
    const normalized = normalizeRole(member.roles);
    if (normalized) {
      normalizedRoles.push(normalized);
    }
  }

  if (typeof member.role === 'string') {
    const normalized = normalizeRole(member.role);
    if (normalized) {
      normalizedRoles.push(normalized);
    }
  }

  if (Array.isArray(member.permissions)) {
    member.permissions.forEach((permission) => {
      const normalized = normalizeRole(permission);
      if (normalized) {
        normalizedRoles.push(normalized);
      }
    });
  }

  const defaultRoles = Array.isArray(DEFAULT_ADMIN_ROLES)
    ? DEFAULT_ADMIN_ROLES.map((role) => (typeof role === 'string' ? role.trim().toLowerCase() : '')).filter(Boolean)
    : [];
  const adminRoleSet = new Set([...defaultRoles, 'superadmin']);

  return normalizedRoles.some((role) => adminRoleSet.has(role));
}

function ensureAdminAccess(member) {
  if (!isAdminMember(member)) {
    throw createError('FORBIDDEN', '仅管理员可执行该操作');
  }
}

function cloneProfileWithoutHistory(profile) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }
  const { battleHistory, skillHistory, __historyDoc, ...rest } = profile;
  return { ...rest };
}

async function loadPveHistory(memberId) {
  const historyCollection = db.collection(COLLECTIONS.MEMBER_PVE_HISTORY);
  const snapshot = await historyCollection
    .doc(memberId)
    .get()
    .catch(() => null);

  const data = snapshot && snapshot.data ? snapshot.data : null;
  const battleHistory = normalizeHistory(data ? data.battleHistory : [], MAX_BATTLE_HISTORY);
  const skillHistory = normalizeHistory(data ? data.skillHistory : [], MAX_SKILL_HISTORY);

  return {
    exists: !!data,
    createdAt: data && data.createdAt ? new Date(data.createdAt) : null,
    battleHistory,
    skillHistory
  };
}

async function savePveHistory(memberId, battleHistory, skillHistory, now = new Date(), historyDoc = null) {
  const collectionName = COLLECTIONS.MEMBER_PVE_HISTORY;
  const historyCollection = db.collection(collectionName);
  const normalizedBattle = normalizeHistory(battleHistory, MAX_BATTLE_HISTORY);
  const normalizedSkill = normalizeHistory(skillHistory, MAX_SKILL_HISTORY);
  const createdAt = historyDoc && historyDoc.createdAt ? historyDoc.createdAt : now;

  const payload = {
    createdAt,
    updatedAt: now,
    battleHistory: normalizedBattle,
    skillHistory: normalizedSkill
  };

  await ensureCollection(collectionName);

  try {
    await historyCollection.doc(memberId).set({
      data: payload
    });
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
    ensuredCollections.delete(collectionName);
    await ensureCollection(collectionName);
    await historyCollection.doc(memberId).set({
      data: payload
    });
  }

  return { createdAt, battleHistory: normalizedBattle, skillHistory: normalizedSkill, exists: true };
}

async function savePveProfile(actorId, profile, options = {}) {
  const nowCandidate = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const extraUpdates = options.extraUpdates && typeof options.extraUpdates === 'object' ? options.extraUpdates : {};
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const updatePayload = { ...extraUpdates, updatedAt: nowCandidate };

  if (!options.skipProfile) {
    updatePayload.pveProfile = _.set(cloneProfileWithoutHistory(profile));
  }

  const updateMemberPromise = membersCollection.doc(actorId).update({
    data: updatePayload
  });

  let historyPromise = null;
  if (options.saveHistory !== false) {
    const existingHistory = options.historyDoc || profile.__historyDoc || null;
    const battleHistory = profile && Array.isArray(profile.battleHistory) ? profile.battleHistory : [];
    const skillHistory = profile && Array.isArray(profile.skillHistory) ? profile.skillHistory : [];
    historyPromise = savePveHistory(actorId, battleHistory, skillHistory, nowCandidate, existingHistory).then(
      (savedHistory) => {
        if (profile && typeof profile === 'object') {
          profile.__historyDoc = savedHistory;
          profile.battleHistory = savedHistory.battleHistory;
          profile.skillHistory = savedHistory.skillHistory;
        }
        return savedHistory;
      }
    );
  }

  if (historyPromise) {
    await Promise.all([updateMemberPromise, historyPromise]);
  } else {
    await updateMemberPromise;
  }

  return nowCandidate;
}

async function attachHistoryToProfile(memberId, profile) {
  const historyDoc = await loadPveHistory(memberId);
  if (profile && typeof profile === 'object') {
    profile.battleHistory = Array.isArray(historyDoc.battleHistory) ? historyDoc.battleHistory : [];
    profile.skillHistory = Array.isArray(historyDoc.skillHistory) ? historyDoc.skillHistory : [];
    profile.__historyDoc = historyDoc;
  }
  return historyDoc;
}

async function ensurePveProfile(actorId, member, levelCache) {
  const now = new Date();
  const rawProfile = member && member.pveProfile && typeof member.pveProfile === 'object' ? member.pveProfile : null;
  const normalizedProfile = normalizeProfile(rawProfile || {}, now);
  let profile = normalizedProfile;
  let changed = !rawProfile || !deepEqual(rawProfile, normalizedProfile);

  const levels = Array.isArray(levelCache) ? levelCache : await loadMembershipLevels();
  let summaryDirty = false;
  if (syncAttributesWithMemberLevel(profile.attributes, member, levels)) {
    changed = true;
    summaryDirty = true;
  }

  const extras = await loadMemberExtras(actorId);
  const attrs = profile.attributes || {};
  const currentAvatarBonus = Math.max(0, Math.floor(Number(attrs.avatarBonusPoints) || 0));
  const desiredAvatarBonus = Math.max(0, Math.floor(Number(extras.avatarAttributeBonus) || 0));
  if (desiredAvatarBonus !== currentAvatarBonus) {
    const availablePoints = Math.max(0, Math.floor(Number(attrs.attributePoints) || 0));
    const diff = desiredAvatarBonus - currentAvatarBonus;
    attrs.attributePoints = Math.max(0, availablePoints + diff);
    attrs.avatarBonusPoints = desiredAvatarBonus;
    profile.attributes = attrs;
    changed = true;
    summaryDirty = true;
  }

  if (summaryDirty) {
    refreshAttributeSummary(profile);
  }

  let historyDoc = profile.__historyDoc && typeof profile.__historyDoc === 'object' ? profile.__historyDoc : null;
  if (!historyDoc) {
    historyDoc = await loadPveHistory(actorId);
  }

  let battleHistory = Array.isArray(historyDoc.battleHistory) ? historyDoc.battleHistory : [];
  let skillHistory = Array.isArray(historyDoc.skillHistory) ? historyDoc.skillHistory : [];
  let historyChanged = false;

  if (!historyDoc.exists) {
    const normalizedBattle = Array.isArray(profile.battleHistory)
      ? normalizeHistory(profile.battleHistory, MAX_BATTLE_HISTORY)
      : [];
    const normalizedSkill = Array.isArray(profile.skillHistory)
      ? normalizeHistory(profile.skillHistory, MAX_SKILL_HISTORY)
      : [];
    if (normalizedBattle.length) {
      battleHistory = normalizedBattle;
      historyChanged = true;
    }
    if (normalizedSkill.length) {
      skillHistory = normalizedSkill;
      historyChanged = true;
    }
  }

  profile.battleHistory = battleHistory;
  profile.skillHistory = skillHistory;
  profile.__historyDoc = { ...historyDoc, battleHistory, skillHistory };

  const shouldPersistProfile = changed;
  const shouldPersistHistory = historyChanged;

  if (shouldPersistProfile || shouldPersistHistory) {
    await savePveProfile(actorId, profile, {
      now,
      historyDoc: profile.__historyDoc,
      saveHistory: shouldPersistHistory,
      skipProfile: !shouldPersistProfile
    });
  }

  return profile;
}
function buildDefaultProfile(now = new Date()) {
  return {
    attributes: buildDefaultAttributes(),
    equipment: buildDefaultEquipment(),
    skills: buildDefaultSkills(now),
    secretRealm: buildDefaultSecretRealmState(),
    battleHistory: [],
    skillHistory: [],
    lastBattleAt: null
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

function buildDefaultStorage(level = 0) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const limit = Math.max(DEFAULT_STORAGE_UPGRADE_LIMIT, safeLevel);
  const upgrades = {};
  STORAGE_CATEGORY_KEYS.forEach((key) => {
    upgrades[key] = safeLevel;
  });
  const upgradeAvailable =
    safeLevel > 0 ? Math.max(limit - Math.min(limit, safeLevel), 0) : 0;
  return {
    upgrades,
    globalUpgrades: safeLevel,
    baseCapacity: STORAGE_BASE_CAPACITY,
    perUpgrade: STORAGE_PER_UPGRADE,
    upgradeLimit: limit,
    upgradeAvailable
  };
}

function buildDefaultEquipment() {
  return { inventory: [], slots: createEmptySlotMap(), storage: buildDefaultStorage(0) };
}

function buildDefaultSkills(now = new Date()) {
  const defaultSkill = createSkillInventoryEntry('sword_breaking_clouds', now);
  return {
    inventory: [defaultSkill],
    equipped: ['sword_breaking_clouds'],
    lastDrawAt: null,
    drawCount: 0,
    drawCredits: DEFAULT_SKILL_DRAW_CREDITS
  };
}

function buildDefaultSecretRealmState() {
  const firstFloor = ENEMY_LIBRARY.length ? ENEMY_LIBRARY[0].floor : 1;
  return {
    highestUnlockedFloor: firstFloor,
    floors: {}
  };
}

function normalizeProfile(profile, now = new Date()) {
  return normalizeProfileInternal(profile, now, { includeEquipmentDefaults: true });
}

function readStorageNumber(payload, metadata, keys, options = {}) {
  const { allowFloat = false } = options;
  const sources = [payload, metadata];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    for (let j = 0; j < sources.length; j += 1) {
      const source = sources[j];
      if (!source || !Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }
      const value = Number(source[key]);
      if (Number.isNaN(value)) {
        continue;
      }
      if (allowFloat) {
        return value;
      }
      if (value >= 0) {
        return Math.floor(value);
      }
    }
  }
  return null;
}

function normalizeStorageMetadata(rawStorage) {
  const payload = rawStorage && typeof rawStorage === 'object' ? rawStorage : {};
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const normalized = {};

  const baseCapacity = readStorageNumber(payload, metadata, ['baseCapacity']);
  if (baseCapacity !== null) {
    normalized.baseCapacity = baseCapacity;
  }

  const perUpgrade = readStorageNumber(payload, metadata, ['perUpgrade']);
  if (perUpgrade !== null) {
    normalized.perUpgrade = perUpgrade;
  }

  const sharedUpgrades = readStorageNumber(payload, metadata, ['sharedUpgrades', 'upgrades', 'upgradeLevel']);
  if (sharedUpgrades !== null) {
    normalized.sharedUpgrades = sharedUpgrades;
  }

  const upgradeLimit = readStorageNumber(payload, metadata, ['upgradeLimit', 'limit', 'maxUpgrades']);
  if (upgradeLimit !== null) {
    normalized.upgradeLimit = upgradeLimit;
  }

  const remainingUpgrades = readStorageNumber(payload, metadata, ['remainingUpgrades', 'availableUpgrades', 'upgradesRemaining']);
  if (remainingUpgrades !== null) {
    normalized.remainingUpgrades = remainingUpgrades;
  }

  const capacity = readStorageNumber(payload, metadata, ['capacity', 'sharedCapacity']);
  if (capacity !== null) {
    normalized.capacity = capacity;
  }

  const nextCapacity = readStorageNumber(payload, metadata, ['nextCapacity']);
  if (nextCapacity !== null) {
    normalized.nextCapacity = nextCapacity;
  }

  const totalItems = readStorageNumber(payload, metadata, ['totalItems']);
  if (totalItems !== null) {
    normalized.totalItems = totalItems;
  }

  const remainingSlots = readStorageNumber(payload, metadata, ['remainingSlots']);
  if (remainingSlots !== null) {
    normalized.remainingSlots = remainingSlots;
  }

  const usagePercent = readStorageNumber(payload, metadata, ['usagePercent'], { allowFloat: true });
  if (usagePercent !== null) {
    const bounded = Math.max(0, Math.min(100, Math.round(usagePercent)));
    normalized.usagePercent = bounded;
  }

  return normalized;
}

function sanitizeStorageIdentifier(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.replace(/\s+/g, '-');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return '';
}

function sanitizeStorageKeyComponent(value) {
  const normalized = sanitizeStorageIdentifier(value);
  if (!normalized) {
    return '';
  }
  return normalized.replace(/[:/\\?&#%]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function generateStorageInventoryId(category, itemId, obtainedAt = null) {
  const safeCategory = sanitizeStorageIdentifier(category) || 'storage';
  const safeItem = sanitizeStorageIdentifier(itemId) || 'item';
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${safeCategory}-${safeItem}-${timestamp}-${random}`;
}

function buildStableStorageInventoryId(category, sourceId, obtainedAt = null, index = 0) {
  const safeCategory = sanitizeStorageKeyComponent(category) || 'storage';
  const safeSource = sanitizeStorageKeyComponent(sourceId) || 'item';
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : 0;
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return `${safeCategory}-${safeSource}-${timestamp}-${safeIndex}`;
}

function normalizeStorageInventoryItem(entry, categoryKey, index = 0) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const normalized = { ...entry };
  const key = typeof categoryKey === 'string' && categoryKey.trim() ? categoryKey.trim() : 'consumable';
  const itemId = typeof normalized.itemId === 'string' ? normalized.itemId.trim() : '';
  const candidateIds = [normalized.inventoryId, normalized.id, normalized._id];
  let inventoryId = '';
  for (let i = 0; i < candidateIds.length; i += 1) {
    const candidate = sanitizeStorageIdentifier(candidateIds[i]);
    if (candidate) {
      inventoryId = candidate;
      break;
    }
  }
  if (!itemId && !inventoryId) {
    return null;
  }
  if (itemId) {
    normalized.itemId = itemId;
  }

  let obtainedAt = null;
  if (normalized.obtainedAt) {
    const parsed = new Date(normalized.obtainedAt);
    if (!Number.isNaN(parsed.getTime())) {
      obtainedAt = parsed;
    }
  }
  if (obtainedAt) {
    normalized.obtainedAt = obtainedAt;
  } else if (normalized.obtainedAt) {
    delete normalized.obtainedAt;
  }

  if (typeof normalized.storageCategory === 'string' && normalized.storageCategory.trim()) {
    normalized.storageCategory = normalized.storageCategory.trim();
  } else {
    normalized.storageCategory = key;
  }

  const badgeCategory = sanitizeStorageIdentifier(normalized.storageCategory) || key;

  const stableCategoryComponent =
    sanitizeStorageKeyComponent(normalized.storageCategory) ||
    sanitizeStorageKeyComponent(key) ||
    'storage';

  const fallbackSourceCandidates = [
    inventoryId,
    normalized.storageSerial,
    normalized.storageBadgeKey,
    normalized.storageKey,
    normalized.storageId,
    normalized.inventoryKey,
    normalized.itemId,
    normalized.timestamp,
    normalized.createdAt,
    normalized.updatedAt,
    normalized.obtainTime,
    obtainedAt ? obtainedAt.getTime() : '',
    normalized.id,
    normalized._id,
    `entry-${index}`
  ];
  let fallbackSource = '';
  for (let i = 0; i < fallbackSourceCandidates.length; i += 1) {
    const component = sanitizeStorageKeyComponent(fallbackSourceCandidates[i]);
    if (component) {
      if (component.startsWith(`${stableCategoryComponent}-`)) {
        const trimmed = component.slice(stableCategoryComponent.length + 1);
        fallbackSource = trimmed || component;
      } else {
        fallbackSource = component;
      }
      break;
    }
  }
  if (!fallbackSource) {
    const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
    fallbackSource = `entry-${safeIndex}`;
  }

  const stableIdentifier = buildStableStorageInventoryId(
    normalized.storageCategory,
    fallbackSource,
    obtainedAt,
    index
  );

  if (!inventoryId) {
    inventoryId = stableIdentifier;
  }
  normalized.inventoryId = inventoryId;

  const previousSerial = sanitizeStorageIdentifier(normalized.storageSerial);
  const serialCandidates = [
    sanitizeStorageIdentifier(inventoryId),
    sanitizeStorageIdentifier(stableIdentifier),
    itemId && obtainedAt ? sanitizeStorageIdentifier(`${itemId}-${obtainedAt.getTime()}`) : '',
    sanitizeStorageIdentifier(normalized.serialId),
    sanitizeStorageIdentifier(normalized.serial),
    sanitizeStorageIdentifier(normalized.sequenceId),
    sanitizeStorageIdentifier(normalized.entryId),
    sanitizeStorageIdentifier(normalized.badgeId),
    previousSerial
  ];
  let storageSerial = '';
  for (let i = 0; i < serialCandidates.length; i += 1) {
    const candidate = serialCandidates[i];
    if (candidate) {
      storageSerial = candidate;
      break;
    }
  }
  if (!storageSerial) {
    storageSerial = stableIdentifier;
  }
  if (previousSerial && previousSerial !== storageSerial) {
    const legacyTargets = ['serialId', 'sequenceId', 'entryId', 'badgeId'];
    for (let i = 0; i < legacyTargets.length; i += 1) {
      const key = legacyTargets[i];
      const existing = sanitizeStorageIdentifier(normalized[key]);
      if (!existing) {
        normalized[key] = previousSerial;
        break;
      }
    }
  }
  normalized.storageSerial = storageSerial;

  const previousBadgeKey =
    typeof normalized.storageBadgeKey === 'string' ? normalized.storageBadgeKey.trim() : '';
  const desiredBadgeKey = `${badgeCategory}:${storageSerial}`;
  if (previousBadgeKey && previousBadgeKey !== desiredBadgeKey) {
    if (!normalized.badgeKey) {
      normalized.badgeKey = previousBadgeKey;
    } else if (!normalized.storageId) {
      normalized.storageId = previousBadgeKey;
    }
  }
  normalized.storageBadgeKey = desiredBadgeKey;

  const previousStorageKey =
    typeof normalized.storageKey === 'string' ? normalized.storageKey.trim() : '';
  const desiredStorageKey = `${badgeCategory}-${storageSerial}`;
  if (previousStorageKey && previousStorageKey !== desiredStorageKey) {
    if (!normalized.inventoryKey) {
      normalized.inventoryKey = previousStorageKey;
    } else if (!normalized.storageId) {
      normalized.storageId = previousStorageKey;
    }
  }
  normalized.storageKey = desiredStorageKey;

  if (
    typeof normalized.slotLabel !== 'string' ||
    !normalized.slotLabel.trim()
  ) {
    normalized.slotLabel =
      STORAGE_CATEGORY_LABEL_MAP[normalized.storageCategory] ||
      STORAGE_CATEGORY_LABEL_MAP[key] ||
      normalized.storageCategory ||
      '道具';
  }
  if (Array.isArray(normalized.actions)) {
    normalized.actions = normalized.actions
      .map((action) => ({
        key: typeof action.key === 'string' ? action.key.trim() : '',
        label: typeof action.label === 'string' ? action.label : '',
        primary: !!action.primary
      }))
      .filter((action) => action.key && action.label);
  } else {
    normalized.actions = [];
  }
  if (normalized.actions.length) {
    const primary = normalized.actions.find((action) => action.primary) || normalized.actions[0];
    normalized.primaryAction = primary || null;
  } else {
    normalized.primaryAction = null;
  }
  if (Array.isArray(normalized.notes)) {
    normalized.notes = normalized.notes.filter((note) => !!note);
  } else {
    normalized.notes = [];
  }
  normalized.locked = normalized.locked === true;
  if (!normalized.kind) {
    normalized.kind = normalized.storageCategory === 'equipment' ? 'equipment' : 'storage';
  }
  if (normalized.usage && typeof normalized.usage === 'object') {
    normalized.usage = { ...normalized.usage };
  } else {
    normalized.usage = null;
  }
  const quantityCandidates = [normalized.quantity, normalized.count, normalized.amount];
  for (let i = 0; i < quantityCandidates.length; i += 1) {
    const candidate = Number(quantityCandidates[i]);
    if (Number.isFinite(candidate)) {
      normalized.quantity = Math.max(0, Math.floor(candidate));
      break;
    }
  }
  return normalized;
}

function normalizeStorageCategoryEntry(category) {
  if (!category || typeof category !== 'object') {
    return null;
  }
  const key = typeof category.key === 'string' ? category.key.trim() : '';
  if (!key) {
    return null;
  }
  const label =
    typeof category.label === 'string' && category.label.trim()
      ? category.label.trim()
      : STORAGE_CATEGORY_LABEL_MAP[key] || key;
  const items = Array.isArray(category.items)
    ? category.items
        .map((item, index) => normalizeStorageInventoryItem(item, key, index))
        .filter((item) => !!item)
    : [];
  const normalized = { key, label, items };
  const baseCapacity = toOptionalPositiveInt(category.baseCapacity);
  if (baseCapacity !== null) {
    normalized.baseCapacity = baseCapacity;
  }
  const perUpgrade = toOptionalPositiveInt(category.perUpgrade);
  if (perUpgrade !== null) {
    normalized.perUpgrade = perUpgrade;
  }
  const upgrades = toOptionalPositiveInt(category.upgrades);
  if (upgrades !== null) {
    normalized.upgrades = upgrades;
  }
  const capacity = toOptionalPositiveInt(category.capacity);
  if (capacity !== null) {
    normalized.capacity = capacity;
  }
  const used = toOptionalPositiveInt(category.used);
  if (used !== null) {
    normalized.used = used;
  }
  const remaining = toOptionalPositiveInt(category.remaining);
  if (remaining !== null) {
    normalized.remaining = remaining;
  }
  const usagePercent = toOptionalPositiveInt(category.usagePercent);
  if (usagePercent !== null) {
    normalized.usagePercent = Math.min(100, usagePercent);
  }
  const nextCapacity = toOptionalPositiveInt(category.nextCapacity);
  if (nextCapacity !== null) {
    normalized.nextCapacity = nextCapacity;
  }
  const upgradeAvailable = toOptionalPositiveInt(category.upgradeAvailable);
  if (upgradeAvailable !== null) {
    normalized.upgradeAvailable = upgradeAvailable;
  }
  const upgradeLimit = toOptionalPositiveInt(category.upgradeLimit);
  if (upgradeLimit !== null) {
    normalized.upgradeLimit = upgradeLimit;
  }
  if (category.meta && typeof category.meta === 'object') {
    normalized.meta = { ...category.meta };
  }
  return normalized;
}

function normalizeProfileWithoutEquipmentDefaults(profile, now = new Date()) {
  return normalizeProfileInternal(profile, now, { includeEquipmentDefaults: false });
}

function normalizeProfileInternal(profile, now = new Date(), options = {}) {
  const payload = typeof profile === 'object' && profile ? profile : {};
  const includeDefaults = options.includeEquipmentDefaults !== false;
  const normalized = {
    attributes: normalizeAttributes(payload.attributes),
    equipment: normalizeEquipment(payload.equipment, now, { includeDefaults }),
    skills: normalizeSkills(payload.skills, now),
    secretRealm: normalizeSecretRealm(payload.secretRealm, now),
    battleHistory: normalizeHistory(payload.battleHistory, MAX_BATTLE_HISTORY),
    skillHistory: normalizeHistory(payload.skillHistory, MAX_SKILL_HISTORY)
  };
  const lastBattleAt = resolveDateInput(payload.lastBattleAt);
  normalized.lastBattleAt = lastBattleAt || null;
  refreshAttributeSummary(normalized);
  return normalized;
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
  const defaults = includeDefaults ? buildDefaultEquipment() : { inventory: [], slots: createEmptySlotMap() };
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

  if (includeDefaults && normalizedInventory.length === 0) {
    (defaults.inventory || []).forEach((entry) => {
      if (entry) {
        trackInventory({ ...entry });
      }
    });
  }

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
    const hasRawSlotValue = Object.prototype.hasOwnProperty.call(rawSlots, slot);
    const raw = rawSlots[slot];
    let normalizedEntry = null;
    if (raw && typeof raw === 'object') {
      const candidate = normalizeEquipmentInventoryItem(raw, now);
      if (candidate) {
        normalizedEntry = { ...candidate };
      }
    } else if (typeof raw === 'string' && raw) {
      normalizedEntry = claimByItemId(raw);
    }
    if (!normalizedEntry && !hasRawSlotValue && defaults.slots && defaults.slots[slot]) {
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
    if (raw && typeof raw === 'object') {
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

  const defaultStorage =
    defaults.storage && typeof defaults.storage === 'object' ? defaults.storage : null;
  const rawStoragePayload =
    payload.storage && typeof payload.storage === 'object' ? payload.storage : null;
  const rawStorage = rawStoragePayload || defaultStorage || {};
  const { level: storageLevel, upgrades: storageUpgrades } = resolveStorageUpgradeState(rawStorage);
  const baseCapacity = resolveStorageBaseCapacity(rawStorage);
  const perUpgrade = resolveStoragePerUpgrade(rawStorage);
  const {
    value: storageUpgradeAvailable,
    key: storageUpgradeAvailableKey
  } = extractStorageUpgradeAvailable(rawStorage);
  const { value: storageUpgradeLimit, key: storageUpgradeLimitKey } = extractStorageUpgradeLimit(rawStorage);
  const hasAvailableField = storageUpgradeAvailableKey !== null;
  const hasLimitField = storageUpgradeLimitKey !== null;
  let resolvedUpgradeAvailable =
    typeof storageUpgradeAvailable === 'number' ? Math.max(0, storageUpgradeAvailable) : null;
  let resolvedUpgradeLimit = storageUpgradeLimit !== null && storageUpgradeLimit > 0 ? storageUpgradeLimit : null;
  if (resolvedUpgradeLimit === null) {
    const inferredLimit = Math.max(
      DEFAULT_STORAGE_UPGRADE_LIMIT,
      storageLevel + Math.max(0, resolvedUpgradeAvailable !== null ? resolvedUpgradeAvailable : 0)
    );
    resolvedUpgradeLimit = inferredLimit;
  }
  if (resolvedUpgradeAvailable === null || !hasAvailableField) {
    resolvedUpgradeAvailable = 0;
  }
  const normalizedStorage = {
    upgrades: storageUpgrades,
    globalUpgrades: storageLevel,
    baseCapacity,
    perUpgrade
  };
  const availableKey = storageUpgradeAvailableKey || 'upgradeAvailable';
  normalizedStorage[availableKey] = resolvedUpgradeAvailable;
  if (resolvedUpgradeLimit !== null) {
    const key = storageUpgradeLimitKey || 'upgradeLimit';
    normalizedStorage[key] = resolvedUpgradeLimit;
  }

  const normalizedStorageMeta = normalizeStorageMetadata(rawStoragePayload);
  if (normalizedStorageMeta && Object.keys(normalizedStorageMeta).length) {
    normalizedStorage.meta = normalizedStorageMeta;
  }
  const rawStorageCategories =
    rawStoragePayload && Array.isArray(rawStoragePayload.categories) ? rawStoragePayload.categories : [];
  const normalizedCategories = rawStorageCategories
    .map((category) => normalizeStorageCategoryEntry(category))
    .filter((category) => !!category);
  if (normalizedCategories.length) {
    normalizedStorage.categories = normalizedCategories;
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

  const hadInventory = inventory.length > 0;

  defaults.inventory.forEach((entry) => {
    if (!seen.has(entry.skillId)) {
      inventory.push(entry);
      seen.add(entry.skillId);
    }
  });

  let equipped = Array.isArray(payload.equipped) ? payload.equipped.filter((id) => typeof id === 'string' && id) : [];
  equipped = equipped.filter((id, index) => SKILL_MAP[id] && equipped.indexOf(id) === index).slice(0, MAX_SKILL_SLOTS);
  if (!equipped.length && !hadInventory) {
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

  const defaultDrawCredits = Math.max(
    0,
    Math.floor(Number(defaults.drawCredits) || DEFAULT_SKILL_DRAW_CREDITS)
  );
  const normalizedDrawCredits = normalizeSkillDrawCreditValue(
    Object.prototype.hasOwnProperty.call(payload, 'drawCredits')
      ? payload.drawCredits
      : defaultDrawCredits,
    defaultDrawCredits
  );

  return {
    inventory,
    equipped,
    lastDrawAt: payload.lastDrawAt ? new Date(payload.lastDrawAt) : null,
    drawCount: Math.max(0, Math.floor(Number(payload.drawCount) || defaults.drawCount || 0)),
    drawCredits: normalizedDrawCredits
  };
}

function normalizeSecretRealm(secretRealm, now = new Date()) {
  const defaults = buildDefaultSecretRealmState();
  const payload = typeof secretRealm === 'object' && secretRealm ? secretRealm : {};
  const floors = {};
  const rawFloors = payload.floors && typeof payload.floors === 'object' ? payload.floors : {};

  Object.keys(rawFloors).forEach((floorId) => {
    const entry = rawFloors[floorId] || {};
    let enemy = resolveEnemyTarget(floorId);
    if (!enemy && entry && entry.enemyId) {
      enemy = resolveEnemyTarget(entry.enemyId);
    }
    if (!enemy) {
      return;
    }
    const entryClearedAt = entry.clearedAt ? new Date(entry.clearedAt) : null;
    const normalizedClearedAt =
      entryClearedAt && !Number.isNaN(entryClearedAt.getTime()) ? entryClearedAt : null;
    const normalizedBestRounds = Number.isFinite(Number(entry.bestRounds))
      ? Math.max(1, Math.floor(Number(entry.bestRounds)))
      : null;
    const normalizedVictories = Number.isFinite(Number(entry.victories))
      ? Math.max(0, Math.floor(Number(entry.victories)))
      : 0;

    const targetId = enemy.id;
    const existing = floors[targetId] || {};
    const existingClearedAt =
      existing.clearedAt instanceof Date && !Number.isNaN(existing.clearedAt.getTime())
        ? existing.clearedAt
        : null;
    let mergedClearedAt = existingClearedAt;
    if (normalizedClearedAt) {
      if (!mergedClearedAt) {
        mergedClearedAt = normalizedClearedAt;
      } else if (normalizedClearedAt.getTime() < mergedClearedAt.getTime()) {
        mergedClearedAt = normalizedClearedAt;
      }
    }

    const existingBestRounds = Number.isFinite(Number(existing.bestRounds))
      ? Math.max(1, Math.floor(Number(existing.bestRounds)))
      : null;
    let mergedBestRounds = existingBestRounds;
    if (normalizedBestRounds) {
      if (!mergedBestRounds) {
        mergedBestRounds = normalizedBestRounds;
      } else {
        mergedBestRounds = Math.min(mergedBestRounds, normalizedBestRounds);
      }
    }

    const existingVictories = Number.isFinite(Number(existing.victories))
      ? Math.max(0, Math.floor(Number(existing.victories)))
      : 0;
    const mergedVictories = Math.max(existingVictories, normalizedVictories);

    floors[targetId] = {
      clearedAt: mergedClearedAt || null,
      bestRounds: mergedBestRounds || null,
      victories: mergedVictories
    };
  });

  const rawHighest = Number(payload.highestUnlockedFloor);
  let highestUnlockedFloor = Number.isFinite(rawHighest)
    ? Math.max(1, Math.floor(rawHighest))
    : defaults.highestUnlockedFloor;
  const highestProgress = Object.keys(floors).reduce((max, floorKey) => {
    const enemy = ENEMY_MAP[floorKey];
    if (!enemy) {
      return max;
    }
    const state = floors[floorKey];
    if (!state || !state.clearedAt) {
      return max;
    }
    const nextCandidate = enemy.floor + 1;
    if (SECRET_REALM_MAX_FLOOR > 0) {
      return Math.max(max, Math.min(SECRET_REALM_MAX_FLOOR, nextCandidate));
    }
    return Math.max(max, nextCandidate);
  }, defaults.highestUnlockedFloor);
  highestUnlockedFloor = Math.max(highestUnlockedFloor, highestProgress);
  if (SECRET_REALM_MAX_FLOOR > 0) {
    highestUnlockedFloor = Math.min(SECRET_REALM_MAX_FLOOR, highestUnlockedFloor);
  }
  if (!highestUnlockedFloor || highestUnlockedFloor < 1) {
    highestUnlockedFloor = defaults.highestUnlockedFloor;
  }

  return {
    highestUnlockedFloor,
    floors
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

function extractTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^-?\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function resolveEquipmentObtainedTimestamp(item, now = new Date()) {
  if (item && typeof item === 'object') {
    const candidates = [
      item.obtainedAt,
      item.obtainTime,
      item.obtainTimestamp,
      item.obtainDate,
      item.obtainDateTime,
      item.obtain_at,
      item.obtain_time,
      item.acquireTime,
      item.acquire_at,
      item.acquiredAt,
      item.acquiredTime,
      item.grantedAt,
      item.createdAt,
      item.created_at,
      item.timestamp,
      item.time
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const parsed = extractTimestamp(candidates[i]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return 0;
}

function buildEquipmentFingerprint(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const rawLevel = Number(item.level);
  const rawRefine = Number(item.refine);
  const payload = {
    level: Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : null,
    refine: Number.isFinite(rawRefine) ? Math.max(0, Math.floor(rawRefine)) : null,
    favorite: !!item.favorite,
    bonus: item.bonus && typeof item.bonus === 'object' ? item.bonus : null,
    extra: item.extra && typeof item.extra === 'object' ? item.extra : null,
    rolls: Array.isArray(item.rolls) ? item.rolls : null,
    stats: item.stats && typeof item.stats === 'object' ? item.stats : null
  };
  const json = JSON.stringify(payload);
  if (!json) {
    return '';
  }
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash * 31 + json.charCodeAt(i)) >>> 0;
  }
  return hash ? hash.toString(36) : '';
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
  const obtainedTimestamp = resolveEquipmentObtainedTimestamp(item, now);
  const obtainedAt = obtainedTimestamp ? new Date(obtainedTimestamp) : null;
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
    quality: definition.quality || entry.quality || entry.rarity || 'linggan',
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
    item && item._id,
    item && item.inventoryKey,
    item && item.storageId,
    item && item.storageSerial,
    item && item.storageKey,
    item && item.storageBadgeKey,
    item && item.serialId,
    item && item.serial,
    item && item.sequenceId,
    item && item.badgeId,
    item && item.obtainId,
    item && item.obtainKey,
    item && item.identifier
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : 0;
  const safeItemId = sanitizeStorageKeyComponent(itemId) || 'equipment';
  const parts = [safeItemId];
  if (timestamp) {
    parts.push(`t${timestamp}`);
  }
  const level = Number(item && item.level);
  if (Number.isFinite(level)) {
    parts.push(`l${Math.max(0, Math.floor(level))}`);
  }
  const refine = Number(item && item.refine);
  if (Number.isFinite(refine)) {
    parts.push(`r${Math.max(0, Math.floor(refine))}`);
  }
  if (item && typeof item.slot === 'string' && item.slot.trim()) {
    parts.push(`s${sanitizeStorageKeyComponent(item.slot)}`);
  }
  const fingerprint = buildEquipmentFingerprint(item);
  if (fingerprint) {
    parts.push(`f${fingerprint}`);
  }
  return `eq-${parts.join('-')}`;
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
    quality: definition.quality || 'linggan',
    level: 1,
    duplicates: 0,
    obtainedAt,
    favorite: false
  };
}

function decorateStorageInventoryItem(entry, fallbackCategory = '') {
  if (!entry) {
    return null;
  }
  const payload = typeof entry === 'object' ? { ...entry } : { itemId: entry };
  const category =
    typeof payload.storageCategory === 'string' && payload.storageCategory
      ? payload.storageCategory
      : fallbackCategory || 'consumable';
  const inventoryIdCandidates = [
    payload.inventoryId,
    payload.id,
    payload._id,
    payload.itemId ? `${category}-${payload.itemId}` : ''
  ];
  let inventoryId = '';
  for (let i = 0; i < inventoryIdCandidates.length; i += 1) {
    const candidate = inventoryIdCandidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      inventoryId = candidate.trim();
      break;
    }
  }
  const serialCandidates = [
    payload.storageSerial,
    payload.serialId,
    payload.serial,
    payload.sequenceId,
    payload.entryId,
    payload.badgeId,
    inventoryId,
    payload.itemId && payload.obtainedAt ? `${payload.itemId}-${payload.obtainedAt}` : ''
  ];
  let storageSerial = '';
  for (let i = 0; i < serialCandidates.length; i += 1) {
    const candidate = serialCandidates[i];
    if (typeof candidate === 'string' && candidate.trim()) {
      storageSerial = candidate.trim();
      break;
    }
  }
  const obtainedAtRaw = payload.obtainedAt ? new Date(payload.obtainedAt) : null;
  const obtainedAt = obtainedAtRaw instanceof Date && !Number.isNaN(obtainedAtRaw.getTime()) ? obtainedAtRaw : null;
  const actions = Array.isArray(payload.actions)
    ? payload.actions
        .map((action) => ({
          key: typeof action.key === 'string' ? action.key.trim() : '',
          label: typeof action.label === 'string' ? action.label : '',
          primary: !!action.primary
        }))
        .filter((action) => action.key && action.label)
    : [];
  const primaryAction = payload.primaryAction && typeof payload.primaryAction.key === 'string'
    ? actions.find((action) => action.key === payload.primaryAction.key)
    : null;
  const notes = Array.isArray(payload.notes) ? payload.notes.filter((note) => !!note) : [];
  const normalized = {
    ...payload,
    inventoryId,
    storageSerial: storageSerial || inventoryId,
    storageCategory: category,
    storageCategoryLabel: payload.storageCategoryLabel || STORAGE_CATEGORY_LABEL_MAP[category] || category || '',
    name: payload.name || '道具',
    shortName: payload.shortName || payload.name || '道具',
    description: payload.description || '',
    iconUrl: payload.iconUrl || '',
    iconFallbackUrl: payload.iconFallbackUrl || '',
    quality: payload.quality || '',
    qualityLabel: payload.qualityLabel || '',
    qualityColor: payload.qualityColor || '#6b7bff',
    obtainedAt,
    obtainedAtText: payload.obtainedAtText || (obtainedAt ? formatDateTime(obtainedAt) : ''),
    locked: !!payload.locked,
    usage: payload.usage && typeof payload.usage === 'object' ? { ...payload.usage } : null,
    actions,
    primaryAction: primaryAction || (actions.length ? actions[0] : null),
    kind: payload.kind || (category === 'equipment' ? 'equipment' : 'storage'),
    notes,
    slotLabel:
      payload.slotLabel ||
      (category && STORAGE_CATEGORY_LABEL_MAP[category] ? STORAGE_CATEGORY_LABEL_MAP[category] : '道具')
  };
  if (typeof normalized.storageBadgeKey !== 'string' || !normalized.storageBadgeKey) {
    const safeCategory = typeof normalized.storageCategory === 'string' && normalized.storageCategory
      ? normalized.storageCategory
      : category;
    const serial = normalized.storageSerial || inventoryId;
    if (serial) {
      normalized.storageBadgeKey = `${safeCategory}:${serial}`;
    }
  }
  if (typeof normalized.storageKey !== 'string' || !normalized.storageKey) {
    const safeCategory = typeof normalized.storageCategory === 'string' && normalized.storageCategory
      ? normalized.storageCategory
      : category;
    const serial = normalized.storageSerial || inventoryId;
    if (serial) {
      normalized.storageKey = `${safeCategory}-${serial}`;
    }
  }
  const quantityCandidates = [payload.quantity, payload.count, payload.amount];
  for (let i = 0; i < quantityCandidates.length; i += 1) {
    const candidate = Number(quantityCandidates[i]);
    if (Number.isFinite(candidate)) {
      normalized.quantity = Math.max(0, Math.floor(candidate));
      break;
    }
  }
  return normalized;
}
function decorateProfile(member, profile, options = {}) {
  const viewer = options.viewer || member;
  const viewerIsAdmin = isAdminMember(viewer);
  const attributes = profile && profile.attributes ? profile.attributes : {};
  const equipment = profile && profile.equipment ? profile.equipment : {};
  const skills = profile && profile.skills ? profile.skills : {};
  let attributeSummary = profile && typeof profile.attributeSummary === 'object' ? profile.attributeSummary : null;
  if (!attributeSummary) {
    attributeSummary = calculateAttributes(attributes, equipment, skills);
    if (profile && typeof profile === 'object') {
      profile.attributeSummary = attributeSummary;
    }
  }
  const equipmentSummary = decorateEquipment(profile, attributeSummary.equipmentBonus);
  const skillsSummary = decorateSkills(profile);
  const secretRealm = decorateSecretRealm(profile.secretRealm, attributeSummary, { viewerIsAdmin });
  const enemies = secretRealm.visibleFloors || [];
  const battleHistory = decorateBattleHistory(profile.battleHistory, profile, { viewerIsAdmin });
  const skillHistory = decorateSkillHistory(profile.skillHistory);

  return {
    memberId: member._id || member.id || '',
    attributes: attributeSummary,
    equipment: equipmentSummary,
    skills: skillsSummary,
    secretRealm,
    enemies,
    battleHistory,
    skillHistory,
    skillQualityConfig: decorateSkillQualityConfig(),
    metadata: {
      maxSkillSlots: MAX_SKILL_SLOTS,
      maxLevel: attributeSummary.maxLevel || MAX_LEVEL,
      viewerIsAdmin
    }
  };
}

function refreshAttributeSummary(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const summary = calculateAttributes(profile.attributes || {}, profile.equipment || {}, profile.skills || {});
  profile.attributeSummary = summary;
  return summary;
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

  stats.maxHp = 200 + constitution * 20 + root * 5;
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

  const special = { ...(equipmentSummary.special || {}) };
  Object.keys(skillSummary.special || {}).forEach((key) => {
    special[key] = (special[key] || 0) + (skillSummary.special[key] || 0);
  });

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
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};
  const { level: storageLevel, upgrades: storageLevelMap } = resolveStorageUpgradeState(storage);
  const baseCapacity = resolveStorageBaseCapacity(storage);
  const perUpgrade = resolveStoragePerUpgrade(storage);
  const capacity = baseCapacity + perUpgrade * storageLevel;
  const upgradeAvailable = resolveStorageUpgradeAvailable(storage);
  const rawUpgradeLimit = resolveStorageUpgradeLimit(storage);
  const upgradeLimit = rawUpgradeLimit !== null && rawUpgradeLimit > 0 ? rawUpgradeLimit : null;
  const upgradesRemaining =
    upgradeLimit !== null ? Math.max(upgradeLimit - Math.min(upgradeLimit, storageLevel), 0) : null;
  const rawCategories = Array.isArray(storage.categories) ? storage.categories : [];
  const rawCategoryMap = new Map();
  rawCategories.forEach((category) => {
    if (category && typeof category.key === 'string' && category.key) {
      rawCategoryMap.set(category.key, category);
    }
  });

  const processedKeys = new Set();
  const storageCategories = [];

  STORAGE_CATEGORY_DEFINITIONS.forEach((definition) => {
    const key = definition.key;
    const raw = rawCategoryMap.get(key);
    processedKeys.add(key);
    const label = (raw && typeof raw.label === 'string' && raw.label) || definition.label || key;
    const items =
      key === 'equipment'
        ? list.map((item) => ({ ...item }))
        : (raw && Array.isArray(raw.items) ? raw.items : [])
            .map((item) => decorateStorageInventoryItem(item, key))
            .filter((item) => !!item);
    const used = items.length;
    const slotCount = Math.max(capacity, used);
    const slotsList = items.map((item) => ({ ...item, placeholder: false, storageCategory: key }));
    for (let i = items.length; i < slotCount; i += 1) {
      slotsList.push({ placeholder: true, storageKey: `${key}-placeholder-${i}` });
    }
    const remaining = Math.max(capacity - used, 0);
    const usagePercent = capacity ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
    storageCategories.push({
      key,
      label,
      baseCapacity,
      perUpgrade,
      upgrades: storageLevel,
      capacity: slotCount,
      used,
      remaining,
      usagePercent,
      nextCapacity: capacity + perUpgrade,
      items,
      slots: slotsList
    });
  });

  rawCategories.forEach((category) => {
    if (!category || typeof category !== 'object') {
      return;
    }
    const key = typeof category.key === 'string' ? category.key : '';
    if (!key || processedKeys.has(key)) {
      return;
    }
    const label = typeof category.label === 'string' && category.label ? category.label : key;
    const rawItems = Array.isArray(category.items) ? category.items : [];
    const items = rawItems.map((item) => decorateStorageInventoryItem(item, key)).filter((item) => !!item);
    const used = items.length;
    const slotCount = Math.max(capacity, used);
    const slotsList = items.map((item) => ({ ...item, placeholder: false, storageCategory: key }));
    for (let i = items.length; i < slotCount; i += 1) {
      slotsList.push({ placeholder: true, storageKey: `${key}-placeholder-${i}` });
    }
    const remaining = Math.max(capacity - used, 0);
    const usagePercent = capacity ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
    storageCategories.push({
      key,
      label,
      baseCapacity,
      perUpgrade,
      upgrades: storageLevel,
      capacity: slotCount,
      used,
      remaining,
      usagePercent,
      nextCapacity: capacity + perUpgrade,
      items,
      slots: slotsList
    });
  });
  const totalUsed = storageCategories.reduce((sum, category) => sum + (category.used || 0), 0);
  const clampedUsed = Math.min(totalUsed, capacity);
  const storageMeta = {
    baseCapacity,
    perUpgrade,
    upgrades: storageLevel,
    capacity,
    used: clampedUsed,
    remaining: Math.max(capacity - clampedUsed, 0),
    usagePercent: capacity ? Math.min(100, Math.round((clampedUsed / capacity) * 100)) : 0,
    nextCapacity: capacity + perUpgrade
  };
  if (upgradeAvailable !== null) {
    storageMeta.upgradeAvailable = upgradeAvailable;
  }
  if (upgradeLimit !== null) {
    storageMeta.upgradeLimit = upgradeLimit;
    storageMeta.upgradesRemaining = upgradesRemaining;
  }
  const storagePayload = {
    categories: storageCategories,
    baseCapacity,
    perUpgrade,
    globalUpgrades: storageLevel,
    upgrades: storageLevelMap,
    meta: storageMeta
  };
  if (upgradeAvailable !== null) {
    storagePayload.upgradeAvailable = upgradeAvailable;
  }
  if (upgradeLimit !== null) {
    storagePayload.upgradeLimit = upgradeLimit;
  }
  return {
    slots: slotDetails,
    inventory: list,
    storage: storagePayload,
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
    qualityRank: definition.qualityRank || resolveEquipmentQualityRank(definition.quality),
    iconId: definition.iconId || 0,
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
    drawCount: skills.drawCount || 0,
    drawCredits: Math.max(0, Math.floor(Number(skills.drawCredits) || 0))
  };
}

function decorateSecretRealm(secretRealmState, attributeSummary, options = {}) {
  const normalized = normalizeSecretRealm(secretRealmState || {});
  const highestUnlockedFloor = normalized.highestUnlockedFloor || 1;
  const viewerIsAdmin = !!options.viewerIsAdmin;
  const decoratedFloors = ENEMY_LIBRARY.map((enemy) =>
    decorateEnemy(enemy, attributeSummary, normalized, { viewerIsAdmin })
  );
  const clearedCount = decoratedFloors.filter((floor) => floor.completed).length;
  const nextFloor = decoratedFloors.find((floor) => !floor.completed && !floor.locked);
  const totalFloors = ENEMY_LIBRARY.length;
  const progress = totalFloors > 0 ? Math.min(1, clearedCount / totalFloors) : 0;
  const visibleFloors = resolveVisibleSecretRealmFloors(decoratedFloors);

  return {
    highestUnlockedFloor,
    clearedCount,
    totalFloors,
    progress,
    nextFloorId: nextFloor ? nextFloor.id : '',
    visibleFloors
  };
}

function resolveVisibleSecretRealmFloors(floors) {
  if (!Array.isArray(floors) || floors.length === 0) {
    return [];
  }

  const summaries = [];
  const currentIndex = floors.findIndex((floor) => !floor.completed && !floor.locked);
  if (currentIndex >= 0) {
    const currentSummary = summarizeSecretRealmFloor(floors[currentIndex]);
    if (currentSummary) {
      summaries.push(currentSummary);
    }
    const nextLocked = floors.slice(currentIndex + 1).find((floor) => floor.locked && !floor.completed);
    if (nextLocked) {
      const nextSummary = summarizeSecretRealmFloor(nextLocked);
      if (nextSummary) {
        summaries.push(nextSummary);
      }
    }
    return summaries;
  }

  const upcoming = floors.find((floor) => !floor.completed && floor.locked);
  if (upcoming) {
    const upcomingSummary = summarizeSecretRealmFloor(upcoming);
    if (upcomingSummary) {
      summaries.push(upcomingSummary);
    }
  }

  return summaries;
}

function summarizeSecretRealmFloor(floor) {
  if (!floor) {
    return null;
  }

  return {
    id: floor.id,
    name: floor.name,
    description: floor.description,
    level: floor.level,
    combatPower: floor.combatPower,
    difficulty: floor.difficulty,
    floor: floor.floor,
    floorLabel: floor.floorLabel,
    stageName: floor.stageName,
    stageLabel: floor.stageLabel,
    type: floor.type,
    locked: floor.locked,
    completed: floor.completed,
    statusLabel: floor.statusLabel,
    rewardsText: floor.rewardsText,
    ...(floor.adminEnemyDetails ? { adminEnemyDetails: floor.adminEnemyDetails } : {})
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
  const quality = definition.quality || 'linggan';
  const typeLabel = resolveSkillTypeLabel(definition.type);
  const disciplineLabel = resolveSkillDisciplineLabel(definition.discipline);
  const elementLabel = resolveSkillElementLabel(definition.element);
  const resourceText = formatSkillResource(definition.params || {});
  const imprintText = formatSkillImprintInfo(definition);
  const currentLevel = entry.level || 1;
  const progressionSummary = formatSkillProgression(definition, currentLevel);
  const effectsSummary = formatStatsText(flattened);
  const combinedSummary = [...progressionSummary, ...effectsSummary];
  const highlights = buildSkillHighlights(flattened, definition, progressionSummary, currentLevel);
  return {
    skillId: entry.skillId,
    name: definition.name,
    quality,
    qualityLabel: resolveSkillQualityLabel(quality),
    qualityColor: resolveSkillQualityColor(quality),
    typeLabel,
    disciplineLabel,
    elementLabel,
    description: definition.description,
    level: entry.level || 1,
    maxLevel: resolveSkillMaxLevel(entry.skillId),
    effectsSummary: combinedSummary,
    progressionSummary,
    highlights,
    resourceText,
    imprintText,
    mechanics: Array.isArray(definition.mechanics) ? definition.mechanics : [],
    tags: definition.tags || [],
    obtainedAt: entry.obtainedAt,
    obtainedAtText: formatDateTime(entry.obtainedAt),
    equipped: Array.isArray(profile.skills && profile.skills.equipped)
      ? profile.skills.equipped.includes(entry.skillId)
      : false
  };
}
function decorateEnemy(enemy, attributeSummary, secretRealmState, options = {}) {
  const combatPower = calculateCombatPower(enemy.stats, enemy.special || {});
  const playerPower = calculateCombatPower(attributeSummary.finalStats || {}, attributeSummary.skillSummary || {});
  const difficulty = resolveDifficultyLabel(playerPower, combatPower);
  const rewards = normalizeDungeonRewards(enemy.rewards);
  const floors = secretRealmState && secretRealmState.floors ? secretRealmState.floors : {};
  const floorState = floors[enemy.id] || null;
  let highestUnlockedFloor = ENEMY_LIBRARY.length ? ENEMY_LIBRARY[0].floor : 1;
  if (secretRealmState && secretRealmState.highestUnlockedFloor) {
    highestUnlockedFloor = secretRealmState.highestUnlockedFloor;
  }
  const completed = !!(floorState && floorState.clearedAt);
  const locked = enemy.floor > highestUnlockedFloor;
  const clearedAt = floorState && floorState.clearedAt ? floorState.clearedAt : null;
  const clearedAtText = clearedAt ? formatDateTime(clearedAt) : '';
  const bestRounds = floorState && floorState.bestRounds ? floorState.bestRounds : null;
  const victories = floorState && typeof floorState.victories === 'number' ? floorState.victories : 0;
  const statusLabel = locked ? '未解锁' : completed ? '已通关' : '可挑战';
  const viewerIsAdmin = !!options.viewerIsAdmin;
  const adminEnemyDetails = viewerIsAdmin ? buildEnemyPreviewDetails(enemy) : null;
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
    recommendedPower: combatPower,
    floor: enemy.floor,
    floorLabel: enemy.floorLabel || `第${enemy.floor}层`,
    stageName: enemy.stageName || '',
    stageLabel: enemy.stageLabel || '',
    type: enemy.type || 'normal',
    locked,
    completed,
    statusLabel,
    clearedAt,
    clearedAtText,
    bestRounds,
    victories,
    suggestedRewards: enemy.meta && enemy.meta.suggestedRewards ? enemy.meta.suggestedRewards : null,
    ...(adminEnemyDetails ? { adminEnemyDetails } : {})
  };
}

function buildEnemyPreviewDetails(enemy) {
  if (!enemy || typeof enemy !== 'object') {
    return null;
  }
  const snapshot = captureEnemySnapshot(enemy);
  const entry = snapshot ? { enemySnapshot: snapshot } : {};
  return buildBattleEnemyDetails(entry, enemy);
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
      const quality = definition ? definition.quality : 'linggan';
      return {
        type: 'skill',
        skillId: item.skillId,
        chance: item.chance,
        label: definition ? definition.name : '技能',
        quality,
        qualityLabel: resolveSkillQualityLabel(quality)
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

const ADMIN_ENEMY_ATTRIBUTE_ORDER = [...BASE_ATTRIBUTE_KEYS];

const ADMIN_ENEMY_STAT_ORDER = [
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
  'physicalPenetration',
  'magicPenetration',
  'finalDamageBonus',
  'finalDamageReduction',
  'lifeSteal',
  'healingBonus',
  'healingReduction',
  'controlHit',
  'controlResist',
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

const ADMIN_ENEMY_SPECIAL_LABELS = {
  bonusDamage: '额外伤害',
  shield: '护盾值',
  dodgeChance: '闪避率'
};

function decorateBattleHistory(history, profile, options = {}) {
  if (!Array.isArray(history)) {
    return [];
  }
  const viewerIsAdmin = !!options.viewerIsAdmin;
  return history.map((entry, index) => {
    if (entry.type === 'battle') {
      const enemy = ENEMY_MAP[entry.enemyId] || { name: entry.enemyName || '未知对手' };
      const resultLabel = entry.result === 'win' ? '胜利' : entry.result === 'lose' ? '惜败' : '战斗';
      const adminEnemyDetails = viewerIsAdmin ? buildBattleEnemyDetails(entry, enemy) : null;
      const battleSource = entry.battle && typeof entry.battle === 'object' ? entry.battle : null;
      const participantsSource =
        (entry.participants && typeof entry.participants === 'object' ? entry.participants : null) ||
        (battleSource && typeof battleSource.participants === 'object' ? battleSource.participants : null) ||
        {};
      const participants = participantsSource && typeof participantsSource === 'object' ? participantsSource : {};
      const playerParticipant =
        participants.player ||
        participants.self ||
        participants.attacker ||
        participants.ally ||
        participants.member ||
        null;
      const opponentParticipant =
        participants.opponent ||
        participants.enemy ||
        participants.defender ||
        participants.target ||
        participants.foe ||
        null;
      const playerPortrait = pickPortraitUrl(
        entry.playerPortrait,
        playerParticipant && playerParticipant.portrait,
        playerParticipant && playerParticipant.avatarPortrait,
        playerParticipant && playerParticipant.avatarUrl,
        playerParticipant && playerParticipant.avatar,
        profile && profile.portrait,
        profile && profile.avatarPortrait,
        profile && profile.avatarUrl,
        profile && profile.avatar
      );
      const opponentPortrait = pickPortraitUrl(
        entry.opponentPortrait,
        opponentParticipant && opponentParticipant.portrait,
        opponentParticipant && opponentParticipant.avatarPortrait,
        opponentParticipant && opponentParticipant.avatarUrl,
        opponentParticipant && opponentParticipant.avatar,
        enemy && enemy.portrait,
        enemy && enemy.avatarPortrait,
        enemy && enemy.avatarUrl,
        enemy && enemy.avatar,
        enemy && enemy.image
      );
      const playerAvatarUrl =
        (playerParticipant && (playerParticipant.avatarUrl || playerParticipant.avatar)) ||
        entry.playerAvatarUrl ||
        entry.playerAvatar ||
        (profile && (profile.avatarUrl || profile.avatar)) ||
        '';
      const opponentAvatarUrl =
        (opponentParticipant && (opponentParticipant.avatarUrl || opponentParticipant.avatar)) ||
        entry.opponentAvatarUrl ||
        entry.opponentAvatar ||
        (enemy && (enemy.avatarUrl || enemy.avatar)) ||
        '';
      const logSource = Array.isArray(entry.log)
        ? entry.log
        : battleSource && Array.isArray(battleSource.log)
        ? battleSource.log
        : [];
      const rawTimeline = Array.isArray(entry.timeline)
        ? entry.timeline
        : battleSource && Array.isArray(battleSource.timeline)
        ? battleSource.timeline
        : [];
      const timeline = rawTimeline.filter((item) => item && typeof item === 'object');
      const archiveId = entry.battleArchiveId || (battleSource && battleSource.archiveId) || null;
      const metadataSource =
        (entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null) ||
        (battleSource && typeof battleSource.metadata === 'object' ? battleSource.metadata : null) ||
        null;
      const metadata = metadataSource ? { ...metadataSource } : { mode: 'pve' };
      if (!metadata.mode) {
        metadata.mode = 'pve';
      }
      const outcome = entry.outcome || (battleSource && battleSource.outcome) || null;
      const rewards = entry.rewards || (battleSource && battleSource.rewards) || null;
      const combatPower = entry.combatPower || (battleSource && battleSource.combatPower) || null;
      const remaining = entry.remaining || (battleSource && battleSource.remaining) || null;
      const rounds = entry.rounds || (battleSource && battleSource.rounds) || null;
      const victory =
        typeof entry.victory === 'boolean'
          ? entry.victory
          : battleSource && typeof battleSource.victory === 'boolean'
          ? battleSource.victory
          : entry.result === 'win';
      const draw =
        typeof entry.draw === 'boolean'
          ? entry.draw
          : battleSource && typeof battleSource.draw === 'boolean'
          ? battleSource.draw
          : entry.result === 'draw';

      let battlePreview = null;
      if (battleSource) {
        battlePreview = { ...battleSource };
        battlePreview.archiveId = archiveId;
        if (!battlePreview.metadata) {
          battlePreview.metadata = metadata;
        } else if (!battlePreview.metadata.mode) {
          battlePreview.metadata = { ...battlePreview.metadata, mode: 'pve' };
        }
        if (!battlePreview.participants && Object.keys(participants).length) {
          battlePreview.participants = participants;
        }
        if (!battlePreview.outcome && outcome) {
          battlePreview.outcome = outcome;
        }
        if (!battlePreview.rewards && rewards) {
          battlePreview.rewards = rewards;
        }
        if (!battlePreview.combatPower && combatPower) {
          battlePreview.combatPower = combatPower;
        }
        if (!battlePreview.remaining && remaining) {
          battlePreview.remaining = remaining;
        }
        if (typeof battlePreview.victory !== 'boolean') {
          battlePreview.victory = victory;
        }
        if (typeof battlePreview.draw !== 'boolean') {
          battlePreview.draw = draw;
        }
        if (!Array.isArray(battlePreview.timeline) || !battlePreview.timeline.length) {
          delete battlePreview.timeline;
        }
      } else if (archiveId) {
        battlePreview = {
          archiveId,
          metadata,
          participants,
          outcome,
          rewards,
          combatPower,
          remaining,
          rounds,
          victory,
          draw
        };
      }

      const replayAvailable = timeline.length > 0 || logSource.length > 0 || !!archiveId;

      return {
        type: 'battle',
        id: entry.id || entry.createdAt || `${entry.enemyId || 'battle'}-${index}`,
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        enemyId: entry.enemyId,
        enemyName: enemy.name,
        result: entry.result,
        resultLabel,
        summary: `${resultLabel} · ${enemy.name}`,
        rewards,
        rewardsText: formatRewardText(rewards),
        rounds,
        combatPower,
        log: logSource,
        timeline,
        participants: Object.keys(participants).length ? participants : null,
        playerPortrait: playerPortrait || '',
        opponentPortrait: opponentPortrait || '',
        playerAvatarUrl,
        opponentAvatarUrl,
        playerName:
          entry.playerName ||
          (playerParticipant && (playerParticipant.displayName || playerParticipant.name)) ||
          (profile && (profile.displayName || profile.nickname || profile.nickName)) ||
          '你',
        opponentName:
          entry.opponentName ||
          (opponentParticipant && (opponentParticipant.displayName || opponentParticipant.name)) ||
          enemy.name,
        ...(archiveId ? { battleArchiveId: archiveId } : {}),
        ...(battlePreview ? { battle: battlePreview } : {}),
        replayAvailable,
        ...(adminEnemyDetails ? { adminEnemyDetails } : {})
      };
    }
    if (entry.type === 'allocate') {
      return {
        type: 'allocate',
        id: entry.id || entry.createdAt || `allocate-${index}`,
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
        id: entry.id || entry.createdAt || `equipment-${index}`,
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
        id: entry.id || entry.createdAt || `consumable-${index}`,
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
        id: entry.id || entry.createdAt || `respec-${index}`,
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        detail,
        summary
      };
    }
    return {
      ...entry,
      id: entry.id || entry.createdAt || `${entry.type || 'history'}-${index}`,
      createdAtText: formatDateTime(entry.createdAt)
    };
  });
}

function captureEnemySnapshot(enemy = {}) {
  if (!enemy || typeof enemy !== 'object') {
    return null;
  }
  const snapshot = {};
  if (enemy.id) {
    snapshot.id = enemy.id;
  }
  if (enemy.type) {
    snapshot.type = enemy.type;
  }
  if (enemy.stageName) {
    snapshot.stageName = enemy.stageName;
  }
  if (enemy.realmName) {
    snapshot.realmName = enemy.realmName;
  }
  if (enemy.realmShort) {
    snapshot.realmShort = enemy.realmShort;
  }
  if (enemy.archetype) {
    snapshot.archetype = enemy.archetype;
  }
  if (enemy.floor != null) {
    const floor = normalizePositiveInteger(enemy.floor);
    if (floor) {
      snapshot.floor = floor;
    }
  }
  if (enemy.level != null) {
    const level = normalizePositiveInteger(enemy.level);
    if (level) {
      snapshot.level = level;
    }
  }
  const attributes = sanitizeNumericRecord(enemy.attributes || enemy.baseAttributes);
  if (attributes && Object.keys(attributes).length) {
    snapshot.attributes = attributes;
  }
  const stats = sanitizeNumericRecord(enemy.stats);
  if (stats && Object.keys(stats).length) {
    snapshot.stats = stats;
  }
  const special = sanitizeNumericRecord(enemy.special);
  if (special && Object.keys(special).length) {
    snapshot.special = special;
  }
  const skills = sanitizeSkillList(collectSkillList(enemy));
  if (skills.length) {
    snapshot.skills = skills;
  }
  return Object.keys(snapshot).length ? snapshot : null;
}

function buildBattleEnemyDetails(entry, fallbackEnemy = {}) {
  const snapshot = (entry && entry.enemySnapshot) || {};
  const statsSource = snapshot.stats || entry.enemyStats || null;
  const specialSource = snapshot.special || entry.enemySpecial || null;
  const stats = sanitizeNumericRecord(statsSource);
  const special = sanitizeNumericRecord(specialSource);
  const baseAttributes = resolveEnemyAttributesFromSources(snapshot, entry, fallbackEnemy);
  const skillIds = resolveEnemySkillsFromSources(snapshot, entry, fallbackEnemy);
  const skillDetails = skillIds
    .map((skillId) => buildEnemySkillDetails(skillId))
    .filter((detail) => detail);
  const meta = [];

  const stageName = entry.enemyStageName || snapshot.stageName || fallbackEnemy.stageName || '';
  const realmName = entry.enemyRealmName || snapshot.realmName || fallbackEnemy.realmName || '';
  const type = entry.enemyType || snapshot.type || fallbackEnemy.type || '';
  const floor = normalizePositiveInteger(
    snapshot.floor != null ? snapshot.floor : entry.enemyFloor != null ? entry.enemyFloor : fallbackEnemy.floor
  );
  const level = normalizePositiveInteger(
    snapshot.level != null ? snapshot.level : entry.enemyLevel != null ? entry.enemyLevel : fallbackEnemy.level
  );
  const archetypeKey = entry.enemyArchetype || snapshot.archetype || fallbackEnemy.archetype || '';
  const archetype = archetypeKey ? SECRET_REALM_ARCHETYPE_LABELS[archetypeKey] || '' : '';

  if (realmName) {
    meta.push({ label: '秘境', value: realmName });
  }
  if (stageName) {
    meta.push({ label: '关卡', value: stageName });
  }
  if (floor) {
    meta.push({ label: '层数', value: `第${floor}层` });
  }
  if (level) {
    meta.push({ label: '等级', value: `${level}` });
  }
  if (type) {
    const typeLabel = type === 'boss' ? '首领' : '普通';
    meta.push({ label: '类型', value: typeLabel });
  }
  if (archetype) {
    meta.push({ label: '流派', value: archetype });
  }

  const entries = [];
  const attributeSeen = new Set();
  const statSeen = new Set();

  const pushAttribute = (key, value) => {
    if (value == null || attributeSeen.has(key)) {
      return;
    }
    const label = resolveAttributeLabel(key);
    entries.push({
      key: `attribute-${key}`,
      label,
      value: formatEnemyAttributeValue(value),
      type: 'attribute'
    });
    attributeSeen.add(key);
  };

  if (baseAttributes) {
    ADMIN_ENEMY_ATTRIBUTE_ORDER.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(baseAttributes, key)) {
        pushAttribute(key, baseAttributes[key]);
      }
    });
  }

  const pushStat = (key, value) => {
    if (value == null || value === 0 || statSeen.has(key)) {
      return;
    }
    const label = resolveCombatStatLabel(key);
    entries.push({
      key,
      label,
      value: formatStatDisplay(key, value),
      type: 'stat'
    });
    statSeen.add(key);
  };

  ADMIN_ENEMY_STAT_ORDER.forEach((key) => {
    if (stats && Object.prototype.hasOwnProperty.call(stats, key)) {
      pushStat(key, stats[key]);
    }
  });

  if (stats) {
    Object.keys(stats)
      .sort()
      .forEach((key) => {
        if (!statSeen.has(key)) {
          pushStat(key, stats[key]);
        }
      });
  }

  if (special) {
    Object.keys(special).forEach((key) => {
      const raw = special[key];
      if (raw == null || raw === 0) {
        return;
      }
      if (key.endsWith('Multiplier')) {
        const target = key.replace('Multiplier', '');
        const label = resolveCombatStatLabel(target);
        const value = `${Math.round(raw * 10000) / 100}%`;
        entries.push({ key: `special-${key}`, label, value: `+${value}`, type: 'special' });
        return;
      }
      const label = ADMIN_ENEMY_SPECIAL_LABELS[key] || resolveCombatStatLabel(key);
      const value = formatEnemySpecialValue(key, raw);
      if (value) {
        entries.push({ key: `special-${key}`, label, value, type: 'special' });
      }
    });
  }

  if (!entries.length && !meta.length && !skillDetails.length) {
    return null;
  }

  return {
    meta,
    entries,
    ...(skillDetails.length ? { skills: skillDetails } : {})
  };
}

function resolveEnemyAttributesFromSources(snapshot = {}, entry = {}, fallbackEnemy = {}) {
  const candidate =
    (snapshot && (snapshot.attributes || snapshot.baseAttributes)) ||
    (entry && entry.enemyAttributes) ||
    fallbackEnemy.attributes ||
    fallbackEnemy.baseAttributes ||
    null;
  const attributes = sanitizeNumericRecord(candidate);
  if (attributes && Object.keys(attributes).length) {
    return attributes;
  }

  const statsSource =
    (snapshot && snapshot.stats) ||
    (entry && entry.enemyStats) ||
    fallbackEnemy.stats ||
    null;
  let levelSource = 1;
  if (snapshot && snapshot.level != null) {
    levelSource = snapshot.level;
  } else if (entry && entry.enemyLevel != null) {
    levelSource = entry.enemyLevel;
  } else if (fallbackEnemy && fallbackEnemy.level != null) {
    levelSource = fallbackEnemy.level;
  }
  return deriveEnemyAttributesFromStats(statsSource, levelSource);
}

function resolveEnemySkillsFromSources(snapshot = {}, entry = {}, fallbackEnemy = {}) {
  const sets = [
    collectSkillList(snapshot),
    collectSkillList(entry),
    collectSkillList((entry && entry.detail) || {}),
    collectSkillList(fallbackEnemy)
  ];
  const seen = new Set();
  const skills = [];
  sets.forEach((list) => {
    const normalized = sanitizeSkillList(list);
    normalized.forEach((skillId) => {
      if (!seen.has(skillId)) {
        seen.add(skillId);
        skills.push(skillId);
      }
    });
  });
  return skills;
}

function collectSkillList(source) {
  if (!source || typeof source !== 'object') {
    return [];
  }
  const keys = ['skills', 'skillIds', 'skillIdList', 'skillLoadout', 'enemySkills', 'enemySkillIds'];
  for (let i = 0; i < keys.length; i += 1) {
    const value = source[keys[i]];
    if (Array.isArray(value) && value.length) {
      return value;
    }
  }
  return [];
}

function buildEnemySkillDetails(skillId) {
  if (!skillId) {
    return null;
  }
  const definition = SKILL_MAP[skillId];
  if (!definition) {
    return {
      id: skillId,
      name: `未知技能（${skillId}）`,
      meta: '',
      description: '',
      highlights: []
    };
  }
  const qualityLabel = resolveSkillQualityLabel(definition.quality || 'linggan');
  const typeLabel = resolveSkillTypeLabel(definition.type || 'active');
  const disciplineLabel = resolveSkillDisciplineLabel(definition.discipline);
  const elementLabel = resolveSkillElementLabel(definition.element);
  const resourceText = formatSkillResource(definition.params || {});
  const metaParts = [];
  if (qualityLabel) {
    metaParts.push(qualityLabel);
  }
  if (typeLabel) {
    metaParts.push(typeLabel);
  }
  if (disciplineLabel) {
    metaParts.push(disciplineLabel);
  }
  if (elementLabel && elementLabel !== '无属性') {
    metaParts.push(elementLabel);
  }
  if (resourceText) {
    metaParts.push(resourceText);
  }
  const highlights = buildSkillHighlights(
    null,
    definition,
    formatSkillProgression(definition, 1),
    1
  );
  return {
    id: definition.id,
    name: definition.name || definition.id,
    meta: metaParts.join(' · '),
    description: definition.description || '',
    highlights
  };
}

function formatEnemyAttributeValue(value) {
  if (!Number.isFinite(Number(value))) {
    return '';
  }
  return `${Math.max(0, Math.round(Number(value)))}`;
}

function formatEnemySpecialValue(key, value) {
  if (value == null) {
    return '';
  }
  if (key === 'dodgeChance') {
    return `+${Math.round(value * 10000) / 100}%`;
  }
  return `+${Math.round(value)}`;
}

function sanitizeNumericRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  return Object.keys(record).reduce((acc, key) => {
    const value = Number(record[key]);
    if (Number.isFinite(value)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function sanitizeSkillList(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  list.forEach((entry) => {
    let skillId = '';
    if (typeof entry === 'string') {
      skillId = entry.trim();
    } else if (entry && typeof entry.skillId === 'string') {
      skillId = entry.skillId.trim();
    } else if (entry && typeof entry.id === 'string') {
      skillId = entry.id.trim();
    }
    if (!skillId || seen.has(skillId)) {
      return;
    }
    seen.add(skillId);
    normalized.push(skillId);
  });
  return normalized;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    const normalized = Math.max(0, Math.floor(number));
    return normalized > 0 ? normalized : null;
  }
  return null;
}

function decorateSkillHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((entry) => {
    if (entry.type === 'draw') {
      const detail = entry.detail || {};
      const skill = SKILL_MAP[detail.skillId] || { name: '未知技能', quality: 'linggan' };
      const quality = detail.quality || detail.rarity || skill.quality || 'linggan';
      return {
        type: 'draw',
        createdAt: entry.createdAt,
        createdAtText: formatDateTime(entry.createdAt),
        summary: `${detail.isNew ? '获得' : '升阶'}：${skill.name}（${resolveSkillQualityLabel(quality)}）`,
        detail: { ...detail, quality }
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

function decorateSkillQualityConfig() {
  return Object.keys(SKILL_QUALITY_CONFIG).map((key) => ({
    key,
    label: SKILL_QUALITY_CONFIG[key].label,
    color: SKILL_QUALITY_CONFIG[key].color,
    weight: SKILL_QUALITY_CONFIG[key].weight
  }));
}

function formatSkillResource(params = {}) {
  if (!params || typeof params !== 'object') {
    return '';
  }
  const parts = [];
  if (params.cooldown != null) {
    parts.push(`冷却${params.cooldown}回合`);
  }
  if (params.interval != null) {
    parts.push(`间隔${params.interval}回合`);
  }
  if (params.cost != null) {
    parts.push(`真气${params.cost}`);
  }
  if (params.range) {
    parts.push(params.range);
  }
  if (params.target && params.target !== params.range) {
    parts.push(params.target);
  }
  if (params.castTime) {
    parts.push(params.castTime);
  }
  return parts.join(' · ');
}

function formatSkillImprintInfo(definition = {}) {
  const qualityConfig = SKILL_QUALITY_CONFIG[definition.quality];
  const slots = Array.isArray(definition.imprintSlots) && definition.imprintSlots.length
    ? definition.imprintSlots
    : qualityConfig && Array.isArray(qualityConfig.imprintSlots)
    ? qualityConfig.imprintSlots
    : [];
  if (!slots.length) {
    return '';
  }
  const parts = slots.map((slot) => {
    const unlock = slot.unlockLevel != null ? `${slot.unlockLevel}级` : '解锁';
    const suffix = slot.breakthrough ? '突破后' : '';
    const slotLabel = slot.count != null ? `第${slot.count}槽` : '槽位';
    const exclusive = slot.exclusive ? '（专属）' : '';
    return `${unlock}${suffix}解锁${slotLabel}${exclusive}`;
  });
  return `印记槽：${parts.join('，')}`;
}

const SKILL_STAT_CATEGORY_KEY_MAP = {
  bonusDamage: 'damage',
  finalDamageBonus: 'damage',
  finalDamageReduction: 'defense',
  shield: 'shield',
  shieldPower: 'shield',
  shieldMultiplier: 'shield',
  maxHp: 'sustain',
  maxHpMultiplier: 'sustain',
  physicalAttack: 'damage',
  physicalAttackMultiplier: 'damage',
  magicAttack: 'damage',
  magicAttackMultiplier: 'damage',
  physicalDefense: 'defense',
  physicalDefenseMultiplier: 'defense',
  magicDefense: 'defense',
  magicDefenseMultiplier: 'defense',
  speed: 'buff',
  speedMultiplier: 'buff',
  accuracy: 'buff',
  accuracyMultiplier: 'buff',
  dodge: 'evasion',
  dodgeMultiplier: 'evasion',
  dodgeChance: 'evasion',
  critRate: 'crit',
  critRateMultiplier: 'crit',
  critDamage: 'crit',
  critDamageMultiplier: 'crit',
  critResist: 'defense',
  critResistMultiplier: 'defense',
  physicalPenetration: 'damage',
  magicPenetration: 'damage',
  comboRate: 'buff',
  block: 'defense',
  counterRate: 'reflect',
  damageReduction: 'defense',
  healingReceived: 'sustain',
  lifeSteal: 'sustain',
  healOnHit: 'sustain',
  healOnKill: 'sustain',
  healPerRound: 'sustain',
  healOnTrigger: 'sustain',
  healingBonus: 'heal',
  healingReduction: 'debuff',
  controlHit: 'control',
  controlResist: 'defense',
  controlStrength: 'control',
  rageGain: 'resource',
  summonPower: 'support',
  elementalVulnerability: 'debuff'
};

function prefixHighlight(text, label) {
  if (typeof text !== 'string') {
    return '';
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (!label || trimmed.startsWith('【')) {
    return trimmed;
  }
  return `【${label}】${trimmed}`;
}

function buildSkillHighlights(flattened, definition = {}, progression = [], level = 1) {
  const highlights = [];
  const levelValue = Math.max(1, Math.floor(Number(level) || 1));
  const dynamicHighlights = buildSkillHighlightSummaries(definition, levelValue);
  if (Array.isArray(definition.mechanics)) {
    definition.mechanics.forEach((item) => {
      const entry = typeof item === 'string' ? item : '';
      if (entry) {
        highlights.push(entry);
      }
    });
  } else if (typeof definition.mechanics === 'string' && definition.mechanics) {
    highlights.push(definition.mechanics);
  }
  if (dynamicHighlights.length) {
    highlights.push(...dynamicHighlights);
  } else if (Array.isArray(progression) && progression.length) {
    highlights.push(...progression);
  }
  const statsText = formatStatsText(flattened);
  if (statsText.length) {
    highlights.push(...statsText);
  }
  if (definition.growth) {
    if (Array.isArray(definition.growth)) {
      definition.growth.forEach((item) => {
        const entry = typeof item === 'string' ? item : '';
        if (entry) {
          highlights.push(prefixHighlight(entry, '成长'));
        }
      });
    } else if (typeof definition.growth === 'string') {
      highlights.push(prefixHighlight(definition.growth, '成长'));
    }
  }
  if (definition.synergy) {
    if (Array.isArray(definition.synergy)) {
      definition.synergy.forEach((item) => {
        const entry = typeof item === 'string' ? item : '';
        if (entry) {
          highlights.push(prefixHighlight(entry, '协同'));
        }
      });
    } else if (typeof definition.synergy === 'string') {
      highlights.push(prefixHighlight(definition.synergy, '协同'));
    }
  }
  return highlights.filter((text, index, list) => typeof text === 'string' && text && list.indexOf(text) === index);
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
    let text = '';
    let categoryKey = key;
    if (key === 'bonusDamage') {
      text = `额外伤害 +${Math.round(value)}`;
      categoryKey = 'bonusDamage';
    } else if (key === 'shield') {
      text = `护盾 +${Math.round(value)}`;
      categoryKey = 'shield';
    } else if (key === 'dodgeChance') {
      text = `闪避率 +${Math.round(value * 100)}%`;
      categoryKey = 'dodgeChance';
    } else if (key.endsWith('Multiplier')) {
      const target = key.replace('Multiplier', '');
      const label = resolveAttributeLabel(target);
      text = `${label} +${Math.round(value * 10000) / 100}%`;
      categoryKey = target;
    } else {
      const label = resolveAttributeLabel(key);
      text = `${label} ${formatStatDisplay(key, value, true)}`;
    }
    if (!text) {
      return;
    }
    const mappedCategory = SKILL_STAT_CATEGORY_KEY_MAP[categoryKey];
    const baseCategory = BASE_ATTRIBUTE_KEYS.includes(categoryKey) ? 'attribute' : '';
    const label =
      SKILL_HIGHLIGHT_CATEGORY_LABELS[mappedCategory] ||
      (baseCategory ? SKILL_HIGHLIGHT_CATEGORY_LABELS[baseCategory] || '属性' : '');
    texts.push(prefixHighlight(text, label));
  });
  return texts;
}
function buildBattleSetup(profile, enemy, member) {
  const attributes =
    (profile && typeof profile.attributeSummary === 'object' && profile.attributeSummary) ||
    calculateAttributes(profile.attributes, profile.equipment, profile.skills);
  if (profile && typeof profile === 'object' && profile.attributeSummary !== attributes) {
    profile.attributeSummary = attributes;
  }
  const player = createPlayerCombatant(attributes);
  const enemyCombatant = createEnemyCombatant(enemy);
  const playerInfo = buildPlayerBattleInfo(profile, member, attributes, player);
  const enemyInfo = buildEnemyBattleInfo(enemy, enemyCombatant);
  const playerSkills = buildRuntimeSkillLoadout(profile.skills || {}, { includeBasic: true });
  const enemySkills = buildRuntimeSkillLoadout({ equipped: enemy && Array.isArray(enemy.skills) ? enemy.skills : [] }, {
    includeBasic: true
  });
  return {
    player,
    enemy: enemyCombatant,
    attributes,
    playerInfo,
    enemyInfo,
    playerSkills,
    enemySkills
  };
}

function resolveAvatarFrameValue(...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const value = normalizeAvatarFrameValue(candidates[i] || '');
    if (value) {
      return value;
    }
  }
  return '';
}

function buildPlayerBattleInfo(profile, member, attributes, combatant) {
  const memberIdCandidates = [
    profile && profile.memberId,
    profile && profile.id,
    profile && profile.member && profile.member._id,
    member && member._id,
    member && member.id,
    member && member.openid,
    member && member.openId
  ];
  const displayNameCandidates = [
    profile && profile.displayName,
    profile && profile.nickname,
    profile && profile.nickName,
    member && member.nickName,
    member && member.nickname,
    member && member.name
  ];
  let resolvedId = 'player';
  memberIdCandidates.forEach((candidate) => {
    if (resolvedId !== 'player') {
      return;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      resolvedId = candidate.trim();
    }
  });
  let displayName = '你';
  displayNameCandidates.forEach((candidate) => {
    if (displayName !== '你') {
      return;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      displayName = candidate.trim();
    }
  });
  const portrait = pickPortraitUrl(
    profile && profile.portrait,
    profile && profile.avatarPortrait,
    profile && profile.avatar,
    profile && profile.avatarUrl,
    member && member.portrait,
    member && member.avatarPortrait,
    member && member.avatar,
    member && member.avatarUrl
  );
  const avatarUrl =
    (profile && (profile.avatarUrl || profile.avatar)) ||
    (member && (member.avatarUrl || member.avatar)) ||
    '';
  const avatarFrame = resolveAvatarFrameValue(
    profile && profile.avatarFrame,
    profile && profile.appearance && profile.appearance.avatarFrame,
    member && member.avatarFrame,
    member && member.appearanceFrame
  );
  const hpSnapshot = buildParticipantHpSnapshot(
    combatant.stats,
    combatant.special,
    attributes && attributes.finalStats
  );
  return {
    id: resolvedId,
    displayName,
    portrait,
    avatarUrl,
    ...(avatarFrame ? { avatarFrame } : {}),
    level: attributes.level,
    realmId: attributes.realmId,
    realmName: attributes.realmName,
    realmShort: attributes.realmShort,
    combatPower: attributes.combatPower,
    hp: hpSnapshot
  };
}

function buildEnemyBattleInfo(enemy, combatant) {
  const idCandidates = [enemy && enemy.id, enemy && enemy.enemyId, enemy && enemy._id];
  let resolvedId = 'opponent';
  idCandidates.forEach((candidate) => {
    if (resolvedId !== 'opponent') {
      return;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      resolvedId = candidate.trim();
    }
  });
  const displayName =
    (enemy && (enemy.displayName || enemy.name || enemy.stageName || enemy.realmName)) || '敌方';
  const portrait = pickPortraitUrl(
    enemy && enemy.portrait,
    enemy && enemy.avatarPortrait,
    enemy && enemy.avatar,
    enemy && enemy.avatarUrl,
    enemy && enemy.image
  );
  const avatarUrl =
    (enemy && (enemy.avatarUrl || enemy.avatar)) ||
    '';
  const avatarFrame = resolveAvatarFrameValue(
    enemy && enemy.avatarFrame,
    enemy && enemy.appearanceFrame,
    enemy && enemy.frame,
    enemy && enemy.avatarBorder
  );
  const hpSnapshot = buildParticipantHpSnapshot(combatant.stats, combatant.special, enemy && enemy.stats);
  return {
    id: resolvedId,
    displayName,
    portrait,
    avatarUrl,
    ...(avatarFrame ? { avatarFrame } : {}),
    level: enemy && enemy.level,
    realmId: enemy && enemy.realmId,
    realmName: enemy && enemy.realmName,
    realmShort: enemy && enemy.realmShort,
    combatPower: calculateCombatPower(combatant.stats, combatant.special),
    hp: hpSnapshot
  };
}

function buildParticipantHpSnapshot(stats = {}, special = {}, sourceStats = {}) {
  const maxHp = Math.max(0, Math.round(Number(stats.maxHp || sourceStats.maxHp || 0)));
  const shield = Math.max(0, Math.round(Number(special.shield || sourceStats.shield || 0)));
  const current = Math.max(0, Math.round(maxHp));
  const payload = { current, max: maxHp };
  if (shield > 0) {
    payload.shield = shield;
  }
  return payload;
}

function runBattleSimulation({
  player,
  enemy,
  attributes,
  playerInfo = {},
  enemyInfo = {},
  playerSkills = [],
  enemySkills = []
}) {
  const log = [];
  const timeline = [];
  const playerStats = player.stats;
  const enemyStats = enemy.stats;
  const playerSpecial = player.special || {};
  const enemySpecial = enemy.special || {};
  const playerAttributesSnapshot = buildCombatAttributesSnapshot(playerStats);
  const enemyAttributesSnapshot = buildCombatAttributesSnapshot(enemyStats);
  const playerId = (playerInfo && playerInfo.id) || 'player';
  const enemyId = (enemyInfo && enemyInfo.id) || 'opponent';
  const playerName = (playerInfo && playerInfo.displayName) || '你';
  const enemyName = (enemyInfo && enemyInfo.displayName) || '敌方';

  const playerActor = createActorRuntime({
    id: playerId,
    name: playerName,
    side: 'player',
    combatant: { stats: playerStats, special: playerSpecial },
    skills: playerSkills,
    mode: 'pve'
  });
  const enemyActor = createActorRuntime({
    id: enemyId,
    name: enemyName,
    side: 'opponent',
    combatant: { stats: enemyStats, special: enemySpecial },
    skills: enemySkills,
    mode: 'pve'
  });

  const playerMaxHp = playerActor.maxHp;
  const enemyMaxHp = enemyActor.maxHp;

  const participants = {
    player: {
      id: playerId,
      displayName: playerName,
      portrait: playerInfo.portrait || '',
      avatarUrl: playerInfo.avatarUrl || '',
      maxHp: Math.round(playerMaxHp),
      hp: {
        current: Math.max(0, Math.round(Math.min(playerActor.hp, playerMaxHp))),
        max: Math.round(playerMaxHp),
        ...(playerActor.hp > playerMaxHp ? { shield: Math.round(playerActor.hp - playerMaxHp) } : {})
      },
      combatPower: attributes.combatPower,
      ...(playerInfo.avatarFrame ? { avatarFrame: playerInfo.avatarFrame } : {}),
      attributes: { ...playerAttributesSnapshot }
    },
    opponent: {
      id: enemyId,
      displayName: enemyName,
      portrait: enemyInfo.portrait || '',
      avatarUrl: enemyInfo.avatarUrl || '',
      ...(enemyInfo.avatarFrame ? { avatarFrame: enemyInfo.avatarFrame } : {}),
      maxHp: Math.round(enemyMaxHp),
      hp: {
        current: Math.max(0, Math.round(Math.min(enemyActor.hp, enemyMaxHp))),
        max: Math.round(enemyMaxHp),
        ...(enemyActor.hp > enemyMaxHp ? { shield: Math.round(enemyActor.hp - enemyMaxHp) } : {})
      },
      combatPower: calculateCombatPower(enemyStats, enemySpecial),
      attributes: { ...enemyAttributesSnapshot }
    }
  };

  let previousPlayerAttributesSnapshot = null;
  let previousEnemyAttributesSnapshot = null;
  let round = 1;
  const maxRounds = 20;

  while (playerActor.hp > 0 && enemyActor.hp > 0 && round <= maxRounds) {
    const { order: roundOrder } = determineRoundOrder(playerActor, enemyActor, {
      playerKey: 'player',
      opponentKey: 'enemy',
      fallbackFirst: 'player'
    });
    let sequence = 1;

    for (let i = 0; i < roundOrder.length; i += 1) {
      if (playerActor.hp <= 0 || enemyActor.hp <= 0) {
        break;
      }
      const attackerKey = roundOrder[i];
      const currentActor = attackerKey === 'player' ? playerActor : enemyActor;
      const defender = currentActor === playerActor ? enemyActor : playerActor;
      const beforeState = { player: playerActor.hp, enemy: enemyActor.hp };
      const beforeControl = {
        player: captureControlSnapshot(playerActor),
        opponent: captureControlSnapshot(enemyActor)
      };
      const turnResult = executeSkillTurn({ actor: currentActor, opponent: defender });
      const afterState = { player: playerActor.hp, enemy: enemyActor.hp };
      const afterControl = {
        player: captureControlSnapshot(playerActor),
        opponent: captureControlSnapshot(enemyActor)
      };
      const events = [];
      if (Array.isArray(turnResult.preEvents) && turnResult.preEvents.length) {
        events.push(...turnResult.preEvents);
      }
      if (Array.isArray(turnResult.events) && turnResult.events.length) {
        events.push(...turnResult.events);
      }
      const summaryParts = Array.isArray(turnResult.summary) ? turnResult.summary : [];
      const summaryText = summaryParts.length
        ? summaryParts.join('；')
        : `第${round}回合：${currentActor.name}发起了动作`;
      log.push(summaryText);

      const entry = buildTimelineEntry({
        round,
        sequence,
        actorId: currentActor.id,
        actorName: currentActor.name,
        actorSide: currentActor.side,
        targetId: defender.id,
        targetName: defender.name,
        events,
        skill: turnResult.skill,
        before: beforeState,
        after: afterState,
        playerMaxHp,
        enemyMaxHp,
        playerAttributesSnapshot,
        enemyAttributesSnapshot,
        previousAttributes: {
          player: previousPlayerAttributesSnapshot,
          opponent: previousEnemyAttributesSnapshot
        },
        controlBefore: beforeControl,
        controlAfter: afterControl,
        summaryText
      });
      timeline.push(entry);
      previousPlayerAttributesSnapshot = playerAttributesSnapshot ? { ...playerAttributesSnapshot } : null;
      previousEnemyAttributesSnapshot = enemyAttributesSnapshot ? { ...enemyAttributesSnapshot } : null;

      sequence += 1;
    }

    if (playerActor.hp <= 0 || enemyActor.hp <= 0) {
      break;
    }

    round += 1;
  }

  const timeout = round > maxRounds && playerActor.hp > 0 && enemyActor.hp > 0;
  if (timeout) {
    log.push(`第${maxRounds}回合后仍未击败敌人，秘境挑战失败`);
  }

  const victory = enemyActor.hp <= 0 && playerActor.hp > 0;
  const draw = !victory && !timeout && playerActor.hp > 0 && enemyActor.hp > 0;

  const rewards = calculateBattleRewards(attributes, enemy.meta || enemy, { victory, draw });
  const roundsCompleted = Math.min(round, maxRounds);
  const outcome = buildBattleOutcome({
    victory,
    draw,
    rounds: roundsCompleted,
    rewards,
    playerId,
    enemyId,
    playerName,
    enemyName,
    remaining: {
      playerHp: Math.max(0, Math.round(playerActor.hp)),
      enemyHp: Math.max(0, Math.round(enemyActor.hp))
    }
  });
  const metadata = {
    mode: 'pve',
    generatedAt: Date.now()
  };

  return {
    victory,
    draw,
    rounds: roundsCompleted,
    log,
    rewards,
    remaining: outcome.remaining,
    combatPower: {
      player: attributes.combatPower,
      enemy: calculateCombatPower(enemyStats, enemySpecial)
    },
    timeline,
    participants,
    outcome,
    metadata
  };
}

function buildBattleOutcome({ victory, draw, rounds, rewards, playerId, enemyId, playerName, enemyName, remaining }) {
  const result = victory ? 'victory' : draw ? 'draw' : 'defeat';
  const winnerId = victory ? playerId : draw ? null : enemyId;
  const loserId = victory ? enemyId : draw ? null : playerId;
  const summaryText =
    result === 'victory'
      ? `你击败了${enemyName}。`
      : result === 'defeat'
      ? `${enemyName} 击败了你。`
      : `与 ${enemyName} 的对决以平局收场。`;
  return {
    winnerId,
    loserId,
    result,
    rounds,
    rewards: { ...rewards },
    summary: {
      title: result === 'victory' ? '战斗结果 · 胜利' : result === 'defeat' ? '战斗结果 · 惜败' : '战斗结果 · 平局',
      text: summaryText
    },
    remaining
  };
}

function buildCombatAttributesSnapshot(stats = {}) {
  const keys = [
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
  const snapshot = {};
  keys.forEach((key) => {
    if (typeof stats[key] === 'number' && !Number.isNaN(stats[key])) {
      snapshot[key] = Number(stats[key]);
    }
  });
  return snapshot;
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function resolveSkillStringField(skill, fields) {
  if (!skill || typeof skill !== 'object' || !Array.isArray(fields)) {
    return '';
  }
  for (let i = 0; i < fields.length; i += 1) {
    const trimmed = toTrimmedString(skill[fields[i]]);
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function buildTimelineSkillPayload(skill) {
  const fallback = { id: 'basic_attack', name: '普攻', type: 'basic' };
  if (!skill || typeof skill !== 'object') {
    return { ...fallback };
  }
  const id = toTrimmedString(skill.id) || fallback.id;
  const name = toTrimmedString(skill.name) || fallback.name;
  const type = toTrimmedString(skill.type) || fallback.type;
  const payload = { id, name, type };
  const animation = toTrimmedString(skill.animation);
  if (animation) {
    payload.animation = animation;
  }
  if (skill.resource && typeof skill.resource === 'object') {
    const resource = {};
    const resourceType = toTrimmedString(skill.resource.type);
    if (resourceType) {
      resource.type = resourceType;
    }
    const cost = Number(skill.resource.cost);
    if (Number.isFinite(cost)) {
      resource.cost = Math.max(0, Math.round(cost));
    }
    if (Object.keys(resource).length) {
      payload.resource = resource;
    }
  }
  const quality =
    resolveSkillStringField(skill, ['quality', 'skillQuality', 'rarity', 'qualityKey']) || '';
  const qualityLabel =
    resolveSkillStringField(skill, ['qualityLabel', 'rarityLabel', 'skillQualityLabel']);
  const qualityColor =
    resolveSkillStringField(skill, ['qualityColor', 'skillQualityColor', 'rarityColor']);
  if (quality) {
    payload.quality = quality;
    payload.skillQuality = quality;
    payload.rarity = quality;
  }
  if (qualityLabel) {
    payload.qualityLabel = qualityLabel;
    payload.rarityLabel = qualityLabel;
  }
  if (qualityColor) {
    payload.qualityColor = qualityColor;
    payload.skillQualityColor = qualityColor;
    payload.rarityColor = qualityColor;
  }
  return payload;
}

function buildTimelineEntry({
  round,
  sequence,
  actorId,
  actorName,
  actorSide,
  targetId,
  targetName,
  events,
  skill,
  before,
  after,
  playerMaxHp,
  enemyMaxHp,
  playerAttributesSnapshot,
  enemyAttributesSnapshot,
  previousAttributes = {},
  controlBefore,
  controlAfter,
  summaryText
}) {
  const beforePlayer = before.player;
  const beforeEnemy = before.enemy;
  const afterPlayer = after.player;
  const afterEnemy = after.enemy;
  const entry = {
    id: `round-${round}-action-${sequence}`,
    round,
    sequence,
    actorId,
    actorSide,
    actor: { id: actorId, side: actorSide, displayName: actorName },
    target: { id: targetId, side: actorSide === 'player' ? 'opponent' : 'player', displayName: targetName },
    skill: buildTimelineSkillPayload(skill),
    events: events.filter(Boolean),
    state: {
      player: buildTimelineStateSide({
        before: beforePlayer,
        after: afterPlayer,
        maxHp: playerMaxHp,
        attributes: playerAttributesSnapshot,
        previousAttributes: previousAttributes ? previousAttributes.player : null,
        controlBefore: controlBefore ? controlBefore.player : null,
        controlAfter: controlAfter ? controlAfter.player : null
      }),
      opponent: buildTimelineStateSide({
        before: beforeEnemy,
        after: afterEnemy,
        maxHp: enemyMaxHp,
        attributes: enemyAttributesSnapshot,
        previousAttributes: previousAttributes ? previousAttributes.opponent : null,
        controlBefore: controlBefore ? controlBefore.opponent : null,
        controlAfter: controlAfter ? controlAfter.opponent : null
      })
    },
    summary: summaryText
      ? {
          title: `第${round}回合`,
          text: summaryText
        }
      : undefined
  };
  return entry;
}

function normalizeControlRuntimeSnapshot(runtime) {
  const base = {
    effects: [],
    skip: false,
    disableBasic: false,
    disableActive: false,
    disableDodge: false,
    remainingTurns: 0,
    remainingByEffect: {},
    summaries: {},
    active: false
  };
  if (!runtime || typeof runtime !== 'object') {
    return base;
  }
  const effects = Array.isArray(runtime.effects)
    ? runtime.effects
        .map((effect) => (typeof effect === 'string' ? effect.trim().toLowerCase() : ''))
        .filter(Boolean)
    : [];
  const skip = !!runtime.skip;
  const disableBasic = !!runtime.disableBasic;
  const disableActive = !!runtime.disableActive;
  const disableDodge = !!runtime.disableDodge;
  const remainingTurns = Number.isFinite(Number(runtime.remainingTurns))
    ? Math.max(0, Math.round(Number(runtime.remainingTurns)))
    : 0;
  const sourceRemaining =
    runtime.remainingByEffect && typeof runtime.remainingByEffect === 'object' ? runtime.remainingByEffect : {};
  const remainingByEffect = {};
  effects.forEach((effect) => {
    const raw = Number(sourceRemaining[effect]);
    if (Number.isFinite(raw)) {
      remainingByEffect[effect] = Math.max(0, Math.round(raw));
    }
  });
  const sourceSummaries = runtime.summaries && typeof runtime.summaries === 'object' ? runtime.summaries : {};
  const summaries = {};
  effects.forEach((effect) => {
    const summary = sourceSummaries[effect];
    if (typeof summary === 'string' && summary.trim()) {
      summaries[effect] = summary.trim();
    }
  });
  const active =
    effects.length > 0 || skip || disableBasic || disableActive || disableDodge || remainingTurns > 0;
  return {
    effects,
    skip,
    disableBasic,
    disableActive,
    disableDodge,
    remainingTurns,
    remainingByEffect,
    summaries,
    active
  };
}

function captureControlSnapshot(actor) {
  if (!actor || !actor.controlRuntime) {
    return normalizeControlRuntimeSnapshot();
  }
  return normalizeControlRuntimeSnapshot(actor.controlRuntime);
}

function cloneControlSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const effects = Array.isArray(snapshot.effects)
    ? snapshot.effects.map((effect) => (typeof effect === 'string' ? effect : '')).filter(Boolean)
    : [];
  const sourceRemaining = snapshot.remainingByEffect && typeof snapshot.remainingByEffect === 'object'
    ? snapshot.remainingByEffect
    : {};
  const sourceSummaries = snapshot.summaries && typeof snapshot.summaries === 'object' ? snapshot.summaries : {};
  const remainingByEffect = effects.reduce((acc, effect) => {
    const value = Number(sourceRemaining[effect]);
    if (Number.isFinite(value)) {
      acc[effect] = Math.max(0, Math.round(value));
    }
    return acc;
  }, {});
  const summaries = effects.reduce((acc, effect) => {
    const summary = sourceSummaries[effect];
    if (typeof summary === 'string' && summary.trim()) {
      acc[effect] = summary.trim();
    }
    return acc;
  }, {});
  const remainingTurns = Number.isFinite(Number(snapshot.remainingTurns))
    ? Math.max(0, Math.round(Number(snapshot.remainingTurns)))
    : 0;
  const active =
    typeof snapshot.active === 'boolean'
      ? snapshot.active
      : effects.length > 0 || snapshot.skip || snapshot.disableBasic || snapshot.disableActive || snapshot.disableDodge || remainingTurns > 0;
  return {
    effects,
    skip: !!snapshot.skip,
    disableBasic: !!snapshot.disableBasic,
    disableActive: !!snapshot.disableActive,
    disableDodge: !!snapshot.disableDodge,
    remainingTurns,
    remainingByEffect,
    summaries,
    active
  };
}

function buildTimelineStateSide({
  before,
  after,
  maxHp,
  attributes,
  previousAttributes,
  controlBefore,
  controlAfter
}) {
  const max = Math.max(1, Math.round(maxHp || 1));
  const beforeValue = Number.isFinite(before) ? before : max;
  const afterValue = Number.isFinite(after) ? after : Math.min(beforeValue, max);
  const beforeHp = Math.max(0, Math.round(Math.min(beforeValue, max)));
  const afterHp = Math.max(0, Math.round(Math.min(afterValue, max)));
  const shieldBefore = Math.max(0, Math.round(beforeValue - max));
  const shieldAfter = Math.max(0, Math.round(afterValue - max));
  const changedAttributes = extractChangedAttributes(attributes, previousAttributes);
  const state = {
    hp: {
      before: beforeHp,
      after: afterHp,
      max
    },
    attributes: changedAttributes
  };
  if (shieldBefore > 0 || shieldAfter > 0) {
    state.shield = {
      before: shieldBefore,
      after: shieldAfter
    };
  }
  const hasControlBefore = controlBefore && (controlBefore.active || controlBefore.effects.length);
  const hasControlAfter = controlAfter && (controlAfter.active || controlAfter.effects.length);
  if (hasControlBefore || hasControlAfter) {
    state.control = {
      before: cloneControlSnapshot(controlBefore),
      after: cloneControlSnapshot(controlAfter)
    };
  }
  return state;
}

function extractChangedAttributes(current, previous) {
  if (!current || typeof current !== 'object') {
    return {};
  }
  const previousAttributes = previous && typeof previous === 'object' ? previous : null;
  const changed = {};
  const keys = Object.keys(current);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = current[key];
    const previousValue = previousAttributes ? previousAttributes[key] : undefined;
    if (typeof value === 'number') {
      if (!Number.isFinite(previousValue) || Number(value) !== Number(previousValue)) {
        changed[key] = Number(value);
      }
    } else if (value !== undefined && value !== previousValue) {
      changed[key] = value;
    }
  }
  return changed;
}

function createPlayerCombatant(attributes) {
  return createCombatantFromAttributes(attributes, { convertLegacyPercentages: true });
}

function createEnemyCombatant(enemy) {
  const stats = resolveCombatStats(
    { finalStats: enemy.stats || {}, combatStats: enemy.combatStats },
    { defaults: ENEMY_COMBAT_DEFAULTS, convertLegacyPercentages: true }
  );
  const special = resolveSpecialStats(enemy.special || {}, { convertLegacyPercentages: true });
  return {
    stats,
    special,
    meta: enemy
  };
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

function applyBattleOutcome(profile, result, enemy, now, member, levels = [], battlePayload = null) {
  const updated = profile && typeof profile === 'object' ? profile : buildDefaultProfile(now);

  if (!updated.attributes || typeof updated.attributes !== 'object') {
    updated.attributes = buildDefaultAttributes();
  }
  if (!updated.equipment || typeof updated.equipment !== 'object') {
    updated.equipment = buildDefaultEquipment();
  }
  if (!updated.skills || typeof updated.skills !== 'object') {
    updated.skills = buildDefaultSkills(now);
  }
  if (!Array.isArray(updated.battleHistory)) {
    updated.battleHistory = [];
  }
  if (!Array.isArray(updated.skillHistory)) {
    updated.skillHistory = [];
  }
  if (!updated.secretRealm || typeof updated.secretRealm !== 'object') {
    updated.secretRealm = buildDefaultSecretRealmState();
  }

  const rewards = (result && result.rewards) || {};
  const rewardAttributePoints = rewards.attributePoints || 0;
  updated.attributes.attributePoints = (updated.attributes.attributePoints || 0) + rewardAttributePoints;

  if (Array.isArray(rewards.loot)) {
    rewards.loot.forEach((item) => {
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

  if (enemy && enemy.category === 'secretRealm') {
    const progress = normalizeSecretRealm(updated.secretRealm || {}, now);
    const floorState = progress.floors[enemy.id] || {};
    if (result.victory) {
      if (!floorState.clearedAt) {
        floorState.clearedAt = now;
      }
      const normalizedRounds = Number.isFinite(result.rounds)
        ? Math.max(1, Math.floor(result.rounds))
        : null;
      if (normalizedRounds) {
        if (!floorState.bestRounds || normalizedRounds < floorState.bestRounds) {
          floorState.bestRounds = normalizedRounds;
        }
      }
      floorState.victories = (floorState.victories || 0) + 1;
      progress.floors[enemy.id] = floorState;

      const defaultFloor = ENEMY_LIBRARY.length ? ENEMY_LIBRARY[0].floor : 1;
      const currentHighest = progress.highestUnlockedFloor || defaultFloor;
      const maxFloor = SECRET_REALM_MAX_FLOOR > 0 ? SECRET_REALM_MAX_FLOOR : enemy.floor + 1;
      const nextFloor = Math.min(maxFloor, enemy.floor + 1);
      if (nextFloor > currentHighest) {
        progress.highestUnlockedFloor = nextFloor;
      } else if (!progress.highestUnlockedFloor || progress.highestUnlockedFloor < defaultFloor) {
        progress.highestUnlockedFloor = defaultFloor;
      }
    } else if (floorState.victories) {
      progress.floors[enemy.id] = floorState;
    }
    updated.secretRealm = progress;
  }

  const battleRecord = battlePayload && typeof battlePayload === 'object' ? battlePayload : null;
  const historyTimeline = battleRecord && Array.isArray(battleRecord.timeline)
    ? battleRecord.timeline
    : Array.isArray(result.timeline)
    ? result.timeline
    : [];
  const historyParticipants =
    (battleRecord && battleRecord.participants) || result.participants || {};
  const historyOutcome = (battleRecord && battleRecord.outcome) || result.outcome || null;
  const historyMetadata = (battleRecord && battleRecord.metadata) || result.metadata || { mode: 'pve' };
  const historyRewards = (battleRecord && battleRecord.rewards) || result.rewards;
  const historyLog = battleRecord && Array.isArray(battleRecord.log) ? battleRecord.log : result.log;
  const historyCombatPower = (battleRecord && battleRecord.combatPower) || result.combatPower;

  const historyEntry = {
    type: 'battle',
    createdAt: now,
    enemyId: enemy.id,
    enemyName: enemy.name,
    enemyStageName: enemy.stageName,
    enemyRealmName: enemy.realmName,
    enemyType: enemy.type,
    enemyLevel: enemy.level,
    enemyFloor: enemy.floor,
    enemyArchetype: enemy.archetype,
    enemyAttributes: enemy.attributes,
    enemySnapshot: captureEnemySnapshot(enemy),
    result: result.victory ? 'win' : result.draw ? 'draw' : 'lose',
    rounds: result.rounds,
    rewards: historyRewards,
    log: trimBattleLog(historyLog, BATTLE_HISTORY_LOG_LIMIT),
    timeline: historyTimeline,
    participants: historyParticipants,
    outcome: historyOutcome,
    metadata: historyMetadata,
    combatPower: historyCombatPower
  };

  if (battleRecord) {
    historyEntry.battle = battleRecord;
  }

  updated.battleHistory = appendHistory(updated.battleHistory, historyEntry, MAX_BATTLE_HISTORY);

  refreshAttributeSummary(updated);

  if (profile && profile.__historyDoc) {
    updated.__historyDoc = profile.__historyDoc;
  }

  updated.lastBattleAt = now;

  return updated;
}

function trimBattleLog(log, limit = BATTLE_HISTORY_LOG_LIMIT) {
  if (!Array.isArray(log) || limit <= 0) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (log.length <= normalizedLimit) {
    return log.slice();
  }
  const sliceLength = Math.max(1, normalizedLimit - 1);
  const trimmed = log.slice(0, sliceLength);
  trimmed.push(`……（共 ${log.length} 条战斗日志，已截断）`);
  return trimmed;
}

function expandBattleHistoryEntry(entry) {
  if (!entry || entry.type !== 'battle' || !entry.battle || typeof entry.battle !== 'object') {
    return entry;
  }
  const battle = entry.battle;
  if (!entry.participants && battle.participants) {
    entry.participants = battle.participants;
  }
  if (!entry.outcome && battle.outcome) {
    entry.outcome = battle.outcome;
  }
  if (!entry.metadata && battle.metadata) {
    entry.metadata = battle.metadata;
  }
  if (!entry.combatPower && battle.combatPower) {
    entry.combatPower = battle.combatPower;
  }
  if (!entry.remaining && battle.remaining) {
    entry.remaining = battle.remaining;
  }
  if (!entry.rewards && battle.rewards) {
    entry.rewards = battle.rewards;
  }
  if ((!entry.log || !entry.log.length) && Array.isArray(battle.log)) {
    entry.log = battle.log.slice();
  }
  if ((!entry.timeline || !entry.timeline.length) && Array.isArray(battle.timeline)) {
    entry.timeline = battle.timeline;
  }
  if (typeof entry.victory !== 'boolean' && typeof battle.victory === 'boolean') {
    entry.victory = battle.victory;
  }
  if (typeof entry.draw !== 'boolean' && typeof battle.draw === 'boolean') {
    entry.draw = battle.draw;
  }
  if (!entry.rounds && battle.rounds) {
    entry.rounds = battle.rounds;
  }
  if (!entry.result && battle.result) {
    entry.result = battle.result;
  }
  return entry;
}

function needsBattleArchive(entry) {
  if (!entry || entry.type !== 'battle' || entry.battleArchiveId) {
    return false;
  }
  if (Array.isArray(entry.timeline) && entry.timeline.length > 0) {
    return true;
  }
  if (entry.battle && Array.isArray(entry.battle.timeline) && entry.battle.timeline.length > 0) {
    return true;
  }
  return false;
}

function buildBattleArchivePayload(entry, options = {}) {
  if (!entry || entry.type !== 'battle') {
    return null;
  }
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const battlePayload = options.battlePayload && typeof options.battlePayload === 'object' ? options.battlePayload : null;

  const timelineSources = [];
  if (battlePayload && Array.isArray(battlePayload.timeline) && battlePayload.timeline.length) {
    timelineSources.push(battlePayload.timeline);
  }
  if (Array.isArray(entry.timeline) && entry.timeline.length) {
    timelineSources.push(entry.timeline);
  }
  if (entry.battle && Array.isArray(entry.battle.timeline) && entry.battle.timeline.length) {
    timelineSources.push(entry.battle.timeline);
  }

  const timeline = timelineSources.length ? timelineSources[0] : null;
  if (!timeline || !timeline.length) {
    return null;
  }

  const resolveRecord = (source) => (source && typeof source === 'object' ? source : null);
  const battleRecord = resolveRecord(battlePayload) || resolveRecord(entry.battle) || null;

  const participants =
    (battlePayload && resolveRecord(battlePayload.participants)) ||
    resolveRecord(entry.participants) ||
    (battleRecord && resolveRecord(battleRecord.participants)) ||
    null;
  const outcome =
    (battlePayload && resolveRecord(battlePayload.outcome)) ||
    resolveRecord(entry.outcome) ||
    (battleRecord && resolveRecord(battleRecord.outcome)) ||
    null;
  const metadataSource =
    (battlePayload && resolveRecord(battlePayload.metadata)) ||
    resolveRecord(entry.metadata) ||
    (battleRecord && resolveRecord(battleRecord.metadata)) ||
    null;
  const metadata = metadataSource ? { ...metadataSource } : { mode: 'pve' };
  if (!metadata.mode) {
    metadata.mode = 'pve';
  }
  const rewards =
    (battlePayload && resolveRecord(battlePayload.rewards)) ||
    resolveRecord(entry.rewards) ||
    (battleRecord && resolveRecord(battleRecord.rewards)) ||
    null;
  const combatPower =
    (battlePayload && resolveRecord(battlePayload.combatPower)) ||
    resolveRecord(entry.combatPower) ||
    (battleRecord && resolveRecord(battleRecord.combatPower)) ||
    null;
  const remaining =
    (battlePayload && resolveRecord(battlePayload.remaining)) ||
    resolveRecord(entry.remaining) ||
    (battleRecord && resolveRecord(battleRecord.remaining)) ||
    null;

  const logSource =
    (battlePayload && Array.isArray(battlePayload.log) ? battlePayload.log : null) ||
    (Array.isArray(entry.log) ? entry.log : null) ||
    (battleRecord && Array.isArray(battleRecord.log) ? battleRecord.log : null) ||
    [];

  const createdAt =
    entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime())
      ? entry.createdAt
      : typeof entry.createdAt === 'string' || typeof entry.createdAt === 'number'
      ? new Date(entry.createdAt)
      : now;

  const enemySnapshot = entry.enemySnapshot || (options.enemy ? captureEnemySnapshot(options.enemy) : null);

  return {
    memberId: options.actorId || entry.memberId || null,
    createdAt,
    updatedAt: now,
    enemyId: entry.enemyId,
    enemyName: entry.enemyName,
    enemyStageName: entry.enemyStageName,
    enemyRealmName: entry.enemyRealmName,
    enemyFloor: entry.enemyFloor,
    enemyType: entry.enemyType,
    enemySnapshot,
    result: entry.result,
    rounds: entry.rounds,
    rewards,
    log: trimBattleLog(logSource, BATTLE_ARCHIVE_LOG_LIMIT),
    timeline: timeline.map((item) => (item && typeof item === 'object' ? { ...item } : item)),
    participants,
    outcome,
    metadata,
    combatPower,
    remaining
  };
}

async function saveBattleArchiveRecord(memberId, payload) {
  if (!payload || !Array.isArray(payload.timeline) || !payload.timeline.length) {
    return null;
  }
  const collectionName = BATTLE_ARCHIVE_COLLECTION;
  await ensureCollection(collectionName);
  const archiveCollection = db.collection(collectionName);
  const createdAt =
    payload.createdAt instanceof Date && !Number.isNaN(payload.createdAt.getTime()) ? payload.createdAt : new Date();
  const updatedAt =
    payload.updatedAt instanceof Date && !Number.isNaN(payload.updatedAt.getTime()) ? payload.updatedAt : createdAt;
  const document = {
    memberId,
    createdAt,
    updatedAt,
    enemyId: payload.enemyId || '',
    enemyName: payload.enemyName || '',
    enemyStageName: payload.enemyStageName || '',
    enemyRealmName: payload.enemyRealmName || '',
    enemyFloor: payload.enemyFloor || null,
    enemyType: payload.enemyType || '',
    enemySnapshot: payload.enemySnapshot || null,
    result: payload.result || '',
    rounds: payload.rounds || null,
    rewards: payload.rewards || null,
    log: Array.isArray(payload.log) ? payload.log : [],
    timeline: payload.timeline,
    participants: payload.participants || null,
    outcome: payload.outcome || null,
    metadata: payload.metadata || { mode: 'pve' },
    combatPower: payload.combatPower || null,
    remaining: payload.remaining || null
  };
  const addResult = await archiveCollection.add({ data: document });
  return { _id: addResult._id, ...document };
}

function buildBattleHistoryPreviewFromEntry(entry, archiveId) {
  if (!entry || entry.type !== 'battle') {
    return archiveId ? { archiveId } : null;
  }
  const preview = {
    archiveId: archiveId || entry.battleArchiveId || null,
    rounds: entry.rounds,
    rewards: entry.rewards || null,
    combatPower: entry.combatPower || null,
    metadata: entry.metadata || null,
    participants: entry.participants || null,
    outcome: entry.outcome || null,
    remaining: entry.remaining || null,
    result: entry.result,
    victory:
      typeof entry.victory === 'boolean'
        ? entry.victory
        : typeof entry.result === 'string'
        ? entry.result === 'win'
        : undefined,
    draw:
      typeof entry.draw === 'boolean'
        ? entry.draw
        : typeof entry.result === 'string'
        ? entry.result === 'draw'
        : undefined
  };
  if (preview.metadata && !preview.metadata.mode) {
    preview.metadata = { ...preview.metadata, mode: 'pve' };
  }
  return preview;
}

function markHistoryEntryArchived(entry, archiveId, options = {}) {
  if (!entry || entry.type !== 'battle') {
    return;
  }
  const logLimit = Number.isFinite(options.logLimit) ? Math.max(1, Math.floor(options.logLimit)) : BATTLE_HISTORY_LOG_LIMIT;
  if (Array.isArray(entry.log) && entry.log.length > logLimit) {
    entry.log = trimBattleLog(entry.log, logLimit);
  }
  entry.battleArchiveId = archiveId || entry.battleArchiveId || null;
  entry.timeline = [];
  entry.battle = buildBattleHistoryPreviewFromEntry(entry, archiveId);
}

async function offloadBattleHistoryEntries(actorId, profile, options = {}) {
  if (!profile || !Array.isArray(profile.battleHistory) || !profile.battleHistory.length) {
    return [];
  }
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const limit = Number.isFinite(options.limit)
    ? Math.max(0, Math.floor(options.limit))
    : BATTLE_ARCHIVE_MIGRATION_LIMIT;
  const enemy = options.enemy || null;
  const battlePayload = options.battlePayload || null;

  const candidates = [];
  for (let i = 0; i < profile.battleHistory.length; i += 1) {
    const entry = profile.battleHistory[i];
    if (!entry || entry.type !== 'battle') {
      continue;
    }
    expandBattleHistoryEntry(entry);
    if (!needsBattleArchive(entry)) {
      if (Array.isArray(entry.log) && entry.log.length > BATTLE_HISTORY_LOG_LIMIT) {
        entry.log = trimBattleLog(entry.log, BATTLE_HISTORY_LOG_LIMIT);
      }
      continue;
    }
    candidates.push({ entry, isNewest: i === 0 });
    if (limit && candidates.length >= limit) {
      break;
    }
  }

  const archived = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const { entry, isNewest } = candidates[i];
    const payload = buildBattleArchivePayload(entry, {
      battlePayload: isNewest ? battlePayload : null,
      enemy,
      now,
      actorId
    });
    if (!payload) {
      continue;
    }
    const archive = await saveBattleArchiveRecord(actorId, payload).catch((error) => {
      console.error('[pve] save battle archive failed', error);
      return null;
    });
    if (archive && archive._id) {
      markHistoryEntryArchived(entry, archive._id, { logLimit: BATTLE_HISTORY_LOG_LIMIT });
      archived.push(archive);
    }
  }

  profile.battleHistory.forEach((entry) => {
    if (!entry || entry.type !== 'battle') {
      return;
    }
    if (entry.metadata && typeof entry.metadata === 'object' && !entry.metadata.mode) {
      entry.metadata.mode = 'pve';
    }
    if (Array.isArray(entry.log) && entry.log.length > BATTLE_HISTORY_LOG_LIMIT) {
      entry.log = trimBattleLog(entry.log, BATTLE_HISTORY_LOG_LIMIT);
    }
  });

  return archived;
}

function formatBattleArchiveResponse(record) {
  if (!record || typeof record !== 'object') {
    return { archiveId: null, battle: null, log: [], timeline: [] };
  }
  const archiveId = record._id || record.id || null;
  const timeline = Array.isArray(record.timeline) ? record.timeline : [];
  const log = Array.isArray(record.log) ? record.log : [];
  const metadataSource = record.metadata && typeof record.metadata === 'object' ? record.metadata : null;
  const metadata = metadataSource ? { ...metadataSource } : { mode: 'pve' };
  if (!metadata.mode) {
    metadata.mode = 'pve';
  }
  const rounds = Number.isFinite(record.rounds) ? Math.max(1, Math.floor(record.rounds)) : timeline.length;
  const result = record.result || (record.victory ? 'win' : record.draw ? 'draw' : 'lose');
  const victory = typeof record.victory === 'boolean' ? record.victory : result === 'win';
  const draw = typeof record.draw === 'boolean' ? record.draw : result === 'draw';
  const battle = {
    archiveId,
    timeline,
    log,
    participants: record.participants || null,
    outcome: record.outcome || null,
    metadata,
    rewards: record.rewards || null,
    combatPower: record.combatPower || null,
    remaining: record.remaining || null,
    rounds,
    victory,
    draw
  };
  return {
    archiveId,
    memberId: record.memberId || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    enemyId: record.enemyId || null,
    enemyName: record.enemyName || null,
    enemyStageName: record.enemyStageName || null,
    enemyRealmName: record.enemyRealmName || null,
    enemyFloor: record.enemyFloor || null,
    enemyType: record.enemyType || null,
    enemySnapshot: record.enemySnapshot || null,
    result,
    rounds,
    rewards: record.rewards || null,
    log,
    timeline,
    participants: record.participants || null,
    outcome: record.outcome || null,
    metadata,
    combatPower: record.combatPower || null,
    remaining: record.remaining || null,
    battle
  };
}

async function loadBattleArchive(actorId, event = {}) {
  const archiveIdCandidate =
    event && typeof event.archiveId === 'string' && event.archiveId.trim() ? event.archiveId.trim() : '';
  const recordId =
    archiveIdCandidate ||
    (event && typeof event.recordId === 'string' && event.recordId.trim() ? event.recordId.trim() : '') ||
    (event && typeof event.battleId === 'string' && event.battleId.trim() ? event.battleId.trim() : '');
  if (!recordId) {
    throw createError('ARCHIVE_ID_REQUIRED', '缺少战斗记录编号');
  }

  const member = await ensureMember(actorId);

  const collection = db.collection(BATTLE_ARCHIVE_COLLECTION);
  const snapshot = await collection
    .doc(recordId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw createError('ARCHIVE_NOT_FOUND', '战斗回放不存在或已过期');
  }
  const record = snapshot.data;
  if (record.memberId && record.memberId !== actorId && !isAdminMember(member)) {
    throw createError('FORBIDDEN', '无权查看该战斗记录');
  }
  return formatBattleArchiveResponse({ ...record, _id: recordId });
}

function ensureEquipmentOwned(profile, itemId, now) {
  const definition = EQUIPMENT_MAP[itemId];
  if (!definition) {
    return;
  }
  profile.equipment = profile.equipment || buildDefaultEquipment();
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

function formatBattleResult(result, context = {}) {
  const rawRewards = result.rewards || {};
  const lootItems = Array.isArray(rawRewards.loot) ? rawRewards.loot : [];
  const decoratedLoot = lootItems.map((item) => {
    if (item.type === 'equipment') {
      const def = EQUIPMENT_MAP[item.itemId];
      return {
        type: 'equipment',
        itemId: item.itemId,
        name: def ? def.name : '装备',
        quality: def ? def.quality : 'mortal',
        qualityLabel: def ? resolveEquipmentQualityLabel(def.quality) : resolveEquipmentQualityLabel('mortal'),
        qualityColor: def ? resolveEquipmentQualityColor(def.quality) : resolveEquipmentQualityColor('mortal')
      };
    }
    if (item.type === 'skill') {
      const def = SKILL_MAP[item.skillId];
      const quality = def ? def.quality : 'linggan';
      return {
        type: 'skill',
        skillId: item.skillId,
        name: def ? def.name : '技能',
        quality,
        qualityLabel: resolveSkillQualityLabel(quality)
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
  });

  const rewards = {
    exp: rawRewards.exp || 0,
    stones: rawRewards.stones || 0,
    attributePoints: rawRewards.attributePoints || 0,
    loot: decoratedLoot
  };

  const metadataSource = result.metadata && typeof result.metadata === 'object' ? result.metadata : {};
  const metadata = { ...metadataSource };
  if (typeof metadata.mode !== 'string' || !metadata.mode) {
    metadata.mode = 'pve';
  }

  const playerParticipant = result.participants && result.participants.player ? result.participants.player : null;
  const opponentParticipant = result.participants
    ? result.participants.opponent || result.participants.enemy || null
    : null;
  const extractId = (source) => {
    if (!source || typeof source !== 'object') {
      return null;
    }
    if (typeof source.memberId === 'string' && source.memberId) {
      return source.memberId;
    }
    if (typeof source.id === 'string' && source.id) {
      return source.id;
    }
    if (typeof source.characterId === 'string' && source.characterId) {
      return source.characterId;
    }
    if (typeof source.roleId === 'string' && source.roleId) {
      return source.roleId;
    }
    return null;
  };

  const playerId = extractId(playerParticipant);
  const opponentId = extractId(opponentParticipant);
  const winnerId = result.draw ? null : result.victory ? playerId : opponentId;
  const loserId = result.draw ? null : result.victory ? opponentId : playerId;

  const battlePayload = createBattlePayload({
    mode: 'pve',
    rounds: result.rounds,
    timeline: result.timeline,
    participants: result.participants,
    outcome: result.outcome,
    metadata,
    log: result.log,
    rewards,
    remaining: result.remaining,
    combatPower: result.combatPower,
    draw: result.draw,
    victory: result.victory,
    actorId: context.actorId || playerId,
    player: context.player || null,
    opponent: context.opponent || null,
    winnerId,
    loserId
  });

  battlePayload.rewards = rewards;
  battlePayload.rewardsText = formatRewardText(rewards);
  battlePayload.log = Array.isArray(result.log) ? result.log : [];
  battlePayload.remaining = result.remaining || battlePayload.remaining;
  battlePayload.combatPower = result.combatPower || battlePayload.combatPower;
  battlePayload.victory = !!result.victory;
  battlePayload.draw = !!result.draw;
  if (!battlePayload.metadata || typeof battlePayload.metadata !== 'object') {
    battlePayload.metadata = { mode: 'pve' };
  } else if (!battlePayload.metadata.mode) {
    battlePayload.metadata.mode = 'pve';
  }

  return battlePayload;
}
function rollSkill() {
  const quality = selectSkillQuality();
  const pool = SKILL_LIBRARY.filter((skill) => (skill.quality || 'linggan') === quality);
  const skill = pool.length ? pool[Math.floor(Math.random() * pool.length)] : SKILL_LIBRARY[0];
  return { quality, skill };
}

function selectSkillQuality() {
  const weights = Object.values(SKILL_QUALITY_CONFIG).map((item) => item.weight || 0);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let roll = Math.random() * total;
  for (const key of Object.keys(SKILL_QUALITY_CONFIG)) {
    const weight = SKILL_QUALITY_CONFIG[key].weight || 0;
    if (roll < weight) {
      return key;
    }
    roll -= weight;
  }
  return Object.keys(SKILL_QUALITY_CONFIG)[0] || 'linggan';
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
    const lootNames = rewards.loot
      .map((item) => {
        if (item && typeof item === 'object') {
          return item.label || item.name || item.itemName || '';
        }
        return '';
      })
      .filter((name) => name);
    if (lootNames.length) {
      parts.push(`掉落：${lootNames.join('、')}`);
    } else {
      parts.push('获得掉落');
    }
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
