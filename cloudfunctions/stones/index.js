const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command.aggregate;

const COLLECTIONS = {
  MEMBERS: 'members',
  STONE_TRANSACTIONS: 'stoneTransactions'
};

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'summary';

  switch (action) {
    case 'summary':
      return getSummary(OPENID);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

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
