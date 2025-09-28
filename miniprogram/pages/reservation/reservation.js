import { ReservationService } from '../../services/api';
import { formatDate, formatCurrency } from '../../utils/format';

const DEFAULT_START_TIME = '12:00';
const DEFAULT_END_TIME = '14:00';

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
    memberUsageCount: 0
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
      this.setData({
        rooms: result.rooms || [],
        loading: false,
        notice: result.notice || null,
        noticeDismissed: false,
        memberUsageCount: Math.max(0, Number(result.memberUsageCount || 0))
      });
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
    this.setData({ noticeDismissed: true });
  },

  formatCurrency
});
