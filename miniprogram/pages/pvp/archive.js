import { PvpService } from '../../services/api';
import { formatCombatPower } from '../../utils/format';
const { buildTitleImageUrl } = require('../../shared/titles.js');
const { normalizeBackgroundId, resolveBackgroundById, getDefaultBackgroundId } = require('../../shared/backgrounds.js');
const { CHARACTER_IMAGE_BASE_PATH, AVATAR_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');
const { listAvatarIds } = require('../../shared/avatar-catalog.js');

const app = getApp();

const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;
const DEFAULT_CHARACTER_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/default.png`;

function buildCharacterImageMap() {
  const ids = listAvatarIds();
  return ids.reduce((acc, id) => {
    acc[id] = `${CHARACTER_IMAGE_BASE_PATH}/${id}.png`;
    return acc;
  }, {});
}

const CHARACTER_IMAGE_MAP = buildCharacterImageMap();

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const match = url.trim().toLowerCase().match(/\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png$/);
  return match ? match[1] : '';
}

function resolveCharacterImageByAvatarId(avatarId) {
  if (!avatarId) {
    return DEFAULT_CHARACTER_IMAGE;
  }
  return CHARACTER_IMAGE_MAP[avatarId] || DEFAULT_CHARACTER_IMAGE;
}

function resolveCharacterImage(archive) {
  if (!archive) {
    return DEFAULT_CHARACTER_IMAGE;
  }
  if (archive.portrait) {
    return archive.portrait;
  }
  const avatarId = extractAvatarIdFromUrl(archive.avatarUrl || '');
  if (avatarId) {
    return resolveCharacterImageByAvatarId(avatarId);
  }
  return DEFAULT_CHARACTER_IMAGE;
}

function resolveBackgroundDisplay(background) {
  const normalizedId =
    background && typeof background.id === 'string' ? normalizeBackgroundId(background.id) : '';
  let base = null;
  if (normalizedId) {
    base = resolveBackgroundById(normalizedId);
  }
  if (!base) {
    base = resolveBackgroundById(getDefaultBackgroundId());
  }
  const image = (background && background.image) || (base && base.image) || '';
  let video = '';
  if (background && background.animated) {
    video = background.video || (base && base.video) || '';
  }
  return {
    image,
    video,
    dynamicEnabled: !!(background && background.animated && video)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    memberId: '',
    archive: null,
    attributeList: [],
    combatStats: [],
    backgroundImage: '',
    backgroundVideo: '',
    showBackgroundVideo: false,
    backgroundVideoError: false,
    showBackgroundOverlay: true,
    navHeight: 88,
    titleImage: '',
    heroImage: DEFAULT_CHARACTER_IMAGE,
    defaultAvatar: DEFAULT_AVATAR,
    combatPowerText: '--'
  },

  onLoad(options = {}) {
    this.ensureNavMetrics();
    const memberId =
      options && typeof options.memberId === 'string' ? decodeURIComponent(options.memberId) : '';
    if (!memberId) {
      this.setData({ loading: false, error: '缺少成员信息' });
      return;
    }
    this.setData({ memberId });
    this.fetchArchive(memberId);
  },

  onShow() {
    this.ensureNavMetrics();
  },

  onPullDownRefresh() {
    if (!this.data.memberId) {
      wx.stopPullDownRefresh();
      return;
    }
    this.fetchArchive(this.data.memberId)
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  ensureNavMetrics() {
    const { customNav = {} } = app.globalData || {};
    const navHeight = customNav.navHeight || 88;
    if (navHeight !== this.data.navHeight) {
      this.setData({ navHeight });
    }
  },

  async fetchArchive(memberId) {
    this.setData({ loading: true, error: '' });
    try {
      const res = await PvpService.inspectArchive(memberId);
      this.applyArchive(res);
    } catch (error) {
      console.error('[pvp] load archive failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
      throw error;
    }
  },

  applyArchive(payload) {
    if (!payload || !payload.target) {
      this.setData({ loading: false, error: '未找到角色档案' });
      return;
    }
    const archive = payload.target;
    const attributeList =
      payload.attributes && Array.isArray(payload.attributes.attributeList)
        ? payload.attributes.attributeList
        : [];
    const combatStats =
      payload.attributes && Array.isArray(payload.attributes.combatStats)
        ? payload.attributes.combatStats
        : [];
    const backgroundDisplay = resolveBackgroundDisplay(archive.background);
    const heroImage = resolveCharacterImage(archive);
    const titleImage = buildTitleImageUrl(archive.titleId || '');
    const combatPowerText = formatCombatPower(archive.combatPower || 0);

    this.setData({
      archive,
      attributeList,
      combatStats,
      heroImage,
      titleImage,
      combatPowerText,
      backgroundImage: backgroundDisplay.image,
      backgroundVideo: backgroundDisplay.video,
      backgroundVideoError: false,
      showBackgroundVideo: backgroundDisplay.dynamicEnabled,
      loading: false
    });
  },

  handleBackgroundVideoError() {
    this.setData({ backgroundVideoError: true, showBackgroundVideo: false });
  }
});
