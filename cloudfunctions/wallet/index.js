const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  TRANSACTIONS: 'walletTransactions',
  RESERVATIONS: 'reservations'
};

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'summary';

  switch (action) {
    case 'summary':
      return getSummary(OPENID);
    case 'createRecharge':
      return createRecharge(OPENID, event.amount);
    case 'balancePay':
      return payWithBalance(OPENID, event.orderId, event.amount);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function getSummary(openid) {
  const [memberDoc, transactionsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    db
      .collection(COLLECTIONS.TRANSACTIONS)
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()
  ]);
  const member = memberDoc && memberDoc.data ? memberDoc.data : { balance: 0 };
  const transactions = transactionsSnapshot.data || [];
  const totalRecharge = transactions
    .filter((item) => item.type === 'recharge' && item.status === 'success')
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalSpend = transactions
    .filter((item) => item.type === 'spend')
    .reduce((sum, item) => sum + Math.abs(item.amount || 0), 0);
  return {
    balance: member.balance || 0,
    totalRecharge,
    totalSpend,
    transactions: transactions.map((txn) => ({
      _id: txn._id,
      type: txn.type,
      typeLabel: transactionTypeLabel[txn.type] || '交易',
      amount: txn.amount || 0,
      createdAt: txn.createdAt || new Date(),
      status: txn.status || 'success'
    }))
  };
}

async function createRecharge(openid, amount) {
  if (!amount || amount <= 0) {
    throw new Error('充值金额无效');
  }
  const now = new Date();
  const record = await db.collection(COLLECTIONS.TRANSACTIONS).add({
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

async function payWithBalance(openid, orderId, amount) {
  if (!amount || amount <= 0) {
    throw new Error('扣款金额无效');
  }
  await db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).get();
    const member = memberDoc.data;
    if (!member || typeof member.balance !== 'number' || member.balance < amount) {
      throw new Error('余额不足');
    }
    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: {
        balance: _.inc(-amount),
        updatedAt: new Date()
      }
    });
    await transaction.collection(COLLECTIONS.TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -amount,
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

  return { success: true, message: '支付成功' };
}

const transactionTypeLabel = {
  recharge: '充值',
  spend: '消费',
  reward: '奖励'
};
