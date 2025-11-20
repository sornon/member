const { COLLECTIONS } = require('common-config');

const GUILD_COLLECTIONS = [
  {
    name: COLLECTIONS.GUILDS,
    indexes: [
      { key: { name: 1 }, options: { name: 'idx_name_unique', unique: true } },
      { key: { name: 'text' }, options: { name: 'idx_name_text' } },
      { key: { leaderId: 1, updatedAt: -1 }, options: { name: 'idx_leader' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_MEMBERS,
    indexes: [
      { key: { guildId: 1, role: 1 }, options: { name: 'idx_guild_role' } },
      { key: { memberId: 1 }, options: { name: 'idx_member' } },
      { key: { guildId: 1, contributionWeek: -1 }, options: { name: 'idx_week_contribution' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_TASKS,
    indexes: [
      { key: { guildId: 1, status: 1, endAt: -1 }, options: { name: 'idx_guild_status' } },
      { key: { endAt: 1 }, options: { name: 'idx_end_at' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_BOSS,
    indexes: [
      { key: { guildId: 1, status: 1 }, options: { name: 'idx_guild_status' } },
      { key: { guildId: 1, schemaVersion: -1 }, options: { name: 'idx_schema_version' } },
      { key: { updatedAt: -1 }, options: { name: 'idx_updated_at_desc' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_BATTLES,
    indexes: [
      { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_guild_created_desc' } },
      { key: { signature: 1 }, options: { name: 'idx_signature_unique', unique: true } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_LEADERBOARD,
    indexes: [
      { key: { updatedAt: -1 }, options: { name: 'idx_updated_at_desc' } },
      { key: { schemaVersion: -1 }, options: { name: 'idx_schema_version' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_LOGS,
    indexes: [
      { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_guild_logs_recent' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_CACHE,
    indexes: []
  },
  {
    name: COLLECTIONS.GUILD_EVENT_LOGS,
    indexes: [
      { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_guild_event_logs_recent' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_TICKETS,
    indexes: [
      { key: { signature: 1 }, options: { name: 'idx_guild_ticket_signature_unique', unique: true } },
      { key: { memberId: 1, consumed: 1 }, options: { name: 'idx_guild_ticket_member_consumed' } },
      { key: { expiresAt: 1 }, options: { name: 'idx_guild_ticket_expires' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_RATE_LIMITS,
    indexes: [
      { key: { memberId: 1, action: 1 }, options: { name: 'idx_guild_rate_limit_member_action', unique: true } },
      { key: { expiresAt: 1 }, options: { name: 'idx_guild_rate_limit_expires' } }
    ]
  }
];

const SAMPLE_GUILD_ID = 'guild_demo_crane';
const SAMPLE_LEADER_ID = 'member_demo_leader';
const SAMPLE_OFFICER_ID = 'member_demo_officer';
const SAMPLE_MEMBER_ID = 'member_demo_disciple';

function getLogger(context = {}) {
  const fallback = () => {};
  const logger = context.logger || {};
  return {
    info: logger.info || console.log,
    warn: logger.warn || console.warn,
    error: logger.error || console.error,
    debug: logger.debug || fallback
  };
}

async function ensureCollection(db, name, logger) {
  try {
    await db.collection(name).limit(1).get();
    logger.info(`[guild-init] collection ${name} exists`);
  } catch (error) {
    if (error && /not exist/i.test(error.errMsg || '')) {
      logger.info(`[guild-init] creating collection ${name}`);
      await db.createCollection(name);
      return;
    }
    throw error;
  }
}

async function ensureIndexes(db, name, indexes = [], logger) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return;
  }

  const collection = db.collection(name);
  if (typeof collection.createIndex !== 'function') {
    logger.warn(
      `[guild-init] current SDK does not support createIndex(), skip ensuring indexes for ${name}`
    );
    logger.warn(
      `[guild-init] please confirm the following indexes manually: ${
        indexes
          .map((index) => (index.options && index.options.name) || JSON.stringify(index.key))
          .join(', ')
      }`
    );
    return;
  }

  for (const index of indexes) {
    try {
      await collection.createIndex(index.key, index.options || {});
      logger.info(
        `[guild-init] ensured index ${
          (index.options && index.options.name) || JSON.stringify(index.key)
        } on ${name}`
      );
    } catch (error) {
      if (error && /already exist/i.test(error.errMsg || '')) {
        logger.info(`[guild-init] index exists on ${name}`);
        continue;
      }
      throw error;
    }
  }
}

async function ensureDocument(collection, collectionName, docId, data, logger) {
  const snapshot = await collection
    .doc(docId)
    .get()
    .catch((error) => {
      if (error && /not exist|not found/i.test(error.errMsg || '')) {
        return null;
      }
      throw error;
    });
  if (snapshot && snapshot.data) {
    logger.info(`[guild-init] document ${docId} already exists in ${collectionName}`);
    return false;
  }
  await collection.doc(docId).set({ data });
  logger.info(`[guild-init] created document ${docId} in ${collectionName}`);
  return true;
}

async function seedSampleData(db, logger) {
  const now = new Date();

  const guildsCollection = db.collection(COLLECTIONS.GUILDS);

  const existingGuildsSnapshot = await guildsCollection
    .limit(1)
    .get()
    .catch((error) => {
      if (error && /not exist|not found/i.test(error.errMsg || '')) {
        return { data: [] };
      }
      throw error;
    });

  const hasExistingGuilds = Array.isArray(existingGuildsSnapshot.data)
    ? existingGuildsSnapshot.data.length > 0
    : typeof existingGuildsSnapshot.total === 'number'
    ? existingGuildsSnapshot.total > 0
    : false;

  if (hasExistingGuilds) {
    logger.info('[guild-init] existing guild detected, skip seeding sample data');
    return;
  }

  const guildCreated = await ensureDocument(
    guildsCollection,
    COLLECTIONS.GUILDS,
    SAMPLE_GUILD_ID,
    {
      name: '云鹤仙宗',
      badge: 'badge_crane',
      level: 3,
      notice: '欢迎各位道友，共赴云海问仙。',
      leaderId: SAMPLE_LEADER_ID,
      officerIds: [SAMPLE_OFFICER_ID],
      memberCount: 3,
      capacity: 30,
      exp: 12800,
      tech: {
        alchemy: 2,
        blacksmith: 1
      },
      createdAt: now,
      updatedAt: now
    },
    logger
  );

  const membersCollection = db.collection(COLLECTIONS.GUILD_MEMBERS);
  if (guildCreated) {
    await ensureDocument(
      membersCollection,
      COLLECTIONS.GUILD_MEMBERS,
      `${SAMPLE_GUILD_ID}_leader`,
      {
        guildId: SAMPLE_GUILD_ID,
        memberId: SAMPLE_LEADER_ID,
        role: 'leader',
        contributionTotal: 4200,
        contributionWeek: 320,
        activity: 98,
        joinedAt: now,
        updatedAt: now
      },
      logger
    );
    await ensureDocument(
      membersCollection,
      COLLECTIONS.GUILD_MEMBERS,
      `${SAMPLE_GUILD_ID}_officer`,
      {
        guildId: SAMPLE_GUILD_ID,
        memberId: SAMPLE_OFFICER_ID,
        role: 'officer',
        contributionTotal: 2800,
        contributionWeek: 260,
        activity: 87,
        joinedAt: now,
        updatedAt: now
      },
      logger
    );
    await ensureDocument(
      membersCollection,
      COLLECTIONS.GUILD_MEMBERS,
      `${SAMPLE_GUILD_ID}_disciple`,
      {
        guildId: SAMPLE_GUILD_ID,
        memberId: SAMPLE_MEMBER_ID,
        role: 'member',
        contributionTotal: 920,
        contributionWeek: 110,
        activity: 74,
        joinedAt: now,
        updatedAt: now
      },
      logger
    );
  }

  const tasksCollection = db.collection(COLLECTIONS.GUILD_TASKS);
  await ensureDocument(
    tasksCollection,
    COLLECTIONS.GUILD_TASKS,
    `${SAMPLE_GUILD_ID}_task_trial`,
    {
      guildId: SAMPLE_GUILD_ID,
      taskId: 'guild_trial_elite',
      type: 'trial',
      title: '云海试炼·守护灵峰',
      goal: { metric: 'damage', target: 5000 },
      progress: { metric: 'damage', current: 1860 },
      reward: { contribution: 180, items: ['elixir_basic'] },
      status: 'open',
      startAt: now,
      endAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      updatedAt: now,
      schemaVersion: 1
    },
    logger
  );

  const bossCollection = db.collection(COLLECTIONS.GUILD_BOSS);
  await ensureDocument(
    bossCollection,
    COLLECTIONS.GUILD_BOSS,
    `${SAMPLE_GUILD_ID}_boss_default`,
    {
      guildId: SAMPLE_GUILD_ID,
      bossId: 'boss_crane_guardian',
      level: 3,
      status: 'open',
      hpMax: 180000,
      hpLeft: 145600,
      totalDamage: 34400,
      damageByMember: {
        [SAMPLE_LEADER_ID]: 18200,
        [SAMPLE_OFFICER_ID]: 9600,
        [SAMPLE_MEMBER_ID]: 6600
      },
      memberAttempts: {
        [SAMPLE_LEADER_ID]: { dateKey: '2025-01-01', count: 2, lastChallengeAt: now },
        [SAMPLE_OFFICER_ID]: { dateKey: '2025-01-01', count: 2, lastChallengeAt: now },
        [SAMPLE_MEMBER_ID]: { dateKey: '2025-01-01', count: 1, lastChallengeAt: now }
      },
      phase: 1,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now
    },
    logger
  );

  const leaderboardCollection = db.collection(COLLECTIONS.GUILD_LEADERBOARD);
  await ensureDocument(
    leaderboardCollection,
    COLLECTIONS.GUILD_LEADERBOARD,
    'contribution',
    {
      metricType: 'contribution',
      entries: [
        { guildId: SAMPLE_GUILD_ID, name: '云鹤仙宗', score: 48200, rank: 1 },
        { guildId: 'guild_demo_phoenix', name: '炎羽天宫', score: 41320, rank: 2 }
      ],
      updatedAt: now,
      schemaVersion: 1
    },
    logger
  );

  const guildLogsCollection = db.collection(COLLECTIONS.GUILD_LOGS);
  await ensureDocument(
    guildLogsCollection,
    COLLECTIONS.GUILD_LOGS,
    `${SAMPLE_GUILD_ID}_log_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      type: 'donate',
      actorId: SAMPLE_OFFICER_ID,
      details: { amount: 200, templateId: 'donate-spirit-stone' },
      createdAt: now,
      schemaVersion: 1
    },
    logger
  );

  const battlesCollection = db.collection(COLLECTIONS.GUILD_BATTLES);
  await ensureDocument(
    battlesCollection,
    COLLECTIONS.GUILD_BATTLES,
    `${SAMPLE_GUILD_ID}_battle_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      initiatorId: SAMPLE_LEADER_ID,
      team: [
        { memberId: SAMPLE_LEADER_ID, power: 520 },
        { memberId: SAMPLE_OFFICER_ID, power: 430 }
      ],
      difficulty: 3,
      payload: {
        signature: 'sample_battle_signature',
        seed: 'demo_seed_2025'
      },
      signature: 'sample_battle_signature',
      victory: true,
      createdAt: now,
      schemaVersion: 1
    },
    logger
  );

  const cacheCollection = db.collection(COLLECTIONS.GUILD_CACHE);
  await ensureDocument(
    cacheCollection,
    COLLECTIONS.GUILD_CACHE,
    'leaderboard',
    {
      schemaVersion: 1,
      generatedAt: now,
      data: [
        { guildId: SAMPLE_GUILD_ID, power: 12800, rank: 1 },
        { guildId: 'guild_demo_phoenix', power: 9870, rank: 2 }
      ]
    },
    logger
  );

  const eventLogsCollection = db.collection(COLLECTIONS.GUILD_EVENT_LOGS);
  await ensureDocument(
    eventLogsCollection,
    COLLECTIONS.GUILD_EVENT_LOGS,
    `${SAMPLE_GUILD_ID}_event_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      type: 'teamBattle',
      actorId: SAMPLE_LEADER_ID,
      details: { difficulty: 3, teamSize: 2 },
      createdAt: now,
      schemaVersion: 1
    },
    logger
  );

  const ticketsCollection = db.collection(COLLECTIONS.GUILD_TICKETS);
  await ensureDocument(
    ticketsCollection,
    COLLECTIONS.GUILD_TICKETS,
    `${SAMPLE_MEMBER_ID}_ticket_demo`,
    {
      memberId: SAMPLE_MEMBER_ID,
      signature: 'sample_ticket_signature',
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      consumed: false,
      schemaVersion: 1
    },
    logger
  );

  const rateLimitCollection = db.collection(COLLECTIONS.GUILD_RATE_LIMITS);
  await ensureDocument(
    rateLimitCollection,
    COLLECTIONS.GUILD_RATE_LIMITS,
    `${SAMPLE_MEMBER_ID}_initiateTeamBattle`,
    {
      memberId: SAMPLE_MEMBER_ID,
      action: 'initiateTeamBattle',
      lastTriggeredAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      schemaVersion: 1
    },
    logger
  );
}

module.exports = async function runGuildInit({ db, logger }) {
  if (!db) {
    throw new Error('Missing database instance for guild init migration');
  }
  const log = getLogger(logger ? { logger } : {});

  for (const { name, indexes } of GUILD_COLLECTIONS) {
    await ensureCollection(db, name, log);
    await ensureIndexes(db, name, indexes, log);
  }

  await seedSampleData(db, log);

  return {
    migration: '2025-01-guild-init',
    collections: GUILD_COLLECTIONS.map((item) => item.name)
  };
};
