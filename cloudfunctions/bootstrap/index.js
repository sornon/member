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
  await Promise.all(
    dataList.map(async (item) => {
      const { _id, ...payload } = item;
      await collection.doc(_id).set({ data: payload });
    })
  );
}

const subLevelLabels = ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层', '圆满'];

const realmConfigs = [
  {
    id: 'realm_qi_refining',
    name: '炼气期',
    shortName: '炼气',
    description: '入门境界，通过吸纳天地灵气淬炼肉身，正式踏上修行大道。',
    increment: 100,
    discount: 1,
    virtualRewards: [
      '称号「炼气·初悟」，解锁灵根检测背景',
      '灵石积分 +100，可兑换入门灵草',
      '头像框「灵气萌芽」开放',
      '修炼服饰「青布道袍」上线',
      '虚拟法器「灵木剑」挂件',
      '聊天气泡「灵气环绕」',
      '消费积分加成 +5%，基础任务收益提升',
      '表情包「闭关修炼」解锁',
      '灵宠挂件「碧灵狐」幼崽随行',
      '修炼笔记皮肤「炼气圆满」开放'
    ],
    milestone: {
      type: '虚拟+饮品礼遇',
      summary: '灵泉饮品券 1 张 + 限定背景「炼气圆满」',
      rights: [
        {
          rightId: 'right_realm_qi_drink',
          quantity: 1,
          description: '灵泉饮品券 1 张'
        }
      ]
    }
  },
  {
    id: 'realm_foundation',
    name: '筑基期',
    shortName: '筑基',
    description: '稳固根基，凝练真元，寿元翻倍，为结丹做足准备。',
    increment: 200,
    discount: 0.99,
    virtualRewards: [
      '称号「筑基·初成」，昵称前缀升级',
      '灵石积分 +200，可兑换筑基丹材料',
      '头像框「筑基丹炉」解锁',
      '服饰「玄铁束甲」上线',
      '本命法器「赤焰飞剑」虚拟道具',
      '聊天气泡「丹火流光」特效',
      '消费积分加成提升至 +10%',
      '表情动作「丹炉炼制」',
      '灵宠进化为「碧灵狐·少成」',
      '专属动作「丹火腾空」展示'
    ],
    milestone: {
      type: '包房体验',
      summary: '私人包房券 1 次（1 小时）+ 虚拟特效「筑基雷纹」',
      rights: [
        {
          rightId: 'right_realm_foundation_room',
          quantity: 1,
          description: '筑基专属包房券 1 次'
        }
      ]
    }
  },
  {
    id: 'realm_core',
    name: '金丹期',
    shortName: '金丹',
    description: '凝聚金丹，可御空飞行，是门派的核心力量。',
    increment: 400,
    discount: 0.98,
    virtualRewards: [
      '称号「金丹·初凝」，获得金丹铭牌',
      '灵石积分 +400，可兑换珍稀材料',
      '头像框「金丹护体」解锁',
      '服饰「锦云法袍」上线',
      '法宝「玉衡飞剑」虚拟模型',
      '聊天气泡「丹光环绕」',
      '消费积分加成提升至 +15%',
      '动作「金丹出窍」解锁',
      '灵宠化形为「碧灵狐·灵巧」',
      '专属座驾「金丹祥云」虚拟坐骑'
    ],
    milestone: {
      type: '定制礼盒',
      summary: '定制礼盒「金丹入怀」 + 稀有法宝皮肤',
      rights: [
        {
          rightId: 'right_realm_core_gift',
          quantity: 1,
          description: '金丹定制礼盒 1 份'
        }
      ]
    }
  },
  {
    id: 'realm_nascent',
    name: '元婴期',
    shortName: '元婴',
    description: '金丹化婴，元神可离体而存，寿元再度提升。',
    increment: 800,
    discount: 0.97,
    virtualRewards: [
      '称号「元婴·初现」，展示元神光影',
      '灵石积分 +800，用于兑换元婴培元丹',
      '头像框「元婴护持」解锁',
      '服饰「素银道袍」上线',
      '法宝「紫雷珠」虚拟特效',
      '聊天气泡「元神出窍」',
      '消费积分加成提升至 +20%',
      '动作「元婴抱元」解锁',
      '灵宠成长为「碧灵狐·灵婴」',
      '开启随身元婴分身虚拟宠物'
    ],
    milestone: {
      type: '精品雪茄',
      summary: '精品雪茄「云雾上品」 + 元婴分身主题',
      rights: [
        {
          rightId: 'right_realm_nascent_cigar',
          quantity: 1,
          description: '元婴精品雪茄 1 支'
        }
      ]
    }
  },
  {
    id: 'realm_divine',
    name: '化神期',
    shortName: '化神',
    description: '感应法则之力，法力不绝，立于人界巅峰门槛。',
    increment: 1600,
    discount: 0.96,
    virtualRewards: [
      '称号「化神·初悟」，获得法则光纹',
      '灵石积分 +1600，可兑换化神法则碎片',
      '头像框「化神神光」解锁',
      '服饰「星辉法衣」上线',
      '法宝「九霄神剑」虚拟特效',
      '聊天气泡「神识寰宇」',
      '消费积分加成提升至 +25%',
      '动作「法则降临」解锁',
      '灵宠晋升为「碧灵狐·化神」',
      '解锁飞升试炼场主题'
    ],
    milestone: {
      type: '珍藏红酒',
      summary: '珍藏红酒「神霖年份」 + 化神法则光翼',
      rights: [
        {
          rightId: 'right_realm_divine_wine',
          quantity: 1,
          description: '化神珍藏红酒 1 瓶'
        }
      ]
    }
  },
  {
    id: 'realm_void',
    name: '炼虚期',
    shortName: '炼虚',
    description: '元婴化虚，可凝练分身，调动更广阔的天地之力。',
    increment: 3200,
    discount: 0.95,
    virtualRewards: [
      '称号「炼虚·洞明」，附带虚化光影',
      '灵石积分 +3200，用于兑换虚空晶石',
      '头像框「虚空流光」解锁',
      '服饰「雾隐斗篷」上线',
      '法宝「虚影分身」特效挂件',
      '聊天气泡「虚实交汇」',
      '消费积分加成提升至 +30%',
      '动作「虚空步」解锁',
      '灵宠化虚为「碧灵狐·虚灵」',
      '获得尊贵徽记「炼虚印记」'
    ],
    milestone: {
      type: '尊贵标识',
      summary: '尊贵标识礼包 + 虚空行走特效',
      rights: [
        {
          rightId: 'right_realm_void_badge',
          quantity: 1,
          description: '炼虚尊贵标识礼包'
        }
      ]
    }
  },
  {
    id: 'realm_unity',
    name: '合体期',
    shortName: '合体',
    description: '元神与分身合一，显化法相真身，掌控磅礴灵力。',
    increment: 6400,
    discount: 0.94,
    virtualRewards: [
      '称号「合体·初合」，显化合体光环',
      '灵石积分 +6400，兑换合体灵材',
      '头像框「合体法相」解锁',
      '服饰「鸿蒙战铠」上线',
      '法宝「法相金身」虚拟模型',
      '聊天气泡「天地同调」',
      '消费积分加成提升至 +35%',
      '动作「法相显圣」解锁',
      '灵宠晋阶为「碧灵狐·法相」',
      '专属动态光环「合体真身」'
    ],
    milestone: {
      type: '钻石形象与尊享服务',
      summary: '专属虚拟形象套装 + 钻石级尊享服务礼遇',
      rights: [
        {
          rightId: 'right_realm_unity_avatar',
          quantity: 1,
          description: '合体专属形象套装'
        }
      ]
    }
  },
  {
    id: 'realm_great_vehicle',
    name: '大乘期',
    shortName: '大乘',
    description: '修为圆满，掌控更高层次法则之力，距离飞升只差临门一脚。',
    increment: 12800,
    discount: 0.93,
    virtualRewards: [
      '称号「大乘·初悟」，获得道韵光芒',
      '灵石积分 +12800，可兑换飞升宝材',
      '头像框「大乘法象」解锁',
      '服饰「苍穹霞衣」上线',
      '法宝「鸿蒙界扇」虚拟特效',
      '聊天气泡「道音回响」',
      '消费积分加成提升至 +40%',
      '动作「道韵加身」解锁',
      '灵宠化为「碧灵狐·玄极」',
      '专属场景「大乘天宫」背景'
    ],
    milestone: {
      type: '贵宾宴请',
      summary: '贵宾宴请券 + 大乘天宫场景永久解锁',
      rights: [
        {
          rightId: 'right_realm_great_vehicle_banquet',
          quantity: 1,
          description: '大乘贵宾宴请券'
        }
      ]
    }
  },
  {
    id: 'realm_tribulation',
    name: '渡劫期',
    shortName: '渡劫',
    description: '迎接雷劫洗礼，冲击仙界门槛，成败在此一举。',
    increment: 25600,
    discount: 0.92,
    virtualRewards: [
      '称号「渡劫·初雷」，附带雷霆特效',
      '灵石积分 +25600，用于兑换渡劫护符',
      '头像框「雷劫之环」解锁',
      '服饰「劫云战袍」上线',
      '法宝「九天雷鼓」虚拟特效',
      '聊天气泡「仙雷洗礼」',
      '消费积分加成提升至 +45%',
      '动作「雷霆御身」解锁',
      '灵宠蜕变为「碧灵狐·雷劫」',
      '专属特效「仙雷护体」'
    ],
    milestone: {
      type: '整店欢聚夜',
      summary: '整店欢聚夜包场券 + 渡劫雷劫动态场景',
      rights: [
        {
          rightId: 'right_realm_tribulation_fullhouse',
          quantity: 1,
          description: '渡劫整店欢聚夜 1 次'
        }
      ]
    }
  },
  {
    id: 'realm_ascension',
    name: '飞升期',
    shortName: '飞升',
    description: '飞升在即，脱离凡俗成就真仙，享无尽寿元与更高维力量。',
    increment: 51200,
    discount: 0.9,
    virtualRewards: [
      '称号「飞升·初羽」，获得仙羽光效',
      '灵石积分 +51200，可兑换仙界供品',
      '头像框「飞升圣环」解锁',
      '服饰「仙尊羽衣」上线',
      '法宝「九霄云辇」虚拟座驾',
      '聊天气泡「仙韵缭绕」',
      '消费积分加成提升至 +50%',
      '动作「飞升之姿」解锁',
      '灵宠圆满为「碧灵狐·仙灵」',
      '终极虚拟形象套装「仙尊降世」'
    ],
    milestone: {
      type: '至尊黑卡',
      summary: '至尊黑卡 + 终极仙尊虚拟套装',
      rights: [
        {
          rightId: 'right_realm_immortal_blackcard',
          quantity: 1,
          description: '飞升至尊黑卡'
        }
      ]
    }
  }
];

const membershipRights = [
  {
    _id: 'right_realm_qi_drink',
    name: '灵泉饮品券',
    description: '炼气圆满奖励，赠送店内特调饮品 1 杯',
    applyReservation: false,
    validDays: 60
  },
  {
    _id: 'right_realm_foundation_room',
    name: '筑基专属包房券',
    description: '非高峰时段私人包房 1 小时，需提前预约',
    applyReservation: true,
    applySlots: ['day', 'night', 'late'],
    validDays: 120
  },
  {
    _id: 'right_realm_core_gift',
    name: '金丹定制礼盒',
    description: '法宝主题礼盒套装 1 份，线下领取',
    applyReservation: false,
    validDays: 365
  },
  {
    _id: 'right_realm_nascent_cigar',
    name: '元婴精品雪茄',
    description: '甄选雪茄 1 支，需到店核验身份后领取',
    applyReservation: false,
    validDays: 365
  },
  {
    _id: 'right_realm_divine_wine',
    name: '化神珍藏红酒',
    description: '珍藏红酒 1 瓶，可预约到店领取',
    applyReservation: false,
    validDays: 365
  },
  {
    _id: 'right_realm_void_badge',
    name: '炼虚尊贵标识包',
    description: '发放实体徽章与虚拟标识，永久生效',
    applyReservation: false
  },
  {
    _id: 'right_realm_unity_avatar',
    name: '合体专属形象套装',
    description: '钻石级专属头像、光环与服饰整套',
    applyReservation: false
  },
  {
    _id: 'right_realm_great_vehicle_banquet',
    name: '大乘贵宾宴请券',
    description: '年度贵宾宴席邀请 1 次，需提前预约',
    applyReservation: false,
    validDays: 365
  },
  {
    _id: 'right_realm_tribulation_fullhouse',
    name: '渡劫整店欢聚夜',
    description: '整店包场券 1 次，提前 7 日预约',
    applyReservation: false,
    validDays: 180
  },
  {
    _id: 'right_realm_immortal_blackcard',
    name: '飞升至尊黑卡',
    description: '终身尊享黑卡服务与专属顾问',
    applyReservation: false
  },
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

const membershipLevels = buildMembershipLevels();

function buildMembershipLevels() {
  const levels = [];
  let cumulativeRecharge = 0;
  let order = 1;

  realmConfigs.forEach((realm, realmIndex) => {
    const { increment, discount, virtualRewards, milestone } = realm;

    subLevelLabels.forEach((label, subIndex) => {
      const subLevel = subIndex + 1;
      let thresholdYuan;
      if (realmIndex === 0 && subLevel === 1) {
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
        threshold: thresholdYuan * 100,
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
