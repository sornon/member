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
    inviteAutoBattling: false,
    targetChallenge: null,
    claimingReward: false
  },

  onLoad(options = {}) {
    this._ensureMemberPromise = null;
    this._inviteEntryActive = false;
    this._inviteEntryFallback = false;
    this._inviteAutoTriggered = false;
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
    const inviteId = pendingInviteId;
    try {
      await this.ensureMemberReady();
    } catch (error) {
      console.error('[pvp] ensure member before accepting invite failed', error);
      wx.showToast({ title: error.errMsg || '进入战斗失败', icon: 'none' });
      return;
    }
    this.setData({ acceptingInvite: true, inviteAutoBattling: true, pendingInviteId: '' });
    let inspectResult = null;
    let fallbackToRandom = false;
    let fallbackReason = '';
    try {
      inspectResult = await PvpService.inspectInvite(inviteId);
      if (!inspectResult || inspectResult.valid !== true) {
        fallbackToRandom = true;
        fallbackReason = inspectResult && inspectResult.reason ? inspectResult.reason : 'invalid';
      }
    } catch (error) {
      console.error('[pvp] inspect invite failed', error);
      fallbackToRandom = true;
      fallbackReason = 'inspect_failed';
    }

    const battleContext = fallbackToRandom
      ? {
          mode: 'pvp',
          source: 'random',
          inviteId,
          fallbackFromInvite: true,
          inviteFallbackReason: fallbackReason
        }
      : {
          mode: 'pvp',
          source: 'acceptInvite',
          inviteId
        };

    if (fallbackToRandom) {
      const message = this.resolveInviteFallbackMessage(fallbackReason);
      if (message) {
        wx.showToast({ title: message, icon: 'none', duration: 3000 });
      }
      this.setData({ inviteInfo: null });
    }

    this._inviteEntryActive = true;
    this._inviteEntryFallback = fallbackToRandom;
    this._inviteAutoTriggered = true;
    wx.navigateTo({
      url: '/pages/battle/play?mode=pvp',
      events: {
        battleFinished: (payload = {}) => {
          this.applyBattlePayload(payload);
          this.setData({ pendingInviteId: '', acceptingInvite: false, inviteAutoBattling: false });
        }
      },
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', battleContext);
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
        this._inviteEntryActive = false;
        this._inviteEntryFallback = false;
        this._inviteAutoTriggered = false;
        this.setData({ acceptingInvite: false, inviteAutoBattling: false, pendingInviteId: inviteId });
      },
      complete: () => {
        this.setData({ acceptingInvite: false, inviteAutoBattling: false });
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
    const { pendingInviteId } = this.data;
    if (!pendingInviteId || this._inviteAutoTriggered) {
      return;
    }
    this._inviteAutoTriggered = true;
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

    if (
      this._inviteEntryActive &&
      (payload.battleSource === 'acceptInvite' || payload.fallbackFromInvite)
    ) {
      this._inviteEntryActive = false;
      const redirectDelay = this._inviteEntryFallback ? 600 : 800;
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' });
      }, redirectDelay);
    }
  },

  resolveInviteFallbackMessage(reason) {
    const code = reason || 'invalid';
    switch (code) {
      case 'self_invite':
        return '这是您自己发起的邀战，已为您匹配其他对手。';
      case 'not_found':
        return '邀战编号不存在，已为您匹配其他对手。';
      case 'expired':
        return '该邀战已过期，已为您匹配其他对手。';
      case 'status_mismatch':
        return '该邀战已被处理，已为您匹配其他对手。';
      case 'missing_inviter':
      case 'inviter_not_found':
        return '邀战信息异常，已为您匹配其他对手。';
      case 'inspect_failed':
        return '暂时无法校验邀战，已为您匹配其他对手。';
      default:
        return '邀战不可用，已为您匹配其他对手。';
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
