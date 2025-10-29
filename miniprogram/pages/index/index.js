import { AdminService, MemberService, TaskService } from '../../services/api';
import { setActiveMember, subscribe as subscribeMemberRealtime } from '../../services/member-realtime';
import { formatCombatPower, formatCurrency, formatExperience, formatStones } from '../../utils/format';
import { shouldShowRoleBadge } from '../../utils/pending-attributes';
import { hasUnacknowledgedStorageItems } from '../../utils/storage-notifications';
import { applyCacheVersionUpdate } from '../../utils/cache-version.js';
const { resolveVideoPosterSource } = require('../../utils/media');
import {
  buildAvatarUrlById,
  getAvailableAvatars,
  getDefaultAvatarId,
  normalizeAvatarUnlocks,
  resolveAvatarById
} from '../../utils/avatar-catalog';
const { listAvatarFrameUrls, normalizeAvatarFrameValue } = require('../../shared/avatar-frames.js');
const {
  listBackgrounds,
  normalizeBackgroundId,
  resolveBackgroundById,
  resolveBackgroundByRealmName,
  resolveHighestUnlockedBackgroundByRealmOrder,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  registerCustomBackgrounds,
  normalizeBackgroundCatalog
} = require('../../shared/backgrounds.js');
const {
  AVATAR_IMAGE_BASE_PATH,
  CHARACTER_IMAGE_BASE_PATH,
  buildCloudAssetUrl
} = require('../../shared/asset-paths.js');
const {
  buildTitleImageUrl,
  resolveTitleById,
  normalizeTitleId,
  registerCustomTitles,
  normalizeTitleCatalog
} = require('../../shared/titles.js');
const {
  listAvatarIds: listAllAvatarIds,
  resolveAvatarMetaById
} = require('../../shared/avatar-catalog.js');
const {
  resolveFigureScaleClassByRarity,
  normalizeFigureRarity
} = require('../../shared/figure-scale');
const { SHARE_COVER_IMAGE_URL } = require('../../shared/common.js');

const DEFAULT_GLOBAL_BACKGROUND = { enabled: false, backgroundId: '', animated: false };

function buildCharacterImageMap() {
  const ids = listAllAvatarIds();
  return ids.reduce((acc, id) => {
    acc[id] = `${CHARACTER_IMAGE_BASE_PATH}/${id}.png`;
    return acc;
  }, {});
}

const CHARACTER_IMAGE_MAP = buildCharacterImageMap();

const DEFAULT_CHARACTER_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/default.png`;
const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;
const STARTUP_COVER_IMAGE = '/cover-20251028.jpg';
const STARTUP_VIDEO_SOURCE = buildCloudAssetUrl('background', 'cover-20251028.mp4');
const STARTUP_VIDEO_FADE_OUT_AT_SECONDS = 5;
const STARTUP_VIDEO_FADE_DURATION_MS = 1000;

const AVATAR_URL_PATTERN = /\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png(?:\?.*)?$/;
const CHARACTER_URL_PATTERN = /\/assets\/character\/((male|female)-[a-z]+-\d+)\.png(?:\?.*)?$/;
const WECHAT_DEFAULT_AVATAR_URL =
  'https://thirdwx.qlogo.cn/mmopen/vi_32/POgEwh4mIHO4nibH0KlMECNjjGxQUq24ZEaGT4poC6icRiccVGKSyXwibcPq4BWmiaIGuG1icwxaQX6grC9VemZoJ8rg/132';

const app = getApp();

const NAV_EXPANDED_STORAGE_KEY = 'home-nav-expanded';
const AVATAR_BADGE_STORAGE_KEY = 'home-avatar-badge-dismissed';
const AVATAR_TAB_BADGE_STORAGE_KEY = 'home-avatar-tab-badges';
const NAME_BADGE_STORAGE_KEY = 'home-name-badge-dismissed';
const HOME_ENTRIES_STORAGE_KEY = 'home-entries-visibility';
const PROXY_LOGOUT_ACTION = 'proxyLogout';

const APPEARANCE_BADGE_TABS = ['avatar', 'frame', 'title', 'background'];

function cloneDefaultAppearanceBadgeState() {
  return {
    avatar: false,
    frame: false,
    title: false,
    background: false
  };
}

function normalizeAppearanceBadgeState(source) {
  const base = cloneDefaultAppearanceBadgeState();
  if (!source || typeof source !== 'object') {
    return base;
  }
  APPEARANCE_BADGE_TABS.forEach((key) => {
    if (source[key] === true) {
      base[key] = true;
    }
  });
  return base;
}

function markAllAppearanceBadgesDismissed() {
  const state = cloneDefaultAppearanceBadgeState();
  APPEARANCE_BADGE_TABS.forEach((key) => {
    state[key] = true;
  });
  return state;
}

function areAllAppearanceBadgesDismissed(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }
  return APPEARANCE_BADGE_TABS.every((key) => state[key] === true);
}

function resolveStorageBadgeVisibility() {
  try {
    return hasUnacknowledgedStorageItems();
  } catch (error) {
    console.warn('[home] resolve storage badge failed', error);
    return false;
  }
}

function resolveBackgroundUnlocks(source) {
  if (!source) {
    return [];
  }
  if (Array.isArray(source.backgroundUnlocks)) {
    return source.backgroundUnlocks.filter((id) => typeof id === 'string' && id.trim());
  }
  return [];
}

function resolveTitleUnlocks(source) {
  if (!source) {
    return [];
  }
  let rawUnlocks = [];
  if (Array.isArray(source.titleUnlocks)) {
    rawUnlocks = source.titleUnlocks;
  } else if (source.extras && Array.isArray(source.extras.titleUnlocks)) {
    rawUnlocks = source.extras.titleUnlocks;
  }
  const result = [];
  rawUnlocks.forEach((id) => {
    const normalized = normalizeTitleId(id);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  });
  return result;
}

function buildTitleOptionList(member) {
  const unlocks = resolveTitleUnlocks(member);
  const options = [
    { id: '', name: '无称号', image: '' }
  ];
  unlocks.forEach((titleId) => {
    const definition = resolveTitleById(titleId);
    const name = definition && definition.name ? definition.name : '神秘称号';
    const image = buildTitleImageUrl(titleId);
    options.push({
      id: titleId,
      name,
      image
    });
  });
  return options;
}

function resolveActiveTitleId(member, desiredId) {
  const normalized = normalizeTitleId(desiredId || '');
  if (!normalized) {
    return '';
  }
  const unlocks = resolveTitleUnlocks(member);
  if (unlocks.includes(normalized)) {
    return normalized;
  }
  return '';
}

const BASE_NAV_ITEMS = [
  { icon: '💰', label: '钱包', url: '/pages/wallet/wallet' },
  { icon: '🍽️', label: '点餐', url: '/pages/membership/order/index' },
  { icon: '📅', label: '预订', url: '/pages/reservation/reservation' },
  //{ icon: '⚔️', label: '比武', url: '/pages/pvp/index' },
  { icon: '🧝', label: '角色', url: '/pages/role/index?tab=character' },
  { icon: '🛡️', label: '装备', url: '/pages/role/index?tab=equipment' },
  { icon: '💍', label: '纳戒', url: '/pages/role/index?tab=storage' },
  { icon: '📜', label: '技能', url: '/pages/role/index?tab=skill' }
  //{ icon: '🧙‍♀️', label: '造型', url: '/pages/avatar/avatar' }
];

const HOME_ENTRY_ITEMS = [
  { key: 'activities', icon: '🎉', label: '活动', url: '/pages/activities/index' },
  { key: 'mall', icon: '🏪', label: '商城', url: '/pages/mall/index' },
  { key: 'secretRealm', icon: '⚔️', label: '秘境', url: '/pages/pve/pve' },
  { key: 'rights', icon: '🎫', label: '权益', url: '/pages/rights/rights' },
  { key: 'pvp', icon: '🥊', label: '比武', url: '/pages/pvp/index' },
  { key: 'trading', icon: '⚖️', label: '交易', url: '/pages/trading/index' }
];

const DEFAULT_HOME_ENTRY_VISIBILITY = Object.freeze({
  activities: true,
  mall: true,
  secretRealm: false,
  rights: true,
  pvp: false,
  trading: false
});

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return toBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function normalizeHomeEntryVisibility(source) {
  const base = source && typeof source === 'object' ? source : {};
  return HOME_ENTRY_ITEMS.reduce((acc, item) => {
    const defaultValue = DEFAULT_HOME_ENTRY_VISIBILITY[item.key];
    acc[item.key] = toBoolean(base[item.key], defaultValue);
    return acc;
  }, {});
}

function loadCachedHomeEntryVisibility() {
  try {
    const cached = wx.getStorageSync(HOME_ENTRIES_STORAGE_KEY);
    if (!cached) {
      return null;
    }
    if (typeof cached === 'string') {
      try {
        const parsed = JSON.parse(cached);
        return normalizeHomeEntryVisibility(parsed);
      } catch (error) {
        return null;
      }
    }
    return normalizeHomeEntryVisibility(cached);
  } catch (error) {
    console.warn('[index] load cached home entries failed', error);
    return null;
  }
}

function persistHomeEntryVisibility(visibility) {
  try {
    const normalized = normalizeHomeEntryVisibility(visibility);
    wx.setStorageSync(HOME_ENTRIES_STORAGE_KEY, normalized);
    return true;
  } catch (error) {
    console.warn('[index] persist home entries failed', error);
    return false;
  }
}

function buildHomeActivityIcons(visibility) {
  const normalized = normalizeHomeEntryVisibility(visibility);
  return HOME_ENTRY_ITEMS.filter((item) => normalized[item.key] !== false).map((item) => ({
    icon: item.icon,
    label: item.label,
    url: item.url
  }));
}

const DEFAULT_ACTIVITY_ICONS = buildHomeActivityIcons(DEFAULT_HOME_ENTRY_VISIBILITY);

function buildDefaultNavItems() {
  const showRoleDot = shouldShowRoleBadge(null);
  const showStorageDot = resolveStorageBadgeVisibility();
  return BASE_NAV_ITEMS.map((item) => {
    if (item.label === '角色') {
      return { ...item, showDot: showRoleDot };
    }
    if (item.label === '纳戒') {
      return { ...item, showDot: showStorageDot };
    }
    return { ...item };
  });
}

const INITIAL_NAV_ITEMS = buildDefaultNavItems();

const ADMIN_ALLOWED_ROLES = ['admin', 'developer'];

function buildCollapsedNavItems(navItems) {
  const source = Array.isArray(navItems) && navItems.length ? navItems : BASE_NAV_ITEMS;
  if (!source.length) {
    return [];
  }

  const MAX_ITEMS = 3;
  const selected = [];
  const seen = new Set();
  const exitItem = source.find((item) => item && item.action === PROXY_LOGOUT_ACTION);
  const maxRegularItems = exitItem ? Math.max(0, MAX_ITEMS - 1) : MAX_ITEMS;

  const tryAdd = (item) => {
    if (!item || seen.has(item.label) || selected.length >= maxRegularItems) {
      return;
    }
    selected.push(item);
    seen.add(item.label);
  };

  source.forEach((item) => {
    if (item && item.showDot) {
      tryAdd(item);
    }
  });

  if (selected.length < MAX_ITEMS) {
    source.forEach((item) => {
      tryAdd(item);
    });
  }

  if (exitItem && !seen.has(exitItem.label)) {
    selected.push(exitItem);
  }

  return selected.slice(0, MAX_ITEMS);
}

const AVATAR_FRAME_OPTIONS = buildAvatarFrameOptionList();

function resolveRealmOrderFromLevel(level) {
  if (!level) {
    return 1;
  }
  if (typeof level.realmOrder === 'number' && Number.isFinite(level.realmOrder)) {
    return Math.max(1, Math.floor(level.realmOrder));
  }
  if (typeof level.order === 'number' && Number.isFinite(level.order)) {
    return Math.max(1, Math.floor((level.order - 1) / 10) + 1);
  }
  if (typeof level.realm === 'string') {
    const matched = resolveBackgroundByRealmName(level.realm);
    if (matched) {
      return matched.realmOrder;
    }
  }
  return 1;
}

function isMemberAdmin(member) {
  if (!member) {
    return false;
  }
  const roles = Array.isArray(member.roles) ? member.roles : [];
  return roles.some((role) => ADMIN_ALLOWED_ROLES.includes(role));
}

function resolveMemberRealmOrder(member) {
  if (!member) {
    return 1;
  }
  if (member.level) {
    return resolveRealmOrderFromLevel(member.level);
  }
  if (typeof member.levelRealmOrder === 'number' && Number.isFinite(member.levelRealmOrder)) {
    return Math.max(1, Math.floor(member.levelRealmOrder));
  }
  if (typeof member.realmOrder === 'number' && Number.isFinite(member.realmOrder)) {
    return Math.max(1, Math.floor(member.realmOrder));
  }
  if (member.appearanceBackground) {
    const background = resolveBackgroundById(normalizeBackgroundId(member.appearanceBackground));
    if (background) {
      return background.realmOrder;
    }
  }
  return 1;
}

function resolvePreferredBackground(member) {
  const realmOrder = resolveMemberRealmOrder(member);
  const desiredId = normalizeBackgroundId(member && member.appearanceBackground);
  const backgroundUnlocks = resolveBackgroundUnlocks(member);
  if (desiredId && isBackgroundUnlocked(desiredId, realmOrder, backgroundUnlocks)) {
    const desired = resolveBackgroundById(desiredId);
    if (desired) {
      return desired;
    }
  }
  const manualUnlocked = backgroundUnlocks
    .map((id) => resolveBackgroundById(id))
    .filter((background) => background && background.unlockType === 'manual');
  if (manualUnlocked.length) {
    manualUnlocked.sort((a, b) => (a.realmOrder || 0) - (b.realmOrder || 0));
    let candidate = null;
    manualUnlocked.forEach((background) => {
      if (!background) {
        return;
      }
      if (background.realmOrder && background.realmOrder <= realmOrder) {
        candidate = background;
      }
    });
    if (!candidate) {
      candidate = manualUnlocked[manualUnlocked.length - 1];
    }
    if (candidate) {
      return candidate;
    }
  }
  const fallback = resolveHighestUnlockedBackgroundByRealmOrder(realmOrder);
  if (fallback) {
    return fallback;
  }
  return resolveBackgroundById(getDefaultBackgroundId());
}

function resolveBackgroundMediaSources(member) {
  const background = resolvePreferredBackground(member);
  const fallback = resolveBackgroundById(getDefaultBackgroundId());
  const imageSource = background && background.image ? background.image : fallback && fallback.image ? fallback.image : '';
  const videoSource = background && background.video ? background.video : '';
  return {
    image: imageSource,
    video: videoSource,
    background
  };
}

function resolveBackgroundImage(member) {
  const { image } = resolveBackgroundMediaSources(member);
  return image;
}

function resolveBackgroundVideo(member) {
  const { video } = resolveBackgroundMediaSources(member);
  return video;
}

function normalizeGlobalBackgroundConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ...DEFAULT_GLOBAL_BACKGROUND };
  }
  const normalized = { ...DEFAULT_GLOBAL_BACKGROUND };
  normalized.enabled = !!config.enabled;
  const candidates = [config.backgroundId, config.id, config.background];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = typeof candidates[i] === 'string' ? candidates[i].trim() : '';
    if (!value) {
      continue;
    }
    const sanitized = normalizeBackgroundId(value);
    if (sanitized) {
      normalized.backgroundId = sanitized;
      break;
    }
  }
  normalized.animated = !!config.animated;
  return normalized;
}

function cloneGlobalBackgroundConfig(config) {
  const normalized = normalizeGlobalBackgroundConfig(config);
  return {
    enabled: normalized.enabled,
    backgroundId: normalized.backgroundId,
    animated: normalized.animated
  };
}

function resolveBackgroundDisplay(member) {
  const { image, video } = resolveBackgroundMediaSources(member);
  return {
    image,
    video,
    dynamicEnabled: !!(member && member.appearanceBackgroundAnimated)
  };
}

function resolveEffectiveBackgroundDisplay(member, globalBackground) {
  const override = cloneGlobalBackgroundConfig(globalBackground);
  if (override.enabled) {
    let targetId = override.backgroundId;
    if (!targetId) {
      targetId = resolveSafeBackgroundId(member, member && member.appearanceBackground);
    }
    let background = resolveBackgroundById(targetId);
    if (!background) {
      background = resolveBackgroundById(getDefaultBackgroundId());
    }
    const imageSource = background && background.image ? background.image : resolveBackgroundImage(member);
    const videoSource = background && background.video ? background.video : '';
    const dynamicEnabled = !!(override.animated && videoSource);
    return {
      image: imageSource,
      video: dynamicEnabled ? videoSource : '',
      dynamicEnabled
    };
  }
  return resolveBackgroundDisplay(member);
}

function buildBackgroundOptionList(member, options = {}) {
  const realmOrder = resolveMemberRealmOrder(member);
  const globalCatalog = Array.isArray(options.globalBackgroundCatalog)
    ? options.globalBackgroundCatalog
    : [];
  const memberCatalog = Array.isArray(options.memberBackgroundCatalog)
    ? options.memberBackgroundCatalog
    : member && Array.isArray(member.backgroundCatalog)
    ? member.backgroundCatalog
    : [];
  const globalBackgroundIds = new Set(
    globalCatalog
      .map((item) => (item && typeof item.id === 'string' ? item.id.trim() : ''))
      .filter((id) => !!id)
  );
  const memberBackgroundIds = new Set(
    memberCatalog
      .map((item) => (item && typeof item.id === 'string' ? item.id.trim() : ''))
      .filter((id) => !!id)
  );
  const backgroundUnlocks = resolveBackgroundUnlocks(member);
  const globalBackground = options.globalBackground || null;
  const globalBackgroundEnforced = !!options.globalBackgroundEnforced;
  const enforcedBackgroundId = globalBackgroundEnforced
    ? normalizeBackgroundId(
        (globalBackground && globalBackground.backgroundId) || options.globalBackgroundId || ''
      )
    : '';
  const activeId = enforcedBackgroundId || resolveSafeBackgroundId(member, member && member.appearanceBackground);
  const backgrounds = listBackgrounds();
  let visibleBackgrounds = backgrounds;
  if (!isMemberAdmin(member)) {
    const maxRealmOrder = backgrounds.reduce((max, background) => {
      const value = Number.isFinite(background.realmOrder)
        ? Math.max(0, Math.floor(background.realmOrder))
        : 0;
      return Math.max(max, value);
    }, 1);
    const highestVisibleOrder = Math.min(maxRealmOrder, realmOrder + 1);
    visibleBackgrounds = backgrounds.filter((background) => background.realmOrder <= highestVisibleOrder);
  }
  visibleBackgrounds = visibleBackgrounds.filter((background) => {
    if (!background) {
      return false;
    }
    const backgroundId = background.id;
    if (globalBackgroundEnforced && enforcedBackgroundId && backgroundId === enforcedBackgroundId) {
      return true;
    }
    if (globalBackgroundIds.has(backgroundId) && !memberBackgroundIds.has(backgroundId)) {
      return isBackgroundUnlocked(backgroundId, realmOrder, backgroundUnlocks);
    }
    return true;
  });
  return visibleBackgrounds.map((background) => {
    const backgroundId = background.id;
    const unlocked = isBackgroundUnlocked(backgroundId, realmOrder, backgroundUnlocks);
    const isEnforcedSelection =
      globalBackgroundEnforced && enforcedBackgroundId && backgroundId === enforcedBackgroundId;
    let description = background.unlockType === 'manual' ? '使用奖励道具后解锁' : `突破至${background.realmName}解锁`;
    if (isEnforcedSelection) {
      description = '管理员已启用';
    } else if (backgroundId === activeId && unlocked) {
      description = '当前使用';
    } else if (unlocked) {
      description = '已解锁';
    }
    return {
      ...background,
      unlocked,
      description
    };
  });
}

function resolveBackgroundOptionContext(scope, member) {
  if (!scope) {
    return {};
  }
  const memberCatalog = Array.isArray(scope.memberBackgroundCatalog)
    ? scope.memberBackgroundCatalog
    : member && Array.isArray(member.backgroundCatalog)
    ? member.backgroundCatalog
    : [];
  return {
    globalBackgroundEnforced: scope.data && scope.data.globalBackgroundEnforced,
    globalBackground: scope.globalBackground,
    globalBackgroundCatalog: scope.globalBackgroundCatalog,
    memberBackgroundCatalog: memberCatalog
  };
}

function resolveActiveBackgroundId(member, scope) {
  const context = resolveBackgroundOptionContext(scope, member);
  if (context.globalBackgroundEnforced) {
    const enforcedId = normalizeBackgroundId(
      context.globalBackground && context.globalBackground.backgroundId
        ? context.globalBackground.backgroundId
        : ''
    );
    if (enforcedId) {
      return enforcedId;
    }
  }
  return resolveSafeBackgroundId(member, member && member.appearanceBackground);
}

function resolveSafeBackgroundId(member, desiredId) {
  const realmOrder = resolveMemberRealmOrder(member);
  const sanitizedId = normalizeBackgroundId(desiredId || '');
  const backgroundUnlocks = resolveBackgroundUnlocks(member);
  if (sanitizedId && isBackgroundUnlocked(sanitizedId, realmOrder, backgroundUnlocks)) {
    return sanitizedId;
  }
  const fallback = resolvePreferredBackground(member);
  return fallback ? fallback.id : getDefaultBackgroundId();
}

function normalizePercentage(progress) {
  if (!progress || typeof progress.percentage !== 'number') {
    return 0;
  }
  const value = Number(progress.percentage);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function hasPendingLevelRewards(progress) {
  if (!progress || !Array.isArray(progress.levels)) {
    return false;
  }
  return progress.levels.some((level) => level && level.claimable);
}

function buildWidthStyle(width) {
  const safeWidth = typeof width === 'number' && Number.isFinite(width) ? width : 0;
  return `width: ${safeWidth}%;`;
}

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

function shouldShowReservationDot(badges) {
  return badges.memberVersion > badges.memberSeenVersion;
}

function shouldShowAdminDot(badges) {
  return badges.adminVersion > badges.adminSeenVersion;
}

function extractDocIdFromChange(change) {
  if (!change) {
    return '';
  }
  if (change.docId && typeof change.docId === 'string') {
    return change.docId;
  }
  const doc = change.doc || change.data;
  if (doc && typeof doc === 'object') {
    return doc._id || doc.id || doc.docId || '';
  }
  return '';
}

function extractDocId(doc) {
  if (!doc) {
    return '';
  }
  if (typeof doc === 'string') {
    return doc;
  }
  if (typeof doc === 'object') {
    return doc._id || doc.id || doc.docId || '';
  }
  return '';
}

function padNumber(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function resolveDefaultAvatarUrl(gender) {
  const defaultId = getDefaultAvatarId(gender);
  if (!defaultId) {
    return '';
  }
  return buildAvatarUrlById(defaultId);
}

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const normalized = url.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  let match = normalized.match(AVATAR_URL_PATTERN);
  if (match) {
    return match[1];
  }
  match = normalized.match(CHARACTER_URL_PATTERN);
  return match ? match[1] : '';
}

function resolveCharacterImageByAvatarId(avatarId) {
  if (!avatarId) {
    return '';
  }
  return CHARACTER_IMAGE_MAP[avatarId] || '';
}

function resolveCharacterImage(member) {
  if (!member) {
    return HERO_IMAGE;
  }
  const avatarId = extractAvatarIdFromUrl(sanitizeAvatarUrl(member.avatarUrl));
  const characterImage = resolveCharacterImageByAvatarId(avatarId);
  if (characterImage) {
    return characterImage;
  }
  return HERO_IMAGE;
}

function resolveCharacterRarityByAvatarId(avatarId) {
  if (!avatarId) {
    return '';
  }
  const meta = resolveAvatarMetaById(avatarId);
  if (!meta || !meta.rarity) {
    return '';
  }
  return normalizeFigureRarity(meta.rarity);
}

function resolveMemberFigureRarity(member) {
  if (!member) {
    return '';
  }
  const directCandidates = [
    member.figureRarity,
    member.avatarRarity,
    member.rarity,
    member.rarityKey,
    member.appearanceRarity,
    member.characterRarity
  ];
  if (member.avatar && typeof member.avatar === 'object') {
    directCandidates.push(member.avatar.rarity, member.avatar.rarityKey);
  }
  if (member.figure && typeof member.figure === 'object') {
    directCandidates.push(member.figure.rarity, member.figure.rank);
  }
  if (member.tier && typeof member.tier === 'object') {
    directCandidates.push(member.tier.name, member.tier.rank);
  }
  for (let i = 0; i < directCandidates.length; i += 1) {
    const normalized = normalizeFigureRarity(directCandidates[i]);
    if (normalized) {
      return normalized;
    }
  }
  const avatarId = extractAvatarIdFromUrl(sanitizeAvatarUrl(member.avatarUrl));
  const avatarRarity = resolveCharacterRarityByAvatarId(avatarId);
  if (avatarRarity) {
    return avatarRarity;
  }
  const figureImage = resolveCharacterImage(member);
  const figureAvatarId = extractAvatarIdFromUrl(figureImage);
  const figureRarity = resolveCharacterRarityByAvatarId(figureAvatarId);
  if (figureRarity) {
    return figureRarity;
  }
  return '';
}

function resolveHeroFigureScaleClass(member) {
  return resolveFigureScaleClassByRarity(resolveMemberFigureRarity(member));
}

function computeAvatarOptionList(member, currentAvatar, gender) {
  const unlocks = normalizeAvatarUnlocks((member && member.avatarUnlocks) || []);
  const available = getAvailableAvatars({ gender, unlocks });
  const result = [];
  const seen = new Set();

  if (typeof currentAvatar === 'string' && currentAvatar) {
    const currentId = extractAvatarIdFromUrl(currentAvatar);
    const meta = currentId ? resolveAvatarById(currentId) : null;
    const currentName = meta ? meta.name : '当前头像';
    result.push({ id: meta ? meta.id : 'current', url: currentAvatar, name: currentName, rarity: meta ? meta.rarity : undefined });
    seen.add(currentAvatar);
  }

  available.forEach((avatar) => {
    if (!avatar || !avatar.url || seen.has(avatar.url)) {
      return;
    }
    result.push({ id: avatar.id, url: avatar.url, name: avatar.name, rarity: avatar.rarity });
    seen.add(avatar.url);
  });

  if (!result.length) {
    const fallback = resolveDefaultAvatarUrl(gender);
    if (fallback) {
      const fallbackId = extractAvatarIdFromUrl(fallback);
      const meta = fallbackId ? resolveAvatarById(fallbackId) : null;
      result.push({
        id: meta ? meta.id : 'default',
        url: fallback,
        name: meta ? meta.name : '默认头像',
        rarity: meta ? meta.rarity : undefined
      });
    }
  }

  return result;
}

function buildAvatarFrameOptionList() {
  const urls = listAvatarFrameUrls();
  const base = [{ id: 'none', url: '', name: '无相框' }];
  return base.concat(
    urls.map((url, index) => ({
      id: `frame_${index + 1}`,
      url,
      name: `相框 ${index + 1}`
    }))
  );
}

function cloneAvatarFrameOptions() {
  return AVATAR_FRAME_OPTIONS.map((item) => ({ ...item }));
}

function sanitizeAvatarFrame(value) {
  return normalizeAvatarFrameValue(typeof value === 'string' ? value : '');
}

function buildSanitizedMember(member) {
  if (!member) {
    return null;
  }
  const sanitizedAvatar = sanitizeAvatarUrl(member.avatarUrl);
  const sanitizedFrame = sanitizeAvatarFrame(member.avatarFrame || '');
  const sanitizedBackground = normalizeBackgroundId(member.appearanceBackground || '') || getDefaultBackgroundId();
  const titleUnlocks = resolveTitleUnlocks(member);
  const desiredTitle = normalizeTitleId(member.appearanceTitle || '');
  const appearanceTitle = desiredTitle && titleUnlocks.includes(desiredTitle) ? desiredTitle : '';
  const titleCatalog = normalizeTitleCatalog(member.titleCatalog);
  const backgroundCatalog = normalizeBackgroundCatalog(member.backgroundCatalog);
  registerCustomTitles(titleCatalog);
  return {
    ...member,
    avatarUrl: sanitizedAvatar || '',
    avatarFrame: sanitizedFrame,
    appearanceBackground: sanitizedBackground,
    appearanceBackgroundAnimated: !!member.appearanceBackgroundAnimated,
    appearanceTitle,
    titleUnlocks,
    titleCatalog,
    backgroundCatalog,
    backgroundUnlocks: resolveBackgroundUnlocks(member)
  };
}

function resolveAvatarSelection(options, currentAvatar, gender) {
  const desired = typeof currentAvatar === 'string' ? currentAvatar : '';
  if (
    desired &&
    Array.isArray(options) &&
    options.some((option) => option && option.url === desired)
  ) {
    return desired;
  }
  if (Array.isArray(options)) {
    const firstValid = options.find((option) => option && option.url);
    if (firstValid && firstValid.url) {
      return firstValid.url;
    }
  }
  const fallback = resolveDefaultAvatarUrl(gender);
  if (fallback) {
    return fallback;
  }
  return desired;
}

function sanitizeAvatarUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  let sanitized = url.trim();
  if (!sanitized) {
    return '';
  }
  if (!sanitized.startsWith('data:')) {
    sanitized = sanitized.replace(/^http:\/\//i, 'https://');
    if (/qlogo\.cn/.test(sanitized)) {
      const [base, query] = sanitized.split('?');
      const normalizedBase = base.replace(/\/(0|46|64|96)$/, '/132');
      sanitized = query ? `${normalizedBase}?${query}` : normalizedBase;
      const normalizedWithoutQuery = normalizedBase;
      if (normalizedWithoutQuery === WECHAT_DEFAULT_AVATAR_URL) {
        return '';
      }
    }
  }
  return sanitized;
}

function normalizeGenderValue(value) {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'male' || lower === 'man' || lower === 'm' || lower === '男') {
      return 'male';
    }
    if (lower === 'female' || lower === 'woman' || lower === 'f' || lower === '女') {
      return 'female';
    }
    if (lower === 'unknown' || lower === 'secret' || lower === '保密') {
      return 'unknown';
    }
  }
  if (typeof value === 'number') {
    if (value === 1) return 'male';
    if (value === 2) return 'female';
  }
  return 'unknown';
}

function formatHistoryList(history) {
  if (!Array.isArray(history) || !history.length) {
    return [];
  }
  const sorted = [...history].sort((a, b) => {
    const aTime = new Date(a && a.changedAt ? a.changedAt : 0).getTime();
    const bTime = new Date(b && b.changedAt ? b.changedAt : 0).getTime();
    return bTime - aTime;
  });
  return sorted
    .map((item, index) => {
      if (!item) {
        return null;
      }
      const date = new Date(item.changedAt || 0);
      const valid = Number.isFinite(date.getTime());
      const displayTime = valid
        ? `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(
            date.getHours()
          )}:${padNumber(date.getMinutes())}`
        : '';
      return {
        id: `${valid ? date.getTime() : Date.now()}_${index}`,
        previous: item.previous || '',
        current: item.current || '',
        displayTime,
        source: item.source || ''
      };
    })
    .filter(Boolean);
}

const HERO_IMAGE = DEFAULT_CHARACTER_IMAGE;

const EMPTY_MEMBER_STATS = {
  stoneBalance: formatStones(0),
  cashBalance: formatCurrency(0),
  experience: formatExperience(0),
  combatPower: formatCombatPower(0)
};

function resolveMemberCombatPower(member) {
  if (!member || typeof member !== 'object') {
    return 0;
  }

  const candidates = [
    member.combatPower,
    member.power,
    member.powerScore,
    member.powerValue,
    member.fightPower,
    member.fighting,
    member.score,
    member.rating
  ];

  const attributeSummary = member.attributeSummary && typeof member.attributeSummary === 'object'
    ? member.attributeSummary
    : null;
  if (attributeSummary) {
    candidates.push(attributeSummary.combatPower);
  }

  const profile = member.pveProfile && typeof member.pveProfile === 'object' ? member.pveProfile : null;
  if (profile) {
    const profileSummary = profile.attributeSummary && typeof profile.attributeSummary === 'object'
      ? profile.attributeSummary
      : null;
    if (profileSummary) {
      candidates.push(
        profileSummary.combatPower,
        profileSummary.power,
        profileSummary.powerScore,
        profileSummary.score,
        profileSummary.rating
      );
    }

    const profileAttributes = profile.attributes && typeof profile.attributes === 'object'
      ? profile.attributes
      : null;
    if (profileAttributes) {
      candidates.push(
        profileAttributes.combatPower,
        profileAttributes.power,
        profileAttributes.powerScore,
        profileAttributes.score,
        profileAttributes.rating
      );
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = Number(candidates[i]);
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
}

function deriveMemberStats(member) {
  if (!member) {
    return { ...EMPTY_MEMBER_STATS };
  }

  const combatPower = resolveMemberCombatPower(member);
  return {
    stoneBalance: formatStones(member.stoneBalance ?? 0),
    cashBalance: formatCurrency(member.cashBalance ?? member.balance ?? 0),
    experience: formatExperience(member.experience ?? 0),
    combatPower: formatCombatPower(combatPower)
  };
}

function resolveNavItems(member) {
  const roles = Array.isArray(member && member.roles) ? member.roles : [];
  const badges = normalizeReservationBadges(member && member.reservationBadges);
  const roleHasPendingAttributes = shouldShowRoleBadge(member);
  const storageHasPending = resolveStorageBadgeVisibility();
  const proxySessionActive = !!(
    member &&
    member.proxySession &&
    member.proxySession.active !== false &&
    member.proxySession.targetMemberId
  );
  const navItems = BASE_NAV_ITEMS.map((item) => {
    const next = { ...item };
    if (item.label === '预订') {
      next.showDot = shouldShowReservationDot(badges);
    }
    if (item.label === '角色') {
      next.showDot = roleHasPendingAttributes;
    }
    if (item.label === '纳戒') {
      next.showDot = storageHasPending;
    }
    return next;
  });
  if (roles.some((role) => ADMIN_ALLOWED_ROLES.includes(role))) {
    navItems.push({
      icon: '🛡️',
      label: '管理员',
      url: '/pages/admin/index',
      showDot: shouldShowAdminDot(badges)
    });
  }
  if (proxySessionActive) {
    navItems.push({
      icon: '🚪',
      label: '退出',
      action: PROXY_LOGOUT_ACTION,
      url: ''
    });
  }
  return navItems;
}

Page({
  data: {
    member: null,
    proxySession: null,
    progress: null,
    progressRemainingExperience: formatExperience(0),
    realmHasPendingRewards: false,
    showAvatarBadge: true,
    showNameBadge: true,
    appearanceBadgeState: cloneDefaultAppearanceBadgeState(),
    tasks: [],
    loading: true,
    proxyLogoutPending: false,
    backgroundImage: STARTUP_COVER_IMAGE,
    backgroundVideo: resolveBackgroundVideo(null),
    backgroundPoster: resolveVideoPosterSource(STARTUP_COVER_IMAGE),
    showBackgroundVideo: false,
    showBackgroundOverlay: false,
    backgroundVideoError: false,
    dynamicBackgroundEnabled: false,
    startupVideoSource: STARTUP_VIDEO_SOURCE,
    showStartupVideo: true,
    startupVideoFading: false,
    globalBackgroundEnforced: false,
    navHeight: 88,
    today: '',
    showProfile: false,
    showOnboarding: false,
    onboardingSubmitting: false,
    onboarding: {
      nickName: '',
      avatarUrl: '',
      mobile: '',
      phoneCloudId: '',
      phoneCode: ''
    },
    authorizationStatus: {
      profileAuthorized: false,
      phoneAuthorized: false
    },
    heroImage: HERO_IMAGE,
    heroFigureScaleClass: '',
    defaultAvatar: DEFAULT_AVATAR,
    activeTitleImage: '',
    activityIcons: DEFAULT_ACTIVITY_ICONS.slice(),
    navItems: INITIAL_NAV_ITEMS.slice(),
    collapsedNavItems: buildCollapsedNavItems(INITIAL_NAV_ITEMS),
    navExpanded: false,
    memberStats: { ...EMPTY_MEMBER_STATS },
    progressWidth: 0,
    progressStyle: buildWidthStyle(0),
    profileEditor: {
      nickName: '',
      gender: 'unknown',
      avatarUrl: '',
      avatarFrame: '',
      appearanceTitle: '',
      appearanceBackground: getDefaultBackgroundId(),
      appearanceBackgroundAnimated: false,
      renameCredits: 0,
      renameCards: 0,
      renameUsed: 0,
      renameHistory: []
    },
    profileSaving: false,
    renameRedeeming: false,
    showAvatarPicker: false,
    avatarPickerSaving: false,
    avatarPicker: {
      activeTab: 'avatar',
      avatarUrl: '',
      avatarOptions: [],
      avatarFrame: '',
      frameOptions: cloneAvatarFrameOptions(),
      backgroundId: getDefaultBackgroundId(),
      backgroundOptions: buildBackgroundOptionList(null),
      dynamicBackground: false,
      appearanceTitle: '',
      titleOptions: []
    },
  },

  async syncCacheVersions() {
    if (this.cacheVersionSyncPromise) {
      return this.cacheVersionSyncPromise;
    }
    this.cacheVersionSyncPromise = (async () => {
      try {
        const result = await MemberService.getCacheVersions();
        const payload =
          (result && (result.versions || result.cacheVersions)) ||
          (result && result.data && (result.data.versions || result.data.cacheVersions)) ||
          {};
        const { versions, mismatched } = applyCacheVersionUpdate(payload);
        try {
          const appInstance = getApp();
          if (appInstance && appInstance.globalData) {
            appInstance.globalData.cacheVersions = versions;
          }
        } catch (updateError) {
          console.warn('[index] update global cache versions failed', updateError);
        }
        this.cacheVersionSynced = true;
        this.cacheVersionSyncResult = { versions, mismatched };
        return this.cacheVersionSyncResult;
      } catch (error) {
        console.warn('[index] sync cache versions failed', error);
        this.cacheVersionSynced = false;
        this.cacheVersionSyncResult = null;
        return null;
      } finally {
        this.cacheVersionSyncPromise = null;
      }
    })();
    return this.cacheVersionSyncPromise;
  },

  applyHomeEntries(visibility) {
    const previous = this.homeEntries || {};
    const normalized = normalizeHomeEntryVisibility(visibility);
    this.homeEntries = normalized;
    try {
      if (app && app.globalData) {
        app.globalData.homeEntries = normalized;
      }
    } catch (error) {
      console.warn('[index] sync global home entries failed', error);
    }
    const icons = buildHomeActivityIcons(normalized);
    const currentIcons = Array.isArray(this.data.activityIcons) ? this.data.activityIcons : [];
    const unchanged =
      currentIcons.length === icons.length &&
      currentIcons.every((item, index) => {
        const next = icons[index];
        return (
          item &&
          next &&
          item.icon === next.icon &&
          item.label === next.label &&
          item.url === next.url
        );
      });
    if (!unchanged) {
      this.setData({ activityIcons: icons });
    }
    const changed = HOME_ENTRY_ITEMS.some((item) => normalized[item.key] !== previous[item.key]);
    if (changed || !this.homeEntriesPersisted) {
      const persisted = persistHomeEntryVisibility(normalized);
      if (persisted) {
        this.homeEntriesPersisted = true;
      }
    }
  },

  applyGlobalBackground(config) {
    const normalized = cloneGlobalBackgroundConfig(config);
    this.globalBackground = normalized;
    try {
      if (app && app.globalData) {
        app.globalData.globalBackground = normalized;
      }
    } catch (error) {
      console.warn('[index] sync global background failed', error);
    }
    const enforced = !!normalized.enabled;
    const updates = {};
    if (this.data.globalBackgroundEnforced !== enforced) {
      updates.globalBackgroundEnforced = enforced;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
    if (this.data.member) {
      const member = this.data.member;
      const activeBackgroundId = resolveActiveBackgroundId(member, this);
      const backgroundUpdates = {
        'avatarPicker.backgroundOptions': buildBackgroundOptionList(
          member,
          resolveBackgroundOptionContext(this, member)
        ),
        'avatarPicker.backgroundId': activeBackgroundId
      };
      if (enforced && activeBackgroundId && this.data.profileEditor.appearanceBackground !== activeBackgroundId) {
        backgroundUpdates['profileEditor.appearanceBackground'] = activeBackgroundId;
      } else if (!enforced) {
        const memberBackgroundId = resolveSafeBackgroundId(member, member && member.appearanceBackground);
        if (this.data.profileEditor.appearanceBackground !== memberBackgroundId) {
          backgroundUpdates['profileEditor.appearanceBackground'] = memberBackgroundId;
        }
      }
      this.setData(backgroundUpdates);
      this.updateBackgroundDisplay(member, { resetError: true });
    }
  },

  refreshBackgroundRegistry(memberCatalog) {
    const globalCatalog = Array.isArray(this.globalBackgroundCatalog)
      ? this.globalBackgroundCatalog
      : [];
    const memberCatalogList = Array.isArray(memberCatalog)
      ? memberCatalog
      : Array.isArray(this.memberBackgroundCatalog)
      ? this.memberBackgroundCatalog
      : [];
    const combined = normalizeBackgroundCatalog(globalCatalog.concat(memberCatalogList));
    registerCustomBackgrounds(combined);
  },

  loadHomeEntries() {
    if (this.homeEntryLoadingPromise) {
      return this.homeEntryLoadingPromise;
    }
    this.homeEntryLoadingPromise = (async () => {
      try {
        const result = await MemberService.getSystemSettings();
        const visibility =
          (result && result.homeEntries) || DEFAULT_HOME_ENTRY_VISIBILITY;
        this.applyHomeEntries(visibility);
        const catalog = normalizeBackgroundCatalog(
          (result && result.globalBackgroundCatalog) || []
        );
        this.globalBackgroundCatalog = catalog;
        try {
          if (app && app.globalData) {
            app.globalData.globalBackgroundCatalog = catalog;
          }
        } catch (error) {
          console.warn('[index] sync global catalog failed', error);
        }
        this.refreshBackgroundRegistry(this.memberBackgroundCatalog);
        if (result && result.globalBackground) {
          this.applyGlobalBackground(result.globalBackground);
        }
        this.homeEntriesLoadedAt = Date.now();
        return visibility;
      } catch (error) {
        console.warn('[index] load home entries failed', error);
        return null;
      } finally {
        this.homeEntryLoadingPromise = null;
        this.homeEntriesReady = true;
      }
    })();
    return this.homeEntryLoadingPromise;
  },

  onLoad() {
    this.startupVideoDismissed = false;
    this.startupVideoFadeTimeout = null;
    this.setData({
      startupVideoSource: STARTUP_VIDEO_SOURCE,
      showStartupVideo: true,
      startupVideoFading: false
    });
    this.cacheVersionSynced = false;
    this.cacheVersionSyncResult = null;
    this.cacheVersionSyncPromise = null;
    this.hasBootstrapped = false;
    this.hasVisitedOtherPage = false;
    this.nameBadgeDismissedFromStorage = false;
    this.homeEntriesReady = false;
    this.homeEntriesLoadedAt = 0;
    this.homeEntryLoadingPromise = null;
    this.globalBackgroundCatalog = [];
    this.memberBackgroundCatalog = [];
    this.globalBackground = cloneGlobalBackgroundConfig(DEFAULT_GLOBAL_BACKGROUND);
    try {
      if (app && app.globalData) {
        app.globalData.globalBackground = this.globalBackground;
      }
    } catch (error) {
      console.warn('[index] sync global background failed', error);
    }
    const globalHomeEntries = app && app.globalData ? app.globalData.homeEntries : null;
    const cachedHomeEntries = loadCachedHomeEntryVisibility();
    if (cachedHomeEntries) {
      this.homeEntries = cachedHomeEntries;
      this.homeEntriesPersisted = true;
    } else if (globalHomeEntries) {
      this.homeEntries = normalizeHomeEntryVisibility(globalHomeEntries);
      this.homeEntriesPersisted = false;
    } else {
      this.homeEntries = normalizeHomeEntryVisibility(DEFAULT_HOME_ENTRY_VISIBILITY);
      this.homeEntriesPersisted = false;
    }
    this.applyHomeEntries(this.homeEntries);
    this.ensureNavMetrics();
    this.updateToday();
    this.loadHomeEntries().catch(() => null);
    const versionPromise = this.syncCacheVersions();
    versionPromise
      .catch(() => null)
      .finally(() => {
        this.restoreNavExpansionState();
        this.restoreProfileBadgeState();
      });
  },

  onShow() {
    this.ensureNavMetrics();
    this.updateToday();
    const globalHomeEntries = app && app.globalData ? app.globalData.homeEntries : null;
    if (globalHomeEntries) {
      const normalizedGlobal = normalizeHomeEntryVisibility(globalHomeEntries);
      const previousEntries =
        this.homeEntries && typeof this.homeEntries === 'object'
          ? this.homeEntries
          : normalizeHomeEntryVisibility(DEFAULT_HOME_ENTRY_VISIBILITY);
      const hasDifference = HOME_ENTRY_ITEMS.some((item) => normalizedGlobal[item.key] !== previousEntries[item.key]);
      if (hasDifference) {
        this.applyHomeEntries(normalizedGlobal);
      }
    }
    try {
      const globalBackground = app && app.globalData ? app.globalData.globalBackground : null;
      if (globalBackground) {
        const normalized = cloneGlobalBackgroundConfig(globalBackground);
        if (
          !this.globalBackground ||
          normalized.enabled !== this.globalBackground.enabled ||
          normalized.backgroundId !== this.globalBackground.backgroundId ||
          normalized.animated !== this.globalBackground.animated
        ) {
          this.applyGlobalBackground(normalized);
        }
      }
    } catch (error) {
      console.warn('[index] sync global background from app failed', error);
    }
    const shouldRefreshHomeEntries =
      !this.homeEntriesReady ||
      (this.homeEntriesLoadedAt && Date.now() - this.homeEntriesLoadedAt > 300000);
    if (shouldRefreshHomeEntries) {
      this.loadHomeEntries();
    }
    this.refreshStorageBadgeIndicator();
    this.attachMemberRealtime();
    this.bootstrap();
  },

  onReady() {},

  onHide() {
    this.detachMemberRealtime();
    this.clearStartupVideoFadeTimer();
    try {
      const pages = getCurrentPages();
      if (Array.isArray(pages) && pages.length > 1) {
        this.hasVisitedOtherPage = true;
      }
    } catch (err) {
      // Ignore errors from getCurrentPages.
    }
  },

  onUnload() {
    this.detachMemberRealtime();
    this.clearStartupVideoFadeTimer();
  },

  ensureNavMetrics() {
    const { customNav = {} } = app.globalData || {};
    const navHeight = customNav.navHeight || 88;
    if (navHeight !== this.data.navHeight) {
      this.setData({ navHeight });
    }
  },

  updateBackgroundDisplay(member, options = {}) {
    const { image, video, dynamicEnabled } = resolveEffectiveBackgroundDisplay(
      member,
      this.globalBackground
    );
    const shouldShowVideo = dynamicEnabled && !!video;
    const hasError = shouldShowVideo ? (options.resetError ? false : !!this.data.backgroundVideoError) : false;
    const showVideo = hasError ? false : shouldShowVideo;
    this.setData({
      backgroundImage: image,
      backgroundVideo: video,
      backgroundPoster: resolveVideoPosterSource(image),
      dynamicBackgroundEnabled: dynamicEnabled,
      showBackgroundVideo: showVideo,
      showBackgroundOverlay: !showVideo,
      backgroundVideoError: hasError
    });
  },

  clearStartupVideoFadeTimer() {
    if (this.startupVideoFadeTimeout) {
      clearTimeout(this.startupVideoFadeTimeout);
      this.startupVideoFadeTimeout = null;
    }
  },

  triggerStartupVideoFade(immediate = false) {
    if (this.startupVideoDismissed) {
      return;
    }
    this.startupVideoDismissed = true;
    this.clearStartupVideoFadeTimer();
    if (immediate) {
      this.setData({
        showStartupVideo: false,
        startupVideoFading: false
      });
      return;
    }
    this.setData({ startupVideoFading: true });
    this.startupVideoFadeTimeout = setTimeout(() => {
      this.startupVideoFadeTimeout = null;
      this.setData({ showStartupVideo: false });
    }, STARTUP_VIDEO_FADE_DURATION_MS);
  },

  handleStartupVideoTimeUpdate(event) {
    if (this.startupVideoDismissed) {
      return;
    }
    const detail = event && event.detail ? event.detail : {};
    const currentTime = Number(detail.currentTime || 0);
    if (currentTime >= STARTUP_VIDEO_FADE_OUT_AT_SECONDS) {
      this.triggerStartupVideoFade();
    }
  },

  handleStartupVideoEnded() {
    this.triggerStartupVideoFade();
  },

  handleStartupVideoError() {
    this.triggerStartupVideoFade(true);
  },

  handleBackgroundVideoError() {
    if (!this.data.backgroundVideoError) {
      wx.showToast({ title: '未找到动态背景，已使用静态背景', icon: 'none' });
    }
    this.setData({
      backgroundVideoError: true,
      showBackgroundVideo: false,
      showBackgroundOverlay: true
    });
  },

  attachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      return;
    }
    this.unsubscribeMemberRealtime = subscribeMemberRealtime((event) => {
      if (!event) {
        return;
      }
      if (event.type === 'memberSnapshot') {
        const incomingMember = event.member;
        if (!incomingMember) {
          return;
        }
        const currentMemberId = this.data.member && this.data.member._id;
        const incomingMemberId = incomingMember._id || incomingMember.id;
        if (currentMemberId && incomingMemberId && currentMemberId !== incomingMemberId) {
          return;
        }
        this.applyMemberUpdate(incomingMember, { propagate: false });
        if (event.origin === 'manualRefresh') {
          this.bootstrap({ showLoading: false });
        }
        return;
      }
      if (event.type !== 'memberChanged' && event.type !== 'memberExtrasChanged') {
        return;
      }
      const { snapshot } = event;
      if (!snapshot || snapshot.type === 'init') {
        return;
      }
      const memberId = this.data.member && this.data.member._id;
      if (!memberId) {
        return;
      }
      const docChanges = Array.isArray(snapshot.docChanges) ? snapshot.docChanges : [];
      let affectedIds = docChanges.map((change) => extractDocIdFromChange(change)).filter(Boolean);
      if (!affectedIds.length && Array.isArray(snapshot.docs)) {
        affectedIds = snapshot.docs.map((doc) => extractDocId(doc)).filter(Boolean);
      }
      if (!affectedIds.length && snapshot.docId) {
        affectedIds = [snapshot.docId];
      }
      if (!affectedIds.includes(memberId)) {
        return;
      }
      this.bootstrap({ showLoading: false });
    });
  },

  detachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      this.unsubscribeMemberRealtime();
      this.unsubscribeMemberRealtime = null;
    }
  },

  async bootstrap(options = {}) {
    await this.syncCacheVersions();
    if (this.bootstrapRunning) {
      this.bootstrapPending = true;
      return;
    }
    this.bootstrapRunning = true;
    const showLoading = options.showLoading ?? !this.hasBootstrapped;
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const [member, progress, tasks] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress(),
        TaskService.list()
      ]);
      const sanitizedMember = buildSanitizedMember(member);
      const width = normalizePercentage(progress);
      const nextDiff = progress && typeof progress.nextDiff === 'number' ? progress.nextDiff : 0;
      const progressRemainingExperience = formatExperience(nextDiff);
      const needsProfile = !sanitizedMember || !sanitizedMember.nickName || !sanitizedMember.mobile;
      const shouldShowOnboarding = this.shouldShowOnboarding(needsProfile);
      const profileAuthorized = !!(sanitizedMember && sanitizedMember.nickName);
      const phoneAuthorized = !!(sanitizedMember && sanitizedMember.mobile);
      const navItems = resolveNavItems(sanitizedMember);
      const collapsedNavItems = buildCollapsedNavItems(navItems);
      const realmHasPendingRewards = hasPendingLevelRewards(progress);
      this.setData({
        member: sanitizedMember,
        proxySession: sanitizedMember ? sanitizedMember.proxySession || null : null,
        progress,
        progressRemainingExperience,
        realmHasPendingRewards,
        tasks: tasks.slice(0, 3),
        loading: false,
        heroImage: resolveCharacterImage(sanitizedMember),
        heroFigureScaleClass: resolveHeroFigureScaleClass(sanitizedMember),
        navItems,
        collapsedNavItems,
        memberStats: deriveMemberStats(sanitizedMember),
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        showOnboarding: shouldShowOnboarding,
        onboarding: needsProfile
          ? {
              ...this.data.onboarding,
              nickName: sanitizedMember && sanitizedMember.nickName ? sanitizedMember.nickName : '',
              avatarUrl:
                sanitizedMember && sanitizedMember.avatarUrl ? sanitizedMember.avatarUrl : '',
              mobile: sanitizedMember && sanitizedMember.mobile ? sanitizedMember.mobile : '',
              phoneCloudId: '',
              phoneCode: ''
            }
          : this.data.onboarding,
        authorizationStatus: needsProfile
          ? {
              profileAuthorized,
              phoneAuthorized
            }
          : {
              profileAuthorized: false,
              phoneAuthorized: false
            },
        'profileEditor.appearanceBackground': resolveSafeBackgroundId(
          sanitizedMember,
          sanitizedMember && sanitizedMember.appearanceBackground
        ),
        'profileEditor.appearanceBackgroundAnimated': !!sanitizedMember.appearanceBackgroundAnimated,
        'avatarPicker.backgroundOptions': buildBackgroundOptionList(
          sanitizedMember,
          resolveBackgroundOptionContext(this, sanitizedMember)
        ),
        'avatarPicker.backgroundId': resolveActiveBackgroundId(sanitizedMember, this),
        'avatarPicker.dynamicBackground': !!sanitizedMember.appearanceBackgroundAnimated
      });
      this.updateBackgroundDisplay(sanitizedMember, { resetError: true });
      setActiveMember(sanitizedMember);
      this.syncNameBadgeVisibility(sanitizedMember);
    } catch (err) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        memberStats: deriveMemberStats(this.data.member),
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        heroImage: resolveCharacterImage(this.data.member),
        heroFigureScaleClass: resolveHeroFigureScaleClass(this.data.member)
      });
      this.updateBackgroundDisplay(this.data.member, {});
    }
    this.syncNameBadgeVisibility();
    this.bootstrapRunning = false;
    if (!this.hasBootstrapped) {
      this.hasBootstrapped = true;
    }
    if (this.bootstrapPending) {
      this.bootstrapPending = false;
      this.bootstrap({ showLoading: false });
    }
  },

  updateToday() {
    const now = new Date();
    const formatNumber = (value) => (value < 10 ? `0${value}` : `${value}`);
    this.setData({
      today: `${now.getFullYear()} · ${formatNumber(now.getMonth() + 1)} · ${formatNumber(now.getDate())}`
    });
  },

  refreshStorageBadgeIndicator() {
    if (!this.hasBootstrapped && !this.data.member) {
      return;
    }
    const navItems = resolveNavItems(this.data.member);
    const collapsedNavItems = buildCollapsedNavItems(navItems);
    this.setData({ navItems, collapsedNavItems });
  },

  restoreNavExpansionState() {
    try {
      const stored = wx.getStorageSync(NAV_EXPANDED_STORAGE_KEY);
      if (stored && !this.data.navExpanded) {
        this.setData({ navExpanded: true });
      }
    } catch (err) {
      // Ignore storage errors and keep the default collapsed state.
    }
  },

  restoreProfileBadgeState() {
    let avatarDismissed = false;
    let appearanceState = cloneDefaultAppearanceBadgeState();
    this.nameBadgeDismissedFromStorage = false;
    try {
      avatarDismissed = wx.getStorageSync(AVATAR_BADGE_STORAGE_KEY) === true;
    } catch (err) {
      // Ignore storage errors and keep the avatar badge visible by default.
    }
    try {
      this.nameBadgeDismissedFromStorage = wx.getStorageSync(NAME_BADGE_STORAGE_KEY) === true;
    } catch (err) {
      // Ignore storage errors and keep the name badge visible by default.
      this.nameBadgeDismissedFromStorage = false;
    }
    try {
      const storedAppearanceBadges = wx.getStorageSync(AVATAR_TAB_BADGE_STORAGE_KEY);
      appearanceState = normalizeAppearanceBadgeState(storedAppearanceBadges);
    } catch (err) {
      // Ignore storage errors and show all appearance badge dots by default.
    }
    if (avatarDismissed) {
      appearanceState = markAllAppearanceBadgesDismissed();
    }
    const nextState = { appearanceBadgeState: appearanceState };
    const avatarBadgeCleared = avatarDismissed || areAllAppearanceBadgesDismissed(appearanceState);
    if (avatarBadgeCleared && this.data.showAvatarBadge) {
      nextState.showAvatarBadge = false;
    }
    if (Object.keys(nextState).length > 0) {
      this.setData(nextState);
    }
    this.syncNameBadgeVisibility();
  },

  syncNameBadgeVisibility(memberOverride) {
    const member = memberOverride || this.data.member;
    const nickName =
      member && typeof member.nickName === 'string' ? member.nickName.trim() : '';
    const hasName = !!nickName;
    const dismissed = this.nameBadgeDismissedFromStorage === true;
    const shouldShow = !hasName || !dismissed;
    if (shouldShow !== this.data.showNameBadge) {
      this.setData({ showNameBadge: shouldShow });
    }
  },

  shouldShowOnboarding(needsProfile) {
    if (!needsProfile) {
      return false;
    }
    if (this.hasVisitedOtherPage) {
      return true;
    }
    return false;
  },

  persistNavExpansionState() {
    try {
      wx.setStorageSync(NAV_EXPANDED_STORAGE_KEY, true);
    } catch (err) {
      // Ignore storage errors because persistence is a best-effort enhancement.
    }
  },

  markAppearanceTabVisited(tab) {
    if (!APPEARANCE_BADGE_TABS.includes(tab)) {
      return;
    }
    const currentState = this.data.appearanceBadgeState
      ? { ...this.data.appearanceBadgeState }
      : cloneDefaultAppearanceBadgeState();
    if (currentState[tab] === true) {
      return;
    }
    const nextState = { ...currentState, [tab]: true };
    this.setData({ appearanceBadgeState: nextState });
    try {
      wx.setStorageSync(AVATAR_TAB_BADGE_STORAGE_KEY, nextState);
    } catch (err) {
      // Ignore storage errors so red dots still clear in the current session.
    }
    if (areAllAppearanceBadgesDismissed(nextState)) {
      this.dismissAvatarBadge(nextState);
    }
  },

  dismissAvatarBadge(appearanceStateOverride) {
    if (!this.data.showAvatarBadge) {
      return;
    }
    const appearanceState = appearanceStateOverride || this.data.appearanceBadgeState;
    if (!areAllAppearanceBadgesDismissed(appearanceState)) {
      return;
    }
    this.setData({ showAvatarBadge: false });
    try {
      wx.setStorageSync(AVATAR_BADGE_STORAGE_KEY, true);
    } catch (err) {
      // Swallow storage errors so the UI can continue without persistence.
    }
  },

  dismissNameBadge() {
    if (!this.data.showNameBadge) {
      return;
    }
    const member = this.data.member || {};
    const nickName = typeof member.nickName === 'string' ? member.nickName.trim() : '';
    if (!nickName) {
      return;
    }
    this.nameBadgeDismissedFromStorage = true;
    this.setData({ showNameBadge: false });
    try {
      wx.setStorageSync(NAME_BADGE_STORAGE_KEY, true);
    } catch (err) {
      // Swallow storage errors so the UI can continue without persistence.
    }
  },

  formatCurrency,
  formatExperience,

  handleExpandNav() {
    if (this.data.navExpanded) {
      return;
    }
    this.setData({ navExpanded: true }, () => {
      this.persistNavExpansionState();
    });
  },

  handleProfileTap() {
    this.dismissNameBadge();
    this.openArchiveEditor();
  },

  handleAvatarTap() {
    this.openAvatarPicker('avatar');
  },

  handleTitleTap() {
    this.openAvatarPicker('title');
  },

  handleCombatPowerTap() {
    wx.navigateTo({ url: '/pages/role/index?tab=character' });
  },

  handleStoneTap() {
    wx.navigateTo({ url: '/pages/stones/stones' });
  },

  handleLevelTap() {
    wx.navigateTo({ url: '/pages/membership/membership' });
  },

  handleExperienceTap() {
    wx.navigateTo({ url: '/pages/membership/membership' });
  },

  openArchiveEditor() {
    const member = this.data.member || {};
    const nickName = member.nickName || '';
    const gender = normalizeGenderValue(member.gender);
    const avatarUrl = member.avatarUrl || this.data.defaultAvatar;
    const appearanceBackground = resolveSafeBackgroundId(member, member.appearanceBackground);
    const renameHistory = formatHistoryList(member.renameHistory);
    this.setData({
      showProfile: true,
      profileSaving: false,
      renameRedeeming: false,
      profileEditor: {
        ...this.data.profileEditor,
        nickName,
        gender,
        avatarUrl,
        appearanceBackground,
        appearanceBackgroundAnimated: !!member.appearanceBackgroundAnimated,
        renameCredits: member.renameCredits || 0,
        renameCards: member.renameCards || 0,
        renameUsed: member.renameUsed || 0,
        renameHistory
      }
    });
  },

  handleCloseProfile() {
    if (this.data.profileSaving) {
      return;
    }
    this.setData({
      showProfile: false,
      profileSaving: false,
      renameRedeeming: false
    });
  },

  handleArchiveNickname(event) {
    const detail = event && event.detail ? event.detail : {};
    const value = typeof detail.value === 'string' ? detail.value : '';
    this.setData({
      'profileEditor.nickName': value
    });
  },

  handleGenderSelect(event) {
    if (this.data.profileSaving) {
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const value = dataset.value;
    const gender = normalizeGenderValue(value);
    this.setData({ 'profileEditor.gender': gender });
    if (this.data.showAvatarPicker) {
      this.refreshAvatarPickerOptions();
    }
  },

  handleAppearanceTabChange(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const tab = typeof dataset.tab === 'string' ? dataset.tab : '';
    if (!tab) {
      return;
    }
    this.markAppearanceTabVisited(tab);
    if (tab === this.data.avatarPicker.activeTab) {
      return;
    }
    const updates = {
      'avatarPicker.activeTab': tab
    };
    if (tab === 'background') {
      updates['avatarPicker.backgroundOptions'] = buildBackgroundOptionList(
        this.data.member,
        resolveBackgroundOptionContext(this, this.data.member)
      );
    }
    if (tab === 'title') {
      updates['avatarPicker.titleOptions'] = buildTitleOptionList(this.data.member);
    }
    this.setData(updates);
  },

  openAvatarPicker(initialTab = 'avatar') {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const normalizedTab = APPEARANCE_BADGE_TABS.includes(initialTab) ? initialTab : 'avatar';
    const member = this.data.member || {};
    const gender = normalizeGenderValue(this.data.profileEditor.gender || member.gender);
    const baseAvatar = sanitizeAvatarUrl(member.avatarUrl);
    const options = computeAvatarOptionList(member, baseAvatar, gender);
    const avatarUrl = resolveAvatarSelection(options, baseAvatar, gender) || this.data.defaultAvatar;
    const frameOptions = cloneAvatarFrameOptions();
    const currentFrame = sanitizeAvatarFrame(
      this.data.profileEditor.avatarFrame || member.avatarFrame || ''
    );
    const backgroundId = this.data.globalBackgroundEnforced
      ? resolveActiveBackgroundId(member, this)
      : resolveSafeBackgroundId(
          member,
          this.data.profileEditor.appearanceBackground || member.appearanceBackground
        );
    const backgroundOptions = buildBackgroundOptionList(
      member,
      resolveBackgroundOptionContext(this, member)
    );
    const dynamicBackground =
      typeof this.data.profileEditor.appearanceBackgroundAnimated === 'boolean'
        ? this.data.profileEditor.appearanceBackgroundAnimated
        : !!member.appearanceBackgroundAnimated;
    const appearanceTitle = resolveActiveTitleId(member, this.data.profileEditor.appearanceTitle || member.appearanceTitle);
    const titleOptions = buildTitleOptionList(member);
    const updates = {
      showAvatarPicker: true,
      avatarPickerSaving: false,
      avatarPicker: {
        activeTab: normalizedTab,
        avatarUrl,
        avatarOptions: options,
        avatarFrame: currentFrame,
        frameOptions,
        backgroundId,
        backgroundOptions,
        dynamicBackground,
        appearanceTitle,
        titleOptions
      }
    };
    if (avatarUrl && this.data.profileEditor.avatarUrl !== avatarUrl) {
      updates['profileEditor.avatarUrl'] = avatarUrl;
    }
    if (this.data.profileEditor.avatarFrame !== currentFrame) {
      updates['profileEditor.avatarFrame'] = currentFrame;
    }
    if (this.data.profileEditor.appearanceBackground !== backgroundId) {
      updates['profileEditor.appearanceBackground'] = backgroundId;
    }
    if (this.data.profileEditor.appearanceBackgroundAnimated !== dynamicBackground) {
      updates['profileEditor.appearanceBackgroundAnimated'] = dynamicBackground;
    }
    if (this.data.profileEditor.appearanceTitle !== appearanceTitle) {
      updates['profileEditor.appearanceTitle'] = appearanceTitle;
    }
    this.setData(updates, () => {
      this.markAppearanceTabVisited(normalizedTab);
    });
  },

  handleCloseAvatarPicker() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    this.setData({
      showAvatarPicker: false,
      avatarPickerSaving: false
    });
  },

  refreshAvatarPickerOptions() {
    const member = this.data.member || {};
    const gender = normalizeGenderValue(this.data.profileEditor.gender || member.gender);
    const preferredAvatar = sanitizeAvatarUrl(this.data.avatarPicker.avatarUrl) || sanitizeAvatarUrl(member.avatarUrl);
    const avatarOptions = computeAvatarOptionList(member, preferredAvatar, gender);
    const avatarUrl = resolveAvatarSelection(avatarOptions, preferredAvatar, gender) || this.data.defaultAvatar;
    const titleOptions = buildTitleOptionList(this.data.member);
    const appearanceTitle = resolveActiveTitleId(this.data.member, this.data.profileEditor.appearanceTitle);
    const updates = {
      'avatarPicker.avatarOptions': avatarOptions,
      'avatarPicker.avatarUrl': avatarUrl,
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(
        this.data.member,
        resolveBackgroundOptionContext(this, this.data.member)
      ),
      'avatarPicker.titleOptions': titleOptions,
      'avatarPicker.appearanceTitle': appearanceTitle
    };
    if (avatarUrl && this.data.profileEditor.avatarUrl !== avatarUrl) {
      updates['profileEditor.avatarUrl'] = avatarUrl;
    }
    if (this.data.profileEditor.appearanceTitle !== appearanceTitle) {
      updates['profileEditor.appearanceTitle'] = appearanceTitle;
    }
    this.setData(updates);
  },

  handleAvatarPickerSelect(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const url = sanitizeAvatarUrl(dataset.url) || dataset.url;
    if (typeof url === 'string' && url) {
      this.setData({
        'avatarPicker.avatarUrl': url,
        'profileEditor.avatarUrl': url
      });
    }
  },

  handleAvatarFrameSelect(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const frame = sanitizeAvatarFrame(dataset.url || '');
    this.setData({
      'avatarPicker.avatarFrame': frame,
      'profileEditor.avatarFrame': frame
    });
  },

  handleTitleSelect(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const rawId = typeof dataset.id === 'string' ? dataset.id : '';
    const normalizedId = normalizeTitleId(rawId);
    if (!normalizedId) {
      this.setData({
        'avatarPicker.appearanceTitle': '',
        'profileEditor.appearanceTitle': ''
      });
      return;
    }
    const unlocks = resolveTitleUnlocks(this.data.member);
    if (!unlocks.includes(normalizedId)) {
      return;
    }
    this.setData({
      'avatarPicker.appearanceTitle': normalizedId,
      'profileEditor.appearanceTitle': normalizedId
    });
  },

  handleBackgroundSelect(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    if (this.data.globalBackgroundEnforced) {
      wx.showToast({ title: '全局背景已启用，暂不可修改', icon: 'none' });
      return;
    }
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const disabled = dataset.disabled === true || dataset.disabled === 'true';
    if (disabled) {
      const hint = typeof dataset.hint === 'string' && dataset.hint ? dataset.hint : '该背景尚未解锁';
      wx.showToast({ title: hint, icon: 'none' });
      return;
    }
    const backgroundId = normalizeBackgroundId(dataset.id || '');
    if (!backgroundId) {
      return;
    }
    this.setData({
      'avatarPicker.backgroundId': backgroundId,
      'profileEditor.appearanceBackground': backgroundId
    });
  },

  handleDynamicBackgroundToggle(event) {
    if (this.data.avatarPickerSaving) {
      return;
    }
    if (this.data.globalBackgroundEnforced) {
      wx.showToast({ title: '全局背景已启用，暂不可修改', icon: 'none' });
      return;
    }
    const detail = event && event.detail ? event.detail : {};
    const value = !!detail.value;
    this.setData({
      'avatarPicker.dynamicBackground': value,
      'profileEditor.appearanceBackgroundAnimated': value
    });
  },

  async handleAvatarPickerConfirm() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const avatarUrl = sanitizeAvatarUrl(this.data.avatarPicker.avatarUrl) || this.data.defaultAvatar;
    const avatarFrame = sanitizeAvatarFrame(this.data.avatarPicker.avatarFrame);
    const backgroundId = this.data.globalBackgroundEnforced
      ? resolveSafeBackgroundId(this.data.member, this.data.member && this.data.member.appearanceBackground)
      : resolveSafeBackgroundId(
          this.data.member,
          this.data.avatarPicker.backgroundId || this.data.profileEditor.appearanceBackground
        );
    const isAnimated = this.data.globalBackgroundEnforced
      ? !!(this.data.member && this.data.member.appearanceBackgroundAnimated)
      : !!this.data.avatarPicker.dynamicBackground;
    const appearanceTitle = resolveActiveTitleId(this.data.member, this.data.avatarPicker.appearanceTitle);
    this.setData({ avatarPickerSaving: true });
    try {
      const payload = {
        avatarUrl,
        avatarFrame,
        appearanceTitle
      };
      if (!this.data.globalBackgroundEnforced) {
        payload.appearanceBackground = backgroundId;
        payload.appearanceBackgroundAnimated = isAnimated;
      }
      const member = await MemberService.updateArchive(payload);
      this.applyMemberUpdate(member);
      this.setData({
        showAvatarPicker: false,
        'profileEditor.avatarUrl': avatarUrl,
        'profileEditor.avatarFrame': avatarFrame,
        'profileEditor.appearanceBackground': backgroundId,
        'profileEditor.appearanceBackgroundAnimated': isAnimated,
        'profileEditor.appearanceTitle': appearanceTitle,
        'avatarPicker.dynamicBackground': isAnimated,
        'avatarPicker.appearanceTitle': appearanceTitle,
        activeTitleImage: buildTitleImageUrl(appearanceTitle)
      });
      wx.showToast({ title: '外观已更新', icon: 'success' });
    } catch (error) {
      // callCloud 已提示
    } finally {
      this.setData({ avatarPickerSaving: false });
    }
  },

  async handleArchiveSubmit() {
    if (this.data.profileSaving) {
      return;
    }
    const nickName = (this.data.profileEditor.nickName || '').trim();
    if (!nickName) {
      wx.showToast({ title: '请输入道号', icon: 'none' });
      return;
    }
    const appearanceTitle = resolveActiveTitleId(this.data.member, this.data.profileEditor.appearanceTitle);
    const payload = {
      nickName,
      gender: this.data.profileEditor.gender,
      avatarUrl: sanitizeAvatarUrl(this.data.profileEditor.avatarUrl) || this.data.defaultAvatar,
      avatarFrame: sanitizeAvatarFrame(this.data.profileEditor.avatarFrame),
      appearanceTitle
    };
    if (!this.data.globalBackgroundEnforced) {
      payload.appearanceBackground = resolveSafeBackgroundId(
        this.data.member,
        this.data.profileEditor.appearanceBackground
      );
      payload.appearanceBackgroundAnimated = !!this.data.profileEditor.appearanceBackgroundAnimated;
    }
    this.setData({ profileSaving: true });
    try {
      const member = await MemberService.updateArchive(payload);
      this.applyMemberUpdate(member);
      this.setData({ showProfile: false });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      // callCloud 已提示
    } finally {
      this.setData({ profileSaving: false });
    }
  },

  async handleUseRenameCard() {
    if (this.data.renameRedeeming || this.data.profileSaving) {
      return;
    }
    if (!this.data.profileEditor.renameCards) {
      wx.showToast({ title: '暂无改名卡', icon: 'none' });
      return;
    }
    this.setData({ renameRedeeming: true });
    try {
      const member = await MemberService.redeemRenameCard(1);
      this.applyMemberUpdate(member);
      wx.showToast({ title: '改名次数 +1', icon: 'success' });
    } catch (error) {
      // callCloud 已提示
    } finally {
      this.setData({ renameRedeeming: false });
    }
  },

  applyMemberUpdate(member, options = {}) {
    if (!member) {
      return;
    }
    const sanitizedMember = buildSanitizedMember(member);
    if (!sanitizedMember) {
      return;
    }
    this.memberBackgroundCatalog = sanitizedMember.backgroundCatalog || [];
    this.refreshBackgroundRegistry(this.memberBackgroundCatalog);
    const renameHistory = formatHistoryList(member.renameHistory);
    const navItems = resolveNavItems(sanitizedMember);
    const collapsedNavItems = buildCollapsedNavItems(navItems);
    this.setData({
      member: sanitizedMember,
      proxySession: sanitizedMember ? sanitizedMember.proxySession || null : null,
      memberStats: deriveMemberStats(sanitizedMember),
      navItems,
      collapsedNavItems,
      heroImage: resolveCharacterImage(sanitizedMember),
      heroFigureScaleClass: resolveHeroFigureScaleClass(sanitizedMember),
      'profileEditor.nickName': sanitizedMember.nickName || this.data.profileEditor.nickName,
      'profileEditor.gender': normalizeGenderValue(sanitizedMember.gender),
      'profileEditor.avatarUrl': sanitizedMember.avatarUrl || this.data.profileEditor.avatarUrl,
      'profileEditor.avatarFrame': sanitizedMember.avatarFrame,
      'profileEditor.appearanceTitle': sanitizedMember.appearanceTitle,
      'profileEditor.appearanceBackground': sanitizedMember.appearanceBackground,
      'profileEditor.appearanceBackgroundAnimated': !!sanitizedMember.appearanceBackgroundAnimated,
      'avatarPicker.avatarUrl': sanitizedMember.avatarUrl || this.data.avatarPicker.avatarUrl,
      'avatarPicker.avatarFrame': sanitizedMember.avatarFrame,
      'avatarPicker.frameOptions': this.data.avatarPicker.frameOptions && this.data.avatarPicker.frameOptions.length
        ? this.data.avatarPicker.frameOptions
        : cloneAvatarFrameOptions(),
      'avatarPicker.backgroundId': resolveActiveBackgroundId(sanitizedMember, this),
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(
        sanitizedMember,
        resolveBackgroundOptionContext(this, sanitizedMember)
      ),
      'avatarPicker.appearanceTitle': sanitizedMember.appearanceTitle,
      'avatarPicker.titleOptions': buildTitleOptionList(sanitizedMember),
      'avatarPicker.dynamicBackground': !!sanitizedMember.appearanceBackgroundAnimated,
      'profileEditor.renameCredits': sanitizedMember.renameCredits || 0,
      'profileEditor.renameCards': sanitizedMember.renameCards || 0,
      'profileEditor.renameUsed': sanitizedMember.renameUsed || 0,
      'profileEditor.renameHistory': renameHistory,
      activeTitleImage: buildTitleImageUrl(sanitizedMember.appearanceTitle)
    });
    this.updateBackgroundDisplay(sanitizedMember, { resetError: true });
    this.syncNameBadgeVisibility(sanitizedMember);
    if (this.data.showAvatarPicker) {
      this.refreshAvatarPickerOptions();
    }
    if (options.propagate !== false) {
      setActiveMember(sanitizedMember);
    }
  },

  handleNicknameInput(event) {
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      onboarding: {
        ...this.data.onboarding,
        nickName: value
      }
    });
  },

  handleRequestUserProfile() {
    wx.getUserProfile({
      desc: '用于完善会员昵称与头像',
      success: (res) => {
        const info = res && res.userInfo ? res.userInfo : {};
        const avatarUrl = sanitizeAvatarUrl(info.avatarUrl || '');
        const resolvedAvatarUrl =
          avatarUrl || this.data.onboarding.avatarUrl || this.data.defaultAvatar;
        this.setData({
          onboarding: {
            ...this.data.onboarding,
            nickName: info.nickName || this.data.onboarding.nickName,
            avatarUrl: resolvedAvatarUrl
          },
          'authorizationStatus.profileAuthorized': true
        });
        wx.showToast({
          title: '已获取微信昵称',
          icon: 'success'
        });
      },
      fail: () => {
        wx.showToast({
          title: '未获取到昵称信息',
          icon: 'none'
        });
      }
    });
  },

  handleGetPhoneNumber(event) {
    const detail = event && event.detail ? event.detail : {};
    if (detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({
        title: '需要手机号授权',
        icon: 'none'
      });
      return;
    }
    this.setData({
      onboarding: {
        ...this.data.onboarding,
        mobile: detail.phoneNumber || this.data.onboarding.mobile,
        phoneCloudId: detail.cloudID || '',
        phoneCode: detail.code || ''
      },
      'authorizationStatus.phoneAuthorized': true
    });
    wx.showToast({
      title: '已授权手机号',
      icon: 'success'
    });
  },

  async handleOnboardingConfirm() {
    if (this.data.onboardingSubmitting) {
      return;
    }
    const nickName = (this.data.onboarding.nickName || '').trim();
    const mobile = (this.data.onboarding.mobile || '').trim();
    const phoneCloudId = this.data.onboarding.phoneCloudId || '';
    const phoneCode = this.data.onboarding.phoneCode || '';
    const { profileAuthorized, phoneAuthorized } = this.data.authorizationStatus;
    if (!profileAuthorized) {
      wx.showToast({
        title: '请先授权微信昵称',
        icon: 'none'
      });
      return;
    }
    if (!phoneAuthorized) {
      wx.showToast({
        title: '请先授权手机号',
        icon: 'none'
      });
      return;
    }
    if (!nickName) {
      wx.showToast({
        title: '请填写昵称',
        icon: 'none'
      });
      return;
    }
    if (!mobile && !phoneCloudId && !phoneCode) {
      wx.showToast({
        title: '请授权手机号',
        icon: 'none'
      });
      return;
    }
    this.setData({ onboardingSubmitting: true });
    try {
      await MemberService.completeProfile(
        {
          nickName,
          avatarUrl: this.data.onboarding.avatarUrl
        },
        {
          phoneCloudId: this.data.onboarding.phoneCloudId,
          phoneCode: this.data.onboarding.phoneCode,
          phoneNumber: mobile
        }
      );
      this.setData({
        showOnboarding: false,
        onboarding: {
          ...this.data.onboarding,
          phoneCloudId: '',
          phoneCode: ''
        },
        authorizationStatus: {
          profileAuthorized: false,
          phoneAuthorized: false
        }
      });
      await this.bootstrap({ showLoading: false });
    } catch (error) {
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    } finally {
      this.setData({ onboardingSubmitting: false });
    }
  },

  handleActivityTap(event) {
    const { url, label } = event.currentTarget.dataset;
    if (url) {
      wx.navigateTo({ url });
      return;
    }
    wx.showToast({
      title: `${label} · 敬请期待`,
      icon: 'none'
    });
  },

  handleNavTap(event) {
    const { url, action } = event.currentTarget.dataset;
    if (action === PROXY_LOGOUT_ACTION) {
      this.handleProxyLogout();
      return;
    }
    if (url) {
      wx.navigateTo({ url });
    }
  },

  async handleProxyLogout() {
    if (this.data.proxyLogoutPending) {
      return;
    }
    if (!this.data.proxySession) {
      return;
    }
    this.setData({ proxyLogoutPending: true });
    wx.showLoading({ title: '恢复中', mask: true });
    try {
      await AdminService.proxyLogout();
      await this.bootstrap({ showLoading: true });
      wx.hideLoading();
      wx.showToast({ title: '已退出', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '退出失败，请重试', icon: 'none' });
      console.error('[home] proxy logout failed', error);
    } finally {
      this.setData({ proxyLogoutPending: false });
    }
  },

  onShareAppMessage() {
    return {
      title: '酒隐之茄 · 仙界生活',
      path: '/pages/index/index',
      imageUrl: SHARE_COVER_IMAGE_URL
    };
  },

  onShareTimeline() {
    return {
      title: '酒隐之茄 · 仙界生活',
      imageUrl: SHARE_COVER_IMAGE_URL
    };
  }
});
