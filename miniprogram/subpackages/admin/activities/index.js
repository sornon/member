import { AdminService } from '../../../services/api';
import { formatDateTimeRange } from '../../../utils/format';

const EDITOR_STATUS_OPTIONS = [
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '归档' }
];
const ACTIVITY_TYPE_OPTIONS = [
  { value: 'standard', label: '通用活动' },
  { value: 'bargain', label: '砍价活动（感恩节/音乐会）' }
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
    locationLat: Number.isFinite(activity.locationLat) ? activity.locationLat : null,
    locationLng: Number.isFinite(activity.locationLng) ? activity.locationLng : null,
    highlight: activity.highlight || '',
    notes: activity.notes || '',
    perks,
    tags,
    activityType: activity.activityType || 'standard',
    activityTypeLabel: activity.activityType === 'bargain' ? '砍价活动' : '通用活动',
    activityTemplate: activity.activityTemplate || '',
    bargainSettings: activity.bargainSettings || null,
    coverImage: activity.coverImage || '',
    sortOrder: Number(activity.sortOrder || 0)
  };
}

function buildEditorForm(activity) {
  const buildQuestionItem = (item = {}) => ({
    question: item && typeof item.question === 'string' ? item.question : '',
    optionsText: Array.isArray(item && item.options) ? item.options.join('\n') : '',
    answerIndex: Number.isFinite(item && item.answerIndex) ? `${item.answerIndex}` : '0'
  });
  const defaultBargainItems = [
    { amount: '120', probability: '14' },
    { amount: '180', probability: '14' },
    { amount: '200', probability: '14' },
    { amount: '260', probability: '14' },
    { amount: '320', probability: '14' },
    { amount: '500', probability: '14' },
    { amount: '0', probability: '16' }
  ];
  const bargainItems =
    activity && activity.bargainSettings && Array.isArray(activity.bargainSettings.bargainItems)
      ? activity.bargainSettings.bargainItems
      : [];
  const formBargainItems = defaultBargainItems.map((item, index) => ({
    amount: bargainItems[index] && Number.isFinite(bargainItems[index].amount) ? `${bargainItems[index].amount}` : item.amount,
    probability:
      bargainItems[index] && Number.isFinite(bargainItems[index].probability) ? `${bargainItems[index].probability}` : item.probability
  }));
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
      locationLat: '',
      locationLng: '',
      highlight: '',
      perksText: '',
      notes: '',
      tagsText: '',
      activityType: 'standard',
      activityTemplate: '',
      bargainStartPrice: '1500',
      bargainFloorPrice: '998',
      shareRewardAttempts: '1',
      bargainStock: '15',
      bargainItems: formBargainItems,
      coverImage: '',
      heroImagePath: '/assets/background/articalday.jpg',
      heroHeightRpx: '1000',
      pageBackgroundColor: '#050814',
      cardBackgroundColor: 'rgba(13, 18, 35, 0.9)',
      heroMaskEnabled: 'true',
      infoSectionEnabled: 'true',
      infoSectionContent: '',
      activityTag1: '',
      activityTag1Enabled: 'true',
      activityTag2: '',
      activityTag2Enabled: 'true',
      quizRewardEnabled: 'false',
      quizQuestion: '',
      quizOptionsText: '',
      quizAnswerIndex: '0',
      quizExtraQuestions: [],
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
    locationLat: Number.isFinite(activity.locationLat) ? `${activity.locationLat}` : '',
    locationLng: Number.isFinite(activity.locationLng) ? `${activity.locationLng}` : '',
    highlight: activity.highlight || '',
    perksText: Array.isArray(activity.perks) ? activity.perks.join('\n') : '',
    notes: activity.notes || '',
    tagsText: Array.isArray(activity.tags) ? activity.tags.join('\n') : '',
    activityType: activity.activityType || 'standard',
    activityTemplate: activity.activityTemplate || '',
    bargainStartPrice:
      activity.bargainSettings && Number.isFinite(activity.bargainSettings.startPrice)
        ? `${activity.bargainSettings.startPrice}`
        : '1500',
    bargainFloorPrice:
      activity.bargainSettings && Number.isFinite(activity.bargainSettings.floorPrice)
        ? `${activity.bargainSettings.floorPrice}`
        : '998',
    shareRewardAttempts:
      activity.bargainSettings && Number.isFinite(activity.bargainSettings.shareRewardAttempts)
        ? `${activity.bargainSettings.shareRewardAttempts}`
        : '1',
    bargainStock:
      activity.bargainSettings && Number.isFinite(activity.bargainSettings.stock)
        ? `${activity.bargainSettings.stock}`
        : '15',
    bargainItems: formBargainItems,
    coverImage: activity.coverImage || '',
    heroImagePath:
      activity.bargainSettings && typeof activity.bargainSettings.heroImagePath === 'string'
        ? activity.bargainSettings.heroImagePath
        : '/assets/background/articalday.jpg',
    heroHeightRpx:
      activity.bargainSettings && Number.isFinite(activity.bargainSettings.heroHeightRpx)
        ? `${activity.bargainSettings.heroHeightRpx}`
        : '1000',
    pageBackgroundColor:
      activity.bargainSettings && typeof activity.bargainSettings.pageBackgroundColor === 'string'
        ? activity.bargainSettings.pageBackgroundColor
        : '#050814',
    cardBackgroundColor:
      activity.bargainSettings && typeof activity.bargainSettings.cardBackgroundColor === 'string'
        ? activity.bargainSettings.cardBackgroundColor
        : 'rgba(13, 18, 35, 0.9)',
    heroMaskEnabled:
      activity.bargainSettings && typeof activity.bargainSettings.heroMaskEnabled === 'boolean'
        ? `${activity.bargainSettings.heroMaskEnabled}`
        : 'true',
    infoSectionEnabled:
      activity.bargainSettings && typeof activity.bargainSettings.infoSectionEnabled === 'boolean'
        ? `${activity.bargainSettings.infoSectionEnabled}`
        : 'true',
    infoSectionContent:
      activity.bargainSettings && typeof activity.bargainSettings.infoSectionContent === 'string'
        ? activity.bargainSettings.infoSectionContent
        : '',
    activityTag1:
      activity.bargainSettings && typeof activity.bargainSettings.activityTag1 === 'string'
        ? activity.bargainSettings.activityTag1
        : '',
    activityTag1Enabled:
      activity.bargainSettings && typeof activity.bargainSettings.activityTag1Enabled === 'boolean'
        ? `${activity.bargainSettings.activityTag1Enabled}`
        : 'true',
    activityTag2:
      activity.bargainSettings && typeof activity.bargainSettings.activityTag2 === 'string'
        ? activity.bargainSettings.activityTag2
        : '',
    activityTag2Enabled:
      activity.bargainSettings && typeof activity.bargainSettings.activityTag2Enabled === 'boolean'
        ? `${activity.bargainSettings.activityTag2Enabled}`
        : 'true',
    quizRewardEnabled:
      activity.bargainSettings && activity.bargainSettings.quizReward && activity.bargainSettings.quizReward.enabled ? 'true' : 'false',
    quizQuestion:
      activity.bargainSettings && activity.bargainSettings.quizReward && activity.bargainSettings.quizReward.question
        ? activity.bargainSettings.quizReward.question
        : '',
    quizOptionsText:
      activity.bargainSettings && activity.bargainSettings.quizReward && Array.isArray(activity.bargainSettings.quizReward.options)
        ? activity.bargainSettings.quizReward.options.join('\n')
        : '',
    quizAnswerIndex:
      activity.bargainSettings && activity.bargainSettings.quizReward && Number.isFinite(activity.bargainSettings.quizReward.answerIndex)
        ? `${activity.bargainSettings.quizReward.answerIndex}`
        : '0',
    quizExtraQuestions:
      activity.bargainSettings &&
      activity.bargainSettings.quizReward &&
      Array.isArray(activity.bargainSettings.quizReward.questions) &&
      activity.bargainSettings.quizReward.questions.length > 1
        ? activity.bargainSettings.quizReward.questions.slice(1).map((item) => buildQuestionItem(item))
        : [],
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
    activityTypeOptions: ACTIVITY_TYPE_OPTIONS,
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

  handleActivityTypeChange(event) {
    const index = Number(event.detail.value);
    if (Number.isNaN(index) || !this.data.activityTypeOptions[index]) {
      return;
    }
    this.setData({
      'editorForm.activityType': this.data.activityTypeOptions[index].value
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


  handleHeroMaskEnabledChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      'editorForm.heroMaskEnabled': index === 1 ? 'false' : 'true'
    });
  },
  handleInfoSectionEnabledChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      'editorForm.infoSectionEnabled': index === 1 ? 'false' : 'true'
    });
  },

  handleActivityTag1EnabledChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      'editorForm.activityTag1Enabled': index === 1 ? 'false' : 'true'
    });
  },

  handleActivityTag2EnabledChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      'editorForm.activityTag2Enabled': index === 1 ? 'false' : 'true'
    });
  },
  handleQuizRewardEnabledChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      'editorForm.quizRewardEnabled': index === 1 ? 'false' : 'true'
    });
  },

  handleEditorTimeChange(event) {
    const { field } = event.currentTarget.dataset || {};
    if (!field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.${field}`]: value });
  },
  handleBargainItemInput(event) {
    const { index, field } = event.currentTarget.dataset || {};
    const targetIndex = Number(index);
    if (Number.isNaN(targetIndex) || !field) {
      return;
    }
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      [`editorForm.bargainItems[${targetIndex}].${field}`]: value
    });
  },
  handleQuizExtraQuestionInput(event) {
    const { index, field } = event.currentTarget.dataset || {};
    const targetIndex = Number(index);
    if (Number.isNaN(targetIndex) || !field) return;
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ [`editorForm.quizExtraQuestions[${targetIndex}].${field}`]: value });
  },
  handleAddQuizQuestion() {
    const current = Array.isArray(this.data.editorForm.quizExtraQuestions) ? this.data.editorForm.quizExtraQuestions : [];
    this.setData({
      'editorForm.quizExtraQuestions': [...current, { question: '', optionsText: '', answerIndex: '0' }]
    });
  },
  handleRemoveQuizQuestion(event) {
    const { index } = event.currentTarget.dataset || {};
    const targetIndex = Number(index);
    const current = Array.isArray(this.data.editorForm.quizExtraQuestions) ? [...this.data.editorForm.quizExtraQuestions] : [];
    if (Number.isNaN(targetIndex) || targetIndex < 0 || targetIndex >= current.length) return;
    current.splice(targetIndex, 1);
    this.setData({ 'editorForm.quizExtraQuestions': current });
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
      locationLat: form.locationLat === '' ? null : Number(form.locationLat),
      locationLng: form.locationLng === '' ? null : Number(form.locationLng),
      highlight: form.highlight.trim(),
      notes: form.notes,
      coverImage: form.coverImage.trim(),
      sortOrder: Number(form.sortOrder || 0),
      perks: normalizePerksInput(form.perksText),
      tags: normalizeTagsInput(form.tagsText)
    };
    payload.activityType = form.activityType || 'standard';
    payload.activityTemplate = form.activityTemplate || '';
    if (payload.activityType === 'bargain') {
      const bargainItems = Array.isArray(form.bargainItems) ? form.bargainItems : [];
      const normalizedItems = bargainItems.map((item) => ({
        amount: Number((item && item.amount) || 0),
        probability: Number((item && item.probability) || 0)
      }));
      const probabilitySum = normalizedItems.reduce(
        (sum, item) => sum + (Number.isFinite(item.probability) ? item.probability : 0),
        0
      );
      if (probabilitySum !== 100) {
        wx.showToast({ title: '砍价项概率总和必须为100%', icon: 'none' });
        return;
      }
      payload.bargainSettings = {
        ...(payload.bargainSettings || {}),
        startPrice: Number(form.bargainStartPrice || 1500),
        floorPrice: Number(form.bargainFloorPrice || 998),
        shareRewardAttempts: Number(form.shareRewardAttempts || 1),
        stock: Number(form.bargainStock || 15),
        bargainItems: normalizedItems,
        heroImagePath: (form.heroImagePath || '').trim(),
        heroHeightRpx: Number(form.heroHeightRpx || 1000),
        pageBackgroundColor: (form.pageBackgroundColor || '').trim(),
        cardBackgroundColor: (form.cardBackgroundColor || '').trim(),
        heroMaskEnabled: `${form.heroMaskEnabled}` !== 'false',
        infoSectionEnabled: `${form.infoSectionEnabled}` !== 'false',
        infoSectionContent: form.infoSectionContent || '',
        activityTag1: (form.activityTag1 || '').trim(),
        activityTag1Enabled: `${form.activityTag1Enabled}` !== 'false',
        activityTag2: (form.activityTag2 || '').trim(),
        activityTag2Enabled: `${form.activityTag2Enabled}` !== 'false',
        quizReward: {
          enabled: `${form.quizRewardEnabled}` === 'true',
          question: (form.quizQuestion || '').trim(),
          options: normalizePerksInput(form.quizOptionsText || ''),
          answerIndex: Number(form.quizAnswerIndex || 0),
          questions: [
            {
              question: (form.quizQuestion || '').trim(),
              options: normalizePerksInput(form.quizOptionsText || ''),
              answerIndex: Number(form.quizAnswerIndex || 0)
            },
            ...(Array.isArray(form.quizExtraQuestions) ? form.quizExtraQuestions : []).map((item) => ({
              question: ((item && item.question) || '').trim(),
              options: normalizePerksInput((item && item.optionsText) || ''),
              answerIndex: Number((item && item.answerIndex) || 0)
            }))
          ].filter((item) => item.question && item.options.length >= 2)
        }
      };
    } else {
      payload.bargainSettings = null;
    }

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
    if (!Number.isFinite(payload.locationLat)) {
      payload.locationLat = null;
    }
    if (!Number.isFinite(payload.locationLng)) {
      payload.locationLng = null;
    }

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
