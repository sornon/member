import { AdminService } from '../../../services/api';
import { formatCurrency, formatDate } from '../../../utils/format';

const MIN_REPORT_MONTH = '2025-09';

function parseMonthValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = /^([0-9]{4})-([0-9]{2})$/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
        return new Date(year, month - 1, 1);
      }
    }
  }
  return null;
}

function formatMonthKey(date) {
  if (!(date instanceof Date)) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeMonthKey(value) {
  const date = parseMonthValue(value);
  if (!date) {
    return '';
  }
  return formatMonthKey(date);
}

function formatMonthLabel(value) {
  const date = parseMonthValue(value);
  if (!date) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.toString().padStart(2, '0');
  return `${year}年${month}月`;
}

function getCurrentMonthKey() {
  return formatMonthKey(new Date());
}

function monthScore(value) {
  const date = parseMonthValue(value);
  if (!date) {
    return NaN;
  }
  return date.getFullYear() * 12 + date.getMonth();
}

function clampMonthKey(value, min, max) {
  const normalizedValue = normalizeMonthKey(value) || normalizeMonthKey(max) || normalizeMonthKey(min);
  const normalizedMin = normalizeMonthKey(min);
  const normalizedMax = normalizeMonthKey(max);
  let result = normalizedValue || '';
  if (result && normalizedMin && monthScore(result) < monthScore(normalizedMin)) {
    result = normalizedMin;
  }
  if (result && normalizedMax && monthScore(result) > monthScore(normalizedMax)) {
    result = normalizedMax;
  }
  return result;
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch (error) {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    if (value.$date) {
      return parseDateValue(value.$date);
    }
    if (value.time) {
      return parseDateValue(value.time);
    }
  }
  return null;
}

function formatDateTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function getMonthBoundaries(monthKey) {
  const date = parseMonthValue(monthKey);
  if (!date) {
    return null;
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

function buildRangeLabel(range, monthKey) {
  const start = parseDateValue(range && range.start);
  const endExclusive = parseDateValue(range && range.end);
  if (start && endExclusive) {
    const endDate = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), 0);
    return `${formatDate(start)} 至 ${formatDate(endDate)}`;
  }
  const boundaries = getMonthBoundaries(monthKey);
  if (boundaries) {
    const endDate = new Date(boundaries.end.getFullYear(), boundaries.end.getMonth(), 0);
    return `${formatDate(boundaries.start)} 至 ${formatDate(endDate)}`;
  }
  return '';
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.round(numeric));
}

function buildMetrics(totals) {
  const totalIncome = toPositiveNumber(totals.totalIncome);
  const totalSpend = toPositiveNumber(totals.totalSpend);
  const diningSpend = toPositiveNumber(totals.diningSpend);
  return [
    {
      id: 'income',
      label: '总收入',
      value: totalIncome,
      valueLabel: formatCurrency(totalIncome),
      description: '会员充值合计'
    },
    {
      id: 'spend',
      label: '总消费',
      value: totalSpend,
      valueLabel: formatCurrency(totalSpend),
      description: '会员余额支付合计'
    },
    {
      id: 'dining',
      label: '用餐消费',
      value: diningSpend,
      valueLabel: formatCurrency(diningSpend),
      description: '点餐“用餐”分类消费'
    }
  ];
}

function buildReportState(result, fallbackMonthKey) {
  const normalizedFallback = normalizeMonthKey(fallbackMonthKey);
  const monthKey = normalizeMonthKey(result && result.month) || normalizedFallback;
  const totalsSource = (result && result.totals) || {};
  const totals = {
    totalIncome: toPositiveNumber(totalsSource.totalIncome),
    totalSpend: toPositiveNumber(totalsSource.totalSpend),
    diningSpend: toPositiveNumber(totalsSource.diningSpend)
  };
  const monthLabel = (result && result.monthLabel) || formatMonthLabel(monthKey);
  const rangeLabel = (result && result.rangeLabel) || buildRangeLabel(result && result.range, monthKey);
  const generatedAtLabel = formatDateTimeLabel(parseDateValue(result && result.generatedAt));
  return {
    monthKey,
    monthLabel,
    rangeLabel,
    generatedAtLabel,
    metrics: buildMetrics(totals),
    totals
  };
}

Page({
  data: {
    loading: false,
    monthValue: '',
    displayMonthLabel: '',
    startMonth: MIN_REPORT_MONTH,
    endMonth: getCurrentMonthKey(),
    metrics: [],
    report: {
      monthLabel: '',
      rangeLabel: '',
      generatedAtLabel: '',
      totals: {
        totalIncome: 0,
        totalSpend: 0,
        diningSpend: 0
      }
    }
  },

  onLoad() {
    const currentMonth = getCurrentMonthKey();
    const initialMonth = clampMonthKey(currentMonth, MIN_REPORT_MONTH, currentMonth);
    this.setData({
      monthValue: initialMonth,
      displayMonthLabel: formatMonthLabel(initialMonth) || '—',
      endMonth: currentMonth
    });
    this.loadReport(initialMonth);
  },

  onPullDownRefresh() {
    const month = this.data.monthValue || getCurrentMonthKey();
    this.loadReport(month);
  },

  handleMonthChange(event) {
    const rawValue = event && event.detail ? event.detail.value : '';
    const { startMonth, endMonth } = this.data;
    const normalized = clampMonthKey(rawValue, startMonth, endMonth);
    this.setData({
      monthValue: normalized,
      displayMonthLabel: formatMonthLabel(normalized) || '—'
    });
    this.loadReport(normalized);
  },

  handleRefresh() {
    const month = this.data.monthValue || getCurrentMonthKey();
    this.loadReport(month);
  },

  async loadReport(month) {
    const targetMonth = month || getCurrentMonthKey();
    this.setData({ loading: true });
    try {
      const result = await AdminService.getFinanceReport({ month: targetMonth });
      const constraints = (result && result.constraints) || {};
      const minMonth = constraints.minMonth || MIN_REPORT_MONTH;
      const maxMonth = constraints.maxMonth || getCurrentMonthKey();
      const normalizedMonth =
        clampMonthKey(result && result.month, minMonth, maxMonth) ||
        clampMonthKey(targetMonth, minMonth, maxMonth);
      const reportState = buildReportState(result, normalizedMonth);
      this.setData({
        loading: false,
        startMonth: minMonth,
        endMonth: maxMonth,
        monthValue: normalizedMonth,
        displayMonthLabel: formatMonthLabel(normalizedMonth) || '—',
        metrics: reportState.metrics,
        report: {
          monthLabel: reportState.monthLabel,
          rangeLabel: reportState.rangeLabel,
          generatedAtLabel: reportState.generatedAtLabel,
          totals: reportState.totals
        }
      });
    } catch (error) {
      console.error('[finance-report] load report failed', error);
      this.setData({ loading: false });
      const message = (error && (error.errMsg || error.message)) || '';
      wx.showToast({
        title: message && message.length <= 7 ? message : '加载失败',
        icon: 'none'
      });
    } finally {
      wx.stopPullDownRefresh();
    }
  }
});
