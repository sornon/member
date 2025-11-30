const { setBalanceVersion, __resetBalanceCache } = require('balance/config-loader');
const { simulatePveBattle, simulatePvpBattle } = require('balance/simulator');
const { resolveCombatStats } = require('combat-system');

describe('balance simulator', () => {
  afterEach(() => {
    setBalanceVersion('v1');
    __resetBalanceCache();
  });

  test('v2 curves shorten PVE fights for the same build', () => {
    const playerBuild = {
      stats: {
        maxHp: 1500,
        physicalAttack: 210,
        physicalDefense: 80,
        magicDefense: 70,
        accuracy: 135,
        speed: 105,
        critRate: 0.1,
        critDamage: 1.6
      }
    };
    const enemyBuild = {
      stats: {
        maxHp: 1850,
        physicalAttack: 130,
        physicalDefense: 90,
        magicDefense: 80,
        accuracy: 118,
        speed: 95
      }
    };
    const seeds = [1, 2, 3, 4, 5];
    setBalanceVersion('v1');
    __resetBalanceCache();
    const roundsV1 = seeds.map((seed) => simulatePveBattle({ playerBuild, enemyConfig: enemyBuild, seed }).rounds);
    setBalanceVersion('v2');
    __resetBalanceCache();
    const roundsV2 = seeds.map((seed) => simulatePveBattle({ playerBuild, enemyConfig: enemyBuild, seed }).rounds);
    const avgV1 = roundsV1.reduce((sum, r) => sum + r, 0) / roundsV1.length;
    const avgV2 = roundsV2.reduce((sum, r) => sum + r, 0) / roundsV2.length;
    expect(avgV2).toBeLessThan(avgV1);
  });

  test('v2 reduces PVP draw likelihood for tanky builds', () => {
    const tankA = {
      id: 'A',
      stats: {
        maxHp: 3200,
        physicalAttack: 110,
        magicAttack: 110,
        physicalDefense: 120,
        magicDefense: 120,
        speed: 90,
        accuracy: 120
      }
    };
    const tankB = {
      id: 'B',
      stats: {
        maxHp: 3100,
        physicalAttack: 105,
        magicAttack: 105,
        physicalDefense: 115,
        magicDefense: 115,
        speed: 88,
        accuracy: 118
      }
    };
    const seeds = [11, 12, 13, 14, 15];
    setBalanceVersion('v1');
    __resetBalanceCache();
    const drawsV1 = seeds.filter((seed) => simulatePvpBattle({ playerA: tankA, playerB: tankB, seed }).draw).length;
    setBalanceVersion('v2');
    __resetBalanceCache();
    const drawsV2 = seeds.filter((seed) => simulatePvpBattle({ playerA: tankA, playerB: tankB, seed }).draw).length;
    expect(drawsV2).toBeLessThanOrEqual(drawsV1);
  });

  test('extreme stats are clamped to safe bounds', () => {
    const stats = resolveCombatStats({
      critRate: 5,
      critDamage: 10,
      finalDamageReduction: 5,
      damageReduction: 5,
      lifeSteal: 5,
      healingReceived: 5
    });
    expect(stats.critRate).toBeLessThanOrEqual(0.95);
    expect(stats.critDamage).toBeGreaterThanOrEqual(1.2);
    expect(stats.finalDamageReduction).toBeLessThanOrEqual(0.9);
    expect(stats.damageReduction).toBeLessThanOrEqual(0.8);
    expect(stats.lifeSteal).toBeLessThanOrEqual(0.6);
    expect(stats.healingReceived).toBeLessThanOrEqual(1.5);
  });
});
