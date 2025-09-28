import { AdminService } from '../../../services/api';

const STATUS_OPTIONS = [
  { value: 'pendingApproval', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'cancelled', label: '已取消' },
  { value: 'all', label: '全部' }
];

Page({
  data: {
    loading: true,
    reservations: [],
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    page: 1,
    pageSize: 20,
    total: 0,
    finished: false,
    error: '',
    processingId: '',
    processingType: '',
    currentStatusLabel: STATUS_OPTIONS[0].label
  },

  onShow() {
    this.fetchReservations(true);
  },

  onPullDownRefresh() {
    this.fetchReservations(true)
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  onReachBottom() {
    if (this.data.loading || this.data.finished) {
      return;
    }
    this.fetchReservations();
  },

  handleStatusChange(event) {
    const index = Number(event.detail.value);
    if (Number.isNaN(index)) {
      return;
    }
    this.setData({ statusIndex: index }, () => {
      this.fetchReservations(true);
    });
  },

  async fetchReservations(reset = false) {
    const nextPage = reset ? 1 : this.data.page;
    const statusOption = this.data.statusOptions[this.data.statusIndex] || STATUS_OPTIONS[0];
    this.setData({
      loading: true,
      error: '',
      currentStatusLabel: statusOption ? statusOption.label : STATUS_OPTIONS[0].label
    });
    try {
      const response = await AdminService.listReservations({
        status: statusOption ? statusOption.value : 'pendingApproval',
        page: nextPage,
        pageSize: this.data.pageSize
      });
      const items = response.reservations || [];
      const merged = reset ? items : [...this.data.reservations, ...items];
      const total = response.total || merged.length;
      const finished = merged.length >= total || items.length < this.data.pageSize;
      this.setData({
        reservations: merged,
        total,
        page: nextPage + 1,
        finished,
        loading: false
      });
    } catch (error) {
      console.error('[admin:reservations] fetch failed', error);
      this.setData({
        loading: false,
        error: error.errMsg || error.message || '加载失败'
      });
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    }
  },

  async handleApprove(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.processingId) {
      return;
    }
    this.setData({ processingId: id, processingType: 'approve' });
    try {
      await AdminService.approveReservation(id);
      wx.showToast({ title: '已通过', icon: 'success' });
      this.fetchReservations(true);
    } catch (error) {
      console.error('[admin:reservations] approve failed', error);
      wx.showToast({ title: error.errMsg || error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ processingId: '', processingType: '' });
    }
  },

  handleReject(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.processingId) {
      return;
    }
    wx.showModal({
      title: '拒绝预约',
      content: '确认拒绝该预约申请？',
      confirmText: '拒绝',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.submitRejection(id);
      }
    });
  },

  async submitRejection(reservationId) {
    this.setData({ processingId: reservationId, processingType: 'reject' });
    try {
      await AdminService.rejectReservation(reservationId, '房间已被其他会员锁定');
      wx.showToast({ title: '已拒绝', icon: 'success' });
      this.fetchReservations(true);
    } catch (error) {
      console.error('[admin:reservations] reject failed', error);
      wx.showToast({ title: error.errMsg || error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ processingId: '', processingType: '' });
    }
  }
});
