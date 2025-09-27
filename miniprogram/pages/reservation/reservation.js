import { ReservationService } from '../../services/api';
import { formatDate, formatCurrency } from '../../utils/format';

const slots = [
  { label: '日间（12:00-18:00）', value: 'day' },
  { label: '夜间（18:00-24:00）', value: 'night' },
  { label: '通宵（24:00-06:00）', value: 'late' }
];

Page({
  data: {
    loading: true,
    submitting: false,
    date: formatDate(new Date()),
    slotIndex: 0,
    slots,
    rooms: [],
    rightId: null
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
    const { date, slotIndex } = this.data;
    this.setData({ loading: true });
    try {
      const result = await ReservationService.listRooms(date, slots[slotIndex].value);
      this.setData({ rooms: result.rooms || [], loading: false });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleDateChange(event) {
    this.setData({ date: event.detail.value }, () => {
      this.fetchRooms();
    });
  },

  handleSlotChange(event) {
    this.setData({ slotIndex: Number(event.detail.value) }, () => {
      this.fetchRooms();
    });
  },

  async handleReserve(event) {
    const room = event.currentTarget.dataset.room;
    if (!room) return;
    this.setData({ submitting: true });
    try {
      const payload = {
        roomId: room._id,
        date: this.data.date,
        slot: slots[this.data.slotIndex].value,
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

  formatCurrency
});
