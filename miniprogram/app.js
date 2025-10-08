App({
  globalData: {
    env: 'cloud1-8gyoxq651fcc92c2',
    memberInfo: null,
    ready: false,
    lastPvpBattle: null,
    rolePendingAttributes: null
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
    const menuButtonRect = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : null;

    this.globalData.customNav = {
      statusBarHeight: 0,
      navHeight: 64,
      menuButtonRect
    };

    this.globalData.safeArea = {
      top: 0,
      bottom: 0
    };

    const applyMetrics = (info) => {
      if (!info) {
        return;
      }

      const statusBarHeight = info.statusBarHeight || 0;
      let navHeight = statusBarHeight + 44;

      if (menuButtonRect && typeof menuButtonRect.top === 'number') {
        const gap = menuButtonRect.top - statusBarHeight;
        const navBarHeight = menuButtonRect.height + Math.max(gap, 0) * 2;
        navHeight = statusBarHeight + navBarHeight;
      }

      const screenHeight = info.screenHeight || info.windowHeight || 0;
      const safeArea = info.safeArea || null;
      const bottomInset = safeArea && screenHeight
        ? Math.max(screenHeight - safeArea.bottom, 0)
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
    };

    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : null;
    if (windowInfo) {
      applyMetrics(windowInfo);
      return;
    }

    const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : null;
    if (deviceInfo) {
      applyMetrics(deviceInfo);
      return;
    }

    if (wx.getSystemInfo) {
      wx.getSystemInfo({
        success: applyMetrics
      });
    }
  }
});
