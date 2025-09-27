const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels'
};

const ADMIN_ROLES = ['admin', 'developer'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'listMembers';

  switch (action) {
    case 'listMembers':
      return listMembers(OPENID, event.keyword || '', event.page || 1, event.pageSize || 20);
    case 'getMemberDetail':
      return getMemberDetail(OPENID, event.memberId);
    case 'updateMember':
      return updateMember(OPENID, event.memberId, event.updates || {});
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function ensureAdmin(openid) {
  if (!openid) {
    throw new Error('未获取到用户身份');
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .get()
    .catch(() => null);
  const member = doc && doc.data;
  if (!member) {
    throw new Error('账号不存在');
  }
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    throw new Error('无权访问管理员功能');
  }
  return member;
}

async function listMembers(openid, keyword, page, pageSize) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  const regex = keyword
    ? db.RegExp({
        regexp: keyword,
        options: 'i'
      })
    : null;

  let baseQuery = db.collection(COLLECTIONS.MEMBERS);
  if (regex) {
    baseQuery = baseQuery.where(
      _.or([
        { nickName: regex },
        { mobile: regex },
        { _id: regex }
      ])
    );
  }

  const [snapshot, countResult, levels] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count(),
    loadLevels()
  ]);

  const levelMap = buildLevelMap(levels);
  const members = snapshot.data.map((member) => decorateMemberRecord(member, levelMap));
  return {
    members,
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function getMemberDetail(openid, memberId) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  return fetchMemberDetail(memberId);
}

async function updateMember(openid, memberId, updates) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const payload = buildUpdatePayload(updates);
  if (!Object.keys(payload).length) {
    return fetchMemberDetail(memberId);
  }
  payload.updatedAt = new Date();
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .update({
      data: payload
    });
  return fetchMemberDetail(memberId);
}

async function fetchMemberDetail(memberId) {
  const [memberDoc, levels] = await Promise.all([
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null),
    loadLevels()
  ]);
  if (!memberDoc || !memberDoc.data) {
    throw new Error('会员不存在');
  }
  const levelMap = buildLevelMap(levels);
  return {
    member: decorateMemberRecord(memberDoc.data, levelMap),
    levels: levels.map((level) => ({
      _id: level._id,
      name: level.displayName || level.name,
      order: level.order
    }))
  };
}

async function loadLevels() {
  const snapshot = await db.collection(COLLECTIONS.LEVELS).orderBy('order', 'asc').get();
  return snapshot.data || [];
}

function buildLevelMap(levels) {
  const map = {};
  (levels || []).forEach((level) => {
    map[level._id] = level;
  });
  return map;
}

function decorateMemberRecord(member, levelMap) {
  const level = member.levelId ? levelMap[member.levelId] : null;
  const roles = Array.isArray(member.roles) && member.roles.length ? Array.from(new Set(member.roles)) : ['member'];
  const cashBalance = resolveCashBalance(member);
  const stoneBalance = resolveStoneBalance(member);
  return {
    _id: member._id,
    nickName: member.nickName || '',
    avatarUrl: member.avatarUrl || '',
    mobile: member.mobile || '',
    balance: cashBalance,
    cashBalance,
    cashBalanceYuan: formatFenToYuan(cashBalance),
    stoneBalance,
    stoneBalanceLabel: formatStoneLabel(stoneBalance),
    experience: Number(member.experience || 0),
    levelId: member.levelId || '',
    levelName: level ? level.displayName || level.name : '',
    roles,
    createdAt: formatDate(member.createdAt),
    updatedAt: formatDate(member.updatedAt),
    avatarConfig: member.avatarConfig || {}
  };
}

function buildUpdatePayload(updates) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'nickName')) {
    payload.nickName = updates.nickName || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'mobile')) {
    payload.mobile = updates.mobile || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'levelId')) {
    payload.levelId = updates.levelId || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'experience')) {
    const experience = Number(updates.experience || 0);
    payload.experience = Number.isFinite(experience) ? experience : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'cashBalance')) {
    const cash = Number(updates.cashBalance || 0);
    payload.cashBalance = Number.isFinite(cash) ? Math.round(cash) : 0;
  } else if (Object.prototype.hasOwnProperty.call(updates, 'balance')) {
    const legacy = Number(updates.balance || 0);
    payload.cashBalance = Number.isFinite(legacy) ? Math.round(legacy) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'stoneBalance')) {
    const stones = Number(updates.stoneBalance || 0);
    payload.stoneBalance = Number.isFinite(stones) ? Math.max(0, Math.floor(stones)) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'roles')) {
    const roles = Array.isArray(updates.roles) ? updates.roles : [];
    const filtered = roles.filter((role) => ['member', 'admin', 'developer'].includes(role));
    payload.roles = filtered.length ? filtered : ['member'];
  }
  return payload;
}

function resolveCashBalance(member) {
  if (!member) return 0;
  if (typeof member.cashBalance === 'number' && Number.isFinite(member.cashBalance)) {
    return member.cashBalance;
  }
  if (typeof member.balance === 'number' && Number.isFinite(member.balance)) {
    return member.balance;
  }
  return 0;
}

function resolveStoneBalance(member) {
  if (!member) return 0;
  const value = Number(member.stoneBalance);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

function formatFenToYuan(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return (numeric / 100).toFixed(2);
}

function formatStoneLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return Math.max(0, Math.floor(numeric)).toLocaleString('zh-CN');
}

function formatDate(value) {
  if (!value) return '';
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (err) {
      date = null;
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}
