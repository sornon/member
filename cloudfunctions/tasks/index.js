const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS } = require('common-config'); // 公共配置模块

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';

  switch (action) {
    case 'list':
      return listTasks(OPENID);
    case 'claim':
      return claimTask(OPENID, event.taskId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listTasks(openid) {
  const [tasksSnapshot, recordsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.TASKS)
      .where({ status: 'online' })
      .orderBy('priority', 'asc')
      .get(),
    db.collection(COLLECTIONS.TASK_RECORDS)
      .where({ memberId: openid })
      .get()
  ]);

  const recordMap = {};
  recordsSnapshot.data.forEach((item) => {
    recordMap[item.taskId] = item;
  });

  const now = Date.now();
  return tasksSnapshot.data.map((task) => {
    const record = recordMap[task._id] || {};
    const current = record.progress || 0;
    const target = task.target || 1;
    const completed = Boolean(record.status === 'completed' || current >= target);
    const claimedTimes = record.claimCount || 0;
    const inDateRange = validateTaskDate(task, now);
    const claimLimit = task.claimLimit || 1;
    const canClaim = inDateRange && completed && claimedTimes < claimLimit;
    const reward = task.reward || {};
    const rewardSummary = task.rewardSummary || buildRewardSummary(reward);
    const cultivationLocked = reward.type === 'experience';
    const finalCanClaim = canClaim && !cultivationLocked;
    const actionLabel = cultivationLocked
      ? '前往充值'
      : canClaim
      ? '立即领取'
      : completed
      ? '已领取'
      : '去完成';
    return {
      _id: task._id,
      title: task.title,
      description: task.description,
      type: task.type,
      typeLabel: typeLabelMap[task.type] || '任务',
      rewardSummary,
      progressText: `${Math.min(current, target)}/${target}`,
      canClaim: finalCanClaim,
      actionLabel
    };
  });
}

async function claimTask(openid, taskId) {
  if (!taskId) {
    throw new Error('任务不存在');
  }
  const taskDoc = await db.collection(COLLECTIONS.TASKS).doc(taskId).get().catch(() => null);
  if (!taskDoc || !taskDoc.data) {
    throw new Error('任务不存在');
  }
  const task = taskDoc.data;
  const recordCollection = db.collection(COLLECTIONS.TASK_RECORDS);
  const recordDoc = await recordCollection
    .where({ memberId: openid, taskId })
    .get();
  const record = recordDoc.data[0];
  const now = Date.now();
  if (!validateTaskDate(task, now)) {
    throw new Error('任务不在有效期');
  }
  if (task.reward && task.reward.type === 'experience') {
    throw new Error('修为需通过充值获取，请前往充值中心');
  }
  const progress = record ? record.progress || 0 : 0;
  const target = task.target || 1;
  if (progress < target && (!record || record.status !== 'completed')) {
    throw new Error('任务尚未达成');
  }
  const claimLimit = task.claimLimit || 1;
  const claimCount = record ? record.claimCount || 0 : 0;
  if (claimCount >= claimLimit) {
    throw new Error('任务奖励已领取');
  }

  await issueReward(openid, task.reward || {});

  if (record) {
    await recordCollection.doc(record._id).update({
      data: {
        claimCount: _.inc(1),
        status: 'claimed',
        lastClaimAt: new Date()
      }
    });
  } else {
    await recordCollection.add({
      data: {
        memberId: openid,
        taskId,
        progress: target,
        status: 'claimed',
        claimCount: 1,
        lastClaimAt: new Date(),
        createdAt: new Date()
      }
    });
  }

  return { success: true, message: '奖励已发放' };
}

const typeLabelMap = {
  signin: '签到任务',
  invite: '邀请任务',
  spend: '消费任务',
  share: '互动任务',
  daily: '每日任务'
};

function buildRewardSummary(reward) {
  if (!reward) return '奖励';
  if (reward.type === 'coupon') {
    return reward.description || '优惠券奖励';
  }
  if (reward.type === 'experience') {
    return '修为奖励（需充值获得）';
  }
  if (reward.type === 'balance') {
    return `现金余额 +¥${((reward.amount || 0) / 100).toFixed(2)}`;
  }
  if (reward.type === 'stones') {
    return `灵石 +${Math.max(0, Math.floor(reward.amount || 0))}`;
  }
  return '奖励';
}

function validateTaskDate(task, timestamp) {
  const start = task.validFrom ? new Date(task.validFrom).getTime() : null;
  const end = task.validTo ? new Date(task.validTo).getTime() : null;
  if (start && timestamp < start) return false;
  if (end && timestamp > end) return false;
  return true;
}

async function issueReward(openid, reward) {
  if (!reward || !reward.type) return;
  if (reward.type === 'coupon') {
    await issueCouponReward(openid, reward);
  } else if (reward.type === 'experience') {
    throw new Error('修为需通过充值获取，请调整任务奖励配置');
  } else if (reward.type === 'balance') {
    await applyCashBalance(openid, reward.amount || 0, reward);
  } else if (reward.type === 'stones') {
    await applyStones(openid, reward.amount || 0, reward);
  }
}

async function issueCouponReward(openid, reward) {
  if (!reward.couponId) return;
  const couponDoc = await db.collection(COLLECTIONS.COUPONS).doc(reward.couponId).get().catch(() => null);
  if (!couponDoc || !couponDoc.data) {
    throw new Error('优惠券不存在');
  }
  const coupon = couponDoc.data;
  const now = new Date();
  const validUntil = coupon.validDays
    ? new Date(now.getTime() + coupon.validDays * 24 * 60 * 60 * 1000)
    : coupon.validUntil || null;
  await db.collection(COLLECTIONS.COUPON_RECORDS).add({
    data: {
      memberId: openid,
      couponId: reward.couponId,
      status: 'active',
      title: coupon.title,
      description: coupon.description,
      discountType: coupon.type,
      amount: coupon.amount,
      threshold: coupon.threshold,
      validUntil,
      issuedAt: now,
      source: 'task',
      taskId: reward.taskId || null
    }
  });
}

async function applyCashBalance(openid, amount, reward = {}) {
  if (!amount) return;
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .update({
      data: {
        cashBalance: _.inc(normalized),
        updatedAt: new Date()
      }
    });
  await db.collection('walletTransactions').add({
    data: {
      memberId: openid,
      amount: normalized,
      type: 'reward',
      source: 'task',
      remark: reward.description || '任务奖励余额',
      createdAt: new Date()
    }
  });
}

async function applyStones(openid, amount, reward = {}) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  const integerAmount = Math.max(0, Math.floor(normalized));
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  await membersCollection.doc(openid).update({
    data: {
      stoneBalance: _.inc(integerAmount),
      updatedAt: new Date()
    }
  });
  await db.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
    data: {
      memberId: openid,
      amount: integerAmount,
      type: 'earn',
      source: 'task',
      description: reward.description || reward.rewardSummary || '任务奖励灵石',
      createdAt: new Date()
    }
  });
}
