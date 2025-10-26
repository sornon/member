import { WalletService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatCurrency, formatDate } from '../../utils/format';

const presets = [200, 500, 1000, 2000, 5000];

const DEFAULT_FEATURES = {
  cashierEnabled: true
};

function toNumeric(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return toBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function formatTransactionAmount(amount) {
  const numeric = toNumeric(amount, 0);
  if (numeric === 0) {
    return formatCurrency(0);
  }
  const prefix = numeric > 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(numeric))}`;
}

const ORDER_DETAIL_SOURCES = new Set(['chargeorder', 'menuorder']);

function decorateTransaction(txn) {
  if (!txn || typeof txn !== 'object') {
    return {
      _id: '',
      type: 'unknown',
      typeLabel: '',
      amount: 0,
      amountText: formatCurrency(0),
      amountClass: '',
      source: '',
      orderId: '',
      canViewOrder: false,
      remark: '',
      createdAt: '',
      displayDate: ''
    };
  }

  const amount = toNumeric(txn.amount, 0);
  const status = typeof txn.status === 'string' ? txn.status.trim() : '';
  const normalizedStatus = status ? status.toLowerCase() : '';
  const source = typeof txn.source === 'string' ? txn.source.trim() : '';
  const normalizedSource = source.toLowerCase();
  const orderId = typeof txn.orderId === 'string' ? txn.orderId.trim() : '';
  const rawType = typeof txn.type === 'string' ? txn.type.trim() : '';
  let amountClass = amount > 0 ? 'income' : amount < 0 ? 'expense' : '';
  let amountText = formatTransactionAmount(amount);

  if (normalizedStatus && normalizedStatus !== 'success') {
    amountClass = `status status-${normalizedStatus}`;
    if (txn.type === 'recharge') {
      if (normalizedStatus === 'pending' || normalizedStatus === 'processing') {
        amountText = '待支付';
      } else {
        amountText = '充值失败';
      }
    } else if (normalizedStatus === 'pending' || normalizedStatus === 'processing') {
      amountText = '处理中';
    } else if (normalizedStatus === 'cancelled') {
      amountText = '已取消';
    } else if (normalizedStatus === 'failed') {
      amountText = '交易失败';
    } else if (normalizedStatus === 'refunded') {
      amountText = '已退款';
    } else if (normalizedStatus === 'closed') {
      amountText = '已关闭';
    }
  }

  return {
    ...txn,
    type: rawType || txn.type || '',
    source,
    orderId,
    amount,
    amountText,
    amountClass,
    createdAt: txn.createdAt,
    displayDate: formatDate(txn.createdAt),
    canViewOrder: Boolean(orderId && ORDER_DETAIL_SOURCES.has(normalizedSource))
  };
}

function decorateWineEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) {
    return null;
  }
  const rawQuantity = Number(entry.quantity || 0);
  const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
  const expiresAtDate = entry.expiresAt ? new Date(entry.expiresAt) : null;
  const expiresAtValid = expiresAtDate && !Number.isNaN(expiresAtDate.getTime()) ? expiresAtDate : null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : `wine_${index}`,
    name,
    quantity,
    expiresAt: expiresAtValid ? expiresAtValid.toISOString() : '',
    expiresAtText: expiresAtValid ? formatDate(expiresAtValid) : '—',
    sortKey: expiresAtValid ? expiresAtValid.getTime() : Number.POSITIVE_INFINITY
  };
}

function decorateSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return {
      cashBalance: 0,
      balance: 0,
      totalRecharge: 0,
      totalSpend: 0,
      cashBalanceText: formatCurrency(0),
      totalRechargeText: formatCurrency(0),
      totalSpendText: formatCurrency(0),
      transactions: [],
      wineStorage: [],
      totalWineQuantity: 0,
      features: { ...DEFAULT_FEATURES }
    };
  }

  const cashBalance = toNumeric(summary.cashBalance ?? summary.balance, 0);
  const balance = toNumeric(summary.balance ?? summary.cashBalance, cashBalance);
  const totalRecharge = toNumeric(summary.totalRecharge, 0);
  const totalSpend = toNumeric(summary.totalSpend, 0);
  const transactions = Array.isArray(summary.transactions)
    ? summary.transactions.map((txn) => decorateTransaction(txn))
    : [];
  const wineEntriesRaw = Array.isArray(summary.wineStorage) ? summary.wineStorage : [];
  const wineEntriesDecorated = wineEntriesRaw
    .map((entry, index) => decorateWineEntry(entry, index))
    .filter((entry) => !!entry);
  wineEntriesDecorated.sort((a, b) => a.sortKey - b.sortKey);
  const wineStorage = wineEntriesDecorated.map((entry) => {
    const { sortKey, ...rest } = entry;
    return rest;
  });
  const totalWineQuantity = Number.isFinite(summary.wineStorageTotal)
    ? Math.max(0, Math.floor(summary.wineStorageTotal))
    : wineStorage.reduce((sum, entry) => sum + (Number.isFinite(entry.quantity) ? entry.quantity : 0), 0);
  const features = normalizeFeatures(summary.features);

  return {
    ...summary,
    cashBalance,
    balance,
    totalRecharge,
    totalSpend,
    cashBalanceText: formatCurrency(cashBalance),
    totalRechargeText: formatCurrency(totalRecharge),
    totalSpendText: formatCurrency(totalSpend),
    transactions,
    wineStorage,
    totalWineQuantity,
    features
  };
}

function normalizeFeatures(features) {
  const normalized = { ...DEFAULT_FEATURES };
  if (features && typeof features === 'object') {
    if (Object.prototype.hasOwnProperty.call(features, 'cashierEnabled')) {
      normalized.cashierEnabled = toBoolean(features.cashierEnabled, true);
    }
  }
  return normalized;
}

Page({
  data: {
    loading: true,
    summary: null,
    amount: presets[0],
    presets
  },

  onShow() {
    this.attachMemberRealtime();
    ensureMemberWatcher().catch(() => {
      // ignore ensure errors here; fetchSummary will handle errors when needed
    });
    this.fetchSummary();
  },

  onHide() {
    this.detachMemberRealtime();
  },

  onUnload() {
    this.detachMemberRealtime();
  },

  attachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      return;
    }
    this.unsubscribeMemberRealtime = subscribeMemberRealtime((event) => {
      if (
        !event ||
        (event.type !== 'memberChanged' && event.type !== 'memberSnapshot' && event.type !== 'memberExtrasChanged')
      ) {
        return;
      }
      this.fetchSummary({ showLoading: false });
    });
  },

  detachMemberRealtime() {
    if (this.unsubscribeMemberRealtime) {
      this.unsubscribeMemberRealtime();
      this.unsubscribeMemberRealtime = null;
    }
  },

  async fetchSummary(options = {}) {
    if (this.fetchingSummary) {
      this.pendingFetchSummary = true;
      return;
    }
    this.fetchingSummary = true;
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const summary = await WalletService.summary();
      const normalizedSummary = decorateSummary(summary);
      this.setData({ summary: normalizedSummary, loading: false });
    } catch (error) {
      this.setData({ loading: false });
    }
    this.fetchingSummary = false;
    if (this.pendingFetchSummary) {
      this.pendingFetchSummary = false;
      this.fetchSummary({ showLoading: false });
    }
  },

  handleAmountInput(event) {
    if (!this.isCashierEnabled()) {
      return;
    }
    this.setData({ amount: Number(event.detail.value) || 0 });
  },

  handlePresetTap(event) {
    if (!this.isCashierEnabled()) {
      return;
    }
    const { value } = event.currentTarget.dataset;
    this.setData({ amount: value });
  },

  async handleRecharge() {
    if (!this.isCashierEnabled()) {
      wx.showToast({ title: '目前只支持收款台线下充值', icon: 'none' });
      return;
    }
    const amountYuan = Number(this.data.amount);
    if (!amountYuan || amountYuan < 1) {
      wx.showToast({ title: '请输入充值金额', icon: 'none' });
      return;
    }
    const amountInCents = Math.round(amountYuan * 100);
    if (!amountInCents || !Number.isFinite(amountInCents)) {
      wx.showToast({ title: '充值金额无效', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建订单', mask: true });
    try {
      const result = await WalletService.createRecharge(amountInCents);
      wx.hideLoading();
      if (result.payment && result.payment.paySign === 'MOCK_SIGN') {
        wx.showModal({
          title: '提示',
          content: '当前为示例支付参数，请在云函数 wallet 中接入真实微信支付后再发起充值。',
          showCancel: false
        });
        return;
      }
      const { transactionId } = result;
      wx.requestPayment({
        ...result.payment,
        success: async () => {
          try {
            await WalletService.completeRecharge(transactionId);
            wx.showToast({ title: '充值成功', icon: 'success' });
          } catch (error) {
            wx.showToast({ title: '充值状态更新失败', icon: 'none' });
          } finally {
            this.fetchSummary();
          }
        },
        fail: (error) => {
          const errMsg = error && error.errMsg ? error.errMsg : '';
          const isCancelled = errMsg.includes('cancel');
          wx.showToast({ title: isCancelled ? '支付已取消' : '支付未完成', icon: 'none' });
          (async () => {
            if (!transactionId) {
              this.fetchSummary({ showLoading: false });
              return;
            }
            try {
              await WalletService.failRecharge(transactionId, {
                reason: isCancelled ? '用户取消支付' : errMsg || '支付未完成'
              });
            } catch (failureError) {
              // ignore failRecharge errors in UI flow
            } finally {
              this.fetchSummary({ showLoading: false });
            }
          })();
        }
      });
    } catch (error) {
      wx.hideLoading();
    }
  },

  isCashierEnabled() {
    const { summary } = this.data;
    if (!summary || !summary.features) {
      return false;
    }
    return summary.features.cashierEnabled !== false;
  },

  async handleScanCharge() {
    try {
      const res = await wx.scanCode({ onlyFromCamera: true });
      const orderId = this.parseScanResult(res && res.result);
      if (!orderId) {
        wx.showToast({ title: '二维码无效', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: `/pages/wallet/charge-confirm/index?orderId=${orderId}` });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
    }
  },

  handleTransactionTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const orderIdRaw = dataset.orderId;
    if (!orderIdRaw) {
      return;
    }
    const orderId = typeof orderIdRaw === 'string' ? orderIdRaw.trim() : '';
    if (!orderId) {
      return;
    }
    wx.navigateTo({ url: `/pages/wallet/charge-confirm/index?orderId=${orderId}` });
  },

  parseScanResult(result) {
    if (!result || typeof result !== 'string') {
      return '';
    }
    const trimmed = result.trim();
    if (trimmed.startsWith('member-charge:')) {
      return trimmed.slice('member-charge:'.length);
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === 'member_charge' && parsed.orderId) {
        return parsed.orderId;
      }
    } catch (err) {
      // ignore
    }
    return '';
  },

  formatCurrency,
  formatDate
});
