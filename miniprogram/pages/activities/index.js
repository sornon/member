import { ActivityService } from '../../services/api';
import { formatDateTimeRange } from '../../utils/format';

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normalizePerks(perks) {
  if (Array.isArray(perks)) {
    return perks
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof perks === 'string') {
    return perks
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveStatus(activity) {
  const status = typeof activity.status === 'string' ? activity.status.trim().toLowerCase() : '';
  if (status === 'archived') {
    return { type: 'archived', label: '已结束' };
  }
  if (status === 'draft') {
    return { type: 'draft', label: '筹备中' };
  }

  const start = parseDate(activity.startTime);
  const end = parseDate(activity.endTime);
  const now = Date.now();

  if (end && now > end.getTime()) {
    return { type: 'ended', label: '已结束' };
  }
  if (start && now < start.getTime()) {
    return { type: 'upcoming', label: '即将开始' };
  }
  if (!start && !end) {
    return { type: 'ongoing', label: '长期活动' };
  }
  return { type: 'ongoing', label: '进行中' };
}

function decorateActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return null;
  }
  const perks = normalizePerks(activity.perks);
  const status = resolveStatus(activity);
  const timeRangeLabel = formatDateTimeRange(activity.startTime, activity.endTime);
  return {
    id: activity.id || activity._id || '',
    title: typeof activity.title === 'string' && activity.title ? activity.title : '精彩活动',
    tagline: typeof activity.tagline === 'string' ? activity.tagline : '',
    summary: typeof activity.summary === 'string' ? activity.summary : '',
    priceLabel: typeof activity.priceLabel === 'string' ? activity.priceLabel : '',
    location: typeof activity.location === 'string' ? activity.location : '',
    highlight: typeof activity.highlight === 'string' ? activity.highlight : '',
    notes: typeof activity.notes === 'string' ? activity.notes : '',
    perks,
    tags: Array.isArray(activity.tags) ? activity.tags.filter((item) => typeof item === 'string' && item.trim()) : [],
    coverImage: typeof activity.coverImage === 'string' ? activity.coverImage : '',
    timeRangeLabel,
    statusLabel: status.label,
    statusType: status.type
  };
}

Page({
  data: {
    loading: true,
    activities: [],
    error: ''
  },

  onShow() {
    this.fetchActivities();
  },

  async fetchActivities() {
    this.setData({ loading: true, error: '' });
    try {
      const response = await ActivityService.list();
      const list = Array.isArray(response && response.activities) ? response.activities : [];
      const activities = list.map((item) => decorateActivity(item)).filter(Boolean);
      this.setData({ activities, loading: false });
    } catch (error) {
      console.error('[activities] fetch failed', error);
      this.setData({
        loading: false,
        error: (error && (error.errMsg || error.message)) || '加载失败，请稍后重试'
      });
    }
  },

  handleRetry() {
    if (this.data.loading) {
      return;
    }
    this.fetchActivities();
  },

  formatDateTimeRange
});
