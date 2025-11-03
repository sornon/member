const {
  listRegisteredAvatars,
  normalizeAvatarUnlocks: normalizeAvatarUnlocksShared,
  buildAvatarUrl,
  registerCustomAvatars,
  normalizeAvatarCatalog,
  resolveAvatarMetaById,
  buildAvatarImageUrlByFile,
  normalizeAvatarFileName: normalizeAvatarFileNameShared
} = require('../shared/avatar-catalog.js');

const AVATAR_GENDER_LABELS = {
  male: '男',
  female: '女'
};

const DEFAULT_RARITY = 'c';

const RARITY_LABELS = {
  c: 'C',
  b: 'B',
  a: 'A',
  s: 'S',
  ss: 'SS',
  sss: 'SSS'
};

const RARITY_ORDER = ['c', 'b', 'a', 's', 'ss', 'sss'];

function padIndex(index) {
  return index < 10 ? `0${index}` : `${index}`;
}

function buildAvatarName(meta = {}) {
  if (meta && typeof meta.name === 'string' && meta.name.trim()) {
    return meta.name.trim();
  }
  const genderLabel = AVATAR_GENDER_LABELS[meta.gender] || '通用';
  const rarityLabel = RARITY_LABELS[meta.rarity] || (meta.rarity || '').toUpperCase();
  const index = Number(meta.index);
  if (Number.isFinite(index) && index > 0) {
    return `${genderLabel} · ${rarityLabel} · ${padIndex(index)}`;
  }
  return `${genderLabel} · ${rarityLabel}`;
}

function compareAvatars(a, b) {
  if (a.gender !== b.gender) {
    return a.gender > b.gender ? 1 : -1;
  }
  if (a.rarity !== b.rarity) {
    const diff = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
    if (diff !== 0) {
      return diff;
    }
  }
  const indexA = Number(a.index) || 0;
  const indexB = Number(b.index) || 0;
  return indexA - indexB;
}

function mapAvatarMeta(meta) {
  const url = buildAvatarUrl(meta.id);
  return {
    ...meta,
    name: buildAvatarName(meta),
    url
  };
}

export function listAllAvatars() {
  const metas = listRegisteredAvatars();
  const mapped = metas.map((meta) => mapAvatarMeta(meta));
  return mapped.sort(compareAvatars);
}

export function isValidAvatarId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  const normalized = id.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !!resolveAvatarMetaById(normalized);
}

function resolveGenders(gender) {
  if (gender === 'male' || gender === 'female') {
    return [gender];
  }
  return ['male', 'female'];
}

export const normalizeAvatarUnlocks = normalizeAvatarUnlocksShared;

export function listAvatarsByGender(gender) {
  const genders = resolveGenders(gender);
  return listAllAvatars().filter((avatar) => genders.includes(avatar.gender));
}

export function getDefaultAvatarId(gender) {
  const avatars = listAvatarsByGender(gender).filter((avatar) => avatar.rarity === DEFAULT_RARITY);
  const candidate = avatars[0] || listAllAvatars().find((avatar) => avatar.rarity === DEFAULT_RARITY);
  return candidate ? candidate.id : '';
}

export function getAvailableAvatars({ gender = 'unknown', unlocks = [] } = {}) {
  const genders = resolveGenders(gender);
  const unlockSet = new Set(normalizeAvatarUnlocks(unlocks));
  const filtered = listAllAvatars().filter((avatar) => {
    if (!genders.includes(avatar.gender)) {
      return false;
    }
    if (avatar.rarity === DEFAULT_RARITY) {
      return true;
    }
    return unlockSet.has(avatar.id);
  });
  return filtered;
}

export function resolveAvatarById(id) {
  if (!id) {
    return null;
  }
  const meta = resolveAvatarMetaById(id);
  return meta ? mapAvatarMeta(meta) : null;
}

export function buildAvatarUrlById(id) {
  if (!isValidAvatarId(id)) {
    return '';
  }
  return buildAvatarUrl(id);
}

export function buildAvatarUrlByFile(file) {
  return buildAvatarImageUrlByFile(file);
}

export function normalizeAvatarFileName(value) {
  return normalizeAvatarFileNameShared(value);
}

export const AVATAR_DEFAULT_RARITY = DEFAULT_RARITY;
export const AVATAR_RARITY_ORDER = RARITY_ORDER.slice();

export { registerCustomAvatars, normalizeAvatarCatalog };
