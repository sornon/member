import { GuildService } from '../../../services/api';

Page({
  data: {
    loading: true,
    error: '',
    guild: null,
    membership: null,
    leaderboard: [],
    actionTicket: null,
    settings: null
  },
  onShow() {
    this.loadOverview();
  },
  async loadOverview() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await GuildService.getOverview();
      this.setData({
        loading: false,
        guild: result.guild || null,
        membership: result.membership || null,
        leaderboard: result.leaderboard || [],
        actionTicket: result.actionTicket || null,
        settings: result.settings || null
      });
    } catch (error) {
      console.error('[guild] load overview failed', error);
      this.setData({ loading: false, error: error.errMsg || error.message || '加载失败' });
    }
  },
  ensureTicket() {
    const { actionTicket } = this.data;
    if (actionTicket && actionTicket.ticket) {
      return actionTicket;
    }
    wx.showToast({ title: '令牌生成中，请稍候', icon: 'none' });
    return null;
  },
  handleCreateGuild() {
    const ticket = this.ensureTicket();
    if (!ticket) {
      return;
    }
    wx.navigateTo({
      url: `/pages/guild/create/index?ticket=${encodeURIComponent(ticket.ticket)}&signature=${encodeURIComponent(
        ticket.signature || ''
      )}`
    });
  },
  handleViewGuild(event) {
    const id = event.currentTarget.dataset.id;
    const ticket = this.ensureTicket();
    if (!ticket) {
      return;
    }
    wx.navigateTo({
      url: `/pages/guild/detail/index?id=${id}&ticket=${encodeURIComponent(ticket.ticket)}&signature=${encodeURIComponent(
        ticket.signature || ''
      )}`
    });
  },
  handleTeamBattle() {
    const { guild } = this.data;
    const ticket = this.ensureTicket();
    if (!guild || !ticket) {
      return;
    }
    wx.navigateTo({
      url: `/pages/guild/team/index?guildId=${guild.id}&ticket=${encodeURIComponent(ticket.ticket)}&signature=${encodeURIComponent(
        ticket.signature || ''
      )}`
    });
  },
  handleManageGuild() {
    wx.showToast({ title: '请在管理端进行宗门设置', icon: 'none' });
  }
});
