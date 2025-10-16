import { AdminService } from '../../../services/api';
import { formatMemberDisplayName } from '../../../utils/format';

const STATUS_OPTIONS = [
  { value: 'pendingApproval', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'cancelled', label: '已取消' },
  { value: 'all', label: '全部' }
];

const CANCELABLE_STATUSES = ['approved', 'reserved', 'confirmed', 'pendingPayment'];

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
    currentStatusLabel: STATUS_OPTIONS[0].label,
    overviewLoading: false,
    overviewError: '',
    reservationOverview: [],
    overviewGeneratedAt: ''
  },

  onShow() {
    this.markReservationUpdatesAsRead();
    this.fetchReservations(true);
    this.fetchReservationOverview();
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
      const items = (response.reservations || []).map((item) => this.decorateReservation(item));
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

  async fetchReservationOverview() {
    this.setData({ overviewLoading: true, overviewError: '' });
    try {
      const response = await AdminService.getReservationOverview();
      const days = (response && Array.isArray(response.days) ? response.days : []).map((day, index) => {
        const reservations = Array.isArray(day.reservations)
          ? day.reservations.map((item) => ({
              ...item,
              memberDisplayName: formatMemberDisplayName(
                item.memberName,
                item.memberRealName,
                item.memberId || ''
              )
            }))
          : [];
        const reservationCount = reservations.length;

        return {
          ...day,
          reservations,
          isToday: index === 0,
          displayLabel: index === 0 ? '今天' : day.weekday || '',
          reservationCount,
          reservationCountLabel: reservationCount > 0 ? `${reservationCount}场` : '空闲'
        };
      });
      this.setData({
        reservationOverview: days,
        overviewGeneratedAt: (response && response.generatedAt) || '',
        overviewLoading: false
      });
    } catch (error) {
      console.error('[admin:reservations] overview fetch failed', error);
      this.setData({
        overviewLoading: false,
        overviewError: error.errMsg || error.message || '加载失败'
      });
    }
  },

  handleRetryOverview() {
    if (this.data.overviewLoading) {
      return;
    }
    this.fetchReservationOverview();
  },

  decorateReservation(item) {
    if (!item || typeof item !== 'object') {
      return item;
    }
    const memberDisplayName = formatMemberDisplayName(
      item.memberName,
      item.memberRealName,
      item.memberName || item.memberId || ''
    );
    return {
      ...item,
      canCancel: CANCELABLE_STATUSES.includes(item.status),
      memberDisplayName
    };
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
  },

  handleCancel(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.processingId) {
      return;
    }
    wx.showModal({
      title: '取消预约',
      content: '确认取消该预约并返还使用次数？',
      confirmText: '取消预约',
      cancelText: '暂不取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.submitCancellation(id);
      }
    });
  },

  async submitCancellation(reservationId) {
    this.setData({ processingId: reservationId, processingType: 'cancel' });
    try {
      await AdminService.cancelReservation(reservationId, '管理员取消预约');
      wx.showToast({ title: '已取消', icon: 'success' });
      this.fetchReservations(true);
    } catch (error) {
      console.error('[admin:reservations] cancel failed', error);
      wx.showToast({ title: error.errMsg || error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ processingId: '', processingType: '' });
    }
  },

  async markReservationUpdatesAsRead() {
    try {
      const result = await AdminService.markReservationRead();
      if (result && result.reservationBadges) {
        this.updateGlobalReservationBadges(result.reservationBadges);
      }
    } catch (error) {
      // ignore silently
      console.error('[admin:reservations] mark read failed', error);
    }
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
      console.error('[admin:reservations] update global badges failed', error);
    }
  }
});
