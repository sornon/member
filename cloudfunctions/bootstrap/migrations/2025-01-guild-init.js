const { COLLECTIONS } = require('common-config');

const GUILD_COLLECTIONS = [
  {
    name: COLLECTIONS.GUILDS,
    indexes: [
      { key: { name: 1 }, options: { name: 'idx_guild_name_unique', unique: true } },
      { key: { name: 'text' }, options: { name: 'idx_guild_name_text' } },
      { key: { leaderId: 1 }, options: { name: 'idx_guild_leader' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_MEMBERS,
    indexes: [
      { key: { guildId: 1, role: 1 }, options: { name: 'idx_guild_member_role' } },
      { key: { memberId: 1 }, options: { name: 'idx_guild_member_lookup' } },
      { key: { contributionWeek: -1 }, options: { name: 'idx_guild_contribution_week_desc' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_TASKS,
    indexes: [
      { key: { guildId: 1, status: 1 }, options: { name: 'idx_guild_task_status' } },
      { key: { endAt: 1 }, options: { name: 'idx_guild_task_end' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_BOSS,
    indexes: [
      { key: { guildId: 1 }, options: { name: 'idx_guild_boss_guild' } },
      { key: { status: 1 }, options: { name: 'idx_guild_boss_status' } },
      { key: { endsAt: 1 }, options: { name: 'idx_guild_boss_ends' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_LEADERBOARD,
    indexes: [
      { key: { schemaVersion: 1 }, options: { name: 'idx_guild_leaderboard_schema' } }
    ]
  },
  {
    name: COLLECTIONS.GUILD_LOGS,
    indexes: [
      { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_guild_logs_recent' } }
    ]
  }
];

const SAMPLE_GUILD_ID = 'guild_demo_crane';
const SAMPLE_LEADER_ID = 'member_demo_leader';
const SAMPLE_OFFICER_ID = 'member_demo_officer';
const SAMPLE_MEMBER_ID = 'member_demo_disciple';
const SAMPLE_LEADERBOARD_ID = 'season_demo_2025';

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
  const collection = db.collection(name);
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
    `${SAMPLE_GUILD_ID}_trial_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      taskId: 'guild_trial_elite',
      type: 'trial',
      title: '云海试炼：灵木守护',
      goal: { type: 'defeat', target: 15 },
      progress: { current: 12, target: 15 },
      reward: { stones: 120, contribution: 60 },
      status: 'open',
      startAt: now,
      endAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      updatedAt: now
    },
    logger
  );
  await ensureDocument(
    tasksCollection,
    COLLECTIONS.GUILD_TASKS,
    `${SAMPLE_GUILD_ID}_donation_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      taskId: 'guild_donation_weekly',
      type: 'donation',
      title: '灵石捐献',
      goal: { type: 'donate', target: 3000 },
      progress: { current: 1450, target: 3000 },
      reward: { contribution: 40 },
      status: 'open',
      startAt: now,
      endAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
      updatedAt: now
    },
    logger
  );

  const bossCollection = db.collection(COLLECTIONS.GUILD_BOSS);
  await ensureDocument(
    bossCollection,
    COLLECTIONS.GUILD_BOSS,
    `${SAMPLE_GUILD_ID}_boss_current`,
    {
      guildId: SAMPLE_GUILD_ID,
      bossId: 'ancient_spirit_tree',
      level: 5,
      hpMax: 500000,
      hpLeft: 312000,
      phase: 2,
      refreshedAt: now,
      endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      status: 'open',
      leaderboard: [
        { memberId: SAMPLE_LEADER_ID, damage: 82000 },
        { memberId: SAMPLE_OFFICER_ID, damage: 65500 },
        { memberId: SAMPLE_MEMBER_ID, damage: 28750 }
      ]
    },
    logger
  );

  const leaderboardCollection = db.collection(COLLECTIONS.GUILD_LEADERBOARD);
  await ensureDocument(
    leaderboardCollection,
    COLLECTIONS.GUILD_LEADERBOARD,
    SAMPLE_LEADERBOARD_ID,
    {
      entries: [
        { guildId: SAMPLE_GUILD_ID, score: 12800, rank: 1 },
        { guildId: 'guild_demo_phoenix', score: 9870, rank: 2 }
      ],
      updatedAt: now,
      schemaVersion: 1
    },
    logger
  );

  const logsCollection = db.collection(COLLECTIONS.GUILD_LOGS);
  await ensureDocument(
    logsCollection,
    COLLECTIONS.GUILD_LOGS,
    `${SAMPLE_GUILD_ID}_log_01`,
    {
      guildId: SAMPLE_GUILD_ID,
      type: 'system',
      actorId: SAMPLE_LEADER_ID,
      payload: {
        message: '宗门建立成功，宗主云鹤真人发出入门邀请。'
      },
      createdAt: now
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
