const { listAvatarIds } = require('../member/avatar-catalog.js');

const DEFAULT_CHARACTER_IMAGE_BASE_PATH =
  'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets/character';

function loadCharacterImageBasePath() {
  try {
    const assetPaths = require('../../miniprogram/shared/asset-paths.js');
    if (assetPaths && assetPaths.CHARACTER_IMAGE_BASE_PATH) {
      return assetPaths.CHARACTER_IMAGE_BASE_PATH;
    }
  } catch (error) {
    if (!(error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message)))) {
      throw error;
    }
  }
  return DEFAULT_CHARACTER_IMAGE_BASE_PATH;
}

const CHARACTER_IMAGE_BASE_PATH = loadCharacterImageBasePath();

const AVATAR_URL_PATTERN = /\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png(?:\?.*)?$/i;

const ALLOWED_AVATAR_IDS = new Set(
  listAvatarIds()
    .map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
    .filter(Boolean)
);

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const match = url.trim().toLowerCase().match(AVATAR_URL_PATTERN);
  if (!match) {
    return '';
  }
  const avatarId = match[1];
  return ALLOWED_AVATAR_IDS.has(avatarId) ? avatarId : '';
}

function resolveCharacterPortraitFromAvatarUrl(url) {
  const avatarId = extractAvatarIdFromUrl(url);
  if (!avatarId) {
    return '';
  }
  return `${CHARACTER_IMAGE_BASE_PATH}/${avatarId}.png`;
}

function normalizePortraitUrl(candidate) {
  if (!candidate) {
    return '';
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return '';
    }
    const portrait = resolveCharacterPortraitFromAvatarUrl(trimmed);
    return portrait || trimmed;
  }
  if (typeof candidate === 'object') {
    const directPortrait = normalizePortraitUrl(candidate.portrait);
    if (directPortrait) {
      return directPortrait;
    }
    return normalizePortraitUrl(candidate.avatarUrl);
  }
  return '';
}

function pickPortraitUrl(...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const resolved = normalizePortraitUrl(candidates[i]);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

module.exports = {
  CHARACTER_IMAGE_BASE_PATH,
  resolveCharacterPortraitFromAvatarUrl,
  normalizePortraitUrl,
  pickPortraitUrl,
  extractAvatarIdFromUrl
};
