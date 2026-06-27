import { AdminService } from '../../../services/api';
import { formatMemberDisplayName } from '../../../utils/format';
const { AVATAR_IMAGE_BASE_PATH } = require('../../../shared/asset-paths.js');

const PAGE_SIZE = 20;
const DEFAULT_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;
const MEMBER_SORT_STORAGE_KEY = 'admin:members:sort';

function findMemberSortOption(options, value) {
  return options.find((option) => option.value === value) || options[0];
}

function readStoredMemberSort(options) {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return options[0];
  }
  try {
    const storedValue = wx.getStorageSync(MEMBER_SORT_STORAGE_KEY);
    return findMemberSortOption(options, storedValue || '');
  } catch (error) {
    console.warn('[admin:members:sort:read]', error);
    return options[0];
  }
}

function writeStoredMemberSort(value) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
    return;
  }
  try {
    wx.setStorageSync(MEMBER_SORT_STORAGE_KEY, value || '');
  } catch (error) {
    console.warn('[admin:members:sort:write]', error);
  }
}

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
    defaultAvatar: DEFAULT_AVATAR,
    memberSort: '',
    memberSortIndex: 0,
    memberSortOptions: [
      { value: '', label: '默认排序' },
      { value: 'rechargeDesc', label: '累计充值降序' },
      { value: 'createdAtDesc', label: '注册时间排序' },
      { value: 'updatedAtDesc', label: '上次登录时间排序' }
    ],
    memberSortLabel: '默认排序',
    sortDropdownVisible: false
  },

  onLoad() {
    const option = readStoredMemberSort(this.data.memberSortOptions);
    const index = this.data.memberSortOptions.findIndex((item) => item.value === option.value);
    this.setData({
      memberSort: option.value || '',
      memberSortIndex: index >= 0 ? index : 0,
      memberSortLabel: option.label || '默认排序'
    });
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

  handleMemberSortToggle() {
    this.setData({ sortDropdownVisible: !this.data.sortDropdownVisible });
  },

  handleMemberSortSelect(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const option = this.data.memberSortOptions[index] || this.data.memberSortOptions[0];
    const memberSort = option.value || '';
    const nextState = {
      sortDropdownVisible: false,
      memberSort,
      memberSortIndex: index,
      memberSortLabel: option.label || '默认排序'
    };
    if (memberSort === this.data.memberSort) {
      this.setData(nextState);
      writeStoredMemberSort(memberSort);
      return;
    }
    this.setData(nextState);
    writeStoredMemberSort(memberSort);
    this.fetchMembers(true);
  },

  async fetchMembers(reset = false) {
    const nextPage = reset ? 1 : this.data.page;
    this.setData({ loading: true, error: '', sortDropdownVisible: false });
    try {
      const response = await AdminService.listMembers({
        keyword: this.data.keyword.trim(),
        page: nextPage,
        pageSize: this.data.pageSize,
        sortBy: this.data.memberSort
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
    wx.navigateTo({ url: `/subpackages/admin/member-detail/index?id=${id}` });
  }
});
