import { AdminService } from '../../../services/api';

const SECTION_LABELS = {
  level: '等级成长/属性曲线',
  equipment: '装备强化成长',
  skill: '技能资源与控制',
  pve: 'PVE 秘境与怪物',
  pvp: 'PVP 赛季与匹配'
};

const SLOT_LABEL_MAP = {
  weapon: '武器槽位',
  armor: '防具槽位',
  accessory: '饰品槽位'
};

const TIER_TITLE_MAP = {
  bronze: '青铜',
  silver: '白银',
  gold: '黄金',
  platinum: '白金',
  diamond: '钻石',
  master: '宗师'
};

const TIER_FIELD_META = {
  id: { label: '段位键名', description: '用于引用段位的唯一键，请使用英文或拼音。' },
  name: { label: '段位中文名', description: '显示在排行榜或界面的名称。' },
  min: { label: '最低分', description: '进入该段位的最低天梯分。' },
  max: { label: '最高分', description: '该段位的最高天梯分，填 Infinity 代表无上限。' },
  color: { label: '显示颜色', description: '段位徽章或进度的配色，例如 #c4723a。' },
  rewardKey: { label: '奖励键名', description: '对应 tierRewards 下的键名，用于领取奖励。' }
};

const FIELD_GROUP_META = [
  {
    section: 'level',
    prefix: 'profiles.v1.defaults.combatStats.',
    map: {
      maxHp: { label: '最大生命值上限', description: '角色生命值基线，用于计算血量与容错。' },
      physicalAttack: { label: '物理攻击强度', description: '物理输出基线，决定物攻伤害起点。' },
      magicAttack: { label: '魔法攻击强度', description: '魔法输出基线，决定法术伤害起点。' },
      physicalDefense: { label: '物理防御力', description: '物理减伤基线，抵御物理伤害。' },
      magicDefense: { label: '魔法防御力', description: '魔法减伤基线，抵御法术伤害。' },
      speed: { label: '速度（行动条）', description: '影响行动条增长与出手顺序的基线。' },
      accuracy: { label: '命中率', description: '命中初始属性，决定命中公式基础。' },
      dodge: { label: '闪避率', description: '闪避初始属性，为命中公式留出空间。' },
      critRate: { label: '暴击率', description: '暴击触发起点。' },
      critDamage: { label: '暴击伤害倍数', description: '暴击倍率起点。' },
      finalDamageBonus: { label: '终伤加成系数', description: '终伤增益基线。' },
      finalDamageReduction: { label: '终伤减免系数', description: '终伤减益基线，抵消伤害。' },
      lifeSteal: { label: '吸血比例', description: '攻击回血起点，影响续航。' },
      healingBonus: { label: '主动治疗加成', description: '治疗输出基线。' },
      healingReduction: { label: '治疗减免', description: '对目标施加的治疗衰减起点。' },
      controlHit: { label: '控制命中', description: '控制类效果命中率基线。' },
      controlResist: { label: '控制抗性', description: '抵抗控制的基线。' },
      physicalPenetration: { label: '物理穿透', description: '物防穿透起点。' },
      magicPenetration: { label: '魔法穿透', description: '魔防穿透起点。' },
      critResist: { label: '暴击抵抗率', description: '抑制被暴击的起点。' },
      comboRate: { label: '连击概率', description: '触发类概率基线。' },
      block: { label: '格挡率', description: '格挡触发基线。' },
      counterRate: { label: '反击概率', description: '反击触发基线。' },
      damageReduction: { label: '通用减伤率', description: '固定减伤基线。' },
      healingReceived: { label: '受治疗加成', description: '被治疗收益基线。' },
      rageGain: { label: '怒气获取效率', description: '资源获取效率基线。' },
      controlStrength: { label: '控制强度', description: '控制效果时长/强度基线。' },
      shieldPower: { label: '护盾强度加成', description: '护盾效率基线。' },
      summonPower: { label: '召唤物强度', description: '召唤物属性加成起点。' },
      elementalVulnerability: { label: '元素易伤系数', description: '元素伤害易伤基线。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.defaults.specialStats.',
    map: {
      shield: { label: '初始护盾值', description: '角色创建时自带护盾。' },
      bonusDamage: { label: '额外伤害系数', description: '触发额外伤害的倍率基线。' },
      dodgeChance: { label: '额外闪避概率', description: '触发型闪避概率基线。' },
      healOnHit: { label: '命中回复生命比例', description: '每次命中触发的自恢复。' },
      healOnKill: { label: '击杀回复生命比例', description: '击杀触发的自恢复。' },
      damageReflection: { label: '反弹伤害比例', description: '反伤系数基线。' },
      accuracyBonus: { label: '额外命中加成', description: '额外命中修正基线。' },
      speedBonus: { label: '额外速度加成', description: '临时速度增益基线。' },
      physicalPenetrationBonus: { label: '额外物理穿透', description: '额外物防穿透修正。' },
      magicPenetrationBonus: { label: '额外魔法穿透', description: '额外魔防穿透修正。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.hitFormula.',
    map: {
      base: { label: '命中公式基础命中率', description: '命中概率的基础值。' },
      slope: { label: '命中成长斜率', description: '命中随属性或等级提升的斜率。' },
      min: { label: '命中下限', description: '命中概率的最小截断值。' },
      max: { label: '命中上限', description: '命中概率的最大截断值。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.penetration.',
    map: {
      scale: { label: '穿透系数比例', description: '穿透属性转化为减防效果的比例。' },
      max: { label: '减防率上限', description: '穿透减防的封顶值。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.baseDamage.',
    map: {
      minAttackRatio: { label: '攻击占比最低阈值', description: '伤害公式中攻击力占比的下限。' },
      randomMin: { label: '伤害随机浮动下限', description: '基础伤害随机区间的起点。' },
      randomRange: { label: '伤害随机浮动幅度', description: '基础伤害的随机波动范围。' },
      minDamage: { label: '伤害保底值', description: '极端情况下的最小伤害。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.crit.',
    map: {
      min: { label: '暴击率下限', description: '暴击触发概率最小值。' },
      max: { label: '暴击率上限', description: '暴击触发概率最大值。' },
      damageMin: { label: '暴击伤害下限', description: '暴击伤害倍率的下限。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.finalDamage.',
    map: {
      minMultiplier: { label: '终伤总乘最低倍率', description: '终伤乘区的最低值。' },
      'bonusClamp.min': { label: '终伤加成最小截断', description: '终伤加成的最低截断值。' },
      'bonusClamp.max': { label: '终伤加成最大截断', description: '终伤加成的最高截断值。' },
      'reductionClamp.min': { label: '终伤减免最小截断', description: '终伤减免的最低截断值。' },
      'reductionClamp.max': { label: '终伤减免最大截断', description: '终伤减免的最高截断值。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.healing.',
    map: {
      lifeStealMax: { label: '吸血比例上限', description: '吸血系数封顶，防止无限续航。' },
      'healingBonusClamp.min': { label: '治疗加成最小截断', description: '治疗增益允许的最低值。' },
      'healingBonusClamp.max': { label: '治疗加成最大截断', description: '治疗增益允许的最高值。' },
      'healingReductionClamp.min': { label: '治疗减免最小截断', description: '治疗减免允许的最低值。' },
      'healingReductionClamp.max': { label: '治疗减免最大截断', description: '治疗减免允许的最高值。' },
      'healingReceivedClamp.min': { label: '受治疗加成最小截断', description: '受治疗系数的下限。' },
      'healingReceivedClamp.max': { label: '受治疗加成最大截断', description: '受治疗系数的上限。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.mitigation.',
    map: {
      damageReductionMax: { label: '减伤率上限', description: '通用减伤的封顶值。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.procCaps.',
    map: {
      comboRateMax: { label: '连击概率上限', description: '触发概率最高 100%。' },
      blockMax: { label: '格挡概率上限', description: '格挡概率封顶。' },
      counterRateMax: { label: '反击概率上限', description: '反击概率封顶。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.specialCaps.',
    map: {
      dodgeChanceMax: { label: '闪避概率上限', description: '附加闪避的封顶值。' },
      damageReflectionMax: { label: '反弹伤害比例上限', description: '反伤比例封顶。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v1.statFloors.',
    map: {
      critDamageMin: { label: '暴击伤害下限', description: '暴击伤害倍率的最低值。' }
    }
  },
  {
    section: 'level',
    prefix: 'profiles.v2.',
    map: {
      'hitFormula.base': { label: 'V2 命中基础值', description: '在 v2 中提升命中基础率。' },
      'baseDamage.randomMin': { label: 'V2 伤害浮动下限', description: 'v2 的基础伤害随机下限。' },
      'baseDamage.randomRange': { label: 'V2 伤害浮动幅度', description: 'v2 的基础伤害浮动范围。' },
      'crit.min': { label: 'V2 暴击率下限', description: 'v2 的暴击触发下限。' }
    }
  },
  {
    section: 'equipment',
    prefix: 'profiles.v1.',
    map: {
      slots: { label: '可强化装备槽位', description: '允许强化的装备槽列表。' },
      'enhancement.base': { label: '强化基础倍率', description: '装备强化计算使用的基础系数。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v1.resource.defaults.',
    map: {
      type: { label: '资源类型', description: '技能资源的代号，如怒气/真气。' },
      baseMax: { label: '资源上限', description: '技能资源槽的最大值。' },
      startFraction: { label: '开局资源百分比', description: '按最大值比例给予的起手资源。' },
      startValue: { label: '开局固定资源', description: '开局额外的固定资源值。' },
      turnGain: { label: '每回合自然回复', description: '回合结束自动恢复的资源量。' },
      basicAttackGain: { label: '普攻获得资源', description: '普攻后获得的资源。' },
      damageTakenGain: { label: '受伤资源系数', description: '按伤害量乘系数获得资源。' },
      critGain: { label: '暴击奖励资源', description: '造成暴击时额外获得的资源。' },
      critTakenGain: { label: '被暴击补偿资源', description: '被暴击时额外获得的资源。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v1.controlEffects.stun.',
    map: {
      summary: { label: '眩晕描述', description: '状态描述文案。' },
      skip: { label: '眩晕跳过回合', description: '是否整回合跳过。' },
      disableBasic: { label: '眩晕禁用普攻', description: '眩晕时是否禁止普攻。' },
      disableActive: { label: '眩晕禁用主动技能', description: '眩晕时是否禁止主动技能。' },
      disableDodge: { label: '眩晕禁用闪避', description: '眩晕时是否禁止闪避。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v1.controlEffects.silence.',
    map: {
      summary: { label: '沉默描述', description: '状态描述文案。' },
      skip: { label: '沉默跳过回合', description: '沉默时是否跳过回合。' },
      disableBasic: { label: '沉默禁用普攻', description: '沉默时是否禁止普攻。' },
      disableActive: { label: '沉默禁用主动技能', description: '沉默时是否禁止主动技能。' },
      disableDodge: { label: '沉默禁用闪避', description: '沉默时是否禁止闪避。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v1.controlEffects.freeze.',
    map: {
      summary: { label: '冰冻描述', description: '状态描述文案。' },
      skip: { label: '冰冻跳过回合', description: '冰冻时是否跳过回合。' },
      disableBasic: { label: '冰冻禁用普攻', description: '冰冻时是否禁止普攻。' },
      disableActive: { label: '冰冻禁用主动技能', description: '冰冻时是否禁止主动技能。' },
      disableDodge: { label: '冰冻禁用闪避', description: '冰冻时是否禁止闪避。' },
      breakOnFire: { label: '火属性解除冰冻', description: '受到火属性伤害是否解除。' },
      fireDamageMultiplier: { label: '火克制额外伤害', description: '火属性克制下的额外伤害系数。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v1.controlEffects.sleep.',
    map: {
      summary: { label: '沉睡描述', description: '状态描述文案。' },
      skip: { label: '沉睡跳过回合', description: '沉睡时是否跳过回合。' },
      disableBasic: { label: '沉睡禁用普攻', description: '沉睡时是否禁止普攻。' },
      disableActive: { label: '沉睡禁用主动技能', description: '沉睡时是否禁止主动技能。' },
      disableDodge: { label: '沉睡禁用闪避', description: '沉睡时是否禁止闪避。' },
      wakeOnDamage: { label: '受击立即醒来', description: '受伤后是否立即解除沉睡。' },
      turnResourceGain: { label: '沉睡回合被动回能', description: '沉睡状态下每回合被动回复的资源量。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v2.resource.defaults.',
    map: {
      turnGain: { label: 'V2 每回合回能', description: 'v2 版本的自然回复量。' },
      basicAttackGain: { label: 'V2 普攻回能', description: 'v2 版本的普攻资源获取。' },
      damageTakenGain: { label: 'V2 受伤回能系数', description: 'v2 受伤获得资源的系数。' },
      startFraction: { label: 'V2 开局资源比例', description: 'v2 版本的起手资源比例。' },
      'controlEffects.sleep.turnResourceGain': { label: 'V2 沉睡回能', description: 'v2 中沉睡状态的回能值。' }
    }
  },
  {
    section: 'skill',
    prefix: 'profiles.v2.controlEffects.sleep.',
    map: {
      turnResourceGain: { label: 'V2 沉睡回能', description: 'v2 中沉睡状态的回能值。' }
    }
  },
  {
    section: 'pve',
    prefix: 'profiles.v1.',
    map: {
      maxLevel: { label: 'PVE 等级上限', description: '秘境与剧情的等级封顶。' },
      roundLimit: { label: 'PVE 最大回合数', description: 'PVE 战斗超出回合即判和局。' },
      cooldownMs: { label: 'PVE 冷却时间(毫秒)', description: '限制重复开战的冷却时间。' },
      cooldownMessage: { label: 'PVE 冷却提示', description: '冷却期间展示给玩家的提示文案。' }
    }
  },
  {
    section: 'pve',
    prefix: 'profiles.v1.secretRealm.baseStats.',
    map: {
      maxHp: { label: '敌方生命基线', description: '秘境敌人的基础生命值。' },
      physicalAttack: { label: '敌方物攻基线', description: '秘境敌人的物理攻击力基线。' },
      magicAttack: { label: '敌方法攻基线', description: '秘境敌人的魔法攻击力基线。' },
      physicalDefense: { label: '敌方物防基线', description: '秘境敌人的物理防御。' },
      magicDefense: { label: '敌方魔防基线', description: '秘境敌人的魔法防御。' },
      speed: { label: '敌方速度', description: '秘境敌人的速度基线。' },
      accuracy: { label: '敌方命中', description: '秘境敌人的命中基线。' },
      dodge: { label: '敌方闪避', description: '秘境敌人的闪避基线。' },
      critRate: { label: '敌方暴击率', description: '秘境敌人的暴击概率。' },
      critDamage: { label: '敌方暴击伤害', description: '秘境敌人的暴击伤害倍率。' },
      finalDamageBonus: { label: '敌方终伤加成', description: '秘境敌人的终伤增益。' },
      finalDamageReduction: { label: '敌方终伤减免', description: '秘境敌人的终伤减免。' },
      lifeSteal: { label: '敌方吸血', description: '秘境敌人的吸血比例。' },
      controlHit: { label: '敌方控制命中', description: '秘境敌人的控制命中基线。' },
      controlResist: { label: '敌方控制抗性', description: '秘境敌人的控制抗性基线。' },
      physicalPenetration: { label: '敌方物穿', description: '秘境敌人的物理穿透。' },
      magicPenetration: { label: '敌方法穿', description: '秘境敌人的魔法穿透。' }
    }
  },
  {
    section: 'pve',
    prefix: 'profiles.v1.secretRealm.tuning.',
    map: {
      baseMultiplier: { label: '楼层基础倍率', description: '秘境楼层数值的起始乘数。' },
      floorGrowth: { label: '每层递增倍率', description: '每层增加的综合系数。' },
      realmGrowth: { label: '每章递增倍率', description: '每个秘境章节额外增幅。' },
      'normal.base': { label: '普通怪基础倍率', description: '普通怪在非克制下的基准倍率。' },
      'normal.primary': { label: '普通怪主属性倍率', description: '普通怪主属性的强化倍率。' },
      'normal.secondary': { label: '普通怪副属性倍率', description: '普通怪副属性的加成。' },
      'normal.off': { label: '普通怪非针对倍率', description: '普通怪在非克制关系下的倍率。' },
      'normal.weak': { label: '普通怪被克制衰减', description: '普通怪被克制时的衰减倍率。' },
      'boss.base': { label: '首领基础倍率', description: '首领敌人的基础倍率。' },
      'boss.primary': { label: '首领主属性倍率', description: '首领主属性加成。' },
      'boss.secondary': { label: '首领副属性倍率', description: '首领副属性加成。' },
      'boss.tertiary': { label: '首领次要属性倍率', description: '首领次要属性加成。' },
      'boss.off': { label: '首领非针对倍率', description: '首领在非克制时的倍率。' },
      'boss.weak': { label: '首领被克制衰减', description: '首领被克制时的衰减倍率。' },
      'special.base': { label: '特殊怪基础倍率', description: '特殊怪初始加成。' },
      'special.growth': { label: '特殊怪每层增幅', description: '特殊怪随楼层提升的增幅。' },
      'special.boss': { label: '特殊首领额外倍率', description: '特殊首领额外提升系数。' },
      'limits.critRate': { label: '暴击率上限', description: '秘境敌人暴击率封顶。' },
      'limits.critDamage': { label: '暴击伤害上限', description: '秘境敌人暴击伤害封顶。' },
      'limits.finalDamageBonus': { label: '终伤加成上限', description: '秘境敌人终伤增益上限。' },
      'limits.finalDamageReduction': { label: '终伤减免上限', description: '秘境敌人终伤减免上限。' },
      'limits.lifeSteal': { label: '吸血上限', description: '秘境敌人吸血比例上限。' },
      'limits.accuracy': { label: '命中属性上限', description: '秘境敌人命中数值上限。' },
      'limits.dodge': { label: '闪避属性上限', description: '秘境敌人闪避数值上限。' }
    }
  },
  {
    section: 'pve',
    prefix: 'profiles.v2.',
    map: {
      roundLimit: { label: 'V2 PVE 最大回合数', description: 'v2 调整后的 PVE 回合上限。' },
      'secretRealm.tuning.normal.primary': { label: 'V2 普通怪主属性倍率', description: 'v2 下调的普通怪主属性倍率。' },
      'secretRealm.tuning.limits.finalDamageReduction': { label: 'V2 终伤减免上限', description: 'v2 调整后的终伤减免上限。' }
    }
  },
  {
    section: 'pvp',
    prefix: 'profiles.v1.',
    map: {
      roundLimit: { label: 'PVP 最大回合数', description: 'PVP 战斗的最大回合数。' },
      cooldownMs: { label: '匹配冷却时间(毫秒)', description: '同一玩家发起战斗的冷却时间。' },
      cooldownMessage: { label: '冷却提示文案', description: '冷却期间显示的提示。' },
      seasonLengthDays: { label: '赛季时长(天)', description: '赛季重置周期。' },
      leaderboardCacheSize: { label: '排行榜缓存上限', description: '排行榜缓存条数上限。' },
      leaderboardSchemaVersion: { label: '排行榜数据版本', description: '排行榜数据结构版本号。' },
      recentMatchLimit: { label: '最近对局保留数', description: '用于匹配冷却或展示的记录数。' },
      defaultRating: { label: '新玩家初始分', description: '新手 Elo/天梯起始分。' },
      tiers: { label: '段位区间列表', description: '从青铜到宗师的分数范围定义。' },
      'tierRewards.bronze.stones': { label: '青铜奖励-货币', description: '青铜段位的奖励货币数量。' },
      'tierRewards.bronze.title': { label: '青铜奖励-称号', description: '青铜段位称号。' },
      'tierRewards.bronze.coupon': { label: '青铜奖励-优惠券', description: '青铜段位券 ID（可为空）。' },
      'tierRewards.silver.stones': { label: '白银奖励-货币', description: '白银段位奖励货币。' },
      'tierRewards.silver.title': { label: '白银奖励-称号', description: '白银段位称号。' },
      'tierRewards.silver.coupon': { label: '白银奖励-优惠券', description: '白银段位券 ID。' },
      'tierRewards.gold.stones': { label: '黄金奖励-货币', description: '黄金段位奖励货币。' },
      'tierRewards.gold.title': { label: '黄金奖励-称号', description: '黄金段位称号。' },
      'tierRewards.gold.coupon': { label: '黄金奖励-优惠券', description: '黄金段位券 ID。' },
      'tierRewards.platinum.stones': { label: '白金奖励-货币', description: '白金段位奖励货币。' },
      'tierRewards.platinum.title': { label: '白金奖励-称号', description: '白金段位称号。' },
      'tierRewards.platinum.coupon': { label: '白金奖励-优惠券', description: '白金段位券 ID。' },
      'tierRewards.diamond.stones': { label: '钻石奖励-货币', description: '钻石段位奖励货币。' },
      'tierRewards.diamond.title': { label: '钻石奖励-称号', description: '钻石段位称号。' },
      'tierRewards.diamond.coupon': { label: '钻石奖励-优惠券', description: '钻石段位券 ID。' },
      'tierRewards.master.stones': { label: '宗师奖励-货币', description: '宗师段位奖励货币。' },
      'tierRewards.master.title': { label: '宗师奖励-称号', description: '宗师段位称号。' },
      'tierRewards.master.coupon': { label: '宗师奖励-优惠券', description: '宗师段位券 ID。' }
    }
  },
  {
    section: 'pvp',
    prefix: 'profiles.v2.',
    map: {
      roundLimit: { label: 'V2 PVP 最大回合数', description: 'v2 调整后的 PVP 回合上限。' }
    }
  }
];

const FIELD_FALLBACKS = {
  version: { label: '配置版本', description: '用于选择当前生效的数值版本。' }
};

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  const segments = path.split('.');
  let current = obj;
  for (let i = 0; i < segments.length; i += 1) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[segments[i]];
  }
  return current;
}

function setValueByPath(obj, path, value) {
  const segments = path.split('.');
  let target = obj;
  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (i === segments.length - 1) {
      target[key] = value;
      return;
    }
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target[key] = { ...target[key] };
    Object.setPrototypeOf(target[key], Object.prototype);
    target = target[key];
  }
}

function flattenConfig(source = {}, prefix = '') {
  const fields = [];
  const walk = (value, path) => {
    const currentPath = path;
    if (Array.isArray(value)) {
      const slotFieldPaths = ['profiles.v1.slots', 'profiles.v2.slots'];
      const tierFieldPaths = ['profiles.v1.tiers'];
      const isSlotField = slotFieldPaths.includes(currentPath);
      const isTierField = tierFieldPaths.includes(currentPath);
      fields.push({
        path: currentPath,
        type: isSlotField ? 'slots' : isTierField ? 'tiers' : 'json',
        defaultValue: value
      });
      return;
    }
    if (typeof value === 'boolean') {
      fields.push({ path: currentPath, type: 'boolean', defaultValue: value });
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => {
        walk(value[key], currentPath ? `${currentPath}.${key}` : key);
      });
      return;
    }
    fields.push({
      path: currentPath,
      type: typeof value === 'number' ? 'number' : 'text',
      defaultValue: value
    });
  };
  walk(source, prefix);
  return fields;
}

function toSlotItems(list = []) {
  const values = Array.isArray(list) ? list : [];
  return values.map((value, index) => ({
    value,
    label: SLOT_LABEL_MAP[value] || `槽位 ${index + 1}`,
    hint: SLOT_LABEL_MAP[value] ? `键名：${value}` : '自定义槽位键'
  }));
}

function normalizeTiers(list = []) {
  const unwrapValue = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      if ('value' in value) return value.value;
      if ('current' in value) return value.current;
      return '';
    }
    return value;
  };

  const normalizeNumber = (value) => {
    if (value === 'Infinity') return Infinity;
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  };

  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const id = unwrapValue(item && item.id);
    const name = unwrapValue(item && item.name);
    const min = normalizeNumber(unwrapValue(item && item.min));
    const max = normalizeNumber(unwrapValue(item && item.max));
    const color = unwrapValue(item && item.color);
    const rewardKey = unwrapValue(item && item.rewardKey);
    return {
      id: id || '',
      name: name || '',
      min: min === undefined ? '' : min,
      max: max === undefined ? '' : max,
      color: color || '',
      rewardKey: rewardKey || ''
    };
  });
}

function toTierItems(list = []) {
  const normalized = normalizeTiers(list);
  return normalized.map((tier, index) => {
    const title = tier.name || TIER_TITLE_MAP[tier.id] || `段位 ${index + 1}`;
    return {
      ...tier,
      title,
      key: tier.id || `tier_${index + 1}`
    };
  });
}

function resolveFieldMeta(sectionKey, path) {
  const directKey = `${sectionKey}.${path}`;
  if (FIELD_FALLBACKS[directKey]) return FIELD_FALLBACKS[directKey];
  if (FIELD_FALLBACKS[path]) return FIELD_FALLBACKS[path];
  const group = FIELD_GROUP_META.find((item) => item.section === sectionKey && path.startsWith(item.prefix));
  if (group) {
    const suffix = path.replace(group.prefix, '');
    if (group.map[suffix]) return group.map[suffix];
  }
  return { label: '自定义字段', description: '请根据需要填写。' };
}

function parseVersionedPath(path = '') {
  const match = path.match(/^(.*)\.v(\d+)\.(.+)$/);
  if (!match) return { basePath: path, version: null };
  return { basePath: `${match[1]}.${match[3]}`, version: Number(match[2]) };
}

function buildSections(defaults = {}, staging = {}, versions = {}) {
  return Object.keys(SECTION_LABELS).map((key) => {
    const base = defaults[key] || {};
    const fields = flattenConfig(base);
    const latestByPath = {};
    fields.forEach((field) => {
      const version = (versions[key] && versions[key][field.path]) || parseVersionedPath(field.path).version;
      const basePath = parseVersionedPath(field.path).basePath || field.path;
      const current = latestByPath[basePath];
      if (!current || (Number.isFinite(version) && version > (current.version || 0))) {
        latestByPath[basePath] = { field, version: Number.isFinite(version) ? version : null };
      }
    });
    const dedupedFields = Object.values(latestByPath).map(({ field, version }) => {
      const defaultText = (() => {
        if (field.type === 'slots') {
          const defaults = Array.isArray(field.defaultValue) ? field.defaultValue : [];
          return defaults.length
            ? defaults.map((item) => SLOT_LABEL_MAP[item] || item).join('、')
            : '无';
        }
        if (field.type === 'tiers') {
          const defaults = Array.isArray(field.defaultValue) ? field.defaultValue : [];
          return defaults.length
            ? defaults
                .map((item) => {
                  const name = item.name || TIER_TITLE_MAP[item.id] || '段位';
                  const min = item.min ?? '无';
                  const max = item.max === Infinity ? 'Infinity' : item.max ?? '无';
                  return `${name}(${min}-${max})`;
                })
                .join('、')
            : '无';
        }
        if (field.defaultValue === undefined) return '无';
        if (typeof field.defaultValue === 'object') return JSON.stringify(field.defaultValue);
        return field.defaultValue;
      })();
      const versionHint = Number.isFinite(version) ? ` 当前版本:v${version}` : '';
      const currentValue = getValueByPath(staging[key] || {}, field.path);
      const slotValue =
        field.type === 'slots'
          ? (() => {
              if (Array.isArray(currentValue)) return currentValue;
              if (Array.isArray(field.defaultValue)) return field.defaultValue;
              return [];
            })()
          : currentValue;
      const tierValue =
        field.type === 'tiers'
          ? (() => {
              if (Array.isArray(currentValue)) return normalizeTiers(currentValue);
              if (Array.isArray(field.defaultValue)) return normalizeTiers(field.defaultValue);
              return [];
            })()
          : currentValue;
      return {
        ...field,
        ...resolveFieldMeta(key, field.path),
        defaultHint: `默认值：${defaultText}${versionHint}`,
        value: field.type === 'slots' ? slotValue : field.type === 'tiers' ? tierValue : currentValue,
        displayValue:
          field.type === 'json'
            ? (() => {
                const current = currentValue;
                if (!current) return '';
                try {
                  return JSON.stringify(current, null, 2);
                } catch (error) {
                  return '';
                }
              })()
            : undefined,
        items:
          field.type === 'slots'
            ? toSlotItems(slotValue)
            : field.type === 'tiers'
            ? toTierItems(tierValue)
            : undefined
      };
    });
      return {
        key,
        title: SECTION_LABELS[key] || key,
        fields: dedupedFields
      };
    });
}

Page({
  data: {
    loading: true,
    saving: false,
    testing: false,
    applying: false,
    sections: [],
    activeTab: '',
    stagingConfig: {},
    activeConfig: {},
    defaults: {},
    activeMetadata: {},
    stagingMetadata: {},
    fieldVersions: {},
    baselineConfig: {},
    testReport: null,
    testRounds: 12,
    tierFieldMeta: TIER_FIELD_META
  },

  onLoad() {
    this.loadConfig();
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const result = await AdminService.getBalanceConfig();
      const defaults = result && result.defaults ? result.defaults : {};
      const stagingConfig = (result && result.staging && result.staging.config) || defaults;
      const fieldVersions = (result && result.staging && result.staging.metadata && result.staging.metadata.fieldVersions) || {};
      const sections = buildSections(defaults, stagingConfig, fieldVersions);
      const activeTab = this.data.activeTab || (sections[0] && sections[0].key) || '';
      this.setData({
        sections,
        activeTab,
        defaults,
        stagingConfig,
        baselineConfig: stagingConfig,
        fieldVersions,
        activeConfig: (result && result.active && result.active.config) || defaults,
        activeMetadata: (result && result.active && result.active.metadata) || {},
        stagingMetadata: (result && result.staging && result.staging.metadata) || {},
        loading: false
      });
    } catch (error) {
      console.error('load balance config failed', error);
      wx.showToast({ title: '加载配置失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  handleRoundsChange(event) {
    const value = Number(event.detail.value);
    this.setData({ testRounds: Number.isFinite(value) ? value : this.data.testRounds });
  },

  handleFieldChange(event) {
    const { section, path, type } = event.currentTarget.dataset;
    const rawValue = event.detail.value;
    const nextConfig = clone(this.data.stagingConfig || {});
    const sectionConfig = clone(nextConfig[section] || {});
    let value = rawValue;
    if (type === 'number') {
      const numeric = Number(rawValue);
      value = Number.isFinite(numeric) ? numeric : rawValue;
    } else if (type === 'boolean') {
      value = !!rawValue;
    } else if (type === 'json') {
      try {
        value = rawValue ? JSON.parse(rawValue) : {};
      } catch (error) {
        wx.showToast({ title: 'JSON 解析失败', icon: 'none' });
        return;
      }
    }
    setValueByPath(sectionConfig, path, value);
    nextConfig[section] = sectionConfig;
    const sections = this.data.sections.map((item) => {
      if (item.key !== section) return item;
      return {
        ...item,
        fields: item.fields.map((field) =>
          field.path === path
            ? {
                ...field,
                value: type === 'json' ? value : value,
                displayValue: type === 'json' ? rawValue : field.displayValue
              }
            : field
        )
      };
    });
    this.setData({ stagingConfig: nextConfig, sections });
  },

  updateSlotsField(section, path, updater) {
    const nextConfig = clone(this.data.stagingConfig || {});
    const sectionConfig = clone(nextConfig[section] || {});
    const current = getValueByPath(sectionConfig, path);
    const nextSlots = updater(Array.isArray(current) ? [...current] : []);
    setValueByPath(sectionConfig, path, nextSlots);
    nextConfig[section] = sectionConfig;
    const sections = this.data.sections.map((item) => {
      if (item.key !== section) return item;
      return {
        ...item,
        fields: item.fields.map((field) =>
          field.path === path ? { ...field, value: nextSlots, items: toSlotItems(nextSlots) } : field
        )
      };
    });
    this.setData({ stagingConfig: nextConfig, sections });
  },

  updateTiersField(section, path, updater) {
    const nextConfig = clone(this.data.stagingConfig || {});
    const sectionConfig = clone(nextConfig[section] || {});
    const current = getValueByPath(sectionConfig, path);
    const nextTiers = updater(Array.isArray(current) ? [...current] : []);
    setValueByPath(sectionConfig, path, nextTiers);
    nextConfig[section] = sectionConfig;
    const sections = this.data.sections.map((item) => {
      if (item.key !== section) return item;
      return {
        ...item,
        fields: item.fields.map((field) =>
          field.path === path ? { ...field, value: nextTiers, items: toTierItems(nextTiers) } : field
        )
      };
    });
    this.setData({ stagingConfig: nextConfig, sections });
  },

  handleSlotValueChange(event) {
    const { section, path } = event.currentTarget.dataset;
    const index = Number(event.currentTarget.dataset.index);
    const value = (event.detail.value || '').trim();
    this.updateSlotsField(section, path, (slots) => {
      const next = [...slots];
      next[index] = value;
      return next;
    });
  },

  handleSlotRemove(event) {
    const { section, path } = event.currentTarget.dataset;
    const index = Number(event.currentTarget.dataset.index);
    this.updateSlotsField(section, path, (slots) => slots.filter((_, idx) => idx !== index));
  },

  handleSlotAdd(event) {
    const { section, path } = event.currentTarget.dataset;
    this.updateSlotsField(section, path, (slots) => [...slots, '']);
  },

  handleTierFieldChange(event) {
    const { section, path, key } = event.currentTarget.dataset;
    const index = Number(event.currentTarget.dataset.index);
    const rawValue = event.detail.value;
    const value = key === 'min' || key === 'max' ? Number(rawValue) : rawValue;
    this.updateTiersField(section, path, (tiers) => {
      const next = normalizeTiers(tiers);
      if (!next[index]) next[index] = { id: '', name: '', min: '', max: '', color: '', rewardKey: '' };
      if (key === 'max' && rawValue && rawValue.trim().toLowerCase() === 'infinity') {
        next[index][key] = Infinity;
      } else if (key === 'min' || key === 'max') {
        next[index][key] = Number.isNaN(value) ? '' : value;
      } else {
        next[index][key] = rawValue;
      }
      return next;
    });
  },

  handleTierRemove(event) {
    const { section, path } = event.currentTarget.dataset;
    const index = Number(event.currentTarget.dataset.index);
    this.updateTiersField(section, path, (tiers) => normalizeTiers(tiers).filter((_, idx) => idx !== index));
  },

  handleTierAdd(event) {
    const { section, path } = event.currentTarget.dataset;
    const nextTier = { id: '', name: '', min: 0, max: Infinity, color: '', rewardKey: '' };
    this.updateTiersField(section, path, (tiers) => [...normalizeTiers(tiers), nextTier]);
  },

  handleTabChange(event) {
    const { key } = event.currentTarget.dataset;
    if (!key || key === this.data.activeTab) return;
    this.setData({ activeTab: key });
  },

  computeNextVersions() {
    const flattenValues = (obj = {}, prefix = '') => {
      const result = {};
      const walk = (value, path) => {
        if (Array.isArray(value) || typeof value !== 'object' || value === null) {
          result[path] = value;
          return;
        }
        Object.keys(value).forEach((key) => {
          const nextPath = path ? `${path}.${key}` : key;
          walk(value[key], nextPath);
        });
      };
      walk(obj, prefix);
      return result;
    };

    const currentFlat = flattenValues(this.data.stagingConfig || {});
    const baselineFlat = flattenValues(this.data.baselineConfig || {});
    const nextVersions = clone(this.data.fieldVersions || {});

    Object.keys(currentFlat).forEach((fullPath) => {
      const baseValue = baselineFlat[fullPath];
      const currentValue = currentFlat[fullPath];
      const changed = JSON.stringify(baseValue) !== JSON.stringify(currentValue);
      const [section, ...rest] = fullPath.split('.');
      const path = rest.join('.');
      if (!section || !path) return;
      if (changed) {
        const sectionVersions = nextVersions[section] || {};
        sectionVersions[path] = (sectionVersions[path] || 0) + 1;
        nextVersions[section] = sectionVersions;
      }
    });

    return nextVersions;
  },

  async handleSaveDraft() {
    this.setData({ saving: true });
    try {
      const nextVersions = this.computeNextVersions();
      const response = await AdminService.saveBalanceDraft({
        config: this.data.stagingConfig || {},
        fieldVersions: nextVersions
      });
      wx.showToast({ title: '已暂存', icon: 'success' });
      const stagingMetadata = {
        updatedBy: response.staging && response.staging.updatedBy,
        updatedByName: response.staging && response.staging.updatedByName,
        updatedAt: new Date(),
        fieldVersions: nextVersions
      };
      const sections = buildSections(this.data.defaults, this.data.stagingConfig, nextVersions);
      this.setData({ stagingMetadata, fieldVersions: nextVersions, baselineConfig: this.data.stagingConfig, sections });
    } catch (error) {
      console.error('save balance draft failed', error);
      wx.showToast({ title: error.message || '暂存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async handleTestDraft() {
    this.setData({ testing: true, testReport: null });
    try {
      const report = await AdminService.testBalanceDraft({ rounds: this.data.testRounds });
      const seedText = report && Array.isArray(report.seeds) ? report.seeds.join(', ') : '';
      this.setData({ testReport: { ...report, seedText } });
    } catch (error) {
      console.error('test balance draft failed', error);
      wx.showToast({ title: error.message || '测试失败', icon: 'none' });
    } finally {
      this.setData({ testing: false });
    }
  },

  async handleApplyGlobal() {
    wx.showModal({
      title: '应用到全局',
      content: '确定将暂存的平衡性配置应用到全局吗？',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ applying: true });
        try {
          await AdminService.applyBalanceConfig();
          wx.showToast({ title: '已应用到全局', icon: 'success' });
          this.loadConfig();
        } catch (error) {
          console.error('apply balance config failed', error);
          wx.showToast({ title: error.message || '应用失败', icon: 'none' });
        } finally {
          this.setData({ applying: false });
        }
      }
    });
  }
});
