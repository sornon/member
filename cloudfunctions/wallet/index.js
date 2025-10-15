const cloud = require('wx-server-sdk');
const {
  EXPERIENCE_PER_YUAN,
  COLLECTIONS,
  EXCLUDED_TRANSACTION_STATUSES
} = require('common-config'); //云函数公共模块，维护在目录cloudfunctions/nodejs-layer/node_modules/common-config

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FEATURE_TOGGLE_DOC_ID = 'feature_toggles';
const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};
const DEFAULT_FEATURE_TOGGLES = {
  cashierEnabled: true,
  menuOrderingEnabled: false,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT }
};

function resolveToggleBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (
      ['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)
    ) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return resolveToggleBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function trimToString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  try {
    return String(value).trim();
  } catch (error) {
    return '';
  }
}

function normalizeImmortalTournament(config) {
  const normalized = { ...DEFAULT_IMMORTAL_TOURNAMENT };
  if (config && typeof config === 'object') {
    if (Object.prototype.hasOwnProperty.call(config, 'enabled')) {
      normalized.enabled = resolveToggleBoolean(config.enabled, normalized.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationStart')) {
      normalized.registrationStart = trimToString(config.registrationStart);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationEnd')) {
      normalized.registrationEnd = trimToString(config.registrationEnd);
    }
  }
  return normalized;
}

function normalizeFeatureToggles(documentData) {
  const toggles = {
    cashierEnabled: DEFAULT_FEATURE_TOGGLES.cashierEnabled,
    menuOrderingEnabled: DEFAULT_FEATURE_TOGGLES.menuOrderingEnabled,
    immortalTournament: { ...DEFAULT_FEATURE_TOGGLES.immortalTournament }
  };
  if (documentData && typeof documentData === 'object') {
    if (Object.prototype.hasOwnProperty.call(documentData, 'cashierEnabled')) {
      toggles.cashierEnabled = resolveToggleBoolean(documentData.cashierEnabled, true);
    }
    if (Object.prototype.hasOwnProperty.call(documentData, 'menuOrderingEnabled')) {
      toggles.menuOrderingEnabled = resolveToggleBoolean(documentData.menuOrderingEnabled, false);
    }
    if (Object.prototype.hasOwnProperty.call(documentData, 'immortalTournament')) {
      toggles.immortalTournament = normalizeImmortalTournament(documentData.immortalTournament);
    }
  }
  return toggles;
}

async function loadFeatureToggles() {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.SYSTEM_SETTINGS)
      .doc(FEATURE_TOGGLE_DOC_ID)
      .get();
    if (snapshot && snapshot.data) {
      return normalizeFeatureToggles(snapshot.data);
    }
  } catch (error) {
    if (error && error.errMsg && /not exist|not found/i.test(error.errMsg)) {
      return { ...DEFAULT_FEATURE_TOGGLES };
    }
    console.error('[wallet] loadFeatureToggles failed', error);
  }
  return { ...DEFAULT_FEATURE_TOGGLES };
}

function normalizeWineStorageEntries(list = []) {
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return;
    }
    const rawQuantity = Number(entry.quantity || 0);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `wine_${index}_${Date.now()}`;
    const expiresAtCandidate = entry.expiresAt ? new Date(entry.expiresAt) : null;
    const createdAtCandidate = entry.createdAt ? new Date(entry.createdAt) : null;
    const expiresAt =
      expiresAtCandidate && !Number.isNaN(expiresAtCandidate.getTime()) ? expiresAtCandidate : null;
    const createdAt =
      createdAtCandidate && !Number.isNaN(createdAtCandidate.getTime()) ? createdAtCandidate : null;
    normalized.push({
      id,
      name,
      quantity,
      expiresAt,
      createdAt
    });
  });
  return normalized.sort((a, b) => {
    const aExpiry = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) {
      return aExpiry - bExpiry;
    }
    const aCreated = a.createdAt ? a.createdAt.getTime() : 0;
    const bCreated = b.createdAt ? b.createdAt.getTime() : 0;
    return aCreated - bCreated;
  });
}

function serializeWineStorageEntry(entry) {
  if (!entry) {
    return { id: '', name: '', quantity: 0, expiresAt: '', createdAt: '' };
  }
  return {
    id: entry.id || '',
    name: entry.name || '',
    quantity: Number.isFinite(entry.quantity) ? entry.quantity : 0,
    expiresAt: entry.expiresAt instanceof Date && !Number.isNaN(entry.expiresAt.getTime()) ? entry.expiresAt.toISOString() : '',
    createdAt: entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime()) ? entry.createdAt.toISOString() : ''
  };
}

function calculateWineStorageTotal(entries = []) {
  return entries.reduce((sum, entry) => {
    const qty = Number.isFinite(entry.quantity) ? entry.quantity : 0;
    return sum + Math.max(0, qty);
  }, 0);
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'summary';

  switch (action) {
    case 'summary':
      return getSummary(OPENID);
    case 'createRecharge':
      return createRecharge(OPENID, event.amount);
    case 'completeRecharge':
      return completeRecharge(OPENID, event.transactionId);
    case 'balancePay':
      return payWithBalance(OPENID, event.orderId, event.amount);
    case 'loadChargeOrder':
      return loadChargeOrder(OPENID, event.orderId);
    case 'confirmChargeOrder':
      return confirmChargeOrder(OPENID, event.orderId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function getSummary(openid) {
  const transactionsCollection = db.collection(COLLECTIONS.WALLET_TRANSACTIONS);
  const totalsPromise = resolveEffectiveTotals(transactionsCollection, openid);
  const [memberDoc, transactionsSnapshot, totals, extrasDoc, featureToggles] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    transactionsCollection
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get(),
    totalsPromise,
    db.collection(COLLECTIONS.MEMBER_EXTRAS).doc(openid).get().catch(() => null),
    loadFeatureToggles()
  ]);

  const member = memberDoc && memberDoc.data ? memberDoc.data : { cashBalance: 0 };
  const transactions = transactionsSnapshot.data || [];
  const extras = extrasDoc && extrasDoc.data ? extrasDoc.data : {};
  const resolvedCashBalance = resolveCashBalance(member);
  const storedRecharge = resolveAmountNumber(member.totalRecharge);
  const storedSpend = resolveAmountNumber(member.totalSpend);
  const normalizedTotals = {
    totalRecharge: Math.max(
      0,
      Number.isFinite(storedRecharge) ? Math.max(storedRecharge, totals.totalRecharge) : totals.totalRecharge
    ),
    totalSpend: Math.max(
      0,
      Number.isFinite(storedSpend) ? Math.max(storedSpend, totals.totalSpend) : totals.totalSpend
    )
  };

  await persistMemberTotalsIfNeeded(openid, member, normalizedTotals);

  const wineStorageEntries = normalizeWineStorageEntries(extras.wineStorage);
  const wineStorageTotal = calculateWineStorageTotal(wineStorageEntries);

  return {
    cashBalance: resolvedCashBalance,
    balance: resolvedCashBalance,
    totalRecharge: normalizedTotals.totalRecharge,
    totalSpend: normalizedTotals.totalSpend,
    wineStorage: wineStorageEntries.map((entry) => serializeWineStorageEntry(entry)),
    wineStorageTotal,
    features: featureToggles,
    transactions: transactions.map((txn) => {
      const amount = resolveAmountNumber(txn.amount);
      const status = normalizeTransactionStatus(txn.status);
      const type = resolveTransactionType(txn.type, amount);
      return {
        _id: txn._id,
        type,
        typeLabel: transactionTypeLabel[type] || transactionTypeLabel.unknown,
        amount,
        source: txn.source || '',
        remark: txn.remark || '',
        createdAt: resolveDate(txn.createdAt) || new Date(),
        status
      };
    })
  };
}

async function resolveEffectiveTotals(collection, memberId) {
  const pageSize = 500;
  let offset = 0;
  let totalRecharge = 0;
  let totalSpend = 0;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 40) {
    const snapshot = await collection
      .aggregate()
      .match({ memberId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .project({ amount: 1, type: 1, status: 1 })
      .end()
      .catch(() => ({ list: [] }));

    const batch = Array.isArray(snapshot.list) ? snapshot.list : [];
    if (!batch.length) {
      break;
    }

    batch.forEach((txn) => {
      const amount = resolveAmountNumber(txn.amount);
      if (!Number.isFinite(amount) || amount === 0) {
        return;
      }
      const status = normalizeTransactionStatus(txn.status);
      if (EXCLUDED_TRANSACTION_STATUSES.includes(status)) {
        return;
      }
      const type = resolveTransactionType(txn.type, amount);
      if (type === 'recharge') {
        totalRecharge += Math.abs(amount);
      } else if (type === 'spend') {
        totalSpend += Math.abs(amount);
      }
    });

    if (batch.length < pageSize) {
      hasMore = false;
    } else {
      offset += pageSize;
    }

    guard += 1;
  }

  return {
    totalRecharge: Math.round(Math.max(totalRecharge, 0)),
    totalSpend: Math.round(Math.max(totalSpend, 0))
  };
}

async function persistMemberTotalsIfNeeded(memberId, member, totals) {
  if (!member || !member._id) {
    return;
  }
  const hasRechargeField = Object.prototype.hasOwnProperty.call(member, 'totalRecharge');
  const hasSpendField = Object.prototype.hasOwnProperty.call(member, 'totalSpend');
  const currentRecharge = resolveAmountNumber(member.totalRecharge);
  const currentSpend = resolveAmountNumber(member.totalSpend);
  const updates = {};

  if (!hasRechargeField || !Number.isFinite(currentRecharge) || Math.round(currentRecharge) !== totals.totalRecharge) {
    updates.totalRecharge = totals.totalRecharge;
  }
  if (!hasSpendField || !Number.isFinite(currentSpend) || Math.round(currentSpend) !== totals.totalSpend) {
    updates.totalSpend = totals.totalSpend;
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: updates
      })
      .catch(() => null);
  }
}

function resolveTransactionType(type, amount) {
  if (type) {
    return type;
  }
  if (Number.isFinite(amount)) {
    if (amount > 0) {
      return 'recharge';
    }
    if (amount < 0) {
      return 'spend';
    }
  }
  return 'unknown';
}

async function createRecharge(openid, amount) {
  const featureToggles = await loadFeatureToggles();
  if (!featureToggles.cashierEnabled) {
    throw new Error('线上充值暂不可用，请前往收款台线下充值');
  }
  if (!amount || amount <= 0) {
    throw new Error('充值金额无效');
  }
  const now = new Date();
  const record = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
    data: {
      memberId: openid,
      amount,
      type: 'recharge',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      remark: '余额充值'
    }
  });

  // 真实环境应调用 cloud.cloudPay.unifiedOrder 生成支付参数
  const mockPaymentParams = {
    timeStamp: `${Math.floor(Date.now() / 1000)}`,
    nonceStr: Math.random().toString(36).slice(2, 10),
    package: `prepay_id=mock_${record._id}`,
    signType: 'RSA',
    paySign: 'MOCK_SIGN'
  };

  return {
    transactionId: record._id,
    payment: mockPaymentParams,
    message: '测试环境返回模拟支付参数，生产环境请替换为真实签名'
  };
}

async function completeRecharge(openid, transactionId) {
  if (!transactionId) {
    throw new Error('充值记录不存在');
  }

  let result = { success: true, message: '充值成功' };
  await db.runTransaction(async (transaction) => {
    const transactionRef = transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(transactionId);
    const transactionDoc = await transactionRef.get().catch(() => null);
    if (!transactionDoc || !transactionDoc.data) {
      throw new Error('充值记录不存在');
    }
    const record = transactionDoc.data;
    if (record.memberId !== openid) {
      throw new Error('无权操作该充值记录');
    }
    if (record.type !== 'recharge') {
      throw new Error('记录类型错误');
    }
    if (record.status === 'success') {
      result = { success: true, message: '充值已完成' };
      return;
    }

    const amount = record.amount || 0;
    const experienceGain = calculateExperienceGain(amount);

    await transactionRef.update({
      data: {
        status: 'success',
        updatedAt: new Date()
      }
    });

    const memberUpdate = {
      cashBalance: _.inc(amount),
      totalRecharge: _.inc(amount),
      updatedAt: new Date()
    };
    if (experienceGain > 0) {
      memberUpdate.experience = _.inc(experienceGain);
    }

    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: memberUpdate
    });

    result = {
      success: true,
      message: '充值成功',
      amount,
      experienceGain
    };
  });

  if (result.success) {
    await syncMemberLevel(openid);
  }

  return result;
}

async function payWithBalance(openid, orderId, amount) {
  const normalizedAmount = Number(amount);
  if (!normalizedAmount || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('扣款金额无效');
  }
  let experienceGain = 0;
  await db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).get();
    const member = memberDoc.data;
    const currentBalance = resolveCashBalance(member);
    if (!member || currentBalance < normalizedAmount) {
      throw new Error('余额不足');
    }
    experienceGain = calculateExperienceGain(normalizedAmount);
    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: {
        cashBalance: _.inc(-normalizedAmount),
        totalSpend: _.inc(normalizedAmount),
        updatedAt: new Date(),
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -normalizedAmount,
        type: 'spend',
        status: 'success',
        orderId: orderId || null,
        createdAt: new Date(),
        remark: '余额支付订单'
      }
    });
    if (orderId) {
      await transaction.collection(COLLECTIONS.RESERVATIONS).doc(orderId).update({
        data: {
          status: 'confirmed',
          paidAt: new Date()
        }
      });
    }
  });

  if (experienceGain > 0) {
    await syncMemberLevel(openid);
  }

  return { success: true, message: '支付成功', experienceGain };
}

async function loadChargeOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('扣费单不存在');
  }
  const doc = await db
    .collection(COLLECTIONS.CHARGE_ORDERS)
    .doc(orderId)
    .get()
    .catch(() => null);
  if (!doc || !doc.data) {
    throw new Error('扣费单不存在');
  }
  const order = mapChargeOrder(doc.data, orderId);
  if (order.status === 'expired' && doc.data.status !== 'expired') {
    await db
      .collection(COLLECTIONS.CHARGE_ORDERS)
      .doc(orderId)
      .update({
        data: {
          status: 'expired',
          updatedAt: new Date()
        }
      })
      .catch(() => null);
  }
  return { order };
}

async function confirmChargeOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('扣费单不存在');
  }
  let result = { success: false };
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(orderId);
    const orderDoc = await orderRef.get().catch(() => null);
    if (!orderDoc || !orderDoc.data) {
      throw new Error('扣费单不存在');
    }
    const now = new Date();
    const order = orderDoc.data;
    const normalizedOrder = mapChargeOrder(order, orderId, now);
    if (normalizedOrder.status === 'expired') {
      await orderRef.update({
        data: {
          status: 'expired',
          updatedAt: now
        }
      });
      throw new Error('扣费单已过期');
    }
    if (order.status === 'paid') {
      throw new Error('扣费单已完成');
    }
    if (order.status === 'cancelled') {
      throw new Error('扣费单已取消');
    }
    const amount = Number(order.totalAmount || 0);
    if (!amount || amount <= 0) {
      throw new Error('扣费金额无效');
    }
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    const balance = resolveCashBalance(memberDoc.data);
    if (balance < amount) {
      throw new Error('余额不足，请先充值');
    }
    const stoneReward = Number(order.stoneReward || amount);
    await memberRef.update({
      data: {
        cashBalance: _.inc(-amount),
        totalSpend: _.inc(amount),
        stoneBalance: _.inc(stoneReward),
        updatedAt: now
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -amount,
        type: 'spend',
        status: 'success',
        source: 'chargeOrder',
        orderId,
        createdAt: now,
        remark: '扫码扣费'
      }
    });
    await transaction.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: stoneReward,
        type: 'earn',
        source: 'chargeOrder',
        description: '扫码消费赠送灵石',
        createdAt: now,
        meta: {
          orderId
        }
      }
    });
    await orderRef.update({
      data: {
        status: 'paid',
        memberId: openid,
        confirmedAt: now,
        stoneReward,
        updatedAt: now
      }
    });
    result = {
      success: true,
      message: '扣费成功',
      amount,
      stoneReward
    };
  });
  return result;
}

const transactionTypeLabel = {
  recharge: '充值',
  spend: '消费',
  reward: '奖励',
  refund: '退款',
  adjust: '调整',
  unknown: '交易'
};

function mapChargeOrder(raw, orderId, now = new Date()) {
  if (!raw) return null;
  const expireAt = resolveDate(raw.expireAt);
  let status = raw.status || 'pending';
  if (status === 'pending' && expireAt && expireAt.getTime() <= now.getTime()) {
    status = 'expired';
  }
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => ({
        name: item.name || '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        amount: Number(item.amount || 0)
      }))
    : [];
  return {
    _id: raw._id || orderId,
    status,
    items,
    totalAmount: Number(raw.totalAmount || 0),
    stoneReward: Number(raw.stoneReward || raw.totalAmount || 0),
    createdAt: resolveDate(raw.createdAt),
    updatedAt: resolveDate(raw.updatedAt),
    expireAt,
    memberId: raw.memberId || '',
    confirmedAt: resolveDate(raw.confirmedAt)
  };
}

function resolveDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch (err) {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function normalizeTransactionStatus(status) {
  if (!status) {
    return 'success';
  }
  if (status === 'completed') {
    return 'success';
  }
  return status;
}

async function syncMemberLevel(openid) {
  const [memberDoc, levelsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    db.collection(COLLECTIONS.MEMBERSHIP_LEVELS).orderBy('order', 'asc').get()
  ]);
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
    });
  await grantLevelRewards(openid, targetLevel);
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

async function grantLevelRewards(openid, level) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;
  const masterSnapshot = await db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get();
  const masterMap = {};
  masterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({ memberId: openid, rightId: reward.rightId, levelId: level._id })
      .count();
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
