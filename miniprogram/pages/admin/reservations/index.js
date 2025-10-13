import { AdminService } from '../../../services/api';
import { playAdminNotificationSound } from '../../../services/notification';
import { formatMemberDisplayName } from '../../../utils/format';

const STATUS_OPTIONS = [
  { value: 'pendingApproval', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'cancelled', label: '已取消' },
  { value: 'all', label: '全部' }
];

const CANCELABLE_STATUSES = ['approved', 'reserved', 'confirmed', 'pendingPayment'];

function resolveDatabaseInstance() {
  if (!wx || !wx.cloud || typeof wx.cloud.database !== 'function') {
    return null;
  }
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData && app.globalData.env) {
        return wx.cloud.database({ env: app.globalData.env });
      }
    }
  } catch (error) {
    console.error('[admin:reservations] resolve database failed', error);
  }
  return wx.cloud.database();
}

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
    this.markReservationUpdatesAsRead();
    this.startReservationWatcher();
    this.fetchReservations(true);
  },

  onHide() {
    this.stopReservationWatcher();
  },

  onUnload() {
    this.stopReservationWatcher();
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

  startReservationWatcher() {
    if (this.reservationWatcher || this.reservationWatcherRestartTimer) {
      return;
    }
    const db = resolveDatabaseInstance();
    if (!db || typeof db.collection !== 'function') {
      return;
    }
    this.reservationKnownIds = this.reservationKnownIds || new Set();
    this.reservationWatcherInitialized = false;
    try {
      this.reservationWatcher = db
        .collection('reservations')
        .where({ status: 'pendingApproval' })
        .watch({
          onChange: (snapshot) => this.handleReservationWatcherChange(snapshot),
          onError: (error) => {
            console.error('[admin:reservations] watcher error', error);
            this.scheduleReservationWatcherRestart();
          }
        });
    } catch (error) {
      console.error('[admin:reservations] start watcher failed', error);
      this.scheduleReservationWatcherRestart();
    }
  },

  stopReservationWatcher() {
    if (this.reservationWatcher && typeof this.reservationWatcher.close === 'function') {
      try {
        this.reservationWatcher.close();
      } catch (error) {
        console.error('[admin:reservations] close watcher failed', error);
      }
    }
    this.reservationWatcher = null;
    this.reservationWatcherInitialized = false;
    if (this.reservationKnownIds && typeof this.reservationKnownIds.clear === 'function') {
      this.reservationKnownIds.clear();
    }
    if (this.reservationWatcherRestartTimer) {
      clearTimeout(this.reservationWatcherRestartTimer);
      this.reservationWatcherRestartTimer = null;
    }
  },

  scheduleReservationWatcherRestart() {
    if (this.reservationWatcherRestartTimer) {
      return;
    }
    this.stopReservationWatcher();
    this.reservationWatcherRestartTimer = setTimeout(() => {
      this.reservationWatcherRestartTimer = null;
      this.startReservationWatcher();
    }, 5000);
  },

  handleReservationWatcherChange(snapshot) {
    if (!snapshot) {
      return;
    }
    this.reservationKnownIds = this.reservationKnownIds || new Set();
    const docChanges = Array.isArray(snapshot.docChanges) ? snapshot.docChanges : [];
    if (snapshot.type === 'init') {
      if (Array.isArray(snapshot.docs)) {
        snapshot.docs.forEach((doc) => {
          if (doc && doc._id && doc.status === 'pendingApproval') {
            this.reservationKnownIds.add(doc._id);
          }
        });
      }
      docChanges.forEach((change) => {
        const doc = change && change.doc ? change.doc : null;
        const docId = (doc && doc._id) || (change && change.docId) || '';
        if (!docId) {
          return;
        }
        if (doc && doc.status === 'pendingApproval') {
          this.reservationKnownIds.add(docId);
        } else {
          this.reservationKnownIds.delete(docId);
        }
      });
      this.reservationWatcherInitialized = true;
      return;
    }
    this.reservationWatcherInitialized = true;
    if (docChanges.length) {
      docChanges.forEach((change) => this.processReservationWatcherChange(change));
      return;
    }
    if (Array.isArray(snapshot.docs)) {
      snapshot.docs.forEach((doc) => {
        this.processReservationWatcherChange({ dataType: 'update', doc, docId: doc && doc._id });
      });
    }
  },

  processReservationWatcherChange(change) {
    if (!change) {
      return;
    }
    const doc = change.doc || null;
    const docId = change.docId || (doc && doc._id) || '';
    if (!docId) {
      return;
    }
    this.reservationKnownIds = this.reservationKnownIds || new Set();
    if (change.dataType === 'remove' || !doc || doc.status !== 'pendingApproval') {
      this.reservationKnownIds.delete(docId);
      return;
    }
    const wasKnown = this.reservationKnownIds.has(docId);
    const statusChangedToPending =
      change.dataType === 'update' &&
      doc.status === 'pendingApproval' &&
      change.updatedFields &&
      Object.prototype.hasOwnProperty.call(change.updatedFields, 'status');
    const isAddition = change.dataType === 'add' || (!wasKnown && doc.status === 'pendingApproval');
    if (isAddition || statusChangedToPending) {
      this.reservationKnownIds.add(docId);
      if (this.reservationWatcherInitialized) {
        playAdminNotificationSound();
      }
      return;
    }
    this.reservationKnownIds.add(docId);
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
