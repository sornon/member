import { CLOUD_FUNCTIONS } from './config';

const ERROR_LOG_COLLECTION = 'errorlogs';

function resolveDatabase() {
  const canUseDatabase = wx.cloud && typeof wx.cloud.database === 'function';
  if (!canUseDatabase) {
    return null;
  }
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData && app.globalData.env) {
        return wx.cloud.database({ env: app.globalData.env });
      }
    }
  } catch (error) {
    console.error('[api] resolve database failed', error);
  }
  return wx.cloud.database();
}

function getCurrentMemberId() {
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData && app.globalData.memberInfo) {
        return app.globalData.memberInfo._id || '';
      }
    }
  } catch (error) {
    console.error('[api] resolve member id failed', error);
  }
  return '';
}

function sanitizeValue(value) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }
  if (typeof value === 'function') {
    return undefined;
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return String(value);
    }
  }
  return value;
}

function serializeError(error) {
  if (!error) {
    return null;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  const payload = {};
  const baseKeys = ['message', 'name', 'stack', 'errCode', 'errMsg', 'code'];
  baseKeys.forEach((key) => {
    if (error[key]) {
      payload[key] = sanitizeValue(error[key]);
    }
  });
  if (!payload.message) {
    try {
      payload.message = error.toString();
    } catch (toStringError) {
      payload.message = 'Unknown error';
    }
  }
  if (typeof error === 'object') {
    try {
      const extra = {};
      Object.keys(error).forEach((key) => {
        if (baseKeys.includes(key)) {
          return;
        }
        const sanitized = sanitizeValue(error[key]);
        if (typeof sanitized !== 'undefined') {
          extra[key] = sanitized;
        }
      });
      if (Object.keys(extra).length > 0) {
        payload.extra = extra;
      }
    } catch (extraError) {
      payload.extra = { message: 'Failed to serialize extra fields', error: extraError.message };
    }
  }
  return payload;
}

function recordNetworkError(name, data, error) {
  const db = resolveDatabase();
  if (!db || typeof db.collection !== 'function') {
    return Promise.resolve();
  }
  const collection = db.collection(ERROR_LOG_COLLECTION);
  const record = {
    interface: name,
    memberId: getCurrentMemberId(),
    createdAt: typeof db.serverDate === 'function' ? db.serverDate() : new Date(),
    error: serializeError(error)
  };
  if (data && typeof data.action === 'string') {
    record.action = data.action;
  }
  return collection.add({ data: record }).catch((logError) => {
    console.error('[api] record network error failed', logError);
  });
}

const callCloud = async (name, data = {}) => {
  try {
    const res = await wx.cloud.callFunction({
      name,
      data
    });
    return res.result;
  } catch (error) {
    console.error(`[cloud:${name}]`, error);
    recordNetworkError(name, data, error);
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
  async claimLevelReward(levelId) {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, {
      action: 'claimLevelReward',
      levelId
    });
  },
  async getRights() {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, { action: 'rights' });
  },
  async completeProfile(profile = {}, options = {}) {
    const payload = {
      action: 'completeProfile',
      profile
    };
    if (options.phoneCloudId) {
      payload.phone = wx.cloud.CloudID(options.phoneCloudId);
    }
    if (options.phoneCode) {
      payload.phoneCode = options.phoneCode;
    }
    if (options.phoneNumber) {
      payload.phoneNumber = options.phoneNumber;
    }
    return callCloud(CLOUD_FUNCTIONS.MEMBER, payload);
  },
  async updateArchive(updates = {}) {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, {
      action: 'updateArchive',
      updates
    });
  },
  async redeemRenameCard(count = 1) {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, {
      action: 'redeemRenameCard',
      count
    });
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
  async listRooms(date, startTime, endTime) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'availableRooms',
      date,
      startTime,
      endTime
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
  },
  async redeemUsageCoupon(memberRightId) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'redeemUsageCoupon',
      memberRightId
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
  async completeRecharge(transactionId) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'completeRecharge',
      transactionId
    });
  },
  async payWithBalance(orderId, amount) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'balancePay',
      orderId,
      amount
    });
  },
  async loadChargeOrder(orderId) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'loadChargeOrder',
      orderId
    });
  },
  async confirmChargeOrder(orderId) {
    return callCloud(CLOUD_FUNCTIONS.WALLET, {
      action: 'confirmChargeOrder',
      orderId
    });
  }
};

export const PveService = {
  async profile() {
    return callCloud(CLOUD_FUNCTIONS.PVE, { action: 'profile' });
  },
  async battle(enemyId) {
    return callCloud(CLOUD_FUNCTIONS.PVE, { action: 'battle', enemyId });
  },
  async drawSkill() {
    return callCloud(CLOUD_FUNCTIONS.PVE, { action: 'drawSkill' });
  },
  async equipSkill({ skillId, slot } = {}) {
    const payload = { action: 'equipSkill', skillId: skillId || '' };
    if (typeof slot === 'number') {
      payload.slot = slot;
    }
    return callCloud(CLOUD_FUNCTIONS.PVE, payload);
  },
  async equipItem({ itemId = '', slot = '', inventoryId = '' } = {}) {
    const payload = { action: 'equipItem' };
    const normalizedItemId = typeof itemId === 'string' ? itemId : '';
    const normalizedSlot = typeof slot === 'string' ? slot.trim() : '';
    const normalizedInventoryId = typeof inventoryId === 'string' ? inventoryId.trim() : '';
    if (normalizedItemId) {
      payload.itemId = normalizedItemId;
    }
    if (normalizedSlot) {
      payload.slot = normalizedSlot;
    }
    if (normalizedInventoryId) {
      payload.inventoryId = normalizedInventoryId;
    }
    return callCloud(CLOUD_FUNCTIONS.PVE, payload);
  },
  async discardItem({ inventoryId = '', category = '' } = {}) {
    const payload = { action: 'discardItem' };
    const normalizedInventoryId = typeof inventoryId === 'string' ? inventoryId.trim() : '';
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    if (normalizedInventoryId) {
      payload.inventoryId = normalizedInventoryId;
    }
    if (normalizedCategory) {
      payload.category = normalizedCategory;
    }
    return callCloud(CLOUD_FUNCTIONS.PVE, payload);
  },
  async upgradeStorage({ category = '' } = {}) {
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    return callCloud(CLOUD_FUNCTIONS.PVE, {
      action: 'upgradeStorage',
      category: normalizedCategory
    });
  },
  async allocatePoints(allocations = {}) {
    return callCloud(CLOUD_FUNCTIONS.PVE, { action: 'allocatePoints', allocations });
  },
  async resetAttributes() {
    return callCloud(CLOUD_FUNCTIONS.PVE, { action: 'resetAttributes' });
  }
};

export const PvpService = {
  async profile() {
    return callCloud(CLOUD_FUNCTIONS.PVP, { action: 'profile' });
  },
  async matchRandom(options = {}) {
    const payload = { action: 'matchRandom' };
    if (options && typeof options.seed === 'string' && options.seed) {
      payload.seed = options.seed;
    }
    return callCloud(CLOUD_FUNCTIONS.PVP, payload);
  },
  async matchFriend(targetId, options = {}) {
    const normalized = typeof targetId === 'string' ? targetId.trim() : '';
    const payload = { action: 'matchFriend', targetId: normalized };
    if (options && typeof options.seed === 'string' && options.seed) {
      payload.seed = options.seed;
    }
    return callCloud(CLOUD_FUNCTIONS.PVP, payload);
  },
  async battleReplay(matchId) {
    return callCloud(CLOUD_FUNCTIONS.PVP, { action: 'battleReplay', matchId });
  },
  async leaderboard({ type = 'season', limit = 100, seasonId = '' } = {}) {
    const payload = { action: 'getLeaderboard', type, limit };
    if (seasonId) {
      payload.seasonId = seasonId;
    }
    return callCloud(CLOUD_FUNCTIONS.PVP, payload);
  },
  async claimSeasonReward(seasonId) {
    return callCloud(CLOUD_FUNCTIONS.PVP, { action: 'claimSeasonReward', seasonId });
  },
  async sendInvite(channel = 'friend') {
    return callCloud(CLOUD_FUNCTIONS.PVP, { action: 'sendInvite', channel });
  },
  async acceptInvite(inviteId) {
    return callCloud(CLOUD_FUNCTIONS.PVP, { action: 'acceptInvite', inviteId });
  }
};

export const StoneService = {
  async summary() {
    return callCloud(CLOUD_FUNCTIONS.STONES, { action: 'summary' });
  },
  async catalog() {
    return callCloud(CLOUD_FUNCTIONS.STONES, { action: 'catalog' });
  },
  async purchase(itemId, quantity = 1) {
    return callCloud(CLOUD_FUNCTIONS.STONES, {
      action: 'purchase',
      itemId,
      quantity
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

export const AdminService = {
  async listMembers({ keyword = '', page = 1, pageSize = 20 } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listMembers',
      keyword,
      page,
      pageSize
    });
  },
  async getMemberDetail(memberId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'getMemberDetail',
      memberId
    });
  },
  async updateMember(memberId, updates) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'updateMember',
      memberId,
      updates
    });
  },
  async deleteMember(memberId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'deleteMember',
      memberId
    });
  },
  async listEquipmentCatalog() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listEquipmentCatalog'
    });
  },
  async grantEquipment({ memberId, itemId }) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'grantEquipment',
      memberId,
      itemId
    });
  },
  async removeEquipment({ memberId, itemId, inventoryId }) {
    const payload = {
      action: 'removeEquipment',
      memberId,
      itemId
    };
    if (inventoryId) {
      payload.inventoryId = inventoryId;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async updateEquipmentAttributes({ memberId, itemId, inventoryId, refine }) {
    const payload = {
      action: 'updateEquipmentAttributes',
      memberId,
      itemId,
      attributes: { refine }
    };
    if (inventoryId) {
      payload.inventoryId = inventoryId;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async createChargeOrder(items) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'createChargeOrder',
      items
    });
  },
  async getChargeOrder(orderId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'getChargeOrder',
      orderId
    });
  },
  async getChargeOrderQrCode(orderId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'getChargeOrderQrCode',
      orderId
    });
  },
  async listChargeOrders({ page = 1, pageSize = 20, memberId = '', keyword = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listChargeOrders',
      page,
      pageSize,
      memberId,
      keyword
    });
  },
  async forceChargeOrder(orderId, { memberId = '', remark = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'forceChargeOrder',
      orderId,
      memberId,
      remark
    });
  },
  async rechargeMember(memberId, amount) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'rechargeMember',
      memberId,
      amount
    });
  },
  async listReservations({ status = 'pendingApproval', page = 1, pageSize = 20 } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listReservations',
      status,
      page,
      pageSize
    });
  },
  async approveReservation(reservationId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'approveReservation',
      reservationId
    });
  },
  async rejectReservation(reservationId, reason = '') {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'rejectReservation',
      reservationId,
      reason
    });
  },
  async cancelReservation(reservationId, reason = '') {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'cancelReservation',
      reservationId,
      reason
    });
  },
  async markReservationRead() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'markReservationRead'
    });
  }
};

export const MenuOrderService = {
  async createOrder({ items = [], remark = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'createOrder',
      items,
      remark
    });
  },
  async listOrders() {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'listMemberOrders'
    });
  },
  async confirmOrder(orderId) {
    const result = await callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'confirmMemberOrder',
      orderId
    });
    if (result && result.errorCode) {
      const error = new Error(result.message || '扣费失败');
      error.code = result.errorCode;
      throw error;
    }
    return result;
  }
};

export const AdminMenuOrderService = {
  async listPrepOrders({ status = 'submitted', pageSize = 50 } = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'listPrepOrders',
      status,
      pageSize
    });
  },
  async markOrderReady(orderId, remark = '') {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'markOrderReady',
      orderId,
      remark
    });
  }
};
