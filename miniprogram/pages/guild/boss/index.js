import { GuildService } from '../../../services/api';
const { resolveGuildActionTicket, hasGuildActionTicketExpired } = require('../../../shared/guild.js');

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  if (numeric >= 100000) {
    return `${(numeric / 10000).toFixed(1)}万`;
  }
  return `${numeric}`;
}

function formatCooldown(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) {
    return '可立即挑战';
  }
  const seconds = Math.max(0, Math.floor(duration / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`;
}

function decorateBossStatus(payload = {}) {
  const boss = payload && payload.boss ? payload.boss : {};
  const hp = boss.hp || {};
  const max = Number(hp.max || 0);
  const current = Number(hp.current || 0);
  const percent = max > 0 ? Math.max(0, Math.round((current / max) * 100)) : 0;
  const attempts = boss.attempts || {};
  const cooldownRemaining = Number(attempts.cooldownRemaining || 0);
  return {
    ...boss,
    hp: {
      ...hp,
      max,
      current,
      percent
    },
    attempts: {
      ...attempts,
      cooldownRemaining,
      cooldownText: formatCooldown(cooldownRemaining)
    }
  };
}

function decorateBossRank(entries = []) {
  return (entries || []).map((entry, index) => ({
    ...entry,
    rank: index + 1,
    damageText: formatNumber(entry.damage || entry.totalDamage || 0)
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    boss: null,
    canChallenge: false,
    serverCanChallenge: false,
    actionTicket: null,
    membership: null,
    guild: null,
    settings: null,
    challenging: false,
    rankEntries: [],
    rankLoading: false
  },
  onLoad() {
    this.loadStatus();
  },
  onUnload() {
    this.clearCooldownTimer();
  },
  onPullDownRefresh() {
    this.reload()
      .catch((error) => {
        console.error('[guild] refresh boss failed', error);
      })
      .finally(() => wx.stopPullDownRefresh());
  },
  async loadStatus() {
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
      await this.fetchBossStatus(ticket);
      await this.fetchBossRank(ticket);
    } catch (error) {
      console.error('[guild] load boss status failed', error);
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
  async fetchBossStatus(ticket) {
    const currentTicket = ticket || (await this.ensureActionTicket());
    if (!currentTicket) {
      return;
    }
    try {
      const status = await GuildService.getBossStatus({
        ticket: currentTicket.ticket,
        signature: currentTicket.signature
      });
      const boss = decorateBossStatus(status);
      const serverCanChallenge = !!status.canChallenge;
      this.setData({
        boss,
        serverCanChallenge,
        canChallenge: this.evaluateCanChallenge(boss, serverCanChallenge),
        settings: status.settings || null,
        loading: false,
        error: ''
      });
      this.startCooldownTimer(boss);
    } catch (error) {
      console.error('[guild] fetch boss status failed', error);
      wx.showToast({ title: error.errMsg || 'Boss 状态获取失败', icon: 'none' });
      this.setData({ loading: false, error: error.errMsg || 'Boss 状态获取失败' });
    }
  },
  async fetchBossRank(ticket) {
    const currentTicket = ticket || (await this.ensureActionTicket());
    if (!currentTicket) {
      return;
    }
    this.setData({ rankLoading: true });
    try {
      const result = await GuildService.getBossRank({
        ticket: currentTicket.ticket,
        signature: currentTicket.signature
      });
      this.setData({ rankEntries: decorateBossRank(result.leaderboard || []), rankLoading: false });
    } catch (error) {
      console.error('[guild] fetch boss rank failed', error);
      this.setData({ rankLoading: false });
    }
  },
  async handleChallenge() {
    if (!this.data.canChallenge || this.data.challenging) {
      return;
    }
    const ticket = await this.ensureActionTicket();
    if (!ticket) {
      return;
    }
    this.setData({ challenging: true });
    try {
      const result = await GuildService.challengeBoss({
        ticket: ticket.ticket,
        signature: ticket.signature
      });
      const boss = decorateBossStatus(result);
      const serverCanChallenge = !!result.canChallenge;
      this.setData({
        boss,
        serverCanChallenge,
        canChallenge: this.evaluateCanChallenge(boss, serverCanChallenge),
        challenging: false
      });
      this.startCooldownTimer(boss);
      wx.showToast({ title: result.victory ? '讨伐成功' : '挑战完成', icon: 'success' });
      await this.fetchBossRank(ticket);
    } catch (error) {
      console.error('[guild] boss challenge failed', error);
      wx.showToast({ title: error.errMsg || '挑战失败', icon: 'none' });
      this.setData({ challenging: false });
    }
  },
  evaluateCanChallenge(boss, baseCanChallenge = this.data.serverCanChallenge) {
    const attempts = (boss && boss.attempts) || {};
    const hasAttempts = Number(attempts.remaining || 0) > 0;
    const cooldownReady = Number(attempts.cooldownRemaining || 0) <= 0;
    return !!baseCanChallenge || (hasAttempts && cooldownReady);
  },
  startCooldownTimer(boss) {
    this.clearCooldownTimer();
    const attempts = (boss && boss.attempts) || {};
    const cooldownRemaining = Number(attempts.cooldownRemaining || 0);
    if (!Number.isFinite(cooldownRemaining) || cooldownRemaining <= 0) {
      this.setData({ canChallenge: this.evaluateCanChallenge(boss) });
      return;
    }
    const endTime = Date.now() + cooldownRemaining;
    this.cooldownTimer = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      const nextBoss = {
        ...(this.data.boss || {}),
        ...boss,
        attempts: {
          ...((this.data.boss && this.data.boss.attempts) || {}),
          ...(boss && boss.attempts ? boss.attempts : {}),
          cooldownRemaining: remaining,
          cooldownText: formatCooldown(remaining)
        }
      };
      this.setData({
        boss: nextBoss,
        canChallenge: this.evaluateCanChallenge(nextBoss)
      });
      if (remaining <= 0) {
        this.clearCooldownTimer();
      }
    }, 1000);
  },
  clearCooldownTimer() {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  },
  formatNumber
});
