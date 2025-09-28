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
      },
      {
        icon: '📊',
        label: '订单查询',
        description: '按会员查看扣费订单记录',
        url: '/pages/admin/orders/index'
      },
      {
        icon: '🏠',
        label: '预约审核',
        description: '查看并审核包房预约申请',
        url: '/pages/admin/reservations/index'
      }
    ]
  },

  handleActionTap(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
