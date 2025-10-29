import { TradingService, PveService } from '../../services/api';
import { formatStones } from '../../utils/format';
import { sanitizeEquipmentProfile, buildEquipmentIconPaths } from '../../utils/equipment';

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

const EQUIPMENT_QUALITY_META = {
  mortal: { label: '凡品', color: '#8d9099' },
  inferior: { label: '下品', color: '#63a86c' },
  standard: { label: '中品', color: '#3c9bd4' },
  superior: { label: '上品', color: '#7f6bff' },
  excellent: { label: '极品', color: '#ff985a' },
  immortal: { label: '仙品', color: '#f05d7d' },
  perfect: { label: '完美', color: '#d4a93c' },
  primordial: { label: '先天', color: '#f7baff' },
  relic: { label: '至宝', color: '#6cf4ff' }
};

function resolveEquipmentName(source, fallback = '') {
  if (!source || typeof source !== 'object') {
    return fallback;
  }
  const name =
    (typeof source.displayName === 'string' && source.displayName.trim()) ||
    (typeof source.cnName === 'string' && source.cnName.trim()) ||
    (typeof source.name === 'string' && source.name.trim()) ||
    (typeof source.itemName === 'string' && source.itemName.trim()) ||
    (typeof source.label === 'string' && source.label.trim()) ||
    '';
  if (name) {
    return name;
  }
  return fallback;
}

function normalizeDisplayLines(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const normalized = [];
  list.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  });
  return normalized;
}

function buildEquipmentDetailLookup(profile) {
  if (!profile || typeof profile !== 'object') {
    return {};
  }
  const sanitizedProfile = sanitizeEquipmentProfile(profile);
  const equipment = sanitizedProfile && sanitizedProfile.equipment ? sanitizedProfile.equipment : null;
  const inventory = equipment && Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const lookup = {};
  inventory.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const inventoryId = typeof entry.inventoryId === 'string' ? entry.inventoryId.trim() : '';
    if (!inventoryId) {
      return;
    }
    lookup[inventoryId] = entry;
  });
  return lookup;
}

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
  const baseName = resolveEquipmentName(item, '神秘装备');
  const name = `${baseName}${refine > 0 ? ` · 强化 +${refine}` : ''}`;
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

function buildSellableItemDisplay(item, index = 0, detail = null) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const inventoryIdRaw =
    typeof item.inventoryId === 'string'
      ? item.inventoryId
      : item.inventoryId !== undefined && item.inventoryId !== null
      ? String(item.inventoryId)
      : '';
  const inventoryId = inventoryIdRaw.trim();
  if (!inventoryId) {
    return null;
  }
  const detailItem = detail && typeof detail === 'object' ? detail : null;
  const refineValue = detailItem && typeof detailItem.refine === 'number' ? detailItem.refine : Number(item.refine);
  const refine = Number.isFinite(refineValue) ? Math.max(0, Math.trunc(refineValue)) : 0;
  const levelValue = detailItem && typeof detailItem.level === 'number' ? detailItem.level : Number(item.level);
  const level = Number.isFinite(levelValue) && levelValue > 0 ? Math.trunc(levelValue) : null;
  const slotLabel =
    (detailItem && typeof detailItem.slotLabel === 'string' && detailItem.slotLabel.trim()) ||
    (typeof item.slotLabel === 'string' && item.slotLabel.trim()) ||
    '';
  const qualityKey = detailItem && typeof detailItem.quality === 'string' ? detailItem.quality : typeof item.quality === 'string' ? item.quality : 'mortal';
  const qualityMeta = EQUIPMENT_QUALITY_META[qualityKey] || EQUIPMENT_QUALITY_META.mortal;
  let iconUrl = detailItem && typeof detailItem.iconUrl === 'string' ? detailItem.iconUrl : '';
  let iconFallbackUrl =
    detailItem && typeof detailItem.iconFallbackUrl === 'string' ? detailItem.iconFallbackUrl : '';
  if (!iconUrl || !iconFallbackUrl) {
    const iconSource = detailItem || item;
    const iconPaths = buildEquipmentIconPaths(iconSource);
    iconUrl = iconUrl || iconPaths.iconUrl;
    iconFallbackUrl = iconFallbackUrl || iconPaths.iconFallbackUrl;
  }
  const baseName = resolveEquipmentName(detailItem || item, `装备 ${index + 1}`);
  const displayName = baseName;
  const shortName =
    (typeof item.shortName === 'string' && item.shortName) ||
    (displayName.length > 6 ? `${displayName.slice(0, 5)}…` : displayName);
  const obtainedAt = (detailItem && detailItem.obtainedAt) || item.obtainedAt || null;
  const obtainedAtText =
    (detailItem && typeof detailItem.obtainedAtText === 'string' && detailItem.obtainedAtText) ||
    (obtainedAt ? formatDateTime(obtainedAt) : '');
  const refineLabel =
    (detailItem && typeof detailItem.refineLabel === 'string' && detailItem.refineLabel) ||
    (refine > 0 ? `精炼 +${refine}` : '未精炼');
  const setName =
    (detailItem && typeof detailItem.setName === 'string' && detailItem.setName.trim()) || '';
  const detailStats = normalizeDisplayLines(
    detailItem && Array.isArray(detailItem.statsText) ? detailItem.statsText : []
  );
  const detailNotes = normalizeDisplayLines(
    detailItem && Array.isArray(detailItem.notes) ? detailItem.notes : []
  );
  const detailDescription =
    (detailItem && typeof detailItem.description === 'string' && detailItem.description.trim()) || '';
  const summaryParts = normalizeDisplayLines([
    slotLabel ? `槽位：${slotLabel}` : '',
    level ? `等级 ${level}` : '',
    refineLabel,
    setName ? `套装：${setName}` : ''
  ]);
  return {
    ...item,
    inventoryId,
    refine,
    level,
    label: displayName,
    displayName,
    shortName,
    iconUrl: iconUrl || item.iconUrl || '',
    iconFallbackUrl: iconFallbackUrl || item.iconFallbackUrl || '',
    qualityColor:
      (detailItem && typeof detailItem.qualityColor === 'string' && detailItem.qualityColor) ||
      item.qualityColor ||
      qualityMeta.color,
    qualityLabel:
      (detailItem && typeof detailItem.qualityLabel === 'string' && detailItem.qualityLabel) ||
      item.qualityLabel ||
      qualityMeta.label,
    obtainedAtText,
    slotLabel,
    refineLabel,
    detailSummary: summaryParts.length ? summaryParts : [qualityMeta.label],
    detailStats,
    detailNotes,
    detailDescription,
    inventoryIndex: index
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
    publishStep: 'select',
    selectedSellableItem: null,
    publishForm: {
      inventoryId: '',
      inventoryLabel: '',
      saleMode: 'fixed',
      fixedPrice: '',
      startPrice: '',
      bidIncrement: '',
      buyoutPrice: '',
      durationHours: 72
    },
    showEquipmentDetail: false,
    equipmentDetailItem: null,
    equipmentDetailMode: 'select',
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
      const balance = payload && Number.isFinite(payload.balance) ? payload.balance : 0;
      this.setData({
        summary: {
          balance,
          listings,
          myListings,
          myBids,
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
      publishStep: 'select',
      selectedSellableItem: null,
      showEquipmentDetail: false,
      equipmentDetailItem: null,
      equipmentDetailMode: 'select',
      publishForm: {
        ...this.data.publishForm,
        inventoryId: '',
        inventoryLabel: '',
        saleMode: 'fixed',
        fixedPrice: '',
        startPrice: '',
        bidIncrement: '',
        buyoutPrice: ''
      }
    });
    try {
      const [sellableRes, profileRes] = await Promise.all([
        TradingService.sellable(),
        PveService.profile().catch((error) => {
          console.warn('[trading] load equipment profile failed', error);
          return null;
        })
      ]);
      const detailLookup = buildEquipmentDetailLookup(profileRes || null);
      const items = Array.isArray(sellableRes && sellableRes.items) ? sellableRes.items : [];
      const sellableItems = items
        .map((item, index) => {
          const inventoryId =
            item && typeof item.inventoryId === 'string' ? item.inventoryId.trim() : '';
          const detail = inventoryId ? detailLookup[inventoryId] : null;
          return buildSellableItemDisplay(item, index, detail);
        })
        .filter((entry) => !!entry);
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
    this.setData({
      showPublish: false,
      publishSubmitting: false,
      sellableLoading: false,
      publishStep: 'select',
      selectedSellableItem: null,
      showEquipmentDetail: false,
      equipmentDetailItem: null,
      equipmentDetailMode: 'select'
    });
  },

  handleSelectEquipmentTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const index = toNumeric(dataset.index, -1);
    const item = index >= 0 ? this.data.sellableItems[index] : null;
    if (!item) {
      return;
    }
    this.openEquipmentDetail(item, 'select');
  },

  openEquipmentDetail(item, mode = 'select') {
    if (!item) {
      return;
    }
    this.setData({
      showEquipmentDetail: true,
      equipmentDetailItem: { ...item },
      equipmentDetailMode: mode
    });
  },

  handleEquipmentDetailClose() {
    this.setData({ showEquipmentDetail: false, equipmentDetailItem: null });
  },

  handleEquipmentDetailConfirm() {
    const item = this.data.equipmentDetailItem;
    if (!item) {
      return;
    }
    const updates = {
      publishStep: 'form',
      selectedSellableItem: { ...item },
      showEquipmentDetail: false,
      equipmentDetailItem: null,
      equipmentDetailMode: 'select',
      'publishForm.inventoryId': item.inventoryId,
      'publishForm.inventoryLabel': item.displayName || item.label || '',
      'publishForm.saleMode': this.data.publishForm.saleMode || 'fixed'
    };
    this.setData(updates);
  },

  handleEquipmentDetailReselect() {
    this.setData({
      showEquipmentDetail: false,
      equipmentDetailItem: null,
      publishStep: 'select',
      selectedSellableItem: null,
      'publishForm.inventoryId': '',
      'publishForm.inventoryLabel': '',
      equipmentDetailMode: 'select'
    });
  },

  handleSelectedEquipmentTap() {
    const item = this.data.selectedSellableItem;
    if (!item) {
      return;
    }
    this.openEquipmentDetail(item, 'form');
  },

  handleSellableIconError(event) {
    const dataset = (event && event.target && event.target.dataset) || {};
    const fallback = dataset.fallback;
    if (!fallback) {
      return;
    }
    const mode = dataset.mode || '';
    if (mode === 'selected') {
      this.setData({ 'selectedSellableItem.iconUrl': fallback });
      return;
    }
    if (mode === 'detail') {
      this.setData({ 'equipmentDetailItem.iconUrl': fallback });
      return;
    }
    const index = toNumeric(dataset.index, -1);
    if (index < 0) {
      return;
    }
    const updates = {};
    updates[`sellableItems[${index}].iconUrl`] = fallback;
    this.setData(updates);
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
