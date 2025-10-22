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

const callCloud = async (name, data = {}, options = {}) => {
  try {
    const res = await wx.cloud.callFunction({
      name,
      data
    });
    return res.result;
  } catch (error) {
    console.error(`[cloud:${name}]`, error);
    recordNetworkError(name, data, error);
    if (!options || !options.suppressErrorToast) {
      wx.showToast({
        title: error.errMsg || '网络异常',
        icon: 'none'
      });
    }
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
  },
  async breakthrough() {
    return callCloud(CLOUD_FUNCTIONS.MEMBER, { action: 'breakthrough' });
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
  async listRooms(date, startTime, endTime, endDate) {
    return callCloud(CLOUD_FUNCTIONS.RESERVATION, {
      action: 'availableRooms',
      date,
      startTime,
      endTime,
      endDate
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
  async failRecharge(transactionId, options = {}) {
    const payload = {
      action: 'failRecharge',
      transactionId
    };
    if (options && typeof options === 'object') {
      if (options.reason) {
        payload.reason = options.reason;
      }
      if (options.code) {
        payload.code = options.code;
      }
    }
    return callCloud(CLOUD_FUNCTIONS.WALLET, payload);
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
  async drawSkill(options = {}) {
    const payload = { action: 'drawSkill' };
    if (options && typeof options === 'object') {
      const rawCount =
        Object.prototype.hasOwnProperty.call(options, 'count') && options.count !== undefined
          ? options.count
          : options.drawCount;
      const parsedCount = Number(rawCount);
      if (Number.isFinite(parsedCount)) {
        const safeCount = Math.max(1, Math.floor(parsedCount));
        payload.drawCount = safeCount;
      }
    }
    return callCloud(CLOUD_FUNCTIONS.PVE, payload);
  },
  async equipSkill({ skillId, slot } = {}) {
    const payload = { action: 'equipSkill', skillId: skillId || '' };
    if (typeof slot === 'number') {
      payload.slot = slot;
    } else if (typeof slot === 'string' && slot.trim()) {
      const parsedSlot = Number(slot);
      if (Number.isFinite(parsedSlot)) {
        payload.slot = Math.floor(parsedSlot);
      }
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
  async useStorageItem({ inventoryId = '', actionKey = 'use' } = {}) {
    const payload = { action: 'useStorageItem' };
    const normalizedInventoryId = typeof inventoryId === 'string' ? inventoryId.trim() : '';
    if (normalizedInventoryId) {
      payload.inventoryId = normalizedInventoryId;
    }
    const normalizedAction = typeof actionKey === 'string' ? actionKey.trim() : '';
    if (normalizedAction) {
      payload.actionKey = normalizedAction;
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
  },
  async adminInspectProfile(memberId) {
    const payload = { action: 'adminInspectProfile' };
    const normalizedId = typeof memberId === 'string' ? memberId.trim() : '';
    if (normalizedId) {
      payload.memberId = normalizedId;
    }
    return callCloud(CLOUD_FUNCTIONS.PVE, payload);
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

export const ActivityService = {
  async list(options = {}) {
    const payload = { action: 'list' };
    if (options && Number.isFinite(options.limit)) {
      payload.limit = options.limit;
    }
    return callCloud(CLOUD_FUNCTIONS.ACTIVITIES, payload);
  },
  async detail(id) {
    return callCloud(CLOUD_FUNCTIONS.ACTIVITIES, {
      action: 'detail',
      id
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
  async getMemberDetail(memberId, options = {}) {
    const payload = {
      action: 'getMemberDetail',
      memberId
    };
    if (options && options.includePveProfile) {
      payload.includePveProfile = true;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async updateMember(memberId, updates, options = {}) {
    const payload = {
      action: 'updateMember',
      memberId,
      updates
    };
    if (options && options.includePveProfile) {
      payload.includePveProfile = true;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
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
  async forceChargeOrder(orderId, { memberId = '', remark = '', allowNegativeBalance = false } = {}) {
    const payload = {
      action: 'forceChargeOrder',
      orderId,
      memberId,
      remark
    };
    if (allowNegativeBalance) {
      payload.allowNegativeBalance = true;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload, { suppressErrorToast: true });
  },
  async cancelChargeOrder(orderId, { remark = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'cancelChargeOrder',
      orderId,
      remark
    });
  },
  async adjustChargeOrder(orderId, { amount, remark = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'adjustChargeOrder',
      orderId,
      amount,
      remark
    });
  },
  async rechargeMember(memberId, amount, options = {}) {
    const payload = {
      action: 'rechargeMember',
      memberId,
      amount
    };
    if (options && options.includePveProfile) {
      payload.includePveProfile = true;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async listReservations({ status = 'pendingApproval', page = 1, pageSize = 20 } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listReservations',
      status,
      page,
      pageSize
    });
  },
  async getReservationOverview({ days = 16 } = {}) {
    const payload = {
      action: 'getReservationOverview'
    };
    if (Number.isFinite(days)) {
      payload.days = days;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
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
  async listWineStorage(memberId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'listWineStorage',
      memberId
    });
  },
  async addWineStorage(memberId, { name = '', quantity = 0, expiryOption = '' } = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'addWineStorage',
      memberId,
      name,
      quantity,
      expiryOption
    });
  },
  async removeWineStorage(memberId, entryId) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'removeWineStorage',
      memberId,
      entryId
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
  },
  async getFinanceReport({ month = '' } = {}) {
    const payload = {
      action: 'getFinanceReport'
    };
    if (month) {
      payload.month = month;
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async previewCleanupResidualData() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'previewCleanupOrphanData'
    });
  },
  async cleanupResidualData() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'cleanupOrphanData'
    });
  },
  async previewCleanupBattleRecords() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'previewCleanupBattleRecords'
    });
  },
  async cleanupBattleRecords() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'cleanupBattleRecords'
    });
  },
  async getSystemFeatures() {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'getSystemFeatures'
    });
  },
  async getSystemSettings() {
    return this.getSystemFeatures();
  },
  async updateSystemFeature(featureKey, enabled) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'updateSystemFeature',
      featureKey,
      enabled
    });
  },
  async updateGameParameters(parameters = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'updateGameParameters',
      parameters
    });
  },
  async updateImmortalTournamentSettings(updates = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'updateImmortalTournamentSettings',
      updates
    });
  },
  async resetImmortalTournament(options = {}) {
    const payload = { action: 'resetImmortalTournament' };
    if (options && typeof options === 'object') {
      if (options.scope) {
        payload.scope = options.scope;
      }
      if (options.seasonId) {
        payload.seasonId = options.seasonId;
      }
      if (typeof options.seasonIndex !== 'undefined') {
        payload.seasonIndex = options.seasonIndex;
      }
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async listActivities(options = {}) {
    const payload = { action: 'listActivities' };
    if (options && typeof options === 'object') {
      if (options.status) {
        payload.status = options.status;
      }
      if (typeof options.includeArchived !== 'undefined') {
        payload.includeArchived = !!options.includeArchived;
      }
    }
    return callCloud(CLOUD_FUNCTIONS.ADMIN, payload);
  },
  async createActivity(activity = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'createActivity',
      activity
    });
  },
  async updateActivity(activityId, updates = {}) {
    return callCloud(CLOUD_FUNCTIONS.ADMIN, {
      action: 'updateActivity',
      activityId,
      updates
    });
  }
};

export const MenuCatalogService = {
  async listCatalog() {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, { action: 'listCatalog' });
  }
};

export const AdminMenuCatalogService = {
  async listCatalog() {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, { action: 'adminListCatalog' });
  },
  async createSection(section = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'createSection',
      section
    });
  },
  async updateSection(section = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'updateSection',
      section
    });
  },
  async createCategory(category = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'createCategory',
      category
    });
  },
  async updateCategory(category = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'updateCategory',
      category
    });
  },
  async createItem(item = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'createItem',
      item
    });
  },
  async updateItem(item = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_CATALOG, {
      action: 'updateItem',
      item
    });
  }
};

export const MenuOrderService = {
  async createOrder({ items = [], remark = '', categoryTotals = {} } = {}) {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'createOrder',
      items,
      remark,
      categoryTotals
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
  },
  async cancelOrder(orderId, remark = '') {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'cancelMemberOrder',
      orderId,
      remark
    });
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
  },
  async cancelOrder(orderId, remark = '') {
    return callCloud(CLOUD_FUNCTIONS.MENU_ORDER, {
      action: 'cancelOrder',
      orderId,
      remark
    });
  }
};
