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

function unwrapSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }
  if (summary.result && typeof summary.result === 'object') {
    return summary.result;
  }
  return summary;
}

function formatSourceLabel(source) {
  if (!source) return '';
  if (source === 'task') return '任务奖励';
  if (source === 'adjust') return '后台调整';
  if (source === 'spend') return '商城消费';
  if (source === 'manual') return '运营发放';
  return source;
}

function decorateTransaction(txn = {}) {
  const normalized = typeof txn === 'object' && txn ? txn : {};
  const change = toNumeric(normalized.change ?? normalized.amount ?? 0, 0);
  const amount = toNumeric(normalized.amount ?? change, change);
  const createdAt = normalized.createdAt || normalized.timestamp || '';
  const type = normalized.type || (change >= 0 ? 'earn' : 'spend');
  const typeLabel = normalized.typeLabel || (change >= 0 ? '获得' : '消耗');
  const amountClass = change > 0 ? 'income' : change < 0 ? 'expense' : '';

  return {
    _id: normalized._id || normalized.id || `${type}-${createdAt || 'unknown'}-${amount}`,
    ...normalized,
    amount,
    change,
    type,
    typeLabel,
    createdAt,
    source: normalized.source || '',
    description: normalized.description || '',
    sourceLabel: formatSourceLabel(normalized.source),
    dateText: createdAt ? formatDate(createdAt) : '',
    changeText: formatStoneChange(change),
    amountClass
  };
}

function calculateTotals(transactions) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return { earned: 0, spent: 0 };
  }

  return transactions.reduce(
    (acc, txn) => {
      const amount = toNumeric(txn.change ?? txn.amount ?? 0, 0);
      if (amount > 0) {
        acc.earned += amount;
      } else if (amount < 0) {
        acc.spent += Math.abs(amount);
      }
      return acc;
    },
    { earned: 0, spent: 0 }
  );
}

function decorateSummary(summary) {
  const payload = unwrapSummary(summary) || {};

  const stoneBalance = toNumeric(payload.stoneBalance ?? payload.balance, 0);
  const balance = toNumeric(payload.balance ?? payload.stoneBalance, stoneBalance);
  const rawEarned = toNumeric(payload.totalEarned, 0);
  const rawSpent = toNumeric(payload.totalSpent, 0);
  const rawTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const transactions = rawTransactions.map((item) => decorateTransaction(item));

  const fallbackTotals = calculateTotals(transactions);
  const totalEarned = rawEarned > 0 ? rawEarned : fallbackTotals.earned;
  const totalSpent = rawSpent > 0 ? rawSpent : fallbackTotals.spent;

  return {
    ...payload,
    stoneBalance,
    balance,
    totalEarned,
    totalSpent,
    balanceText: formatStones(stoneBalance || balance || 0),
    earnedText: formatStones(totalEarned),
    spentText: formatStones(totalSpent),
    transactions
  };
}

Page({
  data: {
    loading: true,
    summary: null
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
      const summary = await StoneService.summary();
      const normalizedSummary = decorateSummary(summary);
      this.setData({ summary: normalizedSummary, loading: false });
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
