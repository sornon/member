function loadAvatarFrames() {
  try {
    return require('../../miniprogram/shared/avatar-frames.js');
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      return require('./avatar-frames.local.js');
    }
    throw error;
  }
}

module.exports = loadAvatarFrames();
