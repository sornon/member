const AVATAR_FRAME_BASE_PATH = '/assets/border';
const AVATAR_FRAME_IDS = ['1', '2', '3'];

const AVATAR_FRAME_URLS = AVATAR_FRAME_IDS.map((id) => `${AVATAR_FRAME_BASE_PATH}/${id}.png`);

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
  return AVATAR_FRAME_URLS.includes(trimmed);
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
