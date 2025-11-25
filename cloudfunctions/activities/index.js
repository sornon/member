const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { COLLECTIONS, buildCloudAssetUrl } = require('common-config');

const DEFAULT_LIMIT = 100;
const BHK_BARGAIN_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';
const BHK_BARGAIN_COLLECTION = 'bhkBargainRecords';
const DEFAULT_AVATAR = buildCloudAssetUrl('avatar', 'default.png');
const ENCOURAGEMENTS = [
  '好友助力价格还能更低，赶紧喊上小伙伴！',
  '邀请好友帮砍，惊爆价就在前面！',
  '继续分享，越多人助力越容易砍到底！',
  '呼朋唤友来助力，价格还能再低！',
  '好友助力价格还能更低，快去求助一下吧~'
];

async function ensureCollectionExists(name) {
  if (!name) return;
  try {
    if (typeof db.createCollection === 'function') {
      await db.createCollection(name);
    }
  } catch (err) {
    const code = err && (err.errCode || err.code || err.message || '').toString();
    const alreadyExists = code.includes('ResourceExists') || code.includes('already exists');
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
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

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
    title: '感恩节 · BHK56 限量品鉴会',
    tagline: '珍稀雪茄 15 席限量，感恩节回馈到店酒友',
    status: 'published',
    startTime: '2025-11-27T11:00:00.000Z',
    endTime: '2025-12-01T16:00:00.000Z',
    priceLabel: '¥3500 起 / 15 席',
    location: '酒隐之茄·上海店（长宁路 188 号）',
    coverImage: buildCloudAssetUrl('background', 'cover-20251102.jpg'),
    highlight: 'Cohiba BHK56 珍品雪茄 + 品鉴会入场 + 畅饮调酒',
    tags: ['BHK56', '感恩节', '限量品鉴'],
    perks: [
      '伴手礼含 Cohiba Behike 56 雪茄一支（市场价约 ¥3500）',
      '高端雪茄吧包场氛围，专属品鉴席位仅 15 席',
      '到店签到即享节日调酒与软饮畅饮权益',
      '现场导师讲解 Cohiba 品牌故事与雪茄品鉴礼仪'
    ],
    notes:
      '本活动仅限 18 岁以上会员到店参与，门票不可转售或退款；售罄即止。如遇不可抗力主办方保留变更活动时间的权利。'
  };
}

function buildBhkBargainConfig() {
  return {
    startPrice: 3500,
    floorPrice: 998,
    baseAttempts: 3,
    vipBonuses: [
      { thresholdRealmOrder: 4, bonusAttempts: 1, label: '元婴及以上修为尊享' },
      { thresholdRealmOrder: 7, bonusAttempts: 2, label: '合体及以上额外加成' }
    ],
    segments: [120, 180, 200, 260, 320, 500, 0, 150],
    assistRewardRange: { min: 60, max: 180 },
    assistAttemptCap: 6,
    stock: 15,
    endsAt: '2025-12-01T16:00:00.000Z',
    heroImage: buildCloudAssetUrl('background', 'cover-20251102.jpg'),
    mysteryLabel: '???',
    perks: [
      '原价 ¥3500，拼手气拿到惊爆价',
      '默认 3 次砍价，修仙境界越高额外次数越多，分享好友还可叠加',
      '好友助力砍价后自动追加一次转盘机会，助力金额实时累计',
      '余票与倒计时实时提醒，便捷一键购票'
    ]
  };
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
    return 1;
  }
  if (Number.isFinite(level.realmOrder)) {
    return Math.max(1, Math.floor(level.realmOrder));
  }
  if (Number.isFinite(level.order)) {
    return Math.max(1, Math.floor(level.order));
  }
  return 1;
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

async function resolveMemberBoost(config = {}, openid = '') {
  const bonuses = Array.isArray(config.vipBonuses) ? config.vipBonuses : [];
  let memberBoost = 0;
  let realmName = '';
  const currentOpenId = openid || getOpenId();

  if (!currentOpenId) {
    return { memberBoost, realmName, openid: '' };
  }

  const memberSnapshot = await db.collection(COLLECTIONS.MEMBERS).doc(currentOpenId).get().catch(() => null);
  const member = (memberSnapshot && memberSnapshot.data) || {};
  realmName = resolveMemberRealm(member);
  const realmOrder = resolveRealmOrder(member.level || member);

  bonuses.forEach((bonus) => {
    if (!bonus || !Number.isFinite(bonus.thresholdRealmOrder)) {
      return;
    }
    const threshold = Math.max(1, Math.floor(bonus.thresholdRealmOrder));
    if (realmOrder >= threshold) {
      memberBoost = Math.max(memberBoost, Number(bonus.bonusAttempts) || 0);
    }
  });

  return { memberBoost, realmName, openid: currentOpenId };
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
    assistSpins: Number.isFinite(record.assistSpins) ? record.assistSpins : 0,
    shareCount: Number.isFinite(record.shareCount) ? record.shareCount : 0,
    helperRecords: Array.isArray(record.helperRecords) ? record.helperRecords : [],
    memberRealm: record.memberRealm || resolveMemberRealm(record.member) || '',
    remainingDiscount: Math.max(0, (Number.isFinite(record.currentPrice) ? record.currentPrice : config.startPrice) - config.floorPrice)
  };

  return { ...normalized, ...overrides };
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
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();

  const snapshot = await collection.doc(docId).get().catch(() => null);
  if (snapshot && snapshot.data) {
    return normalizeBargainSession(snapshot.data, config, { memberRealm }, openid);
  }

  const baseSpins = (Number(config.baseAttempts) || 0) + memberBoost;
  const session = {
    _id: docId,
    activityId: BHK_BARGAIN_ACTIVITY_ID,
    memberId: openid,
    currentPrice: config.startPrice,
    totalDiscount: 0,
    remainingSpins: baseSpins,
    baseSpins: config.baseAttempts,
    memberBoost,
    assistSpins: 0,
    shareCount: 0,
    helperRecords: [],
    memberRealm,
    createdAt: now,
    updatedAt: now,
    remainingDiscount: Math.max(0, config.startPrice - config.floorPrice)
  };

  await collection.add({ data: session });
  return normalizeBargainSession(session, config, {}, openid);
}

function buildBargainPayload(config, session, overrides = {}) {
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const payload = {
    activity: decorateActivity(buildBhkBargainActivity()),
    bargainConfig: { ...config, displaySegments },
    session
  };
  return { ...payload, ...overrides };
}

async function getBhkBargainStatus() {
  const config = buildBhkBargainConfig();
  const { memberBoost, realmName, openid } = await resolveMemberBoost(config);
  const session = await getOrCreateBargainSession(config, {
    memberBoost,
    memberRealm: realmName,
    openid
  });
  return buildBargainPayload(config, session);
}

async function spinBhkBargain() {
  const config = buildBhkBargainConfig();
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const { memberBoost, realmName, openid } = await resolveMemberBoost(config);
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const segments = normalizeSegments(config.segments);

  if (!segments.length) {
    throw new Error('暂无抽奖配置');
  }

  let result = null;

  await getOrCreateBargainSession(config, { memberBoost, memberRealm: realmName, openid });

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
    const updatedRecord = {
      ...record,
      currentPrice: nextPrice,
      totalDiscount: nextDiscount,
      remainingSpins: Math.max(0, (record.remainingSpins || 0) - 1),
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
      message
    });
  });

  return result;
}

async function assistBhkBargain() {
  const config = buildBhkBargainConfig();
  const displaySegments = buildDisplaySegments(config.segments, config.mysteryLabel);
  const { memberBoost, realmName, openid } = await resolveMemberBoost(config);
  const docId = `${BHK_BARGAIN_ACTIVITY_ID}_${openid}`;
  const now = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const segments = normalizeSegments(config.segments);
  const range = (config && config.assistRewardRange) || { min: 60, max: 180 };

  let result = null;

  await getOrCreateBargainSession(config, { memberBoost, memberRealm: realmName, openid });

  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(BHK_BARGAIN_COLLECTION).doc(docId);
    let snapshot = await ref.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('助力数据初始化失败');
    }
    const record = normalizeBargainSession(snapshot.data, config, { memberBoost, memberRealm: realmName }, openid);

    if (record.assistSpins >= config.assistAttemptCap) {
      throw new Error('助力次数已达上限');
    }

    const min = Number(range.min) || 0;
    const max = Number(range.max) || 0;
    const reward = Math.floor(Math.random() * (max - min + 1)) + min;
    const availableCut = Math.max(0, record.currentPrice - config.floorPrice);
    const rawCut = Math.max(0, reward);
    const cut = Math.min(rawCut, availableCut);
    const reachedFloor = availableCut <= rawCut;
    const landingIndex = reachedFloor
      ? displaySegments.length - 1
      : segments.findIndex((item) => item === rawCut);
    const nextPrice = Math.max(config.floorPrice, record.currentPrice - cut);
    const nextHelper = {
      id: `${Date.now()}_${(record.assistSpins || 0) + 1}`,
      amount: cut,
      avatar: DEFAULT_AVATAR,
      nickname: `助力好友 ${(record.shareCount || 0) + 1}`
    };
    const helperRecords = [nextHelper, ...(record.helperRecords || [])].slice(0, 6);
    const updatedRecord = {
      ...record,
      currentPrice: nextPrice,
      totalDiscount: (record.totalDiscount || 0) + cut,
      assistSpins: (record.assistSpins || 0) + 1,
      shareCount: (record.shareCount || 0) + 1,
      remainingSpins: (record.remainingSpins || 0) + 1,
      helperRecords,
      remainingDiscount: Math.max(0, nextPrice - config.floorPrice),
      updatedAt: now
    };

    await ref.update({ data: updatedRecord });

    const message = reachedFloor
      ? '你太幸运了！已经拿到最终底价，抓紧下单吧！'
      : pickEncouragement();

    result = buildBargainPayload(config, updatedRecord, {
      landingIndex: landingIndex >= 0 ? landingIndex : displaySegments.length - 1,
      amount: cut,
      message
    });
  });

  return result;
}
