const app = getApp();

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    title: {
      type: String,
      value: ''
    },
    enableBack: {
      type: Boolean,
      value: true
    },
    theme: {
      type: String,
      value: 'dark'
    }
  },

  data: {
    statusBarHeight: 0,
    navHeight: 64,
    navBarHeight: 44,
    navPlaceholderHeight: 64,
    showBack: false,
    canNavigateBack: false
  },

  lifetimes: {
    attached() {
      const { customNav = {}, safeArea = {} } = app.globalData || {};
      const statusBarHeight = customNav.statusBarHeight ?? safeArea.top ?? 0;
      const navHeight = customNav.navHeight || (statusBarHeight + 44);
      const navBarHeight = navHeight - statusBarHeight;
      const pages = getCurrentPages();
      const canNavigateBack = pages.length > 1;
      const showBack = !!this.data.enableBack;

      this.setData({
        statusBarHeight,
        navHeight,
        navBarHeight: navBarHeight > 0 ? navBarHeight : 44,
        navPlaceholderHeight: navHeight > 0 ? navHeight : 64,
        showBack,
        canNavigateBack
      });
    }
  },

  methods: {
    handleBack() {
      const pages = getCurrentPages();
      const canNavigateBack = pages.length > 1 || this.data.canNavigateBack;
      if (canNavigateBack) {
        wx.navigateBack({ delta: 1 });
      } else {
        const indexPageIndex = pages.findIndex((page) => page.route === 'pages/index/index');
        if (indexPageIndex >= 0) {
          const delta = pages.length - 1 - indexPageIndex;
          if (delta > 0) {
            wx.navigateBack({ delta });
            return;
          }
        }
        wx.redirectTo({ url: '/pages/index/index' });
      }
    }
  }
});
