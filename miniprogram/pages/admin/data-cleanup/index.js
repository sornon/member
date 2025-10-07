import { AdminService } from '../../../services/api';

const COLLECTION_LABELS = {
  members: '会员',
  memberTimeline: '会员动态',
  memberExtras: '会员扩展信息',
  memberPveHistory: 'PVE 战斗记录',
  reservations: '预约记录',
  memberRights: '会员权益',
  walletTransactions: '钱包流水',
  stoneTransactions: '灵石流水',
  taskRecords: '任务记录',
  couponRecords: '卡券记录',
  chargeOrders: '扣费订单',
  menuOrders: '菜单订单',
  errorlogs: '错误日志',
  pvpInvites: 'PVP 邀请',
  pvpMatches: 'PVP 对战记录',
  pvpProfiles: 'PVP 资料',
  pvpLeaderboard: 'PVP 排行榜',
  pvpLeaderboardEntries: 'PVP 排行榜条目'
};

function formatTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value) => `${value}`.padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizeRemovedDetails(removed = {}) {
  if (!removed || typeof removed !== 'object') {
    return [];
  }
  return Object.keys(removed)
    .map((key) => {
      const numeric = Number(removed[key]);
      const count = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
      return {
        key,
        label: COLLECTION_LABELS[key] || key,
        count
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
}

function formatErrorMessages(errors = []) {
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((error) => {
      if (!error || typeof error !== 'object') {
        return '';
      }
      const label = COLLECTION_LABELS[error.collection] || error.collection || '未知集合';
      const id = typeof error.id === 'string' && error.id ? ` #${error.id}` : '';
      const message = error.message || '未知错误';
      return `${label}${id}：${message}`;
    })
    .filter(Boolean);
}

function normalizeCleanupResult(response = {}) {
  const summary = response.summary && typeof response.summary === 'object' ? response.summary : {};
  const details = normalizeRemovedDetails(summary.removed || {});
  const computedTotal = details.reduce((acc, item) => acc + item.count, 0);
  const totalRemovedValue = Number(response.totalRemoved);
  const totalRemoved = Number.isFinite(totalRemovedValue)
    ? Math.max(0, Math.floor(totalRemovedValue))
    : computedTotal;
  const memberCountValue = Number(response.memberCount);
  const memberCount = Number.isFinite(memberCountValue)
    ? Math.max(0, Math.floor(memberCountValue))
    : 0;
  const errors = formatErrorMessages(summary.errors || []);
  return {
    totalRemoved,
    memberCount,
    details,
    errors
  };
}

Page({
  data: {
    loading: false,
    finishedAt: '',
    result: null
  },

  handleCleanupTap() {
    if (this.data.loading) {
      return;
    }
    wx.showModal({
      title: '确认执行数据清理？',
      content: '系统将移除所有已删除会员遗留下来的无用数据，该操作不可撤销。',
      confirmText: '开始清理',
      cancelText: '暂不执行',
      success: (res) => {
        if (res.confirm) {
          this.runCleanup();
        }
      }
    });
  },

  async runCleanup() {
    this.setData({ loading: true });
    try {
      const response = await AdminService.cleanupResidualData();
      const result = normalizeCleanupResult(response || {});
      this.setData({
        loading: false,
        result,
        finishedAt: formatTimestamp(new Date())
      });
      wx.showToast({ title: '清理完成', icon: 'success' });
    } catch (error) {
      console.error('[admin:data-cleanup]', error);
      this.setData({ loading: false });
      wx.showToast({
        title: error && (error.errMsg || error.message) ? error.errMsg || error.message : '清理失败，请稍后再试',
        icon: 'none'
      });
    }
  }
});
