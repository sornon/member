const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { listAvatarIds } = require('./avatar-catalog.js');
const { normalizeAvatarFrameValue } = require('./avatar-frames.js');
const commonConfig = require('common-config');
const {
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder,
  resolveBackgroundByRealmName,
  resolveBackgroundById,
  COLLECTIONS,
  realmConfigs,
  subLevelLabels
} = commonConfig;

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
  }
});

function normalizeTitleId(titleId) {
  if (typeof titleId !== 'string') {
    return '';
  }
  return titleId.trim();
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
      type: 'consumable',
      storageItemId: 'reward_voucher_qi_drink',
      storageCategory: 'consumable',
      usage: {
        type: 'grantRight',
        rightId: 'right_realm_qi_drink',
        amountLimit: 12000,
        categoryType: 'drinks'
      },
      name: '饮品券·任意 120 元内饮品',
      description: '使用后获得「任意饮品券（120 元内）」权益，点餐时自动抵扣最贵的一件酒水。',
      slotLabel: '道具',
      quality: 'epic',
      qualityLabel: '权益券',
      qualityColor: '#f2a546'
    },
    {
      type: 'background',
      backgroundId: 'reward_foundation',
      name: '背景·筑基背景',
      description: '突破筑基后自动解锁的专属背景，无需额外道具。',
      autoUnlock: true
    }
  ]
});

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
  const item = {
    inventoryId: generateStorageInventoryId(reward.storageItemId || reward.itemId || 'item', now),
    itemId: reward.storageItemId || reward.itemId || '',
    name: reward.name || '道具',
    shortName: reward.shortName || reward.name || '道具',
    description: reward.description || '',
    iconUrl: reward.iconUrl || '',
    iconFallbackUrl: reward.iconFallbackUrl || '',
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
    category.items.push(item);
  }
  return profile;
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
    if (!Array.isArray(extras.backgroundUnlocks)) {
      extras.backgroundUnlocks = [];
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
    backgroundUnlocks: [],
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
              backgroundUnlocks: [],
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';

  switch (action) {
    case 'init':
      return initMember(OPENID, event.profile || {});
    case 'profile':
      return getProfile(OPENID);
    case 'progress':
      return getProgress(OPENID);
    case 'rights':
      return getRights(OPENID);
    case 'claimLevelReward':
      return claimLevelReward(OPENID, event.levelId);
    case 'completeProfile':
      return completeProfile(OPENID, event);
    case 'updateArchive':
      return updateArchive(OPENID, event.updates || {});
    case 'redeemRenameCard':
      return redeemRenameCard(OPENID, event.count || 1);
    case 'breakthrough':
      return breakthrough(OPENID);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function initMember(openid, profile) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const exist = await membersCollection.doc(openid).get().catch(() => null);
  if (exist && exist.data) {
    return exist.data;
  }

  const levels = await loadLevels();
  const defaultLevel = levels[0];
  const now = new Date();
  const doc = {
    _id: openid,
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
    roles: ['member'],
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
  await membersCollection.add({ data: doc });
  await db
    .collection(COLLECTIONS.MEMBER_EXTRAS)
    .doc(openid)
    .set({
      data: {
        avatarUnlocks: [],
        claimedLevelRewards: [],
        createdAt: now,
        updatedAt: now
      }
    })
    .catch(() => {});
  if (defaultLevel) {
    await grantLevelRewards(openid, defaultLevel, []);
  }
  return doc;
}

async function getProfile(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return getProfile(openid);
  }
  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: withDefaults } = await ensureArchiveDefaults(normalized);
  const synced = await ensureLevelSync(withDefaults, levels);
  return decorateMember(synced, levels);
}

async function getProgress(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return getProgress(openid);
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
  return {
    member: decorateMember(member, levels),
    levels: levels.map((lvl) => ({
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
      virtualRewards: lvl.virtualRewards || [],
      milestoneReward: lvl.milestoneReward || '',
      milestoneType: lvl.milestoneType || '',
      rewards: (lvl.rewards || []).map((reward) => reward.description || reward.name || ''),
      hasRewards: hasLevelRewards(lvl),
      claimed: claimedLevelRewards.includes(lvl._id),
      reached: experience >= (typeof lvl.threshold === 'number' ? lvl.threshold : 0),
      claimable:
        hasLevelRewards(lvl) &&
        experience >= (typeof lvl.threshold === 'number' ? lvl.threshold : 0) &&
        !claimedLevelRewards.includes(lvl._id)
    })),
    claimedLevelRewards,
    percentage,
    nextDiff,
    currentLevel,
    nextLevel
  };
}

async function getRights(openid) {
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const [rightsSnapshot, rightsMasterSnapshot] = await Promise.all([
    rightsCollection
      .where({ memberId: openid })
      .orderBy('issuedAt', 'desc')
      .get(),
    db.collection(COLLECTIONS.RIGHTS_MASTER).get()
  ]);

  const masterMap = {};
  rightsMasterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });

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

async function completeProfile(openid, payload = {}) {
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
    });
    return getProfile(openid);
  }

  if (!Object.keys(updates).length) {
    const levels = await loadLevels();
    return decorateMember(normalizeAssetFields(existing.data), levels);
  }

  updates.updatedAt = new Date();
  await membersCollection.doc(openid).update({
    data: updates
  });

  return getProfile(openid);
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
  let currentLevel = levels.find((lvl) => lvl && lvl._id === member.levelId) || levels[0];

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
    await grantLevelRewards(member._id, nextLevel, levels);
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
      if (Array.isArray(config.milestone.rights) && config.milestone.rights.length) {
        overrides.rewards = config.milestone.rights.map((item) => ({
          rightId: item.rightId,
          quantity: item.quantity || 1,
          description: item.description || ''
        }));
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
  if (Array.isArray(level.rewards) && level.rewards.length) {
    return true;
  }
  if (Array.isArray(level.virtualRewards) && level.virtualRewards.length) {
    return true;
  }
  return !!level.milestoneReward;
}

async function grantLevelRewards(openid, level, levels) {
  const rewards = level.rewards || [];
  if (rewards.length) {
    const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
    const now = new Date();
    const masterSnapshot = await db.collection(COLLECTIONS.RIGHTS_MASTER).get();
    const masterMap = {};
    masterSnapshot.data.forEach((item) => {
      masterMap[item._id] = item;
    });

    for (const reward of rewards) {
      const right = masterMap[reward.rightId];
      if (!right) continue;
      const existing = await rightsCollection
        .where({
          memberId: openid,
          rightId: reward.rightId,
          levelId: level._id
        })
        .get();
      const needQuantity = reward.quantity || 1;
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
            levelId: level._id,
            status: 'active',
            issuedAt: now,
            validUntil,
            meta: {
              fromLevel: level._id,
              rewardName: reward.description || right.name
            }
          }
        });
      }
    }
  }

  await grantInventoryRewardsForLevel(openid, level);
}

async function grantInventoryRewardsForLevel(openid, level) {
  const rewards = LEVEL_REWARD_CONFIG[level._id];
  if (!Array.isArray(rewards) || !rewards.length) {
    return;
  }
  const extras = await resolveMemberExtras(openid);
  const delivered = Array.isArray(extras.deliveredLevelRewards) ? extras.deliveredLevelRewards : [];
  const backgroundUnlocks = Array.isArray(extras.backgroundUnlocks) ? extras.backgroundUnlocks : [];
  const backgroundUnlockSet = new Set(backgroundUnlocks);
  if (delivered.includes(level._id)) {
    return;
  }

  const memberSnapshot = await db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  if (!memberSnapshot || !memberSnapshot.data) {
    return;
  }

  const now = new Date();
  const profile = ensurePveRewardProfile(memberSnapshot.data.pveProfile);
  let profileChanged = false;
  let extrasChanged = false;

  for (const reward of rewards) {
    if (!reward || typeof reward !== 'object') {
      continue;
    }
    if (reward.type === 'equipment' && reward.itemId) {
      const hasItem = profile.equipment.inventory.some((entry) => entry && entry.itemId === reward.itemId);
      if (!hasItem) {
        const equipmentEntry = createEquipmentRewardEntry(reward, now);
        if (equipmentEntry) {
          profile.equipment.inventory.push(equipmentEntry);
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
      .doc(openid)
      .update({
        data: {
          pveProfile: _.set(profile),
          updatedAt: now
        }
      })
      .catch(() => {});
  }

  const deliveredSet = new Set(delivered);
  deliveredSet.add(level._id);
  const extrasUpdate = { deliveredLevelRewards: Array.from(deliveredSet) };
  if (extrasChanged) {
    extrasUpdate.backgroundUnlocks = Array.from(backgroundUnlockSet);
  }
  await updateMemberExtras(openid, extrasUpdate);
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
  const backgroundUnlocks = Array.isArray(extras.backgroundUnlocks) ? extras.backgroundUnlocks.slice() : [];

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

  const memberClaims = normalizeClaimedLevelRewards(member.claimedLevelRewards);
  const extrasClaims = normalizeClaimedLevelRewards(extras.claimedLevelRewards);
  const mergedClaims = normalizeClaimedLevelRewards([...extrasClaims, ...memberClaims]);
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

async function updateArchive(openid, updates = {}) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {});
    return updateArchive(openid, updates);
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
    return decorateMember(member, levels);
  }

  if (renamed) {
    patch.renameCredits = Math.max((member.renameCredits || 0) - 1, 0);
    patch.renameUsed = (member.renameUsed || 0) + 1;
  }

  patch.updatedAt = now;
  await membersCollection.doc(openid).update({
    data: patch
  });

  return getProfile(openid);
}

async function redeemRenameCard(openid, count = 1) {
  const quantity = Number(count);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createError('INVALID_QUANTITY', '改名卡数量无效');
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {});
    return redeemRenameCard(openid, count);
  }

  const normalized = normalizeAssetFields(existing.data);
  const { member: memberWithDefaults } = await ensureArchiveDefaults(normalized);
  const member = memberWithDefaults;
  const available = Math.max(0, Math.floor(member.renameCards || 0));
  if (available < quantity) {
    throw createError('RENAME_CARD_INSUFFICIENT', '改名卡数量不足');
  }

  await membersCollection.doc(openid).update({
    data: {
      renameCards: _.inc(-quantity),
      renameCredits: _.inc(quantity),
      updatedAt: new Date()
    }
  });

  return getProfile(openid);
}

async function breakthrough(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return breakthrough(openid);
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
    return getProgress(openid);
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

  await grantLevelRewards(openid, targetLevel, levels);

  member.levelId = targetLevel._id;
  member.pendingBreakthroughLevelId = '';
  await ensureLevelSync(member, levels);

  return getProgress(openid);
}

async function claimLevelReward(openid, levelId) {
  if (typeof levelId !== 'string' || !levelId.trim()) {
    throw createError('INVALID_LEVEL', '无效的等级');
  }
  const targetLevelId = levelId.trim();
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return claimLevelReward(openid, targetLevelId);
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

  await grantInventoryRewardsForLevel(openid, level);

  return getProgress(openid);
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
      return;
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
