App({
  globalData: {
    env: 'your-env-id',
    memberInfo: null,
    ready: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    });

    this.globalData.ready = true;
  }
});
