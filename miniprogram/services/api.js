import { CLOUD_FUNCTIONS } from './config';

const callCloud = async (name, data = {}) => {
  try {
    const res = await wx.cloud.callFunction({
      name,
      data
    });
    return res.result;
  } catch (error) {
    console.error(`[cloud:${name}]`, error);
    wx.showToast({
      title: error.errMsg || '网络异常',
      icon: 'none'
    });
    throw error;
  }
};

export const MemberService = {
  async initMember(profile) {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, {
      action: 'init',
      profile
    });
  },
  async getMember() {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, { action: 'profile' });
  },
  async getLevelProgress() {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, { action: 'progress' });
  },
  async getRights() {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, { action: 'rights' });
  }
};

export const TaskService = {
  async list() {
    return callCloud(CLOUD_FUNCTIONS.TASKS, { action: 'list' });
  },
  async claim(taskId) {
    return callCloud(CLOUD_FUNCTIONS.TASKS, {
      action: 'claim',
      taskId
    });
  }
};

export const ReservationService = {
  async listRooms(date, slot) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'availableRooms',
      date,
      slot
    });
  },
  async create(order) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'create',
      order
    });
  },
  async cancel(reservationId) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'cancel',
      reservationId
    });
  }
};

export const WalletService = {
  async summary() {
    return callCloud(CLOUD_FUNCTIONS.WALLET, { action: 'summary' });
  },
  async createRecharge(amount) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'createRecharge',
      amount
    });
  },
  async payWithBalance(orderId, amount) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'balancePay',
      orderId,
      amount
    });
  }
};

export const AvatarService = {
  async listAssets() {
    return callCloud(CLOUD_FUNCTIONS.AVATAR, { action: 'assets' });
  },
  async saveConfig(config) {
    return callCloud(CLOUD_FUNCTIONS.AVATAR, {
      action: 'save',
      config
    });
  }
};
