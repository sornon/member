#!/usr/bin/env node
/* eslint-disable no-console */
const cloud = require('wx-server-sdk');

const requiredCollections = [
  'guilds',
  'guildMembers',
  'guildBattles',
  'guildCache',
  'guildEventLogs',
  'guildTickets',
  'guildRateLimits'
];

const collectionIndexes = {
  guilds: [
    { key: { power: -1 }, options: { name: 'idx_power_desc' } },
    { key: { memberCount: -1 }, options: { name: 'idx_member_count_desc' } }
  ],
  guildMembers: [
    { key: { guildId: 1, status: 1 }, options: { name: 'idx_guild_status' } },
    { key: { memberId: 1 }, options: { name: 'idx_member_lookup' } }
  ],
  guildBattles: [
    { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_guild_battles' } }
  ],
  guildCache: [
    { key: { schemaVersion: 1 }, options: { name: 'idx_cache_schema' } }
  ],
  guildEventLogs: [
    { key: { guildId: 1, createdAt: -1 }, options: { name: 'idx_event_audit' } }
  ],
  guildTickets: [
    { key: { memberId: 1 }, options: { name: 'idx_ticket_member' } },
    { key: { signature: 1 }, options: { name: 'idx_ticket_signature', unique: true } }
  ],
  guildRateLimits: [
    { key: { action: 1, memberId: 1 }, options: { name: 'idx_rate_member_action' } }
  ]
};

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach((item) => {
    const [key, value] = item.split('=');
    if (key.startsWith('--')) {
      args[key.slice(2)] = value === undefined ? true : value;
    }
  });
  return args;
}

async function ensureCollection(db, name) {
  try {
    await db.collection(name).limit(1).get();
    console.log(`[guild-migrate] collection ${name} exists`);
  } catch (error) {
    if (error && /not exist/i.test(error.errMsg || '')) {
      console.log(`[guild-migrate] creating collection ${name}`);
      await db.createCollection(name);
    } else {
      throw error;
    }
  }
}

async function ensureIndexes(db, name, indexes = []) {
  const collection = db.collection(name);
  for (const index of indexes) {
    try {
      await collection.createIndex(index.key, index.options || {});
      console.log(`[guild-migrate] ensured index ${index.options && index.options.name ? index.options.name : JSON.stringify(index.key)} on ${name}`);
    } catch (error) {
      if (error && /already exist/i.test(error.errMsg || '')) {
        console.log(`[guild-migrate] index exists on ${name}`);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const envId = args.envId || process.env.TCB_ENV || process.env.WX_ENV || process.env.CLOUDBASE_ENV;
  if (!envId) {
    throw new Error('Missing envId. Pass --envId=xxx or set TCB_ENV.');
  }
  cloud.init({ env: envId });
  const db = cloud.database();
  console.log(`[guild-migrate] using env ${envId}`);
  for (const name of requiredCollections) {
    await ensureCollection(db, name);
    const indexes = collectionIndexes[name] || [];
    if (indexes.length) {
      await ensureIndexes(db, name, indexes);
    }
  }
  console.log('[guild-migrate] migration complete');
}

main().catch((error) => {
  console.error('[guild-migrate] failed', error);
  process.exitCode = 1;
});
