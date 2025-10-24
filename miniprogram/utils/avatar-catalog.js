const { RAW_AVATARS, buildAvatarId, listAvatarIds } = require('../shared/avatar-catalog.js');

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

const RARITY_ORDER = ['c', 'b', 'a', 's', 'sss'];

const ALLOWED_AVATAR_IDS = new Set(listAvatarIds());

function padIndex(index) {
  return index < 10 ? `0${index}` : `${index}`;
}

function buildAvatarName({ gender, rarity, index }) {
  const genderLabel = AVATAR_GENDER_LABELS[gender] || '通用';
  const rarityLabel = RARITY_LABELS[rarity] || rarity.toUpperCase();
  return `${genderLabel} · ${rarityLabel} · ${padIndex(index)}`;
}

function buildAvatarUrl(id) {
  return `/assets/avatar/${id}.png`;
}

export const AVATAR_CATALOG = RAW_AVATARS.map((item) => {
  const id = buildAvatarId(item);
  return {
    ...item,
    id,
    name: buildAvatarName(item),
    url: buildAvatarUrl(id)
  };
});

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
  return a.index - b.index;
}

export const SORTED_AVATARS = AVATAR_CATALOG.slice().sort(compareAvatars);

export function listAllAvatars() {
  return SORTED_AVATARS.slice();
}

export function isValidAvatarId(id) {
  return typeof id === 'string' && ALLOWED_AVATAR_IDS.has(id);
}

function resolveGenders(gender) {
  if (gender === 'male' || gender === 'female') {
    return [gender];
  }
  return ['male', 'female'];
}

export function normalizeAvatarUnlocks(unlocks) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || !isValidAvatarId(trimmed) || seen.has(trimmed)) {
      return;
    }
    if (!AVATAR_CATALOG.some((avatar) => avatar.id === trimmed)) {
      return;
    }
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

export function listAvatarsByGender(gender) {
  const genders = resolveGenders(gender);
  return SORTED_AVATARS.filter((avatar) => genders.includes(avatar.gender));
}

export function getDefaultAvatarId(gender) {
  const avatars = listAvatarsByGender(gender).filter((avatar) => avatar.rarity === DEFAULT_RARITY);
  const candidate = avatars[0] || SORTED_AVATARS.find((avatar) => avatar.rarity === DEFAULT_RARITY);
  return candidate ? candidate.id : '';
}

export function getAvailableAvatars({ gender = 'unknown', unlocks = [] } = {}) {
  const genders = resolveGenders(gender);
  const unlockSet = new Set(normalizeAvatarUnlocks(unlocks));
  const filtered = SORTED_AVATARS.filter((avatar) => {
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
  return SORTED_AVATARS.find((avatar) => avatar.id === id) || null;
}

export function buildAvatarUrlById(id) {
  if (!isValidAvatarId(id)) {
    return '';
  }
  return buildAvatarUrl(id);
}

export const AVATAR_DEFAULT_RARITY = DEFAULT_RARITY;
export const AVATAR_RARITY_ORDER = RARITY_ORDER.slice();
