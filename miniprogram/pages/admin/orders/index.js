import { AdminService } from '../../../services/api';
import { formatCurrency, formatMemberDisplayName } from '../../../utils/format';

function formatDateTime(value) {
  if (!value) return '';
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (error) {
      date = null;
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mm}`;
}

function describeStatus(status) {
  switch (status) {
    case 'paid':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已过期';
    default:
      return '待支付';
  }
}

function normalizePriceAdjustmentInfo(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const previousAmount = Number(record.previousAmount || 0);
  const newAmount = Number(record.newAmount || record.amount || 0);
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    return null;
  }
  const remark = typeof record.remark === 'string' ? record.remark : '';
  const adjustedAt = record.adjustedAt || record.updatedAt || null;
  return {
    previousAmount,
    newAmount,
    remark,
    adjustedAt,
    adjustedAtLabel: formatDateTime(adjustedAt)
  };
}

const DRINK_VOUCHER_RIGHT_ID = 'right_realm_qi_drink';
const CUBANEY_VOUCHER_RIGHT_ID = 'right_realm_core_cubaney_voucher';

function parseAmountInputToFen(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const sanitized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!sanitized) {
    return 0;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function formatAmountInputFromFen(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  return (numeric / 100).toFixed(2);
}

function showConfirmDialog({ title = '提示', content = '', confirmText = '确定' } = {}) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText: '取消',
      success: (res) => resolve(res || { confirm: false, cancel: true }),
      fail: () => resolve({ confirm: false, cancel: true })
    });
  });
}

function parseInsufficientBalanceError(error) {
  if (!error) {
    return null;
  }
  const code = typeof error.code === 'string' ? error.code : typeof error.errCode === 'string' ? error.errCode : '';
  const message = typeof error.message === 'string' ? error.message : '';
  const errMsg = typeof error.errMsg === 'string' ? error.errMsg : '';
  const combinedMessage = `${message} ${errMsg}`;
  if (!code && !combinedMessage.includes('会员余额不足')) {
    return null;
  }
  if (code && code.toUpperCase() !== 'INSUFFICIENT_BALANCE' && !combinedMessage.includes('会员余额不足')) {
    return null;
  }
  const extra =
    (error.details && typeof error.details === 'object' ? error.details : null) ||
    (error.data && typeof error.data === 'object' ? error.data : null) ||
    (error.extra && typeof error.extra === 'object' ? error.extra : null) ||
    {};
  const parseNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  };
  const shortage = parseNumber(extra.shortage || error.shortage || extra.shortfall);
  const amount = parseNumber(extra.amount || error.amount);
  const balance = parseNumber(extra.balance || extra.balanceBefore || error.balance);
  const balanceAfter = parseNumber(
    extra.balanceAfter || error.balanceAfter || (Number.isFinite(balance) && Number.isFinite(amount) ? balance - amount : NaN)
  );
  return {
    shortage: Number.isFinite(shortage) ? Math.max(shortage, 0) : NaN,
    amount: Number.isFinite(amount) ? amount : NaN,
    balance: Number.isFinite(balance) ? balance : NaN,
    balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : NaN
  };
}

function buildForceChargeDebtModalContent({ amount, balance, balanceAfter, shortage }) {
  const lines = [];
  if (Number.isFinite(balance)) {
    lines.push(`当前余额：${formatCurrency(balance)}`);
  }
  if (Number.isFinite(amount)) {
    lines.push(`扣款金额：${formatCurrency(amount)}`);
  }
  if (Number.isFinite(balanceAfter)) {
    lines.push(`扣款后余额：${formatCurrency(balanceAfter)}`);
  }
  if (Number.isFinite(shortage) && shortage > 0) {
    lines.push(`仍差：${formatCurrency(shortage)}`);
  }
  lines.push('确认扣款后将产生欠款，是否继续？');
  return lines.join('\n');
}

function decorateOrder(order) {
  if (!order) return null;
  const totalAmount = Number(order.totalAmount || 0);
  const priceAdjustment = normalizePriceAdjustmentInfo(order.priceAdjustment);
  const originalTotalAmount = Number(order.originalTotalAmount || 0) ||
    (priceAdjustment ? Number(priceAdjustment.previousAmount || 0) : 0);
  const priceAdjusted = !!priceAdjustment &&
    ((Number.isFinite(priceAdjustment.previousAmount) && priceAdjustment.previousAmount !== priceAdjustment.newAmount) ||
      (Number.isFinite(originalTotalAmount) && originalTotalAmount > 0 && originalTotalAmount !== totalAmount));
  const priceAdjustmentRemark = priceAdjustment
    ? priceAdjustment.remark
    : typeof order.priceAdjustmentRemark === 'string'
    ? order.priceAdjustmentRemark
    : '';
  const stoneReward = Number(order.stoneReward || 0);
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const price = Number(item.price || 0);
        const quantity = Number(item.quantity || 0);
        const amount = Number(item.amount || price * quantity || 0);
        return {
          ...item,
          priceLabel: formatCurrency(price),
          amountLabel: formatCurrency(amount)
        };
      })
    : [];
  const appliedRightsRaw = Array.isArray(order.appliedRights) ? order.appliedRights : [];
  const appliedRights = appliedRightsRaw
    .map((entry) => {
      const amount = Number(entry.amount || 0);
      return {
        memberRightId: entry.memberRightId || '',
        rightId: entry.rightId || '',
        type: entry.type || '',
        title: entry.title || entry.name || '权益',
        amount,
        amountLabel: formatCurrency(amount)
      };
    })
    .filter((entry) => entry.title);
  let discountTotal = Number(order.discountTotal || 0);
  if ((!Number.isFinite(discountTotal) || discountTotal <= 0) && appliedRights.length) {
    discountTotal = appliedRights.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  }
  const discountTotalLabel = discountTotal > 0 ? formatCurrency(discountTotal) : '';
  const drinkVoucherApplied = appliedRights.some(
    (entry) => entry.type === 'drinkVoucher' || entry.rightId === DRINK_VOUCHER_RIGHT_ID
  );
  const cubaneyVoucherApplied = appliedRights.some(
    (entry) => entry.type === 'cubaneyVoucher' || entry.rightId === CUBANEY_VOUCHER_RIGHT_ID
  );
  const voucherBadges = [];
  if (drinkVoucherApplied) {
    voucherBadges.push('饮品券已使用');
  }
  if (cubaneyVoucherApplied) {
    voucherBadges.push('古巴邑券已使用');
  }
  const stoneRewardLabel = `${Math.max(0, Math.floor(stoneReward))} 枚`;
  const memberDisplayName = formatMemberDisplayName(
    typeof order.memberName === 'string' ? order.memberName : '',
    typeof order.memberRealName === 'string' ? order.memberRealName : '',
    typeof order.memberName === 'string' && order.memberName ? order.memberName : ''
  );
  return {
    ...order,
    items,
    totalAmount,
    stoneReward,
    totalAmountLabel: formatCurrency(totalAmount),
    stoneRewardLabel,
    originalTotalAmount,
    originalTotalAmountLabel: originalTotalAmount ? formatCurrency(originalTotalAmount) : '',
    priceAdjusted,
    priceAdjustmentRemark,
    priceAdjustmentUpdatedAtLabel: priceAdjustment ? priceAdjustment.adjustedAtLabel : '',
    statusLabel: order.statusLabel || describeStatus(order.status),
    createdAtLabel: order.createdAtLabel || formatDateTime(order.createdAt),
    updatedAtLabel: order.updatedAtLabel || formatDateTime(order.updatedAt),
    confirmedAtLabel: order.confirmedAtLabel || formatDateTime(order.confirmedAt),
    memberDisplayName,
    appliedRights,
    discountTotal,
    discountTotalLabel,
    drinkVoucherApplied,
    cubaneyVoucherApplied,
    voucherBadges
  };
}

Page({
  data: {
    keyword: '',
    orders: [],
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    refreshing: false,
    forceChargingId: '',
    forceChargeDialog: {
      visible: false,
      orderId: '',
      keyword: '',
      results: [],
      loading: false,
      selectedMemberId: '',
      error: '',
      memberLocked: false,
      memberInfo: null,
      remark: '',
      memberCache: {}
    },
    priceAdjustingId: '',
    cancelingId: '',
    priceAdjustDialog: {
      visible: false,
      orderId: '',
      amountInput: '',
      remark: '',
      error: '',
      originalAmountLabel: '',
      currentAmountLabel: ''
    }
  },

  onShow() {
    this.loadOrders({ reset: true });
  },

  handleStatusTap(event) {
    const { id, status } = event.currentTarget.dataset || {};
    if (!id) return;
    if (status !== 'pending' && status !== 'created') {
      return;
    }
    wx.navigateTo({
      url: `/pages/admin/charge/index?orderId=${encodeURIComponent(id)}`
    });
  },

  async loadOrders({ reset = false, page = null } = {}) {
    if (this.data.loading) return;
    const targetPage = page || (reset ? 1 : this.data.page);
    const previousOrders = reset ? [] : this.data.orders;
    if (reset) {
      this.setData({ loading: true, refreshing: true, page: 1, orders: [] });
    } else {
      this.setData({ loading: true });
    }
    try {
      const response = await AdminService.listChargeOrders({
        page: targetPage,
        pageSize: this.data.pageSize,
        keyword: (this.data.keyword || '').trim()
      });
      const fetched = (response.orders || []).map(decorateOrder);
      this.setData({
        loading: false,
        refreshing: false,
        page: response.page || targetPage,
        pageSize: response.pageSize || this.data.pageSize,
        total: response.total || 0,
        orders: reset ? fetched : previousOrders.concat(fetched)
      });
    } catch (error) {
      this.setData({ loading: false, refreshing: false });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async handleForceChargeTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.forceChargingId) {
      return;
    }
    const targetOrder = this.data.orders.find((item) => item && item._id === id);
    if (!targetOrder) {
      return;
    }
    if (targetOrder.memberId) {
      const memberSnapshot = targetOrder.memberSnapshot || {};
      const balanceBeforeValue = targetOrder.balanceBefore;
      const hasBalanceBefore = typeof balanceBeforeValue === 'number' && Number.isFinite(balanceBeforeValue);
      const fallbackBalanceLabel =
        targetOrder.memberBalanceLabel || targetOrder.balanceBeforeLabel || '';
      const memberInfo = {
        _id: targetOrder.memberId,
        nickName: targetOrder.memberName || memberSnapshot.nickName || '',
        realName: targetOrder.memberRealName || memberSnapshot.realName || '',
        displayName: formatMemberDisplayName(
          targetOrder.memberName || memberSnapshot.nickName || '',
          targetOrder.memberRealName || memberSnapshot.realName || '',
          targetOrder.memberName || memberSnapshot.nickName || ''
        ),
        mobile: targetOrder.memberMobile || memberSnapshot.mobile || '',
        levelName: targetOrder.memberLevelName || '',
        balanceLabel: hasBalanceBefore ? formatCurrency(balanceBeforeValue) : fallbackBalanceLabel,
        cashBalance: hasBalanceBefore ? balanceBeforeValue : null
      };
      this.openForceChargeDialog(id, {
        selectedMemberId: targetOrder.memberId,
        memberLocked: true,
        memberInfo
      });
      this.setData({
        [`forceChargeDialog.memberCache.${targetOrder.memberId}`]: memberInfo
      });
      this.ensureForceChargeMemberDetail(targetOrder.memberId);
      return;
    }
    this.openForceChargeDialog(id);
  },

  async handleCancelOrderTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id || this.data.cancelingId) {
      return;
    }
    const targetOrder = this.data.orders.find((item) => item && item._id === id);
    if (!targetOrder || !['pending', 'created'].includes(targetOrder.status)) {
      return;
    }
    const confirmResult = await showConfirmDialog({
      title: '取消订单',
      content: '确认取消该订单？',
      confirmText: '取消订单'
    });
    if (!confirmResult.confirm) {
      return;
    }
    this.setData({ cancelingId: id });
    try {
      await AdminService.cancelChargeOrder(id, { remark: '' });
      wx.showToast({ title: '订单已取消', icon: 'success' });
      await this.loadOrders({ reset: true });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message)) ? String(error.errMsg || error.message) : '取消失败';
      const shortMessage = message.length > 14 ? `${message.slice(0, 13)}…` : message;
      wx.showToast({ title: shortMessage, icon: 'none' });
    } finally {
      this.setData({ cancelingId: '' });
    }
  },

  handleOpenPriceAdjustDialog(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const targetOrder = this.data.orders.find((item) => item && item._id === id);
    if (!targetOrder) {
      return;
    }
    const amountInput = formatAmountInputFromFen(targetOrder.totalAmount);
    const originalAmount = targetOrder.originalTotalAmount || targetOrder.totalAmount;
    const originalAmountLabel = formatCurrency(originalAmount || targetOrder.totalAmount);
    const currentAmountLabel = formatCurrency(targetOrder.totalAmount || 0);
    this.setData({
      priceAdjustDialog: {
        visible: true,
        orderId: id,
        amountInput,
        remark: targetOrder.priceAdjustmentRemark || '',
        error: '',
        originalAmountLabel,
        currentAmountLabel
      }
    });
  },

  closePriceAdjustDialog() {
    if (!this.data.priceAdjustDialog.visible) {
      return;
    }
    this.setData({
      priceAdjustDialog: {
        visible: false,
        orderId: '',
        amountInput: '',
        remark: '',
        error: '',
        originalAmountLabel: '',
        currentAmountLabel: ''
      }
    });
  },

  handlePriceAdjustAmountInput(event) {
    this.setData({
      'priceAdjustDialog.amountInput': event.detail && typeof event.detail.value === 'string' ? event.detail.value : ''
    });
  },

  handlePriceAdjustRemarkInput(event) {
    this.setData({
      'priceAdjustDialog.remark': event.detail && typeof event.detail.value === 'string' ? event.detail.value : ''
    });
  },

  async handleConfirmPriceAdjust() {
    if (this.data.priceAdjustingId) {
      return;
    }
    const { orderId, amountInput, remark } = this.data.priceAdjustDialog;
    if (!orderId) {
      return;
    }
    const amount = parseAmountInputToFen(amountInput);
    if (!amount || amount <= 0) {
      this.setData({ 'priceAdjustDialog.error': '请输入有效金额' });
      return;
    }
    this.setData({ priceAdjustingId: orderId, 'priceAdjustDialog.error': '' });
    try {
      await AdminService.adjustChargeOrder(orderId, { amount, remark: (remark || '').trim() });
      wx.showToast({ title: '改价成功', icon: 'success' });
      this.closePriceAdjustDialog();
      await this.loadOrders({ reset: true });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message)) ? String(error.errMsg || error.message) : '改价失败';
      const shortMessage = message.length > 14 ? `${message.slice(0, 13)}…` : message;
      this.setData({ 'priceAdjustDialog.error': shortMessage });
      wx.showToast({ title: shortMessage, icon: 'none' });
    } finally {
      this.setData({ priceAdjustingId: '' });
    }
  },

  openForceChargeDialog(orderId, options = {}) {
    this.setData({
      forceChargeDialog: {
        visible: true,
        orderId,
        keyword: '',
        results: [],
        loading: false,
        selectedMemberId: options.selectedMemberId || '',
        error: '',
        memberLocked: !!options.memberLocked,
        memberInfo: options.memberInfo || null,
        remark: options.remark || '',
        memberCache:
          (options.memberCache && typeof options.memberCache === 'object'
            ? options.memberCache
            : {}) || {}
      }
    });
  },

  closeForceChargeDialog() {
    if (!this.data.forceChargeDialog.visible) {
      return;
    }
    this.setData({
      forceChargeDialog: {
        visible: false,
        orderId: '',
        keyword: '',
        results: [],
        loading: false,
        selectedMemberId: '',
        error: '',
        memberLocked: false,
        memberInfo: null,
        remark: '',
        memberCache: {}
      }
    });
  },

  handleForceChargeMemberInput(event) {
    if (this.data.forceChargeDialog.memberLocked) {
      return;
    }
    this.setData({
      'forceChargeDialog.keyword': event.detail.value || ''
    });
  },

  handleForceChargeMemberSearch() {
    if (this.data.forceChargeDialog.memberLocked) {
      return;
    }
    this.fetchForceChargeMembers();
  },

  handleSelectForceChargeMember(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    this.setData({ 'forceChargeDialog.selectedMemberId': id });
    this.ensureForceChargeMemberDetail(id);
  },

  handleConfirmForceChargeWithMember() {
    const { orderId, selectedMemberId, memberLocked, memberInfo, remark } = this.data.forceChargeDialog;
    if (!orderId) {
      return;
    }
    const targetMemberId = memberLocked && memberInfo ? memberInfo._id : selectedMemberId;
    if (!targetMemberId) {
      wx.showToast({ title: '请先选择会员', icon: 'none' });
      return;
    }
    this.forceChargeOrder(orderId, targetMemberId, remark);
  },

  async fetchForceChargeMembers() {
    if (this.data.forceChargeDialog.memberLocked) {
      return;
    }
    const keyword = (this.data.forceChargeDialog.keyword || '').trim();
    const orderId = this.data.forceChargeDialog.orderId;
    if (!orderId) {
      return;
    }
    this.setData({
      'forceChargeDialog.loading': true,
      'forceChargeDialog.error': ''
    });
    try {
      const response = await AdminService.listMembers({ keyword, page: 1, pageSize: 20 });
      const results = Array.isArray(response.members)
        ? response.members.map((member) => ({
            _id: member._id,
            nickName: member.nickName || '',
            realName: member.realName || '',
            displayName: formatMemberDisplayName(member.nickName, member.realName, '未命名'),
            mobile: member.mobile || '',
            levelName: member.levelName || '',
            cashBalance: (() => {
              const numeric = Number(member.cashBalance);
              return Number.isFinite(numeric) ? numeric : null;
            })(),
            balanceLabel: formatCurrency(member.cashBalance)
          }))
        : [];
      const currentSelected = this.data.forceChargeDialog.selectedMemberId || '';
      const stillExists = currentSelected && results.some((member) => member._id === currentSelected);
      const memberCache = { ...(this.data.forceChargeDialog.memberCache || {}) };
      results.forEach((member) => {
        memberCache[member._id] = {
          _id: member._id,
          nickName: member.nickName,
          realName: member.realName,
          displayName: member.displayName,
          mobile: member.mobile,
          levelName: member.levelName,
          cashBalance: member.cashBalance,
          balanceLabel: member.balanceLabel
        };
      });
      this.setData({
        'forceChargeDialog.results': results,
        'forceChargeDialog.loading': false,
        'forceChargeDialog.selectedMemberId': stillExists ? currentSelected : '',
        'forceChargeDialog.memberCache': memberCache
      });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '搜索失败';
      this.setData({
        'forceChargeDialog.loading': false,
        'forceChargeDialog.error': message
      });
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    }
  },

  handleForceChargeRemarkInput(event) {
    this.setData({ 'forceChargeDialog.remark': event.detail.value || '' });
  },

  async forceChargeOrder(orderId, memberId = '', remark = '', options = {}) {
    if (!orderId || this.data.forceChargingId === orderId) {
      return;
    }
    const normalizedRemark = typeof remark === 'string' ? remark.trim() : '';
    if (!options.allowNegativeBalance && !options.skipDebtPrecheck) {
      const preview = await this.getForceChargeDebtPreview(orderId, memberId);
      if (
        preview &&
        Number.isFinite(preview.shortage) &&
        preview.shortage > 0 &&
        Number.isFinite(preview.amount)
      ) {
        const confirmResult = await showConfirmDialog({
          title: '余额不足',
          content: buildForceChargeDebtModalContent(preview),
          confirmText: '仍要扣款'
        });
        if (!confirmResult || !confirmResult.confirm) {
          return;
        }
        return this.forceChargeOrder(orderId, memberId, remark, {
          ...options,
          allowNegativeBalance: true,
          skipDebtPrecheck: true
        });
      }
    }

    this.setData({ forceChargingId: orderId });
    let retryWithNegativeBalance = false;
    try {
      const result = await AdminService.forceChargeOrder(orderId, {
        memberId,
        remark: normalizedRemark,
        allowNegativeBalance: !!options.allowNegativeBalance
      });
      const stoneReward = Number(result && result.stoneReward ? result.stoneReward : 0);
      const balanceAfter = Number(result && typeof result.balanceAfter !== 'undefined' ? result.balanceAfter : NaN);
      let message = stoneReward > 0 ? `扣款成功，灵石+${Math.floor(stoneReward)}` : '扣款成功';
      const balanceAfterLabel = Number.isFinite(balanceAfter) ? formatCurrency(balanceAfter) : '';
      if (Number.isFinite(balanceAfter) && balanceAfter < 0) {
        message = `${message}（余额${balanceAfterLabel}）`;
      }
      wx.showToast({ title: message, icon: 'success' });
      if (memberId && Number.isFinite(balanceAfter)) {
        const setPayload = {
          [`forceChargeDialog.memberCache.${memberId}.cashBalance`]: balanceAfter,
          [`forceChargeDialog.memberCache.${memberId}.balanceLabel`]: balanceAfterLabel
        };
        if (
          this.data.forceChargeDialog.memberLocked &&
          this.data.forceChargeDialog.memberInfo &&
          this.data.forceChargeDialog.memberInfo._id === memberId
        ) {
          setPayload['forceChargeDialog.memberInfo'] = {
            ...this.data.forceChargeDialog.memberInfo,
            cashBalance: balanceAfter,
            balanceLabel: balanceAfterLabel
          };
        }
        this.setData(setPayload);
      }
      this.closeForceChargeDialog();
      await this.loadOrders({ reset: true });
      return result;
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '扣款失败';
      const insufficientInfo = parseInsufficientBalanceError(error);
      if (insufficientInfo && !options.allowNegativeBalance) {
        const fallbackPreview = await this.getForceChargeDebtPreview(orderId, memberId);
        const dialogData = {
          amount: Number.isFinite(insufficientInfo.amount)
            ? insufficientInfo.amount
            : fallbackPreview && Number.isFinite(fallbackPreview.amount)
            ? fallbackPreview.amount
            : insufficientInfo.amount,
          balance: Number.isFinite(insufficientInfo.balance)
            ? insufficientInfo.balance
            : fallbackPreview && Number.isFinite(fallbackPreview.balance)
            ? fallbackPreview.balance
            : insufficientInfo.balance,
          balanceAfter: Number.isFinite(insufficientInfo.balanceAfter)
            ? insufficientInfo.balanceAfter
            : fallbackPreview && Number.isFinite(fallbackPreview.balanceAfter)
            ? fallbackPreview.balanceAfter
            : insufficientInfo.balanceAfter,
          shortage: Number.isFinite(insufficientInfo.shortage)
            ? insufficientInfo.shortage
            : fallbackPreview && Number.isFinite(fallbackPreview.shortage)
            ? fallbackPreview.shortage
            : insufficientInfo.shortage
        };
        const confirmResult = await showConfirmDialog({
          title: '余额不足',
          content: buildForceChargeDebtModalContent(dialogData),
          confirmText: '仍要扣款'
        });
        if (confirmResult && confirmResult.confirm) {
          retryWithNegativeBalance = true;
        }
      } else {
        wx.showToast({
          title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
          icon: 'none'
        });
      }
    } finally {
      this.setData({ forceChargingId: '' });
    }
    if (retryWithNegativeBalance) {
      return this.forceChargeOrder(orderId, memberId, remark, {
        allowNegativeBalance: true,
        skipDebtPrecheck: true
      });
    }
  },

  async ensureForceChargeMemberDetail(memberId) {
    if (!memberId) {
      return null;
    }
    const dialog = this.data.forceChargeDialog || {};
    const cache = dialog.memberCache || {};
    const cached = cache[memberId];
    if (cached && Number.isFinite(cached.cashBalance)) {
      return cached;
    }
    try {
      const detail = await AdminService.getMemberDetail(memberId);
      const member = detail && detail.member ? detail.member : null;
      if (!member) {
        return cached || null;
      }
      const resolvedNickName =
        (member.nickName && typeof member.nickName === 'string' ? member.nickName : '') ||
        (cached && cached.nickName ? cached.nickName : '');
      const resolvedRealName =
        (member.realName && typeof member.realName === 'string' ? member.realName : '') ||
        (cached && cached.realName ? cached.realName : '');
      const candidateBalances = [member.cashBalance, member.balance, cached && cached.cashBalance];
      let normalizedBalance = null;
      for (const candidate of candidateBalances) {
        if (candidate === null || typeof candidate === 'undefined' || candidate === '') {
          continue;
        }
        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) {
          normalizedBalance = numeric;
          break;
        }
      }
      const info = {
        _id: memberId,
        nickName: resolvedNickName,
        realName: resolvedRealName,
        displayName: formatMemberDisplayName(
          resolvedNickName,
          resolvedRealName,
          (cached && (cached.displayName || cached.nickName || cached.realName)) || '未命名'
        ),
        mobile:
          (member.mobile && typeof member.mobile === 'string' ? member.mobile : '') ||
          (cached && cached.mobile ? cached.mobile : ''),
        levelName: '',
        cashBalance: Number.isFinite(normalizedBalance) ? normalizedBalance : null,
        balanceLabel: Number.isFinite(normalizedBalance)
          ? formatCurrency(normalizedBalance)
          : (cached && cached.balanceLabel) || ''
      };
      const updatePayload = {
        [`forceChargeDialog.memberCache.${memberId}`]: info
      };
      if (
        dialog.memberLocked &&
        dialog.memberInfo &&
        dialog.memberInfo._id === memberId
      ) {
        updatePayload['forceChargeDialog.memberInfo'] = {
          ...dialog.memberInfo,
          nickName: info.nickName || dialog.memberInfo.nickName || '',
          realName: info.realName || dialog.memberInfo.realName || '',
          mobile: info.mobile || dialog.memberInfo.mobile || '',
          levelName:
            Object.prototype.hasOwnProperty.call(info, 'levelName')
              ? info.levelName
              : dialog.memberInfo.levelName || '',
          displayName: info.displayName || dialog.memberInfo.displayName || '',
          cashBalance: info.cashBalance,
          balanceLabel: info.balanceLabel
        };
      }
      this.setData(updatePayload);
      return info;
    } catch (error) {
      return cached || null;
    }
  },

  async getForceChargeDebtPreview(orderId, memberId) {
    if (!orderId || !memberId) {
      return null;
    }
    const order = this.data.orders.find((item) => item && item._id === orderId);
    if (!order) {
      return null;
    }
    const amount = Number(order.totalAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    const dialog = this.data.forceChargeDialog || {};
    const cache = dialog.memberCache || {};
    let record = null;
    if (
      dialog.memberLocked &&
      dialog.memberInfo &&
      dialog.memberInfo._id === memberId &&
      Number.isFinite(dialog.memberInfo.cashBalance)
    ) {
      record = dialog.memberInfo;
    }
    if (!record && cache[memberId] && Number.isFinite(cache[memberId].cashBalance)) {
      record = cache[memberId];
    }
    if (!record) {
      record = await this.ensureForceChargeMemberDetail(memberId);
    }
    if (!record || !Number.isFinite(record.cashBalance)) {
      return { amount };
    }
    const balance = Number(record.cashBalance);
    const balanceAfter = balance - amount;
    const shortage = amount - balance;
    return {
      amount,
      balance,
      balanceAfter,
      shortage
    };
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' });
  },

  handleSearch() {
    this.loadOrders({ reset: true });
  },

  handleResetFilters() {
    if (!this.data.keyword) {
      this.loadOrders({ reset: true });
      return;
    }
    this.setData({ keyword: '' });
    this.loadOrders({ reset: true });
  },

  onPullDownRefresh() {
    this.loadOrders({ reset: true });
  },

  onReachBottom() {
    if (this.data.loading) return;
    if (this.data.orders.length >= this.data.total) {
      return;
    }
    const nextPage = this.data.page + 1;
    this.loadOrders({ page: nextPage });
  }
});
