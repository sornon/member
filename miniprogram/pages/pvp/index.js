import { PvpService } from '../../services/api';

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

const SHARE_COVER_IMAGE_URL = 'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets/background/share_cover_1000x800.png';

Page({
  data: {
    loading: true,
    profile: null,
    season: null,
    history: [],
    recentMatches: [],
    leaderboardPreview: [],
    leaderboardUpdatedAt: '',
    battleResult: null,
    matching: false,
    inviteSending: false,
    shareInvite: null,
    inviteInfo: null,
    pendingInviteId: '',
    acceptingInvite: false,
    targetChallenge: null,
    claimingReward: false
  },

  onLoad(options = {}) {
    const nextState = {};
    if (options.inviteId) {
      nextState.pendingInviteId = options.inviteId;
    }
    if (options.targetId) {
      nextState.targetChallenge = {
        id: options.targetId,
        name: options.targetName ? decodeURIComponent(options.targetName) : ''
      };
    }
    if (Object.keys(nextState).length) {
      this.setData(nextState);
    }
  },

  onShow() {
    const globalBattle = app && app.globalData ? app.globalData.lastPvpBattle : null;
    if (globalBattle) {
      this.setData({ battleResult: globalBattle.battle || null });
      app.globalData.lastPvpBattle = null;
    }
    this.fetchProfile();
  },

  onPullDownRefresh() {
    this.fetchProfile()
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  async fetchProfile() {
    if (this.data.loading !== true) {
      this.setData({ loading: true });
    }
    try {
      const res = await PvpService.profile();
      this.setData({
        loading: false,
        season: res.season || null,
        profile: res.profile || null,
        history: res.history || [],
        recentMatches: res.recentMatches || [],
        leaderboardPreview: res.leaderboardPreview || [],
        leaderboardUpdatedAt: res.leaderboardUpdatedAt || ''
      });
    } catch (error) {
      console.error('[pvp] load profile failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  handleMatch() {
    if (this.data.matching) return;
    this.setData({ matching: true });
    wx.navigateTo({
      url: '/pages/pvp/battle?mode=pvp&operation=random',
      events: {
        battleComplete: (payload = {}) => {
          this.applyBattleUpdates(payload);
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battle:launch', {
            mode: 'pvp',
            operation: 'random'
          });
        }
      },
      fail: (error) => {
        console.error('[pvp] navigate to battle failed', error);
        wx.showToast({ title: '无法进入战斗', icon: 'none' });
      },
      complete: () => {
        this.setData({ matching: false });
      }
    });
  },

  handleAcceptInvite() {
    const { pendingInviteId, acceptingInvite } = this.data;
    if (!pendingInviteId || acceptingInvite) {
      return;
    }
    this.setData({ acceptingInvite: true });
    wx.navigateTo({
      url: '/pages/pvp/battle?mode=pvp&operation=acceptInvite',
      events: {
        battleComplete: (payload = {}) => {
          this.applyBattleUpdates({ ...payload, clearInvite: true });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battle:launch', {
            mode: 'pvp',
            operation: 'acceptInvite',
            inviteId: pendingInviteId
          });
        }
      },
      fail: (error) => {
        console.error('[pvp] navigate to invite battle failed', error);
        wx.showToast({ title: '无法进入战斗', icon: 'none' });
      },
      complete: () => {
        this.setData({ acceptingInvite: false });
      }
    });
  },

  clearPendingInvite() {
    this.setData({ pendingInviteId: '' });
  },

  async handleSendInvite() {
    if (this.data.inviteSending) return;
    this.setData({ inviteSending: true });
    try {
      const res = await PvpService.sendInvite();
      this.setData({
        shareInvite: res,
        inviteInfo: {
          inviteId: res.inviteId,
          expiresAt: formatDateTime(res.expiresAt),
          tier: res.tier
        },
        inviteSending: false
      });
      wx.showToast({ title: '邀请已生成，快去分享！', icon: 'success' });
    } catch (error) {
      console.error('[pvp] send invite failed', error);
      wx.showToast({ title: error.errMsg || '生成失败', icon: 'none' });
      this.setData({ inviteSending: false });
    }
  },

  async handleClaimReward() {
    const { season, profile, claimingReward } = this.data;
    if (!season || !profile || profile.claimedSeasonReward || claimingReward) {
      return;
    }
    this.setData({ claimingReward: true });
    try {
      const res = await PvpService.claimSeasonReward(season.seasonId);
      wx.showToast({ title: `已领取 ${res.reward.title || '赛季奖励'}`, icon: 'success' });
      this.fetchProfile();
    } catch (error) {
      console.error('[pvp] claim reward failed', error);
      wx.showToast({ title: error.errMsg || '领取失败', icon: 'none' });
    } finally {
      this.setData({ claimingReward: false });
    }
  },

  handleChallengeConfirm() {
    const challenge = this.data.targetChallenge;
    if (!challenge || this.data.matching) {
      return;
    }
    this.setData({ matching: true });
    wx.navigateTo({
      url: `/pages/pvp/battle?mode=pvp&operation=friend&targetId=${challenge.id}`,
      events: {
        battleComplete: (payload = {}) => {
          this.applyBattleUpdates({ ...payload, clearChallenge: true });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battle:launch', {
            mode: 'pvp',
            operation: 'friend',
            targetId: challenge.id
          });
        }
      },
      fail: (error) => {
        console.error('[pvp] navigate to challenge battle failed', error);
        wx.showToast({ title: '无法进入战斗', icon: 'none' });
      },
      complete: () => {
        this.setData({ matching: false });
      }
    });
  },

  handleCancelChallenge() {
    this.setData({ targetChallenge: null });
  },

  handleViewLeaderboard() {
    wx.navigateTo({ url: '/pages/pvp/leaderboard' });
  },

  handleReplay(event) {
    const matchId = event.currentTarget.dataset.id;
    if (!matchId) return;
    wx.navigateTo({ url: `/pages/pvp/battle?mode=pvpReplay&matchId=${matchId}` });
  },

  applyBattleUpdates(payload = {}) {
    if (!payload || payload.mode !== 'pvp') {
      return;
    }
    const nextState = {};
    if (payload.profile) {
      nextState.profile = payload.profile;
    }
    if (payload.recentMatches) {
      nextState.recentMatches = payload.recentMatches;
    }
    if (payload.leaderboardPreview) {
      nextState.leaderboardPreview = payload.leaderboardPreview;
    }
    if (payload.leaderboardUpdatedAt) {
      nextState.leaderboardUpdatedAt = payload.leaderboardUpdatedAt;
    }
    if (payload.season) {
      nextState.season = payload.season;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'battle')) {
      nextState.battleResult = payload.battle || null;
    }
    if (payload.clearInvite) {
      nextState.pendingInviteId = '';
    }
    if (payload.clearChallenge) {
      nextState.targetChallenge = null;
    }
    if (Object.keys(nextState).length) {
      this.setData(nextState);
    }
    if (payload.toast) {
      wx.showToast({ title: payload.toast, icon: payload.toastIcon || 'success' });
    }
  },

  onShareAppMessage() {
    const { shareInvite, profile } = this.data;
    if (shareInvite) {
      const title = profile && profile.memberSnapshot
        ? `${profile.memberSnapshot.nickName || '神秘仙友'}向你发起比武` : '竞技场邀战令';
      return {
        title,
        path: `/pages/pvp/index?inviteId=${shareInvite.inviteId}`,
        imageUrl: SHARE_COVER_IMAGE_URL
      };
    }
    return {
      title: '酒隐之茄 · 仙界比武场',
      path: '/pages/pvp/index',
      imageUrl: SHARE_COVER_IMAGE_URL
    };
  },

  formatDateTime
});
