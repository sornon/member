const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { listAvatarIds } = require('./avatar-catalog.js');
const { normalizeAvatarFrameValue } = require('./avatar-frames.js');
const {
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder,
  resolveBackgroundByRealmName,
  resolveBackgroundById
} = require('./shared/backgrounds.js');
const { getMenuCatalog, getMenuItemById } = require('../shared/menu-data.js');

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  RIGHTS_MASTER: 'membershipRights',
  MEMBER_RIGHTS: 'memberRights',
  MEMBER_EXTRAS: 'memberExtras',
  MEMBER_TIMELINE: 'memberTimeline',
  MEAL_ORDERS: 'mealOrders'
};

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
      return createMealOrder(OPENID, event.order || {});
    case 'listMealOrders':
      return listMealOrders(OPENID, event.options || {});
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

function formatFenToYuan(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return (numeric / 100).toFixed(2);
}

async function ensureMemberExists(openid) {
  if (!openid) {
    throw new Error('缺少会员身份');
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .get()
    .catch(() => null);
  if (!doc || !doc.data) {
    throw new Error('会员信息不存在');
  }
  return doc.data;
}

function normalizeOrderItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return [];
  }
  const aggregated = new Map();
  rawItems.forEach((item) => {
    if (!item) {
      return;
    }
    const id = typeof item.itemId === 'string' && item.itemId.trim()
      ? item.itemId.trim()
      : typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : '';
    if (!id) {
      return;
    }
    const quantityValue = Number(item.quantity);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      return;
    }
    const quantity = Math.max(1, Math.floor(quantityValue));
    const existing = aggregated.get(id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      aggregated.set(id, { itemId: id, quantity });
    }
  });
  return Array.from(aggregated.values());
}

function resolveDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch (error) {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = resolveDate(value);
  if (!date) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mm}`;
}

function decorateMealOrder(order) {
  if (!order) {
    return null;
  }
  const items = Array.isArray(order.items)
    ? order.items.map((item) => ({
        ...item,
        amount: Number(item.amount || item.price * item.quantity || 0),
        amountLabel: `¥${formatFenToYuan(item.amount || item.price * item.quantity || 0)}`
      }))
    : [];
  const totalAmount = Number(order.totalAmount || 0);
  const totalQuantity = Number(order.totalQuantity || items.reduce((sum, item) => sum + (item.quantity || 0), 0));
  const createdAt = resolveDate(order.createdAt || order.submittedAt || order.createdAtLabel || null) || new Date();
  const updatedAt = resolveDate(order.updatedAt || createdAt) || createdAt;
  return {
    ...order,
    items,
    totalAmount,
    totalQuantity,
    totalAmountLabel: `¥${formatFenToYuan(totalAmount)}`,
    createdAt,
    createdAtLabel: formatDateTime(createdAt),
    updatedAt,
    updatedAtLabel: formatDateTime(updatedAt)
  };
}

async function listMealMenu(openid) {
  await ensureMemberExists(openid);
  return {
    categories: getMenuCatalog()
  };
}

async function createMealOrder(openid, payload = {}) {
  const member = await ensureMemberExists(openid);
  if (!member) {
    throw new Error('会员不存在');
  }
  const normalizedItems = normalizeOrderItems(payload.items);
  if (!normalizedItems.length) {
    throw new Error('请先选择菜品');
  }

  const orderItems = [];
  let totalAmount = 0;
  let totalQuantity = 0;

  normalizedItems.forEach((entry) => {
    const menuItem = getMenuItemById(entry.itemId);
    if (!menuItem) {
      throw new Error('菜品信息已更新，请刷新菜单');
    }
    const quantity = Math.max(1, Math.floor(entry.quantity));
    const price = Number(menuItem.price || 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('菜品价格无效');
    }
    const amount = price * quantity;
    totalAmount += amount;
    totalQuantity += quantity;
    orderItems.push({
      itemId: menuItem.id,
      name: menuItem.name,
      price,
      quantity,
      amount,
      unit: menuItem.unit || '',
      categoryId: menuItem.categoryId,
      categoryName: menuItem.categoryName
    });
  });

  if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('订单金额无效');
  }

  const memberNote = typeof payload.note === 'string' ? payload.note.trim().slice(0, 200) : '';
  const now = new Date();
  const history = [
    {
      type: 'status',
      status: 'pending',
      createdAt: now,
      actor: 'member',
      actorId: openid,
      actorName: member.nickName || '',
      note: memberNote || '会员提交订单'
    }
  ];

  const result = await db.collection(COLLECTIONS.MEAL_ORDERS).add({
    data: {
      memberId: openid,
      status: 'pending',
      totalAmount,
      totalQuantity,
      items: orderItems,
      memberNote,
      kitchenNote: '',
      paymentNote: '',
      createdAt: now,
      updatedAt: now,
      history
    }
  });

  return {
    success: true,
    orderId: result._id,
    totalAmount,
    totalQuantity
  };
}

async function listMealOrders(openid, options = {}) {
  await ensureMemberExists(openid);
  const page = Number(options.page) || 1;
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 20, 1), 50);
  const skip = Math.max(page - 1, 0) * pageSize;

  const baseCollection = db.collection(COLLECTIONS.MEAL_ORDERS).where({ memberId: openid });
  const [snapshot, countResult] = await Promise.all([
    baseCollection
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get(),
    baseCollection.count()
  ]);

  const orders = snapshot.data.map((order) => decorateMealOrder(order));
  return {
    orders,
    page,
    pageSize,
    total: countResult.total || orders.length
  };
}

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
