import { ReservationService } from '../../services/api';
import { acknowledgeBadges, BADGE_KEYS } from '../../utils/badge-center';
import { formatDate, formatCurrency } from '../../utils/format';

const DEFAULT_START_TIME = '12:00';
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DURATION_OPTIONS = [
  { value: 3, label: '3 小时' },
  { value: 6, label: '6 小时' },
  { value: 12, label: '12 小时' }
];
const DEFAULT_DURATION_INDEX = 0;
const DEFAULT_DURATION_HOURS = DURATION_OPTIONS[DEFAULT_DURATION_INDEX].value;
const DISMISSED_NOTICE_STORAGE_KEY = 'reservation_notice_dismissed';
const MINIMUM_ADVANCE_MINUTES = MINUTES_PER_HOUR;

function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return NaN;
  const [hourStr = '', minuteStr = ''] = time.split(':');
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
  if (hours < 0 || hours > 24) return NaN;
  if (minutes < 0 || minutes > 59) return NaN;
  const total = hours * 60 + minutes;
  if (hours === 24 && minutes !== 0) return NaN;
  return total;
}

function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [yearStr = '', monthStr = '', dayStr = ''] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function buildDateWithTime(dateStr, minutesOfDay) {
  if (!Number.isFinite(minutesOfDay) || minutesOfDay < 0) return null;
  const dateParts = parseDateParts(dateStr);
  if (!dateParts) return null;
  const hours = Math.floor(minutesOfDay / MINUTES_PER_HOUR);
  const minutes = minutesOfDay % MINUTES_PER_HOUR;
  const date = new Date(dateParts.year, dateParts.month - 1, dateParts.day, hours, minutes, 0, 0);
  return date;
}

function formatMinutesToTime(minutes) {
  if (!Number.isFinite(minutes)) return '00:00';
  const clamped = Math.max(0, Math.min(Math.floor(minutes), MINUTES_PER_DAY - 1));
  const hours = String(Math.floor(clamped / MINUTES_PER_HOUR)).padStart(2, '0');
  const mins = String(clamped % MINUTES_PER_HOUR).padStart(2, '0');
  return `${hours}:${mins}`;
}

function getMinimumStartInfo(dateStr) {
  const defaultResult = {
    minimumMinutes: 0,
    minimumTimeLabel: '00:00',
    unavailableMessage: ''
  };
  const dateParts = parseDateParts(dateStr);
  if (!dateParts) {
    return defaultResult;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const selectedDate = new Date(dateParts.year, dateParts.month - 1, dateParts.day);
  if (Number.isNaN(selectedDate.getTime())) {
    return defaultResult;
  }
  if (selectedDate.getTime() < today.getTime()) {
    return {
      minimumMinutes: MINUTES_PER_DAY,
      minimumTimeLabel: '00:00',
      unavailableMessage: '请选择有效的预约日期'
    };
  }
  if (selectedDate.getTime() === today.getTime()) {
    const minDateTime = new Date(now.getTime() + MINIMUM_ADVANCE_MINUTES * 60 * 1000);
    if (
      minDateTime.getFullYear() !== now.getFullYear() ||
      minDateTime.getMonth() !== now.getMonth() ||
      minDateTime.getDate() !== now.getDate()
    ) {
      return {
        minimumMinutes: MINUTES_PER_DAY,
        minimumTimeLabel: '00:00',
        unavailableMessage: '今日可预约时间已截止，请选择其他日期'
      };
    }
    const minutes = minDateTime.getHours() * MINUTES_PER_HOUR + minDateTime.getMinutes();
    return {
      minimumMinutes: minutes,
      minimumTimeLabel: formatMinutesToTime(minutes),
      unavailableMessage: ''
    };
  }
  return defaultResult;
}

function formatDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

Page({
  data: {
    loading: true,
    submitting: false,
    date: formatDate(new Date()),
    startTime: DEFAULT_START_TIME,
    timePickerStart: '00:00',
    endTime: '',
    endDate: '',
    endDateTimeLabel: '',
    durationOptions: DURATION_OPTIONS,
    durationIndex: DEFAULT_DURATION_INDEX,
    durationHours: DEFAULT_DURATION_HOURS,
    rooms: [],
    rightId: null,
    timeError: '',
    notice: null,
    noticeDismissed: false,
    memberUsageCount: 0,
    memberReservations: [],
    reservationBadges: null,
    cancellingId: ''
  },

  onLoad(options) {
    if (options && options.rightId) {
      this.setData({ rightId: options.rightId });
    }
  },

  onShow() {
    acknowledgeBadges([BADGE_KEYS.HOME_NAV_RESERVATION, BADGE_KEYS.RESERVATION_NOTIFICATION]);
    this.fetchRooms();
  },

  async fetchRooms() {
    const { date, startTime, durationHours } = this.data;
    const minimumInfo = getMinimumStartInfo(date);
    const startMinutes = timeToMinutes(startTime);
    const updates = { timePickerStart: minimumInfo.minimumTimeLabel };
    let effectiveStartTime = startTime;
    if (
      minimumInfo.minimumMinutes < MINUTES_PER_DAY &&
      Number.isFinite(startMinutes) &&
      startMinutes < minimumInfo.minimumMinutes
    ) {
      effectiveStartTime = minimumInfo.minimumTimeLabel;
      updates.startTime = minimumInfo.minimumTimeLabel;
    }
    this.setData(updates);
    if (minimumInfo.unavailableMessage) {
      this.setData({
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        timeError: minimumInfo.unavailableMessage,
        rooms: [],
        loading: false
      });
      return;
    }
    const validation = this.validateTimeRange(
      date,
      effectiveStartTime,
      durationHours,
      minimumInfo.minimumMinutes
    );
    this.setData({
      endTime: validation.endTime,
      endDate: validation.endDate,
      endDateTimeLabel: validation.endDateTimeLabel,
      timeError: validation.errorMessage || ''
    });
    if (!validation.valid) {
      this.setData({ rooms: [], loading: false });
      return;
    }
    const { endTime, endDate } = validation;
    this.setData({ loading: true, timeError: '' });
    try {
      const result = await ReservationService.listRooms(
        date,
        effectiveStartTime,
        endTime,
        endDate
      );
      const notice = result.notice || null;
      const rawReservations = Array.isArray(result.memberReservations)
        ? result.memberReservations
        : [];
      this.setData({
        rooms: result.rooms || [],
        loading: false,
        notice,
        noticeDismissed: this.isNoticeDismissed(notice),
        memberUsageCount: Math.max(0, Number(result.memberUsageCount || 0)),
        memberReservations: this.normalizeMemberReservations(rawReservations),
        reservationBadges: result.reservationBadges || null
      });
      this.updateGlobalReservationBadges(result.reservationBadges);
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleDateChange(event) {
    this.setData({ date: event.detail.value }, () => {
      this.fetchRooms();
    });
  },

  handleStartTimeChange(event) {
    this.setData({ startTime: event.detail.value }, () => {
      this.fetchRooms();
    });
  },

  handleDurationChange(event) {
    const { durationOptions } = this.data;
    const index = Number(event.detail.value);
    const safeIndex = Number.isInteger(index) ? Math.max(0, Math.min(index, durationOptions.length - 1)) : 0;
    const durationHours = (durationOptions[safeIndex] && durationOptions[safeIndex].value) || DEFAULT_DURATION_HOURS;
    this.setData({ durationIndex: safeIndex, durationHours }, () => {
      this.fetchRooms();
    });
  },

  validateTimeRange(date, start, durationHours, minimumStartMinutes = 0) {
    if (Number.isFinite(minimumStartMinutes) && minimumStartMinutes >= MINUTES_PER_DAY) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '今日可预约时间已截止，请选择其他日期'
      };
    }
    const startMinutes = timeToMinutes(start);
    if (!Number.isFinite(startMinutes)) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择有效的开始时间'
      };
    }
    if (startMinutes >= MINUTES_PER_DAY) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择有效的开始时间'
      };
    }
    if (
      Number.isFinite(minimumStartMinutes) &&
      startMinutes < Math.max(0, minimumStartMinutes)
    ) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择至少提前1小时的开始时间'
      };
    }
    const duration = Number(durationHours);
    if (!Number.isFinite(duration) || duration <= 0) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择有效的使用时长'
      };
    }
    const durationMinutes = duration * MINUTES_PER_HOUR;
    const startDate = buildDateWithTime(date, startMinutes);
    if (!startDate) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择有效的预约日期'
      };
    }
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    if (Number.isNaN(endDate.getTime())) {
      return {
        valid: false,
        endTime: '',
        endDate: '',
        endDateTimeLabel: '',
        errorMessage: '请选择有效的使用时长'
      };
    }
    const endTime = formatTimeLabel(endDate);
    const endDateLabel = formatDateLabel(endDate);
    const endDateTimeLabel = endDateLabel && endTime ? `${endDateLabel} ${endTime}` : '';
    return {
      valid: true,
      endTime,
      endDate: endDateLabel,
      endDateTimeLabel,
      errorMessage: ''
    };
  },

  async handleReserve(event) {
    const room = event.currentTarget.dataset.room;
    if (!room) return;
    const minimumInfo = getMinimumStartInfo(this.data.date);
    if (minimumInfo.unavailableMessage) {
      wx.showToast({ title: minimumInfo.unavailableMessage, icon: 'none' });
      return;
    }
    let reserveStartTime = this.data.startTime;
    const currentStartMinutes = timeToMinutes(reserveStartTime);
    if (
      minimumInfo.minimumMinutes < MINUTES_PER_DAY &&
      Number.isFinite(currentStartMinutes) &&
      currentStartMinutes < minimumInfo.minimumMinutes
    ) {
      reserveStartTime = minimumInfo.minimumTimeLabel;
      this.setData({
        startTime: reserveStartTime,
        timePickerStart: minimumInfo.minimumTimeLabel
      });
    }
    const validation = this.validateTimeRange(
      this.data.date,
      reserveStartTime,
      this.data.durationHours,
      minimumInfo.minimumMinutes
    );
    if (!validation.valid) {
      this.setData({
        endTime: validation.endTime,
        endDate: validation.endDate,
        endDateTimeLabel: validation.endDateTimeLabel,
        timeError: validation.errorMessage || ''
      });
      wx.showToast({ title: validation.errorMessage || '预约时间不正确', icon: 'none' });
      return;
    }
    this.setData({
      endTime: validation.endTime,
      endDate: validation.endDate,
      endDateTimeLabel: validation.endDateTimeLabel,
      timeError: ''
    });
    if (this.data.memberUsageCount <= 0) {
      wx.showToast({ title: '包房使用次数不足', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const payload = {
        roomId: room._id,
        date: this.data.date,
        startTime: reserveStartTime,
        endTime: validation.endTime,
        endDate: validation.endDate,
        rightId: this.data.rightId
      };
      const res = await ReservationService.create(payload);
      wx.showToast({ title: res.message || '预约成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 800);
    } catch (error) {
      // 错误已在服务层提示
    } finally {
      this.setData({ submitting: false });
    }
  },

  dismissNotice() {
    const { notice } = this.data;
    if (notice && notice.closable) {
      this.rememberNoticeDismissed(notice);
    }
    this.setData({ noticeDismissed: true });
  },

  async handleCancelReservation(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.cancellingId) {
      return;
    }
    wx.showModal({
      title: '取消预约',
      content: '确定取消该包房预约吗？',
      confirmText: '取消预约',
      cancelText: '暂不取消',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ cancellingId: id });
        try {
          await ReservationService.cancel(id);
          wx.showToast({ title: '已取消预约', icon: 'success' });
          this.fetchRooms();
        } catch (error) {
          wx.showToast({ title: error.errMsg || error.message || '取消失败', icon: 'none' });
        } finally {
          this.setData({ cancellingId: '' });
        }
      }
    });
  },

  updateGlobalReservationBadges(badges) {
    if (!badges || typeof getApp !== 'function') {
      return;
    }
    try {
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.memberInfo = {
          ...(app.globalData.memberInfo || {}),
          reservationBadges: { ...(badges || {}) }
        };
      }
    } catch (error) {
      console.error('[reservation] update global badges failed', error);
    }
  },

  normalizeMemberReservations(reservations) {
    if (!Array.isArray(reservations) || !reservations.length) {
      return [];
    }
    const now = new Date();
    const normalized = reservations
      .map((reservation) => {
        if (!reservation || typeof reservation !== 'object') {
          return null;
        }
        const startDateTime = this.buildReservationDateTime(
          reservation.date,
          reservation.startTime
        );
        const endDateTime = this.buildReservationDateTime(
          reservation.endDate || reservation.date,
          reservation.endTime
        );
        const hasStarted = startDateTime
          ? now.getTime() >= startDateTime.getTime()
          : false;
        const hasEnded = endDateTime ? now.getTime() >= endDateTime.getTime() : false;
        if (hasEnded) {
          return null;
        }
        return {
          ...reservation,
          canCancel: !!reservation.canCancel && !hasStarted
        };
      })
      .filter(Boolean);
    return normalized;
  },

  buildReservationDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) {
      return null;
    }
    const minutes = timeToMinutes(timeStr);
    if (!Number.isFinite(minutes)) {
      return null;
    }
    return buildDateWithTime(dateStr, minutes);
  },

  isNoticeDismissed(notice) {
    if (!notice || !notice.closable) {
      return false;
    }
    if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
      return false;
    }
    const key = this.getNoticeStorageKey(notice);
    if (!key) {
      return false;
    }
    try {
      const stored = wx.getStorageSync(DISMISSED_NOTICE_STORAGE_KEY);
      if (!stored || typeof stored !== 'object') {
        return false;
      }
      return !!stored[key];
    } catch (error) {
      console.error('[reservation] read notice dismissed flag failed', error);
      return false;
    }
  },

  rememberNoticeDismissed(notice) {
    const key = this.getNoticeStorageKey(notice);
    if (!key) {
      return;
    }
    if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
      return;
    }
    try {
      const stored = wx.getStorageSync(DISMISSED_NOTICE_STORAGE_KEY);
      const map = stored && typeof stored === 'object' ? stored : {};
      map[key] = true;
      wx.setStorageSync(DISMISSED_NOTICE_STORAGE_KEY, map);
    } catch (error) {
      console.error('[reservation] persist notice dismissed flag failed', error);
    }
  },

  getNoticeStorageKey(notice) {
    if (!notice) {
      return '';
    }
    const parts = [notice.reservationId || '', notice.type || '', notice.code || '', notice.message || ''];
    return parts.filter(Boolean).join('|');
  },

  formatCurrency
});
