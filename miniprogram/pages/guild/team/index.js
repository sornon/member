import { GuildService } from '../../../services/api';

function getCurrentMemberId() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.memberInfo) {
      return app.globalData.memberInfo._id || '';
    }
  } catch (error) {
    console.warn('[guild] resolve member id failed', error);
  }
  return '';
}

Page({
  data: {
    guildId: '',
    ticket: '',
    signature: '',
    difficultyOptions: ['难度 I', '难度 II', '难度 III', '难度 IV'],
    difficultyIndex: 0,
    loading: false,
    battle: null,
    rewards: { stones: 0, contribution: 0 }
  },
  onLoad(options) {
    this.setData({
      guildId: options.guildId || '',
      ticket: options.ticket || '',
      signature: options.signature || ''
    });
  },
  handleDifficultyChange(event) {
    this.setData({ difficultyIndex: Number(event.detail.value) });
  },
  async handleStart() {
    const { guildId, ticket, signature, difficultyIndex } = this.data;
    if (!guildId || !ticket) {
      wx.showToast({ title: '宗门信息缺失，请返回重试', icon: 'none' });
      return;
    }
    const memberId = getCurrentMemberId();
    if (!memberId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const difficulty = difficultyIndex + 1;
      const result = await GuildService.initiateTeamBattle({
        guildId,
        ticket,
        signature,
        members: [memberId],
        difficulty
      });
      this.setData({
        loading: false,
        battle: result.battle || null,
        rewards: result.rewards || { stones: 0, contribution: 0 }
      });
    } catch (error) {
      console.error('[guild] start battle failed', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || '发起失败', icon: 'none' });
    }
  }
});
