import { GuildService } from '../../../services/api';

Page({
  data: {
    ticket: '',
    signature: '',
    name: '',
    manifesto: '',
    icon: '',
    submitting: false
  },
  onLoad(options) {
    this.setData({
      ticket: options.ticket || '',
      signature: options.signature || ''
    });
  },
  handleNameInput(event) {
    this.setData({ name: event.detail.value });
  },
  handleManifestoInput(event) {
    this.setData({ manifesto: event.detail.value });
  },
  handleIconInput(event) {
    this.setData({ icon: event.detail.value });
  },
  async handleSubmit() {
    const { name, manifesto, icon, ticket, signature } = this.data;
    if (!name || !ticket) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await GuildService.createGuild({ name, manifesto, icon, ticket, signature });
      wx.showToast({ title: '创建成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 600);
    } catch (error) {
      console.error('[guild] create failed', error);
      wx.showToast({ title: error.errMsg || '创建失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
