Page({
  data: {
    quickActions: [
      {
        icon: '👥',
        label: '会员列表',
        description: '查看与管理会员资料',
        url: '/pages/admin/members/index'
      },
      {
        icon: '🧾',
        label: '创建扣费单',
        description: '录入商品生成扫码扣费单',
        url: '/pages/admin/charge/index'
      }
    ]
  },

  handleActionTap(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
