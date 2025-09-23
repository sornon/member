import { MemberService } from '../../services/api';
import { formatDate } from '../../utils/format';

Page({
  data: {
    loading: true,
    rights: [],
    member: null
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
        rights: rights || []
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  formatDate,

  handleReserve(event) {
    const { rightId } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/reservation/reservation?rightId=${rightId}`
    });
  }
});
