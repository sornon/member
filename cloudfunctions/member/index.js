const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const commonConfig = require('common-config');
const {
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder,
  resolveBackgroundByRealmName,
  resolveBackgroundById,
  registerCustomBackgrounds,
  normalizeBackgroundCatalog,
  areBackgroundCatalogsEqual,
  COLLECTIONS,
  realmConfigs,
  subLevelLabels,
  listAvatarIds,
  normalizeAvatarFrameValue,
  resolveRegularLevelRights
} = commonConfig;
const {
  FEATURE_TOGGLE_DOC_ID,
  normalizeCacheVersions,
  cloneCacheVersions,
  normalizeHomeEntries,
  cloneHomeEntries,
  DEFAULT_HOME_ENTRIES,
  cloneGlobalBackground,
  cloneGlobalBackgroundCatalog
} = require('system-settings');

const db = cloud.database();
const _ = db.command;

const GENDER_OPTIONS = ['unknown', 'male', 'female'];
const AVATAR_ID_PATTERN = /^(male|female)-([a-z]+)-(\d+)$/;
const ALLOWED_AVATAR_IDS = new Set(listAvatarIds());

const TITLE_LIBRARY = Object.freeze({
  title_refining_rookie: {
    id: 'title_refining_rookie',
    name: '炼气新人',
    description: '初入修行的身份称号，可在档案中展示。'
  },
  title_foundation_initiate: {
    id: 'title_foundation_initiate',
    name: '筑基初成',
    description: '筑基阶段的专属身份称号，可在档案中展示。',
    imageFile: 'zhujichucheng'
  },
  title_core_forming_initiate: {
    id: 'title_core_forming_initiate',
    name: '结丹初凝',
    description: '结丹阶段的专属身份称号，可在档案中展示。',
    imageFile: 'jiedanchuning'
  },
  title_nascent_soul_initiate: {
    id: 'title_nascent_soul_initiate',
    name: '元婴初现',
    description: '元婴阶段的专属身份称号，可在档案中展示。',
    imageFile: 'yuanyingchuxian'
  },
  title_divine_transformation_initiate: {
    id: 'title_divine_transformation_initiate',
    name: '化神初悟',
    description: '化神阶段的专属身份称号，可在档案中展示。',
    imageFile: 'huashenchuwu'
  },
  title_void_refining_initiate: {
    id: 'title_void_refining_initiate',
    name: '炼虚洞明',
    description: '炼虚阶段的专属身份称号，可在档案中展示。',
    imageFile: 'lianxudongming'
  },
  title_unity_initiate: {
    id: 'title_unity_initiate',
    name: '合体初合',
    description: '合体阶段的专属身份称号，可在档案中展示。',
    imageFile: 'hetichuhe'
  }
});

function normalizeTitleId(titleId) {
  if (typeof titleId !== 'string') {
    return '';
  }
  return titleId.trim();
}

function normalizeTitleImageFile(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let sanitized = value.trim();
  if (!sanitized) {
    return '';
  }
  sanitized = sanitized.replace(/\.png$/i, '');
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]+/g, '_');
  sanitized = sanitized.replace(/_{2,}/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized.toLowerCase();
}

function generateCustomTitleId(base, existingIds) {
  const ids = existingIds || new Set();
  const normalizedBase = normalizeTitleImageFile(base) || 'title';
  let candidate = normalizedBase.startsWith('title_') ? normalizedBase : `title_${normalizedBase}`;
  let suffix = 1;
  let finalId = candidate;
  while (ids.has(finalId)) {
    suffix += 1;
    finalId = `${candidate}_${suffix}`;
  }
  ids.add(finalId);
  return finalId;
}

function normalizeTitleCatalogEntry(entry, existingIds) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const ids = existingIds || new Set();
  let id = typeof entry.id === 'string' ? entry.id.trim() : '';
  let imageFile = normalizeTitleImageFile(entry.imageFile || entry.fileName || entry.file || id);
  if (!id) {
    id = generateCustomTitleId(imageFile || entry.name || '', ids);
  } else {
    id = normalizeTitleId(id);
    if (!id) {
      id = generateCustomTitleId(imageFile || entry.name || '', ids);
    }
  }
  if (ids.has(id)) {
    id = generateCustomTitleId(id, ids);
  }
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  imageFile = imageFile || id;
  if (!ids.has(id)) {
    ids.add(id);
  }
  const normalized = {
    id,
    name,
    imageFile
  };
  if (entry.createdAt) {
    normalized.createdAt = entry.createdAt;
  }
  if (entry.createdBy) {
    normalized.createdBy = entry.createdBy;
  }
  return normalized;
}

function normalizeTitleCatalog(list = []) {
  const baseIds = new Set(Object.keys(TITLE_LIBRARY));
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalizedEntry = normalizeTitleCatalogEntry(entry, baseIds);
    if (!normalizedEntry) {
      return;
    }
    normalized.push(normalizedEntry);
  });
  return normalized;
}

function areTitleCatalogsEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] || {};
    const right = b[i] || {};
    if (left.id !== right.id) {
      return false;
    }
    if ((left.name || '') !== (right.name || '')) {
      return false;
    }
    if ((left.imageFile || '') !== (right.imageFile || '')) {
      return false;
    }
  }
  return true;
}

function normalizeBackgroundUnlockList(list = []) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  list.forEach((id) => {
    const normalized = normalizeBackgroundId(id);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function ensureCustomBackgroundsUnlocked(entries = [], unlocks = []) {
  const normalizedUnlocks = normalizeBackgroundUnlockList(unlocks);
  const unlockSet = new Set(normalizedUnlocks);
  let changed = false;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || !entry.id || unlockSet.has(entry.id)) {
      return;
    }
    unlockSet.add(entry.id);
    normalizedUnlocks.push(entry.id);
    changed = true;
  });
  return changed ? normalizeBackgroundUnlockList(normalizedUnlocks) : normalizedUnlocks;
}

const BACKGROUND_LIBRARY = Object.freeze({
  trial_spirit_test: {
    id: 'trial_spirit_test',
    name: '灵根测试'
  },
  reward_foundation: {
    id: 'reward_foundation',
    name: '筑基背景'
  }
});

const STORAGE_CATEGORY_DEFAULT_LABELS = Object.freeze({
  quest: '任务',
  material: '材料',
  consumable: '道具'
});

const STORAGE_REWARD_META = Object.freeze({
  title: { quality: 'rare', qualityLabel: '称号', qualityColor: '#6c8cff' },
  background: { quality: 'rare', qualityLabel: '背景', qualityColor: '#45c0a8' },
  consumable: { quality: 'epic', qualityLabel: '消耗品', qualityColor: '#f2a546' }
});

const ALLOWED_MEMBER_ROLES = new Set(['member', 'admin', 'developer', 'test']);
const PROXY_SESSION_COLLECTION = COLLECTIONS.ADMIN_PROXY_SESSIONS || 'adminProxySessions';
const PROXY_LOG_COLLECTION = COLLECTIONS.ADMIN_PROXY_LOGS || 'adminProxyLogs';

const ensuredCollections = new Set();

function isCollectionNotExistsError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof error.errCode !== 'undefined' ? error.errCode : error.code;
  const message = typeof error.errMsg === 'string' ? error.errMsg : error.message || '';
  if (code === -502005) {
    return true;
  }
  return /collection not exist|database collection not exists|db or table not exist/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof error.errCode !== 'undefined' ? error.errCode : error.code;
  const message = typeof error.errMsg === 'string' ? error.errMsg : error.message || '';
  return code === -502004 || /already exist/i.test(message);
}

function isPermissionDeniedError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof error.errCode !== 'undefined' ? error.errCode : error.code;
  const message = typeof error.errMsg === 'string' ? error.errMsg : error.message || '';
  return code === -501000 || /permission denied/i.test(message);
}

async function ensureCollectionExists(collectionName) {
  if (!collectionName || ensuredCollections.has(collectionName)) {
    return;
  }
  try {
    await db
      .collection(collectionName)
      .limit(1)
      .get();
    ensuredCollections.add(collectionName);
    return;
  } catch (error) {
    if (!isCollectionNotExistsError(error)) {
      console.warn(`[member] 检查集合 ${collectionName} 失败`, error);
      ensuredCollections.add(collectionName);
      return;
    }
  }

  try {
    await db.createCollection(collectionName);
    ensuredCollections.add(collectionName);
  } catch (error) {
    if (isCollectionAlreadyExistsError(error)) {
      ensuredCollections.add(collectionName);
      return;
    }
    if (isPermissionDeniedError(error)) {
      throw new Error(`没有权限自动创建集合 ${collectionName}，请前往云开发控制台手动创建该集合。`);
    }
    console.error(`[member] 创建集合 ${collectionName} 失败`, error);
    throw new Error(`创建集合 ${collectionName} 失败，请稍后重试或在云开发控制台手动创建。`);
  }
}

async function ensureProxyLogCollection() {
  await ensureCollectionExists(PROXY_LOG_COLLECTION);
}

const SUB_LEVEL_COUNT =
  Array.isArray(subLevelLabels) && subLevelLabels.length ? subLevelLabels.length : 10;

const LEVEL_REWARD_CONFIG = Object.freeze({
  level_001: [
    {
      type: 'title',
      titleId: 'title_refining_rookie',
      storageItemId: 'reward_title_refining_rookie',
      storageCategory: 'consumable',
      name: '称号·炼气新人',
      description: '使用后解锁称号“炼气新人”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_refining_rookie' }
    }
  ],
  level_002: [
    {
      type: 'background',
      backgroundId: 'trial_spirit_test',
      storageItemId: 'reward_background_spirit_test',
      storageCategory: 'consumable',
      name: '背景·灵根测试',
      description: '使用后解锁背景“灵根测试”，可在外观设置中选择。',
      slotLabel: '背景',
      usage: { type: 'unlockBackground', backgroundId: 'trial_spirit_test' }
    }
  ],
  level_003: [
    { type: 'equipment', itemId: 'mortal_weapon_staff' }
  ],
  level_004: [
    { type: 'skill', skillId: 'spell_burning_burst' }
  ],
  level_005: [
    { type: 'equipment', itemId: 'mortal_chest_robe' }
  ],
  level_006: [
    { type: 'equipment', itemId: 'mortal_boots_lightstep' }
  ],
  level_007: [
    { type: 'equipment', itemId: 'mortal_belt_ring' }
  ],
  level_008: [
    { type: 'equipment', itemId: 'mortal_bracer_echo' }
  ],
  level_009: [
    { type: 'equipment', itemId: 'mortal_orb_calm' }
  ],
  level_010: [
    {
      type: 'consumable',
      storageItemId: 'reward_skill_draw_bundle',
      storageCategory: 'consumable',
      usage: { type: 'skillDraw', drawCount: 5 },
      name: '技能5连抽',
      description: '使用后立即进行 5 次技能抽取。',
      slotLabel: '道具'
    },
    {
      type: 'background',
      backgroundId: 'reward_foundation',
      name: '背景·筑基背景',
      description: '突破筑基后自动解锁的专属背景，无需额外道具。',
      autoUnlock: true
    }
  ],
  level_011: [
    {
      type: 'title',
      titleId: 'title_foundation_initiate',
      storageItemId: 'reward_title_foundation_initiate',
      storageCategory: 'consumable',
      name: '称号·筑基初成',
      description: '使用后解锁称号“筑基初成”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_foundation_initiate' }
    }
  ],
  level_012: [
    { type: 'equipment', itemId: 'mortal_helm_headband', refine: 2 }
  ],
  level_013: [
    { type: 'equipment', itemId: 'mortal_boots_cloth', refine: 2 }
  ],
  level_014: [
    { type: 'equipment', itemId: 'mortal_belt_rope', refine: 2 }
  ],
  level_015: [
    { type: 'equipment', itemId: 'mortal_bracer_stone', refine: 2 }
  ],
  level_016: [
    { type: 'equipment', itemId: 'mortal_orb_amber', refine: 2 }
  ],
  level_017: [
    { type: 'equipment', itemId: 'mortal_necklace_rune', refine: 2 }
  ],
  level_018: [
    { type: 'equipment', itemId: 'mortal_token_oath', refine: 2 }
  ],
  level_019: [
    { type: 'equipment', itemId: 'mortal_puppet_wood', refine: 2 }
  ],
  level_020: [
    { type: 'equipment', itemId: 'mortal_treasure_dawn', refine: 2 }
  ],
  level_021: [
    {
      type: 'title',
      titleId: 'title_core_forming_initiate',
      storageItemId: 'reward_title_core_forming_initiate',
      storageCategory: 'consumable',
      name: '称号·结丹初凝',
      description: '使用后解锁称号“结丹初凝”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_core_forming_initiate' }
    }
  ],
  level_022: [
    { type: 'equipment', itemId: 'novice_sword' }
  ],
  level_023: [
    { type: 'equipment', itemId: 'apprentice_helm' }
  ],
  level_024: [
    { type: 'equipment', itemId: 'apprentice_robe' }
  ],
  level_025: [
    { type: 'equipment', itemId: 'lightstep_boots' }
  ],
  level_026: [
    { type: 'equipment', itemId: 'spirit_belt' }
  ],
  level_027: [
    { type: 'equipment', itemId: 'initiate_bracers' }
  ],
  level_028: [
    { type: 'equipment', itemId: 'initiate_orb' }
  ],
  level_029: [
    { type: 'equipment', itemId: 'spirit_ring' }
  ],
  level_030: [
    { type: 'equipment', itemId: 'initiate_treasure' }
  ],
  level_031: [
    {
      type: 'title',
      titleId: 'title_nascent_soul_initiate',
      storageItemId: 'reward_title_nascent_soul_initiate',
      storageCategory: 'consumable',
      name: '称号·元婴初现',
      description: '使用后解锁称号“元婴初现”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_nascent_soul_initiate' }
    }
  ],
  level_041: [
    {
      type: 'title',
      titleId: 'title_divine_transformation_initiate',
      storageItemId: 'reward_title_divine_transformation_initiate',
      storageCategory: 'consumable',
      name: '称号·化神初悟',
      description: '使用后解锁称号“化神初悟”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_divine_transformation_initiate' }
    }
  ],
  level_051: [
    {
      type: 'title',
      titleId: 'title_void_refining_initiate',
      storageItemId: 'reward_title_void_refining_initiate',
      storageCategory: 'consumable',
      name: '称号·炼虚洞明',
      description: '使用后解锁称号“炼虚洞明”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_void_refining_initiate' }
    }
  ],
  level_061: [
    {
      type: 'title',
      titleId: 'title_unity_initiate',
      storageItemId: 'reward_title_unity_initiate',
      storageCategory: 'consumable',
      name: '称号·合体初合',
      description: '使用后解锁称号“合体初合”，并可在档案中展示。',
      slotLabel: '称号',
      usage: { type: 'unlockTitle', titleId: 'title_unity_initiate' }
    }
  ]
});

const BREAKTHROUGH_DELIVERY_SUFFIX = '::breakthrough';

function resolveTitleDefinition(titleId) {
  if (typeof titleId !== 'string') {
    return null;
  }
  return TITLE_LIBRARY[titleId] || null;
}

function resolveBackgroundDefinition(backgroundId) {
  if (typeof backgroundId !== 'string') {
    return null;
  }
  return BACKGROUND_LIBRARY[backgroundId] || null;
}

function resolveClientEnvVersion(options = {}) {
  if (!options || typeof options !== 'object') {
    return '';
  }
  if (options.clientEnv && typeof options.clientEnv === 'object') {
    const candidate = options.clientEnv.envVersion || options.clientEnv.version || '';
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  if (typeof options.envVersion === 'string' && options.envVersion.trim()) {
    return options.envVersion.trim().toLowerCase();
  }
  if (typeof options.clientEnvVersion === 'string' && options.clientEnvVersion.trim()) {
    return options.clientEnvVersion.trim().toLowerCase();
  }
  return '';
}

function shouldAssignTestRole(envVersion) {
  const normalized = typeof envVersion === 'string' ? envVersion.trim().toLowerCase() : '';
  return normalized === 'develop' || normalized === 'trial';
}

function resolveStorageCategoryLabel(key) {
  return STORAGE_CATEGORY_DEFAULT_LABELS[key] || key || '道具';
}

function generateStorageInventoryId(itemId, obtainedAt = new Date()) {
  const base = typeof itemId === 'string' && itemId ? itemId : 'storage';
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `st-${base}-${timestamp}-${random}`;
}

async function loadFeatureToggleDocument() {
  const snapshot = await db
    .collection(COLLECTIONS.SYSTEM_SETTINGS)
    .doc(FEATURE_TOGGLE_DOC_ID)
    .get()
    .catch((error) => {
      if (error && error.errMsg && /not exist|not found/i.test(error.errMsg)) {
        return null;
      }
      throw error;
    });
  return snapshot && snapshot.data ? snapshot.data : null;
}

async function getCacheVersions() {
  const document = await loadFeatureToggleDocument();
  const versions = normalizeCacheVersions(document && document.cacheVersions);
  const response = {
    versions: cloneCacheVersions(versions)
  };
  if (document && document.updatedAt) {
    response.updatedAt = document.updatedAt;
  }
  return response;
}

async function getSystemSettings() {
  const document = await loadFeatureToggleDocument();
  const homeEntries = document && document.homeEntries ? document.homeEntries : DEFAULT_HOME_ENTRIES;
  const normalizedHomeEntries = normalizeHomeEntries(homeEntries);
  const mergedHomeEntries = { ...DEFAULT_HOME_ENTRIES, ...normalizedHomeEntries };
  const backgroundCatalog = normalizeBackgroundCatalog(
    (document && document.globalBackgroundCatalog) || []
  );
  registerCustomBackgrounds(backgroundCatalog);
  const response = {
    homeEntries: cloneHomeEntries(mergedHomeEntries),
    globalBackground: cloneGlobalBackground(document && document.globalBackground),
    globalBackgroundCatalog: cloneGlobalBackgroundCatalog(backgroundCatalog)
  };
  if (document && document.updatedAt) {
    response.updatedAt = document.updatedAt;
  }
  return response;
}

function generateEquipmentInventoryId(itemId, obtainedAt = new Date()) {
  const base = typeof itemId === 'string' && itemId ? itemId : 'equipment';
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `eq-${base}-${timestamp}-${random}`;
}

function ensurePveRewardProfile(profile) {
  const base = profile && typeof profile === 'object' ? { ...profile } : {};
  const equipment = base.equipment && typeof base.equipment === 'object' ? { ...base.equipment } : {};
  equipment.inventory = Array.isArray(equipment.inventory)
    ? equipment.inventory.map((item) => ({ ...item }))
    : [];
  const storage = equipment.storage && typeof equipment.storage === 'object' ? { ...equipment.storage } : {};
  storage.categories = Array.isArray(storage.categories)
    ? storage.categories.map((category) => ({
        ...(category || {}),
        items: Array.isArray(category && category.items)
          ? category.items.map((item) => ({ ...item }))
          : []
      }))
    : [];
  equipment.storage = storage;
  base.equipment = equipment;

  const skills = base.skills && typeof base.skills === 'object' ? { ...base.skills } : {};
  skills.inventory = Array.isArray(skills.inventory)
    ? skills.inventory.map((item) => ({ ...item }))
    : [];
  skills.equipped = Array.isArray(skills.equipped) ? skills.equipped.slice() : [];
  base.skills = skills;

  return base;
}

function ensureStorageCategoryEntry(storage, key) {
  if (!storage || typeof storage !== 'object') {
    return { key, label: resolveStorageCategoryLabel(key), items: [] };
  }
  const categories = Array.isArray(storage.categories) ? storage.categories : [];
  let entry = categories.find((category) => category && category.key === key);
  if (!entry) {
    entry = { key, label: resolveStorageCategoryLabel(key), items: [] };
    categories.push(entry);
    storage.categories = categories;
  } else if (!Array.isArray(entry.items)) {
    entry.items = [];
  }
  entry.label = entry.label || resolveStorageCategoryLabel(key);
  return entry;
}

function applyStorageRewardMetadata(item, rewardType) {
  const meta = STORAGE_REWARD_META[rewardType] || {};
  if (meta.quality && !item.quality) {
    item.quality = meta.quality;
  }
  if (meta.qualityLabel && !item.qualityLabel) {
    item.qualityLabel = meta.qualityLabel;
  }
  if (meta.qualityColor && !item.qualityColor) {
    item.qualityColor = meta.qualityColor;
  }
  return item;
}

function resolveStorageRewardMediaKey(reward) {
  if (!reward || typeof reward !== 'object') {
    return '';
  }
  if (typeof reward.mediaKey === 'string' && reward.mediaKey.trim()) {
    return reward.mediaKey.trim();
  }
  const type = typeof reward.type === 'string' ? reward.type.trim() : '';
  if (type === 'background') {
    return 'item-1';
  }
  if (type === 'title') {
    return 'item-2';
  }
  if (type === 'skill') {
    return 'item-3';
  }
  const usageType =
    reward.usage && typeof reward.usage === 'object' && typeof reward.usage.type === 'string'
      ? reward.usage.type.trim()
      : '';
  if (usageType === 'skillDraw' || usageType === 'skillUnlock' || usageType === 'unlockSkill') {
    return 'item-3';
  }
  if (usageType === 'grantRight' || usageType === 'grantCoupon' || usageType === 'coupon') {
    return 'item-4';
  }
  if (type === 'right' || type === 'voucher' || type === 'coupon') {
    return 'item-4';
  }
  return '';
}

function createStorageRewardItem(reward, now = new Date()) {
  if (!reward || typeof reward !== 'object') {
    return null;
  }
  const defaultCategory = (() => {
    if (reward.type === 'background') {
      return 'consumable';
    }
    if (reward.type === 'title') {
      return 'consumable';
    }
    return 'consumable';
  })();
  const iconUrlCandidate = typeof reward.iconUrl === 'string' ? reward.iconUrl.trim() : '';
  const iconFallbackCandidate =
    typeof reward.iconFallbackUrl === 'string' ? reward.iconFallbackUrl.trim() : '';
  const legacyIconCandidate = typeof reward.icon === 'string' ? reward.icon.trim() : '';

  const iconUrl = iconUrlCandidate || legacyIconCandidate;
  const iconFallbackUrl = iconFallbackCandidate || iconUrl;

  const item = {
    inventoryId: generateStorageInventoryId(reward.storageItemId || reward.itemId || 'item', now),
    itemId: reward.storageItemId || reward.itemId || '',
    name: reward.name || '道具',
    shortName: reward.shortName || reward.name || '道具',
    description: reward.description || '',
    iconUrl,
    iconFallbackUrl,
    quality: reward.quality || '',
    qualityLabel: reward.qualityLabel || '',
    qualityColor: reward.qualityColor || '',
    storageCategory: reward.storageCategory || defaultCategory,
    slotLabel: reward.slotLabel || resolveStorageCategoryLabel(reward.storageCategory || defaultCategory),
    obtainedAt: now,
    mediaKey: resolveStorageRewardMediaKey(reward),
    actions:
      Array.isArray(reward.actions) && reward.actions.length
        ? reward.actions.map((action) => ({
            key: typeof action.key === 'string' ? action.key : '',
            label: typeof action.label === 'string' ? action.label : '',
            primary: !!action.primary
          })).filter((action) => action.key && action.label)
        : [{ key: 'use', label: '使用', primary: true }],
    usage: reward.usage ? { ...reward.usage } : null,
    locked: reward.locked === true,
    notes: Array.isArray(reward.notes) ? reward.notes.slice() : [],
    kind: reward.kind || 'storage'
  };
  applyStorageRewardMetadata(item, reward.type || 'consumable');
  if (reward.type === 'background') {
    item.storageCategory = 'consumable';
    if (!reward.slotLabel) {
      item.slotLabel = '背景';
    }
  }
  item.isNew = true;
  item.hasNew = true;
  item.hasNewBadge = true;
  if (Array.isArray(item.actions) && item.actions.length) {
    const primary = item.actions.find((action) => action.primary) || item.actions[0];
    item.primaryAction = primary || null;
  } else {
    item.actions = [];
    item.primaryAction = null;
  }
  return item;
}

function createEquipmentRewardEntry(reward, now = new Date()) {
  if (!reward || typeof reward !== 'object' || !reward.itemId) {
    return null;
  }
  const obtainedAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const entry = {
    inventoryId: generateEquipmentInventoryId(reward.itemId, obtainedAt),
    itemId: reward.itemId,
    obtainedAt,
    level: typeof reward.level === 'number' ? reward.level : 1,
    refine: typeof reward.refine === 'number' ? reward.refine : 0,
    favorite: false,
    storageCategory: 'equipment'
  };
  if (typeof reward.quality === 'string' && reward.quality) {
    entry.quality = reward.quality;
  }
  if (typeof reward.qualityLabel === 'string' && reward.qualityLabel) {
    entry.qualityLabel = reward.qualityLabel;
  }
  if (typeof reward.qualityColor === 'string' && reward.qualityColor) {
    entry.qualityColor = reward.qualityColor;
  }
  if (typeof reward.qualityRank === 'number') {
    entry.qualityRank = reward.qualityRank;
  }
  if (typeof reward.iconId === 'number') {
    entry.iconId = reward.iconId;
  }
  return entry;
}

function appendStorageItemToProfile(profile, item) {
  if (!profile || !item) {
    return profile;
  }
  const storage = profile.equipment && profile.equipment.storage ? profile.equipment.storage : null;
  if (!storage) {
    return profile;
  }
  const categoryKey = item.storageCategory || 'consumable';
  const category = ensureStorageCategoryEntry(storage, categoryKey);
  const alreadyExists = category.items.some((existing) => existing && existing.inventoryId === item.inventoryId);
  if (!alreadyExists) {
    if (item && typeof item === 'object') {
      if (typeof item.isNew !== 'boolean') {
        item.isNew = true;
      }
      if (typeof item.hasNew !== 'boolean') {
        item.hasNew = true;
      }
      if (typeof item.hasNewBadge !== 'boolean') {
        item.hasNewBadge = true;
      }
    }
    category.items.push(item);
  }
  return profile;
}

function removeStorageItemsByItemId(profile, itemId, quantity = 1) {
  if (!profile || !itemId) {
    return 0;
  }
  const equipment = profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : null;
  if (!equipment) {
    return 0;
  }
  const storage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : null;
  if (!storage || !Array.isArray(storage.categories)) {
    return 0;
  }
  const normalizedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  let remaining = normalizedQuantity;
  const categories = storage.categories.map((category) => {
    if (!category || !Array.isArray(category.items) || remaining <= 0) {
      return category;
    }
    const items = [];
    category.items.forEach((entry) => {
      if (remaining > 0 && entry && entry.itemId === itemId) {
        remaining -= 1;
      } else if (entry) {
        items.push(entry);
      }
    });
    return { ...category, items };
  });
  storage.categories = categories;
  return normalizedQuantity - remaining;
}

async function resolveMemberExtras(memberId) {
  if (!memberId) {
    return { avatarUnlocks: [], claimedLevelRewards: [] };
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
    if (!Array.isArray(extras.titleCatalog)) {
      extras.titleCatalog = [];
    }
    if (!Array.isArray(extras.backgroundUnlocks)) {
      extras.backgroundUnlocks = [];
    }
    if (!Array.isArray(extras.backgroundCatalog)) {
      extras.backgroundCatalog = [];
    }
    if (!Array.isArray(extras.deliveredLevelRewards)) {
      extras.deliveredLevelRewards = [];
    }
    return extras;
  }
  const now = new Date();
  const data = {
    avatarUnlocks: [],
    claimedLevelRewards: [],
    wineStorage: [],
    titleUnlocks: [],
    titleCatalog: [],
    backgroundUnlocks: [],
    backgroundCatalog: [],
    deliveredLevelRewards: [],
    createdAt: now,
    updatedAt: now
  };
  await collection
    .doc(memberId)
    .set({ data })
    .catch(() => {});
  return data;
}

async function updateMemberExtras(memberId, updates = {}) {
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
              titleCatalog: [],
              backgroundUnlocks: [],
              backgroundCatalog: [],
              deliveredLevelRewards: []
            }
          })
          .catch(() => {});
      }
    });
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function buildRenameTraceId(entry) {
  if (!entry) {
    return '';
  }
  const previous = typeof entry.previous === 'string' ? entry.previous.trim() : '';
  const current = typeof entry.current === 'string' ? entry.current.trim() : '';
  const changedAt = entry.changedAt ? new Date(entry.changedAt) : new Date();
  const timestamp = Number.isNaN(changedAt.getTime()) ? Date.now() : changedAt.getTime();
  return `${previous}|${current}|${timestamp}`;
}

function normalizeRenameLogEntry(entry, { source = 'manual' } = {}) {
  if (!entry) {
    return null;
  }
  const previous = typeof entry.previous === 'string' ? entry.previous.trim() : '';
  const current = typeof entry.current === 'string' ? entry.current.trim() : '';
  const rawChangedAt = entry.changedAt ? new Date(entry.changedAt) : new Date();
  const changedAt = Number.isNaN(rawChangedAt.getTime()) ? new Date() : rawChangedAt;
  const safeSource = typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : source;
  if (!current && !previous) {
    return null;
  }
  return {
    previous,
    current,
    changedAt,
    source: safeSource,
    traceId: buildRenameTraceId({ previous, current, changedAt })
  };
}

async function appendRenameTimeline(memberId, entry, options = {}) {
  const normalized = normalizeRenameLogEntry(entry, options);
  if (!memberId || !normalized) {
    return;
  }
  const collection = db.collection(COLLECTIONS.MEMBER_TIMELINE);
  if (!options.skipDuplicateCheck) {
    const exists = await collection
      .where({ memberId, type: 'rename', traceId: normalized.traceId })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    if (exists.data && exists.data.length) {
      return;
    }
  }
  await collection.add({
    data: {
      memberId,
      type: 'rename',
      traceId: normalized.traceId,
      previous: normalized.previous,
      current: normalized.current,
      source: normalized.source,
      changedAt: normalized.changedAt,
      createdAt: new Date()
    }
  });
}

async function loadRenameTimeline(memberId, limit = 20) {
  if (!memberId) {
    return [];
  }
  const collection = db.collection(COLLECTIONS.MEMBER_TIMELINE);
  const snapshot = await collection
    .where({ memberId, type: 'rename' })
    .orderBy('changedAt', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(Math.max(1, Math.min(limit, 50)))
    .get()
    .catch(() => ({ data: [] }));
  return (snapshot.data || []).map((item) => ({
    previous: item.previous || '',
    current: item.current || '',
    changedAt: item.changedAt || item.createdAt || new Date(),
    source: item.source || 'manual'
  }));
}

async function migrateRenameHistoryField(member) {
  if (!member || !member._id) {
    return;
  }
  if (!Array.isArray(member.renameHistory) || !member.renameHistory.length) {
    return;
  }
  const tasks = member.renameHistory
    .slice(-50)
    .map((entry) => appendRenameTimeline(member._id, entry));
  if (tasks.length) {
    await Promise.all(tasks);
  }
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(member._id)
    .update({
      data: {
        renameHistory: _.remove(),
        updatedAt: new Date()
      }
    })
    .catch(() => {});
  member.renameHistory = [];
}

function normalizeProxyMemberId(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function sanitizeProxySessionPayload(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }
  const targetMemberId = normalizeProxyMemberId(session.targetMemberId);
  if (!targetMemberId) {
    return null;
  }
  const payload = {
    sessionId: session.sessionId || '',
    adminId: normalizeProxyMemberId(session.adminId) || '',
    adminName: typeof session.adminName === 'string' ? session.adminName : '',
    targetMemberId,
    targetMemberName: typeof session.targetMemberName === 'string' ? session.targetMemberName : '',
    startedAt: session.startedAt || session.createdAt || session.updatedAt || null,
    active: session.active !== false
  };
  if (session.endedAt) {
    payload.endedAt = session.endedAt;
  }
  return payload;
}

async function resolveProxySessionForAdmin(adminId) {
  const normalizedAdminId = normalizeProxyMemberId(adminId);
  if (!normalizedAdminId) {
    return null;
  }
  try {
    const snapshot = await db.collection(PROXY_SESSION_COLLECTION).doc(normalizedAdminId).get();
    if (!snapshot || !snapshot.data) {
      return null;
    }
    const session = { ...snapshot.data };
    if (session.active === false) {
      return null;
    }
    if (!session.sessionId) {
      session.sessionId = `proxy_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    }
    if (!session.adminId) {
      session.adminId = normalizedAdminId;
    }
    if (!session.startedAt && (session.createdAt || session.updatedAt)) {
      session.startedAt = session.createdAt || session.updatedAt;
    }
    return sanitizeProxySessionPayload(session);
  } catch (error) {
    if (isCollectionNotExistsError(error)) {
      return null;
    }
    console.error('[member] 获取代理会话失败', error);
    return null;
  }
}

function sanitizeProxyActionEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const allowedKeys = [
    'action',
    'type',
    'operation',
    'memberId',
    'targetId',
    'levelId',
    'amount',
    'remark',
    'updates',
    'profile'
  ];
  const payload = {};
  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(event, key)) {
      return;
    }
    const value = event[key];
    if (value === null || typeof value === 'undefined') {
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      payload[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      payload[key] = value
        .filter((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        .slice(0, 5);
      return;
    }
    if (typeof value === 'object') {
      try {
        payload[key] = JSON.parse(JSON.stringify(value));
      } catch (error) {
        payload[key] = '[object]';
      }
    }
  });
  return Object.keys(payload).length ? payload : null;
}

async function recordProxyActionUsage(session, actorId, action, event = {}) {
  if (!session || !session.sessionId) {
    return;
  }
  try {
    await ensureProxyLogCollection();
    const collection = db.collection(PROXY_LOG_COLLECTION);
    const payload = {
      sessionId: session.sessionId,
      type: 'action',
      adminId: session.adminId || actorId,
      adminName: session.adminName || '',
      actorId: actorId || session.adminId || '',
      targetMemberId: session.targetMemberId || '',
      targetMemberName: session.targetMemberName || '',
      action: action || '',
      createdAt: new Date()
    };
    const detail = sanitizeProxyActionEvent(event);
    if (detail) {
      payload.detail = detail;
    }
    await collection.add({ data: payload }).catch((error) => {
      console.error('[member] record proxy action failed', error);
      throw error;
    });
  } catch (error) {
    console.error('[member] record proxy action failed', error);
    throw error;
  }
}

function attachProxySession(member, session) {
  if (!member) {
    return member;
  }
  if (!session) {
    if (member.proxySession) {
      const clone = { ...member };
      delete clone.proxySession;
      return clone;
    }
    return member;
  }
  const sanitized = sanitizeProxySessionPayload(session);
  if (!sanitized) {
    if (member.proxySession) {
      const clone = { ...member };
      delete clone.proxySession;
      return clone;
    }
    return member;
  }
  return { ...member, proxySession: sanitized };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';
  const proxySession = await resolveProxySessionForAdmin(OPENID);
  const memberOpenId = proxySession && proxySession.targetMemberId ? proxySession.targetMemberId : OPENID;

  if (proxySession) {
    await recordProxyActionUsage(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'init':
      return initMember(memberOpenId, event.profile || {}, event || {}, { proxySession, actorId: OPENID });
    case 'profile':
      return getProfile(memberOpenId, event || {}, { proxySession, actorId: OPENID });
    case 'progress':
      return getProgress(memberOpenId, event || {}, { proxySession, actorId: OPENID });
    case 'rights':
      return getRights(memberOpenId);
    case 'claimLevelReward':
      return claimLevelReward(memberOpenId, event.levelId, { proxySession, actorId: OPENID });
    case 'completeProfile':
      return completeProfile(memberOpenId, event, { proxySession, actorId: OPENID });
    case 'updateArchive':
      return updateArchive(memberOpenId, event.updates || {}, { proxySession, actorId: OPENID });
    case 'redeemRenameCard':
      return redeemRenameCard(memberOpenId, event.count || 1, { proxySession, actorId: OPENID });
    case 'breakthrough':
      return breakthrough(memberOpenId, { proxySession, actorId: OPENID });
    case 'cacheVersions':
      return getCacheVersions();
    case 'systemSettings':
      return getSystemSettings();
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function initMember(openid, profile = {}, options = {}, context = {}) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const exist = await membersCollection.doc(openid).get().catch(() => null);
  if (exist && exist.data) {
    return attachProxySession({ ...exist.data }, context.proxySession);
  }

  const levels = await loadLevels();
  const defaultLevel = levels[0];
  const now = new Date();
  const envVersion = resolveClientEnvVersion(options);
  const profileRoles = Array.isArray(profile.roles) ? profile.roles : [];
  const sanitizedRoles = profileRoles
    .map((role) => (typeof role === 'string' ? role.trim() : ''))
    .filter((role) => ALLOWED_MEMBER_ROLES.has(role));
  const desiredRoles = new Set(sanitizedRoles);
  desiredRoles.add('member');
  if (shouldAssignTestRole(envVersion)) {
    desiredRoles.add('test');
  }
  const roles = Array.from(desiredRoles).filter((role) => ALLOWED_MEMBER_ROLES.has(role));

  const doc = {
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    avatarFrame: normalizeAvatarFrameValue(profile.avatarFrame || ''),
    appearanceBackground: normalizeBackgroundId(profile.appearanceBackground || '') || getDefaultBackgroundId(),
    appearanceBackgroundAnimated: normalizeBooleanFlag(profile.appearanceBackgroundAnimated, false),
    appearanceTitle: '',
    mobile: profile.mobile || '',
    gender: normalizeGender(profile.gender),
    levelId: defaultLevel ? defaultLevel._id : '',
    experience: 0,
    cashBalance: 0,
    totalRecharge: 0,
    totalSpend: 0,
    stoneBalance: 0,
    roles: roles.length ? roles : ['member'],
    createdAt: now,
    updatedAt: now,
    avatarConfig: {},
    renameCredits: 1,
    renameUsed: 0,
    renameCards: 0,
    pendingBreakthroughLevelId: '',
    roomUsageCount: 0,
    reservationBadges: {
      memberVersion: 0,
      memberSeenVersion: 0,
      adminVersion: 0,
      adminSeenVersion: 0,
      pendingApprovalCount: 0
    }
  };
  await membersCollection
    .doc(openid)
    .set({ data: doc })
    .catch(async (error) => {
      if (error && /already exist|duplicate/i.test(error.errMsg || '')) {
        return;
      }
      throw error;
    });
  await db
    .collection(COLLECTIONS.MEMBER_EXTRAS)
    .doc(openid)
    .set({
      data: {
        avatarUnlocks: [],
        titleUnlocks: [],
        titleCatalog: [],
        claimedLevelRewards: [],
        deliveredLevelRewards: [],
        createdAt: now,
        updatedAt: now
      }
    })
    .catch(() => {});
  return attachProxySession({ ...doc, _id: openid }, context.proxySession);
}

async function getProfile(openid, options = {}, context = {}) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, options.profile || {}, options, context);
    return getProfile(openid, options, context);
  }
  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: withDefaults } = await ensureArchiveDefaults(normalized);
  const synced = await ensureLevelSync(withDefaults, levels);
  return attachProxySession(decorateMember(synced, levels), context.proxySession);
}

async function getProgress(openid, options = {}, context = {}) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, options.profile || {}, options, context);
    return getProgress(openid, options, context);
  }
  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: withDefaults } = await ensureArchiveDefaults(normalized);
  const member = await ensureLevelSync(withDefaults, levels);
  const currentLevel = levels.find((lvl) => lvl._id === member.levelId) || levels[0];
  const nextLevel = getNextLevel(levels, currentLevel);
  const percentage = calculatePercentage(member.experience, currentLevel, nextLevel);
  const nextDiff = nextLevel ? Math.max(nextLevel.threshold - member.experience, 0) : 0;
  const claimedLevelRewards = normalizeClaimedLevelRewards(member.claimedLevelRewards, levels);
  const experience = Number(member.experience || 0);
  const decoratedMember = attachProxySession(decorateMember(member, levels), context.proxySession);
  return {
    member: decoratedMember,
    levels: levels.map((lvl) => {
      const regularRights = resolveRegularLevelRights(lvl);
      return {
        _id: lvl._id,
        name: lvl.displayName || lvl.name,
        displayName: lvl.displayName || lvl.name,
        shortName: lvl.name,
        threshold: lvl.threshold,
        discount: lvl.discount,
        order: lvl.order,
        realm: lvl.realm,
        realmShort: lvl.realmShort || '',
        realmId: lvl.realmId || '',
        realmOrder: lvl.realmOrder || lvl.order,
        realmDescription: lvl.realmDescription || '',
        subLevel: lvl.subLevel || 1,
        subLevelLabel: lvl.subLevelLabel || '',
        virtualRewards: Array.isArray(lvl.virtualRewards) ? lvl.virtualRewards : [],
        milestoneReward: lvl.milestoneReward || '',
        milestoneType: lvl.milestoneType || '',
        rewards: regularRights.map((reward) => reward.description || reward.name || ''),
        hasRewards: hasLevelRewards(lvl),
        claimed: claimedLevelRewards.includes(lvl._id),
        reached: experience >= (typeof lvl.threshold === 'number' ? lvl.threshold : 0),
        claimable:
          hasLevelRewards(lvl) &&
          experience >= (typeof lvl.threshold === 'number' ? lvl.threshold : 0) &&
          !claimedLevelRewards.includes(lvl._id)
      };
    }),
    claimedLevelRewards,
    percentage,
    nextDiff,
    currentLevel,
    nextLevel
  };
}

async function getRights(openid) {
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const [rightsSnapshot, masterMap] = await Promise.all([
    rightsCollection
      .where({ memberId: openid })
      .orderBy('issuedAt', 'desc')
      .get(),
    loadMembershipRightsMap()
  ]);

  const now = Date.now();
  return rightsSnapshot.data.map((item) => {
    const right = masterMap[item.rightId] || {};
    const expired = item.validUntil && new Date(item.validUntil).getTime() < now;
    const status = expired ? 'expired' : item.status || 'active';
    const statusLabel = statusLabelMap[status] || '待使用';
    const mergedMeta = { ...(right.meta || {}), ...(item.meta || {}) };
    const usageCredits = Number(mergedMeta.roomUsageCount || mergedMeta.roomUsageCredits || 0);
    return {
      _id: item._id,
      rightId: item.rightId || '',
      name: right.name || item.name || '权益',
      description: right.description || item.description || '',
      status,
      statusLabel,
      validUntil: item.validUntil || right.defaultValidUntil || '',
      canReserve: !!right.applyReservation && status === 'active',
      canRedeemRoomUsage: usageCredits > 0 && status === 'active',
      roomUsageCredits: usageCredits,
      meta: mergedMeta
    };
  });
}

async function completeProfile(openid, payload = {}, context = {}) {
  const profile = payload.profile || {};
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);

  const nickName = typeof profile.nickName === 'string' ? profile.nickName.trim() : '';
  const avatarUrl = typeof profile.avatarUrl === 'string' ? profile.avatarUrl : '';
  const hasAvatarFrame = Object.prototype.hasOwnProperty.call(profile, 'avatarFrame');
  const avatarFrame = hasAvatarFrame ? normalizeAvatarFrameValue(profile.avatarFrame || '') : '';
  const genderValue = normalizeGender(profile.gender);
  const mobile = await resolveMobile(payload);

  const updates = {};
  if (nickName) {
    updates.nickName = nickName;
  }
  if (avatarUrl) {
    updates.avatarUrl = avatarUrl;
  }
  if (mobile) {
    updates.mobile = mobile;
  }
  if (typeof profile.gender !== 'undefined' && profile.gender !== null) {
    updates.gender = genderValue;
  }
  if (hasAvatarFrame) {
    updates.avatarFrame = avatarFrame;
  }

  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {
      nickName,
      avatarUrl,
      avatarFrame,
      mobile,
      gender: genderValue
    }, {}, context);
    return getProfile(openid, {}, context);
  }

  if (!Object.keys(updates).length) {
    const levels = await loadLevels();
    return attachProxySession(decorateMember(normalizeAssetFields(existing.data), levels), context.proxySession);
  }

  updates.updatedAt = new Date();
  await membersCollection.doc(openid).update({
    data: updates
  });

  return getProfile(openid, {}, context);
}

async function resolveMobile(payload) {
  if (!payload) return '';
  const { phone, phoneNumber, phoneCode } = payload;
  if (phone && typeof phone === 'object') {
    if (phone.data && phone.data.phoneNumber) {
      return String(phone.data.phoneNumber).trim();
    }
    if (phone.phoneNumber) {
      return String(phone.phoneNumber).trim();
    }
  }
  if (typeof phoneCode === 'string' && phoneCode.trim()) {
    try {
      const res = await cloud.openapi.wxa.business.getUserPhoneNumber({
        code: phoneCode.trim()
      });
      if (res && res.phoneInfo && res.phoneInfo.phoneNumber) {
        return String(res.phoneInfo.phoneNumber).trim();
      }
    } catch (error) {
      console.error('[member:resolveMobile] getUserPhoneNumber failed', error);
    }
  }
  if (typeof phoneNumber === 'string') {
    return phoneNumber.trim();
  }
  if (payload.profile && typeof payload.profile.mobile === 'string') {
    return payload.profile.mobile.trim();
  }
  return '';
}

const statusLabelMap = {
  active: '可使用',
  used: '已使用',
  expired: '已过期',
  locked: '预约中'
};

async function ensureLevelSync(member, levels) {
  if (!levels.length || !member || !member._id) {
    return member;
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const experience = Number(member.experience || 0);
  const sortedLevels = [...levels].sort((a, b) => a.order - b.order);
  let currentLevel = sortedLevels.find((lvl) => lvl && lvl._id === member.levelId) || sortedLevels[0];

  if (currentLevel && currentLevel._id !== member.levelId) {
    await membersCollection
      .doc(member._id)
      .update({
        data: {
          levelId: currentLevel._id,
          updatedAt: new Date()
        }
      })
      .catch(() => {});
    member.levelId = currentLevel._id;
  }

  let pendingId = typeof member.pendingBreakthroughLevelId === 'string' ? member.pendingBreakthroughLevelId : '';
  let pendingLevel = pendingId ? levels.find((lvl) => lvl && lvl._id === pendingId) : null;

  if (
    pendingId &&
    (!pendingLevel ||
      !requiresBreakthrough(currentLevel, pendingLevel) ||
      experience < (typeof pendingLevel.threshold === 'number' ? pendingLevel.threshold : Number.POSITIVE_INFINITY))
  ) {
    pendingId = '';
    pendingLevel = null;
    if (member.pendingBreakthroughLevelId) {
      await membersCollection
        .doc(member._id)
        .update({
          data: {
            pendingBreakthroughLevelId: '',
            updatedAt: new Date()
          }
        })
        .catch(() => {});
      member.pendingBreakthroughLevelId = '';
    }
  }

  if (currentLevel) {
    let downgradeTarget = currentLevel;
    while (downgradeTarget && experience < getLevelThreshold(downgradeTarget)) {
      const previous = getPreviousLevel(sortedLevels, downgradeTarget);
      if (!previous) {
        break;
      }
      downgradeTarget = previous;
    }
    if (downgradeTarget && downgradeTarget._id !== currentLevel._id) {
      await membersCollection
        .doc(member._id)
        .update({
          data: {
            levelId: downgradeTarget._id,
            pendingBreakthroughLevelId: '',
            updatedAt: new Date()
          }
        })
        .catch(() => {});
      member.levelId = downgradeTarget._id;
      member.pendingBreakthroughLevelId = '';
      currentLevel = downgradeTarget;
      pendingId = '';
      pendingLevel = null;
    }
  }

  while (true) {
    const nextLevel = getNextLevel(levels, currentLevel);
    if (!nextLevel) {
      break;
    }
    const threshold = typeof nextLevel.threshold === 'number' ? nextLevel.threshold : Number.POSITIVE_INFINITY;
    if (experience < threshold) {
      break;
    }
    if (requiresBreakthrough(currentLevel, nextLevel)) {
      if (pendingId !== nextLevel._id) {
        pendingId = nextLevel._id;
        await membersCollection
          .doc(member._id)
          .update({
            data: {
              pendingBreakthroughLevelId: nextLevel._id,
              updatedAt: new Date()
            }
          })
          .catch(() => {});
      }
      member.pendingBreakthroughLevelId = pendingId;
      break;
    }

    await membersCollection
      .doc(member._id)
      .update({
        data: {
          levelId: nextLevel._id,
          pendingBreakthroughLevelId: '',
          updatedAt: new Date()
        }
      })
      .catch(() => {});
    member.levelId = nextLevel._id;
    member.pendingBreakthroughLevelId = '';
    currentLevel = nextLevel;
  }

  return member;
}

function resolveLevelByExperience(exp, levels) {
  let target = levels[0];
  levels.forEach((lvl) => {
    if (exp >= lvl.threshold) {
      target = lvl;
    }
  });
  return target;
}

function getNextLevel(levels, currentLevel) {
  if (!currentLevel) return null;
  const sorted = [...levels].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((item) => item._id === currentLevel._id);
  if (idx < 0 || idx === sorted.length - 1) {
    return null;
  }
  return sorted[idx + 1];
}

function getPreviousLevel(levels, currentLevel) {
  if (!currentLevel) return null;
  const sorted = [...levels].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((item) => item._id === currentLevel._id);
  if (idx <= 0) {
    return null;
  }
  return sorted[idx - 1];
}

function getLevelThreshold(level) {
  if (!level || typeof level.threshold !== 'number') {
    return Number.POSITIVE_INFINITY;
  }
  const value = Number(level.threshold);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function calculatePercentage(exp, currentLevel, nextLevel) {
  if (!currentLevel || !nextLevel) {
    return 100;
  }
  const delta = nextLevel.threshold - currentLevel.threshold;
  if (delta <= 0) {
    return 100;
  }
  return Math.min(100, Math.round(((exp - currentLevel.threshold) / delta) * 100));
}

function resolveSubLevel(level) {
  if (!level) {
    return 1;
  }
  if (typeof level.subLevel === 'number' && Number.isFinite(level.subLevel)) {
    return Math.max(1, Math.floor(level.subLevel));
  }
  if (typeof level.order === 'number' && Number.isFinite(level.order)) {
    const perRealm = SUB_LEVEL_COUNT > 0 ? SUB_LEVEL_COUNT : 10;
    return Math.max(1, ((Math.floor(level.order) - 1) % perRealm) + 1);
  }
  return 1;
}

function findRealmConfigForLevel(level) {
  if (!level || !Array.isArray(realmConfigs) || !realmConfigs.length) {
    return null;
  }

  const realmId = typeof level.realmId === 'string' ? level.realmId.trim() : '';
  if (realmId) {
    const indexById = realmConfigs.findIndex((realm) => realm && realm.id === realmId);
    if (indexById >= 0) {
      return { config: realmConfigs[indexById], index: indexById };
    }
  }

  const realmName = typeof level.realm === 'string' ? level.realm.trim() : '';
  if (realmName) {
    const indexByName = realmConfigs.findIndex(
      (realm) => realm && (realm.name === realmName || realm.shortName === realmName)
    );
    if (indexByName >= 0) {
      return { config: realmConfigs[indexByName], index: indexByName };
    }
  }

  if (typeof level.realmOrder === 'number' && Number.isFinite(level.realmOrder)) {
    const realmIndex = Math.max(0, Math.floor(level.realmOrder) - 1);
    if (realmConfigs[realmIndex]) {
      return { config: realmConfigs[realmIndex], index: realmIndex };
    }
  }

  if (typeof level.order === 'number' && Number.isFinite(level.order) && SUB_LEVEL_COUNT > 0) {
    const realmIndex = Math.max(0, Math.floor((Math.floor(level.order) - 1) / SUB_LEVEL_COUNT));
    if (realmConfigs[realmIndex]) {
      return { config: realmConfigs[realmIndex], index: realmIndex };
    }
  }

  return null;
}

function normalizeConfigRewardEntry(entry) {
  if (Array.isArray(entry)) {
    return entry
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => !!item);
  }
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeMilestoneInventory(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      return { ...item };
    })
    .filter((item) => !!item);
}

function applyRealmConfigOverrides(levels = []) {
  if (!Array.isArray(levels) || !levels.length) {
    return levels || [];
  }

  return levels.map((level) => {
    if (!level) {
      return level;
    }
    const matched = findRealmConfigForLevel(level);
    if (!matched) {
      return level;
    }

    const { config } = matched;
    const overrides = {};
    const subIndex = Math.max(0, resolveSubLevel(level) - 1);
    const rewardsList = Array.isArray(config.virtualRewards) ? config.virtualRewards : [];

    if (subIndex < rewardsList.length) {
      const normalizedRewards = normalizeConfigRewardEntry(rewardsList[subIndex]);
      if (normalizedRewards.length) {
        overrides.virtualRewards = normalizedRewards;
      }
    }

    let isFinalSubLevel = false;
    if (SUB_LEVEL_COUNT > 0) {
      isFinalSubLevel = subIndex >= SUB_LEVEL_COUNT - 1;
    } else if (rewardsList.length > 0) {
      isFinalSubLevel = subIndex >= rewardsList.length - 1;
    }

    if (isFinalSubLevel && config.milestone) {
      overrides.milestoneReward = config.milestone.summary || level.milestoneReward || '';
      overrides.milestoneType = config.milestone.type || level.milestoneType || '';
      const milestoneRightIds = new Set();
      const milestoneRights = Array.isArray(config.milestone.rights)
        ? config.milestone.rights.filter((item) => item && item.rightId)
        : [];
      if (milestoneRights.length) {
        overrides.breakthroughRewards = milestoneRights.map((item) => {
          if (typeof item.rightId === 'string' && item.rightId.trim()) {
            milestoneRightIds.add(item.rightId.trim());
          }
          return {
            rightId: item.rightId,
            quantity: item.quantity || 1,
            description: item.description || ''
          };
        });
      }
      if (Array.isArray(config.milestone.items) && config.milestone.items.length) {
        const milestoneInventory = normalizeMilestoneInventory(config.milestone.items);
        if (milestoneInventory.length) {
          overrides.breakthroughInventory = milestoneInventory;
          milestoneInventory.forEach((item) => {
            if (!item || typeof item !== 'object') {
              return;
            }
            if (typeof item.rightId === 'string' && item.rightId.trim()) {
              milestoneRightIds.add(item.rightId.trim());
              return;
            }
            const usage = item.usage && typeof item.usage === 'object' ? item.usage : null;
            if (!usage) {
              return;
            }
            const usageType = typeof usage.type === 'string' ? usage.type.trim().toLowerCase() : '';
            if (usageType === 'grantright' || usageType === 'grantcoupon' || usageType === 'coupon') {
              if (typeof usage.rightId === 'string' && usage.rightId.trim()) {
                milestoneRightIds.add(usage.rightId.trim());
              }
            }
          });
        }
      }
      if (milestoneRightIds.size && Array.isArray(level.rewards) && level.rewards.length) {
        const filteredRewards = level.rewards.filter((reward) => {
          if (!reward || typeof reward.rightId !== 'string') {
            return true;
          }
          const trimmed = reward.rightId.trim();
          if (!trimmed) {
            return true;
          }
          return !milestoneRightIds.has(trimmed);
        });
        if (filteredRewards.length !== level.rewards.length) {
          overrides.rewards = filteredRewards;
        }
      }
    }

    if (config.description) {
      overrides.realmDescription = config.description;
    }

    if (config.id) {
      overrides.realmId = config.id;
    }

    if (config.shortName) {
      overrides.realmShort = config.shortName;
    }

    if (config.name) {
      overrides.realm = config.name;
    }

    return Object.keys(overrides).length ? { ...level, ...overrides } : level;
  });
}

function requiresBreakthrough(currentLevel, nextLevel) {
  if (!currentLevel || !nextLevel) {
    return false;
  }
  const currentRealm = resolveRealmOrderFromLevel(currentLevel);
  const nextRealm = resolveRealmOrderFromLevel(nextLevel);
  if (nextRealm <= currentRealm) {
    return false;
  }
  return resolveSubLevel(currentLevel) >= 10;
}

function hasLevelRewards(level) {
  if (!level) return false;
  if (Array.isArray(level.virtualRewards) && level.virtualRewards.length) {
    return true;
  }
  const regularRights = resolveRegularLevelRights(level);
  return regularRights.length > 0;
}

async function loadMembershipRightsMap() {
  const collection = db.collection(COLLECTIONS.RIGHTS_MASTER);
  const PAGE_SIZE = 100;
  const masterMap = {};
  let fetched = 0;
  while (true) {
    const snapshot = await collection
      .skip(fetched)
      .limit(PAGE_SIZE)
      .get()
      .catch(() => ({ data: [] }));
    const items = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!items.length) {
      break;
    }
    items.forEach((item) => {
      if (!item || typeof item._id !== 'string') {
        return;
      }
      const id = item._id.trim();
      if (!id) {
        return;
      }
      masterMap[id] = item;
    });
    fetched += items.length;
    if (items.length < PAGE_SIZE) {
      break;
    }
  }
  return masterMap;
}

async function grantRightsForSourceLevel(openid, level, rewards = []) {
  if (!level || !Array.isArray(rewards) || !rewards.length) {
    return;
  }
  const levelId = typeof level._id === 'string' ? level._id : '';
  if (!levelId) {
    return;
  }
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  const masterMap = await loadMembershipRightsMap();

  for (const reward of rewards) {
    if (!reward || !reward.rightId) {
      continue;
    }
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({
        memberId: openid,
        rightId: reward.rightId,
        levelId
      })
      .get();
    const numericQuantity = Number(reward.quantity);
    const needQuantity = Number.isFinite(numericQuantity) ? Math.max(1, Math.floor(numericQuantity)) : 1;
    const already = existing.data.length;
    if (already >= needQuantity) {
      continue;
    }
    const diff = needQuantity - already;
    for (let i = 0; i < diff; i += 1) {
      const validUntil = right.validDays
        ? new Date(now.getTime() + right.validDays * 24 * 60 * 60 * 1000)
        : null;
      await rightsCollection.add({
        data: {
          memberId: openid,
          rightId: reward.rightId,
          levelId,
          status: 'active',
          issuedAt: now,
          validUntil,
          meta: {
            fromLevel: levelId,
            rewardName: reward.description || right.name
          }
        }
      });
    }
  }
}

async function applyInventoryRewardsForLevel(openid, level, rewards, deliveryKey) {
  const normalizedRewards = Array.isArray(rewards)
    ? rewards.filter((reward) => reward && typeof reward === 'object')
    : [];
  if (!normalizedRewards.length) {
    return;
  }
  const memberId = typeof openid === 'string' ? openid : '';
  if (!memberId) {
    return;
  }

  const extras = await resolveMemberExtras(memberId);
  const delivered = Array.isArray(extras.deliveredLevelRewards) ? extras.deliveredLevelRewards : [];
  if (deliveryKey && delivered.includes(deliveryKey)) {
    return;
  }
  const backgroundUnlocks = Array.isArray(extras.backgroundUnlocks) ? extras.backgroundUnlocks : [];
  const backgroundUnlockSet = new Set(backgroundUnlocks);

  const memberSnapshot = await db.collection(COLLECTIONS.MEMBERS).doc(memberId).get().catch(() => null);
  if (!memberSnapshot || !memberSnapshot.data) {
    return;
  }

  const now = new Date();
  const profile = ensurePveRewardProfile(memberSnapshot.data.pveProfile);
  let profileChanged = false;
  let extrasChanged = false;

  for (const reward of normalizedRewards) {
    if (reward.type === 'equipment' && reward.itemId) {
      const rewardRefine = typeof reward.refine === 'number' ? Math.max(0, Math.floor(reward.refine)) : 0;
      const existingIndex = profile.equipment.inventory.findIndex(
        (entry) => entry && entry.itemId === reward.itemId
      );
      if (existingIndex === -1) {
        const equipmentEntry = createEquipmentRewardEntry({ ...reward, refine: rewardRefine }, now);
        if (equipmentEntry) {
          profile.equipment.inventory.push(equipmentEntry);
          profileChanged = true;
        }
      } else {
        const existingEntry = profile.equipment.inventory[existingIndex];
        const currentRefine = Math.max(0, Math.floor(Number(existingEntry.refine) || 0));
        if (rewardRefine > currentRefine) {
          profile.equipment.inventory[existingIndex] = {
            ...existingEntry,
            refine: rewardRefine,
            obtainedAt: existingEntry.obtainedAt || now
          };
          profileChanged = true;
        }
      }
      continue;
    }
    if (reward.type === 'skill' && reward.skillId) {
      const hasSkill = profile.skills.inventory.some((entry) => entry && entry.skillId === reward.skillId);
      if (!hasSkill) {
        profile.skills.inventory.push({ skillId: reward.skillId, obtainedAt: now, level: 1, duplicates: 0 });
        profileChanged = true;
      }
      continue;
    }
    if (reward.type === 'background' && reward.backgroundId) {
      const backgroundId = normalizeBackgroundId(reward.backgroundId);
      if (!backgroundId) {
        continue;
      }
      if (reward.autoUnlock) {
        if (!backgroundUnlockSet.has(backgroundId)) {
          backgroundUnlockSet.add(backgroundId);
          extrasChanged = true;
        }
        continue;
      }
    }
    if (['title', 'background', 'consumable'].includes(reward.type)) {
      const storageItem = createStorageRewardItem(reward, now);
      if (storageItem) {
        appendStorageItemToProfile(profile, storageItem);
        profileChanged = true;
      }
    }
  }

  if (profileChanged) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: {
          pveProfile: _.set(profile),
          updatedAt: now
        }
      })
      .catch(() => {});
  }

  const deliveredSet = new Set(delivered);
  if (deliveryKey) {
    deliveredSet.add(deliveryKey);
  }
  const extrasUpdate = { deliveredLevelRewards: Array.from(deliveredSet) };
  if (extrasChanged) {
    extrasUpdate.backgroundUnlocks = Array.from(backgroundUnlockSet);
  }
  await updateMemberExtras(memberId, extrasUpdate);
}

async function grantInventoryRewardsForLevel(openid, level) {
  if (!level) {
    return;
  }
  const baseRewards = LEVEL_REWARD_CONFIG[level._id] || [];
  const deliveryKey = typeof level._id === 'string' ? level._id : '';
  await applyInventoryRewardsForLevel(openid, level, baseRewards, deliveryKey);
}

async function grantBreakthroughInventoryRewards(openid, level) {
  if (!level) {
    return;
  }
  const milestoneRewards = Array.isArray(level.breakthroughInventory) ? level.breakthroughInventory : [];
  if (!milestoneRewards.length) {
    return;
  }
  const levelId = typeof level._id === 'string' ? level._id : '';
  if (!levelId) {
    return;
  }
  const deliveryKey = `${levelId}${BREAKTHROUGH_DELIVERY_SUFFIX}`;
  await applyInventoryRewardsForLevel(openid, level, milestoneRewards, deliveryKey);
}

async function grantLevelRewards(openid, level, levels) {
  const regularRights = resolveRegularLevelRights(level);
  if (regularRights.length) {
    await grantRightsForSourceLevel(openid, level, regularRights);
  }
  await grantInventoryRewardsForLevel(openid, level);
}

async function grantBreakthroughRewardsForLevel(openid, level) {
  if (!level) {
    return;
  }
  const milestoneRights = Array.isArray(level.breakthroughRewards) ? level.breakthroughRewards : [];
  if (milestoneRights.length) {
    await grantRightsForSourceLevel(openid, level, milestoneRights);
  }
  await grantBreakthroughInventoryRewards(openid, level);
}

async function loadLevels() {
  const snapshot = await db.collection(COLLECTIONS.LEVELS).orderBy('order', 'asc').get();
  const levels = snapshot.data || [];
  return applyRealmConfigOverrides(levels);
}

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.errMsg = message || code;
  return error;
}

function normalizeGender(value) {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'male' || lower === 'man' || lower === 'm' || lower === '男') {
      return 'male';
    }
    if (lower === 'female' || lower === 'woman' || lower === 'f' || lower === '女') {
      return 'female';
    }
    if (lower === 'unknown' || lower === 'secret' || lower === '保密') {
      return 'unknown';
    }
  }
  if (typeof value === 'number') {
    if (value === 1) return 'male';
    if (value === 2) return 'female';
  }
  return 'unknown';
}

function normalizeBooleanFlag(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (!lower) {
      return false;
    }
    if (['true', '1', 'yes', 'y', 'on'].includes(lower)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(lower)) {
      return false;
    }
    return defaultValue;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'undefined' || value === null) {
    return defaultValue;
  }
  return !!value;
}

function resolveRealmOrderFromLevel(level) {
  if (!level) {
    return 1;
  }
  const { realmOrder, order } = level;
  if (typeof realmOrder === 'number' && Number.isFinite(realmOrder)) {
    return Math.max(1, Math.floor(realmOrder));
  }
  if (typeof order === 'number' && Number.isFinite(order)) {
    return Math.max(1, Math.floor((order - 1) / 10) + 1);
  }
  return 1;
}

function resolveMemberRealmOrder(member, levels = []) {
  if (!member) {
    return 1;
  }
  if (member.level && typeof member.level.realmOrder === 'number' && Number.isFinite(member.level.realmOrder)) {
    return Math.max(1, Math.floor(member.level.realmOrder));
  }
  if (typeof member.levelRealmOrder === 'number' && Number.isFinite(member.levelRealmOrder)) {
    return Math.max(1, Math.floor(member.levelRealmOrder));
  }
  if (typeof member.realmOrder === 'number' && Number.isFinite(member.realmOrder)) {
    return Math.max(1, Math.floor(member.realmOrder));
  }
  const levelId = member.levelId;
  if (levelId && Array.isArray(levels)) {
    const matchedLevel = levels.find((item) => item && item._id === levelId);
    if (matchedLevel) {
      return resolveRealmOrderFromLevel(matchedLevel);
    }
  }
  if (member.level && typeof member.level.realm === 'string') {
    const matchedBackground = resolveBackgroundByRealmName(member.level.realm);
    if (matchedBackground) {
      return matchedBackground.realmOrder;
    }
  }
  const appearanceBackground = normalizeBackgroundId(member.appearanceBackground || '');
  if (appearanceBackground) {
    const background = resolveBackgroundById(appearanceBackground);
    if (background) {
      return background.realmOrder;
    }
  }
  if (typeof member.experience === 'number' && Number.isFinite(member.experience) && Array.isArray(levels)) {
    const sortedLevels = levels
      .filter((item) => item && typeof item.threshold === 'number')
      .sort((a, b) => a.threshold - b.threshold);
    for (let i = sortedLevels.length - 1; i >= 0; i -= 1) {
      const level = sortedLevels[i];
      if (member.experience >= (level.threshold || 0)) {
        return resolveRealmOrderFromLevel(level);
      }
    }
  }
  return 1;
}

async function ensureArchiveDefaults(member) {
  if (!member || !member._id) {
    return { member, extras: await resolveMemberExtras(member ? member._id : ''), renameHistory: [] };
  }
  await migrateRenameHistoryField(member);
  const updates = {};
  const extrasUpdates = {};
  const memberId = member._id;
  const extras = await resolveMemberExtras(memberId);
  const titleUnlockSet = new Set();
  const titleUnlocks = Array.isArray(extras.titleUnlocks)
    ? extras.titleUnlocks
        .map((id) => normalizeTitleId(id))
        .filter((id) => {
          if (!id || titleUnlockSet.has(id)) {
            return false;
          }
          titleUnlockSet.add(id);
          return true;
        })
    : [];
  if (!arraysEqual(Array.isArray(extras.titleUnlocks) ? extras.titleUnlocks : [], titleUnlocks)) {
    extrasUpdates.titleUnlocks = titleUnlocks;
    extras.titleUnlocks = titleUnlocks;
  }
  extras.titleUnlocks = titleUnlocks;

  const rawTitleCatalog = Array.isArray(extras.titleCatalog) ? extras.titleCatalog : [];
  const normalizedTitleCatalog = normalizeTitleCatalog(rawTitleCatalog);
  if (!areTitleCatalogsEqual(rawTitleCatalog, normalizedTitleCatalog)) {
    extrasUpdates.titleCatalog = normalizedTitleCatalog;
    extras.titleCatalog = normalizedTitleCatalog;
  } else {
    extras.titleCatalog = normalizedTitleCatalog;
  }
  member.titleCatalog = normalizedTitleCatalog;

  const rawBackgroundCatalog = Array.isArray(extras.backgroundCatalog) ? extras.backgroundCatalog : [];
  const normalizedBackgroundCatalog = normalizeBackgroundCatalog(rawBackgroundCatalog);
  registerCustomBackgrounds(normalizedBackgroundCatalog);
  if (!areBackgroundCatalogsEqual(rawBackgroundCatalog, normalizedBackgroundCatalog)) {
    extrasUpdates.backgroundCatalog = normalizedBackgroundCatalog;
    extras.backgroundCatalog = normalizedBackgroundCatalog;
  } else {
    extras.backgroundCatalog = normalizedBackgroundCatalog;
  }
  let backgroundUnlocks = normalizeBackgroundUnlockList(extras.backgroundUnlocks);
  const ensuredBackgroundUnlocks = ensureCustomBackgroundsUnlocked(
    normalizedBackgroundCatalog,
    backgroundUnlocks
  );
  if (!arraysEqual(backgroundUnlocks, ensuredBackgroundUnlocks)) {
    extrasUpdates.backgroundUnlocks = ensuredBackgroundUnlocks;
    extras.backgroundUnlocks = ensuredBackgroundUnlocks;
  } else {
    extras.backgroundUnlocks = ensuredBackgroundUnlocks;
  }
  backgroundUnlocks = ensuredBackgroundUnlocks;
  member.backgroundCatalog = normalizedBackgroundCatalog;

  if (!GENDER_OPTIONS.includes(member.gender)) {
    member.gender = 'unknown';
    updates.gender = 'unknown';
  }

  const renameUsed = Number.isFinite(member.renameUsed) ? Math.max(0, Math.floor(member.renameUsed)) : 0;
  if (!Object.is(renameUsed, member.renameUsed)) {
    updates.renameUsed = renameUsed;
  }
  member.renameUsed = renameUsed;

  const hasRenameCredits = Object.prototype.hasOwnProperty.call(member, 'renameCredits');
  const rawRenameCredits = hasRenameCredits ? member.renameCredits : Math.max(0, 1 - renameUsed);
  const numericRenameCredits = Number(rawRenameCredits);
  const renameCredits = Number.isFinite(numericRenameCredits)
    ? Math.max(0, Math.floor(numericRenameCredits))
    : Math.max(0, 1 - renameUsed);
  if (!Object.is(renameCredits, member.renameCredits)) {
    updates.renameCredits = renameCredits;
  }
  member.renameCredits = renameCredits;

  const renameCards = Number.isFinite(member.renameCards) ? Math.max(0, Math.floor(member.renameCards)) : 0;
  if (!Object.is(renameCards, member.renameCards)) {
    updates.renameCards = renameCards;
  }
  member.renameCards = renameCards;

  const avatarFrame = normalizeAvatarFrameValue(member.avatarFrame || '');
  if (!Object.is(avatarFrame, member.avatarFrame || '')) {
    updates.avatarFrame = avatarFrame;
  }
  member.avatarFrame = avatarFrame;

  const backgroundId = normalizeBackgroundId(member.appearanceBackground || '');
  const realmOrder = resolveMemberRealmOrder(member, []);
  const unlockedBackgroundId =
    backgroundId && isBackgroundUnlocked(backgroundId, realmOrder, backgroundUnlocks)
      ? backgroundId
      : '';
  const fallbackBackground = resolveHighestUnlockedBackgroundByRealmOrder(realmOrder);
  const safeBackgroundId =
    unlockedBackgroundId || (fallbackBackground ? fallbackBackground.id : getDefaultBackgroundId());
  if (!Object.is(safeBackgroundId, member.appearanceBackground || '')) {
    updates.appearanceBackground = safeBackgroundId;
  }
  member.appearanceBackground = safeBackgroundId;

  const appearanceTitle = normalizeTitleId(member.appearanceTitle);
  if (appearanceTitle && !titleUnlocks.includes(appearanceTitle)) {
    updates.appearanceTitle = '';
    member.appearanceTitle = '';
  } else {
    member.appearanceTitle = appearanceTitle || '';
  }

  const backgroundAnimated = normalizeBooleanFlag(member.appearanceBackgroundAnimated, false);
  if (!Object.is(backgroundAnimated, member.appearanceBackgroundAnimated)) {
    updates.appearanceBackgroundAnimated = backgroundAnimated;
  }
  member.appearanceBackgroundAnimated = backgroundAnimated;

  const usageCountRaw = Number(member.roomUsageCount);
  const usageCount = Number.isFinite(usageCountRaw) ? Math.max(0, Math.floor(usageCountRaw)) : 0;
  if (!Object.is(usageCount, member.roomUsageCount)) {
    updates.roomUsageCount = usageCount;
  }
  member.roomUsageCount = usageCount;

  const badges = normalizeReservationBadges(member.reservationBadges);
  const originalBadges = member.reservationBadges || {};
  const badgeChanged = Object.keys(badges).some((key) => !Object.is(badges[key], originalBadges[key]));
  if (badgeChanged) {
    updates.reservationBadges = badges;
  }
  member.reservationBadges = badges;

  const hadAvatarUnlocksField = Object.prototype.hasOwnProperty.call(member, 'avatarUnlocks');
  const hadClaimsField = Object.prototype.hasOwnProperty.call(member, 'claimedLevelRewards');
  const memberUnlocks = normalizeAvatarUnlocksList(member.avatarUnlocks);
  const extrasUnlocks = normalizeAvatarUnlocksList(extras.avatarUnlocks);
  const mergedUnlocks = Array.from(new Set([...extrasUnlocks, ...memberUnlocks]));
  if (!arraysEqual(extrasUnlocks, mergedUnlocks)) {
    extrasUpdates.avatarUnlocks = mergedUnlocks;
    extras.avatarUnlocks = mergedUnlocks;
  }
  if (hadAvatarUnlocksField) {
    updates.avatarUnlocks = _.remove();
  }
  member.avatarUnlocks = mergedUnlocks;

  const deliveredClaims = normalizeClaimedLevelRewards(extras.deliveredLevelRewards);
  if (!arraysEqual(Array.isArray(extras.deliveredLevelRewards) ? extras.deliveredLevelRewards : [], deliveredClaims)) {
    extrasUpdates.deliveredLevelRewards = deliveredClaims;
    extras.deliveredLevelRewards = deliveredClaims;
  }
  const memberClaims = normalizeClaimedLevelRewards(member.claimedLevelRewards);
  const extrasClaims = normalizeClaimedLevelRewards(extras.claimedLevelRewards);
  const mergedClaims = normalizeClaimedLevelRewards([...extrasClaims, ...memberClaims, ...deliveredClaims]);
  if (!arraysEqual(extrasClaims, mergedClaims)) {
    extrasUpdates.claimedLevelRewards = mergedClaims;
    extras.claimedLevelRewards = mergedClaims;
  }
  if (hadClaimsField) {
    updates.claimedLevelRewards = _.remove();
  }
  member.claimedLevelRewards = mergedClaims;

  member.titleUnlocks = titleUnlocks;

  member.backgroundUnlocks = backgroundUnlocks;

  const renameHistory = await loadRenameTimeline(memberId, 20);
  member.renameHistory = renameHistory;

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: updates
      })
      .catch(() => {});
  }

  if (Object.keys(extrasUpdates).length) {
    await updateMemberExtras(memberId, extrasUpdates);
  }

  return { member, extras, renameHistory };
}

async function updateArchive(openid, updates = {}, context = {}) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {}, {}, context);
    return updateArchive(openid, updates, context);
  }

  const normalized = normalizeAssetFields(existing.data);
  const { member: memberWithDefaults, extras } = await ensureArchiveDefaults(normalized);
  const levels = await loadLevels();
  const member = await ensureLevelSync(memberWithDefaults, levels);
  const now = new Date();
  const patch = {};
  let renamed = false;
  const realmOrder = resolveMemberRealmOrder(member, levels);
  const titleUnlocks = Array.isArray(extras && extras.titleUnlocks) ? extras.titleUnlocks : [];
  const backgroundUnlocks = Array.isArray(extras && extras.backgroundUnlocks)
    ? extras.backgroundUnlocks
    : [];

  if (typeof updates.nickName === 'string') {
    const nickName = updates.nickName.trim();
    if (nickName && nickName !== member.nickName) {
      if ((member.renameCredits || 0) <= 0) {
        throw createError('RENAME_QUOTA_EXCEEDED', '剩余改名次数不足，请使用改名卡增加次数');
      }
      patch.nickName = nickName;
      renamed = true;
      await appendRenameTimeline(openid, {
        previous: member.nickName || '',
        current: nickName,
        changedAt: now,
        source: updates.source || 'manual'
      });
    }
  }

  if (typeof updates.gender !== 'undefined' && updates.gender !== null) {
    const genderValue = normalizeGender(updates.gender);
    if (genderValue !== member.gender) {
      patch.gender = genderValue;
    }
  }

  if (typeof updates.avatarUrl === 'string') {
    const avatarUrl = updates.avatarUrl.trim();
    if (avatarUrl && avatarUrl !== member.avatarUrl) {
      if (!isAvatarAllowedForMember(avatarUrl, member)) {
        throw createError('AVATAR_NOT_ALLOWED', '该头像尚未解锁');
      }
      patch.avatarUrl = avatarUrl;
    }
  }

  if (typeof updates.avatarFrame === 'string') {
    const avatarFrame = normalizeAvatarFrameValue(updates.avatarFrame || '');
    if (avatarFrame !== (member.avatarFrame || '')) {
      patch.avatarFrame = avatarFrame;
    }
  }

  if (typeof updates.appearanceBackground === 'string') {
    const desiredBackgroundId = normalizeBackgroundId(updates.appearanceBackground || '');
    if (desiredBackgroundId) {
      if (!isBackgroundUnlocked(desiredBackgroundId, realmOrder, backgroundUnlocks)) {
        throw createError('BACKGROUND_NOT_UNLOCKED', '该背景尚未解锁');
      }
      if (desiredBackgroundId !== (member.appearanceBackground || '')) {
        patch.appearanceBackground = desiredBackgroundId;
      }
    } else {
      const fallback = resolveHighestUnlockedBackgroundByRealmOrder(realmOrder);
      const fallbackId = fallback ? fallback.id : getDefaultBackgroundId();
      if (fallbackId && fallbackId !== (member.appearanceBackground || '')) {
        patch.appearanceBackground = fallbackId;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'appearanceTitle')) {
    const desiredTitle = normalizeTitleId(updates.appearanceTitle);
    if (!desiredTitle) {
      if (member.appearanceTitle) {
        patch.appearanceTitle = '';
      }
    } else {
      if (!titleUnlocks.includes(desiredTitle)) {
        throw createError('TITLE_NOT_UNLOCKED', '该称号尚未解锁');
      }
      if (desiredTitle !== (member.appearanceTitle || '')) {
        patch.appearanceTitle = desiredTitle;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'appearanceBackgroundAnimated')) {
    const desiredAnimated = normalizeBooleanFlag(updates.appearanceBackgroundAnimated, false);
    const currentAnimated = normalizeBooleanFlag(member.appearanceBackgroundAnimated, false);
    if (!Object.is(desiredAnimated, currentAnimated)) {
      patch.appearanceBackgroundAnimated = desiredAnimated;
    }
  }

  if (!Object.keys(patch).length) {
    return attachProxySession(decorateMember(member, levels), context.proxySession);
  }

  if (renamed) {
    patch.renameCredits = Math.max((member.renameCredits || 0) - 1, 0);
    patch.renameUsed = (member.renameUsed || 0) + 1;
  }

  patch.updatedAt = now;
  await membersCollection.doc(openid).update({
    data: patch
  });

  return getProfile(openid, {}, context);
}

async function redeemRenameCard(openid, count = 1, context = {}) {
  const quantity = Number(count);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createError('INVALID_QUANTITY', '改名卡数量无效');
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {}, {}, context);
    return redeemRenameCard(openid, count, context);
  }

  const normalized = normalizeAssetFields(existing.data);
  const { member: memberWithDefaults } = await ensureArchiveDefaults(normalized);
  const member = memberWithDefaults;
  const available = Math.max(0, Math.floor(member.renameCards || 0));
  if (available < quantity) {
    throw createError('RENAME_CARD_INSUFFICIENT', '改名卡数量不足');
  }

  const profile = ensurePveRewardProfile(member.pveProfile);
  const removedFromStorage = removeStorageItemsByItemId(profile, 'mall_rename_card_single', quantity);

  const updatePayload = {
    renameCards: _.inc(-quantity),
    renameCredits: _.inc(quantity),
    updatedAt: new Date()
  };
  if (removedFromStorage > 0) {
    updatePayload.pveProfile = _.set(profile);
  }

  await membersCollection.doc(openid).update({
    data: updatePayload
  });

  return getProfile(openid, {}, context);
}

async function breakthrough(openid, context = {}) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {}, {}, context);
    return breakthrough(openid, context);
  }

  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: memberWithDefaults } = await ensureArchiveDefaults(normalized);
  const member = await ensureLevelSync(memberWithDefaults, levels);
  const pendingId =
    typeof member.pendingBreakthroughLevelId === 'string' && member.pendingBreakthroughLevelId
      ? member.pendingBreakthroughLevelId
      : '';
  if (!pendingId) {
    throw createError('BREAKTHROUGH_NOT_PENDING', '暂无可突破的境界');
  }

  const targetLevel = levels.find((lvl) => lvl && lvl._id === pendingId);
  if (!targetLevel) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
      .update({
        data: {
          pendingBreakthroughLevelId: '',
          updatedAt: new Date()
        }
      })
      .catch(() => {});
    throw createError('BREAKTHROUGH_INVALID', '突破目标无效，请稍后再试');
  }

  const currentLevel = levels.find((lvl) => lvl && lvl._id === member.levelId) || levels[0];
  const breakthroughSourceLevel = currentLevel;
  if (!requiresBreakthrough(currentLevel, targetLevel)) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
      .update({
        data: {
          pendingBreakthroughLevelId: '',
          updatedAt: new Date()
        }
      })
      .catch(() => {});
    return getProgress(openid, {}, context);
  }

  const threshold = typeof targetLevel.threshold === 'number' ? targetLevel.threshold : Number.POSITIVE_INFINITY;
  if (Number(member.experience || 0) < threshold) {
    throw createError('BREAKTHROUGH_NOT_READY', '修为尚未达到突破条件');
  }

  const now = new Date();
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .update({
      data: {
        levelId: targetLevel._id,
        pendingBreakthroughLevelId: '',
        updatedAt: now
      }
    })
    .catch(() => {});

  await grantBreakthroughRewardsForLevel(openid, breakthroughSourceLevel);

  member.levelId = targetLevel._id;
  member.pendingBreakthroughLevelId = '';
  await ensureLevelSync(member, levels);

  return getProgress(openid, {}, context);
}

async function claimLevelReward(openid, levelId, context = {}) {
  if (typeof levelId !== 'string' || !levelId.trim()) {
    throw createError('INVALID_LEVEL', '无效的等级');
  }
  const targetLevelId = levelId.trim();
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {}, {}, context);
    return claimLevelReward(openid, targetLevelId, context);
  }

  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: withDefaults } = await ensureArchiveDefaults(normalized);
  const member = await ensureLevelSync(withDefaults, levels);
  const level = levels.find((lvl) => lvl && lvl._id === targetLevelId);
  if (!level) {
    throw createError('LEVEL_NOT_FOUND', '等级不存在');
  }
  if (!hasLevelRewards(level)) {
    throw createError('LEVEL_REWARD_NOT_AVAILABLE', '该等级暂无奖励');
  }

  const claimedLevelRewards = normalizeClaimedLevelRewards(member.claimedLevelRewards, levels);
  if (claimedLevelRewards.includes(targetLevelId)) {
    throw createError('LEVEL_REWARD_ALREADY_CLAIMED', '奖励已领取');
  }

  const experience = Number(member.experience || 0);
  if (experience < (typeof level.threshold === 'number' ? level.threshold : 0)) {
    throw createError('LEVEL_REWARD_NOT_REACHED', '尚未达到该等级');
  }

  await db
    .collection(COLLECTIONS.MEMBER_EXTRAS)
    .doc(openid)
    .update({
      data: {
        claimedLevelRewards: _.addToSet(targetLevelId),
        updatedAt: new Date()
      }
    })
    .catch(async (error) => {
      if (error && /not exist/i.test(error.errMsg || '')) {
        await db
          .collection(COLLECTIONS.MEMBER_EXTRAS)
          .doc(openid)
          .set({
            data: {
              claimedLevelRewards: [targetLevelId],
              avatarUnlocks: [],
              backgroundUnlocks: [],
              titleUnlocks: [],
              deliveredLevelRewards: [],
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
          .catch(() => {});
      }
    });

  await grantLevelRewards(openid, level, levels);

  return getProgress(openid, {}, context);
}

function decorateMember(member, levels) {
  const level = levels.find((lvl) => lvl._id === member.levelId) || null;
  const roles = Array.isArray(member.roles) && member.roles.length ? member.roles : ['member'];
  if (roles !== member.roles) {
    db.collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: {
          roles,
          updatedAt: new Date()
        }
      })
      .catch(() => {});
  }
  const reservationBadges = normalizeReservationBadges(member.reservationBadges);
  const claimedLevelRewards = normalizeClaimedLevelRewards(member.claimedLevelRewards, levels);
  return {
    ...member,
    roles,
    level,
    reservationBadges,
    claimedLevelRewards
  };
}

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

function normalizeAvatarUnlocksList(unlocks) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim().toLowerCase();
    if (
      !trimmed ||
      seen.has(trimmed) ||
      !AVATAR_ID_PATTERN.test(trimmed) ||
      !ALLOWED_AVATAR_IDS.has(trimmed)
    ) {
      return;
    }
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function normalizeClaimedLevelRewards(claims, levels = []) {
  const validIds = new Set();
  if (Array.isArray(levels)) {
    levels.forEach((level) => {
      if (level && typeof level._id === 'string') {
        validIds.add(level._id);
      }
    });
  }
  if (!Array.isArray(claims)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  claims.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    if (validIds.size && !validIds.has(trimmed)) {
      if (
        trimmed.endsWith(BREAKTHROUGH_DELIVERY_SUFFIX) &&
        validIds.has(trimmed.slice(0, -BREAKTHROUGH_DELIVERY_SUFFIX.length))
      ) {
        // allow extended delivery keys for breakthrough rewards
      } else {
        return;
      }
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const match = url.trim().toLowerCase().match(/\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png$/);
  if (!match) {
    return '';
  }
  const id = match[1];
  return ALLOWED_AVATAR_IDS.has(id) ? id : '';
}

function isAvatarAllowedForMember(url, member) {
  const avatarId = extractAvatarIdFromUrl(url);
  if (!avatarId) {
    return true;
  }
  if (!ALLOWED_AVATAR_IDS.has(avatarId)) {
    return false;
  }
  const parts = avatarId.split('-');
  if (parts.length < 3) {
    return false;
  }
  const [avatarGender, rarity] = parts;
  const memberGender = normalizeGender(member && member.gender);
  if (rarity === 'c') {
    if (memberGender === 'unknown') {
      return true;
    }
    return memberGender === avatarGender;
  }
  const unlocks = normalizeAvatarUnlocksList(member && member.avatarUnlocks);
  return unlocks.includes(avatarId);
}

function normalizeAssetFields(member) {
  if (!member) return member;
  const normalized = { ...member };
  const updates = {};
  const cashBalance = coerceAmountValue(normalized.cashBalance, normalized.balance);
  normalized.cashBalance = cashBalance;
  if (!Object.is(cashBalance, member.cashBalance)) {
    updates.cashBalance = cashBalance;
  }

  const totalRecharge = coerceAmountValue(normalized.totalRecharge, 0);
  normalized.totalRecharge = totalRecharge;
  if (!Object.is(totalRecharge, member.totalRecharge)) {
    updates.totalRecharge = totalRecharge;
  }

  const totalSpend = Math.max(0, coerceAmountValue(normalized.totalSpend, 0));
  normalized.totalSpend = totalSpend;
  if (!Object.is(totalSpend, member.totalSpend)) {
    updates.totalSpend = totalSpend;
  }

  const stoneNumeric = resolveAmountNumber(normalized.stoneBalance);
  const stoneBalance = Number.isFinite(stoneNumeric) ? Math.max(0, Math.floor(stoneNumeric)) : 0;
  normalized.stoneBalance = stoneBalance;
  if (!Object.is(stoneBalance, member.stoneBalance)) {
    updates.stoneBalance = stoneBalance;
  }
  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    db.collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: updates
      })
      .catch(() => {});
  }
  return normalized;
}

function coerceAmountValue(value, fallback = 0) {
  const numeric = resolveAmountNumber(value);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  const fallbackNumeric = resolveAmountNumber(fallback);
  if (Number.isFinite(fallbackNumeric)) {
    return Math.round(fallbackNumeric);
  }
  return 0;
}

function resolveAmountNumber(value) {
  if (value == null) {
    return NaN;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const sanitized = trimmed.replace(/[^0-9+.,-]/g, '').replace(/,/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        const numeric = value.toNumber();
        return Number.isFinite(numeric) ? numeric : NaN;
      } catch (err) {
        // ignore
      }
    }
    if (typeof value.valueOf === 'function') {
      const primitive = value.valueOf();
      if (typeof primitive === 'number' && Number.isFinite(primitive)) {
        return primitive;
      }
      const numeric = Number(primitive);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    if (typeof value.toString === 'function') {
      const numeric = Number(value.toString());
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}
