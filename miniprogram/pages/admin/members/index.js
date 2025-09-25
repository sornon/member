import { AdminService } from '../../../services/api';

const PAGE_SIZE = 20;
const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZi' +
  'xzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjUwJSIgeTE9IjAlIiB4Mj0iNTAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0' +
  'b3AtY29sb3I9IiMxZTMyNTIiIHN0b3Atb3BhY2l0eT0iMC44Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzE0MjA0MCIgc3RvcC1vcG' +
  'FjaXR5PSIwLjkiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImZhY2UiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9' +
  'IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2Y4OTI1YyIgc3RvcC1vcGFjaXR5PSIwLjgiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMD' +
  'AlIiBzdG9wLWNvbG9yPSIjZjE0ZjdiIiBzdG9wLW9wYWNpdHk9IjAuNiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPGNpcmNsZSBjeD0iNjAi' +
  'IGN5PSI2MCIgcj0iNTgiIGZpbGw9InVybCgjYmcpIi8+CiAgPGNpcmNsZSBjeD0iNjAiIGN5PSI0OCIgcj0iMjIiIGZpbGw9IiNmZmYiLz4KICA8cGF0aCBkPSJNM' +
  'zAgOTAgUTYwIDcwIDkwIDkwIiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZmFjZSkiIHN0cm9rZS13aWR0aD0iMTAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo' +
  '8L3N2Zz4=';

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

  onLoad() {
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
      const incoming = response.members || [];
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
