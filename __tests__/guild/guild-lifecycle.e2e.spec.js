const { createService, seedMember, COLLECTIONS } = require('./test-helpers');

async function bootstrapGuildScenario() {
  const { service, db } = createService({
    riskControl: {
      enabled: true,
      actions: {
        donate: { cooldownMs: 0, dailyLimit: 5 },
        'tasks.claim': { cooldownMs: 0, dailyLimit: 5 },
        'boss.challenge': { cooldownMs: 0, dailyLimit: 5 }
      },
      abuseDetection: { enabled: false }
    }
  });
  await seedMember(db, 'leader', { nickName: '九霄' });
  await seedMember(db, 'support', { nickName: '青离' });
  await db.collection(COLLECTIONS.GUILD_TASKS).add({
    data: {
      _id: 'task_demo',
      guildId: 'pending',
      taskId: 'trial_001',
      type: 'donate',
      title: '捐献试炼',
      goal: { type: 'donate', target: 10 },
      progress: { current: 0, target: 10 },
      reward: { stones: 100 },
      status: 'open'
    }
  }).catch(() => {});
  return { service, db };
}

describe('Guild E2E flow: join → donate → task → boss → leaderboard → rewards', () => {
  test('completes core cooperative workflow', async () => {
    const { service, db } = await bootstrapGuildScenario();

    const leaderTicket = await service.issueActionTicket('leader');
    const created = await service.createGuild('leader', {
      name: '星河会',
      manifesto: '守护星海',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 3400
    });
    expect(created.summary.code).toBe('GUILD_CREATED');

    const joinTicket = await service.issueActionTicket('support');
    await service.joinGuild('support', {
      guildId: created.guild.id,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 2800
    });

    const donationTicket = await service.issueActionTicket('leader');
    const donation = await service.donate('leader', {
      ticket: donationTicket.ticket,
      signature: donationTicket.signature,
      amount: 20,
      type: 'stone'
    });
    expect(donation.donation.amount).toBe(20);

    const taskTicket = await service.issueActionTicket('support');
    const taskClaim = await service.tasksClaim('support', {
      ticket: taskTicket.ticket,
      signature: taskTicket.signature,
      taskId: 'trial_001'
    });
    expect(taskClaim.taskId).toBe('trial_001');

    const bossTicket = await service.issueActionTicket('support');
    const bossResult = await service.bossChallenge('support', {
      ticket: bossTicket.ticket,
      signature: bossTicket.signature,
      party: ['support', 'leader'],
      seed: 'e2e-seed'
    });
    expect(bossResult.damage.length).toBeGreaterThan(0);

    const leaderboard = await service.getLeaderboard('leader', { force: true, limit: 10 });
    expect(leaderboard.entries.length).toBeGreaterThan(0);
    expect(leaderboard.myRank).toBe(1);

    const rewards = bossResult.rewards;
    expect(rewards).toBeTruthy();
    expect(Object.keys(rewards).length).toBeGreaterThan(0);

    const logs = await db.collection(COLLECTIONS.GUILD_LOGS).get();
    expect(Array.isArray(logs.data)).toBe(true);
  });
});
