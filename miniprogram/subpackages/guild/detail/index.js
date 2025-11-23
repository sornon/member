import { GuildService } from '../../../services/api';

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
    guildId: '',
    ticket: '',
    signature: '',
    guild: null,
    loading: true,
    error: '',
    joining: false
  },
  onLoad(options) {
    this.setData({
      guildId: options.id || '',
      ticket: options.ticket || '',
      signature: options.signature || ''
    });
    this.loadGuild();
  },
  async loadGuild() {
    const { guildId } = this.data;
    if (!guildId) {
      this.setData({ loading: false, error: '未找到宗门信息' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const list = await GuildService.listGuilds();
      const target = (list.guilds || []).find((item) => item.id === guildId);
      if (!target) {
        this.setData({ loading: false, error: '宗门不存在或已解散' });
        return;
      }
      this.setData({ loading: false, guild: decorateGuild(target) });
    } catch (error) {
      console.error('[guild] load detail failed', error);
      this.setData({ loading: false, error: error.errMsg || '加载失败' });
    }
  },
  async handleJoin() {
    const { guildId, ticket, signature, joining } = this.data;
    if (joining) {
      return;
    }
    if (!ticket) {
      wx.showToast({ title: '授权失效，请返回重试', icon: 'none' });
      return;
    }
    this.setData({ joining: true });
    try {
      await GuildService.joinGuild({ guildId, ticket, signature });
      wx.showToast({ title: '加入成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({ delta: 2 });
      }, 600);
    } catch (error) {
      console.error('[guild] join failed', error);
      wx.showToast({ title: error.errMsg || '加入失败', icon: 'none' });
    } finally {
      this.setData({ joining: false });
    }
  },
  formatNumber
});
