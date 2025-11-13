const cloud = require('wx-server-sdk');

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

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'guild' });

const REQUIRED_GUILD_COLLECTIONS = [
  COLLECTIONS.GUILDS,
  COLLECTIONS.GUILD_MEMBERS,
  COLLECTIONS.GUILD_BATTLES,
  COLLECTIONS.GUILD_CACHE,
  COLLECTIONS.GUILD_EVENT_LOGS,
  COLLECTIONS.GUILD_TICKETS,
  COLLECTIONS.GUILD_RATE_LIMITS
];

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

exports.main = async (event = {}, context = {}) => {
  const service = getGuildService();
  const { OPENID } = cloud.getWXContext();
  const action = typeof event.action === 'string' ? event.action.trim() : 'overview';
  const { memberId: proxyMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const actorId = normalizeMemberId(event.memberId || event.actorId || proxyMemberId || OPENID);
  if (!actorId) {
    throw createError('UNAUTHENTICATED', '缺少身份信息，请重新登录');
  }
  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }
  await ensureGuildCollections();
  try {
    switch (action) {
      case 'overview':
        return service.getOverview(actorId, event);
      case 'listGuilds':
        return service.listGuilds(actorId, event);
      case 'createGuild':
        return service.createGuild(actorId, event);
      case 'joinGuild':
        return service.joinGuild(actorId, event);
      case 'leaveGuild':
        return service.leaveGuild(actorId, event);
      case 'initiateTeamBattle':
        return service.initiateTeamBattle(actorId, event);
      case 'refreshTicket':
        return { actionTicket: await service.issueActionTicket(actorId) };
      default:
        throw createError('UNKNOWN_ACTION', `未知操作：${action}`);
    }
  } catch (error) {
    console.error('[guild] action failed', action, error);
    if (!error || !error.errCode) {
      throw createError('GUILD_ACTION_FAILED', error && error.message ? error.message : '宗门系统异常');
    }
    throw error;
  }
};
