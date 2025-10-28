const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const {
  EXPERIENCE_PER_YUAN,
  COLLECTIONS,
  subLevelLabels,
  realmConfigs,
  membershipRights
} = require('common-config'); //云函数公共模块，维护在目录cloudfunctions/nodejs-layer/node_modules/common-config
const { DEFAULT_HOME_ENTRIES } = require('system-settings');

exports.main = async () => {
  await Promise.all([
    ensureCollection(COLLECTIONS.CHARGE_ORDERS),
    ensureCollection(COLLECTIONS.ERROR_LOGS),
    ensureCollection(COLLECTIONS.MEMBER_EXTRAS),
    ensureCollection(COLLECTIONS.MEMBER_TIMELINE),
    ensureCollection(COLLECTIONS.SYSTEM_SETTINGS),
    ensureCollection(COLLECTIONS.ACTIVITIES)
  ]);

  await Promise.all([
    seedCollection(COLLECTIONS.MEMBERSHIP_RIGHTS, membershipRights),
    seedCollection(COLLECTIONS.MEMBERSHIP_LEVELS, membershipLevels),
    seedCollection(COLLECTIONS.ROOMS, rooms),
    seedCollection(COLLECTIONS.TASKS, tasks),
    seedCollection(COLLECTIONS.COUPONS, coupons),
    seedCollection(COLLECTIONS.AVATAR_CATEGORIES, avatarCategories),
    seedCollection(COLLECTIONS.AVATARS, avatars)
  ]);

  await seedSystemSettings();
  await seedActivities();

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

const FEATURE_TOGGLE_DOC_ID = 'feature_toggles';
const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};
const DEFAULT_CACHE_VERSIONS = {
  global: 1,
  menu: 1
};
const DEFAULT_FEATURE_TOGGLES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT },
  cacheVersions: { ...DEFAULT_CACHE_VERSIONS },
  homeEntries: { ...DEFAULT_HOME_ENTRIES }
};

async function seedSystemSettings() {
  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const existing = await collection
    .doc(FEATURE_TOGGLE_DOC_ID)
    .get()
    .catch((error) => {
      if (error && error.errMsg && /not exist|not found/i.test(error.errMsg)) {
        return null;
      }
      throw error;
    });

  if (existing && existing.data) {
    return;
  }

  const now = new Date();
  await collection.doc(FEATURE_TOGGLE_DOC_ID).set({
    data: {
      ...DEFAULT_FEATURE_TOGGLES,
      createdAt: now,
      updatedAt: now
    }
  });
}

async function seedActivities() {
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const now = new Date();
  await Promise.all(
    defaultActivities.map(async (item) => {
      if (!item || !item._id) {
        return;
      }
      const snapshot = await collection
        .doc(item._id)
        .get()
        .catch((error) => {
          if (error && /not exist|not found/i.test(error.errMsg || '')) {
            return null;
          }
          throw error;
        });
      if (snapshot && snapshot.data) {
        return;
      }
      const startTime = item.startTime ? new Date(item.startTime) : null;
      const endTime = item.endTime ? new Date(item.endTime) : null;
      const data = {
        title: item.title || '',
        tagline: item.tagline || '',
        summary: item.summary || '',
        status: item.status || 'published',
        startTime: startTime && !Number.isNaN(startTime.getTime()) ? startTime : null,
        endTime: endTime && !Number.isNaN(endTime.getTime()) ? endTime : null,
        priceLabel: item.priceLabel || '',
        location: item.location || '',
        highlight: item.highlight || '',
        perks: Array.isArray(item.perks) ? item.perks : [],
        notes: item.notes || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        coverImage: item.coverImage || '',
        sortOrder: Number.isFinite(item.sortOrder)
          ? item.sortOrder
          : Number(item.sortOrder || 0) || 0,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system',
        updatedBy: 'system'
      };
      await collection.doc(item._id).set({ data });
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

const defaultActivities = [
  {
    _id: 'activity_202410_recharge',
    title: '充值赠包房礼',
    tagline: '充5000 送尊享包房一次',
    summary: '10月21日-11月9日限时充值礼遇',
    status: 'published',
    startTime: '2024-10-21T00:00:00+08:00',
    endTime: '2024-11-09T23:59:59+08:00',
    priceLabel: '充5000',
    highlight: '尊享包房含1箱啤酒与果盘，价值1800元',
    perks: [
      '充值 5000 元赠送尊享包房 1 次（价值 1800 元）',
      '含 1 箱啤酒、1 个果盘',
      '服务生 300 元小费无法免除'
    ],
    tags: ['充值礼遇', '限时活动'],
    sortOrder: 180
  },
  {
    _id: 'activity_202410_halloween',
    title: '万圣节古巴之夜',
    tagline: '门票 1288 赠高希霸世纪 6',
    summary: '10月31日 20:00 开场，畅饮多款精品酒水',
    status: 'published',
    startTime: '2024-10-31T20:00:00+08:00',
    endTime: '2024-10-31T23:59:59+08:00',
    priceLabel: '门票 ¥1288',
    highlight: '充值 1 万元免门票，额外赠包房含 3 箱啤酒、果盘',
    perks: [
      '赠送 1 支高希霸世纪 6',
      'KTV 自由欢唱',
      '古巴邑 10 年、雷司令、红酒、白兰地、鸡尾酒、软饮畅饮',
      '赠送万圣节随机头像、相框、称号、背景',
      '充值 1 万元免门票，额外赠送包房 1 次（含 3 箱啤酒、1 个果盘）'
    ],
    tags: ['万圣节', '酒会'],
    sortOrder: 260
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
