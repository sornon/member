import { PvpService } from '../../services/api';
import { normalizeAvatarFrameValue } from '../../shared/avatar-frames';

const app = getApp();

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
    if (normalizedFrame || entry.avatarFrame) {
      return { ...entry, avatarFrame: normalizedFrame };
    }
    return { ...entry, avatarFrame: '' };
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
    myRank: null
  },

  onLoad() {
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
      this.setData({
        loading: false,
        entries,
        season: res.season || null,
        updatedAt: res.updatedAt ? formatDateTime(res.updatedAt) : '',
        myRank: Number.isFinite(res.myRank) ? res.myRank : null
      });
    } catch (error) {
      console.error('[pvp] load leaderboard failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
    }
  },

  async handleChallenge(event) {
    const { id, name } = event.currentTarget.dataset;
    if (!id || this.data.matchLoadingId) {
      return;
    }
    this.setData({ matchLoadingId: id });
    try {
      const res = await PvpService.matchFriend(id);
      if (app && app.globalData) {
        app.globalData.lastPvpBattle = res;
      }
      wx.showToast({ title: '挑战完成', icon: 'success' });
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      console.error('[pvp] leaderboard challenge failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.setData({ matchLoadingId: '' });
    }
  },

  handleShare(event) {
    const { id, name } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/pvp/index?targetId=${id}&targetName=${encodeURIComponent(name || '')}` });
  },

  formatDateTime
});
