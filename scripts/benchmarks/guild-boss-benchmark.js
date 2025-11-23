#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const Module = require('module');
const { performance } = require('perf_hooks');

const extraNodePath = path.join(__dirname, '..', '..', 'cloudfunctions', 'nodejs-layer', 'node_modules');
if (!module.paths.includes(extraNodePath)) {
  process.env.NODE_PATH = [extraNodePath, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

const { createService, seedMember, COLLECTIONS, createMemoryDb } = require('../../__tests__/guild/test-helpers');

async function batch(items, size, handler) {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await Promise.all(slice.map((item, offset) => handler(item, i + offset)));
  }
}

async function bootstrapMembers(db, count) {
  const ids = Array.from({ length: count }, (_, index) => `member_${index + 1}`);
  const started = performance.now();
  await batch(ids, 50, async (memberId) => seedMember(db, memberId, { nickName: `成员-${memberId}` }));
  const ended = performance.now();
  return { ids, durationMs: ended - started };
}

async function attachMembersToGuild(db, guildId, memberIds) {
  const started = performance.now();
  await batch(memberIds, 100, async (memberId) =>
    db.collection(COLLECTIONS.GUILD_MEMBERS).add({
      data: {
        guildId,
        memberId,
        role: 'member',
        status: 'active',
        joinedAt: new Date(),
        contribution: Math.floor(Math.random() * 5000),
        power: 2000 + Math.floor(Math.random() * 800),
        schemaVersion: 1
      }
    })
  );
  const ended = performance.now();
  return ended - started;
}

async function simulateBossAttempts(service, memberIds, attempts = 100) {
  const seeds = Array.from({ length: attempts }, (_, index) => `benchmark-seed-${index}`);
  const started = performance.now();
  await batch(seeds, 10, async (seed, idx) => {
    const memberId = memberIds[idx % memberIds.length];
    const ticket = await service.issueActionTicket(memberId);
    await service.bossChallenge(memberId, {
      ticket: ticket.ticket,
      signature: ticket.signature,
      party: [memberId],
      seed
    });
  });
  const ended = performance.now();
  return ended - started;
}

async function run() {
  const db = createMemoryDb();
  const { service } = createService({
    db,
    riskControl: {
      enabled: true,
      actions: {
        'boss.challenge': { cooldownMs: 0, dailyLimit: 200 },
        donate: { cooldownMs: 0, dailyLimit: 200 }
      },
      abuseDetection: { enabled: false }
    }
  });

  const leaderId = 'leader_benchmark';
  await seedMember(db, leaderId, { nickName: '压测宗主', combatPower: 4200 });
  const ticket = await service.issueActionTicket(leaderId);
  const guild = await service.createGuild(leaderId, {
    name: '星象基准宗',
    ticket: ticket.ticket,
    signature: ticket.signature,
    powerRating: 4200
  });

  const { ids: memberIds, durationMs: seedDuration } = await bootstrapMembers(db, 5000);
  const attachDuration = await attachMembersToGuild(db, guild.guild.id, memberIds);
  const challengeParticipants = memberIds.slice(0, 100);
  const challengeDuration = await simulateBossAttempts(service, challengeParticipants, 100);

  const leaderboardStarted = performance.now();
  await service.getLeaderboard(leaderId, { force: true, limit: 50 });
  const leaderboardDuration = performance.now() - leaderboardStarted;

  const rows = [
    { stage: 'Seed Members (5k)', durationMs: seedDuration.toFixed(2) },
    { stage: 'Attach Members', durationMs: attachDuration.toFixed(2) },
    { stage: 'Simulate Boss Challenges (100)', durationMs: challengeDuration.toFixed(2) },
    { stage: 'Refresh Leaderboard', durationMs: leaderboardDuration.toFixed(2) }
  ];

  console.log('Guild Boss Benchmark Results');
  console.table(rows);
  console.log('\nOptimization suggestions:');
  console.log('- Use batched `where({_id: command.in(ids)})` reads to hydrate party members instead of sequential lookups.');
  console.log('- Ensure CloudBase indexes on `guildMembers.guildId+status` and `guildBoss.guildId+status` are in place to avoid table scans.');
  console.log('- Trim leaderboard payload fields (e.g., omit large appearance catalogues) when refresh happens at scale.');
}

run().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exitCode = 1;
});
