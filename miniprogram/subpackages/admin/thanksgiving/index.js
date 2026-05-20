import { AdminService } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';

function buildRightsSummary(breakdown = []) {
  const parts = breakdown
    .filter((item) => item && Number(item.count) > 0)
    .map((item) => `${item.label} ${item.count}`);
  return parts.join(' / ');
}

function normalizeOrders(orders = []) {
  if (!Array.isArray(orders)) {
    return [];
  }
  return orders.map((item) => ({
    ...item,
    displayName: item.displayName || '未命名会员',
    amountLabel: item.amountLabel || '¥0.00',
    purchasedAtLabel: item.purchasedAtLabel || formatDateTime(item.purchasedAt) || '—',
    rightStatusLabel: item.rightStatusLabel || '未发放'
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    summary: {
      orderCount: 0,
      orderLimit: 0,
      stockRemaining: 0,
      totalStock: 0,
      sold: 0,
      rightsTotal: 0,
      rightsSummary: '',
      rightsBreakdown: [],
      updatedAtLabel: ''
    },
    orders: []
  },

  onLoad() {
    this.loadDashboard();
  },

  async loadDashboard() {
    this.setData({ loading: true, error: '' });
    try {
      const dashboard = await AdminService.getThanksgivingDashboard();
      const summary = this.normalizeDashboard(dashboard || {});
      this.setData({
        loading: false,
        summary,
        orders: normalizeOrders(summary.orders)
      });
    } catch (error) {
      console.error('[admin/thanksgiving] load dashboard failed', error);
      this.setData({
        loading: false,
        error: (error && error.errMsg) || error.message || '加载失败，请稍后重试'
      });
    }
  },

  handleRefresh() {
    if (this.data.loading) return;
    this.loadDashboard();
  },

  normalizeDashboard(payload = {}) {
    const breakdown = (payload.rights && payload.rights.breakdown) || [];
    const summaryText = buildRightsSummary(breakdown);
    const stock = payload.stock || {};
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    return {
      orderCount: Number(payload.orderCount || 0),
      orderLimit: Number(payload.orderLimit || orders.length || 0),
      stockRemaining: Number.isFinite(stock.stockRemaining) ? stock.stockRemaining : 0,
      totalStock: Number.isFinite(stock.totalStock) ? stock.totalStock : 0,
      sold: Number.isFinite(stock.sold) ? stock.sold : 0,
      rightsTotal: (payload.rights && Number(payload.rights.total)) || 0,
      rightsSummary: summaryText,
      rightsBreakdown: breakdown,
      updatedAtLabel: payload.updatedAtLabel || formatDateTime(payload.updatedAt),
      orders
    };
  }
});
