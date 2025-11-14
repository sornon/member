import { GuildService } from '../../../services/api';

const PAGE_SIZE = 10;
const MEMBER_PAGE_SIZE = 20;

const ROLE_LABELS = {
  leader: '宗主',
  officer: '长老',
  member: '成员'
};

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  const rounded = Math.round(numeric);
  return `${rounded}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0%';
  }
  return `${Math.max(0, Math.round(numeric * 100))}%`;
}

function decorateGuildListItem(item = {}) {
  const topMembers = Array.isArray(item.topMembers) ? item.topMembers : [];
  const topMembersText = topMembers
    .map((member) => `${member.name || member.memberId || '成员'}(${formatNumber(member.contribution || 0)})`)
    .join('、');
  const activeCount = Number(item.activeMemberCount || item.memberCount || 0);
  const capacity = Number(item.capacity || 0);
  const memberLabel = capacity > 0 ? `${formatNumber(activeCount)} / ${formatNumber(capacity)}` : `${formatNumber(activeCount)}`;
  const alertCount = Number(item.alertCount || 0);
  const leaderName =
    item.leader && (item.leader.name || item.leader.id) ? item.leader.name || item.leader.id : '';
  const leaderId = item.leader && item.leader.id ? item.leader.id : '';
  const leaderLabel = leaderName || leaderId || '暂无宗主';
  return {
    id: item.id || '',
    name: item.name || '未命名宗门',
    leaderName,
    leaderId,
    leaderLabel,
    memberLabel,
    powerLabel: formatNumber(item.power || 0),
    activityLabel: formatNumber(item.activityScore || 0),
    contributionLabel: formatNumber(item.contributionTotal || 0),
    alertLabel: alertCount > 0 ? `${alertCount} 条` : '无',
    alertType: alertCount > 0 ? 'warning' : '',
    topMembersText,
    updatedAtLabel: formatDateTime(item.updatedAt || item.lastAlertAt || '')
  };
}

function decorateGuildDetail(item = {}) {
  const topMembers = Array.isArray(item.topMembers) ? item.topMembers : [];
  const topMembersText = topMembers
    .map((member) => `${member.name || member.memberId || '成员'}(${formatNumber(member.contribution || 0)})`)
    .join('、');
  const activeCount = Number(item.activeMemberCount || item.memberCount || 0);
  const capacity = Number(item.capacity || 0);
  const memberLabel = capacity > 0 ? `${formatNumber(activeCount)} / ${formatNumber(capacity)}` : `${formatNumber(activeCount)}`;
  const leaderName =
    item.leader && (item.leader.name || item.leader.id) ? item.leader.name || item.leader.id : '';
  const leaderId = item.leader && item.leader.id ? item.leader.id : '';
  const leaderLabel = leaderName || leaderId || '暂无宗主';
  return {
    id: item.id || '',
    name: item.name || '未命名宗门',
    leaderName,
    leaderId,
    leaderLabel,
    manifesto: item.manifesto || '',
    notice: item.notice || '',
    memberLabel,
    powerLabel: formatNumber(item.power || 0),
    activityLabel: formatNumber(item.activityScore || 0),
    contributionLabel: formatNumber(item.contributionTotal || 0),
    averagePowerLabel: formatNumber(item.averagePower || 0),
    alertLabel: (Number(item.alertCount || 0) > 0 ? `${item.alertCount} 条` : '无') || '无',
    topMembersText,
    createdAtLabel: formatDateTime(item.createdAt || ''),
    updatedAtLabel: formatDateTime(item.updatedAt || item.lastAlertAt || '')
  };
}

function decorateBoss(boss = {}) {
  if (!boss || (typeof boss !== 'object' && !boss.bossId)) {
    return null;
  }
  const level = Number.isFinite(Number(boss.level)) ? Math.max(1, Math.round(Number(boss.level))) : 1;
  return {
    bossId: boss.bossId || '',
    name: boss.name || '宗门试炼',
    levelLabel: `Lv.${level}`,
    progressLabel: formatPercent(boss.progress),
    hpLabel: `${formatNumber(boss.hpLeft || 0)} / ${formatNumber(boss.hpMax || 0)}`,
    totalDamageLabel: formatNumber(boss.totalDamage || 0),
    updatedAtLabel: formatDateTime(boss.updatedAt || ''),
    leaderboard: Array.isArray(boss.leaderboard)
      ? boss.leaderboard.map((entry) => ({
          memberId: entry.memberId || '',
          name: entry.name || entry.memberId || '成员',
          damageLabel: formatNumber(entry.damage || 0)
        }))
      : []
  };
}

function decorateTask(task = {}) {
  const id = task.id || task.taskId || '';
  const current = task.progress && Number.isFinite(Number(task.progress.current)) ? Number(task.progress.current) : 0;
  const target = task.progress && Number.isFinite(Number(task.progress.target)) ? Number(task.progress.target) : 0;
  const statusLabels = {
    open: '进行中',
    closed: '已结束',
    completed: '已完成'
  };
  return {
    id,
    title: task.title || task.taskId || '宗门任务',
    statusLabel: statusLabels[task.status] || task.status || '进行中',
    progressLabel: `${formatNumber(current)} / ${formatNumber(target)} (${formatPercent(task.progress && task.progress.percent)})`,
    endAtLabel: formatDateTime(task.endAt || '')
  };
}

function decorateAlert(alert = {}) {
  const summaryMessage = alert.summary && (alert.summary.message || alert.summary.description);
  const payloadMessage = alert.payload && (alert.payload.message || alert.payload.reason);
  const message = summaryMessage || payloadMessage || alert.action || '异常操作';
  const actorId = alert.actorId || '';
  const actorName =
    alert.actorName ||
    (alert.actor &&
      (alert.actor.displayName ||
        alert.actor.name ||
        alert.actor.nickName ||
        alert.actor.nickname)) ||
    '';
  const actorDisplay = alert.actorDisplay || actorName || actorId || '';
  return {
    id: alert.id || '',
    action: alert.action || '',
    actorId,
    actorName,
    actorDisplay,
    message,
    createdAtLabel: formatDateTime(alert.createdAt || '')
  };
}

function decorateMembersOverview(members = {}) {
  const topContributors = Array.isArray(members.topContributors)
    ? members.topContributors.map((entry) => ({
        memberId: entry.memberId || '',
        name: entry.name || entry.memberId || '成员',
        contributionLabel: formatNumber(entry.contribution || 0)
      }))
    : [];
  const topPower = Array.isArray(members.topPower)
    ? members.topPower.map((entry) => ({
        memberId: entry.memberId || '',
        name: entry.name || entry.memberId || '成员',
        powerLabel: formatNumber(entry.power || 0)
      }))
    : [];
  const recentJoins = Array.isArray(members.recentJoins)
    ? members.recentJoins.map((entry) => ({
        memberId: entry.memberId || '',
        name: entry.name || entry.memberId || '成员',
        joinedAtLabel: formatDateTime(entry.joinedAt || '')
      }))
    : [];
  return {
    total: Number(members.total || 0),
    active: Number(members.active || 0),
    inactive: Number(members.inactive || 0),
    officerCount: Number(members.officerCount || 0),
    topContributors,
    topPower,
    recentJoins
  };
}

function decorateMemberListEntry(member = {}) {
  const status = member.status === 'inactive' ? 'inactive' : 'active';
  return {
    memberId: member.memberId || '',
    name: member.name || member.memberId || '成员',
    roleLabel: ROLE_LABELS[member.role] || '成员',
    statusLabel: status === 'inactive' ? '已退出' : '活跃',
    statusClass: status,
    contributionLabel: formatNumber(member.contribution || 0),
    powerLabel: formatNumber(member.power || 0),
    activityLabel: formatNumber(member.activity || 0),
    joinedAtLabel: formatDateTime(member.joinedAt || '')
  };
}

Page({
  data: {
    keyword: '',
    loading: false,
    guilds: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    finished: false,
    selectedGuildId: '',
    selectedGuild: null,
    membersOverview: {
      total: 0,
      active: 0,
      inactive: 0,
      officerCount: 0,
      topContributors: [],
      topPower: [],
      recentJoins: []
    },
    boss: null,
    tasks: [],
    alerts: [],
    detailLoading: false,
    memberKeyword: '',
    includeInactive: false,
    memberOrder: 'contribution',
    memberList: [],
    memberPage: 1,
    memberPageSize: MEMBER_PAGE_SIZE,
    memberTotal: 0,
    memberFinished: false,
    memberLoading: false,
    memberLoadingGuildId: '',
    memberRoles: {},
    memberStats: {}
  },

  async onLoad() {
    try {
      await this.fetchGuilds({ reset: true });
      const { selectedGuildId, guilds } = this.data;
      if (!selectedGuildId && guilds && guilds.length) {
        await this.loadGuildDetail(guilds[0].id);
      }
    } catch (error) {
      console.error('[admin:guild] initial load failed', error);
    }
  },

  onPullDownRefresh() {
    this.refreshAll()
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh({});
      });
  },

  async refreshAll() {
    await this.fetchGuilds({ reset: true });
    if (this.data.selectedGuildId) {
      await this.loadGuildDetail(this.data.selectedGuildId);
    } else if (this.data.guilds.length) {
      await this.loadGuildDetail(this.data.guilds[0].id);
    }
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' });
  },

  handleSearch() {
    this.fetchGuilds({ reset: true });
  },

  handleReset() {
    this.setData({ keyword: '' });
    this.fetchGuilds({ reset: true });
  },

  async fetchGuilds({ reset = false, page } = {}) {
    if (this.data.loading) {
      return Promise.resolve();
    }
    const targetPage = page || (reset ? 1 : this.data.page);
    this.setData({ loading: true });
    if (reset) {
      this.setData({ guilds: [], finished: false, total: 0, page: 1 });
    }
    try {
      const response = await GuildService.adminListGuilds({
        keyword: this.data.keyword,
        page: targetPage,
        pageSize: this.data.pageSize
      });
      const list = Array.isArray(response && response.guilds)
        ? response.guilds.map((item) => decorateGuildListItem(item))
        : [];
      const guilds = reset ? list : this.data.guilds.concat(list);
      const total = Number(response && response.total) || guilds.length;
      const finished = guilds.length >= total;
      this.setData({
        guilds,
        page: targetPage,
        total,
        finished
      });
      if (!guilds.length) {
        this.setData({ selectedGuildId: '', selectedGuild: null });
      }
      if (reset && guilds.length) {
        await this.loadGuildDetail(guilds[0].id);
      }
    } catch (error) {
      console.error('[admin:guild] fetch guilds failed', error);
      wx.showToast({
        title: (error && error.message) || '加载宗门失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
    return { guilds: this.data.guilds, total: this.data.total };
  },

  handleLoadMoreGuilds() {
    if (this.data.loading || this.data.finished) {
      return;
    }
    const nextPage = (this.data.page || 1) + 1;
    this.fetchGuilds({ page: nextPage });
  },

  handleGuildTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || id === this.data.selectedGuildId) {
      return;
    }
    this.loadGuildDetail(id);
  },

  async loadGuildDetail(guildId) {
    if (!guildId) {
      return;
    }
    this.setData({
      selectedGuildId: guildId,
      detailLoading: true,
      memberKeyword: '',
      memberList: [],
      memberPage: 1,
      memberFinished: false
    });
    try {
      const response = await GuildService.adminGetGuildDetail({ guildId });
      const guildSummary = decorateGuildDetail(response && response.guild ? response.guild : {});
      const membersOverview = decorateMembersOverview(response && response.members ? response.members : {});
      const boss = decorateBoss(response && response.boss ? response.boss : null);
      const tasks = Array.isArray(response && response.tasks) ? response.tasks.map((task) => decorateTask(task)) : [];
      const alerts = Array.isArray(response && response.alerts) ? response.alerts.map((alert) => decorateAlert(alert)) : [];
      this.setData({
        selectedGuild: guildSummary,
        membersOverview,
        boss,
        tasks,
        alerts
      });
      await this.loadMemberList({ reset: true });
    } catch (error) {
      console.error('[admin:guild] load detail failed', error);
      wx.showToast({
        title: (error && error.message) || '加载详情失败',
        icon: 'none'
      });
    } finally {
      this.setData({ detailLoading: false });
    }
  },

  handleMemberKeywordInput(event) {
    this.setData({ memberKeyword: event.detail.value || '' });
  },

  handleMemberSearch() {
    this.loadMemberList({ reset: true });
  },

  handleMemberReset() {
    this.setData({ memberKeyword: '', includeInactive: false, memberOrder: 'contribution' });
    this.loadMemberList({ reset: true });
  },

  handleToggleInactive() {
    this.setData({ includeInactive: !this.data.includeInactive });
    this.loadMemberList({ reset: true });
  },

  handleMemberOrderChange(event) {
    const { order } = event.currentTarget.dataset || {};
    if (!order || order === this.data.memberOrder) {
      return;
    }
    this.setData({ memberOrder: order });
    this.loadMemberList({ reset: true });
  },

  handleMemberLoadMore() {
    if (this.data.memberLoading || this.data.memberFinished) {
      return;
    }
    const nextPage = (this.data.memberPage || 1) + 1;
    this.loadMemberList({ page: nextPage });
  },

  async loadMemberList({ reset = false, page } = {}) {
    const guildId = this.data.selectedGuildId;
    if (!guildId) {
      return Promise.resolve();
    }
    const { memberLoading, memberLoadingGuildId } = this.data;
    if (memberLoading && memberLoadingGuildId === guildId) {
      return Promise.resolve();
    }
    const targetPage = page || (reset ? 1 : this.data.memberPage || 1);
    const requestId = `${guildId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._activeMemberRequestId = requestId;
    this.setData({ memberLoading: true, memberLoadingGuildId: guildId });
    if (reset) {
      this.setData({ memberList: [], memberFinished: false, memberTotal: 0, memberPage: 1 });
    }
    try {
      const response = await GuildService.adminGetGuildMembers({
        guildId,
        page: targetPage,
        pageSize: this.data.memberPageSize,
        keyword: this.data.memberKeyword,
        includeInactive: this.data.includeInactive,
        order: this.data.memberOrder
      });
      if (this._activeMemberRequestId !== requestId || this.data.selectedGuildId !== guildId) {
        return;
      }
      const entries = Array.isArray(response && response.members)
        ? response.members.map((entry) => decorateMemberListEntry(entry))
        : [];
      const memberList = reset ? entries : this.data.memberList.concat(entries);
      const total = Number(response && response.total) || memberList.length;
      const finished = memberList.length >= total;
      this.setData({
        memberList,
        memberPage: targetPage,
        memberTotal: total,
        memberFinished: finished,
        memberRoles: (response && response.roles) || this.data.memberRoles,
        memberStats: (response && response.stats) || this.data.memberStats
      });
    } catch (error) {
      console.error('[admin:guild] load members failed', error);
      if (this._activeMemberRequestId === requestId) {
        wx.showToast({
          title: (error && error.message) || '加载成员失败',
          icon: 'none'
        });
      }
    } finally {
      if (this._activeMemberRequestId === requestId) {
        this.setData({ memberLoading: false, memberLoadingGuildId: '' });
      }
    }
  }
});
