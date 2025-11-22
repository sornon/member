// Legacy stub retained for compatibility with cached routes; redirects to the new guild logs subpackage page.
Page({
  onLoad() {
    wx.redirectTo({ url: '/subpackages/guild/logs/index' });
  }
});
