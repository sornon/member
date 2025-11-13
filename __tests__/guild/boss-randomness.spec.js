const { createService, seedMember, COLLECTIONS } = require('./test-helpers');

async function setupGuildFor(memberId = 'seed-tester') {
  const { db, service } = createService({
    riskControl: {
      enabled: true,
      actions: {
        'boss.challenge': { cooldownMs: 0, dailyLimit: 10 }
      },
      abuseDetection: { enabled: false }
    }
  });
  await seedMember(db, memberId);
  const ticket = await service.issueActionTicket(memberId);
  const creation = await service.createGuild(memberId, {
    name: `序列宗-${memberId}`,
    ticket: ticket.ticket,
    signature: ticket.signature,
    powerRating: 3600
  });
  return { db, service, guildId: creation.guild.id };
}

describe('Guild boss randomness guarantees', () => {
  test('identical seeds create deterministic battle signature and timeline', async () => {
    const { service } = await setupGuildFor();
    const run = async (seed) => {
      const challengeTicket = await service.issueActionTicket('seed-tester');
      return service.bossChallenge('seed-tester', {
        ticket: challengeTicket.ticket,
        signature: challengeTicket.signature,
        party: ['seed-tester'],
        seed
      });
    };
    const first = await run('shared-seed');
    const second = await run('shared-seed');
    expect(second.battle.signature).toBe(first.battle.signature);
    expect(second.battle.timeline).toEqual(first.battle.timeline);
  });

  test('different seeds result in varied playback and damage totals', async () => {
    const { service, db, guildId } = await setupGuildFor('seed-differ');
    const run = async (seed) => {
      const challengeTicket = await service.issueActionTicket('seed-differ');
      return service.bossChallenge('seed-differ', {
        ticket: challengeTicket.ticket,
        signature: challengeTicket.signature,
        party: ['seed-differ'],
        seed
      });
    };
    const first = await run('alpha-seed');
    const second = await run('beta-seed');
    expect(second.battle.signature).not.toBe(first.battle.signature);
    expect(second.battle.timeline).not.toEqual(first.battle.timeline);
    const statusTicket = await service.issueActionTicket('seed-differ');
    const status = await service.bossStatus('seed-differ', {
      ticket: statusTicket.ticket,
      signature: statusTicket.signature
    });
    const totalRecordedDamage = status.boss.totalDamage;
    const manualAggregate = await db.collection(COLLECTIONS.GUILD_BOSS).doc(`${guildId}_ancient_spirit_tree`).get();
    expect(totalRecordedDamage).toBeGreaterThan(0);
    expect(manualAggregate.data.totalDamage).toBeGreaterThanOrEqual(totalRecordedDamage);
  });
});
