const { createGuildService } = require('../guild-service');
const { GUILD_SCHEMA_VERSION } = require('../guild-service');

function bootstrapDb() {
  const base = {};
  const db = {
    serverDate() {
      return new Date();
    },
    createCollection() {
      return Promise.resolve();
    },
    command: {
      inc(value) {
        return { __op: 'inc', value };
      },
      in(values) {
        return { __op: 'in', values };
      }
    }
  };
  const collections = new Map();
  const ensure = (name) => {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    return collections.get(name);
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function applyUpdate(target, updates) {
    Object.keys(updates).forEach((key) => {
      const value = updates[key];
      if (value && typeof value === 'object' && value.__op === 'inc') {
        const baseValue = Number(target[key]) || 0;
        target[key] = baseValue + Number(value.value || 0);
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
  function buildQuery(items) {
    return {
      limit(size) {
        return {
          async get() {
            return { data: items.slice(0, size).map(clone) };
          }
        };
      },
      async get() {
        return { data: items.map(clone) };
      }
    };
  }
  db.collection = (name) => {
    const store = ensure(name);
    return {
      async add({ data: doc }) {
        const id = doc._id || doc.id || `${name}_${store.length + 1}`;
        const record = { ...clone(doc), _id: id };
        store.push(record);
        return { id };
      },
      async get() {
        return { data: store.map(clone) };
      },
      doc(id) {
        return {
          async get() {
            const record = store.find((item) => (item._id || item.id) === id);
            if (!record) {
              throw { errMsg: 'not exist' };
            }
            return { data: clone(record) };
          },
          async set({ data: doc }) {
            const record = store.find((item) => (item._id || item.id) === id);
            if (record) {
              throw { errMsg: 'exists' };
            }
            store.push({ ...clone(doc), _id: id });
            return { id };
          },
          async update({ data: updates }) {
            const record = store.find((item) => (item._id || item.id) === id);
            if (!record) {
              throw { errMsg: 'not exist' };
            }
            applyUpdate(record, clone(updates));
            return { updated: 1 };
          }
        };
      },
      where(criteria) {
        const filtered = store.filter((item) => matches(item, criteria));
        return buildQuery(filtered);
      },
      limit(size) {
        return buildQuery(store).limit(size);
      },
      orderBy(field, order) {
        const sorted = [...store].sort((a, b) => {
          const left = Number(a[field]) || 0;
          const right = Number(b[field]) || 0;
          return order === 'desc' ? right - left : left - right;
        });
        return buildQuery(sorted);
      }
    };
  };
  return db;
}

describe('GuildService E2E', () => {
  test('complete guild lifecycle', async () => {
    const db = bootstrapDb();
    const service = createGuildService({
      db,
      command: db.command,
      loadSettings: async () => ({
        enabled: true,
        maxMembers: 25,
        secret: 'raid-secret',
        schemaVersion: GUILD_SCHEMA_VERSION
      })
    });
    const leaderTicket = await service.issueActionTicket('alpha');
    const created = await service.createGuild('alpha', {
      name: '星尘海',
      manifesto: '星海漫游',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 1500
    });
    const overview = await service.getOverview('alpha');
    expect(overview.guild.id).toBe(created.guild.id);
    const joinTicket = await service.issueActionTicket('beta');
    await service.joinGuild('beta', {
      guildId: created.guild.id,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 900
    });
    const raidTicket = await service.issueActionTicket('beta');
    const battle = await service.initiateTeamBattle('beta', {
      ticket: raidTicket.ticket,
      signature: raidTicket.signature,
      members: ['alpha', 'beta'],
      difficulty: 3
    });
    expect(battle.battle.signature).toBeTruthy();
    expect(battle.rewards).toHaveProperty('stones');
    const guilds = await service.listGuilds();
    expect(guilds.guilds.length).toBeGreaterThan(0);
    const profile = await service.profile('alpha');
    expect(profile.summary.action).toBe('profile');
    expect(profile.guild.id).toBe(created.guild.id);
  });
});
