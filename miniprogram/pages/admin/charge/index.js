import { AdminService } from '../../../services/api';
import { formatCurrency as formatCurrencyLabel } from '../../../utils/format';
import { drawQrCode } from '../../../utils/qrcode';

function toFen(value) {
  if (value == null || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric * 100);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const sanitized = trimmed.replace(/[^0-9.-]/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  return 0;
}

function formatItems(items = []) {
  return items.map((item) => ({
    name: item.name || '',
    priceYuan: item.priceYuan || '',
    quantity: item.quantity > 0 ? item.quantity : 1
  }));
}

function buildPayload(items) {
  return items
    .map((item) => {
      const name = (item.name || '').trim();
      const quantity = Number(item.quantity || 0);
      const price = toFen(item.priceYuan);
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || price <= 0) {
        return null;
      }
      return {
        name,
        quantity: Math.floor(quantity),
        price
      };
    })
    .filter(Boolean);
}

function calculateTotalFen(items) {
  return items.reduce((sum, item) => {
    const price = toFen(item.priceYuan);
    const quantity = Number(item.quantity || 0);
    if (!price || !Number.isFinite(quantity) || quantity <= 0) {
      return sum;
    }
    return sum + price * Math.floor(quantity);
  }, 0);
}

function describeStatus(status) {
  switch (status) {
    case 'paid':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已过期';
    default:
      return '待支付';
  }
}

Page({
  data: {
    items: formatItems([
      { name: '', priceYuan: '', quantity: 1 }
    ]),
    totalAmount: 0,
    generating: false,
    currentOrder: null,
    loadingOrder: false,
    viewingOrderId: ''
  },

  onLoad(options = {}) {
    const orderId = options.orderId ? decodeURIComponent(options.orderId) : '';
    if (orderId) {
      this.setData({ viewingOrderId: orderId });
    }
  },

  onShow() {
    if (this.data.viewingOrderId) {
      this.loadExistingOrder(this.data.viewingOrderId);
      return;
    }
    if (this.data.currentOrder && this.data.currentOrder._id) {
      this.handleRefresh();
    }
  },

  onUnload() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  },

  handleItemInput(event) {
    const { index, field } = event.currentTarget.dataset;
    if (typeof index !== 'number' || !field) return;
    const items = [...this.data.items];
    items[index] = { ...items[index], [field]: event.detail.value };
    this.setData({
      items,
      totalAmount: calculateTotalFen(items)
    });
  },

  handleQuantityStep(event) {
    const { index, delta } = event.currentTarget.dataset;
    if (typeof index !== 'number') return;
    const items = [...this.data.items];
    const current = Number(items[index].quantity || 0);
    const next = Math.max(1, current + Number(delta || 0));
    items[index] = { ...items[index], quantity: next };
    this.setData({
      items,
      totalAmount: calculateTotalFen(items)
    });
  },

  handleAddItem() {
    const items = [
      ...this.data.items,
      { name: '', priceYuan: '', quantity: 1 }
    ];
    this.setData({
      items,
      totalAmount: calculateTotalFen(items)
    });
  },

  handleRemoveItem(event) {
    const { index } = event.currentTarget.dataset;
    if (typeof index !== 'number') return;
    const items = this.data.items.filter((_, idx) => idx !== index);
    if (!items.length) {
      wx.showToast({ title: '至少保留一项商品', icon: 'none' });
      return;
    }
    this.setData({
      items,
      totalAmount: calculateTotalFen(items)
    });
  },

  async handleGenerate() {
    if (this.data.generating) return;
    if (this.data.viewingOrderId) return;
    const payloadItems = buildPayload(this.data.items);
    if (!payloadItems.length) {
      wx.showToast({ title: '请完善商品信息', icon: 'none' });
      return;
    }
    this.setData({ generating: true });
    try {
      const order = await AdminService.createChargeOrder(payloadItems);
      this.setData({
        currentOrder: this.decorateOrder(order),
        generating: false
      });
      this.renderQr();
    } catch (error) {
      this.setData({ generating: false });
    }
  },

  async handleRefresh() {
    if (this.data.viewingOrderId) {
      await this.loadExistingOrder(this.data.viewingOrderId);
      return;
    }
    if (!this.data.currentOrder) return;
    this.setData({ loadingOrder: true });
    try {
      const order = await AdminService.getChargeOrder(this.data.currentOrder._id);
      this.setData({
        currentOrder: this.decorateOrder(order),
        loadingOrder: false
      });
      this.renderQr();
    } catch (error) {
      this.setData({ loadingOrder: false });
    }
  },

  async loadExistingOrder(orderId) {
    if (!orderId) return;
    this.setData({ loadingOrder: true });
    try {
      const order = await AdminService.getChargeOrder(orderId);
      if (!order) {
        wx.showToast({ title: '订单不存在', icon: 'none' });
        this.setData({ loadingOrder: false });
        return;
      }
      const decorated = this.decorateOrder(order);
      this.setData({
        currentOrder: decorated,
        loadingOrder: false,
        totalAmount: decorated.totalAmount || 0
      });
      this.renderQr();
    } catch (error) {
      this.setData({ loadingOrder: false });
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  decorateOrder(order) {
    if (!order) return null;
    const totalAmount = Number(order.totalAmount || 0);
    return {
      ...order,
      totalAmount,
      totalAmountLabel: formatCurrencyLabel(totalAmount),
      stoneRewardLabel: `${Number(order.stoneReward || totalAmount || 0)} 枚`,
      statusLabel: describeStatus(order.status),
      expireAtLabel: order.expireAt ? this.formatDateTime(order.expireAt) : '—'
    };
  },

  formatDateTime(value) {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '';
    }
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    const h = `${date.getHours()}`.padStart(2, '0');
    const mm = `${date.getMinutes()}`.padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${mm}`;
  },

  renderQr() {
    if (!this.data.currentOrder || !this.data.currentOrder.qrPayload) return;
    drawQrCode({
      canvasId: 'charge-qr',
      text: this.data.currentOrder.qrPayload,
      size: 240
    }, this);
  },

  formatCurrency(value) {
    return formatCurrencyLabel(value || 0);
  }
});
