import { GuildService } from '../../../services/api';

const PAGE_SIZE = 10;
const MEMBER_PAGE_SIZE = 20;

const ROLE_LABELS = {
  leader: '宗主',
  officer: '长老',
  member: '成员'
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatKeyLabel(key = '') {
  if (!key) {
    return '';
  }
  const spaced = key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_\-\s]+/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '';
}

function formatKeyValueEntries(section) {
  if (!isPlainObject(section)) {
    return [];
  }
  return Object.keys(section)
    .filter((key) => Object.prototype.hasOwnProperty.call(section, key))
    .map((key) => {
      const value = section[key];
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const normalizedValue =
        typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      return {
        key,
        label: formatKeyLabel(key) || key,
        value: normalizedValue
      };
    })
    .filter(Boolean);
}

function createEmptyAlertDetail() {
  return {
    id: '',
    message: '',
    action: '',
    actorDisplay: '',
    createdAtLabel: '',
    summaryItems: [],
    payloadItems: []
  };
}

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
  const summary = isPlainObject(alert.summary) ? alert.summary : null;
  const payload = isPlainObject(alert.payload) ? alert.payload : null;
  return {
    id: alert.id || '',
    action: alert.action || '',
    actorId,
    actorName,
    actorDisplay,
    message,
    createdAtLabel: formatDateTime(alert.createdAt || ''),
    summary,
    payload,
    summaryItems: formatKeyValueEntries(summary),
    payloadItems: formatKeyValueEntries(payload)
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

function formatDurationLabel(milliseconds) {
  const numeric = Number(milliseconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '—';
  }
  if (numeric < 1000) {
    return `${numeric} 毫秒`;
  }
  const seconds = Math.round(numeric / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) {
    return remainSeconds ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`;
}

function decorateSystemOverview(payload = {}) {
  const stats = payload.stats || {};
  const settings = payload.settings || {};
  const alertCount = Number(stats.securityAlertCount || 0);
  const statsEntries = [
    {
      key: 'guildCount',
      label: '宗门总数',
      value: formatNumber(stats.guildCount || 0),
      rawValue: Number(stats.guildCount || 0)
    },
    {
      key: 'memberCount',
      label: '成员总数',
      value: formatNumber(stats.memberCount || 0),
      rawValue: Number(stats.memberCount || 0)
    },
    {
      key: 'activeMembers',
      label: '活跃成员',
      value: formatNumber(stats.activeMembers || 0),
      rawValue: Number(stats.activeMembers || 0)
    },
    {
      key: 'inactiveMembers',
      label: '退出成员',
      value: formatNumber(stats.inactiveMembers || 0),
      rawValue: Number(stats.inactiveMembers || 0)
    },
    {
      key: 'bossCount',
      label: 'Boss 档案',
      value: formatNumber(stats.bossCount || 0),
      rawValue: Number(stats.bossCount || 0)
    },
    {
      key: 'activeBossCount',
      label: '进行中试炼',
      value: formatNumber(stats.activeBossCount || 0),
      rawValue: Number(stats.activeBossCount || 0)
    },
    {
      key: 'openTaskCount',
      label: '进行中任务',
      value: formatNumber(stats.openTaskCount || 0),
      rawValue: Number(stats.openTaskCount || 0)
    },
    {
      key: 'completedTaskCount',
      label: '已完成任务',
      value: formatNumber(stats.completedTaskCount || 0),
      rawValue: Number(stats.completedTaskCount || 0)
    },
    {
      key: 'securityAlertCount',
      label: '安全预警',
      value: formatNumber(alertCount),
      rawValue: Number(alertCount),
      tone: alertCount > 0 ? 'warning' : 'default'
    }
  ];
  const leaderboardTtl = Number(settings.leaderboardCacheTtlMs || 0);
  const bossDailyAttempts = Number(settings.bossDailyAttempts || 0);
  const settingsEntries = [
    {
      key: 'enabled',
      label: '系统开关',
      value: settings.enabled === false ? '已关闭' : '已开启',
      tone: settings.enabled === false ? 'danger' : 'success',
      type: 'boolean',
      rawValue: settings.enabled !== false,
      editValue: settings.enabled !== false,
      helper: '关闭后，宗门相关功能将暂时不可用。'
    },
    {
      key: 'maxMembers',
      label: '宗门人数上限',
      value: formatNumber(settings.maxMembers || 0),
      type: 'number',
      rawValue: Number(settings.maxMembers || 0),
      editValue: Number(settings.maxMembers || 0),
      helper: '单个宗门可容纳的成员数量（建议 5-500 人）。'
    },
    {
      key: 'leaderboardCacheTtlMs',
      label: '排行榜缓存',
      value: formatDurationLabel(leaderboardTtl),
      type: 'duration',
      rawValue: leaderboardTtl,
      editValue: Math.max(1, Math.round(leaderboardTtl / (60 * 1000))),
      inputUnit: '分钟',
      helper: '缓存刷新间隔，影响贡献/战力等排行榜的更新频率。'
    },
    {
      key: 'teamBattleEnabled',
      label: '团队讨伐',
      value: settings.teamBattleEnabled === false ? '未启用' : '已启用',
      tone: settings.teamBattleEnabled === false ? 'muted' : 'success',
      type: 'boolean',
      rawValue: settings.teamBattleEnabled !== false,
      editValue: settings.teamBattleEnabled !== false,
      helper: '控制团队讨伐玩法是否对宗门成员开放。'
    },
    {
      key: 'bossEnabled',
      label: '宗门试炼',
      value:
        settings.bossEnabled === false
          ? '已关闭'
          : bossDailyAttempts > 0
          ? `已开启 · ${formatNumber(bossDailyAttempts)} 次/日`
          : '已开启',
      tone: settings.bossEnabled === false ? 'muted' : 'success',
      type: 'boolean',
      rawValue: settings.bossEnabled !== false,
      editValue: settings.bossEnabled !== false,
      helper: '控制宗门 Boss 试炼是否启用。'
    },
    {
      key: 'bossDailyAttempts',
      label: '每日试炼次数',
      value: bossDailyAttempts > 0 ? `${formatNumber(bossDailyAttempts)} 次` : '未限制',
      type: 'number',
      rawValue: bossDailyAttempts,
      editValue: bossDailyAttempts,
      helper: '成员每日可挑战宗门试炼的次数，建议 1-10 次。'
    },
    {
      key: 'riskControlEnabled',
      label: '风控监控',
      value: settings.riskControlEnabled === false ? '已停用' : '监控中',
      tone: settings.riskControlEnabled === false ? 'muted' : 'warning',
      type: 'boolean',
      rawValue: settings.riskControlEnabled !== false,
      editValue: settings.riskControlEnabled !== false,
      helper: '启用后将记录捐献、挑战等高频操作，便于审计。'
    }
  ];
  const recentGuilds = Array.isArray(payload.recentGuilds)
    ? payload.recentGuilds
        .map((entry) => ({
          id: entry.id || '',
          name: entry.name || entry.id || '未命名宗门',
          memberLabel: formatNumber(entry.memberCount || 0),
          updatedAtLabel: formatDateTime(entry.updatedAt || '')
        }))
        .filter((entry) => entry.id)
    : [];
  const updatedAt = formatDateTime(payload.updatedAt || (payload.summary && payload.summary.updatedAt) || '');
  return {
    statsEntries,
    settingsEntries,
    recentGuilds,
    updatedAtLabel: updatedAt
  };
}

Page({
  data: {
    systemLoading: false,
    systemOverview: {
      statsEntries: [],
      settingsEntries: [],
      recentGuilds: [],
      updatedAtLabel: ''
    },
    systemResetting: false,
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
    alertDetailVisible: false,
    alertDetail: createEmptyAlertDetail(),
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
    memberStats: {},
    statDetailVisible: false,
    statDetail: {
      key: '',
      title: '',
      value: '',
      note: '',
      items: [],
      action: null
    },
    settingEditor: {
      visible: false,
      key: '',
      type: '',
      label: '',
      helper: '',
      unit: '',
      value: '',
      inputValue: '',
      error: ''
    },
    settingSaving: false
  },

  async onLoad() {
    try {
      await Promise.all([this.fetchSystemOverview(), this.fetchGuilds({ reset: true })]);
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
    await this.fetchSystemOverview();
    await this.fetchGuilds({ reset: true });
    if (this.data.selectedGuildId) {
      await this.loadGuildDetail(this.data.selectedGuildId);
    } else if (this.data.guilds.length) {
      await this.loadGuildDetail(this.data.guilds[0].id);
    }
  },

  async fetchSystemOverview() {
    if (this.data.systemLoading) {
      return Promise.resolve();
    }
    this.setData({ systemLoading: true });
    try {
      const response = await GuildService.adminGetSystemOverview();
      const overview = decorateSystemOverview(response || {});
      this.setData({ systemOverview: overview });
    } catch (error) {
      console.error('[admin:guild] fetch system overview failed', error);
      wx.showToast({
        title: (error && error.message) || '加载系统概览失败',
        icon: 'none'
      });
    } finally {
      this.setData({ systemLoading: false });
    }
  },

  handleRefreshSystem() {
    this.fetchSystemOverview();
  },

  handleResetSystem() {
    if (this.data.systemResetting) {
      return;
    }
    wx.showModal({
      title: '清空宗门数据',
      content: '此操作将删除所有宗门、成员、任务、Boss、日志等数据，不可恢复，请确认已做好备份。',
      confirmText: '立即清空',
      confirmColor: '#e64b4b',
      success: (result) => {
        if (result && result.confirm) {
          this.performSystemReset();
        }
      }
    });
  },

  async performSystemReset() {
    if (this.data.systemResetting) {
      return;
    }
    this.setData({ systemResetting: true });
    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await GuildService.adminResetGuildSystem({ requestId });
      wx.showToast({ title: '已清空宗门数据', icon: 'success' });
      this.setData({
        guilds: [],
        page: 1,
        total: 0,
        finished: true,
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
        memberKeyword: '',
        includeInactive: false,
        memberOrder: 'contribution',
        memberList: [],
        memberPage: 1,
        memberTotal: 0,
        memberFinished: true,
        memberLoading: false,
        memberLoadingGuildId: '',
        memberRoles: {},
        memberStats: {}
      });
      await this.fetchSystemOverview();
      await this.fetchGuilds({ reset: true });
    } catch (error) {
      console.error('[admin:guild] reset system failed', error);
      wx.showToast({
        title: (error && error.message) || '清空失败',
        icon: 'none'
      });
    } finally {
      this.setData({ systemResetting: false });
    }
  },

  handleStatTap(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key) {
      return;
    }
    const detail = this.buildStatDetail(key);
    if (!detail) {
      return;
    }
    this.setData({ statDetailVisible: true, statDetail: detail });
  },

  closeStatDetail() {
    this.setData({
      statDetailVisible: false,
      statDetail: {
        key: '',
        title: '',
        value: '',
        note: '',
        items: [],
        action: null
      }
    });
  },

  closeAlertDetail() {
    this.setData({
      alertDetailVisible: false,
      alertDetail: createEmptyAlertDetail()
    });
  },

  handleStatAction() {
    const { statDetail } = this.data;
    if (!statDetail || !statDetail.action) {
      this.closeStatDetail();
      return;
    }
    const action = statDetail.action;
    this.closeStatDetail();
    if (action.type === 'navigate' && action.url) {
      wx.navigateTo({ url: action.url });
    } else if (action.type === 'scroll' && action.selector) {
      wx.pageScrollTo({ selector: action.selector, duration: 300 });
    }
  },

  buildStatDetail(key) {
    const { systemOverview, selectedGuild, membersOverview, boss, tasks, alerts } = this.data;
    const entry = (systemOverview.statsEntries || []).find((item) => item.key === key);
    if (!entry) {
      return null;
    }
    const detail = {
      key,
      title: entry.label || '',
      value: entry.value || '',
      note: '',
      items: [],
      action: null
    };
    const statsEntries = systemOverview.statsEntries || [];
    const findStat = (statKey) => statsEntries.find((item) => item.key === statKey);
    switch (key) {
      case 'guildCount': {
        const recent = Array.isArray(systemOverview.recentGuilds)
          ? systemOverview.recentGuilds.map((guild) => ({
              type: 'list',
              primary: guild.name,
              secondary: `成员：${guild.memberLabel} · 更新时间：${guild.updatedAtLabel || '—'}`
            }))
          : [];
        detail.note = recent.length ? '最近更新的宗门' : '暂无更多宗门信息';
        detail.items = recent;
        if (recent.length) {
          detail.action = { type: 'scroll', selector: '#guildList', label: '前往宗门列表' };
        }
        break;
      }
      case 'memberCount': {
        const active = findStat('activeMembers');
        const inactive = findStat('inactiveMembers');
        detail.note = '成员分布：';
        detail.items = [
          { type: 'metric', label: '活跃成员', value: active ? active.value : '0' },
          { type: 'metric', label: '退出成员', value: inactive ? inactive.value : '0' }
        ];
        detail.action = { type: 'navigate', url: '/pages/admin/members/index', label: '查看会员列表' };
        break;
      }
      case 'activeMembers': {
        const guildName = selectedGuild ? selectedGuild.name : '当前宗门';
        detail.note = '活跃成员包含近期登录或参与宗门活动的玩家。';
        detail.items = [
          { type: 'metric', label: `${guildName} 活跃`, value: formatNumber((membersOverview && membersOverview.active) || 0) },
          { type: 'metric', label: `${guildName} 总人数`, value: formatNumber((membersOverview && membersOverview.total) || 0) }
        ];
        detail.action = { type: 'navigate', url: '/pages/admin/members/index', label: '查看会员列表' };
        break;
      }
      case 'inactiveMembers': {
        const guildName = selectedGuild ? selectedGuild.name : '当前宗门';
        detail.note = '退出成员包括被移除或主动离开的成员。';
        detail.items = [
          { type: 'metric', label: `${guildName} 退出成员`, value: formatNumber((membersOverview && membersOverview.inactive) || 0) }
        ];
        detail.action = { type: 'navigate', url: '/pages/admin/members/index', label: '查看会员列表' };
        break;
      }
      case 'bossCount':
      case 'activeBossCount': {
        detail.note = boss ? '当前宗门试炼进度：' : '当前选中宗门暂未开启试炼。';
        detail.items = boss
          ? [
              {
                type: 'list',
                primary: `${boss.name} · ${boss.levelLabel}`,
                secondary: `进度：${boss.progressLabel} · 剩余 HP：${boss.hpLabel}`
              }
            ]
          : [];
        if (boss) {
          detail.action = { type: 'scroll', selector: '#guildBossSection', label: '查看宗门试炼' };
        }
        break;
      }
      case 'openTaskCount':
      case 'completedTaskCount': {
        const taskItems = Array.isArray(tasks)
          ? tasks.slice(0, 5).map((task) => ({
              type: 'list',
              primary: task.title,
              secondary: `状态：${task.statusLabel} · 进度：${task.progressLabel}`
            }))
          : [];
        detail.note = taskItems.length ? '当前宗门任务：' : '当前选中宗门暂无任务数据。';
        detail.items = taskItems;
        if (taskItems.length) {
          detail.action = { type: 'scroll', selector: '#guildTaskSection', label: '查看宗门任务' };
        }
        break;
      }
      case 'securityAlertCount': {
        const alertItems = Array.isArray(alerts)
          ? alerts.slice(0, 5).map((alert) => ({
              type: 'list',
              primary: alert.message || '异常行为',
              secondary: `时间：${alert.createdAtLabel || '—'} · 操作：${alert.action || '未知'}`
            }))
          : [];
        detail.note = alertItems.length ? '最近的安全预警：' : '近期暂无安全预警。';
        detail.items = alertItems;
        if (alertItems.length) {
          detail.action = { type: 'scroll', selector: '#guildAlertSection', label: '查看预警记录' };
        }
        break;
      }
      default:
        break;
    }
    return detail;
  },

  handleAlertTap(event) {
    const dataset = event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const alertId = dataset.id;
    if (!alertId) {
      return;
    }
    const alert = (this.data.alerts || []).find((item) => item.id === alertId);
    if (!alert) {
      return;
    }
    const detail = {
      id: alert.id,
      message: alert.message || '异常行为',
      action: alert.action || '',
      actorDisplay: alert.actorDisplay || alert.actorName || alert.actorId || '',
      createdAtLabel: alert.createdAtLabel || '',
      summaryItems: Array.isArray(alert.summaryItems) ? alert.summaryItems : [],
      payloadItems: Array.isArray(alert.payloadItems) ? alert.payloadItems : []
    };
    this.setData({ alertDetailVisible: true, alertDetail: detail });
  },

  handleSettingTap(event) {
    const dataset = event.currentTarget.dataset || {};
    const { key, type } = dataset;
    if (!key || !type || dataset.editable === 'false') {
      return;
    }
    if (type === 'link' && dataset.url) {
      wx.navigateTo({ url: dataset.url });
      return;
    }
    const editor = {
      visible: true,
      key,
      type,
      label: dataset.label || '',
      helper: dataset.helper || '',
      unit: dataset.unit || '',
      value: '',
      inputValue: '',
      error: ''
    };
    if (type === 'boolean') {
      const boolValue =
        dataset.boolean === true ||
        dataset.boolean === 'true' ||
        dataset.value === 1 ||
        dataset.value === '1';
      editor.value = boolValue;
    } else if (type === 'duration' || type === 'number') {
      const numeric = Number(dataset.value);
      editor.value = Number.isFinite(numeric) ? numeric : '';
      editor.inputValue = Number.isFinite(numeric) ? String(numeric) : '';
    }
    this.setData({ settingEditor: editor, settingSaving: false });
  },

  handleSettingInput(event) {
    if (!this.data.settingEditor.visible) {
      return;
    }
    this.setData({
      'settingEditor.inputValue': event.detail.value || '',
      'settingEditor.error': ''
    });
  },

  handleSettingSelect(event) {
    if (!this.data.settingEditor.visible || this.data.settingEditor.type !== 'boolean') {
      return;
    }
    const { value } = event.currentTarget.dataset || {};
    const normalized = value === true || value === 'true' || value === 1 || value === '1';
    this.setData({
      'settingEditor.value': normalized,
      'settingEditor.error': ''
    });
  },

  handleSettingCancel() {
    if (this.data.settingSaving) {
      return;
    }
    this.closeSettingEditor();
  },

  async handleSettingConfirm() {
    const editor = this.data.settingEditor;
    if (!editor.visible || !editor.key || this.data.settingSaving) {
      return;
    }
    let value;
    if (editor.type === 'boolean') {
      if (typeof editor.value !== 'boolean') {
        this.setData({ 'settingEditor.error': '请选择状态' });
        return;
      }
      value = editor.value;
    } else if (editor.type === 'number' || editor.type === 'duration') {
      const input = (editor.inputValue || '').trim();
      if (!input) {
        this.setData({ 'settingEditor.error': '请输入数值' });
        return;
      }
      const numeric = Number(input);
      if (!Number.isFinite(numeric)) {
        this.setData({ 'settingEditor.error': '请输入有效数字' });
        return;
      }
      const rounded = Math.floor(numeric);
      if (editor.key === 'maxMembers' && (rounded < 5 || rounded > 500)) {
        this.setData({ 'settingEditor.error': '人数上限需在 5-500 之间' });
        return;
      }
      if (editor.key === 'bossDailyAttempts' && (rounded < 1 || rounded > 20)) {
        this.setData({ 'settingEditor.error': '每日试炼次数需在 1-20 之间' });
        return;
      }
      if (editor.key === 'leaderboardCacheTtlMs' && (rounded < 1 || rounded > 1440)) {
        this.setData({ 'settingEditor.error': '排行榜缓存建议为 1-1440 分钟' });
        return;
      }
      value = Math.max(0, rounded);
    } else {
      this.closeSettingEditor();
      return;
    }
    await this.saveSystemSetting(editor.key, value);
  },

  async saveSystemSetting(key, value) {
    this.setData({ settingSaving: true, 'settingEditor.error': '' });
    const updates = {};
    if (key === 'leaderboardCacheTtlMs') {
      const minutes = Number(value);
      const milliseconds = Math.max(30 * 1000, Math.floor(minutes) * 60 * 1000);
      updates[key] = milliseconds;
    } else {
      updates[key] = value;
    }
    try {
      await GuildService.adminUpdateSystemSettings({ updates });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.fetchSystemOverview();
      this.closeSettingEditor();
    } catch (error) {
      console.error('[admin:guild] update system setting failed', error);
      const message = (error && error.message) || '保存失败';
      this.setData({ 'settingEditor.error': message });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ settingSaving: false });
    }
  },

  closeSettingEditor() {
    this.setData({
      settingEditor: {
        visible: false,
        key: '',
        type: '',
        label: '',
        helper: '',
        unit: '',
        value: '',
        inputValue: '',
        error: ''
      }
    });
  },

  preventTouchMove() {},

  stopPropagation() {},

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
        alerts,
        alertDetailVisible: false,
        alertDetail: createEmptyAlertDetail()
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
