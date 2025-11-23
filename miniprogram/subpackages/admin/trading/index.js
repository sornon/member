import { AdminService } from '../../../services/api';
import { formatStones } from '../../../utils/format';

const SALE_MODE_LABELS = {
  fixed: '一口价',
  auction: '竞拍'
};

const SOURCE_LABELS = {
  auction: '竞拍结算',
  buyout: '一口价成交'
};

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatPercentDisplay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  const percent = numeric * 100;
  if (!Number.isFinite(percent)) {
    return '';
  }
  if (percent === 0) {
    return '0';
  }
  if (Math.abs(percent - Math.round(percent)) < 1e-6) {
    return `${Math.round(percent)}`;
  }
  return percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function parsePercentInput(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return NaN;
    }
    return value >= 1 ? value / 100 : value;
  }
  if (typeof value !== 'string') {
    return NaN;
  }
  const sanitized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!sanitized) {
    return NaN;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return numeric / 100;
}

function normalizeHoursInput(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return NaN;
    }
    return Math.max(1, Math.floor(value));
  }
  if (typeof value !== 'string') {
    return NaN;
  }
  const sanitized = value.replace(/[^0-9]/g, '');
  if (!sanitized) {
    return NaN;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return Math.max(1, Math.floor(numeric));
}

function buildRecordDisplay(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const price = Number(record.price);
  const fee = Number(record.fee);
  const netIncome = Number(record.netIncome);
  const resolvedPrice = Number.isFinite(price) ? price : 0;
  const resolvedFee = Number.isFinite(fee) ? fee : 0;
  const resolvedNetIncome = Number.isFinite(netIncome)
    ? netIncome
    : Math.max(0, resolvedPrice - resolvedFee);
  const saleMode = typeof record.saleMode === 'string' ? record.saleMode : 'fixed';
  const source = typeof record.source === 'string' ? record.source : '';
  const seller = record.seller && typeof record.seller === 'object' ? record.seller : {};
  const buyer = record.buyer && typeof record.buyer === 'object' ? record.buyer : {};
  return {
    _id: record._id || record.id || '',
    listingId: record.listingId || '',
    itemId: record.itemId || '',
    itemName: record.itemName || record.itemId || '未命名装备',
    saleModeLabel: SALE_MODE_LABELS[saleMode] || '未知模式',
    sourceLabel: SOURCE_LABELS[source] || SOURCE_LABELS[saleMode] || '交易成交',
    priceLabel: `${formatStones(resolvedPrice)} 灵石`,
    feeLabel: `${formatStones(resolvedFee)} 灵石`,
    netIncomeLabel: `${formatStones(resolvedNetIncome)} 灵石`,
    createdAtLabel: formatDateTime(record.createdAt || record.updatedAt || null),
    seller: {
      name: seller.realName || seller.nickName || seller.name || '',
      nickName: seller.nickName || '',
      realName: seller.realName || '',
      mobile: seller.mobile || ''
    },
    buyer: {
      name: buyer.realName || buyer.nickName || buyer.name || '',
      nickName: buyer.nickName || '',
      realName: buyer.realName || '',
      mobile: buyer.mobile || ''
    }
  };
}

Page({
  data: {
    loading: false,
    records: [],
    page: 1,
    pageSize: 20,
    total: 0,
    memberKeyword: '',
    itemKeyword: '',
    configLoading: false,
    configSaving: false,
    configForm: {
      feeRatePercent: '',
      minDurationHours: '',
      maxDurationHours: ''
    },
    configMeta: {
      updatedAtLabel: '',
      updatedByName: ''
    }
  },

  onLoad() {
    this.loadConfig();
    this.loadRecords({ reset: true });
  },

  onPullDownRefresh() {
    Promise.all([this.loadConfig(), this.loadRecords({ reset: true })])
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh({});
      });
  },

  onReachBottom() {
    if (this.data.loading) {
      return;
    }
    if (this.data.records.length >= this.data.total) {
      return;
    }
    const nextPage = (this.data.page || 1) + 1;
    this.loadRecords({ page: nextPage });
  },

  async loadRecords({ page = 1, reset = false } = {}) {
    if (this.data.loading) {
      return Promise.resolve();
    }
    this.setData({ loading: true });
    if (reset) {
      this.setData({ page: 1, total: 0, records: [] });
    }
    try {
      const response = await AdminService.listTradeOrders({
        page,
        pageSize: this.data.pageSize,
        memberKeyword: this.data.memberKeyword,
        itemKeyword: this.data.itemKeyword
      });
      const list = Array.isArray(response && response.records)
        ? response.records.map((item) => buildRecordDisplay(item)).filter(Boolean)
        : [];
      const nextPage = Number(response && response.page);
      const nextPageSize = Number(response && response.pageSize);
      const totalValue = Number(response && response.total);
      const baseRecords = reset ? [] : this.data.records;
      this.setData({
        records: baseRecords.concat(list),
        page: Number.isFinite(nextPage) && nextPage > 0 ? nextPage : page,
        pageSize: Number.isFinite(nextPageSize) && nextPageSize > 0 ? nextPageSize : this.data.pageSize,
        total: Number.isFinite(totalValue)
          ? totalValue
          : reset
            ? list.length
            : this.data.total
      });
    } catch (error) {
      console.error('[admin-trading] load records failed', error);
      wx.showToast({
        title: (error && error.errMsg) || '加载交易记录失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadConfig() {
    this.setData({ configLoading: true });
    try {
      const response = await AdminService.getTradingConfig();
      const config = (response && response.config) || {};
      const feeRate = Number(config.feeRate);
      const minHours = Number(config.minDurationHours);
      const maxHours = Number(config.maxDurationHours);
      this.setData({
        configForm: {
          feeRatePercent: formatPercentDisplay(feeRate),
          minDurationHours: Number.isFinite(minHours) ? String(minHours) : '',
          maxDurationHours: Number.isFinite(maxHours) ? String(maxHours) : ''
        },
        configMeta: {
          updatedAtLabel: formatDateTime(response && response.updatedAt),
          updatedByName: (response && response.updatedByName) || ''
        }
      });
    } catch (error) {
      console.error('[admin-trading] load config failed', error);
      wx.showToast({
        title: (error && error.errMsg) || '加载配置失败',
        icon: 'none'
      });
    } finally {
      this.setData({ configLoading: false });
    }
  },

  handleMemberKeywordInput(event) {
    this.setData({ memberKeyword: event.detail.value || '' });
  },

  handleItemKeywordInput(event) {
    this.setData({ itemKeyword: event.detail.value || '' });
  },

  handleSearch() {
    this.loadRecords({ reset: true });
  },

  handleResetFilters() {
    if (!this.data.memberKeyword && !this.data.itemKeyword) {
      this.loadRecords({ reset: true });
      return;
    }
    this.setData({ memberKeyword: '', itemKeyword: '' });
    this.loadRecords({ reset: true });
  },

  handleFeeRateInput(event) {
    this.setData({ 'configForm.feeRatePercent': event.detail.value || '' });
  },

  handleMinDurationInput(event) {
    this.setData({ 'configForm.minDurationHours': event.detail.value || '' });
  },

  handleMaxDurationInput(event) {
    this.setData({ 'configForm.maxDurationHours': event.detail.value || '' });
  },

  async handleSaveConfig() {
    if (this.data.configSaving) {
      return;
    }
    const { feeRatePercent, minDurationHours, maxDurationHours } = this.data.configForm;
    const feeRate = parsePercentInput(feeRatePercent);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
      wx.showToast({ title: '请输入有效的手续费比例', icon: 'none' });
      return;
    }
    const minHours = normalizeHoursInput(minDurationHours);
    if (!Number.isFinite(minHours)) {
      wx.showToast({ title: '请输入有效的最短挂单时间', icon: 'none' });
      return;
    }
    const maxHours = normalizeHoursInput(maxDurationHours);
    if (!Number.isFinite(maxHours)) {
      wx.showToast({ title: '请输入有效的最长挂单时间', icon: 'none' });
      return;
    }
    if (maxHours < minHours) {
      wx.showToast({ title: '最长时间需大于或等于最短时间', icon: 'none' });
      return;
    }
    this.setData({ configSaving: true });
    try {
      await AdminService.updateTradingConfig({
        feeRate,
        minDurationHours: minHours,
        maxDurationHours: maxHours
      });
      wx.showToast({ title: '配置已保存', icon: 'success' });
      await this.loadConfig();
    } catch (error) {
      console.error('[admin-trading] save config failed', error);
      wx.showToast({
        title: (error && error.errMsg) || '保存配置失败',
        icon: 'none'
      });
    } finally {
      this.setData({ configSaving: false });
    }
  }
});
