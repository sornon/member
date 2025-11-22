import { GuildService } from '../../../services/api';
const { resolveGuildActionTicket, hasGuildActionTicketExpired } = require('../../../shared/guild.js');

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
    const rounded = (numeric / 10000).toFixed(1);
    return `${rounded.replace(/\.0$/, '')}万`;
  }
  return `${numeric}`;
}

function decorateAttributes(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const catalog = Array.isArray(state.catalog)
    ? state.catalog.map((entry) => ({
        ...entry,
        cap: entry.cap || 0,
        level: entry.level || 0,
        nextCost: entry.nextCost || 0,
        capped: state.maxLevel ? entry.cap >= state.maxLevel : false,
        progress: entry.cap > 0 ? Math.min(100, Math.round((entry.level || 0) / entry.cap * 100)) : 0
      }))
    : [];
  const contribution = state.contribution || {};
  const points = state.points || {};
  return {
    ...state,
    catalog,
    contribution: {
      ...contribution,
      remainingText: formatNumber(contribution.available)
    },
    points: {
      ...points,
      remainingText: formatNumber(points.available || 0)
    }
  };
}

Page({
  data: {
    loading: true,
    error: '',
    guild: null,
    membership: null,
    membershipRoleLabel: '成员',
    actionTicket: null,
    attributes: null,
    refreshing: false,
    upgradingKey: '',
    upgradingCap: false
  },
  onLoad() {
    this.loadPage();
  },
  onPullDownRefresh() {
    this.reload()
      .catch((error) => {
        console.error('[guild] refresh attributes failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  async loadPage() {
    await this.reload({ showLoading: true });
  },
  async reload({ showLoading = false } = {}) {
    if (showLoading) {
      this.setData({ loading: true, error: '' });
    }
    try {
      const overview = await GuildService.getOverview();
      const ticket = resolveGuildActionTicket(overview);
      this.setData({
        guild: overview.guild || null,
        membership: overview.membership || null,
        membershipRoleLabel: resolveRoleLabel(overview.membership && overview.membership.role),
        actionTicket: ticket
      });
      await this.fetchAttributes({ ticket });
      this.setData({ loading: false });
    } catch (error) {
      console.error('[guild] load attributes overview failed', error);
      this.setData({
        loading: false,
        error: error.errMsg || error.message || '加载失败'
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
      wx.showToast({ title: '授权获取失败', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh action ticket failed', error);
      wx.showToast({ title: error.errMsg || '授权获取失败', icon: 'none' });
    }
    return null;
  },
  async fetchAttributes({ ticket } = {}) {
    const actionTicket = ticket || (await this.ensureActionTicket());
    if (!actionTicket) {
      this.setData({ error: '授权失效，请返回重试', loading: false });
      return;
    }
    this.setData({ refreshing: true, error: '' });
    try {
      const result = await GuildService.getGuildAttributes({
        ticket: actionTicket.ticket,
        signature: actionTicket.signature
      });
      this.setData({ attributes: decorateAttributes(result), loading: false });
    } catch (error) {
      console.error('[guild] load guild attributes failed', error);
      this.setData({ error: error.errMsg || error.message || '加载失败', loading: false });
    } finally {
      this.setData({ refreshing: false });
    }
  },
  async handleUpgradeCap(event) {
    const { attributes, upgradingCap } = this.data;
    const key = event.currentTarget.dataset && event.currentTarget.dataset.key;
    if (!attributes || !key || upgradingCap) {
      return;
    }
    if (!attributes.points || attributes.points.available <= 0) {
      wx.showToast({ title: '升级点不足', icon: 'none' });
      return;
    }
    this.setData({ upgradingCap: true, upgradingKey: key });
    try {
      const ticket = await this.ensureActionTicket();
      if (!ticket) {
        return;
      }
      const result = await GuildService.upgradeGuildAttributeCap({
        key,
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      wx.showToast({ title: '上限提升成功', icon: 'success' });
      this.setData({ attributes: decorateAttributes(result) });
    } catch (error) {
      console.error('[guild] upgrade guild attribute cap failed', error);
      wx.showToast({ title: error.errMsg || '上限提升失败', icon: 'none' });
    } finally {
      this.setData({ upgradingCap: false, upgradingKey: '' });
    }
  },
  async handleUpgradeLevel(event) {
    const { attributes, upgradingKey } = this.data;
    const key = event.currentTarget.dataset && event.currentTarget.dataset.key;
    if (!attributes || !key || upgradingKey === key) {
      return;
    }
    const target = (attributes.catalog || []).find((item) => item.key === key);
    if (!target || target.cap <= target.level) {
      wx.showToast({ title: '已达宗门上限', icon: 'none' });
      return;
    }
    const nextCost = target.nextCost || 0;
    if (attributes.contribution && attributes.contribution.available < nextCost) {
      wx.showToast({ title: '个人贡献不足', icon: 'none' });
      return;
    }
    this.setData({ upgradingKey: key });
    try {
      const ticket = await this.ensureActionTicket();
      if (!ticket) {
        return;
      }
      const result = await GuildService.upgradeMemberGuildAttribute({
        key,
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      wx.showToast({ title: '升级成功', icon: 'success' });
      this.setData({ attributes: decorateAttributes(result) });
    } catch (error) {
      console.error('[guild] upgrade attribute failed', error);
      wx.showToast({ title: error.errMsg || '升级失败', icon: 'none' });
    } finally {
      this.setData({ upgradingKey: '' });
    }
  },
  resolveRoleLabel,
  formatNumber
});
