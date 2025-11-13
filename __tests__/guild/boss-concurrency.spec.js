const { createService, seedMember } = require('./test-helpers');

function sumDamage(entries) {
  return entries.reduce((acc, entry) => acc + (entry.damage || 0), 0);
}

describe('Guild boss concurrent submissions', () => {
  test('aggregates damage correctly across concurrent challenges', async () => {
    const { service, db } = createService({
      riskControl: {
        enabled: true,
        actions: {
          'boss.challenge': { cooldownMs: 0, dailyLimit: 10 }
        },
        abuseDetection: { enabled: false }
      }
    });
    await Promise.all([
      seedMember(db, 'alpha'),
      seedMember(db, 'beta'),
      seedMember(db, 'gamma')
    ]);
    const leaderTicket = await service.issueActionTicket('alpha');
    const guild = await service.createGuild('alpha', {
      name: '晨星会',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature
    });
    const joinBeta = await service.issueActionTicket('beta');
    const joinGamma = await service.issueActionTicket('gamma');
    await Promise.all([
      service.joinGuild('beta', {
        guildId: guild.guild.id,
        ticket: joinBeta.ticket,
        signature: joinBeta.signature,
        powerRating: 2600
      }),
      service.joinGuild('gamma', {
        guildId: guild.guild.id,
        ticket: joinGamma.ticket,
        signature: joinGamma.signature,
        powerRating: 2500
      })
    ]);

    const [alphaTicket, betaTicket, gammaTicket] = await Promise.all([
      service.issueActionTicket('alpha'),
      service.issueActionTicket('beta'),
      service.issueActionTicket('gamma')
    ]);

    const [alphaResult, betaResult, gammaResult] = await Promise.all([
      service.bossChallenge('alpha', {
        ticket: alphaTicket.ticket,
        signature: alphaTicket.signature,
        party: ['alpha'],
        seed: 'concurrent-alpha'
      }),
      service.bossChallenge('beta', {
        ticket: betaTicket.ticket,
        signature: betaTicket.signature,
        party: ['beta'],
        seed: 'concurrent-beta'
      }),
      service.bossChallenge('gamma', {
        ticket: gammaTicket.ticket,
        signature: gammaTicket.signature,
        party: ['gamma'],
        seed: 'concurrent-gamma'
      })
    ]);

    const totalDamage =
      sumDamage(alphaResult.damage) +
      sumDamage(betaResult.damage) +
      sumDamage(gammaResult.damage);

    const statusTicket = await service.issueActionTicket('alpha');
    const status = await service.bossStatus('alpha', {
      ticket: statusTicket.ticket,
      signature: statusTicket.signature
    });
    expect(status.boss.totalDamage).toBeGreaterThanOrEqual(totalDamage);
    expect(status.boss.leaderboard.length).toBeGreaterThanOrEqual(3);
    const sorted = [...status.boss.leaderboard].sort((a, b) => b.damage - a.damage);
    expect(status.boss.leaderboard.map((entry) => entry.memberId)).toEqual(sorted.map((entry) => entry.memberId));
  });
});
