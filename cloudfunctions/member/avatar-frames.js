const DEFAULT_AVATAR_FRAME_BASE_PATH = '/assets/border';
const DEFAULT_AVATAR_FRAME_IDS = ['1', '2', '3'];

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBasePath(basePath, fallback = DEFAULT_AVATAR_FRAME_BASE_PATH) {
  const trimmed = toTrimmedString(basePath);
  const fallbackTrimmed = toTrimmedString(fallback) || DEFAULT_AVATAR_FRAME_BASE_PATH;
  const normalized = (trimmed || fallbackTrimmed).replace(/\/+$/u, '');
  return normalized || DEFAULT_AVATAR_FRAME_BASE_PATH;
}

function buildFrameUrl(basePath, id) {
  const normalizedBase = normalizeBasePath(basePath);
  const trimmedId = toTrimmedString(id);
  if (!trimmedId) {
    return '';
  }
  return `${normalizedBase}/${trimmedId}.png`;
}

function ensureNormalizeHelper(frames = {}) {
  const fallbackBasePath = normalizeBasePath(frames.AVATAR_FRAME_BASE_PATH, DEFAULT_AVATAR_FRAME_BASE_PATH);
  const rawIds = Array.isArray(frames.AVATAR_FRAME_IDS) ? frames.AVATAR_FRAME_IDS : [];
  const normalizedIds = rawIds.map(toTrimmedString).filter(Boolean);
  const effectiveIds = normalizedIds.length ? normalizedIds : DEFAULT_AVATAR_FRAME_IDS;

  const rawUrls = Array.isArray(frames.AVATAR_FRAME_URLS) ? frames.AVATAR_FRAME_URLS : [];
  const normalizedUrls = rawUrls.map(toTrimmedString).filter(Boolean);
  const knownUrls = normalizedUrls.length
    ? normalizedUrls.slice()
    : effectiveIds.map((id) => buildFrameUrl(fallbackBasePath, id));
  const knownUrlSet = new Set(knownUrls);

  function rememberUrl(url) {
    const trimmed = toTrimmedString(url);
    if (trimmed && !knownUrlSet.has(trimmed)) {
      knownUrlSet.add(trimmed);
      knownUrls.push(trimmed);
    }
    return trimmed;
  }

  const fallbackBuildById = (id) => {
    const trimmedId = toTrimmedString(id);
    if (!trimmedId || !effectiveIds.includes(trimmedId)) {
      return '';
    }
    return rememberUrl(buildFrameUrl(fallbackBasePath, trimmedId));
  };

  const safeBuildById =
    typeof frames.buildAvatarFrameUrlById === 'function'
      ? (id) => {
          const built = frames.buildAvatarFrameUrlById(id);
          const trimmedBuilt = rememberUrl(built);
          if (trimmedBuilt) {
            return trimmedBuilt;
          }
          return fallbackBuildById(id);
        }
      : fallbackBuildById;

  const fallbackNormalize = (value) => {
    const trimmed = toTrimmedString(value);
    if (!trimmed) {
      return '';
    }
    if (knownUrlSet.has(trimmed)) {
      return trimmed;
    }
    return toTrimmedString(safeBuildById(trimmed));
  };

  const safeNormalize =
    typeof frames.normalizeAvatarFrameValue === 'function'
      ? (value) => {
          const normalized = rememberUrl(frames.normalizeAvatarFrameValue(value));
          if (normalized) {
            return normalized;
          }
          return fallbackNormalize(value);
        }
      : fallbackNormalize;

  const safeList =
    typeof frames.listAvatarFrameUrls === 'function'
      ? () => {
          const listed = frames.listAvatarFrameUrls();
          if (!Array.isArray(listed)) {
            return knownUrls.slice();
          }
          const collected = listed.map(rememberUrl).filter(Boolean);
          return collected.length ? collected : knownUrls.slice();
        }
      : () => knownUrls.slice();

  const safeIsValid =
    typeof frames.isValidAvatarFrameUrl === 'function'
      ? (value) => {
          if (frames.isValidAvatarFrameUrl(value)) {
            rememberUrl(value);
            return true;
          }
          const trimmed = toTrimmedString(value);
          if (!trimmed) {
            return false;
          }
          if (knownUrlSet.has(trimmed)) {
            return true;
          }
          return Boolean(toTrimmedString(safeBuildById(trimmed)));
        }
      : (value) => {
          const trimmed = toTrimmedString(value);
          if (!trimmed) {
            return false;
          }
          if (knownUrlSet.has(trimmed)) {
            return true;
          }
          return Boolean(toTrimmedString(safeBuildById(trimmed)));
        };

  return {
    ...frames,
    AVATAR_FRAME_BASE_PATH: fallbackBasePath,
    AVATAR_FRAME_IDS: effectiveIds,
    AVATAR_FRAME_URLS: knownUrls,
    listAvatarFrameUrls: safeList,
    buildAvatarFrameUrlById: safeBuildById,
    isValidAvatarFrameUrl: safeIsValid,
    normalizeAvatarFrameValue: safeNormalize
  };
}

function loadAvatarFrames() {
  const fallback = ensureNormalizeHelper();
  try {
    return ensureNormalizeHelper(require('../../miniprogram/shared/avatar-frames.js'));
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(error.message))) {
      try {
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
      } catch (sharedError) {
        if (
          sharedError &&
          (sharedError.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(sharedError.message))
        ) {
          return fallback;
        }
        throw sharedError;
      }
    }
    throw error;
  }
}

module.exports = loadAvatarFrames();
