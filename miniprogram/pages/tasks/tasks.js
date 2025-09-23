import { TaskService } from '../../services/api';

Page({
  data: {
    loading: true,
    tasks: []
  },

  onShow() {
    this.fetchTasks();
  },

  async fetchTasks() {
    this.setData({ loading: true });
    try {
      const tasks = await TaskService.list();
      this.setData({ tasks, loading: false });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  async handleClaim(event) {
    const { taskId } = event.currentTarget.dataset;
    wx.showLoading({ title: '领取中', mask: true });
    try {
      const result = await TaskService.claim(taskId);
      wx.showToast({ title: result.message || '领取成功', icon: 'success' });
      this.fetchTasks();
    } catch (error) {
      // 错误提示在 api 层处理
    } finally {
      wx.hideLoading();
    }
  }
});
