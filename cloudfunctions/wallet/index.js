const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  TRANSACTIONS: 'walletTransactions',
  RESERVATIONS: 'reservations',
  MEMBER_RIGHTS: 'memberRights',
  MEMBERSHIP_LEVELS: 'membershipLevels',
  MEMBERSHIP_RIGHTS: 'membershipRights'
};

const EXPERIENCE_PER_YUAN = 100;

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

async function completeRecharge(openid, transactionId) {
  if (!transactionId) {
    throw new Error('充值记录不存在');
  }

  let result = { success: true, message: '充值成功' };
  await db.runTransaction(async (transaction) => {
    const transactionRef = transaction.collection(COLLECTIONS.TRANSACTIONS).doc(transactionId);
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
      balance: _.inc(amount),
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
  recharge: '充',
  spend: '消费',
  reward: '奖励'
};

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
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
