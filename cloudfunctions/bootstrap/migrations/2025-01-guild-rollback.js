const { COLLECTIONS } = require('common-config');

const TARGET_COLLECTIONS = [
  COLLECTIONS.GUILD_LOGS,
  COLLECTIONS.GUILD_LEADERBOARD,
  COLLECTIONS.GUILD_BOSS,
  COLLECTIONS.GUILD_TASKS,
  COLLECTIONS.GUILD_MEMBERS,
  COLLECTIONS.GUILDS
];

function getLogger(context = {}) {
  const fallback = () => {};
  const logger = context.logger || {};
  return {
    info: logger.info || console.log,
    warn: logger.warn || console.warn,
    error: logger.error || console.error
  };
}

async function dropCollection(db, name, dryRun, logger) {
  if (dryRun) {
    logger.info(`[guild-rollback] dry-run: skip dropping ${name}`);
    return { name, dropped: false, dryRun: true };
  }
  const collection = db.collection(name);
  if (typeof collection.drop === 'function') {
    try {
      await collection.drop();
      logger.info(`[guild-rollback] dropped collection ${name}`);
      return { name, dropped: true };
    } catch (error) {
      if (error && /not exist/i.test(error.errMsg || '')) {
        logger.warn(`[guild-rollback] collection ${name} not found`);
        return { name, dropped: false, missing: true };
      }
      logger.error(`[guild-rollback] drop failed for ${name}`, error);
      throw error;
    }
  }
  logger.warn(`[guild-rollback] drop() unsupported for ${name}, attempting remove all documents`);
  try {
    await collection.where({}).remove();
    logger.info(`[guild-rollback] removed documents from ${name}`);
    return { name, dropped: true, removed: true };
  } catch (error) {
    if (error && /not exist/i.test(error.errMsg || '')) {
      logger.warn(`[guild-rollback] collection ${name} not found`);
      return { name, dropped: false, missing: true };
    }
    logger.error(`[guild-rollback] remove failed for ${name}`, error);
    throw error;
  }
}

module.exports = async function runGuildRollback({ db, dryRun = true, logger }) {
  if (!db) {
    throw new Error('Missing database instance for guild rollback migration');
  }
  const log = getLogger(logger ? { logger } : {});
  const results = [];
  for (const name of TARGET_COLLECTIONS) {
    const result = await dropCollection(db, name, dryRun, log);
    results.push(result);
  }
  return {
    migration: '2025-01-guild-rollback',
    dryRun: Boolean(dryRun),
    results
  };
};
