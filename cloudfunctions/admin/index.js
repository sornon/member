const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const {
  EXPERIENCE_PER_YUAN,
  COLLECTIONS,
  EXCLUDED_TRANSACTION_STATUSES,
  DEFAULT_ADMIN_ROLES,
  listAvatarIds,
  analyzeMemberLevelProgress
} = require('common-config'); //云函数公共模块，维护在目录cloudfunctions/nodejs-layer/node_modules/common-config
const {
  DEFAULT_GAME_PARAMETERS,
  DEFAULT_RAGE_SETTINGS,
  DEFAULT_CACHE_VERSIONS,
  normalizeRageSettings,
  serializeGameParameters,
  cloneGameParameters,
  cloneRageSettings,
  resolveGameParametersFromDocument,
  normalizeCacheVersions,
  cloneCacheVersions,
  incrementCacheVersionValue
} = require('system-settings');

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const ADMIN_ROLES = [...new Set([...DEFAULT_ADMIN_ROLES, 'superadmin'])];
const MIN_REPORT_MONTH = new Date(2025, 8, 1);
const AVATAR_ID_PATTERN = /^(male|female)-([a-z]+)-(\d+)$/;
const ALLOWED_AVATAR_IDS = new Set(listAvatarIds());

const STORAGE_UPGRADE_LIMIT_KEYS = ['upgradeLimit', 'maxUpgrades', 'limit'];

const WINE_EXPIRY_PRESETS = {
  '7d': { days: 7 },
  '3m': { months: 3 },
  '1y': { years: 1 }
};

const DEFAULT_WINE_EXPIRY = '3m';

const FEATURE_TOGGLE_DOC_ID = 'feature_toggles';
const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};
const DEFAULT_FEATURE_TOGGLES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT },
  cacheVersions: { ...DEFAULT_CACHE_VERSIONS }
};
const DEFAULT_PVP_RATING = 1200;
const DEFAULT_PVP_TIER = { id: 'bronze', name: '青铜' };
const DEFAULT_PVP_SEASON_LENGTH_DAYS = 56;
const ACTIVE_RESERVATION_STATUSES = [
  'pendingApproval',
  'approved',
  'reserved',
  'confirmed',
  'pendingPayment'
];
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const CLEANUP_TASK_CONCURRENCY = 3;
const ORPHAN_QUERY_BATCH_LIMIT = 200;
const PLAYER_REFRESH_BATCH_SIZE = 1;
const PLAYER_REFRESH_MAX_DURATION_MS = 2400;

const ACTIVITY_ALLOWED_STATUSES = ['draft', 'published', 'archived'];

const FEATURE_KEY_ALIASES = {
  cashier: 'cashierEnabled',
  cashierenabled: 'cashierEnabled',
  cashiernabled: 'cashierEnabled',
  'cashier-enabled': 'cashierEnabled',
  'cashier_enabled': 'cashierEnabled'
};

const CACHE_VERSION_KEY_ALIASES = {
  global: 'global',
  overal: 'global',
  overall: 'global',
  full: 'global',
  all: 'all',
  menu: 'menu',
  menus: 'menu',
  catalog: 'menu',
  menucatalog: 'menu',
  ordering: 'menu',
  order: 'menu'
};

const ACTIONS = {
  LIST_MEMBERS: 'listMembers',
  GET_MEMBER_DETAIL: 'getMemberDetail',
  UPDATE_MEMBER: 'updateMember',
  DELETE_MEMBER: 'deleteMember',
  CREATE_CHARGE_ORDER: 'createChargeOrder',
  GET_CHARGE_ORDER: 'getChargeOrder',
  LIST_CHARGE_ORDERS: 'listChargeOrders',
  GET_CHARGE_ORDER_QR_CODE: 'getChargeOrderQrCode',
  FORCE_CHARGE_ORDER: 'forceChargeOrder',
  ADJUST_CHARGE_ORDER: 'adjustChargeOrder',
  CANCEL_CHARGE_ORDER: 'cancelChargeOrder',
  RECHARGE_MEMBER: 'rechargeMember',
  LIST_RESERVATIONS: 'listReservations',
  GET_RESERVATION_OVERVIEW: 'getReservationOverview',
  APPROVE_RESERVATION: 'approveReservation',
  REJECT_RESERVATION: 'rejectReservation',
  CANCEL_RESERVATION: 'cancelReservation',
  MARK_RESERVATION_READ: 'markReservationRead',
  LIST_EQUIPMENT_CATALOG: 'listEquipmentCatalog',
  GRANT_EQUIPMENT: 'grantEquipment',
  REMOVE_EQUIPMENT: 'removeEquipment',
  UPDATE_EQUIPMENT_ATTRIBUTES: 'updateEquipmentAttributes',
  GET_FINANCE_REPORT: 'getFinanceReport',
  LIST_WINE_STORAGE: 'listWineStorage',
  ADD_WINE_STORAGE: 'addWineStorage',
  REMOVE_WINE_STORAGE: 'removeWineStorage',
  CLEANUP_ORPHAN_DATA: 'cleanupOrphanData',
  PREVIEW_CLEANUP_ORPHAN_DATA: 'previewCleanupOrphanData',
  CLEANUP_BATTLE_RECORDS: 'cleanupBattleRecords',
  PREVIEW_CLEANUP_BATTLE_RECORDS: 'previewCleanupBattleRecords',
  CLEANUP_TEST_MEMBERS: 'cleanupTestMembers',
  PREVIEW_CLEANUP_TEST_MEMBERS: 'previewCleanupTestMembers',
  GET_SYSTEM_FEATURES: 'getSystemFeatures',
  UPDATE_SYSTEM_FEATURE: 'updateSystemFeature',
  UPDATE_IMMORTAL_TOURNAMENT_SETTINGS: 'updateImmortalTournamentSettings',
  UPDATE_GAME_PARAMETERS: 'updateGameParameters',
  BUMP_CACHE_VERSION: 'bumpCacheVersion',
  RESET_IMMORTAL_TOURNAMENT: 'resetImmortalTournament',
  REFRESH_IMMORTAL_TOURNAMENT_PLAYERS: 'refreshImmortalTournamentPlayers',
  LIST_ACTIVITIES: 'listActivities',
  CREATE_ACTIVITY: 'createActivity',
  UPDATE_ACTIVITY: 'updateActivity'
};

const ACTION_CANONICAL_MAP = Object.values(ACTIONS).reduce((map, name) => {
  const lowercase = name.toLowerCase();
  map[lowercase] = name;
  map[name.replace(/[\s_-]+/g, '').toLowerCase()] = name;
  return map;
}, {});

const ACTION_ALIASES = {
  listmembers: ACTIONS.LIST_MEMBERS,
  getmemberdetail: ACTIONS.GET_MEMBER_DETAIL,
  updatemember: ACTIONS.UPDATE_MEMBER,
  deletemember: ACTIONS.DELETE_MEMBER,
  createchargeorder: ACTIONS.CREATE_CHARGE_ORDER,
  getchargeorder: ACTIONS.GET_CHARGE_ORDER,
  getchargeorderqrcode: ACTIONS.GET_CHARGE_ORDER_QR_CODE,
  listchargeorders: ACTIONS.LIST_CHARGE_ORDERS,
  listchargeorder: ACTIONS.LIST_CHARGE_ORDERS,
  forcechargeorder: ACTIONS.FORCE_CHARGE_ORDER,
  adjustchargeorder: ACTIONS.ADJUST_CHARGE_ORDER,
  cancelchargeorder: ACTIONS.CANCEL_CHARGE_ORDER,
  rechargemember: ACTIONS.RECHARGE_MEMBER,
  listreservations: ACTIONS.LIST_RESERVATIONS,
  getreservationoverview: ACTIONS.GET_RESERVATION_OVERVIEW,
  approvereservation: ACTIONS.APPROVE_RESERVATION,
  rejectreservation: ACTIONS.REJECT_RESERVATION,
  cancelreservation: ACTIONS.CANCEL_RESERVATION,
  markreservationread: ACTIONS.MARK_RESERVATION_READ,
  listequipmentcatalog: ACTIONS.LIST_EQUIPMENT_CATALOG,
  grantequipment: ACTIONS.GRANT_EQUIPMENT,
  removeequipment: ACTIONS.REMOVE_EQUIPMENT,
  updateequipmentattributes: ACTIONS.UPDATE_EQUIPMENT_ATTRIBUTES,
  getfinancereport: ACTIONS.GET_FINANCE_REPORT,
  financereport: ACTIONS.GET_FINANCE_REPORT,
  listwinestorage: ACTIONS.LIST_WINE_STORAGE,
  addwinestorage: ACTIONS.ADD_WINE_STORAGE,
  removewinestorage: ACTIONS.REMOVE_WINE_STORAGE,
  cleanuporphandata: ACTIONS.CLEANUP_ORPHAN_DATA,
  datacleanup: ACTIONS.CLEANUP_ORPHAN_DATA,
  cleanupresidualdata: ACTIONS.CLEANUP_ORPHAN_DATA,
  cleanupdata: ACTIONS.CLEANUP_ORPHAN_DATA,
  previewcleanuporphandata: ACTIONS.PREVIEW_CLEANUP_ORPHAN_DATA,
  previewcleanupdata: ACTIONS.PREVIEW_CLEANUP_ORPHAN_DATA,
  scandataorphans: ACTIONS.PREVIEW_CLEANUP_ORPHAN_DATA,
  cleanupbattlerecords: ACTIONS.CLEANUP_BATTLE_RECORDS,
  cleanbattles: ACTIONS.CLEANUP_BATTLE_RECORDS,
  battlecleanup: ACTIONS.CLEANUP_BATTLE_RECORDS,
  previewcleanupbattlerecords: ACTIONS.PREVIEW_CLEANUP_BATTLE_RECORDS,
  scanbattlerecords: ACTIONS.PREVIEW_CLEANUP_BATTLE_RECORDS,
  previewbattlerecords: ACTIONS.PREVIEW_CLEANUP_BATTLE_RECORDS,
  cleantestmembers: ACTIONS.CLEANUP_TEST_MEMBERS,
  cleantestaccounts: ACTIONS.CLEANUP_TEST_MEMBERS,
  cleanupTestMembers: ACTIONS.CLEANUP_TEST_MEMBERS,
  scantestmembers: ACTIONS.PREVIEW_CLEANUP_TEST_MEMBERS,
  previewcleantestmembers: ACTIONS.PREVIEW_CLEANUP_TEST_MEMBERS,
  previewcleanuptestmembers: ACTIONS.PREVIEW_CLEANUP_TEST_MEMBERS,
  getsystemfeatures: ACTIONS.GET_SYSTEM_FEATURES,
  systemfeatures: ACTIONS.GET_SYSTEM_FEATURES,
  updatesystemfeature: ACTIONS.UPDATE_SYSTEM_FEATURE,
  togglesystemfeature: ACTIONS.UPDATE_SYSTEM_FEATURE,
  setfeaturetoggle: ACTIONS.UPDATE_SYSTEM_FEATURE,
  updateimmortaltournamentsettings: ACTIONS.UPDATE_IMMORTAL_TOURNAMENT_SETTINGS,
  immortaltournamentsettings: ACTIONS.UPDATE_IMMORTAL_TOURNAMENT_SETTINGS,
  updatetournamentsettings: ACTIONS.UPDATE_IMMORTAL_TOURNAMENT_SETTINGS,
  updategameparameters: ACTIONS.UPDATE_GAME_PARAMETERS,
  gameparameters: ACTIONS.UPDATE_GAME_PARAMETERS,
  resetimmortaltournament: ACTIONS.RESET_IMMORTAL_TOURNAMENT,
  resetimmortaltournaments: ACTIONS.RESET_IMMORTAL_TOURNAMENT,
  cleartournament: ACTIONS.RESET_IMMORTAL_TOURNAMENT,
  resetimmortaltournamentseason: ACTIONS.RESET_IMMORTAL_TOURNAMENT,
  resetimmortaltournamentdata: ACTIONS.RESET_IMMORTAL_TOURNAMENT,
  refreshimmortaltournamentplayers: ACTIONS.REFRESH_IMMORTAL_TOURNAMENT_PLAYERS,
  refreshimmortalplayers: ACTIONS.REFRESH_IMMORTAL_TOURNAMENT_PLAYERS,
  refreshpvpprofiles: ACTIONS.REFRESH_IMMORTAL_TOURNAMENT_PLAYERS,
  bumpcacheversion: ACTIONS.BUMP_CACHE_VERSION,
  refreshcache: ACTIONS.BUMP_CACHE_VERSION,
  updatecacheversion: ACTIONS.BUMP_CACHE_VERSION,
  incrementcacheversion: ACTIONS.BUMP_CACHE_VERSION,
  listactivities: ACTIONS.LIST_ACTIVITIES,
  activities: ACTIONS.LIST_ACTIVITIES,
  createactivity: ACTIONS.CREATE_ACTIVITY,
  updateactivity: ACTIONS.UPDATE_ACTIVITY,
  editactivity: ACTIONS.UPDATE_ACTIVITY
};

function normalizeAction(action) {
  if (typeof action === 'string' || action instanceof String) {
    const trimmed = String(action).trim();
    if (trimmed) {
      const canonical = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
      if (ACTION_ALIASES[canonical]) {
        return ACTION_ALIASES[canonical];
      }
      if (ACTION_CANONICAL_MAP[canonical]) {
        return ACTION_CANONICAL_MAP[canonical];
      }
      const lowercase = trimmed.toLowerCase();
      if (ACTION_CANONICAL_MAP[lowercase]) {
        return ACTION_CANONICAL_MAP[lowercase];
      }
      return trimmed;
    }
  }
  return ACTIONS.LIST_MEMBERS;
}

const ACTION_HANDLERS = {
  [ACTIONS.LIST_MEMBERS]: (openid, event) =>
    listMembers(openid, event.keyword || '', event.page || 1, event.pageSize || 20),
  [ACTIONS.GET_MEMBER_DETAIL]: (openid, event) =>
    getMemberDetail(openid, event.memberId, event || {}),
  [ACTIONS.UPDATE_MEMBER]: (openid, event) =>
    updateMember(openid, event.memberId, event.updates || {}, event || {}),
  [ACTIONS.DELETE_MEMBER]: (openid, event) => deleteMember(openid, event.memberId),
  [ACTIONS.CREATE_CHARGE_ORDER]: (openid, event) => createChargeOrder(openid, event.items || []),
  [ACTIONS.GET_CHARGE_ORDER]: (openid, event) => getChargeOrder(openid, event.orderId),
  [ACTIONS.GET_CHARGE_ORDER_QR_CODE]: (openid, event) => getChargeOrderQrCode(openid, event.orderId),
  [ACTIONS.LIST_CHARGE_ORDERS]: (openid, event) =>
    listChargeOrders(openid, {
      page: event.page || 1,
      pageSize: event.pageSize || 20,
      memberId: event.memberId || '',
      keyword: event.keyword || ''
    }),
  [ACTIONS.FORCE_CHARGE_ORDER]: (openid, event) =>
    forceChargeOrder(openid, event.orderId, {
      memberId: event.memberId || '',
      remark: event.remark || '',
      allowNegativeBalance: !!event.allowNegativeBalance
    }),
  [ACTIONS.CANCEL_CHARGE_ORDER]: (openid, event) =>
    cancelChargeOrder(openid, event.orderId, event.remark || ''),
  [ACTIONS.ADJUST_CHARGE_ORDER]: (openid, event) =>
    adjustChargeOrderAmount(openid, event.orderId, {
      amount: event.amount,
      remark: event.remark || ''
    }),
  [ACTIONS.RECHARGE_MEMBER]: (openid, event) =>
    rechargeMember(openid, event.memberId, event.amount, event || {}),
  [ACTIONS.LIST_RESERVATIONS]: (openid, event) =>
    listReservations(openid, {
      status: event.status || 'pendingApproval',
      page: event.page || 1,
      pageSize: event.pageSize || 20
    }),
  [ACTIONS.GET_RESERVATION_OVERVIEW]: (openid, event) =>
    getReservationOverview(openid, { days: event.days || event.range || 7 }),
  [ACTIONS.APPROVE_RESERVATION]: (openid, event) => approveReservation(openid, event.reservationId),
  [ACTIONS.REJECT_RESERVATION]: (openid, event) => rejectReservation(openid, event.reservationId, event.reason || ''),
  [ACTIONS.CANCEL_RESERVATION]: (openid, event) => cancelReservation(openid, event.reservationId, event.reason || ''),
  [ACTIONS.MARK_RESERVATION_READ]: (openid) => markReservationRead(openid),
  [ACTIONS.LIST_EQUIPMENT_CATALOG]: (openid) => listEquipmentCatalog(openid),
  [ACTIONS.GRANT_EQUIPMENT]: (openid, event) => grantEquipment(openid, event.memberId, event.itemId),
  [ACTIONS.REMOVE_EQUIPMENT]: (openid, event) =>
    removeEquipment(openid, event.memberId, event.itemId, event.inventoryId),
  [ACTIONS.UPDATE_EQUIPMENT_ATTRIBUTES]: (openid, event) =>
    updateEquipmentAttributes(openid, event.memberId, event.itemId, event.attributes || {}, event),
  [ACTIONS.GET_FINANCE_REPORT]: (openid, event) => getFinanceReport(openid, event.month || event.targetMonth || ''),
  [ACTIONS.LIST_WINE_STORAGE]: (openid, event) => listWineStorage(openid, event.memberId),
  [ACTIONS.ADD_WINE_STORAGE]: (openid, event) =>
    addWineStorage(openid, event.memberId, {
      name: event.name,
      quantity: event.quantity,
      expiryOption: event.expiryOption || event.expireOption || event.expiry || ''
    }),
  [ACTIONS.REMOVE_WINE_STORAGE]: (openid, event) =>
    removeWineStorage(openid, event.memberId, event.entryId || event.storageId || ''),
  [ACTIONS.CLEANUP_ORPHAN_DATA]: (openid) => cleanupResidualMemberData(openid),
  [ACTIONS.PREVIEW_CLEANUP_ORPHAN_DATA]: (openid) => previewCleanupResidualData(openid),
  [ACTIONS.CLEANUP_BATTLE_RECORDS]: (openid) => cleanupBattleRecords(openid),
  [ACTIONS.PREVIEW_CLEANUP_BATTLE_RECORDS]: (openid) => previewCleanupBattleRecords(openid),
  [ACTIONS.CLEANUP_TEST_MEMBERS]: (openid) => cleanupTestMembers(openid),
  [ACTIONS.PREVIEW_CLEANUP_TEST_MEMBERS]: (openid) => previewCleanupTestMembers(openid),
  [ACTIONS.GET_SYSTEM_FEATURES]: (openid) => getSystemFeatures(openid),
  [ACTIONS.UPDATE_SYSTEM_FEATURE]: (openid, event) => updateSystemFeature(openid, event),
  [ACTIONS.UPDATE_IMMORTAL_TOURNAMENT_SETTINGS]: (openid, event = {}) =>
    updateImmortalTournamentSettings(openid, event.updates || event),
  [ACTIONS.UPDATE_GAME_PARAMETERS]: (openid, event = {}) =>
    updateGameParameters(openid, event.parameters || event),
  [ACTIONS.BUMP_CACHE_VERSION]: (openid, event) => bumpCacheVersion(openid, event || {}),
  [ACTIONS.RESET_IMMORTAL_TOURNAMENT]: (openid, event) =>
    resetImmortalTournament(openid, event || {}),
  [ACTIONS.REFRESH_IMMORTAL_TOURNAMENT_PLAYERS]: (openid, event) =>
    refreshImmortalTournamentPlayers(openid, event || {}),
  [ACTIONS.LIST_ACTIVITIES]: (openid, event) => listActivities(openid, event || {}),
  [ACTIONS.CREATE_ACTIVITY]: (openid, event) => createActivity(openid, event.activity || {}),
  [ACTIONS.UPDATE_ACTIVITY]: (openid, event) =>
    updateActivity(openid, event.activityId || event.id, event.updates || event.activity || {})
};

async function resolveMemberExtras(memberId) {
  if (!memberId) {
    return { avatarUnlocks: [], claimedLevelRewards: [] };
  }
  const collection = db.collection(COLLECTIONS.MEMBER_EXTRAS);
  const snapshot = await collection
    .doc(memberId)
    .get()
    .catch(() => null);
  if (snapshot && snapshot.data) {
    const extras = snapshot.data;
    if (!Array.isArray(extras.avatarUnlocks)) {
      extras.avatarUnlocks = [];
    }
    if (!Array.isArray(extras.claimedLevelRewards)) {
      extras.claimedLevelRewards = [];
    }
    if (!Array.isArray(extras.wineStorage)) {
      extras.wineStorage = [];
    }
    return extras;
  }
  const now = new Date();
  const data = {
    avatarUnlocks: [],
    claimedLevelRewards: [],
    wineStorage: [],
    createdAt: now,
    updatedAt: now
  };
  await collection
    .doc(memberId)
    .set({ data })
    .catch(() => {});
  return data;
}

async function updateMemberExtras(memberId, updates = {}) {
  if (!memberId || !updates || !Object.keys(updates).length) {
    return;
  }
  const collection = db.collection(COLLECTIONS.MEMBER_EXTRAS);
  const payload = { ...updates, updatedAt: new Date() };
  await collection
    .doc(memberId)
    .update({ data: payload })
    .catch(async (error) => {
      if (error && /not exist/i.test(error.errMsg || '')) {
        await collection
          .doc(memberId)
          .set({
            data: {
              ...payload,
              avatarUnlocks: [],
              wineStorage: [],
              createdAt: new Date()
            }
          })
          .catch(() => {});
      }
    });
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function generateWineStorageId() {
  return `wine_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortWineStorageEntries(entries = []) {
  return entries
    .slice()
    .sort((a, b) => {
      const aExpiry = a && a.expiresAt instanceof Date && !Number.isNaN(a.expiresAt.getTime())
        ? a.expiresAt.getTime()
        : Number.POSITIVE_INFINITY;
      const bExpiry = b && b.expiresAt instanceof Date && !Number.isNaN(b.expiresAt.getTime())
        ? b.expiresAt.getTime()
        : Number.POSITIVE_INFINITY;
      if (aExpiry !== bExpiry) {
        return aExpiry - bExpiry;
      }
      const aCreated = a && a.createdAt instanceof Date && !Number.isNaN(a.createdAt.getTime())
        ? a.createdAt.getTime()
        : 0;
      const bCreated = b && b.createdAt instanceof Date && !Number.isNaN(b.createdAt.getTime())
        ? b.createdAt.getTime()
        : 0;
      return aCreated - bCreated;
    });
}

function normalizeWineStorageEntries(list = []) {
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return;
    }
    const rawQuantity = Number(entry.quantity || 0);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : '';
    const createdAtCandidate = entry.createdAt ? new Date(entry.createdAt) : null;
    const expiresAtCandidate = entry.expiresAt ? new Date(entry.expiresAt) : null;
    const createdAt =
      createdAtCandidate && !Number.isNaN(createdAtCandidate.getTime())
        ? createdAtCandidate
        : new Date();
    const expiresAt =
      expiresAtCandidate && !Number.isNaN(expiresAtCandidate.getTime()) ? expiresAtCandidate : null;
    normalized.push({
      id: id || generateWineStorageId(),
      name,
      quantity,
      createdAt,
      expiresAt
    });
  });
  return sortWineStorageEntries(normalized);
}

function serializeWineStorageEntry(entry) {
  if (!entry) {
    return { id: '', name: '', quantity: 0, expiresAt: '', createdAt: '' };
  }
  return {
    id: entry.id || '',
    name: entry.name || '',
    quantity: Number.isFinite(entry.quantity) ? entry.quantity : 0,
    expiresAt:
      entry.expiresAt instanceof Date && !Number.isNaN(entry.expiresAt.getTime())
        ? entry.expiresAt.toISOString()
        : '',
    createdAt:
      entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime())
        ? entry.createdAt.toISOString()
        : ''
  };
}

function prepareWineStorageForSave(entries = []) {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    quantity: Number.isFinite(entry.quantity) ? entry.quantity : 0,
    expiresAt:
      entry.expiresAt instanceof Date && !Number.isNaN(entry.expiresAt.getTime()) ? entry.expiresAt : null,
    createdAt:
      entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime()) ? entry.createdAt : new Date()
  }));
}

function resolveWineStorageExpiry(optionKey) {
  const key = typeof optionKey === 'string' ? optionKey.trim().toLowerCase() : '';
  const preset = WINE_EXPIRY_PRESETS[key] || WINE_EXPIRY_PRESETS[DEFAULT_WINE_EXPIRY];
  const now = new Date();
  const expiresAt = new Date(now.getTime());
  if (preset.days) {
    expiresAt.setDate(expiresAt.getDate() + preset.days);
  }
  if (preset.months) {
    const originalDate = expiresAt.getDate();
    expiresAt.setMonth(expiresAt.getMonth() + preset.months, originalDate);
  }
  if (preset.years) {
    expiresAt.setFullYear(expiresAt.getFullYear() + preset.years);
  }
  return expiresAt;
}

function calculateWineStorageTotal(entries = []) {
  return entries.reduce((sum, entry) => {
    const qty = Number.isFinite(entry.quantity) ? entry.quantity : 0;
    return sum + Math.max(0, qty);
  }, 0);
}

function buildRenameTraceId(entry) {
  if (!entry) {
    return '';
  }
  const previous = typeof entry.previous === 'string' ? entry.previous.trim() : '';
  const current = typeof entry.current === 'string' ? entry.current.trim() : '';
  const changedAt = entry.changedAt ? new Date(entry.changedAt) : new Date();
  const timestamp = Number.isNaN(changedAt.getTime()) ? Date.now() : changedAt.getTime();
  return `${previous}|${current}|${timestamp}`;
}

function normalizeRenameLogEntry(entry, { source = 'manual' } = {}) {
  if (!entry) {
    return null;
  }
  const previous = typeof entry.previous === 'string' ? entry.previous.trim() : '';
  const current = typeof entry.current === 'string' ? entry.current.trim() : '';
  const rawChangedAt = entry.changedAt ? new Date(entry.changedAt) : new Date();
  const changedAt = Number.isNaN(rawChangedAt.getTime()) ? new Date() : rawChangedAt;
  const safeSource = typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : source;
  if (!previous && !current) {
    return null;
  }
  return {
    previous,
    current,
    changedAt,
    source: safeSource,
    traceId: buildRenameTraceId({ previous, current, changedAt })
  };
}

async function appendRenameTimeline(memberId, entry, options = {}) {
  const normalized = normalizeRenameLogEntry(entry, options);
  if (!memberId || !normalized) {
    return;
  }
  const collection = db.collection(COLLECTIONS.MEMBER_TIMELINE);
  if (!options.skipDuplicateCheck) {
    const exists = await collection
      .where({ memberId, type: 'rename', traceId: normalized.traceId })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    if (exists.data && exists.data.length) {
      return;
    }
  }
  await collection.add({
    data: {
      memberId,
      type: 'rename',
      traceId: normalized.traceId,
      previous: normalized.previous,
      current: normalized.current,
      source: normalized.source,
      changedAt: normalized.changedAt,
      createdAt: new Date()
    }
  });
}

async function loadRenameTimeline(memberId, limit = 20) {
  if (!memberId) {
    return [];
  }
  const collection = db.collection(COLLECTIONS.MEMBER_TIMELINE);
  const snapshot = await collection
    .where({ memberId, type: 'rename' })
    .orderBy('changedAt', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(Math.max(1, Math.min(limit, 50)))
    .get()
    .catch(() => ({ data: [] }));
  return (snapshot.data || []).map((item) => ({
    previous: item.previous || '',
    current: item.current || '',
    changedAt: item.changedAt || item.createdAt || new Date(),
    source: item.source || 'manual'
  }));
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const rawAction =
    event.action ?? event.actionName ?? event.action_type ?? event.type ?? event.operation;
  const action = normalizeAction(rawAction);
  let handler = ACTION_HANDLERS[action];

  if (!handler && typeof action === 'string') {
    const fallbackKey = ACTION_CANONICAL_MAP[action.replace(/[\s_-]+/g, '').toLowerCase()];
    if (fallbackKey) {
      handler = ACTION_HANDLERS[fallbackKey];
    }
  }

  if (!handler) {
    throw new Error(`Unknown action: ${action}`);
  }

  return handler(OPENID, event);
};

async function ensureAdmin(openid) {
  if (!openid) {
    throw new Error('未获取到用户身份');
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .get()
    .catch(() => null);
  const member = doc && doc.data;
  if (!member) {
    throw new Error('账号不存在');
  }
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    throw new Error('无权访问管理员功能');
  }
  return member;
}

function normalizeFeatureKey(input) {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === 'cashierEnabled') {
    return 'cashierEnabled';
  }
  const compact = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
  if (FEATURE_KEY_ALIASES[compact]) {
    return FEATURE_KEY_ALIASES[compact];
  }
  const lowercase = trimmed.toLowerCase();
  if (FEATURE_KEY_ALIASES[lowercase]) {
    return FEATURE_KEY_ALIASES[lowercase];
  }
  return '';
}

function resolveBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (
      ['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)
    ) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return resolveBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function trimToString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  try {
    const text = String(value);
    return text.trim();
  } catch (error) {
    return '';
  }
}

function normalizeImmortalTournament(config) {
  const normalized = { ...DEFAULT_IMMORTAL_TOURNAMENT };
  if (config && typeof config === 'object') {
    if (Object.prototype.hasOwnProperty.call(config, 'enabled')) {
      normalized.enabled = resolveBoolean(config.enabled, normalized.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationStart')) {
      normalized.registrationStart = trimToString(config.registrationStart);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationEnd')) {
      normalized.registrationEnd = trimToString(config.registrationEnd);
    }
  }
  return normalized;
}

function cloneImmortalTournament(config) {
  const normalized = normalizeImmortalTournament(config);
  return { ...normalized };
}

function serializeImmortalTournament(config) {
  return cloneImmortalTournament(config);
}

function sanitizeFeatureDocument(documentData) {
  if (!documentData || typeof documentData !== 'object') {
    return {};
  }
  return Object.keys(documentData).reduce((acc, key) => {
    if (key === '_id' || key === '_openid') {
      return acc;
    }
    acc[key] = documentData[key];
    return acc;
  }, {});
}

function normalizeFeatureToggles(documentData) {
  const toggles = {
    cashierEnabled: DEFAULT_FEATURE_TOGGLES.cashierEnabled,
    immortalTournament: cloneImmortalTournament(DEFAULT_FEATURE_TOGGLES.immortalTournament),
    cacheVersions: cloneCacheVersions(DEFAULT_FEATURE_TOGGLES.cacheVersions)
  };
  if (documentData && typeof documentData === 'object') {
    if (Object.prototype.hasOwnProperty.call(documentData, 'cashierEnabled')) {
      toggles.cashierEnabled = resolveBoolean(documentData.cashierEnabled, true);
    }
    if (Object.prototype.hasOwnProperty.call(documentData, 'immortalTournament')) {
      toggles.immortalTournament = cloneImmortalTournament(documentData.immortalTournament);
    }
    if (Object.prototype.hasOwnProperty.call(documentData, 'cacheVersions')) {
      toggles.cacheVersions = cloneCacheVersions(documentData.cacheVersions);
    }
  }
  return toggles;
}

async function loadSystemFeatureDocument() {
  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const snapshot = await collection
    .doc(FEATURE_TOGGLE_DOC_ID)
    .get()
    .catch((error) => {
      if (error && error.errMsg && /not exist|not found/i.test(error.errMsg)) {
        return null;
      }
      throw error;
    });
  return snapshot && snapshot.data ? snapshot.data : null;
}

async function getSystemFeatures(openid) {
  await ensureAdmin(openid);
  const documentData = await loadSystemFeatureDocument();
  const gameParameters = resolveGameParametersFromDocument(documentData);
  return {
    features: normalizeFeatureToggles(documentData),
    gameParameters: cloneGameParameters(gameParameters),
    rageSettings: cloneRageSettings(gameParameters.rage),
    defaults: {
      gameParameters: cloneGameParameters(DEFAULT_GAME_PARAMETERS),
      rageSettings: cloneRageSettings(DEFAULT_RAGE_SETTINGS)
    },
    updatedAt: documentData && documentData.updatedAt ? documentData.updatedAt : null
  };
}

function resolveFeatureEventKey(event = {}) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  const candidates = [
    event.featureKey,
    event.key,
    event.name,
    event.field,
    event.id,
    event.code
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const key = normalizeFeatureKey(candidates[i]);
    if (key) {
      return key;
    }
  }
  return '';
}

function resolveFeatureEventValue(event = {}, key, fallback) {
  if (!event || typeof event !== 'object') {
    return fallback;
  }
  if (Object.prototype.hasOwnProperty.call(event, 'enabled')) {
    return resolveBoolean(event.enabled, fallback);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'value')) {
    return resolveBoolean(event.value, fallback);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'open')) {
    return resolveBoolean(event.open, fallback);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'checked')) {
    return resolveBoolean(event.checked, fallback);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'state')) {
    return resolveBoolean(event.state, fallback);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'active')) {
    return resolveBoolean(event.active, fallback);
  }
  if (typeof key === 'string' && key) {
    if (Object.prototype.hasOwnProperty.call(event, key)) {
      return resolveBoolean(event[key], fallback);
    }
  }
  return fallback;
}

function normalizeCacheVersionScopeKey(input) {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/[\s_-]+/g, '').toLowerCase();
  return CACHE_VERSION_KEY_ALIASES[normalized] || '';
}

function resolveCacheVersionScope(event = {}) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  const candidates = [];
  if (Array.isArray(event.scopes)) {
    event.scopes.forEach((scope) => {
      candidates.push(scope);
    });
  }
  ['scope', 'target', 'key', 'name', 'type', 'code'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(event, field)) {
      candidates.push(event[field]);
    }
  });
  for (let i = 0; i < candidates.length; i += 1) {
    const resolved = normalizeCacheVersionScopeKey(candidates[i]);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function resolveCacheVersionTargets(scope, versions = {}) {
  const normalized = typeof scope === 'string' ? scope : '';
  if (!normalized) {
    return [];
  }
  if (normalized === 'all') {
    const keys = new Set([
      ...Object.keys(DEFAULT_CACHE_VERSIONS),
      ...Object.keys(versions || {})
    ]);
    return Array.from(keys);
  }
  return [normalized];
}

async function updateSystemFeature(openid, event = {}) {
  await ensureAdmin(openid);
  const key = resolveFeatureEventKey(event);
  if (!key) {
    throw new Error('未知功能开关');
  }

  const existingDocument = await loadSystemFeatureDocument();
  const currentToggles = normalizeFeatureToggles(existingDocument);
  const currentParameters = resolveGameParametersFromDocument(existingDocument);
  const currentCacheVersions = normalizeCacheVersions(
    existingDocument && existingDocument.cacheVersions
  );
  const nextValue = resolveFeatureEventValue(event, key, currentToggles[key]);

  if (currentToggles[key] === nextValue && existingDocument) {
    return {
      success: true,
      features: currentToggles,
      updatedAt: existingDocument.updatedAt || null
    };
  }

  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const now = new Date();
  const sanitizedExisting = sanitizeFeatureDocument(existingDocument);

  const payload = {
    ...sanitizedExisting,
    cashierEnabled: key === 'cashierEnabled' ? nextValue : currentToggles.cashierEnabled,
    immortalTournament: serializeImmortalTournament(currentToggles.immortalTournament),
    cacheVersions: cloneCacheVersions(currentCacheVersions),
    gameParameters: serializeGameParameters(currentParameters),
    updatedAt: now
  };
  if (!payload.createdAt) {
    payload.createdAt = now;
  }

  await collection.doc(FEATURE_TOGGLE_DOC_ID).set({ data: payload });

  const features = normalizeFeatureToggles(payload);
  return {
    success: true,
    features,
    updatedAt: now
  };
}

async function updateImmortalTournamentSettings(openid, updates = {}) {
  await ensureAdmin(openid);
  if (!updates || typeof updates !== 'object') {
    throw new Error('无效的配置参数');
  }

  const existingDocument = await loadSystemFeatureDocument();
  const currentToggles = normalizeFeatureToggles(existingDocument);
  const currentTournament = cloneImmortalTournament(currentToggles.immortalTournament);
  const currentParameters = resolveGameParametersFromDocument(existingDocument);
  const currentCacheVersions = normalizeCacheVersions(
    existingDocument && existingDocument.cacheVersions
  );

  let changed = false;
  const nextTournament = { ...currentTournament };

  if (Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
    const nextEnabled = resolveBoolean(updates.enabled, currentTournament.enabled);
    if (nextEnabled !== currentTournament.enabled) {
      nextTournament.enabled = nextEnabled;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'registrationStart')) {
    const value = trimToString(updates.registrationStart);
    if (value !== currentTournament.registrationStart) {
      nextTournament.registrationStart = value;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'registrationEnd')) {
    const value = trimToString(updates.registrationEnd);
    if (value !== currentTournament.registrationEnd) {
      nextTournament.registrationEnd = value;
      changed = true;
    }
  }

  if (!changed && existingDocument) {
    return {
      success: true,
      features: currentToggles,
      updatedAt: existingDocument.updatedAt || null
    };
  }

  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const now = new Date();
  const sanitizedExisting = sanitizeFeatureDocument(existingDocument);

  const payload = {
    ...sanitizedExisting,
    cashierEnabled: currentToggles.cashierEnabled,
    immortalTournament: serializeImmortalTournament(nextTournament),
    cacheVersions: cloneCacheVersions(currentCacheVersions),
    gameParameters: serializeGameParameters(currentParameters),
    updatedAt: now
  };
  if (!payload.createdAt) {
    payload.createdAt = now;
  }

  await collection.doc(FEATURE_TOGGLE_DOC_ID).set({ data: payload });

  const features = normalizeFeatureToggles(payload);
  return {
    success: true,
    features,
    updatedAt: now
  };
}

async function updateGameParameters(openid, updates = {}) {
  await ensureAdmin(openid);
  if (!updates || typeof updates !== 'object') {
    throw new Error('无效的参数配置');
  }

  const rageUpdates = updates.rage || updates.rageSettings;
  if (!rageUpdates || typeof rageUpdates !== 'object') {
    throw new Error('请提供真气参数配置');
  }

  const existingDocument = await loadSystemFeatureDocument();
  const currentToggles = normalizeFeatureToggles(existingDocument);
  const currentParameters = resolveGameParametersFromDocument(existingDocument);
  const nextParameters = cloneGameParameters(currentParameters);

  const rageKeys = ['start', 'turnGain', 'basicAttackGain', 'damageTakenMultiplier', 'critGain', 'critTakenGain'];
  const sanitizedInput = {};
  rageKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rageUpdates, key)) {
      const numeric = Number(rageUpdates[key]);
      if (!Number.isFinite(numeric)) {
        throw new Error('真气参数需为有效数值');
      }
      sanitizedInput[key] = numeric;
    }
  });

  if (!Object.keys(sanitizedInput).length) {
    throw new Error('未检测到可更新的真气参数');
  }

  const mergedRage = normalizeRageSettings({ ...currentParameters.rage, ...sanitizedInput });
  const rageChanged = rageKeys.some((key) => mergedRage[key] !== currentParameters.rage[key]);

  if (!rageChanged && existingDocument) {
    return {
      success: true,
      features: currentToggles,
      gameParameters: cloneGameParameters(currentParameters),
      rageSettings: cloneRageSettings(currentParameters.rage),
      updatedAt: existingDocument && existingDocument.updatedAt ? existingDocument.updatedAt : null,
      defaults: {
        gameParameters: cloneGameParameters(DEFAULT_GAME_PARAMETERS),
        rageSettings: cloneRageSettings(DEFAULT_RAGE_SETTINGS)
      }
    };
  }

  nextParameters.rage = mergedRage;

  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const now = new Date();
  const sanitizedExisting = sanitizeFeatureDocument(existingDocument);

  const payload = {
    ...sanitizedExisting,
    cashierEnabled: currentToggles.cashierEnabled,
    immortalTournament: serializeImmortalTournament(currentToggles.immortalTournament),
    cacheVersions: cloneCacheVersions(currentCacheVersions),
    gameParameters: serializeGameParameters(nextParameters),
    updatedAt: now
  };
  if (!payload.createdAt) {
    payload.createdAt = now;
  }

  await collection.doc(FEATURE_TOGGLE_DOC_ID).set({ data: payload });

  const features = normalizeFeatureToggles(payload);
  const gameParameters = resolveGameParametersFromDocument(payload);
  return {
    success: true,
    features,
    gameParameters: cloneGameParameters(gameParameters),
    rageSettings: cloneRageSettings(gameParameters.rage),
    updatedAt: now,
    defaults: {
      gameParameters: cloneGameParameters(DEFAULT_GAME_PARAMETERS),
      rageSettings: cloneRageSettings(DEFAULT_RAGE_SETTINGS)
    }
  };
}

async function bumpCacheVersion(openid, event = {}) {
  await ensureAdmin(openid);
  const scope = resolveCacheVersionScope(event);
  if (!scope) {
    throw new Error('请选择要刷新的缓存范围');
  }

  const existingDocument = await loadSystemFeatureDocument();
  const currentToggles = normalizeFeatureToggles(existingDocument);
  const currentParameters = resolveGameParametersFromDocument(existingDocument);
  const currentCacheVersions = normalizeCacheVersions(
    existingDocument && existingDocument.cacheVersions
  );

  const targets = Array.from(
    new Set(resolveCacheVersionTargets(scope, currentCacheVersions).filter(Boolean))
  );
  if (!targets.length) {
    throw new Error('未找到可刷新的缓存范围');
  }

  const nextCacheVersions = cloneCacheVersions(currentCacheVersions);
  targets.forEach((key) => {
    nextCacheVersions[key] = incrementCacheVersionValue(nextCacheVersions[key]);
  });

  const collection = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
  const now = new Date();
  const sanitizedExisting = sanitizeFeatureDocument(existingDocument);

  const payload = {
    ...sanitizedExisting,
    cashierEnabled: currentToggles.cashierEnabled,
    immortalTournament: serializeImmortalTournament(currentToggles.immortalTournament),
    cacheVersions: cloneCacheVersions(nextCacheVersions),
    gameParameters: serializeGameParameters(currentParameters),
    updatedAt: now
  };
  if (!payload.createdAt) {
    payload.createdAt = now;
  }

  await collection.doc(FEATURE_TOGGLE_DOC_ID).set({ data: payload });

  const features = normalizeFeatureToggles(payload);
  return {
    success: true,
    scope,
    targets,
    cacheVersions: cloneCacheVersions(nextCacheVersions),
    features,
    updatedAt: now
  };
}

async function resetImmortalTournament(openid, options = {}) {
  await ensureAdmin(openid);

  const scope = normalizeTournamentResetScope(options.scope);
  if (scope === 'all') {
    const summary = await resetAllImmortalTournamentData();
    const featureDocument = await loadSystemFeatureDocument();
    return {
      success: true,
      scope: 'all',
      summary,
      features: normalizeFeatureToggles(featureDocument)
    };
  }

  const season = await resolveTournamentSeasonForReset(options);
  if (!season) {
    const featureDocument = await loadSystemFeatureDocument();
    return {
      success: true,
      scope: 'season',
      season: null,
      summary: {
        message: '暂无可重置的赛季数据'
      },
      features: normalizeFeatureToggles(featureDocument)
    };
  }

  const summary = await resetImmortalTournamentSeason(season);
  const featureDocument = await loadSystemFeatureDocument();
  return {
    success: true,
    scope: 'season',
    season: {
      id: season._id,
      index: season.index || null,
      name: season.name || ''
    },
    summary,
    features: normalizeFeatureToggles(featureDocument)
  };
}

async function refreshImmortalTournamentPlayers(openid, options = {}) {
  await ensureAdmin(openid);

  const batchSize = resolveRefreshBatchSize(options.batchSize);
  const cursor = normalizeMemberIdValue(options.cursor);
  const previousProcessed = resolveNonNegativeInteger(options.processed);
  const previousRefreshed = resolveNonNegativeInteger(options.refreshed);
  const previousFailed = resolveNonNegativeInteger(options.failed);
  const maxDurationMs = resolveRefreshMaxDuration(options.maxDurationMs);

  const totalPromise = (() => {
    const knownTotal = Number(options.total);
    if (Number.isFinite(knownTotal) && knownTotal >= 0) {
      return Promise.resolve(Math.floor(knownTotal));
    }
    return getTotalMemberCount();
  })();

  const [{ ids: memberIds, nextCursor }, total] = await Promise.all([
    listMemberIdsBatch(cursor, batchSize),
    totalPromise
  ]);

  const summary = {
    success: true,
    total,
    batchSize,
    processed: 0,
    processedTotal: previousProcessed,
    refreshed: 0,
    refreshedTotal: previousRefreshed,
    failed: 0,
    failedTotal: previousFailed,
    remaining: Math.max(0, total - previousProcessed),
    durationMs: 0,
    cursor: '',
    hasMore: false,
    errors: []
  };

  if (!memberIds.length) {
    summary.cursor = '';
    summary.hasMore = false;
    summary.durationMs = 0;
    return summary;
  }

  const startTime = Date.now();
  const errorList = [];
  let lastProcessedId = cursor;
  let processedInBatch = 0;

  for (const memberId of memberIds) {
    const elapsed = Date.now() - startTime;
    if (processedInBatch > 0 && elapsed >= maxDurationMs) {
      break;
    }
    if (!memberId) {
      continue;
    }
    try {
      await callPveFunction('profile', { actorId: memberId, refreshOnly: true });
      await callPvpFunction('profile', { actorId: memberId, refreshOnly: true });
      summary.refreshed += 1;
      summary.refreshedTotal += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failedTotal += 1;
      summary.success = false;
      if (errorList.length < 10) {
        errorList.push({
          memberId,
          message: resolveErrorMessage(error, '刷新失败')
        });
      }
    } finally {
      summary.processed += 1;
      summary.processedTotal += 1;
      processedInBatch += 1;
      lastProcessedId = memberId;
    }
  }

  summary.durationMs = Date.now() - startTime;
  summary.errors = errorList;
  if (processedInBatch > 0 && processedInBatch < memberIds.length) {
    summary.cursor = lastProcessedId;
    summary.hasMore = true;
  } else {
    summary.cursor = nextCursor;
    summary.hasMore = Boolean(nextCursor);
  }
  summary.remaining = Math.max(0, total - summary.processedTotal);

  return summary;
}

function normalizeTournamentResetScope(scope) {
  if (typeof scope === 'string') {
    const normalized = scope.trim().toLowerCase();
    if (!normalized) {
      return 'season';
    }
    if (['all', 'allseasons', 'full', 'global', 'allseason', 'resetall'].includes(normalized)) {
      return 'all';
    }
  }
  return 'season';
}

function normalizeSeasonIdValue(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.floor(value));
  }
  return '';
}

function normalizeSeasonIndexValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const integer = Math.round(numeric);
    return integer > 0 ? integer : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const integer = Math.round(value);
    return integer > 0 ? integer : null;
  }
  return null;
}

async function resolveTournamentSeasonForReset(options = {}) {
  const collection = db.collection(COLLECTIONS.PVP_SEASONS);
  const seasonId = normalizeSeasonIdValue(
    options.seasonId || options.id || options.season || options.seasonKey
  );
  if (seasonId) {
    const snapshot = await collection
      .doc(seasonId)
      .get()
      .catch(() => null);
    if (snapshot && snapshot.data) {
      return snapshot.data;
    }
  }

  const seasonIndex = normalizeSeasonIndexValue(options.seasonIndex || options.index);
  if (seasonIndex) {
    const snapshot = await collection
      .where({ index: seasonIndex })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    if (snapshot.data && snapshot.data.length) {
      return snapshot.data[0];
    }
  }

  const activeSnapshot = await collection
    .where({ status: 'active' })
    .orderBy('startAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (activeSnapshot.data && activeSnapshot.data.length) {
    return activeSnapshot.data[0];
  }

  const latestSnapshot = await collection
    .orderBy('startAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (latestSnapshot.data && latestSnapshot.data.length) {
    return latestSnapshot.data[0];
  }
  return null;
}

async function resetImmortalTournamentSeason(season) {
  if (!season || !season._id) {
    return {
      message: '赛季信息缺失'
    };
  }
  const seasonId = season._id;
  const summary = { removed: {}, errors: [] };

  const removedInvites = await removeCollectionDocumentsByCondition(
    COLLECTIONS.PVP_INVITES,
    { seasonId },
    'pvpInvites',
    summary
  );
  const removedMatches = await removeCollectionDocumentsByCondition(
    COLLECTIONS.PVP_MATCHES,
    { seasonId },
    'pvpMatches',
    summary
  );
  const removedLeaderboards = await removeCollectionDocumentsByCondition(
    COLLECTIONS.PVP_LEADERBOARD,
    { seasonId },
    'pvpLeaderboard',
    summary
  );

  const removedProfiles = await resetPvpProfilesForSeason(season, summary);

  const now = new Date();
  const endAt = new Date(now.getTime() + DEFAULT_PVP_SEASON_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  await db
    .collection(COLLECTIONS.PVP_SEASONS)
    .doc(seasonId)
    .update({
      data: {
        status: 'active',
        startAt: now,
        endAt,
        updatedAt: now,
        seasonId,
        name: season.name || `第${season.index || ''}赛季`
      }
    })
    .then(() => {
      summary.seasonReset = true;
    })
    .catch((error) => {
      if (!isNotFoundError(error)) {
        pushCleanupError(summary, COLLECTIONS.PVP_SEASONS, error, seasonId);
      }
    });

  return {
    removedInvites,
    removedMatches,
    removedLeaderboards,
    removedProfiles,
    summary
  };
}

async function resetAllImmortalTournamentData() {
  const summary = { removed: {}, errors: [] };
  const targets = [
    { collection: COLLECTIONS.PVP_INVITES, key: 'pvpInvites' },
    { collection: COLLECTIONS.PVP_MATCHES, key: 'pvpMatches' },
    { collection: COLLECTIONS.PVP_LEADERBOARD, key: 'pvpLeaderboard' },
    { collection: COLLECTIONS.PVP_PROFILES, key: 'pvpProfiles' },
    { collection: COLLECTIONS.PVP_SEASONS, key: 'pvpSeasons' }
  ];

  for (const target of targets) {
    await cleanupCollectionDocuments(target.collection, summary, { counterKey: target.key });
  }

  return summary;
}

async function removeCollectionDocumentsByCondition(collectionName, condition, counterKey, summary) {
  const collection = db.collection(collectionName);
  const limit = 100;
  let removed = 0;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 200) {
    const snapshot = await collection
      .where(condition)
      .orderBy('_id', 'asc')
      .limit(limit)
      .field({ _id: true })
      .get()
      .catch(() => ({ data: [] }));
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    await Promise.all(
      docs.map((doc) => {
        if (!doc || !doc._id) {
          return Promise.resolve();
        }
        return collection
          .doc(doc._id)
          .remove()
          .then(() => {
            removed += 1;
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, collectionName, error, doc._id);
            }
          });
      })
    );
    if (docs.length < limit) {
      hasMore = false;
    }
    guard += 1;
  }

  if (removed > 0) {
    if (!summary.removed || typeof summary.removed !== 'object') {
      summary.removed = {};
    }
    summary.removed[counterKey || collectionName] =
      (summary.removed[counterKey || collectionName] || 0) + removed;
  }

  return removed;
}

async function resetPvpProfilesForSeason(season, summary) {
  if (!season || !season._id) {
    return 0;
  }
  return removeCollectionDocumentsByCondition(
    COLLECTIONS.PVP_PROFILES,
    { seasonId: season._id },
    'pvpProfiles',
    summary
  );
}

async function listMembers(openid, keyword, page, pageSize) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  const regex = keyword
    ? db.RegExp({
        regexp: keyword,
        options: 'i'
      })
    : null;

  let baseQuery = db.collection(COLLECTIONS.MEMBERS);
  if (regex) {
    baseQuery = baseQuery.where(
      _.or([
        { nickName: regex },
        { mobile: regex },
        { realName: regex }
      ])
    );
  }

  const [snapshot, countResult, levels] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count(),
    loadLevels()
  ]);

  const levelMap = buildLevelMap(levels);
  const members = snapshot.data.map((member) => decorateMemberRecord(member, levelMap));
  return {
    members,
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function getMemberDetail(openid, memberId, options = {}) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  return fetchMemberDetail(memberId, openid, options);
}

async function updateMember(openid, memberId, updates, options = {}) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const memberDoc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .get()
    .catch(() => null);
  if (!memberDoc || !memberDoc.data) {
    throw new Error('会员不存在');
  }
  const extras = await resolveMemberExtras(memberId);
  const { memberUpdates, extrasUpdates, renameLog } = buildUpdatePayload(updates, memberDoc.data, extras);
  if (!Object.keys(memberUpdates).length && !Object.keys(extrasUpdates).length && !renameLog) {
    return fetchMemberDetail(memberId, openid, options);
  }
  const now = new Date();
  const tasks = [];
  const shouldSyncLevel =
    Object.prototype.hasOwnProperty.call(memberUpdates, 'experience') ||
    Object.prototype.hasOwnProperty.call(memberUpdates, 'levelId');
  if (Object.keys(memberUpdates).length) {
    tasks.push(
      db
        .collection(COLLECTIONS.MEMBERS)
        .doc(memberId)
        .update({
          data: { ...memberUpdates, updatedAt: now }
        })
    );
  }
  if (Object.keys(extrasUpdates).length) {
    tasks.push(updateMemberExtras(memberId, extrasUpdates));
  }
  if (renameLog) {
    tasks.push(appendRenameTimeline(memberId, { ...renameLog, changedAt: renameLog.changedAt || now }, { skipDuplicateCheck: true }));
  }
  if (tasks.length) {
    await Promise.all(tasks);
  }
  if (shouldSyncLevel) {
    await syncMemberLevel(memberId);
  }
  return fetchMemberDetail(memberId, openid, options);
}

async function listWineStorage(openid, memberId) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const extras = await resolveMemberExtras(memberId);
  const entries = normalizeWineStorageEntries(extras.wineStorage);
  return {
    entries: entries.map((entry) => serializeWineStorageEntry(entry)),
    totalQuantity: calculateWineStorageTotal(entries)
  };
}

async function addWineStorage(openid, memberId, payload = {}) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    throw new Error('请输入存酒名称');
  }
  const rawQuantity = Number(payload.quantity || 0);
  const quantity = Number.isFinite(rawQuantity) ? Math.max(1, Math.floor(rawQuantity)) : 0;
  if (!quantity) {
    throw new Error('请输入有效的存酒数量');
  }
  const extras = await resolveMemberExtras(memberId);
  const entries = normalizeWineStorageEntries(extras.wineStorage);
  const entry = {
    id: generateWineStorageId(),
    name,
    quantity,
    createdAt: new Date(),
    expiresAt: resolveWineStorageExpiry(payload.expiryOption)
  };
  const updatedEntries = sortWineStorageEntries([...entries, entry]);
  await updateMemberExtras(memberId, { wineStorage: prepareWineStorageForSave(updatedEntries) });
  return {
    entry: serializeWineStorageEntry(entry),
    entries: updatedEntries.map((item) => serializeWineStorageEntry(item)),
    totalQuantity: calculateWineStorageTotal(updatedEntries)
  };
}

async function removeWineStorage(openid, memberId, entryId) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const targetId = typeof entryId === 'string' ? entryId.trim() : '';
  if (!targetId) {
    throw new Error('缺少存酒编号');
  }
  const extras = await resolveMemberExtras(memberId);
  const entries = normalizeWineStorageEntries(extras.wineStorage);
  const filtered = entries.filter((entry) => entry.id !== targetId);
  if (filtered.length === entries.length) {
    throw new Error('存酒记录不存在');
  }
  await updateMemberExtras(memberId, { wineStorage: prepareWineStorageForSave(filtered) });
  return {
    removedId: targetId,
    entries: filtered.map((entry) => serializeWineStorageEntry(entry)),
    totalQuantity: calculateWineStorageTotal(filtered)
  };
}

async function deleteMember(openid, memberId) {
  const admin = await ensureAdmin(openid);
  const targetId = normalizeMemberIdValue(memberId);
  if (!targetId) {
    throw new Error('缺少会员编号');
  }
  const deletingSelf = targetId === admin._id;
  const memberDoc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(targetId)
    .get()
    .catch(() => null);
  if (!memberDoc || !memberDoc.data) {
    throw new Error('会员不存在');
  }
  const cleanup = await cleanupMemberData(targetId);
  return {
    success: true,
    memberId: targetId,
    cleanup,
    selfDeleted: deletingSelf
  };
}

async function listEquipmentCatalog(openid) {
  await ensureAdmin(openid);
  const result = await callPveFunction('listEquipmentCatalog', { actorId: openid }).catch((error) => {
    console.error('[admin] list equipment catalog failed', error);
    throw new Error(error && error.errMsg ? error.errMsg : '获取装备列表失败');
  });
  return result && result.items ? result : { items: [] };
}

async function grantEquipment(openid, memberId, itemId) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  if (!itemId) {
    throw new Error('请选择装备');
  }
  const result = await callPveFunction('grantEquipment', { actorId: openid, memberId, itemId }).catch((error) => {
    console.error('[admin] grant equipment failed', error);
    throw new Error(error && error.errMsg ? error.errMsg : '发放装备失败');
  });
  return result || {};
}

async function removeEquipment(openid, memberId, itemId, inventoryId) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  if (!itemId) {
    throw new Error('请选择要删除的装备');
  }
  const payload = { actorId: openid, memberId, itemId };
  if (inventoryId) {
    payload.inventoryId = inventoryId;
  }
  const result = await callPveFunction('removeEquipment', payload).catch((error) => {
    console.error('[admin] remove equipment failed', error);
    throw new Error(error && error.errMsg ? error.errMsg : '删除装备失败');
  });
  return result || {};
}

async function updateEquipmentAttributes(openid, memberId, itemId, attributes = {}, event = {}) {
  await ensureAdmin(openid);
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  if (!itemId) {
    throw new Error('请选择装备');
  }
  const payload = { ...(attributes || {}) };
  if (typeof event.refine !== 'undefined' && typeof payload.refine === 'undefined') {
    payload.refine = event.refine;
  }
  if (typeof event.level !== 'undefined' && typeof payload.level === 'undefined') {
    payload.level = event.level;
  }
  if (typeof event.favorite !== 'undefined' && typeof payload.favorite === 'undefined') {
    payload.favorite = event.favorite;
  }
  const sanitizedAttributes = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'refine')) {
    sanitizedAttributes.refine = payload.refine;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'level')) {
    sanitizedAttributes.level = payload.level;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'favorite')) {
    sanitizedAttributes.favorite = payload.favorite;
  }
  if (!Object.keys(sanitizedAttributes).length) {
    throw new Error('请填写要调整的属性');
  }
  const result = await callPveFunction('updateEquipmentAttributes', {
    actorId: openid,
    memberId,
    itemId,
    inventoryId: event.inventoryId,
    attributes: sanitizedAttributes
  }).catch((error) => {
    console.error('[admin] update equipment attributes failed', error);
    throw new Error(error && error.errMsg ? error.errMsg : '修改装备失败');
  });
  return result || {};
}

async function createChargeOrder(openid, items) {
  const admin = await ensureAdmin(openid);
  const normalizedItems = normalizeChargeItems(items);
  if (!normalizedItems.length) {
    throw new Error('请添加有效的扣费商品');
  }
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  if (!totalAmount || totalAmount <= 0) {
    throw new Error('扣费金额无效');
  }
  const diningAmount = normalizedItems.reduce((sum, item) => {
    if (!item || !item.isDining) {
      return sum;
    }
    return sum + item.amount;
  }, 0);
  const now = new Date();
  const expireAt = new Date(now.getTime() + 10 * 60 * 1000);
  const orderData = {
    status: 'pending',
    items: normalizedItems,
    totalAmount,
    stoneReward: totalAmount,
    diningAmount: Math.min(totalAmount, Math.max(0, diningAmount)),
    createdBy: admin._id,
    createdAt: now,
    updatedAt: now,
    expireAt
  };
  const result = await db.collection(COLLECTIONS.CHARGE_ORDERS).add({
    data: orderData
  });
  return mapChargeOrder({
    _id: result._id,
    ...orderData
  });
}

async function getChargeOrder(openid, orderId) {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少扣费单编号');
  }
  const doc = await db
    .collection(COLLECTIONS.CHARGE_ORDERS)
    .doc(orderId)
    .get()
    .catch(() => null);
  if (!doc || !doc.data) {
    throw new Error('扣费单不存在');
  }
  return mapChargeOrder({
    _id: doc.data._id || orderId,
    ...doc.data
  });
}

async function getChargeOrderQrCode(openid, orderId) {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少扣费单编号');
  }

  const doc = await db
    .collection(COLLECTIONS.CHARGE_ORDERS)
    .doc(orderId)
    .get()
    .catch(() => null);

  if (!doc || !doc.data) {
    throw new Error('扣费单不存在');
  }

  const orderIdValue = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!orderIdValue) {
    throw new Error('扣费单编号无效');
  }

  const scene = buildChargeOrderScene(orderIdValue);
  if (!scene) {
    console.warn('Charge order scene fallback to raw id because scene is empty', orderIdValue);
  }

  const schemeResult = await generateChargeOrderUrlScheme(orderIdValue, doc.data.expireAt);

  return {
    scene,
    page: 'pages/wallet/charge-confirm/index',
    path: buildChargeOrderPagePath(orderIdValue),
    payload: buildChargeOrderPayload(orderIdValue),
    schemeUrl: schemeResult.schemeUrl,
    schemeExpireAt: schemeResult.schemeExpireAt
  };
}

async function listChargeOrders(openid, { page = 1, pageSize = 20, memberId = '', keyword = '' }) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  let baseQuery = db.collection(COLLECTIONS.CHARGE_ORDERS);
  let memberIdFilter = memberId && typeof memberId === 'string' ? memberId.trim() : '';

  if (!memberIdFilter && keyword) {
    const matchedMemberIds = (await searchMemberIdsByKeyword(keyword)).slice(0, 10);
    if (!matchedMemberIds.length) {
      return {
        orders: [],
        total: 0,
        page,
        pageSize: limit
      };
    }
    memberIdFilter = null;
    baseQuery = baseQuery.where({
      memberId: _.in(matchedMemberIds)
    });
  } else if (memberIdFilter) {
    baseQuery = baseQuery.where({ memberId: memberIdFilter });
  }

  const [snapshot, countResult] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count()
  ]);

  const rawOrders = snapshot.data || [];
  const memberIds = Array.from(
    new Set(
      rawOrders
        .map((order) => order.memberId)
        .filter((id) => typeof id === 'string' && id)
    )
  );
  const memberMap = await loadMembersMap(memberIds);

  const orders = rawOrders.map((order) =>
    decorateChargeOrderRecord(
      mapChargeOrder({
        _id: order._id,
        ...order
      }),
      memberMap[order.memberId]
    )
  );

  return {
    orders,
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function forceChargeOrder(openid, orderId, { memberId = '', remark = '', allowNegativeBalance = false } = {}) {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const normalizedRemark = typeof remark === 'string' ? remark.trim() : '';
  let targetMemberId = '';
  let stoneReward = 0;
  let experienceGain = 0;
  let balanceBefore = 0;
  let balanceAfter = 0;
  let debtIncurred = false;
  let allowNegativeApplied = false;
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(orderId);
    const orderDoc = await orderRef.get().catch(() => null);
    if (!orderDoc || !orderDoc.data) {
      throw new Error('订单不存在');
    }
    const order = orderDoc.data;
    const status = order.status || 'pending';
    if (status === 'paid') {
      throw new Error('订单已完成');
    }
    if (status === 'cancelled') {
      throw new Error('订单已取消');
    }
    targetMemberId = order.memberId || (typeof memberId === 'string' ? memberId.trim() : '');
    if (!targetMemberId) {
      throw new Error('请先关联会员');
    }
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(targetMemberId);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    const amount = Number(order.totalAmount || 0);
    if (!amount || amount <= 0) {
      throw new Error('订单金额无效');
    }
    const balance = resolveCashBalance(memberDoc.data);
    balanceBefore = balance;
    balanceAfter = balance - amount;
    debtIncurred = balanceAfter < 0;
    allowNegativeApplied = balance < amount;
    if (allowNegativeApplied && !allowNegativeBalance) {
      const shortage = amount - balance;
      const error = new Error('会员余额不足');
      error.code = 'INSUFFICIENT_BALANCE';
      error.errCode = 'INSUFFICIENT_BALANCE';
      error.details = {
        balance,
        amount,
        shortage,
        balanceAfter
      };
      error.data = error.details;
      error.shortage = shortage;
      error.amount = amount;
      error.balance = balance;
      error.balanceAfter = balanceAfter;
      throw error;
    }
    const memberSnapshot = buildMemberSnapshot(memberDoc.data);
    stoneReward = Number(order.stoneReward || amount || 0);
    if (!stoneReward || stoneReward <= 0) {
      stoneReward = amount;
    }
    experienceGain = calculateExperienceGain(amount);
    await memberRef.update({
      data: {
        cashBalance: _.inc(-amount),
        totalSpend: _.inc(amount),
        stoneBalance: _.inc(stoneReward),
        updatedAt: now,
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
      }
    });
    const walletRemark = normalizedRemark ? `管理员扣款(${normalizedRemark})` : '管理员扣款';
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: targetMemberId,
        amount: -amount,
        type: 'spend',
        status: 'success',
        source: 'menuOrder',
        orderId,
        remark: walletRemark,
        createdAt: now,
        updatedAt: now,
        balanceBefore,
        balanceAfter,
        allowNegativeBalance: allowNegativeApplied,
        debtIncurred
      }
    });
    await transaction.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
      data: {
        memberId: targetMemberId,
        amount: stoneReward,
        type: 'earn',
        source: 'menuOrder',
        description: '菜单消费赠送灵石',
        createdAt: now,
        meta: {
          orderId,
          forcedBy: openid
        }
      }
    });
    await orderRef.update({
      data: {
        status: 'paid',
        memberId: targetMemberId,
        memberSnapshot,
        confirmedAt: now,
        stoneReward,
        updatedAt: now,
        balanceBefore,
        balanceAfter,
        allowNegativeBalance: allowNegativeApplied,
        debtIncurred
      }
    });
    if (order.menuOrderId) {
      const menuOrderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(order.menuOrderId);
      const menuOrderDoc = await menuOrderRef.get().catch(() => null);
      if (menuOrderDoc && menuOrderDoc.data) {
        await menuOrderRef.update({
          data: {
            status: 'paid',
            memberId: targetMemberId,
            memberSnapshot,
            memberConfirmedAt: now,
            updatedAt: now,
            chargeOrderId: orderId,
            forceChargedBy: openid,
            forceChargedAt: now,
            balanceBefore,
            balanceAfter,
            allowNegativeBalance: allowNegativeApplied,
            debtIncurred
          }
        });
      }
    }
  });
  if (experienceGain > 0 && targetMemberId) {
    await syncMemberLevel(targetMemberId);
  }
  return {
    success: true,
    stoneReward,
    experienceGain,
    memberId: targetMemberId,
    balanceBefore,
    balanceAfter,
    debtIncurred,
    allowNegativeBalance: allowNegativeApplied
  };
}

async function cancelChargeOrder(openid, orderId, remark = '') {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const normalizedRemark =
    typeof remark === 'string' ? remark.trim().slice(0, 200) : '';
  const cancelRemark = normalizedRemark || '管理员取消订单';
  const now = new Date();
  let updatedOrder = null;
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction
      .collection(COLLECTIONS.CHARGE_ORDERS)
      .doc(orderId);
    const orderDoc = await orderRef.get().catch(() => null);
    if (!orderDoc || !orderDoc.data) {
      throw new Error('订单不存在');
    }
    const order = orderDoc.data;
    const status = order.status || 'pending';
    if (status === 'paid') {
      throw new Error('订单已完成，无法取消');
    }
    if (status === 'cancelled') {
      updatedOrder = { _id: orderId, ...order };
      return;
    }
    if (!['pending', 'created'].includes(status)) {
      throw new Error('订单当前不可取消');
    }
    const chargeUpdates = {
      status: 'cancelled',
      cancelRemark,
      cancelReason: 'adminCancelled',
      cancelledAt: now,
      cancelledBy: openid,
      cancelledByRole: 'admin',
      updatedAt: now
    };
    await orderRef.update({ data: chargeUpdates });
    updatedOrder = { ...order, ...chargeUpdates };

    const menuOrderId =
      typeof order.menuOrderId === 'string' ? order.menuOrderId.trim() : '';
    if (!menuOrderId) {
      return;
    }
    const menuOrderRef = transaction
      .collection(COLLECTIONS.MENU_ORDERS)
      .doc(menuOrderId);
    const menuSnapshot = await menuOrderRef.get().catch(() => null);
    if (!menuSnapshot || !menuSnapshot.data) {
      return;
    }
    const menuOrder = menuSnapshot.data;
    if (menuOrder.status === 'paid' || menuOrder.status === 'cancelled') {
      return;
    }
    const menuUpdates = {
      status: 'cancelled',
      cancelRemark,
      cancelReason: 'adminCancelled',
      cancelledAt: now,
      cancelledBy: openid,
      cancelledByRole: 'admin',
      updatedAt: now
    };
    await menuOrderRef.update({ data: menuUpdates });
    const appliedRights = Array.isArray(menuOrder.appliedRights)
      ? menuOrder.appliedRights
      : [];
    for (const applied of appliedRights) {
      const memberRightId =
        applied && typeof applied.memberRightId === 'string'
          ? applied.memberRightId.trim()
          : '';
      if (!memberRightId) {
        continue;
      }
      await transaction
        .collection(COLLECTIONS.MEMBER_RIGHTS)
        .doc(memberRightId)
        .update({
          data: {
            status: 'active',
            updatedAt: now,
            orderId: _.remove(),
            lockedAt: _.remove(),
            usedAt: _.remove()
          }
        })
        .catch(() => null);
    }
  });
  return { order: mapChargeOrder(updatedOrder) };
}

async function adjustChargeOrderAmount(openid, orderId, { amount, remark = '' } = {}) {
  await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const normalizedAmount = normalizeAmountFen(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    throw new Error('改价金额无效');
  }
  const normalizedRemark = typeof remark === 'string' ? remark.trim() : '';
  let updatedOrder = null;
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(orderId);
    const orderSnapshot = await orderRef.get().catch(() => null);
    if (!orderSnapshot || !orderSnapshot.data) {
      throw new Error('订单不存在');
    }
    const order = orderSnapshot.data;
    if (order.status === 'paid') {
      throw new Error('订单已完成，无法改价');
    }
    if (order.status === 'cancelled') {
      throw new Error('订单已取消，无法改价');
    }
    const previousAmount = Number(order.totalAmount || 0);
    if (!previousAmount || previousAmount <= 0) {
      throw new Error('订单金额无效');
    }
    const existingAdjustmentRemark =
      order.priceAdjustment && typeof order.priceAdjustment.remark === 'string'
        ? order.priceAdjustment.remark
        : '';
    if (previousAmount === normalizedAmount && normalizedRemark === existingAdjustmentRemark) {
      throw new Error('改价金额未变化');
    }
    const now = new Date();
    const adjustmentEntry = {
      previousAmount,
      newAmount: normalizedAmount,
      remark: normalizedRemark,
      adjustedAt: now,
      adjustedBy: openid
    };
    const history = Array.isArray(order.priceAdjustmentHistory)
      ? [adjustmentEntry, ...order.priceAdjustmentHistory].slice(0, 10)
      : [adjustmentEntry];
    const chargeUpdates = {
      totalAmount: normalizedAmount,
      stoneReward: normalizedAmount,
      updatedAt: now,
      priceAdjustment: adjustmentEntry,
      priceAdjustmentHistory: history,
      originalTotalAmount:
        Number(order.originalTotalAmount || 0) > 0
          ? Number(order.originalTotalAmount)
          : previousAmount
    };
    const existingDiningAmount = Number(order.diningAmount || 0);
    if (Number.isFinite(existingDiningAmount) && existingDiningAmount > 0) {
      chargeUpdates.diningAmount = Math.min(normalizedAmount, Math.max(0, Math.round(existingDiningAmount)));
    }
    await orderRef.update({ data: chargeUpdates });

    if (order.menuOrderId) {
      const menuOrderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(order.menuOrderId);
      const menuSnapshot = await menuOrderRef.get().catch(() => null);
      if (menuSnapshot && menuSnapshot.data) {
        const menuOrder = menuSnapshot.data;
        const menuPreviousAmount = Number(menuOrder.totalAmount || 0);
        const menuHistory = Array.isArray(menuOrder.adminPriceAdjustmentHistory)
          ? [adjustmentEntry, ...menuOrder.adminPriceAdjustmentHistory].slice(0, 10)
          : [adjustmentEntry];
        const menuUpdates = {
          totalAmount: normalizedAmount,
          updatedAt: now,
          adminPriceAdjustment: adjustmentEntry,
          adminPriceAdjustmentHistory: menuHistory,
          originalTotalAmount:
            Number(menuOrder.originalTotalAmount || 0) > 0
              ? Number(menuOrder.originalTotalAmount)
              : menuPreviousAmount || previousAmount
        };
        await menuOrderRef.update({ data: menuUpdates });
      }
    }
    updatedOrder = { ...order, ...chargeUpdates };
  });
  return { order: mapChargeOrder(updatedOrder) };
}

async function rechargeMember(openid, memberId, amount, options = {}) {
  await ensureAdmin(openid);
  const numericAmount = normalizeAmountFen(amount);
  if (!numericAmount || numericAmount <= 0) {
    throw new Error('充值金额无效');
  }
  if (!memberId) {
    throw new Error('缺少会员编号');
  }
  const now = new Date();
  const experienceGain = calculateExperienceGain(numericAmount);
  await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(memberId);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    await memberRef.update({
      data: {
        cashBalance: _.inc(numericAmount),
        totalRecharge: _.inc(numericAmount),
        updatedAt: now,
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId,
        amount: numericAmount,
        type: 'recharge',
        status: 'success',
        source: 'admin',
        remark: '管理员充值',
        createdAt: now,
        updatedAt: now
      }
    });
  });
  if (experienceGain > 0) {
    await syncMemberLevel(memberId);
  }
  return fetchMemberDetail(memberId, openid, options);
}

async function listReservations(openid, { status = 'pendingApproval', page = 1, pageSize = 20 } = {}) {
  await ensureAdmin(openid);
  const limit = Math.min(Math.max(pageSize, 1), 50);
  const skip = Math.max(page - 1, 0) * limit;

  let baseQuery = db.collection(COLLECTIONS.RESERVATIONS);
  if (status && status !== 'all') {
    baseQuery = baseQuery.where({ status });
  }

  const [snapshot, countResult] = await Promise.all([
    baseQuery
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get(),
    baseQuery.count()
  ]);

  const reservations = snapshot.data || [];
  const memberIds = Array.from(
    new Set(reservations.map((item) => item.memberId).filter((id) => typeof id === 'string' && id))
  );
  const roomIds = Array.from(
    new Set(reservations.map((item) => item.roomId).filter((id) => typeof id === 'string' && id))
  );

  const [memberMap, roomMap] = await Promise.all([
    loadMembersMap(memberIds),
    loadRoomsMap(roomIds)
  ]);

  return {
    reservations: reservations.map((item) =>
      decorateReservationRecord(
        { _id: item._id, ...item },
        memberMap[item.memberId],
        roomMap[item.roomId]
      )
    ),
    total: countResult.total,
    page,
    pageSize: limit
  };
}

async function getReservationOverview(openid, { days: requestedDays = 16 } = {}) {
  await ensureAdmin(openid);
  const numericDays = Number(requestedDays);
  const totalDays = Math.min(
    Math.max(Number.isFinite(numericDays) ? Math.floor(numericDays) : 16, 1),
    31
  );
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const dayKeys = [];
  for (let i = 0; i < totalDays; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    dayKeys.push(formatDateLabel(date));
  }
  if (!dayKeys.length) {
    return { days: [], generatedAt: formatDate(new Date()) };
  }

  const startKey = dayKeys[0];
  const endKey = dayKeys[dayKeys.length - 1];

  const snapshot = await db
    .collection(COLLECTIONS.RESERVATIONS)
    .where({
      date: _.gte(startKey).and(_.lte(endKey)),
      status: _.in(ACTIVE_RESERVATION_STATUSES)
    })
    .orderBy('date', 'asc')
    .orderBy('startTime', 'asc')
    .limit(totalDays * 50)
    .get();

  const reservations = snapshot.data || [];
  if (!reservations.length) {
    return {
      days: dayKeys.map((key, index) => {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);
        return {
          date: key,
          weekday: WEEKDAY_LABELS[date.getDay()],
          reservations: []
        };
      }),
      generatedAt: formatDate(new Date())
    };
  }

  const memberIds = Array.from(
    new Set(reservations.map((item) => item.memberId).filter((id) => typeof id === 'string' && id))
  );
  const roomIds = Array.from(
    new Set(reservations.map((item) => item.roomId).filter((id) => typeof id === 'string' && id))
  );

  const [memberMap, roomMap] = await Promise.all([
    loadMembersMap(memberIds),
    loadRoomsMap(roomIds)
  ]);

  const decorated = reservations.map((item) =>
    decorateReservationRecord(
      { _id: item._id, ...item },
      memberMap[item.memberId],
      roomMap[item.roomId]
    )
  );

  const grouped = decorated.reduce((acc, item) => {
    if (!item || !item.date) {
      return acc;
    }
    if (!acc[item.date]) {
      acc[item.date] = [];
    }
    acc[item.date].push({
      _id: item._id,
      memberId: item.memberId,
      memberName: item.memberName,
      memberRealName: item.memberRealName,
      memberMobile: item.memberMobile,
      roomId: item.roomId,
      roomName: item.roomName,
      startTime: item.startTime,
      endTime: item.endTime,
      status: item.status,
      statusLabel: item.statusLabel
    });
    return acc;
  }, {});

  Object.keys(grouped).forEach((key) => {
    grouped[key].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  });

  const days = dayKeys.map((key, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      date: key,
      weekday: WEEKDAY_LABELS[date.getDay()],
      reservations: grouped[key] || []
    };
  });

  return {
    days,
    generatedAt: formatDate(new Date())
  };
}

async function approveReservation(openid, reservationId) {
  await ensureAdmin(openid);
  if (!reservationId) {
    throw new Error('缺少预约编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = snapshot.data;
    if (reservation.status === 'approved') {
      return;
    }
    if (reservation.status !== 'pendingApproval') {
      throw new Error('预约已处理，无法重复审核');
    }
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'approved',
        approval: {
          ...(reservation.approval || {}),
          status: 'approved',
          decidedAt: now,
          decidedBy: openid,
          reason: ''
        },
        updatedAt: now
      }
    });

    await incrementMemberReservationBadge(transaction, reservation.memberId);
  });
  await updateAdminReservationBadges({ incrementVersion: false });
  return getReservationRecord(reservationId);
}

async function rejectReservation(openid, reservationId, reason = '') {
  await ensureAdmin(openid);
  if (!reservationId) {
    throw new Error('缺少预约编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = { ...snapshot.data, _id: reservationId };
    if (reservation.status === 'rejected') {
      return;
    }
    if (reservation.status !== 'pendingApproval') {
      throw new Error('预约已处理，无法拒绝');
    }
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'rejected',
        approval: {
          ...(reservation.approval || {}),
          status: 'rejected',
          decidedAt: now,
          decidedBy: openid,
          reason: reason || ''
        },
        updatedAt: now
      }
    });

    await releaseReservationResources(transaction, reservation, { refundUsage: true, unlockRight: true });

    await incrementMemberReservationBadge(transaction, reservation.memberId);
  });

  await updateAdminReservationBadges({ incrementVersion: false });
  return getReservationRecord(reservationId);
}

async function cancelReservation(openid, reservationId, reason = '') {
  await ensureAdmin(openid);
  if (!reservationId) {
    throw new Error('缺少预约编号');
  }
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = { ...snapshot.data, _id: reservationId };
    if (reservation.status === 'cancelled') {
      return;
    }
    const cancellableStatuses = [
      'pendingApproval',
      'approved',
      'reserved',
      'confirmed',
      'pendingPayment'
    ];
    if (!cancellableStatuses.includes(reservation.status)) {
      throw new Error('当前状态不可取消');
    }
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'cancelled',
        approval: {
          ...(reservation.approval || {}),
          status: 'cancelled',
          decidedAt: now,
          decidedBy: openid,
          reason: reason || '管理员取消预约'
        },
        updatedAt: now
      }
    });

    await releaseReservationResources(transaction, reservation, { refundUsage: true, unlockRight: true });
    await incrementMemberReservationBadge(transaction, reservation.memberId);
  });

  await updateAdminReservationBadges({ incrementVersion: false });
  return getReservationRecord(reservationId);
}

async function markReservationRead(openid) {
  const member = await ensureAdmin(openid);
  const badges = normalizeReservationBadges(member.reservationBadges);
  if (badges.adminSeenVersion >= badges.adminVersion) {
    return { success: true, reservationBadges: badges };
  }
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(member._id)
    .update({
      data: {
        'reservationBadges.adminSeenVersion': badges.adminVersion,
        updatedAt: new Date()
      }
    })
    .catch(() => {});
  const updatedBadges = { ...badges, adminSeenVersion: badges.adminVersion };
  return { success: true, reservationBadges: updatedBadges };
}

async function getReservationRecord(reservationId) {
  if (!reservationId) {
    return null;
  }
  const snapshot = await db
    .collection(COLLECTIONS.RESERVATIONS)
    .doc(reservationId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    return null;
  }
  const reservation = { _id: reservationId, ...snapshot.data };
  const [memberMap, roomMap] = await Promise.all([
    loadMembersMap(reservation.memberId ? [reservation.memberId] : []),
    loadRoomsMap(reservation.roomId ? [reservation.roomId] : [])
  ]);
  return decorateReservationRecord(
    reservation,
    reservation.memberId ? memberMap[reservation.memberId] : null,
    reservation.roomId ? roomMap[reservation.roomId] : null
  );
}

async function fetchMemberDetail(memberId, adminId, options = {}) {
  const [memberDoc, levels] = await Promise.all([
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null),
    loadLevels()
  ]);
  if (!memberDoc || !memberDoc.data) {
    throw new Error('会员不存在');
  }
  const extras = await resolveMemberExtras(memberId);
  const renameHistory = await loadRenameTimeline(memberId, 50);
  const mergedMember = {
    ...memberDoc.data,
    avatarUnlocks: extras.avatarUnlocks || [],
    claimedLevelRewards: extras.claimedLevelRewards || [],
    renameHistory
  };
  const levelMap = buildLevelMap(levels);
  const includePveProfile = !!(options && options.includePveProfile);
  const pveProfile = includePveProfile ? await loadMemberPveProfile(memberId, adminId) : null;
  return {
    member: decorateMemberRecord(mergedMember, levelMap),
    levels: levels.map((level) => ({
      _id: level._id,
      name: level.displayName || level.name,
      order: level.order
    })),
    pveProfile: pveProfile || null
  };
}

async function loadLevels() {
  const snapshot = await db.collection(COLLECTIONS.LEVELS).orderBy('order', 'asc').get();
  return snapshot.data || [];
}

async function callPveFunction(action, data = {}) {
  try {
    const response = await cloud.callFunction({
      name: 'pve',
      data: { action, ...data }
    });
    return response && response.result ? response.result : null;
  } catch (error) {
    throw error;
  }
}

async function callPvpFunction(action, data = {}) {
  try {
    const response = await cloud.callFunction({
      name: 'pvp',
      data: { action, ...data }
    });
    return response && response.result ? response.result : null;
  } catch (error) {
    throw error;
  }
}

async function loadMemberPveProfile(memberId, adminId) {
  if (!memberId) {
    return null;
  }
  try {
    const payload = adminId ? { actorId: adminId, memberId } : { memberId };
    const result = await callPveFunction('adminInspectProfile', payload);
    return result && result.profile ? result.profile : null;
  } catch (error) {
    console.error('[admin] load member pve profile failed', memberId, error);
    return null;
  }
}

async function syncMemberLevel(memberId) {
  const [memberDoc, levels] = await Promise.all([
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null),
    loadLevels()
  ]);
  if (!memberDoc || !memberDoc.data) return;
  const member = memberDoc.data;
  if (!Array.isArray(levels) || !levels.length) return;

  const {
    levelId: resolvedLevelId,
    pendingBreakthroughLevelId,
    levelsToGrant
  } = analyzeMemberLevelProgress(member, levels);

  const updates = {};
  const normalizedPending = pendingBreakthroughLevelId || '';
  const existingPending =
    typeof member.pendingBreakthroughLevelId === 'string' ? member.pendingBreakthroughLevelId : '';

  if (resolvedLevelId && resolvedLevelId !== member.levelId) {
    updates.levelId = resolvedLevelId;
  }

  if (normalizedPending !== existingPending) {
    updates.pendingBreakthroughLevelId = normalizedPending;
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: updates
      })
      .catch(() => {});
  }

  for (const level of levelsToGrant) {
    await grantLevelRewards(memberId, level);
  }

  try {
    await callPveFunction('profile', { actorId: memberId });
  } catch (error) {
    console.error('[admin] sync member level failed to refresh attributes', memberId, error);
  }
}

async function grantLevelRewards(memberId, level) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;

  const masterSnapshot = await db
    .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
    .get()
    .catch(() => ({ data: [] }));

  const masterMap = {};
  (masterSnapshot.data || []).forEach((item) => {
    masterMap[item._id] = item;
  });

  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();

  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;

    const existing = await rightsCollection
      .where({ memberId, rightId: reward.rightId, levelId: level._id })
      .count()
      .catch(() => ({ total: 0 }));

    const quantity = reward.quantity || 1;
    if (existing.total >= quantity) continue;

    const validUntil = right.validDays
      ? new Date(now.getTime() + right.validDays * 24 * 60 * 60 * 1000)
      : null;

    for (let i = existing.total; i < quantity; i += 1) {
      await rightsCollection
        .add({
          data: {
            memberId,
            rightId: reward.rightId,
            levelId: level._id,
            status: 'active',
            issuedAt: now,
            validUntil,
            meta: {
              fromLevel: level._id,
              rewardName: reward.description || (right && right.name) || ''
            }
          }
        })
        .catch(() => null);
    }
  }
}

function buildLevelMap(levels) {
  const map = {};
  (levels || []).forEach((level) => {
    map[level._id] = level;
  });
  return map;
}

function decorateMemberRecord(member, levelMap) {
  const level = member.levelId ? levelMap[member.levelId] : null;
  const roles = Array.isArray(member.roles) && member.roles.length ? Array.from(new Set(member.roles)) : ['member'];
  const cashBalance = resolveCashBalance(member);
  const stoneBalance = resolveStoneBalance(member);
  const respecStats = resolvePveRespecStats(member);
  const skillDrawCredits = resolveSkillDrawCredits(member);
  const totalRecharge = normalizeAmountFen(member.totalRecharge);
  const lastConsumptionAt =
    member.lastConsumptionAt ||
    member.lastSpendAt ||
    member.lastOrderAt ||
    member.lastTransactionAt ||
    member.lastConsumptionDate ||
    member.lastConsumeAt ||
    member.lastConsumeDate ||
    member.lastSpendDate ||
    member.lastPaymentAt ||
    member.lastPaymentDate ||
    null;
  const lastConsumptionAtLabel = formatDate(lastConsumptionAt);
  return {
    _id: member._id,
    nickName: member.nickName || '',
    realName: typeof member.realName === 'string' ? member.realName : '',
    avatarUrl: member.avatarUrl || '',
    mobile: member.mobile || '',
    balance: cashBalance,
    cashBalance,
    cashBalanceYuan: formatFenToYuan(cashBalance),
    totalRecharge,
    totalRechargeYuan: formatFenToYuan(totalRecharge),
    stoneBalance,
    stoneBalanceLabel: formatStoneLabel(stoneBalance),
    experience: Number(member.experience || 0),
    levelId: member.levelId || '',
    levelName: level ? level.displayName || level.name : '',
    roles,
    gender: normalizeGenderValue(member.gender),
    renameCredits: normalizeRenameCredits(member.renameCredits),
    renameUsed: normalizeRenameUsed(member.renameUsed),
    renameCards: normalizeRenameCredits(member.renameCards),
    renameHistory: formatRenameHistory(member.renameHistory),
    createdAt: formatDate(member.createdAt),
    updatedAt: formatDate(member.updatedAt),
    lastConsumptionAt,
    lastConsumptionAtLabel,
    avatarConfig: member.avatarConfig || {},
    roomUsageCount: normalizeUsageCount(member.roomUsageCount),
    avatarUnlocks: normalizeAvatarUnlocksList(member.avatarUnlocks),
    pveRespecAvailable: respecStats.available,
    skillDrawCredits
  };
}

function decorateReservationRecord(reservation, member, room) {
  const status = reservation.status || 'pendingApproval';
  return {
    _id: reservation._id,
    memberId: reservation.memberId || '',
    memberName: member ? member.nickName || member.name || '' : '',
    memberRealName: member ? member.realName || '' : '',
    memberMobile: member ? member.mobile || '' : '',
    roomId: reservation.roomId || '',
    roomName: room ? room.name || '' : '',
    date: reservation.date || '',
    startTime: reservation.startTime || '',
    endTime: reservation.endTime || '',
    status,
    statusLabel: resolveReservationStatusLabel(status),
    approval: reservation.approval || null,
    price: Number(reservation.price || 0),
    usageCredits: normalizeUsageCount(reservation.usageCredits),
    createdAt: formatDate(reservation.createdAt),
    updatedAt: formatDate(reservation.updatedAt)
  };
}

function resolveReservationStatusLabel(status) {
  const map = {
    pendingApproval: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    cancelled: '已取消',
    reserved: '已预约',
    confirmed: '已确认',
    pendingPayment: '待支付'
  };
  return map[status] || '待处理';
}

async function loadRoomsMap(roomIds) {
  if (!Array.isArray(roomIds) || !roomIds.length) {
    return {};
  }
  const snapshot = await db
    .collection(COLLECTIONS.ROOMS)
    .where({
      _id: _.in(roomIds)
    })
    .get();
  const map = {};
  (snapshot.data || []).forEach((room) => {
    map[room._id] = room;
  });
  return map;
}

async function releaseReservationResources(transaction, reservation, options = {}) {
  const { refundUsage = false, unlockRight = true } = options;
  if (!reservation || !reservation._id) {
    return;
  }
  const updates = {};
  if (refundUsage && !reservation.usageRefunded) {
    const credits = normalizeUsageCount(reservation.usageCredits || 1);
    if (credits > 0) {
      await transaction
        .collection(COLLECTIONS.MEMBERS)
        .doc(reservation.memberId)
        .update({
          data: {
            roomUsageCount: _.inc(credits),
            updatedAt: new Date()
          }
        })
        .catch(() => {});
      updates.usageRefunded = true;
    }
  }
  if (unlockRight && reservation.rightId) {
    await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .doc(reservation.rightId)
      .update({
        data: {
          status: 'active',
          reservationId: _.remove(),
          updatedAt: new Date()
        }
      })
      .catch(() => {});
  }
  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservation._id).update({
      data: updates
    });
  }
}

function incrementMemberReservationBadge(transaction, memberId) {
  if (!memberId) {
    return Promise.resolve();
  }
  return transaction
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .update({
      data: {
        'reservationBadges.memberVersion': _.inc(1)
      }
    })
    .catch(() => {});
}

async function updateAdminReservationBadges({ incrementVersion = false } = {}) {
  try {
    const [pendingResult, adminSnapshot] = await Promise.all([
      db
        .collection(COLLECTIONS.RESERVATIONS)
        .where({ status: 'pendingApproval' })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.MEMBERS)
        .where({ roles: _.in(ADMIN_ROLES) })
        .get()
        .catch(() => ({ data: [] }))
    ]);

    const pendingCount = pendingResult && Number.isFinite(pendingResult.total) ? pendingResult.total : 0;
    const admins = Array.isArray(adminSnapshot.data) ? adminSnapshot.data : [];

    await Promise.all(
      admins.map((admin) =>
        db
          .collection(COLLECTIONS.MEMBERS)
          .doc(admin._id)
          .update({
            data: {
              'reservationBadges.pendingApprovalCount': pendingCount,
              ...(incrementVersion ? { 'reservationBadges.adminVersion': _.inc(1) } : {}),
              updatedAt: new Date()
            }
          })
          .catch(() => {})
      )
    );

    return pendingCount;
  } catch (error) {
    console.error('[admin] update admin reservation badges failed', error);
    return 0;
  }
}

async function previewCleanupResidualData(openid) {
  return cleanupResidualMemberData(openid, { previewOnly: true });
}

async function previewCleanupBattleRecords(openid) {
  return cleanupBattleRecords(openid, { previewOnly: true });
}

async function previewCleanupTestMembers(openid) {
  await ensureAdmin(openid);

  const members = await listTestMembers();
  if (!members.length) {
    return {
      memberCount: 0,
      totalRemoved: 0,
      summary: { preview: {}, errors: [] },
      previewOnly: true
    };
  }

  const memberIds = members
    .map((member) => normalizeMemberIdValue(member && member._id))
    .filter(Boolean);
  const previewSummary = await summarizeTestMemberAssociations(memberIds);
  const totalRemoved = Object.keys(previewSummary).reduce((acc, key) => {
    const value = Number(previewSummary[key]);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    memberCount: memberIds.length,
    totalRemoved,
    summary: { preview: previewSummary, errors: [] },
    previewOnly: true
  };
}

async function cleanupBattleRecords(openid, options = {}) {
  await ensureAdmin(openid);

  const previewOnly = Boolean(options && options.previewOnly);
  const summary = { removed: {}, errors: [], preview: {} };
  const processedCollections = new Set();

  const cleanupTargets = [
    { collection: COLLECTIONS.MEMBER_PVE_HISTORY, key: 'memberPveHistory' },
    { collection: COLLECTIONS.PVP_MATCHES, key: 'pvpMatches' },
    { collection: COLLECTIONS.PVP_INVITES, key: 'pvpInvites' },
    { collection: COLLECTIONS.PVP_PROFILES, key: 'pvpProfiles' },
    { collection: COLLECTIONS.PVP_LEADERBOARD, key: 'pvpLeaderboard' },
    { collection: COLLECTIONS.PVP_SEASONS, key: 'pvpSeasons' }
  ];

  cleanupTargets.forEach((target) => processedCollections.add(target.key));

  await runTasksWithConcurrency(
    cleanupTargets.map((target) => async () => {
      try {
        await cleanupCollectionDocuments(target.collection, summary, {
          previewOnly,
          counterKey: target.key
        });
      } catch (error) {
        pushCleanupError(summary, target.collection, error);
      }
    }),
    CLEANUP_TASK_CONCURRENCY
  );

  processedCollections.add('pveProfileHistory');
  await cleanupPveProfileHistory(summary, { previewOnly });

  const totalSource = previewOnly ? summary.preview : summary.removed;
  const totalRemoved = Object.keys(totalSource).reduce((acc, key) => {
    const value = Number(totalSource[key]);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    memberCount: 0,
    totalRemoved,
    processedCollections: Array.from(processedCollections),
    summary,
    previewOnly
  };
}

async function cleanupTestMembers(openid) {
  await ensureAdmin(openid);

  const members = await listTestMembers();
  if (!members.length) {
    return {
      memberCount: 0,
      totalRemoved: 0,
      summary: { removed: {}, errors: [] },
      previewOnly: false
    };
  }

  const memberIds = members
    .map((member) => normalizeMemberIdValue(member && member._id))
    .filter(Boolean);
  const summary = { removed: {}, errors: [] };

  const cleanupTasks = memberIds.map((memberId) => async () => {
    try {
      return await cleanupMemberData(memberId);
    } catch (error) {
      return { error, memberId };
    }
  });

  const results = await runTasksWithConcurrency(cleanupTasks, CLEANUP_TASK_CONCURRENCY);

  results.forEach((result) => {
    if (!result) {
      return;
    }
    if (result.error) {
      pushCleanupError(summary, COLLECTIONS.MEMBERS, result.error, result.memberId);
      return;
    }
    mergeCleanupSummary(summary, result);
  });

  const totalRemoved = Object.keys(summary.removed || {}).reduce((acc, key) => {
    const value = Number(summary.removed[key]);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    memberCount: memberIds.length,
    totalRemoved,
    summary,
    previewOnly: false
  };
}

async function cleanupResidualMemberData(openid, options = {}) {
  await ensureAdmin(openid);

  const previewOnly = Boolean(options && options.previewOnly);

  const memberCount = await getTotalMemberCount();

  const summary = { removed: {}, errors: [], preview: {} };
  const cleanupJobs = [
    {
      key: COLLECTIONS.MEMBER_TIMELINE,
      collection: COLLECTIONS.MEMBER_TIMELINE,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.MEMBER_TIMELINE, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.MEMBER_EXTRAS,
      collection: COLLECTIONS.MEMBER_EXTRAS,
      runner: () => removeOrphanedDocumentsById(COLLECTIONS.MEMBER_EXTRAS, summary, { previewOnly })
    },
    {
      key: COLLECTIONS.MEMBER_PVE_HISTORY,
      collection: COLLECTIONS.MEMBER_PVE_HISTORY,
      runner: () => removeOrphanedDocumentsById(COLLECTIONS.MEMBER_PVE_HISTORY, summary, { previewOnly })
    },
    {
      key: COLLECTIONS.RESERVATIONS,
      collection: COLLECTIONS.RESERVATIONS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.RESERVATIONS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.MEMBER_RIGHTS,
      collection: COLLECTIONS.MEMBER_RIGHTS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.MEMBER_RIGHTS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.WALLET_TRANSACTIONS,
      collection: COLLECTIONS.WALLET_TRANSACTIONS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.WALLET_TRANSACTIONS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.STONE_TRANSACTIONS,
      collection: COLLECTIONS.STONE_TRANSACTIONS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.STONE_TRANSACTIONS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.TASK_RECORDS,
      collection: COLLECTIONS.TASK_RECORDS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.TASK_RECORDS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.COUPON_RECORDS,
      collection: COLLECTIONS.COUPON_RECORDS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.COUPON_RECORDS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.CHARGE_ORDERS,
      collection: COLLECTIONS.CHARGE_ORDERS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.CHARGE_ORDERS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.MENU_ORDERS,
      collection: COLLECTIONS.MENU_ORDERS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.MENU_ORDERS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.ERROR_LOGS,
      collection: COLLECTIONS.ERROR_LOGS,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.ERROR_LOGS, ['memberId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.PVP_INVITES,
      collection: COLLECTIONS.PVP_INVITES,
      runner: () => cleanupCollectionOrphans(COLLECTIONS.PVP_INVITES, ['inviterId', 'opponentId'], summary, { previewOnly })
    },
    {
      key: COLLECTIONS.PVP_MATCHES,
      collection: COLLECTIONS.PVP_MATCHES,
      runner: () =>
        cleanupCollectionOrphans(
          COLLECTIONS.PVP_MATCHES,
          ['player.memberId', 'opponent.memberId'],
          summary,
          { previewOnly }
        )
    },
    {
      key: COLLECTIONS.PVP_PROFILES,
      collection: COLLECTIONS.PVP_PROFILES,
      runner: () => removeOrphanedDocumentsById(COLLECTIONS.PVP_PROFILES, summary, { previewOnly })
    },
    {
      key: COLLECTIONS.PVP_LEADERBOARD,
      collection: COLLECTIONS.PVP_LEADERBOARD,
      runner: () => cleanupPvpLeaderboardOrphans(summary, { previewOnly })
    }
  ];

  await runTasksWithConcurrency(
    cleanupJobs.map((job) => async () => {
      try {
        await job.runner();
      } catch (error) {
        pushCleanupError(summary, job.collection || job.key, error);
      }
    }),
    CLEANUP_TASK_CONCURRENCY
  );

  const processedCollections = cleanupJobs.map((job) => job.key);

  const totalSource = previewOnly ? summary.preview : summary.removed;
  const reservationsRemoved = Number(totalSource[COLLECTIONS.RESERVATIONS]) || 0;

  if (!previewOnly && reservationsRemoved > 0) {
    await updateAdminReservationBadges({ incrementVersion: true });
  }

  const totalRemoved = Object.keys(totalSource).reduce((acc, key) => {
    const value = Number(totalSource[key]);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    memberCount,
    totalRemoved,
    processedCollections: Array.from(new Set(processedCollections)),
    summary,
    previewOnly
  };
}

async function listTestMembers() {
  const collection = db.collection(COLLECTIONS.MEMBERS);
  const pageSize = 100;
  let skip = 0;
  const members = [];

  while (true) {
    let snapshot;
    try {
      snapshot = await collection
        .where({ roles: _.all(['test']) })
        .orderBy('_id', 'asc')
        .skip(skip)
        .limit(pageSize)
        .field({ _id: true, roles: true })
        .get();
    } catch (error) {
      if (isNotFoundError(error)) {
        break;
      }
      console.error('[admin] list test members failed', error);
      break;
    }

    const docs = (snapshot && Array.isArray(snapshot.data)) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    docs.forEach((doc) => {
      const id = normalizeMemberIdValue(doc && doc._id);
      const roles = Array.isArray(doc && doc.roles) ? doc.roles.filter(Boolean) : [];
      if (id && roles.includes('test') && !roles.some((role) => ADMIN_ROLES.includes(role))) {
        members.push({ _id: id, roles });
      }
    });

    if (docs.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return members;
}

async function summarizeTestMemberAssociations(memberIds) {
  const preview = {};
  const ids = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];
  if (!ids.length) {
    return preview;
  }

  preview[COLLECTIONS.MEMBERS] = ids.length;

  const timelineIds = await collectDocumentIdsForMembers(COLLECTIONS.MEMBER_TIMELINE, ids, {
    fieldPaths: ['memberId']
  });
  if (timelineIds.size) {
    preview[COLLECTIONS.MEMBER_TIMELINE] = timelineIds.size;
  }

  const extrasIds = await collectDocumentIdsForMembers(COLLECTIONS.MEMBER_EXTRAS, ids, {
    useDocId: true
  });
  if (extrasIds.size) {
    preview[COLLECTIONS.MEMBER_EXTRAS] = extrasIds.size;
  }

  const pveHistoryIds = await collectDocumentIdsForMembers(COLLECTIONS.MEMBER_PVE_HISTORY, ids, {
    useDocId: true
  });
  if (pveHistoryIds.size) {
    preview[COLLECTIONS.MEMBER_PVE_HISTORY] = pveHistoryIds.size;
  }

  const reservationsIds = await collectDocumentIdsForMembers(COLLECTIONS.RESERVATIONS, ids, {
    fieldPaths: ['memberId']
  });
  if (reservationsIds.size) {
    preview[COLLECTIONS.RESERVATIONS] = reservationsIds.size;
  }

  const rightsIds = await collectDocumentIdsForMembers(COLLECTIONS.MEMBER_RIGHTS, ids, {
    fieldPaths: ['memberId']
  });
  if (rightsIds.size) {
    preview[COLLECTIONS.MEMBER_RIGHTS] = rightsIds.size;
  }

  const walletIds = await collectDocumentIdsForMembers(COLLECTIONS.WALLET_TRANSACTIONS, ids, {
    fieldPaths: ['memberId']
  });
  if (walletIds.size) {
    preview[COLLECTIONS.WALLET_TRANSACTIONS] = walletIds.size;
  }

  const stoneIds = await collectDocumentIdsForMembers(COLLECTIONS.STONE_TRANSACTIONS, ids, {
    fieldPaths: ['memberId']
  });
  if (stoneIds.size) {
    preview[COLLECTIONS.STONE_TRANSACTIONS] = stoneIds.size;
  }

  const taskIds = await collectDocumentIdsForMembers(COLLECTIONS.TASK_RECORDS, ids, {
    fieldPaths: ['memberId']
  });
  if (taskIds.size) {
    preview[COLLECTIONS.TASK_RECORDS] = taskIds.size;
  }

  const couponIds = await collectDocumentIdsForMembers(COLLECTIONS.COUPON_RECORDS, ids, {
    fieldPaths: ['memberId']
  });
  if (couponIds.size) {
    preview[COLLECTIONS.COUPON_RECORDS] = couponIds.size;
  }

  const chargeIds = await collectDocumentIdsForMembers(COLLECTIONS.CHARGE_ORDERS, ids, {
    fieldPaths: ['memberId']
  });
  if (chargeIds.size) {
    preview[COLLECTIONS.CHARGE_ORDERS] = chargeIds.size;
  }

  const menuOrderIds = await collectDocumentIdsForMembers(COLLECTIONS.MENU_ORDERS, ids, {
    fieldPaths: ['memberId']
  });
  if (menuOrderIds.size) {
    preview[COLLECTIONS.MENU_ORDERS] = menuOrderIds.size;
  }

  const errorLogIds = await collectDocumentIdsForMembers(COLLECTIONS.ERROR_LOGS, ids, {
    fieldPaths: ['memberId']
  });
  if (errorLogIds.size) {
    preview[COLLECTIONS.ERROR_LOGS] = errorLogIds.size;
  }

  const pvpInviteIds = await collectDocumentIdsForMembers(COLLECTIONS.PVP_INVITES, ids, {
    fieldPaths: ['inviterId', 'opponentId']
  });
  if (pvpInviteIds.size) {
    preview[COLLECTIONS.PVP_INVITES] = pvpInviteIds.size;
  }

  const pvpMatchIds = await collectDocumentIdsForMembers(COLLECTIONS.PVP_MATCHES, ids, {
    fieldPaths: ['player.memberId', 'opponent.memberId']
  });
  if (pvpMatchIds.size) {
    preview[COLLECTIONS.PVP_MATCHES] = pvpMatchIds.size;
  }

  const pvpProfileIds = await collectDocumentIdsForMembers(COLLECTIONS.PVP_PROFILES, ids, {
    useDocId: true
  });
  if (pvpProfileIds.size) {
    preview[COLLECTIONS.PVP_PROFILES] = pvpProfileIds.size;
  }

  const leaderboardSummary = await summarizePvpLeaderboardForMembers(ids);
  if (leaderboardSummary.docCount > 0) {
    preview[COLLECTIONS.PVP_LEADERBOARD] = leaderboardSummary.docCount;
  }
  if (leaderboardSummary.entryCount > 0) {
    preview.pvpLeaderboardEntries = leaderboardSummary.entryCount;
  }

  return preview;
}

async function collectDocumentIdsForMembers(collectionName, memberIds, options = {}) {
  const ids = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];
  if (!ids.length) {
    return new Set();
  }

  const useDocId = Boolean(options && options.useDocId);
  if (useDocId) {
    const collected = new Set();
    for (const memberId of ids) {
      try {
        const snapshot = await db.collection(collectionName).doc(memberId).field({ _id: true }).get();
        if (snapshot && snapshot.data && snapshot.data._id) {
          collected.add(memberId);
        }
      } catch (error) {
        if (!isNotFoundError(error)) {
          console.error(`[admin] lookup ${collectionName} for member failed`, memberId, error);
        }
      }
    }
    return collected;
  }

  const fieldPaths = Array.isArray(options && options.fieldPaths)
    ? options.fieldPaths.map((field) => (typeof field === 'string' ? field.trim() : '')).filter(Boolean)
    : [];
  if (!fieldPaths.length) {
    return new Set();
  }

  const collected = new Set();
  const batchSize = 10;
  const fetchLimit = 100;

  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const conditions = fieldPaths.map((field) => ({ [field]: _.in(batch) }));
    const whereCondition = conditions.length === 1 ? conditions[0] : _.or(conditions);
    let skip = 0;

    while (true) {
      let snapshot;
      try {
        snapshot = await db
          .collection(collectionName)
          .where(whereCondition)
          .orderBy('_id', 'asc')
          .skip(skip)
          .limit(fetchLimit)
          .field({ _id: true })
          .get();
      } catch (error) {
        if (!isNotFoundError(error)) {
          console.error(`[admin] query ${collectionName} for members failed`, error);
        }
        break;
      }

      const docs = (snapshot && Array.isArray(snapshot.data)) ? snapshot.data : [];
      if (!docs.length) {
        break;
      }

      docs.forEach((doc) => {
        const docId = normalizeMemberIdValue(doc && doc._id);
        if (docId) {
          collected.add(docId);
        }
      });

      if (docs.length < fetchLimit) {
        break;
      }
      skip += fetchLimit;
    }
  }

  return collected;
}

async function summarizePvpLeaderboardForMembers(memberIds) {
  const ids = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];
  if (!ids.length) {
    return { docCount: 0, entryCount: 0 };
  }

  const memberSet = new Set(ids.map((id) => normalizeMemberIdValue(id)).filter(Boolean));
  let snapshot;
  try {
    snapshot = await db.collection(COLLECTIONS.PVP_LEADERBOARD).get();
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error('[admin] load pvp leaderboard failed', error);
    }
    return { docCount: 0, entryCount: 0 };
  }

  const docs = (snapshot && Array.isArray(snapshot.data)) ? snapshot.data : [];
  let docCount = 0;
  let entryCount = 0;

  docs.forEach((doc) => {
    const entries = Array.isArray(doc && doc.entries) ? doc.entries : [];
    let affected = false;
    entries.forEach((entry) => {
      const candidate = normalizeMemberIdValue(
        entry && (entry.memberId || entry._id || entry.id || entry.memberID)
      );
      if (candidate && memberSet.has(candidate)) {
        affected = true;
        entryCount += 1;
      }
    });
    if (affected) {
      docCount += 1;
    }
  });

  return { docCount, entryCount };
}

async function cleanupMemberData(memberId) {
  const summary = { removed: {}, errors: [] };

  const removalResults = await Promise.all([
    removeCollectionByMemberId(COLLECTIONS.MEMBER_TIMELINE, memberId, summary),
    removeMemberExtrasDocument(memberId, summary),
    removeMemberPveHistoryDocument(memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.RESERVATIONS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.MEMBER_RIGHTS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.WALLET_TRANSACTIONS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.STONE_TRANSACTIONS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.TASK_RECORDS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.COUPON_RECORDS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.CHARGE_ORDERS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.MENU_ORDERS, memberId, summary),
    removeCollectionByMemberId(COLLECTIONS.ERROR_LOGS, memberId, summary),
    removeCollectionByMemberIdFields(
      COLLECTIONS.PVP_INVITES,
      ['inviterId', 'opponentId'],
      memberId,
      summary
    ),
    removeCollectionByMemberIdFields(
      COLLECTIONS.PVP_MATCHES,
      ['player.memberId', 'opponent.memberId'],
      memberId,
      summary
    ),
    removeDocumentById(COLLECTIONS.PVP_PROFILES, memberId, summary),
    removeMemberFromPvpLeaderboard(memberId, summary),
    removeDocumentById(COLLECTIONS.MEMBERS, memberId, summary)
  ]);

  const reservationsRemoved = Number(removalResults[3]) || 0;
  if (reservationsRemoved > 0) {
    await updateAdminReservationBadges({ incrementVersion: true });
  }

  return summary;
}

function appendRemovalCount(summary, key, amount) {
  const numericAmount = Number(amount);
  if (!summary || !key || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return;
  }
  if (!summary.removed || typeof summary.removed !== 'object') {
    summary.removed = {};
  }
  summary.removed[key] = (summary.removed[key] || 0) + numericAmount;
}

async function removeMemberExtrasDocument(memberId, summary) {
  const targetId = normalizeMemberIdValue(memberId);
  if (!targetId) {
    return 0;
  }

  const collection = db.collection(COLLECTIONS.MEMBER_EXTRAS);
  let extras = null;
  try {
    const snapshot = await collection.doc(targetId).get();
    extras = snapshot && snapshot.data ? snapshot.data : null;
  } catch (error) {
    if (!isNotFoundError(error)) {
      pushCleanupError(summary, COLLECTIONS.MEMBER_EXTRAS, error, targetId);
    }
  }

  try {
    await collection.doc(targetId).remove();
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }
    pushCleanupError(summary, COLLECTIONS.MEMBER_EXTRAS, error, targetId);
    return 0;
  }

  appendRemovalCount(summary, COLLECTIONS.MEMBER_EXTRAS, 1);

  if (extras && typeof extras === 'object') {
    const avatarUnlocks = Array.isArray(extras.avatarUnlocks)
      ? extras.avatarUnlocks.filter((id) => typeof id === 'string' && id.trim()).length
      : 0;
    const titleUnlocks = Array.isArray(extras.titleUnlocks)
      ? extras.titleUnlocks.filter((id) => typeof id === 'string' && id.trim()).length
      : 0;
    const backgroundUnlocks = Array.isArray(extras.backgroundUnlocks)
      ? extras.backgroundUnlocks.filter((id) => typeof id === 'string' && id.trim()).length
      : 0;
    const claimedRewards = Array.isArray(extras.claimedLevelRewards)
      ? extras.claimedLevelRewards.filter((id) => typeof id === 'string' && id.trim()).length
      : 0;
    const deliveredRewards = Array.isArray(extras.deliveredLevelRewards)
      ? extras.deliveredLevelRewards.filter((id) => typeof id === 'string' && id.trim()).length
      : 0;
    const wineEntries = normalizeWineStorageEntries(extras.wineStorage);
    const wineBottles = wineEntries.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

    appendRemovalCount(summary, 'memberExtrasAvatarUnlocks', avatarUnlocks);
    appendRemovalCount(summary, 'memberExtrasTitleUnlocks', titleUnlocks);
    appendRemovalCount(summary, 'memberExtrasBackgroundUnlocks', backgroundUnlocks);
    appendRemovalCount(summary, 'memberExtrasClaimedLevelRewards', claimedRewards);
    appendRemovalCount(summary, 'memberExtrasDeliveredLevelRewards', deliveredRewards);
    appendRemovalCount(summary, 'memberExtrasWineEntries', wineEntries.length);
    appendRemovalCount(summary, 'memberExtrasWineBottleCount', wineBottles);
  }

  return 1;
}

async function removeMemberPveHistoryDocument(memberId, summary) {
  const targetId = normalizeMemberIdValue(memberId);
  if (!targetId) {
    return 0;
  }

  const collection = db.collection(COLLECTIONS.MEMBER_PVE_HISTORY);
  let history = null;
  try {
    const snapshot = await collection.doc(targetId).get();
    history = snapshot && snapshot.data ? snapshot.data : null;
  } catch (error) {
    if (!isNotFoundError(error)) {
      pushCleanupError(summary, COLLECTIONS.MEMBER_PVE_HISTORY, error, targetId);
    }
  }

  try {
    await collection.doc(targetId).remove();
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }
    pushCleanupError(summary, COLLECTIONS.MEMBER_PVE_HISTORY, error, targetId);
    return 0;
  }

  appendRemovalCount(summary, COLLECTIONS.MEMBER_PVE_HISTORY, 1);

  if (history && typeof history === 'object') {
    const battleCount = Array.isArray(history.battleHistory) ? history.battleHistory.length : 0;
    const skillCount = Array.isArray(history.skillHistory) ? history.skillHistory.length : 0;
    appendRemovalCount(summary, 'memberPveBattleHistoryEntries', battleCount);
    appendRemovalCount(summary, 'memberPveSkillHistoryEntries', skillCount);
  }

  return 1;
}

async function getTotalMemberCount() {
  try {
    const snapshot = await db.collection(COLLECTIONS.MEMBERS).count();
    const total = snapshot && Number.isFinite(snapshot.total) ? Math.floor(snapshot.total) : 0;
    return Math.max(0, total);
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error('[admin] failed to count members', error);
    }
  }
  return 0;
}

async function listAllMemberIds() {
  const collection = db.collection(COLLECTIONS.MEMBERS);
  const limit = 100;
  const memberIds = new Set();
  let hasMore = true;
  let lastId = '';

  while (hasMore) {
    let query = collection;
    if (lastId) {
      query = query.where({ _id: _.gt(lastId) });
    }
    const snapshot = await query
      .orderBy('_id', 'asc')
      .limit(limit)
      .field({ _id: true })
      .get()
      .catch((error) => {
        if (isNotFoundError(error)) {
          return { data: [] };
        }
        throw error;
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    lastId = docs[docs.length - 1]._id || lastId;
    docs.forEach((doc) => {
      const id = normalizeMemberIdValue(doc && doc._id);
      if (id) {
        memberIds.add(id);
      }
    });
    if (docs.length < limit) {
      hasMore = false;
    }
  }

  return memberIds;
}

async function listMemberIdsBatch(cursor = '', limit = 20) {
  const normalizedCursor = normalizeMemberIdValue(cursor);
  const batchLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  let query = db.collection(COLLECTIONS.MEMBERS);
  if (normalizedCursor) {
    query = query.where({ _id: _.gt(normalizedCursor) });
  }
  const snapshot = await query
    .orderBy('_id', 'asc')
    .limit(batchLimit)
    .field({ _id: true })
    .get()
    .catch((error) => {
      if (isNotFoundError(error)) {
        return { data: [] };
      }
      throw error;
    });
  const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
  const memberIds = [];
  docs.forEach((doc) => {
    const id = normalizeMemberIdValue(doc && doc._id);
    if (id) {
      memberIds.push(id);
    }
  });
  const nextCursor = docs.length === batchLimit && memberIds.length ? memberIds[memberIds.length - 1] : '';
  return { ids: memberIds, nextCursor };
}

async function cleanupCollectionOrphans(collectionName, memberIdPaths, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const normalizedPaths = normalizeMemberIdPaths(memberIdPaths);
  if (!normalizedPaths.length) {
    return 0;
  }

  const batchSize = Number.isFinite(options && options.batchSize) && options.batchSize > 0
    ? Math.min(500, Math.floor(options.batchSize))
    : ORPHAN_QUERY_BATCH_LIMIT;

  if (previewOnly) {
    const total = await countCollectionOrphans(collectionName, normalizedPaths, batchSize);
    if (total !== null) {
      if (total > 0) {
        summary.preview = summary.preview || {};
        summary.preview[collectionName] = (summary.preview[collectionName] || 0) + total;
      }
      return total;
    }
  } else {
    let removed = 0;
    while (true) {
      const orphanIds = await findCollectionOrphanIds(collectionName, normalizedPaths, { limit: batchSize });
      if (orphanIds === null) {
        break;
      }
      if (!orphanIds.length) {
        return removed;
      }

      const tasks = orphanIds.map((docId) =>
        db
          .collection(collectionName)
          .doc(docId)
          .remove()
          .then(() => {
            removed += 1;
            appendRemovalCount(summary, collectionName, 1);
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, collectionName, error, docId);
            }
          })
      );

      if (tasks.length) {
        await Promise.all(tasks);
      }

      if (orphanIds.length < batchSize) {
        return removed;
      }
    }
  }

  return legacyCleanupCollectionOrphans(collectionName, normalizedPaths, summary, { previewOnly });
}

async function countCollectionOrphans(collectionName, memberIdPaths, batchSize = ORPHAN_QUERY_BATCH_LIMIT) {
  let total = 0;
  let cursor = '';

  while (true) {
    const orphanIds = await findCollectionOrphanIds(collectionName, memberIdPaths, { limit: batchSize, afterId: cursor });
    if (orphanIds === null) {
      return null;
    }
    if (!orphanIds.length) {
      break;
    }
    total += orphanIds.length;
    cursor = orphanIds[orphanIds.length - 1];
    if (orphanIds.length < batchSize) {
      break;
    }
  }

  return total;
}

async function findCollectionOrphanIds(collectionName, memberIdPaths, options = {}) {
  const limit = Number.isFinite(options && options.limit) && options.limit > 0 ? Math.min(500, Math.floor(options.limit)) : ORPHAN_QUERY_BATCH_LIMIT;
  const afterId = options && typeof options.afterId === 'string' ? options.afterId : '';
  const candidateIds = new Set();

  for (const path of memberIdPaths) {
    try {
      const matchStage = {};
      if (afterId) {
        matchStage._id = _.gt(afterId);
      }
      matchStage[path] = _.exists(true);

      const snapshot = await db
        .collection(collectionName)
        .aggregate()
        .match(matchStage)
        .lookup({
          from: COLLECTIONS.MEMBERS,
          localField: path,
          foreignField: '_id',
          as: '__memberLookup'
        })
        .unwind({
          path: '$__memberLookup',
          preserveNullAndEmptyArrays: true
        })
        .match({ '__memberLookup._id': _.exists(false) })
        .sort({ _id: 1 })
        .project({ _id: true })
        .limit(limit)
        .end();

      const docs = (snapshot && Array.isArray(snapshot.list)) ? snapshot.list : [];
      docs.forEach((doc) => {
        const id = normalizeMemberIdValue(doc && doc._id);
        if (id) {
          candidateIds.add(id);
        }
      });
    } catch (error) {
      console.error('[admin] aggregate orphan lookup failed', collectionName, path, error);
      return null;
    }
  }

  const sorted = Array.from(candidateIds).sort();
  if (afterId) {
    return sorted.filter((id) => id > afterId).slice(0, limit);
  }
  if (limit && sorted.length > limit) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

function normalizeMemberIdPaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths
    .map((path) => (typeof path === 'string' ? path.trim() : ''))
    .filter((path) => Boolean(path));
}

async function legacyCleanupCollectionOrphans(collectionName, memberIdPaths, summary, options = {}) {
  let memberIds;
  try {
    memberIds = await listAllMemberIds();
  } catch (error) {
    console.error('[admin] legacy cleanup failed to load member ids', error);
    return 0;
  }
  return legacyCleanupCollectionOrphansWithMembers(collectionName, memberIdPaths, memberIds, summary, options);
}

async function legacyCleanupCollectionOrphansWithMembers(collectionName, memberIdPaths, memberIds, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  if (!memberIdPaths.length) {
    return 0;
  }
  const collection = db.collection(collectionName);
  const limit = 100;
  let removed = 0;
  let hasMore = true;
  let lastId = '';

  while (hasMore) {
    let query = collection;
    if (lastId) {
      query = query.where({ _id: _.gt(lastId) });
    }
    const snapshot = await query
      .orderBy('_id', 'asc')
      .limit(limit)
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, collectionName, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    lastId = docs[docs.length - 1]._id || lastId;

    const orphanDocs = docs.filter((doc) => {
      if (!doc || !doc._id) {
        return false;
      }
      return memberIdPaths.some((path) => {
        const candidates = extractMemberIdsByPath(doc, path);
        if (!candidates.length) {
          return false;
        }
        return candidates.some((candidate) => !memberIds.has(candidate));
      });
    });

    if (!orphanDocs.length) {
      continue;
    }

    if (previewOnly) {
      summary.preview = summary.preview || {};
      summary.preview[collectionName] = (summary.preview[collectionName] || 0) + orphanDocs.length;
      removed += orphanDocs.length;
      continue;
    }

    const tasks = orphanDocs.map((doc) =>
      collection
        .doc(doc._id)
        .remove()
        .then(() => {
          removed += 1;
          appendRemovalCount(summary, collectionName, 1);
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            pushCleanupError(summary, collectionName, error, doc._id);
          }
        })
    );

    if (tasks.length) {
      await Promise.all(tasks);
    }

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  return removed;
}

async function cleanupCollectionDocuments(collectionName, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const counterKey = options && options.counterKey ? options.counterKey : collectionName;
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 100;
  const collection = db.collection(collectionName);

  if (previewOnly) {
    try {
      const snapshot = await collection.count();
      const total = snapshot && Number.isFinite(snapshot.total) ? Math.max(0, Math.floor(snapshot.total)) : 0;
      if (total > 0) {
        if (!summary.preview || typeof summary.preview !== 'object') {
          summary.preview = {};
        }
        summary.preview[counterKey] = (summary.preview[counterKey] || 0) + total;
      }
      return total;
    } catch (error) {
      if (isNotFoundError(error)) {
        return 0;
      }
      pushCleanupError(summary, collectionName, error);
      return 0;
    }
  }

  let removed = 0;
  let hasMore = true;
  let lastId = '';

  while (hasMore) {
    let query = collection;
    if (lastId) {
      query = query.where({ _id: _.gt(lastId) });
    }
    const snapshot = await query
      .orderBy('_id', 'asc')
      .limit(limit)
      .field({ _id: true })
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, collectionName, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    lastId = docs[docs.length - 1]._id || lastId;

    const tasks = docs.map((doc) => {
      if (collectionName === COLLECTIONS.MEMBER_EXTRAS) {
        return removeMemberExtrasDocument(doc._id, summary).then((count) => {
          removed += count;
        });
      }
      if (collectionName === COLLECTIONS.MEMBER_PVE_HISTORY) {
        return removeMemberPveHistoryDocument(doc._id, summary).then((count) => {
          removed += count;
        });
      }
      return collection
        .doc(doc._id)
        .remove()
        .then(() => {
          removed += 1;
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            pushCleanupError(summary, collectionName, error, doc._id);
          }
        });
    });

    if (tasks.length) {
      await Promise.all(tasks);
    }

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  appendRemovalCount(summary, counterKey, removed);

  return removed;
}

async function removeOrphanedDocumentsById(collectionName, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const batchSize = Number.isFinite(options && options.batchSize) && options.batchSize > 0
    ? Math.min(500, Math.floor(options.batchSize))
    : ORPHAN_QUERY_BATCH_LIMIT;

  if (previewOnly) {
    const total = await countCollectionOrphans(collectionName, ['_id'], batchSize);
    if (total !== null) {
      if (total > 0) {
        summary.preview = summary.preview || {};
        summary.preview[collectionName] = (summary.preview[collectionName] || 0) + total;
      }
      return total;
    }
  } else {
    let removed = 0;
    while (true) {
      const orphanIds = await findCollectionOrphanIds(collectionName, ['_id'], { limit: batchSize });
      if (orphanIds === null) {
        break;
      }
      if (!orphanIds.length) {
        return removed;
      }

      const tasks = orphanIds.map(async (docId) => {
        if (collectionName === COLLECTIONS.MEMBER_EXTRAS) {
          removed += await removeMemberExtrasDocument(docId, summary);
          return;
        }
        if (collectionName === COLLECTIONS.MEMBER_PVE_HISTORY) {
          removed += await removeMemberPveHistoryDocument(docId, summary);
          return;
        }
        await db
          .collection(collectionName)
          .doc(docId)
          .remove()
          .then(() => {
            removed += 1;
            appendRemovalCount(summary, collectionName, 1);
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, collectionName, error, docId);
            }
          });
      });

      if (tasks.length) {
        await Promise.all(tasks);
      }

      if (orphanIds.length < batchSize) {
        return removed;
      }
    }
  }

  return legacyRemoveOrphanedDocumentsById(collectionName, summary, { previewOnly });
}

async function legacyRemoveOrphanedDocumentsById(collectionName, summary, options = {}) {
  let memberIds;
  try {
    memberIds = await listAllMemberIds();
  } catch (error) {
    console.error('[admin] legacy orphan removal failed to load member ids', error);
    return 0;
  }
  return legacyRemoveOrphanedDocumentsByIdWithMembers(collectionName, memberIds, summary, options);
}

async function legacyRemoveOrphanedDocumentsByIdWithMembers(collectionName, memberIds, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const collection = db.collection(collectionName);
  const limit = 100;
  let removed = 0;
  let hasMore = true;
  let lastId = '';

  while (hasMore) {
    let query = collection;
    if (lastId) {
      query = query.where({ _id: _.gt(lastId) });
    }
    const snapshot = await query
      .orderBy('_id', 'asc')
      .limit(limit)
      .field({ _id: true })
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, collectionName, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    lastId = docs[docs.length - 1]._id || lastId;

    const orphanDocs = docs.filter((doc) => {
      const docId = normalizeMemberIdValue(doc && doc._id);
      return docId && !memberIds.has(docId);
    });

    if (!orphanDocs.length) {
      continue;
    }

    if (previewOnly) {
      summary.preview = summary.preview || {};
      summary.preview[collectionName] = (summary.preview[collectionName] || 0) + orphanDocs.length;
      removed += orphanDocs.length;
      continue;
    }

    const tasks = orphanDocs.map((doc) =>
      collection
        .doc(doc._id)
        .remove()
        .then(() => {
          removed += 1;
          appendRemovalCount(summary, collectionName, 1);
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            pushCleanupError(summary, collectionName, error, doc._id);
          }
        })
    );

    if (tasks.length) {
      await Promise.all(tasks);
    }

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  return removed;
}

async function cleanupPvpLeaderboardOrphans(summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const collection = db.collection(COLLECTIONS.PVP_LEADERBOARD);
  const batchSize = Number.isFinite(options && options.batchSize) && options.batchSize > 0
    ? Math.min(500, Math.floor(options.batchSize))
    : ORPHAN_QUERY_BATCH_LIMIT;

  if (previewOnly) {
    try {
      const snapshot = await collection
        .aggregate()
        .unwind({ path: '$entries', preserveNullAndEmptyArrays: false })
        .lookup({
          from: COLLECTIONS.MEMBERS,
          localField: 'entries.memberId',
          foreignField: '_id',
          as: '__memberLookup'
        })
        .unwind({ path: '$__memberLookup', preserveNullAndEmptyArrays: true })
        .match({ '__memberLookup._id': _.exists(false) })
        .count('total')
        .end();
      const total = snapshot && Array.isArray(snapshot.list) && snapshot.list.length
        ? Math.max(0, Number(snapshot.list[0].total) || 0)
        : 0;
      if (total > 0) {
        summary.preview = summary.preview || {};
        summary.preview.pvpLeaderboardEntries = (summary.preview.pvpLeaderboardEntries || 0) + total;
      }
      return total;
    } catch (error) {
      console.error('[admin] preview pvp leaderboard cleanup failed', error);
      return legacyCleanupPvpLeaderboardOrphans(summary, { previewOnly });
    }
  }

  let cleanedEntries = 0;

  while (true) {
    let snapshot;
    try {
      snapshot = await collection
        .aggregate()
        .unwind({ path: '$entries', preserveNullAndEmptyArrays: false })
        .lookup({
          from: COLLECTIONS.MEMBERS,
          localField: 'entries.memberId',
          foreignField: '_id',
          as: '__memberLookup'
        })
        .unwind({ path: '$__memberLookup', preserveNullAndEmptyArrays: true })
        .match({ '__memberLookup._id': _.exists(false) })
        .sort({ _id: 1 })
        .project({
          _id: true,
          memberId: '$entries.memberId'
        })
        .limit(batchSize)
        .end();
    } catch (error) {
      console.error('[admin] aggregate pvp leaderboard cleanup failed', error);
      return legacyCleanupPvpLeaderboardOrphans(summary, options);
    }

    const entries = snapshot && Array.isArray(snapshot.list) ? snapshot.list : [];
    if (!entries.length) {
      break;
    }

    const removalsByDoc = new Map();
    entries.forEach((entry) => {
      const docId = entry && entry._id ? String(entry._id) : '';
      if (!docId) {
        return;
      }
      const memberId = normalizeMemberIdValue(entry.memberId);
      if (!removalsByDoc.has(docId)) {
        removalsByDoc.set(docId, new Set());
      }
      if (memberId) {
        removalsByDoc.get(docId).add(memberId);
      }
    });

    const tasks = Array.from(removalsByDoc.entries()).map(([docId, memberIdSet]) => {
      const idsToRemove = Array.from(memberIdSet);
      const idLookup = new Set(idsToRemove.map((id) => normalizeMemberIdValue(id)));

      return collection
        .doc(docId)
        .get()
        .then((snapshot) => (snapshot && snapshot.data ? snapshot.data : null))
        .then((doc) => {
          if (!doc || !Array.isArray(doc.entries) || !doc.entries.length) {
            return 0;
          }
          const filtered = doc.entries.filter((entry) => {
            const candidate = normalizeMemberIdValue(entry && entry.memberId);
            return candidate && !idLookup.has(candidate);
          });
          const removedCount = doc.entries.length - filtered.length;
          if (removedCount <= 0) {
            return 0;
          }
          return collection
            .doc(docId)
            .update({
              data: {
                entries: filtered,
                updatedAt: new Date()
              }
            })
            .then(() => removedCount)
            .catch((error) => {
              if (!isNotFoundError(error)) {
                pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error, docId);
              }
              return 0;
            });
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error, docId);
          }
          return 0;
        });
    });

    if (tasks.length) {
      const results = await Promise.all(tasks);
      results.forEach((count) => {
        if (Number.isFinite(count) && count > 0) {
          cleanedEntries += count;
        }
      });
    }

    if (entries.length < batchSize) {
      break;
    }
  }

  if (cleanedEntries > 0) {
    appendRemovalCount(summary, 'pvpLeaderboardEntries', cleanedEntries);
  }

  return cleanedEntries;
}

async function legacyCleanupPvpLeaderboardOrphans(summary, options = {}) {
  let memberIds;
  try {
    memberIds = await listAllMemberIds();
  } catch (error) {
    console.error('[admin] legacy pvp leaderboard cleanup failed to load member ids', error);
    return 0;
  }
  return legacyCleanupPvpLeaderboardOrphansWithMembers(memberIds, summary, options);
}

async function legacyCleanupPvpLeaderboardOrphansWithMembers(memberIds, summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const collection = db.collection(COLLECTIONS.PVP_LEADERBOARD);
  const limit = 100;
  let hasMore = true;
  let lastId = '';
  let cleanedEntries = 0;

  while (hasMore) {
    let query = collection;
    if (lastId) {
      query = query.where({ _id: _.gt(lastId) });
    }
    const snapshot = await query
      .orderBy('_id', 'asc')
      .limit(limit)
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }
    lastId = docs[docs.length - 1]._id || lastId;

    const tasks = [];

    docs.forEach((doc) => {
      if (!doc || !doc._id) {
        return;
      }
      const entries = Array.isArray(doc.entries) ? doc.entries : [];
      const filtered = entries.filter((entry) => {
        const candidate = normalizeMemberIdValue(entry && entry.memberId);
        return candidate && memberIds.has(candidate);
      });
      if (filtered.length === entries.length) {
        return;
      }
      const orphanCount = entries.length - filtered.length;
      if (previewOnly) {
        summary.preview = summary.preview || {};
        summary.preview.pvpLeaderboardEntries =
          (summary.preview.pvpLeaderboardEntries || 0) + orphanCount;
        cleanedEntries += orphanCount;
        return;
      }
      tasks.push(
        collection
          .doc(doc._id)
          .update({
            data: {
              entries: filtered,
              updatedAt: new Date()
            }
          })
          .then(() => {
            cleanedEntries += orphanCount;
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error, doc._id);
            }
          })
      );
    });

    if (!previewOnly && tasks.length) {
      await Promise.all(tasks);
    }

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  if (cleanedEntries > 0 && !previewOnly) {
    appendRemovalCount(summary, 'pvpLeaderboardEntries', cleanedEntries);
  }

  return cleanedEntries;
}

async function cleanupPveProfileHistory(summary, options = {}) {
  const previewOnly = Boolean(options && options.previewOnly);
  const collection = db.collection(COLLECTIONS.MEMBERS);
  const condition = _.or([
    { 'pveProfile.battleHistory': _.exists(true) },
    { 'pveProfile.skillHistory': _.exists(true) },
    { 'pveProfile.__historyDoc': _.exists(true) }
  ]);

  if (previewOnly) {
    try {
      const snapshot = await collection.where(condition).count();
      const total = snapshot && Number.isFinite(snapshot.total) ? Math.max(0, Math.floor(snapshot.total)) : 0;
      if (total > 0) {
        if (!summary.preview || typeof summary.preview !== 'object') {
          summary.preview = {};
        }
        summary.preview.pveProfileHistory = (summary.preview.pveProfileHistory || 0) + total;
      }
      return total;
    } catch (error) {
      if (isNotFoundError(error)) {
        return 0;
      }
      pushCleanupError(summary, COLLECTIONS.MEMBERS, error);
      return 0;
    }
  }

  const limit = 100;
  let offset = 0;
  let processed = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await collection
      .where(condition)
      .skip(offset)
      .limit(limit)
      .field({ _id: true })
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, COLLECTIONS.MEMBERS, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    offset += docs.length;

    const tasks = docs.map((doc) =>
      collection
        .doc(doc._id)
        .update({
          data: {
            'pveProfile.battleHistory': _.remove(),
            'pveProfile.skillHistory': _.remove(),
            'pveProfile.__historyDoc': _.remove(),
            updatedAt: new Date()
          }
        })
        .then(() => {
          processed += 1;
        })
        .catch((error) => {
          if (!isNotFoundError(error)) {
            pushCleanupError(summary, COLLECTIONS.MEMBERS, error, doc._id);
          }
        })
    );

    if (tasks.length) {
      await Promise.all(tasks);
    }

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  if (processed > 0) {
    if (!summary.removed || typeof summary.removed !== 'object') {
      summary.removed = {};
    }
    summary.removed.pveProfileHistory = (summary.removed.pveProfileHistory || 0) + processed;
  }

  return processed;
}

function extractMemberIdsByPath(doc, path) {
  if (!doc || !path) {
    return [];
  }
  const segments = String(path)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    return [];
  }
  let value = doc;
  for (const segment of segments) {
    if (value === null || value === undefined) {
      return [];
    }
    value = value[segment];
  }
  if (Array.isArray(value)) {
    const results = [];
    value.forEach((item) => {
      if (item && typeof item === 'object') {
        const candidate = normalizeMemberIdValue(item.memberId || item._id || item.id || '');
        if (candidate) {
          results.push(candidate);
        }
      } else {
        const candidate = normalizeMemberIdValue(item);
        if (candidate) {
          results.push(candidate);
        }
      }
    });
    return Array.from(new Set(results));
  }
  if (value && typeof value === 'object') {
    const candidate = normalizeMemberIdValue(value.memberId || value._id || value.id || '');
    return candidate ? [candidate] : [];
  }
  const candidate = normalizeMemberIdValue(value);
  return candidate ? [candidate] : [];
}

async function removeCollectionByMemberId(collectionName, memberId, summary) {
  const targetId = normalizeMemberIdValue(memberId);
  if (!targetId) {
    return 0;
  }
  const collection = db.collection(collectionName);
  const limit = 100;
  let removed = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await collection
      .where({ memberId: targetId })
      .limit(limit)
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, collectionName, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    await Promise.all(
      docs.map((doc) =>
        collection
          .doc(doc._id)
          .remove()
          .then(() => {
            removed += 1;
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, collectionName, error, doc._id);
            }
          })
      )
    );

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  appendRemovalCount(summary, collectionName, removed);
  return removed;
}

async function removeCollectionByMemberIdFields(collectionName, fields, memberId, summary) {
  const targetId = normalizeMemberIdValue(memberId);
  const normalizedFields = Array.isArray(fields)
    ? fields.map((field) => (typeof field === 'string' ? field.trim() : '')).filter((field) => field)
    : [];
  if (!targetId || !normalizedFields.length) {
    return 0;
  }
  const collection = db.collection(collectionName);
  const limit = 100;
  let removed = 0;
  let hasMore = true;
  const filterConditions = normalizedFields.map((field) => ({ [field]: targetId }));

  while (hasMore) {
    const whereCondition =
      filterConditions.length === 1 ? filterConditions[0] : _.or(filterConditions);
    const snapshot = await collection
      .where(whereCondition)
      .limit(limit)
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, collectionName, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    await Promise.all(
      docs.map((doc) =>
        collection
          .doc(doc._id)
          .remove()
          .then(() => {
            removed += 1;
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, collectionName, error, doc._id);
            }
          })
      )
    );

    if (docs.length < limit) {
      hasMore = false;
    }
  }

  appendRemovalCount(summary, collectionName, removed);
  return removed;
}

async function removeMemberFromPvpLeaderboard(memberId, summary) {
  const targetId = normalizeMemberIdValue(memberId);
  if (!targetId) {
    return 0;
  }
  const collection = db.collection(COLLECTIONS.PVP_LEADERBOARD);
  const limit = 100;
  let offset = 0;
  let cleanedEntries = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await collection
      .skip(offset)
      .limit(limit)
      .get()
      .catch((error) => {
        if (!isNotFoundError(error)) {
          pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error);
        }
        return { data: [] };
      });
    const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
    if (!docs.length) {
      break;
    }

    await Promise.all(
      docs.map((doc) => {
        const entries = Array.isArray(doc.entries) ? doc.entries : [];
        const filtered = entries.filter((entry) => entry && entry.memberId !== targetId);
        if (filtered.length === entries.length) {
          return Promise.resolve();
        }
        return collection
          .doc(doc._id)
          .update({
            data: {
              entries: filtered,
              updatedAt: new Date()
            }
          })
          .then(() => {
            cleanedEntries += entries.length - filtered.length;
          })
          .catch((error) => {
            if (!isNotFoundError(error)) {
              pushCleanupError(summary, COLLECTIONS.PVP_LEADERBOARD, error, doc._id);
            }
          });
      })
    );

    offset += docs.length;
    if (docs.length < limit) {
      hasMore = false;
    }
  }

  if (cleanedEntries > 0) {
    appendRemovalCount(summary, 'pvpLeaderboardEntries', cleanedEntries);
  }
  return cleanedEntries;
}

async function removeDocumentById(collectionName, docId, summary) {
  const targetId = normalizeMemberIdValue(docId);
  if (!targetId) {
    return 0;
  }
  try {
    await db
      .collection(collectionName)
      .doc(targetId)
      .remove();
    appendRemovalCount(summary, collectionName, 1);
    return 1;
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }
    pushCleanupError(summary, collectionName, error, targetId);
    return 0;
  }
}

function mergeCleanupSummary(target, source) {
  if (!target || !source || typeof source !== 'object') {
    return;
  }
  if (source.removed && typeof source.removed === 'object') {
    target.removed = target.removed && typeof target.removed === 'object' ? target.removed : {};
    Object.keys(source.removed).forEach((key) => {
      const value = Number(source.removed[key]);
      if (Number.isFinite(value) && value > 0) {
        target.removed[key] = (target.removed[key] || 0) + value;
      }
    });
  }
  if (source.preview && typeof source.preview === 'object') {
    target.preview = target.preview && typeof target.preview === 'object' ? target.preview : {};
    Object.keys(source.preview).forEach((key) => {
      const value = Number(source.preview[key]);
      if (Number.isFinite(value) && value > 0) {
        target.preview[key] = (target.preview[key] || 0) + value;
      }
    });
  }
  if (Array.isArray(source.errors) && source.errors.length) {
    target.errors = Array.isArray(target.errors) ? target.errors : [];
    target.errors.push(...source.errors);
  }
}

async function runTasksWithConcurrency(taskFactories, concurrency = 3) {
  if (!Array.isArray(taskFactories) || taskFactories.length === 0) {
    return [];
  }

  const normalizedConcurrency = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1;
  const workerCount = Math.min(normalizedConcurrency, taskFactories.length);
  const results = new Array(taskFactories.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= taskFactories.length) {
        break;
      }
      const factory = taskFactories[currentIndex];
      try {
        results[currentIndex] = await factory();
      } catch (error) {
        results[currentIndex] = { error };
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

function pushCleanupError(summary, collectionName, error, docId = '') {
  const message = (error && (error.errMsg || error.message)) || 'Unknown error';
  summary.errors.push({ collection: collectionName, id: docId, message });
  console.error('[admin] cleanup member data failed', collectionName, docId, error);
}

function isNotFoundError(error) {
  if (!error) {
    return false;
  }
  const message = error.errMsg || error.message || '';
  return /not exist/i.test(message);
}

function resolveRefreshBatchSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return PLAYER_REFRESH_BATCH_SIZE;
  }
  return Math.min(100, Math.max(1, Math.floor(numeric)));
}

function resolveRefreshMaxDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return PLAYER_REFRESH_MAX_DURATION_MS;
  }
  return Math.min(2800, Math.max(500, Math.floor(numeric)));
}

function resolveNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeMemberIdValue(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function normalizeUsageCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeOptionalUsageLimit(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const positive = Math.max(0, Math.floor(numeric));
  return positive > 0 ? positive : null;
}

function storageIsObject(value) {
  return value && typeof value === 'object';
}

function resolveExistingStorage(existing = {}) {
  const profile = existing && existing.pveProfile ? existing.pveProfile : {};
  const equipment = profile && profile.equipment ? profile.equipment : {};
  const storage = equipment && storageIsObject(equipment.storage) ? equipment.storage : {};
  return storageIsObject(storage) ? storage : {};
}

function resolveExistingStorageUpgradeLimit(existing = {}) {
  const storage = resolveExistingStorage(existing);
  if (!Object.keys(storage).length) {
    return null;
  }
  const meta = storageIsObject(storage.meta) ? storage.meta : {};
  for (const key of STORAGE_UPGRADE_LIMIT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      const limit = normalizeOptionalUsageLimit(meta[key]);
      if (limit !== null) {
        return limit;
      }
    }
  }
  for (const key of STORAGE_UPGRADE_LIMIT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(storage, key)) {
      const limit = normalizeOptionalUsageLimit(storage[key]);
      if (limit !== null) {
        return limit;
      }
    }
  }
  return null;
}

function resolveExistingStorageUpgradeLevel(existing = {}) {
  const storage = resolveExistingStorage(existing);
  let level = normalizeUsageCount(storage.globalUpgrades);
  if (storageIsObject(storage.upgrades)) {
    Object.keys(storage.upgrades).forEach((key) => {
      level = Math.max(level, normalizeUsageCount(storage.upgrades[key]));
    });
  }
  const meta = storageIsObject(storage.meta) ? storage.meta : {};
  if (Object.prototype.hasOwnProperty.call(meta, 'upgrades')) {
    level = Math.max(level, normalizeUsageCount(meta.upgrades));
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'globalUpgrades')) {
    level = Math.max(level, normalizeUsageCount(meta.globalUpgrades));
  }
  return level;
}

function calculateDefaultStorageUpgradeLimit(existing, availableCount) {
  const currentLevel = resolveExistingStorageUpgradeLevel(existing);
  const desired = currentLevel + Math.max(0, availableCount);
  if (desired > 0) {
    return desired;
  }
  return currentLevel > 0 ? currentLevel : null;
}

function resolveStorageUpgradeLimitForUpdate(existing, availableCount) {
  const existingLimit = resolveExistingStorageUpgradeLimit(existing);
  const defaultLimit = calculateDefaultStorageUpgradeLimit(existing, availableCount);
  if (existingLimit !== null && defaultLimit !== null) {
    return Math.max(existingLimit, defaultLimit);
  }
  if (existingLimit !== null) {
    return existingLimit;
  }
  if (defaultLimit !== null) {
    return defaultLimit;
  }
  return undefined;
}

function resolvePveRespecStats(member) {
  const profile = member && member.pveProfile ? member.pveProfile : {};
  const attributes = profile && profile.attributes ? profile.attributes : {};
  const legacyLimit = normalizeUsageCount(attributes.respecLimit);
  const legacyUsed = Math.min(legacyLimit, normalizeUsageCount(attributes.respecUsed));
  const legacyAvailable = Math.max(legacyLimit - legacyUsed, 0);
  const available = Math.max(legacyAvailable, normalizeUsageCount(attributes.respecAvailable));
  return { available };
}

function resolveSkillDrawCredits(member) {
  const profile = member && member.pveProfile ? member.pveProfile : {};
  const skills = profile && profile.skills ? profile.skills : {};
  return normalizeUsageCount(skills.drawCredits);
}

function normalizeAvatarUnlocksList(unlocks) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim().toLowerCase();
    if (
      !trimmed ||
      seen.has(trimmed) ||
      !AVATAR_ID_PATTERN.test(trimmed) ||
      !ALLOWED_AVATAR_IDS.has(trimmed)
    ) {
      return;
    }
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

function buildUpdatePayload(updates, existing = {}, extras = {}) {
  const memberUpdates = {};
  const extrasUpdates = {};
  let renameLog = null;

  if (Object.prototype.hasOwnProperty.call(updates, 'nickName')) {
    const input = updates.nickName;
    const currentName = typeof existing.nickName === 'string' ? existing.nickName : '';
    const target = typeof input === 'string' ? input.trim() : '';
    if (target !== currentName) {
      memberUpdates.nickName = target;
      if (target) {
        const now = new Date();
        const renameUsed = Number(existing.renameUsed || 0);
        memberUpdates.renameUsed = Number.isFinite(renameUsed) ? renameUsed + 1 : 1;
        renameLog = {
          previous: currentName || '',
          current: target,
          changedAt: now,
          source: 'admin'
        };
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'mobile')) {
    memberUpdates.mobile = updates.mobile || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'realName')) {
    memberUpdates.realName = typeof updates.realName === 'string' ? updates.realName.trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'levelId')) {
    memberUpdates.levelId = updates.levelId || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'gender')) {
    memberUpdates.gender = normalizeGenderValue(updates.gender);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatarUrl')) {
    memberUpdates.avatarUrl = typeof updates.avatarUrl === 'string' ? updates.avatarUrl.trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'experience')) {
    const experience = Number(updates.experience || 0);
    memberUpdates.experience = Number.isFinite(experience) ? experience : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'cashBalance')) {
    const cash = Number(updates.cashBalance || 0);
    memberUpdates.cashBalance = Number.isFinite(cash) ? Math.round(cash) : 0;
  } else if (Object.prototype.hasOwnProperty.call(updates, 'balance')) {
    const legacy = Number(updates.balance || 0);
    memberUpdates.cashBalance = Number.isFinite(legacy) ? Math.round(legacy) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'stoneBalance')) {
    const stones = Number(updates.stoneBalance || 0);
    memberUpdates.stoneBalance = Number.isFinite(stones) ? Math.max(0, Math.floor(stones)) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'renameCredits')) {
    const credits = Number(updates.renameCredits || 0);
    memberUpdates.renameCredits = Number.isFinite(credits) ? Math.max(0, Math.floor(credits)) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'respecAvailable')) {
    const desiredAvailable = normalizeUsageCount(updates.respecAvailable);
    memberUpdates['pveProfile.attributes.respecAvailable'] = desiredAvailable;
    memberUpdates['pveProfile.attributes.respecLimit'] = 0;
    memberUpdates['pveProfile.attributes.respecUsed'] = 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'skillDrawCredits')) {
    memberUpdates['pveProfile.skills.drawCredits'] = normalizeUsageCount(
      updates.skillDrawCredits
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'roomUsageCount')) {
    memberUpdates.roomUsageCount = normalizeUsageCount(updates.roomUsageCount);
  }
  let storageUpgradeLimitProvided = false;
  let storageUpgradeLimitValue = null;
  if (Object.prototype.hasOwnProperty.call(updates, 'storageUpgradeLimit')) {
    storageUpgradeLimitProvided = true;
    storageUpgradeLimitValue = normalizeOptionalUsageLimit(updates.storageUpgradeLimit);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'storageUpgradeAvailable')) {
    const available = normalizeUsageCount(updates.storageUpgradeAvailable);
    memberUpdates['pveProfile.equipment.storage.upgradeAvailable'] = available;
    memberUpdates['pveProfile.equipment.storage.upgradeRemaining'] = available;
    memberUpdates['pveProfile.equipment.storage.meta.upgradeAvailable'] = available;
    memberUpdates['pveProfile.equipment.storage.meta.upgradesRemaining'] = available;
    if (!storageUpgradeLimitProvided) {
      const resolvedLimit = resolveStorageUpgradeLimitForUpdate(existing, available);
      if (resolvedLimit !== undefined) {
        storageUpgradeLimitProvided = true;
        storageUpgradeLimitValue = resolvedLimit;
      }
    }
  }
  if (storageUpgradeLimitProvided) {
    memberUpdates['pveProfile.equipment.storage.upgradeLimit'] = storageUpgradeLimitValue;
    memberUpdates['pveProfile.equipment.storage.meta.upgradeLimit'] = storageUpgradeLimitValue;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'roles')) {
    const roles = Array.isArray(updates.roles) ? updates.roles : [];
    const filtered = roles.filter((role) => ['member', 'admin', 'developer', 'test'].includes(role));
    memberUpdates.roles = filtered.length ? filtered : ['member'];
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatarUnlocks')) {
    const currentExtrasUnlocks = Array.isArray(extras.avatarUnlocks) ? extras.avatarUnlocks : [];
    const desiredUnlocks = normalizeAvatarUnlocksList(updates.avatarUnlocks);
    if (!arraysEqual(currentExtrasUnlocks, desiredUnlocks)) {
      extrasUpdates.avatarUnlocks = desiredUnlocks;
    }
  }

  return { memberUpdates, extrasUpdates, renameLog };
}

function normalizeAmountFen(value) {
  if (value == null) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const sanitized = trimmed.replace(/[^0-9.-]/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }
  return 0;
}

function normalizeGenderValue(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'male' || normalized === '1') {
    return 'male';
  }
  if (normalized === 'female' || normalized === '2') {
    return 'female';
  }
  return 'unknown';
}

function normalizeRenameCredits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeRenameUsed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function formatRenameHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.slice(-20).map((item, index) => {
    const changedAt = item && item.changedAt ? item.changedAt : null;
    let timestamp = Date.now();
    if (changedAt) {
      const date = changedAt instanceof Date ? changedAt : new Date(changedAt);
      if (!Number.isNaN(date.getTime())) {
        timestamp = date.getTime();
      }
    }
    return {
      id: item && item.id ? item.id : `${timestamp}-${index}`,
      previous: (item && item.previous) || '',
      current: (item && item.current) || '',
      changedAt,
      changedAtLabel: formatDate(changedAt),
      source: (item && item.source) || 'manual'
    };
  });
}

function normalizeDiningFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ['1', 'true', 'yes', 'y', '是', '用餐'].includes(normalized);
  }
  return false;
}

function normalizeChargeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((raw) => {
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const quantity = Number(raw.quantity || 0);
      const price = normalizeAmountFen(raw.price);
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || !price || price <= 0) {
        return null;
      }
      const normalizedQuantity = Math.floor(quantity);
      const amount = price * normalizedQuantity;
      return {
        name,
        price,
        quantity: normalizedQuantity,
        amount,
        isDining: normalizeDiningFlag(raw.isDining)
      };
    })
    .filter(Boolean);
}

function mapChargeOrder(order) {
  if (!order) return null;
  const hasBalanceBefore = Object.prototype.hasOwnProperty.call(order, 'balanceBefore');
  const hasBalanceAfter = Object.prototype.hasOwnProperty.call(order, 'balanceAfter');
  const normalizeOptionalAmount = (value, hasValue) => {
    if (!hasValue) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const totalAmount = Number(order.totalAmount || 0);
  const priceAdjustment = normalizePriceAdjustmentRecord(order.priceAdjustment);
  return {
    _id: order._id,
    status: order.status || 'pending',
    items: (order.items || []).map((item) => ({
      name: item.name || '',
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      amount: Number(item.amount || 0),
      isDining: !!item.isDining
    })),
    totalAmount,
    stoneReward: Number(order.stoneReward || totalAmount || 0),
    diningAmount: Number(order.diningAmount || 0),
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    expireAt: order.expireAt || null,
    memberId: order.memberId || '',
    confirmedAt: order.confirmedAt || null,
    qrPayload: buildChargeOrderPayload(order._id),
    miniProgramScene: buildChargeOrderScene(order._id),
    originalTotalAmount: Number(order.originalTotalAmount || 0),
    priceAdjustment,
    priceAdjustmentHistory: normalizePriceAdjustmentHistory(order.priceAdjustmentHistory, priceAdjustment),
    balanceBefore: normalizeOptionalAmount(order.balanceBefore, hasBalanceBefore),
    balanceAfter: normalizeOptionalAmount(order.balanceAfter, hasBalanceAfter),
    allowNegativeBalance: !!order.allowNegativeBalance,
    debtIncurred: !!order.debtIncurred
  };
}

function normalizePriceAdjustmentRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const previousAmount = Number(record.previousAmount || record.previous || 0);
  const newAmount = Number(record.newAmount || record.current || record.amount || 0);
  if (!newAmount || newAmount <= 0) {
    return null;
  }
  const remark = typeof record.remark === 'string' ? record.remark : '';
  const adjustedAt = record.adjustedAt || record.updatedAt || record.createdAt || null;
  const adjustedBy = typeof record.adjustedBy === 'string' ? record.adjustedBy : '';
  return {
    previousAmount,
    newAmount,
    remark,
    adjustedAt,
    adjustedBy,
    adjustedByName: typeof record.adjustedByName === 'string' ? record.adjustedByName : ''
  };
}

function normalizePriceAdjustmentHistory(history, latest) {
  if (!Array.isArray(history)) {
    return latest ? [latest] : [];
  }
  const normalized = history
    .map((entry) => normalizePriceAdjustmentRecord(entry))
    .filter(Boolean);
  if (latest) {
    const [first] = normalized;
    if (!first || first.adjustedAt !== latest.adjustedAt || first.newAmount !== latest.newAmount) {
      normalized.unshift(latest);
    }
  }
  return normalized;
}

function buildChargeOrderPayload(orderId) {
  if (!orderId) return '';
  return `member-charge:${orderId}`;
}

function buildChargeOrderScene(orderId) {
  if (!orderId) {
    return '';
  }
  const value = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!value) {
    return '';
  }
  return value.length > 32 ? '' : value;
}

function buildChargeOrderPagePath(orderId) {
  const basePath = 'pages/wallet/charge-confirm/index';
  if (!orderId) {
    return basePath;
  }
  const trimmed = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!trimmed) {
    return basePath;
  }
  const encoded = encodeURIComponent(trimmed);
  return `${basePath}?orderId=${encoded}`;
}

async function generateChargeOrderUrlScheme(orderId, expireAt) {
  const queryValue = typeof orderId === 'string' ? orderId.trim() : String(orderId || '');
  if (!queryValue) {
    return { schemeUrl: '', schemeExpireAt: null };
  }

  const expireTimestamp = resolveExpireTimestamp(expireAt);
  const envOptions = resolveUrlSchemeEnvOptions();
  const path = 'pages/wallet/charge-confirm/index';
  const query = `orderId=${encodeURIComponent(queryValue)}`;

  const schemeResult = await tryGenerateUrlScheme({ path, query }, expireTimestamp, envOptions);
  if (schemeResult) {
    return schemeResult;
  }

  const linkResult = await tryGenerateUrlLink({ path, query }, expireTimestamp, envOptions);
  if (linkResult) {
    return linkResult;
  }

  return { schemeUrl: '', schemeExpireAt: null };
}

async function tryGenerateUrlScheme({ path, query }, expireTimestamp, envOptions) {
  const canGenerate =
    cloud.openapi &&
    cloud.openapi.urlscheme &&
    typeof cloud.openapi.urlscheme.generate === 'function';
  if (!canGenerate) {
    return null;
  }

  let lastError = null;
  for (const option of envOptions) {
    try {
      const payload = {
        jumpWxa: {
          path,
          query
        },
        isExpire: typeof expireTimestamp === 'number'
      };

      if (option.envVersion) {
        payload.jumpWxa.envVersion = option.envVersion;
      }

      if (typeof expireTimestamp === 'number') {
        payload.expireTime = expireTimestamp;
      }

      const response = await cloud.openapi.urlscheme.generate(payload);
      if (response && response.scheme) {
        return {
          schemeUrl: response.scheme,
          schemeExpireAt: resolveExpireDate(expireTimestamp)
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `Failed to generate url scheme for charge order in env ${option.envVersion || 'release'}`,
        error
      );
    }
  }

  if (lastError) {
    console.error('Failed to generate url scheme for charge order after retries', lastError);
  }

  return null;
}

async function tryGenerateUrlLink({ path, query }, expireTimestamp, envOptions) {
  const canGenerate =
    cloud.openapi &&
    cloud.openapi.urllink &&
    typeof cloud.openapi.urllink.generate === 'function';
  if (!canGenerate) {
    return null;
  }

  let lastError = null;
  for (const option of envOptions) {
    try {
      const payload = {
        path,
        query,
        isExpire: typeof expireTimestamp === 'number'
      };

      if (option.envVersion) {
        payload.envVersion = option.envVersion;
      }

      if (typeof expireTimestamp === 'number') {
        payload.expireType = 1;
        payload.expireTime = expireTimestamp;
      }

      const response = await cloud.openapi.urllink.generate(payload);
      if (response && response.urlLink) {
        return {
          schemeUrl: response.urlLink,
          schemeExpireAt: resolveExpireDate(expireTimestamp)
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `Failed to generate url link for charge order in env ${option.envVersion || 'release'}`,
        error
      );
    }
  }

  if (lastError) {
    console.error('Failed to generate url link for charge order after retries', lastError);
  }

  return null;
}

function resolveUrlSchemeEnvOptions() {
  const configured = getConfiguredEnvVersion();
  if (configured) {
    return [{ envVersion: configured }];
  }
  return [{ envVersion: 'release' }, { envVersion: 'trial' }, { envVersion: 'develop' }];
}

function resolveExpireTimestamp(expireAt) {
  if (!expireAt) {
    return undefined;
  }

  const date = expireAt instanceof Date ? expireAt : new Date(expireAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const timestamp = Math.floor(date.getTime() / 1000);
  if (timestamp <= 0) {
    return undefined;
  }

  const now = Math.floor(Date.now() / 1000);
  if (timestamp <= now) {
    return now + 60;
  }

  return timestamp;
}

function resolveExpireDate(expireTimestamp) {
  if (!expireTimestamp || typeof expireTimestamp !== 'number') {
    return null;
  }
  return new Date(expireTimestamp * 1000).toISOString();
}

function getConfiguredEnvVersion() {
  const value =
    process.env.MINI_PROGRAM_QR_ENV_VERSION ||
    process.env.MINIPROGRAM_QR_ENV_VERSION ||
    process.env.WXACODE_ENV_VERSION ||
    '';

  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) {
    return '';
  }

  if (['release', 'trial', 'develop'].includes(normalized)) {
    return normalized;
  }

  return '';
}

function decorateChargeOrderRecord(order, member) {
  if (!order) return null;
  const originalAmount = Number(
    order.originalTotalAmount || (order.priceAdjustment ? order.priceAdjustment.previousAmount : 0)
  );
  const priceAdjusted = Number.isFinite(originalAmount) && originalAmount > 0 && originalAmount !== order.totalAmount;
  const priceAdjustmentRemark = order.priceAdjustment ? order.priceAdjustment.remark || '' : '';
  const priceAdjustmentAdjustedAtLabel = order.priceAdjustment ? formatDate(order.priceAdjustment.adjustedAt) : '';
  const balanceBefore = Number.isFinite(order.balanceBefore) ? order.balanceBefore : null;
  const balanceAfter = Number.isFinite(order.balanceAfter) ? order.balanceAfter : null;
  return {
    ...order,
    totalAmountLabel: `¥${formatFenToYuan(order.totalAmount)}`,
    stoneRewardLabel: `${formatStoneLabel(order.stoneReward)} 枚`,
    createdAtLabel: formatDate(order.createdAt),
    updatedAtLabel: formatDate(order.updatedAt),
    confirmedAtLabel: formatDate(order.confirmedAt),
    statusLabel: describeChargeOrderStatus(order.status),
    memberId: order.memberId || '',
    memberName: member ? member.nickName || '' : '',
    memberRealName: member ? member.realName || '' : '',
    memberMobile: member ? member.mobile || '' : '',
    originalTotalAmount: originalAmount,
    originalTotalAmountLabel: originalAmount ? `¥${formatFenToYuan(originalAmount)}` : '',
    priceAdjusted,
    priceAdjustmentRemark,
    priceAdjustmentAdjustedAtLabel,
    balanceBefore,
    balanceAfter,
    balanceBeforeLabel: Number.isFinite(balanceBefore) ? `¥${formatFenToYuan(balanceBefore)}` : '',
    balanceAfterLabel: Number.isFinite(balanceAfter) ? `¥${formatFenToYuan(balanceAfter)}` : '',
    allowNegativeBalance: !!order.allowNegativeBalance,
    debtIncurred: !!order.debtIncurred
  };
}

function describeChargeOrderStatus(status) {
  switch (status) {
    case 'paid':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已过期';
    default:
      return '待支付';
  }
}

function buildMemberSnapshot(member) {
  if (!member || typeof member !== 'object') {
    return {
      nickName: '',
      realName: '',
      mobile: '',
      levelId: ''
    };
  }
  return {
    nickName: typeof member.nickName === 'string' ? member.nickName : '',
    realName: typeof member.realName === 'string' ? member.realName : '',
    mobile: typeof member.mobile === 'string' ? member.mobile : '',
    levelId: typeof member.levelId === 'string' ? member.levelId : ''
  };
}

async function loadMembersMap(memberIds) {
  if (!Array.isArray(memberIds) || !memberIds.length) {
    return {};
  }
  const chunks = [];
  const size = 10;
  for (let i = 0; i < memberIds.length; i += size) {
    chunks.push(memberIds.slice(i, i + size));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      db
        .collection(COLLECTIONS.MEMBERS)
        .where({ _id: _.in(ids) })
        .get()
        .catch(() => ({ data: [] }))
    )
  );
  const map = {};
  results.forEach((res) => {
    (res.data || []).forEach((member) => {
      map[member._id] = member;
    });
  });
  return map;
}

async function searchMemberIdsByKeyword(keyword) {
  if (!keyword) {
    return [];
  }
  const regex = db.RegExp({
    regexp: keyword,
    options: 'i'
  });
  const snapshot = await db
    .collection(COLLECTIONS.MEMBERS)
    .where(
      _.or([
        { nickName: regex },
        { mobile: regex },
        { realName: regex }
      ])
    )
    .limit(20)
    .get()
    .catch(() => ({ data: [] }));
  const ids = new Set();
  (snapshot.data || []).forEach((member) => {
    if (member && member._id) {
      ids.add(member._id);
    }
  });
  return Array.from(ids);
}

function resolveCashBalance(member) {
  if (!member) return 0;
  if (typeof member.cashBalance === 'number' && Number.isFinite(member.cashBalance)) {
    return member.cashBalance;
  }
  if (typeof member.balance === 'number' && Number.isFinite(member.balance)) {
    return member.balance;
  }
  return 0;
}

function resolveStoneBalance(member) {
  if (!member) return 0;
  const value = Number(member.stoneBalance);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

function formatFenToYuan(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return (numeric / 100).toFixed(2);
}

function formatStoneLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return Math.max(0, Math.floor(numeric)).toLocaleString('zh-CN');
}

function formatDate(value) {
  if (!value) return '';
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else if (value && typeof value.toDate === 'function') {
    try {
      date = value.toDate();
    } catch (err) {
      date = null;
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  const y = map.year || '';
  const m = map.month || '';
  const d = map.day || '';
  const hh = map.hour || '';
  const mm = map.minute || '';
  if (!y || !m || !d || !hh || !mm) {
    return formatter
      .format(date)
      .replace(/\//g, '-')
      .replace(/[年月]/g, '-')
      .replace(/[日]/, '')
      .replace(/[\u4e00-\u9fa5]/g, '')
      .trim();
  }
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}

async function getFinanceReport(openid, monthInput) {
  await ensureAdmin(openid);
  const range = resolveFinanceReportRange(monthInput);
  const adminMemberIds = await loadAdminMemberIds();
  const walletMatch = buildWalletMatch(range, adminMemberIds);
  const menuOrderMatch = buildMenuOrderMatch(range, adminMemberIds);
  const chargeOrderMatch = buildChargeOrderMatch(range, adminMemberIds);
  const [walletTotals, menuDiningTotals, chargeDiningTotals] = await Promise.all([
    aggregateWalletTotals(walletMatch),
    aggregateMenuDiningTotals(menuOrderMatch, range),
    aggregateChargeOrderDiningTotals(chargeOrderMatch, range)
  ]);
  const totalIncome = Math.max(0, normalizeAmountValue(walletTotals.totalIncome));
  const totalSpend = Math.max(0, normalizeAmountValue(walletTotals.totalSpend));
  const diningSpendRaw = Math.max(
    0,
    normalizeAmountValue(menuDiningTotals.diningTotal) + normalizeAmountValue(chargeDiningTotals.diningTotal)
  );
  const diningSpend = Math.min(totalSpend, diningSpendRaw);
  const now = new Date();
  return {
    month: range.month,
    monthLabel: range.monthLabel,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    rangeLabel: range.rangeLabel,
    totals: {
      totalIncome,
      totalSpend,
      diningSpend
    },
    generatedAt: now.toISOString(),
    constraints: range.constraints
  };
}

function resolveFinanceReportRange(input) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxMonthStart = currentMonthStart < MIN_REPORT_MONTH ? new Date(MIN_REPORT_MONTH.getTime()) : currentMonthStart;
  let monthStart = parseMonthInput(input) || currentMonthStart;
  if (monthStart < MIN_REPORT_MONTH) {
    monthStart = new Date(MIN_REPORT_MONTH.getTime());
  }
  if (monthStart > maxMonthStart) {
    monthStart = new Date(maxMonthStart.getTime());
  }
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  return {
    month: formatMonthKey(start),
    monthLabel: formatMonthLabel(start),
    start,
    end,
    rangeLabel: `${formatDateLabel(start)} 至 ${formatDateLabel(new Date(end.getFullYear(), end.getMonth(), 0))}`,
    constraints: {
      minMonth: formatMonthKey(MIN_REPORT_MONTH),
      maxMonth: formatMonthKey(maxMonthStart)
    }
  };
}

function parseMonthInput(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = /^([0-9]{4})-([0-9]{2})$/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (
        Number.isInteger(year) &&
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        year >= 2000 &&
        year <= 9999
      ) {
        return new Date(year, month - 1, 1);
      }
    }
  }
  return null;
}

function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function formatMonthLabel(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.toString().padStart(2, '0');
  return `${year}年${month}月`;
}

function formatDateLabel(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildWalletMatch(range, excludedMemberIds = []) {
  const match = {
    createdAt: _.gte(range.start).and(_.lt(range.end)),
    status: _.nin(EXCLUDED_TRANSACTION_STATUSES)
  };
  if (Array.isArray(excludedMemberIds) && excludedMemberIds.length) {
    match.memberId = _.nin(excludedMemberIds);
  }
  return match;
}

async function aggregateWalletTotals(match) {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.WALLET_TRANSACTIONS)
      .aggregate()
      .match(match)
      .group({
        _id: null,
        totalIncome: $.sum(
          $.cond({
            if: $.gt(['$amount', 0]),
            then: '$amount',
            else: 0
          })
        ),
        totalSpend: $.sum(
          $.cond({
            if: $.lt(['$amount', 0]),
            then: $.abs('$amount'),
            else: 0
          })
        )
      })
      .end();
    if (snapshot && Array.isArray(snapshot.list) && snapshot.list.length) {
      const doc = snapshot.list[0] || {};
      return {
        totalIncome: normalizeAmountValue(doc.totalIncome),
        totalSpend: normalizeAmountValue(doc.totalSpend)
      };
    }
  } catch (error) {
    console.error('[admin] aggregate wallet totals failed', error);
  }
  return fallbackAggregateWalletTotals(match);
}

async function fallbackAggregateWalletTotals(match) {
  const limit = 200;
  let offset = 0;
  let guard = 0;
  let totalIncome = 0;
  let totalSpend = 0;
  let hasMore = true;
  while (hasMore && guard < 50) {
    const snapshot = await db
      .collection(COLLECTIONS.WALLET_TRANSACTIONS)
      .where(match)
      .orderBy('createdAt', 'desc')
      .skip(offset)
      .limit(limit)
      .field({ amount: 1, status: 1 })
      .get()
      .catch(() => null);
    const batch = (snapshot && snapshot.data) || [];
    if (!batch.length) {
      break;
    }
    batch.forEach((doc) => {
      if (!doc) {
        return;
      }
      const status = normalizeStatus(doc.status);
      if (status && EXCLUDED_TRANSACTION_STATUSES.includes(status)) {
        return;
      }
      const amount = Number(doc.amount || 0);
      if (!Number.isFinite(amount) || amount === 0) {
        return;
      }
      if (amount > 0) {
        totalIncome += amount;
      } else if (amount < 0) {
        totalSpend += Math.abs(amount);
      }
    });
    if (batch.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
    guard += 1;
  }
  return { totalIncome: Math.round(totalIncome), totalSpend: Math.round(totalSpend) };
}

function normalizeAmountValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric);
}

async function loadAdminMemberIds() {
  const ids = new Set();
  const limit = 100;
  let offset = 0;
  let guard = 0;
  let hasMore = true;
  while (hasMore && guard < 40) {
    const snapshot = await db
      .collection(COLLECTIONS.MEMBERS)
      .where({ roles: _.in(ADMIN_ROLES) })
      .skip(offset)
      .limit(limit)
      .field({ _id: 1 })
      .get()
      .catch(() => null);
    const batch = (snapshot && snapshot.data) || [];
    if (!batch.length) {
      break;
    }
    batch.forEach((doc) => {
      if (doc && typeof doc._id === 'string' && doc._id) {
        ids.add(doc._id);
      }
    });
    if (batch.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
    guard += 1;
  }
  return Array.from(ids);
}

function normalizeStatus(status) {
  if (typeof status === 'string') {
    return status.trim().toLowerCase();
  }
  return '';
}

function buildMenuOrderMatch(range, excludedMemberIds = []) {
  const match = {
    status: 'paid',
    memberConfirmedAt: _.gte(range.start).and(_.lt(range.end))
  };
  if (Array.isArray(excludedMemberIds) && excludedMemberIds.length) {
    match.memberId = _.nin(excludedMemberIds);
  }
  return match;
}

function buildChargeOrderMatch(range, excludedMemberIds = []) {
  const match = {
    status: 'paid',
    confirmedAt: _.gte(range.start).and(_.lt(range.end))
  };
  if (Array.isArray(excludedMemberIds) && excludedMemberIds.length) {
    match.memberId = _.nin(excludedMemberIds);
  }
  return match;
}

async function aggregateMenuDiningTotals(match, range) {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .aggregate()
      .match(match)
      .group({
        _id: null,
        diningTotal: $.sum($.ifNull(['$categoryTotals.dining', 0]))
      })
      .end();
    if (snapshot && Array.isArray(snapshot.list) && snapshot.list.length) {
      const doc = snapshot.list[0] || {};
      return { diningTotal: normalizeAmountValue(doc.diningTotal) };
    }
  } catch (error) {
    console.error('[admin] aggregate dining totals failed', error);
  }
  return fallbackAggregateMenuDiningTotals(match, range);
}

async function fallbackAggregateMenuDiningTotals(match, range) {
  const limit = 200;
  let offset = 0;
  let guard = 0;
  let total = 0;
  let hasMore = true;
  while (hasMore && guard < 50) {
    const snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .where(match)
      .orderBy('memberConfirmedAt', 'desc')
      .skip(offset)
      .limit(limit)
      .field({ categoryTotals: 1, memberConfirmedAt: 1 })
      .get()
      .catch(() => null);
    const batch = (snapshot && snapshot.data) || [];
    if (!batch.length) {
      break;
    }
    batch.forEach((doc) => {
      if (!doc) {
        return;
      }
      const confirmedAt = resolveDateValue(doc.memberConfirmedAt);
      if (!confirmedAt || confirmedAt < range.start || confirmedAt >= range.end) {
        return;
      }
      const dining = doc.categoryTotals ? Number(doc.categoryTotals.dining || 0) : 0;
      if (Number.isFinite(dining) && dining > 0) {
        total += dining;
      }
    });
    if (batch.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
    guard += 1;
  }
  return { diningTotal: Math.round(total) };
}

async function aggregateChargeOrderDiningTotals(match, range) {
  try {
    const diningItemsSumExpression = $.sum(
      $.map({
        input: $.ifNull(['$items', []]),
        as: 'item',
        in: $.cond({
          if: $.eq([$.ifNull(['$$item.isDining', false]), true]),
          then: $.ifNull(['$$item.amount', 0]),
          else: 0
        })
      })
    );
    const snapshot = await db
      .collection(COLLECTIONS.CHARGE_ORDERS)
      .aggregate()
      .match(match)
      .project({
        rawDiningAmount: diningItemsSumExpression,
        totalAmountSafe: $.cond({
          if: $.lt([$.ifNull(['$totalAmount', 0]), 0]),
          then: 0,
          else: $.ifNull(['$totalAmount', 0])
        })
      })
      .project({
        diningAmount: $.cond({
          if: $.lt(['$rawDiningAmount', 0]),
          then: 0,
          else: $.cond({
            if: $.lt(['$rawDiningAmount', '$totalAmountSafe']),
            then: '$rawDiningAmount',
            else: '$totalAmountSafe'
          })
        })
      })
      .group({
        _id: null,
        diningTotal: $.sum($.cond({
          if: $.lt(['$diningAmount', 0]),
          then: 0,
          else: '$diningAmount'
        }))
      })
      .end();
    if (snapshot && Array.isArray(snapshot.list) && snapshot.list.length) {
      const doc = snapshot.list[0] || {};
      return { diningTotal: normalizeAmountValue(doc.diningTotal) };
    }
  } catch (error) {
    console.error('[admin] aggregate charge order dining totals failed', error);
  }
  return fallbackAggregateChargeOrderDiningTotals(match, range);
}

async function fallbackAggregateChargeOrderDiningTotals(match, range) {
  const limit = 200;
  let offset = 0;
  let guard = 0;
  let total = 0;
  let hasMore = true;
  while (hasMore && guard < 50) {
    const snapshot = await db
      .collection(COLLECTIONS.CHARGE_ORDERS)
      .where(match)
      .orderBy('confirmedAt', 'desc')
      .skip(offset)
      .limit(limit)
      .field({ items: 1, totalAmount: 1, confirmedAt: 1, diningAmount: 1 })
      .get()
      .catch(() => null);
    const batch = (snapshot && snapshot.data) || [];
    if (!batch.length) {
      break;
    }
    batch.forEach((doc) => {
      if (!doc) {
        return;
      }
      const confirmedAt = resolveDateValue(doc.confirmedAt);
      if (!confirmedAt || confirmedAt < range.start || confirmedAt >= range.end) {
        return;
      }
      const diningAmount = extractChargeOrderDiningAmount(doc);
      if (diningAmount > 0) {
        total += diningAmount;
      }
    });
    if (batch.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
    guard += 1;
  }
  return { diningTotal: Math.round(total) };
}

function extractChargeOrderDiningAmount(order) {
  if (!order) {
    return 0;
  }
  const directDiningAmount = Number(order.diningAmount || 0);
  if (Number.isFinite(directDiningAmount) && directDiningAmount > 0) {
    const totalAmount = Number(order.totalAmount || 0);
    if (Number.isFinite(totalAmount) && totalAmount > 0) {
      return Math.min(Math.round(directDiningAmount), Math.round(totalAmount));
    }
    return Math.round(directDiningAmount);
  }
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) {
    return 0;
  }
  const totalAmount = Number(order.totalAmount || 0);
  const diningSum = items.reduce((sum, item) => {
    if (!item || !normalizeDiningFlag(item.isDining)) {
      return sum;
    }
    const amount = Number(item.amount || item.price || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      const price = Number(item.price || 0);
      const quantity = Number(item.quantity || 0);
      const fallback = Number.isFinite(price) && Number.isFinite(quantity) ? price * quantity : 0;
      return fallback > 0 ? sum + fallback : sum;
    }
    return sum + amount;
  }, 0);
  if (!Number.isFinite(diningSum) || diningSum <= 0) {
    return 0;
  }
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return Math.round(diningSum);
  }
  return Math.min(Math.round(diningSum), Math.round(totalAmount));
}

function normalizeActivityStatus(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const normalized = trimmed.toLowerCase();
  if (ACTIVITY_ALLOWED_STATUSES.includes(normalized)) {
    return normalized;
  }
  if (ACTIVITY_ALLOWED_STATUSES.includes(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function normalizeActivityStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => trimToString(item))
      .map((item) => item.replace(/\r\n/g, '\n').trim())
      .filter(Boolean);
  }
  const text = trimToString(value);
  if (!text) {
    return [];
  }
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMultilineString(value) {
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').trim();
  }
  if (Array.isArray(value)) {
    return normalizeActivityStringArray(value).join('\n');
  }
  return trimToString(value);
}

function normalizeActivitySortOrder(value, fallback = 0) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric);
}

function normalizeActivityDateValue(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const lowered = trimmed.toLowerCase();
    if (['null', 'undefined', 'none'].includes(lowered)) {
      return null;
    }
    return resolveDateValue(trimmed);
  }
  return resolveDateValue(value);
}

function normalizeActivityPayload(input = {}, options = {}) {
  const partial = !!options.partial;
  const result = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (has('title') || !partial) {
    const title = trimToString(input.title);
    if (!title && !partial) {
      throw new Error('活动标题不能为空');
    }
    if (title || !partial) {
      result.title = title;
    }
  }

  if (has('tagline')) {
    result.tagline = trimToString(input.tagline);
  }

  if (has('summary')) {
    result.summary = trimToString(input.summary);
  }

  if (has('priceLabel')) {
    result.priceLabel = trimToString(input.priceLabel);
  }

  if (has('location')) {
    result.location = trimToString(input.location);
  }

  if (has('coverImage')) {
    result.coverImage = trimToString(input.coverImage);
  }

  if (has('highlight')) {
    result.highlight = trimToString(input.highlight);
  }

  if (has('notes')) {
    result.notes = normalizeMultilineString(input.notes);
  } else if (!partial) {
    result.notes = '';
  }

  if (has('status') || !partial) {
    const status = normalizeActivityStatus(input.status, partial ? '' : 'draft');
    result.status = status || 'draft';
  }

  if (has('startTime') || !partial) {
    result.startTime = normalizeActivityDateValue(input.startTime);
  }

  if (has('endTime') || !partial) {
    result.endTime = normalizeActivityDateValue(input.endTime);
  }

  if (has('perks')) {
    result.perks = normalizeActivityStringArray(input.perks);
  } else if (!partial) {
    result.perks = [];
  }

  if (has('tags')) {
    result.tags = normalizeActivityStringArray(input.tags);
  } else if (!partial) {
    result.tags = [];
  }

  if (has('sortOrder') || !partial) {
    result.sortOrder = normalizeActivitySortOrder(has('sortOrder') ? input.sortOrder : 0, 0);
  }

  return result;
}

function toIsoString(value) {
  const date = normalizeActivityDateValue(value);
  if (!date) {
    return '';
  }
  try {
    return date.toISOString();
  } catch (error) {
    return '';
  }
}

function decorateActivityRecord(doc = {}) {
  if (!doc) {
    return null;
  }
  return {
    id: doc._id || '',
    title: trimToString(doc.title),
    tagline: trimToString(doc.tagline),
    summary: trimToString(doc.summary),
    status: normalizeActivityStatus(doc.status, 'draft') || 'draft',
    startTime: toIsoString(doc.startTime),
    endTime: toIsoString(doc.endTime),
    priceLabel: trimToString(doc.priceLabel),
    location: trimToString(doc.location),
    coverImage: trimToString(doc.coverImage),
    highlight: trimToString(doc.highlight),
    notes: normalizeMultilineString(doc.notes),
    perks: normalizeActivityStringArray(doc.perks),
    tags: normalizeActivityStringArray(doc.tags),
    sortOrder: normalizeActivitySortOrder(doc.sortOrder, 0),
    createdAt: toIsoString(doc.createdAt),
    updatedAt: toIsoString(doc.updatedAt),
    createdBy: trimToString(doc.createdBy || ''),
    updatedBy: trimToString(doc.updatedBy || '')
  };
}

async function listActivities(openid, options = {}) {
  await ensureAdmin(openid);
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const snapshot = await collection
    .orderBy('sortOrder', 'desc')
    .orderBy('startTime', 'asc')
    .limit(200)
    .get()
    .catch((error) => {
      if (error && /not exist|not found/i.test(error.errMsg || '')) {
        return { data: [] };
      }
      throw error;
    });

  let activities = (snapshot && snapshot.data ? snapshot.data : []).map((item) =>
    decorateActivityRecord({ ...item, _id: item._id })
  );
  activities = activities.filter(Boolean);

  const statusFilter = options && options.status ? normalizeActivityStatus(options.status, '') : '';
  if (statusFilter) {
    activities = activities.filter((item) => item.status === statusFilter);
  }
  if (options && options.includeArchived === false) {
    activities = activities.filter((item) => item.status !== 'archived');
  }

  return { activities };
}

async function createActivity(openid, payload = {}) {
  const admin = await ensureAdmin(openid);
  const normalized = normalizeActivityPayload(payload, { partial: false });
  const now = new Date();
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const {
    startTime,
    endTime,
    perks = [],
    tags = [],
    ...rest
  } = normalized;

  const data = {
    ...rest,
    startTime: startTime || null,
    endTime: endTime || null,
    perks: Array.isArray(perks) ? perks : [],
    tags: Array.isArray(tags) ? tags : [],
    createdAt: now,
    updatedAt: now,
    createdBy: admin._id || openid,
    updatedBy: admin._id || openid
  };

  const result = await collection.add({ data });
  const activityId = result && result._id ? result._id : '';
  const snapshot = activityId
    ? await collection
        .doc(activityId)
        .get()
        .catch(() => null)
    : null;
  const doc = snapshot && snapshot.data ? { ...snapshot.data, _id: activityId } : { ...data, _id: activityId };
  return { activity: decorateActivityRecord(doc) };
}

async function updateActivity(openid, activityId, updates = {}) {
  if (!activityId) {
    throw new Error('缺少活动编号');
  }
  const admin = await ensureAdmin(openid);
  const collection = db.collection(COLLECTIONS.ACTIVITIES);
  const existing = await collection
    .doc(activityId)
    .get()
    .catch(() => null);
  if (!existing || !existing.data) {
    throw new Error('活动不存在或已删除');
  }

  const normalized = normalizeActivityPayload(updates, { partial: true });
  const now = new Date();
  const payload = {
    ...normalized,
    updatedAt: now,
    updatedBy: admin._id || openid
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'startTime')) {
    payload.startTime = payload.startTime || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'endTime')) {
    payload.endTime = payload.endTime || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'perks')) {
    payload.perks = Array.isArray(payload.perks) ? payload.perks : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
    payload.tags = Array.isArray(payload.tags) ? payload.tags : [];
  }

  await collection.doc(activityId).update({ data: payload });
  const snapshot = await collection
    .doc(activityId)
    .get()
    .catch(() => null);
  const doc = snapshot && snapshot.data ? { ...snapshot.data, _id: activityId } : { ...existing.data, ...payload, _id: activityId };
  return { activity: decorateActivityRecord(doc) };
}

function resolveDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch (error) {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    if (value.$date) {
      return resolveDateValue(value.$date);
    }
    if (value.time) {
      return resolveDateValue(value.time);
    }
  }
  return null;
}
