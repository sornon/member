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

  async handleMatch() {
    if (this.data.matching) return;
    this.setData({ matching: true });
    try {
      const res = await PvpService.matchRandom();
      const profile = res.profile || this.data.profile;
      this.setData({
        profile,
        recentMatches: res.recentMatches || this.data.recentMatches,
        leaderboardPreview: res.leaderboardPreview || this.data.leaderboardPreview,
        leaderboardUpdatedAt: res.leaderboardUpdatedAt || this.data.leaderboardUpdatedAt,
        battleResult: res.battle || null,
        season: res.season || this.data.season,
        matching: false
      });
      const victory = res.battle && !res.battle.draw && res.battle.winnerId === (profile ? profile.memberId : '');
      wx.showToast({
        title: res.battle ? (res.battle.draw ? '平局收场' : victory ? '切磋胜利' : '战斗结束') : '战斗结束',
        icon: 'success'
      });
    } catch (error) {
      console.error('[pvp] match random failed', error);
      wx.showToast({ title: error.errMsg || '匹配失败', icon: 'none' });
      this.setData({ matching: false });
    }
  },

  async handleAcceptInvite() {
    const { pendingInviteId, acceptingInvite } = this.data;
    if (!pendingInviteId || acceptingInvite) {
      return;
    }
    this.setData({ acceptingInvite: true });
    try {
      const res = await PvpService.acceptInvite(pendingInviteId);
      const profile = res.profile || this.data.profile;
      this.setData({
        profile,
        recentMatches: res.recentMatches || this.data.recentMatches,
        leaderboardPreview: res.leaderboardPreview || this.data.leaderboardPreview,
        leaderboardUpdatedAt: res.leaderboardUpdatedAt || this.data.leaderboardUpdatedAt,
        battleResult: res.battle || null,
        season: res.season || this.data.season,
        pendingInviteId: '',
        acceptingInvite: false
      });
      const victory = res.battle && !res.battle.draw && res.battle.winnerId === (profile ? profile.memberId : '');
      wx.showToast({ title: res.battle ? (res.battle.draw ? '平局收场' : victory ? '比武胜利' : '比武结束') : '比武完成', icon: 'success' });
    } catch (error) {
      console.error('[pvp] accept invite failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.setData({ acceptingInvite: false });
    }
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

  async handleChallengeConfirm() {
    const challenge = this.data.targetChallenge;
    if (!challenge || this.data.matching) {
      return;
    }
    this.setData({ matching: true });
    try {
      const res = await PvpService.matchFriend(challenge.id);
      const profile = res.profile || this.data.profile;
      this.setData({
        profile,
        recentMatches: res.recentMatches || this.data.recentMatches,
        leaderboardPreview: res.leaderboardPreview || this.data.leaderboardPreview,
        leaderboardUpdatedAt: res.leaderboardUpdatedAt || this.data.leaderboardUpdatedAt,
        battleResult: res.battle || null,
        season: res.season || this.data.season,
        matching: false,
        targetChallenge: null
      });
      const victory = res.battle && !res.battle.draw && res.battle.winnerId === (profile ? profile.memberId : '');
      wx.showToast({ title: res.battle ? (res.battle.draw ? '平局收场' : victory ? '切磋胜利' : '切磋结束') : '切磋完成', icon: 'success' });
    } catch (error) {
      console.error('[pvp] challenge friend failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.setData({ matching: false });
    }
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
    wx.navigateTo({ url: `/pages/pvp/battle?matchId=${matchId}` });
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
