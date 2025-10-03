const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command.aggregate;
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  STONE_TRANSACTIONS: 'stoneTransactions'
};

const MALL_ITEMS = [
  {
    id: 'rename_card_single',
    name: '改名卡',
    icon: '🪪',
    price: 120,
    description: '兑换额外的改名次数，随时焕新道号。',
    effectLabel: '兑换后 +1 张改名卡',
    effects: { renameCards: 1 },
    category: 'rename',
    categoryLabel: '改名道具',
    categoryOrder: 1,
    order: 1
  },
  {
    id: 'rename_card_bundle_5',
    name: '改名福袋（5 张）',
    icon: '🎁',
    price: 550,
    description: '限时福袋，内含 5 张改名卡，比单买更划算。',
    effectLabel: '兑换后 +5 张改名卡',
    effects: { renameCards: 5 },
    category: 'rename',
    categoryLabel: '改名道具',
    categoryOrder: 1,
    order: 2
  },
  {
    id: 'rename_card_bundle_10',
    name: '改名福袋（10 张）',
    icon: '💎',
    price: 1080,
    description: '尊享礼包，适合频繁焕新道号的高阶仙友。',
    effectLabel: '兑换后 +10 张改名卡',
    effects: { renameCards: 10 },
    category: 'rename',
    categoryLabel: '改名道具',
    categoryOrder: 1,
    order: 3
  }
];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'summary';

  switch (action) {
    case 'summary':
      return getSummary(OPENID);
    case 'catalog':
      return getCatalog();
    case 'purchase':
      return purchaseItem(OPENID, event.itemId, event.quantity || 1);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

function createError(code, message) {
  const error = new Error(message || '发生未知错误');
  error.code = code;
  error.errCode = code;
  return error;
}

async function getSummary(openid) {
  const [memberDoc, transactionsSnapshot, totalsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    db
      .collection(COLLECTIONS.STONE_TRANSACTIONS)
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get(),
    aggregateStoneTotals(openid)
  ]);

  const member = memberDoc && memberDoc.data ? memberDoc.data : {};
  const balance = resolveStoneBalance(member);
  const transactions = transactionsSnapshot.data || [];
  const { totalEarned, totalSpent } = resolveTotals({
    snapshot: totalsSnapshot,
    transactions
  });

  return {
    stoneBalance: balance,
    balance,
    totalEarned,
    totalSpent,
    transactions: transactions.map(mapTransaction)
  };
}

async function aggregateStoneTotals(memberId) {
  if (!memberId) {
    return null;
  }
  try {
    return await db
      .collection(COLLECTIONS.STONE_TRANSACTIONS)
      .aggregate()
      .match({ memberId })
      .group({
        _id: null,
        totalEarned: $.sum(
          $.cond({
            if: $.gt(['$amount', 0]),
            then: $.floor('$amount'),
            else: 0
          })
        ),
        totalSpent: $.sum(
          $.cond({
            if: $.lt(['$amount', 0]),
            then: $.abs($.floor('$amount')),
            else: 0
          })
        )
      })
      .end();
  } catch (error) {
    console.error('[stones] aggregate totals failed', error);
    return null;
  }
}

function resolveTotals({ snapshot, transactions }) {
  const fallbackTotals = calculateTotalsFromTransactions(transactions);
  if (!snapshot || !snapshot.list || !snapshot.list.length) {
    return fallbackTotals;
  }
  const doc = snapshot.list[0] || {};
  const totalEarned = normalizeAmount(doc.totalEarned);
  const totalSpent = Math.abs(normalizeAmount(doc.totalSpent));
  if (!Number.isFinite(totalEarned) || !Number.isFinite(totalSpent)) {
    return fallbackTotals;
  }
  return {
    totalEarned: Math.max(0, totalEarned),
    totalSpent: Math.max(0, totalSpent)
  };
}

function calculateTotalsFromTransactions(transactions) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return { totalEarned: 0, totalSpent: 0 };
  }
  return transactions.reduce(
    (acc, item) => {
      const amount = normalizeAmount(item.amount);
      if (amount > 0) {
        acc.totalEarned += amount;
      } else if (amount < 0) {
        acc.totalSpent += Math.abs(amount);
      }
      return acc;
    },
    { totalEarned: 0, totalSpent: 0 }
  );
}

function mapTransaction(txn) {
  const amount = normalizeAmount(txn.amount);
  const type = txn.type || (amount >= 0 ? 'earn' : 'spend');
  return {
    _id: txn._id,
    amount,
    change: amount,
    type,
    typeLabel: transactionTypeLabel[type] || (amount >= 0 ? '获得' : '消耗'),
    description: txn.description || '',
    source: txn.source || '',
    createdAt: txn.createdAt || new Date(),
    meta: txn.meta || null
  };
}

function resolveStoneBalance(member) {
  if (!member) return 0;
  const value = Number(member.stoneBalance);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

function normalizeAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  return Math.trunc(numeric);
}

const transactionTypeLabel = {
  earn: '获得',
  spend: '消耗',
  adjust: '调整',
  task: '任务奖励',
  reward: '奖励'
};

function getCatalog() {
  return {
    items: MALL_ITEMS.map((item) => ({
      id: item.id,
      name: item.name,
      icon: item.icon || '',
      iconUrl: item.iconUrl || '',
      price: Math.max(0, Math.floor(Number(item.price) || 0)),
      description: item.description || '',
      effectLabel: item.effectLabel || '',
      category: item.category || 'general',
      categoryLabel:
        item.categoryLabel ||
        (item.category === 'general' ? '奇珍异宝' : '其他道具'),
      categoryOrder: Number.isFinite(Number(item.categoryOrder))
        ? Number(item.categoryOrder)
        : null,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : null
    }))
  };
}

async function purchaseItem(openid, itemId, quantity = 1) {
  if (!openid) {
    throw createError('AUTH_REQUIRED', '请先登录后再兑换');
  }
  const normalizedId = typeof itemId === 'string' ? itemId.trim() : '';
  if (!normalizedId) {
    throw createError('INVALID_ITEM', '请选择要兑换的道具');
  }
  const item = MALL_ITEMS.find((entry) => entry.id === normalizedId);
  if (!item) {
    throw createError('ITEM_NOT_FOUND', '道具不存在或已下架');
  }

  const quantityNumber = Number(quantity);
  if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
    throw createError('INVALID_QUANTITY', '兑换数量无效');
  }
  const normalizedQuantity = Math.max(1, Math.floor(quantityNumber));
  const totalCost = Math.max(0, Math.floor(Number(item.price) || 0)) * normalizedQuantity;
  if (totalCost <= 0) {
    throw createError('INVALID_PRICE', '该道具暂无法兑换');
  }

  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(openid).get().catch(() => null);
  if (!existing || !existing.data) {
    throw createError('MEMBER_NOT_FOUND', '请先完成会员注册');
  }
  const member = existing.data;
  const balance = resolveStoneBalance(member);
  if (balance < totalCost) {
    throw createError('STONE_INSUFFICIENT', '灵石不足');
  }

  const updates = {
    stoneBalance: _.inc(-totalCost),
    updatedAt: new Date()
  };

  if (item.effects && item.effects.renameCards) {
    const renameAmount = Math.max(0, Math.floor(Number(item.effects.renameCards) || 0));
    if (renameAmount > 0) {
      updates.renameCards = _.inc(renameAmount * normalizedQuantity);
    }
  }

  await membersCollection.doc(openid).update({
    data: updates
  });

  const serverDate = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const description = normalizedQuantity > 1 ? `${item.name} x${normalizedQuantity}` : item.name;
  await db.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
    data: {
      memberId: openid,
      amount: -totalCost,
      type: 'spend',
      source: 'mall',
      description: `购买${description}`,
      meta: { itemId: item.id, quantity: normalizedQuantity },
      createdAt: serverDate
    }
  });

  const summary = await getSummary(openid);
  return {
    success: true,
    item: {
      id: item.id,
      name: item.name
    },
    quantity: normalizedQuantity,
    summary
  };
}
