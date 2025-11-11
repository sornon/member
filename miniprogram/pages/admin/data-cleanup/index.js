import { AdminService } from '../../../services/api';

const COLLECTION_LABELS = {
  members: '会员',
  memberTimeline: '会员动态',
  memberExtras: '会员扩展信息',
  memberPveHistory: 'PVE 战斗记录',
  pveProfileHistory: 'PVE 档案缓存',
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
  pvpLeaderboardEntries: 'PVP 排行榜条目',
  pvpSeasons: 'PVP 赛季'
};

const CLEANUP_COLLECTION_METADATA = {
  members: {
    collection: 'members',
    indexes: ['_id'],
    description: '会员基础档案',
    reason: '删除测试账号时需移除账号主体信息'
  },
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
  pveProfileHistory: {
    collection: 'members',
    indexes: ['pveProfile.battleHistory', 'pveProfile.skillHistory'],
    description: '会员 PVE 档案中缓存的战斗与技能历史',
    reason: '清空战斗记录时需同步移除缓存，避免前端展示残留数据'
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
  pvpLeaderboard: {
    collection: 'pvpLeaderboard',
    indexes: ['seasonId'],
    description: 'PVP 排行榜缓存快照',
    reason: '战斗记录重置后需要清空旧有排名数据'
  },
  pvpLeaderboardEntries: {
    collection: 'pvpLeaderboard',
    indexes: ['entries[].memberId'],
    description: 'PVP 排行榜条目与排名',
    reason: '排行榜成员对应的会员已删除，需要更新榜单'
  },
  pvpSeasons: {
    collection: 'pvpSeasons',
    indexes: ['status', 'seasonId'],
    description: 'PVP 赛季与排名周期配置',
    reason: '重建战斗环境时需要清空历史赛季数据以便重新初始化'
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

function formatExperience(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0';
  }
  return Math.max(0, Math.floor(numeric)).toLocaleString('zh-CN');
}

function formatAmountFen(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return (numeric / 100).toFixed(2);
}

function normalizeSpendMember(entry = {}) {
  const transactionCount = Math.max(0, Number(entry.transactionCount) || 0);
  const totalAmount = Math.max(0, Number(entry.totalAmount) || 0);
  const experienceToRevert = Math.max(0, Number(entry.experienceToRevert) || 0);
  const experienceDeducted = Math.max(0, Number(entry.experienceDeducted) || 0);
  const experienceBefore = Math.max(0, Number(entry.experienceBefore) || 0);
  const experienceAfter = Math.max(0, Number(entry.experienceAfter) || 0);
  const displayName = entry.displayName || entry.realName || entry.nickName || entry.memberId || '';
  return {
    memberId: entry.memberId || '',
    displayName,
    nickName: entry.nickName || '',
    realName: entry.realName || '',
    transactionCount,
    totalAmount,
    totalAmountLabel: `¥${formatAmountFen(totalAmount)}`,
    experienceToRevert,
    experienceToRevertLabel: formatExperience(experienceToRevert),
    experienceDeducted,
    experienceDeductedLabel: formatExperience(experienceDeducted),
    experienceBefore,
    experienceBeforeLabel: formatExperience(experienceBefore),
    experienceAfter,
    experienceAfterLabel: formatExperience(experienceAfter),
    lastTransactionAt: entry.lastTransactionAt || '',
    lastTransactionAtLabel: entry.lastTransactionAtLabel || ''
  };
}

function normalizeSpendPreview(response = {}) {
  const members = Array.isArray(response.members) ? response.members.map(normalizeSpendMember) : [];
  const memberCount = Math.max(0, Number(response.memberCount) || members.length || 0);
  const totalTransactions = Math.max(0, Number(response.totalTransactions) || 0);
  const totalAmount = Math.max(0, Number(response.totalAmount) || 0);
  const totalExperience = Math.max(0, Number(response.totalExperience) || 0);
  const totalExperienceDeducted = Math.max(
    0,
    Number(response.totalExperienceDeducted || response.totalExperienceExpectedDeduction || 0)
  );
  return {
    members,
    memberCount,
    totalTransactions,
    totalAmount,
    totalAmountLabel: `¥${formatAmountFen(totalAmount)}`,
    totalExperience,
    totalExperienceLabel: formatExperience(totalExperience),
    totalExperienceDeducted,
    totalExperienceDeductedLabel: formatExperience(totalExperienceDeducted)
  };
}

function normalizeSpendResult(response = {}) {
  const members = Array.isArray(response.members) ? response.members.map(normalizeSpendMember) : [];
  const memberCount = Math.max(0, Number(response.memberCount) || members.length || 0);
  const totalTransactions = Math.max(0, Number(response.totalTransactions) || 0);
  const totalAmount = Math.max(0, Number(response.totalAmount) || 0);
  const totalExperience = Math.max(0, Number(response.totalExperience) || 0);
  const totalExperienceDeducted = Math.max(0, Number(response.totalExperienceDeducted) || 0);
  const summary = response.summary && typeof response.summary === 'object' ? response.summary : {};
  const errors = formatErrorMessages(summary.errors || []);
  return {
    members,
    memberCount,
    totalTransactions,
    totalAmount,
    totalAmountLabel: `¥${formatAmountFen(totalAmount)}`,
    totalExperience,
    totalExperienceLabel: formatExperience(totalExperience),
    totalExperienceDeducted,
    totalExperienceDeductedLabel: formatExperience(totalExperienceDeducted),
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
    result: null,
    spendPreviewAt: '',
    spendFinishedAt: '',
    spendPreview: null,
    spendResult: null,
    testPreviewAt: '',
    testFinishedAt: '',
    testPreview: null,
    testResult: null,
    battlePreviewAt: '',
    battleFinishedAt: '',
    battlePreview: null,
    battleResult: null
  },

  handleScanTap() {
    if (this.data.loading) {
      return;
    }
    this.runScan();
  },

  handleTestScanTap() {
    if (this.data.loading) {
      return;
    }
    this.runTestScan();
  },

  handleSpendScanTap() {
    if (this.data.loading) {
      return;
    }
    this.runSpendScan();
  },

  handleSpendCleanupTap() {
    if (this.data.loading) {
      return;
    }
    const spendPreview = this.data.spendPreview;
    if (!spendPreview || !Array.isArray(spendPreview.members) || !spendPreview.members.length) {
      wx.showToast({ title: '请先扫描异常修为', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认回滚消费修为？',
      content: '系统将回滚历史消费产生的修为并重新计算境界，该操作不可撤销。',
      confirmText: '确认修正',
      cancelText: '再考虑下',
      success: (res) => {
        if (res.confirm) {
          this.runSpendCleanup();
        }
      }
    });
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

  async runTestScan() {
    this.setData({ loading: true, loadingAction: 'scanTest' });
    try {
      const response = await AdminService.previewCleanupTestMembers();
      const testPreview = normalizePreviewResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        testPreview,
        testPreviewAt: formatTimestamp(new Date()),
        testResult: null,
        testFinishedAt: ''
      });
      const hasMembers = testPreview.memberCount > 0;
      wx.showToast({
        title: hasMembers ? '扫描完成' : '未发现测试账号',
        icon: hasMembers ? 'success' : 'none'
      });
    } catch (error) {
      console.error('[admin:data-cleanup:test-scan]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '测试账号扫描失败，请稍后再试',
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

  handleTestCleanupTap() {
    if (this.data.loading) {
      return;
    }
    const testPreview = this.data.testPreview;
    if (!testPreview || testPreview.memberCount <= 0) {
      wx.showToast({ title: '请先扫描测试账号', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认清理测试账号？',
      content: '系统将删除所有带有测试标签的账号及关联数据，该操作不可撤销。',
      confirmText: '确认清理',
      cancelText: '再考虑下',
      success: (res) => {
        if (res.confirm) {
          this.runTestCleanup();
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
  },

  async runSpendScan() {
    this.setData({ loading: true, loadingAction: 'scanSpend' });
    try {
      const response = await AdminService.previewFixSpendExperience();
      const spendPreview = normalizeSpendPreview(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        spendPreview,
        spendPreviewAt: formatTimestamp(new Date()),
        spendResult: null,
        spendFinishedAt: ''
      });
      wx.showToast({
        title:
          spendPreview.memberCount > 0
            ? '扫描完成'
            : '未发现异常修为',
        icon: spendPreview.memberCount > 0 ? 'success' : 'none'
      });
    } catch (error) {
      console.error('[admin:data-cleanup:spend-scan]', error);
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

  async runSpendCleanup() {
    this.setData({ loading: true, loadingAction: 'cleanupSpend' });
    try {
      const response = await AdminService.fixSpendExperience();
      const spendResult = normalizeSpendResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        spendResult,
        spendFinishedAt: formatTimestamp(new Date()),
        spendPreview: null,
        spendPreviewAt: ''
      });
      wx.showToast({ title: '修正完成', icon: 'success' });
    } catch (error) {
      console.error('[admin:data-cleanup:spend-cleanup]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '修正失败，请稍后再试',
        icon: 'none'
      });
    }
  },

  async runTestCleanup() {
    this.setData({ loading: true, loadingAction: 'cleanupTest' });
    try {
      const response = await AdminService.cleanupTestMembers();
      const testResult = normalizeCleanupResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        testResult,
        testFinishedAt: formatTimestamp(new Date()),
        testPreview: null,
        testPreviewAt: ''
      });
      wx.showToast({ title: '测试账号清理完成', icon: 'success' });
    } catch (error) {
      console.error('[admin:data-cleanup:test]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '清理测试账号失败，请稍后再试',
        icon: 'none'
      });
    }
  },

  handleBattleScanTap() {
    if (this.data.loading) {
      return;
    }
    this.runBattleScan();
  },

  async runBattleScan() {
    this.setData({ loading: true, loadingAction: 'scanBattle' });
    try {
      const response = await AdminService.previewCleanupBattleRecords();
      const battlePreview = normalizePreviewResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        battlePreview,
        battlePreviewAt: formatTimestamp(new Date()),
        battleResult: null,
        battleFinishedAt: ''
      });
      wx.showToast({
        title: battlePreview.total > 0 ? '战斗记录扫描完成' : '未发现战斗记录',
        icon: battlePreview.total > 0 ? 'success' : 'none'
      });
    } catch (error) {
      console.error('[admin:data-cleanup:battle-scan]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '战斗记录扫描失败，请稍后再试',
        icon: 'none'
      });
    }
  },

  handleBattleCleanupTap() {
    if (this.data.loading) {
      return;
    }
    const battlePreview = this.data.battlePreview;
    if (!battlePreview || !Array.isArray(battlePreview.items) || !battlePreview.items.length) {
      wx.showToast({ title: '请先扫描战斗记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认清理所有战斗记录？',
      content: '系统将移除全部 PVE / PVP 战斗记录及衍生数据，该操作不可撤销。',
      confirmText: '确认清理',
      cancelText: '再考虑下',
      success: (res) => {
        if (res.confirm) {
          this.runBattleCleanup();
        }
      }
    });
  },

  async runBattleCleanup() {
    this.setData({ loading: true, loadingAction: 'cleanupBattle' });
    try {
      const response = await AdminService.cleanupBattleRecords();
      const battleResult = normalizeCleanupResult(response || {});
      this.setData({
        loading: false,
        loadingAction: '',
        battleResult,
        battleFinishedAt: formatTimestamp(new Date()),
        battlePreview: null,
        battlePreviewAt: ''
      });
      wx.showToast({ title: '战斗记录清理完成', icon: 'success' });
    } catch (error) {
      console.error('[admin:data-cleanup:battle]', error);
      this.setData({ loading: false, loadingAction: '' });
      wx.showToast({
        title:
          error && (error.errMsg || error.message)
            ? error.errMsg || error.message
            : '战斗记录清理失败，请稍后再试',
        icon: 'none'
      });
    }
  }
});
