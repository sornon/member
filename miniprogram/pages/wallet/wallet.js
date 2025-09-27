import { WalletService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatCurrency, formatDate } from '../../utils/format';

const presets = [200, 500, 1000, 2000, 5000];

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

function formatTransactionAmount(amount) {
  const numeric = toNumeric(amount, 0);
  if (numeric === 0) {
    return formatCurrency(0);
  }
  const prefix = numeric > 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(numeric))}`;
}

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
      remark: '',
      createdAt: '',
      displayDate: ''
    };
  }

  const amount = toNumeric(txn.amount, 0);
  const amountClass = amount > 0 ? 'income' : amount < 0 ? 'expense' : '';

  return {
    ...txn,
    amount,
    amountText: formatTransactionAmount(amount),
    amountClass,
    createdAt: txn.createdAt,
    displayDate: formatDate(txn.createdAt)
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
      transactions: []
    };
  }

  const cashBalance = toNumeric(summary.cashBalance ?? summary.balance, 0);
  const balance = toNumeric(summary.balance ?? summary.cashBalance, cashBalance);
  const totalRecharge = toNumeric(summary.totalRecharge, 0);
  const totalSpend = toNumeric(summary.totalSpend, 0);
  const transactions = Array.isArray(summary.transactions)
    ? summary.transactions.map((txn) => decorateTransaction(txn))
    : [];

  return {
    ...summary,
    cashBalance,
    balance,
    totalRecharge,
    totalSpend,
    cashBalanceText: formatCurrency(cashBalance),
    totalRechargeText: formatCurrency(totalRecharge),
    totalSpendText: formatCurrency(totalSpend),
    transactions
  };
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
      if (!event || event.type !== 'memberChanged') {
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
    this.setData({ amount: Number(event.detail.value) || 0 });
  },

  handlePresetTap(event) {
    const { value } = event.currentTarget.dataset;
    this.setData({ amount: value });
  },

  async handleRecharge() {
    const amount = Number(this.data.amount);
    if (!amount || amount < 1) {
      wx.showToast({ title: '请输入充值金额', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建订单', mask: true });
    try {
      const result = await WalletService.createRecharge(amount * 100);
      wx.hideLoading();
      if (result.payment && result.payment.paySign === 'MOCK_SIGN') {
        wx.showModal({
          title: '提示',
          content: '当前为示例支付参数，请在云函数 wallet 中接入真实微信支付后再发起充值。',
          showCancel: false
        });
        return;
      }
      wx.requestPayment({
        ...result.payment,
        success: async () => {
          try {
            await WalletService.completeRecharge(result.transactionId);
            wx.showToast({ title: '充值成功', icon: 'success' });
          } catch (error) {
            wx.showToast({ title: '充值状态更新失败', icon: 'none' });
          } finally {
            this.fetchSummary();
          }
        },
        fail: () => {
          wx.showToast({ title: '支付已取消', icon: 'none' });
        }
      });
    } catch (error) {
      wx.hideLoading();
    }
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
