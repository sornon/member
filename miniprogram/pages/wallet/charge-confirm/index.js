import { WalletService } from '../../../services/api';
import { formatCurrency, formatStones } from '../../../utils/format';

function formatDateTime(value) {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function mapOrder(order) {
  if (!order) return null;
  const total = Number(order.totalAmount || 0);
  const stoneReward = Number(order.stoneReward || total || 0);
  const status = order.status || 'pending';
  const adminRemark = typeof order.adminRemark === 'string' ? order.adminRemark.trim() : '';
  const priceAdjustment = normalizePriceAdjustmentInfo(order.adminPriceAdjustment || order.priceAdjustment);
  const priceAdjustmentRemark = priceAdjustment && priceAdjustment.remark
    ? priceAdjustment.remark
    : typeof order.priceAdjustmentRemark === 'string'
    ? order.priceAdjustmentRemark.trim()
    : '';
  const priceAdjustmentVisible = Boolean(priceAdjustment || priceAdjustmentRemark);
  return {
    ...order,
    totalAmount: total,
    stoneReward,
    totalLabel: formatCurrency(total),
    stoneLabel: formatStones(stoneReward),
    createdAtLabel: formatDateTime(order.createdAt),
    expireAtLabel: formatDateTime(order.expireAt),
    status,
    statusLabel: status === 'pending' ? '待确认' : status === 'paid' ? '已完成' : status === 'expired' ? '已过期' : '已取消',
    adminRemark,
    priceAdjustment,
    priceAdjustmentRemark,
    priceAdjustmentVisible
  };
}

function normalizePriceAdjustmentInfo(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const newAmount = Number(record.newAmount || record.current || record.amount || 0);
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    return null;
  }
  const previousAmount = Number(record.previousAmount || record.previous || record.originalAmount || 0);
  const remark = typeof record.remark === 'string' ? record.remark.trim() : '';
  const adjustedAt = record.adjustedAt || record.updatedAt || record.createdAt || null;
  const adjustedBy = typeof record.adjustedBy === 'string' ? record.adjustedBy : '';
  const adjustedByName = typeof record.adjustedByName === 'string' ? record.adjustedByName : '';
  const hasPrevious = Number.isFinite(previousAmount) && previousAmount > 0;
  return {
    previousAmount,
    previousAmountLabel: hasPrevious ? formatCurrency(previousAmount) : '',
    newAmount,
    newAmountLabel: formatCurrency(newAmount),
    remark,
    adjustedAtLabel: formatDateTime(adjustedAt),
    adjustedBy,
    adjustedByName,
    hasPrevious
  };
}

Page({
  data: {
    orderId: '',
    loading: true,
    order: null,
    error: '',
    confirming: false
  },

  onLoad(options = {}) {
    const orderId = this.resolveOrderId(options);
    if (!orderId) {
      wx.showToast({ title: '扣费单不存在', icon: 'none' });
      return;
    }
    this.setData({ orderId });
    this.loadOrder(orderId);
  },

  resolveOrderId(options = {}) {
    if (!options || typeof options !== 'object') {
      return '';
    }
    if (options.orderId) {
      const direct = String(options.orderId).trim();
      if (direct) {
        return direct;
      }
    }
    if (options.scene) {
      let scene = '';
      try {
        scene = decodeURIComponent(options.scene);
      } catch (e) {
        scene = options.scene;
      }
      if (!scene) {
        return '';
      }
      if (scene.includes('=')) {
        const params = scene.split('&').reduce((acc, pair) => {
          if (!pair) {
            return acc;
          }
          const [rawKey, rawValue = ''] = pair.split('=');
          if (rawKey) {
            let key = rawKey;
            let value = rawValue;
            try {
              key = decodeURIComponent(rawKey);
            } catch (err) {
              key = rawKey;
            }
            try {
              value = decodeURIComponent(rawValue);
            } catch (err) {
              value = rawValue;
            }
            acc[key] = value || '';
          }
          return acc;
        }, {});
        if (params.orderId) {
          const parsed = String(params.orderId).trim();
          if (parsed) {
            return parsed;
          }
        }
      }
      return scene.trim();
    }
    return '';
  },

  async loadOrder(orderId) {
    this.setData({ loading: true, error: '' });
    try {
      const result = await WalletService.loadChargeOrder(orderId);
      const order = mapOrder(result.order);
      this.setData({ order, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.errMsg || error.message || '扣费单不存在' });
    }
  },

  async handleConfirm() {
    if (!this.data.order || this.data.order.status !== 'pending' || this.data.confirming) {
      return;
    }
    this.setData({ confirming: true });
    try {
      const result = await WalletService.confirmChargeOrder(this.data.orderId);
      const stoneReward = result && Number(result.stoneReward || 0);
      const message = stoneReward && stoneReward > 0 ? `扣费成功，灵石+${stoneReward}` : '扣费成功';
      wx.showToast({ title: message, icon: 'success' });
      await this.loadOrder(this.data.orderId);
      setTimeout(() => {
        wx.navigateBack({});
      }, 800);
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '扣费失败', icon: 'none' });
      this.loadOrder(this.data.orderId);
    } finally {
      this.setData({ confirming: false });
    }
  },

  handleRetry() {
    if (!this.data.orderId) return;
    this.loadOrder(this.data.orderId);
  },

  formatCurrency,
  formatStones
});
