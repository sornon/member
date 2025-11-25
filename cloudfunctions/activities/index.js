const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { COLLECTIONS, buildCloudAssetUrl } = require('common-config');

const DEFAULT_LIMIT = 100;
const BHK_BARGAIN_ACTIVITY_ID = '479859146924a70404e4f40e1530f51d';

exports.main = async (event = {}) => {
  const action = typeof event.action === 'string' ? event.action.trim() : 'list';

  switch (action) {
    case 'list':
    case 'publicList':
      return listPublicActivities(event || {});
    case 'detail':
      return getActivityDetail(event || {});
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
    floorPrice: 1288,
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
    perks: [
      '原价 ¥3500，砍价后最低 ¥1288 即可锁定限量席位',
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
