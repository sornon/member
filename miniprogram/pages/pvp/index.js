import { MemberService, PvpService } from '../../services/api';
const { SHARE_COVER_IMAGE_URL } = require('../../shared/common.js');

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
    claimingReward: false,
    autoMatchIntent: false
  },

  onLoad(options = {}) {
    this._ensureMemberPromise = null;
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
    const shouldAutoMatch = !nextState.pendingInviteId
      && !nextState.targetChallenge
      && !this.hasInternalReferrer();
    if (shouldAutoMatch) {
      nextState.autoMatchIntent = true;
    }
    const afterStateApplied = () => {
      this.triggerAutoBattleIfNeeded();
    };
    if (Object.keys(nextState).length) {
      this.setData(nextState, afterStateApplied);
    } else {
      afterStateApplied();
    }
  },

  onShow() {
    const globalBattle = app && app.globalData ? app.globalData.lastPvpBattle : null;
    if (globalBattle) {
      this.setData({ battleResult: globalBattle.battle || null });
      app.globalData.lastPvpBattle = null;
    }
    this.ensureMemberReady()
      .catch((error) => {
        console.error('[pvp] ensure member on show failed', error);
      })
      .finally(() => {
        this.fetchProfile();
      });
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
    if (this.data.matching) {
      return;
    }
    this.setData({ matching: true });
    wx.navigateTo({
      url: '/pages/battle/play?mode=pvp',
      events: {
        battleFinished: (payload = {}) => {
          this.applyBattlePayload(payload);
          this.setData({ matching: false });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', { mode: 'pvp', source: 'random' });
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
        this.setData({ matching: false });
      },
      complete: () => {
        this.setData({ matching: false });
      }
    });
  },

  async handleAcceptInvite() {
    const { pendingInviteId, acceptingInvite } = this.data;
    if (!pendingInviteId || acceptingInvite) {
      return;
    }
    try {
      await this.ensureMemberReady();
    } catch (error) {
      console.error('[pvp] ensure member before accepting invite failed', error);
      wx.showToast({ title: error.errMsg || '进入战斗失败', icon: 'none' });
      return;
    }
    this.setData({ acceptingInvite: true });
    wx.navigateTo({
      url: '/pages/battle/play?mode=pvp',
      events: {
        battleFinished: (payload = {}) => {
          this.applyBattlePayload(payload);
          this.setData({ pendingInviteId: '', acceptingInvite: false });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', { mode: 'pvp', source: 'acceptInvite', inviteId: pendingInviteId });
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
        this.setData({ acceptingInvite: false });
      },
      complete: () => {
        this.setData({ acceptingInvite: false });
      }
    });
  },

  ensureMemberReady() {
    if (this._ensureMemberPromise) {
      return this._ensureMemberPromise;
    }
    try {
      const globalMember = app && app.globalData ? app.globalData.memberInfo : null;
      if (globalMember && globalMember._id) {
        return Promise.resolve(globalMember);
      }
    } catch (error) {
      console.error('[pvp] read global member failed', error);
    }
    const promise = MemberService.getMember()
      .then((member) => {
        try {
          if (member && app && app.globalData) {
            app.globalData.memberInfo = member;
          }
        } catch (error) {
          console.error('[pvp] update global member failed', error);
        }
        return member;
      })
      .catch((error) => {
        console.error('[pvp] ensure member failed', error);
        throw error;
      })
      .finally(() => {
        this._ensureMemberPromise = null;
      });
    this._ensureMemberPromise = promise;
    return promise;
  },

  triggerAutoBattleIfNeeded() {
    const { pendingInviteId, autoMatchIntent, targetChallenge } = this.data;
    if (!pendingInviteId) {
      if (!autoMatchIntent || targetChallenge) {
        return;
      }
      this.setData({ autoMatchIntent: false }, () => {
        this.handleMatch();
      });
      return;
    }
    this.handleAcceptInvite();
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
      url: '/pages/battle/play?mode=pvp',
      events: {
        battleFinished: (payload = {}) => {
          this.applyBattlePayload(payload);
          this.setData({ matching: false, targetChallenge: null });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', { mode: 'pvp', source: 'challenge', targetId: challenge.id });
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
        this.setData({ matching: false });
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
    wx.navigateTo({ url: `/pages/battle/play?mode=pvp&replay=1&matchId=${matchId}` });
  },

  hasInternalReferrer() {
    try {
      const stack = getCurrentPages();
      if (!Array.isArray(stack) || stack.length < 2) {
        return false;
      }
      const referrer = stack[stack.length - 2];
      const route = referrer && typeof referrer.route === 'string' ? referrer.route : '';
      return route.startsWith('pages/');
    } catch (error) {
      console.error('[pvp] resolve referrer failed', error);
      return false;
    }
  },

  applyBattlePayload(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const nextState = {};
    if (payload.profile) {
      nextState.profile = payload.profile;
    }
    if (payload.season) {
      nextState.season = payload.season;
    }
    if (payload.recentMatches) {
      nextState.recentMatches = payload.recentMatches;
    }
    if (payload.leaderboardPreview) {
      nextState.leaderboardPreview = payload.leaderboardPreview;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'leaderboardUpdatedAt')) {
      nextState.leaderboardUpdatedAt = payload.leaderboardUpdatedAt;
    }
    if (payload.battle) {
      nextState.battleResult = payload.battle;
    }
    if (Object.keys(nextState).length) {
      this.setData(nextState);
    }
    if (payload.battle) {
      const profile = nextState.profile || this.data.profile || {};
      const memberId = profile ? profile.memberId : '';
      const draw = !!payload.battle.draw;
      const victory = !draw && payload.battle.winnerId === memberId;
      const battleSource = payload.battleSource || payload.source || '';
      if (!draw && !victory && battleSource === 'acceptInvite') {
        wx.showToast({
          title: '您在仙界的实力太弱了，赶快开始现实灰茄提升仙界功力吧。',
          icon: 'none',
          duration: 4000
        });
      } else {
        wx.showToast({
          title: draw ? '平局收场' : victory ? '比武胜利' : '比武结束',
          icon: 'success'
        });
      }
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
