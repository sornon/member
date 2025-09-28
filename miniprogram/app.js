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

    this.setupSystemMetrics();
    this.globalData.ready = true;
  },

  onShow() {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: '#050921',
      animation: {
        duration: 0,
        timingFunc: 'linear'
      }
    });
  },

  setupSystemMetrics() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      const menuButtonRect = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;

      const statusBarHeight = systemInfo.statusBarHeight || 0;
      let navHeight = statusBarHeight + 44;

      if (menuButtonRect) {
        const gap = menuButtonRect.top - statusBarHeight;
        const navBarHeight = menuButtonRect.height + Math.max(gap, 0) * 2;
        navHeight = statusBarHeight + navBarHeight;
      }

      const bottomInset = systemInfo.safeArea
        ? Math.max(systemInfo.screenHeight - systemInfo.safeArea.bottom, 0)
        : 0;

      this.globalData.customNav = {
        statusBarHeight,
        navHeight,
        menuButtonRect
      };

      this.globalData.safeArea = {
        top: statusBarHeight,
        bottom: bottomInset
      };
    } catch (error) {
      this.globalData.customNav = {
        statusBarHeight: 0,
        navHeight: 64,
        menuButtonRect: null
      };
      this.globalData.safeArea = {
        top: 0,
        bottom: 0
      };
    }
  }
});
