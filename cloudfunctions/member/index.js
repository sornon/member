const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEMBERS: 'members',
  LEVELS: 'membershipLevels',
  RIGHTS_MASTER: 'membershipRights',
  MEMBER_RIGHTS: 'memberRights'
};

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'profile';

  switch (action) {
    case 'init':
      return initMember(OPENID, event.profile || {});
    case 'profile':
      return getProfile(OPENID);
    case 'progress':
      return getProgress(OPENID);
    case 'rights':
      return getRights(OPENID);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function initMember(openid, profile) {
  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const exist = await membersCollection.doc(openid).get().catch(() => null);
  if (exist && exist.data) {
    return exist.data;
  }

  const levels = await loadLevels();
  const defaultLevel = levels[0];
  const doc = {
    _id: openid,
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    mobile: profile.mobile || '',
    levelId: defaultLevel ? defaultLevel._id : '',
    experience: 0,
    balance: 0,
    roles: ['member'],
    createdAt: new Date(),
    avatarConfig: {}
  };
  await membersCollection.add({ data: doc });
  if (defaultLevel) {
    await grantLevelRewards(openid, defaultLevel, []);
  }
  return doc;
}

async function getProfile(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return getProfile(openid);
  }
  const member = memberDoc.data;
  const synced = await ensureLevelSync(member, levels);
  return decorateMember(synced, levels);
}

async function getProgress(openid) {
  const [levels, memberDoc] = await Promise.all([
    loadLevels(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);
  if (!memberDoc || !memberDoc.data) {
    await initMember(openid, {});
    return getProgress(openid);
  }
  const member = await ensureLevelSync(memberDoc.data, levels);
  const currentLevel = levels.find((lvl) => lvl._id === member.levelId) || levels[0];
  const nextLevel = getNextLevel(levels, currentLevel);
  const percentage = calculatePercentage(member.experience, currentLevel, nextLevel);
  const nextDiff = nextLevel ? Math.max(nextLevel.threshold - member.experience, 0) : 0;
  return {
    member: decorateMember(member, levels),
    levels: levels.map((lvl) => ({
      _id: lvl._id,
      name: lvl.displayName || lvl.name,
      displayName: lvl.displayName || lvl.name,
      shortName: lvl.name,
      threshold: lvl.threshold,
      discount: lvl.discount,
      order: lvl.order,
      realm: lvl.realm,
      realmShort: lvl.realmShort || '',
      realmId: lvl.realmId || '',
      realmOrder: lvl.realmOrder || lvl.order,
      realmDescription: lvl.realmDescription || '',
      subLevel: lvl.subLevel || 1,
      subLevelLabel: lvl.subLevelLabel || '',
      virtualRewards: lvl.virtualRewards || [],
      milestoneReward: lvl.milestoneReward || '',
      milestoneType: lvl.milestoneType || '',
      rewards: (lvl.rewards || []).map((reward) => reward.description || reward.name || '')
    })),
    percentage,
    nextDiff,
    currentLevel,
    nextLevel
  };
}

async function getRights(openid) {
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const [rightsSnapshot, rightsMasterSnapshot] = await Promise.all([
    rightsCollection
      .where({ memberId: openid })
      .orderBy('issuedAt', 'desc')
      .get(),
    db.collection(COLLECTIONS.RIGHTS_MASTER).get()
  ]);

  const masterMap = {};
  rightsMasterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });

  const now = Date.now();
  return rightsSnapshot.data.map((item) => {
    const right = masterMap[item.rightId] || {};
    const expired = item.validUntil && new Date(item.validUntil).getTime() < now;
    const status = expired ? 'expired' : item.status || 'active';
    const statusLabel = statusLabelMap[status] || '待使用';
    return {
      _id: item._id,
      name: right.name || item.name || '权益',
      description: right.description || item.description || '',
      status,
      statusLabel,
      validUntil: item.validUntil || right.defaultValidUntil || '',
      canReserve: !!right.applyReservation && status === 'active',
      meta: item.meta || {}
    };
  });
}

const statusLabelMap = {
  active: '可使用',
  used: '已使用',
  expired: '已过期',
  locked: '预约中'
};

async function ensureLevelSync(member, levels) {
  if (!levels.length) return member;
  const targetLevel = resolveLevelByExperience(member.experience || 0, levels);
  if (targetLevel && targetLevel._id !== member.levelId) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: {
          levelId: targetLevel._id,
          updatedAt: new Date()
        }
      });
    await grantLevelRewards(member._id, targetLevel, levels);
    member.levelId = targetLevel._id;
  }
  return member;
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

function getNextLevel(levels, currentLevel) {
  if (!currentLevel) return null;
  const sorted = [...levels].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((item) => item._id === currentLevel._id);
  if (idx < 0 || idx === sorted.length - 1) {
    return null;
  }
  return sorted[idx + 1];
}

function calculatePercentage(exp, currentLevel, nextLevel) {
  if (!currentLevel || !nextLevel) {
    return 100;
  }
  const delta = nextLevel.threshold - currentLevel.threshold;
  if (delta <= 0) {
    return 100;
  }
  return Math.min(100, Math.round(((exp - currentLevel.threshold) / delta) * 100));
}

async function grantLevelRewards(openid, level, levels) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  const masterSnapshot = await db.collection(COLLECTIONS.RIGHTS_MASTER).get();
  const masterMap = {};
  masterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });

  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({
        memberId: openid,
        rightId: reward.rightId,
        levelId: level._id
      })
      .get();
    const needQuantity = reward.quantity || 1;
    const already = existing.data.length;
    if (already >= needQuantity) {
      continue;
    }
    const diff = needQuantity - already;
    for (let i = 0; i < diff; i += 1) {
      const validUntil = right.validDays
        ? new Date(now.getTime() + right.validDays * 24 * 60 * 60 * 1000)
        : null;
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

async function loadLevels() {
  const snapshot = await db.collection(COLLECTIONS.LEVELS).orderBy('order', 'asc').get();
  return snapshot.data || [];
}

function decorateMember(member, levels) {
  const level = levels.find((lvl) => lvl._id === member.levelId) || null;
  const roles = Array.isArray(member.roles) && member.roles.length ? member.roles : ['member'];
  if (roles !== member.roles) {
    db.collection(COLLECTIONS.MEMBERS)
      .doc(member._id)
      .update({
        data: {
          roles,
          updatedAt: new Date()
        }
      })
      .catch(() => {});
  }
  return {
    ...member,
    roles,
    level
  };
}
