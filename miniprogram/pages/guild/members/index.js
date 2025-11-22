import { GuildService } from '../../../services/api';
const {
  resolveGuildActionTicket,
  decorateGuildMembers,
  DEFAULT_MEMBER_AVATAR,
  hasGuildActionTicketExpired
} = require('../../../shared/guild.js');

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

function formatDateTime(date) {
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
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function normalizePagination(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return { hasMore: false, cursor: '' };
  }
  return {
    hasMore: !!payload.hasMore,
    cursor: typeof payload.next === 'string' ? payload.next : ''
  };
}

function decorateMemberList(entries = []) {
  const decorated = decorateGuildMembers(entries);
  return decorated.map((entry) => {
    const joinedAt = entry.joinedAt || entry.joined_at || entry.joinDate || entry.join_time;
    const lastActive = entry.updatedAt || entry.lastActiveAt || entry.lastSeenAt;
    return {
      ...entry,
      avatarUrl: entry.avatarUrl || DEFAULT_MEMBER_AVATAR,
      roleLabel: resolveRoleLabel(entry.role),
      joinedAtText: formatDateTime(joinedAt),
      lastActiveText: formatDateTime(lastActive),
      contributionTotal: Number(entry.contributionTotal || entry.contribution || 0),
      contributionWeek: Number(entry.contributionWeek || entry.contributionWeekly || 0),
      powerScore: Number(entry.power || entry.powerScore || 0),
      powerText: formatNumber(entry.power || entry.powerScore || 0)
    };
  });
}

function decorateGuild(guild) {
  if (!guild || typeof guild !== 'object') {
    return null;
  }
  return {
    ...guild,
    powerText: formatNumber(guild.power || guild.powerScore || 0),
    memberCountText: formatNumber(guild.memberCount || 0)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    guild: null,
    membership: null,
    membershipRoleLabel: '成员',
    members: [],
    pagination: { hasMore: false, cursor: '' },
    fetching: false,
    actionTicket: null,
    defaultAvatar: DEFAULT_MEMBER_AVATAR
  },
  onLoad() {
    this.loadOverview();
  },
  onPullDownRefresh() {
    this.reload(true)
      .catch((error) => {
        console.error('[guild] refresh members failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    this.handleLoadMore();
  },
  async loadOverview() {
    await this.reload(true);
  },
  async reload(resetMembers = false) {
    if (resetMembers) {
      this.setData({ loading: true, error: '' });
    }
    try {
      const result = await GuildService.getOverview();
      const ticket = resolveGuildActionTicket(result);
      this.setData({
        loading: false,
        guild: decorateGuild(result.guild),
        membership: result.membership || null,
        membershipRoleLabel: resolveRoleLabel(result.membership && result.membership.role),
        actionTicket: ticket,
        error: ''
      });
      await this.fetchMembers({ reset: true, ticket });
    } catch (error) {
      console.error('[guild] load overview failed', error);
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
      wx.showToast({ title: '授权生成失败', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh ticket failed', error);
      wx.showToast({ title: error.errMsg || '授权获取失败', icon: 'none' });
    }
    return null;
  },
  async fetchMembers({ reset = false, ticket } = {}) {
    const currentTicket = ticket || (await this.ensureActionTicket());
    if (!currentTicket) {
      return;
    }
    const cursor = !reset && this.data.pagination ? this.data.pagination.cursor : '';
    this.setData({ fetching: true });
    try {
      const response = await GuildService.listMembers({
        ticket: currentTicket.ticket,
        signature: currentTicket.signature,
        cursor,
        limit: 50
      });
      const members = decorateMemberList(response.members || []);
      const merged = reset ? members : (this.data.members || []).concat(members);
      this.setData({
        members: merged,
        pagination: normalizePagination(response.pagination),
        fetching: false,
        error: ''
      });
    } catch (error) {
      console.error('[guild] fetch members failed', error);
      wx.showToast({ title: error.errMsg || '加载成员失败', icon: 'none' });
      this.setData({ fetching: false, error: error.errMsg || '加载成员失败' });
    }
  },
  handleLoadMore() {
    if (this.data.fetching) {
      return;
    }
    if (!this.data.pagination || !this.data.pagination.hasMore) {
      return;
    }
    this.fetchMembers({ reset: false }).catch((error) => {
      console.error('[guild] load more members failed', error);
    });
  },
  async handleManageMember(event) {
    const { id, name } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const options = name ? [`调整 ${name} 的职位`, `将 ${name} 移出宗门`] : ['调整职位', '移出宗门'];
    try {
      await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: options,
          success: resolve,
          fail: (error) => {
            if (error && /cancel/.test(error.errMsg || '')) {
              resolve();
              return;
            }
            reject(error);
          }
        });
      });
      wx.showToast({ title: '操作暂未开放', icon: 'none' });
    } catch (error) {
      console.error('[guild] manage member action failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },
  resolveRoleLabel,
  formatNumber
});
