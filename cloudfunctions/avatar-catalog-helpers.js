'use strict';

function createAvatarCatalogHelpers(options = {}) {
  const normalizeAvatarCatalogFromConfig = options.normalizeAvatarCatalog;
  const normalizeAvatarCatalogEntryFromConfig = options.normalizeAvatarCatalogEntry;
  const listAvatarIds = options.listAvatarIds;
  const normalizeAvatarGender = options.normalizeAvatarGender;
  const normalizeAvatarRarity = options.normalizeAvatarRarity;
  const normalizeAvatarFileName = options.normalizeAvatarFileName;
  const rarityBonusMap = options.AVATAR_RARITY_ATTRIBUTE_BONUS || {};

  const normalizeGender =
    typeof normalizeAvatarGender === 'function'
      ? normalizeAvatarGender
      : (value) => {
          const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
          if (normalized === 'female') {
            return 'female';
          }
          if (normalized === 'male') {
            return 'male';
          }
          return 'male';
        };

  const normalizeRarity =
    typeof normalizeAvatarRarity === 'function'
      ? normalizeAvatarRarity
      : () => 'c';

  const normalizeFileName =
    typeof normalizeAvatarFileName === 'function'
      ? normalizeAvatarFileName
      : (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

  function fallbackGenerateCustomAvatarId(base, gender, rarity, existingIds) {
    const ids = existingIds || new Set();
    const normalizedBase = normalizeFileName(base);
    const slug = normalizedBase || 'custom';
    let candidate = `${gender}-${rarity}-${slug}`;
    let suffix = 1;
    while (ids.has(candidate)) {
      suffix += 1;
      candidate = `${gender}-${rarity}-${slug}-${suffix}`;
    }
    ids.add(candidate);
    return candidate;
  }

  function fallbackNormalizeAvatarCatalogEntry(entry, existingIds) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const ids = existingIds || new Set();
    const gender = normalizeGender(entry.gender);
    const rarity = normalizeRarity(entry.rarity);
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
    const file = normalizeFileName(entry.file || entry.fileName || entry.avatarFile || entry.id || entry.name);
    if (!file) {
      return null;
    }
    let id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
    if (!id || ids.has(id)) {
      id = fallbackGenerateCustomAvatarId(id || file, gender, rarity, ids);
    } else {
      ids.add(id);
    }
    const characterFile = normalizeFileName(entry.characterFile || file);
    const attributeBonus = rarityBonusMap && rarityBonusMap[rarity] ? rarityBonusMap[rarity] : 0;
    return {
      id,
      name: name || id,
      gender,
      rarity,
      file,
      characterFile,
      attributeBonus
    };
  }

  function fallbackNormalizeAvatarCatalog(list = []) {
    const baseIdsSource = typeof listAvatarIds === 'function' ? listAvatarIds() : [];
    const baseIds = new Set(Array.isArray(baseIdsSource) ? baseIdsSource : []);
    const normalized = [];
    (Array.isArray(list) ? list : []).forEach((entry) => {
      let normalizedEntry = null;
      if (typeof normalizeAvatarCatalogEntryFromConfig === 'function') {
        normalizedEntry = normalizeAvatarCatalogEntryFromConfig(entry, baseIds);
      } else {
        normalizedEntry = fallbackNormalizeAvatarCatalogEntry(entry, baseIds);
      }
      if (normalizedEntry) {
        normalized.push(normalizedEntry);
      }
    });
    return normalized;
  }

  const normalizeAvatarCatalog =
    typeof normalizeAvatarCatalogFromConfig === 'function'
      ? normalizeAvatarCatalogFromConfig
      : fallbackNormalizeAvatarCatalog;

  return {
    normalizeAvatarCatalog,
    fallbackNormalizeAvatarCatalog,
    fallbackNormalizeAvatarCatalogEntry
  };
}

module.exports = {
  createAvatarCatalogHelpers
};
