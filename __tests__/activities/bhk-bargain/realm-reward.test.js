const { normalizeRealmReward } = require('../../../miniprogram/pages/activities/bhk-bargain/realm-reward');

describe('normalizeRealmReward 感恩节境界奖励', () => {
  test('后端未写入境界奖励时，化神期自动触发神之一手提示', () => {
    const reward = normalizeRealmReward({ memberRealm: '化神期', remainingSpins: 3 });
    expect(reward.type).toBe('divine');
    expect(reward.label).toBe('神之一手');
    expect(reward.description).toContain('神秘奖池');
    expect(reward.ready).toBe(false);
    expect(reward.total).toBeGreaterThanOrEqual(1);
  });

  test('后端传回未解锁的结丹奖励时也会自动补全', () => {
    const reward = normalizeRealmReward({
      memberRealm: '结丹后期',
      realmReward: { label: '结丹后期 奖励', type: 'none', total: 0, remaining: 0 }
    });
    expect(reward.type).toBe('boost');
    expect(reward.label).toBe('结丹奖励 +4');
    expect(reward.remaining).toBe(4);
    expect(reward.ready).toBe(true);
  });

  test('保留后端已经计算好的境界奖励', () => {
    const reward = normalizeRealmReward({
      memberRealm: '化神期',
      realmReward: { label: '神之一手', type: 'divine', total: 2, remaining: 1, ready: true }
    });
    expect(reward.type).toBe('divine');
    expect(reward.remaining).toBe(1);
    expect(reward.ready).toBe(true);
  });
});
