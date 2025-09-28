import { MemberService, ReservationService } from '../../services/api';
import { formatDate } from '../../utils/format';

Page({
  data: {
    loading: true,
    rights: [],
    member: null,
    redeemingRightId: ''
  },

  onShow() {
    this.fetchRights();
  },

  async fetchRights() {
    this.setData({ loading: true });
    try {
      const [member, rights] = await Promise.all([
        MemberService.getMember(),
        MemberService.getRights()
      ]);
      this.setData({
        loading: false,
        member,
        rights: rights || [],
        redeemingRightId: ''
      });
    } catch (error) {
      this.setData({ loading: false, redeemingRightId: '' });
    }
  },

  formatDate,

  handleReserve(event) {
    const { rightId } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/reservation/reservation?rightId=${rightId}`
    });
  },

  async handleRedeemUsage(event) {
    const { rightId } = event.currentTarget.dataset;
    if (!rightId) return;
    if (this.data.redeemingRightId) {
      return;
    }
    this.setData({ redeemingRightId: rightId });
    try {
      await ReservationService.redeemUsageCoupon(rightId);
      wx.showToast({ title: '已增加使用次数', icon: 'success' });
      await this.fetchRights();
    } catch (error) {
      const message = (error && (error.errMsg || error.message)) || '兑换失败';
      wx.showToast({ title: message, icon: 'none' });
      this.setData({ redeemingRightId: '' });
    }
  }
});
