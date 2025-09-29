const COLLECTION_NAME = 'appSettings';
const DOCUMENT_ID = 'entranceSettings';

const DEFAULT_ENTRANCE_CONFIG = Object.freeze({
  bottomNav: {
    role: true,
    equipment: true,
    skill: true,
    rights: true,
    reservation: true,
    wallet: true,
    avatar: true
  },
  activity: {
    pve: true,
    festival: true,
    arena: true
  }
});

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_ENTRANCE_CONFIG));
}

function coerceBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (['false', '0', 'off', 'disable', 'disabled'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'on', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
  }
  return fallback;
}

function normalizeEntranceConfig(config = {}) {
  const defaults = cloneDefaultConfig();
  const normalized = {};
  Object.keys(defaults).forEach((groupKey) => {
    const defaultGroup = defaults[groupKey];
    const incomingGroup = config[groupKey];
    const normalizedGroup = { ...defaultGroup };
    if (incomingGroup && typeof incomingGroup === 'object') {
      Object.keys(defaultGroup).forEach((optionKey) => {
        const value = incomingGroup[optionKey];
        normalizedGroup[optionKey] = coerceBoolean(value, defaultGroup[optionKey]);
      });
    }
    normalized[groupKey] = normalizedGroup;
  });
  return normalized;
}

function sanitizeMemberReference(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const member = {};
  if (typeof value._id === 'string' && value._id) {
    member._id = value._id;
  }
  if (typeof value.nickName === 'string' && value.nickName) {
    member.nickName = value.nickName;
  }
  if (Array.isArray(value.roles) && value.roles.length) {
    member.roles = value.roles.slice(0, 8);
  }
  return Object.keys(member).length ? member : null;
}

async function ensureDocument(db, collection) {
  const doc = await collection.doc(DOCUMENT_ID).get().catch(() => null);
  if (doc && doc.data) {
    return doc.data;
  }
  const defaults = cloneDefaultConfig();
  const payload = {
    config: defaults,
    updatedAt: null,
    updatedBy: '',
    updatedByMember: null
  };
  try {
    await collection.doc(DOCUMENT_ID).set({ data: payload });
  } catch (error) {
    if (error && (error.errCode === -501002 || /not exist/i.test(error.errMsg || ''))) {
      try {
        await db.createCollection(COLLECTION_NAME);
      } catch (createError) {
        if (!createError || createError.errCode !== -502005) {
          throw createError;
        }
      }
      await collection.doc(DOCUMENT_ID).set({ data: payload });
    } else {
      throw error;
    }
  }
  return payload;
}

async function getEntranceSettings(db) {
  const collection = db.collection(COLLECTION_NAME);
  const doc = await ensureDocument(db, collection);
  const normalizedConfig = normalizeEntranceConfig(doc.config || {});
  return {
    config: normalizedConfig,
    updatedAt: doc.updatedAt || null,
    updatedBy: typeof doc.updatedBy === 'string' ? doc.updatedBy : '',
    updatedByMember: sanitizeMemberReference(doc.updatedByMember)
  };
}

async function updateEntranceSettings(db, config = {}, context = {}) {
  const normalizedConfig = normalizeEntranceConfig(config && config.config ? config.config : config);
  const collection = db.collection(COLLECTION_NAME);
  await ensureDocument(db, collection);
  const payload = {
    config: normalizedConfig,
    updatedAt: new Date(),
    updatedBy: typeof context.updatedBy === 'string' ? context.updatedBy : '',
    updatedByMember: sanitizeMemberReference(context.updatedByMember)
  };
  await collection.doc(DOCUMENT_ID).set({ data: payload });
  return payload;
}

module.exports = {
  COLLECTION_NAME,
  DOCUMENT_ID,
  DEFAULT_ENTRANCE_CONFIG,
  cloneDefaultConfig,
  normalizeEntranceConfig,
  getEntranceSettings,
  updateEntranceSettings
};
