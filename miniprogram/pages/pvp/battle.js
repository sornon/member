Page({
  data: {
    redirecting: true,
    error: ''
  },

  onLoad(options = {}) {
    const matchId = typeof options.matchId === 'string' ? options.matchId : '';
    if (!matchId) {
      this.setData({ redirecting: false, error: '缺少战报编号，无法查看战斗详情' });
      return;
    }
    const mode = options.mode === 'pve' ? 'pve' : 'pvp';
    const query = `mode=${mode}&replay=1&matchId=${encodeURIComponent(matchId)}`;
    wx.redirectTo({
      url: `/pages/battle/play?${query}`,
      fail: (error) => {
        console.error('[pvp] redirect battle replay failed', error);
        this.setData({ redirecting: false, error: error.errMsg || '战斗画面跳转失败' });
      }
    });
  },

  onPullDownRefresh() {
    wx.stopPullDownRefresh();
  }
});
