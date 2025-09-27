const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  CHARGE_ORDERS: 'chargeOrders',
  WALLET_TRANSACTIONS: 'walletTransactions'
};

const ADMIN_ROLES = ['admin', 'developer'];

function normalizeAction(action) {
  if (typeof action === 'string') {
    const trimmed = action.trim();
    if (trimmed) {
      if (trimmed === 'listChargeOrder') {
        return 'listChargeOrders';
      }
      return trimmed;
    }
  }
  return 'listMembers';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = normalizeAction(event.action);

  switch (action) {
    case 'listMembers':
      return listMembers(OPENID, event.keyword || '', event.page || 1, event.pageSize || 20);
    case 'getMemberDetail':
      return getMemberDetail(OPENID, event.memberId);
    case 'updateMember':
      return updateMember(OPENID, event.memberId, event.updates || {});
    case 'createChargeOrder':
      return createChargeOrder(OPENID, event.items || []);
    case 'getChargeOrder':
      return getChargeOrder(OPENID, event.orderId);
    case 'listChargeOrders':
      return listChargeOrders(OPENID, {
        page: event.page || 1,
        pageSize: event.pageSize || 20,
        memberId: event.memberId || '',
        keyword: event.keyword || ''
      });
    case 'rechargeMember':
      return rechargeMember(OPENID, event.memberId, event.amount);
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

async function createChargeOrder(openid, items) {
  const admin = await ensureAdmin(openid);
  const normalizedItems = normalizeChargeItems(items);
  if (!normalizedItems.length) {
    throw new Error('请添加有效的扣费商品');
  }
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  if (!totalAmount || totalAmount <= 0) {
    throw new Error('扣费金额无效');
  }
  const now = new Date();
  const expireAt = new Date(now.getTime() + 10 * 60 * 1000);
  const orderData = {
    status: 'pending',
    items: normalizedItems,
    totalAmount,
    stoneReward: totalAmount,
    createdBy: admin._id,
    createdAt: now,
    updatedAt: now,
    expireAt
  };
  const result = await db.collection(COLLECTIONS.CHARGE_ORDERS).add({
    data: orderData
  });
  return mapChargeOrder({
    _id: result._id,
    ...orderData
  });
}

async function getChargeOrder(openid, orderId) {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少扣费单编号');
  }
  const doc = await db
    .collection(COLLECTIONS.CHARGE_ORDERS)
    .doc(orderId)
    .get()
    .catch(() => null);
  if (!doc || !doc.data) {
    throw new Error('扣费单不存在');
  }
  return mapChargeOrder({
    _id: doc.data._id || orderId,
    ...doc.data
  });
}

async function listChargeOrders(openid, { page = 1, pageSize = 20, memberId = '', keyword = '' }) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  let baseQuery = db.collection(COLLECTIONS.CHARGE_ORDERS);
  let memberIdFilter = memberId && typeof memberId === 'string' ? memberId.trim() : '';

  if (!memberIdFilter && keyword) {
    const matchedMemberIds = (await searchMemberIdsByKeyword(keyword)).slice(0, 10);
    if (!matchedMemberIds.length) {
      return {
        orders: [],
        total: 0,
        page,
        pageSize: limit
      };
    }
    memberIdFilter = null;
    baseQuery = baseQuery.where({
      memberId: _.in(matchedMemberIds)
    });
  } else if (memberIdFilter) {
    baseQuery = baseQuery.where({ memberId: memberIdFilter });
  }

  const [snapshot, countResult] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count()
  ]);

  const rawOrders = snapshot.data || [];
  const memberIds = Array.from(
    new Set(
      rawOrders
        .map((order) => order.memberId)
        .filter((id) => typeof id === 'string' && id)
    )
  );
  const memberMap = await loadMembersMap(memberIds);

  const orders = rawOrders.map((order) =>
    decorateChargeOrderRecord(
      mapChargeOrder({
        _id: order._id,
        ...order
      }),
      memberMap[order.memberId]
    )
  );

  return {
    orders,
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function rechargeMember(openid, memberId, amount) {
  await ensureAdmin(openid);
  const numericAmount = normalizeAmountFen(amount);
  if (!numericAmount || numericAmount <= 0) {
    throw new Error('充值金额无效');
  }
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(memberId);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    await memberRef.update({
      data: {
        cashBalance: _.inc(numericAmount),
        updatedAt: now
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId,
        amount: numericAmount,
        type: 'recharge',
        status: 'success',
        source: 'admin',
        remark: '管理员充值',
        createdAt: now,
        updatedAt: now
      }
    });
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

function normalizeAmountFen(value) {
  if (value == null) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const sanitized = trimmed.replace(/[^0-9.-]/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return 0;
}

function normalizeChargeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((raw) => {
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const quantity = Number(raw.quantity || 0);
      const price = normalizeAmountFen(raw.price);
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || !price || price <= 0) {
        return null;
      }
      const normalizedQuantity = Math.floor(quantity);
      const amount = price * normalizedQuantity;
      return {
        name,
        price,
        quantity: normalizedQuantity,
        amount
      };
    })
    .filter(Boolean);
}

function mapChargeOrder(order) {
  if (!order) return null;
  const totalAmount = Number(order.totalAmount || 0);
  return {
    _id: order._id,
    status: order.status || 'pending',
    items: (order.items || []).map((item) => ({
      name: item.name || '',
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      amount: Number(item.amount || 0)
    })),
    totalAmount,
    stoneReward: Number(order.stoneReward || totalAmount || 0),
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    expireAt: order.expireAt || null,
    memberId: order.memberId || '',
    confirmedAt: order.confirmedAt || null,
    qrPayload: buildChargeOrderPayload(order._id)
  };
}

function buildChargeOrderPayload(orderId) {
  if (!orderId) return '';
  return `member-charge:${orderId}`;
}

function decorateChargeOrderRecord(order, member) {
  if (!order) return null;
  return {
    ...order,
    totalAmountLabel: `¥${formatFenToYuan(order.totalAmount)}`,
    stoneRewardLabel: `${formatStoneLabel(order.stoneReward)} 枚`,
    createdAtLabel: formatDate(order.createdAt),
    updatedAtLabel: formatDate(order.updatedAt),
    confirmedAtLabel: formatDate(order.confirmedAt),
    statusLabel: describeChargeOrderStatus(order.status),
    memberId: order.memberId || '',
    memberName: member ? member.nickName || '' : '',
    memberMobile: member ? member.mobile || '' : ''
  };
}

function describeChargeOrderStatus(status) {
  switch (status) {
    case 'paid':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已过期';
    default:
      return '待支付';
  }
}

async function loadMembersMap(memberIds) {
  if (!Array.isArray(memberIds) || !memberIds.length) {
    return {};
  }
  const chunks = [];
  const size = 10;
  for (let i = 0; i < memberIds.length; i += size) {
    chunks.push(memberIds.slice(i, i + size));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      db
        .collection(COLLECTIONS.MEMBERS)
        .where({ _id: _.in(ids) })
        .get()
        .catch(() => ({ data: [] }))
    )
  );
  const map = {};
  results.forEach((res) => {
    (res.data || []).forEach((member) => {
      map[member._id] = member;
    });
  });
  return map;
}

async function searchMemberIdsByKeyword(keyword) {
  if (!keyword) {
    return [];
  }
  const regex = db.RegExp({
    regexp: keyword,
    options: 'i'
  });
  const snapshot = await db
    .collection(COLLECTIONS.MEMBERS)
    .where(
      _.or([
        { _id: regex },
        { nickName: regex },
        { mobile: regex }
      ])
    )
    .limit(20)
    .get()
    .catch(() => ({ data: [] }));
  const ids = new Set();
  (snapshot.data || []).forEach((member) => {
    if (member && member._id) {
      ids.add(member._id);
    }
  });
  return Array.from(ids);
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
