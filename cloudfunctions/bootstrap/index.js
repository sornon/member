const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const {
  EXPERIENCE_PER_YUAN,
  subLevelLabels,
  realmConfigs,
  membershipRights
} = require('./level-config');

exports.main = async () => {
  await Promise.all([
    ensureCollection('chargeOrders'),
    ensureCollection('errorlogs'),
    ensureCollection('memberExtras'),
    ensureCollection('memberTimeline')
  ]);

  await Promise.all([
    seedCollection('membershipRights', membershipRights),
    seedCollection('membershipLevels', membershipLevels),
    seedCollection('rooms', rooms),
    seedCollection('tasks', tasks),
    seedCollection('coupons', coupons),
    seedCollection('avatarCategories', avatarCategories),
    seedCollection('avatars', avatars)
  ]);

  return { success: true };
};

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    if (!error || !error.errMsg) {
      throw error;
    }
    const alreadyExists =
      error.errCode === -501001 ||
      error.errCode === -501002 ||
      /already exists/i.test(error.errMsg);
    if (!alreadyExists) {
      throw error;
    }
  }
}

async function seedCollection(name, dataList) {
  const collection = db.collection(name);
  await Promise.all(
    dataList.map(async (item) => {
      const { _id, ...payload } = item;
      await collection.doc(_id).set({ data: payload });
    })
  );
}

const membershipLevels = buildMembershipLevels();

function buildMembershipLevels() {
  const levels = [];
  let cumulativeRecharge = 0;
  let order = 1;

  realmConfigs.forEach((realm, realmIndex) => {
    const { increment, discount, virtualRewards, milestone, thresholds } = realm;
    const hasCustomThresholds =
      Array.isArray(thresholds) && thresholds.length === subLevelLabels.length;

    subLevelLabels.forEach((label, subIndex) => {
      const subLevel = subIndex + 1;
      let thresholdYuan;
      if (hasCustomThresholds) {
        thresholdYuan = thresholds[subIndex];
        cumulativeRecharge = thresholdYuan;
      } else if (realmIndex === 0 && subLevel === 1) {
        thresholdYuan = 0;
      } else {
        cumulativeRecharge += increment;
        thresholdYuan = cumulativeRecharge;
      }

      const level = {
        _id: `level_${String(order).padStart(3, '0')}`,
        name: `${realm.shortName}${label}`,
        displayName: `${realm.name} · ${label}`,
        realm: realm.name,
        realmShort: realm.shortName,
        realmId: realm.id,
        realmOrder: realmIndex + 1,
        realmDescription: realm.description,
        subLevel,
        subLevelLabel: label,
        threshold: Math.round(thresholdYuan * EXPERIENCE_PER_YUAN),
        discount,
        order,
        virtualRewards: [],
        milestoneReward: '',
        milestoneType: milestone ? milestone.type || '' : '',
        rewards: []
      };

      const rewardText = virtualRewards[subIndex];
      if (rewardText) {
        level.virtualRewards = Array.isArray(rewardText)
          ? rewardText.filter(Boolean)
          : [rewardText];
      }

      if (subLevel === subLevelLabels.length && milestone) {
        level.milestoneReward = milestone.summary;
        if (Array.isArray(milestone.rights)) {
          level.rewards = milestone.rights.map((item) => ({
            rightId: item.rightId,
            quantity: item.quantity || 1,
            description: item.description
          }));
        }
      }

      levels.push(level);
      order += 1;
    });
  });

  return levels;
}

const rooms = [
  {
    _id: 'room_jyzq10',
    name: '酒隐之茄10人包',
    capacity: 10,
    facilities: ['顶级音响', 'LED大屏', '净烟卫士', '豪华沙发'],
    pricing: {
      fixed: 0
    },
    priority: 1,
    status: 'online'
  }
];

const coupons = [
  {
    _id: 'coupon_welcome_100',
    title: '¥100 新人满减券',
    description: '单笔消费满 ¥500 可用',
    type: 'cash',
    amount: 10000,
    threshold: 50000,
    validDays: 30
  },
  {
    _id: 'coupon_spend_back',
    title: '10% 消费返券',
    description: '单笔消费满 ¥1000 返券 10%',
    type: 'discount',
    amount: 10,
    threshold: 100000,
    validDays: 30
  }
];

const tasks = [
  {
    _id: 'task_signin',
    title: '连续签到 7 天',
    description: '每日登录小程序签到，连续 7 天领券',
    type: 'signin',
    target: 7,
    status: 'online',
    priority: 1,
    reward: {
      type: 'coupon',
      couponId: 'coupon_welcome_100'
    },
    rewardSummary: '赠 ¥100 满减券'
  },
  {
    _id: 'task_invite',
    title: '成功邀请 3 位好友',
    description: '好友注册并首单消费即视为邀请成功',
    type: 'invite',
    target: 3,
    status: 'online',
    priority: 2,
    reward: {
      type: 'balance',
      amount: 5000
    },
    rewardSummary: '赠余额 ¥50'
  },
  {
    _id: 'task_spend',
    title: '单笔消费满 ¥500',
    description: '任意订单单笔满 ¥500 返券',
    type: 'spend',
    target: 1,
    status: 'online',
    priority: 3,
    reward: {
      type: 'coupon',
      couponId: 'coupon_spend_back'
    },
    rewardSummary: '10% 返券'
  }
];

const avatarCategories = [
  {
    _id: 'outfit',
    name: '仙衣',
    order: 1
  },
  {
    _id: 'weapon',
    name: '法器',
    order: 2
  },
  {
    _id: 'aura',
    name: '灵光',
    order: 3
  }
];

const avatars = [
  {
    _id: 'outfit_basic',
    categoryId: 'outfit',
    name: '素云道袍',
    description: '练气期基础服饰',
    unlockText: '默认拥有',
    status: 'online'
  },
  {
    _id: 'outfit_foundation',
    categoryId: 'outfit',
    name: '紫府道袍',
    description: '筑基级解锁',
    unlockText: '达到筑基级自动解锁',
    status: 'online'
  },
  {
    _id: 'weapon_sword',
    categoryId: 'weapon',
    name: '玄霄飞剑',
    description: '结丹级奖励专属',
    unlockText: '完成结丹级任务获取',
    status: 'online'
  },
  {
    _id: 'aura_light',
    categoryId: 'aura',
    name: '仙灵流光',
    description: 'VIP 限定灵光环绕',
    unlockText: '达成元婴级或活动解锁',
    status: 'online'
  }
];
