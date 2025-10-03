const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MENU_ORDERS: 'menuOrders',
  MEMBERS: 'members',
  WALLET_TRANSACTIONS: 'walletTransactions',
  MEMBERSHIP_LEVELS: 'membershipLevels',
  MEMBERSHIP_RIGHTS: 'membershipRights',
  MEMBER_RIGHTS: 'memberRights'
};

const ADMIN_ROLES = ['admin', 'developer', 'superadmin'];
const EXPERIENCE_PER_YUAN = 100;
const ensuredCollections = new Set();

const ERROR_CODES = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS'
};

function isCollectionNotFoundError(error) {
  if (!error) return false;
  if (error.errCode === -502005 || error.code === 'ResourceNotFound') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /collection\s+not\s+exists/i.test(message) || /ResourceNotFound/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error) return false;
  if (error.errCode === -502006 || error.code === 'ResourceExists') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /already\s+exists/i.test(message);
}

function createCustomError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.errCode = code;
  return error;
}

function isCustomError(error, code) {
  if (!error || !code) {
    return false;
  }
  return error.code === code || error.errCode === code;
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'listMemberOrders';

  switch (action) {
    case 'createOrder':
      return createOrder(OPENID, event.items || [], event.remark || '');
    case 'listMemberOrders':
      return listMemberOrders(OPENID);
    case 'confirmMemberOrder':
      return confirmMemberOrder(OPENID, event.orderId);
    case 'listPrepOrders':
      return listPrepOrders(OPENID, event.status || 'submitted', event.pageSize || 100);
    case 'markOrderReady':
      return markOrderReady(OPENID, event.orderId, event.remark || '');
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function createOrder(openid, itemsInput, remarkInput) {
  const member = await ensureMember(openid);
  const items = normalizeItems(itemsInput);
  if (!items.length) {
    throw new Error('请至少选择一件商品');
  }
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (!totalAmount || totalAmount <= 0) {
    throw new Error('订单金额无效');
  }
  const now = new Date();
  const orderData = {
    memberId: openid,
    memberSnapshot: {
      nickName: member.nickName || '',
      mobile: member.mobile || '',
      levelId: member.levelId || ''
    },
    items,
    totalAmount,
    remark: normalizeRemark(remarkInput),
    status: 'submitted',
    createdAt: now,
    updatedAt: now
  };
  await ensureCollection(COLLECTIONS.MENU_ORDERS);
  const result = await db.collection(COLLECTIONS.MENU_ORDERS).add({ data: orderData });
  return { order: mapOrder({ _id: result._id, ...orderData }) };
}

async function listMemberOrders(openid) {
  await ensureMember(openid);
  try {
    await ensureCollection(COLLECTIONS.MENU_ORDERS);
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  let snapshot;
  try {
    snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  const orders = (snapshot?.data || []).map((doc) => mapOrder({ _id: doc._id, ...doc }));
  return { orders };
}

async function markOrderReady(openid, orderId, remarkInput) {
  const admin = await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const remark = normalizeRemark(remarkInput, 200);
  const now = new Date();
  let updatedOrder = null;
  await ensureCollection(COLLECTIONS.MENU_ORDERS);
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(orderId);
    const snapshot = await orderRef.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('订单不存在');
    }
    const order = snapshot.data;
    if (order.status !== 'submitted') {
      throw new Error('订单已处理');
    }
    const updates = {
      status: 'pendingMember',
      adminId: admin._id,
      adminSnapshot: {
        nickName: admin.nickName || '',
        roles: Array.isArray(admin.roles) ? admin.roles : []
      },
      adminRemark: remark,
      adminConfirmedAt: now,
      updatedAt: now
    };
    await orderRef.update({ data: updates });
    updatedOrder = mapOrder({ _id: orderId, ...order, ...updates });
  });
  return { order: updatedOrder };
}

async function listPrepOrders(openid, status = 'submitted', pageSize = 100) {
  await ensureAdmin(openid);
  const normalizedSize = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  let statuses;
  if (status === 'all') {
    statuses = ['submitted', 'pendingMember'];
  } else if (status === 'pendingMember') {
    statuses = ['pendingMember'];
  } else {
    statuses = ['submitted'];
  }
  try {
    await ensureCollection(COLLECTIONS.MENU_ORDERS);
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  let snapshot;
  try {
    snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .where({ status: _.in(statuses) })
      .orderBy('createdAt', 'desc')
      .limit(normalizedSize)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  const orders = (snapshot?.data || []).map((doc) => mapOrder({ _id: doc._id, ...doc }));
  return { orders };
}

async function confirmMemberOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  let experienceGain = 0;
  let orderSnapshot = null;
  await ensureCollection(COLLECTIONS.MENU_ORDERS);
  await ensureCollection(COLLECTIONS.WALLET_TRANSACTIONS);
  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(orderId);
      const snapshot = await orderRef.get().catch(() => null);
      if (!snapshot || !snapshot.data) {
        throw new Error('订单不存在');
      }
      const order = snapshot.data;
      if (order.memberId !== openid) {
        throw new Error('无法操作该订单');
      }
      if (order.status !== 'pendingMember') {
        throw new Error('订单当前不可确认');
      }
      const amount = Number(order.totalAmount || 0);
      if (!amount || amount <= 0) {
        throw new Error('订单金额无效');
      }
      const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
      const memberDoc = await memberRef.get().catch(() => null);
      if (!memberDoc || !memberDoc.data) {
        throw new Error('会员不存在');
      }
      const balance = resolveCashBalance(memberDoc.data);
      if (balance < amount) {
        throw createCustomError(ERROR_CODES.INSUFFICIENT_FUNDS, '余额不足，请先充值');
      }
      const now = new Date();
      experienceGain = calculateExperienceGain(amount);
      await memberRef.update({
        data: {
          cashBalance: _.inc(-amount),
          totalSpend: _.inc(amount),
          updatedAt: now,
          ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
        }
      });
      await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
        data: {
          memberId: openid,
          amount: -amount,
          type: 'spend',
          status: 'success',
          source: 'menuOrder',
          orderId,
          remark: '菜单消费',
          createdAt: now,
          updatedAt: now
        }
      });
      await orderRef.update({
        data: {
          status: 'paid',
          memberConfirmedAt: now,
          updatedAt: now
        }
      });
      orderSnapshot = mapOrder({ _id: orderId, ...order, status: 'paid', memberConfirmedAt: now, updatedAt: now });
    });
  } catch (error) {
    if (isCustomError(error, ERROR_CODES.INSUFFICIENT_FUNDS)) {
      return {
        errorCode: ERROR_CODES.INSUFFICIENT_FUNDS,
        message: '余额不足，请先充值'
      };
    }
    throw error;
  }
  if (experienceGain > 0) {
    await syncMemberLevel(openid);
  }
  return { order: orderSnapshot, experienceGain };
}

async function ensureMember(openid) {
  if (!openid) {
    throw new Error('未获取到用户身份');
  }
  const snapshot = await db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw new Error('会员不存在');
  }
  return snapshot.data;
}

async function ensureAdmin(openid) {
  const member = await ensureMember(openid);
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    throw new Error('无权访问该功能');
  }
  return member;
}

function normalizeRemark(value, limit = 140) {
  if (!value) {
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  return text.slice(0, limit);
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const menuId = typeof item.menuId === 'string' ? item.menuId.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const spec = typeof item.spec === 'string' ? item.spec.trim() : '';
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    const price = Math.round(Number(item.price || 0));
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
    if (!menuId || !title || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    const amount = price * quantity;
    result.push({
      menuId,
      title,
      spec,
      unit,
      price,
      quantity,
      amount
    });
    if (result.length >= 50) {
      break;
    }
  }
  return result;
}

function mapOrder(doc) {
  if (!doc) {
    return null;
  }
  const items = Array.isArray(doc.items)
    ? doc.items.map((item) => ({
        menuId: item.menuId || '',
        title: item.title || '',
        spec: item.spec || '',
        unit: item.unit || '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        amount: Number(item.amount || 0)
      }))
    : [];
  return {
    _id: doc._id || doc.id || '',
    status: doc.status || 'submitted',
    items,
    totalAmount: Number(doc.totalAmount || 0),
    remark: doc.remark || '',
    adminRemark: doc.adminRemark || '',
    memberId: doc.memberId || '',
    memberSnapshot: doc.memberSnapshot || {},
    adminSnapshot: doc.adminSnapshot || {},
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    adminConfirmedAt: doc.adminConfirmedAt || null,
    memberConfirmedAt: doc.memberConfirmedAt || null
  };
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}

function resolveCashBalance(member) {
  if (!member) return 0;
  if (Object.prototype.hasOwnProperty.call(member, 'cashBalance')) {
    const resolved = resolveAmountNumber(member.cashBalance);
    if (Number.isFinite(resolved)) {
      return resolved;
    }
  }
  if (Object.prototype.hasOwnProperty.call(member, 'balance')) {
    const legacy = resolveAmountNumber(member.balance);
    if (Number.isFinite(legacy)) {
      return legacy;
    }
  }
  return 0;
}

function resolveAmountNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        const numeric = value.toNumber();
        return Number.isFinite(numeric) ? numeric : 0;
      } catch (err) {
        // fall through
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
  return Number.isFinite(numeric) ? numeric : 0;
}

async function syncMemberLevel(openid) {
  const memberPromise = db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  const levelsPromise = db
    .collection(COLLECTIONS.MEMBERSHIP_LEVELS)
    .orderBy('order', 'asc')
    .get()
    .catch((error) => {
      if (isCollectionNotFoundError(error)) {
        return { data: [] };
      }
      throw error;
    });
  const [memberDoc, levelsSnapshot] = await Promise.all([memberPromise, levelsPromise]);
  if (!memberDoc || !memberDoc.data) return;
  const member = memberDoc.data;
  const levels = levelsSnapshot.data || [];
  if (!levels.length) return;
  const targetLevel = resolveLevelByExperience(member.experience || 0, levels);
  if (!targetLevel || targetLevel._id === member.levelId) {
    return;
  }
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .update({
      data: {
        levelId: targetLevel._id,
        updatedAt: new Date()
      }
    })
    .catch(() => null);
  await grantLevelRewards(openid, targetLevel);
}

function resolveLevelByExperience(exp, levels) {
  let target = levels[0];
  levels.forEach((level) => {
    if (exp >= level.threshold) {
      target = level;
    }
  });
  return target;
}

async function grantLevelRewards(openid, level) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;
  const masterSnapshot = await db
    .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
    .get()
    .catch((error) => {
      if (isCollectionNotFoundError(error)) {
        return { data: [] };
      }
      throw error;
    });
  const masterMap = {};
  (masterSnapshot.data || []).forEach((item) => {
    masterMap[item._id] = item;
  });
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({ memberId: openid, rightId: reward.rightId, levelId: level._id })
      .count()
      .catch((error) => {
        if (isCollectionNotFoundError(error)) {
          return { total: 0 };
        }
        throw error;
      });
    const quantity = reward.quantity || 1;
    if (existing.total >= quantity) continue;
    const validUntil = right.validDays
      ? new Date(now.getTime() + right.validDays * 24 * 60 * 60 * 1000)
      : null;
    for (let i = existing.total; i < quantity; i += 1) {
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
