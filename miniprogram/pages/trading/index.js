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

function sanitizeEquipmentDetailSnapshot(detail) {
  if (!detail || typeof detail !== 'object') {
    return {};
  }
  const sanitized = {};
  const assignString = (targetKey, sourceKeys) => {
    const keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];
    for (let index = 0; index < keys.length; index += 1) {
      const value = detail[keys[index]];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          sanitized[targetKey] = trimmed;
          return;
        }
      }
    }
  };

  assignString('displayName', ['displayName', 'label', 'name', 'cnName', 'itemName']);
  if (sanitized.displayName) {
    sanitized.label = sanitized.displayName;
  } else {
    assignString('label', 'label');
  }
  assignString('shortName', 'shortName');
  assignString('iconUrl', 'iconUrl');
  assignString('iconFallbackUrl', ['iconFallbackUrl', 'fallbackIconUrl']);
  assignString('slot', 'slot');
  assignString('slotLabel', 'slotLabel');
  assignString('quality', 'quality');
  assignString('qualityLabel', 'qualityLabel');
  assignString('qualityColor', 'qualityColor');
  assignString('refineLabel', 'refineLabel');
  assignString('setName', 'setName');
  assignString('description', ['detailDescription', 'description']);
  if (sanitized.description) {
    sanitized.detailDescription = sanitized.description;
  }
  assignString('obtainedAtText', 'obtainedAtText');
  assignString('setId', 'setId');
  assignString('iconId', 'iconId');

  const assignNumeric = (targetKey, sourceKeys, options = {}) => {
    const keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];
    for (let index = 0; index < keys.length; index += 1) {
      const number = Number(detail[keys[index]]);
      if (!Number.isFinite(number)) {
        continue;
      }
      let numeric = number;
      if (typeof options.min === 'number') {
        numeric = Math.max(options.min, numeric);
      }
      if (options.round === 'floor') {
        numeric = Math.floor(numeric);
      } else if (options.round === 'ceil') {
        numeric = Math.ceil(numeric);
      }
      sanitized[targetKey] = numeric;
      return;
    }
  };

  assignNumeric('refine', 'refine', { min: 0, round: 'floor' });
  assignNumeric('level', 'level', { min: 1, round: 'floor' });
  assignNumeric('qualityRank', 'qualityRank', { min: 0, round: 'floor' });

  if (detail.obtainedAt instanceof Date) {
    sanitized.obtainedAt = detail.obtainedAt;
  } else if (typeof detail.obtainedAt === 'string' && detail.obtainedAt.trim()) {
    sanitized.obtainedAt = detail.obtainedAt.trim();
  }

  const detailSummary = normalizeDisplayLines(
    Array.isArray(detail.detailSummary) ? detail.detailSummary : detail.summary
  );
  if (detailSummary.length) {
    sanitized.detailSummary = detailSummary;
  }

  const statsText = normalizeDisplayLines(
    Array.isArray(detail.detailStats)
      ? detail.detailStats
      : Array.isArray(detail.statsText)
      ? detail.statsText
      : []
  );
  if (statsText.length) {
    sanitized.detailStats = statsText;
    sanitized.statsText = statsText;
  }

  const notes = normalizeDisplayLines(
    Array.isArray(detail.detailNotes)
      ? detail.detailNotes
      : Array.isArray(detail.notes)
      ? detail.notes
      : []
  );
  if (notes.length) {
    sanitized.detailNotes = notes;
    sanitized.notes = notes;
  }

  const uniqueEffects = normalizeDisplayLines(
    Array.isArray(detail.uniqueEffects)
      ? detail.uniqueEffects.map((entry) => {
          if (!entry) {
            return '';
          }
          if (typeof entry === 'string') {
            return entry;
          }
          if (typeof entry.description === 'string') {
            return entry.description;
          }
          return '';
        })
      : []
  );
  if (uniqueEffects.length) {
    sanitized.uniqueEffects = uniqueEffects;
  }

  return sanitized;
}

function mergeEquipmentDetailSnapshot(base, detail) {
  const target = base && typeof base === 'object' ? { ...base } : {};
  const normalized = sanitizeEquipmentDetailSnapshot(detail);
  if (!Object.keys(normalized).length) {
    return target;
  }
  const mergedDetail = { ...(target.detail || {}), ...normalized };
  target.detail = mergedDetail;
  Object.keys(normalized).forEach((key) => {
    const value = normalized[key];
    if (typeof value === 'undefined') {
      return;
    }
    if (Array.isArray(value) && !value.length) {
      return;
    }
    if (value === null || value === '') {
      return;
    }
    target[key] = value;
  });
  return target;
}

function extractEquipmentDetailSnapshot(item) {
  const snapshot = sanitizeEquipmentDetailSnapshot(item);
  return Object.keys(snapshot).length ? snapshot : null;
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

function hasLookupEntries(lookup) {
  return !!(lookup && typeof lookup === 'object' && Object.keys(lookup).length);
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

function buildEquipmentDisplayModel(baseItem, detail = null, options = {}) {
  if (!baseItem || typeof baseItem !== 'object') {
    return null;
  }
  const fallbackName =
    typeof options.fallbackName === 'string' && options.fallbackName.trim()
      ? options.fallbackName.trim()
      : '神秘装备';
  const shortNameLimit = Number.isFinite(options.shortNameLimit)
    ? Math.max(3, Math.floor(options.shortNameLimit))
    : 6;
  const detailItem = detail && typeof detail === 'object' ? detail : null;
  const inventoryIdRaw =
    typeof baseItem.inventoryId === 'string'
      ? baseItem.inventoryId
      : baseItem.inventoryId !== undefined && baseItem.inventoryId !== null
      ? String(baseItem.inventoryId)
      : '';
  const inventoryId = inventoryIdRaw.trim();
  const refineValue =
    detailItem && typeof detailItem.refine === 'number' ? detailItem.refine : Number(baseItem.refine);
  const refine = Number.isFinite(refineValue) ? Math.max(0, Math.trunc(refineValue)) : 0;
  const levelValue =
    detailItem && typeof detailItem.level === 'number' ? detailItem.level : Number(baseItem.level);
  const level = Number.isFinite(levelValue) && levelValue > 0 ? Math.trunc(levelValue) : null;
  const slotLabel =
    (detailItem && typeof detailItem.slotLabel === 'string' && detailItem.slotLabel.trim()) ||
    (typeof baseItem.slotLabel === 'string' && baseItem.slotLabel.trim()) ||
    '';
  const qualityKey =
    detailItem && typeof detailItem.quality === 'string'
      ? detailItem.quality
      : typeof baseItem.quality === 'string'
      ? baseItem.quality
      : 'mortal';
  const qualityMeta = EQUIPMENT_QUALITY_META[qualityKey] || EQUIPMENT_QUALITY_META.mortal;
  let iconUrl = detailItem && typeof detailItem.iconUrl === 'string' ? detailItem.iconUrl : '';
  let iconFallbackUrl =
    detailItem && typeof detailItem.iconFallbackUrl === 'string' ? detailItem.iconFallbackUrl : '';
  if (!iconUrl || !iconFallbackUrl) {
    const iconSource = detailItem || baseItem;
    const iconPaths = buildEquipmentIconPaths(iconSource);
    iconUrl = iconUrl || iconPaths.iconUrl;
    iconFallbackUrl = iconFallbackUrl || iconPaths.iconFallbackUrl;
  }
  const baseName = resolveEquipmentName(detailItem || baseItem, fallbackName);
  const shortSource =
    (detailItem && typeof detailItem.shortName === 'string' && detailItem.shortName.trim()) ||
    (typeof baseItem.shortName === 'string' && baseItem.shortName.trim()) ||
    '';
  const shortName = shortSource
    ? shortSource
    : baseName.length > shortNameLimit
    ? `${baseName.slice(0, shortNameLimit - 1)}…`
    : baseName;
  const obtainedAt = (detailItem && detailItem.obtainedAt) || baseItem.obtainedAt || null;
  const obtainedAtText =
    (detailItem && typeof detailItem.obtainedAtText === 'string' && detailItem.obtainedAtText) ||
    (obtainedAt ? formatDateTime(obtainedAt) : '');
  const refineLabel =
    (detailItem && typeof detailItem.refineLabel === 'string' && detailItem.refineLabel.trim()) ||
    (refine > 0 ? `精炼 +${refine}` : '未精炼');
  const setName =
    (detailItem && typeof detailItem.setName === 'string' && detailItem.setName.trim()) || '';
  const statsSource =
    detailItem && Array.isArray(detailItem.detailStats)
      ? detailItem.detailStats
      : detailItem && Array.isArray(detailItem.statsText)
      ? detailItem.statsText
      : Array.isArray(baseItem.detailStats)
      ? baseItem.detailStats
      : Array.isArray(baseItem.statsText)
      ? baseItem.statsText
      : [];
  const detailStats = normalizeDisplayLines(statsSource);
  const notesSource =
    detailItem && Array.isArray(detailItem.detailNotes)
      ? detailItem.detailNotes
      : detailItem && Array.isArray(detailItem.notes)
      ? detailItem.notes
      : Array.isArray(baseItem.detailNotes)
      ? baseItem.detailNotes
      : Array.isArray(baseItem.notes)
      ? baseItem.notes
      : [];
  const detailNotes = normalizeDisplayLines(notesSource);
  const effectsSource =
    detailItem && Array.isArray(detailItem.uniqueEffects)
      ? detailItem.uniqueEffects
      : Array.isArray(baseItem.uniqueEffects)
      ? baseItem.uniqueEffects
      : [];
  const detailUniqueEffects = normalizeDisplayLines(
    effectsSource.map((entry) => {
      if (!entry) {
        return '';
      }
      if (typeof entry === 'string') {
        return entry;
      }
      if (typeof entry.description === 'string') {
        return entry.description;
      }
      return '';
    })
  );
  const detailDescription =
    (detailItem && typeof detailItem.description === 'string' && detailItem.description.trim()) ||
    (detailItem && typeof detailItem.detailDescription === 'string' && detailItem.detailDescription.trim()) ||
    '';
  const summaryParts = normalizeDisplayLines([
    slotLabel ? `槽位：${slotLabel}` : '',
    level ? `等级 ${level}` : '',
    refineLabel,
    setName ? `套装：${setName}` : ''
  ]);
  const detailSummary = summaryParts.length ? summaryParts : [qualityMeta.label];
  return {
    inventoryId,
    displayName: baseName,
    shortName,
    refine,
    level,
    slotLabel,
    quality: qualityKey,
    qualityLabel:
      (detailItem && typeof detailItem.qualityLabel === 'string' && detailItem.qualityLabel.trim()) ||
      (typeof baseItem.qualityLabel === 'string' && baseItem.qualityLabel.trim()) ||
      qualityMeta.label,
    qualityColor:
      (detailItem && typeof detailItem.qualityColor === 'string' && detailItem.qualityColor) ||
      baseItem.qualityColor ||
      qualityMeta.color,
    iconUrl: iconUrl || baseItem.iconUrl || '',
    iconFallbackUrl: iconFallbackUrl || baseItem.iconFallbackUrl || '',
    obtainedAt: obtainedAt || null,
    obtainedAtText,
    refineLabel,
    setName,
    detailSummary,
    detailStats,
    detailNotes,
    detailUniqueEffects,
    detailDescription,
    detail: detailItem || baseItem.detail || null
  };
}

function buildListingDisplay(listing, config, detailLookup = null) {
  if (!listing || typeof listing !== 'object') {
    return null;
  }
  const rawItem = listing.item && typeof listing.item === 'object' ? listing.item : {};
  const inventoryId =
    typeof rawItem.inventoryId === 'string'
      ? rawItem.inventoryId.trim()
      : rawItem.inventoryId !== undefined && rawItem.inventoryId !== null
      ? String(rawItem.inventoryId).trim()
      : '';
  const lookupDetail =
    inventoryId && detailLookup && typeof detailLookup === 'object' ? detailLookup[inventoryId] : null;
  const detailSource = lookupDetail || (rawItem && typeof rawItem.detail === 'object' ? rawItem.detail : null);
  const item = mergeEquipmentDetailSnapshot({ ...rawItem }, detailSource);
  const equipment = buildEquipmentDisplayModel(item, detailSource || (item && item.detail) || null, {
    fallbackName: '神秘装备',
    shortNameLimit: 6
  });
  const displayItem = equipment ? { ...item, ...equipment } : item;
  if (displayItem && typeof displayItem === 'object') {
    displayItem.displayName = equipment ? equipment.displayName : displayItem.displayName || displayItem.label;
    displayItem.label = displayItem.displayName || displayItem.label;
  }
  const cardTitle = equipment
    ? equipment.refine > 0
      ? `${equipment.displayName} · 强化 +${equipment.refine}`
      : equipment.displayName
    : resolveEquipmentName(item, '神秘装备');
  if (displayItem) {
    displayItem.displayTitle = cardTitle;
  }
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
    displayName: cardTitle,
    displayPrice,
    displayRemaining: remaining,
    statusLabel,
    minBidHint: `${minBid} 灵石`,
    item: displayItem,
    equipment
  };
}

function buildSellableItemDisplay(item, index = 0, detail = null) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const equipment = buildEquipmentDisplayModel(item, detail, {
    fallbackName: `装备 ${index + 1}`,
    shortNameLimit: 6
  });
  if (!equipment || !equipment.inventoryId) {
    return null;
  }
  return {
    ...item,
    inventoryId: equipment.inventoryId,
    refine: equipment.refine,
    level: equipment.level,
    label: equipment.displayName,
    displayName: equipment.displayName,
    shortName: equipment.shortName,
    iconUrl: equipment.iconUrl,
    iconFallbackUrl: equipment.iconFallbackUrl,
    qualityColor: equipment.qualityColor,
    qualityLabel: equipment.qualityLabel,
    obtainedAtText: equipment.obtainedAtText,
    slotLabel: equipment.slotLabel,
    refineLabel: equipment.refineLabel,
    detailSummary: equipment.detailSummary,
    detailStats: equipment.detailStats,
    detailNotes: equipment.detailNotes,
    detailUniqueEffects: equipment.detailUniqueEffects,
    detailDescription: equipment.detailDescription,
    detail: equipment.detail,
    inventoryIndex: index
  };
}

function buildBidDisplay(bid, config, detailLookup = null) {
  if (!bid || typeof bid !== 'object') {
    return null;
  }
  const statusLabel = BID_STATUS_LABELS[bid.status] || '已记录';
  const listingData = bid.listing && typeof bid.listing === 'object' ? bid.listing : null;
  const listingDisplay = listingData ? buildListingDisplay(listingData, config, detailLookup) : null;
  const listing = listingDisplay || listingData || null;
  const listingName =
    (listingDisplay && listingDisplay.displayName) ||
    resolveEquipmentName(listingData ? listingData.item : null, `挂单 ${bid.listingId || ''}`);
  const saleModeLabel = listing
    ? listing.saleMode === 'fixed'
      ? '一口价'
      : '拍卖'
    : '';
  const currentPrice = listing && Number.isFinite(listing.currentPrice)
    ? listing.currentPrice
    : listing && Number.isFinite(listing.fixedPrice)
    ? listing.fixedPrice
    : listing && Number.isFinite(listing.startPrice)
    ? listing.startPrice
    : null;
  const currentPriceText = Number.isFinite(currentPrice) ? `${currentPrice} 灵石` : '';
  return {
    ...bid,
    statusLabel,
    displayTime: formatDateTime(bid.createdAt),
    listing,
    listingName,
    saleModeLabel,
    currentPriceText,
    item: listing && listing.item ? listing.item : null
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
    equipmentDetailLookup: {},
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

  ensureEquipmentLookup(forceRefresh = false) {
    if (!forceRefresh) {
      if (hasLookupEntries(this.data && this.data.equipmentDetailLookup)) {
        this._equipmentLookup = this.data.equipmentDetailLookup;
        return Promise.resolve(this.data.equipmentDetailLookup);
      }
      if (hasLookupEntries(this._equipmentLookup)) {
        return Promise.resolve(this._equipmentLookup);
      }
      if (this._equipmentLookupPromise) {
        return this._equipmentLookupPromise;
      }
    } else if (this._equipmentLookupPromise) {
      return this._equipmentLookupPromise;
    }

    const request = PveService.profile()
      .then((profile) => {
        const lookup = buildEquipmentDetailLookup(profile || null);
        this._equipmentLookup = lookup;
        this.setData({ equipmentDetailLookup: lookup });
        return lookup;
      })
      .catch((error) => {
        console.warn('[trading] ensure equipment lookup failed', error);
        const empty = {};
        this._equipmentLookup = empty;
        this.setData({ equipmentDetailLookup: empty });
        return empty;
      })
      .finally(() => {
        if (this._equipmentLookupPromise === request) {
          this._equipmentLookupPromise = null;
        }
      });

    this._equipmentLookupPromise = request;
    return request;
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
      const [payload, equipmentLookup] = await Promise.all([
        TradingService.dashboard(),
        this.ensureEquipmentLookup(false)
      ]);
      const lookup = equipmentLookup && typeof equipmentLookup === 'object' ? equipmentLookup : {};
      const config = payload && payload.config ? payload.config : this.data.summary.config;
      const listings = Array.isArray(payload && payload.listings)
        ? payload.listings.map((item) => buildListingDisplay(item, config, lookup)).filter(Boolean)
        : [];
      const myListings = Array.isArray(payload && payload.myListings)
        ? payload.myListings.map((item) => buildListingDisplay(item, config, lookup)).filter(Boolean)
        : [];
      const myBids = Array.isArray(payload && payload.myBids)
        ? payload.myBids.map((bid) => buildBidDisplay(bid, config, lookup)).filter(Boolean)
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
      const [sellableRes, equipmentLookup] = await Promise.all([
        TradingService.sellable(),
        this.ensureEquipmentLookup(true)
      ]);
      const detailLookup = equipmentLookup && typeof equipmentLookup === 'object' ? equipmentLookup : {};
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

  handleSummaryIconError(event) {
    const dataset = (event && event.target && event.target.dataset) || {};
    const fallback = dataset.fallback;
    if (!fallback) {
      return;
    }
    const scope = dataset.scope || '';
    const index = toNumeric(dataset.index, -1);
    if (index < 0) {
      return;
    }
    let list;
    let basePath;
    if (scope === 'market') {
      list = this.data.summary && Array.isArray(this.data.summary.listings) ? this.data.summary.listings : [];
      basePath = `summary.listings[${index}]`;
    } else if (scope === 'myListings') {
      list = this.data.summary && Array.isArray(this.data.summary.myListings) ? this.data.summary.myListings : [];
      basePath = `summary.myListings[${index}]`;
    } else if (scope === 'myBids') {
      list = this.data.summary && Array.isArray(this.data.summary.myBids) ? this.data.summary.myBids : [];
      basePath = `summary.myBids[${index}]`;
    } else {
      return;
    }
    if (!Array.isArray(list) || !list[index]) {
      return;
    }
    const updates = {};
    updates[`${basePath}.item.iconUrl`] = fallback;
    updates[`${basePath}.item.iconFallbackUrl`] = fallback;
    const target = list[index];
    if (target && target.equipment) {
      updates[`${basePath}.equipment.iconUrl`] = fallback;
      updates[`${basePath}.equipment.iconFallbackUrl`] = fallback;
    }
    if (scope === 'myBids' && target && target.listing && target.listing.item) {
      updates[`${basePath}.listing.item.iconUrl`] = fallback;
      updates[`${basePath}.listing.item.iconFallbackUrl`] = fallback;
    }
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
    const selectedItem = this.data.selectedSellableItem;
    if (selectedItem) {
      const detailSnapshot = extractEquipmentDetailSnapshot(selectedItem);
      if (detailSnapshot) {
        payload.inventoryDetail = detailSnapshot;
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
