import { ReservationService } from '../../services/api';
import { formatDate, formatCurrency } from '../../utils/format';

const DEFAULT_START_TIME = '12:00';
const DEFAULT_END_TIME = '14:00';
const DISMISSED_NOTICE_STORAGE_KEY = 'reservation_notice_dismissed';

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

Page({
  data: {
    loading: true,
    submitting: false,
    date: formatDate(new Date()),
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
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
    this.fetchRooms();
  },

  async fetchRooms() {
    const { date, startTime, endTime } = this.data;
    if (!this.ensureValidTimeRange(startTime, endTime)) {
      this.setData({ rooms: [], loading: false });
      return;
    }
    this.setData({ loading: true, timeError: '' });
    try {
      const result = await ReservationService.listRooms(date, startTime, endTime);
      const notice = result.notice || null;
      this.setData({
        rooms: result.rooms || [],
        loading: false,
        notice,
        noticeDismissed: this.isNoticeDismissed(notice),
        memberUsageCount: Math.max(0, Number(result.memberUsageCount || 0)),
        memberReservations: Array.isArray(result.memberReservations) ? result.memberReservations : [],
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

  handleEndTimeChange(event) {
    this.setData({ endTime: event.detail.value }, () => {
      this.fetchRooms();
    });
  },

  ensureValidTimeRange(start, end) {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      this.setData({ timeError: '请选择有效的预约时间' });
      return false;
    }
    if (startMinutes >= endMinutes) {
      this.setData({ timeError: '结束时间需晚于开始时间' });
      return false;
    }
    this.setData({ timeError: '' });
    return true;
  },

  async handleReserve(event) {
    const room = event.currentTarget.dataset.room;
    if (!room) return;
    if (!this.ensureValidTimeRange(this.data.startTime, this.data.endTime)) {
      wx.showToast({ title: this.data.timeError || '预约时间不正确', icon: 'none' });
      return;
    }
    if (this.data.memberUsageCount <= 0) {
      wx.showToast({ title: '包房使用次数不足', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const payload = {
        roomId: room._id,
        date: this.data.date,
        startTime: this.data.startTime,
        endTime: this.data.endTime,
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
