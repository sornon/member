const FIGURE_SCALE_CLASS_MAP = {
  s: 'figure-scale--s',
  ss: 'figure-scale--ss',
  sss: 'figure-scale--sss'
};

function normalizeFigureRarity(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(FIGURE_SCALE_CLASS_MAP, normalized)) {
    return normalized;
  }
  if (normalized.includes('sss')) {
    return 'sss';
  }
  if (normalized.includes('ss')) {
    return 'ss';
  }
  if (normalized.includes('s')) {
    return 's';
  }
  return '';
}

function resolveFigureScaleClassByRarity(value) {
  const rarity = normalizeFigureRarity(value);
  if (!rarity) {
    return '';
  }
  return FIGURE_SCALE_CLASS_MAP[rarity] || '';
}

module.exports = {
  FIGURE_SCALE_CLASS_MAP,
  normalizeFigureRarity,
  resolveFigureScaleClassByRarity
};
