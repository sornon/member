import { PvpService } from '../../services/api';
import { normalizeAvatarFrameValue } from '../../shared/avatar-frames';

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

  handleChallenge(event) {
    const { id, name } = event.currentTarget.dataset || {};
    if (!id || this.data.matchLoadingId) {
      return;
    }
    const targetId = String(id);
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
