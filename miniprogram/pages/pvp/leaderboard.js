import { PvpService } from '../../services/api';
import { normalizeAvatarFrameValue } from '../../shared/avatar-frames';
const { buildTitleImageUrl, normalizeTitleId } = require('../../shared/titles.js');

const { AVATAR_IMAGE_BASE_PATH } = require('../../shared/asset-paths.js');

const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;

const app = getApp();

function resolveSelfMemberId() {
  try {
    if (app && app.globalData && app.globalData.memberInfo) {
      return app.globalData.memberInfo._id || '';
    }
  } catch (error) {
    console.error('[pvp] resolve self member id failed', error);
  }
  return '';
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeUrl(value) {
  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    return false;
  }
  return (
    /^https?:\/\//.test(trimmed) ||
    trimmed.startsWith('cloud://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('wxfile://')
  );
}

function formatDateTime(date) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function decorateLeaderboardEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const normalizedFrame = normalizeAvatarFrameValue(entry.avatarFrame || '');
    const avatarUrl = toTrimmedString(entry.avatarUrl) || DEFAULT_AVATAR;
    const titleName = toTrimmedString(entry.titleName);
    const tierName = toTrimmedString(entry.tierName);
    const normalizedTitleId = normalizeTitleId(entry.titleId || '');
    const rawTitleImage = toTrimmedString(entry.titleImage || entry.titleImageUrl || '');
    let resolvedTitleImage = '';
    if (rawTitleImage) {
      resolvedTitleImage = looksLikeUrl(rawTitleImage)
        ? rawTitleImage
        : buildTitleImageUrl(rawTitleImage);
    } else if (normalizedTitleId) {
      resolvedTitleImage = buildTitleImageUrl(normalizedTitleId);
    }
    const basePayload = {
      ...entry,
      titleName,
      tierName,
      avatarUrl,
      titleId: normalizedTitleId,
      titleImage: resolvedTitleImage
    };
    if (normalizedFrame || entry.avatarFrame) {
      return { ...basePayload, avatarFrame: normalizedFrame };
    }
    return { ...basePayload, avatarFrame: '' };
  });
}

Page({
  data: {
    loading: true,
    entries: [],
    season: null,
    updatedAt: '',
    matchLoadingId: '',
    error: '',
    myRank: null,
    defaultAvatar: DEFAULT_AVATAR,
    selfMemberId: ''
  },

  onLoad() {
    this.setData({ selfMemberId: resolveSelfMemberId() });
    this.fetchLeaderboard();
  },

  onPullDownRefresh() {
    this.fetchLeaderboard()
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  async fetchLeaderboard() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await PvpService.leaderboard({ limit: 100 });
      const entries = decorateLeaderboardEntries(res.entries);
      const resolvedSelfId = toTrimmedString(res.memberId)
        || this.data.selfMemberId
        || resolveSelfMemberId();
      this.setData({
        loading: false,
        entries,
        season: res.season || null,
        updatedAt: res.updatedAt ? formatDateTime(res.updatedAt) : '',
        myRank: Number.isFinite(res.myRank) ? res.myRank : null,
        selfMemberId: resolvedSelfId
      });
    } catch (error) {
      console.error('[pvp] load leaderboard failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
    }
  },

  handleChallenge(event) {
    const { id, name } = event.currentTarget.dataset || {};
    const targetId = toTrimmedString(id);
    if (!targetId || this.data.matchLoadingId) {
      return;
    }
    const selfMemberId = this.data.selfMemberId || resolveSelfMemberId();
    if (selfMemberId && targetId === selfMemberId) {
      wx.showToast({ title: '无法与自己切磋', icon: 'none' });
      return;
    }
    this.setData({ matchLoadingId: targetId });
    wx.navigateTo({
      url: '/pages/battle/play?mode=pvp',
      events: {
        battleFinished: () => {
          this.handleBattleFinished();
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          const context = { mode: 'pvp', source: 'challenge', targetId };
          if (typeof name === 'string' && name.trim()) {
            context.opponentName = name.trim();
          }
          res.eventChannel.emit('battleContext', context);
        }
      },
      fail: (error) => {
        console.error('[pvp] leaderboard challenge navigation failed', error);
        wx.showToast({ title: error.errMsg || '战斗画面加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ matchLoadingId: '' });
      }
    });
  },

  handleViewArchive(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/pvp/archive?memberId=${id}` });
  },

  handleBattleFinished() {
    this.fetchLeaderboard().catch((error) => {
      console.error('[pvp] refresh leaderboard after battle failed', error);
    });
  },

  formatDateTime
});
