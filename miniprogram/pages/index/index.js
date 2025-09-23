import { MemberService, TaskService } from '../../services/api';
import { formatCurrency } from '../../utils/format';

Page({
  data: {
    member: null,
    progress: null,
    tasks: [],
    loading: true,
    today: '',
    shortcuts: [
      { icon: '💳', label: '会员等级', url: '/pages/membership/membership' },
      { icon: '🎁', label: '权益中心', url: '/pages/rights/rights' },
      { icon: '🧾', label: '任务福利', url: '/pages/tasks/tasks' },
      { icon: '📅', label: '在线预订', url: '/pages/reservation/reservation' },
      { icon: '💰', label: '充值余额', url: '/pages/wallet/wallet' },
      { icon: '🧙‍♂️', label: '虚拟形象', url: '/pages/avatar/avatar' }
    ]
  },

  onLoad() {
    const now = new Date();
    this.setData({
      today: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    });
    this.bootstrap();
  },

  async bootstrap() {
    this.setData({ loading: true });
    try {
      const [member, progress, tasks] = await Promise.all([
        MemberService.getMember(),
        MemberService.getLevelProgress(),
        TaskService.list()
      ]);
      this.setData({
        member,
        progress,
        tasks: tasks.slice(0, 3),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  formatCurrency,

  handleShortcutTap(event) {
    const { url } = event.currentTarget.dataset;
    wx.navigateTo({ url });
  }
});
