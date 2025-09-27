import { WalletService } from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/format';

const presets = [200, 500, 1000, 2000, 5000];

Page({
  data: {
    loading: true,
    summary: null,
    amount: presets[0],
    presets
  },

  onShow() {
    this.fetchSummary();
  },

  async fetchSummary() {
    this.setData({ loading: true });
    try {
      const summary = await WalletService.summary();
      this.setData({ summary, loading: false });
    } catch (error) {
      this.setData({ loading: false });
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

  formatCurrency,
  formatDate,

  formatTxnAmount(amount) {
    const numeric = Number(amount || 0);
    if (!Number.isFinite(numeric) || numeric === 0) {
      return formatCurrency(0);
    }
    const prefix = numeric > 0 ? '+' : '-';
    return `${prefix}${formatCurrency(Math.abs(numeric))}`;
  }
});
