const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  const [memberDoc, transactionsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    db
      .collection(COLLECTIONS.STONE_TRANSACTIONS)
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
  ]);

  const member = memberDoc && memberDoc.data ? memberDoc.data : {};
  const balance = resolveStoneBalance(member);
  const transactions = transactionsSnapshot.data || [];

  const totalEarned = transactions
    .filter((item) => (item.amount || 0) > 0)
    .reduce((sum, item) => sum + Math.max(0, Math.trunc(item.amount || 0)), 0);
  const totalSpent = transactions
    .filter((item) => (item.amount || 0) < 0)
    .reduce((sum, item) => sum + Math.abs(Math.trunc(item.amount || 0)), 0);

  return {
    stoneBalance: balance,
    balance,
    totalEarned,
    totalSpent,
    transactions: transactions.map(mapTransaction)
  };
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
