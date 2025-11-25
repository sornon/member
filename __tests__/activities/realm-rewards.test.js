const activities = require('../../cloudfunctions/activities/index');

const { resolveRealmOrder, buildRealmRewardState } = activities.__TESTING__;

describe('境界识别与奖励', () => {
  test('能够根据境界名称匹配到正确的序号（含化神期）', () => {
    expect(resolveRealmOrder({ realmName: '化神期' })).toBe(5);
    expect(resolveRealmOrder({ realm: '元婴期' })).toBe(4);
    expect(resolveRealmOrder({ levelName: '结丹期' })).toBe(3);
  });

  test('高阶境界应解锁神之一手奖励', () => {
    const reward = buildRealmRewardState({
      memberBoost: 5,
      memberRealm: '化神期',
      divineHandRemaining: 1,
      remainingSpins: 0
    });

    expect(reward.type).toBe('divine');
    expect(reward.realmName).toBe('化神期');
    expect(reward.ready).toBe(true);
    expect(reward.total).toBeGreaterThanOrEqual(1);
  });

  test('低阶境界保持境界加成逻辑', () => {
    const reward = buildRealmRewardState({
      memberBoost: 3,
      memberRealm: '结丹期',
      realmBonusRemaining: 2
    });

    expect(reward.type).toBe('boost');
    expect(reward.total).toBe(4);
    expect(reward.remaining).toBe(2);
    expect(reward.ready).toBe(true);
  });
});
