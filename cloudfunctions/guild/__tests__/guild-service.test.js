const { COLLECTIONS } = require('common-config');
const { FEATURE_TOGGLE_DOC_ID } = require('system-settings');
const crypto = require('crypto');
const { createGuildService, LEADERBOARD_CACHE_SCHEMA_VERSION } = require('../guild-service');
const { ERROR_CODES } = require('../error-codes');

function createMemoryDb() {
  const collections = new Map();
  const ensure = (name) => {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    return collections.get(name);
  };
  const command = {
    inc(value) {
      return { __op: 'inc', value };
    },
    in(values) {
      return { __op: 'in', values };
    }
  };
  function resolvePath(container, path, { create = false } = {}) {
    const segments = path.split('.');
    let current = container;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (current[segment] === undefined) {
        if (!create) {
          return { parent: current, key: segments[segments.length - 1], exists: false };
        }
        current[segment] = {};
      }
      if (typeof current[segment] !== 'object' || current[segment] === null) {
        if (!create) {
          return { parent: current, key: segments[segments.length - 1], exists: false };
        }
        current[segment] = {};
      }
      current = current[segment];
    }
    const key = segments[segments.length - 1];
    const exists = Object.prototype.hasOwnProperty.call(current, key);
    return { parent: current, key, exists };
  }

  function applyUpdate(target, updates) {
    Object.keys(updates).forEach((path) => {
      const value = updates[path];
      const { parent, key } = resolvePath(target, path, { create: true });
      if (value && typeof value === 'object' && value.__op === 'inc') {
        const baseValue = Number(parent[key]) || 0;
        parent[key] = baseValue + Number(value.value || 0);
      } else {
        parent[key] = value;
      }
    });
  }
  function matches(doc, criteria = {}) {
    return Object.keys(criteria).every((key) => {
      const expected = criteria[key];
      if (expected && typeof expected === 'object' && expected.__op === 'in') {
        return expected.values.includes(doc[key]);
      }
      return doc[key] === expected;
    });
  }
  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }
  function createQuery(data, view = data) {
    return {
      skip(count) {
        const offset = Math.max(0, Math.floor(Number(count) || 0));
        return createQuery(data, view.slice(offset));
      },
      limit(size) {
        const bounded = Math.max(0, Math.floor(Number(size) || 0));
        if (bounded === 0) {
          return createQuery(data, []);
        }
        return createQuery(data, view.slice(0, bounded));
      },
      async get() {
        return { data: view.map(clone) };
      },
      async remove() {
        const ids = new Set(view.map((item) => item._id || item.id));
        if (!ids.size) {
          return { deleted: 0, stats: { removed: 0 } };
        }
        const before = data.length;
        for (let i = data.length - 1; i >= 0; i -= 1) {
          const record = data[i];
          const id = record && (record._id || record.id);
          if (ids.has(id)) {
            data.splice(i, 1);
          }
        }
        const removed = before - data.length;
        return { deleted: removed, stats: { removed } };
      }
    };
  }
  function createCollection(name) {
    const data = ensure(name);
    return {
      async add({ data: doc }) {
        const id = doc._id || doc.id || `${name}_${data.length + 1}`;
        const record = { ...clone(doc), _id: id };
        data.push(record);
        return { id };
      },
      doc(id) {
        return {
          async get() {
            const record = data.find((item) => (item._id || item.id) === id);
            if (!record) {
              throw { errMsg: 'document not exist' };
            }
            return { data: clone(record) };
          },
          async set({ data: doc }) {
            const exists = data.find((item) => (item._id || item.id) === id);
            if (exists) {
              throw { errMsg: 'document exists' };
            }
            data.push({ ...clone(doc), _id: id });
            return { id };
          },
          async update({ data: updates }) {
            const record = data.find((item) => (item._id || item.id) === id);
            if (!record) {
              throw { errMsg: 'document not exist' };
            }
            applyUpdate(record, clone(updates));
            return { updated: 1 };
          },
          async remove() {
            const index = data.findIndex((item) => (item._id || item.id) === id);
            if (index === -1) {
              throw { errMsg: 'document not exist' };
            }
            data.splice(index, 1);
            return { deleted: 1, stats: { removed: 1 } };
          }
        };
      },
      async get() {
        return { data: data.map(clone) };
      },
      where(criteria) {
        const filtered = data.filter((item) => matches(item, criteria));
        return {
          ...createQuery(data, filtered),
          async remove() {
            const ids = new Set(filtered.map((item) => item._id || item.id));
            if (!ids.size) {
              return { deleted: 0, stats: { removed: 0 } };
            }
            const before = data.length;
            for (let i = data.length - 1; i >= 0; i -= 1) {
              const record = data[i];
              const id = record && (record._id || record.id);
              if (ids.has(id)) {
                data.splice(i, 1);
              }
            }
            const removed = before - data.length;
            return { deleted: removed, stats: { removed } };
          }
        };
      },
      limit(size) {
        return createQuery(data, data).limit(size);
      },
      orderBy(field, direction) {
        const sorted = [...data].sort((a, b) => {
          const left = Number(a[field]) || 0;
          const right = Number(b[field]) || 0;
          return direction === 'desc' ? right - left : left - right;
        });
        return createQuery(data, sorted);
      }
    };
  }
  return {
    serverDate() {
      return new Date();
    },
    createCollection(name) {
      ensure(name);
      return Promise.resolve();
    },
    collection(name) {
      return createCollection(name);
    },
    command
  };
}

function createSampleMember(memberId, overrides = {}) {
  return {
    _id: memberId,
    nickName: overrides.nickName || `成员-${memberId}`,
    pveProfile: {
      attributeSummary: {
        combatPower: overrides.combatPower || 3200,
        finalStats: {
          maxHp: 6800,
          physicalAttack: 420,
          magicAttack: 360,
          physicalDefense: 280,
          magicDefense: 260,
          speed: 185,
          accuracy: 160,
          dodge: 90,
          critRate: 0.18,
          critDamage: 1.62,
          finalDamageBonus: 0.12,
          finalDamageReduction: 0.08
        }
      },
      skills: {
        equipped: overrides.skills || [
          { id: 'sword_breaking_clouds', level: 24 },
          { id: 'spell_burning_burst', level: 22 },
          { id: 'spell_frost_bolt', level: 20 }
        ]
      }
    }
  };
}

describe('GuildService', () => {
  let db;
  let service;
  beforeEach(() => {
    db = createMemoryDb();
    service = createGuildService({
      db,
      command: db.command,
      loadSettings: async () => ({
        enabled: true,
        maxMembers: 30,
        secret: 'test-secret',
        teamBattle: { baseEnemyPower: 150 },
        boss: {
          enabled: true,
          dailyAttempts: 5,
          cooldownMs: 500,
          maxRounds: 12,
          rotation: [{ bossId: 'ancient_spirit_tree', level: 60 }]
        }
      })
    });
  });

  test('error code table exposes canonical identifiers', () => {
    expect(ERROR_CODES.UNKNOWN_ACTION).toBe('UNKNOWN_ACTION');
    expect(ERROR_CODES.NOT_IMPLEMENTED).toBe('NOT_IMPLEMENTED');
  });

  test('issues action ticket and creates guild', async () => {
    const ticket = await service.issueActionTicket('member-1');
    expect(ticket.ticket).toBeTruthy();
    const result = await service.createGuild('member-1', {
      name: '苍穹宗',
      manifesto: '长夜将明',
      ticket: ticket.ticket,
      signature: ticket.signature,
      powerRating: 1200
    });
    expect(result.guild.name).toBe('苍穹宗');
    const overview = await service.getOverview('member-1');
    expect(overview.guild.name).toBe('苍穹宗');
    expect(overview.membership.role).toBe('leader');
    expect(overview.actionTicket.ticket).toBeTruthy();
  });

  test('overview normalizes guild metrics from derived fields', async () => {
    await db.collection(COLLECTIONS.GUILDS).add({
      data: {
        _id: 'guild-metrics',
        name: '太初宗',
        icon: '',
        manifesto: '大道初行',
        founderId: 'founder-1',
        memberCount: '27',
        powerScore: '12345.6',
        totalPower: 12000,
        activity: '678.9',
        activityScore: 650,
        stats: { powerScore: 12400, activity: 680 }
      }
    });
    await db.collection(COLLECTIONS.GUILD_MEMBERS).add({
      data: {
        _id: 'membership-metrics',
        guildId: 'guild-metrics',
        memberId: 'member-metrics',
        role: 'leader',
        status: 'active',
        joinedAt: new Date().toISOString(),
        power: 5000
      }
    });

    const overview = await service.getOverview('member-metrics');
    expect(overview.guild.id).toBe('guild-metrics');
    expect(overview.guild.memberCount).toBe(27);
    expect(overview.guild.power).toBe(12400);
    expect(overview.guild.activityScore).toBe(680);
    expect(overview.membership.memberId).toBe('member-metrics');
  });

  test('join guild and initiate battle', async () => {
    const leaderTicket = await service.issueActionTicket('leader');
    const guildResult = await service.createGuild('leader', {
      name: '星落阁',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 2000
    });
    const joinTicket = await service.issueActionTicket('member-2');
    await service.joinGuild('member-2', {
      guildId: guildResult.guild.id,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 800
    });
    const battleTicket = await service.issueActionTicket('leader');
    const battle = await service.initiateTeamBattle('leader', {
      ticket: battleTicket.ticket,
      signature: battleTicket.signature,
      members: ['leader', 'member-2'],
      difficulty: 2
    });
    expect(battle.battle.mode).toBe('guildRaid');
    expect(typeof battle.battle.signature).toBe('string');
  });

  test('action ticket cannot be reused after verification', async () => {
    const ticket = await service.issueActionTicket('member-3');
    await expect(
      service.verifyActionTicket('member-3', ticket.ticket, ticket.signature)
    ).resolves.toBe(true);
    await expect(
      service.verifyActionTicket('member-3', ticket.ticket, ticket.signature)
    ).rejects.toHaveProperty('code', 'TICKET_CONSUMED');
  });

  test('ticket issuance handles duplicate document gracefully', async () => {
    const spy = jest
      .spyOn(crypto, 'randomBytes')
      .mockReturnValue(Buffer.from('1234567890abcdef1234567890abcdef', 'hex'));
    const first = await service.issueActionTicket('member-dup');
    const second = await service.issueActionTicket('member-dup');
    expect(second.signature).toBe(first.signature);
    spy.mockRestore();
  });

  test('verifyActionTicket validates payload combinations', async () => {
    await expect(service.verifyActionTicket('member-x', '', '')).rejects.toHaveProperty('code', 'INVALID_TICKET');
    const ticket = await service.issueActionTicket('member-y');
    await expect(
      service.verifyActionTicket('member-y', ticket.ticket, 'wrong-signature')
    ).rejects.toHaveProperty('code', 'INVALID_TICKET_SIGNATURE');
    const secretSignature = crypto
      .createHash('md5')
      .update(`ghost:test-secret`)
      .digest('hex');
    await expect(
      service.verifyActionTicket('member-y', 'ghost', secretSignature)
    ).rejects.toHaveProperty('code', 'TICKET_NOT_FOUND');
    const expirySignature = crypto
      .createHash('md5')
      .update(`member-expired:test-secret`)
      .digest('hex');
    const expiresAt = new Date(Date.now() - 60 * 1000);
    const docId = `ticket_${crypto
      .createHash('md5')
      .update(`member-expired:${expirySignature}`)
      .digest('hex')}`;
    await db
      .collection(COLLECTIONS.GUILD_TICKETS)
      .doc(docId)
      .set({
        data: {
          memberId: 'member-expired',
          signature: expirySignature,
          expiresAt,
          consumed: false,
          schemaVersion: 1
        }
      });
    await expect(
      service.verifyActionTicket('member-expired', 'member-expired', expirySignature)
    ).rejects.toHaveProperty('code', 'TICKET_EXPIRED');
  });

  test('join guild derives member power from stored profile', async () => {
    const leaderTicket = await service.issueActionTicket('leader');
    const guildResult = await service.createGuild('leader', {
      name: '流光阁',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 1500
    });
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('member-4')
      .set({
        data: {
          _id: 'member-4',
          combatPower: 4321,
          attributeSummary: { combatPower: 4321 }
        }
      });
    const joinTicket = await service.issueActionTicket('member-4');
    await service.joinGuild('member-4', {
      guildId: guildResult.guild.id,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 9999999
    });
    const snapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId: guildResult.guild.id, memberId: 'member-4' })
      .limit(1)
      .get();
    expect(snapshot.data[0].power).toBe(4321);
  });

  test('membersList returns decorated entries with pagination and filters', async () => {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('leader-alpha')
      .set({ data: createSampleMember('leader-alpha', { nickName: '掌门' }) });
    await db
      .collection(COLLECTIONS.MEMBER_EXTRAS)
      .doc('leader-alpha')
      .set({ data: { _id: 'leader-alpha', avatarUrl: 'https://example.com/leader.png' } });
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('ally-beta')
      .set({ data: createSampleMember('ally-beta', { nickName: 'Beta' }) });
    await db
      .collection(COLLECTIONS.MEMBER_EXTRAS)
      .doc('ally-beta')
      .set({ data: { _id: 'ally-beta', avatarFrame: 'frame-test' } });
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('ally-delta')
      .set({ data: createSampleMember('ally-delta', { nickName: 'Delta' }) });
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('sleepy-gamma')
      .set({ data: createSampleMember('sleepy-gamma', { nickName: 'Gamma' }) });

    const createTicket = await service.issueActionTicket('leader-alpha');
    const guildResult = await service.createGuild('leader-alpha', {
      name: '云霄殿',
      ticket: createTicket.ticket,
      signature: createTicket.signature,
      powerRating: 2800
    });
    const betaTicket = await service.issueActionTicket('ally-beta');
    await service.joinGuild('ally-beta', {
      guildId: guildResult.guild.id,
      ticket: betaTicket.ticket,
      signature: betaTicket.signature,
      powerRating: 1800
    });
    const deltaTicket = await service.issueActionTicket('ally-delta');
    await service.joinGuild('ally-delta', {
      guildId: guildResult.guild.id,
      ticket: deltaTicket.ticket,
      signature: deltaTicket.signature,
      powerRating: 1400
    });
    const gammaTicket = await service.issueActionTicket('sleepy-gamma');
    await service.joinGuild('sleepy-gamma', {
      guildId: guildResult.guild.id,
      ticket: gammaTicket.ticket,
      signature: gammaTicket.signature,
      powerRating: 1600
    });

    const memberSnapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId: guildResult.guild.id })
      .get();
    for (const doc of memberSnapshot.data) {
      const updates = {};
      if (doc.memberId === 'leader-alpha') {
        updates.contribution = 320;
        updates.contributionWeek = 60;
        updates.power = 5200;
        updates.joinedAt = new Date('2024-01-01T00:00:00Z');
      } else if (doc.memberId === 'ally-beta') {
        updates.contribution = 210;
        updates.contributionWeek = 45;
        updates.power = 4100;
        updates.joinedAt = new Date('2024-01-02T00:00:00Z');
      } else if (doc.memberId === 'ally-delta') {
        updates.contribution = 150;
        updates.contributionWeek = 18;
        updates.power = 3600;
        updates.joinedAt = new Date('2024-01-03T00:00:00Z');
      } else if (doc.memberId === 'sleepy-gamma') {
        updates.contribution = 430;
        updates.power = 4800;
        updates.status = 'inactive';
        updates.joinedAt = new Date('2024-01-04T00:00:00Z');
      }
      if (Object.keys(updates).length) {
        await db.collection(COLLECTIONS.GUILD_MEMBERS).doc(doc._id).update({ data: updates });
      }
    }

    const listTicket = await service.issueActionTicket('leader-alpha');
    const firstPage = await service.membersList('leader-alpha', {
      ticket: listTicket.ticket,
      signature: listTicket.signature,
      limit: 2
    });
    expect(firstPage.members.map((entry) => entry.memberId)).toEqual(['leader-alpha', 'ally-beta']);
    expect(firstPage.pagination.hasMore).toBe(true);
    expect(typeof firstPage.pagination.next).toBe('string');
    const leaderEntry = firstPage.members.find((entry) => entry.memberId === 'leader-alpha');
    expect(leaderEntry.role).toBe('leader');
    expect(leaderEntry.avatarUrl).toBe('https://example.com/leader.png');
    const betaFromFirstPage = firstPage.members.find((entry) => entry.memberId === 'ally-beta');
    expect(betaFromFirstPage.contributionTotal).toBe(210);
    expect(betaFromFirstPage.contributionWeek).toBe(45);
    expect(betaFromFirstPage.avatarFrame).toBe('frame-test');
    expect(betaFromFirstPage.displayName).toBe('Beta');

    const secondTicket = await service.issueActionTicket('leader-alpha');
    const secondPage = await service.membersList('leader-alpha', {
      ticket: secondTicket.ticket,
      signature: secondTicket.signature,
      cursor: firstPage.pagination.next,
      limit: 2
    });
    expect(secondPage.members.map((entry) => entry.memberId)).toEqual(['ally-delta']);
    expect(secondPage.pagination.hasMore).toBe(false);
    const deltaEntry = secondPage.members.find((entry) => entry.memberId === 'ally-delta');
    expect(deltaEntry.contributionTotal).toBe(150);
    expect(deltaEntry.displayName).toBe('Delta');
  });

  test('membersList requires guild membership', async () => {
    const ticket = await service.issueActionTicket('solo-wanderer');
    await expect(
      service.membersList('solo-wanderer', {
        ticket: ticket.ticket,
        signature: ticket.signature
      })
    ).rejects.toHaveProperty('code', 'NOT_IN_GUILD');
  });

  test('rate limiting prevents rapid guild creation', async () => {
    const ticket = await service.issueActionTicket('rate-test');
    await service.createGuild('rate-test', {
      name: '雷霆宗',
      ticket: ticket.ticket,
      signature: ticket.signature
    });
    await expect(
      service.createGuild('rate-test', {
        name: '雷霆宗二队',
        ticket: ticket.ticket,
        signature: ticket.signature
      })
    ).rejects.toHaveProperty('code', 'RATE_LIMITED');
  });

  test('createGuild rejects invalid names', async () => {
    const ticket = await service.issueActionTicket('invalid-name');
    await expect(
      service.createGuild('invalid-name', {
        name: 123,
        ticket: ticket.ticket,
        signature: ticket.signature
      })
    ).rejects.toHaveProperty('code', 'INVALID_NAME');
  });

  test('create action wrapper returns summary payload', async () => {
    const ticket = await service.issueActionTicket('wrapper-1');
    const result = await service.create('wrapper-1', {
      name: '幻星宗',
      ticket: ticket.ticket,
      signature: ticket.signature
    });
    expect(result.summary.action).toBe('create');
    expect(result.summary.code).toBe('GUILD_CREATED');
    expect(result.guild).toBeTruthy();
    expect(result.snapshot.guild).toBeTruthy();
  });

  test('boss.challenge action enforces cooldown and wraps battle result', async () => {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('leader-boss')
      .set({ data: createSampleMember('leader-boss') });
    const ticket = await service.issueActionTicket('leader-boss');
    const createResult = await service.createGuild('leader-boss', {
      name: '凌霄殿',
      ticket: ticket.ticket,
      signature: ticket.signature,
      powerRating: 2600
    });
    const challengeTicket = await service.issueActionTicket('leader-boss');
    const challenge = await service.bossChallenge('leader-boss', {
      ticket: challengeTicket.ticket,
      signature: challengeTicket.signature,
      members: ['leader-boss'],
      difficulty: 1
    });
    expect(challenge.summary.action).toBe('boss.challenge');
    expect(challenge.battle).toBeTruthy();
    expect(challenge.battle.signature).toBeTruthy();
    expect(challenge.boss).toBeTruthy();
    expect(Array.isArray(challenge.damage)).toBe(true);
    expect(challenge.damage[0].memberId).toBe('leader-boss');
    const secondTicket = await service.issueActionTicket('leader-boss');
    await expect(
      service.bossChallenge('leader-boss', {
        ticket: secondTicket.ticket,
        signature: secondTicket.signature,
        members: ['leader-boss'],
        difficulty: 1
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/ACTION_COOLDOWN|BOSS_COOLDOWN|RATE_LIMITED/) });
    expect(createResult.guild.id).toBeTruthy();
  });

  test('boss challenge with identical seed produces deterministic timeline', async () => {
    async function runWithSeed(seed) {
      const localDb = createMemoryDb();
      const localService = createGuildService({
        db: localDb,
        command: localDb.command,
        loadSettings: async () => ({
          enabled: true,
          maxMembers: 30,
          secret: 'test-secret',
          teamBattle: { baseEnemyPower: 150 },
          boss: {
            enabled: true,
            dailyAttempts: 5,
            cooldownMs: 0,
            maxRounds: 12,
            rotation: [{ bossId: 'ancient_spirit_tree', level: 60 }]
          }
        })
      });
      await localDb
        .collection(COLLECTIONS.MEMBERS)
        .doc('deterministic')
        .set({ data: createSampleMember('deterministic') });
      const ticket = await localService.issueActionTicket('deterministic');
      await localService.createGuild('deterministic', {
        name: '定序宗',
        ticket: ticket.ticket,
        signature: ticket.signature,
        powerRating: 3000
      });
      const challengeTicket = await localService.issueActionTicket('deterministic');
      return localService.bossChallenge('deterministic', {
        ticket: challengeTicket.ticket,
        signature: challengeTicket.signature,
        party: ['deterministic'],
        seed
      });
    }
    const first = await runWithSeed('fixed-seed');
    const second = await runWithSeed('fixed-seed');
    expect(second.battle.signature).toBe(first.battle.signature);
    expect(second.battle.timeline).toEqual(first.battle.timeline);
  });

  describe('risk control guards', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test('donate enforces cooldown and daily limit via risk control', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      const guardedService = createGuildService({
        db,
        command: db.command,
        loadSettings: async () => ({
          enabled: true,
          maxMembers: 30,
          secret: 'test-secret',
          teamBattle: { baseEnemyPower: 150 },
          boss: {
            enabled: true,
            dailyAttempts: 5,
            cooldownMs: 500,
            maxRounds: 12,
            rotation: [{ bossId: 'ancient_spirit_tree', level: 60 }]
          },
          riskControl: {
            enabled: true,
            actions: {
              donate: { cooldownMs: 10 * 1000, dailyLimit: 2 },
              'tasks.claim': { cooldownMs: 10 * 1000, dailyLimit: 2 },
              'boss.challenge': { cooldownMs: 10 * 1000, dailyLimit: 3 },
              bossChallenge: { cooldownMs: 10 * 1000, dailyLimit: 3 }
            },
            abuseDetection: { enabled: false }
          }
        })
      });

      const firstTicket = await guardedService.issueActionTicket('risk-user');
      await expect(
        guardedService.donate('risk-user', {
          ticket: firstTicket.ticket,
          signature: firstTicket.signature,
          amount: 10
        })
      ).resolves.toMatchObject({ summary: { code: 'NOT_IMPLEMENTED' } });

      const cooldownTicket = await guardedService.issueActionTicket('risk-user');
      await expect(
        guardedService.donate('risk-user', {
          ticket: cooldownTicket.ticket,
          signature: cooldownTicket.signature,
          amount: 5
        })
      ).rejects.toMatchObject({ code: expect.stringMatching(/ACTION_COOLDOWN|RATE_LIMITED/) });

      jest.advanceTimersByTime(30 * 1000);
      const secondTicket = await guardedService.issueActionTicket('risk-user');
      await guardedService.donate('risk-user', {
        ticket: secondTicket.ticket,
        signature: secondTicket.signature,
        amount: 8
      });

      jest.advanceTimersByTime(30 * 1000);
      const thirdTicket = await guardedService.issueActionTicket('risk-user');
      await expect(
        guardedService.donate('risk-user', {
          ticket: thirdTicket.ticket,
          signature: thirdTicket.signature,
          amount: 12
        })
      ).rejects.toHaveProperty('code', ERROR_CODES.ACTION_DAILY_LIMIT);
    });

    test('abuse detection records security alerts for repeated donations', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      const detectionService = createGuildService({
        db,
        command: db.command,
        loadSettings: async () => ({
          enabled: true,
          maxMembers: 30,
          secret: 'test-secret',
          teamBattle: { baseEnemyPower: 150 },
          boss: {
            enabled: true,
            dailyAttempts: 5,
            cooldownMs: 500,
            maxRounds: 12,
            rotation: [{ bossId: 'ancient_spirit_tree', level: 60 }]
          },
          riskControl: {
            enabled: true,
            actions: {
              donate: { cooldownMs: 10 * 1000, dailyLimit: 5 },
              'tasks.claim': { cooldownMs: 10 * 1000, dailyLimit: 5 },
              'boss.challenge': { cooldownMs: 10 * 1000, dailyLimit: 5 },
              bossChallenge: { cooldownMs: 10 * 1000, dailyLimit: 5 }
            },
            abuseDetection: { enabled: true, windowMs: 60 * 1000, threshold: 2 }
          }
        })
      });

      const firstTicket = await detectionService.issueActionTicket('alert-user');
      await detectionService.donate('alert-user', {
        ticket: firstTicket.ticket,
        signature: firstTicket.signature,
        amount: 6
      });
      jest.advanceTimersByTime(30 * 1000);
      const secondTicket = await detectionService.issueActionTicket('alert-user');
      await detectionService.donate('alert-user', {
        ticket: secondTicket.ticket,
        signature: secondTicket.signature,
        amount: 7
      });

      const logs = await db.collection(COLLECTIONS.GUILD_LOGS).where({ type: 'security' }).get();
      expect(Array.isArray(logs.data)).toBe(true);
      expect(logs.data.some((entry) => entry.action === 'riskControl')).toBe(true);

      const alerts = await detectionService.listRiskAlerts('admin-user', { limit: 5 });
      expect(Array.isArray(alerts.alerts)).toBe(true);
      expect(alerts.alerts.length).toBeGreaterThan(0);
    });
  });

  describe('admin.updateGuildSettings', () => {
    it('persists validated updates and records audit logs', async () => {
      const result = await service.adminUpdateGuildSettings(
        'admin-user',
        {
          updates: {
            enabled: false,
            maxMembers: 3,
            leaderboardCacheTtlMs: 1000,
            teamBattleEnabled: false,
            bossEnabled: false,
            bossDailyAttempts: 50,
            riskControlEnabled: false
          }
        },
        { proxySession: { adminId: 'admin-user' } }
      );

      expect(result.summary.action).toBe('admin.updateGuildSettings');
      expect(result.settings.enabled).toBe(false);
      expect(result.settings.maxMembers).toBe(5);
      expect(result.settings.leaderboardCacheTtlMs).toBe(30 * 1000);
      const stored = await db
        .collection(COLLECTIONS.SYSTEM_SETTINGS)
        .doc(FEATURE_TOGGLE_DOC_ID)
        .get();
      expect(stored.data.guildSettings.enabled).toBe(false);
      expect(stored.data.guildSettings.maxMembers).toBe(5);
      expect(stored.data.guildSettings.teamBattle.enabled).toBe(false);
      expect(stored.data.guildSettings.boss.enabled).toBe(false);
      expect(stored.data.guildSettings.boss.dailyAttempts).toBe(20);
      expect(stored.data.guildSettings.riskControl.enabled).toBe(false);

      const logs = await db.collection(COLLECTIONS.GUILD_LOGS).get();
      expect(logs.data.some((entry) => entry.action === 'admin.updateGuildSettings')).toBe(true);
    });

    it('rejects empty update payload', async () => {
      await expect(
        service.adminUpdateGuildSettings(
          'admin-user',
          { updates: {} },
          { proxySession: { adminId: 'admin-user' } }
        )
      ).rejects.toMatchObject({ message: '缺少配置更新项' });
    });

    it('rejects invalid numeric inputs', async () => {
      await expect(
        service.adminUpdateGuildSettings(
          'admin-user',
          { updates: { maxMembers: 'invalid' } },
          { proxySession: { adminId: 'admin-user' } }
        )
      ).rejects.toMatchObject({ message: '宗门人数上限需为数字' });
    });
  });

  describe('admin.resetGuildSystem', () => {
    it('clears guild collections in batches and restores defaults', async () => {
      await db
        .collection(COLLECTIONS.SYSTEM_SETTINGS)
        .doc(FEATURE_TOGGLE_DOC_ID)
        .set({
          data: {
            guildSettings: {
              enabled: false,
              schemaVersion: 0,
              updatedAt: new Date()
            }
          }
        });
      await db.collection(COLLECTIONS.GUILDS).add({
        data: {
          _id: 'guild_temp_reset',
          name: '霜华宫'
        }
      });
      await db.collection(COLLECTIONS.GUILD_MEMBERS).add({
        data: {
          _id: 'guild_temp_reset_leader',
          guildId: 'guild_temp_reset',
          memberId: 'admin-user',
          role: 'leader'
        }
      });
      await db.collection(COLLECTIONS.GUILD_TASKS).add({
        data: {
          _id: 'guild_temp_reset_task',
          guildId: 'guild_temp_reset',
          title: '重置演练'
        }
      });

      const result = await service.adminResetGuildSystem(
        'admin-user',
        { confirm: true, requestId: 'reset-case' },
        { proxySession: { adminId: 'admin-user' } }
      );

      const expectedCollections = [
        COLLECTIONS.GUILDS,
        COLLECTIONS.GUILD_MEMBERS,
        COLLECTIONS.GUILD_TASKS,
        COLLECTIONS.GUILD_BOSS,
        COLLECTIONS.GUILD_BATTLES,
        COLLECTIONS.GUILD_LEADERBOARD,
        COLLECTIONS.GUILD_LOGS,
        COLLECTIONS.GUILD_CACHE,
        COLLECTIONS.GUILD_EVENT_LOGS,
        COLLECTIONS.GUILD_TICKETS,
        COLLECTIONS.GUILD_RATE_LIMITS
      ];

      expect(result.success).toBe(true);
      expect(result.summary.action).toBe('admin.resetGuildSystem');
      expect(result.cleared).toHaveLength(expectedCollections.length);
      expectedCollections.forEach((name) => {
        expect(result.cleared).toEqual(
          expect.arrayContaining([expect.objectContaining({ name })])
        );
      });
      const guildEntry = result.cleared.find((entry) => entry.name === COLLECTIONS.GUILDS);
      const memberEntry = result.cleared.find((entry) => entry.name === COLLECTIONS.GUILD_MEMBERS);
      expect(guildEntry.deleted).toBeGreaterThanOrEqual(1);
      expect(memberEntry.deleted).toBeGreaterThanOrEqual(1);

      for (const name of expectedCollections) {
        const snapshot = await db.collection(name).get();
        const docs = Array.isArray(snapshot.data) ? snapshot.data : [];
        if (name === COLLECTIONS.GUILD_LOGS) {
          expect(docs.length).toBeLessThanOrEqual(1);
          if (docs.length === 1) {
            expect(docs[0].action).toBe('admin.resetGuildSystem');
          }
          continue;
        }
        expect(docs.length).toBe(0);
      }
      const settingsDoc = await db
        .collection(COLLECTIONS.SYSTEM_SETTINGS)
        .doc(FEATURE_TOGGLE_DOC_ID)
        .get();
      expect(settingsDoc.data.guildSettings.enabled).toBe(true);
      expect(settingsDoc.data.guildSettings.schemaVersion).toBe(1);
    });
  });

  test('concurrent boss challenges aggregate damage safely', async () => {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('leader-alpha')
      .set({ data: createSampleMember('leader-alpha') });
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('ally-beta')
      .set({ data: createSampleMember('ally-beta', { nickName: 'Beta' }) });
    const leaderTicket = await service.issueActionTicket('leader-alpha');
    const createResult = await service.createGuild('leader-alpha', {
      name: '星辉宗',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 3200
    });
    const joinTicket = await service.issueActionTicket('ally-beta');
    await service.joinGuild('ally-beta', {
      guildId: createResult.guild.id,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 2800
    });
    const [alphaTicket, betaTicket] = await Promise.all([
      service.issueActionTicket('leader-alpha'),
      service.issueActionTicket('ally-beta')
    ]);
    const [alphaResult, betaResult] = await Promise.all([
      service.bossChallenge('leader-alpha', {
        ticket: alphaTicket.ticket,
        signature: alphaTicket.signature,
        party: ['leader-alpha'],
        seed: 'seed-alpha'
      }),
      service.bossChallenge('ally-beta', {
        ticket: betaTicket.ticket,
        signature: betaTicket.signature,
        party: ['ally-beta'],
        seed: 'seed-beta'
      })
    ]);
    const totalDamage = alphaResult.damage.reduce((acc, entry) => acc + entry.damage, 0) +
      betaResult.damage.reduce((acc, entry) => acc + entry.damage, 0);
    const statusTicket = await service.issueActionTicket('leader-alpha');
    const status = await service.bossStatus('leader-alpha', {
      ticket: statusTicket.ticket,
      signature: statusTicket.signature
    });
    expect(status.boss.totalDamage).toBeGreaterThanOrEqual(totalDamage);
    expect(status.boss.leaderboard.length).toBeGreaterThanOrEqual(2);
  });

  test('placeholder actions return NOT_IMPLEMENTED summary', async () => {
    const ticket = await service.issueActionTicket('placeholder');
    const donateResult = await service.donate('placeholder', {
      ticket: ticket.ticket,
      signature: ticket.signature,
      amount: 10
    });
    expect(donateResult.summary.code).toBe('NOT_IMPLEMENTED');
    const tasksTicket = await service.issueActionTicket('placeholder');
    const taskResult = await service.tasksClaim('placeholder', {
      ticket: tasksTicket.ticket,
      signature: tasksTicket.signature,
      taskId: 'task_demo'
    });
    expect(taskResult.summary.code).toBe('NOT_IMPLEMENTED');
  });

  test('management placeholder actions reuse ticket guards', async () => {
    const applyTicket = await service.issueActionTicket('manager');
    const applyResult = await service.apply('manager', {
      ticket: applyTicket.ticket,
      signature: applyTicket.signature
    });
    expect(applyResult.summary.code).toBe('NOT_IMPLEMENTED');
    const approveTicket = await service.issueActionTicket('manager');
    const approveResult = await service.approve('manager', {
      ticket: approveTicket.ticket,
      signature: approveTicket.signature
    });
    expect(approveResult.summary.code).toBe('NOT_IMPLEMENTED');
    const rejectTicket = await service.issueActionTicket('manager');
    const rejectResult = await service.reject('manager', {
      ticket: rejectTicket.ticket,
      signature: rejectTicket.signature
    });
    expect(rejectResult.summary.code).toBe('NOT_IMPLEMENTED');
    const kickTicket = await service.issueActionTicket('manager');
    const kickResult = await service.kick('manager', {
      ticket: kickTicket.ticket,
      signature: kickTicket.signature
    });
    expect(kickResult.summary.code).toBe('NOT_IMPLEMENTED');
    const disbandTicket = await service.issueActionTicket('manager');
    const disbandResult = await service.disband('manager', {
      ticket: disbandTicket.ticket,
      signature: disbandTicket.signature
    });
    expect(disbandResult.summary.code).toBe('NOT_IMPLEMENTED');
  });

  test('status and leaderboard helpers return structured responses', async () => {
    const leaderTicket = await service.issueActionTicket('leader-status');
    await service.createGuild('leader-status', {
      name: '星罗阁',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 1800
    });
    const statusTicket = await service.issueActionTicket('leader-status');
    const status = await service.bossStatus('leader-status', {
      ticket: statusTicket.ticket,
      signature: statusTicket.signature
    });
    expect(status.summary.action).toBe('boss.status');
    const leaderboard = await service.getLeaderboard('leader-status', { force: true, limit: 5 });
    expect(leaderboard.summary.action).toBe('getLeaderboard');
    expect(leaderboard.type).toBe('power');
    expect(Array.isArray(leaderboard.entries)).toBe(true);
    expect(leaderboard.entries.length).toBeGreaterThan(0);
    expect(Array.isArray(leaderboard.entries[0].titleCatalog)).toBe(true);
    expect(typeof leaderboard.entries[0].avatarFrame).toBe('string');
    expect(leaderboard.myRank).toBe(1);
  });

  test('getLeaderboard returns normalized appearance and contribution data', async () => {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc('leader-appearance')
      .set({
        data: {
          _id: 'leader-appearance',
          nickName: '云起',
          avatarUrl: 'https://cdn.example/avatar.png',
          avatarFrame: 'https://cdn.example/frame.png',
          appearance: {
            titleCatalog: [
              { id: 'champion', name: '霸主', imageFile: 'champion.png' }
            ],
            titleId: 'champion',
            titleName: '霸主',
            avatarFrame: 'https://cdn.example/frame.png'
          }
        }
      });
    await db
      .collection(COLLECTIONS.MEMBER_EXTRAS)
      .doc('leader-appearance')
      .set({
        data: {
          _id: 'leader-appearance',
          titleCatalog: [
            { id: 'champion', name: '霸主', imageFile: 'champion.png' },
            { id: 'sage', name: '太上', imageFile: 'sage.png' }
          ]
        }
      });
    const ticket = await service.issueActionTicket('leader-appearance');
    await service.createGuild('leader-appearance', {
      name: '辉月宗',
      ticket: ticket.ticket,
      signature: ticket.signature,
      powerRating: 2200
    });
    const guildSnapshot = await db.collection(COLLECTIONS.GUILDS).get();
    const guildId = guildSnapshot.data[0]._id;
    const membershipSnapshot = await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .where({ guildId, memberId: 'leader-appearance' })
      .limit(1)
      .get();
    await db
      .collection(COLLECTIONS.GUILD_MEMBERS)
      .doc(membershipSnapshot.data[0]._id)
      .update({ data: { contribution: 512 } });
    const leaderboard = await service.getLeaderboard('leader-appearance', {
      type: 'contribution',
      limit: 10,
      force: true
    });
    expect(leaderboard.type).toBe('contribution');
    const entry = leaderboard.entries.find((item) => item.guildId === guildId);
    expect(entry).toBeTruthy();
    expect(entry.contribution).toBeGreaterThanOrEqual(512);
    expect(entry.avatarUrl).toBe('https://cdn.example/avatar.png');
    expect(entry.avatarFrame).toBe('https://cdn.example/frame.png');
    expect(entry.memberId).toBe('leader-appearance');
    expect(entry.titleCatalog.length).toBe(2);
    expect(entry.titleCatalog[0].id).toBe('champion');
    expect(entry.titleCatalog[1].id).toBe('sage');
    expect(leaderboard.myRank).toBe(1);
  });

  test('leaderboard cache rebuilds when schema version changes', async () => {
    const ticket = await service.issueActionTicket('schema-leader');
    await service.createGuild('schema-leader', {
      name: '霜寒宫',
      ticket: ticket.ticket,
      signature: ticket.signature
    });
    const outdatedPayload = {
      _id: 'power',
      schemaVersion: 0,
      entries: [{ guildId: 'legacy', titleCatalog: [], avatarFrame: '' }],
      updatedAt: new Date().toISOString(),
      type: 'power'
    };
    await db
      .collection(COLLECTIONS.GUILD_LEADERBOARD)
      .doc('power')
      .set({ data: outdatedPayload })
      .catch(async () => {
        await db
          .collection(COLLECTIONS.GUILD_LEADERBOARD)
          .doc('power')
          .update({ data: outdatedPayload });
      });
    const result = await service.getLeaderboard('schema-leader', { type: 'power' });
    expect(result.summary.action).toBe('getLeaderboard');
    expect(result.schemaVersion).toBe(LEADERBOARD_CACHE_SCHEMA_VERSION);
    expect(Array.isArray(result.entries)).toBe(true);
    const snapshot = await db.collection(COLLECTIONS.GUILD_LEADERBOARD).doc('power').get();
    expect(snapshot.data.schemaVersion).toBe(LEADERBOARD_CACHE_SCHEMA_VERSION);
    expect(Array.isArray(snapshot.data.entries)).toBe(true);
  });

  test('logging helpers write without throwing', async () => {
    await expect(
      service.recordGuildLog({ action: 'unit.test', actorId: 'alpha', summary: { action: 'unit.test' } })
    ).resolves.toBeUndefined();
    await expect(
      service.recordErrorLog({ action: 'unit.test', actorId: 'alpha', code: 'TEST', message: 'demo' })
    ).resolves.toBeUndefined();
    await expect(service.enforceCooldown('cooldown-test', 'boss.challenge')).resolves.toBeUndefined();
  });
});
