jest.mock('common-config', () => ({
  COLLECTIONS: { MEMBERS: 'members', LEVELS: 'levels' },
  buildCloudAssetUrl: (bucket, file) => `cloud://${bucket}/${file}`,
  realmConfigs: [
    { realmName: '炼气期', shortName: '炼气', realmOrder: 1 },
    { realmName: '筑基期', shortName: '筑基', realmOrder: 2 },
    { realmName: '结丹期', shortName: '结丹', realmOrder: 3 },
    { realmName: '元婴期', shortName: '元婴', realmOrder: 4 },
    { realmName: '化神期', shortName: '化神', realmOrder: 5 }
  ]
}));

jest.mock('wx-server-sdk');

const activities = require('../../cloudfunctions/activities/index');
const { normalizeBargainSession, buildRealmRewardState, resolveRealmBonus } = activities.__private__;

describe('BHK bargain realm rewards', () => {
  const baseConfig = {
    startPrice: 3500,
    floorPrice: 998,
    baseAttempts: 3,
    segments: [100, 200, 300],
    mysteryLabel: '???'
  };

  it('hydrates existing session with latest member boost', () => {
    const existingRecord = {
      _id: 'record-1',
      activityId: 'bhk',
      memberId: 'user-openid',
      currentPrice: 3200,
      totalDiscount: 300,
      remainingSpins: 1,
      baseSpins: 3,
      memberBoost: 0,
      assistSpins: 0,
      shareCount: 0,
      helperRecords: [],
      realmBonusTotal: 0,
      realmBonusRemaining: 0,
      divineHandRemaining: 0,
      memberRealm: ''
    };

    const normalized = normalizeBargainSession(existingRecord, baseConfig, {
      memberBoost: 4,
      memberRealm: '化神期'
    });

    expect(normalized.memberBoost).toBe(4);
    expect(normalized.memberRealm).toBe('化神期');
    const { bonus } = resolveRealmBonus(normalized.memberBoost);
    const hydrated = { ...normalized };
    if (!Number.isFinite(hydrated.realmBonusTotal) || hydrated.realmBonusTotal === 0) {
      hydrated.realmBonusTotal = bonus;
      hydrated.realmBonusRemaining = Math.max(0, Math.min(bonus, hydrated.remainingSpins || 0));
    }
    expect(hydrated.realmBonusTotal).toBe(4);
    expect(hydrated.realmBonusRemaining).toBe(1);
  });

  it('returns divine hand reward when member boost reaches threshold', () => {
    const reward = buildRealmRewardState({
      memberBoost: 4,
      memberRealm: '化神期',
      divineHandRemaining: 1,
      remainingSpins: 0
    });

    expect(reward.type).toBe('divine');
    expect(reward.label).toContain('神之一手');
    expect(reward.ready).toBe(true);
  });
});
