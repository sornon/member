Page({
  data: {
    quickActions: [
      {
        icon: '👥',
        label: '会员列表',
        description: '查看与管理会员资料',
        url: '/pages/admin/members/index'
      }
    ]
  },

  handleActionTap(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
