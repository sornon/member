import { GuildService } from '../../../services/api';

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
      this.setData({ loading: false, guild: target });
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
      wx.showToast({ title: '令牌失效，请返回重试', icon: 'none' });
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
  }
});
