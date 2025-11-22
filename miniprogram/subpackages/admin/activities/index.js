import { AdminService } from '../../../services/api';
import { formatDateTimeRange } from '../../../utils/format';

const EDITOR_STATUS_OPTIONS = [
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '归档' }
];

function resolveStatusLabel(value) {
  const option = EDITOR_STATUS_OPTIONS.find((item) => item.value === value);
  return option ? option.label : '草稿';
}

function resolveStatusIndex(value) {
  const index = EDITOR_STATUS_OPTIONS.findIndex((item) => item.value === value);
  return index >= 0 ? index : 0;
}

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

function formatDatePart(date) {
  if (!date) {
    return '';
  }
  const d = parseDate(date);
  if (!d) {
    return '';
  }
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimePart(date) {
  if (!date) {
    return '';
  }
  const d = parseDate(date);
  if (!d) {
    return '';
  }
  const h = `${d.getHours()}`.padStart(2, '0');
  const m = `${d.getMinutes()}`.padStart(2, '0');
  return `${h}:${m}`;
}

function combineDateTime(date, time) {
  const dateText = typeof date === 'string' ? date.trim() : '';
  if (!dateText) {
    return '';
  }
  const timeText = typeof time === 'string' && time.trim() ? time.trim() : '00:00';
  return `${dateText}T${timeText}:00+08:00`;
}

function normalizePerksInput(text) {
  if (Array.isArray(text)) {
    return text
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof text !== 'string') {
    return [];
  }
  return text
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTagsInput(text) {
  if (Array.isArray(text)) {
    return text
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof text !== 'string') {
    return [];
  }
  return text
    .split(/\r?\n+|[,，；;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveActivityStatus(activity) {
  const status = typeof activity.status === 'string' ? activity.status.trim().toLowerCase() : '';
  if (status === 'draft') {
    return { type: 'draft', label: '草稿' };
  }
  if (status === 'archived') {
    return { type: 'archived', label: '已归档' };
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
    return { type: 'ongoing', label: '长期' };
  }
  return { type: 'ongoing', label: '进行中' };
}

function decorateActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return null;
  }
  const status = resolveActivityStatus(activity);
  const perks = Array.isArray(activity.perks)
    ? activity.perks.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const tags = Array.isArray(activity.tags)
    ? activity.tags.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const timeRangeLabel = formatDateTimeRange(activity.startTime, activity.endTime);
  return {
    id: activity.id || activity._id || '',
    title: activity.title || '未命名活动',
    tagline: activity.tagline || '',
    summary: activity.summary || '',
    status: activity.status || 'draft',
    statusLabel: status.label,
    statusType: status.type,
    startTime: activity.startTime || '',
    endTime: activity.endTime || '',
    timeRangeLabel,
    priceLabel: activity.priceLabel || '',
    location: activity.location || '',
    highlight: activity.highlight || '',
    notes: activity.notes || '',
    perks,
    tags,
    coverImage: activity.coverImage || '',
    sortOrder: Number(activity.sortOrder || 0)
  };
}

function buildEditorForm(activity) {
  if (!activity) {
    return {
      title: '',
      tagline: '',
      summary: '',
      status: 'published',
      startDate: '',
      startTime: '00:00',
      endDate: '',
      endTime: '23:59',
      priceLabel: '',
      location: '',
      highlight: '',
      perksText: '',
      notes: '',
      tagsText: '',
      coverImage: '',
      sortOrder: '0'
    };
  }
  return {
    title: activity.title || '',
    tagline: activity.tagline || '',
    summary: activity.summary || '',
    status: activity.status || 'draft',
    startDate: formatDatePart(activity.startTime),
    startTime: formatTimePart(activity.startTime),
    endDate: formatDatePart(activity.endTime),
    endTime: formatTimePart(activity.endTime),
    priceLabel: activity.priceLabel || '',
    location: activity.location || '',
    highlight: activity.highlight || '',
    perksText: Array.isArray(activity.perks) ? activity.perks.join('\n') : '',
    notes: activity.notes || '',
    tagsText: Array.isArray(activity.tags) ? activity.tags.join('\n') : '',
    coverImage: activity.coverImage || '',
    sortOrder: `${Number(activity.sortOrder || 0)}`
  };
}

Page({
  data: {
    loading: true,
    error: '',
    activities: [],
    editorVisible: false,
    editorMode: 'create',
    editorSaving: false,
    editorForm: buildEditorForm(null),
    editorStatusOptions: EDITOR_STATUS_OPTIONS,
    activeActivityId: '',
    editorStatusLabel: resolveStatusLabel('published'),
    editorStatusIndex: resolveStatusIndex('published')
  },

  onShow() {
    this.fetchActivities();
  },

  async fetchActivities() {
    this.setData({ loading: true, error: '' });
    try {
      const response = await AdminService.listActivities({ includeArchived: true });
      const list = Array.isArray(response && response.activities) ? response.activities : [];
      const activities = list.map((item) => decorateActivity(item)).filter(Boolean);
      this.setData({ activities, loading: false });
    } catch (error) {
      console.error('[admin:activities] fetch failed', error);
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

  handleRefresh() {
    if (this.data.loading) {
      return;
    }
    this.fetchActivities();
  },

  handleToggleCreateForm() {
    if (this.data.editorVisible && this.data.editorMode === 'create') {
      if (this.data.editorSaving) {
        return;
      }
      this.setData({
        editorVisible: false,
        editorMode: 'create',
        editorForm: buildEditorForm(null),
        activeActivityId: '',
        editorStatusLabel: resolveStatusLabel('published'),
        editorStatusIndex: resolveStatusIndex('published')
      });
      return;
    }

    this.setData({
      editorVisible: true,
      editorMode: 'create',
      editorForm: buildEditorForm(null),
      activeActivityId: '',
      editorStatusLabel: resolveStatusLabel('published'),
      editorStatusIndex: resolveStatusIndex('published')
    });
  },

  handleEditTap(event) {
    const { id } = event.currentTarget.dataset || {};
    const target = this.data.activities.find((item) => item.id === id);
    if (!target) {
      wx.showToast({ title: '未找到活动', icon: 'none' });
      return;
    }
    this.setData({
      editorVisible: true,
      editorMode: 'edit',
      editorForm: buildEditorForm(target),
      activeActivityId: target.id || '',
      editorStatusLabel: resolveStatusLabel(target.status),
      editorStatusIndex: resolveStatusIndex(target.status)
    });
  },

  handleCloseEditor() {
    if (this.data.editorSaving) {
      return;
    }
    this.setData({
      editorVisible: false,
      editorMode: 'create',
      activeActivityId: '',
      editorForm: buildEditorForm(null),
      editorStatusLabel: resolveStatusLabel('published'),
      editorStatusIndex: resolveStatusIndex('published')
    });
  },

  handleEditorInput(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.${field}`]: value });
  },

  handleEditorTextArea(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.${field}`]: value });
  },

  handleEditorStatusChange(event) {
    const index = Number(event.detail.value);
    if (Number.isNaN(index)) {
      return;
    }
    const option = this.data.editorStatusOptions[index];
    if (!option) {
      return;
    }
    this.setData({
      'editorForm.status': option.value,
      editorStatusLabel: option.label,
      editorStatusIndex: index
    });
  },

  handleEditorDateChange(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.${field}`]: value });
  },

  handleEditorTimeChange(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.${field}`]: value });
  },

  async handleEditorSubmit() {
    if (this.data.editorSaving) {
      return;
    }
    const form = this.data.editorForm;
    if (!form.title || !form.title.trim()) {
      wx.showToast({ title: '请输入活动标题', icon: 'none' });
      return;
    }
    const payload = {
      title: form.title.trim(),
      tagline: form.tagline.trim(),
      summary: form.summary.trim(),
      status: form.status || 'draft',
      startTime: combineDateTime(form.startDate, form.startTime),
      endTime: combineDateTime(form.endDate, form.endTime),
      priceLabel: form.priceLabel.trim(),
      location: form.location.trim(),
      highlight: form.highlight.trim(),
      notes: form.notes,
      coverImage: form.coverImage.trim(),
      sortOrder: Number(form.sortOrder || 0),
      perks: normalizePerksInput(form.perksText),
      tags: normalizeTagsInput(form.tagsText)
    };

    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') {
        payload[key] = payload[key].trim();
      }
      if (key === 'notes' && typeof payload[key] === 'string') {
        payload[key] = payload[key].replace(/\r\n/g, '\n');
      }
      if ((key === 'startTime' || key === 'endTime') && !payload[key]) {
        payload[key] = null;
      }
    });

    this.setData({ editorSaving: true });
    try {
      if (this.data.editorMode === 'edit' && this.data.activeActivityId) {
        await AdminService.updateActivity(this.data.activeActivityId, payload);
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        await AdminService.createActivity(payload);
        wx.showToast({ title: '已创建', icon: 'success' });
      }
      this.setData({
        editorVisible: false,
        editorSaving: false,
        activeActivityId: '',
        editorMode: 'create',
        editorForm: buildEditorForm(null),
        editorStatusLabel: resolveStatusLabel('published'),
        editorStatusIndex: resolveStatusIndex('published')
      });
      this.fetchActivities();
    } catch (error) {
      console.error('[admin:activities] save failed', error);
      wx.showToast({ title: (error && (error.errMsg || error.message)) || '保存失败', icon: 'none' });
      this.setData({ editorSaving: false });
    }
  }
});
