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

const app = getApp();

const BASE_NAV_ITEMS = [
  { icon: '🧝', label: '角色', url: '/pages/role/index?tab=character' },
  { icon: '🛡️', label: '装备', url: '/pages/role/index?tab=equipment' },
  { icon: '💳', label: '等级', url: '/pages/membership/membership' },
  { icon: '🎁', label: '权益', url: '/pages/rights/rights' },
  { icon: '📅', label: '预订', url: '/pages/reservation/reservation' },
  { icon: '💰', label: '钱包', url: '/pages/wallet/wallet' },
  { icon: '🧙‍♀️', label: '造型', url: '/pages/avatar/avatar' }
];

const ADMIN_ALLOWED_ROLES = ['admin', 'developer'];

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

const BACKGROUND_IMAGE =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjEyODAiIHZpZXdCb3g9IjAgMCA3MjAgMTI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVm' +
  'cz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ic2t5IiB4MT0iMCIgeTE9IjAiIHgyPSIwIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9I' +
  'iMwNTA5MjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMxYjNjNjgiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPS' +
  'IjMmQwYjNkIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPHJhZGlhbEdyYWRpZW50IGlkPSJnbG93IiBjeD0iNTAlIiBjeT0iMjAlIiByPSI2MCUiPgogICAgICA' +
  '8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZjdmMWQ1IiBzdG9wLW9wYWNpdHk9IjAuOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9' +
  'IiNmN2YxZDUiIHN0b3Atb3BhY2l0eT0iMCIvPgogICAgPC9yYWRpYWxHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjcyMCIgaGVpZ2h0PSIxMjgwIiBma' +
  'WxsPSJ1cmwoI3NreSkiLz4KICA8Y2lyY2xlIGN4PSIzNjAiIGN5PSIyMDAiIHI9IjE4MCIgZmlsbD0idXJsKCNnbG93KSIvPgogIDxwYXRoIGQ9Ik0wIDkwMCBMMTYwID' +
  'c2MCBMMzIwIDg4MCBMNDgwIDcyMCBMNjQwIDg2MCBMNzIwIDc4MCBMNzIwIDEyODAgTDAgMTI4MCBaIiBmaWxsPSIjMWYxYjJlIiBvcGFjaXR5PSIwLjYiLz4KICA8cGF' +
  '0aCBkPSJNMCA5OTAgTDE4MCA4MjAgTDM2MCA5NDAgTDUyMCA3ODAgTDcyMCA5NjAgTDcyMCAxMjgwIEwwIDEyODAgWiIgZmlsbD0iIzI4MWYzZiIgb3BhY2l0eT0iMC43' +
  'NSIvPgogIDxwYXRoIGQ9Ik0wIDEwODAgTDIwMCA5MDAgTDM2MCAxMDIwIEw1NDAgODgwIEw3MjAgMTA4MCBMNzIwIDEyODAgTDAgMTI4MCBaIiBmaWxsPSIjMzQyODU5' +
  'IiBvcGFjaXR5PSIwLjkiLz4KICA8ZyBvcGFjaXR5PSIwLjEyIiBmaWxsPSIjZmZmZmZmIj4KICAgIDxjaXJjbGUgY3g9IjEyMCIgY3k9IjE4MCIgcj0iMyIvPgogICAg' +
  'PGNpcmNsZSBjeD0iMjQwIiBjeT0iMTIwIiByPSIyIi8+CiAgICA8Y2lyY2xlIGN4PSI1MjAiIGN5PSIyMDAiIHI9IjMiLz4KICAgIDxjaXJjbGUgY3g9IjYwMCIgY3k9' +
  'IjEwMCIgcj0iMi41Ii8+CiAgICA8Y2lyY2xlIGN4PSI0MjAiIGN5PSI2MCIgcj0iMiIvPgogICAgPGNpcmNsZSBjeD0iMzIwIiBjeT0iMjYwIiByPSIyLjQiLz4KICAg' +
  'IDxjaXJjbGUgY3g9IjIwMCIgY3k9IjMyMCIgcj0iMS44Ii8+CiAgICA8Y2lyY2xlIGN4PSI1ODAiIGN5PSIzMjAiIHI9IjIuMiIvPgogIDwvZz4KPC9zdmc+';

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
    backgroundImage: BACKGROUND_IMAGE,
    heroImage: HERO_IMAGE,
    defaultAvatar: DEFAULT_AVATAR,
    activityIcons: [
      { icon: '⚔️', label: '秘境', url: '/pages/pve/pve' },
      { icon: '🎉', label: '盛典', url: '/pages/rights/rights' },
      { icon: '🔥', label: '比武' }
    ],
    navItems: [...BASE_NAV_ITEMS],
    memberStats: { ...EMPTY_MEMBER_STATS },
    progressWidth: 0,
    progressStyle: buildWidthStyle(0),
    profileEditor: {
      nickName: '',
      gender: 'unknown',
      avatarUrl: '',
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
      avatarUrl: '',
      avatarOptions: []
    }
  },

  onLoad() {
    this.hasBootstrapped = false;
    this.ensureNavMetrics();
    this.updateToday();
  },

  onShow() {
    this.ensureNavMetrics();
    this.updateToday();
    this.attachMemberRealtime();
    this.bootstrap();
  },

  onHide() {
    this.detachMemberRealtime();
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
      if (event.type !== 'memberChanged') {
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
      const width = normalizePercentage(progress);
      const needsProfile = !member || !member.nickName || !member.mobile;
      const profileAuthorized = !!(member && member.nickName);
      const phoneAuthorized = !!(member && member.mobile);
      this.setData({
        member,
        progress,
        tasks: tasks.slice(0, 3),
        loading: false,
        navItems: resolveNavItems(member),
        memberStats: deriveMemberStats(member),
        progressWidth: width,
        progressStyle: buildWidthStyle(width),
        showOnboarding: needsProfile,
        onboarding: needsProfile
          ? {
              ...this.data.onboarding,
              nickName: member && member.nickName ? member.nickName : '',
              avatarUrl: member && member.avatarUrl ? member.avatarUrl : '',
              mobile: member && member.mobile ? member.mobile : '',
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
            }
      });
      setActiveMember(member);
    } catch (err) {
      const width = normalizePercentage(this.data.progress);
      this.setData({
        loading: false,
        memberStats: deriveMemberStats(this.data.member),
        progressWidth: width,
        progressStyle: buildWidthStyle(width)
      });
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

  handleExperienceTap() {
    wx.navigateTo({ url: '/pages/membership/membership' });
  },

  openArchiveEditor() {
    const member = this.data.member || {};
    const nickName = member.nickName || '';
    const gender = normalizeGenderValue(member.gender);
    const avatarUrl = member.avatarUrl || this.data.defaultAvatar;
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

  openAvatarPicker() {
    if (this.data.avatarPickerSaving) {
      return;
    }
    const member = this.data.member || {};
    const gender = normalizeGenderValue(this.data.profileEditor.gender || member.gender);
    const baseAvatar = sanitizeAvatarUrl(member.avatarUrl);
    const options = computeAvatarOptionList(member, baseAvatar, gender);
    const avatarUrl = resolveAvatarSelection(options, baseAvatar, gender) || this.data.defaultAvatar;
    const updates = {
      showAvatarPicker: true,
      avatarPickerSaving: false,
      avatarPicker: {
        avatarUrl,
        avatarOptions: options
      }
    };
    if (avatarUrl && this.data.profileEditor.avatarUrl !== avatarUrl) {
      updates['profileEditor.avatarUrl'] = avatarUrl;
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
      'avatarPicker.avatarUrl': avatarUrl
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
    this.setData({ avatarPickerSaving: true });
    try {
      const member = await MemberService.updateArchive({
        avatarUrl
      });
      this.applyMemberUpdate(member);
      this.setData({
        showAvatarPicker: false,
        'profileEditor.avatarUrl': avatarUrl
      });
      wx.showToast({ title: '头像已更新', icon: 'success' });
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
      avatarUrl: this.data.profileEditor.avatarUrl || this.data.defaultAvatar
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
    const renameHistory = formatHistoryList(member.renameHistory);
    const sanitizedAvatar = sanitizeAvatarUrl(member.avatarUrl);
    this.setData({
      member,
      memberStats: deriveMemberStats(member),
      navItems: resolveNavItems(member),
      'profileEditor.nickName': member.nickName || this.data.profileEditor.nickName,
      'profileEditor.gender': normalizeGenderValue(member.gender),
      'profileEditor.avatarUrl': sanitizedAvatar || this.data.profileEditor.avatarUrl,
      'avatarPicker.avatarUrl': sanitizedAvatar || this.data.avatarPicker.avatarUrl,
      'profileEditor.renameCredits': member.renameCredits || 0,
      'profileEditor.renameCards': member.renameCards || 0,
      'profileEditor.renameUsed': member.renameUsed || 0,
      'profileEditor.renameHistory': renameHistory
    });
    if (this.data.showAvatarPicker) {
      this.refreshAvatarPickerOptions();
    }
    if (options.propagate !== false) {
      setActiveMember(member);
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
    const { url } = event.currentTarget.dataset;
    wx.navigateTo({ url });
  }
});
