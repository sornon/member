const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS } = require('common-config');
const {
  DEFAULT_GUILD_SETTINGS,
  normalizeGuildSettings,
  FEATURE_TOGGLE_DOC_ID
} = require('system-settings');
const { createProxyHelpers } = require('admin-proxy');
const {
  createGuildService,
  createError,
  GUILD_SCHEMA_VERSION
} = require('./guild-service');
const { ERROR_CODES } = require('./error-codes');

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'guild' });

const REQUIRED_GUILD_COLLECTIONS = [
  COLLECTIONS.GUILDS,
  COLLECTIONS.GUILD_MEMBERS,
  COLLECTIONS.GUILD_TASKS,
  COLLECTIONS.GUILD_BOSS,
  COLLECTIONS.GUILD_LEADERBOARD,
  COLLECTIONS.GUILD_LOGS,
  COLLECTIONS.GUILD_BATTLES,
  COLLECTIONS.GUILD_CACHE,
  COLLECTIONS.GUILD_EVENT_LOGS,
  COLLECTIONS.GUILD_TICKETS,
  COLLECTIONS.GUILD_RATE_LIMITS,
  COLLECTIONS.ERROR_LOGS
];

const ACTION_HANDLER_MAP = Object.freeze({
  create: 'create',
  apply: 'apply',
  approve: 'approve',
  reject: 'reject',
  leave: 'leave',
  kick: 'kick',
  disband: 'disband',
  profile: 'profile',
  donate: 'donate',
  'members.list': 'membersList',
  'logs.list': 'logsList',
  'tasks.list': 'tasksList',
  'tasks.claim': 'tasksClaim',
  'boss.status': 'bossStatus',
  'boss.challenge': 'bossChallenge',
  'boss.rank': 'bossRank',
  getLeaderboard: 'getLeaderboard',
  overview: 'profile',
  listGuilds: 'listGuilds',
  createGuild: 'createGuild',
  joinGuild: 'joinGuild',
  leaveGuild: 'leaveGuild',
  initiateTeamBattle: 'initiateTeamBattle'
});

const CUSTOM_ACTIONS = Object.freeze({
  refreshTicket: async (service, actorId) => ({
    actionTicket: await service.issueActionTicket(actorId)
  })
});

let collectionsReady = false;
let ensuringCollectionsPromise = null;
let serviceInstance = null;

async function loadGuildSettingsFromDatabase() {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.SYSTEM_SETTINGS)
      .doc(FEATURE_TOGGLE_DOC_ID)
      .get();
    const doc = (snapshot && snapshot.data) || {};
    const settings = doc.guildSettings || doc.guild || {};
    const normalized = normalizeGuildSettings({ ...DEFAULT_GUILD_SETTINGS, ...settings });
    if (!doc.guildSettings || doc.guildSettings.schemaVersion !== GUILD_SCHEMA_VERSION) {
      await db
        .collection(COLLECTIONS.SYSTEM_SETTINGS)
        .doc(FEATURE_TOGGLE_DOC_ID)
        .update({
          data: {
            guildSettings: {
              ...normalized,
              schemaVersion: GUILD_SCHEMA_VERSION,
              updatedAt: db.serverDate ? db.serverDate() : new Date()
            }
          }
        })
        .catch(() => {});
    }
    return normalized;
  } catch (error) {
    if (error && /not exist/i.test(error.errMsg || '')) {
      return DEFAULT_GUILD_SETTINGS;
    }
    console.error('[guild] load settings failed', error);
    return DEFAULT_GUILD_SETTINGS;
  }
}

function getGuildService() {
  if (!serviceInstance) {
    serviceInstance = createGuildService({
      db,
      command: _,
      logger: console,
      loadSettings: loadGuildSettingsFromDatabase
    });
  }
  return serviceInstance;
}

function isCollectionMissingError(error) {
  if (!error) {
    return false;
  }
  const message = typeof error.errMsg === 'string' ? error.errMsg.toLowerCase() : '';
  return message.includes('not exist') || message.includes('not found');
}

function isCollectionAlreadyExistsError(error) {
  if (!error) {
    return false;
  }
  const message = typeof error.errMsg === 'string' ? error.errMsg.toLowerCase() : '';
  return message.includes('exists');
}

async function ensureGuildCollections() {
  if (collectionsReady) {
    return;
  }
  if (ensuringCollectionsPromise) {
    return ensuringCollectionsPromise;
  }
  ensuringCollectionsPromise = (async () => {
    try {
      await Promise.all(
        REQUIRED_GUILD_COLLECTIONS.map(async (name) => {
          const exists = await db
            .collection(name)
            .limit(1)
            .get()
            .then(() => true)
            .catch((error) => {
              if (isCollectionMissingError(error)) {
                return false;
              }
              throw error;
            });
          if (!exists) {
            await db.createCollection(name).catch((error) => {
              if (isCollectionAlreadyExistsError(error)) {
                return;
              }
              throw error;
            });
          }
        })
      );
      collectionsReady = true;
    } catch (error) {
      ensuringCollectionsPromise = null;
      throw error;
    }
  })();
  return ensuringCollectionsPromise;
}

function normalizeMemberId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function resolveOptionalActorId(defaultMemberId, event = {}) {
  const fromEvent = normalizeMemberId(event.actorId || event.memberId);
  const fromContext = normalizeMemberId(defaultMemberId);
  return fromEvent || fromContext || null;
}

function resolveActorId(defaultMemberId, event = {}) {
  const resolved = resolveOptionalActorId(defaultMemberId, event);
  if (!resolved) {
    throw createError(ERROR_CODES.UNAUTHENTICATED, '缺少身份信息，请重新登录');
  }
  return resolved;
}

function normalizeActionName(value) {
  if (typeof value !== 'string') {
    return 'profile';
  }
  const trimmed = value.trim();
  return trimmed || 'profile';
}

function buildSummary(action, overrides = {}) {
  const { code = 'SUCCESS', message = '操作成功', ...rest } = overrides || {};
  return { action, code, message, ...rest };
}

function ensureResponseShape(action, result) {
  const payload = result && typeof result === 'object' ? { ...result } : {};
  const summary = payload.summary
    ? { ...buildSummary(action), ...payload.summary }
    : buildSummary(action);
  const updatedAt = payload.updatedAt || new Date().toISOString();
  if (!payload.schemaVersion) {
    payload.schemaVersion = GUILD_SCHEMA_VERSION;
  }
  return { ...payload, summary, updatedAt };
}

function sanitizeEventForLog(event = {}) {
  const clone = { ...event };
  if (typeof clone.ticket === 'string') {
    clone.ticket = `ticket:${crypto.createHash('md5').update(clone.ticket).digest('hex').slice(0, 6)}`;
  }
  if (typeof clone.signature === 'string') {
    clone.signature = `${clone.signature.slice(0, 6)}...`;
  }
  return clone;
}

function sanitizeResultForLog(result = {}) {
  if (!result || typeof result !== 'object') {
    return {};
  }
  const { summary, updatedAt, guild, membership } = result;
  return {
    summary,
    updatedAt,
    guild: guild ? { id: guild.id, name: guild.name } : null,
    membership: membership ? { guildId: membership.guildId, role: membership.role } : null
  };
}

function resolveGuildIdFromResult(result, event = {}) {
  if (result && result.guild && result.guild.id) {
    return result.guild.id;
  }
  if (result && result.membership && result.membership.guildId) {
    return result.membership.guildId;
  }
  if (event && event.guildId) {
    return event.guildId;
  }
  return null;
}

async function recordSuccessLog(service, action, actorId, event, result) {
  const guildId = resolveGuildIdFromResult(result, event);
  const entry = {
    action,
    actorId,
    guildId,
    summary: result.summary || buildSummary(action),
    result: sanitizeResultForLog(result),
    event: sanitizeEventForLog(event)
  };
  await service.recordGuildLog(entry);
}

async function recordErrorLog(service, action, actorId, event, error, openid) {
  const entry = {
    action,
    actorId,
    openid,
    code: error && (error.errCode || error.code) ? error.errCode || error.code : ERROR_CODES.INTERNAL_ERROR,
    message: error && error.message ? error.message : '未知错误',
    stack: error && error.stack ? error.stack : '',
    event: sanitizeEventForLog(event)
  };
  await service.recordErrorLog(entry);
}

function resolveActionHandler(service, action) {
  if (CUSTOM_ACTIONS[action]) {
    return async (actorId, event, context) => CUSTOM_ACTIONS[action](service, actorId, event, context);
  }
  const method = ACTION_HANDLER_MAP[action];
  if (!method) {
    return null;
  }
  if (typeof service[method] !== 'function') {
    return null;
  }
  return async (actorId, event, context) => service[method](actorId, event, context);
}

exports.main = async (event = {}, context = {}) => {
  const service = getGuildService();
  const { OPENID } = cloud.getWXContext();
  const normalizedAction = normalizeActionName(event.action);
  const { memberId: proxyMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const actorId = resolveActorId(proxyMemberId || OPENID, event);
  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, normalizedAction, event || {});
  }
  await ensureGuildCollections();
  try {
    const handler = resolveActionHandler(service, normalizedAction);
    if (!handler) {
      throw createError(ERROR_CODES.UNKNOWN_ACTION, `未知操作：${normalizedAction}`);
    }
    const rawResult = await handler(actorId, event, { context, openid: OPENID });
    const result = ensureResponseShape(normalizedAction, rawResult);
    await recordSuccessLog(service, normalizedAction, actorId, event, result);
    return result;
  } catch (error) {
    console.error('[guild] action failed', normalizedAction, error);
    try {
      await recordErrorLog(service, normalizedAction, actorId, event, error, OPENID);
    } catch (logError) {
      console.warn('[guild] error log failed', logError);
    }
    if (!error || !error.errCode) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, error && error.message ? error.message : '宗门系统异常');
    }
    throw error;
  }
};
