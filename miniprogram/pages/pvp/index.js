import { MemberService, PvpService } from '../../services/api';
const { SHARE_COVER_IMAGE_URL } = require('../../shared/common.js');
const { buildCloudAssetUrl } = require('../../shared/asset-paths.js');

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
    targetChallenge: null,
    claimingReward: false,
    autoMatchIntent: false,
    autoChallengePending: false,
    heroBackgroundUrl: buildCloudAssetUrl('background', 'battle-s1.jpg')
  },

  onLoad(options = {}) {
    this._ensureMemberPromise = null;
    const nextState = {};
    if (options.targetId) {
      nextState.targetChallenge = {
        id: options.targetId,
        name: options.targetName ? decodeURIComponent(options.targetName) : ''
      };
      nextState.autoChallengePending = true;
    }
    const shouldAutoMatch = !nextState.targetChallenge && !this.hasInternalReferrer();
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
        leaderboardPreview: Array.isArray(res.leaderboardPreview)
          ? res.leaderboardPreview.slice(0, 10)
          : [],
        leaderboardUpdatedAt: res.leaderboardUpdatedAt || ''
      });
      this.triggerAutoBattleIfNeeded();
    } catch (error) {
      console.error('[pvp] load profile failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  handleMatch(eventOrOptions = {}) {
    const options = eventOrOptions && eventOrOptions.type ? {} : eventOrOptions;
    const autoInvite = !!(options && options.autoInvite);
    if (this.data.matching) {
      return;
    }
    this.setData({ matching: true });
    const battleSource = autoInvite ? 'autoInvite' : 'random';
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
          res.eventChannel.emit('battleContext', { mode: 'pvp', source: battleSource });
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
    const { autoMatchIntent, targetChallenge, autoChallengePending, matching } = this.data;
    if (targetChallenge && autoChallengePending && !matching) {
      Promise.resolve()
        .then(() => this.handleChallengeConfirm())
        .catch((error) => {
          console.error('[pvp] auto challenge failed', error);
        });
      return;
    }
    if (!autoMatchIntent || matching || targetChallenge) {
      return;
    }
    this.setData({ autoMatchIntent: false }, () => {
      this.handleMatch({ autoInvite: true });
    });
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
      this.setData({ autoChallengePending: false });
      return;
    }
    const targetId = typeof challenge.id === 'string'
      ? challenge.id.trim()
      : challenge.id
      ? String(challenge.id)
      : '';
    if (!targetId) {
      this.setData({ autoChallengePending: false, targetChallenge: null });
      return;
    }
    const profile = this.data.profile || {};
    const selfId = typeof profile.memberId === 'string'
      ? profile.memberId
      : profile.memberId
      ? String(profile.memberId)
      : '';
    this.setData({ matching: true, autoChallengePending: false });
    try {
      await this.ensureMemberReady();
    } catch (error) {
      console.error('[pvp] ensure member before spar failed', error);
      wx.showToast({ title: error.errMsg || '进入战斗失败', icon: 'none' });
      this.setData({ matching: false });
      return;
    }
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
          res.eventChannel.emit('battleContext', { mode: 'pvp', source: 'challenge', targetId });
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
    this.setData({ targetChallenge: null, autoChallengePending: false });
  },

  handleViewLeaderboard() {
    wx.navigateTo({ url: '/pages/pvp/leaderboard' });
  },

  handleViewArchive(event) {
    const { memberId } = event.currentTarget.dataset || {};
    if (!memberId) {
      return;
    }
    wx.navigateTo({ url: `/pages/pvp/archive?memberId=${memberId}` });
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
      nextState.leaderboardPreview = Array.isArray(payload.leaderboardPreview)
        ? payload.leaderboardPreview.slice(0, 10)
        : [];
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
  },

  onShareAppMessage() {
    const { profile } = this.data;
    const targetId = profile && typeof profile.memberId === 'string' ? profile.memberId : '';
    if (targetId) {
      const nickname = profile && profile.nickName ? profile.nickName : '神秘仙友';
      const encodedName = encodeURIComponent(nickname);
      return {
        title: `${nickname}邀请你切磋`,
        path: `/pages/pvp/index?targetId=${targetId}&targetName=${encodedName}`,
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
