const crypto = require('crypto');
const { createService, seedMember, COLLECTIONS } = require('./test-helpers');
const { ERROR_CODES } = require('../../cloudfunctions/guild/error-codes');

function extractTicketSignature(ticket) {
  return ticket && ticket.signature;
}

describe('GuildService action surfaces', () => {
  let db;
  let service;

  beforeEach(() => {
    ({ db, service } = createService());
  });

  describe('createGuild', () => {
    test('creates guild successfully with valid ticket', async () => {
      const ticket = await service.issueActionTicket('creator');
      const result = await service.createGuild('creator', {
        name: '晨辉宗',
        manifesto: '以星辰之名守护苍生',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket),
        powerRating: 1800
      });
      expect(result.summary.code).toBe('GUILD_CREATED');
      expect(result.guild).toBeTruthy();
      const guildDocs = await db.collection(COLLECTIONS.GUILDS).get();
      expect(guildDocs.data[0].name).toBe('晨辉宗');
    });

    test('rejects empty guild name', async () => {
      const ticket = await service.issueActionTicket('creator');
      await expect(
        service.createGuild('creator', {
          name: '   ',
          ticket: ticket.ticket,
          signature: extractTicketSignature(ticket)
        })
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
    });

    test('prevents creating second guild when already enrolled', async () => {
      const ticket = await service.issueActionTicket('creator');
      await service.createGuild('creator', {
        name: '灵霄阁',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      const reuseTicket = await service.issueActionTicket('creator');
      await expect(
        service.createGuild('creator', {
          name: '星海盟',
          ticket: reuseTicket.ticket,
          signature: extractTicketSignature(reuseTicket)
        })
      ).rejects.toMatchObject({ code: 'ALREADY_IN_GUILD' });
    });
  });

  describe('apply / approve', () => {
    test('apply returns placeholder summary with pending flag', async () => {
      const ticket = await service.issueActionTicket('applicant');
      const response = await service.apply('applicant', {
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      expect(response.summary.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
      expect(response.pending).toBe(true);
    });

    test('approve enforces ticket signature validation', async () => {
      const ticket = await service.issueActionTicket('officer');
      const invalidSignature = crypto.createHash('md5').update('invalid').digest('hex');
      await expect(
        service.approve('officer', {
          ticket: ticket.ticket,
          signature: invalidSignature
        })
      ).rejects.toMatchObject({ code: 'INVALID_TICKET_SIGNATURE' });
    });

    test('apply obeys rate limit window', async () => {
      const ticket = await service.issueActionTicket('applicant');
      await service.apply('applicant', {
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      const secondTicket = await service.issueActionTicket('applicant');
      await expect(
        service.apply('applicant', {
          ticket: secondTicket.ticket,
          signature: extractTicketSignature(secondTicket)
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.RATE_LIMITED });
    });
  });

  describe('donate', () => {
    beforeEach(async () => {
      const ticket = await service.issueActionTicket('founder');
      await service.createGuild('founder', {
        name: '焰心盟',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
    });

    test('accepts donation request and echoes payload', async () => {
      const ticket = await service.issueActionTicket('founder');
      const response = await service.donate('founder', {
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket),
        amount: 12,
        type: 'stone'
      });
      expect(response.summary.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
      expect(response.donation.amount).toBe(12);
    });

    test('respects daily limit configured through risk control', async () => {
      ({ db, service } = createService({
        riskControl: {
          enabled: true,
          actions: {
            donate: { cooldownMs: 0, dailyLimit: 1 }
          },
          abuseDetection: { enabled: false }
        }
      }));
      const ticket = await service.issueActionTicket('founder');
      await service.createGuild('founder', {
        name: '星澜宗',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      const firstTicket = await service.issueActionTicket('founder');
      await service.donate('founder', {
        ticket: firstTicket.ticket,
        signature: extractTicketSignature(firstTicket)
      });
      const secondTicket = await service.issueActionTicket('founder');
      await expect(
        service.donate('founder', {
          ticket: secondTicket.ticket,
          signature: extractTicketSignature(secondTicket)
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.ACTION_DAILY_LIMIT });
    });
  });

  describe('tasks.claim', () => {
    beforeEach(async () => {
      const ticket = await service.issueActionTicket('leader');
      await service.createGuild('leader', {
        name: '云台阁',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
    });

    test('returns placeholder summary for task claim', async () => {
      const ticket = await service.issueActionTicket('leader');
      const response = await service.tasksClaim('leader', {
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket),
        taskId: 'trial_001'
      });
      expect(response.summary.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
      expect(response.taskId).toBe('trial_001');
    });

    test('enforces cooldown and daily limit boundary', async () => {
      jest.useFakeTimers();
      try {
        ({ db, service } = createService({
          riskControl: {
            enabled: true,
            actions: {
              'tasks.claim': { cooldownMs: 2000, dailyLimit: 1 }
            },
            abuseDetection: { enabled: false }
          }
        }));
        const ticket = await service.issueActionTicket('leader');
        await service.createGuild('leader', {
          name: '青霄盟',
          ticket: ticket.ticket,
          signature: extractTicketSignature(ticket)
        });
        const first = await service.issueActionTicket('leader');
        await service.tasksClaim('leader', {
          ticket: first.ticket,
          signature: extractTicketSignature(first),
          taskId: 'trial_001'
        });
        await expect(
          service.tasksClaim('leader', {
            ticket: first.ticket,
            signature: extractTicketSignature(first),
            taskId: 'trial_001'
          })
        ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_TICKET });
        const second = await service.issueActionTicket('leader');
        await expect(
          service.tasksClaim('leader', {
            ticket: second.ticket,
            signature: extractTicketSignature(second),
            taskId: 'trial_001'
          })
        ).rejects.toMatchObject({ code: ERROR_CODES.ACTION_DAILY_LIMIT });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('boss.challenge', () => {
    beforeEach(async () => {
      await seedMember(db, 'leader');
      await seedMember(db, 'ally');
      const ticket = await service.issueActionTicket('leader');
      const guild = await service.createGuild('leader', {
        name: '凌霄殿',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      const joinTicket = await service.issueActionTicket('ally');
      await service.joinGuild('ally', {
        guildId: guild.guild.id,
        ticket: joinTicket.ticket,
        signature: extractTicketSignature(joinTicket),
        powerRating: 2800
      });
    });

    test('simulates boss challenge successfully', async () => {
      const ticket = await service.issueActionTicket('leader');
      const result = await service.bossChallenge('leader', {
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket),
        party: ['leader', 'ally'],
        seed: 'boss-seed'
      });
      expect(result.summary.action).toBe('boss.challenge');
      expect(result.damage.length).toBeGreaterThan(0);
      expect(result.rewards).toBeTruthy();
    });

    test('rejects challenge when member not in guild', async () => {
      const outsiderTicket = await service.issueActionTicket('outsider');
      await expect(
        service.bossChallenge('outsider', {
          ticket: outsiderTicket.ticket,
          signature: extractTicketSignature(outsiderTicket)
        })
      ).rejects.toMatchObject({ code: 'NOT_IN_GUILD' });
    });

    test('daily attempt limit stops repeated challenges', async () => {
      ({ db, service } = createService({
        riskControl: {
          enabled: true,
          actions: {
            'boss.challenge': { cooldownMs: 0, dailyLimit: 1 }
          },
          abuseDetection: { enabled: false }
        }
      }));
      await seedMember(db, 'leader');
      const ticket = await service.issueActionTicket('leader');
      await service.createGuild('leader', {
        name: '龙吟阁',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
      const firstTicket = await service.issueActionTicket('leader');
      await service.bossChallenge('leader', {
        ticket: firstTicket.ticket,
        signature: extractTicketSignature(firstTicket),
        party: ['leader'],
        seed: 'limit-seed'
      });
      const secondTicket = await service.issueActionTicket('leader');
      await expect(
        service.bossChallenge('leader', {
          ticket: secondTicket.ticket,
          signature: extractTicketSignature(secondTicket),
          party: ['leader'],
          seed: 'limit-seed-2'
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.ACTION_DAILY_LIMIT });
    });
  });

  describe('getLeaderboard', () => {
    beforeEach(async () => {
      await seedMember(db, 'leader', { nickName: 'Aurora' });
      const ticket = await service.issueActionTicket('leader');
      await service.createGuild('leader', {
        name: '星辉盟',
        ticket: ticket.ticket,
        signature: extractTicketSignature(ticket)
      });
    });

    test('returns leaderboard snapshot successfully', async () => {
      const result = await service.getLeaderboard('leader', { force: true, limit: 5 });
      expect(result.summary.code).toBe('SUCCESS');
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.myRank).toBe(1);
    });

    test('enforces rate limit when refreshed rapidly', async () => {
      await service.getLeaderboard('leader', { force: true, limit: 3 });
      await expect(
        service.getLeaderboard('leader', { force: true, limit: 3 })
      ).rejects.toMatchObject({ code: ERROR_CODES.RATE_LIMITED });
    });

    test('clamps leaderboard size within cache limit boundary', async () => {
      const result = await service.getLeaderboard('leader', { limit: 999 });
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.length).toBeLessThanOrEqual(200);
    });
  });
});
