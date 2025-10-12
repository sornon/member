function loadAvatarFrames() {
  try {
    return require('../../miniprogram/shared/avatar-frames.js');
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      const {
        AVATAR_FRAME_BASE_PATH,
        AVATAR_FRAME_IDS,
        AVATAR_FRAME_URLS,
        listAvatarFrameUrls,
        buildAvatarFrameUrlById,
        isValidAvatarFrameUrl,
        normalizeAvatarFrameValue
      } = require('common-config');
      return {
        AVATAR_FRAME_BASE_PATH,
        AVATAR_FRAME_IDS,
        AVATAR_FRAME_URLS,
        listAvatarFrameUrls,
        buildAvatarFrameUrlById,
        isValidAvatarFrameUrl,
        normalizeAvatarFrameValue
      };
    }
    throw error;
  }
}

module.exports = loadAvatarFrames();
