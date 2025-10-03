import { AdminService } from '../../../services/api';
import { formatCurrency } from '../../../utils/format';

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

function decorateOrder(order) {
  if (!order) return null;
  const totalAmount = Number(order.totalAmount || 0);
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
  const stoneRewardLabel = `${Math.max(0, Math.floor(stoneReward))} 枚`;
  return {
    ...order,
    items,
    totalAmount,
    stoneReward,
    totalAmountLabel: formatCurrency(totalAmount),
    stoneRewardLabel,
    statusLabel: order.statusLabel || describeStatus(order.status),
    createdAtLabel: order.createdAtLabel || formatDateTime(order.createdAt),
    updatedAtLabel: order.updatedAtLabel || formatDateTime(order.updatedAt),
    confirmedAtLabel: order.confirmedAtLabel || formatDateTime(order.confirmedAt)
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
      remark: ''
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
      const memberInfo = {
        _id: targetOrder.memberId,
        nickName: targetOrder.memberName || memberSnapshot.nickName || '',
        mobile: targetOrder.memberMobile || memberSnapshot.mobile || '',
        levelName: targetOrder.memberLevelName || '',
        balanceLabel: targetOrder.memberBalanceLabel || ''
      };
      this.openForceChargeDialog(id, {
        selectedMemberId: targetOrder.memberId,
        memberLocked: true,
        memberInfo
      });
      return;
    }
    this.openForceChargeDialog(id);
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
        remark: options.remark || ''
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
        remark: ''
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
            mobile: member.mobile || '',
            levelName: member.levelName || '',
            balanceLabel: formatCurrency(member.cashBalance)
          }))
        : [];
      const currentSelected = this.data.forceChargeDialog.selectedMemberId || '';
      const stillExists = currentSelected && results.some((member) => member._id === currentSelected);
      this.setData({
        'forceChargeDialog.results': results,
        'forceChargeDialog.loading': false,
        'forceChargeDialog.selectedMemberId': stillExists ? currentSelected : ''
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

  async forceChargeOrder(orderId, memberId = '', remark = '') {
    if (!orderId || this.data.forceChargingId === orderId) {
      return;
    }
    this.setData({ forceChargingId: orderId });
    try {
      const normalizedRemark = typeof remark === 'string' ? remark.trim() : '';
      const result = await AdminService.forceChargeOrder(orderId, { memberId, remark: normalizedRemark });
      const stoneReward = Number(result && result.stoneReward ? result.stoneReward : 0);
      const message = stoneReward > 0 ? `扣款成功，灵石+${Math.floor(stoneReward)}` : '扣款成功';
      wx.showToast({ title: message, icon: 'success' });
      this.closeForceChargeDialog();
      await this.loadOrders({ reset: true });
    } catch (error) {
      const message =
        (error && (error.errMsg || error.message))
          ? String(error.errMsg || error.message)
          : '扣款失败';
      wx.showToast({
        title: message.length > 14 ? `${message.slice(0, 13)}…` : message,
        icon: 'none'
      });
    } finally {
      this.setData({ forceChargingId: '' });
    }
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
