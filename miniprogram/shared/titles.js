const { TITLE_IMAGE_BASE_PATH } = require('./asset-paths.js');

const RAW_TITLES = [
  { id: 'title_refining_rookie', name: '炼气新人' }
];

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

module.exports = {
  listTitles,
  resolveTitleById,
  buildTitleImageUrl,
  normalizeTitleId,
  TITLE_IMAGE_BASE_PATH
};
