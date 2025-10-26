const { TITLE_IMAGE_BASE_PATH } = require('./asset-paths.js');

const RAW_TITLES = [
  { id: 'title_refining_rookie', name: '炼气新人' }
];

const CUSTOM_TITLE_MAP = new Map();

function normalizeTitleImageFile(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let sanitized = value.trim();
  if (!sanitized) {
    return '';
  }
  sanitized = sanitized.replace(/\.png$/i, '');
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]+/g, '_');
  sanitized = sanitized.replace(/_{2,}/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized.toLowerCase();
}

function generateCustomTitleId(base, existingIds) {
  const normalizedBase = normalizeTitleImageFile(base) || 'title';
  const existing = existingIds || new Set();
  let candidate = normalizedBase.startsWith('title_') ? normalizedBase : `title_${normalizedBase}`;
  let suffix = 1;
  let finalId = candidate;
  while (existing.has(finalId)) {
    suffix += 1;
    finalId = `${candidate}_${suffix}`;
  }
  existing.add(finalId);
  return finalId;
}

function normalizeTitleCatalogEntry(entry, existingIds) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const ids = existingIds || new Set();
  let id = typeof entry.id === 'string' ? entry.id.trim() : '';
  let imageFile = normalizeTitleImageFile(entry.imageFile || entry.fileName || entry.file || id);
  if (!id) {
    id = generateCustomTitleId(imageFile || entry.name || '', ids);
  } else {
    id = normalizeTitleId(id);
    if (!id) {
      id = generateCustomTitleId(imageFile || entry.name || '', ids);
    }
  }
  if (ids.has(id)) {
    id = generateCustomTitleId(id, ids);
  }
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  imageFile = imageFile || id;
  if (!ids.has(id)) {
    ids.add(id);
  }
  const normalized = {
    id,
    name,
    imageFile
  };
  if (entry.createdAt) {
    normalized.createdAt = entry.createdAt;
  }
  if (entry.createdBy) {
    normalized.createdBy = entry.createdBy;
  }
  return normalized;
}

function normalizeTitleCatalog(list = []) {
  const workingIds = new Set(TITLES.map((item) => item.id));
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalizedEntry = normalizeTitleCatalogEntry(entry, workingIds);
    if (!normalizedEntry) {
      return;
    }
    normalized.push(normalizedEntry);
  });
  return normalized;
}

function normalizeTitleId(id) {
  if (typeof id !== 'string') {
    return '';
  }
  return id.trim();
}

function buildTitleImageUrl(id) {
  const normalized = normalizeTitleId(id);
  if (!normalized) {
    return '';
  }
  if (CUSTOM_TITLE_MAP.has(normalized)) {
    const definition = CUSTOM_TITLE_MAP.get(normalized);
    const imageFile = definition && definition.imageFile ? definition.imageFile : normalized;
    return `${TITLE_IMAGE_BASE_PATH}/${imageFile}.png`;
  }
  return `${TITLE_IMAGE_BASE_PATH}/${normalized}.png`;
}

function buildTitleImageUrlByFile(fileName) {
  const normalized = normalizeTitleImageFile(fileName);
  if (!normalized) {
    return '';
  }
  return `${TITLE_IMAGE_BASE_PATH}/${normalized}.png`;
}

function decorateTitle(definition) {
  if (!definition || !definition.id) {
    return null;
  }
  const normalized = normalizeTitleId(definition.id);
  if (!normalized) {
    return null;
  }
  return {
    ...definition,
    id: normalized,
    image: buildTitleImageUrl(normalized)
  };
}

const TITLES = RAW_TITLES.map((item) => decorateTitle(item)).filter(Boolean);
const TITLE_MAP = new Map(TITLES.map((item) => [item.id, item]));

function listTitles() {
  return TITLES.map((title) => ({ ...title }));
}

function resolveTitleById(id) {
  const normalized = normalizeTitleId(id);
  if (!normalized) {
    return null;
  }
  if (CUSTOM_TITLE_MAP.has(normalized)) {
    const matchedCustom = CUSTOM_TITLE_MAP.get(normalized);
    if (matchedCustom) {
      return { ...matchedCustom, image: buildTitleImageUrl(normalized) };
    }
  }
  if (TITLE_MAP.has(normalized)) {
    const matched = TITLE_MAP.get(normalized);
    return matched ? { ...matched } : null;
  }
  return {
    id: normalized,
    name: '神秘称号',
    image: buildTitleImageUrl(normalized)
  };
}

function registerCustomTitles(list = [], options = {}) {
  const normalized = normalizeTitleCatalog(list);
  if (!options || options.reset !== false) {
    CUSTOM_TITLE_MAP.clear();
  }
  normalized.forEach((entry) => {
    CUSTOM_TITLE_MAP.set(entry.id, {
      id: entry.id,
      name: entry.name,
      imageFile: entry.imageFile
    });
  });
  return normalized;
}

module.exports = {
  listTitles,
  resolveTitleById,
  buildTitleImageUrl,
  normalizeTitleId,
  TITLE_IMAGE_BASE_PATH,
  buildTitleImageUrlByFile,
  registerCustomTitles,
  normalizeTitleCatalog,
  normalizeTitleCatalogEntry,
  normalizeTitleImageFile,
  generateCustomTitleId
};
