import { StoneService } from '../../services/api';
import {
  ensureWatcher as ensureMemberWatcher,
  subscribe as subscribeMemberRealtime
} from '../../services/member-realtime';
import { formatDate, formatStones, formatStoneChange } from '../../utils/format';

function toNumeric(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === 'object') {
    if ('value' in value) {
      return toNumeric(value.value, fallback);
    }
    if ('amount' in value) {
      return toNumeric(value.amount, fallback);
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTransaction(txn = {}) {
  const change = toNumeric(txn.change ?? txn.amount ?? 0, 0);
  const amount = toNumeric(txn.amount ?? change, change);
  const createdAt = txn.createdAt || txn.timestamp || '';
  const type = txn.type || (change >= 0 ? 'earn' : 'spend');
  const typeLabel = txn.typeLabel || (change >= 0 ? '获得' : '消耗');
  return {
    _id: txn._id || txn.id || `${type}-${createdAt || 'unknown'}-${amount}`,
    ...txn,
    amount,
    change,
    createdAt,
    type,
    typeLabel,
    source: txn.source || '',
    description: txn.description || ''
  };
}

function normalizeSummary(summary) {
  const payload = summary && typeof summary === 'object' && summary.result && typeof summary.result === 'object'
    ? summary.result
    : summary;
  if (!payload || typeof payload !== 'object') {
    return {
      stoneBalance: 0,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      transactions: []
    };
  }
  const stoneBalance = toNumeric(payload.stoneBalance ?? payload.balance, 0);
  const balance = toNumeric(payload.balance ?? payload.stoneBalance, stoneBalance);
  const totalEarned = toNumeric(payload.totalEarned, 0);
  const totalSpent = toNumeric(payload.totalSpent, 0);
  const transactions = Array.isArray(payload.transactions)
    ? payload.transactions.map((item) => normalizeTransaction(item))
    : [];
  return {
    ...payload,
    stoneBalance,
    balance,
    totalEarned,
    totalSpent,
    transactions
  };
}

function formatSourceLabel(source) {
  if (!source) return '';
  if (source === 'task') return '任务奖励';
  if (source === 'adjust') return '后台调整';
  if (source === 'spend') return '商城消费';
  if (source === 'manual') return '运营发放';
  return source;
}

function buildSummaryDisplay(summary) {
  if (!summary || typeof summary !== 'object') {
    return {
      balanceText: formatStones(0),
      earnedText: formatStones(0),
      spentText: formatStones(0),
      transactions: []
    };
  }

  const { stoneBalance = 0, balance = 0, totalEarned = 0, totalSpent = 0 } = summary;
  const transactions = Array.isArray(summary.transactions) ? summary.transactions : [];

  return {
    balanceText: formatStones(stoneBalance || balance || 0),
    earnedText: formatStones(totalEarned || 0),
    spentText: formatStones(totalSpent || 0),
    transactions: transactions.map((txn) => {
      const change = toNumeric(txn.change ?? txn.amount ?? 0, 0);
      const amountClass = change > 0 ? 'income' : change < 0 ? 'expense' : '';

      return {
        ...txn,
        sourceLabel: formatSourceLabel(txn.source),
        dateText: txn.createdAt ? formatDate(txn.createdAt) : '',
        changeText: formatStoneChange(change),
        amountClass
      };
    })
  };
}

Page({
  data: {
    loading: true,
    summary: null,
    summaryDisplay: null
  },

  onShow() {
    this.attachMemberRealtime();
    ensureMemberWatcher().catch(() => {
      // ignore; fetchSummary will surface any issues
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
      const summary = await StoneService.summary();
      const normalizedSummary = normalizeSummary(summary);
      const summaryDisplay = buildSummaryDisplay(normalizedSummary);
      this.setData({ summary: normalizedSummary, summaryDisplay, loading: false });
    } catch (error) {
      console.error('[stones:summary]', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
    }
    this.fetchingSummary = false;
    if (this.pendingFetchSummary) {
      this.pendingFetchSummary = false;
      this.fetchSummary({ showLoading: false });
    }
  }
});
