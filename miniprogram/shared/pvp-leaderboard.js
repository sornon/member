const { normalizeAvatarFrameValue } = require('./avatar-frames');
const { AVATAR_IMAGE_BASE_PATH } = require('./asset-paths.js');
const {
  buildTitleImageUrl,
  registerCustomTitles,
  normalizeTitleCatalog
} = require('./titles.js');

const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function decorateLeaderboardEntries(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const registerTitles = options && options.registerTitles !== false;
  const sanitized = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const normalizedFrame = normalizeAvatarFrameValue(entry.avatarFrame || '');
    const avatarUrl = toTrimmedString(entry.avatarUrl) || DEFAULT_AVATAR;
    const titleId = toTrimmedString(entry.titleId);
    const titleCatalog = normalizeTitleCatalog(entry.titleCatalog);
    return {
      ...entry,
      avatarFrame: normalizedFrame || '',
      avatarUrl,
      titleId,
      titleCatalog
    };
  });
  if (registerTitles) {
    const catalogEntries = [];
    const catalogSeen = new Set();
    sanitized.forEach((entry) => {
      if (!entry || !Array.isArray(entry.titleCatalog)) {
        return;
      }
      entry.titleCatalog.forEach((item) => {
        if (!item || !item.id || catalogSeen.has(item.id)) {
          return;
        }
        catalogSeen.add(item.id);
        catalogEntries.push({ ...item });
      });
    });
    if (catalogEntries.length) {
      registerCustomTitles(catalogEntries, { reset: false });
    }
  }
  return sanitized.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const titleImage = entry.titleId ? buildTitleImageUrl(entry.titleId) : '';
    return {
      ...entry,
      titleImage
    };
  });
}

module.exports = {
  decorateLeaderboardEntries,
  DEFAULT_AVATAR
};
