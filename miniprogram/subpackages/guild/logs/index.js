import { GuildService } from '../../../services/api';
const { resolveGuildActionTicket, hasGuildActionTicketExpired } = require('../shared/guild.js');

function formatTimestamp(date) {
  if (!date) {
    return '--';
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '--';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  const ss = String(parsed.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function normalizePagination(pagination = {}) {
  if (!pagination || typeof pagination !== 'object') {
    return { hasMore: false, cursor: '' };
  }
  return {
    hasMore: !!pagination.hasMore,
    cursor: typeof pagination.next === 'string' ? pagination.next : ''
  };
}

function summarizePayload(payload) {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return '';
  }
}

function decorateLogs(entries = []) {
  return (entries || []).map((entry) => ({
    ...entry,
    createdAtText: formatTimestamp(entry.createdAt || entry.timestamp),
    payloadText: summarizePayload(entry.payload || entry.details)
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    logs: [],
    pagination: { hasMore: false, cursor: '' },
    fetching: false,
    actionTicket: null,
    guild: null
  },
  onLoad() {
    this.loadLogs();
  },
  onPullDownRefresh() {
    this.reload(true)
      .catch((error) => {
        console.error('[guild] refresh logs failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    this.handleLoadMore();
  },
  async loadLogs() {
    await this.reload(true);
  },
  async reload(reset = false) {
    if (reset) {
      this.setData({ loading: true, error: '' });
    }
    try {
      const overview = await GuildService.getOverview();
      const ticket = resolveGuildActionTicket(overview);
      this.setData({
        guild: overview.guild || null,
        actionTicket: ticket
      });
      await this.fetchLogs({ reset: true, ticket });
    } catch (error) {
      console.error('[guild] load logs failed', error);
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
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
      wx.showToast({ title: '授权生成失败', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh ticket failed', error);
      wx.showToast({ title: error.errMsg || '授权获取失败', icon: 'none' });
    }
    return null;
  },
  async fetchLogs({ reset = false, ticket } = {}) {
    const currentTicket = ticket || (await this.ensureActionTicket());
    if (!currentTicket) {
      return;
    }
    const cursor = !reset && this.data.pagination ? this.data.pagination.cursor : '';
    this.setData({ fetching: true });
    try {
      const response = await GuildService.getLogs({
        ticket: currentTicket.ticket,
        signature: currentTicket.signature,
        cursor,
        limit: 50
      });
      const logs = decorateLogs(response.logs || []);
      const merged = reset ? logs : (this.data.logs || []).concat(logs);
      this.setData({
        logs: merged,
        pagination: normalizePagination(response.pagination),
        fetching: false,
        loading: false,
        error: ''
      });
    } catch (error) {
      console.error('[guild] fetch logs failed', error);
      wx.showToast({ title: error.errMsg || '日志加载失败', icon: 'none' });
      this.setData({ fetching: false, loading: false, error: error.errMsg || '日志加载失败' });
    }
  },
  handleLoadMore() {
    if (this.data.fetching) {
      return;
    }
    if (!this.data.pagination || !this.data.pagination.hasMore) {
      return;
    }
    this.fetchLogs({ reset: false }).catch((error) => {
      console.error('[guild] load more logs failed', error);
    });
  }
});
