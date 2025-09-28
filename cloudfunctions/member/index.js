const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { listAvatarIds } = require('../../miniprogram/shared/avatar-catalog.js');
const { normalizeAvatarFrameValue } = require('../../miniprogram/shared/avatar-frames.js');

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  RIGHTS_MASTER: 'membershipRights',
  MEMBER_RIGHTS: 'memberRights'
};

const GENDER_OPTIONS = ['unknown', 'male', 'female'];
const AVATAR_ID_PATTERN = /^(male|female)-([a-z]+)-(\d+)$/;
const ALLOWED_AVATAR_IDS = new Set(listAvatarIds());

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
    case 'completeProfile':
      return completeProfile(OPENID, event);
    case 'updateArchive':
      return updateArchive(OPENID, event.updates || {});
    case 'redeemRenameCard':
      return redeemRenameCard(OPENID, event.count || 1);
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
    mobile: profile.mobile || '',
    gender: normalizeGender(profile.gender),
    levelId: defaultLevel ? defaultLevel._id : '',
    experience: 0,
    cashBalance: 0,
    totalRecharge: 0,
    totalSpend: 0,
    stoneBalance: 0,
    roles: ['member'],
    avatarUnlocks: [],
    createdAt: now,
    updatedAt: now,
    avatarConfig: {},
    renameCredits: 1,
    renameUsed: 0,
    renameCards: 0,
    renameHistory: [],
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
  const withDefaults = await ensureArchiveDefaults(normalized);
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
  const withDefaults = await ensureArchiveDefaults(normalized);
  const member = await ensureLevelSync(withDefaults, levels);
  const currentLevel = levels.find((lvl) => lvl._id === member.levelId) || levels[0];
  const nextLevel = getNextLevel(levels, currentLevel);
  const percentage = calculatePercentage(member.experience, currentLevel, nextLevel);
  const nextDiff = nextLevel ? Math.max(nextLevel.threshold - member.experience, 0) : 0;
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
      rewards: (lvl.rewards || []).map((reward) => reward.description || reward.name || '')
    })),
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
  const avatarFrame = normalizeAvatarFrameValue(profile.avatarFrame || '');
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
  if (avatarFrame) {
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

async function ensureArchiveDefaults(member) {
  if (!member || !member._id) {
    return member;
  }
  const updates = {};
  if (!GENDER_OPTIONS.includes(member.gender)) {
    member.gender = 'unknown';
    updates.gender = 'unknown';
  }

  const renameUsed = Number.isFinite(member.renameUsed) ? Math.max(0, Math.floor(member.renameUsed)) : 0;
  if (!Object.is(renameUsed, member.renameUsed)) {
    updates.renameUsed = renameUsed;
    member.renameUsed = renameUsed;
  } else {
    member.renameUsed = renameUsed;
  }

  const hasRenameCredits = Object.prototype.hasOwnProperty.call(member, 'renameCredits');
  const rawRenameCredits = hasRenameCredits ? member.renameCredits : Math.max(0, 1 - renameUsed);
  const numericRenameCredits = Number(rawRenameCredits);
  const renameCredits = Number.isFinite(numericRenameCredits)
    ? Math.max(0, Math.floor(numericRenameCredits))
    : Math.max(0, 1 - renameUsed);
  if (!Object.is(renameCredits, member.renameCredits)) {
    updates.renameCredits = renameCredits;
    member.renameCredits = renameCredits;
  } else {
    member.renameCredits = renameCredits;
  }

  const renameCards = Number.isFinite(member.renameCards) ? Math.max(0, Math.floor(member.renameCards)) : 0;
  if (!Object.is(renameCards, member.renameCards)) {
    updates.renameCards = renameCards;
    member.renameCards = renameCards;
  } else {
    member.renameCards = renameCards;
  }

  if (!Array.isArray(member.renameHistory)) {
    member.renameHistory = [];
    updates.renameHistory = [];
  } else if (member.renameHistory.length > 20) {
    member.renameHistory = member.renameHistory.slice(-20);
    updates.renameHistory = member.renameHistory;
  }

  const avatarUnlocks = normalizeAvatarUnlocksList(member.avatarUnlocks);
  const originalUnlocks = Array.isArray(member.avatarUnlocks) ? member.avatarUnlocks : [];
  const unlocksChanged =
    avatarUnlocks.length !== originalUnlocks.length ||
    avatarUnlocks.some((value, index) => value !== originalUnlocks[index]);
  if (unlocksChanged) {
    updates.avatarUnlocks = avatarUnlocks;
  }
  member.avatarUnlocks = avatarUnlocks;

  const avatarFrame = normalizeAvatarFrameValue(member.avatarFrame || '');
  if (!Object.is(avatarFrame, member.avatarFrame || '')) {
    updates.avatarFrame = avatarFrame;
    member.avatarFrame = avatarFrame;
  } else {
    member.avatarFrame = avatarFrame;
  }

  const usageCountRaw = Number(member.roomUsageCount);
  const usageCount = Number.isFinite(usageCountRaw) ? Math.max(0, Math.floor(usageCountRaw)) : 0;
  if (!Object.is(usageCount, member.roomUsageCount)) {
    updates.roomUsageCount = usageCount;
    member.roomUsageCount = usageCount;
  } else {
    member.roomUsageCount = usageCount;
  }

  const badges = normalizeReservationBadges(member.reservationBadges);
  const originalBadges = member.reservationBadges || {};
  const badgeChanged = Object.keys(badges).some((key) => !Object.is(badges[key], originalBadges[key]));
  if (badgeChanged) {
    updates.reservationBadges = badges;
  }
  member.reservationBadges = badges;

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: updates
      })
      .catch(() => {});
  }

  return member;
}

async function updateArchive(openid, updates = {}) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    await initMember(openid, {});
    return updateArchive(openid, updates);
  }

  const normalized = normalizeAssetFields(existing.data);
  const member = await ensureArchiveDefaults(normalized);
  const now = new Date();
  const patch = {};
  let renamed = false;

  if (typeof updates.nickName === 'string') {
    const nickName = updates.nickName.trim();
    if (nickName && nickName !== member.nickName) {
      if ((member.renameCredits || 0) <= 0) {
        throw createError('RENAME_QUOTA_EXCEEDED', '剩余改名次数不足，请使用改名卡增加次数');
      }
      patch.nickName = nickName;
      renamed = true;
      const history = Array.isArray(member.renameHistory) ? [...member.renameHistory] : [];
      history.push({
        previous: member.nickName || '',
        current: nickName,
        changedAt: now,
        source: updates.source || 'manual'
      });
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
      patch.renameHistory = history;
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

  if (!Object.keys(patch).length) {
    return decorateMember(member, await loadLevels());
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
  const member = await ensureArchiveDefaults(normalized);
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
  return {
    ...member,
    roles,
    level,
    reservationBadges
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
