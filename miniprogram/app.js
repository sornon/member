App({
  globalData: {
    env: 'cloud1-8gyoxq651fcc92c2',
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
