import { GuildService } from '../../../services/api';
const {
  resolveGuildActionTicket,
  decorateGuildLeaderboardEntries
} = require('../../../shared/guild.js');

const DONATION_PRESETS = [50, 100, 200, 500];

function buildTicketedUrl(baseUrl, ticket) {
  if (!ticket || !ticket.ticket) {
    return baseUrl;
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  const encodedTicket = encodeURIComponent(ticket.ticket);
  const encodedSignature = encodeURIComponent(ticket.signature || '');
  return `${baseUrl}${separator}ticket=${encodedTicket}&signature=${encodedSignature}`;
}

function resolveRoleLabel(role) {
  const normalized = typeof role === 'string' ? role.trim() : '';
  if (!normalized) {
    return '成员';
  }
  if (normalized === 'leader') {
    return '宗主';
  }
  if (normalized === 'officer' || normalized === 'elder') {
    return '长老';
  }
  return '成员';
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  if (numeric >= 10000) {
    return `${(numeric / 10000).toFixed(1)}万`;
  }
  return `${numeric}`;
}

function pickDonationAmount() {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: DONATION_PRESETS.map((amount) => `捐献 ${amount} 灵石`),
      success: (res) => {
        if (typeof res.tapIndex === 'number' && DONATION_PRESETS[res.tapIndex]) {
          resolve(DONATION_PRESETS[res.tapIndex]);
        } else {
          resolve(null);
        }
      },
      fail: (error) => {
        if (error && /cancel/.test(error.errMsg || '')) {
          resolve(null);
          return;
        }
        reject(error);
      }
    });
  });
}

Page({
  data: {
    loading: true,
    error: '',
    guild: null,
    membership: null,
    leaderboard: [],
    actionTicket: null,
    settings: null,
    donating: false,
    summary: null
  },
  onShow() {
    this.loadOverview();
  },
  onPullDownRefresh() {
    this.reloadOverview({ showLoading: false })
      .catch((error) => {
        console.error('[guild] refresh overview failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  async loadOverview() {
    await this.reloadOverview({ showLoading: true });
  },
  async reloadOverview({ showLoading = false } = {}) {
    if (showLoading) {
      this.setData({ loading: true, error: '' });
    }
    try {
      const result = await GuildService.getOverview();
      const ticket = resolveGuildActionTicket(result);
      const leaderboard = decorateGuildLeaderboardEntries(result.leaderboard || []);
      this.setData({
        loading: false,
        guild: result.guild || null,
        membership: result.membership || null,
        leaderboard,
        actionTicket: ticket,
        settings: result.settings || null,
        summary: result.summary || null,
        error: ''
      });
    } catch (error) {
      console.error('[guild] load overview failed', error);
      this.setData({
        loading: false,
        error: error.errMsg || error.message || '加载失败'
      });
    }
  },
  async ensureActionTicket({ refresh = false } = {}) {
    if (!refresh) {
      const { actionTicket } = this.data;
      if (actionTicket && actionTicket.ticket) {
        return actionTicket;
      }
    }
    try {
      const refreshed = await GuildService.refreshTicket();
      const ticket = resolveGuildActionTicket(refreshed);
      if (ticket) {
        this.setData({ actionTicket: ticket });
        return ticket;
      }
      wx.showToast({ title: '令牌生成失败，请稍后重试', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh ticket failed', error);
      wx.showToast({ title: error.errMsg || '令牌获取失败', icon: 'none' });
    }
    return null;
  },
  async handleCreateGuild() {
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    wx.navigateTo({ url: buildTicketedUrl('/pages/guild/create/index', ticket) });
  },
  async handleViewGuild(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    const url = buildTicketedUrl(`/pages/guild/detail/index?id=${encodeURIComponent(id)}`, ticket);
    wx.navigateTo({ url });
  },
  async handleTeamBattle() {
    const { guild } = this.data;
    if (!guild) {
      wx.showToast({ title: '请先加入宗门', icon: 'none' });
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    const baseUrl = `/pages/guild/team/index?guildId=${encodeURIComponent(guild.id)}`;
    wx.navigateTo({ url: buildTicketedUrl(baseUrl, ticket) });
  },
  async handleNavigate(event) {
    const { url, requireGuild } = event.currentTarget.dataset || {};
    if (!url) {
      return;
    }
    if (requireGuild && !this.data.guild) {
      wx.showToast({ title: '请先加入宗门', icon: 'none' });
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    wx.navigateTo({ url: buildTicketedUrl(url, ticket) });
  },
  async handleQuickDonate() {
    if (this.data.donating) {
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    let amount;
    try {
      amount = await pickDonationAmount();
    } catch (error) {
      console.error('[guild] donation picker failed', error);
      wx.showToast({ title: error.errMsg || '选择失败', icon: 'none' });
      return;
    }
    if (!amount) {
      return;
    }
    this.setData({ donating: true });
    try {
      await GuildService.donate({
        amount,
        type: 'stone',
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      wx.showToast({ title: `已捐献 ${amount} 灵石`, icon: 'success' });
      await this.reloadOverview({ showLoading: true });
    } catch (error) {
      console.error('[guild] donate failed', error);
      wx.showToast({ title: error.errMsg || '捐献失败', icon: 'none' });
    } finally {
      this.setData({ donating: false });
    }
  },
  resolveRoleLabel,
  formatNumber
});
