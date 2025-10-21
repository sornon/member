const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { COLLECTIONS } = require('common-config');

const DEFAULT_LIMIT = 100;

exports.main = async (event = {}) => {
  const action = typeof event.action === 'string' ? event.action.trim() : 'list';

  switch (action) {
    case 'list':
    case 'publicList':
      return listPublicActivities(event || {});
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
