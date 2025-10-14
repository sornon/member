import { AdminService } from '../../../services/api';
import { formatMemberDisplayName } from '../../../utils/format';
const { AVATAR_IMAGE_BASE_PATH } = require('../../../shared/asset-paths.js');

const PAGE_SIZE = 20;
const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;

Page({
  data: {
    keyword: '',
    members: [],
    loading: false,
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    finished: false,
    error: '',
    defaultAvatar: DEFAULT_AVATAR
  },

  onShow() {
    this.fetchMembers(true);
  },

  onPullDownRefresh() {
    this.fetchMembers(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.loading || this.data.finished) return;
    this.fetchMembers();
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' });
  },

  handleSearch() {
    this.fetchMembers(true);
  },

  async fetchMembers(reset = false) {
    const nextPage = reset ? 1 : this.data.page;
    this.setData({ loading: true, error: '' });
    try {
      const response = await AdminService.listMembers({
        keyword: this.data.keyword.trim(),
        page: nextPage,
        pageSize: this.data.pageSize
      });
      const incoming = (response.members || []).map((member) => ({
        ...member,
        displayName: formatMemberDisplayName(member.nickName, member.realName, '未命名会员')
      }));
      const merged = reset ? incoming : [...this.data.members, ...incoming];
      const total = response.total || merged.length;
      const finished = merged.length >= total || incoming.length < this.data.pageSize;
      this.setData({
        members: merged,
        total,
        page: nextPage + 1,
        finished,
        loading: false
      });
    } catch (error) {
      console.error('[admin:members:list]', error);
      this.setData({
        loading: false,
        error: error.errMsg || error.message || '加载失败'
      });
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    }
  },

  handleMemberTap(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin/member-detail/index?id=${id}` });
  }
});
