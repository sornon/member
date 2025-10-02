const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { listAvatarIds } = require('./avatar-catalog.js');
const { normalizeAvatarFrameValue } = require('./avatar-frames.js');
const { MENU_VERSION, listMenuCatalog, getMenuItem, normalizeSelection } = require('./menu-catalog.js');
const {
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder,
  resolveBackgroundByRealmName,
  resolveBackgroundById
} = require('./shared/backgrounds.js');

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  RIGHTS_MASTER: 'membershipRights',
  MEMBER_RIGHTS: 'memberRights',
  MEMBER_EXTRAS: 'memberExtras',
  MEMBER_TIMELINE: 'memberTimeline',
  MEAL_ORDERS: 'mealOrders',
  WALLET_TRANSACTIONS: 'walletTransactions'
};

const EXPERIENCE_PER_YUAN = 100;

const GENDER_OPTIONS = ['unknown', 'male', 'female'];
const AVATAR_ID_PATTERN = /^(male|female)-([a-z]+)-(\d+)$/;
const ALLOWED_AVATAR_IDS = new Set(listAvatarIds());

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
    return extras;
  }
  const now = new Date();
  const data = {
    avatarUnlocks: [],
    claimedLevelRewards: [],
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
          .set({ data: { ...payload, createdAt: new Date() } })
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
    case 'listMealMenu':
      return listMealMenu(OPENID);
    case 'createMealOrder':
      return createMealOrder(OPENID, event.items || [], event.notes || '');
    case 'listMealOrders':
      return listMealOrders(OPENID, {
        page: event.page || 1,
        pageSize: event.pageSize || 20,
        markSeen: !!event.markSeen
      });
    case 'confirmMealOrder':
      return confirmMealOrder(OPENID, event.orderId);
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
    roomUsageCount: 0,
    reservationBadges: {
      memberVersion: 0,
      memberSeenVersion: 0,
      adminVersion: 0,
      adminSeenVersion: 0,
      pendingApprovalCount: 0
    },
    mealOrderBadges: {
      memberVersion: 0,
      memberSeenVersion: 0,
      awaitingMemberCount: 0
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
  if (!levels.length) return member;
  const targetLevel = resolveLevelByExperience(member.experience || 0, levels);
  if (targetLevel && targetLevel._id !== member.levelId) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: {
          levelId: targetLevel._id,
          updatedAt: new Date()
        }
      });
    await grantLevelRewards(member._id, targetLevel, levels);
    member.levelId = targetLevel._id;
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
  if (!rewards.length) return;
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

async function loadLevels() {
  const snapshot = await db.collection(COLLECTIONS.LEVELS).orderBy('order', 'asc').get();
  return snapshot.data || [];
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
  const safeBackgroundId = backgroundId || getDefaultBackgroundId();
  if (!Object.is(safeBackgroundId, member.appearanceBackground || '')) {
    updates.appearanceBackground = safeBackgroundId;
  }
  member.appearanceBackground = safeBackgroundId;

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

  const mealBadges = normalizeMealOrderBadges(member.mealOrderBadges);
  const originalMealBadges = member.mealOrderBadges || {};
  const mealBadgeChanged = Object.keys(mealBadges).some((key) => !Object.is(mealBadges[key], originalMealBadges[key]));
  if (mealBadgeChanged) {
    updates.mealOrderBadges = mealBadges;
  }
  member.mealOrderBadges = mealBadges;

  const extras = await resolveMemberExtras(memberId);

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
  const { member: memberWithDefaults } = await ensureArchiveDefaults(normalized);
  const levels = await loadLevels();
  const member = await ensureLevelSync(memberWithDefaults, levels);
  const now = new Date();
  const patch = {};
  let renamed = false;
  const realmOrder = resolveMemberRealmOrder(member, levels);

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
      if (!isBackgroundUnlocked(desiredBackgroundId, realmOrder)) {
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

async function listMealMenu(openid) {
  if (!openid) {
    throw createError('UNAUTHORIZED', '请先登录');
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {});
  }
  const categories = listMenuCatalog().map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description || '',
    order: category.order || 0,
    items: (Array.isArray(category.items) ? category.items : []).map((item) => ({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      description: item.description || '',
      price: Math.max(0, Math.round(Number(item.price || 0))),
      unit: item.unit || '',
      spicy: Number.isFinite(item.spicy) ? Math.max(0, Math.floor(item.spicy)) : 0,
      tags: Array.isArray(item.tags) ? item.tags : []
    }))
  }));
  return {
    version: MENU_VERSION,
    categories
  };
}

async function createMealOrder(openid, rawItems = [], notes = '') {
  if (!openid) {
    throw createError('UNAUTHORIZED', '请先登录');
  }
  const selection = normalizeSelection(rawItems);
  if (!selection.length) {
    throw createError('MEAL_ORDER_EMPTY', '请先选择菜品');
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const memberDoc = await membersCollection.doc(openid).get().catch(() => null);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return createMealOrder(openid, rawItems, notes);
  }
  const member = normalizeAssetFields(memberDoc.data);
  const categoryMap = listMenuCatalog().reduce((acc, category) => {
    acc[category.id] = category;
    return acc;
  }, {});
  const items = selection.map(({ itemId, quantity }) => {
    const menuItem = getMenuItem(itemId);
    if (!menuItem) {
      throw createError('MEAL_ITEM_NOT_FOUND', '存在已下架菜品');
    }
    return buildMealOrderItem(menuItem, quantity, categoryMap);
  });
  const normalizedItems = items.filter((item) => item.quantity > 0 && item.price >= 0);
  if (!normalizedItems.length) {
    throw createError('MEAL_ORDER_INVALID', '请选择有效的菜品');
  }
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  if (!totalAmount || totalAmount <= 0) {
    throw createError('MEAL_ORDER_INVALID_AMOUNT', '订单金额无效');
  }
  const sanitizedNotes = sanitizeMealNotes(notes);
  const now = new Date();
  const history = [
    {
      action: 'created',
      actorId: openid,
      remark: sanitizedNotes,
      at: now
    }
  ];
  const memberBadges = normalizeMealOrderBadges(member.mealOrderBadges);
  const orderData = {
    memberId: openid,
    status: 'pendingAdmin',
    items: normalizedItems,
    totalAmount: Math.round(totalAmount),
    totalQuantity: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
    memberNotes: sanitizedNotes,
    adminNotes: '',
    menuVersion: MENU_VERSION,
    memberSnapshot: {
      nickName: member.nickName || '',
      mobile: member.mobile || '',
      gender: normalizeGender(member.gender)
    },
    createdAt: now,
    updatedAt: now,
    history
  };
  const result = await db.collection(COLLECTIONS.MEAL_ORDERS).add({
    data: orderData
  });
  return {
    order: mapMealOrderForMember({ _id: result._id, ...orderData }),
    badges: memberBadges
  };
}

async function listMealOrders(openid, { page = 1, pageSize = 20, markSeen = false } = {}) {
  if (!openid) {
    throw createError('UNAUTHORIZED', '请先登录');
  }
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const memberDoc = await membersCollection.doc(openid).get().catch(() => null);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return listMealOrders(openid, { page, pageSize, markSeen });
  }
  const member = normalizeAssetFields(memberDoc.data);
  const badges = normalizeMealOrderBadges(member.mealOrderBadges);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;
  const snapshot = await db
    .collection(COLLECTIONS.MEAL_ORDERS)
    .where({ memberId: openid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
    .catch(() => ({ data: [] }));
  const orders = (snapshot.data || [])
    .map((order) => mapMealOrderForMember({ _id: order._id, ...order }))
    .filter(Boolean);
  let updatedBadges = badges;
  if (markSeen && (badges.memberSeenVersion < badges.memberVersion || badges.awaitingMemberCount > 0)) {
    updatedBadges = {
      ...badges,
      memberSeenVersion: badges.memberVersion,
      awaitingMemberCount: Math.max(0, badges.awaitingMemberCount)
    };
    await membersCollection.doc(openid).update({
      data: {
        mealOrderBadges: updatedBadges,
        updatedAt: new Date()
      }
    });
  }
  return {
    orders,
    page,
    pageSize: limit,
    total: orders.length,
    badges: updatedBadges
  };
}

async function confirmMealOrder(openid, orderId) {
  if (!openid) {
    throw createError('UNAUTHORIZED', '请先登录');
  }
  if (!orderId || typeof orderId !== 'string') {
    throw createError('MEAL_ORDER_REQUIRED', '缺少订单编号');
  }
  const normalizedOrderId = orderId.trim();
  if (!normalizedOrderId) {
    throw createError('MEAL_ORDER_REQUIRED', '缺少订单编号');
  }
  let updatedOrder = null;
  let updatedBadges = null;
  let experienceGain = 0;
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.MEAL_ORDERS).doc(normalizedOrderId);
    const orderDoc = await orderRef.get().catch(() => null);
    if (!orderDoc || !orderDoc.data) {
      throw createError('MEAL_ORDER_NOT_FOUND', '订单不存在');
    }
    const order = orderDoc.data;
    if (order.memberId !== openid) {
      throw createError('MEAL_ORDER_FORBIDDEN', '无权处理该订单');
    }
    const status = normalizeMealOrderStatus(order.status);
    if (status === 'completed') {
      updatedOrder = order;
      return;
    }
    if (status !== 'awaitingMember') {
      throw createError('MEAL_ORDER_NOT_READY', '订单尚未准备完成');
    }
    const totalAmount = Math.max(0, Math.round(Number(order.totalAmount || 0)));
    if (!totalAmount) {
      throw createError('MEAL_ORDER_INVALID_AMOUNT', '订单金额无效');
    }
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw createError('MEMBER_NOT_FOUND', '会员不存在');
    }
    const member = normalizeAssetFields(memberDoc.data);
    const currentBalance = Math.max(0, Math.round(Number(member.cashBalance || 0)));
    if (currentBalance < totalAmount) {
      throw createError('MEAL_ORDER_BALANCE_INSUFFICIENT', '余额不足，请先充值');
    }
    experienceGain = calculateExperienceGain(totalAmount);
    const badges = normalizeMealOrderBadges(member.mealOrderBadges);
    badges.awaitingMemberCount = Math.max(0, badges.awaitingMemberCount - 1);
    badges.memberSeenVersion = Math.max(badges.memberVersion, badges.memberSeenVersion);
    const history = Array.isArray(order.history) ? order.history.slice(-20) : [];
    history.push({
      action: 'memberConfirmed',
      actorId: openid,
      remark: '',
      at: now
    });
    await memberRef.update({
      data: {
        cashBalance: _.inc(-totalAmount),
        totalSpend: _.inc(totalAmount),
        updatedAt: now,
        mealOrderBadges: badges,
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -totalAmount,
        type: 'spend',
        status: 'success',
        source: 'mealOrder',
        orderId: normalizedOrderId,
        remark: '餐饮扣款',
        createdAt: now,
        updatedAt: now
      }
    });
    await orderRef.update({
      data: {
        status: 'completed',
        memberConfirmedAt: now,
        paidAt: now,
        completedAt: now,
        updatedAt: now,
        history
      }
    });
    updatedOrder = {
      ...order,
      status: 'completed',
      memberConfirmedAt: now,
      paidAt: now,
      completedAt: now,
      updatedAt: now,
      history
    };
    updatedBadges = badges;
  });

  if (!updatedOrder) {
    const doc = await db
      .collection(COLLECTIONS.MEAL_ORDERS)
      .doc(normalizedOrderId)
      .get()
      .catch(() => null);
    if (doc && doc.data) {
      updatedOrder = { _id: doc.data._id || normalizedOrderId, ...doc.data };
    }
  }

  if (experienceGain > 0) {
    await syncMemberLevelAfterMeal(openid);
  }

  return {
    order: mapMealOrderForMember({ _id: normalizedOrderId, ...(updatedOrder || {}) }),
    badges: updatedBadges ? normalizeMealOrderBadges(updatedBadges) : undefined,
    experienceGain
  };
}

function buildMealOrderItem(menuItem, quantity, categoryMap = {}) {
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 0));
  const unitPrice = Math.max(0, Math.round(Number(menuItem.price || 0)));
  const totalPrice = unitPrice * safeQuantity;
  const category = categoryMap[menuItem.categoryId] || null;
  return {
    itemId: menuItem.id,
    name: menuItem.name || '',
    quantity: safeQuantity,
    unit: menuItem.unit || '',
    price: unitPrice,
    totalPrice,
    categoryId: menuItem.categoryId || '',
    categoryName: category && category.name ? category.name : '',
    tags: Array.isArray(menuItem.tags) ? menuItem.tags : [],
    spicy: Number.isFinite(menuItem.spicy) ? Math.max(0, Math.floor(menuItem.spicy)) : 0
  };
}

function sanitizeMealNotes(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.slice(0, 120);
}

function normalizeMealOrderStatus(status) {
  if (typeof status !== 'string') {
    return 'pendingAdmin';
  }
  const trimmed = status.trim();
  if (!trimmed) {
    return 'pendingAdmin';
  }
  const normalized = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
  if (normalized === 'pending' || normalized === 'pendingadmin') {
    return 'pendingAdmin';
  }
  if (normalized === 'awaitingmember' || normalized === 'awaiting') {
    return 'awaitingMember';
  }
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
    return 'completed';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  return 'pendingAdmin';
}

function resolveMealOrderStatusLabel(status) {
  const labels = {
    pendingAdmin: '待备餐',
    awaitingMember: '待确认扣费',
    completed: '已完成',
    cancelled: '已取消'
  };
  return labels[status] || labels.pendingAdmin;
}

function mapMealOrderForMember(order) {
  if (!order) {
    return null;
  }
  const status = normalizeMealOrderStatus(order.status);
  const createdAt = resolveDateValue(order.createdAt) || new Date();
  const updatedAt = resolveDateValue(order.updatedAt);
  const confirmedAt = resolveDateValue(order.memberConfirmedAt || order.confirmedAt);
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const quantity = Math.max(1, Math.floor(Number(item.quantity || item.count || 0) || 0));
        const price = Math.max(0, Math.round(Number(item.price || 0)));
        const totalPrice = Math.max(0, Math.round(Number(item.totalPrice || price * quantity)));
        return {
          itemId: item.itemId || item.id || '',
          name: item.name || '',
          quantity,
          unit: item.unit || '',
          price,
          totalPrice,
          categoryId: item.categoryId || '',
          categoryName: item.categoryName || '',
          tags: Array.isArray(item.tags) ? item.tags : [],
          spicy: Number.isFinite(item.spicy) ? Math.max(0, Math.floor(item.spicy)) : 0
        };
      })
    : [];
  const totalAmount = Math.max(0, Math.round(Number(order.totalAmount || 0)));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    _id: order._id || order.id || '',
    orderId: order._id || order.id || '',
    status,
    statusLabel: resolveMealOrderStatusLabel(status),
    totalAmount,
    totalQuantity,
    memberNotes: order.memberNotes || '',
    adminNotes: order.adminNotes || '',
    menuVersion: order.menuVersion || '',
    createdAt: createdAt.toISOString(),
    createdAtTs: createdAt.getTime(),
    displayTime: formatDateTime(createdAt),
    updatedAt: updatedAt ? updatedAt.toISOString() : '',
    confirmedAt: confirmedAt ? confirmedAt.toISOString() : '',
    items,
    canConfirm: status === 'awaitingMember'
  };
}

function normalizeMealOrderBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    awaitingMemberCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  if (normalized.memberSeenVersion > normalized.memberVersion) {
    normalized.memberSeenVersion = normalized.memberVersion;
  }
  if (normalized.awaitingMemberCount < 0) {
    normalized.awaitingMemberCount = 0;
  }
  return normalized;
}

async function syncMemberLevelAfterMeal(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
      .get()
      .catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data || !levels.length) {
    return;
  }
  const normalized = normalizeAssetFields(memberDoc.data);
  const { member: withDefaults } = await ensureArchiveDefaults(normalized);
  await ensureLevelSync(withDefaults, levels);
}

function calculateExperienceGain(amountFen) {
  const numeric = Number(amountFen);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  const amountYuan = numeric / 100;
  return Math.max(0, Math.round(amountYuan * EXPERIENCE_PER_YUAN));
}

function resolveDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function padNumber(value) {
  return `${value}`.padStart(2, '0');
}

function formatDateTime(date) {
  const safe = date instanceof Date ? date : resolveDateValue(date);
  if (!safe) {
    return '';
  }
  const year = safe.getFullYear();
  const month = padNumber(safe.getMonth() + 1);
  const day = padNumber(safe.getDate());
  const hour = padNumber(safe.getHours());
  const minute = padNumber(safe.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
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
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
          .catch(() => {});
      }
    });

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
  const mealOrderBadges = normalizeMealOrderBadges(member.mealOrderBadges);
  const claimedLevelRewards = normalizeClaimedLevelRewards(member.claimedLevelRewards, levels);
  return {
    ...member,
    roles,
    level,
    reservationBadges,
    mealOrderBadges,
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
