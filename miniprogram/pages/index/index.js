import { MemberService, TaskService } from '../../services/api';
import { formatCurrency } from '../../utils/format';

const BACKGROUND_IMAGE =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjEyODAiIHZpZXdCb3g9IjAgMCA3MjAgMTI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVm' +
  'cz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ic2t5IiB4MT0iMCIgeTE9IjAiIHgyPSIwIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9I' +
  'iMwNTA5MjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMxYjNjNjgiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPS' +
  'IjMmQwYjNkIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPHJhZGlhbEdyYWRpZW50IGlkPSJnbG93IiBjeD0iNTAlIiBjeT0iMjAlIiByPSI2MCUiPgogICAgICA' +
  '8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZjdmMWQ1IiBzdG9wLW9wYWNpdHk9IjAuOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9' +
  'IiNmN2YxZDUiIHN0b3Atb3BhY2l0eT0iMCIvPgogICAgPC9yYWRpYWxHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjcyMCIgaGVpZ2h0PSIxMjgwIiBma' +
  'WxsPSJ1cmwoI3NreSkiLz4KICA8Y2lyY2xlIGN4PSIzNjAiIGN5PSIyMDAiIHI9IjE4MCIgZmlsbD0idXJsKCNnbG93KSIvPgogIDxwYXRoIGQ9Ik0wIDkwMCBMMTYwID' +
  'c2MCBMMzIwIDg4MCBMNDgwIDcyMCBMNjQwIDg2MCBMNzIwIDc4MCBMNzIwIDEyODAgTDAgMTI4MCBaIiBmaWxsPSIjMWYxYjJlIiBvcGFjaXR5PSIwLjYiLz4KICA8cGF' +
  '0aCBkPSJNMCA5OTAgTDE4MCA4MjAgTDM2MCA5NDAgTDUyMCA3ODAgTDcyMCA5NjAgTDcyMCAxMjgwIEwwIDEyODAgWiIgZmlsbD0iIzI4MWYzZiIgb3BhY2l0eT0iMC43' +
  'NSIvPgogIDxwYXRoIGQ9Ik0wIDEwODAgTDIwMCA5MDAgTDM2MCAxMDIwIEw1NDAgODgwIEw3MjAgMTA4MCBMNzIwIDEyODAgTDAgMTI4MCBaIiBmaWxsPSIjMzQyODU5' +
  'IiBvcGFjaXR5PSIwLjkiLz4KICA8ZyBvcGFjaXR5PSIwLjEyIiBmaWxsPSIjZmZmZmZmIj4KICAgIDxjaXJjbGUgY3g9IjEyMCIgY3k9IjE4MCIgcj0iMyIvPgogICAg' +
  'PGNpcmNsZSBjeD0iMjQwIiBjeT0iMTIwIiByPSIyIi8+CiAgICA8Y2lyY2xlIGN4PSI1MjAiIGN5PSIyMDAiIHI9IjMiLz4KICAgIDxjaXJjbGUgY3g9IjYwMCIgY3k9' +
  'IjEwMCIgcj0iMi41Ii8+CiAgICA8Y2lyY2xlIGN4PSI0MjAiIGN5PSI2MCIgcj0iMiIvPgogICAgPGNpcmNsZSBjeD0iMzIwIiBjeT0iMjYwIiByPSIyLjQiLz4KICAg' +
  'IDxjaXJjbGUgY3g9IjIwMCIgY3k9IjMyMCIgcj0iMS44Ii8+CiAgICA8Y2lyY2xlIGN4PSI1ODAiIGN5PSIzMjAiIHI9IjIuMiIvPgogIDwvZz4KPC9zdmc+';

const HERO_IMAGE =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iMzYwIiBoZWlnaHQ9IjU2MCIgdmlld0JveD0iMCAwIDM2MCA1NjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZnM+' +
  'CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9ImF1cmEiIGN4PSI1MCUiIGN5PSIzMCUiIHI9IjcwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNm' +
  'ZWY2ZDgiIHN0b3Atb3BhY2l0eT0iMC44Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2ZlZjZkOCIgc3RvcC1vcGFjaXR5PSIwIi8+CiAg' +
  'ICA8L3JhZGlhbEdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJyb2JlIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9w' +
  'IG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmMGYyZmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI2MCUiIHN0b3AtY29sb3I9IiNhZGI2ZmYiLz4KICAgICAgPHN0b3Ag' +
  'b2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNmE0YmZmIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJzYXNoIiB4MT0iMCUiI' +
  'nkxPSIwJSIgeDI9IjEwMCUiIHkyPSIwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmM2I0ZmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxM' +
  'DAlIiBzdG9wLWNvbG9yPSIjN2Q0ZGZmIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8ZWxsaXBzZSBjeD0iMTgwIiBjeT0iNDYwIiByeD0iMTQwI' +
  'iByeT0iNjAiIGZpbGw9InVybCgjYXVyYSkiLz4KICA8Y2lyY2xlIGN4PSIxODAiIGN5PSIxMjAiIHI9IjYwIiBmaWxsPSIjZmZlOWQ2Ii8+CiAgPHBhdGggZD0iTTE4MC' +
  'AxODAgQzE3MCAyNDAgMTEwIDI2MCA5MCAzNjAgQzgwIDQyMCAxMTAgNTIwIDE4MCA1MjAgQzI1MCA1MjAgMjgwIDQyMCAyNzAgMzYwIEMyNTAgMjYwIDE5MCAyNDAgMT' +
  'gwIDE4MCBaIiBmaWxsPSJ1cmwoI3JvYmUpIi8+CiAgPHBhdGggZD0iTTE1MCAzMDAgUTE4MCAyNjAgMjEwIDMwMCBMMjQwIDQyMCBRMjA1IDQ0MCAxODAgNDQwIFExNT' +
  'UgNDQwIDEyMCA0MjAgWiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTTEyMCAzNDAgQzE2MCAzMTAgMjAwIDMxMCAyNDAgMzQwIiBmaW' +
  'xsPSJub25lIiBzdHJva2U9InVybCgjc2FzaCkiIHN0cm9rZS13aWR0aD0iMjAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik0xNTAgMTYwIFExODA' +
  'yMDAgMjEwIDE2MCIgZmlsbD0iI2ZmZGRiMiIvPgogIDxjaXJjbGUgY3g9IjE2MCIgY3k9IjEyMCIgcj0iMTAiIGZpbGw9IiMyNjI2NGYiLz4KICA8Y2lyY2xlIGN4PSI' +
  'yMDAiIGN5PSIxMjAiIHI9IjEwIiBmaWxsPSIjMjYyNjRmIi8+CiAgPHBhdGggZD0iTTE2MCAxNTAgUTE4MCAxNzAgMjAwIDE1MCIgc3Ryb2tlPSIjZDQ4YjhiIiBzdHJv' +
  'a2Utd2lkdGg9IjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4=';

const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB3aWR0aD0iMTYwIiBoZWlnaHQ9IjE2MCIgdmlld0JveD0iMCAwIDE2MCAxNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZnM+' +
  'CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImF2YXRhckJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIg' +
  'c3RvcC1jb2xvcj0iIzczNTZmZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNiODkyZmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgP' +
  'C9kZWZzPgogIDxjaXJjbGUgY3g9IjgwIiBjeT0iODAiIHI9Ijc4IiBmaWxsPSJ1cmwoI2F2YXRhckJnKSIvPgogIDxjaXJjbGUgY3g9IjgwIiBjeT0iNzAiIHI9IjMwIi' +
  'BmaWxsPSIjZmNlMWMyIi8+CiAgPHBhdGggZD0iTTQwIDEzMCBRODAgMTAwIDEyMCAxMzAiIGZpbGw9IiNmMGY0ZmYiIHN0cm9rZT0iI2Q5ZGVmZiIgc3Ryb2tlLXdpZHRo' +
  'PSI0Ii8+Cjwvc3ZnPg==';

Page({
  data: {
    member: null,
    progress: null,
    tasks: [],
    loading: true,
    today: '',
    showProfile: false,
    backgroundImage: BACKGROUND_IMAGE,
    heroImage: HERO_IMAGE,
    defaultAvatar: DEFAULT_AVATAR,
    activityIcons: [
      { icon: '⚔️', label: '宗门闯关', url: '/pages/pve/pve' },
      { icon: '🎉', label: '灵境盛典', url: '/pages/rights/rights' },
      { icon: '🔥', label: '冲榜比武' }
    ],
    navItems: [
      { icon: '⚔️', label: '闯关试炼', url: '/pages/pve/pve' },
      { icon: '💳', label: '境界等级', url: '/pages/membership/membership' },
      { icon: '🎁', label: '权益宝库', url: '/pages/rights/rights' },
      { icon: '📅', label: '灵阁预订', url: '/pages/reservation/reservation' },
      { icon: '💰', label: '灵石钱包', url: '/pages/wallet/wallet' },
      { icon: '🧙‍♀️', label: '捏脸塑形', url: '/pages/avatar/avatar' }
    ]
  },

  onLoad() {
    const now = new Date();
    const formatNumber = (value) => (value < 10 ? `0${value}` : `${value}`);
    this.setData({
      today: `${now.getFullYear()} · ${formatNumber(now.getMonth() + 1)} · ${formatNumber(now.getDate())}`
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

  handleProfileTap() {
    this.setData({ showProfile: true });
  },

  handleCloseProfile() {
    this.setData({ showProfile: false });
  },

  handleActivityTap(event) {
    const { url, label } = event.currentTarget.dataset;
    if (url) {
      wx.navigateTo({ url });
      return;
    }
    wx.showToast({
      title: `${label} · 敬请期待`,
      icon: 'none'
    });
  },

  handleNavTap(event) {
    const { url } = event.currentTarget.dataset;
    wx.navigateTo({ url });
  }
});
