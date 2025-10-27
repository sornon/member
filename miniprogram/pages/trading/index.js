import { TradingService } from '../../services/api';
import { formatStones } from '../../utils/format';

const LISTING_STATUS_LABELS = {
  active: '在售',
  sold: '已成交',
  cancelled: '已取消',
  expired: '已下架',
  settled: '已结算'
};

const BID_STATUS_LABELS = {
  active: '竞价中',
  won: '已赢得',
  settled: '已结算',
  refunded: '已退还',
  outbid: '已被超越'
};

function toNumeric(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  return fallback;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatRemainingTime(value) {
  if (!value) {
    return '未知';
  }
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) {
    return '未知';
  }
  const diff = target.getTime() - Date.now();
  if (diff <= 0) {
    return '已结束';
  }
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours >= 72) {
    const days = Math.floor(hours / 24);
    return `${days} 天`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${remainMinutes} 分`;
  }
  if (remainMinutes > 0) {
    return `${remainMinutes} 分`;
  }
  const seconds = Math.max(Math.floor(diff / 1000), 1);
  return `${seconds} 秒`;
}

function buildListingDisplay(listing, config) {
  if (!listing || typeof listing !== 'object') {
    return null;
  }
  const item = listing.item || {};
  const refine = Number.isFinite(item.refine) ? item.refine : 0;
  const name = item.itemId ? `${item.itemId}${refine ? ` · 强化 +${refine}` : ''}` : listing.id;
  const price = listing.currentPrice || listing.fixedPrice || listing.startPrice || 0;
  const displayPrice = `${price} 灵石`;
  const remaining = formatRemainingTime(listing.expiresAt);
  const statusLabel = LISTING_STATUS_LABELS[listing.status] || '未知状态';
  const minIncrementRate = config && Number.isFinite(config.minBidIncrementRate)
    ? config.minBidIncrementRate
    : 0.05;
  const basePrice = listing.currentPrice || listing.startPrice || listing.fixedPrice || 0;
  const minBid = listing.saleMode === 'auction'
    ? Math.max(basePrice + Math.ceil(basePrice * minIncrementRate), basePrice + 1)
    : basePrice;
  return {
    ...listing,
    displayName: name,
    displayPrice,
    displayRemaining: remaining,
    statusLabel,
    minBidHint: `${minBid} 灵石`
  };
}

function buildBidDisplay(bid) {
  if (!bid || typeof bid !== 'object') {
    return null;
  }
  const statusLabel = BID_STATUS_LABELS[bid.status] || '已记录';
  return {
    ...bid,
    statusLabel,
    displayTime: formatDateTime(bid.createdAt)
  };
}

Page({
  data: {
    loading: false,
    error: '',
    activeTab: 'market',
    balanceText: '0',
    summary: {
      balance: 0,
      listings: [],
      myListings: [],
      myBids: [],
      metrics: {
        totalVolume: 0,
        totalFee: 0,
        totalOrders: 0
      },
      config: {
        minDurationHours: 24,
        maxDurationHours: 168,
        minBidIncrementRate: 0.05
      }
    },
    showPublish: false,
    publishSubmitting: false,
    sellableLoading: false,
    sellableItems: [],
    publishForm: {
      inventoryId: '',
      inventoryLabel: '',
      inventoryIndex: 0,
      saleMode: 'fixed',
      fixedPrice: '',
      startPrice: '',
      bidIncrement: '',
      buyoutPrice: '',
      durationHours: 72
    },
    showDetail: false,
    detailListing: null,
    bidAmount: '',
    actionLoading: false
  },

  onLoad() {
    this.fetchDashboard();
  },

  onPullDownRefresh() {
    this.handleRefresh();
  },

  async handleRefresh() {
    this.setData({ loading: true, error: '' });
    try {
      await this.fetchDashboard();
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh({});
    }
  },

  async fetchDashboard() {
    this.setData({ loading: true, error: '' });
    try {
      const payload = await TradingService.dashboard();
      const config = payload && payload.config ? payload.config : this.data.summary.config;
      const listings = Array.isArray(payload && payload.listings)
        ? payload.listings.map((item) => buildListingDisplay(item, config)).filter(Boolean)
        : [];
      const myListings = Array.isArray(payload && payload.myListings)
        ? payload.myListings.map((item) => buildListingDisplay(item, config)).filter(Boolean)
        : [];
      const myBids = Array.isArray(payload && payload.myBids)
        ? payload.myBids.map((bid) => buildBidDisplay(bid)).filter(Boolean)
        : [];
      const metrics = payload && payload.metrics ? payload.metrics : {};
      const balance = payload && Number.isFinite(payload.balance) ? payload.balance : 0;
      this.setData({
        summary: {
          balance,
          listings,
          myListings,
          myBids,
          metrics: {
            totalVolume: metrics.totalVolume || 0,
            totalFee: metrics.totalFee || 0,
            totalOrders: metrics.totalOrders || 0,
            updatedAt: metrics.updatedAt || null
          },
          config
        },
        balanceText: formatStones(balance),
        'publishForm.durationHours': config && Number.isFinite(config.minDurationHours)
          ? config.minDurationHours
          : this.data.publishForm.durationHours
      });
    } catch (error) {
      console.error('[trading] fetch dashboard failed', error);
      this.setData({ error: error && error.errMsg ? error.errMsg : '加载失败，请稍后再试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleTabChange(event) {
    const tab = event.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) {
      return;
    }
    this.setData({ activeTab: tab });
  },

  async handlePublishTap() {
    this.setData({
      showPublish: true,
      sellableLoading: true,
      publishForm: {
        ...this.data.publishForm,
        inventoryId: '',
        inventoryLabel: '',
        inventoryIndex: 0
      }
    });
    try {
      const res = await TradingService.sellable();
      const items = Array.isArray(res && res.items) ? res.items : [];
      const sellableItems = items.map((item, index) => {
        const refine = Number.isFinite(item.refine) ? item.refine : 0;
        const label = item.itemId
          ? `${item.itemId}${refine ? ` · 强化 +${refine}` : ''}`
          : `装备 ${index + 1}`;
        return {
          ...item,
          label,
          value: item.inventoryId || ''
        };
      });
      this.setData({ sellableItems, sellableLoading: false });
      if (!sellableItems.length) {
        wx.showToast({ title: '暂无可上架装备', icon: 'none' });
      }
    } catch (error) {
      console.error('[trading] load sellable failed', error);
      this.setData({ sellableLoading: false });
      wx.showToast({ title: error && error.errMsg ? error.errMsg : '加载纳戒失败', icon: 'none' });
    }
  },

  handlePublishClose() {
    this.setData({ showPublish: false, publishSubmitting: false, sellableLoading: false });
  },

  handleInventoryChange(event) {
    const index = toNumeric(event && event.detail && event.detail.value, 0);
    const item = this.data.sellableItems[index];
    if (!item) {
      return;
    }
    this.setData({
      'publishForm.inventoryIndex': index,
      'publishForm.inventoryId': item.inventoryId,
      'publishForm.inventoryLabel': item.label
    });
  },

  handleSaleModeChange(event) {
    const value = event && event.detail && event.detail.value;
    if (!value) {
      return;
    }
    this.setData({
      'publishForm.saleMode': value,
      'publishForm.fixedPrice': value === 'fixed' ? this.data.publishForm.fixedPrice : '',
      'publishForm.startPrice': value === 'auction' ? this.data.publishForm.startPrice : '',
      'publishForm.bidIncrement': value === 'auction' ? this.data.publishForm.bidIncrement : '',
      'publishForm.buyoutPrice': this.data.publishForm.buyoutPrice
    });
  },

  handleFixedPriceInput(event) {
    this.setData({ 'publishForm.fixedPrice': event.detail.value });
  },

  handleStartPriceInput(event) {
    this.setData({ 'publishForm.startPrice': event.detail.value });
  },

  handleBidIncrementInput(event) {
    this.setData({ 'publishForm.bidIncrement': event.detail.value });
  },

  handleBuyoutPriceInput(event) {
    this.setData({ 'publishForm.buyoutPrice': event.detail.value });
  },

  handleDurationInput(event) {
    this.setData({ 'publishForm.durationHours': event.detail.value });
  },

  async handlePublishSubmit() {
    if (this.data.publishSubmitting) {
      return;
    }
    const form = this.data.publishForm;
    if (!form.inventoryId) {
      wx.showToast({ title: '请先选择装备', icon: 'none' });
      return;
    }
    const payload = {
      inventoryId: form.inventoryId,
      saleMode: form.saleMode,
      durationHours: toNumeric(form.durationHours, this.data.summary.config.minDurationHours)
    };
    const minHours = this.data.summary.config.minDurationHours || 24;
    const maxHours = this.data.summary.config.maxDurationHours || 168;
    payload.durationHours = Math.max(minHours, Math.min(maxHours, payload.durationHours));
    if (form.saleMode === 'fixed') {
      const price = toNumeric(form.fixedPrice, 0);
      if (price <= 0) {
        wx.showToast({ title: '请输入有效的一口价', icon: 'none' });
        return;
      }
      payload.fixedPrice = price;
    } else {
      const startPrice = toNumeric(form.startPrice, 0);
      if (startPrice <= 0) {
        wx.showToast({ title: '请输入起拍价', icon: 'none' });
        return;
      }
      payload.startPrice = startPrice;
      const bidIncrement = toNumeric(form.bidIncrement, 0);
      if (bidIncrement > 0) {
        payload.bidIncrement = bidIncrement;
      }
      const buyoutPrice = toNumeric(form.buyoutPrice, 0);
      if (buyoutPrice > 0) {
        payload.buyoutPrice = buyoutPrice;
      }
    }
    this.setData({ publishSubmitting: true });
    try {
      await TradingService.createListing(payload);
      wx.showToast({ title: '上架成功', icon: 'success' });
      this.setData({ showPublish: false, publishSubmitting: false });
      await this.fetchDashboard();
    } catch (error) {
      console.error('[trading] create listing failed', error);
      wx.showToast({ title: error && error.errMsg ? error.errMsg : '上架失败', icon: 'none' });
      this.setData({ publishSubmitting: false });
    }
  },

  handleListingTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    const allListings = [...this.data.summary.listings, ...this.data.summary.myListings];
    const target = allListings.find((item) => item.id === id);
    if (!target) {
      return;
    }
    const detailListing = { ...target };
    detailListing.displayName = detailListing.displayName || target.displayName;
    detailListing.minBidHint = detailListing.minBidHint || `${detailListing.currentPrice || detailListing.startPrice} 灵石`;
    this.setData({ detailListing, showDetail: true, bidAmount: '' });
  },

  handleDetailClose() {
    this.setData({ showDetail: false, detailListing: null, actionLoading: false, bidAmount: '' });
  },

  handleBidAmountInput(event) {
    this.setData({ bidAmount: event.detail.value });
  },

  async handleBuyNow(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.actionLoading) {
      return;
    }
    this.setData({ actionLoading: true });
    try {
      await TradingService.buyNow(id);
      wx.showToast({ title: '购买成功', icon: 'success' });
      this.setData({ showDetail: false, actionLoading: false });
      await this.fetchDashboard();
    } catch (error) {
      console.error('[trading] buy now failed', error);
      this.setData({ actionLoading: false });
      wx.showToast({ title: error && error.errMsg ? error.errMsg : '购买失败', icon: 'none' });
    }
  },

  async handleSubmitBid(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.actionLoading) {
      return;
    }
    const amount = toNumeric(this.data.bidAmount, 0);
    if (amount <= 0) {
      wx.showToast({ title: '请输入有效出价', icon: 'none' });
      return;
    }
    this.setData({ actionLoading: true });
    try {
      await TradingService.placeBid({ listingId: id, amount });
      wx.showToast({ title: '出价成功', icon: 'success' });
      this.setData({ showDetail: false, actionLoading: false, bidAmount: '' });
      await this.fetchDashboard();
    } catch (error) {
      console.error('[trading] place bid failed', error);
      this.setData({ actionLoading: false });
      wx.showToast({ title: error && error.errMsg ? error.errMsg : '出价失败', icon: 'none' });
    }
  },

  async handleCancelListing(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.actionLoading) {
      return;
    }
    this.setData({ actionLoading: true });
    try {
      await TradingService.cancelListing(id);
      wx.showToast({ title: '挂单已取消', icon: 'success' });
      this.setData({ showDetail: false, actionLoading: false });
      await this.fetchDashboard();
    } catch (error) {
      console.error('[trading] cancel listing failed', error);
      this.setData({ actionLoading: false });
      wx.showToast({ title: error && error.errMsg ? error.errMsg : '取消失败', icon: 'none' });
    }
  },

  noop() {}
});
