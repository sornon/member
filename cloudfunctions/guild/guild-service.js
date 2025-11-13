const crypto = require('crypto');
const { COLLECTIONS } = require('common-config');
const { clamp } = require('combat-system');
const { createBattlePayload } = require('battle-schema');
const {
  normalizeGuildSettings,
  DEFAULT_GUILD_SETTINGS
} = require('system-settings');

const GUILD_SCHEMA_VERSION = 1;
const LEADERBOARD_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_TICKET_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RATE_LIMITS = Object.freeze({
  createGuild: 60 * 1000,
  joinGuild: 30 * 1000,
  leaveGuild: 15 * 1000,
  initiateTeamBattle: 10 * 1000
});

function createGuildService(options = {}) {
  const db = options.db;
  const command = options.command;
  if (!db || !command) {
    throw new Error('GuildService requires db and command');
  }
  const logger = options.logger || console;
  const settingsLoader = typeof options.loadSettings === 'function'
    ? options.loadSettings
    : async () => DEFAULT_GUILD_SETTINGS;

  let settingsCache = {
    loadedAt: 0,
    settings: normalizeGuildSettings(DEFAULT_GUILD_SETTINGS)
  };

  function now() {
    return Date.now();
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

  async function verifyActionTicket(memberId, ticket, providedSignature) {
    const settings = await loadSettings();
    const secret = settings.secret || 'guild_secret';
    const normalizedTicket = sanitizeString(ticket, { maxLength: 64 });
    if (!normalizedTicket) {
      throw createError('INVALID_TICKET', '令牌无效');
    }
    const signature = buildTicketSignature(normalizedTicket, secret);
    if (providedSignature && providedSignature !== signature) {
      throw createError('INVALID_TICKET_SIGNATURE', '令牌签名不匹配');
    }
    const docId = buildTicketDocId(memberId, signature);
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_TICKETS)
      .doc(docId)
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    if (!snapshot || !snapshot.data) {
      throw createError('TICKET_NOT_FOUND', '令牌不存在或已过期');
    }
    const doc = snapshot.data;
    const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() < now()) {
      throw createError('TICKET_EXPIRED', '令牌已过期');
    }
    await db
      .collection(COLLECTIONS.GUILD_TICKETS)
      .doc(docId)
      .update({
        data: {
          consumed: false,
          lastUsedAt: db.serverDate ? db.serverDate() : new Date(),
          uses: command.inc(1)
        }
      })
      .catch((error) => logger.warn('[guild] ticket update failed', error));
    return true;
  }

  async function recordEvent(event = {}) {
    try {
      await db.collection(COLLECTIONS.GUILD_EVENT_LOGS).add({
        data: {
          ...event,
          schemaVersion: GUILD_SCHEMA_VERSION,
          createdAt: db.serverDate ? db.serverDate() : new Date()
        }
      });
    } catch (error) {
      logger.warn('[guild] record event failed', error);
    }
  }

  async function enforceRateLimit(memberId, action) {
    const windowMs = DEFAULT_RATE_LIMITS[action];
    if (!windowMs) {
      return;
    }
    const keySource = `${memberId}:${action}`;
    const docId = crypto.createHash('md5').update(keySource).digest('hex');
    const collection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
    const nowTs = now();
    const expiresAt = new Date(nowTs + windowMs);
    const existing = await collection
      .doc(docId)
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    if (existing && existing.data) {
      const lastAt = existing.data.lastTriggeredAt ? new Date(existing.data.lastTriggeredAt) : null;
      if (lastAt && nowTs - lastAt.getTime() < windowMs) {
        throw createError('RATE_LIMITED', '操作过于频繁，请稍后再试');
      }
    }
    await collection
      .doc(docId)
      .set({
        data: {
          memberId,
          action,
          lastTriggeredAt: db.serverDate ? db.serverDate() : new Date(),
          expiresAt,
          schemaVersion: GUILD_SCHEMA_VERSION
        }
      })
      .catch((error) => {
        if (error && /exists/i.test(error.errMsg || '')) {
          return collection.doc(docId).update({
            data: {
              lastTriggeredAt: db.serverDate ? db.serverDate() : new Date(),
              expiresAt
            }
          });
        }
        throw error;
      });
  }

  function decorateGuild(doc = {}) {
    if (!doc || typeof doc !== 'object') {
      return null;
    }
    return {
      id: doc._id || doc.id || null,
      name: doc.name || '未命名宗门',
      icon: doc.icon || '',
      manifesto: doc.manifesto || '',
      founderId: doc.founderId || '',
      memberCount: doc.memberCount || 0,
      power: doc.power || 0,
      activityScore: doc.activityScore || 0,
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
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    return {
      membership: record,
      guild: decorateGuild((guildSnapshot && guildSnapshot.data) || {})
    };
  }

  async function refreshLeaderboardCache() {
    const collection = db.collection(COLLECTIONS.GUILD_CACHE);
    const leaderboardSnapshot = await db
      .collection(COLLECTIONS.GUILDS)
      .orderBy('power', 'desc')
      .limit(20)
      .get();
    const guilds = (leaderboardSnapshot.data || []).map((item) => decorateGuild(item));
    const payload = {
      _id: 'leaderboard',
      schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION,
      generatedAt: db.serverDate ? db.serverDate() : new Date(),
      data: guilds
    };
    await collection.doc('leaderboard').set({ data: payload }).catch((error) => {
      if (error && /exists/i.test(error.errMsg || '')) {
        return collection.doc('leaderboard').update({
          data: {
            schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION,
            data: guilds,
            generatedAt: db.serverDate ? db.serverDate() : new Date()
          }
        });
      }
      throw error;
    });
    return guilds;
  }

  async function loadLeaderboard(options = {}) {
    const { force = false } = options;
    if (force) {
      return refreshLeaderboardCache();
    }
    const settings = await loadSettings();
    const ttl = settings.leaderboardCacheTtlMs || DEFAULT_LEADERBOARD_CACHE_TTL_MS;
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_CACHE)
      .doc('leaderboard')
      .get()
      .catch((error) => {
        if (error && /not exist/i.test(error.errMsg || '')) {
          return null;
        }
        throw error;
      });
    if (!snapshot || !snapshot.data) {
      return refreshLeaderboardCache();
    }
    const doc = snapshot.data;
    const generatedAt = doc.generatedAt ? new Date(doc.generatedAt) : null;
    if (doc.schemaVersion !== LEADERBOARD_CACHE_SCHEMA_VERSION || (generatedAt && now() - generatedAt.getTime() > ttl)) {
      return refreshLeaderboardCache();
    }
    return Array.isArray(doc.data) ? doc.data : [];
  }

  function resolveBattleSeed(guildId, difficulty, timestamp = now()) {
    const base = `${guildId}:${difficulty}:${timestamp}`;
    return crypto.createHash('md5').update(base).digest('hex').slice(0, 16);
  }

  function createBattleTimeline(teamMembers, enemyPower, seed) {
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

  function buildBattlePayload({ guild, teamMembers, difficulty, seed }) {
    const enemyBase = 1000 + difficulty * 250;
    const enemyPower = clamp(enemyBase, 1000, 100000);
    const { timeline, rounds, victory, remainingEnemy } = createBattleTimeline(teamMembers, enemyPower, seed);
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

  async function listGuilds() {
    const leaderboard = await loadLeaderboard();
    return { guilds: leaderboard };
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
    const { guild } = await loadMemberGuild(memberId) || {};
    if (guild) {
      throw createError('ALREADY_IN_GUILD', '已加入其他宗门');
    }
    const guildsCollection = db.collection(COLLECTIONS.GUILDS);
    const memberCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
    const createdAt = db.serverDate ? db.serverDate() : new Date();
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
        power: Number(payload.powerRating) || 0,
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
    return { guild: decorateGuild({ ...guildSnapshot.data, _id: guildId }) };
  }

  async function joinGuild(memberId, payload = {}) {
    await enforceRateLimit(memberId, 'joinGuild');
    await verifyActionTicket(memberId, payload.ticket, payload.signature);
    const settings = await loadSettings();
    const guildId = sanitizeString(payload.guildId, { maxLength: 64 });
    if (!guildId) {
      throw createError('INVALID_GUILD', '宗门不存在');
    }
    const memberPower = Number(payload.powerRating) || 0;
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
    const { payload: battlePayload, victory } = buildBattlePayload({ guild, teamMembers, difficulty, seed });
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
    getOverview,
    listGuilds,
    createGuild,
    joinGuild,
    leaveGuild,
    initiateTeamBattle,
    issueActionTicket,
    verifyActionTicket,
    loadSettings
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
