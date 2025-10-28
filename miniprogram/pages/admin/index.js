const app = getApp();

const BASE_ACTIONS = [
  {
    icon: '👥',
    label: '会员列表',
    description: '查看与管理会员资料',
    url: '/pages/admin/members/index'
  },
  {
    icon: '🍷',
    label: '存酒管理',
    description: '为会员登记和管理存酒',
    url: '/pages/admin/wine-storage/index'
  },
  {
    icon: '🧾',
    label: '创建扣费单',
    description: '录入商品生成扫码扣费单',
    url: '/pages/admin/charge/index'
  },
  {
    icon: '🛍️',
    label: '商品管理',
    description: '维护菜单类目与商品',
    url: '/pages/admin/menu-catalog/index'
  },
  {
    icon: '🎯',
    label: '活动管理',
    description: '配置会员端活动展示',
    url: '/pages/admin/activities/index'
  },
  {
    icon: '🍽️',
    label: '备餐列表',
    description: '查看会员点餐并推送扣费',
    url: '/pages/admin/menu-orders/index'
  },
  {
    icon: '📊',
    label: '订单查询',
    description: '按会员查看扣费订单记录',
    url: '/pages/admin/orders/index'
  },
  {
    icon: '⚔️',
    label: '交易行管理',
    description: '查看交易流水与全局配置',
    url: '/pages/admin/trading/index'
  },
  {
    icon: '💹',
    label: '财务报表',
    description: '查看月度收入与消费统计',
    url: '/pages/admin/finance-report/index'
  },
  {
    icon: '🏠',
    label: '预约审核',
    description: '查看并审核包房预约申请',
    url: '/pages/admin/reservations/index'
  },
  {
    icon: '🧹',
    label: '数据清理',
    description: '清理删除会员遗留数据',
    url: '/pages/admin/data-cleanup/index'
  },
  {
    icon: '⚙️',
    label: '系统设置',
    description: '系统全局配置功能',
    url: '/pages/admin/system-switches/index'
  }
];

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

function buildQuickActions(member) {
  const badges = normalizeReservationBadges(member && member.reservationBadges);
  return BASE_ACTIONS.map((action) => {
    if (action.url === '/pages/admin/reservations/index') {
      const showDot = badges.adminVersion > badges.adminSeenVersion;
      const badgeText = badges.pendingApprovalCount > 0 ? `${badges.pendingApprovalCount}` : '';
      return { ...action, showDot, badgeText };
    }
    return { ...action };
  });
}

Page({
  data: {
    quickActions: buildQuickActions(null)
  },

  onShow() {
    this.refreshQuickActions();
  },

  refreshQuickActions() {
    const member = (app.globalData && app.globalData.memberInfo) || null;
    this.setData({ quickActions: buildQuickActions(member) });
  },

  handleActionTap(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
