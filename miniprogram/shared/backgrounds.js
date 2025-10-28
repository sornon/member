const { BACKGROUND_IMAGE_BASE_PATH, BACKGROUND_VIDEO_BASE_PATH } = require('./asset-paths.js');

const RAW_BACKGROUNDS = [
  { id: 'realm_refining', realmOrder: 1, realmName: '炼气期', name: '炼气之地', unlockType: 'realm' },
  {
    id: 'trial_spirit_test',
    realmOrder: 1,
    realmName: '炼气期',
    name: '灵根测试',
    unlockType: 'manual',
    mediaKey: 'bg-free-1'
  },
  { id: 'realm_foundation', realmOrder: 2, realmName: '筑基期', name: '筑基之地', unlockType: 'realm' },
  { id: 'realm_core', realmOrder: 3, realmName: '结丹期', name: '结丹之地', unlockType: 'realm' },
  { id: 'realm_nascent', realmOrder: 4, realmName: '元婴期', name: '元婴之地', unlockType: 'realm' },
  { id: 'realm_divine', realmOrder: 5, realmName: '化神期', name: '化神之地', unlockType: 'realm' },
  { id: 'realm_void', realmOrder: 6, realmName: '炼虚期', name: '炼虚之地', unlockType: 'realm' },
  { id: 'realm_unity', realmOrder: 7, realmName: '合体期', name: '合体之地', unlockType: 'realm' },
  { id: 'realm_great_vehicle', realmOrder: 8, realmName: '大乘期', name: '大乘之地', unlockType: 'realm' },
  { id: 'realm_tribulation', realmOrder: 9, realmName: '真仙期', name: '真仙之地', unlockType: 'realm' },
  { id: 'realm_ascension', realmOrder: 10, realmName: '金仙期', name: '金仙之地', unlockType: 'realm' }
];

function resolveMediaKey(realmOrder) {
  const order = Number(realmOrder);
  if (!Number.isFinite(order) || order <= 0) {
    return '1';
  }
  const normalizedOrder = Math.max(1, Math.floor(order));
  return `${normalizedOrder}`;
}

function buildBackgroundDefinition(item = {}) {
  const mediaKey = item.mediaKey || resolveMediaKey(item.realmOrder);
  const image = item.image || `${BACKGROUND_IMAGE_BASE_PATH}/${mediaKey}.jpg`;
  const video = item.video || `${BACKGROUND_VIDEO_BASE_PATH}/${mediaKey}.mp4`;
  return {
    ...item,
    mediaKey,
    image,
    video
  };
}

const BASE_BACKGROUNDS = RAW_BACKGROUNDS.map((item) => buildBackgroundDefinition(item));
const BASE_BACKGROUND_MAP = new Map(BASE_BACKGROUNDS.map((background) => [background.id, background]));
const CUSTOM_BACKGROUND_MAP = new Map();

function cloneBackground(background) {
  return background ? { ...background } : null;
}

function normalizeBackgroundMediaKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let sanitized = value.trim().toLowerCase();
  if (!sanitized) {
    return '';
  }
  sanitized = sanitized.replace(/\.(jpg|jpeg|png|mp4)$/g, '');
  sanitized = sanitized.replace(/[^a-z0-9_-]+/g, '_');
  sanitized = sanitized.replace(/_{2,}/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized;
}

function generateCustomBackgroundId(base, existingIds) {
  const normalizedBase = normalizeBackgroundMediaKey(base) || 'background';
  const ids = existingIds || new Set();
  let candidate = normalizedBase.startsWith('background_') ? normalizedBase : `background_${normalizedBase}`;
  let suffix = 1;
  let finalId = candidate;
  while (ids.has(finalId)) {
    suffix += 1;
    finalId = `${candidate}_${suffix}`;
  }
  ids.add(finalId);
  return finalId;
}

function normalizeBackgroundCatalogEntry(entry, existingIds) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const ids = existingIds || new Set();
  let id = typeof entry.id === 'string' ? entry.id.trim() : '';
  let mediaKey = normalizeBackgroundMediaKey(
    entry.mediaKey || entry.fileName || entry.file || entry.imageFile || entry.id || entry.name
  );
  if (!id) {
    id = generateCustomBackgroundId(mediaKey || entry.name || '', ids);
  }
  if (ids.has(id)) {
    id = generateCustomBackgroundId(id, ids);
  }
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  if (!mediaKey) {
    mediaKey = normalizeBackgroundMediaKey(id);
  }
  const normalized = {
    id,
    name,
    mediaKey
  };
  if (typeof entry.realmOrder === 'number' && Number.isFinite(entry.realmOrder)) {
    normalized.realmOrder = Math.max(0, Math.floor(entry.realmOrder));
  }
  if (typeof entry.realmName === 'string' && entry.realmName.trim()) {
    normalized.realmName = entry.realmName.trim();
  }
  if (typeof entry.unlockType === 'string' && entry.unlockType.trim()) {
    normalized.unlockType = entry.unlockType.trim();
  }
  if (typeof entry.videoFile === 'string' && entry.videoFile.trim()) {
    normalized.videoFile = normalizeBackgroundMediaKey(entry.videoFile);
  }
  if (typeof entry.dynamic === 'boolean') {
    normalized.dynamic = entry.dynamic;
  }
  if (entry.createdAt) {
    normalized.createdAt = entry.createdAt;
  }
  if (entry.createdBy) {
    normalized.createdBy = entry.createdBy;
  }
  ids.add(id);
  return normalized;
}

function normalizeBackgroundCatalog(list = []) {
  const baseIds = new Set(BASE_BACKGROUNDS.map((item) => item.id));
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalizedEntry = normalizeBackgroundCatalogEntry(entry, baseIds);
    if (normalizedEntry) {
      normalized.push(normalizedEntry);
    }
  });
  return normalized;
}

function areBackgroundCatalogsEqual(a = [], b = []) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] || {};
    const right = b[i] || {};
    if (left.id !== right.id || left.name !== right.name || left.mediaKey !== right.mediaKey) {
      return false;
    }
  }
  return true;
}

function decorateCustomBackground(entry) {
  const realmOrder = Number.isFinite(entry.realmOrder) ? Math.max(0, Math.floor(entry.realmOrder)) : 0;
  const unlockType = entry.unlockType || 'manual';
  const mediaKey = normalizeBackgroundMediaKey(entry.mediaKey || entry.id);
  const videoKey = normalizeBackgroundMediaKey(entry.videoFile || mediaKey);
  return buildBackgroundDefinition({
    id: entry.id,
    name: entry.name,
    realmOrder,
    realmName: entry.realmName || '',
    unlockType,
    mediaKey,
    image: `${BACKGROUND_IMAGE_BASE_PATH}/${mediaKey}.jpg`,
    video: `${BACKGROUND_VIDEO_BASE_PATH}/${videoKey}.mp4`
  });
}

function registerCustomBackgrounds(list = [], options = {}) {
  const normalized = normalizeBackgroundCatalog(list);
  if (!options || options.reset !== false) {
    CUSTOM_BACKGROUND_MAP.clear();
  }
  normalized.forEach((entry) => {
    CUSTOM_BACKGROUND_MAP.set(entry.id, decorateCustomBackground(entry));
  });
  return normalized;
}

function getBackgroundRegistry() {
  return BASE_BACKGROUNDS.concat(Array.from(CUSTOM_BACKGROUND_MAP.values()));
}

function listBackgrounds() {
  return getBackgroundRegistry().map((background) => cloneBackground(background));
}

function resolveBackgroundById(id) {
  if (typeof id !== 'string') {
    return null;
  }
  const trimmed = id.trim();
  if (CUSTOM_BACKGROUND_MAP.has(trimmed)) {
    return cloneBackground(CUSTOM_BACKGROUND_MAP.get(trimmed));
  }
  if (BASE_BACKGROUND_MAP.has(trimmed)) {
    return cloneBackground(BASE_BACKGROUND_MAP.get(trimmed));
  }
  return null;
}

function resolveBackgroundByRealmName(realmName) {
  if (typeof realmName !== 'string' || !realmName.trim()) {
    return null;
  }
  const trimmed = realmName.trim();
  const registry = getBackgroundRegistry();
  const found = registry.find((background) => background.realmName === trimmed);
  return cloneBackground(found);
}

function normalizeBackgroundId(id) {
  if (typeof id !== 'string') {
    return '';
  }
  const trimmed = id.trim();
  return resolveBackgroundById(trimmed) ? trimmed : '';
}

function getDefaultBackgroundId() {
  return BASE_BACKGROUNDS[0].id;
}

function isBackgroundUnlocked(id, realmOrder, unlockedList = []) {
  const background = resolveBackgroundById(id);
  if (!background) {
    return false;
  }
  if (background.unlockType === 'manual') {
    if (!Array.isArray(unlockedList)) {
      return false;
    }
    return unlockedList.includes(id);
  }
  const numericRealmOrder = Number(realmOrder);
  if (!Number.isFinite(numericRealmOrder)) {
    return background.realmOrder <= 1;
  }
  return Math.max(1, Math.floor(numericRealmOrder)) >= background.realmOrder;
}

function resolveHighestUnlockedBackgroundByRealmOrder(realmOrder) {
  const numericRealmOrder = Number(realmOrder);
  const registry = getBackgroundRegistry();
  if (!Number.isFinite(numericRealmOrder)) {
    return cloneBackground(registry[0]);
  }
  const unlocked = registry.filter(
    (background) => background.unlockType !== 'manual' && numericRealmOrder >= background.realmOrder
  );
  const target = unlocked.length ? unlocked[unlocked.length - 1] : registry[0];
  return cloneBackground(target);
}

function buildBackgroundImageUrlByFile(fileName) {
  const mediaKey = normalizeBackgroundMediaKey(fileName);
  if (!mediaKey) {
    return '';
  }
  return `${BACKGROUND_IMAGE_BASE_PATH}/${mediaKey}.jpg`;
}

function buildBackgroundVideoUrlByFile(fileName) {
  const mediaKey = normalizeBackgroundMediaKey(fileName);
  if (!mediaKey) {
    return '';
  }
  return `${BACKGROUND_VIDEO_BASE_PATH}/${mediaKey}.mp4`;
}

module.exports = {
  listBackgrounds,
  resolveBackgroundById,
  resolveBackgroundByRealmName,
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder,
  normalizeBackgroundCatalogEntry,
  normalizeBackgroundCatalog,
  normalizeBackgroundMediaKey,
  generateCustomBackgroundId,
  areBackgroundCatalogsEqual,
  registerCustomBackgrounds,
  buildBackgroundImageUrlByFile,
  buildBackgroundVideoUrlByFile
};
