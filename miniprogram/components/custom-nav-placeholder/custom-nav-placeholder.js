const app = getApp ? getApp() : null;

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    title: {
      type: String,
      value: ''
    },
    theme: {
      type: String,
      value: 'dark'
    }
  },

  data: {
    statusBarHeight: 24,
    navBarHeight: 44,
    navHeight: 68,
    navPlaceholderHeight: 68
  },

  lifetimes: {
    attached() {
      const customNav = app?.globalData?.customNav;
      const statusBarHeight = customNav?.statusBarHeight ?? this.data.statusBarHeight;
      const navHeight = customNav?.navHeight ?? statusBarHeight + this.data.navBarHeight;
      const navBarHeight = navHeight - statusBarHeight;

      this.setData({
        statusBarHeight,
        navHeight,
        navBarHeight: navBarHeight > 0 ? navBarHeight : this.data.navBarHeight,
        navPlaceholderHeight: navHeight > 0 ? navHeight : this.data.navPlaceholderHeight
      });
    }
  }
});
