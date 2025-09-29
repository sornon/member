const {
  AVATAR_FRAME_BASE_PATH,
  LEGACY_ASSET_BASE_PATH
} = require('./asset-paths.js');

const LEGACY_AVATAR_FRAME_BASE_PATH = `${LEGACY_ASSET_BASE_PATH}/border`;
const AVATAR_FRAME_IDS = ['1', '2', '3'];

const AVATAR_FRAME_URLS = AVATAR_FRAME_IDS.map((id) => `${AVATAR_FRAME_BASE_PATH}/${id}.png`);
const LEGACY_AVATAR_FRAME_URLS = AVATAR_FRAME_IDS.map((id) => `${LEGACY_AVATAR_FRAME_BASE_PATH}/${id}.png`);

const LEGACY_AVATAR_FRAME_URL_PATTERN = /^\/?assets\/border\/([1-9]\d*)\.png$/i;

function listAvatarFrameUrls() {
  return AVATAR_FRAME_URLS.slice();
}

function buildAvatarFrameUrlById(id) {
  if (typeof id !== 'string') {
    return '';
  }
  const trimmed = id.trim();
  if (!trimmed) {
    return '';
  }
  if (!AVATAR_FRAME_IDS.includes(trimmed)) {
    return '';
  }
  return `${AVATAR_FRAME_BASE_PATH}/${trimmed}.png`;
}

function isValidAvatarFrameUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  if (AVATAR_FRAME_URLS.includes(trimmed)) {
    return true;
  }
  if (LEGACY_AVATAR_FRAME_URLS.includes(trimmed)) {
    return true;
  }
  const match = trimmed.match(LEGACY_AVATAR_FRAME_URL_PATTERN);
  if (!match) {
    return false;
  }
  return AVATAR_FRAME_IDS.includes(match[1]);
}

function normalizeAvatarFrameValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (AVATAR_FRAME_URLS.includes(trimmed)) {
    return trimmed;
  }
  const legacyMatch = trimmed.match(LEGACY_AVATAR_FRAME_URL_PATTERN);
  if (legacyMatch && AVATAR_FRAME_IDS.includes(legacyMatch[1])) {
    return buildAvatarFrameUrlById(legacyMatch[1]);
  }
  const byId = buildAvatarFrameUrlById(trimmed);
  if (byId) {
    return byId;
  }
  return '';
}

module.exports = {
  AVATAR_FRAME_BASE_PATH,
  AVATAR_FRAME_IDS,
  AVATAR_FRAME_URLS,
  listAvatarFrameUrls,
  buildAvatarFrameUrlById,
  isValidAvatarFrameUrl,
  normalizeAvatarFrameValue
};
