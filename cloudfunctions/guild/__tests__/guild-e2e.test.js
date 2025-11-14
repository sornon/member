const { createGuildService } = require('../guild-service');
const { GUILD_SCHEMA_VERSION } = require('../guild-service');
const { ERROR_CODES } = require('../error-codes');
const { COLLECTIONS } = require('common-config');

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
      },
      or(conditions) {
        return { __op: 'or', conditions: Array.isArray(conditions) ? conditions : [] };
      }
    }
  };
  db.RegExp = ({ regexp, options }) => {
    try {
      return { __op: 'regex', regexp: new RegExp(regexp, options || '') };
    } catch (error) {
      return { __op: 'regex', regexp: new RegExp('') };
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
    if (!criteria || typeof criteria !== 'object') {
      return true;
    }
    if (criteria.__op === 'or') {
      return (criteria.conditions || []).some((condition) => matches(doc, condition));
    }
    return Object.keys(criteria).every((key) => {
      const expected = criteria[key];
      if (expected && typeof expected === 'object') {
        if (expected.__op === 'in') {
          return expected.values.includes(doc[key]);
        }
        if (expected.__op === 'regex' && expected.regexp instanceof RegExp) {
          const value = doc[key] || '';
          return expected.regexp.test(value);
        }
      }
      if (expected && expected.regexp instanceof RegExp) {
        const value = doc[key] || '';
        return expected.regexp.test(value);
      }
      return doc[key] === expected;
    });
  }
  function buildQuery(items) {
    return {
      limit(size) {
        const safe = Math.max(0, Math.floor(size || 0));
        return buildQuery(items.slice(0, safe));
      },
      skip(count) {
        const safe = Math.max(0, Math.floor(count || 0));
        return buildQuery(items.slice(safe));
      },
      orderBy(field, order) {
        const sorted = [...items].sort((a, b) => {
          const leftValue = a && a[field];
          const rightValue = b && b[field];
          const leftTime = leftValue instanceof Date ? leftValue.getTime() : new Date(leftValue || 0).getTime();
          const rightTime = rightValue instanceof Date ? rightValue.getTime() : new Date(rightValue || 0).getTime();
          if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && order && (field || '').includes('At')) {
            return order === 'desc' ? rightTime - leftTime : leftTime - rightTime;
          }
          const left = Number(leftValue) || 0;
          const right = Number(rightValue) || 0;
          return order === 'desc' ? right - left : left - right;
        });
        return buildQuery(sorted);
      },
      where(criteria) {
        const filtered = items.filter((item) => matches(item, criteria));
        return buildQuery(filtered);
      },
      field() {
        return buildQuery(items);
      },
      async get() {
        return { data: items.map(clone) };
      },
      async count() {
        return { total: items.length };
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
        return buildQuery(store).where(criteria);
      },
      limit(size) {
        return buildQuery(store).limit(size);
      },
      orderBy(field, order) {
        return buildQuery(store).orderBy(field, order);
      },
      skip(count) {
        return buildQuery(store).skip(count);
      },
      count() {
        return buildQuery(store).count();
      },
      field() {
        return buildQuery(store).field();
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

  test('admin guild overview and members', async () => {
    const db = bootstrapDb();
    const service = createGuildService({
      db,
      command: db.command,
      loadSettings: async () => ({
        enabled: true,
        maxMembers: 50,
        secret: 'admin-secret',
        schemaVersion: GUILD_SCHEMA_VERSION
      })
    });

    const leaderTicket = await service.issueActionTicket('leader');
    const created = await service.createGuild('leader', {
      name: '太虚观',
      manifesto: '剑指青云',
      ticket: leaderTicket.ticket,
      signature: leaderTicket.signature,
      powerRating: 3200
    });
    const guildId = created.guild.id;
    const joinTicket = await service.issueActionTicket('elder');
    await service.joinGuild('elder', {
      guildId,
      ticket: joinTicket.ticket,
      signature: joinTicket.signature,
      powerRating: 2800
    });
    const memberTicket = await service.issueActionTicket('disciple');
    await service.joinGuild('disciple', {
      guildId,
      ticket: memberTicket.ticket,
      signature: memberTicket.signature,
      powerRating: 1200
    });

    const guildMembers = db.collection(COLLECTIONS.GUILD_MEMBERS);
    const memberSnapshot = await guildMembers.where({ guildId }).get();
    for (const record of memberSnapshot.data) {
      const updates = { displayName: record.memberId };
      if (record.memberId === 'leader') {
        updates.contribution = 4200;
        updates.power = 3500;
        updates.role = 'leader';
      } else if (record.memberId === 'elder') {
        updates.contribution = 5600;
        updates.power = 3600;
        updates.role = 'officer';
      } else if (record.memberId === 'disciple') {
        updates.contribution = 600;
        updates.power = 900;
        updates.status = 'inactive';
      }
      await guildMembers.doc(record._id).update({ data: updates });
    }

    await db.collection(COLLECTIONS.GUILD_LOGS).add({
      data: {
        _id: 'alert_1',
        guildId,
        type: 'security',
        action: 'abnormalDonation',
        actorId: 'elder',
        summary: { message: '短期内异常高频捐献' },
        createdAt: new Date()
      }
    });

    await db.collection(COLLECTIONS.GUILD_TASKS).add({
      data: {
        _id: 'task_1',
        guildId,
        title: '灵田浇灌',
        status: 'open',
        progress: { current: 60 },
        goal: { total: 100 },
        endAt: new Date(),
        updatedAt: new Date()
      }
    });

    await db.collection(COLLECTIONS.GUILD_BOSS).add({
      data: {
        _id: `${guildId}_boss_fire`,
        guildId,
        bossId: 'boss_fire',
        level: 5,
        status: 'open',
        hpMax: 8000,
        hpLeft: 3200,
        totalDamage: 4800,
        damageByMember: { leader: 2000, elder: 2800 },
        updatedAt: new Date(),
        schemaVersion: 1
      }
    });

    const adminContext = {
      proxySession: {
        sessionId: 'proxy_1',
        adminId: 'admin',
        targetMemberId: 'leader'
      }
    };

    const overview = await service.adminListGuilds('admin', { keyword: '太虚', page: 1, pageSize: 10 }, adminContext);
    expect(overview.guilds.length).toBe(1);
    expect(overview.guilds[0].alertCount).toBe(1);
    expect(overview.guilds[0].topMembers[0].memberId).toBe('elder');

    const detail = await service.adminGetGuildDetail('admin', { guildId }, adminContext);
    expect(detail.guild.id).toBe(guildId);
    expect(detail.members.total).toBe(3);
    expect(detail.tasks.length).toBe(1);
    expect(detail.alerts.length).toBe(1);
    expect(detail.boss.totalDamage).toBe(4800);

    const members = await service.adminGetGuildMembers(
      'admin',
      { guildId, order: 'power', includeInactive: true, page: 1, pageSize: 10 },
      adminContext
    );
    expect(members.total).toBe(3);
    expect(members.members[0].memberId).toBe('elder');
    expect(members.roles.leader).toBe(1);

    await expect(service.adminListGuilds('admin', {}, {})).rejects.toMatchObject({ errCode: ERROR_CODES.PERMISSION_DENIED });
  });
});
