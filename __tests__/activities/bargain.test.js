const { _test } = require('../../cloudfunctions/activities/index');

const { applyRealmBoostUpgrade, buildRealmRewardState, hasRealmBoostUpgrade, resolveRealmBonus } = _test;

describe('BHK 砍价境界奖励升级', () => {
  test('新老境界差额应补齐奖励与抽奖次数', () => {
    const baseRecord = {
      remainingSpins: 3,
      memberBoost: 0,
      realmBonusTotal: 0,
      realmBonusRemaining: 0
    };
    const { bonus } = resolveRealmBonus(6);
    const upgraded = applyRealmBoostUpgrade(baseRecord, 6, bonus, 1);

    expect(upgraded.memberBoost).toBe(6);
    expect(upgraded.realmBonusTotal).toBe(bonus);
    expect(upgraded.realmBonusRemaining).toBe(bonus);
    expect(upgraded.remainingSpins).toBe(3 + bonus);
    expect(upgraded.divineHandRemaining).toBe(1);
  });

  test('已有档案提升境界时增量追加而非重置剩余奖励', () => {
    const record = {
      remainingSpins: 4,
      memberBoost: 2,
      realmBonusTotal: 2,
      realmBonusRemaining: 1
    };
    const { bonus } = resolveRealmBonus(4);
    const upgraded = applyRealmBoostUpgrade(record, 4, bonus, 1);

    expect(upgraded.memberBoost).toBe(4);
    expect(upgraded.realmBonusTotal).toBe(4);
    expect(upgraded.realmBonusRemaining).toBe(1 + (bonus - 2));
    expect(upgraded.remainingSpins).toBe(4 + (bonus - 2));
  });

  test('判定需持久化升级时应覆盖剩余抽奖次数与境界加成字段', () => {
    const before = {
      remainingSpins: 3,
      memberBoost: 1,
      realmBonusTotal: 1,
      realmBonusRemaining: 0,
      divineHandRemaining: 0
    };
    const { bonus } = resolveRealmBonus(6);
    const after = applyRealmBoostUpgrade(before, 6, bonus, 1);

    expect(hasRealmBoostUpgrade(before, after)).toBe(true);
  });

  test('保持已领取进度，不应因境界回落而扣减剩余奖励', () => {
    const record = {
      remainingSpins: 5,
      memberBoost: 4,
      realmBonusTotal: 4,
      realmBonusRemaining: 2
    };
    const { bonus } = resolveRealmBonus(2);
    const upgraded = applyRealmBoostUpgrade(record, 2, bonus, 0);

    expect(upgraded.memberBoost).toBe(4); // 取历史最高
    expect(upgraded.realmBonusTotal).toBe(4); // 保留既有档案奖励
    expect(upgraded.realmBonusRemaining).toBe(2);
    expect(upgraded.remainingSpins).toBe(5);
  });

  test('筑基奖励升级为 +4，结丹即可解锁神之一手', () => {
    const { bonus: foundationBonus } = resolveRealmBonus(2);
    const { bonus: coreBonus } = resolveRealmBonus(3);
    const reward = buildRealmRewardState({ memberBoost: 3, remainingSpins: 0, divineHandRemaining: 1 });

    expect(foundationBonus).toBe(4);
    expect(coreBonus).toBe(4);
    expect(reward.type).toBe('divine');
    expect(reward.total).toBe(1);
  });

  test('神之一手消耗后不应被补发，并记录使用状态', () => {
    const record = {
      remainingSpins: 0,
      memberBoost: 6,
      realmBonusTotal: 4,
      realmBonusRemaining: 0,
      divineHandRemaining: 0,
      divineHandUsed: true
    };
    const { bonus } = resolveRealmBonus(6);
    const upgraded = applyRealmBoostUpgrade(record, 6, bonus, 1);
    const reward = buildRealmRewardState(upgraded);

    expect(upgraded.divineHandRemaining).toBe(0);
    expect(upgraded.divineHandUsed).toBe(true);
    expect(reward.used).toBe(true);
    expect(reward.ready).toBe(false);
  });
});
