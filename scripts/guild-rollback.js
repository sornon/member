#!/usr/bin/env node
/* eslint-disable no-console */
const cloud = require('wx-server-sdk');

const targetCollections = [
  'guilds',
  'guildMembers',
  'guildBattles',
  'guildCache',
  'guildEventLogs',
  'guildTickets',
  'guildRateLimits'
];

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

async function dropCollection(db, name) {
  try {
    const collection = db.collection(name);
    console.log(`[guild-rollback] removing all documents in ${name}`);
    await collection.where({}).remove();
  } catch (error) {
    if (error && /not exist/i.test(error.errMsg || '')) {
      console.log(`[guild-rollback] collection ${name} not found, skipping`);
      return;
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.force) {
    console.error('[guild-rollback] pass --force to confirm rollback');
    process.exitCode = 1;
    return;
  }
  const envId = args.envId || process.env.TCB_ENV || process.env.WX_ENV || process.env.CLOUDBASE_ENV;
  if (!envId) {
    throw new Error('Missing envId. Pass --envId=xxx or set TCB_ENV.');
  }
  cloud.init({ env: envId });
  const db = cloud.database();
  console.log(`[guild-rollback] using env ${envId}`);
  for (const name of targetCollections) {
    await dropCollection(db, name);
  }
  console.log('[guild-rollback] rollback complete');
}

main().catch((error) => {
  console.error('[guild-rollback] failed', error);
  process.exitCode = 1;
});
