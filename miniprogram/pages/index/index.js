import { MemberService, TaskService, PveService } from '../../services/api';
import { setActiveMember, subscribe as subscribeMemberRealtime } from '../../services/member-realtime';
import { formatCombatPower, formatCurrency, formatExperience, formatStones } from '../../utils/format';
import { shouldShowRoleBadge, resolveTimestamp } from '../../utils/pending-attributes';
import {
  updateBadgeSignature,
  updateBadgeEntries,
  shouldShowBadge,
  acknowledgeBadge,
  buildIdListSignature,
  buildNumericSignature,
  combineSignatures
} from '../../utils/badge-center';
import { sanitizeEquipmentProfile } from '../../utils/equipment';
import { extractNewStorageItemsFromProfile } from '../../utils/storage-notifications';
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
  isBackgroundUnlocked
} = require('../../shared/backgrounds.js');
const { AVATAR_IMAGE_BASE_PATH, CHARACTER_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');
const { buildTitleImageUrl, resolveTitleById, normalizeTitleId } = require('../../shared/titles.js');
const { listAvatarIds: listAllAvatarIds } = require('../../shared/avatar-catalog.js');
const { SHARE_COVER_IMAGE_URL } = require('../../shared/common.js');

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
const WECHAT_DEFAULT_AVATAR_URL =
  'https://thirdwx.qlogo.cn/mmopen/vi_32/POgEwh4mIHO4nibH0KlMECNjjGxQUq24ZEaGT4poC6icRiccVGKSyXwibcPq4BWmiaIGuG1icwxaQX6grC9VemZoJ8rg/132';

const app = getApp();

const NAV_EXPANDED_STORAGE_KEY = 'home-nav-expanded';

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

function buildDefaultNavItems() {
  const showRoleDot = shouldShowRoleBadge(null);
  return BASE_NAV_ITEMS.map((item) => {
    if (item.label === '角色') {
      return { ...item, showDot: showRoleDot };
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

  const tryAdd = (item) => {
    if (!item || seen.has(item.label) || selected.length >= MAX_ITEMS) {
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

function resolveBackgroundDisplay(member) {
  const { image, video } = resolveBackgroundMediaSources(member);
  return {
    image,
    video,
    dynamicEnabled: !!(member && member.appearanceBackgroundAnimated)
  };
}

function buildBackgroundOptionList(member) {
  const realmOrder = resolveMemberRealmOrder(member);
  const activeId = resolveSafeBackgroundId(member, member && member.appearanceBackground);
  const backgrounds = listBackgrounds();
  let visibleBackgrounds = backgrounds;
  if (!isMemberAdmin(member)) {
    const maxRealmOrder = backgrounds.length ? backgrounds[backgrounds.length - 1].realmOrder : 1;
    const highestVisibleOrder = Math.min(maxRealmOrder, realmOrder + 1);
    visibleBackgrounds = backgrounds.filter((background) => background.realmOrder <= highestVisibleOrder);
  }
  const backgroundUnlocks = resolveBackgroundUnlocks(member);
  return visibleBackgrounds.map((background) => {
    const unlocked = isBackgroundUnlocked(background.id, realmOrder, backgroundUnlocks);
    let description = background.unlockType === 'manual' ? '使用奖励道具后解锁' : `突破至${background.realmName}解锁`;
    if (unlocked) {
      description = background.id === activeId ? '当前使用' : '已解锁';
    }
    return {
      ...background,
      unlocked,
      description
    };
  });
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

function buildReservationBadgeSignature(badges) {
  const normalized = normalizeReservationBadges(badges);
  const version = Math.max(0, Number(normalized.memberVersion || 0));
  const seenVersion = Math.max(0, Number(normalized.memberSeenVersion || 0));
  const pendingCount = Math.max(0, Number(normalized.pendingApprovalCount || 0));
  return `reservation:${version}:${seenVersion}:${pendingCount}`;
}

function extractAvatarFrameUnlocks(member) {
  if (!member || typeof member !== 'object') {
    return [];
  }
  const unlocks = [];
  if (Array.isArray(member.avatarFrameUnlocks)) {
    unlocks.push(...member.avatarFrameUnlocks);
  }
  if (member.extras && Array.isArray(member.extras.avatarFrameUnlocks)) {
    unlocks.push(...member.extras.avatarFrameUnlocks);
  }
  const normalized = [];
  const seen = new Set();
  unlocks.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function normalizeBadgeEntryKey(item, fallbackCategory = 'storage', index = 0) {
  const candidates = [];
  if (item && typeof item === 'object') {
    candidates.push(
      item.storageBadgeKey,
      item.storageKey,
      item.badgeKey,
      item.inventoryId,
      item.inventoryKey,
      item.itemId,
      item.id,
      item._id,
      item.slot
    );
  }
  let category = typeof (item && item.storageCategory) === 'string' ? item.storageCategory.trim() : '';
  if (!category) {
    category = fallbackCategory;
  }
  let identifier = '';
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate === null || typeof candidate === 'undefined') {
      continue;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.includes(':')) {
        return trimmed;
      }
      identifier = trimmed;
      break;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      identifier = String(candidate);
      break;
    }
  }
  if (!identifier) {
    identifier = `idx-${index}`;
  }
  return `${category || 'storage'}:${identifier}`;
}

function isTruthyFlag(value) {
  if (!value) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value !== 0 : false;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return false;
    }
    return trimmed !== '0' && trimmed !== 'false' && trimmed !== 'no' && trimmed !== 'none';
  }
  return false;
}

function collectEquipmentBadgeEntriesFromProfile(profile) {
  const equipment = profile && profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : {};
  const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const entries = [];
  inventory.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    if (!isTruthyFlag(item.isNew || item.new || item.hasNewBadge || item.hasNew)) {
      return;
    }
    const key = normalizeBadgeEntryKey(item, 'equipment', index);
    const timestamp = resolveTimestamp(
      item.obtainedAt || item.obtainTime || item.obtainedAtText || item.updatedAt || item.createdAt || 0
    );
    entries.push({ key, timestamp });
  });
  const storage =
    equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : { categories: [] };
  const categories = Array.isArray(storage.categories) ? storage.categories : [];
  categories.forEach((category) => {
    if (!category || category.key !== 'equipment' || !Array.isArray(category.items)) {
      return;
    }
    category.items.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      if (!isTruthyFlag(item.isNew || item.new || item.hasNewBadge || item.hasNew)) {
        return;
      }
      const key = normalizeBadgeEntryKey(item, 'equipment', index);
      const timestamp = resolveTimestamp(
        item.obtainedAt || item.obtainTime || item.obtainedAtText || item.updatedAt || item.createdAt || 0
      );
      entries.push({ key, timestamp });
    });
  });
  if (!entries.length) {
    return [];
  }
  const deduped = new Map();
  entries.forEach((entry) => {
    if (!entry || !entry.key) {
      return;
    }
    const current = deduped.get(entry.key);
    if (!current || (entry.timestamp || 0) > (current.timestamp || 0)) {
      deduped.set(entry.key, entry);
    }
  });
  return Array.from(deduped.values());
}

function mapStorageEntriesForBadges(profile) {
  const entries = extractNewStorageItemsFromProfile(profile);
  if (!Array.isArray(entries) || !entries.length) {
    return [];
  }
  return entries
    .filter((entry) => entry && entry.key)
    .map((entry) => ({ key: entry.key, timestamp: Number(entry.obtainedAt) || 0 }));
}

function buildRealmBadgeSignature(progress) {
  if (!progress || !Array.isArray(progress.levels)) {
    return 'realm:none';
  }
  const claimableIds = progress.levels
    .filter((level) => level && level.claimable)
    .map((level) => level._id || level.id || '')
    .filter(Boolean);
  return buildIdListSignature(claimableIds, 'realm');
}

function buildStoneBadgeSignature(member) {
  if (!member) {
    return buildNumericSignature(0, 'stoneBalance');
  }
  return buildNumericSignature(member.stoneBalance || 0, 'stoneBalance');
}

function buildAppearanceBadgeSignature(member) {
  if (!member) {
    return {
      avatar: 'avatarUnlocks:none',
      frame: 'avatarFrames:none',
      title: 'titles:none',
      background: 'backgrounds:none',
      combined: 'appearance:none'
    };
  }
  const avatarUnlocks = buildIdListSignature(normalizeAvatarUnlocks(member.avatarUnlocks || []), 'avatarUnlocks');
  const frameUnlocks = buildIdListSignature(extractAvatarFrameUnlocks(member), 'avatarFrames');
  const titleUnlocks = buildIdListSignature(resolveTitleUnlocks(member), 'titles');
  const backgroundUnlocks = buildIdListSignature(member.backgroundUnlocks || [], 'backgrounds');
  const combined = combineSignatures([avatarUnlocks, frameUnlocks, titleUnlocks, backgroundUnlocks], 'appearance');
  return {
    avatar: avatarUnlocks,
    frame: frameUnlocks,
    title: titleUnlocks,
    background: backgroundUnlocks,
    combined
  };
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
  const match = url.trim().toLowerCase().match(/\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png$/);
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
  return {
    ...member,
    avatarUrl: sanitizedAvatar || '',
    avatarFrame: sanitizedFrame,
    appearanceBackground: sanitizedBackground,
    appearanceBackgroundAnimated: !!member.appearanceBackgroundAnimated,
    appearanceTitle,
    titleUnlocks,
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
  const navItems = BASE_NAV_ITEMS.map((item) => {
    const next = { ...item };
    if (item.label === '预订') {
      next.showDot = shouldShowBadge('home.nav.reservation') || shouldShowReservationDot(badges);
    }
    if (item.label === '角色') {
      next.showDot = roleHasPendingAttributes || shouldShowBadge('home.nav.role');
    }
    if (item.label === '装备') {
      next.showDot = shouldShowBadge('home.nav.equipment');
    }
    if (item.label === '纳戒') {
      next.showDot = shouldShowBadge('home.nav.storage');
    }
    if (item.label === '技能') {
      next.showDot = shouldShowBadge('home.nav.skill');
    }
    if (item.label === '点餐') {
      next.showDot = shouldShowBadge('menu.orders.pending');
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
  return navItems;
}

Page({
  data: {
    member: null,
    progress: null,
    progressRemainingExperience: formatExperience(0),
    realmHasPendingRewards: false,
    tasks: [],
    loading: true,
    backgroundImage: resolveBackgroundImage(null),
    backgroundVideo: resolveBackgroundVideo(null),
    showBackgroundVideo: false,
    showBackgroundOverlay: true,
    backgroundVideoError: false,
    dynamicBackgroundEnabled: false,
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
    defaultAvatar: DEFAULT_AVATAR,
    activeTitleImage: '',
    roleProfile: null,
    activityIcons: [
      { icon: '🎊', label: '活动', url: '/pages/activities/index' },
      { icon: '🏪', label: '商城', url: '/pages/mall/index' },
      { icon: '⚔️', label: '秘境', url: '/pages/pve/pve' },
      { icon: '🎉', label: '盛典', url: '/pages/rights/rights' },
      { icon: '🥊', label: '比武', url: '/pages/pvp/index' }
    ],
    navItems: INITIAL_NAV_ITEMS.slice(),
    collapsedNavItems: buildCollapsedNavItems(INITIAL_NAV_ITEMS),
    navExpanded: false,
    badgeState: {
      avatar: false,
      realm: false,
      stones: false
    },
    appearanceTabBadges: {
      avatar: false,
      frame: false,
      title: false,
      background: false
    },
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

  onLoad() {
    this.hasBootstrapped = false;
    this.hasVisitedOtherPage = false;
    this.ensureNavMetrics();
    this.updateToday();
    this.restoreNavExpansionState();
  },

  onShow() {
    this.ensureNavMetrics();
    this.updateToday();
    this.refreshNavBadgeState(member);
    this.refreshBadgeBindings();
    this.attachMemberRealtime();
    this.bootstrap();
  },

  onReady() {},

  onHide() {
    this.detachMemberRealtime();
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
  },

  ensureNavMetrics() {
    const { customNav = {} } = app.globalData || {};
    const navHeight = customNav.navHeight || 88;
    if (navHeight !== this.data.navHeight) {
      this.setData({ navHeight });
    }
  },

  updateBackgroundDisplay(member, options = {}) {
    const { image, video, dynamicEnabled } = resolveBackgroundDisplay(member);
    const shouldShowVideo = dynamicEnabled && !!video;
    const hasError = shouldShowVideo ? (options.resetError ? false : !!this.data.backgroundVideoError) : false;
    const showVideo = hasError ? false : shouldShowVideo;
    this.setData({
      backgroundImage: image,
      backgroundVideo: video,
      dynamicBackgroundEnabled: dynamicEnabled,
      showBackgroundVideo: showVideo,
      showBackgroundOverlay: !showVideo,
      backgroundVideoError: hasError
    });
  },

  refreshBadgeBindings() {
    this.setData({
      'badgeState.avatar': shouldShowBadge('home.avatar'),
      'badgeState.realm': shouldShowBadge('home.realm'),
      'badgeState.stones': shouldShowBadge('home.stones'),
      'appearanceTabBadges.avatar': shouldShowBadge('appearance.avatar'),
      'appearanceTabBadges.frame': shouldShowBadge('appearance.frame'),
      'appearanceTabBadges.title': shouldShowBadge('appearance.title'),
      'appearanceTabBadges.background': shouldShowBadge('appearance.background')
    });
    this.refreshNavBadgeState();
  },

  updateBadgeState(member, progress, roleProfile = null) {
    const appearanceSignatures = buildAppearanceBadgeSignature(member);
    updateBadgeSignature('appearance.avatar', appearanceSignatures.avatar, { initializeAck: true });
    updateBadgeSignature('appearance.frame', appearanceSignatures.frame, { initializeAck: true });
    updateBadgeSignature('appearance.title', appearanceSignatures.title, { initializeAck: true });
    updateBadgeSignature('appearance.background', appearanceSignatures.background, { initializeAck: true });
    updateBadgeSignature('home.avatar', appearanceSignatures.combined, { initializeAck: true });

    const stoneSignature = buildStoneBadgeSignature(member);
    updateBadgeSignature('home.stones', stoneSignature, { initializeAck: true });

    const realmSignature = buildRealmBadgeSignature(progress);
    updateBadgeSignature('home.realm', realmSignature);

    const reservationSignature = buildReservationBadgeSignature(member && member.reservationBadges);
    updateBadgeSignature('home.nav.reservation', reservationSignature, { initializeAck: true });

    if (roleProfile) {
      const sanitizedProfile = sanitizeEquipmentProfile(roleProfile);
      const equipmentEntries = collectEquipmentBadgeEntriesFromProfile(sanitizedProfile);
      const storageEntries = mapStorageEntriesForBadges(sanitizedProfile);
      const equipmentSignature = updateBadgeEntries('role.storage.equipment', equipmentEntries, {
        initializeAck: true,
        prefix: 'equipmentEntries'
      });
      const storageSignature = updateBadgeEntries('role.storage.items', storageEntries, {
        initializeAck: true,
        prefix: 'storageEntries'
      });
      const storageCombined = combineSignatures([equipmentSignature, storageSignature], 'storage');
      updateBadgeSignature('home.nav.storage', storageCombined, { initializeAck: true });
      updateBadgeSignature('home.nav.equipment', equipmentSignature || storageCombined, { initializeAck: true });
    }

    this.refreshBadgeBindings();
  },

  refreshNavBadgeState(memberOverride = null) {
    const sourceMember = memberOverride || this.data.member || null;
    const navItems = resolveNavItems(sourceMember);
    const collapsedNavItems = buildCollapsedNavItems(navItems);
    this.setData({ navItems, collapsedNavItems });
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
      const [member, progress, tasks, roleProfile] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress(),
        TaskService.list(),
        PveService.profile().catch((error) => {
          console.error('[home] load pve profile failed', error);
          return null;
        })
      ]);
      const sanitizedMember = buildSanitizedMember(member);
      this.updateBadgeState(sanitizedMember, progress, roleProfile);
      const navItems = resolveNavItems(sanitizedMember);
      const collapsedNavItems = buildCollapsedNavItems(navItems);
      const width = normalizePercentage(progress);
      const nextDiff = progress && typeof progress.nextDiff === 'number' ? progress.nextDiff : 0;
      const progressRemainingExperience = formatExperience(nextDiff);
      const needsProfile = !sanitizedMember || !sanitizedMember.nickName || !sanitizedMember.mobile;
      const shouldShowOnboarding = this.shouldShowOnboarding(needsProfile);
      const profileAuthorized = !!(sanitizedMember && sanitizedMember.nickName);
      const phoneAuthorized = !!(sanitizedMember && sanitizedMember.mobile);
      const realmHasPendingRewards = hasPendingLevelRewards(progress);
      this.setData({
        member: sanitizedMember,
        progress,
        progressRemainingExperience,
        realmHasPendingRewards,
        tasks: tasks.slice(0, 3),
        loading: false,
        heroImage: resolveCharacterImage(sanitizedMember),
        roleProfile,
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
        'avatarPicker.backgroundOptions': buildBackgroundOptionList(sanitizedMember),
        'avatarPicker.backgroundId': resolveSafeBackgroundId(
          sanitizedMember,
          sanitizedMember && sanitizedMember.appearanceBackground
        ),
        'avatarPicker.dynamicBackground': !!sanitizedMember.appearanceBackgroundAnimated
      });
      this.updateBackgroundDisplay(sanitizedMember, { resetError: true });
      setActiveMember(sanitizedMember);
    } catch (err) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        memberStats: deriveMemberStats(this.data.member),
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        heroImage: resolveCharacterImage(this.data.member)
      });
      this.updateBackgroundDisplay(this.data.member, {});
    }
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
    this.openArchiveEditor();
  },

  handleAvatarTap() {
    acknowledgeBadge(['home.avatar', 'appearance.avatar']);
    this.refreshBadgeBindings();
    this.openAvatarPicker();
  },

  handleCombatPowerTap() {
    acknowledgeBadge('home.nav.role');
    this.refreshNavBadgeState();
    wx.navigateTo({ url: '/pages/role/index?tab=character' });
  },

  handleStoneTap() {
    acknowledgeBadge('home.stones');
    this.refreshBadgeBindings();
    wx.navigateTo({ url: '/pages/stones/stones' });
  },

  handleLevelTap() {
    acknowledgeBadge('home.realm');
    this.refreshBadgeBindings();
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
    if (!tab || tab === this.data.avatarPicker.activeTab) {
      return;
    }
    const updates = {
      'avatarPicker.activeTab': tab
    };
    if (tab === 'background') {
      updates['avatarPicker.backgroundOptions'] = buildBackgroundOptionList(this.data.member);
    }
    if (tab === 'title') {
      updates['avatarPicker.titleOptions'] = buildTitleOptionList(this.data.member);
    }
    if (tab) {
      acknowledgeBadge(`appearance.${tab}`);
    }
    this.setData(updates, () => {
      this.refreshBadgeBindings();
    });
  },

  openAvatarPicker() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const member = this.data.member || {};
    const gender = normalizeGenderValue(this.data.profileEditor.gender || member.gender);
    const baseAvatar = sanitizeAvatarUrl(member.avatarUrl);
    const options = computeAvatarOptionList(member, baseAvatar, gender);
    const avatarUrl = resolveAvatarSelection(options, baseAvatar, gender) || this.data.defaultAvatar;
    const frameOptions = cloneAvatarFrameOptions();
    const currentFrame = sanitizeAvatarFrame(
      this.data.profileEditor.avatarFrame || member.avatarFrame || ''
    );
    const backgroundId = resolveSafeBackgroundId(member, this.data.profileEditor.appearanceBackground || member.appearanceBackground);
    const backgroundOptions = buildBackgroundOptionList(member);
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
        activeTab: 'avatar',
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
    acknowledgeBadge(['home.avatar', 'appearance.avatar']);
    this.setData(updates, () => {
      this.refreshBadgeBindings();
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
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(this.data.member),
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
    const detail = event && event.detail ? event.detail : {};
    const value = !!detail.value;
    this.setData({
      'avatarPicker.dynamicBackground': value,
      'profileEditor.appearanceBackgroundAnimated': value
    });
  },

  handleAvatarPickerSyncWechat() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const applyAvatarSelection = (avatarUrl, toastTitle) => {
      const normalizedAvatar = sanitizeAvatarUrl(avatarUrl || '') || avatarUrl;
      this.setData({
        'avatarPicker.avatarUrl': normalizedAvatar,
        'profileEditor.avatarUrl': normalizedAvatar
      });
      this.refreshAvatarPickerOptions();
      wx.showToast({ title: toastTitle, icon: 'success' });
    };
    const applyDefaultAvatar = () => {
      applyAvatarSelection(DEFAULT_AVATAR, '已使用默认头像');
    };
    wx.getUserProfile({
      desc: '用于同步微信头像',
      success: (res) => {
        const info = res && res.userInfo ? res.userInfo : {};
        const avatarUrl = sanitizeAvatarUrl(info.avatarUrl || '');
        if (avatarUrl) {
          applyAvatarSelection(avatarUrl, '已同步微信头像');
          return;
        }
        applyDefaultAvatar();
      },
      fail: () => {
        applyDefaultAvatar();
      }
    });
  },

  async handleAvatarPickerConfirm() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const avatarUrl = sanitizeAvatarUrl(this.data.avatarPicker.avatarUrl) || this.data.defaultAvatar;
    const avatarFrame = sanitizeAvatarFrame(this.data.avatarPicker.avatarFrame);
    const backgroundId = resolveSafeBackgroundId(
      this.data.member,
      this.data.avatarPicker.backgroundId || this.data.profileEditor.appearanceBackground
    );
    const isAnimated = !!this.data.avatarPicker.dynamicBackground;
    const appearanceTitle = resolveActiveTitleId(this.data.member, this.data.avatarPicker.appearanceTitle);
    this.setData({ avatarPickerSaving: true });
    try {
      const member = await MemberService.updateArchive({
        avatarUrl,
        avatarFrame,
        appearanceBackground: backgroundId,
        appearanceBackgroundAnimated: isAnimated,
        appearanceTitle
      });
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
      appearanceBackground: resolveSafeBackgroundId(
        this.data.member,
        this.data.profileEditor.appearanceBackground
      ),
      appearanceBackgroundAnimated: !!this.data.profileEditor.appearanceBackgroundAnimated,
      appearanceTitle
    };
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
    const renameHistory = formatHistoryList(member.renameHistory);
    const navItems = resolveNavItems(sanitizedMember);
    const collapsedNavItems = buildCollapsedNavItems(navItems);
    this.setData({
      member: sanitizedMember,
      memberStats: deriveMemberStats(sanitizedMember),
      navItems,
      collapsedNavItems,
      heroImage: resolveCharacterImage(sanitizedMember),
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
      'avatarPicker.backgroundId': resolveSafeBackgroundId(sanitizedMember, sanitizedMember.appearanceBackground),
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(sanitizedMember),
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
    if (this.data.showAvatarPicker) {
      this.refreshAvatarPickerOptions();
    }
    if (options.propagate !== false) {
      setActiveMember(sanitizedMember);
    }
    this.updateBadgeState(sanitizedMember, this.data.progress, this.data.roleProfile || null);
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
    const { url, label } = event.currentTarget.dataset;
    switch (label) {
      case '角色':
        acknowledgeBadge('home.nav.role');
        break;
      case '装备':
        acknowledgeBadge(['home.nav.equipment', 'role.storage.equipment']);
        break;
      case '纳戒':
        acknowledgeBadge(['home.nav.storage', 'role.storage.items']);
        break;
      case '技能':
        acknowledgeBadge('home.nav.skill');
        break;
      case '点餐':
        acknowledgeBadge('menu.orders.pending');
        break;
      case '预订':
        acknowledgeBadge('home.nav.reservation');
        break;
      default:
        break;
    }
    this.refreshNavBadgeState();
    wx.navigateTo({ url });
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
