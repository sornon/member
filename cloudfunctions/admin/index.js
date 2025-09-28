const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  CHARGE_ORDERS: 'chargeOrders',
  WALLET_TRANSACTIONS: 'walletTransactions',
  RESERVATIONS: 'reservations',
  ROOMS: 'rooms',
  MEMBER_RIGHTS: 'memberRights'
};

const EXPERIENCE_PER_YUAN = 100;

const ADMIN_ROLES = ['admin', 'developer'];

const ACTIONS = {
  LIST_MEMBERS: 'listMembers',
  GET_MEMBER_DETAIL: 'getMemberDetail',
  UPDATE_MEMBER: 'updateMember',
  CREATE_CHARGE_ORDER: 'createChargeOrder',
  GET_CHARGE_ORDER: 'getChargeOrder',
  LIST_CHARGE_ORDERS: 'listChargeOrders',
  GET_CHARGE_ORDER_QR_CODE: 'getChargeOrderQrCode',
  RECHARGE_MEMBER: 'rechargeMember',
  LIST_RESERVATIONS: 'listReservations',
  APPROVE_RESERVATION: 'approveReservation',
  REJECT_RESERVATION: 'rejectReservation'
};

const ACTION_ALIASES = {
  listmembers: ACTIONS.LIST_MEMBERS,
  getmemberdetail: ACTIONS.GET_MEMBER_DETAIL,
  updatemember: ACTIONS.UPDATE_MEMBER,
  createchargeorder: ACTIONS.CREATE_CHARGE_ORDER,
  getchargeorder: ACTIONS.GET_CHARGE_ORDER,
  getchargeorderqrcode: ACTIONS.GET_CHARGE_ORDER_QR_CODE,
  listchargeorders: ACTIONS.LIST_CHARGE_ORDERS,
  listchargeorder: ACTIONS.LIST_CHARGE_ORDERS,
  rechargemember: ACTIONS.RECHARGE_MEMBER,
  listreservations: ACTIONS.LIST_RESERVATIONS,
  approvereservation: ACTIONS.APPROVE_RESERVATION,
  rejectreservation: ACTIONS.REJECT_RESERVATION
};

function normalizeAction(action) {
  if (typeof action === 'string' || action instanceof String) {
    const trimmed = String(action).trim();
    if (trimmed) {
      const canonical = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
      return ACTION_ALIASES[canonical] || trimmed;
    }
  }
  return ACTIONS.LIST_MEMBERS;
}

const ACTION_HANDLERS = {
  [ACTIONS.LIST_MEMBERS]: (openid, event) =>
    listMembers(openid, event.keyword || '', event.page || 1, event.pageSize || 20),
  [ACTIONS.GET_MEMBER_DETAIL]: (openid, event) => getMemberDetail(openid, event.memberId),
  [ACTIONS.UPDATE_MEMBER]: (openid, event) => updateMember(openid, event.memberId, event.updates || {}),
  [ACTIONS.CREATE_CHARGE_ORDER]: (openid, event) => createChargeOrder(openid, event.items || []),
  [ACTIONS.GET_CHARGE_ORDER]: (openid, event) => getChargeOrder(openid, event.orderId),
  [ACTIONS.GET_CHARGE_ORDER_QR_CODE]: (openid, event) => getChargeOrderQrCode(openid, event.orderId),
  [ACTIONS.LIST_CHARGE_ORDERS]: (openid, event) =>
    listChargeOrders(openid, {
      page: event.page || 1,
      pageSize: event.pageSize || 20,
      memberId: event.memberId || '',
      keyword: event.keyword || ''
    }),
  [ACTIONS.RECHARGE_MEMBER]: (openid, event) => rechargeMember(openid, event.memberId, event.amount),
  [ACTIONS.LIST_RESERVATIONS]: (openid, event) =>
    listReservations(openid, {
      status: event.status || 'pendingApproval',
      page: event.page || 1,
      pageSize: event.pageSize || 20
    }),
  [ACTIONS.APPROVE_RESERVATION]: (openid, event) => approveReservation(openid, event.reservationId),
  [ACTIONS.REJECT_RESERVATION]: (openid, event) => rejectReservation(openid, event.reservationId, event.reason || '')
};

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const rawAction =
    event.action ?? event.actionName ?? event.action_type ?? event.type ?? event.operation;
  const action = normalizeAction(rawAction);
  const handler = ACTION_HANDLERS[action];

  if (!handler) {
    throw new Error(`Unknown action: ${action}`);
  }

  return handler(OPENID, event);
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
  const memberDoc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .get()
    .catch(() => null);
  if (!memberDoc || !memberDoc.data) {
    throw new Error('会员不存在');
  }
  const payload = buildUpdatePayload(updates, memberDoc.data);
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

async function getChargeOrderQrCode(openid, orderId) {
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

  const orderIdValue = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!orderIdValue) {
    throw new Error('扣费单编号无效');
  }

  const scene = buildChargeOrderScene(orderIdValue);
  if (!scene) {
    console.warn('Charge order scene fallback to raw id because scene is empty', orderIdValue);
  }

  const schemeResult = await generateChargeOrderUrlScheme(orderIdValue, doc.data.expireAt);

  return {
    scene,
    page: 'pages/wallet/charge-confirm/index',
    path: buildChargeOrderPagePath(orderIdValue),
    payload: buildChargeOrderPayload(orderIdValue),
    schemeUrl: schemeResult.schemeUrl,
    schemeExpireAt: schemeResult.schemeExpireAt
  };
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
  const experienceGain = calculateExperienceGain(numericAmount);
  await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(memberId);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    await memberRef.update({
      data: {
        cashBalance: _.inc(numericAmount),
        totalRecharge: _.inc(numericAmount),
        updatedAt: now,
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
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
  if (experienceGain > 0) {
    await syncMemberLevel(memberId);
  }
  return fetchMemberDetail(memberId);
}

async function listReservations(openid, { status = 'pendingApproval', page = 1, pageSize = 20 } = {}) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  let baseQuery = db.collection(COLLECTIONS.RESERVATIONS);
  if (status && status !== 'all') {
    baseQuery = baseQuery.where({ status });
  }

  const [snapshot, countResult] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count()
  ]);

  const reservations = snapshot.data || [];
  const memberIds = Array.from(
    new Set(reservations.map((item) => item.memberId).filter((id) => typeof id === 'string' && id))
  );
  const roomIds = Array.from(
    new Set(reservations.map((item) => item.roomId).filter((id) => typeof id === 'string' && id))
  );

  const [memberMap, roomMap] = await Promise.all([
    loadMembersMap(memberIds),
    loadRoomsMap(roomIds)
  ]);

  return {
    reservations: reservations.map((item) =>
      decorateReservationRecord(
        { _id: item._id, ...item },
        memberMap[item.memberId],
        roomMap[item.roomId]
      )
    ),
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function approveReservation(openid, reservationId) {
  await ensureAdmin(openid);
  if (!reservationId) {
    throw new Error('缺少预约编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = snapshot.data;
    if (reservation.status === 'approved') {
      return;
    }
    if (reservation.status !== 'pendingApproval') {
      throw new Error('预约已处理，无法重复审核');
    }
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'approved',
        approval: {
          ...(reservation.approval || {}),
          status: 'approved',
          decidedAt: now,
          decidedBy: openid,
          reason: ''
        },
        updatedAt: now
      }
    });
  });
  return getReservationRecord(reservationId);
}

async function rejectReservation(openid, reservationId, reason = '') {
  await ensureAdmin(openid);
  if (!reservationId) {
    throw new Error('缺少预约编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = { ...snapshot.data, _id: reservationId };
    if (reservation.status === 'rejected') {
      return;
    }
    if (reservation.status !== 'pendingApproval') {
      throw new Error('预约已处理，无法拒绝');
    }
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'rejected',
        approval: {
          ...(reservation.approval || {}),
          status: 'rejected',
          decidedAt: now,
          decidedBy: openid,
          reason: reason || ''
        },
        updatedAt: now
      }
    });

    await releaseReservationResources(transaction, reservation, { refundUsage: true, unlockRight: true });
  });

  return getReservationRecord(reservationId);
}

async function getReservationRecord(reservationId) {
  if (!reservationId) {
    return null;
  }
  const snapshot = await db
    .collection(COLLECTIONS.RESERVATIONS)
    .doc(reservationId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    return null;
  }
  const reservation = { _id: reservationId, ...snapshot.data };
  const [memberMap, roomMap] = await Promise.all([
    loadMembersMap(reservation.memberId ? [reservation.memberId] : []),
    loadRoomsMap(reservation.roomId ? [reservation.roomId] : [])
  ]);
  return decorateReservationRecord(
    reservation,
    reservation.memberId ? memberMap[reservation.memberId] : null,
    reservation.roomId ? roomMap[reservation.roomId] : null
  );
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

async function syncMemberLevel(memberId) {
  const [memberDoc, levels] = await Promise.all([
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null),
    loadLevels()
  ]);
  if (!memberDoc || !memberDoc.data) return;
  const member = memberDoc.data;
  if (!Array.isArray(levels) || !levels.length) return;
  const targetLevel = resolveLevelByExperience(Number(member.experience || 0), levels);
  if (!targetLevel || targetLevel._id === member.levelId) {
    return;
  }
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .update({
      data: {
        levelId: targetLevel._id,
        updatedAt: new Date()
      }
    });
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
    gender: normalizeGenderValue(member.gender),
    renameCredits: normalizeRenameCredits(member.renameCredits),
    renameUsed: normalizeRenameUsed(member.renameUsed),
    renameCards: normalizeRenameCredits(member.renameCards),
    renameHistory: formatRenameHistory(member.renameHistory),
    createdAt: formatDate(member.createdAt),
    updatedAt: formatDate(member.updatedAt),
    avatarConfig: member.avatarConfig || {},
    roomUsageCount: normalizeUsageCount(member.roomUsageCount)
  };
}

function decorateReservationRecord(reservation, member, room) {
  const status = reservation.status || 'pendingApproval';
  return {
    _id: reservation._id,
    memberId: reservation.memberId || '',
    memberName: member ? member.nickName || member.name || '' : '',
    memberMobile: member ? member.mobile || '' : '',
    roomId: reservation.roomId || '',
    roomName: room ? room.name || '' : '',
    date: reservation.date || '',
    startTime: reservation.startTime || '',
    endTime: reservation.endTime || '',
    status,
    statusLabel: resolveReservationStatusLabel(status),
    approval: reservation.approval || null,
    price: Number(reservation.price || 0),
    usageCredits: normalizeUsageCount(reservation.usageCredits),
    createdAt: formatDate(reservation.createdAt),
    updatedAt: formatDate(reservation.updatedAt)
  };
}

function resolveReservationStatusLabel(status) {
  const map = {
    pendingApproval: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    cancelled: '已取消',
    reserved: '已预约',
    confirmed: '已确认',
    pendingPayment: '待支付'
  };
  return map[status] || '待处理';
}

async function loadRoomsMap(roomIds) {
  if (!Array.isArray(roomIds) || !roomIds.length) {
    return {};
  }
  const snapshot = await db
    .collection(COLLECTIONS.ROOMS)
    .where({
      _id: _.in(roomIds)
    })
    .get();
  const map = {};
  (snapshot.data || []).forEach((room) => {
    map[room._id] = room;
  });
  return map;
}

async function releaseReservationResources(transaction, reservation, options = {}) {
  const { refundUsage = false, unlockRight = true } = options;
  if (!reservation || !reservation._id) {
    return;
  }
  const updates = {};
  if (refundUsage && !reservation.usageRefunded) {
    const credits = normalizeUsageCount(reservation.usageCredits || 1);
    if (credits > 0) {
      await transaction
        .collection(COLLECTIONS.MEMBERS)
        .doc(reservation.memberId)
        .update({
          data: {
            roomUsageCount: _.inc(credits),
            updatedAt: new Date()
          }
        })
        .catch(() => {});
      updates.usageRefunded = true;
    }
  }
  if (unlockRight && reservation.rightId) {
    await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .doc(reservation.rightId)
      .update({
        data: {
          status: 'active',
          reservationId: _.remove(),
          updatedAt: new Date()
        }
      })
      .catch(() => {});
  }
  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservation._id).update({
      data: updates
    });
  }
}

function normalizeUsageCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function buildUpdatePayload(updates, existing = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'nickName')) {
    const input = updates.nickName;
    const currentName = typeof existing.nickName === 'string' ? existing.nickName : '';
    const target = typeof input === 'string' ? input.trim() : '';
    if (target !== currentName) {
      payload.nickName = target;
      if (target) {
        const history = Array.isArray(existing.renameHistory) ? existing.renameHistory.slice() : [];
        const now = new Date();
        history.push({
          previous: currentName || '',
          current: target,
          changedAt: now,
          source: 'admin'
        });
        if (history.length > 20) {
          history.splice(0, history.length - 20);
        }
        payload.renameHistory = history;
        const renameUsed = Number(existing.renameUsed || 0);
        payload.renameUsed = Number.isFinite(renameUsed) ? renameUsed + 1 : 1;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'mobile')) {
    payload.mobile = updates.mobile || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'levelId')) {
    payload.levelId = updates.levelId || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'gender')) {
    payload.gender = normalizeGenderValue(updates.gender);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatarUrl')) {
    payload.avatarUrl = typeof updates.avatarUrl === 'string' ? updates.avatarUrl.trim() : '';
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
  if (Object.prototype.hasOwnProperty.call(updates, 'renameCredits')) {
    const credits = Number(updates.renameCredits || 0);
    payload.renameCredits = Number.isFinite(credits) ? Math.max(0, Math.floor(credits)) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'roomUsageCount')) {
    payload.roomUsageCount = normalizeUsageCount(updates.roomUsageCount);
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

function normalizeGenderValue(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'male' || normalized === '1') {
    return 'male';
  }
  if (normalized === 'female' || normalized === '2') {
    return 'female';
  }
  return 'unknown';
}

function normalizeRenameCredits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeRenameUsed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function formatRenameHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.slice(-20).map((item, index) => {
    const changedAt = item && item.changedAt ? item.changedAt : null;
    let timestamp = Date.now();
    if (changedAt) {
      const date = changedAt instanceof Date ? changedAt : new Date(changedAt);
      if (!Number.isNaN(date.getTime())) {
        timestamp = date.getTime();
      }
    }
    return {
      id: item && item.id ? item.id : `${timestamp}-${index}`,
      previous: (item && item.previous) || '',
      current: (item && item.current) || '',
      changedAt,
      changedAtLabel: formatDate(changedAt),
      source: (item && item.source) || 'manual'
    };
  });
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
    qrPayload: buildChargeOrderPayload(order._id),
    miniProgramScene: buildChargeOrderScene(order._id)
  };
}

function buildChargeOrderPayload(orderId) {
  if (!orderId) return '';
  return `member-charge:${orderId}`;
}

function buildChargeOrderScene(orderId) {
  if (!orderId) {
    return '';
  }
  const value = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!value) {
    return '';
  }
  return value.length > 32 ? '' : value;
}

function buildChargeOrderPagePath(orderId) {
  const basePath = 'pages/wallet/charge-confirm/index';
  if (!orderId) {
    return basePath;
  }
  const trimmed = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!trimmed) {
    return basePath;
  }
  const encoded = encodeURIComponent(trimmed);
  return `${basePath}?orderId=${encoded}`;
}

async function generateChargeOrderUrlScheme(orderId, expireAt) {
  const queryValue = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!queryValue) {
    return { schemeUrl: '', schemeExpireAt: null };
  }

  const expireTimestamp = resolveExpireTimestamp(expireAt);
  const envOptions = resolveUrlSchemeEnvOptions();
  const path = 'pages/wallet/charge-confirm/index';
  const query = `orderId=${encodeURIComponent(queryValue)}`;

  const schemeResult = await tryGenerateUrlScheme({ path, query }, expireTimestamp, envOptions);
  if (schemeResult) {
    return schemeResult;
  }

  const linkResult = await tryGenerateUrlLink({ path, query }, expireTimestamp, envOptions);
  if (linkResult) {
    return linkResult;
  }

  return { schemeUrl: '', schemeExpireAt: null };
}

async function tryGenerateUrlScheme({ path, query }, expireTimestamp, envOptions) {
  const canGenerate =
    cloud.openapi &&
    cloud.openapi.urlscheme &&
    typeof cloud.openapi.urlscheme.generate === 'function';
  if (!canGenerate) {
    return null;
  }

  let lastError = null;
  for (const option of envOptions) {
    try {
      const payload = {
        jumpWxa: {
          path,
          query
        },
        isExpire: typeof expireTimestamp === 'number'
      };

      if (option.envVersion) {
        payload.jumpWxa.envVersion = option.envVersion;
      }

      if (typeof expireTimestamp === 'number') {
        payload.expireTime = expireTimestamp;
      }

      const response = await cloud.openapi.urlscheme.generate(payload);
      if (response && response.scheme) {
        return {
          schemeUrl: response.scheme,
          schemeExpireAt: resolveExpireDate(expireTimestamp)
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `Failed to generate url scheme for charge order in env ${option.envVersion || 'release'}`,
        error
      );
    }
  }

  if (lastError) {
    console.error('Failed to generate url scheme for charge order after retries', lastError);
  }

  return null;
}

async function tryGenerateUrlLink({ path, query }, expireTimestamp, envOptions) {
  const canGenerate =
    cloud.openapi &&
    cloud.openapi.urllink &&
    typeof cloud.openapi.urllink.generate === 'function';
  if (!canGenerate) {
    return null;
  }

  let lastError = null;
  for (const option of envOptions) {
    try {
      const payload = {
        path,
        query,
        isExpire: typeof expireTimestamp === 'number'
      };

      if (option.envVersion) {
        payload.envVersion = option.envVersion;
      }

      if (typeof expireTimestamp === 'number') {
        payload.expireType = 1;
        payload.expireTime = expireTimestamp;
      }

      const response = await cloud.openapi.urllink.generate(payload);
      if (response && response.urlLink) {
        return {
          schemeUrl: response.urlLink,
          schemeExpireAt: resolveExpireDate(expireTimestamp)
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `Failed to generate url link for charge order in env ${option.envVersion || 'release'}`,
        error
      );
    }
  }

  if (lastError) {
    console.error('Failed to generate url link for charge order after retries', lastError);
  }

  return null;
}

function resolveUrlSchemeEnvOptions() {
  const configured = getConfiguredEnvVersion();
  if (configured) {
    return [{ envVersion: configured }];
  }
  return [{ envVersion: 'release' }, { envVersion: 'trial' }, { envVersion: 'develop' }];
}

function resolveExpireTimestamp(expireAt) {
  if (!expireAt) {
    return undefined;
  }

  const date = expireAt instanceof Date ? expireAt : new Date(expireAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const timestamp = Math.floor(date.getTime() / 1000);
  if (timestamp <= 0) {
    return undefined;
  }

  const now = Math.floor(Date.now() / 1000);
  if (timestamp <= now) {
    return now + 60;
  }

  return timestamp;
}

function resolveExpireDate(expireTimestamp) {
  if (!expireTimestamp || typeof expireTimestamp !== 'number') {
    return null;
  }
  return new Date(expireTimestamp * 1000).toISOString();
}

function getConfiguredEnvVersion() {
  const value =
    process.env.MINI_PROGRAM_QR_ENV_VERSION ||
    process.env.MINIPROGRAM_QR_ENV_VERSION ||
    process.env.WXACODE_ENV_VERSION ||
    '';

  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) {
    return '';
  }

  if (['release', 'trial', 'develop'].includes(normalized)) {
    return normalized;
  }

  return '';
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
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  const y = map.year || '';
  const m = map.month || '';
  const d = map.day || '';
  const hh = map.hour || '';
  const mm = map.minute || '';
  if (!y || !m || !d || !hh || !mm) {
    return formatter
      .format(date)
      .replace(/\//g, '-')
      .replace(/[年月]/g, '-')
      .replace(/[日]/, '')
      .replace(/[\u4e00-\u9fa5]/g, '')
      .trim();
  }
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}

function resolveLevelByExperience(exp, levels) {
  if (!Array.isArray(levels) || !levels.length) {
    return null;
  }
  const numericExp = Number(exp) || 0;
  let target = levels[0];
  levels.forEach((level) => {
    const threshold = Number(level.threshold || 0);
    if (Number.isFinite(threshold) && numericExp >= threshold) {
      target = level;
    }
  });
  return target;
}
