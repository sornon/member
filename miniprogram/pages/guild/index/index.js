import { GuildService } from '../../../services/api';
const {
  resolveGuildActionTicket,
  decorateGuildLeaderboardEntries,
  hasGuildActionTicketExpired
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
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  if (numeric >= 10000) {
    return `${(numeric / 10000).toFixed(1)}万`;
  }
  return `${numeric}`;
}

  function decorateGuild(guild) {
    if (!guild || typeof guild !== 'object') {
      return null;
    }
    const memberCapacity = Number(guild.capacity || guild.memberLimit || guild.memberCap || guild.capacityLimit || 0);
    const contribution = Number(guild.contribution || guild.contributionTotal || 0);
    return {
      ...guild,
      powerText: formatNumber(guild.power || guild.powerScore || 0),
      memberCountText: formatNumber(guild.memberCount || 0),
      memberCapacity,
      memberCapacityText: Number.isFinite(memberCapacity) && memberCapacity > 0 ? formatNumber(memberCapacity) : '',
      contributionText: formatNumber(contribution)
    };
  }

  function decorateLeaderboard(leaderboard = []) {
    const normalized = decorateGuildLeaderboardEntries(leaderboard || []);
    return normalized.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }
      const basePower = Number(entry.metricValue || entry.power || 0);
      const decorated = decorateGuild({ ...entry, power: basePower });
      if (!decorated) {
        return entry;
      }
      return {
        ...entry,
        ...decorated,
        powerText: formatNumber(basePower)
      };
    });
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
    membershipRoleLabel: '成员',
    leaderboard: [],
    guildList: [],
    actionTicket: null,
    settings: null,
    teamBattleEnabled: false,
    donating: false,
    guildListLoading: true,
    guildListError: ''
  },
  onShow() {
    this.loadOverview();
    this.loadGuildList();
  },
  onPullDownRefresh() {
    Promise.all([
      this.reloadOverview({ showLoading: false }),
      this.loadGuildList({ showLoading: false })
    ])
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
      const leaderboard = decorateLeaderboard(result.leaderboard || []);
      const membership = result.membership || null;
      // 团队讨伐暂未开放，强制标记为关闭以禁用入口
      const teamBattleEnabled = false;
      this.setData({
        loading: false,
        guild: decorateGuild(result.guild),
        membership,
        membershipRoleLabel: membership ? resolveRoleLabel(membership.role) : '成员',
        leaderboard,
        actionTicket: ticket,
        settings: result.settings || null,
        teamBattleEnabled,
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
  async loadGuildList({ showLoading = true } = {}) {
    if (showLoading) {
      this.setData({ guildListLoading: true, guildListError: '' });
    }
    try {
      const result = await GuildService.listGuilds();
      const guildList = decorateLeaderboard(result.guilds || []);
      this.setData({ guildListLoading: false, guildList, guildListError: '' });
    } catch (error) {
      console.error('[guild] load guild list failed', error);
      this.setData({
        guildListLoading: false,
        guildListError: error.errMsg || error.message || '宗门列表加载失败'
      });
    }
  },
  async ensureActionTicket({ refresh = false } = {}) {
    let shouldRefresh = !!refresh;
    if (!shouldRefresh) {
      const { actionTicket } = this.data;
      if (actionTicket && actionTicket.ticket && !hasGuildActionTicketExpired(actionTicket)) {
        return actionTicket;
      }
      shouldRefresh = true;
    }
    if (!shouldRefresh) {
      return null;
    }
    try {
      const refreshed = await GuildService.refreshTicket();
      const ticket = resolveGuildActionTicket(refreshed);
      if (ticket) {
        this.setData({ actionTicket: ticket });
        return ticket;
      }
      wx.showToast({ title: '授权生成失败，请稍后重试', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh ticket failed', error);
      wx.showToast({ title: error.errMsg || '授权获取失败', icon: 'none' });
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
    const { guild, teamBattleEnabled } = this.data;
    if (!teamBattleEnabled) {
      wx.showToast({ title: '团队讨伐功能暂未开放', icon: 'none' });
      return;
    }
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
      const result = await GuildService.donate({
        amount,
        type: 'stone',
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      const contribution = result && result.donation ? Number(result.donation.contribution) || 0 : 0;
      const toastTitle = contribution ? `贡献 +${contribution}` : `已捐献 ${amount} 灵石`;
      wx.showToast({ title: toastTitle, icon: 'success' });
      if (contribution > 0 && this.data.membership) {
        const current = Number(this.data.membership.contributionTotal || this.data.membership.contribution || 0) || 0;
        const updatedContribution = current + contribution;
        this.setData({
          membership: {
            ...this.data.membership,
            contribution: updatedContribution,
            contributionTotal: updatedContribution
          }
        });
      }
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
