import { AdminService } from '../../../services/api';

function ensureMemberRole(roles) {
  const list = Array.isArray(roles) ? [...new Set(roles)] : [];
  if (!list.includes('member')) {
    list.push('member');
  }
  return list;
}

Page({
  data: {
    memberId: '',
    loading: true,
    saving: false,
    member: null,
    levels: [],
    levelIndex: 0,
    currentLevelName: '',
    roleOptions: [
      { value: 'member', label: '会员' },
      { value: 'admin', label: '管理员' },
      { value: 'developer', label: '开发' }
    ],
    form: {
      nickName: '',
      mobile: '',
      experience: '',
      cashBalance: '',
      stoneBalance: '',
      levelId: '',
      roles: []
    },
    rechargeVisible: false,
    rechargeAmount: ''
  },

  onLoad(options) {
    const { id } = options;
    if (!id) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    this.setData({ memberId: id });
    this.loadMember(id);
  },

  onPullDownRefresh() {
    if (!this.data.memberId) return;
    this.loadMember(this.data.memberId).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadMember(memberId) {
    this.setData({ loading: true });
    try {
      const detail = await AdminService.getMemberDetail(memberId);
      this.applyDetail(detail);
    } catch (error) {
      console.error('[admin:member:detail]', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || error.message || '加载失败', icon: 'none' });
    }
  },

  applyDetail(detail) {
    if (!detail || !detail.member) return;
    const { member, levels = [] } = detail;
    const levelIndex = Math.max(
      levels.findIndex((level) => level._id === member.levelId),
      0
    );
    const currentLevel = levels[levelIndex] || levels[0] || { _id: '', name: '' };
    this.setData({
      member,
      levels,
      levelIndex,
      currentLevelName: currentLevel.name || '',
      loading: false,
      form: {
        nickName: member.nickName || '',
        mobile: member.mobile || '',
        experience: String(member.experience ?? 0),
        cashBalance: this.formatYuan(member.cashBalance ?? member.balance ?? 0),
        stoneBalance: String(member.stoneBalance ?? 0),
        levelId: member.levelId || currentLevel._id || '',
        roles: ensureMemberRole(member.roles)
      }
    });
  },

  handleInputChange(event) {
    const { field } = event.currentTarget.dataset;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  handleLevelChange(event) {
    const index = Number(event.detail.value);
    const level = this.data.levels[index];
    if (!level) return;
    this.setData({
      levelIndex: index,
      currentLevelName: level.name || '',
      'form.levelId': level._id
    });
  },

  handleRolesChange(event) {
    const roles = event.detail.value || [];
    if (!roles.includes('member')) {
      roles.push('member');
    }
    this.setData({ 'form.roles': roles });
  },

  async handleSubmit() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const payload = {
        nickName: (this.data.form.nickName || '').trim(),
        mobile: (this.data.form.mobile || '').trim(),
        experience: Number(this.data.form.experience || 0),
        cashBalance: this.parseYuanToFen(this.data.form.cashBalance),
        stoneBalance: Number(this.data.form.stoneBalance || 0),
        levelId: this.data.form.levelId,
        roles: ensureMemberRole(this.data.form.roles)
      };
      const detail = await AdminService.updateMember(this.data.memberId, payload);
      this.applyDetail(detail);
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      console.error('[admin:member:update]', error);
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  showRechargeDialog() {
    this.setData({ rechargeVisible: true, rechargeAmount: '' });
  },

  hideRechargeDialog() {
    this.setData({ rechargeVisible: false, rechargeAmount: '' });
  },

  handleRechargeInput(event) {
    this.setData({ rechargeAmount: event.detail.value });
  },

  async handleRechargeConfirm() {
    if (!this.data.memberId) return;
    const amountFen = this.parseYuanToFen(this.data.rechargeAmount);
    if (!amountFen || amountFen <= 0) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '充值中', mask: true });
    try {
      const detail = await AdminService.rechargeMember(this.data.memberId, amountFen);
      this.applyDetail(detail);
      wx.showToast({ title: '充值成功', icon: 'success' });
      this.hideRechargeDialog();
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '充值失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  formatYuan(fen) {
    const value = Number(fen || 0);
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return (value / 100).toFixed(2);
  },

  parseYuanToFen(input) {
    if (input == null || input === '') {
      return 0;
    }
    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return Math.round(numeric * 100);
    }
    if (typeof input === 'string') {
      const sanitized = input.trim().replace(/[^0-9.-]/g, '');
      const parsed = Number(sanitized);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    }
    return 0;
  }
});
