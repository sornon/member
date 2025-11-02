import { MemberService } from '../../services/api';
const { buildCloudAssetUrl, CHARACTER_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');

const BACKGROUND_VIDEO_URL = buildCloudAssetUrl('background', 'tupo.mp4');
const EFFECT_START_TIME = 2.2;
const EFFECT_END_TIME = 4.6;
const SUCCESS_NAVIGATION_DELAY = 2200;
const DEFAULT_FIGURE_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/default.png`;

function normalizeAssetUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  if (/^http:/.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return trimmed;
}

function extractAvatarId(url) {
  const normalized = normalizeAssetUrl(url);
  if (!normalized || normalized.startsWith('data:')) {
    return '';
  }
  const match = normalized.match(/\/(?:avatar|character)\/([^\/?.@]+)(?:@[0-9a-z]+)?\.(?:png|jpe?g|webp)(?:[?#].*)?$/i);
  return match ? match[1] : '';
}

function resolveFigureImage(member) {
  const defaultImage = DEFAULT_FIGURE_IMAGE;
  if (!member || typeof member !== 'object') {
    return defaultImage;
  }
  const candidates = [];
  if (member.figure && typeof member.figure === 'object') {
    if (member.figure.image) {
      candidates.push(member.figure.image);
    }
    if (member.figure.url) {
      candidates.push(member.figure.url);
    }
  }
  if (member.characterImage) {
    candidates.push(member.characterImage);
  }
  if (member.heroImage) {
    candidates.push(member.heroImage);
  }
  if (member.avatar && typeof member.avatar === 'object') {
    if (member.avatar.characterImage) {
      candidates.push(member.avatar.characterImage);
    }
    if (member.avatar.figureImage) {
      candidates.push(member.avatar.figureImage);
    }
    if (member.avatar.url) {
      candidates.push(member.avatar.url);
    }
  }
  if (member.avatarUrl) {
    candidates.push(member.avatarUrl);
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = normalizeAssetUrl(candidates[i]);
    if (!candidate) {
      continue;
    }
    if (/\/character\//i.test(candidate) && /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(candidate)) {
      return candidate;
    }
    const avatarId = extractAvatarId(candidate);
    if (avatarId) {
      return `${CHARACTER_IMAGE_BASE_PATH}/${avatarId}.png`;
    }
  }

  return defaultImage;
}

Page({
  data: {
    videoSrc: BACKGROUND_VIDEO_URL,
    figureImage: '',
    showFigure: false,
    vibrationActive: false,
    flashActive: false,
    showSuccessMessage: false,
    levelName: '',
    videoReady: false,
    figureReady: false
  },

  onLoad(options = {}) {
    this.effectActive = false;
    this.figureRevealed = false;
    this.returnTimer = null;
    const levelName = typeof options.levelName === 'string' ? decodeURIComponent(options.levelName) : '';
    if (levelName) {
      this.setData({ levelName });
    }
    this.performBreakthrough();
  },

  onHide() {
    this.clearPendingTimer();
  },

  onUnload() {
    this.clearPendingTimer();
  },

  clearPendingTimer() {
    if (this.returnTimer) {
      clearTimeout(this.returnTimer);
      this.returnTimer = null;
    }
  },

  maybeRevealFigure() {
    if (this.figureRevealed) {
      return;
    }
    if (this.data.videoReady && this.data.figureReady && this.data.figureImage) {
      this.figureRevealed = true;
      this.setData({ showFigure: true });
    }
  },

  async performBreakthrough() {
    try {
      const progress = await MemberService.breakthrough();
      const member = progress && progress.member ? progress.member : null;
      const currentLevel = progress && progress.currentLevel ? progress.currentLevel : null;
      const resolvedLevelName =
        this.data.levelName ||
        (currentLevel && (currentLevel.displayName || currentLevel.name || currentLevel.shortName)) ||
        '';
      this.setData({
        levelName: resolvedLevelName,
        figureImage: resolveFigureImage(member),
        figureReady: false
      });
      this.maybeRevealFigure();
    } catch (error) {
      console.error('[breakthrough] breakthrough failed', error);
      const message =
        (error && (error.errMsg || error.message)) ? String(error.errMsg || error.message) : '突破失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
      this.scheduleReturn(1500);
    }
  },

  handleVideoLoaded() {
    this.setData({ videoReady: true });
    this.maybeRevealFigure();
  },

  handleFigureLoaded() {
    if (!this.data.figureReady) {
      this.setData({ figureReady: true });
    }
    this.maybeRevealFigure();
  },

  handleFigureError() {
    if (this.data.figureImage && this.data.figureImage !== DEFAULT_FIGURE_IMAGE) {
      this.setData({
        figureImage: DEFAULT_FIGURE_IMAGE,
        figureReady: false
      });
      return;
    }
    this.setData({ figureReady: true });
    this.maybeRevealFigure();
  },

  handleVideoTimeUpdate(event) {
    if (!event || !event.detail) {
      return;
    }
    const currentTime = Number(event.detail.currentTime || 0);
    if (!Number.isFinite(currentTime)) {
      return;
    }
    if (
      this.figureRevealed &&
      currentTime >= EFFECT_START_TIME &&
      currentTime <= EFFECT_END_TIME
    ) {
      if (!this.effectActive) {
        this.effectActive = true;
        this.setData({ vibrationActive: true, flashActive: true });
      }
    } else if (this.effectActive && currentTime > EFFECT_END_TIME) {
      this.effectActive = false;
      this.setData({ vibrationActive: false, flashActive: false });
    }
  },

  handleVideoEnded() {
    this.effectActive = false;
    this.setData({
      vibrationActive: false,
      flashActive: false,
      showSuccessMessage: true
    });
    this.scheduleReturn(SUCCESS_NAVIGATION_DELAY);
  },

  handleVideoError(event) {
    console.error('[breakthrough] video error', event);
    wx.showToast({ title: '动画播放失败', icon: 'none' });
    this.scheduleReturn(1200);
  },

  scheduleReturn(delay = SUCCESS_NAVIGATION_DELAY) {
    if (this.returnTimer) {
      return;
    }
    const safeDelay = typeof delay === 'number' && delay > 0 ? delay : SUCCESS_NAVIGATION_DELAY;
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      const pages = getCurrentPages();
      if (pages && pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.redirectTo({ url: '/pages/membership/membership' });
      }
    }, safeDelay);
  }
});
