import { StoneService } from '../../services/api';
import { formatStones } from '../../utils/format';

Page({
  data: {
    loading: true,
    items: [],
    stoneBalance: 0,
    stoneBalanceText: '0',
    submittingId: '',
    error: ''
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    this.setData({ loading: true, error: '' });
    try {
      const [catalog, summary] = await Promise.all([
        StoneService.catalog(),
        StoneService.summary()
      ]);
      const items = Array.isArray(catalog && catalog.items)
        ? catalog.items.map((item) => ({
            ...item,
            price: Math.max(0, Math.floor(Number(item.price) || 0)),
            icon: item.icon || '🛒',
            description: item.description || '',
            effectLabel: item.effectLabel || ''
          }))
        : [];
      this.applySummary(summary);
      this.setData({
        items,
        loading: false
      });
    } catch (error) {
      console.error('[mall] bootstrap failed', error);
      this.setData({
        error: '商城暂时不可用，请稍后再试',
        loading: false
      });
    }
  },

  async handlePurchase(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.submittingId) {
      return;
    }
    const item = this.data.items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.setData({ submittingId: id });
    try {
      const result = await StoneService.purchase(id, 1);
      if (result && result.summary) {
        this.applySummary(result.summary);
      } else {
        const nextBalance = Math.max(this.data.stoneBalance - item.price, 0);
        this.applySummary({ balance: nextBalance, stoneBalance: nextBalance });
      }
      wx.showToast({ title: '兑换成功', icon: 'success' });
    } catch (error) {
      console.error('[mall] purchase failed', error);
      // 错误提示在 callCloud 中已处理，此处仅保持状态同步。
    } finally {
      this.setData({ submittingId: '' });
    }
  },

  applySummary(summary) {
    if (!summary || typeof summary !== 'object') {
      return;
    }
    const balance = Number(summary.balance ?? summary.stoneBalance ?? this.data.stoneBalance);
    if (!Number.isFinite(balance)) {
      return;
    }
    const normalized = Math.max(0, Math.floor(balance));
    this.setData({
      stoneBalance: normalized,
      stoneBalanceText: formatStones(normalized)
    });
  }
});
