const { AVATAR_IMAGE_BASE_PATH, CHARACTER_IMAGE_BASE_PATH } = require('./asset-paths.js');

const RAW_AVATARS = [
  { gender: 'male', rarity: 'c', index: 1 },
  { gender: 'male', rarity: 'c', index: 2 },
  { gender: 'male', rarity: 'c', index: 3 },
  { gender: 'male', rarity: 'b', index: 1 },
  { gender: 'male', rarity: 'b', index: 2 },
  { gender: 'male', rarity: 'b', index: 3 },
  { gender: 'male', rarity: 'b', index: 4 },
  { gender: 'male', rarity: 'b', index: 5 },
  { gender: 'male', rarity: 'b', index: 6 },
  { gender: 'male', rarity: 'a', index: 1 },
  { gender: 'male', rarity: 'a', index: 2 },
  { gender: 'male', rarity: 'a', index: 3 },
  { gender: 'male', rarity: 's', index: 1 },
  { gender: 'male', rarity: 's', index: 2 },
  { gender: 'male', rarity: 's', index: 3 },
  { gender: 'male', rarity: 'ss', index: 1 },
  { gender: 'male', rarity: 'ss', index: 2 },
  { gender: 'male', rarity: 'ss', index: 3 },
  { gender: 'male', rarity: 'sss', index: 1 },
  { gender: 'male', rarity: 'sss', index: 2 },
  { gender: 'male', rarity: 'sss', index: 3 },
  { gender: 'female', rarity: 'c', index: 1 },
  { gender: 'female', rarity: 'c', index: 2 },
  { gender: 'female', rarity: 'c', index: 3 },
  { gender: 'female', rarity: 'b', index: 1 },
  { gender: 'female', rarity: 'b', index: 2 },
  { gender: 'female', rarity: 'b', index: 3 },
  { gender: 'female', rarity: 'b', index: 4 },
  { gender: 'female', rarity: 'b', index: 5 },
  { gender: 'female', rarity: 'b', index: 6 },
  { gender: 'female', rarity: 'a', index: 1 },
  { gender: 'female', rarity: 'a', index: 2 },
  { gender: 'female', rarity: 'a', index: 3 },
  { gender: 'female', rarity: 's', index: 1 },
  { gender: 'female', rarity: 's', index: 2 },
  { gender: 'female', rarity: 's', index: 3 },
  { gender: 'female', rarity: 'ss', index: 1 },
  { gender: 'female', rarity: 'ss', index: 2 },
  { gender: 'female', rarity: 'ss', index: 3 },
  { gender: 'female', rarity: 'sss', index: 1 },
  { gender: 'female', rarity: 'sss', index: 2 },
  { gender: 'female', rarity: 'sss', index: 3 }
];

const AVATAR_RARITIES = ['c', 'b', 'a', 's', 'ss', 'sss'];
const AVATAR_RARITY_ATTRIBUTE_BONUS = {
  s: 5,
  ss: 10,
  sss: 15
};

function buildAvatarId({ gender, rarity, index }) {
  return `${gender}-${rarity}-${index}`;
}

function normalizeAvatarGender(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'female') {
    return 'female';
  }
  return 'male';
}

function normalizeAvatarRarity(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (AVATAR_RARITIES.includes(normalized)) {
    return normalized;
  }
  return 'c';
}

function normalizeAvatarFileName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let sanitized = value.trim().toLowerCase();
  if (!sanitized) {
    return '';
  }
  sanitized = sanitized.replace(/\.(png|jpg|jpeg)$/g, '');
  sanitized = sanitized.replace(/[^a-z0-9_-]+/g, '_');
  sanitized = sanitized.replace(/_{2,}/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized;
}

function decorateAvatarMeta(item) {
  const id = buildAvatarId(item);
  const gender = normalizeAvatarGender(item.gender);
  const rarity = normalizeAvatarRarity(item.rarity);
  const file = normalizeAvatarFileName(item.file || id) || id;
  const characterFile = normalizeAvatarFileName(item.characterFile || file) || file;
  return {
    ...item,
    id,
    gender,
    rarity,
    file,
    characterFile,
    attributeBonus: AVATAR_RARITY_ATTRIBUTE_BONUS[rarity] || 0
  };
}

const BASE_AVATARS = RAW_AVATARS.map((item) => decorateAvatarMeta(item));
const BASE_AVATAR_MAP = new Map(BASE_AVATARS.map((avatar) => [avatar.id, avatar]));
const CUSTOM_AVATAR_MAP = new Map();

let ALLOWED_AVATAR_IDS = new Set(BASE_AVATARS.map((avatar) => avatar.id));
let AVATAR_FILE_INDEX = new Map(BASE_AVATARS.map((avatar) => [avatar.file, avatar.id]));

function cloneAvatarMeta(meta) {
  if (!meta) {
    return null;
  }
  const clone = { ...meta };
  if (meta.attributes && typeof meta.attributes === 'object') {
    clone.attributes = { ...meta.attributes };
  }
  return clone;
}

function refreshAvatarRegistry() {
  const allMetas = BASE_AVATARS.concat(Array.from(CUSTOM_AVATAR_MAP.values()));
  ALLOWED_AVATAR_IDS = new Set(allMetas.map((meta) => meta.id));
  AVATAR_FILE_INDEX = new Map();
  allMetas.forEach((meta) => {
    if (meta && meta.file) {
      AVATAR_FILE_INDEX.set(meta.file, meta.id);
    }
  });
}

function normalizeAvatarId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (!ALLOWED_AVATAR_IDS.has(normalized)) {
    return '';
  }
  return normalized;
}

function resolveAvatarMetaById(id) {
  if (!id) {
    return null;
  }
  if (CUSTOM_AVATAR_MAP.has(id)) {
    return cloneAvatarMeta(CUSTOM_AVATAR_MAP.get(id));
  }
  if (BASE_AVATAR_MAP.has(id)) {
    return cloneAvatarMeta(BASE_AVATAR_MAP.get(id));
  }
  return null;
}

function listRegisteredAvatars() {
  return BASE_AVATARS.concat(Array.from(CUSTOM_AVATAR_MAP.values())).map((meta) => cloneAvatarMeta(meta));
}

function listAvatarIds() {
  return listRegisteredAvatars().map((meta) => meta.id);
}

function buildAvatarImageUrlByMeta(meta) {
  if (!meta) {
    return '';
  }
  const file = meta.file || meta.id;
  if (!file) {
    return '';
  }
  return `${AVATAR_IMAGE_BASE_PATH}/${file}.png`;
}

function buildCharacterImageUrlByMeta(meta) {
  if (!meta) {
    return '';
  }
  const file = meta.characterFile || meta.file || meta.id;
  if (!file) {
    return '';
  }
  return `${CHARACTER_IMAGE_BASE_PATH}/${file}.png`;
}

function buildAvatarUrl(id) {
  const meta = resolveAvatarMetaById(id);
  if (!meta) {
    return '';
  }
  return buildAvatarImageUrlByMeta(meta);
}

function buildCharacterUrlById(id) {
  const meta = resolveAvatarMetaById(id);
  if (!meta) {
    return '';
  }
  return buildCharacterImageUrlByMeta(meta);
}

function generateCustomAvatarId(base, gender, rarity, existingIds) {
  const slug = normalizeAvatarFileName(base) || 'custom';
  const ids = existingIds || new Set();
  let candidate = `${gender}-${rarity}-${slug}`;
  let suffix = 1;
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = `${gender}-${rarity}-${slug}-${suffix}`;
  }
  ids.add(candidate);
  return candidate;
}

function normalizeAvatarCatalogEntry(entry, existingIds) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const ids = existingIds || new Set();
  const gender = normalizeAvatarGender(entry.gender);
  const rarity = normalizeAvatarRarity(entry.rarity);
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
  const file = normalizeAvatarFileName(entry.file || entry.fileName || entry.avatarFile || entry.id || entry.name);
  if (!file) {
    return null;
  }
  let id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
  if (!id) {
    id = generateCustomAvatarId(file, gender, rarity, ids);
  } else if (ids.has(id)) {
    id = generateCustomAvatarId(id, gender, rarity, ids);
  } else {
    ids.add(id);
  }
  const characterFile = normalizeAvatarFileName(entry.characterFile || file);
  return {
    id,
    name: name || id,
    gender,
    rarity,
    file,
    characterFile,
    attributeBonus: AVATAR_RARITY_ATTRIBUTE_BONUS[rarity] || 0
  };
}

function normalizeAvatarCatalog(list = []) {
  const baseIds = new Set(BASE_AVATARS.map((avatar) => avatar.id));
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalizedEntry = normalizeAvatarCatalogEntry(entry, baseIds);
    if (normalizedEntry) {
      normalized.push(normalizedEntry);
    }
  });
  return normalized;
}

function registerCustomAvatars(list = [], options = {}) {
  const normalized = normalizeAvatarCatalog(list);
  if (!options || options.reset !== false) {
    CUSTOM_AVATAR_MAP.clear();
  }
  normalized.forEach((entry) => {
    CUSTOM_AVATAR_MAP.set(entry.id, entry);
  });
  refreshAvatarRegistry();
  return normalized;
}

function normalizeAvatarUnlocks(unlocks = []) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    const id = normalizeAvatarId(value);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(id);
  });
  return result;
}

function calculateAvatarAttributeBonus(unlocks = [], catalog = []) {
  const normalizedUnlocks = normalizeAvatarUnlocks(unlocks);
  if (!normalizedUnlocks.length) {
    return 0;
  }
  const customMap = new Map(normalizeAvatarCatalog(catalog).map((entry) => [entry.id, entry]));
  let total = 0;
  normalizedUnlocks.forEach((id) => {
    let rarity = null;
    if (customMap.has(id)) {
      rarity = customMap.get(id).rarity;
    } else {
      const meta = resolveAvatarMetaById(id);
      rarity = meta ? meta.rarity : null;
    }
    if (rarity && AVATAR_RARITY_ATTRIBUTE_BONUS[rarity]) {
      total += AVATAR_RARITY_ATTRIBUTE_BONUS[rarity];
    }
  });
  return total;
}

function ensureCustomAvatarsUnlocked(entries = [], unlocks = []) {
  const normalizedEntries = normalizeAvatarCatalog(entries);
  const unlockList = normalizeAvatarUnlocks(unlocks);
  const unlockSet = new Set(unlockList);
  let changed = false;
  normalizedEntries.forEach((entry) => {
    if (!unlockSet.has(entry.id)) {
      unlockSet.add(entry.id);
      unlockList.push(entry.id);
      changed = true;
    }
  });
  return changed ? unlockList : unlockList;
}

function buildAvatarImageUrlByFile(file) {
  const normalized = normalizeAvatarFileName(file);
  if (!normalized) {
    return '';
  }
  return `${AVATAR_IMAGE_BASE_PATH}/${normalized}.png`;
}

function buildCharacterImageUrlByFile(file) {
  const normalized = normalizeAvatarFileName(file);
  if (!normalized) {
    return '';
  }
  return `${CHARACTER_IMAGE_BASE_PATH}/${normalized}.png`;
}

function resolveAvatarIdByFile(file) {
  const normalized = normalizeAvatarFileName(file);
  if (!normalized) {
    return '';
  }
  return AVATAR_FILE_INDEX.get(normalized) || '';
}

module.exports = {
  RAW_AVATARS,
  AVATAR_RARITIES,
  AVATAR_RARITY_ATTRIBUTE_BONUS,
  buildAvatarId,
  listAvatarIds,
  registerCustomAvatars,
  normalizeAvatarCatalog,
  normalizeAvatarCatalogEntry,
  normalizeAvatarFileName,
  normalizeAvatarGender,
  normalizeAvatarRarity,
  normalizeAvatarUnlocks,
  resolveAvatarMetaById,
  listRegisteredAvatars,
  buildAvatarUrl,
  buildCharacterUrlById,
  buildAvatarImageUrlByFile,
  buildCharacterImageUrlByFile,
  resolveAvatarIdByFile,
  calculateAvatarAttributeBonus,
  ensureCustomAvatarsUnlocked
};
