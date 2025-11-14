import { GuildService } from '../../../services/api';
const { resolveGuildActionTicket } = require('../../../shared/guild.js');

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
    return '';
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function decorateTasks(entries = []) {
  return (entries || []).map((task) => {
    const progress = task && task.progress ? task.progress : {};
    const current = Number(progress.current || 0);
    const target = Number(progress.target || progress.goal || 0) || 0;
    const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const reward = task && task.reward ? task.reward : {};
    const status = typeof task.status === 'string' ? task.status : 'open';
    let statusLabel = '进行中';
    if (status === 'completed' || status === 'ready') {
      statusLabel = '可领取';
    } else if (status === 'claimed') {
      statusLabel = '已领取';
    } else if (status === 'failed') {
      statusLabel = '已过期';
    }
    const claimable = status === 'completed' || status === 'ready';
    const claimed = status === 'claimed';
    return {
      ...task,
      status,
      progressCurrent: current,
      progressTarget: target,
      progressPercent: percent,
      rewardText: reward && reward.description ? reward.description : '',
      startAtText: formatDateTime(task.startAt || task.start_at),
      endAtText: formatDateTime(task.endAt || task.end_at),
      statusLabel,
      claimable,
      claimed
    };
  });
}

Page({
  data: {
    loading: true,
    error: '',
    tasks: [],
    actionTicket: null,
    claimingTaskId: '',
    guild: null,
    membership: null
  },
  onLoad() {
    this.loadTasks();
  },
  onPullDownRefresh() {
    this.reload()
      .catch((error) => {
        console.error('[guild] refresh tasks failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  async loadTasks() {
    await this.reload();
  },
  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const overview = await GuildService.getOverview();
      const ticket = resolveGuildActionTicket(overview);
      this.setData({
        guild: overview.guild || null,
        membership: overview.membership || null,
        actionTicket: ticket
      });
      await this.fetchTasks(ticket);
    } catch (error) {
      console.error('[guild] load tasks failed', error);
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
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
      wx.showToast({ title: '令牌生成失败', icon: 'none' });
    } catch (error) {
      console.error('[guild] refresh ticket failed', error);
      wx.showToast({ title: error.errMsg || '令牌获取失败', icon: 'none' });
    }
    return null;
  },
  async fetchTasks(ticket) {
    const currentTicket = ticket || (await this.ensureActionTicket());
    if (!currentTicket) {
      return;
    }
    try {
      const response = await GuildService.listTasks({
        ticket: currentTicket.ticket,
        signature: currentTicket.signature
      });
      const tasks = decorateTasks(response.tasks || []);
      this.setData({ tasks, loading: false, error: '' });
    } catch (error) {
      console.error('[guild] fetch tasks failed', error);
      wx.showToast({ title: error.errMsg || '任务加载失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || '任务加载失败' });
    }
  },
  async handleClaimTask(event) {
    const { id } = event.currentTarget.dataset || {};
    const taskId = typeof id === 'string' ? id : '';
    if (!taskId || this.data.claimingTaskId) {
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    this.setData({ claimingTaskId: taskId });
    try {
      await GuildService.claimTask({
        taskId,
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      wx.showToast({ title: '奖励已发放', icon: 'success' });
      await this.fetchTasks(ticket);
    } catch (error) {
      console.error('[guild] claim task failed', error);
      wx.showToast({ title: error.errMsg || '领取失败', icon: 'none' });
    } finally {
      this.setData({ claimingTaskId: '' });
    }
  },
  resolveRoleLabel
});
