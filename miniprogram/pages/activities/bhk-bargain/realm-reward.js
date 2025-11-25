const DIVINE_HAND_KEYWORDS = ['元婴', '化神', '炼虚', '合体', '大乘', '渡劫'];
const REALM_REWARD_RULES = [
  { keyword: '炼气', bonus: 1, label: '炼气奖励' },
  { keyword: '筑基', bonus: 2, label: '筑基奖励' },
  { keyword: '结丹', bonus: 4, label: '结丹奖励' }
];

function resolveRealmTier(realmName = '', memberBoost = 0) {
  const normalized = (realmName || '').trim();
  if (!normalized) {
    return null;
  }
  const matched = REALM_REWARD_RULES.find((item) => normalized.includes(item.keyword));
  if (matched) {
    return { ...matched, type: 'boost' };
  }
  const isDivine = DIVINE_HAND_KEYWORDS.some((keyword) => normalized.includes(keyword)) || Number(memberBoost) >= 4;
  if (isDivine) {
    return { type: 'divine', label: '神之一手', bonus: 0 };
  }
  return null;
}

function buildRealmRewardFromTier(baseReward = {}, tier, session = {}) {
  if (!tier) {
    return null;
  }

  if (tier.type === 'divine') {
    const remaining = Number.isFinite(session.divineHandRemaining)
      ? Math.max(0, Math.floor(session.divineHandRemaining))
      : session.remainingSpins <= 0
        ? 1
        : 0;
    return {
      ...baseReward,
      type: 'divine',
      label: '神之一手',
      description: '所有奖励用尽后仍可必中神秘奖池，直降至 998 底价',
      total: Math.max(1, remaining),
      remaining,
      ready: remaining > 0
    };
  }

  const total = tier.bonus;
  const remaining = Number.isFinite(session.realmBonusRemaining)
    ? Math.max(0, Math.floor(session.realmBonusRemaining))
    : total;
  return {
    ...baseReward,
    type: 'boost',
    label: `${tier.label} +${total}`,
    description: '境界额外砍价次数，先用完再触发神之一手',
    total,
    remaining,
    ready: remaining > 0
  };
}

function normalizeRealmReward(session = {}) {
  const realmName = (session.memberRealm || '').trim();
  const baseReward = {
    type: 'none',
    label: realmName ? `${realmName} 奖励` : '境界奖励',
    description: '认证修仙境界即可解锁额外砍价奖励',
    total: 0,
    remaining: 0,
    ready: false,
    realmName
  };

  const tier = resolveRealmTier(realmName, session.memberBoost);
  const buildTierReward = () => buildRealmRewardFromTier(baseReward, tier, session);

  const sessionReward = session.realmReward;
  if (sessionReward && typeof sessionReward === 'object') {
    const type = sessionReward.type === 'divine' ? 'divine' : sessionReward.type === 'boost' ? 'boost' : 'none';
    const total = Number.isFinite(sessionReward.total) ? Math.max(0, Math.floor(sessionReward.total)) : 0;
    const remaining = Number.isFinite(sessionReward.remaining)
      ? Math.max(0, Math.floor(sessionReward.remaining))
      : total;
    const ready =
      typeof sessionReward.ready === 'boolean'
        ? sessionReward.ready
        : type === 'divine'
          ? false
          : remaining > 0;
    const normalized = {
      ...baseReward,
      type,
      label: sessionReward.label || baseReward.label,
      description:
        sessionReward.description ||
        (type === 'divine' ? '必中隐藏奖池，直接抵达 998 底价' : '境界额外砍价次数'),
      total,
      remaining,
      ready
    };

    if (normalized.type === 'none' && tier) {
      return buildTierReward();
    }
    return normalized;
  }

  const tierReward = buildTierReward();
  if (tierReward) {
    return tierReward;
  }

  return baseReward;
}

module.exports = {
  normalizeRealmReward,
  resolveRealmTier,
  buildRealmRewardFromTier
};
