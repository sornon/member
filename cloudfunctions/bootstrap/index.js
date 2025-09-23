const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
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

async function seedCollection(name, dataList) {
  const collection = db.collection(name);
  for (const item of dataList) {
    const doc = await collection.doc(item._id).get().catch(() => null);
    if (!doc || !doc.data) {
      await collection.add({ data: item });
    } else {
      const { _id, ...payload } = item;
      await collection.doc(item._id).update({ data: payload });
    }
  }
}

const membershipRights = [
  {
    _id: 'right_daytime_room',
    name: '日间包房体验券',
    description: '免费预订一次日间非高峰包房',
    applyReservation: true,
    applySlots: ['day'],
    validDays: 90
  },
  {
    _id: 'right_full_day_room',
    name: '全天包房体验券',
    description: '免费预订一次全天任意时段包房',
    applyReservation: true,
    applySlots: ['day', 'night', 'late'],
    validDays: 120
  },
  {
    _id: 'right_full_house',
    name: '整店包场券',
    description: '尊享整店包场特权一次，需提前预约',
    applyReservation: false,
    validDays: 180
  },
  {
    _id: 'right_premium_gift',
    name: '精品礼盒',
    description: '10 支雪茄 BHK56 礼盒',
    applyReservation: false,
    validDays: 365
  }
];

const membershipLevels = [
  {
    _id: 'novice',
    name: '练气级',
    threshold: 0,
    discount: 1,
    order: 1,
    rewards: []
  },
  {
    _id: 'foundation',
    name: '筑基级',
    threshold: 200000,
    discount: 0.95,
    order: 2,
    rewards: [
      {
        rightId: 'right_daytime_room',
        quantity: 1,
        description: '赠送 1 次日间包房使用权'
      }
    ]
  },
  {
    _id: 'core',
    name: '结丹级',
    threshold: 500000,
    discount: 0.9,
    order: 3,
    rewards: [
      {
        rightId: 'right_full_day_room',
        quantity: 1,
        description: '赠送 1 次全天包房使用权'
      }
    ]
  },
  {
    _id: 'nascent',
    name: '元婴级',
    threshold: 1000000,
    discount: 0.88,
    order: 4,
    rewards: [
      {
        rightId: 'right_full_day_room',
        quantity: 1,
        description: '再赠送 1 次全天包房使用权'
      }
    ]
  },
  {
    _id: 'divine',
    name: '化神级',
    threshold: 2000000,
    discount: 0.85,
    order: 5,
    rewards: [
      {
        rightId: 'right_full_house',
        quantity: 1,
        description: '赠送 1 次整店包场特权'
      }
    ]
  },
  {
    _id: 'ascend',
    name: '渡劫级',
    threshold: 5000000,
    discount: 0.8,
    order: 6,
    rewards: [
      {
        rightId: 'right_premium_gift',
        quantity: 1,
        description: '赠送精品礼品礼包'
      }
    ]
  }
];

const rooms = [
  {
    _id: 'room_a',
    name: '玉竹雅间',
    capacity: 6,
    facilities: ['环绕音响', '智能灯光', '小食吧'],
    pricing: {
      day: 68000,
      night: 98000,
      late: 78000
    },
    priority: 1,
    status: 'online'
  },
  {
    _id: 'room_b',
    name: '紫霄天境',
    capacity: 10,
    facilities: ['豪华沙发', '私人调酒', '舞台灯光'],
    pricing: {
      day: 98000,
      night: 158000,
      late: 118000
    },
    priority: 2,
    status: 'online'
  },
  {
    _id: 'room_c',
    name: '云梦仙台',
    capacity: 20,
    facilities: ['LED 大屏', '舞台', '专业调音台'],
    pricing: {
      day: 158000,
      night: 238000,
      late: 188000
    },
    priority: 3,
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
