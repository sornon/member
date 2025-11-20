const crypto = require('crypto');
const { COLLECTIONS, DEFAULT_ADMIN_ROLES, normalizeAvatarFrameValue, pickPortraitUrl } = require('common-config');
const {
  clamp,
  resolveCombatStats,
  resolveSpecialStats,
  extractCombatProfile,
  calculateCombatPower,
  DEFAULT_COMBAT_STATS,
  DEFAULT_SPECIAL_STATS
} = require('combat-system');
const { createBattlePayload, decorateBattleReplay } = require('battle-schema');
const {
  normalizeGuildSettings,
  DEFAULT_GUILD_SETTINGS,
  DEFAULT_GUILD_BOSS_SETTINGS,
  FEATURE_TOGGLE_DOC_ID
} = require('system-settings');
const {
  buildSkillLoadout: buildRuntimeSkillLoadout,
  createActorRuntime,
  takeTurn: executeSkillTurn
} = require('skill-engine');
const {
  ACTION_RATE_LIMIT_WINDOWS,
  ACTION_COOLDOWN_WINDOWS,
  ACTION_DAILY_LIMITS,
  DEFAULT_BOSS_ID,
  BOSS_SCHEMA_VERSION,
  BOSS_DAILY_ATTEMPT_LIMIT,
  BOSS_MEMBER_COOLDOWN_MS,
  BOSS_MAX_ROUNDS,
  BOSS_RANK_LIMIT
} = require('./constants');
const { getBossDefinition } = require('./boss-definitions');
const { ERROR_CODES } = require('./error-codes');

const GUILD_SCHEMA_VERSION = 1;
const LEADERBOARD_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_TICKET_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const GUILD_LEADERBOARD_CACHE_SIZE = 200;
const DEFAULT_LEADERBOARD_LIMIT = 50;
const DEFAULT_LEADERBOARD_TYPE = 'power';
const GUILD_LEADERBOARD_TYPES = Object.freeze(['power', 'contribution', 'activity', 'boss']);
const ACTION_LIMIT_MESSAGE = '操作次数已达上限，请稍后再试';
const RISK_ALERT_MESSAGE = '检测到异常高频操作';
function createGuildService(options = {}) {
  const db = options.db;
  const command = options.command;
  /* istanbul ignore if */
  if (!db || !command) {
    throw new Error('GuildService requires db and command');
  }
  const logger = options.logger || console;
  const settingsLoader = typeof options.loadSettings === 'function'
    ? options.loadSettings
    /* istanbul ignore next */
    : async () => DEFAULT_GUILD_SETTINGS;

  let settingsCache = {
    loadedAt: 0,
    settings: normalizeGuildSettings(DEFAULT_GUILD_SETTINGS)
  };

  const bossUpdateLocks = new Map();
  const adminPermissionCache = new Map();

  const ADMIN_PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;
  const ADMIN_ROLES = new Set([...(Array.isArray(DEFAULT_ADMIN_ROLES) ? DEFAULT_ADMIN_ROLES : []), 'superadmin']);

  function withBossUpdateLock(key, handler) {
    const previous = bossUpdateLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => handler());
    const completion = run
      .catch(() => {})
      .finally(() => {
        if (bossUpdateLocks.get(key) === completion) {
          bossUpdateLocks.delete(key);
        }
      });
    bossUpdateLocks.set(key, completion);
    return run;
  }

  function now() {
    return Date.now();
  }

  function serverTimestamp() {
    return db.serverDate ? db.serverDate() : new Date();
  }

  function isoTimestamp() {
    return new Date().toISOString();
  }

  function buildSummary(action, overrides = {}) {
    const { code = 'SUCCESS', message = '操作成功', ...rest } = overrides || {};
    return { action, code, message, ...rest };
  }

  function wrapActionResponse(action, data = {}, summaryOverrides = {}) {
    const baseSummary = buildSummary(action, summaryOverrides);
    const summary = data.summary ? { ...baseSummary, ...data.summary } : baseSummary;
    const updatedAt = data.updatedAt || isoTimestamp();
    return {
      ...data,
      summary,
      updatedAt,
      schemaVersion: data.schemaVersion || GUILD_SCHEMA_VERSION
    };
  }

  function buildPlaceholderResponse(action, payload = {}) {
    return wrapActionResponse(action, { success: false, ...payload }, {
      code: 'NOT_IMPLEMENTED',
      message: '功能开发中，敬请期待'
    });
  }

  async function truncateCollection(name) {
    if (!name || typeof name !== 'string') {
      return 0;
    }
    const collection = db.collection(name);
    try {
      const result = await collection.where({}).remove();
      if (result && typeof result.deleted === 'number') {
        return Math.max(0, result.deleted);
      }
      if (result && result.stats && typeof result.stats.removed === 'number') {
        return Math.max(0, result.stats.removed);
      }
      return 0;
    } catch (error) {
      logger.warn(`[guild] bulk remove failed for ${name}, fallback to batch`, error);
      let removed = 0;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const snapshot = await collection
          .limit(limit)
          .get()
          .catch(() => ({ data: [] }));
        const docs = (snapshot && snapshot.data) || [];
        if (!docs.length) {
          break;
        }
        for (const doc of docs) {
          const docId = doc && (doc._id || doc.id);
          if (!docId) {
            continue;
          }
          /* eslint-disable no-await-in-loop */
          await collection
            .doc(docId)
            .remove()
            .then(() => {
              removed += 1;
            })
            .catch((removeError) => {
              logger.error(`[guild] failed to remove document ${docId} from ${name}`, removeError);
            });
          /* eslint-enable no-await-in-loop */
        }
        hasMore = docs.length >= limit;
      }
      return removed;
    }
  }

  async function truncateCollections(names, { concurrency = 3 } = {}) {
    if (!Array.isArray(names) || !names.length) {
      return [];
    }
    const tasks = names.map((name, index) => ({ name, index }));
    const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
    const results = new Array(names.length);
    let cursor = 0;

    async function worker() {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const index = cursor;
        if (index >= tasks.length) {
          break;
        }
        cursor += 1;
        const task = tasks[index];
        const { name, index: resultIndex } = task;
        if (!name || typeof name !== 'string') {
          results[resultIndex] = { name, deleted: 0 };
          continue;
        }
        /* eslint-disable no-await-in-loop */
        const deleted = await truncateCollection(name).catch((error) => {
          logger.error(`[guild] failed to truncate collection ${name}`, error);
          throw createError(ERROR_CODES.INTERNAL_ERROR, `清空 ${name} 失败`);
        });
        /* eslint-enable no-await-in-loop */
        results[resultIndex] = { name, deleted };
      }
    }

    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async function loadSettings({ force = false } = {}) {
    const ttl = 60 * 1000;
    if (!force && settingsCache.settings && now() - settingsCache.loadedAt < ttl) {
      return settingsCache.settings;
    }
    const loaded = await settingsLoader();
    const normalized = normalizeGuildSettings(loaded);
    settingsCache = { loadedAt: now(), settings: normalized };
    return normalized;
  }

  function sanitizeString(value, { maxLength = 32 } = {}) {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.length > maxLength) {
      return trimmed.slice(0, maxLength);
    }
    return trimmed;
  }

  function resolveMaxMemberPower(settings = {}) {
    const baseEnemyPower = Number(settings.teamBattle && settings.teamBattle.baseEnemyPower);
    if (Number.isFinite(baseEnemyPower) && baseEnemyPower > 0) {
      return Math.max(1000, Math.round(baseEnemyPower * 10));
    }
    return 50000;
  }

  function extractMemberPowerFromDoc(doc = {}) {
    const candidates = [
      doc.combatPower,
      doc.power,
      doc.powerRating,
      doc.powerScore,
      doc.totalPower,
      doc.strength,
      doc.rating,
      doc.attributeSummary && doc.attributeSummary.combatPower,
      doc.attributeSummary && doc.attributeSummary.powerScore,
      doc.attributes && doc.attributes.combatPower,
      doc.attributes && doc.attributes.powerScore,
      doc.profile && doc.profile.combatPower,
      doc.profile && doc.profile.powerRating,
      doc.pveProfile && doc.pveProfile.combatPower,
      doc.pveProfile && doc.pveProfile.powerScore,
      doc.pveProfile && doc.pveProfile.attributeSummary && doc.pveProfile.attributeSummary.combatPower,
      doc.pveProfile && doc.pveProfile.attributeSummary && doc.pveProfile.attributeSummary.powerScore,
      doc.pveProfile && doc.pveProfile.attributes && doc.pveProfile.attributes.combatPower,
      doc.pveProfile && doc.pveProfile.attributes && doc.pveProfile.attributes.powerScore
    ];
    return candidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return numeric;
      }
      return acc;
    }, 0);
  }

  async function resolveMemberPower(memberId, fallbackPower = 0, settings = {}) {
    let derivedPower = 0;
    if (memberId) {
      const snapshot = await db
        .collection(COLLECTIONS.MEMBERS)
        .doc(memberId)
        .get()
        /* istanbul ignore next */
        .catch((error) => {
          if (error && /not exist/i.test(error.errMsg || '')) {
            return null;
          }
          throw error;
        });
      if (snapshot && snapshot.data) {
        derivedPower = extractMemberPowerFromDoc(snapshot.data);
      }
    }
    if (!derivedPower) {
      const fallbackNumeric = Number(fallbackPower);
      if (Number.isFinite(fallbackNumeric) && fallbackNumeric > 0) {
        derivedPower = fallbackNumeric;
      }
    }
    const maxPower = resolveMaxMemberPower(settings);
    const normalized = Math.max(0, Math.round(derivedPower));
    return clamp(normalized, 0, maxPower);
  }

  function buildTicketSignature(ticket, secret) {
    return crypto.createHash('md5').update(`${ticket}:${secret}`).digest('hex');
  }

  function buildTicketDocId(memberId, signature) {
    const hash = crypto.createHash('md5').update(`${memberId}:${signature}`).digest('hex');
    return `ticket_${hash}`;
  }

  async function issueActionTicket(memberId) {
    if (!memberId) {
      throw createError('INVALID_MEMBER', '缺少身份信息');
    }
    const settings = await loadSettings();
    const secret = settings.secret || 'guild_secret';
    const token = crypto.randomBytes(16).toString('hex');
    const signature = buildTicketSignature(token, secret);
    const docId = buildTicketDocId(memberId, signature);
    const expiresAt = new Date(now() + DEFAULT_TICKET_TTL_MS);
      await db
        .collection(COLLECTIONS.GUILD_TICKETS)
        .doc(docId)
        .set({
          data: {
            memberId,
            signature,
            issuedAt: db.serverDate ? db.serverDate() : new Date(),
            expiresAt,
            consumed: false,
            schemaVersion: GUILD_SCHEMA_VERSION
          }
        })
        /* istanbul ignore next */
        .catch((error) => {
          if (error && /exists/i.test(error.errMsg || '')) {
            return db
              .collection(COLLECTIONS.GUILD_TICKETS)
              .doc(docId)
            .update({
              data: {
                memberId,
                signature,
                expiresAt,
                consumed: false,
                updatedAt: db.serverDate ? db.serverDate() : new Date()
              }
            });
        }
        throw error;
      });
    return { ticket: token, signature, expiresAt: expiresAt.toISOString() };
  }

  async function verifyActionTicket(memberId, ticket, providedSignature, options = {}) {
    const { consume = true } = typeof options === 'object' && options !== null ? options : {};
    const settings = await loadSettings();
    const secret = settings.secret || 'guild_secret';
    const normalizedTicket = sanitizeString(ticket, { maxLength: 64 });
    if (!normalizedTicket) {
      throw createError('INVALID_TICKET', '授权无效');
    }
    const signature = buildTicketSignature(normalizedTicket, secret);
    if (providedSignature && providedSignature !== signature) {
      throw createError('INVALID_TICKET_SIGNATURE', '授权验证失败');
    }
    const docId = buildTicketDocId(memberId, signature);
      const snapshot = await db
        .collection(COLLECTIONS.GUILD_TICKETS)
        .doc(docId)
        .get()
        /* istanbul ignore next */
        .catch((error) => {
          if (error && /not exist/i.test(error.errMsg || '')) {
            return null;
          }
          throw error;
      });
    if (!snapshot || !snapshot.data) {
      throw createError('TICKET_NOT_FOUND', '授权不存在或已过期');
    }
    const doc = snapshot.data;
    const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() < now()) {
      throw createError('TICKET_EXPIRED', '授权已过期');
    }
    if (doc.consumed && consume) {
      throw createError('TICKET_CONSUMED', '授权已被使用');
    }
    const usageTimestamp = db.serverDate ? db.serverDate() : new Date();
    const updatePayload = {
      lastUsedAt: usageTimestamp,
      uses: command.inc(1)
    };
    if (consume && !doc.consumed) {
      updatePayload.consumed = true;
      updatePayload.consumedAt = usageTimestamp;
    }
    await db
      .collection(COLLECTIONS.GUILD_TICKETS)
      .doc(docId)
      .update({
        data: updatePayload
      })
      /* istanbul ignore next */
      .catch((error) => logger.warn('[guild] ticket update failed', error));
    return true;
  }

  async function recordEvent(event = {}) {
    try {
      await db.collection(COLLECTIONS.GUILD_EVENT_LOGS).add({
        data: {
          ...event,
          schemaVersion: GUILD_SCHEMA_VERSION,
          createdAt: serverTimestamp()
        }
      });
    }
    /* istanbul ignore next */
    catch (error) {
      logger.warn('[guild] record event failed', error);
    }
  }

  function buildTimeGuardDocId(type, memberId, actionKey) {
    const keySource = `${type}:${memberId}:${actionKey}`;
    return crypto.createHash('md5').update(keySource).digest('hex');
  }

  async function enforceTimeGuard(type, memberId, actionKey, windowMs, code, message) {
    if (!memberId || !actionKey || !windowMs) {
      return;
    }
    const docId = buildTimeGuardDocId(type, memberId, actionKey);
    const collection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
    const nowTs = now();
    const expiresAt = new Date(nowTs + windowMs);
      const existing = await collection
        .doc(docId)
        .get()
        /* istanbul ignore next */
        .catch((error) => {
          if (error && /not exist/i.test(error.errMsg || '')) {
            return null;
          }
          throw error;
      });
    if (existing && existing.data) {
      const lastAt = existing.data.lastTriggeredAt ? new Date(existing.data.lastTriggeredAt) : null;
      if (lastAt && nowTs - lastAt.getTime() < windowMs) {
        throw createError(code, message);
      }
    }
      await collection
        .doc(docId)
        .set({
          data: {
            type,
            memberId,
            action: actionKey,
            lastTriggeredAt: serverTimestamp(),
            expiresAt,
            windowMs,
            schemaVersion: GUILD_SCHEMA_VERSION
          }
        })
        /* istanbul ignore next */
        .catch((error) => {
          if (error && /exists/i.test(error.errMsg || '')) {
            return collection.doc(docId).update({
              data: {
                lastTriggeredAt: serverTimestamp(),
              expiresAt,
              windowMs
            }
          });
        }
        throw error;
      });
  }

  async function enforceRateLimit(memberId, actionKey) {
    const windowMs = ACTION_RATE_LIMIT_WINDOWS[actionKey];
    if (!windowMs) {
      return;
    }
    await enforceTimeGuard('rate', memberId, actionKey, windowMs, 'RATE_LIMITED', '操作过于频繁，请稍后再试');
  }

  async function enforceCooldown(memberId, actionKey) {
    const windowMs = await resolveActionCooldownWindow(actionKey);
    if (!windowMs) {
      return;
    }
    await enforceTimeGuard('cooldown', memberId, actionKey, windowMs, 'ACTION_COOLDOWN', '操作冷却中，请稍后再试');
  }

  function resolveRiskControlSettingsSnapshot(settings = {}) {
    const fallback = DEFAULT_GUILD_SETTINGS.riskControl || {};
    const riskControl = settings && typeof settings === 'object' && settings.riskControl
      ? settings.riskControl
      : fallback;
    const actions = {
      ...(fallback.actions || {}),
      ...((riskControl && riskControl.actions) || {})
    };
    const abuseDetection = {
      ...(fallback.abuseDetection || {}),
      ...((riskControl && riskControl.abuseDetection) || {})
    };
    return {
      enabled: riskControl && typeof riskControl.enabled === 'boolean' ? riskControl.enabled : fallback.enabled !== false,
      loggerTag: riskControl && riskControl.loggerTag ? riskControl.loggerTag : fallback.loggerTag || 'guild',
      actions,
      abuseDetection
    };
  }

  function resolveActionKeyCandidates(actionKey) {
    const normalized = typeof actionKey === 'string' ? actionKey : '';
    switch (normalized) {
      case 'boss.challenge':
      case 'bossChallenge':
        return ['boss.challenge', 'bossChallenge'];
      case 'tasks.claim':
      case 'tasksClaim':
        return ['tasks.claim', 'tasksClaim'];
      default:
        return [normalized];
    }
  }

  async function resolveActionCooldownWindow(actionKey) {
    const candidates = resolveActionKeyCandidates(actionKey);
    const fallbackWindow = candidates.reduce((acc, key) => acc || ACTION_COOLDOWN_WINDOWS[key], 0);
    const settings = await loadSettings();
    const riskControl = resolveRiskControlSettingsSnapshot(settings);
    if (!riskControl.enabled) {
      return fallbackWindow;
    }
    const override = candidates.reduce((acc, key) => {
      if (acc) {
        return acc;
      }
      const config = riskControl.actions && riskControl.actions[key];
      if (config && Number.isFinite(Number(config.cooldownMs)) && Number(config.cooldownMs) > 0) {
        return Math.max(1000, Math.round(Number(config.cooldownMs)));
      }
      return acc;
    }, null);
    return override || fallbackWindow;
  }

  async function resolveActionDailyLimit(actionKey) {
    const candidates = resolveActionKeyCandidates(actionKey);
    const fallbackLimit = candidates.reduce((acc, key) => acc || ACTION_DAILY_LIMITS[key], 0);
    const settings = await loadSettings();
    const riskControl = resolveRiskControlSettingsSnapshot(settings);
    if (!riskControl.enabled) {
      return fallbackLimit || 0;
    }
    const override = candidates.reduce((acc, key) => {
      if (acc != null) {
        return acc;
      }
      const config = riskControl.actions && riskControl.actions[key];
      if (config && Number.isFinite(Number(config.dailyLimit))) {
        return Math.max(0, Math.round(Number(config.dailyLimit)));
      }
      return acc;
    }, null);
    return override != null ? override : fallbackLimit || 0;
  }

  function normalizeGuildIdForKey(guildId) {
    if (typeof guildId !== 'string') {
      return 'global';
    }
    const trimmed = guildId.trim();
    return trimmed || 'global';
  }

  function buildDailyLimitDocId(memberId, actionKey, dateKey, guildId) {
    const memberKey = sanitizeString(memberId, { maxLength: 64 }) || 'unknown';
    const action = sanitizeString(actionKey, { maxLength: 64 }) || 'action';
    const normalizedGuild = normalizeGuildIdForKey(guildId);
    const keySource = `daily:${memberKey}:${normalizedGuild}:${action}:${dateKey}`;
    return crypto.createHash('md5').update(keySource).digest('hex');
  }

  function buildAbuseDocId(memberId, guildId, actionKey) {
    const memberKey = sanitizeString(memberId, { maxLength: 64 }) || 'unknown';
    const action = sanitizeString(actionKey, { maxLength: 64 }) || 'action';
    const normalizedGuild = normalizeGuildIdForKey(guildId);
    const keySource = `abuse:${memberKey}:${normalizedGuild}:${action}`;
    return crypto.createHash('md5').update(keySource).digest('hex');
  }

  function computeDailyLimitExpiresAt(dateKey) {
    if (!dateKey || typeof dateKey !== 'string') {
      return new Date(Date.now() + 48 * 60 * 60 * 1000);
    }
    const base = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      return new Date(Date.now() + 48 * 60 * 60 * 1000);
    }
    return new Date(base.getTime() + 48 * 60 * 60 * 1000);
  }

  async function assertDailyLimit(memberId, actionKey, options = {}) {
    const limit = await resolveActionDailyLimit(actionKey);
    if (!limit) {
      return null;
    }
    const normalizedMemberId = sanitizeString(memberId, { maxLength: 64 });
    if (!normalizedMemberId) {
      return null;
    }
    const normalizedGuild = normalizeGuildIdForKey(options.guildId);
    const todayKey = computeDateKey(new Date());
    const docId = buildDailyLimitDocId(normalizedMemberId, actionKey, todayKey, normalizedGuild);
    const collection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
    const existing = await collection
      .doc(docId)
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    let used = 0;
    if (existing && existing.data && existing.data.dateKey === todayKey) {
      used = Math.max(0, Math.round(Number(existing.data.count || 0)));
      if (used >= limit) {
        await recordSecurityEvent({
          action: `${actionKey}.dailyLimit`,
          actorId: memberId,
          guildId: normalizedGuild === 'global' ? null : normalizedGuild,
          code: ERROR_CODES.ACTION_DAILY_LIMIT,
          message: ACTION_LIMIT_MESSAGE,
          context: { limit, used, action: actionKey }
        });
        throw createError(ERROR_CODES.ACTION_DAILY_LIMIT, ACTION_LIMIT_MESSAGE);
      }
    }
    return {
      docId,
      dateKey: todayKey,
      limit,
      used,
      guildId: normalizedGuild === 'global' ? null : normalizedGuild,
      actionKey,
      memberId
    };
  }

  async function reserveDailyQuota(limitContext) {
    if (!limitContext || !limitContext.docId || !limitContext.limit) {
      return null;
    }
    const { docId, limit, dateKey, guildId, actionKey, memberId } = limitContext;
    const collection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
    const docRef = collection.doc(docId);
    const snapshot = await docRef
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    const expiresAt = computeDailyLimitExpiresAt(dateKey);
    let used = 1;
    const basePayload = {
      limit,
      lastTriggeredAt: serverTimestamp(),
      expiresAt,
      schemaVersion: GUILD_SCHEMA_VERSION
    };
    if (guildId) {
      basePayload.guildId = guildId;
    }

    if (!snapshot || !snapshot.data || snapshot.data.dateKey !== dateKey) {
      const payload = {
        ...basePayload,
        type: 'daily',
        memberId,
        action: actionKey,
        dateKey,
        count: 1
      };
      try {
        await docRef.set({ data: payload });
      } catch (error) {
        if (error && /exists/i.test(error.errMsg || '')) {
          return reserveDailyQuota(limitContext);
        }
        throw error;
      }
    } else {
      const previousCount = Math.max(0, Math.round(Number(snapshot.data.count || 0)));
      used = previousCount + 1;
      if (used > limit) {
        await recordSecurityEvent({
          action: `${actionKey}.dailyLimit`,
          actorId: memberId,
          guildId,
          code: ERROR_CODES.ACTION_DAILY_LIMIT,
          message: ACTION_LIMIT_MESSAGE,
          context: { limit, used: previousCount, action: actionKey }
        });
        throw createError(ERROR_CODES.ACTION_DAILY_LIMIT, ACTION_LIMIT_MESSAGE);
      }
      const updatePayload = {
        ...basePayload
      };
      if (command && typeof command.inc === 'function') {
        updatePayload.count = command.inc(1);
      } else {
        updatePayload.count = used;
      }
      await docRef.update({ data: updatePayload });
    }
    return {
      ...limitContext,
      used,
      remaining: Math.max(0, limit - used)
    };
  }

  function extractGuildPowerValue(doc = {}) {
    const candidates = [
      doc.power,
      doc.powerScore,
      doc.totalPower,
      doc.powerTotal,
      doc.powerRating,
      doc.stats && doc.stats.power,
      doc.stats && doc.stats.powerScore,
      doc.metrics && doc.metrics.power,
      doc.metrics && doc.metrics.powerScore
    ];
    return candidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return Math.max(0, Math.round(numeric));
      }
      return acc;
    }, 0);
  }

  function extractGuildActivityValue(doc = {}) {
    const candidates = [
      doc.activityScore,
      doc.activity,
      doc.activityTotal,
      doc.activityWeek,
      doc.stats && doc.stats.activity,
      doc.stats && doc.stats.activityScore,
      doc.metrics && doc.metrics.activity,
      doc.metrics && doc.metrics.activityScore
    ];
    return candidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return Math.max(0, Math.round(numeric));
      }
      return acc;
    }, 0);
  }

  function decorateGuild(doc = {}) {
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    const memberCount = Number.isFinite(Number(doc.memberCount))
      ? Math.max(0, Math.round(Number(doc.memberCount)))
      : 0;
    return {
      id: doc._id || doc.id || null,
      name: toTrimmedString(doc.name) || '未命名宗门',
      icon: toTrimmedString(doc.icon),
      manifesto: toTrimmedString(doc.manifesto),
      founderId: toTrimmedString(doc.founderId),
      memberCount,
      power: extractGuildPowerValue(doc),
      activityScore: extractGuildActivityValue(doc),
      createdAt: doc.createdAt || null,
      schemaVersion: doc.schemaVersion || GUILD_SCHEMA_VERSION
    };
  }

  async function loadMemberGuild(memberId) {
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ memberId, status: 'active' })
      .limit(1)
      .get();
    const record = snapshot && snapshot.data && snapshot.data[0];
    if (!record) {
      return null;
    }
    const guildSnapshot = await db
      .collection(COLLECTIONS.GUILDS)
      .doc(record.guildId)
      .get()
      /* istanbul ignore next */
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    const guildDoc = guildSnapshot && guildSnapshot.data ? { ...guildSnapshot.data, _id: record.guildId } : { _id: record.guildId };
    return {
      membership: record,
      guild: decorateGuild(guildDoc)
    };
  }

  async function refreshLeaderboardCache(types = GUILD_LEADERBOARD_TYPES) {
    const targetTypes = Array.isArray(types) && types.length ? types.map(resolveLeaderboardType) : GUILD_LEADERBOARD_TYPES;
    let fallbackEntries = [];
    for (let i = 0; i < targetTypes.length; i += 1) {
      const type = targetTypes[i];
      try {
        const snapshot = await updateGuildLeaderboardCache(type, { limit: GUILD_LEADERBOARD_CACHE_SIZE });
        if (!fallbackEntries.length && snapshot && Array.isArray(snapshot.entries)) {
          fallbackEntries = snapshot.entries.slice(0, DEFAULT_LEADERBOARD_LIMIT);
        }
      } catch (error) {
        logger.warn('[guild] refresh leaderboard cache failed', { type, error });
      }
    }
    return fallbackEntries;
  }

  async function loadLeaderboard(options = {}) {
    const { force = false, type = DEFAULT_LEADERBOARD_TYPE, limit = 20 } = options;
    const effectiveLimit = clampLeaderboardLimit(limit);
    const snapshot = await loadLeaderboardSnapshot({
      type,
      limit: GUILD_LEADERBOARD_CACHE_SIZE,
      forceRefresh: force
    });
    return snapshot.entries.slice(0, effectiveLimit);
  }

  function resolveBattleSeed(guildId, difficulty, timestamp = now()) {
    const base = `${guildId}:${difficulty}:${timestamp}`;
    return crypto.createHash('md5').update(base).digest('hex').slice(0, 16);
  }

  function createTeamBattleTimeline(teamMembers, enemyPower, seed) {
    const timeline = [];
    const totalPower = teamMembers.reduce((acc, member) => acc + (member.power || 0), 0);
    const victory = totalPower >= enemyPower;
    const rounds = Math.max(3, Math.min(10, Math.ceil(enemyPower / Math.max(1, totalPower)) + 2));
    let remainingEnemy = enemyPower;
    for (let round = 1; round <= rounds; round += 1) {
      const actions = [];
      teamMembers.forEach((member) => {
        const maxDamage = Math.max(5, Math.floor((member.power || 0) / rounds) + 5);
        const damage = Math.min(maxDamage, Math.max(1, Math.floor((member.power || 0) / 3)));
        remainingEnemy = Math.max(0, remainingEnemy - damage);
        actions.push({
          actorId: member.memberId,
          targetId: 'enemy_boss',
          damage,
          type: 'skill',
          label: member.displayName || '队员',
          remainingEnemy
        });
      });
      timeline.push({ round, actions });
      if (remainingEnemy <= 0) {
        break;
      }
    }
    if (victory && remainingEnemy > 0) {
      remainingEnemy = 0;
    }
    return { timeline, rounds: timeline.length, victory, remainingEnemy };
  }

  function signBattlePayload(payload) {
    const serialized = JSON.stringify(payload);
    return crypto.createHash('md5').update(serialized).digest('hex');
  }

  function buildTeamBattlePayload({ guild, teamMembers, difficulty, seed }) {
    const enemyBase = 1000 + difficulty * 250;
    const enemyPower = clamp(enemyBase, 1000, 100000);
    const { timeline, rounds, victory, remainingEnemy } = createTeamBattleTimeline(
      teamMembers,
      enemyPower,
      seed
    );
    const participants = {
      player: {
        id: guild.id,
        name: guild.name,
        members: teamMembers.map((member) => ({
          id: member.memberId,
          name: member.displayName || '修士',
          power: member.power || 0
        }))
      },
      opponent: {
        id: 'enemy_boss',
        name: `守护灵·${difficulty}`,
        power: enemyPower
      }
    };
    const outcome = {
      result: victory ? 'victory' : 'defeat',
      remaining: {
        enemy: remainingEnemy,
        team: victory ? teamMembers.reduce((acc, member) => acc + (member.power || 0), 0) : 0
      }
    };
    const payload = createBattlePayload({
      battleId: `${guild.id}-${Date.now()}`,
      mode: 'guildRaid',
      seed,
      rounds,
      timeline,
      participants,
      outcome,
      metadata: {
        guildId: guild.id,
        difficulty,
        generatedAt: new Date().toISOString()
      },
      result: {
        winnerId: victory ? guild.id : 'enemy_boss',
        loserId: victory ? 'enemy_boss' : guild.id,
        draw: false
      }
    });
    payload.signature = signBattlePayload(payload);
    return { payload, enemyPower, victory };
  }

  function toTrimmedString(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  function looksLikeUrl(value) {
    const trimmed = toTrimmedString(value);
    if (!trimmed) {
      return false;
    }
    return (
      /^https?:\/\//.test(trimmed) ||
      trimmed.startsWith('cloud://') ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('wxfile://')
    );
  }

  function resolveAvatarFrameValue(...candidates) {
    let fallback = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = toTrimmedString(candidates[i]);
      if (!candidate) {
        continue;
      }
      const normalized = normalizeAvatarFrameValue(candidate);
      if (normalized) {
        return normalized;
      }
      if (looksLikeUrl(candidate)) {
        return candidate;
      }
      if (!fallback) {
        fallback = candidate;
      }
    }
    return fallback;
  }

  function normalizeTitleId(value) {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    return trimmed;
  }

  function normalizeTitleCatalogEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const id = normalizeTitleId(entry.id);
    if (!id) {
      return null;
    }
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
    const imageFile =
      typeof entry.imageFile === 'string' && entry.imageFile.trim()
        ? entry.imageFile.trim()
        : id;
    return { id, name, imageFile };
  }

  function normalizeTitleCatalog(list = []) {
    const seen = new Set();
    const normalizedList = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
      const normalized = normalizeTitleCatalogEntry(item);
      if (!normalized || seen.has(normalized.id)) {
        return;
      }
      seen.add(normalized.id);
      normalizedList.push(normalized);
    });
    return normalizedList;
  }

  function normalizeMemberId(memberId) {
    if (typeof memberId === 'string' && memberId.trim()) {
      return memberId.trim();
    }
    return '';
  }

  function normalizeId(value) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return '';
  }

  function clampLeaderboardLimit(limit) {
    if (!Number.isFinite(Number(limit))) {
      return DEFAULT_LEADERBOARD_LIMIT;
    }
    const numeric = Math.floor(Number(limit));
    if (!Number.isFinite(numeric)) {
      return DEFAULT_LEADERBOARD_LIMIT;
    }
    const bounded = Math.max(1, numeric);
    return Math.min(bounded, GUILD_LEADERBOARD_CACHE_SIZE);
  }

  function resolveLeaderboardType(type) {
    const value = typeof type === 'string' && type.trim() ? type.trim().toLowerCase() : DEFAULT_LEADERBOARD_TYPE;
    if (GUILD_LEADERBOARD_TYPES.includes(value)) {
      return value;
    }
    return DEFAULT_LEADERBOARD_TYPE;
  }

  async function loadDocumentsByIds(collectionName, ids = []) {
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(ids) ? ids : [])
          .map((id) => normalizeId(id))
          .filter(Boolean)
      )
    );
    if (!normalizedIds.length) {
      return new Map();
    }
    const batchSize = 20;
    const tasks = [];
    for (let i = 0; i < normalizedIds.length; i += batchSize) {
      const chunk = normalizedIds.slice(i, i + batchSize);
      tasks.push(
        db
          .collection(collectionName)
          .where({ _id: command.in(chunk) })
          .limit(chunk.length)
          .get()
          .then((snapshot) => (snapshot && snapshot.data ? snapshot.data : []))
          .catch((error) => {
            logger.warn(`[guild] load ${collectionName} failed`, error);
            return [];
          })
      );
    }
    const documents = (await Promise.all(tasks)).flat();
    const map = new Map();
    documents.forEach((doc) => {
      const id = normalizeId(doc._id || doc.id);
      if (id) {
        map.set(id, doc);
      }
    });
    return map;
  }

  function guildLeaderboardSnapshotNeedsRefresh(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return true;
    }
    if (snapshot.schemaVersion !== LEADERBOARD_CACHE_SCHEMA_VERSION) {
      return true;
    }
    if (!Array.isArray(snapshot.entries)) {
      return true;
    }
    return snapshot.entries.some((entry) => {
      if (!entry || typeof entry !== 'object') {
        return true;
      }
      if (!('titleCatalog' in entry) || !Array.isArray(entry.titleCatalog)) {
        return true;
      }
      if (!('avatarFrame' in entry)) {
        return true;
      }
      if (!('guildId' in entry) || !entry.guildId) {
        return true;
      }
      if (!('metricType' in entry)) {
        return true;
      }
      return false;
    });
  }

  function extractMemberContribution(doc = {}) {
    const direct = Number(doc.contribution);
    if (Number.isFinite(direct)) {
      return Math.max(0, Math.round(direct));
    }
    const total = Number(doc.contributionTotal);
    if (Number.isFinite(total)) {
      return Math.max(0, Math.round(total));
    }
    const weekly = Number(doc.contributionWeek);
    if (Number.isFinite(weekly)) {
      return Math.max(0, Math.round(weekly));
    }
    return 0;
  }

  async function loadGuildContributionTotals() {
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ status: 'active' })
      .get()
      .catch(() => ({ data: [] }));
    const totals = new Map();
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId) {
        return;
      }
      const contribution = extractMemberContribution(doc);
      if (!Number.isFinite(contribution)) {
        return;
      }
      const current = totals.get(guildId) || 0;
      totals.set(guildId, current + contribution);
    });
    return totals;
  }

  async function loadGuildBossTotals() {
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_BOSS)
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const map = new Map();
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId) {
        return;
      }
      const totalDamage = Math.max(0, Math.round(Number(doc.totalDamage || 0)));
      const bossId = toTrimmedString(doc.bossId);
      const existing = map.get(guildId);
      if (!existing || totalDamage > existing.totalDamage) {
        map.set(guildId, { totalDamage, bossId });
      }
    });
    return map;
  }

  async function loadGuildLeaderRecords(guildIds = []) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(guildIds) ? guildIds : []).map((id) => normalizeId(id)).filter(Boolean))
    );
    if (!normalizedIds.length) {
      return new Map();
    }
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId: command.in(normalizedIds), role: 'leader', status: 'active' })
      .limit(normalizedIds.length)
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const map = new Map();
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId || map.has(guildId)) {
        return;
      }
      map.set(guildId, {
        guildId,
        memberId: normalizeMemberId(doc.memberId),
        displayName: toTrimmedString(doc.displayName || doc.nickName || ''),
        avatarUrl: toTrimmedString(doc.avatarUrl || ''),
        avatarFrame: toTrimmedString(doc.avatarFrame || doc.appearanceFrame || ''),
        titleCatalog: Array.isArray(doc.titleCatalog) ? doc.titleCatalog : [],
        titleId: normalizeTitleId(doc.titleId || doc.appearanceTitle || ''),
        titleName: toTrimmedString(doc.titleName || doc.appearanceTitleName || '')
      });
    });
    return map;
  }

  async function buildGuildLeaderboardEntries(type, limit) {
    const normalizedType = resolveLeaderboardType(type);
    const effectiveLimit = clampLeaderboardLimit(limit);
    const [contributionTotals, bossTotals] = await Promise.all([
      loadGuildContributionTotals().catch(() => new Map()),
      loadGuildBossTotals().catch(() => new Map())
    ]);
    let baseEntries = [];
    if (normalizedType === 'power' || normalizedType === 'activity') {
      const orderField = normalizedType === 'power' ? 'power' : 'activityScore';
      const snapshot = await db
        .collection(COLLECTIONS.GUILDS)
        .orderBy(orderField, 'desc')
        .limit(effectiveLimit)
        .get()
        .catch(() => ({ data: [] }));
      const docs = snapshot && snapshot.data ? snapshot.data : [];
      baseEntries = docs.map((doc) => {
        const metricValue =
          normalizedType === 'power' ? extractGuildPowerValue(doc) : extractGuildActivityValue(doc);
        return {
          guild: doc,
          metricValue,
          bossInfo: bossTotals.get(normalizeId(doc._id || doc.id)) || { totalDamage: 0, bossId: '' }
        };
      });
    } else if (normalizedType === 'contribution') {
      const snapshot = await db
        .collection(COLLECTIONS.GUILDS)
        .get()
        .catch(() => ({ data: [] }));
      const docs = snapshot && snapshot.data ? snapshot.data : [];
      baseEntries = docs
        .map((doc) => {
          const guildId = normalizeId(doc._id || doc.id);
          if (!guildId) {
            return null;
          }
          return {
            guild: doc,
            metricValue: contributionTotals.get(guildId) || 0,
            bossInfo: bossTotals.get(guildId) || { totalDamage: 0, bossId: '' }
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.metricValue - left.metricValue)
        .slice(0, effectiveLimit);
    } else if (normalizedType === 'boss') {
      const snapshot = await db
        .collection(COLLECTIONS.GUILDS)
        .get()
        .catch(() => ({ data: [] }));
      const docs = snapshot && snapshot.data ? snapshot.data : [];
      const guildMap = new Map(docs.map((doc) => [normalizeId(doc._id || doc.id), doc]));
      const entries = [];
      bossTotals.forEach((info, guildId) => {
        const guildDoc = guildMap.get(guildId);
        if (!guildDoc) {
          return;
        }
        entries.push({ guild: guildDoc, metricValue: info.totalDamage, bossInfo: info });
      });
      baseEntries = entries
        .filter((entry) => Number.isFinite(entry.metricValue) && entry.metricValue > 0)
        .sort((left, right) => right.metricValue - left.metricValue)
        .slice(0, effectiveLimit);
    } else {
      baseEntries = [];
    }
    const guildIds = baseEntries
      .map((entry) => normalizeId(entry.guild && (entry.guild._id || entry.guild.id)))
      .filter(Boolean);
    const leaderMap = await loadGuildLeaderRecords(guildIds);
    const leaderIds = Array.from(
      new Set(
        baseEntries
          .map((entry) => {
            const guildId = normalizeId(entry.guild && (entry.guild._id || entry.guild.id));
            if (!guildId) {
              return '';
            }
            const leaderRecord = leaderMap.get(guildId);
            const fallbackLeaderId =
              (leaderRecord && leaderRecord.memberId) ||
              entry.guild.leaderId ||
              entry.guild.founderId ||
              '';
            return normalizeMemberId(fallbackLeaderId);
          })
          .filter(Boolean)
      )
    );
    const [memberMap, extrasMap] = await Promise.all([
      loadDocumentsByIds(COLLECTIONS.MEMBERS, leaderIds),
      loadDocumentsByIds(COLLECTIONS.MEMBER_EXTRAS, leaderIds)
    ]);
    return baseEntries.map((entry) => {
      const guildDoc = entry.guild || {};
      const guildId = normalizeId(guildDoc._id || guildDoc.id);
      const leaderRecord = leaderMap.get(guildId) || null;
      const fallbackLeaderId =
        (leaderRecord && leaderRecord.memberId) ||
        guildDoc.leaderId ||
        guildDoc.founderId ||
        '';
      const leaderId = normalizeMemberId(fallbackLeaderId);
      const memberDoc = leaderId ? memberMap.get(leaderId) || null : null;
      const extrasDoc = leaderId ? extrasMap.get(leaderId) || null : null;
      const name = toTrimmedString(guildDoc.name) || '未命名宗门';
      const memberCount = Number.isFinite(Number(guildDoc.memberCount))
        ? Math.max(0, Math.round(Number(guildDoc.memberCount)))
        : 0;
      const power = extractGuildPowerValue(guildDoc);
      const activityScore = extractGuildActivityValue(guildDoc);
      const contribution = contributionTotals.get(guildId) || 0;
      const bossInfo = entry.bossInfo || bossTotals.get(guildId) || { totalDamage: 0, bossId: '' };
      const avatarUrl =
        pickPortraitUrl(
          leaderRecord && leaderRecord.avatarUrl,
          memberDoc && memberDoc.avatarUrl,
          memberDoc && memberDoc.portrait,
          extrasDoc && extrasDoc.avatarUrl,
          extrasDoc && extrasDoc.portrait
        ) || '';
      const avatarFrame =
        resolveAvatarFrameValue(
          leaderRecord && leaderRecord.avatarFrame,
          memberDoc && memberDoc.avatarFrame,
          memberDoc && memberDoc.appearanceFrame,
          memberDoc && memberDoc.appearance && memberDoc.appearance.avatarFrame,
          extrasDoc && extrasDoc.avatarFrame
        ) || '';
      const titleCatalogEntries = [];
      if (leaderRecord && Array.isArray(leaderRecord.titleCatalog)) {
        titleCatalogEntries.push(...leaderRecord.titleCatalog);
      }
      if (memberDoc && Array.isArray(memberDoc.titleCatalog)) {
        titleCatalogEntries.push(...memberDoc.titleCatalog);
      }
      if (memberDoc && memberDoc.appearance && Array.isArray(memberDoc.appearance.titleCatalog)) {
        titleCatalogEntries.push(...memberDoc.appearance.titleCatalog);
      }
      if (extrasDoc && Array.isArray(extrasDoc.titleCatalog)) {
        titleCatalogEntries.push(...extrasDoc.titleCatalog);
      }
      if (extrasDoc && extrasDoc.appearance && Array.isArray(extrasDoc.appearance.titleCatalog)) {
        titleCatalogEntries.push(...extrasDoc.appearance.titleCatalog);
      }
      const titleCatalog = normalizeTitleCatalog(titleCatalogEntries);
      let titleId =
        (leaderRecord && leaderRecord.titleId) ||
        (memberDoc && memberDoc.appearanceTitle) ||
        (memberDoc && memberDoc.appearance && memberDoc.appearance.titleId) ||
        (extrasDoc && extrasDoc.appearanceTitle) ||
        (extrasDoc && extrasDoc.appearance && extrasDoc.appearance.titleId) ||
        '';
      let titleName =
        (leaderRecord && leaderRecord.titleName) ||
        (memberDoc && memberDoc.appearanceTitleName) ||
        (memberDoc && memberDoc.appearance && memberDoc.appearance.titleName) ||
        (extrasDoc && extrasDoc.appearanceTitleName) ||
        (extrasDoc && extrasDoc.appearance && extrasDoc.appearance.titleName) ||
        '';
      titleId = normalizeTitleId(titleId);
      titleName = toTrimmedString(titleName);
      if (!titleId && titleCatalog.length) {
        titleId = titleCatalog[0].id;
        titleName = titleName || titleCatalog[0].name;
      }
      const leaderName =
        (leaderRecord && leaderRecord.displayName) ||
        (memberDoc && (memberDoc.nickName || memberDoc.nickname || memberDoc.name)) ||
        `宗主-${guildId || ''}`;
      return {
        guildId,
        id: guildId,
        name,
        icon: toTrimmedString(guildDoc.icon),
        manifesto: toTrimmedString(guildDoc.manifesto),
        memberCount,
        power,
        activityScore,
        contribution,
        bossId: bossInfo && bossInfo.bossId ? bossInfo.bossId : '',
        bossTotalDamage: bossInfo && Number.isFinite(bossInfo.totalDamage) ? bossInfo.totalDamage : 0,
        metricType: normalizedType,
        metricValue: Math.max(0, Math.round(Number(entry.metricValue || 0))),
        leaderId,
        leaderName,
        memberId: leaderId,
        avatarUrl,
        avatarFrame,
        titleId,
        titleName,
        titleCatalog
      };
    });
  }

  async function updateGuildLeaderboardCache(type, { limit = GUILD_LEADERBOARD_CACHE_SIZE } = {}) {
    const normalizedType = resolveLeaderboardType(type);
    const effectiveLimit = clampLeaderboardLimit(limit);
    const entries = await buildGuildLeaderboardEntries(normalizedType, effectiveLimit).catch((error) => {
      logger.warn('[guild] build leaderboard entries failed', error);
      return [];
    });
    const updatedAt = serverTimestamp();
    const payload = {
      type: normalizedType,
      entries,
      updatedAt,
      schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION
    };
    await db
      .collection(COLLECTIONS.GUILD_LEADERBOARD)
      .doc(normalizedType)
      .set({ data: payload })
      .catch(async (error) => {
        if (error && /exists/i.test(error.errMsg || error.message || '')) {
          await db
            .collection(COLLECTIONS.GUILD_LEADERBOARD)
            .doc(normalizedType)
            .update({
              data: {
                entries,
                updatedAt,
                schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION,
                type: normalizedType
              }
            })
            .catch((updateError) => {
              logger.warn('[guild] update leaderboard cache failed', updateError);
            });
        } else {
          throw error;
        }
      });
    return payload;
  }

  async function loadLeaderboardSnapshot({
    type = DEFAULT_LEADERBOARD_TYPE,
    limit = GUILD_LEADERBOARD_CACHE_SIZE,
    forceRefresh = false
  } = {}) {
    const normalizedType = resolveLeaderboardType(type);
    const docId = normalizedType;
    const effectiveLimit = clampLeaderboardLimit(limit);
    if (!forceRefresh) {
      const snapshot = await db
        .collection(COLLECTIONS.GUILD_LEADERBOARD)
        .doc(docId)
        .get()
        .catch(() => null);
      if (snapshot && snapshot.data && !guildLeaderboardSnapshotNeedsRefresh(snapshot.data)) {
        const doc = snapshot.data;
        const updatedAtDate = doc.updatedAt ? new Date(doc.updatedAt) : null;
        if (!updatedAtDate || Number.isNaN(updatedAtDate.getTime())) {
          return {
            ...doc,
            entries: Array.isArray(doc.entries) ? doc.entries.slice(0, effectiveLimit) : []
          };
        }
        const settings = await loadSettings();
        const ttl = settings.leaderboardCacheTtlMs || DEFAULT_LEADERBOARD_CACHE_TTL_MS;
        if (now() - updatedAtDate.getTime() <= ttl) {
          return {
            ...doc,
            entries: Array.isArray(doc.entries) ? doc.entries.slice(0, effectiveLimit) : []
          };
        }
      }
    }
    await updateGuildLeaderboardCache(normalizedType, { limit: GUILD_LEADERBOARD_CACHE_SIZE });
    const refreshed = await db
      .collection(COLLECTIONS.GUILD_LEADERBOARD)
      .doc(docId)
      .get()
      .catch(() => null);
    if (refreshed && refreshed.data) {
      return {
        ...refreshed.data,
        entries: Array.isArray(refreshed.data.entries)
          ? refreshed.data.entries.slice(0, effectiveLimit)
          : []
      };
    }
    return {
      _id: docId,
      type: normalizedType,
      entries: [],
      updatedAt: null,
      schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION
    };
  }

  function hashSeed(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createRandomGenerator(seed) {
    const hashedSeed = hashSeed(String(seed || now()));
    let state = hashedSeed;
    const generator = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    generator.seedValue = hashedSeed;
    return generator;
  }

  function buildBossSeed(bossId, memberId, timestamp = now()) {
    const key = `${bossId}:${memberId}`;
    return `${key}:${timestamp}`;
  }

  function deriveBossBattleIdentity(guildId, bossId, seed) {
    const guildKey = toTrimmedString(guildId) || 'guild';
    const bossKey = toTrimmedString(bossId) || 'boss';
    const seedKey = typeof seed === 'string' && seed ? seed : String(seed || 'seed');
    const basis = `${guildKey}:${bossKey}:${seedKey}`;
    const hash = crypto.createHash('md5').update(basis).digest('hex');
    const suffix = hash.slice(0, 12);
    const timeSlice = hash.slice(12, 24);
    const baseEpoch = Date.UTC(2024, 0, 1);
    const offset = Number.parseInt(timeSlice, 16) % (365 * 24 * 60 * 60 * 1000);
    const startedAt = new Date(baseEpoch + offset).toISOString();
    const battleId = `${guildKey}:${bossKey}:${suffix}`;
    return { battleId, startedAt };
  }

  function buildCombatAttributesSnapshot(stats = {}) {
    const keys = [
      'maxHp',
      'physicalAttack',
      'magicAttack',
      'physicalDefense',
      'magicDefense',
      'speed',
      'accuracy',
      'dodge',
      'critRate',
      'critDamage',
      'critResist',
      'finalDamageBonus',
      'finalDamageReduction',
      'lifeSteal',
      'healingBonus',
      'healingReduction',
      'controlHit',
      'controlResist',
      'physicalPenetration',
      'magicPenetration',
      'comboRate',
      'block',
      'counterRate',
      'damageReduction',
      'healingReceived',
      'rageGain',
      'controlStrength',
      'shieldPower',
      'summonPower',
      'elementalVulnerability'
    ];
    const snapshot = {};
    keys.forEach((key) => {
      if (typeof stats[key] === 'number' && !Number.isNaN(stats[key])) {
        snapshot[key] = Number(stats[key]);
      }
    });
    return snapshot;
  }

  function normalizeControlRuntimeSnapshot(runtime) {
    const base = {
      effects: [],
      skip: false,
      disableBasic: false,
      disableActive: false,
      disableDodge: false,
      remainingTurns: 0,
      remainingByEffect: {},
      summaries: {},
      active: false
    };
    if (!runtime || typeof runtime !== 'object') {
      return base;
    }
    const effects = Array.isArray(runtime.effects)
      ? runtime.effects.map((effect) => (typeof effect === 'string' ? effect.trim().toLowerCase() : '')).filter(Boolean)
      : [];
    const sourceRemaining = runtime.remainingByEffect && typeof runtime.remainingByEffect === 'object'
      ? runtime.remainingByEffect
      : {};
    const sourceSummaries = runtime.summaries && typeof runtime.summaries === 'object' ? runtime.summaries : {};
    const remainingByEffect = effects.reduce((acc, effect) => {
      const value = Number(sourceRemaining[effect]);
      if (Number.isFinite(value)) {
        acc[effect] = Math.max(0, Math.round(value));
      }
      return acc;
    }, {});
    const summaries = effects.reduce((acc, effect) => {
      const summary = sourceSummaries[effect];
      if (typeof summary === 'string' && summary.trim()) {
        acc[effect] = summary.trim();
      }
      return acc;
    }, {});
    const remainingTurns = Number.isFinite(Number(runtime.remainingTurns))
      ? Math.max(0, Math.round(Number(runtime.remainingTurns)))
      : 0;
    const active =
      typeof runtime.active === 'boolean'
        ? runtime.active
        : effects.length > 0 || runtime.skip || runtime.disableBasic || runtime.disableActive || runtime.disableDodge || remainingTurns > 0;
    return {
      effects,
      skip: !!runtime.skip,
      disableBasic: !!runtime.disableBasic,
      disableActive: !!runtime.disableActive,
      disableDodge: !!runtime.disableDodge,
      remainingTurns,
      remainingByEffect,
      summaries,
      active
    };
  }

  function cloneControlSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return {
        effects: [],
        skip: false,
        disableBasic: false,
        disableActive: false,
        disableDodge: false,
        remainingTurns: 0,
        remainingByEffect: {},
        summaries: {},
        active: false
      };
    }
    return {
      effects: Array.isArray(snapshot.effects) ? snapshot.effects.slice() : [],
      skip: !!snapshot.skip,
      disableBasic: !!snapshot.disableBasic,
      disableActive: !!snapshot.disableActive,
      disableDodge: !!snapshot.disableDodge,
      remainingTurns: Number(snapshot.remainingTurns) || 0,
      remainingByEffect: { ...(snapshot.remainingByEffect || {}) },
      summaries: { ...(snapshot.summaries || {}) },
      active: !!snapshot.active
    };
  }

  function captureControlSnapshot(actor) {
    if (!actor || !actor.controlRuntime) {
      return normalizeControlRuntimeSnapshot();
    }
    return normalizeControlRuntimeSnapshot(actor.controlRuntime);
  }

  function extractChangedAttributes(current, previous) {
    if (!current || typeof current !== 'object') {
      return {};
    }
    const previousAttributes = previous && typeof previous === 'object' ? previous : null;
    const changed = {};
    const keys = Object.keys(current);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = current[key];
      const previousValue = previousAttributes ? previousAttributes[key] : undefined;
      if (typeof value === 'number') {
        if (!Number.isFinite(previousValue) || Number(value) !== Number(previousValue)) {
          changed[key] = Number(value);
        }
      } else if (value !== undefined && value !== previousValue) {
        changed[key] = value;
      }
    }
    return changed;
  }

  function buildTimelineStateSide({ before, after, maxHp, attributes, previousAttributes, controlBefore, controlAfter }) {
    const max = Math.max(1, Math.round(maxHp || 1));
    const beforeValue = Number.isFinite(before) ? before : max;
    const afterValue = Number.isFinite(after) ? after : Math.min(beforeValue, max);
    const beforeHp = Math.max(0, Math.round(Math.min(beforeValue, max)));
    const afterHp = Math.max(0, Math.round(Math.min(afterValue, max)));
    const shieldBefore = Math.max(0, Math.round(beforeValue - max));
    const shieldAfter = Math.max(0, Math.round(afterValue - max));
    const changedAttributes = extractChangedAttributes(attributes, previousAttributes);
    const state = {
      hp: {
        before: beforeHp,
        after: afterHp,
        max
      },
      attributes: changedAttributes
    };
    if (shieldBefore > 0 || shieldAfter > 0) {
      state.shield = {
        before: shieldBefore,
        after: shieldAfter
      };
    }
    const hasControlBefore = controlBefore && (controlBefore.active || (controlBefore.effects || []).length);
    const hasControlAfter = controlAfter && (controlAfter.active || (controlAfter.effects || []).length);
    if (hasControlBefore || hasControlAfter) {
      state.control = {
        before: cloneControlSnapshot(controlBefore),
        after: cloneControlSnapshot(controlAfter)
      };
    }
    return state;
  }

  function buildTimelineSkillPayload(skill) {
    const fallback = { id: 'basic_attack', name: '普攻', type: 'basic' };
    if (!skill || typeof skill !== 'object') {
      return { ...fallback };
    }
    const id = toTrimmedString(skill.id) || fallback.id;
    const name = toTrimmedString(skill.name) || fallback.name;
    const type = toTrimmedString(skill.type) || fallback.type;
    const payload = { id, name, type };
    const animation = toTrimmedString(skill.animation);
    if (animation) {
      payload.animation = animation;
    }
    if (skill.resource && typeof skill.resource === 'object') {
      const resource = {};
      const resourceType = toTrimmedString(skill.resource.type);
      if (resourceType) {
        resource.type = resourceType;
      }
      const cost = Number(skill.resource.cost);
      if (Number.isFinite(cost)) {
        resource.cost = Math.max(0, Math.round(cost));
      }
      if (Object.keys(resource).length) {
        payload.resource = resource;
      }
    }
    if (skill.quality || skill.skillQuality || skill.rarity) {
      const quality = toTrimmedString(skill.quality || skill.skillQuality || skill.rarity);
      if (quality) {
        payload.quality = quality;
        payload.skillQuality = quality;
        payload.rarity = quality;
      }
    }
    if (skill.qualityLabel || skill.rarityLabel) {
      const label = toTrimmedString(skill.qualityLabel || skill.rarityLabel);
      if (label) {
        payload.qualityLabel = label;
        payload.rarityLabel = label;
      }
    }
    if (skill.qualityColor || skill.rarityColor) {
      const color = toTrimmedString(skill.qualityColor || skill.rarityColor);
      if (color) {
        payload.qualityColor = color;
        payload.rarityColor = color;
      }
    }
    return payload;
  }

  function buildBossTimelineEntry({
    round,
    sequence,
    actorId,
    actorName,
    actorSide,
    targetId,
    targetName,
    events,
    skill,
    before,
    after,
    actorMaxHp,
    targetMaxHp,
    actorAttributes,
    targetAttributes,
    previousAttributes,
    controlBefore,
    controlAfter,
    summaryText
  }) {
    const isGuildActor = actorSide === 'guild';
    const entry = {
      id: `round-${round}-action-${sequence}`,
      round,
      sequence,
      actorId,
      actorSide: isGuildActor ? 'player' : 'opponent',
      actor: { id: actorId, side: isGuildActor ? 'player' : 'opponent', displayName: actorName },
      target: { id: targetId, side: isGuildActor ? 'opponent' : 'player', displayName: targetName },
      skill: buildTimelineSkillPayload(skill),
      events: Array.isArray(events) ? events.filter(Boolean) : [],
      state: {
        player: buildTimelineStateSide({
          before: isGuildActor ? before.actor : before.target,
          after: isGuildActor ? after.actor : after.target,
          maxHp: isGuildActor ? actorMaxHp : targetMaxHp,
          attributes: isGuildActor ? actorAttributes : targetAttributes,
          previousAttributes: previousAttributes ? previousAttributes.actor : null,
          controlBefore: controlBefore ? controlBefore.actor : null,
          controlAfter: controlAfter ? controlAfter.actor : null
        }),
        opponent: buildTimelineStateSide({
          before: isGuildActor ? before.target : before.actor,
          after: isGuildActor ? after.target : after.actor,
          maxHp: isGuildActor ? targetMaxHp : actorMaxHp,
          attributes: isGuildActor ? targetAttributes : actorAttributes,
          previousAttributes: previousAttributes ? previousAttributes.target : null,
          controlBefore: controlBefore ? controlBefore.target : null,
          controlAfter: controlAfter ? controlAfter.target : null
        })
      }
    };
    if (summaryText) {
      entry.summary = {
        title: `第${round}回合`,
        text: summaryText
      };
    }
    return entry;
  }

  function computeDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function normalizeBossDefinition(definition = {}) {
    const id = toTrimmedString(definition.id) || DEFAULT_BOSS_ID;
    const name = toTrimmedString(definition.name) || '宗门试炼';
    const level = Number.isFinite(Number(definition.level)) ? Math.max(1, Math.round(Number(definition.level))) : 1;
    const baseHp = Number.isFinite(Number(definition.hp))
      ? Math.max(1000, Math.round(Number(definition.hp)))
      : Number.isFinite(Number(definition.stats && definition.stats.maxHp))
      ? Math.max(1000, Math.round(Number(definition.stats.maxHp)))
      : 50000;
    const stats = resolveCombatStats(definition.stats || {}, {
      defaults: DEFAULT_COMBAT_STATS,
      convertLegacyPercentages: true
    });
    const special = resolveSpecialStats(definition.special || {}, {
      defaults: DEFAULT_SPECIAL_STATS,
      convertLegacyPercentages: true
    });
    const skills = Array.isArray(definition.skills)
      ? definition.skills
          .map((skill) => {
            if (!skill || typeof skill !== 'object') {
              return null;
            }
            const skillId = toTrimmedString(skill.id);
            if (!skillId) {
              return null;
            }
            const levelValue = Number.isFinite(Number(skill.level))
              ? Math.max(1, Math.round(Number(skill.level)))
              : 1;
            return { id: skillId, level: levelValue };
          })
          .filter(Boolean)
      : [];
    const phases = Array.isArray(definition.phases)
      ? definition.phases
          .map((phase, index) => {
            if (!phase || typeof phase !== 'object') {
              return null;
            }
            const threshold = Number(phase.threshold);
            if (!Number.isFinite(threshold)) {
              return null;
            }
            const effect = phase.effect && typeof phase.effect === 'object' ? { ...phase.effect } : {};
            const summary = toTrimmedString(effect.summary) || `阶段${index + 1}`;
            return {
              threshold: Math.min(0.99, Math.max(0, threshold)),
              effect,
              summary
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.threshold - a.threshold)
      : [];
    const enraged = definition.enraged && typeof definition.enraged === 'object'
      ? {
          threshold: Math.min(0.99, Math.max(0, Number(definition.enraged.threshold || 0.15))),
          bonus: { ...(definition.enraged.bonus || {}) },
          summary: toTrimmedString(definition.enraged.summary) || 'Boss进入暴怒状态'
        }
      : null;
    return {
      id,
      name,
      level,
      element: toTrimmedString(definition.element) || '',
      description: toTrimmedString(definition.description) || '',
      hp: baseHp,
      stats,
      special,
      skills,
      phases,
      enraged
    };
  }

  function resolveBossSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const fallback = DEFAULT_GUILD_BOSS_SETTINGS;
    return {
      enabled: source.enabled !== undefined ? !!source.enabled : fallback.enabled,
      dailyAttempts: Number.isFinite(Number(source.dailyAttempts))
        ? Math.max(1, Math.round(Number(source.dailyAttempts)))
        : fallback.dailyAttempts,
      cooldownMs: Number.isFinite(Number(source.cooldownMs))
        ? Math.max(10 * 1000, Math.round(Number(source.cooldownMs)))
        : fallback.cooldownMs,
      maxRounds: Number.isFinite(Number(source.maxRounds))
        ? Math.max(5, Math.round(Number(source.maxRounds)))
        : fallback.maxRounds,
      rotation: Array.isArray(source.rotation) && source.rotation.length ? source.rotation.slice() : fallback.rotation.slice()
    };
  }

  function buildBossActor(definition, bossState) {
    const skillState = { equipped: Array.isArray(definition.skills) ? definition.skills : [] };
    const bossActor = createActorRuntime({
      id: definition.id,
      name: definition.name,
      side: 'opponent',
      combatant: { stats: definition.stats, special: definition.special },
      skills: buildRuntimeSkillLoadout(skillState, { includeBasic: true }),
      mode: 'pve'
    });
    bossActor.displayName = definition.name;
    bossActor.attributesSnapshot = buildCombatAttributesSnapshot(bossActor.stats);
    bossActor.maxHp = Math.max(bossActor.maxHp || 1, definition.hp);
    const storedHp = Number.isFinite(Number(bossState.hpLeft)) ? Math.max(0, Math.round(Number(bossState.hpLeft))) : bossActor.maxHp;
    bossActor.hp = Math.min(bossActor.maxHp, storedHp);
    return bossActor;
  }

  function buildPartyActor(memberDoc, membershipDoc) {
    const profile = memberDoc && memberDoc.pveProfile && typeof memberDoc.pveProfile === 'object' ? memberDoc.pveProfile : {};
    const attributeSummary = profile.attributeSummary && typeof profile.attributeSummary === 'object' ? profile.attributeSummary : {};
    const enrichedProfile = { ...profile, attributeSummary };
    const combatProfile = extractCombatProfile(enrichedProfile, {
      defaults: DEFAULT_COMBAT_STATS,
      convertLegacyPercentages: true
    });
    const skillLoadout = buildRuntimeSkillLoadout(profile.skills || {}, { includeBasic: true });
    const memberId = toTrimmedString(membershipDoc.memberId) || toTrimmedString(memberDoc._id) || toTrimmedString(memberDoc.id);
    const actor = createActorRuntime({
      id: memberId || `member_${Date.now()}`,
      name:
        toTrimmedString(memberDoc.nickName) ||
        toTrimmedString(memberDoc.nickname) ||
        toTrimmedString(profile.displayName) ||
        '宗门弟子',
      side: 'player',
      combatant: { stats: combatProfile.stats, special: combatProfile.special },
      skills: skillLoadout,
      mode: 'pve'
    });
    actor.memberId = memberId;
    actor.displayName = actor.name;
    actor.guildRole = membershipDoc.role || 'member';
    actor.combatPower = Number.isFinite(combatProfile.combatPower)
      ? Math.max(0, Math.round(combatProfile.combatPower))
      : Math.max(0, Math.round(calculateCombatPower(actor.stats, actor.special)));
    actor.attributesSnapshot = buildCombatAttributesSnapshot(actor.stats);
    actor.originHp = Math.max(0, Math.round(actor.hp));
    return actor;
  }

  function determineBossRoundOrder(partyActors, bossActor, rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    const participants = [];
    partyActors.forEach((actor) => {
      if (actor && actor.hp > 0) {
        participants.push(actor);
      }
    });
    if (bossActor && bossActor.hp > 0) {
      participants.push(bossActor);
    }
    return participants.sort((left, right) => {
      const leftSpeed = Number(left.stats && left.stats.speed) + Number(left.special && left.special.speedBonus || 0);
      const rightSpeed = Number(right.stats && right.stats.speed) + Number(right.special && right.special.speedBonus || 0);
      if (leftSpeed === rightSpeed) {
        return random() - 0.5;
      }
      return rightSpeed - leftSpeed;
    });
  }

  function selectBossTarget(partyActors, rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    const living = partyActors.filter((actor) => actor && actor.hp > 0);
    if (!living.length) {
      return null;
    }
    const index = Math.min(living.length - 1, Math.floor(random() * living.length));
    return living[index];
  }

  function applyBossPhaseEffects({ bossActor, definition, phaseState, events }) {
    if (!bossActor || bossActor.maxHp <= 0) {
      return;
    }
    const hpRatio = bossActor.hp <= 0 ? 0 : bossActor.hp / bossActor.maxHp;
    const phases = Array.isArray(definition.phases) ? definition.phases : [];
    if (!phaseState.triggered) {
      phaseState.triggered = new Set();
    }
    if (!phaseState.events) {
      phaseState.events = [];
    }
    phases.forEach((phase, index) => {
      if (phaseState.triggered.has(index)) {
        return;
      }
      if (hpRatio > phase.threshold) {
        return;
      }
      phaseState.triggered.add(index);
      const effect = phase.effect || {};
      const summary = toTrimmedString(effect.summary) || `阶段${index + 1}`;
      const eventPayload = { phase: index + 1, summary, threshold: phase.threshold };
      if (effect.type === 'shield') {
        const amountPercent = Number.isFinite(Number(effect.amountPercent)) ? Math.max(0, Number(effect.amountPercent)) : 0.12;
        const shieldValue = Math.max(0, Math.round(bossActor.maxHp * amountPercent));
        bossActor.hp = Math.min(bossActor.maxHp, bossActor.hp + shieldValue);
        eventPayload.shield = shieldValue;
      }
      if (effect.bonus && typeof effect.bonus === 'object') {
        const bonus = effect.bonus;
        if (Number.isFinite(Number(bonus.finalDamageBonus))) {
          bossActor.stats.finalDamageBonus = clamp(
            (bossActor.stats.finalDamageBonus || 0) + Number(bonus.finalDamageBonus),
            -0.9,
            2
          );
        }
        if (Number.isFinite(Number(bonus.finalDamageReduction))) {
          bossActor.stats.finalDamageReduction = clamp(
            (bossActor.stats.finalDamageReduction || 0) + Number(bonus.finalDamageReduction),
            0,
            0.9
          );
        }
        if (Number.isFinite(Number(bonus.speed))) {
          bossActor.stats.speed = (bossActor.stats.speed || 0) + Number(bonus.speed);
        }
        if (Number.isFinite(Number(bonus.accuracy))) {
          bossActor.stats.accuracy = (bossActor.stats.accuracy || 0) + Number(bonus.accuracy);
        }
        if (Number.isFinite(Number(bonus.healingBonus))) {
          bossActor.stats.healingBonus = (bossActor.stats.healingBonus || 0) + Number(bonus.healingBonus);
        }
      }
      bossActor.attributesSnapshot = buildCombatAttributesSnapshot(bossActor.stats);
      phaseState.events.push(eventPayload);
      if (Array.isArray(events)) {
        events.push({ type: 'phase', summary });
      }
    });
    if (definition.enraged && !phaseState.enraged) {
      const threshold = Number.isFinite(Number(definition.enraged.threshold))
        ? Math.max(0, Number(definition.enraged.threshold))
        : 0.1;
      if (hpRatio <= threshold) {
        const bonus = definition.enraged.bonus || {};
        if (Number.isFinite(Number(bonus.finalDamageBonus))) {
          bossActor.stats.finalDamageBonus = clamp(
            (bossActor.stats.finalDamageBonus || 0) + Number(bonus.finalDamageBonus),
            -0.9,
            2
          );
        }
        if (Number.isFinite(Number(bonus.finalDamageReduction))) {
          bossActor.stats.finalDamageReduction = clamp(
            (bossActor.stats.finalDamageReduction || 0) + Number(bonus.finalDamageReduction),
            0,
            0.9
          );
        }
        if (Number.isFinite(Number(bonus.speed))) {
          bossActor.stats.speed = (bossActor.stats.speed || 0) + Number(bonus.speed);
        }
        if (Number.isFinite(Number(bonus.accuracy))) {
          bossActor.stats.accuracy = (bossActor.stats.accuracy || 0) + Number(bonus.accuracy);
        }
        bossActor.attributesSnapshot = buildCombatAttributesSnapshot(bossActor.stats);
        phaseState.enraged = true;
        const summary = toTrimmedString(definition.enraged.summary) || 'Boss进入暴怒状态';
        phaseState.events.push({ phase: 'enrage', summary, threshold });
        if (Array.isArray(events)) {
          events.push({ type: 'phase', summary });
        }
      }
    }
  }

  function simulateBossBattle({ guild, bossDefinition, bossState, partyMembers, seed, maxRounds }) {
    const definition = normalizeBossDefinition(bossDefinition);
    const bossActor = buildBossActor(definition, bossState);
    const partyActors = partyMembers.map((entry) => buildPartyActor(entry.member, entry.membership));
    const rng = createRandomGenerator(seed);
    const timeline = [];
    const phaseState = { triggered: new Set(), events: [], enraged: false };
    const damageByMember = {};
    const maxRoundLimit = Number.isFinite(Number(maxRounds)) ? Math.max(5, Math.round(Number(maxRounds))) : BOSS_MAX_ROUNDS;
    let round = 1;
    while (round <= maxRoundLimit && bossActor.hp > 0 && partyActors.some((actor) => actor.hp > 0)) {
      const order = determineBossRoundOrder(partyActors, bossActor, rng);
      let sequence = 1;
      for (let i = 0; i < order.length; i += 1) {
        const actor = order[i];
        if (!actor || actor.hp <= 0) {
          continue;
        }
        if (bossActor.hp <= 0) {
          break;
        }
        const isBoss = actor === bossActor;
        const target = isBoss ? selectBossTarget(partyActors, rng) : bossActor;
        if (!target || target.hp <= 0) {
          continue;
        }
        const before = { actor: actor.hp, target: target.hp };
        const controlBefore = { actor: captureControlSnapshot(actor), target: captureControlSnapshot(target) };
        const turnResult = executeSkillTurn({ actor, opponent: target, rng });
        const after = { actor: actor.hp, target: target.hp };
        const controlAfter = { actor: captureControlSnapshot(actor), target: captureControlSnapshot(target) };
        const events = [];
        if (Array.isArray(turnResult.preEvents)) {
          events.push(...turnResult.preEvents);
        }
        if (Array.isArray(turnResult.events)) {
          events.push(...turnResult.events);
        }
        const summaryParts = Array.isArray(turnResult.summary) ? turnResult.summary : [];
        const summaryText = summaryParts.length ? summaryParts.join('；') : `${actor.name || '战斗者'}发动了攻势`;
        const entry = buildBossTimelineEntry({
          round,
          sequence,
          actorId: actor.id,
          actorName: actor.name,
          actorSide: isBoss ? 'boss' : 'guild',
          targetId: target.id,
          targetName: target.name,
          events,
          skill: turnResult.skill,
          before,
          after,
          actorMaxHp: actor.maxHp,
          targetMaxHp: target.maxHp,
          actorAttributes: actor.attributesSnapshot || buildCombatAttributesSnapshot(actor.stats),
          targetAttributes: target.attributesSnapshot || buildCombatAttributesSnapshot(target.stats),
          previousAttributes: {
            actor: actor.previousAttributes || null,
            target: target.previousAttributes || null
          },
          controlBefore,
          controlAfter,
          summaryText
        });
        timeline.push(entry);
        actor.previousAttributes = actor.attributesSnapshot;
        target.previousAttributes = target.attributesSnapshot;
        if (!isBoss) {
          const damage = Math.max(0, Math.round(turnResult.totalDamage || 0));
          damageByMember[actor.memberId] = (damageByMember[actor.memberId] || 0) + damage;
          applyBossPhaseEffects({ bossActor, definition, phaseState, events });
          if (bossActor.hp <= 0) {
            break;
          }
        }
        sequence += 1;
      }
      round += 1;
    }
    const victory = bossActor.hp <= 0;
    const roundsCompleted = timeline.length ? timeline[timeline.length - 1].round || timeline.length : 0;
    const winnerId = victory ? guild.id : definition.id;
    const loserId = victory ? definition.id : guild.id;
    const outcome = {
      result: victory ? 'victory' : 'defeat',
      winnerId,
      loserId,
      draw: false,
      rounds: roundsCompleted,
      remaining: {
        bossHp: Math.max(0, Math.round(bossActor.hp)),
        guildHp: partyActors.reduce(
          (acc, actor) => acc + Math.max(0, Math.round(Math.min(actor.hp, actor.maxHp))),
          0
        )
      }
    };
    const participants = {
      player: {
        id: guild.id,
        name: guild.name,
        members: partyActors.map((actor) => ({
          id: actor.memberId,
          memberId: actor.memberId,
          name: actor.displayName,
          role: actor.guildRole,
          hp: {
            current: Math.max(0, Math.round(Math.min(actor.hp, actor.maxHp))),
            max: Math.round(actor.maxHp)
          },
          combatPower: actor.combatPower,
          attributes: actor.attributesSnapshot
        }))
      },
      opponent: {
        id: definition.id,
        name: definition.name,
        level: definition.level,
        element: definition.element || '',
        hp: {
          current: Math.max(0, Math.round(Math.min(bossActor.hp, bossActor.maxHp))),
          max: Math.round(bossActor.maxHp)
        },
        attributes: bossActor.attributesSnapshot
      }
    };
    const identity = deriveBossBattleIdentity(guild.id, definition.id, seed);
    const metadata = {
      guildId: guild.id,
      bossId: definition.id,
      bossLevel: definition.level,
      seed,
      phaseEvents: phaseState.events,
      party: partyActors.map((actor) => ({ memberId: actor.memberId, name: actor.displayName, role: actor.guildRole })),
      startedAt: identity.startedAt,
      maxRounds: maxRoundLimit
    };
    const battleId = identity.battleId;
    const payload = createBattlePayload({
      battleId,
      mode: 'guildBoss',
      seed,
      rounds: outcome.rounds,
      timeline,
      participants,
      outcome,
      metadata,
      result: { winnerId, loserId, draw: false }
    });
    payload.signature = signBattlePayload(payload);
    const replay = decorateBattleReplay(payload, { defaultMode: 'guildBoss' });
    payload.replay = replay;
    return {
      payload,
      replay,
      victory,
      bossActor,
      partyActors,
      damageByMember,
      phaseEvents: phaseState.events,
      rounds: roundsCompleted
    };
  }

  function normalizeBossState(doc, definition) {
    const hpMax = Math.max(1, Math.round(Number(doc && doc.hpMax ? doc.hpMax : definition.hp)));
    const hpLeft = Math.max(0, Math.min(hpMax, Math.round(Number(doc && doc.hpLeft ? doc.hpLeft : hpMax))));
    const damageByMember = doc && doc.damageByMember && typeof doc.damageByMember === 'object' ? { ...doc.damageByMember } : {};
    const memberAttempts = doc && doc.memberAttempts && typeof doc.memberAttempts === 'object' ? { ...doc.memberAttempts } : {};
    return {
      id: doc && (doc._id || doc.id) ? doc._id || doc.id : null,
      guildId: doc && doc.guildId ? doc.guildId : null,
      bossId: doc && doc.bossId ? doc.bossId : definition.id,
      level: Number.isFinite(Number(doc && doc.level)) ? Math.max(1, Math.round(Number(doc.level))) : definition.level,
      status: doc && doc.status ? doc.status : 'open',
      phase: Number.isFinite(Number(doc && doc.phase)) ? Math.max(1, Math.round(Number(doc.phase))) : 1,
      totalDamage: Number.isFinite(Number(doc && doc.totalDamage)) ? Math.max(0, Math.round(Number(doc.totalDamage))) : 0,
      hpMax,
      hpLeft,
      damageByMember,
      memberAttempts,
      schemaVersion: Number.isFinite(Number(doc && doc.schemaVersion)) ? Math.round(Number(doc.schemaVersion)) : BOSS_SCHEMA_VERSION,
      updatedAt: doc && doc.updatedAt ? new Date(doc.updatedAt) : null,
      createdAt: doc && doc.createdAt ? new Date(doc.createdAt) : null
    };
  }

  async function ensureBossState(guildId, definition) {
    const docId = `${guildId}_${definition.id}`;
    const collection = db.collection(COLLECTIONS.GUILD_BOSS);
    const snapshot = await collection
      .doc(docId)
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    if (!snapshot || !snapshot.data) {
      const nowDate = serverTimestamp();
      const baseDoc = {
        guildId,
        bossId: definition.id,
        level: definition.level,
        hpMax: definition.hp,
        hpLeft: definition.hp,
        status: 'open',
        phase: 1,
        totalDamage: 0,
        damageByMember: {},
        memberAttempts: {},
        createdAt: nowDate,
        updatedAt: nowDate,
        schemaVersion: BOSS_SCHEMA_VERSION
      };
      await collection
        .doc(docId)
        .set({ data: baseDoc })
        .catch((error) => {
          if (error && /exists/i.test(error.errMsg || '')) {
            return null;
          }
          throw error;
        });
      return { id: docId, state: normalizeBossState(baseDoc, definition) };
    }
    return { id: docId, state: normalizeBossState(snapshot.data, definition) };
  }

  function buildBossLeaderboard(damageMap = {}, limit = BOSS_RANK_LIMIT) {
    const entries = Object.keys(damageMap).map((memberId) => ({
      memberId,
      damage: Math.max(0, Math.round(Number(damageMap[memberId]) || 0))
    }));
    entries.sort((left, right) => right.damage - left.damage);
    return entries.slice(0, limit);
  }

  function buildBossStatusPayload({ state, definition, settings, memberId, now }) {
    const hpMax = Math.max(1, state.hpMax || definition.hp);
    const hpLeft = Math.max(0, Math.min(hpMax, state.hpLeft));
    const progress = hpMax > 0 ? Math.max(0, Math.min(1, 1 - hpLeft / hpMax)) : 0;
    const attemptLimit = Number(settings.dailyAttempts || BOSS_DAILY_ATTEMPT_LIMIT);
    const cooldownMs = Number(settings.cooldownMs || BOSS_MEMBER_COOLDOWN_MS);
    const todayKey = computeDateKey(now);
    const attemptEntry = state.memberAttempts && state.memberAttempts[memberId] ? state.memberAttempts[memberId] : null;
    const attemptsUsed = attemptEntry && attemptEntry.dateKey === todayKey ? Math.max(0, Math.round(Number(attemptEntry.count || 0))) : 0;
    const lastAt = attemptEntry && attemptEntry.lastChallengeAt ? new Date(attemptEntry.lastChallengeAt) : null;
    const cooldownRemaining = lastAt ? Math.max(0, cooldownMs - (now.getTime() - lastAt.getTime())) : 0;
    return {
      bossId: state.bossId || definition.id,
      name: definition.name,
      level: state.level || definition.level,
      element: definition.element || '',
      status: state.status || 'open',
      hp: {
        max: hpMax,
        current: hpLeft,
        progress
      },
      schemaVersion: state.schemaVersion || BOSS_SCHEMA_VERSION,
      totalDamage: state.totalDamage || 0,
      attempts: {
        limit: attemptLimit,
        used: attemptsUsed,
        remaining: Math.max(0, attemptLimit - attemptsUsed),
        cooldownMs,
        cooldownRemaining
      },
      leaderboard: buildBossLeaderboard(state.damageByMember, 10)
    };
  }


  function toIsoString(value) {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  function sanitizePageNumber(value, { min = 1, max = 1000 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return Math.max(1, min);
    }
    const rounded = Math.floor(numeric);
    if (rounded < min) {
      return min;
    }
    if (typeof max === 'number' && rounded > max) {
      return max;
    }
    return rounded;
  }

  function sanitizePageSize(value, { min = 1, max = 50, defaultSize = 10 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return defaultSize;
    }
    const rounded = Math.floor(numeric);
    if (rounded < min) {
      return min;
    }
    if (rounded > max) {
      return max;
    }
    return rounded;
  }

  function resolveOffsetCursor(cursor) {
    if (typeof cursor === 'number' && Number.isFinite(cursor)) {
      return Math.max(0, Math.floor(cursor));
    }
    if (typeof cursor !== 'string' || !cursor) {
      return 0;
    }
    const offsetMatch = cursor.match(/offset:(\d+)/i);
    if (offsetMatch) {
      return Math.max(0, parseInt(offsetMatch[1], 10) || 0);
    }
    const numeric = Number(cursor);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }
    return 0;
  }

  function buildOffsetCursor(offset) {
    const value = Math.max(0, Math.floor(Number(offset) || 0));
    return `offset:${value}`;
  }

  function buildFuzzyRegExp(keyword) {
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return null;
    }
    const trimmed = keyword.trim();
    const escaped = trimmed.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (!escaped) {
      return null;
    }
    try {
      return new RegExp(escaped, 'i');
    } catch (error) {
      logger.warn('[guild] build regex failed', error);
    }
    return null;
  }

  function matchesKeyword(value, matcher) {
    if (!matcher) {
      return true;
    }
    if (matcher instanceof RegExp) {
      const text = typeof value === 'string' ? value : '';
      return matcher.test(text);
    }
    if (typeof matcher === 'object' && matcher && typeof matcher.regexp === 'string') {
      try {
        const regex = new RegExp(matcher.regexp, matcher.options || '');
        const text = typeof value === 'string' ? value : '';
        return regex.test(text);
      } catch (error) {
        return false;
      }
    }
    const text = typeof value === 'string' ? value : '';
    return text.includes(String(matcher || ''));
  }

  function extractMemberPowerValue(doc = {}) {
    const candidates = [
      doc.power,
      doc.powerScore,
      doc.combatPower,
      doc.totalPower,
      doc.powerRating,
      doc.attributeSummary && doc.attributeSummary.powerScore,
      doc.attributes && doc.attributes.powerScore,
      doc.profile && doc.profile.combatPower
    ];
    return candidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return Math.max(0, Math.round(numeric));
      }
      return acc;
    }, 0);
  }

  function buildAdminMemberSummary(doc = {}) {
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    const memberId = normalizeMemberId(doc.memberId || doc._id || doc.id);
    /* istanbul ignore next */
    if (!memberId) {
      return null;
    }
    const name =
      toTrimmedString(doc.displayName) ||
      toTrimmedString(doc.nickName) ||
      toTrimmedString(doc.nickname) ||
      toTrimmedString(doc.name) ||
      memberId;
    const role = typeof doc.role === 'string' && doc.role.trim() ? doc.role.trim() : 'member';
    const status = typeof doc.status === 'string' && doc.status.trim() ? doc.status.trim() : 'active';
    const contribution = extractMemberContribution(doc);
    const power = extractMemberPowerValue(doc);
    const activityScore = Number.isFinite(Number(doc.activity))
      ? Math.max(0, Math.round(Number(doc.activity)))
      : Number.isFinite(Number(doc.activityScore))
      ? Math.max(0, Math.round(Number(doc.activityScore)))
      : 0;
    const joinedAtIso = toIsoString(doc.joinedAt || doc.createdAt || doc.updatedAt || null);
    const joinedAtTimestamp = joinedAtIso ? new Date(joinedAtIso).getTime() : 0;
    return {
      memberId,
      name,
      role,
      status,
      contribution,
      power,
      activity: activityScore,
      joinedAt: joinedAtIso,
      joinedAtTimestamp
    };
  }

  function buildAdminMemberSummaryCollection(docs = []) {
    const entries = [];
    const lookup = new Map();
    (Array.isArray(docs) ? docs : []).forEach((doc) => {
      const summary = buildAdminMemberSummary(doc);
      if (!summary) {
        return;
      }
      entries.push(summary);
      lookup.set(summary.memberId, summary);
    });
    return { entries, lookup };
  }

  function buildGuildMemberListEntry(doc = {}, { memberDoc = null, extrasDoc = null } = {}) {
    /* istanbul ignore next */
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    const memberId = normalizeMemberId(doc.memberId || doc._id || doc.id);
    if (!memberId) {
      return null;
    }
    const guildId = normalizeId(doc.guildId);
    const role = toTrimmedString(doc.role) || 'member';
    const status = toTrimmedString(doc.status) || 'active';
    const nameCandidates = [
      doc.displayName,
      doc.nickName,
      doc.nickname,
      doc.name,
      memberDoc && memberDoc.displayName,
      memberDoc && memberDoc.nickName,
      memberDoc && memberDoc.nickname,
      memberDoc && memberDoc.name,
      extrasDoc && extrasDoc.displayName,
      extrasDoc && extrasDoc.nickName,
      extrasDoc && extrasDoc.nickname,
      extrasDoc && extrasDoc.name
    ];
    const displayName = nameCandidates.map(toTrimmedString).find(Boolean) || memberId;
    const avatarUrl =
      pickPortraitUrl(
        doc.avatarUrl,
        doc.portrait,
        memberDoc && memberDoc.avatarUrl,
        memberDoc && memberDoc.portrait,
        extrasDoc && extrasDoc.avatarUrl,
        extrasDoc && extrasDoc.portrait
      ) || '';
    const avatarFrame = resolveAvatarFrameValue(
      doc.avatarFrame,
      memberDoc && memberDoc.avatarFrame,
      memberDoc && memberDoc.appearanceFrame,
      memberDoc && memberDoc.appearance && memberDoc.appearance.avatarFrame,
      extrasDoc && extrasDoc.avatarFrame
    );
    const titleCatalogEntries = [];
    if (Array.isArray(doc.titleCatalog)) {
      titleCatalogEntries.push(...doc.titleCatalog);
    }
    if (Array.isArray(doc.titles)) {
      titleCatalogEntries.push(...doc.titles);
    }
    if (memberDoc && Array.isArray(memberDoc.titleCatalog)) {
      titleCatalogEntries.push(...memberDoc.titleCatalog);
    }
    if (memberDoc && memberDoc.appearance && Array.isArray(memberDoc.appearance.titleCatalog)) {
      titleCatalogEntries.push(...memberDoc.appearance.titleCatalog);
    }
    if (extrasDoc && Array.isArray(extrasDoc.titleCatalog)) {
      titleCatalogEntries.push(...extrasDoc.titleCatalog);
    }
    if (extrasDoc && extrasDoc.appearance && Array.isArray(extrasDoc.appearance.titleCatalog)) {
      titleCatalogEntries.push(...extrasDoc.appearance.titleCatalog);
    }
    const titleCatalog = normalizeTitleCatalog(titleCatalogEntries);
    let titleId =
      doc.titleId ||
      (doc.title && doc.title.id) ||
      (memberDoc && (memberDoc.titleId || memberDoc.appearanceTitle || (memberDoc.appearance && memberDoc.appearance.titleId))) ||
      (extrasDoc && (extrasDoc.titleId || extrasDoc.appearanceTitle || (extrasDoc.appearance && extrasDoc.appearance.titleId))) ||
      '';
    let titleName =
      doc.titleName ||
      (doc.title && doc.title.name) ||
      (memberDoc &&
        (memberDoc.titleName ||
          memberDoc.appearanceTitleName ||
          (memberDoc.appearance && memberDoc.appearance.titleName))) ||
      (extrasDoc &&
        (extrasDoc.titleName ||
          extrasDoc.appearanceTitleName ||
          (extrasDoc.appearance && extrasDoc.appearance.titleName))) ||
      '';
    titleId = normalizeTitleId(titleId);
    titleName = toTrimmedString(titleName);
    if (!titleId && titleCatalog.length) {
      titleId = titleCatalog[0].id;
      titleName = titleName || titleCatalog[0].name;
    }
    const contribution = extractMemberContribution(doc);
    const contributionTotal = Number.isFinite(Number(doc.contributionTotal))
      ? Math.max(0, Math.round(Number(doc.contributionTotal)))
      : contribution;
    const contributionWeek = Number.isFinite(Number(doc.contributionWeek))
      ? Math.max(0, Math.round(Number(doc.contributionWeek)))
      : 0;
    const power = extractMemberPowerValue(doc);
    const activityScore = Number.isFinite(Number(doc.activityScore))
      ? Math.max(0, Math.round(Number(doc.activityScore)))
      : Number.isFinite(Number(doc.activity))
      ? Math.max(0, Math.round(Number(doc.activity)))
      : 0;
    const joinedAt = toIsoString(doc.joinedAt || doc.createdAt || doc.updatedAt || null);
    const lastActiveAt = toIsoString(doc.lastActiveAt || doc.lastSeenAt || doc.updatedAt || null);
    const joinedAtTimestamp = joinedAt ? new Date(joinedAt).getTime() : 0;
    return {
      memberId,
      guildId,
      role,
      status,
      displayName,
      name: displayName,
      avatarUrl,
      avatarFrame,
      titleId,
      titleName,
      titleCatalog,
      contribution,
      contributionTotal,
      contributionWeek,
      power,
      powerScore: power,
      activityScore,
      joinedAt,
      joinedAtTimestamp,
      updatedAt: toIsoString(doc.updatedAt || null),
      lastActiveAt,
      schemaVersion: doc.schemaVersion || GUILD_SCHEMA_VERSION
    };
  }

  async function loadGuildMembersForAdmin(guildIds = []) {
    const normalized = Array.from(
      new Set((Array.isArray(guildIds) ? guildIds : []).map((id) => normalizeId(id)).filter(Boolean))
    );
    if (!normalized.length) {
      return new Map();
    }
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId: command.in(normalized) })
      .limit(Math.min(1000, normalized.length * 200))
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const grouped = new Map();
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId) {
        return;
      }
      if (!grouped.has(guildId)) {
        grouped.set(guildId, []);
      }
      grouped.get(guildId).push(doc);
    });
    return grouped;
  }

  async function loadGuildSecuritySummaries(guildIds = []) {
    const normalized = Array.from(
      new Set((Array.isArray(guildIds) ? guildIds : []).map((id) => normalizeId(id)).filter(Boolean))
    );
    if (!normalized.length) {
      return new Map();
    }
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_LOGS)
      .where({ guildId: command.in(normalized), type: 'security' })
      .limit(Math.min(500, normalized.length * 20))
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const summaries = new Map();
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId) {
        return;
      }
      const createdAt = toIsoString(doc.createdAt || doc.updatedAt || null);
      const existing = summaries.get(guildId) || { count: 0, lastAlertAt: null };
      existing.count += 1;
      if (createdAt) {
        const createdAtTime = new Date(createdAt).getTime();
        const lastTime = existing.lastAlertAt ? new Date(existing.lastAlertAt).getTime() : 0;
        if (createdAtTime > lastTime) {
          existing.lastAlertAt = createdAt;
        }
      }
      summaries.set(guildId, existing);
    });
    return summaries;
  }

  async function loadBossStatesForGuilds(guildIds = []) {
    const normalized = Array.from(
      new Set((Array.isArray(guildIds) ? guildIds : []).map((id) => normalizeId(id)).filter(Boolean))
    );
    if (!normalized.length) {
      return new Map();
    }
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_BOSS)
      .where({ guildId: command.in(normalized) })
      .limit(Math.min(200, normalized.length * 5))
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const map = new Map();
    docs.forEach((doc) => {
      const guildId = normalizeId(doc.guildId);
      if (!guildId) {
        return;
      }
      const existing = map.get(guildId);
      if (!existing) {
        map.set(guildId, doc);
        return;
      }
      const existingUpdated = existing && existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const docUpdated = doc && doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
      if (docUpdated >= existingUpdated) {
        map.set(guildId, doc);
      }
    });
    return map;
  }

  function buildAdminGuildListEntry(doc = {}, { memberSummaries = [], leaderMap = null, securityMap = null, bossMap = null } = {}) {
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    const guildId = normalizeId(doc._id || doc.id);
    if (!guildId) {
      return null;
    }
    const leaderRecord = (leaderMap && leaderMap.get(guildId)) || null;
    const activeMembers = memberSummaries.filter((entry) => entry.status !== 'inactive');
    const contributionTotal = activeMembers.reduce((acc, entry) => acc + (Number(entry.contribution) || 0), 0);
    const totalPower = activeMembers.reduce((acc, entry) => acc + (Number(entry.power) || 0), 0);
    const averagePower = activeMembers.length ? Math.round(totalPower / activeMembers.length) : 0;
    const officerCount = activeMembers.filter((entry) => entry.role === 'officer').length;
    const securitySummary = securityMap && securityMap.get(guildId);
    const bossState = bossMap && bossMap.get(guildId);
    const topMembers = [...memberSummaries]
      .filter((entry) => entry.status !== 'inactive')
      .sort((left, right) => {
        if (right.contribution !== left.contribution) {
          return right.contribution - left.contribution;
        }
        return right.power - left.power;
      })
      .slice(0, 3);
    let bossSummary = null;
    if (bossState) {
      const definition = normalizeBossDefinition(getBossDefinition(bossState.bossId || DEFAULT_BOSS_ID) || {});
      const hpMax = Math.max(1, Math.round(Number(bossState.hpMax || definition.hp || 1)));
      const hpLeft = Math.max(0, Math.round(Number(bossState.hpLeft || hpMax)));
      bossSummary = {
        bossId: bossState.bossId || definition.id,
        status: bossState.status || 'open',
        totalDamage: Math.max(0, Math.round(Number(bossState.totalDamage || 0))),
        hpMax,
        hpLeft,
        updatedAt: toIsoString(bossState.updatedAt || null)
      };
    }
    return {
      id: guildId,
      name: toTrimmedString(doc.name) || '未命名宗门',
      icon: toTrimmedString(doc.icon || ''),
      manifesto: toTrimmedString(doc.manifesto || ''),
      notice: toTrimmedString(doc.notice || ''),
      badge: toTrimmedString(doc.badge || ''),
      level: Number.isFinite(Number(doc.level)) ? Math.max(1, Math.round(Number(doc.level))) : 1,
      capacity: Number.isFinite(Number(doc.capacity)) ? Math.max(0, Math.round(Number(doc.capacity))) : 0,
      memberCount: Number.isFinite(Number(doc.memberCount)) ? Math.max(0, Math.round(Number(doc.memberCount))) : activeMembers.length,
      activeMemberCount: activeMembers.length,
      power: Number.isFinite(Number(doc.power)) ? Math.max(0, Math.round(Number(doc.power))) : 0,
      activityScore: Number.isFinite(Number(doc.activityScore))
        ? Math.max(0, Math.round(Number(doc.activityScore)))
        : 0,
      contributionTotal,
      averagePower,
      leader: leaderRecord
        ? { id: leaderRecord.memberId, name: leaderRecord.displayName || leaderRecord.memberId }
        : null,
      officerCount,
      topMembers,
      alertCount: securitySummary ? securitySummary.count : 0,
      lastAlertAt: securitySummary && securitySummary.lastAlertAt ? securitySummary.lastAlertAt : null,
      boss: bossSummary,
      createdAt: toIsoString(doc.createdAt || null),
      updatedAt: toIsoString(doc.updatedAt || null)
    };
  }

  function buildTaskProgressSummary(doc = {}) {
    const progress = doc && typeof doc === 'object' ? doc : {};
    const currentCandidates = [progress.value, progress.current, progress.count];
    const current = currentCandidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return Math.max(0, Math.round(numeric));
      }
      return acc;
    }, 0);
    return current;
  }

  function buildTaskSummary(doc = {}) {
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    const taskId = toTrimmedString(doc._id || doc.id || doc.taskId || '');
    const goal = doc.goal && typeof doc.goal === 'object' ? doc.goal : {};
    const progress = doc.progress && typeof doc.progress === 'object' ? doc.progress : {};
    const goalCandidates = [goal.value, goal.target, goal.count, goal.total];
    const goalValue = goalCandidates.reduce((acc, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > acc) {
        return Math.max(0, Math.round(numeric));
      }
      return acc;
    }, 0);
    const progressValue = buildTaskProgressSummary(progress);
    const percent = goalValue > 0 ? Math.max(0, Math.min(1, progressValue / goalValue)) : 0;
    return {
      id: taskId,
      taskId: toTrimmedString(doc.taskId || taskId),
      title: toTrimmedString(doc.title || doc.taskId || '宗门任务'),
      type: toTrimmedString(doc.type || ''),
      status: toTrimmedString(doc.status || 'open'),
      progress: {
        current: progressValue,
        target: goalValue,
        percent
      },
      reward: doc.reward || {},
      startAt: toIsoString(doc.startAt || null),
      endAt: toIsoString(doc.endAt || null),
      updatedAt: toIsoString(doc.updatedAt || null)
    };
  }

  function normalizeAdminMemberId(memberId, context = {}) {
    if (typeof memberId === 'string' && memberId.trim()) {
      return memberId.trim();
    }
    if (context && typeof context.openid === 'string' && context.openid.trim()) {
      return context.openid.trim();
    }
    if (context && context.proxySession && typeof context.proxySession.adminId === 'string') {
      return context.proxySession.adminId.trim();
    }
    return '';
  }

  function toBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return fallback;
      }
      if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'off', 'no', '关闭', '禁用', '停用', 'disabled'].includes(normalized)) {
        return false;
      }
      return fallback;
    }
    if (value == null) {
      return fallback;
    }
    if (typeof value.valueOf === 'function') {
      try {
        const primitive = value.valueOf();
        if (primitive !== value) {
          return toBooleanFlag(primitive, fallback);
        }
      } catch (error) {
        return fallback;
      }
    }
    return Boolean(value);
  }

  async function hasAdminPermission(memberId) {
    const cacheKey = memberId;
    if (!cacheKey) {
      return false;
    }
    const cached = adminPermissionCache.get(cacheKey);
    if (cached && now() - cached.loadedAt < ADMIN_PERMISSION_CACHE_TTL_MS) {
      return cached.allowed;
    }
    try {
      const snapshot = await db
        .collection(COLLECTIONS.MEMBERS)
        .doc(cacheKey)
        .get();
      const member = snapshot && snapshot.data ? snapshot.data : null;
      const roleCandidates = [];
      if (member) {
        if (Array.isArray(member.roles)) {
          roleCandidates.push(...member.roles);
        }
        if (Array.isArray(member.adminRoles)) {
          roleCandidates.push(...member.adminRoles);
        }
        if (typeof member.role === 'string') {
          roleCandidates.push(member.role);
        }
        if (typeof member.primaryRole === 'string') {
          roleCandidates.push(member.primaryRole);
        }
        if (member.isAdmin === true) {
          roleCandidates.push('admin');
        }
        if (member.isDeveloper === true) {
          roleCandidates.push('developer');
        }
      }
      const allowed = roleCandidates.some((role) => ADMIN_ROLES.has(String(role || '').trim()));
      adminPermissionCache.set(cacheKey, { loadedAt: now(), allowed });
      return allowed;
    } catch (error) {
      const message = (error && (error.errMsg || error.message)) || '';
      if (/not exist/i.test(message)) {
        adminPermissionCache.set(cacheKey, { loadedAt: now(), allowed: false });
        return false;
      }
      throw error;
    }
  }

  async function assertAdminContext(memberId, context = {}, action = 'admin') {
    if (context && context.proxySession) {
      return;
    }
    const normalizedMemberId = normalizeAdminMemberId(memberId, context);
    if (await hasAdminPermission(normalizedMemberId)) {
      return;
    }
    await recordSecurityEvent({
      action: `${action}.denied`,
      actorId: normalizedMemberId || memberId || '',
      code: ERROR_CODES.PERMISSION_DENIED,
      message: '检测到未授权的管理员访问',
      context: { action }
    }).catch(() => {});
    throw createError(ERROR_CODES.PERMISSION_DENIED, '仅限管理员操作');
  }

  function resolveAdminGuildSortField(sortBy) {
    const allowed = ['updatedAt', 'memberCount', 'power', 'activityScore', 'createdAt'];
    const normalized = typeof sortBy === 'string' ? sortBy.trim() : '';
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    return 'updatedAt';
  }

  function resolveAdminGuildSortOrder(order) {
    if (typeof order === 'string') {
      const normalized = order.trim().toLowerCase();
      if (normalized === 'asc' || normalized === 'desc') {
        return normalized;
      }
    }
    return 'desc';
  }

  function decorateGuildDetailPayload(summary = {}, { members = [], memberLookup = new Map(), securitySummary = null, bossDoc = null } = {}) {
    const activeMembers = members.filter((entry) => entry.status !== 'inactive');
    const inactiveMembers = members.filter((entry) => entry.status === 'inactive');
    const totalContribution = activeMembers.reduce((acc, entry) => acc + (Number(entry.contribution) || 0), 0);
    const totalPower = activeMembers.reduce((acc, entry) => acc + (Number(entry.power) || 0), 0);
    const averagePower = activeMembers.length ? Math.round(totalPower / activeMembers.length) : 0;
    const topContributors = [...activeMembers]
      .sort((left, right) => {
        if (right.contribution !== left.contribution) {
          return right.contribution - left.contribution;
        }
        return right.power - left.power;
      })
      .slice(0, 5);
    const topPower = [...activeMembers]
      .sort((left, right) => {
        if (right.power !== left.power) {
          return right.power - left.power;
        }
        return right.contribution - left.contribution;
      })
      .slice(0, 5);
    const recentJoins = [...members]
      .filter((entry) => entry.joinedAt)
      .sort((left, right) => right.joinedAtTimestamp - left.joinedAtTimestamp)
      .slice(0, 5);
    let bossSummary = null;
    if (bossDoc) {
      const definition = normalizeBossDefinition(getBossDefinition(bossDoc.bossId || DEFAULT_BOSS_ID) || {});
      const hpMax = Math.max(1, Math.round(Number(bossDoc.hpMax || definition.hp || 1)));
      const hpLeft = Math.max(0, Math.round(Number(bossDoc.hpLeft || hpMax)));
      const leaderboard = buildBossLeaderboard(bossDoc.damageByMember || {}, 5).map((entry) => ({
        memberId: entry.memberId,
        damage: entry.damage,
        name: memberLookup.has(entry.memberId) ? memberLookup.get(entry.memberId).name : entry.memberId
      }));
      bossSummary = {
        bossId: bossDoc.bossId || definition.id,
        name: definition.name,
        level: Number.isFinite(Number(bossDoc.level)) ? Math.max(1, Math.round(Number(bossDoc.level))) : definition.level,
        status: bossDoc.status || 'open',
        totalDamage: Math.max(0, Math.round(Number(bossDoc.totalDamage || 0))),
        hpMax,
        hpLeft,
        progress: hpMax ? Math.max(0, Math.min(1, 1 - hpLeft / hpMax)) : 0,
        updatedAt: toIsoString(bossDoc.updatedAt || null),
        leaderboard
      };
    }
    const leader = summary.leader || null;
    return {
      guild: {
        ...summary,
        contributionTotal: totalContribution,
        averagePower,
        leader,
        alertCount: securitySummary ? securitySummary.count : summary.alertCount || 0,
        lastAlertAt: securitySummary && securitySummary.lastAlertAt ? securitySummary.lastAlertAt : summary.lastAlertAt || null
      },
      members: {
        total: members.length,
        active: activeMembers.length,
        inactive: inactiveMembers.length,
        officerCount: activeMembers.filter((entry) => entry.role === 'officer').length,
        topContributors,
        topPower,
        recentJoins
      },
      boss: bossSummary
    };
  }

  async function getGuildSystemOverviewForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.systemOverview');
    const [
      guildCountResult,
      memberCountResult,
      inactiveMemberCountResult,
      bossCountResult,
      activeBossCountResult,
      openTaskCountResult,
      completedTaskCountResult,
      alertCountResult,
      latestGuildSnapshot,
      settings
    ] = await Promise.all([
      db
        .collection(COLLECTIONS.GUILDS)
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_MEMBERS)
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_MEMBERS)
        .where({ status: 'inactive' })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_BOSS)
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_BOSS)
        .where({ status: command.neq('archived') })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_TASKS)
        .where({ status: command.neq('closed') })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_TASKS)
        .where({ status: 'completed' })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILD_LOGS)
        .where({ type: 'security' })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.GUILDS)
        .orderBy('updatedAt', 'desc')
        .limit(5)
        .get()
        .catch(() => ({ data: [] })),
      loadSettings().catch(() => DEFAULT_GUILD_SETTINGS)
    ]);
    const guildCount = Number(guildCountResult && guildCountResult.total) || 0;
    const memberCount = Number(memberCountResult && memberCountResult.total) || 0;
    const inactiveMembers = Number(inactiveMemberCountResult && inactiveMemberCountResult.total) || 0;
    const activeMembers = Math.max(0, memberCount - inactiveMembers);
    const bossCount = Number(bossCountResult && bossCountResult.total) || 0;
    const activeBossCount = Number(activeBossCountResult && activeBossCountResult.total) || 0;
    const openTaskCount = Number(openTaskCountResult && openTaskCountResult.total) || 0;
    const completedTaskCount = Number(completedTaskCountResult && completedTaskCountResult.total) || 0;
    const alertCount = Number(alertCountResult && alertCountResult.total) || 0;
    const recentGuildsRaw = (latestGuildSnapshot && latestGuildSnapshot.data) || [];
    const recentGuilds = recentGuildsRaw
      .map((doc) => ({
        id: normalizeId(doc._id || doc.id),
        name: toTrimmedString(doc.name || '未命名宗门'),
        updatedAt: toIsoString(doc.updatedAt || doc.lastAlertAt || doc.createdAt || null),
        memberCount: Number(doc.memberCount || doc.activeMemberCount || 0)
      }))
      .filter((entry) => entry && entry.id);
    const settingsSummary = {
      enabled: settings && settings.enabled !== false,
      maxMembers: Number(settings && settings.maxMembers) || DEFAULT_GUILD_SETTINGS.maxMembers,
      leaderboardCacheTtlMs: Number(settings && settings.leaderboardCacheTtlMs) || DEFAULT_GUILD_SETTINGS.leaderboardCacheTtlMs,
      teamBattleEnabled: !!(settings && settings.teamBattle && settings.teamBattle.enabled !== false),
      bossEnabled: !!(settings && settings.boss && settings.boss.enabled !== false),
      bossDailyAttempts:
        Number(settings && settings.boss && settings.boss.dailyAttempts) || DEFAULT_GUILD_BOSS_SETTINGS.dailyAttempts,
      riskControlEnabled: !!(settings && settings.riskControl && settings.riskControl.enabled !== false)
    };
    return wrapActionResponse(
      'admin.systemOverview',
      {
        stats: {
          guildCount,
          memberCount,
          activeMembers,
          inactiveMembers,
          bossCount,
          activeBossCount,
          openTaskCount,
          completedTaskCount,
          securityAlertCount: alertCount
        },
        recentGuilds,
        settings: settingsSummary
      },
      {
        message: '宗门系统总览已加载'
      }
    );
  }

  async function resetGuildSystemForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.resetGuildSystem');
    if (!payload || payload.confirm !== true) {
      throw createError(ERROR_CODES.PERMISSION_DENIED, '请在确认后执行清空操作');
    }
    const actorId = normalizeAdminMemberId(memberId, context);
    const collections = [
      COLLECTIONS.GUILDS,
      COLLECTIONS.GUILD_MEMBERS,
      COLLECTIONS.GUILD_TASKS,
      COLLECTIONS.GUILD_BOSS,
      COLLECTIONS.GUILD_BATTLES,
      COLLECTIONS.GUILD_LEADERBOARD,
      COLLECTIONS.GUILD_LOGS,
      COLLECTIONS.GUILD_CACHE,
      COLLECTIONS.GUILD_EVENT_LOGS,
      COLLECTIONS.GUILD_TICKETS,
      COLLECTIONS.GUILD_RATE_LIMITS
    ];
    const cleared = await truncateCollections(collections, { concurrency: 4 });
    const settingsPayload = {
      ...DEFAULT_GUILD_SETTINGS,
      schemaVersion: GUILD_SCHEMA_VERSION,
      updatedAt: serverTimestamp()
    };
    const settingsDocRef = db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(FEATURE_TOGGLE_DOC_ID);
    const settingsSnapshot = await settingsDocRef.get().catch((error) => {
      logger.error('[guild] load guild settings failed during reset', error);
      throw createError(ERROR_CODES.INTERNAL_ERROR, '重置宗门配置失败');
    });
    const writePromise = settingsSnapshot && settingsSnapshot.data
      ? settingsDocRef.update({
          data: {
            guildSettings: settingsPayload
          }
        })
      : settingsDocRef.set({
          data: {
            guildSettings: settingsPayload
          }
        });
    await writePromise.catch((error) => {
      if (
        settingsSnapshot &&
        settingsSnapshot.data &&
        error &&
        /not[\s_-]*exist/i.test(error.errMsg || '')
      ) {
        return settingsDocRef.set({
          data: {
            guildSettings: settingsPayload
          }
        });
      }
      logger.error('[guild] reset guild settings failed', error);
      throw createError(ERROR_CODES.INTERNAL_ERROR, '重置宗门配置失败');
    });
    settingsCache = { loadedAt: now(), settings: normalizeGuildSettings(DEFAULT_GUILD_SETTINGS) };
    await recordSecurityEvent({
      action: 'admin.resetGuildSystem',
      actorId: actorId || memberId || '',
      message: '管理员清空宗门系统数据',
      context: {
        collections,
        requestId: payload && payload.requestId ? String(payload.requestId) : undefined
      }
    }).catch(() => {});
    adminPermissionCache.clear();
    return wrapActionResponse(
      'admin.resetGuildSystem',
      {
        success: true,
        cleared
      },
      {
        message: '宗门系统数据已清空'
      }
    );
  }

  async function updateGuildSettingsForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.updateGuildSettings');
    const updates = payload && payload.updates && typeof payload.updates === 'object' ? payload.updates : {};
    const updateKeys = Object.keys(updates);
    if (!updateKeys.length) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, '缺少配置更新项');
    }
    const current = await loadSettings();
    const next = {
      ...current,
      teamBattle: { ...(current.teamBattle || {}) },
      boss: { ...(current.boss || {}) },
      riskControl: { ...(current.riskControl || {}) }
    };
    const applied = {};
    if (Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
      const value = toBooleanFlag(updates.enabled, current.enabled !== false);
      next.enabled = value;
      applied.enabled = value;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'maxMembers')) {
      const numeric = Number(updates.maxMembers);
      if (!Number.isFinite(numeric)) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, '宗门人数上限需为数字');
      }
      const clamped = Math.min(500, Math.max(5, Math.floor(numeric)));
      next.maxMembers = clamped;
      applied.maxMembers = clamped;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'leaderboardCacheTtlMs')) {
      const numeric = Number(updates.leaderboardCacheTtlMs);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, '排行榜缓存时长需为正数');
      }
      const clamped = Math.min(24 * 60 * 60 * 1000, Math.max(30 * 1000, Math.floor(numeric)));
      next.leaderboardCacheTtlMs = clamped;
      applied.leaderboardCacheTtlMs = clamped;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'teamBattleEnabled')) {
      const enabled = toBooleanFlag(updates.teamBattleEnabled, next.teamBattle.enabled !== false);
      next.teamBattle = { ...(next.teamBattle || {}), enabled };
      applied.teamBattleEnabled = enabled;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'bossEnabled')) {
      const enabled = toBooleanFlag(updates.bossEnabled, next.boss.enabled !== false);
      next.boss = { ...(next.boss || {}), enabled };
      applied.bossEnabled = enabled;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'bossDailyAttempts')) {
      const numeric = Number(updates.bossDailyAttempts);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, '试炼次数需为正数');
      }
      const clamped = Math.min(20, Math.max(1, Math.floor(numeric)));
      next.boss = { ...(next.boss || {}), dailyAttempts: clamped };
      applied.bossDailyAttempts = clamped;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'riskControlEnabled')) {
      const enabled = toBooleanFlag(updates.riskControlEnabled, next.riskControl.enabled !== false);
      next.riskControl = { ...(next.riskControl || {}), enabled };
      applied.riskControlEnabled = enabled;
    }
    if (!Object.keys(applied).length) {
      return wrapActionResponse(
        'admin.updateGuildSettings',
        { settings: current, updates: {} },
        { message: '未检测到有效的配置更新' }
      );
    }
    const normalized = normalizeGuildSettings(next);
    if (Object.prototype.hasOwnProperty.call(applied, 'teamBattleEnabled')) {
      normalized.teamBattle = { ...(normalized.teamBattle || {}), enabled: applied.teamBattleEnabled };
    }
    const payloadToWrite = {
      ...normalized,
      schemaVersion: GUILD_SCHEMA_VERSION,
      updatedAt: serverTimestamp()
    };
    const docRef = db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(FEATURE_TOGGLE_DOC_ID);
    await docRef
      .update({ data: { guildSettings: payloadToWrite } })
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return docRef.set({ data: { guildSettings: payloadToWrite } });
        }
        throw error;
      })
      .catch((error) => {
        logger.error('[guild] update guild settings failed', error);
        throw createError(ERROR_CODES.INTERNAL_ERROR, '更新宗门配置失败');
      });
    settingsCache = { loadedAt: now(), settings: normalized };
    const actorId = normalizeAdminMemberId(memberId, context);
    await recordSecurityEvent({
      action: 'admin.updateGuildSettings',
      actorId: actorId || memberId || '',
      message: '管理员更新宗门全局配置',
      context: { updates: applied }
    }).catch(() => {});
    return wrapActionResponse(
      'admin.updateGuildSettings',
      { settings: normalized, updates: applied },
      { message: '宗门配置已更新' }
    );
  }

  async function listGuildsForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.listGuilds');
    const pageSize = sanitizePageSize(payload.pageSize, { defaultSize: 10, max: 50 });
    const page = sanitizePageNumber(payload.page, { min: 1, max: 200 });
    const keyword = sanitizeString(payload.keyword || '', { maxLength: 40 });
    const sortField = resolveAdminGuildSortField(payload.sortBy);
    const sortOrder = resolveAdminGuildSortOrder(payload.sortOrder);
    const offset = (page - 1) * pageSize;
    let docs = [];
    let total = 0;
    if (keyword) {
      const keywordMatcher = buildFuzzyRegExp(keyword);
      const collection = db.collection(COLLECTIONS.GUILDS);
      const canUseRegex =
        keywordMatcher instanceof RegExp &&
        db &&
        typeof db.RegExp === 'function' &&
        command &&
        typeof command.or === 'function';
      if (canUseRegex) {
        const regexOptions = keywordMatcher.flags || 'i';
        const regexSource = keywordMatcher.source || keyword;
        const regex = db.RegExp({ regexp: regexSource, options: regexOptions });
        const conditions = [
          { name: regex },
          { _id: regex },
          { id: regex },
          { founderId: regex }
        ];
        const baseQuery = collection.where(command.or(conditions));
        const snapshot = await baseQuery
          .orderBy(sortField, sortOrder)
          .skip(offset)
          .limit(pageSize)
          .get()
          .catch(() => ({ data: [] }));
        docs = snapshot && snapshot.data ? snapshot.data : [];
        const countResult = await baseQuery.count().catch(() => ({ total: docs.length }));
        total = Number(countResult && countResult.total) || docs.length;
      } else {
        const snapshot = await collection
          .get()
          .catch(() => ({ data: [] }));
        const allDocs = snapshot && snapshot.data ? snapshot.data : [];
        const filtered = allDocs.filter((doc) => {
          if (!doc) {
            return false;
          }
          return (
            matchesKeyword(doc.name || '', keywordMatcher) ||
            matchesKeyword(doc._id || doc.id || '', keywordMatcher) ||
            matchesKeyword(doc.founderId || '', keywordMatcher)
          );
        });
        filtered.sort((left, right) => {
          if (sortField === 'createdAt' || sortField === 'updatedAt') {
            const leftTime = left && left[sortField] ? new Date(left[sortField]).getTime() : 0;
            const rightTime = right && right[sortField] ? new Date(right[sortField]).getTime() : 0;
            return sortOrder === 'asc' ? leftTime - rightTime : rightTime - leftTime;
          }
          const leftNumeric = Number(left && left[sortField]);
          const rightNumeric = Number(right && right[sortField]);
          if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
            return sortOrder === 'asc' ? leftNumeric - rightNumeric : rightNumeric - leftNumeric;
          }
          return 0;
        });
        total = filtered.length;
        docs = filtered.slice(offset, offset + pageSize);
      }
    } else {
      const collection = db.collection(COLLECTIONS.GUILDS);
      const snapshot = await collection
        .orderBy(sortField, sortOrder)
        .skip(offset)
        .limit(pageSize)
        .get()
        .catch(() => ({ data: [] }));
      docs = snapshot && snapshot.data ? snapshot.data : [];
      const countResult = await collection.count().catch(() => ({ total: docs.length }));
      total = Number(countResult && countResult.total) || docs.length;
    }
    const guildIds = docs.map((doc) => normalizeId(doc._id || doc.id)).filter(Boolean);
    const [memberDocsMap, leaderMap, securityMap, bossMap] = await Promise.all([
      loadGuildMembersForAdmin(guildIds),
      loadGuildLeaderRecords(guildIds),
      loadGuildSecuritySummaries(guildIds),
      loadBossStatesForGuilds(guildIds)
    ]);
    const guilds = docs
      .map((doc) => {
        const guildId = normalizeId(doc._id || doc.id);
        const members = memberDocsMap.get(guildId) || [];
        const { entries } = buildAdminMemberSummaryCollection(members);
        return buildAdminGuildListEntry(doc, {
          memberSummaries: entries,
          leaderMap,
          securityMap,
          bossMap
        });
      })
      .filter(Boolean);
    return wrapActionResponse(
      'admin.listGuilds',
      {
        page,
        pageSize,
        total,
        guilds
      },
      {
        message: '宗门列表已加载'
      }
    );
  }

  async function getGuildDetailForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.guildDetail');
    const guildId = sanitizeString(payload.guildId, { maxLength: 64 });
    if (!guildId) {
      throw createError('INVALID_GUILD', '缺少宗门 ID');
    }
    const snapshot = await db
      .collection(COLLECTIONS.GUILDS)
      .doc(guildId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw createError('GUILD_NOT_FOUND', '未找到指定宗门');
    }
    const guildDoc = snapshot.data;
    const [memberDocsMap, leaderMap, securityMap, bossMap, tasksSnapshot, alertsPayload] = await Promise.all([
      loadGuildMembersForAdmin([guildId]),
      loadGuildLeaderRecords([guildId]),
      loadGuildSecuritySummaries([guildId]),
      loadBossStatesForGuilds([guildId]),
      db
        .collection(COLLECTIONS.GUILD_TASKS)
        .where({ guildId })
        .orderBy('updatedAt', 'desc')
        .limit(10)
        .get()
        .catch(() => ({ data: [] })),
      listRiskAlertsForAdmin(memberId, { guildId, limit: 10 })
    ]);
    const memberDocs = memberDocsMap.get(guildId) || [];
    const { entries, lookup } = buildAdminMemberSummaryCollection(memberDocs);
    const summary = buildAdminGuildListEntry(guildDoc, {
      memberSummaries: entries,
      leaderMap,
      securityMap,
      bossMap
    });
    const detailPayload = decorateGuildDetailPayload(summary || {}, {
      members: entries,
      memberLookup: lookup,
      securitySummary: securityMap.get(guildId) || null,
      bossDoc: bossMap.get(guildId) || null
    });
    const tasks = (tasksSnapshot && tasksSnapshot.data ? tasksSnapshot.data : [])
      .map((doc) => buildTaskSummary(doc))
      .filter(Boolean);
    const alerts = alertsPayload && Array.isArray(alertsPayload.alerts) ? alertsPayload.alerts : [];
    return wrapActionResponse(
      'admin.guildDetail',
      {
        guild: detailPayload.guild,
        members: detailPayload.members,
        boss: detailPayload.boss,
        tasks,
        alerts
      },
      {
        message: '宗门详情已加载'
      }
    );
  }

  function resolveMemberOrder(order) {
    if (typeof order === 'string') {
      const normalized = order.trim().toLowerCase();
      if (['contribution', 'power', 'joinedat'].includes(normalized)) {
        return normalized;
      }
    }
    return 'contribution';
  }

  async function listGuildMembersForAdmin(memberId, payload = {}, context = {}) {
    await assertAdminContext(memberId, context, 'admin.guildMembers');
    const guildId = sanitizeString(payload.guildId, { maxLength: 64 });
    if (!guildId) {
      throw createError('INVALID_GUILD', '缺少宗门 ID');
    }
    const includeInactive = !!payload.includeInactive;
    const keyword = sanitizeString(payload.keyword || '', { maxLength: 40 });
    const order = resolveMemberOrder(payload.order);
    const pageSize = sanitizePageSize(payload.pageSize, { defaultSize: 20, max: 100 });
    const page = sanitizePageNumber(payload.page, { min: 1, max: 500 });
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId })
      .limit(1000)
      .get()
      .catch(() => ({ data: [] }));
    const docs = snapshot && snapshot.data ? snapshot.data : [];
    const { entries } = buildAdminMemberSummaryCollection(docs);
    const keywordMatcher = buildFuzzyRegExp(keyword);
    const filtered = entries.filter((entry) => {
      if (!includeInactive && entry.status === 'inactive') {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return matchesKeyword(entry.name, keywordMatcher) || matchesKeyword(entry.memberId, keywordMatcher);
    });
    const inactiveCount = entries.filter((entry) => entry.status === 'inactive').length;
    const roleCounts = {
      leader: filtered.filter((entry) => entry.role === 'leader').length,
      officer: filtered.filter((entry) => entry.role === 'officer').length,
      member: filtered.filter((entry) => entry.role === 'member').length,
      inactive: inactiveCount
    };
    filtered.sort((left, right) => {
      if (order === 'power') {
        if (right.power !== left.power) {
          return right.power - left.power;
        }
        return right.contribution - left.contribution;
      }
      if (order === 'joinedat') {
        return right.joinedAtTimestamp - left.joinedAtTimestamp;
      }
      if (right.contribution !== left.contribution) {
        return right.contribution - left.contribution;
      }
      return right.power - left.power;
    });
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const pageEntries = filtered.slice(offset, offset + pageSize);
    const contributionTotal = filtered.reduce((acc, entry) => acc + (Number(entry.contribution) || 0), 0);
    const powerTotal = filtered.reduce((acc, entry) => acc + (Number(entry.power) || 0), 0);
    const averageContribution = filtered.length ? Math.round(contributionTotal / filtered.length) : 0;
    const averagePower = filtered.length ? Math.round(powerTotal / filtered.length) : 0;
    return wrapActionResponse(
      'admin.guildMembers',
      {
        guildId,
        page,
        pageSize,
        total,
        members: pageEntries,
        roles: roleCounts,
        stats: {
          contributionTotal,
          averageContribution,
          averagePower
        }
      },
      {
        message: '宗门成员列表已加载'
      }
    );
  }



  async function listGuilds() {
    const leaderboard = await loadLeaderboard();
    return { guilds: leaderboard };
  }

  async function listRiskAlertsForAdmin(memberId, payload = {}) {
    const requestedLimit = Number(payload.limit);
    const limit = clamp(Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 20, 1, 100);
    const normalizedGuildId = sanitizeString(payload.guildId, { maxLength: 64 });
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_LOGS)
      .where({ type: 'security' })
      .get();
    const rawAlerts = snapshot && snapshot.data ? snapshot.data : [];
    rawAlerts.sort((left, right) => {
      const leftTime = left && left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right && right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    });
    const filtered = normalizedGuildId
      ? rawAlerts.filter((doc) => (doc.guildId || '') === normalizedGuildId)
      : rawAlerts;
    const alerts = filtered.slice(0, limit).map((doc) => ({
      id: doc._id || doc.id || '',
      action: doc.action || '',
      actorId: doc.actorId || '',
      guildId: doc.guildId || null,
      summary: doc.summary || null,
      payload: doc.payload || {},
      createdAt: doc.createdAt || null
    }));
    if (!alerts.length) {
      return { alerts };
    }
    const actorIds = Array.from(
      new Set(alerts.map((alert) => normalizeMemberId(alert.actorId)).filter(Boolean))
    );
    let memberMap = new Map();
    let extrasMap = new Map();
    if (actorIds.length) {
      [memberMap, extrasMap] = await Promise.all([
        loadDocumentsByIds(COLLECTIONS.MEMBERS, actorIds),
        loadDocumentsByIds(COLLECTIONS.MEMBER_EXTRAS, actorIds)
      ]);
    }
    const decoratedAlerts = alerts.map((alert) => {
      const actorId = normalizeMemberId(alert.actorId);
      const memberDoc = actorId ? memberMap.get(actorId) || null : null;
      const extrasDoc = actorId ? extrasMap.get(actorId) || null : null;
      const actorName =
        toTrimmedString(alert.summary && alert.summary.actorName) ||
        toTrimmedString(alert.summary && alert.summary.memberName) ||
        toTrimmedString(alert.payload && alert.payload.actorName) ||
        toTrimmedString(alert.payload && alert.payload.memberName) ||
        (memberDoc
          ? toTrimmedString(
              memberDoc.displayName ||
                memberDoc.nickName ||
                memberDoc.nickname ||
                memberDoc.name
            )
          : '') ||
        (extrasDoc
          ? toTrimmedString(
              extrasDoc.displayName ||
                extrasDoc.nickName ||
                extrasDoc.nickname ||
                extrasDoc.name
            )
          : '');
      const actorDisplay = actorName || actorId || '';
      return {
        ...alert,
        actorId,
        actorName,
        actorDisplay
      };
    });
    return { alerts: decoratedAlerts };
  }

  async function recordGuildLog(entry = {}) {
    try {
      await db.collection(COLLECTIONS.GUILD_LOGS).add({
        data: {
          ...entry,
          createdAt: serverTimestamp(),
          schemaVersion: GUILD_SCHEMA_VERSION
        }
      });
    } catch (error) {
      logger.warn('[guild] record guild log failed', error);
    }
  }

  async function recordSecurityEvent(event = {}) {
    const action = event.action || 'security';
    const actorId = event.actorId || '';
    const guildId = event.guildId || null;
    const code = event.code || ERROR_CODES.SECURITY_ALERT;
    const message = event.message || '安全事件已记录';
    const context = event.context || {};
    try {
      await recordErrorLog({
        action,
        actorId,
        guildId,
        code,
        message,
        event: context
      });
    } catch (error) {
      logger.warn('[guild] record security event error log failed', error);
    }
    try {
      await recordGuildLog({
        action,
        actorId,
        guildId,
        type: 'security',
        severity: 'warning',
        summary: buildSummary(action, { code, message }),
        payload: { ...context, code }
      });
    } catch (error) {
      logger.warn('[guild] record security event guild log failed', error);
    }
  }

  async function recordRiskAlert(entry = {}) {
    const guildId = entry.guildId || null;
    const actorId = entry.memberId || entry.actorId || '';
    const type = entry.type || 'unknown';
    const count = Number(entry.count) || 0;
    const threshold = Number(entry.threshold) || 0;
    const windowMs = Number(entry.windowMs) || 0;
    const metadata = entry.metadata || {};
    const message = `${RISK_ALERT_MESSAGE}(${type})`;
    await recordSecurityEvent({
      action: 'riskControl',
      actorId,
      guildId,
      code: ERROR_CODES.SECURITY_ALERT,
      message,
      context: { type, count, threshold, windowMs, metadata }
    });
  }

  async function monitorActionFrequency({ guildId = null, memberId, type, metadata = {} } = {}) {
    if (!memberId || !type) {
      return null;
    }
    const settings = await loadSettings();
    const riskControl = resolveRiskControlSettingsSnapshot(settings);
    const detection = riskControl.abuseDetection || {};
    if (!riskControl.enabled || detection.enabled === false) {
      return null;
    }
    const windowMs = Math.max(1000, Math.round(Number(detection.windowMs) || 60000));
    const threshold = Math.max(1, Math.round(Number(detection.threshold) || 1));
    const docId = buildAbuseDocId(memberId, guildId, type);
    const collection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
    const docRef = collection.doc(docId);
    const nowDate = new Date();
    const nowTs = nowDate.getTime();
    const snapshot = await docRef
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    let count = 1;
    let windowStartedAt = nowDate;
    let flaggedRecently = false;
    if (snapshot && snapshot.data) {
      const startedAt = snapshot.data.windowStartedAt ? new Date(snapshot.data.windowStartedAt) : null;
      if (startedAt && !Number.isNaN(startedAt.getTime()) && nowTs - startedAt.getTime() < windowMs) {
        const previousCount = Math.max(0, Math.round(Number(snapshot.data.count || 0)));
        count = previousCount + 1;
        windowStartedAt = startedAt;
      }
      const flaggedAt = snapshot.data.flaggedAt ? new Date(snapshot.data.flaggedAt) : null;
      if (flaggedAt && !Number.isNaN(flaggedAt.getTime()) && nowTs - flaggedAt.getTime() < windowMs) {
        flaggedRecently = true;
      }
    }

    const payloadBase = {
      type: 'abuse',
      guildId,
      memberId,
      action: type,
      windowMs,
      windowStartedAt,
      lastTriggeredAt: serverTimestamp(),
      schemaVersion: GUILD_SCHEMA_VERSION
    };

    if (!snapshot || !snapshot.data || (snapshot.data.windowStartedAt && new Date(snapshot.data.windowStartedAt).getTime() !== windowStartedAt.getTime())) {
      try {
        await docRef.set({
          data: {
            ...payloadBase,
            count,
            flaggedAt: null
          }
        });
      } catch (error) {
        if (error && /exists/i.test(error.errMsg || '')) {
          return monitorActionFrequency({ guildId, memberId, type, metadata });
        }
        throw error;
      }
    } else {
      const updatePayload = {
        lastTriggeredAt: serverTimestamp(),
        windowStartedAt,
        windowMs
      };
      if (command && typeof command.inc === 'function') {
        updatePayload.count = command.inc(1);
      } else {
        updatePayload.count = count;
      }
      await docRef.update({ data: updatePayload });
    }

    if (count >= threshold && !flaggedRecently) {
      try {
        await docRef.update({ data: { flaggedAt: serverTimestamp() } });
      } catch (error) {
        logger.warn('[guild] failed to update risk flag timestamp', error);
      }
      await recordRiskAlert({
        guildId,
        memberId,
        type,
        count,
        threshold,
        windowMs,
        metadata
      });
    }

    return { count, threshold, windowMs };
  }

  async function recordErrorLog(entry = {}) {
    try {
      await db.collection(COLLECTIONS.ERROR_LOGS).add({
        data: {
          ...entry,
          createdAt: serverTimestamp(),
          service: 'guild'
        }
      });
    } catch (error) {
      logger.warn('[guild] record error log failed', error);
    }
  }

  async function create(memberId, payload = {}) {
    const creation = await createGuild(memberId, payload);
    const overview = await getOverview(memberId);
    return wrapActionResponse('create', {
      guild: creation.guild,
      membership: overview.membership || null,
      ticket: overview.actionTicket || null,
      snapshot: {
        guild: creation.guild || null,
        membership: overview.membership || null
      }
    }, {
      code: 'GUILD_CREATED',
      message: '宗门创建成功'
    });
  }

  async function apply(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'apply');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('apply', { pending: true });
  }

  async function approve(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'approve');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('approve');
  }

  async function reject(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'reject');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('reject');
  }

  async function leave(memberId, payload = {}) {
    const result = await leaveGuild(memberId, payload);
    return wrapActionResponse('leave', {
      success: !!(result && result.success)
    }, {
      code: result && result.success ? 'SUCCESS' : 'NO_CHANGE',
      message: result && result.success ? '已退出宗门' : '无需退出'
    });
  }

  async function kick(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'kick');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('kick');
  }

  async function disband(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'disband');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('disband');
  }

  async function profile(memberId) {
    const overview = await getOverview(memberId);
    return wrapActionResponse('profile', {
      guild: overview.guild || null,
      membership: overview.membership || null,
      leaderboard: overview.leaderboard || [],
      ticket: overview.actionTicket || null,
      settings: overview.settings || null
    }, {
      message: '宗门信息获取成功'
    });
  }

  async function donate(memberId, payload = {}) {
    const membership = await loadMemberGuild(memberId);
    const guildId = membership && membership.guild ? membership.guild.id : null;
    const limitContext = await assertDailyLimit(memberId, 'donate', { guildId });
    await enforceRateLimit(memberId, 'donate');
    await enforceCooldown(memberId, 'donate');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    if (limitContext) {
      await reserveDailyQuota(limitContext);
    }
    await monitorActionFrequency({
      guildId,
      memberId,
      type: 'donate',
      metadata: {
        amount: Number(payload.amount) || 0,
        donationType: payload.type || 'stone'
      }
    });
    return buildPlaceholderResponse('donate', {
      donation: {
        amount: Number(payload.amount) || 0,
        type: payload.type || 'stone'
      }
    });
  }

  async function membersList(memberId, payload = {}) {
    if (!payload || !payload.cursor) {
      await enforceRateLimit(memberId, 'members.list');
    }
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const membership = await loadMemberGuild(memberId);
    if (!membership || !membership.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const guildId = membership.guild.id;
    const limit = sanitizePageSize(payload.limit, { defaultSize: 20, max: 100 });
    const offset = resolveOffsetCursor(payload.cursor);
    const query = db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId, status: 'active' })
      .orderBy('contribution', 'desc')
      .orderBy('power', 'desc')
      .orderBy('joinedAt', 'asc');
    const snapshot = await query
      .skip(offset)
      .limit(limit)
      .get()
      .catch((error) => {
        logger.error('[guild] load member list failed', error);
        return { data: [] };
      });
    const docs = (snapshot && snapshot.data ? snapshot.data : []).filter(Boolean);
    const memberIds = docs
      .map((doc) => normalizeMemberId(doc.memberId || doc._id || doc.id))
      .filter(Boolean);
    const [memberMap, extrasMap] = await Promise.all([
      loadDocumentsByIds(COLLECTIONS.MEMBERS, memberIds),
      loadDocumentsByIds(COLLECTIONS.MEMBER_EXTRAS, memberIds)
    ]);
    const members = docs
      .map((doc) => {
        const id = normalizeMemberId(doc.memberId || doc._id || doc.id);
        const memberDoc = id ? memberMap.get(id) || null : null;
        const extrasDoc = id ? extrasMap.get(id) || null : null;
        return buildGuildMemberListEntry(doc, { memberDoc, extrasDoc });
      })
      .filter(Boolean);
    const hasMore = docs.length === limit;
    const nextCursor = hasMore ? buildOffsetCursor(offset + docs.length) : null;
    return wrapActionResponse(
      'members.list',
      {
        guildId,
        members,
        pagination: {
          hasMore,
          next: nextCursor
        }
      },
      {
        message: '宗门成员列表已加载'
      }
    );
  }

  async function logsList(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'logs.list');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('logs.list', {
      logs: [],
      pagination: {
        hasMore: false,
        next: null
      }
    });
  }

  async function listTasks(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'tasks.list');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    return buildPlaceholderResponse('tasks.list', {
      tasks: [],
      filters: payload.filters || null
    });
  }

  async function claimTask(memberId, payload = {}) {
    const membership = await loadMemberGuild(memberId);
    const guildId = membership && membership.guild ? membership.guild.id : null;
    const limitContext = await assertDailyLimit(memberId, 'tasks.claim', { guildId });
    await enforceRateLimit(memberId, 'tasks.claim');
    await enforceCooldown(memberId, 'tasks.claim');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    if (limitContext) {
      await reserveDailyQuota(limitContext);
    }
    await monitorActionFrequency({
      guildId,
      memberId,
      type: 'tasks.claim',
      metadata: {
        taskId: payload.taskId || null
      }
    });
    return buildPlaceholderResponse('tasks.claim', {
      taskId: payload.taskId || null
    });
  }

  async function bossStatus(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'boss.status');
    await verifyActionTicket(memberId, payload.ticket, payload.signature, { consume: false });
    const settings = await loadSettings();
    const bossSettings = resolveBossSettings(settings.boss || DEFAULT_GUILD_BOSS_SETTINGS);
    const membership = await loadMemberGuild(memberId);
    if (!membership || !membership.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const rotationBossId = Array.isArray(bossSettings.rotation) && bossSettings.rotation.length
      ? bossSettings.rotation[0].bossId
      : null;
    const requestedBossId = toTrimmedString(payload.bossId);
    const bossId = requestedBossId || rotationBossId || DEFAULT_BOSS_ID;
    const baseDefinition = getBossDefinition(bossId);
    if (!baseDefinition) {
      throw createError('BOSS_NOT_FOUND', '未找到指定 Boss');
    }
    const definition = normalizeBossDefinition(baseDefinition);
    const { state } = await ensureBossState(membership.guild.id, definition);
    const nowDate = new Date();
    const bossPayload = buildBossStatusPayload({
      state,
      definition,
      settings: bossSettings,
      memberId,
      now: nowDate
    });
    const canChallenge =
      bossSettings.enabled &&
      (bossPayload.status !== 'ended' || bossPayload.hp.current > 0) &&
      bossPayload.attempts.remaining > 0 &&
      bossPayload.attempts.cooldownRemaining === 0;
    return wrapActionResponse(
      'boss.status',
      {
        boss: bossPayload,
        canChallenge,
        settings: {
          dailyAttempts: bossSettings.dailyAttempts,
          cooldownMs: bossSettings.cooldownMs,
          maxRounds: bossSettings.maxRounds
        }
      },
      {
        message: 'Boss 状态已加载'
      }
    );
  }

  async function bossChallenge(memberId, payload = {}) {
    let membership = await loadMemberGuild(memberId);
    if (!membership || !membership.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const guildId = membership.guild.id;
    const limitContext = await assertDailyLimit(memberId, 'boss.challenge', { guildId });
    await enforceRateLimit(memberId, 'boss.challenge');
    await enforceCooldown(memberId, 'boss.challenge');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const settings = await loadSettings();
    const bossSettings = resolveBossSettings(settings.boss || DEFAULT_GUILD_BOSS_SETTINGS);
    if (!bossSettings.enabled) {
      throw createError('BOSS_DISABLED', '宗门 Boss 系统已关闭');
    }
    membership = await loadMemberGuild(memberId);
    if (!membership || !membership.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const rotationBossId = Array.isArray(bossSettings.rotation) && bossSettings.rotation.length
      ? bossSettings.rotation[0].bossId
      : null;
    const requestedBossId = toTrimmedString(payload.bossId);
    const bossId = requestedBossId || rotationBossId || DEFAULT_BOSS_ID;
    const baseDefinition = getBossDefinition(bossId);
    if (!baseDefinition) {
      throw createError('BOSS_NOT_FOUND', '未找到指定 Boss');
    }
    const definition = normalizeBossDefinition(baseDefinition);
    const partySource = Array.isArray(payload.party) ? payload.party : Array.isArray(payload.members) ? payload.members : [];
    const normalizedParty = partySource
      .map((id) => toTrimmedString(id))
      .filter(Boolean);
    if (!normalizedParty.includes(memberId)) {
      normalizedParty.unshift(memberId);
    }
    const uniqueParty = Array.from(new Set(normalizedParty)).slice(0, 5);
    if (!uniqueParty.length) {
      uniqueParty.push(memberId);
    }
    const membershipSnapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId, status: 'active', memberId: command.in(uniqueParty) })
      .get();
    const membershipDocs = membershipSnapshot.data || [];
    if (membershipDocs.length !== uniqueParty.length) {
      throw createError('INVALID_MEMBER', '队伍成员存在异常或未在宗门内');
    }
    const memberSnapshot = await db
      .collection(COLLECTIONS.MEMBERS)
      .where({ _id: command.in(uniqueParty) })
      .get();
    const memberDocs = memberSnapshot.data || [];
    if (memberDocs.length !== uniqueParty.length) {
      throw createError('INVALID_MEMBER', '未找到全部队伍成员档案');
    }
    const memberDocMap = new Map();
    memberDocs.forEach((doc) => {
      const key = toTrimmedString(doc._id || doc.id || doc.memberId);
      if (key) {
        memberDocMap.set(key, doc);
      }
    });
    const partyMembers = uniqueParty.map((id) => {
      const membershipDoc = membershipDocs.find((doc) => doc.memberId === id);
      const memberDoc = memberDocMap.get(id);
      if (!membershipDoc || !memberDoc) {
        throw createError('INVALID_MEMBER', '队伍成员信息缺失');
      }
      return { memberId: id, membership: membershipDoc, member: memberDoc };
    });
    const { id: bossDocId, state: bossState } = await ensureBossState(guildId, definition);
    const todayKey = computeDateKey(new Date());
    const attemptLimit = bossSettings.dailyAttempts || BOSS_DAILY_ATTEMPT_LIMIT;
    const cooldownMs = bossSettings.cooldownMs || BOSS_MEMBER_COOLDOWN_MS;
    const attemptState = {};
    partyMembers.forEach((entry) => {
      const record = bossState.memberAttempts[entry.memberId];
      const sameDay = record && record.dateKey === todayKey;
      const used = sameDay ? Math.max(0, Math.round(Number(record.count || 0))) : 0;
      if (used >= attemptLimit) {
        throw createError('BOSS_ATTEMPTS_EXHAUSTED', '今日挑战次数已用尽');
      }
      const lastAt = record && record.lastChallengeAt ? new Date(record.lastChallengeAt) : null;
      if (lastAt && Date.now() - lastAt.getTime() < cooldownMs) {
        throw createError('BOSS_COOLDOWN', 'Boss 挑战冷却中，请稍后再试');
      }
      attemptState[entry.memberId] = { used, record };
    });
    if (limitContext) {
      await reserveDailyQuota(limitContext);
    }
    await monitorActionFrequency({
      guildId,
      memberId,
      type: 'boss.challenge',
      metadata: { bossId, partySize: uniqueParty.length }
    });
    const seed = toTrimmedString(payload.seed) || buildBossSeed(definition.id, memberId);
    const simulation = simulateBossBattle({
      guild: membership.guild,
      bossDefinition: definition,
      bossState,
      partyMembers,
      seed,
      maxRounds: bossSettings.maxRounds
    });
    const totalDamage = Object.values(simulation.damageByMember).reduce((acc, value) => acc + Math.max(0, Math.round(Number(value) || 0)), 0);
    const challengeTimestamp = serverTimestamp();
    const bossCollection = db.collection(COLLECTIONS.GUILD_BOSS);
    const updateData = {
      totalDamage: command.inc(Math.round(totalDamage)),
      hpLeft: command.inc(-Math.round(totalDamage)),
      updatedAt: challengeTimestamp
    };
    if (simulation.victory) {
      updateData.status = 'ended';
      updateData.defeatedAt = challengeTimestamp;
    }
    Object.keys(simulation.damageByMember).forEach((id) => {
      const damageValue = Math.max(0, Math.round(Number(simulation.damageByMember[id]) || 0));
      updateData[`damageByMember.${id}`] = command.inc(damageValue);
    });
    Object.keys(attemptState).forEach((id) => {
      const info = attemptState[id];
      updateData[`memberAttempts.${id}`] = {
        dateKey: todayKey,
        count: info.used + 1,
        lastChallengeAt: challengeTimestamp
      };
    });
    const applyBossUpdates = async (getSnapshot, applyUpdate) => {
      const snapshot = await getSnapshot();
      if (!snapshot || !snapshot.data) {
        throw createError('BOSS_NOT_FOUND', '未找到 Boss 状态');
      }
      const docData = snapshot.data || {};
      const currentAttempts =
        docData.memberAttempts && typeof docData.memberAttempts === 'object'
          ? { ...docData.memberAttempts }
          : {};
      const attemptUpdates = {};
      Object.keys(attemptState).forEach((id) => {
        const record = currentAttempts[id];
        const sameDay = record && record.dateKey === todayKey;
        const used = sameDay ? Math.max(0, Math.round(Number(record.count || 0))) : 0;
        if (used >= attemptLimit) {
          throw createError('BOSS_ATTEMPTS_EXHAUSTED', '今日挑战次数已用尽');
        }
        const nextCount = used + 1;
        attemptUpdates[id] = {
          dateKey: todayKey,
          count: nextCount,
          lastChallengeAt: challengeTimestamp
        };
        currentAttempts[id] = attemptUpdates[id];
      });
      const dataToApply = { ...updateData };
      Object.keys(attemptUpdates).forEach((id) => {
        dataToApply[`memberAttempts.${id}`] = attemptUpdates[id];
      });
      await applyUpdate(dataToApply);
      return { memberAttempts: currentAttempts };
    };

    let transactionResult;
    if (typeof db.runTransaction === 'function') {
      transactionResult = await db.runTransaction(async (transaction) => {
        const bossDocRef = transaction.collection(COLLECTIONS.GUILD_BOSS).doc(bossDocId);
        return applyBossUpdates(
          () => bossDocRef.get().catch(() => null),
          (data) => bossDocRef.update({ data })
        );
      });
    } else {
      transactionResult = await withBossUpdateLock(bossDocId, () =>
        applyBossUpdates(
          () => bossCollection.doc(bossDocId).get().catch(() => null),
          (data) => bossCollection.doc(bossDocId).update({ data })
        )
      );
    }
    if (simulation.victory) {
      await bossCollection.doc(bossDocId).update({ data: { hpLeft: 0 } }).catch(() => {});
    }
    const memberAttemptsSnapshot =
      transactionResult && transactionResult.memberAttempts
        ? transactionResult.memberAttempts
        : bossState.memberAttempts;
    const updatedState = {
      ...bossState,
      hpLeft: Math.max(0, bossState.hpLeft - Math.round(totalDamage)),
      totalDamage: (bossState.totalDamage || 0) + Math.round(totalDamage),
      status: simulation.victory ? 'ended' : bossState.status,
      damageByMember: { ...bossState.damageByMember },
      memberAttempts: { ...memberAttemptsSnapshot }
    };
    Object.keys(simulation.damageByMember).forEach((id) => {
      const previous = Math.max(0, Math.round(Number(updatedState.damageByMember[id]) || 0));
      const increment = Math.max(0, Math.round(Number(simulation.damageByMember[id]) || 0));
      updatedState.damageByMember[id] = previous + increment;
    });
    Object.keys(attemptState).forEach((id) => {
      const info = updatedState.memberAttempts[id];
      const fallback = attemptState[id];
      const count = info && Number.isFinite(Number(info.count))
        ? Math.max(0, Math.round(Number(info.count)))
        : fallback
          ? Math.max(0, Math.round(Number(fallback.used || 0))) + 1
          : 1;
      updatedState.memberAttempts[id] = {
        dateKey: todayKey,
        count,
        lastChallengeAt: new Date().toISOString()
      };
    });
    const partySummary = simulation.partyActors.map((actor) => ({
      memberId: actor.memberId,
      name: actor.displayName,
      role: actor.guildRole,
      damage: Math.max(0, Math.round(Number(simulation.damageByMember[actor.memberId]) || 0))
    }));
    await db.collection(COLLECTIONS.GUILD_BATTLES).add({
      data: {
        guildId: membership.guild.id,
        initiatorId: memberId,
        bossId: definition.id,
        bossName: definition.name,
        type: 'boss',
        party: partySummary,
        payload: simulation.payload,
        signature: simulation.payload.signature,
        seed,
        victory: simulation.victory,
        totalDamage: Math.round(totalDamage),
        rounds: simulation.rounds,
        createdAt: challengeTimestamp,
        schemaVersion: GUILD_SCHEMA_VERSION
      }
    });
    await recordEvent({
      type: 'bossChallenge',
      guildId: membership.guild.id,
      actorId: memberId,
      details: {
        bossId: definition.id,
        victory: simulation.victory,
        seed,
        totalDamage: Math.round(totalDamage),
        participants: partySummary
      }
    });
    await recordGuildLog({
      guildId: membership.guild.id,
      type: 'bossChallenge',
      actorId: memberId,
      payload: {
        bossId: definition.id,
        bossName: definition.name,
        victory: simulation.victory,
        damage: partySummary,
        seed
      }
    });
    const nowDate = new Date();
    const bossPayload = buildBossStatusPayload({
      state: updatedState,
      definition,
      settings: bossSettings,
      memberId,
      now: nowDate
    });
    const rewards = simulation.victory
      ? {
          stones: Math.max(0, Math.round(totalDamage / 1500)),
          contribution: Math.max(1, Math.round(totalDamage / 2000))
        }
      : {
          stones: Math.max(0, Math.round(totalDamage / 3000)),
          contribution: Math.max(0, Math.round(totalDamage / 4000))
        };
    return wrapActionResponse(
      'boss.challenge',
      {
        battle: simulation.payload,
        victory: simulation.victory,
        damage: partySummary,
        rewards,
        boss: bossPayload,
        leaderboard: buildBossLeaderboard(updatedState.damageByMember, 10),
        schemaVersion: BOSS_SCHEMA_VERSION
      },
      {
        message: simulation.victory ? 'Boss 已被击败' : 'Boss 挑战完成'
      }
    );
  }

  async function bossRank(memberId, payload = {}) {
    await verifyActionTicket(memberId, payload.ticket, payload.signature, { consume: false });
    const settings = await loadSettings();
    const bossSettings = resolveBossSettings(settings.boss || DEFAULT_GUILD_BOSS_SETTINGS);
    const membership = await loadMemberGuild(memberId);
    if (!membership || !membership.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const rotationBossId = Array.isArray(bossSettings.rotation) && bossSettings.rotation.length
      ? bossSettings.rotation[0].bossId
      : null;
    const requestedBossId = toTrimmedString(payload.bossId);
    const bossId = requestedBossId || rotationBossId || DEFAULT_BOSS_ID;
    const baseDefinition = getBossDefinition(bossId);
    if (!baseDefinition) {
      throw createError('BOSS_NOT_FOUND', '未找到指定 Boss');
    }
    const definition = normalizeBossDefinition(baseDefinition);
    const { state } = await ensureBossState(membership.guild.id, definition);
    const leaderboard = buildBossLeaderboard(state.damageByMember, BOSS_RANK_LIMIT);
    const selfDamage = leaderboard.find((entry) => entry.memberId === memberId) || {
      memberId,
      damage: Math.max(0, Math.round(Number(state.damageByMember[memberId]) || 0))
    };
    return wrapActionResponse(
      'boss.rank',
      {
        bossId: definition.id,
        bossName: definition.name,
        leaderboard,
        self: selfDamage,
        schemaVersion: BOSS_SCHEMA_VERSION,
        updatedAt: new Date().toISOString()
      },
      {
        message: 'Boss 榜单已加载'
      }
    );
  }

  async function getLeaderboardSnapshot(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'getLeaderboard');
    const requestedLimit = Number(payload.limit);
    const limit = clampLeaderboardLimit(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LEADERBOARD_LIMIT);
    const type = resolveLeaderboardType(payload.type);
    const forceRefresh = !!(payload.force || payload.refresh || payload.forceRefresh);
    const [membership, snapshot] = await Promise.all([
      loadMemberGuild(memberId),
      loadLeaderboardSnapshot({ type, limit, forceRefresh })
    ]);
    const responseType = resolveLeaderboardType(snapshot.type || type);
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries.slice(0, limit) : [];
    const guildId = membership && membership.guild ? membership.guild.id : null;
    let myRank = null;
    if (guildId) {
      const rankIndex = entries.findIndex((entry) => entry && entry.guildId === guildId);
      if (rankIndex >= 0) {
        myRank = rankIndex + 1;
      }
    }
    let updatedAtIso = null;
    if (snapshot.updatedAt) {
      const updatedDate = new Date(snapshot.updatedAt);
      if (!Number.isNaN(updatedDate.getTime())) {
        updatedAtIso = updatedDate.toISOString();
      }
    }
    return wrapActionResponse('getLeaderboard', {
      type: responseType,
      entries,
      updatedAt: updatedAtIso,
      myRank,
      memberId,
      schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION
    }, {
      message: forceRefresh ? '排行榜已刷新' : '排行榜已加载'
    });
  }

  async function getOverview(memberId) {
    const [settings, current, leaderboard, ticket] = await Promise.all([
      loadSettings(),
      loadMemberGuild(memberId),
      loadLeaderboard(),
      issueActionTicket(memberId)
    ]);
    return {
      guild: current ? current.guild : null,
      membership: current ? current.membership : null,
      leaderboard,
      actionTicket: ticket,
      settings
    };
  }

  /* istanbul ignore next */
  async function createGuild(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'createGuild');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const settings = await loadSettings();
    const name = sanitizeString(payload.name, { maxLength: 20 });
    if (!name) {
      throw createError('INVALID_NAME', '宗门名称不能为空');
    }
    const manifesto = sanitizeString(payload.manifesto || '', { maxLength: 120 });
    const icon = sanitizeString(payload.icon || '', { maxLength: 200 });
    const existingMembership = (await loadMemberGuild(memberId)) || {};
    if (existingMembership.guild) {
      throw createError('ALREADY_IN_GUILD', '已加入其他宗门');
    }
    const guildsCollection = db.collection(COLLECTIONS.GUILDS);
    const memberCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
    const createdAt = db.serverDate ? db.serverDate() : new Date();
    const memberPower = await resolveMemberPower(memberId, payload.powerRating, settings);
    const guildDoc = {
      name,
      manifesto,
      icon,
      founderId: memberId,
      memberCount: 1,
      power: 0,
      activityScore: 0,
      createdAt,
      schemaVersion: GUILD_SCHEMA_VERSION
    };
    const guildCreateResult = await guildsCollection.add({ data: guildDoc });
    const guildId = guildCreateResult.id || guildCreateResult._id;
    await memberCollection.add({
      data: {
        guildId,
        memberId,
        role: 'leader',
        status: 'active',
        joinedAt: createdAt,
        contribution: 0,
        power: memberPower,
        schemaVersion: GUILD_SCHEMA_VERSION
      }
    });
    await recordEvent({
      type: 'createGuild',
      guildId,
      actorId: memberId,
      details: { name }
    });
    await refreshLeaderboardCache();
    const guildSnapshot = await guildsCollection.doc(guildId).get();
    const guild = decorateGuild({ ...guildSnapshot.data, _id: guildId });
    return wrapActionResponse(
      'createGuild',
      { guild },
      {
        code: 'GUILD_CREATED',
        message: '宗门创建成功'
      }
    );
  }

  /* istanbul ignore next */
  async function joinGuild(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'joinGuild');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const settings = await loadSettings();
    const guildId = sanitizeString(payload.guildId, { maxLength: 64 });
    if (!guildId) {
      throw createError('INVALID_GUILD', '宗门不存在');
    }
    const memberPower = await resolveMemberPower(memberId, payload.powerRating, settings);
    const current = await loadMemberGuild(memberId);
    if (current && current.guild) {
      throw createError('ALREADY_IN_GUILD', '请先退出当前宗门');
    }
    const guildDocSnapshot = await db.collection(COLLECTIONS.GUILDS).doc(guildId).get();
    const guildDoc = guildDocSnapshot.data;
    if (!guildDoc) {
      throw createError('GUILD_NOT_FOUND', '宗门不存在');
    }
    if (guildDoc.memberCount >= settings.maxMembers) {
      throw createError('GUILD_FULL', '宗门人数已满');
    }
    const memberCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
    const existingMembership = await memberCollection
      .where({ guildId, memberId })
      .limit(1)
      .get();
    const record = existingMembership.data && existingMembership.data[0];
    if (record && record.status === 'active') {
      throw createError('ALREADY_IN_GUILD', '已加入该宗门');
    }
    const nowDate = db.serverDate ? db.serverDate() : new Date();
    if (record) {
      await memberCollection.doc(record._id).update({
        data: {
          status: 'active',
          rejoinedAt: nowDate,
          power: memberPower
        }
      });
    } else {
      await memberCollection.add({
        data: {
          guildId,
          memberId,
          role: 'member',
          status: 'active',
          joinedAt: nowDate,
          contribution: 0,
          power: memberPower,
          schemaVersion: GUILD_SCHEMA_VERSION
        }
      });
    }
    await db
      .collection(COLLECTIONS.GUILDS)
      .doc(guildId)
      .update({
        data: {
          memberCount: command.inc(1),
          updatedAt: nowDate
        }
      });
    await recordEvent({ type: 'joinGuild', guildId, actorId: memberId });
    await refreshLeaderboardCache();
    return {
      guild: decorateGuild({ ...guildDoc, _id: guildId, memberCount: guildDoc.memberCount + 1 })
    };
  }

  /* istanbul ignore next */
  async function leaveGuild(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'leaveGuild');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const current = await loadMemberGuild(memberId);
    if (!current || !current.guild) {
      throw createError('NOT_IN_GUILD', '尚未加入宗门');
    }
    if (current.membership.role === 'leader') {
      throw createError('LEADER_CANNOT_LEAVE', '请先转让宗主再退出');
    }
    const guildId = current.guild.id;
    const memberCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
    await memberCollection.doc(current.membership._id).update({
      data: {
        status: 'inactive',
        leftAt: db.serverDate ? db.serverDate() : new Date()
      }
    });
    await db
      .collection(COLLECTIONS.GUILDS)
      .doc(guildId)
      .update({
        data: {
          memberCount: command.inc(-1),
          updatedAt: db.serverDate ? db.serverDate() : new Date()
        }
      });
    await recordEvent({ type: 'leaveGuild', guildId, actorId: memberId });
    await refreshLeaderboardCache();
    return { success: true };
  }

  /* istanbul ignore next */
  async function initiateTeamBattle(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'initiateTeamBattle');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const current = await loadMemberGuild(memberId);
    if (!current || !current.guild) {
      throw createError('NOT_IN_GUILD', '请先加入宗门');
    }
    const guild = current.guild;
    const memberIds = Array.isArray(payload.members) ? payload.members : [memberId];
    const difficulty = Number(payload.difficulty) || 1;
    const memberCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
    const snapshot = await memberCollection
      .where({ guildId: guild.id, status: 'active', memberId: command.in(memberIds) })
      .limit(memberIds.length)
      .get();
    const teamDocs = snapshot.data || [];
    const teamMembers = teamDocs.map((doc) => ({
      memberId: doc.memberId,
      power: Number(doc.power) || 0,
      displayName: doc.displayName || ''
    }));
    if (!teamMembers.length) {
      throw createError('TEAM_NOT_FOUND', '缺少队伍成员');
    }
    const seed = resolveBattleSeed(guild.id, difficulty, now());
    const { payload: battlePayload, victory } = buildTeamBattlePayload({
      guild,
      teamMembers,
      difficulty,
      seed
    });
    const battleCollection = db.collection(COLLECTIONS.GUILD_BATTLES);
    const createdAt = db.serverDate ? db.serverDate() : new Date();
    await battleCollection.add({
      data: {
        guildId: guild.id,
        initiatorId: memberId,
        team: teamMembers,
        difficulty,
        payload: battlePayload,
        signature: battlePayload.signature,
        victory,
        createdAt,
        schemaVersion: GUILD_SCHEMA_VERSION
      }
    });
    const powerGain = victory ? teamMembers.reduce((acc, member) => acc + (member.power || 0), 0) : 0;
    await db
      .collection(COLLECTIONS.GUILDS)
      .doc(guild.id)
      .update({
        data: {
          power: command.inc(Math.floor(powerGain / 10)),
          activityScore: command.inc(victory ? 5 : 1),
          updatedAt: createdAt
        }
      });
    await recordEvent({
      type: 'teamBattle',
      guildId: guild.id,
      actorId: memberId,
      details: {
        difficulty,
        victory,
        teamSize: teamMembers.length,
        seed
      }
    });
    await refreshLeaderboardCache();
    return {
      battle: battlePayload,
      rewards: victory
        ? {
            stones: Math.max(0, Math.floor(powerGain / 50)),
            contribution: Math.max(1, Math.floor(powerGain / 100))
          }
        : {
            stones: 0,
            contribution: 0
          }
    };
  }

  return {
    create,
    apply,
    approve,
    reject,
    leave,
    kick,
    disband,
    profile,
    donate,
    membersList,
    logsList,
    tasksList: listTasks,
    tasksClaim: claimTask,
    bossStatus,
    bossChallenge,
    bossRank,
    getLeaderboard: getLeaderboardSnapshot,
    getOverview,
    listGuilds,
    listRiskAlerts: listRiskAlertsForAdmin,
    adminGetSystemOverview: getGuildSystemOverviewForAdmin,
    adminResetGuildSystem: resetGuildSystemForAdmin,
    adminUpdateGuildSettings: updateGuildSettingsForAdmin,
    adminListGuilds: listGuildsForAdmin,
    adminGetGuildDetail: getGuildDetailForAdmin,
    adminGetGuildMembers: listGuildMembersForAdmin,
    createGuild,
    joinGuild,
    leaveGuild,
    initiateTeamBattle,
    issueActionTicket,
    verifyActionTicket,
    loadSettings,
    recordGuildLog,
    recordErrorLog,
    recordSecurityEvent,
    enforceRateLimit,
    enforceCooldown
  };
}

function createError(code, message) {
  const error = new Error(message || '发生未知错误');
  error.code = code;
  error.errCode = code;
  return error;
}

module.exports = {
  createGuildService,
  createError,
  GUILD_SCHEMA_VERSION,
  LEADERBOARD_CACHE_SCHEMA_VERSION
};
