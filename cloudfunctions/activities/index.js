const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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

async function listPublicActivities(options = {}) {
  const limit = normalizeLimit(options.limit);
  const now = new Date();
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const query = collection
    .where({
      status: 'published',
      $or: [
        { endTime: _.eq(null) },
        { endTime: _.eq('') },
        { endTime: _.gte(now) }
      ]
    })
    .orderBy('sortOrder', 'desc')
    .orderBy('startTime', 'asc');

  const snapshot = await query.limit(limit).get();
  const activities = (snapshot.data || []).map((item) => decorateActivity(item));
  return { activities };
}
