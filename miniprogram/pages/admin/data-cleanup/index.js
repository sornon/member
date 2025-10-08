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

const CLEANUP_COLLECTION_METADATA = {
  memberTimeline: {
    collection: 'memberTimeline',
    indexes: ['memberId'],
    description: '记录会员在各功能模块产生的时间线信息',
    reason: '关联会员已删除，保留会导致动态展示异常'
  },
  memberExtras: {
    collection: 'memberExtras',
    indexes: ['_id'],
    description: '会员扩展档案与自定义资料',
    reason: '基础会员被删除后遗留的档案需要同步移除'
  },
  memberPveHistory: {
    collection: 'memberPveHistory',
    indexes: ['_id'],
    description: 'PVE 模式战斗历史记录',
    reason: '关联会员不存在，历史战斗记录失去意义'
  },
  reservations: {
    collection: 'reservations',
    indexes: ['memberId'],
    description: '会员创建的预约与订座记录',
    reason: '会员已被删除，预约记录需清理以免占用资源'
  },
  memberRights: {
    collection: 'memberRights',
    indexes: ['memberId'],
    description: '会员当前持有的权益与礼遇',
    reason: '权益持有人已删除，需释放无效权益'
  },
  walletTransactions: {
    collection: 'walletTransactions',
    indexes: ['memberId'],
    description: '会员钱包充值与消费流水',
    reason: '关联会员不存在，账目数据需清理防止统计偏差'
  },
  stoneTransactions: {
    collection: 'stoneTransactions',
    indexes: ['memberId'],
    description: '灵石积分的获取与消耗记录',
    reason: '关联会员已删除，灵石流水需同步移除'
  },
  taskRecords: {
    collection: 'taskRecords',
    indexes: ['memberId'],
    description: '会员任务完成情况记录',
    reason: '任务执行者已删除，记录需清理以保持统计准确'
  },
  couponRecords: {
    collection: 'couponRecords',
    indexes: ['memberId'],
    description: '卡券发放与核销记录',
    reason: '关联会员已删除，卡券记录需同步移除'
  },
  chargeOrders: {
    collection: 'chargeOrders',
    indexes: ['memberId'],
    description: '管理员创建的扣费订单记录',
    reason: '扣费对象已删除，订单无效需要清理'
  },
  menuOrders: {
    collection: 'menuOrders',
    indexes: ['memberId'],
    description: '菜单消费与出品订单',
    reason: '关联会员已删除，订单记录应清除避免重复统计'
  },
  errorlogs: {
    collection: 'errorlogs',
    indexes: ['memberId'],
    description: '系统记录的错误日志',
    reason: '关联会员已删除，日志记录可安全清理'
  },
  pvpInvites: {
    collection: 'pvpInvites',
    indexes: ['inviterId', 'opponentId'],
    description: 'PVP 对战邀请信息',
    reason: '参与者会员已删除，邀请失效需要移除'
  },
  pvpMatches: {
    collection: 'pvpMatches',
    indexes: ['player.memberId', 'opponent.memberId'],
    description: 'PVP 对战结果记录',
    reason: '参赛会员不存在，战斗结果需同步清理'
  },
  pvpProfiles: {
    collection: 'pvpProfiles',
    indexes: ['_id'],
    description: 'PVP 模式玩家档案',
    reason: '玩家会员已删除，档案信息需要移除'
  },
  pvpLeaderboardEntries: {
    collection: 'pvpLeaderboard',
    indexes: ['entries[].memberId'],
    description: 'PVP 排行榜条目与排名',
    reason: '排行榜成员对应的会员已删除，需要更新榜单'
  }
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

function formatIndexFields(indexes = []) {
  if (!Array.isArray(indexes) || !indexes.length) {
    return '-';
  }
  return indexes
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('、');
}

function buildPreviewItem(key, count = 0) {
  const metadata = CLEANUP_COLLECTION_METADATA[key] || {};
  const collection = metadata.collection || key;
  return {
    key,
    label: metadata.label || COLLECTION_LABELS[key] || key,
    collection,
    indexes: formatIndexFields(metadata.indexes || []),
    description: metadata.description || '',
    reason: metadata.reason || '',
    count
  };
}

function normalizePreviewResult(response = {}) {
  const summary = response.summary && typeof response.summary === 'object' ? response.summary : {};
  const previewMap = summary.preview && typeof summary.preview === 'object' ? summary.preview : {};
  const items = Object.keys(previewMap)
    .map((key) => {
      const numeric = Number(previewMap[key]);
      const count = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
      return buildPreviewItem(key, count);
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
  const computedTotal = items.reduce((acc, item) => acc + item.count, 0);
  const totalValue = Number(response.totalRemoved);
  const total = Number.isFinite(totalValue) ? Math.max(0, Math.floor(totalValue)) : computedTotal;
  const memberCountValue = Number(response.memberCount);
  const memberCount = Number.isFinite(memberCountValue) ? Math.max(0, Math.floor(memberCountValue)) : 0;
  return {
    items,
    total,
    memberCount,
    previewOnly: Boolean(response.previewOnly)
  };
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
    loadingAction: '',
    finishedAt: '',
    previewAt: '',
    preview: null,
    result: null
  },

  handleScanTap() {
    if (this.data.loading) {
      return;
    }
    this.runScan();
  },

  async runScan() {
    this.setData({ loading: true, loadingAction: 'scan' });
    try {
      const response = await AdminService.previewCleanupResidualData();
      const preview = normalizePreviewResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        preview,
        previewAt: formatTimestamp(new Date()),
        result: null,
        finishedAt: ''
      });
      wx.showToast({
        title: preview.total > 0 ? '扫描完成' : '未发现待清理数据',
        icon: preview.total > 0 ? 'success' : 'none'
      });
    } catch (error) {
      console.error('[admin:data-cleanup:scan]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '扫描失败，请稍后再试',
        icon: 'none'
      });
    }
  },

  handleCleanupTap() {
    if (this.data.loading) {
      return;
    }
    const preview = this.data.preview;
    if (!preview || !Array.isArray(preview.items) || !preview.items.length) {
      wx.showToast({ title: '请先扫描待清理数据', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认执行数据清理？',
      content: '系统将移除所有已删除会员遗留下来的无用数据，该操作不可撤销。',
      confirmText: '确认清理',
      cancelText: '再考虑下',
      success: (res) => {
        if (res.confirm) {
          this.runCleanup();
        }
      }
    });
  },

  async runCleanup() {
    this.setData({ loading: true, loadingAction: 'cleanup' });
    try {
      const response = await AdminService.cleanupResidualData();
      const result = normalizeCleanupResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        result,
        finishedAt: formatTimestamp(new Date()),
        preview: null,
        previewAt: ''
      });
      wx.showToast({ title: '清理完成', icon: 'success' });
    } catch (error) {
      console.error('[admin:data-cleanup]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title: error && (error.errMsg || error.message) ? error.errMsg || error.message : '清理失败，请稍后再试',
        icon: 'none'
      });
    }
  }
});
