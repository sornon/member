function loadMenu() {
  try {
    return require('../../miniprogram/shared/menu.js');
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      return require('./menu.local.js');
    }
    throw error;
  }
}

module.exports = loadMenu();
