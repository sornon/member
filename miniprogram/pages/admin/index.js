import { playAdminNotificationSound } from '../../services/notification';

const app = getApp();

const BASE_ACTIONS = [
  {
    icon: '👥',
    label: '会员列表',
    description: '查看与管理会员资料',
    url: '/pages/admin/members/index'
  },
  {
    icon: '🍷',
    label: '存酒管理',
    description: '为会员登记和管理存酒',
    url: '/pages/admin/wine-storage/index'
  },
  {
    icon: '🧾',
    label: '创建扣费单',
    description: '录入商品生成扫码扣费单',
    url: '/pages/admin/charge/index'
  },
  {
    icon: '🍽️',
    label: '备餐列表',
    description: '查看会员点餐并推送扣费',
    url: '/pages/admin/menu-orders/index'
  },
  {
    icon: '📊',
    label: '订单查询',
    description: '按会员查看扣费订单记录',
    url: '/pages/admin/orders/index'
  },
  {
    icon: '💹',
    label: '财务报表',
    description: '查看月度收入与消费统计',
    url: '/pages/admin/finance-report/index'
  },
  {
    icon: '🏠',
    label: '预约审核',
    description: '查看并审核包房预约申请',
    url: '/pages/admin/reservations/index'
  },
  {
    icon: '🧹',
    label: '数据清理',
    description: '清理删除会员遗留数据',
    url: '/pages/admin/data-cleanup/index'
  }
];

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

function buildQuickActions(member) {
  const badges = normalizeReservationBadges(member && member.reservationBadges);
  return BASE_ACTIONS.map((action) => {
    if (action.url === '/pages/admin/reservations/index') {
      const showDot = badges.adminVersion > badges.adminSeenVersion;
      const badgeText = badges.pendingApprovalCount > 0 ? `${badges.pendingApprovalCount}` : '';
      return { ...action, showDot, badgeText };
    }
    return { ...action };
  });
}

function resolveDatabaseInstance() {
  if (!wx || !wx.cloud || typeof wx.cloud.database !== 'function') {
    return null;
  }
  try {
    if (typeof getApp === 'function') {
      const appInstance = getApp();
      if (appInstance && appInstance.globalData && appInstance.globalData.env) {
        return wx.cloud.database({ env: appInstance.globalData.env });
      }
    }
  } catch (error) {
    console.error('[admin:index] resolve database failed', error);
  }
  return wx.cloud.database();
}

Page({
  data: {
    quickActions: buildQuickActions(null)
  },

  onShow() {
    this.refreshQuickActions();
    this.startRealtimeNotifications();
  },

  onHide() {
    this.stopRealtimeNotifications();
  },

  onUnload() {
    this.stopRealtimeNotifications({ resetKnown: true });
  },

  refreshQuickActions() {
    const member = (app.globalData && app.globalData.memberInfo) || null;
    this.setData({ quickActions: buildQuickActions(member) });
  },

  handleActionTap(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.navigateTo({ url });
  },

  startRealtimeNotifications() {
    this.startMenuOrderNotificationWatcher();
    this.startReservationNotificationWatcher();
  },

  stopRealtimeNotifications(options = {}) {
    const { resetKnown = false } = options;
    this.stopMenuOrderNotificationWatcher({ resetKnown });
    this.stopReservationNotificationWatcher({ resetKnown });
  },

  startMenuOrderNotificationWatcher() {
    if (this.menuOrderNotificationWatcher || this.menuOrderNotificationRestartTimer) {
      return;
    }
    const db = resolveDatabaseInstance();
    if (!db || typeof db.collection !== 'function') {
      return;
    }
    this.menuOrderNotificationKnownIds = this.menuOrderNotificationKnownIds || new Set();
    this.menuOrderNotificationInitialized = false;
    try {
      this.menuOrderNotificationWatcher = db
        .collection('menuOrders')
        .where({ status: 'submitted' })
        .watch({
          onChange: (snapshot) => this.handleMenuOrderNotificationChange(snapshot),
          onError: (error) => {
            console.error('[admin:index] menu order watcher error', error);
            this.scheduleMenuOrderNotificationRestart();
          }
        });
    } catch (error) {
      console.error('[admin:index] start menu order watcher failed', error);
      this.scheduleMenuOrderNotificationRestart();
    }
  },

  stopMenuOrderNotificationWatcher(options = {}) {
    const { resetKnown = true } = options;
    if (this.menuOrderNotificationWatcher && typeof this.menuOrderNotificationWatcher.close === 'function') {
      try {
        this.menuOrderNotificationWatcher.close();
      } catch (error) {
        console.error('[admin:index] close menu order watcher failed', error);
      }
    }
    this.menuOrderNotificationWatcher = null;
    this.menuOrderNotificationInitialized = false;
    if (resetKnown && this.menuOrderNotificationKnownIds && typeof this.menuOrderNotificationKnownIds.clear === 'function') {
      this.menuOrderNotificationKnownIds.clear();
    }
    if (resetKnown) {
      this.menuOrderNotificationHasEverInitialized = false;
    }
    if (this.menuOrderNotificationRestartTimer) {
      clearTimeout(this.menuOrderNotificationRestartTimer);
      this.menuOrderNotificationRestartTimer = null;
    }
  },

  scheduleMenuOrderNotificationRestart() {
    if (this.menuOrderNotificationRestartTimer) {
      return;
    }
    this.stopMenuOrderNotificationWatcher({ resetKnown: false });
    this.menuOrderNotificationRestartTimer = setTimeout(() => {
      this.menuOrderNotificationRestartTimer = null;
      this.startMenuOrderNotificationWatcher();
    }, 5000);
  },

  handleMenuOrderNotificationChange(snapshot) {
    if (!snapshot) {
      return;
    }
    this.menuOrderNotificationKnownIds = this.menuOrderNotificationKnownIds || new Set();
    const docChanges = Array.isArray(snapshot.docChanges) ? snapshot.docChanges : [];
    const hasEverInitialized = !!this.menuOrderNotificationHasEverInitialized;
    if (snapshot.type === 'init') {
      const previouslyKnownIds = new Set(this.menuOrderNotificationKnownIds);
      const newIds = new Set();
      this.menuOrderNotificationKnownIds.clear();
      if (Array.isArray(snapshot.docs)) {
        snapshot.docs.forEach((doc) => {
          const docId = doc && doc._id;
          if (!docId) {
            return;
          }
          if (doc && doc.status === 'submitted') {
            this.menuOrderNotificationKnownIds.add(docId);
            if (hasEverInitialized && !previouslyKnownIds.has(docId)) {
              newIds.add(docId);
            }
          }
        });
      }
      docChanges.forEach((change) => {
        const doc = change && change.doc ? change.doc : null;
        const docId = (doc && doc._id) || (change && change.docId) || '';
        if (!docId) {
          return;
        }
        if (doc && doc.status === 'submitted') {
          this.menuOrderNotificationKnownIds.add(docId);
          if (hasEverInitialized && !previouslyKnownIds.has(docId)) {
            newIds.add(docId);
          }
        } else {
          this.menuOrderNotificationKnownIds.delete(docId);
        }
      });
      this.menuOrderNotificationInitialized = true;
      this.menuOrderNotificationHasEverInitialized = true;
      if (newIds.size) {
        playAdminNotificationSound();
      }
      return;
    }
    this.menuOrderNotificationInitialized = true;
    this.menuOrderNotificationHasEverInitialized = true;
    if (docChanges.length) {
      docChanges.forEach((change) => this.processMenuOrderNotificationChange(change));
      return;
    }
    if (Array.isArray(snapshot.docs)) {
      snapshot.docs.forEach((doc) => {
        this.processMenuOrderNotificationChange({ dataType: 'update', doc, docId: doc && doc._id });
      });
    }
  },

  processMenuOrderNotificationChange(change) {
    if (!change) {
      return;
    }
    const doc = change.doc || null;
    const docId = change.docId || (doc && doc._id) || '';
    if (!docId) {
      return;
    }
    this.menuOrderNotificationKnownIds = this.menuOrderNotificationKnownIds || new Set();
    if (change.dataType === 'remove' || !doc || doc.status !== 'submitted') {
      this.menuOrderNotificationKnownIds.delete(docId);
      return;
    }
    const wasKnown = this.menuOrderNotificationKnownIds.has(docId);
    const statusChangedToSubmitted =
      change.dataType === 'update' &&
      doc.status === 'submitted' &&
      change.updatedFields &&
      Object.prototype.hasOwnProperty.call(change.updatedFields, 'status');
    const isAddition = !wasKnown && doc.status === 'submitted';
    if (isAddition || statusChangedToSubmitted) {
      this.menuOrderNotificationKnownIds.add(docId);
      if (this.menuOrderNotificationInitialized) {
        playAdminNotificationSound();
      }
      return;
    }
    this.menuOrderNotificationKnownIds.add(docId);
  },

  startReservationNotificationWatcher() {
    if (this.reservationNotificationWatcher || this.reservationNotificationRestartTimer) {
      return;
    }
    const db = resolveDatabaseInstance();
    if (!db || typeof db.collection !== 'function') {
      return;
    }
    this.reservationNotificationKnownIds = this.reservationNotificationKnownIds || new Set();
    this.reservationNotificationInitialized = false;
    try {
      this.reservationNotificationWatcher = db
        .collection('reservations')
        .where({ status: 'pendingApproval' })
        .watch({
          onChange: (snapshot) => this.handleReservationNotificationChange(snapshot),
          onError: (error) => {
            console.error('[admin:index] reservation watcher error', error);
            this.scheduleReservationNotificationRestart();
          }
        });
    } catch (error) {
      console.error('[admin:index] start reservation watcher failed', error);
      this.scheduleReservationNotificationRestart();
    }
  },

  stopReservationNotificationWatcher(options = {}) {
    const { resetKnown = true } = options;
    if (this.reservationNotificationWatcher && typeof this.reservationNotificationWatcher.close === 'function') {
      try {
        this.reservationNotificationWatcher.close();
      } catch (error) {
        console.error('[admin:index] close reservation watcher failed', error);
      }
    }
    this.reservationNotificationWatcher = null;
    this.reservationNotificationInitialized = false;
    if (resetKnown && this.reservationNotificationKnownIds && typeof this.reservationNotificationKnownIds.clear === 'function') {
      this.reservationNotificationKnownIds.clear();
    }
    if (resetKnown) {
      this.reservationNotificationHasEverInitialized = false;
    }
    if (this.reservationNotificationRestartTimer) {
      clearTimeout(this.reservationNotificationRestartTimer);
      this.reservationNotificationRestartTimer = null;
    }
  },

  scheduleReservationNotificationRestart() {
    if (this.reservationNotificationRestartTimer) {
      return;
    }
    this.stopReservationNotificationWatcher({ resetKnown: false });
    this.reservationNotificationRestartTimer = setTimeout(() => {
      this.reservationNotificationRestartTimer = null;
      this.startReservationNotificationWatcher();
    }, 5000);
  },

  handleReservationNotificationChange(snapshot) {
    if (!snapshot) {
      return;
    }
    this.reservationNotificationKnownIds = this.reservationNotificationKnownIds || new Set();
    const docChanges = Array.isArray(snapshot.docChanges) ? snapshot.docChanges : [];
    const hasEverInitialized = !!this.reservationNotificationHasEverInitialized;
    if (snapshot.type === 'init') {
      const previouslyKnownIds = new Set(this.reservationNotificationKnownIds);
      const newIds = new Set();
      this.reservationNotificationKnownIds.clear();
      if (Array.isArray(snapshot.docs)) {
        snapshot.docs.forEach((doc) => {
          const docId = doc && doc._id;
          if (!docId) {
            return;
          }
          if (doc && doc.status === 'pendingApproval') {
            this.reservationNotificationKnownIds.add(docId);
            if (hasEverInitialized && !previouslyKnownIds.has(docId)) {
              newIds.add(docId);
            }
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
          this.reservationNotificationKnownIds.add(docId);
          if (hasEverInitialized && !previouslyKnownIds.has(docId)) {
            newIds.add(docId);
          }
        } else {
          this.reservationNotificationKnownIds.delete(docId);
        }
      });
      this.reservationNotificationInitialized = true;
      this.reservationNotificationHasEverInitialized = true;
      if (newIds.size) {
        playAdminNotificationSound();
      }
      return;
    }
    this.reservationNotificationInitialized = true;
    this.reservationNotificationHasEverInitialized = true;
    if (docChanges.length) {
      docChanges.forEach((change) => this.processReservationNotificationChange(change));
      return;
    }
    if (Array.isArray(snapshot.docs)) {
      snapshot.docs.forEach((doc) => {
        this.processReservationNotificationChange({ dataType: 'update', doc, docId: doc && doc._id });
      });
    }
  },

  processReservationNotificationChange(change) {
    if (!change) {
      return;
    }
    const doc = change.doc || null;
    const docId = change.docId || (doc && doc._id) || '';
    if (!docId) {
      return;
    }
    this.reservationNotificationKnownIds = this.reservationNotificationKnownIds || new Set();
    if (change.dataType === 'remove' || !doc || doc.status !== 'pendingApproval') {
      this.reservationNotificationKnownIds.delete(docId);
      return;
    }
    const wasKnown = this.reservationNotificationKnownIds.has(docId);
    const statusChangedToPending =
      change.dataType === 'update' &&
      doc.status === 'pendingApproval' &&
      change.updatedFields &&
      Object.prototype.hasOwnProperty.call(change.updatedFields, 'status');
    const isAddition = !wasKnown && doc.status === 'pendingApproval';
    if (isAddition || statusChangedToPending) {
      this.reservationNotificationKnownIds.add(docId);
      if (this.reservationNotificationInitialized) {
        playAdminNotificationSound();
      }
      return;
    }
    this.reservationNotificationKnownIds.add(docId);
  }
});
