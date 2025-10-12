function ensureNormalizeHelper(frames) {
  const {
    AVATAR_FRAME_BASE_PATH: basePath = '/assets/border',
    AVATAR_FRAME_IDS: frameIds = [],
    AVATAR_FRAME_URLS: frameUrls = [],
    buildAvatarFrameUrlById,
    normalizeAvatarFrameValue
  } = frames;

  const normalizedUrls = Array.isArray(frameUrls)
    ? frameUrls.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
  const normalizedIds = Array.isArray(frameIds)
    ? frameIds.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
  const safeBasePath = typeof basePath === 'string' ? basePath : '/assets/border';

  const safeBuildById =
    typeof buildAvatarFrameUrlById === 'function'
      ? buildAvatarFrameUrlById
      : (id) => {
          if (typeof id !== 'string') {
            return '';
          }
          const trimmed = id.trim();
          if (!trimmed) {
            return '';
          }
          if (!normalizedIds.includes(trimmed)) {
            return '';
          }
          return `${safeBasePath}/${trimmed}.png`;
        };

  const safeNormalize =
    typeof normalizeAvatarFrameValue === 'function'
      ? normalizeAvatarFrameValue
      : (value) => {
          if (typeof value !== 'string') {
            return '';
          }
          const trimmed = value.trim();
          if (!trimmed) {
            return '';
          }
          if (normalizedUrls.includes(trimmed)) {
            return trimmed;
          }
          const byId = safeBuildById(trimmed);
          if (byId) {
            return byId;
          }
          return '';
        };

  return {
    ...frames,
    buildAvatarFrameUrlById: safeBuildById,
    normalizeAvatarFrameValue: safeNormalize
  };
}

function loadAvatarFrames() {
  try {
    return ensureNormalizeHelper(require('../../miniprogram/shared/avatar-frames.js'));
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      const frames = require('common-config');
      const {
        AVATAR_FRAME_BASE_PATH,
        AVATAR_FRAME_IDS,
        AVATAR_FRAME_URLS,
        listAvatarFrameUrls,
        buildAvatarFrameUrlById,
        isValidAvatarFrameUrl,
        normalizeAvatarFrameValue
      } = frames;
      return ensureNormalizeHelper({
        AVATAR_FRAME_BASE_PATH,
        AVATAR_FRAME_IDS,
        AVATAR_FRAME_URLS,
        listAvatarFrameUrls,
        buildAvatarFrameUrlById,
        isValidAvatarFrameUrl,
        normalizeAvatarFrameValue
      });
    }
    throw error;
  }
}

module.exports = loadAvatarFrames();
