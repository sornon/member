const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { COLLECTIONS, buildCloudAssetUrl, realmConfigs } = require('common-config');

const DEFAULT_LIMIT = 100;
const BHK_BARGAIN_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';
const BHK_BARGAIN_COLLECTION = 'bhkBargainRecords';
const BHK_BARGAIN_STOCK_COLLECTION = 'bhkBargainStock';
const THANKSGIVING_RIGHT_ID = 'thanksgiving-pass';
const THANKSGIVING_TICKET_REMARK = '感恩节活动门票';
const DEFAULT_AVATAR = buildCloudAssetUrl('avatar', 'default.png');
const ENCOURAGEMENTS = [
  '好友助力价格还能更低，赶紧喊上小伙伴！',
  '邀请好友帮砍，惊爆价就在前面！',
  '继续分享，越多人助力越容易砍到底！',
  '呼朋唤友来助力，价格还能再低！',
  '好友助力价格还能更低，快去求助一下吧~'
];
const REALM_BONUS_RULES = [
  { thresholdRealmOrder: 1, bonusAttempts: 1, label: '炼气奖励 +1' },
  { thresholdRealmOrder: 2, bonusAttempts: 4, label: '筑基奖励 +4' },
  { thresholdRealmOrder: 3, bonusAttempts: 4, label: '结丹奖励 +4' }
];
const DIVINE_HAND_THRESHOLD = 3; // 结丹及以上

function normalizeTitleId(id) {
  if (typeof id !== 'string') {
    return '';
  }
  return id.trim();
}

async function ensureCollectionExists(name) {
  if (!name) return;
  try {
    if (typeof db.createCollection === 'function') {
      await db.createCollection(name);
    }
  } catch (err) {
    const code = (err && (err.errCode || err.code || '')) || '';
    const message = (err && err.message) || '';
    const codeStr = code.toString();
    const msgStr = message.toString();
    const alreadyExists =
      codeStr === '-501001' ||
      codeStr.includes('ResourceExists') ||
      codeStr.includes('ResourceExist') ||
      msgStr.includes('ResourceExists') ||
      msgStr.includes('ResourceExist') ||
      msgStr.toLowerCase().includes('already exist');
    if (!alreadyExists) {
      console.error(`createCollection ${name} failed:`, err);
      throw err;
    }
  }
}

function getOpenId() {
  const context = (typeof cloud.getWXContext === 'function' && cloud.getWXContext()) || {};
  return context.OPENID || context.openId || '';
}

exports.main = async (event = {}) => {
  const action = typeof event.action === 'string' ? event.action.trim() : 'list';

  switch (action) {
    case 'list':
    case 'publicList':
      return listPublicActivities(event || {});
    case 'detail':
      return getActivityDetail(event || {});
    case 'bargainStatus':
      return getBhkBargainStatus(event || {});
    case 'bargainSpin':
      return spinBhkBargain(event || {});
    case 'bargainAssist':
      return assistBhkBargain(event || {});
    case 'bargainDivineHand':
      return divineHandBhkBargain(event || {});
    case 'bargainConfirmPurchase':
      return confirmBhkBargainPurchase(event || {});
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

if (process.env.NODE_ENV === 'test') {
  module.exports._test = {
    applyRealmBoostUpgrade,
    buildRealmRewardState,
    hasRealmBoostUpgrade,
    resolveRealmBonus,
    normalizeBargainSession
  };
}

function normalizeLimit(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.floor(value)));
}

function toIsoString(value) {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    try {
      return value.toISOString();
    } catch (error) {
      return '';
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return trimmed;
    }
    return parsed.toISOString();
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString();
  }
  return '';
}

function normalizeStringArray(source) {
  if (Array.isArray(source)) {
    return source
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof source === 'string') {
    return source
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function buildBhkBargainActivity() {
  return {
    _id: BHK_BARGAIN_ACTIVITY_ID,
    title: '感恩节 · BHK56 品鉴会',
    tagline: '珍稀雪茄 15 席限量，感恩节回馈到店酒友',
    status: 'published',
    startTime: '2025-11-27T11:00:00.000Z',
    endTime: '2025-12-01T16:00:00.000Z',
    priceLabel: '¥3500 起 / 15 席',
    location: '北京市朝阳区百子湾路16号4号楼B座102',
    locationName: '酒隐之茄',
    locationAddress: '北京市朝阳区百子湾路16号4号楼B座102',
    locationLat: 39.9003,
    locationLng: 116.4837,
    coverImage: buildCloudAssetUrl('background', 'cover-20251126.jpg'),
    highlight: 'Cohiba BHK56 珍品雪茄 + 品鉴会入场 + 畅饮调酒',
    tags: ['BHK56', '感恩节', '限量品鉴'],
    perks: [
      '伴手礼含 Cohiba Behike 56 雪茄一支（市场价约 ¥3500）',
      '高端雪茄吧包场氛围，专属品鉴席位仅 15 席',
      '到店签到即享软饮畅饮权益'
    ],
    notes:
      '本活动仅限 18 岁以上会员到店参与，门票不可转售或退款；售罄即止。如遇不可抗力主办方保留变更活动时间的权利。'
  };
}

function buildRealmBonusConfig() {
  return REALM_BONUS_RULES;
}

function buildBhkBargainConfig() {
  return {
    startPrice: 3500,
    floorPrice: 998,
    baseAttempts: 3,
    vipBonuses: buildRealmBonusConfig(),
    segments: [120, 180, 200, 260, 320, 500, 0],
    assistRewardRange: { min: 60, max: 180 },
    assistAttemptCap: null,
    stock: 15,
    endsAt: '2025-12-01T16:00:00.000Z',
    heroImage: buildCloudAssetUrl('background', 'cover-20251126.jpg'),
    mysteryLabel: '???',
    perks: [
        '基础砍价：3次',
        '炼气期：+1次砍价',
        '筑基期：+3次砍价',
        '结丹及以上：神之一手',
        '分享助力：双方+1次砍价',
        '设置名字、头像：+1次砍价'
    ]
  };
}

async function ensureBargainStockDoc(config = {}) {
  await ensureCollectionExists(BHK_BARGAIN_STOCK_COLLECTION);
  const stockRef = db.collection(BHK_BARGAIN_STOCK_COLLECTION).doc(BHK_BARGAIN_ACTIVITY_ID);
  const snapshot = await stockRef.get().catch(() => null);
  if (snapshot && snapshot.data) {
    return snapshot.data;
  }

  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const doc = {
    totalStock: config.stock,
    stockRemaining: config.stock,
    sold: 0,
    updatedAt: now
  };

  await stockRef.set({ data: doc });

  const written = await stockRef.get().catch(() => null);
  if (written && written.data) {
    return written.data;
  }

  throw new Error('库存初始化失败，请稍后重试');
}

async function getBargainStock(config = {}) {
  const doc = await ensureBargainStockDoc(config);
  const totalStock = Number.isFinite(doc.totalStock) ? doc.totalStock : config.stock;
  const stockRemaining = Number.isFinite(doc.stockRemaining) ? doc.stockRemaining : config.stock;
  return { totalStock, stockRemaining };
}

async function hasThanksgivingPass(memberId) {
  if (!memberId) {
    return false;
  }
  await ensureCollectionExists(COLLECTIONS.MEMBER_RIGHTS);
  const rights = await db
    .collection(COLLECTIONS.MEMBER_RIGHTS)
    .where({ memberId, rightId: THANKSGIVING_RIGHT_ID, status: _.neq('revoked') })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));

  return Array.isArray(rights.data) && rights.data.length > 0;
}

function decorateActivity(doc = {}) {
  const perks = normalizeStringArray(doc.perks);
  return {
    id: doc._id || '',
    title: typeof doc.title === 'string' ? doc.title : '',
    tagline: typeof doc.tagline === 'string' ? doc.tagline : '',
    status: doc.status || 'draft',
    startTime: toIsoString(doc.startTime),
    endTime: toIsoString(doc.endTime),
    priceLabel: typeof doc.priceLabel === 'string' ? doc.priceLabel : '',
    location: typeof doc.location === 'string' ? doc.location : '',
    locationName: typeof doc.locationName === 'string' ? doc.locationName : '',
    locationAddress: typeof doc.locationAddress === 'string' ? doc.locationAddress : '',
    locationLat: Number.isFinite(doc.locationLat) ? Number(doc.locationLat) : null,
    locationLng: Number.isFinite(doc.locationLng) ? Number(doc.locationLng) : null,
    coverImage: typeof doc.coverImage === 'string' ? doc.coverImage : '',
    perks,
    notes: typeof doc.notes === 'string' ? doc.notes : '',
    sortOrder: Number.isFinite(doc.sortOrder) ? doc.sortOrder : Number(doc.sortOrder) || 0,
    createdAt: toIsoString(doc.createdAt),
    updatedAt: toIsoString(doc.updatedAt),
    highlight: typeof doc.highlight === 'string' ? doc.highlight : '',
    tags: normalizeStringArray(doc.tags),
    summary: typeof doc.summary === 'string' ? doc.summary : ''
  };
}

function resolveTimelineBucket(activity, now = Date.now()) {
  const start = Date.parse(activity.startTime || '');
  const end = Date.parse(activity.endTime || '');

  if (Number.isFinite(end) && end < now) {
    return 2; // ended
  }
  if (Number.isFinite(start) && start > now) {
    return 1; // upcoming
  }
  return 0; // ongoing / timeless
}

function compareDateValue(a, b) {
  const timeA = Date.parse(a || '');
  const timeB = Date.parse(b || '');

  const validA = Number.isFinite(timeA);
  const validB = Number.isFinite(timeB);

  if (validA && validB) {
    return timeA - timeB;
  }
  if (validA) {
    return -1;
  }
  if (validB) {
    return 1;
  }
  return 0;
}

async function listPublicActivities(options = {}) {
  const limit = normalizeLimit(options.limit);
  const now = Date.now();
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const snapshot = await collection
    .where({ status: 'published' })
    .orderBy('sortOrder', 'desc')
    .orderBy('startTime', 'asc')
    .limit(limit)
    .get()
    .catch((error) => {
      if (error && /not exist|not found/i.test(error.errMsg || '')) {
        return { data: [] };
      }
      throw error;
    });

  const decorated = (snapshot.data || []).map((item) => decorateActivity(item));

  if (!decorated.find((item) => item && item.id === BHK_BARGAIN_ACTIVITY_ID)) {
    const bhk = decorateActivity(buildBhkBargainActivity());
    if (bhk) {
      decorated.push({ ...bhk, sortOrder: Number.MAX_SAFE_INTEGER });
    }
  }

  const sorted = decorated.sort((a, b) => {
    const bucketDiff = resolveTimelineBucket(a, now) - resolveTimelineBucket(b, now);
    if (bucketDiff !== 0) {
      return bucketDiff;
    }
    if (Number.isFinite(b.sortOrder) && Number.isFinite(a.sortOrder) && b.sortOrder !== a.sortOrder) {
      return b.sortOrder - a.sortOrder;
    }
    const startDiff = compareDateValue(a.startTime, b.startTime);
    if (startDiff !== 0) {
      return startDiff;
    }
    return compareDateValue(a.endTime, b.endTime);
  });

  return {
    activities: sorted.map(({ sortOrder, ...rest }) => rest)
  };
}

async function getActivityDetail(options = {}) {
  const id = typeof options.id === 'string' ? options.id.trim() : '';
  if (!id) {
    throw new Error('缺少活动编号');
  }
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const doc = await collection
    .doc(id)
    .get()
    .then((res) => res && res.data)
    .catch((error) => {
      if (error && /not exist|not found/i.test(error.errMsg || '')) {
        return null;
      }
      throw error;
    });

  if (!doc || doc.status !== 'published') {
    if (id === BHK_BARGAIN_ACTIVITY_ID) {
      return {
        activity: decorateActivity(buildBhkBargainActivity()),
        bargainConfig: buildBhkBargainConfig()
      };
    }
    throw new Error('活动不存在或已下架');
  }

  const payload = {
    activity: decorateActivity(doc)
  };

  if (id === BHK_BARGAIN_ACTIVITY_ID) {
    payload.bargainConfig = buildBhkBargainConfig();
  }

  return payload;
}

function resolveRealmOrder(level = {}) {
  if (!level || typeof level !== 'object') {
    return 0;
  }

  const orderKeys = ['realmOrder', 'order'];
  for (const key of orderKeys) {
    const value = Number(level[key]);
    if (Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }

  const realmName = (level.realmName || level.realm || '').trim();
  if (!realmName) {
    return 0;
  }

  const normalizedRealmName = realmName.toLowerCase();
  const matched = (realmConfigs || []).find((realm) => {
    const candidates = [realm.realmName, realm.name, realm.shortName]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    return candidates.some((value) => value === normalizedRealmName || normalizedRealmName.includes(value));
  });

  if (matched && Number.isFinite(matched.realmOrder)) {
    return Math.max(0, Math.floor(matched.realmOrder));
  }

  const fallbackIndex = (realmConfigs || []).findIndex((realm) => realm.shortName === realmName);
  if (fallbackIndex >= 0) {
    return fallbackIndex + 1;
  }

  return 0;
}

function resolveMemberRealm(member = {}) {
  if (!member || typeof member !== 'object') {
    return '';
  }
  return (
    member.realmName ||
    member.realm ||
    (member.level && (member.level.realmName || member.level.realm)) ||
    ''
  );
}

function pickEncouragement() {
  if (!Array.isArray(ENCOURAGEMENTS) || !ENCOURAGEMENTS.length) {
    return '好友助力价格还能更低，快去求助一下吧~';
  }
  const index = Math.floor(Math.random() * ENCOURAGEMENTS.length);
  return ENCOURAGEMENTS[index] || ENCOURAGEMENTS[0];
}

function normalizeSegments(segments = []) {
  if (!Array.isArray(segments) || !segments.length) {
    return [];
  }
  return segments
    .map((value) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) {
        return null;
      }
      return Math.max(0, Math.floor(amount));
    })
    .filter((value) => Number.isFinite(value));
}

function buildDisplaySegments(segments = [], mysteryLabel = '???') {
  const normalized = normalizeSegments(segments);
  const display = normalized.map((amount) => ({ amount, label: `-¥${amount}` }));
  display.push({ amount: null, label: mysteryLabel || '???', isMystery: true });
  return display;
}

function hasCompletedProfile(member = {}) {
  const nickname = (member.nickName || member.nickname || member.name || '').trim();
  const avatar =
    (member.avatarUrl ||
      member.avatar ||
      (member.profile && (member.profile.avatarUrl || member.profile.avatar)) ||
      '')
      .trim();
  const normalizedDefaultAvatar = (DEFAULT_AVATAR || '').split('?')[0];
  const normalizedAvatar = avatar.split('?')[0];
  if (!nickname) {
    return false;
  }
  if (!normalizedAvatar) {
    return false;
  }
  return normalizedAvatar !== normalizedDefaultAvatar;
}

function buildMemberProfile(member = {}, openid = '') {
  const nickname = member.nickName || member.nickname || member.name || '神秘会员';
  const avatar =
    member.avatarUrl || member.avatar || (member.profile && member.profile.avatarUrl) || (member.profile && member.profile.avatar);
  const avatarFrame = member.avatarFrame || (member.profile && member.profile.avatarFrame) || '';
  const titleId =
    normalizeTitleId(member.appearanceTitle || (member.title && (member.title.id || member.title.titleId)) || member.titleId || '');
  const titleName =
    member.titleName ||
    (member.title && (member.title.name || member.title.titleName)) ||
    member.appearanceTitle ||
    (member.title && (member.title.id || member.title.titleId)) ||
    '';

  return {
    openid,
    nickname,
    avatar: avatar || DEFAULT_AVATAR,
    avatarFrame,
    titleId,
    titleName: typeof titleName === 'string' ? titleName : ''
  };
}

function resolveCashBalance(member = {}) {
  if (!member || typeof member !== 'object') {
    return 0;
  }
  if (typeof member.cashBalance === 'number' && Number.isFinite(member.cashBalance)) {
    return member.cashBalance;
  }
  if (typeof member.balance === 'number' && Number.isFinite(member.balance)) {
    return member.balance;
  }
  return 0;
}

function buildMemberSnapshot(member = {}) {
  if (!member || typeof member !== 'object') {
    return {
      nickName: '',
      realName: '',
      mobile: '',
      levelId: ''
    };
  }
  return {
    nickName: typeof member.nickName === 'string' ? member.nickName : '',
    realName: typeof member.realName === 'string' ? member.realName : '',
    mobile: typeof member.mobile === 'string' ? member.mobile : '',
    levelId: typeof member.levelId === 'string' ? member.levelId : ''
  };
}

async function resolveMemberBoost(config = {}, openid = '') {
  let memberBoost = 0;
  let realmName = '';
  const currentOpenId = openid || getOpenId();

  if (!currentOpenId) {
    return { memberBoost, realmName, openid: '' };
  }

  const memberSnapshot = await db.collection(COLLECTIONS.MEMBERS).doc(currentOpenId).get().catch(() => null);
  const member = (memberSnapshot && memberSnapshot.data) || {};
  let memberLevel = member.level || null;
  if ((!memberLevel || !memberLevel.realmName) && member.levelId) {
    const levelSnapshot = await db.collection(COLLECTIONS.LEVELS).doc(member.levelId).get().catch(() => null);
    if (levelSnapshot && levelSnapshot.data) {
      memberLevel = levelSnapshot.data;
    }
  }

  const hydratedMember = memberLevel ? { ...member, level: memberLevel } : member;
  realmName = resolveMemberRealm(hydratedMember) || member.levelName || '';
  const realmOrder = resolveRealmOrder(memberLevel || hydratedMember);

  if (realmOrder > 0) {
    memberBoost = realmOrder;
  }

  return {
    memberBoost,
    realmName,
    openid: currentOpenId,
    profile: buildMemberProfile(hydratedMember, currentOpenId),
    profileComplete: hasCompletedProfile(hydratedMember)
  };
}

function resolveRealmBonus(realmOrder = 0) {
  if (!Number.isFinite(realmOrder) || realmOrder <= 0) {
    return { bonus: 0, label: '' };
  }
  const matched = [...REALM_BONUS_RULES]
    .sort((a, b) => b.thresholdRealmOrder - a.thresholdRealmOrder)
    .find((rule) => realmOrder >= rule.thresholdRealmOrder);
  if (!matched) {
    return { bonus: 0, label: '' };
  }
  return { bonus: matched.bonusAttempts || 0, label: matched.label || '' };
}

function buildRealmRewardState(record = {}) {
  const realmOrder = Number(record.memberBoost) || 0;
  const realmName = (record.memberRealm || '').trim();
  const { bonus, label } = resolveRealmBonus(realmOrder);
  const divineHandUsed = Boolean(record.divineHandUsed);
  const divineHandTotal = Number.isFinite(record.divineHandRemaining)
    ? Math.max(0, record.divineHandRemaining)
    : 0;
  const bonusRemaining = Number.isFinite(record.realmBonusRemaining)
    ? Math.max(0, record.realmBonusRemaining)
    : bonus;

  if (realmOrder >= DIVINE_HAND_THRESHOLD) {
    const remaining = divineHandTotal;
    return {
      type: 'divine',
      label: '神之一手',
      description: '所有奖励用尽后仍可必中神秘奖池，直降至 998 底价',
      total: Math.max(1, divineHandTotal || 1),
      remaining,
      used: divineHandUsed,
      ready: remaining > 0 && !divineHandUsed && (record.remainingSpins || 0) <= 0,
      realmName
    };
  }

  if (bonus > 0) {
    return {
      type: 'boost',
      label: label || `${realmName || '境界'}奖励 +${bonus}`,
      description: '境界额外砍价次数，先用完再触发神之一手',
      total: bonus,
      remaining: bonusRemaining,
      ready: bonusRemaining > 0,
      realmName
    };
  }

  return {
    type: 'none',
    label: realmName ? `${realmName} 奖励` : '境界奖励',
    description: '认证修仙境界即可解锁额外砍价奖励',
    total: 0,
    remaining: 0,
    ready: false,
    realmName
  };
}

function normalizeBargainSession(record = {}, config = {}, overrides = {}, openid = '') {
  const memberId = overrides.memberId || record.memberId || openid || '';
  const normalized = {
    id: record._id || '',
    memberId,
    activityId: record.activityId || BHK_BARGAIN_ACTIVITY_ID,
    currentPrice: Number.isFinite(record.currentPrice) ? record.currentPrice : config.startPrice,
    totalDiscount: Number.isFinite(record.totalDiscount) ? record.totalDiscount : 0,
    remainingSpins: Number.isFinite(record.remainingSpins) ? record.remainingSpins : 0,
    baseSpins: Number.isFinite(record.baseSpins) ? record.baseSpins : config.baseAttempts,
    memberBoost: Number.isFinite(record.memberBoost) ? record.memberBoost : 0,
    assistGiven: Number.isFinite(record.assistGiven) ? record.assistGiven : 0,
    assistSpins: Number.isFinite(record.assistSpins) ? record.assistSpins : 0,
    shareCount: Number.isFinite(record.shareCount) ? record.shareCount : 0,
    helperRecords: Array.isArray(record.helperRecords) ? record.helperRecords : [],
    memberProfile: record.memberProfile || null,
    memberRealm: record.memberRealm || resolveMemberRealm(record.member) || '',
    realmBonusTotal: Number.isFinite(record.realmBonusTotal) ? record.realmBonusTotal : 0,
    realmBonusRemaining: Number.isFinite(record.realmBonusRemaining) ? record.realmBonusRemaining : 0,
    divineHandRemaining: Number.isFinite(record.divineHandRemaining) ? record.divineHandRemaining : 0,
    divineHandUsed: Boolean(record.divineHandUsed),
    remainingDiscount: Math.max(0, (Number.isFinite(record.currentPrice) ? record.currentPrice : config.startPrice) - config.floorPrice),
    lastShareTarget: typeof record.lastShareTarget === 'string' ? record.lastShareTarget : '',
    ticketOwned: Boolean(record.ticketOwned || record.hasTicket || record.purchased),
    purchasedAt: record.purchasedAt || null,
    stockRemaining: Number.isFinite(record.stockRemaining) ? record.stockRemaining : config.stock,
    chargeOrderId: typeof record.thanksgivingChargeOrderId === 'string'
      ? record.thanksgivingChargeOrderId
      : typeof record.chargeOrderId === 'string'
      ? record.chargeOrderId
      : '',
    chargeOrderAmount: Number.isFinite(record.chargeOrderAmount) ? record.chargeOrderAmount : 0,
    chargeOrderCreatedAt: record.chargeOrderCreatedAt || null
    thanksgivingProfileRewarded: Boolean(record.thanksgivingProfileRewarded)
  };

  return { ...normalized, ...overrides };
}

async function ensureThanksgivingChargeOrder(openid, sessionDocId, amountInCents = 0) {
  const normalizedAmount = Math.max(0, Math.round(Number(amountInCents || 0)));
  if (!openid || !sessionDocId || !normalizedAmount) {
    return null;
  }

  const now = new Date();
  let chargeOrderId = '';

  await db.runTransaction(async (transaction) => {
    const sessionRef = transaction.collection(BHK_BARGAIN_COLLECTION).doc(sessionDocId);
    const sessionSnapshot = await sessionRef.get().catch(() => null);
    if (!sessionSnapshot || !sessionSnapshot.data) {
      throw new Error('购票信息不存在');
    }

    const sessionData = sessionSnapshot.data;
    const existingOrderId =
      (typeof sessionData.thanksgivingChargeOrderId === 'string' && sessionData.thanksgivingChargeOrderId) ||
      (typeof sessionData.chargeOrderId === 'string' && sessionData.chargeOrderId) ||
      '';

    if (existingOrderId) {
      chargeOrderId = existingOrderId;
      return;
    }

    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }

    const member = memberDoc.data;
    const memberSnapshot = buildMemberSnapshot(member);
    const balanceBefore = resolveCashBalance(member);
    const balanceAfter = balanceBefore - normalizedAmount;
    const debtIncurred = balanceAfter < 0;
    const walletRemark = THANKSGIVING_TICKET_REMARK;

    const orderPayload = {
      status: 'paid',
      items: [
        {
          name: THANKSGIVING_TICKET_REMARK,
          price: normalizedAmount,
          quantity: 1,
          amount: normalizedAmount,
          isDining: false
        }
      ],
      totalAmount: normalizedAmount,
      stoneReward: normalizedAmount,
      diningAmount: 0,
      createdBy: openid,
      createdAt: now,
      updatedAt: now,
      confirmedAt: now,
      memberId: openid,
      memberSnapshot,
      activityId: BHK_BARGAIN_ACTIVITY_ID,
      source: 'bhk-bargain-thanksgiving',
      remark: walletRemark,
      balanceBefore,
      balanceAfter,
      allowNegativeBalance: debtIncurred,
      debtIncurred
    };

    const orderResult = await transaction.collection(COLLECTIONS.CHARGE_ORDERS).add({ data: orderPayload });
    chargeOrderId = (orderResult && orderResult._id) || '';

    if (!chargeOrderId) {
      throw new Error('订单写入失败，请稍后重试');
    }

    await memberRef.update({
      data: {
        cashBalance: _.inc(-normalizedAmount),
        totalSpend: _.inc(normalizedAmount),
        stoneBalance: _.inc(normalizedAmount),
        updatedAt: now
      }
    });

    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -normalizedAmount,
        type: 'spend',
        status: 'success',
        source: 'chargeOrder',
        orderId: chargeOrderId,
        remark: walletRemark,
        createdAt: now,
        updatedAt: now,
        balanceBefore,
        balanceAfter,
        allowNegativeBalance: debtIncurred,
        debtIncurred,
        spendExperienceFixed: true,
        spendExperienceFixedAt: now,
        spendExperienceFixedBy: openid
      }
    });

    await transaction.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: normalizedAmount,
        type: 'earn',
        source: 'chargeOrder',
        description: walletRemark,
        createdAt: now,
        meta: {
          orderId: chargeOrderId,
          activityId: BHK_BARGAIN_ACTIVITY_ID
        }
      }
    });

    await sessionRef.update({
      data: {
        thanksgivingChargeOrderId: chargeOrderId,
        chargeOrderId,
        chargeOrderAmount: normalizedAmount,
        chargeOrderCreatedAt: now
      }
    });
  });

  return { orderId: chargeOrderId };
}

function applyRealmBoostUpgrade(record = {}, memberBoost = 0, realmBonus = 0, divineHandRemaining = 0) {
  const normalized = { ...record };
  const previousBoost = Number.isFinite(normalized.memberBoost) ? normalized.memberBoost : 0;
  const boostedMemberBoost = Math.max(previousBoost, memberBoost);
  const previousRealmBonus = Number.isFinite(normalized.realmBonusTotal) ? normalized.realmBonusTotal : 0;
  const targetRealmBonus = Number.isFinite(realmBonus) ? realmBonus : 0;
  const hasDivineBoost = boostedMemberBoost >= DIVINE_HAND_THRESHOLD;
  const hasDivineHandUsed = Boolean(normalized.divineHandUsed);

  normalized.memberBoost = boostedMemberBoost;

  if (!Number.isFinite(normalized.realmBonusTotal) || normalized.realmBonusTotal === 0 || targetRealmBonus > previousRealmBonus) {
    const deltaBonus = Math.max(0, targetRealmBonus - previousRealmBonus);
    normalized.realmBonusTotal = targetRealmBonus;
    normalized.realmBonusRemaining = Math.max(0, (normalized.realmBonusRemaining || 0) + deltaBonus);
    normalized.remainingSpins = Math.max(0, (normalized.remainingSpins || 0) + deltaBonus);
  } else if (normalized.realmBonusRemaining > normalized.realmBonusTotal) {
    normalized.realmBonusRemaining = normalized.realmBonusTotal;
  }

  if (hasDivineBoost && !hasDivineHandUsed) {
    const targetDivine = Math.max(1, divineHandRemaining || 1);
    if (!Number.isFinite(normalized.divineHandRemaining) || normalized.divineHandRemaining < targetDivine) {
      normalized.divineHandRemaining = targetDivine;
    }
  }

  normalized.divineHandUsed = hasDivineHandUsed;

  return normalized;
}

function hasRealmBoostUpgrade(before = {}, after = {}) {
  return (
    before.memberBoost !== after.memberBoost ||
    before.realmBonusTotal !== after.realmBonusTotal ||
    before.realmBonusRemaining !== after.realmBonusRemaining ||
    before.remainingSpins !== after.remainingSpins ||
    before.divineHandRemaining !== after.divineHandRemaining
  );
}

function applyThanksgivingProfileReward(record = {}, profileComplete = false) {
  if (!profileComplete) {
    return record;
  }
  if (record.thanksgivingProfileRewarded) {
    return record;
  }
  const updated = { ...record };
  updated.thanksgivingProfileRewarded = true;
  updated.remainingSpins = Math.max(0, (updated.remainingSpins || 0) + 1);
  return updated;
}

function hasProfileRewardUpdate(before = {}, after = {}) {
  return Boolean(after.thanksgivingProfileRewarded && !before.thanksgivingProfileRewarded);
}

async function getOrCreateBargainSession(config = {}, options = {}) {
  const openid = options.openid || getOpenId();
  if (!openid) {
    throw new Error('未登录，请先授权');
  }

  await ensureCollectionExists(BHK_BARGAIN_COLLECTION);
  const collection = db.collection(BHK_BARGAIN_COLLECTION);
  const memberBoost = Number.isFinite(options.memberBoost) ? options.memberBoost : 0;
  const memberRealm = options.memberRealm || '';
  const memberProfile = options.memberProfile || null;
  const profileComplete = options.profileComplete === true;
  const { bonus: realmBonus } = resolveRealmBonus(memberBoost);
  const divineHandRemaining = memberBoost >= DIVINE_HAND_THRESHOLD ? 1 : 0;
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();

  const snapshot = await collection.doc(docId).get().catch(() => null);
  if (snapshot && snapshot.data) {
    const normalized = normalizeBargainSession(snapshot.data, config, { memberRealm }, openid);
    const upgraded = applyRealmBoostUpgrade(normalized, memberBoost, realmBonus, divineHandRemaining);
    const rewarded = applyThanksgivingProfileReward(upgraded, profileComplete);
    if (memberProfile && !normalized.memberProfile) {
      rewarded.memberProfile = memberProfile;
    }

    const shouldPersistProfile = memberProfile && !normalized.memberProfile;
    const shouldPersistProfileReward = hasProfileRewardUpdate(normalized, rewarded);
    if (hasRealmBoostUpgrade(normalized, rewarded) || shouldPersistProfile || shouldPersistProfileReward) {
      await collection.doc(docId).update({
        data: { ...rewarded, updatedAt: now }
      });
      return { ...rewarded, updatedAt: now };
    }

    return rewarded;
  }

  const baseSpins = Number(config.baseAttempts) || 0;
  const session = {
    activityId: BHK_BARGAIN_ACTIVITY_ID,
    memberId: openid,
    currentPrice: config.startPrice,
    totalDiscount: 0,
    remainingSpins: baseSpins + realmBonus,
    baseSpins: config.baseAttempts,
    memberBoost,
    assistGiven: 0,
    assistSpins: 0,
    shareCount: 0,
    helperRecords: [],
    memberRealm,
    memberProfile,
    realmBonusTotal: realmBonus,
    realmBonusRemaining: realmBonus,
    divineHandRemaining,
    divineHandUsed: false,
    thanksgivingProfileRewarded: false,
    createdAt: now,
    updatedAt: now,
    remainingDiscount: Math.max(0, config.startPrice - config.floorPrice)
  };

  const rewardedSession = applyThanksgivingProfileReward(session, profileComplete);

  await collection.doc(docId).set({ data: rewardedSession });
  return normalizeBargainSession({ ...rewardedSession, _id: docId }, config, {}, openid);
}

async function buildShareContext(config, targetOpenId, viewerOpenId, viewerProfile, viewerAssistGiven = 0) {
  if (!targetOpenId) {
    return null;
  }

  const { memberBoost, realmName, profile, profileComplete } = await resolveMemberBoost(config, targetOpenId);
  const targetSession = await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid: targetOpenId,
    memberProfile: profile,
    profileComplete
  });
  const helperRecords = Array.isArray(targetSession.helperRecords) ? targetSession.helperRecords : [];
  const ownerProfile = targetSession.memberProfile || profile || buildMemberProfile({}, targetOpenId);
  const ownerTitleId = normalizeTitleId(ownerProfile.titleId || ownerProfile.titleName);
  const helpers = [
    { role: '分享者', id: ownerProfile.openid || targetOpenId, ...ownerProfile, titleId: ownerTitleId },
    ...helperRecords.map((item) => ({
      role: item.role || '助力者',
      id: item.id || item.openid,
      ...item,
      titleId: normalizeTitleId(item.titleId || item.titleName)
    }))
  ].filter((item) => item && item.openid && item.openid !== viewerOpenId);
  const assisted = helperRecords.some((item) => item && item.openid && item.openid === viewerOpenId);
  const canAssist =
    Boolean(viewerOpenId) &&
    viewerOpenId !== targetOpenId &&
    !assisted &&
    (!Number.isFinite(viewerAssistGiven) || viewerAssistGiven < 1);

  return { ownerId: targetOpenId, assisted, canAssist, helpers };
}

function buildBargainPayload(config, session, overrides = {}) {
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const floorReached = (session.currentPrice || 0) <= config.floorPrice;
  const totalStock = Number.isFinite(overrides.totalStock) ? overrides.totalStock : config.stock;
  const publicConfig = { ...config, stock: totalStock, displaySegments };
  delete publicConfig.floorPrice;
  const stockRemaining = Number.isFinite(overrides.stockRemaining)
    ? overrides.stockRemaining
    : Number.isFinite(session.stockRemaining)
      ? session.stockRemaining
      : config.stock;
  const publicSession = { ...session, floorReached, stockRemaining };
  delete publicSession.remainingDiscount;
  const realmReward = buildRealmRewardState(publicSession);
  const payload = {
    activity: decorateActivity(buildBhkBargainActivity()),
    bargainConfig: publicConfig,
    session: { ...publicSession, realmReward, divineHandReady: realmReward.type === 'divine' && realmReward.ready },
    floorReached
  };
  return { ...payload, ...overrides };
}

async function getBhkBargainStatus(event = {}) {
  const config = buildBhkBargainConfig();
  const shareId = typeof event.shareId === 'string' ? event.shareId.trim() : '';
  const { memberBoost, realmName, openid, profile, profileComplete } = await resolveMemberBoost(config);
  const session = await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid,
    memberProfile: profile,
    profileComplete
  });
  const stockState = await getBargainStock(config);
  const ownedRight = await hasThanksgivingPass(openid);
  const normalizedSession = normalizeBargainSession(
    { ...session, stockRemaining: stockState.stockRemaining },
    config,
    { ticketOwned: Boolean(session.ticketOwned) || ownedRight },
    openid
  );

  if (normalizedSession.ticketOwned && !session.ticketOwned) {
    await db
      .collection(BHK_BARGAIN_COLLECTION)
      .doc(`${BHK_BARGAIN_ACTIVITY_ID}_${openid}`)
      .update({ data: { ticketOwned: true, purchased: true, stockRemaining: stockState.stockRemaining } })
      .catch(() => null);
  }

  const targetShareId = shareId || normalizedSession.lastShareTarget || '';
  const shareContext = targetShareId
    ? await buildShareContext(config, targetShareId, openid, profile, normalizedSession.assistGiven)
    : null;

  if (shareId && shareId !== session.lastShareTarget) {
    const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
    await db
      .collection(BHK_BARGAIN_COLLECTION)
      .doc(`${BHK_BARGAIN_ACTIVITY_ID}_${openid}`)
      .update({ data: { lastShareTarget: shareId, updatedAt: now } })
      .catch(() => null);
  }

  return buildBargainPayload(config, normalizedSession, {
    shareContext,
    stockRemaining: stockState.stockRemaining,
    totalStock: stockState.totalStock
  });
}

async function spinBhkBargain() {
  const config = buildBhkBargainConfig();
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const stockState = await getBargainStock(config);
  const { memberBoost, realmName, openid, profile, profileComplete } = await resolveMemberBoost(config);
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const segments = normalizeSegments(config.segments);

  if (!segments.length) {
    throw new Error('暂无抽奖配置');
  }

  let result = null;

  await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid,
    memberProfile: profile,
    profileComplete
  });

  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(BHK_BARGAIN_COLLECTION).doc(docId);
    let snapshot = await ref.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('抽奖数据初始化失败');
    }
    const record = normalizeBargainSession(snapshot.data, config, { memberBoost, memberRealm: realmName }, openid);
    if ((record.remainingSpins || 0) <= 0) {
      throw new Error('抽奖次数不足');
    }

    const sliceIndex = Math.floor(Math.random() * segments.length);
    const slice = segments[sliceIndex] || 0;
    const availableCut = Math.max(0, record.currentPrice - config.floorPrice);
    const rawCut = Math.max(0, slice);
    const cut = Math.min(rawCut, availableCut);
    const reachedFloor = availableCut <= rawCut;
    const landingIndex = reachedFloor ? displaySegments.length - 1 : sliceIndex;
    const nextPrice = Math.max(config.floorPrice, record.currentPrice - cut);
    const nextDiscount = (record.totalDiscount || 0) + cut;
    const nextRemainingSpins = Math.max(0, (record.remainingSpins || 0) - 1);
    const nextRealmBonusRemaining = Math.max(
      0,
      record.realmBonusRemaining > 0 ? record.realmBonusRemaining - 1 : record.realmBonusRemaining || 0
    );
    const updatedRecord = {
      ...record,
      currentPrice: nextPrice,
      totalDiscount: nextDiscount,
      remainingSpins: nextRemainingSpins,
      realmBonusRemaining: nextRealmBonusRemaining,
      remainingDiscount: Math.max(0, nextPrice - config.floorPrice),
      updatedAt: now
    };

    await ref.update({ data: updatedRecord });

    const message = reachedFloor
      ? '你太幸运了！已经拿到最终底价，抓紧下单吧！'
      : pickEncouragement();

    result = buildBargainPayload(config, updatedRecord, {
      landingIndex,
      amount: cut,
      message,
      stockRemaining: stockState.stockRemaining,
      totalStock: stockState.totalStock
    });
  });

  return result;
}

async function assistBhkBargain(event = {}) {
  const shareId = typeof event.shareId === 'string' ? event.shareId.trim() : '';
  const config = buildBhkBargainConfig();
  const stockState = await getBargainStock(config);
  const { memberBoost, realmName, openid, profile, profileComplete } = await resolveMemberBoost(config);

  if (!openid) {
    throw new Error('未登录，请先授权');
  }

  if (!shareId) {
    throw new Error('助力链接无效');
  }

  if (shareId === openid) {
    throw new Error('自己无法助力自己');
  }

  const {
    memberBoost: targetBoost,
    realmName: targetRealm,
    profile: targetProfile,
    profileComplete: targetProfileComplete
  } = await resolveMemberBoost(config, shareId);

  await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid,
    memberProfile: profile,
    profileComplete
  });
  await getOrCreateBargainSession(config, {
    memberBoost: targetBoost,
    memberRealm: targetRealm,
    openid: shareId,
    memberProfile: targetProfile,
    profileComplete: targetProfileComplete
  });

  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  let updatedViewer = null;
  let updatedTarget = null;

  await db.runTransaction(async (transaction) => {
    const viewerRef = transaction.collection(BHK_BARGAIN_COLLECTION).doc(`${BHK_BARGAIN_ACTIVITY_ID}_${openid}`);
    const targetRef = transaction.collection(BHK_BARGAIN_COLLECTION).doc(`${BHK_BARGAIN_ACTIVITY_ID}_${shareId}`);

    const [viewerSnapshot, targetSnapshot] = await Promise.all([viewerRef.get().catch(() => null), targetRef.get().catch(() => null)]);

    if (!viewerSnapshot || !viewerSnapshot.data || !targetSnapshot || !targetSnapshot.data) {
      throw new Error('助力数据未初始化');
    }

    const viewerRecord = normalizeBargainSession(
      viewerSnapshot.data,
      config,
      { memberBoost, memberRealm: realmName },
      openid
    );
    const targetRecord = normalizeBargainSession(
      targetSnapshot.data,
      config,
      { memberBoost: targetBoost, memberRealm: targetRealm },
      shareId
    );

    const assistGiven = Number.isFinite(viewerRecord.assistGiven) ? viewerRecord.assistGiven : 0;
    if (assistGiven >= 1) {
      throw new Error('助力次数已用完');
    }

    const helperRecords = Array.isArray(targetRecord.helperRecords) ? targetRecord.helperRecords : [];
    const alreadyAssisted = helperRecords.some((item) => item && item.openid === openid);
    if (alreadyAssisted) {
      throw new Error('已助力过该好友');
    }

    const helperProfile = profile || buildMemberProfile({}, openid);

    updatedTarget = {
      ...targetRecord,
      helperRecords: [
        ...helperRecords,
        {
          role: '助力者',
          openid,
          id: openid,
          nickname: helperProfile.nickname,
          avatar: helperProfile.avatar,
          avatarFrame: helperProfile.avatarFrame,
          titleName: helperProfile.titleName,
          assistedAt: now
        }
      ],
      remainingSpins: Math.max(0, (targetRecord.remainingSpins || 0) + 1),
      assistSpins: Math.max(0, (targetRecord.assistSpins || 0) + 1),
      remainingDiscount: Math.max(0, (targetRecord.currentPrice || config.startPrice) - config.floorPrice),
      updatedAt: now
    };

    updatedViewer = {
      ...viewerRecord,
      assistGiven: assistGiven + 1,
      remainingSpins: Math.max(0, (viewerRecord.remainingSpins || 0) + 1),
      assistSpins: Math.max(0, (viewerRecord.assistSpins || 0) + 1),
      lastShareTarget: shareId,
      remainingDiscount: Math.max(0, (viewerRecord.currentPrice || config.startPrice) - config.floorPrice),
      updatedAt: now
    };

    await targetRef.update({ data: updatedTarget });
    await viewerRef.update({ data: updatedViewer });
  });

  const viewerSession = normalizeBargainSession(
    { ...updatedViewer, stockRemaining: stockState.stockRemaining },
    config,
    { memberBoost, memberRealm: realmName },
    openid
  );
  const shareContext = await buildShareContext(config, shareId, openid, profile, viewerSession.assistGiven);

  return buildBargainPayload(config, viewerSession, {
    shareContext,
    assistedTarget: shareId,
    stockRemaining: stockState.stockRemaining,
    totalStock: stockState.totalStock
  });
}

async function divineHandBhkBargain() {
  const config = buildBhkBargainConfig();
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const stockState = await getBargainStock(config);
  const { memberBoost, realmName, openid, profile, profileComplete } = await resolveMemberBoost(config);
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();

  let result = null;

  await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid,
    memberProfile: profile,
    profileComplete
  });

  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(BHK_BARGAIN_COLLECTION).doc(docId);
    let snapshot = await ref.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('抽奖数据初始化失败');
    }
    const record = normalizeBargainSession(snapshot.data, config, { memberBoost, memberRealm: realmName }, openid);

    if (record.remainingSpins > 0) {
      throw new Error('还有普通砍价次数可用');
    }

    if (!record.divineHandRemaining || memberBoost < DIVINE_HAND_THRESHOLD) {
      throw new Error('神之一手未解锁');
    }

    const cut = Math.max(0, record.currentPrice - config.floorPrice);
    const nextPrice = Math.max(config.floorPrice, record.currentPrice - cut);
    const updatedRecord = {
      ...record,
      currentPrice: nextPrice,
      totalDiscount: (record.totalDiscount || 0) + cut,
      remainingSpins: 0,
      realmBonusRemaining: Math.max(0, record.realmBonusRemaining || 0),
      divineHandRemaining: Math.max(0, (record.divineHandRemaining || 1) - 1),
      divineHandUsed: true,
      remainingDiscount: 0,
      updatedAt: now
    };

    await ref.update({ data: updatedRecord });

    result = buildBargainPayload(config, updatedRecord, {
      landingIndex: displaySegments.length - 1,
      amount: cut,
      message: '神之一手！必中隐藏奖池，直达底价',
      stockRemaining: stockState.stockRemaining,
      totalStock: stockState.totalStock
    });
  });

  return result;
}

async function confirmBhkBargainPurchase() {
  const config = buildBhkBargainConfig();
  const { memberBoost, realmName, openid, profile, profileComplete } = await resolveMemberBoost(config);

  if (!openid) {
    throw new Error('未登录，请先授权');
  }

  await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid,
    memberProfile: profile,
    profileComplete
  });

  const sessionDocId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  let stockState = await getBargainStock(config);
  let latestSession = null;

  await db.runTransaction(async (transaction) => {
    const sessionRef = transaction.collection(BHK_BARGAIN_COLLECTION).doc(sessionDocId);
    const stockRef = transaction.collection(BHK_BARGAIN_STOCK_COLLECTION).doc(BHK_BARGAIN_ACTIVITY_ID);

    const [sessionSnapshot, stockSnapshot] = await Promise.all([
      sessionRef.get().catch(() => null),
      stockRef.get().catch(() => null)
    ]);

    const hasSession = Boolean(sessionSnapshot && sessionSnapshot.data);
    const baseSession = hasSession
      ? normalizeBargainSession(
          { ...sessionSnapshot.data, stockRemaining: stockState.stockRemaining },
          config,
          { memberBoost, memberRealm: realmName },
          openid
        )
      : null;

    const existingStockDoc = stockSnapshot && stockSnapshot.data;
    const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
    const preparedStock = existingStockDoc
      ? existingStockDoc
      : { totalStock: config.stock, stockRemaining: config.stock, sold: 0, updatedAt: now };

    if (preparedStock && !existingStockDoc) {
      await stockRef.set({ data: preparedStock });
    }

    const verifiedStockSnapshot = existingStockDoc ? stockSnapshot : await stockRef.get().catch(() => null);
    const verifiedStockDoc = verifiedStockSnapshot && verifiedStockSnapshot.data ? verifiedStockSnapshot.data : preparedStock;

    const remainingStock = Number.isFinite(verifiedStockDoc.stockRemaining)
      ? verifiedStockDoc.stockRemaining
      : config.stock;

    if (hasSession && baseSession.ticketOwned) {
      latestSession = baseSession;
      stockState = { ...stockState, stockRemaining: remainingStock };
      return;
    }

    if (remainingStock <= 0) {
      throw new Error('席位已售罄');
    }

    const nextRemaining = Math.max(0, remainingStock - 1);
    await stockRef.update({ data: { stockRemaining: nextRemaining, sold: _.inc(1), updatedAt: now } });

    const { bonus: realmBonus } = resolveRealmBonus(memberBoost);
    const baseSpins = Number(config.baseAttempts) || 0;
    const memberProfile = profile || buildMemberProfile({}, openid);

    const updatedSession = hasSession
      ? { ...baseSession, purchased: true, ticketOwned: true, purchasedAt: now, stockRemaining: nextRemaining, updatedAt: now }
      : {
          activityId: BHK_BARGAIN_ACTIVITY_ID,
          memberId: openid,
          currentPrice: config.startPrice,
          totalDiscount: 0,
          remainingSpins: baseSpins + realmBonus,
          baseSpins: config.baseAttempts,
          memberBoost,
          assistGiven: 0,
          assistSpins: 0,
          shareCount: 0,
          helperRecords: [],
          memberRealm: realmName,
          memberProfile,
          realmBonusTotal: realmBonus,
          realmBonusRemaining: realmBonus,
          divineHandRemaining: memberBoost >= DIVINE_HAND_THRESHOLD ? 1 : 0,
          divineHandUsed: false,
          createdAt: now,
          remainingDiscount: Math.max(0, config.startPrice - config.floorPrice),
          ticketOwned: true,
          purchased: true,
          purchasedAt: now,
          stockRemaining: nextRemaining,
          updatedAt: now
        };

    if (hasSession) {
      const { _id, ...updateData } = updatedSession;
      await sessionRef.update({ data: updateData });
      latestSession = normalizeBargainSession(
        { ...updatedSession, _id: sessionDocId },
        config,
        { memberBoost, memberRealm: realmName },
        openid
      );
    } else {
      await sessionRef.set({ data: updatedSession });
      latestSession = normalizeBargainSession(
        { ...updatedSession, _id: sessionDocId },
        config,
        { memberBoost, memberRealm: realmName },
        openid
      );
    }

    stockState = { ...stockState, stockRemaining: nextRemaining };
  });

  const normalizedSession = latestSession ||
    normalizeBargainSession(
      { stockRemaining: stockState.stockRemaining },
      config,
      { memberBoost, memberRealm: realmName },
      openid
    );

  const normalizedChargeAmount =
    Math.max(0, Math.round(Number(normalizedSession.currentPrice || 0) * 100)) ||
    Math.max(0, Math.round(Number(config.floorPrice || 0) * 100));

  await ensureThanksgivingChargeOrder(openid, sessionDocId, normalizedChargeAmount);

  const shareId = normalizedSession.lastShareTarget || '';
  const shareContext = shareId
    ? await buildShareContext(config, shareId, openid, profile, normalizedSession.assistGiven)
    : null;

  return buildBargainPayload(config, normalizedSession, {
    shareContext,
    stockRemaining: stockState.stockRemaining,
    totalStock: stockState.totalStock
  });
}
