import { MemberService, TaskService } from '../../services/api';
import { setActiveMember, subscribe as subscribeMemberRealtime } from '../../services/member-realtime';
import { formatCurrency, formatExperience, formatStones } from '../../utils/format';
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
const { CHARACTER_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');
const { listAvatarIds: listAllAvatarIds } = require('../../shared/avatar-catalog.js');

function buildCharacterImageMap() {
  const ids = listAllAvatarIds();
  return ids.reduce((acc, id) => {
    acc[id] = `${CHARACTER_IMAGE_BASE_PATH}/${id}.png`;
    return acc;
  }, {});
}

const CHARACTER_IMAGE_MAP = buildCharacterImageMap();

const app = getApp();

const BASE_NAV_ITEMS = [
  { icon: '💰', label: '钱包', url: '/pages/wallet/wallet' },
  { icon: '🍽️', label: '点餐', url: '/pages/membership/order/index' },
  { icon: '📅', label: '预订', url: '/pages/reservation/reservation' },
  { icon: '🧝', label: '角色', url: '/pages/role/index?tab=character' },
  { icon: '🛡️', label: '装备', url: '/pages/role/index?tab=equipment' },
  { icon: '💍', label: '纳戒', url: '/pages/role/index?tab=storage' },
  { icon: '📜', label: '技能', url: '/pages/role/index?tab=skill' }
  //{ icon: '🧙‍♀️', label: '造型', url: '/pages/avatar/avatar' }
];

const NAV_EXPANDED_STORAGE_KEY = 'home_nav_expanded';
const NAV_COLLAPSED_VISIBLE_COUNT = 3;
const MORE_NAV_ITEM = { icon: '➕', label: '更多', action: 'expand' };

const ADMIN_ALLOWED_ROLES = ['admin', 'developer'];

const AVATAR_FRAME_OPTIONS = buildAvatarFrameOptionList();

function buildVisibleNavItems(navItems, expanded) {
  if (expanded) {
    return navItems;
  }
  const primaryNavItems = navItems.slice(0, NAV_COLLAPSED_VISIBLE_COUNT);
  if (navItems.length <= NAV_COLLAPSED_VISIBLE_COUNT) {
    return primaryNavItems;
  }
  return [...primaryNavItems, { ...MORE_NAV_ITEM }];
}

function readNavExpandedState() {
  try {
    const storedValue = wx.getStorageSync(NAV_EXPANDED_STORAGE_KEY);
    if (typeof storedValue === 'boolean') {
      return storedValue;
    }
    if (storedValue === 'true') {
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

function persistNavExpandedState(expanded) {
  try {
    if (expanded) {
      wx.setStorageSync(NAV_EXPANDED_STORAGE_KEY, true);
    } else {
      wx.removeStorageSync(NAV_EXPANDED_STORAGE_KEY);
    }
  } catch (err) {
    // ignore storage errors
  }
}

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
  if (desiredId && isBackgroundUnlocked(desiredId, realmOrder)) {
    const desired = resolveBackgroundById(desiredId);
    if (desired) {
      return desired;
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
  return visibleBackgrounds.map((background) => {
    const unlocked = isBackgroundUnlocked(background.id, realmOrder);
    let description = `突破至${background.realmName}解锁`;
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
  if (sanitizedId && isBackgroundUnlocked(sanitizedId, realmOrder)) {
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
  return {
    ...member,
    avatarUrl: sanitizedAvatar || '',
    avatarFrame: sanitizedFrame,
    appearanceBackground: sanitizedBackground,
    appearanceBackgroundAnimated: !!member.appearanceBackgroundAnimated
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

const HERO_IMAGE =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjU2MCIgdmlld0JveD0iMCAwIDM2MCA1NjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZnM+' +
  'CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9ImF1cmEiIGN4PSI1MCUiIGN5PSIzMCUiIHI9IjcwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNm' +
  'ZWY2ZDgiIHN0b3Atb3BhY2l0eT0iMC44Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2ZlZjZkOCIgc3RvcC1vcGFjaXR5PSIwIi8+CiAg' +
  'ICA8L3JhZGlhbEdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJyb2JlIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9w' +
  'IG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmMGYyZmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI2MCUiIHN0b3AtY29sb3I9IiNhZGI2ZmYiLz4KICAgICAgPHN0b3Ag' +
  'b2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNmE0YmZmIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJzYXNoIiB4MT0iMCUiI' +
  'nkxPSIwJSIgeDI9IjEwMCUiIHkyPSIwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmM2I0ZmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxM' +
  'DAlIiBzdG9wLWNvbG9yPSIjN2Q0ZGZmIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8ZWxsaXBzZSBjeD0iMTgwIiBjeT0iNDYwIiByeD0iMTQwI' +
  'iByeT0iNjAiIGZpbGw9InVybCgjYXVyYSkiLz4KICA8Y2lyY2xlIGN4PSIxODAiIGN5PSIxMjAiIHI9IjYwIiBmaWxsPSIjZmZlOWQ2Ii8+CiAgPHBhdGggZD0iTTE4MC' +
  'AxODAgQzE3MCAyNDAgMTEwIDI2MCA5MCAzNjAgQzgwIDQyMCAxMTAgNTIwIDE4MCA1MjAgQzI1MCA1MjAgMjgwIDQyMCAyNzAgMzYwIEMyNTAgMjYwIDE5MCAyNDAgMT' +
  'gwIDE4MCBaIiBmaWxsPSJ1cmwoI3JvYmUpIi8+CiAgPHBhdGggZD0iTTE1MCAzMDAgUTE4MCAyNjAgMjEwIDMwMCBMMjQwIDQyMCBRMjA1IDQ0MCAxODAgNDQwIFExNT' +
  'UgNDQwIDEyMCA0MjAgWiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTTEyMCAzNDAgQzE2MCAzMTAgMjAwIDMxMCAyNDAgMzQwIiBmaW' +
  'xsPSJub25lIiBzdHJva2U9InVybCgjc2FzaCkiIHN0cm9rZS13aWR0aD0iMjAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik0xNTAgMTYwIFExODA' +
  'yMDAgMjEwIDE2MCIgZmlsbD0iI2ZmZGRiMiIvPgogIDxjaXJjbGUgY3g9IjE2MCIgY3k9IjEyMCIgcj0iMTAiIGZpbGw9IiMyNjI2NGYiLz4KICA8Y2lyY2xlIGN4PSI' +
  'yMDAiIGN5PSIxMjAiIHI9IjEwIiBmaWxsPSIjMjYyNjRmIi8+CiAgPHBhdGggZD0iTTE2MCAxNTAgUTE4MCAxNzAgMjAwIDE1MCIgc3Ryb2tlPSIjZDQ4YjhiIiBzdHJv' +
  'a2Utd2lkdGg9IjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4=';

const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iMTYwIiBoZWlnaHQ9IjE2MCIgdmlld0JveD0iMCAwIDE2MCAxNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZnM+' +
  'CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImF2YXRhckJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIg' +
  'c3RvcC1jb2xvcj0iIzczNTZmZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNiODkyZmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgP' +
  'C9kZWZzPgogIDxjaXJjbGUgY3g9IjgwIiBjeT0iODAiIHI9Ijc4IiBmaWxsPSJ1cmwoI2F2YXRhckJnKSIvPgogIDxjaXJjbGUgY3g9IjgwIiBjeT0iNzAiIHI9IjMwIi' +
  'BmaWxsPSIjZmNlMWMyIi8+CiAgPHBhdGggZD0iTTQwIDEzMCBRODAgMTAwIDEyMCAxMzAiIGZpbGw9IiNmMGY0ZmYiIHN0cm9rZT0iI2Q5ZGVmZiIgc3Ryb2tlLXdpZHRo' +
  'PSI0Ii8+Cjwvc3ZnPg==';

const EMPTY_MEMBER_STATS = {
  stoneBalance: formatStones(0),
  cashBalance: formatCurrency(0),
  experience: formatExperience(0)
};

function deriveMemberStats(member) {
  if (!member) {
    return { ...EMPTY_MEMBER_STATS };
  }

  return {
    stoneBalance: formatStones(member.stoneBalance ?? 0),
    cashBalance: formatCurrency(member.cashBalance ?? member.balance ?? 0),
    experience: formatExperience(member.experience ?? 0)
  };
}

function resolveNavItems(member) {
  const roles = Array.isArray(member && member.roles) ? member.roles : [];
  const badges = normalizeReservationBadges(member && member.reservationBadges);
  const navItems = BASE_NAV_ITEMS.map((item) => {
    if (item.label === '预订') {
      return { ...item, showDot: shouldShowReservationDot(badges) };
    }
    return { ...item };
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
    activityIcons: [
      { icon: '⚔️', label: '秘境', url: '/pages/pve/pve' },
      { icon: '🎉', label: '盛典', url: '/pages/rights/rights' },
      { icon: '🔥', label: '比武' }
    ],
    navItems: [...BASE_NAV_ITEMS],
    visibleNavItems: buildVisibleNavItems([...BASE_NAV_ITEMS], false),
    navExpanded: false,
    memberStats: { ...EMPTY_MEMBER_STATS },
    progressWidth: 0,
    progressStyle: buildWidthStyle(0),
    profileEditor: {
      nickName: '',
      gender: 'unknown',
      avatarUrl: '',
      avatarFrame: '',
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
      dynamicBackground: false
    },
  },

  onLoad() {
    this.hasBootstrapped = false;
    this.ensureNavMetrics();
    this.updateToday();
    this.initializeNavExpansionState();
  },

  onShow() {
    this.ensureNavMetrics();
    this.updateToday();
    this.attachMemberRealtime();
    this.bootstrap();
  },

  onReady() {},

  onHide() {
    this.detachMemberRealtime();
  },

  onUnload() {
    this.detachMemberRealtime();
  },

  initializeNavExpansionState() {
    const expanded = readNavExpandedState();
    if (expanded !== this.data.navExpanded) {
      this.setData({
        navExpanded: expanded,
        visibleNavItems: buildVisibleNavItems(this.data.navItems, expanded)
      });
    }
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
      const [member, progress, tasks] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress(),
        TaskService.list()
      ]);
      const sanitizedMember = buildSanitizedMember(member);
      const width = normalizePercentage(progress);
      const needsProfile = !sanitizedMember || !sanitizedMember.nickName || !sanitizedMember.mobile;
      const profileAuthorized = !!(sanitizedMember && sanitizedMember.nickName);
      const phoneAuthorized = !!(sanitizedMember && sanitizedMember.mobile);
      const navItems = resolveNavItems(sanitizedMember);
      const navExpanded = this.data.navExpanded;
      this.setData({
        member: sanitizedMember,
        progress,
        tasks: tasks.slice(0, 3),
        loading: false,
        heroImage: resolveCharacterImage(sanitizedMember),
        navItems,
        visibleNavItems: buildVisibleNavItems(navItems, navExpanded),
        memberStats: deriveMemberStats(sanitizedMember),
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        showOnboarding: needsProfile,
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

  formatCurrency,
  formatExperience,

  handleProfileTap() {
    this.openArchiveEditor();
  },

  handleAvatarTap() {
    this.openAvatarPicker();
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
    if (!tab || tab === this.data.avatarPicker.activeTab) {
      return;
    }
    const updates = {
      'avatarPicker.activeTab': tab,
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(this.data.member)
    };
    this.setData(updates);
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
        dynamicBackground
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
    this.setData(updates);
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
    const updates = {
      'avatarPicker.avatarOptions': avatarOptions,
      'avatarPicker.avatarUrl': avatarUrl,
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(this.data.member)
    };
    if (avatarUrl && this.data.profileEditor.avatarUrl !== avatarUrl) {
      updates['profileEditor.avatarUrl'] = avatarUrl;
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
    wx.getUserProfile({
      desc: '用于同步微信头像',
      success: (res) => {
        const info = res && res.userInfo ? res.userInfo : {};
        const avatarUrl = sanitizeAvatarUrl(info.avatarUrl || '');
        if (!avatarUrl) {
          wx.showToast({ title: '未获取到头像', icon: 'none' });
          return;
        }
        this.setData({
          'avatarPicker.avatarUrl': avatarUrl,
          'profileEditor.avatarUrl': avatarUrl
        });
        this.refreshAvatarPickerOptions();
        wx.showToast({ title: '已同步微信头像', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '未获取到头像', icon: 'none' });
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
    this.setData({ avatarPickerSaving: true });
    try {
      const member = await MemberService.updateArchive({
        avatarUrl,
        avatarFrame,
        appearanceBackground: backgroundId,
        appearanceBackgroundAnimated: isAnimated
      });
      this.applyMemberUpdate(member);
      this.setData({
        showAvatarPicker: false,
        'profileEditor.avatarUrl': avatarUrl,
        'profileEditor.avatarFrame': avatarFrame,
        'profileEditor.appearanceBackground': backgroundId,
        'profileEditor.appearanceBackgroundAnimated': isAnimated,
        'avatarPicker.dynamicBackground': isAnimated
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
    const payload = {
      nickName,
      gender: this.data.profileEditor.gender,
      avatarUrl: this.data.profileEditor.avatarUrl || this.data.defaultAvatar,
      avatarFrame: sanitizeAvatarFrame(this.data.profileEditor.avatarFrame),
      appearanceBackground: resolveSafeBackgroundId(
        this.data.member,
        this.data.profileEditor.appearanceBackground
      ),
      appearanceBackgroundAnimated: !!this.data.profileEditor.appearanceBackgroundAnimated
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
    const navExpanded = this.data.navExpanded;
    this.setData({
      member: sanitizedMember,
      memberStats: deriveMemberStats(sanitizedMember),
      navItems,
      visibleNavItems: buildVisibleNavItems(navItems, navExpanded),
      heroImage: resolveCharacterImage(sanitizedMember),
      'profileEditor.nickName': sanitizedMember.nickName || this.data.profileEditor.nickName,
      'profileEditor.gender': normalizeGenderValue(sanitizedMember.gender),
      'profileEditor.avatarUrl': sanitizedMember.avatarUrl || this.data.profileEditor.avatarUrl,
      'profileEditor.avatarFrame': sanitizedMember.avatarFrame,
      'profileEditor.appearanceBackground': sanitizedMember.appearanceBackground,
      'profileEditor.appearanceBackgroundAnimated': !!sanitizedMember.appearanceBackgroundAnimated,
      'avatarPicker.avatarUrl': sanitizedMember.avatarUrl || this.data.avatarPicker.avatarUrl,
      'avatarPicker.avatarFrame': sanitizedMember.avatarFrame,
      'avatarPicker.frameOptions': this.data.avatarPicker.frameOptions && this.data.avatarPicker.frameOptions.length
        ? this.data.avatarPicker.frameOptions
        : cloneAvatarFrameOptions(),
      'avatarPicker.backgroundId': resolveSafeBackgroundId(sanitizedMember, sanitizedMember.appearanceBackground),
      'avatarPicker.backgroundOptions': buildBackgroundOptionList(sanitizedMember),
      'avatarPicker.dynamicBackground': !!sanitizedMember.appearanceBackgroundAnimated,
      'profileEditor.renameCredits': sanitizedMember.renameCredits || 0,
      'profileEditor.renameCards': sanitizedMember.renameCards || 0,
      'profileEditor.renameUsed': sanitizedMember.renameUsed || 0,
      'profileEditor.renameHistory': renameHistory
    });
    this.updateBackgroundDisplay(sanitizedMember, { resetError: true });
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
        this.setData({
          onboarding: {
            ...this.data.onboarding,
            nickName: info.nickName || this.data.onboarding.nickName,
            avatarUrl: avatarUrl || this.data.onboarding.avatarUrl
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
    if (action === 'expand') {
      this.expandNavItems();
      return;
    }
    if (!url) {
      return;
    }
    wx.navigateTo({ url });
  },

  expandNavItems() {
    if (this.data.navExpanded) {
      return;
    }
    this.setData({
      navExpanded: true,
      visibleNavItems: buildVisibleNavItems(this.data.navItems, true)
    });
    persistNavExpandedState(true);
  }
});
