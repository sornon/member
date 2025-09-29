function loadAvatarCatalog() {
  try {
    return require('../../miniprogram/shared/avatar-catalog.js');
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      return require('./avatar-catalog.local.js');
    }
    throw error;
  }
}

module.exports = loadAvatarCatalog();
