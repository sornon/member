const { COLLECTIONS } = require('common-config');
const { createGuildService } = require('../guild-service');

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
  function applyUpdate(target, updates) {
    Object.keys(updates).forEach((key) => {
      const value = updates[key];
      if (value && typeof value === 'object' && value.__op === 'inc') {
        const base = Number(target[key]) || 0;
        target[key] = base + Number(value.value || 0);
      } else {
        target[key] = value;
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
  function createQuery(data) {
    return {
      limit(size) {
        return {
          async get() {
            return { data: data.slice(0, size).map(clone) };
          }
        };
      },
      async get() {
        return { data: data.map(clone) };
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
          }
        };
      },
      async get() {
        return { data: data.map(clone) };
      },
      where(criteria) {
        const filtered = data.filter((item) => matches(item, criteria));
        return createQuery(filtered);
      },
      limit(size) {
        return createQuery(data).limit(size);
      },
      orderBy(field, direction) {
        const sorted = [...data].sort((a, b) => {
          const left = Number(a[field]) || 0;
          const right = Number(b[field]) || 0;
          return direction === 'desc' ? right - left : left - right;
        });
        return createQuery(sorted);
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
        secret: 'test-secret'
      })
    });
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
});
