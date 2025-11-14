let commonConfig;
try {
  // Prefer the shared module injected via node_modules when running inside Jest.
  commonConfig = require('common-config');
} catch (error) {
  // Fallback to the bundled copy under the nodejs layer so standalone scripts can execute.
  commonConfig = require('../../cloudfunctions/nodejs-layer/node_modules/common-config');
}
const { COLLECTIONS } = commonConfig;
const { createGuildService } = require('../../cloudfunctions/guild/guild-service');

function createMemoryDb() {
  const collections = new Map();

  function ensure(name) {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    return collections.get(name);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function resolvePath(container, path, { create = false } = {}) {
    const segments = path.split('.');
    let current = container;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = segments[i];
      if (current[key] == null) {
        if (!create) {
          return { parent: current, key: segments[segments.length - 1], exists: false };
        }
        current[key] = {};
      }
      if (typeof current[key] !== 'object') {
        if (!create) {
          return { parent: current, key: segments[segments.length - 1], exists: false };
        }
        current[key] = {};
      }
      current = current[key];
    }
    const leafKey = segments[segments.length - 1];
    const exists = Object.prototype.hasOwnProperty.call(current, leafKey);
    return { parent: current, key: leafKey, exists };
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

  function buildQuery(data) {
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

  const command = {
    inc(value) {
      return { __op: 'inc', value };
    },
    in(values) {
      return { __op: 'in', values };
    }
  };

  return {
    command,
    serverDate() {
      return new Date();
    },
    createCollection(name) {
      ensure(name);
      return Promise.resolve();
    },
    collection(name) {
      const store = ensure(name);
      return {
        async add({ data }) {
          const id = data._id || data.id || `${name}_${store.length + 1}`;
          const record = { ...clone(data), _id: id };
          store.push(record);
          return { id };
        },
        doc(id) {
          return {
            async get() {
              const record = store.find((item) => (item._id || item.id) === id);
              if (!record) {
                throw { errMsg: 'document not exist' };
              }
              return { data: clone(record) };
            },
            async set({ data }) {
              const exists = store.find((item) => (item._id || item.id) === id);
              if (exists) {
                throw { errMsg: 'document exists' };
              }
              store.push({ ...clone(data), _id: id });
              return { id };
            },
            async update({ data }) {
              const record = store.find((item) => (item._id || item.id) === id);
              if (!record) {
                throw { errMsg: 'document not exist' };
              }
              applyUpdate(record, clone(data));
              return { updated: 1 };
            }
          };
        },
        async get() {
          return { data: store.map(clone) };
        },
        where(criteria) {
          const filtered = store.filter((item) => matches(item, criteria));
          return buildQuery(filtered);
        },
        limit(size) {
          return buildQuery(store).limit(size);
        },
        orderBy(field, direction) {
          const sorted = [...store].sort((left, right) => {
            const a = Number(left[field]) || 0;
            const b = Number(right[field]) || 0;
            return direction === 'desc' ? b - a : a - b;
          });
          return buildQuery(sorted);
        }
      };
    }
  };
}

function createSampleMember(memberId, overrides = {}) {
  return {
    _id: memberId,
    nickName: overrides.nickName || `成员-${memberId}`,
    avatarUrl: overrides.avatarUrl || 'https://cdn.example.com/avatar.png',
    avatarFrame: overrides.avatarFrame || '',
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

async function seedMember(db, memberId, overrides = {}) {
  const payload = createSampleMember(memberId, overrides);
  await db.collection(COLLECTIONS.MEMBERS).doc(memberId).set({ data: payload })
    .catch(async (error) => {
      if (error && /exists/i.test(error.errMsg || '')) {
        await db.collection(COLLECTIONS.MEMBERS).doc(memberId).update({ data: payload });
        return;
      }
      throw error;
    });
}

function createService(options = {}) {
  const db = options.db || createMemoryDb();
  const service = createGuildService({
    db,
    command: db.command,
    loadSettings: async () => ({
      enabled: true,
      maxMembers: 30,
      secret: 'unit-test-secret',
      teamBattle: { baseEnemyPower: 150 },
      boss: {
        enabled: true,
        dailyAttempts: 5,
        cooldownMs: 500,
        maxRounds: 12,
        rotation: [{ bossId: 'ancient_spirit_tree', level: 60 }]
      },
      riskControl: options.riskControl || {
        enabled: true,
        actions: {},
        abuseDetection: { enabled: false }
      }
    }),
    logger: options.logger || console
  });
  return { db, service };
}

module.exports = {
  COLLECTIONS,
  createMemoryDb,
  createService,
  createSampleMember,
  seedMember
};
