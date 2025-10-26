const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const commonConfig = require('common-config');
const {
  COLLECTIONS,
  resolveBackgroundById,
  normalizeBackgroundId,
  pickPortraitUrl,
  normalizeAvatarFrameValue
} = commonConfig;
const { createProxyHelpers } = require('admin-proxy');
const {
  DEFAULT_COMBAT_STATS,
  DEFAULT_SPECIAL_STATS,
  clamp,
  extractCombatProfile,
  resolveCombatStats,
  resolveSpecialStats,
  determineRoundOrder
} = require('combat-system');
const {
  buildSkillLoadout: buildRuntimeSkillLoadout,
  createActorRuntime,
  takeTurn: executeSkillTurn,
  configureResourceDefaults
} = require('skill-engine');
const {
  aggregateSkillEffects,
  SKILL_MAP,
  resolveSkillQualityColor,
  resolveSkillQualityLabel
} = require('skill-model');
const { createBattlePayload, decorateBattleReplay } = require('battle-schema');
const {
  DEFAULT_GAME_PARAMETERS,
  buildResourceConfigOverrides,
  resolveGameParametersFromDocument,
  FEATURE_TOGGLE_DOC_ID
} = require('system-settings');

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'pvp' });

const DEFAULT_SEASON_LENGTH_DAYS = 56;
const MATCH_ROUND_LIMIT = 15;
const LEADERBOARD_CACHE_SIZE = 100;
const LEADERBOARD_CACHE_SCHEMA_VERSION = 2;
const RECENT_MATCH_LIMIT = 10;
const DEFAULT_RATING = 1200;
const BATTLE_COOLDOWN_MS = 10 * 1000;
const BATTLE_COOLDOWN_MESSAGE = '您的上一场战斗还没结束，请稍后再战';

const PVP_TIERS = [
  { id: 'bronze', name: '青铜', min: 0, max: 999, color: '#c4723a', rewardKey: 'bronze' },
  { id: 'silver', name: '白银', min: 1000, max: 1499, color: '#c0c0c0', rewardKey: 'silver' },
  { id: 'gold', name: '黄金', min: 1500, max: 1999, color: '#d4af37', rewardKey: 'gold' },
  { id: 'platinum', name: '白金', min: 2000, max: 2399, color: '#e5f0ff', rewardKey: 'platinum' },
  { id: 'diamond', name: '钻石', min: 2400, max: 2799, color: '#7dd3fc', rewardKey: 'diamond' },
  { id: 'master', name: '宗师', min: 2800, max: Infinity, color: '#f472b6', rewardKey: 'master' }
];

const TIER_REWARD_MAP = {
  bronze: { stones: 50, title: '青铜试剑者', coupon: null },
  silver: { stones: 80, title: '白银破阵者', coupon: 'coupon_pvp_silver' },
  gold: { stones: 120, title: '黄金斗剑士', coupon: 'coupon_pvp_gold' },
  platinum: { stones: 160, title: '白金灵刃', coupon: 'coupon_pvp_platinum' },
  diamond: { stones: 220, title: '钻石星耀者', coupon: 'coupon_pvp_diamond' },
  master: { stones: 320, title: '宗师武曲星', coupon: 'coupon_pvp_master' }
};

const tierMap = PVP_TIERS.reduce((acc, tier) => {
  acc[tier.id] = tier;
  return acc;
}, {});

const REQUIRED_PVP_COLLECTIONS = [
  COLLECTIONS.PVP_PROFILES,
  COLLECTIONS.PVP_SEASONS,
  COLLECTIONS.PVP_MATCHES,
  COLLECTIONS.PVP_LEADERBOARD,
  COLLECTIONS.PVP_INVITES
];

async function applyGlobalGameParameters() {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.SYSTEM_SETTINGS)
      .doc(FEATURE_TOGGLE_DOC_ID)
      .get();
    const document = snapshot && snapshot.data ? snapshot.data : null;
    const parameters = resolveGameParametersFromDocument(document);
    configureResourceDefaults(buildResourceConfigOverrides(parameters));
    return parameters;
  } catch (error) {
    if (!(error && error.errMsg && /not exist|not found/i.test(error.errMsg))) {
      console.error('[pvp] load game parameters failed', error);
    }
    configureResourceDefaults(buildResourceConfigOverrides(DEFAULT_GAME_PARAMETERS));
    return DEFAULT_GAME_PARAMETERS;
  }
}

function buildBackgroundPayloadFromId(backgroundId, animatedFlag) {
  const normalized = normalizeBackgroundId(backgroundId || '');
  const animated = !!animatedFlag;
  if (!normalized) {
    return null;
  }
  const definition = resolveBackgroundById(normalized);
  if (!definition) {
    return { id: normalized, animated };
  }
  return {
    id: normalized,
    name: definition.name,
    image: definition.image,
    video: definition.video,
    animated
  };
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed;
}

function looksLikeUrl(value) {
  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    return false;
  }
  return (
    /^https?:\/\//.test(trimmed) ||
    trimmed.startsWith('cloud://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('wxfile://')
  );
}

function resolveAvatarFrameValue(...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = toTrimmedString(candidates[i]);
    if (!candidate) {
      continue;
    }
    const normalized = normalizeAvatarFrameValue(candidate);
    if (normalized) {
      return normalized;
    }
    if (looksLikeUrl(candidate)) {
      return candidate;
    }
  }
  return '';
}

function normalizeTitleId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed;
}

function normalizeTitleCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = normalizeTitleId(entry.id);
  if (!id) {
    return null;
  }
  const name =
    typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  const imageFile =
    typeof entry.imageFile === 'string' && entry.imageFile.trim()
      ? entry.imageFile.trim()
      : id;
  return { id, name, imageFile };
}

function normalizeTitleCatalog(list = []) {
  const seen = new Set();
  const normalizedList = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    const normalized = normalizeTitleCatalogEntry(item);
    if (!normalized || seen.has(normalized.id)) {
      return;
    }
    seen.add(normalized.id);
    normalizedList.push(normalized);
  });
  return normalizedList;
}

let collectionsReady = false;
let ensuringCollectionsPromise = null;

function resolveDateInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assertBattleCooldown(lastBattleAt, now = new Date()) {
  if (!lastBattleAt) {
    return;
  }
  const last = resolveDateInput(lastBattleAt);
  if (!last) {
    return;
  }
  if (now.getTime() - last.getTime() < BATTLE_COOLDOWN_MS) {
    throw createError('BATTLE_COOLDOWN_ACTIVE', BATTLE_COOLDOWN_MESSAGE);
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = typeof event.action === 'string' ? event.action.trim() : 'profile';
  const { memberId: proxyMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const actorId =
    action === 'getLeaderboard'
      ? resolveOptionalActorId(proxyMemberId || OPENID, event)
      : resolveActorId(proxyMemberId || OPENID, event);

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  await ensurePvpCollections();

  switch (action) {
    case 'profile':
      return loadProfile(actorId, event);
    case 'matchRandom':
      return matchRandom(actorId, event);
    case 'matchFriend':
      return matchFriend(actorId, event);
    case 'battleReplay':
      return loadBattleReplay(actorId, event);
    case 'getLeaderboard':
      return getLeaderboard(actorId, event);
    case 'inspectArchive':
      return inspectMemberArchive(actorId, event);
    case 'claimSeasonReward':
      return claimSeasonReward(actorId, event);
    case 'sendInvite':
      return sendInvite(actorId, event);
    case 'acceptInvite':
      return acceptInvite(actorId, event);
    default:
      throw createError('UNKNOWN_ACTION', `未知操作：${action}`);
  }
};

async function ensurePvpCollections() {
  if (collectionsReady) {
    return;
  }

  if (ensuringCollectionsPromise) {
    return ensuringCollectionsPromise;
  }

  ensuringCollectionsPromise = (async () => {
    try {
      await Promise.all(
        REQUIRED_PVP_COLLECTIONS.map(async (name) => {
          const exists = await db
            .collection(name)
            .limit(1)
            .get()
            .then(() => true)
            .catch((error) => {
              if (isCollectionMissingError(error)) {
                return false;
              }
              throw error;
            });

          if (!exists) {
            await db.createCollection(name).catch((error) => {
              if (isCollectionAlreadyExistsError(error)) {
                return;
              }
              throw error;
            });
          }
        })
      );
      collectionsReady = true;
    } catch (error) {
      const wrapped = isCollectionMissingError(error)
        ? createError('COLLECTIONS_NOT_INITIALIZED', 'PVP 数据集合未初始化，请按照部署文档创建云数据库集合')
        : error;
      throw wrapped;
    } finally {
      ensuringCollectionsPromise = null;
    }
  })();

  return ensuringCollectionsPromise;
}

async function loadProfile(memberId, options = {}) {
  const season = await ensureActiveSeason();
  const member = await ensureMember(memberId);
  const profile = await ensurePvpProfile(memberId, member, season);
  if (options && options.refreshOnly) {
    return {
      success: true,
      memberId,
      refreshed: true,
      season: buildSeasonPayload(season),
      combatSnapshot: profile.combatSnapshot || null,
      memberSnapshot: profile.memberSnapshot || null
    };
  }
  const [recentMatches, leaderboard] = await Promise.all([
    loadRecentMatches(memberId, season._id),
    loadLeaderboardSnapshot(season._id, { limit: 10 })
  ]);
  return {
    season: buildSeasonPayload(season),
    profile: decorateProfileForClient(profile, member, season),
    history: (profile.seasonHistory || []).map(formatSeasonHistoryEntry),
    recentMatches: recentMatches.map((match) => decorateMatchSummary(match, memberId)),
    leaderboardPreview: leaderboard.entries || [],
    leaderboardUpdatedAt: leaderboard.updatedAt || null
  };
}

async function matchRandom(memberId, event = {}) {
  const season = await ensureActiveSeason();
  const member = await ensureMember(memberId);
  const profile = await ensurePvpProfile(memberId, member, season);
  assertBattleCooldown(profile.lastMatchedAt);
  const seed = normalizeSeed(event.seed) || buildMatchSeed(memberId, season._id);
  const opponent = await findRandomOpponent(memberId, season, profile);
  const battle = await resolveBattle(memberId, member, profile, opponent, season, { seed });
  await updateLeaderboardCache(season._id);
  const refreshedProfile = await ensurePvpProfile(memberId, member, season);
  const [recentMatches, leaderboard] = await Promise.all([
    loadRecentMatches(memberId, season._id),
    loadLeaderboardSnapshot(season._id, { limit: 10 })
  ]);
  return {
    season: buildSeasonPayload(season),
    profile: decorateProfileForClient(refreshedProfile, member, season),
    opponent: battle.opponentPreview,
    battle: battle.result,
    recentMatches: recentMatches.map((match) => decorateMatchSummary(match, memberId)),
    leaderboardPreview: leaderboard.entries || [],
    leaderboardUpdatedAt: leaderboard.updatedAt || null
  };
}

async function matchFriend(memberId, event = {}) {
  const targetId = normalizeMemberId(event.targetId);
  if (!targetId) {
    throw createError('TARGET_REQUIRED', '请选择要切磋的好友');
  }
  const season = await ensureActiveSeason();
  const member = await ensureMember(memberId);
  const profile = await ensurePvpProfile(memberId, member, season);

  let opponent = null;
  let seed = normalizeSeed(event.seed);
  if (targetId === memberId) {
    const botSeedBase = `${memberId}:sparringBot`;
    const resolvedSeed = seed || buildMatchSeed(botSeedBase, season._id);
    opponent = {
      isBot: true,
      profile: buildBotProfile(profile, season, resolvedSeed)
    };
    seed = resolvedSeed;
  } else {
    const opponentMember = await ensureMember(targetId);
    const opponentProfile = await ensurePvpProfile(targetId, opponentMember, season);
    seed = seed || buildMatchSeed(`${memberId}:${targetId}`, season._id);
    opponent = {
      isBot: false,
      member: opponentMember,
      profile: opponentProfile
    };
  }

  const battle = await resolveBattle(memberId, member, profile, opponent, season, { seed, friendMatch: true });
  await updateLeaderboardCache(season._id);
  const refreshedProfile = await ensurePvpProfile(memberId, member, season);
  const [recentMatches, leaderboard] = await Promise.all([
    loadRecentMatches(memberId, season._id),
    loadLeaderboardSnapshot(season._id, { limit: 10 })
  ]);
  return {
    season: buildSeasonPayload(season),
    profile: decorateProfileForClient(refreshedProfile, member, season),
    opponent: battle.opponentPreview,
    battle: battle.result,
    recentMatches: recentMatches.map((match) => decorateMatchSummary(match, memberId)),
    leaderboardPreview: leaderboard.entries || [],
    leaderboardUpdatedAt: leaderboard.updatedAt || null
  };
}

async function loadBattleReplay(memberId, event = {}) {
  const matchId = normalizeId(event.matchId);
  if (!matchId) {
    throw createError('MATCH_REQUIRED', '缺少战报编号');
  }
  const snapshot = await db
    .collection(COLLECTIONS.PVP_MATCHES)
    .doc(matchId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw createError('MATCH_NOT_FOUND', '战报不存在或已过期');
  }
  const match = snapshot.data;
  if (match.player && match.opponent) {
    const participantIds = [match.player.memberId, match.opponent.memberId];
    if (!participantIds.includes(memberId)) {
      throw createError('FORBIDDEN', '仅参战成员可查看战报');
    }
  }
  return decorateMatchReplay(match);
}

async function getLeaderboard(memberId, event = {}) {
  const type = typeof event.type === 'string' && event.type ? event.type : 'season';
  const limit = Number.isFinite(event.limit) ? Math.max(10, Math.min(Number(event.limit), 200)) : 100;
  const seasonId = normalizeId(event.seasonId);
  const season = seasonId ? await loadSeasonById(seasonId) : await ensureActiveSeason();
  if (!season) {
    throw createError('SEASON_NOT_FOUND', '未找到对应赛季');
  }
  const forceRefresh = !!(event && (event.refresh || event.forceRefresh));
  const snapshot = await loadLeaderboardSnapshot(season._id, { limit, type, forceRefresh });
  const entries = (snapshot.entries || [])
    .slice(0, limit)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }
      const avatarFrame = resolveAvatarFrameValue(entry.avatarFrame);
      const titleId = typeof entry.titleId === 'string' ? entry.titleId : '';
      const titleName = typeof entry.titleName === 'string' ? entry.titleName : '';
      const titleCatalog = normalizeTitleCatalog(entry.titleCatalog);
      if (avatarFrame || entry.avatarFrame) {
        return {
          ...entry,
          avatarFrame,
          titleId,
          titleName,
          titleCatalog
        };
      }
      return {
        ...entry,
        avatarFrame: '',
        titleId,
        titleName,
        titleCatalog
      };
    });
  const rankIndex = entries.findIndex((entry) => entry.memberId === memberId);
  return {
    season: buildSeasonPayload(season),
    type,
    entries,
    updatedAt: snapshot.updatedAt || null,
    myRank: rankIndex >= 0 ? rankIndex + 1 : null,
    memberId
  };
}

async function inspectMemberArchive(actorId, event = {}) {
  const targetId = normalizeMemberId(event.targetId || event.memberId);
  if (!targetId) {
    throw createError('TARGET_REQUIRED', '请选择要查看的仙友');
  }
  const season = await ensureActiveSeason();
  const member = await ensureMember(targetId);
  const profile = await ensurePvpProfile(targetId, member, season);

  const normalizedCombat = normalizeCombatSnapshot(profile.combatSnapshot || {});
  const attributeSummary =
    member && member.pveProfile && typeof member.pveProfile === 'object'
      ? member.pveProfile.attributeSummary || {}
      : {};
  const attributeList = Array.isArray(attributeSummary.attributeList)
    ? attributeSummary.attributeList.map((attr) => ({
        key: attr.key,
        label: attr.label,
        formattedValue: attr.formattedValue,
        formattedBase: attr.formattedBase,
        formattedTrained: attr.formattedTrained,
        formattedEquipment: attr.formattedEquipment,
        formattedSkill: attr.formattedSkill
      }))
    : [];
  const combatStats = Array.isArray(attributeSummary.combatStats)
    ? attributeSummary.combatStats.map((stat) => ({
        key: stat.key,
        label: stat.label,
        formattedValue: stat.formattedValue,
        formattedBase: stat.formattedBase,
        formattedEquipment: stat.formattedEquipment,
        formattedSkill: stat.formattedSkill,
        formattedMultiplier: stat.formattedMultiplier
      }))
    : [];

  const tier = resolveTierByPoints(profile.points);
  const backgroundId = buildBackgroundIdFromMember(member);
  const background = buildBackgroundPayloadFromId(backgroundId, member.appearanceBackgroundAnimated);
  const avatarFrame = resolveAvatarFrameValue(
    profile.memberSnapshot && profile.memberSnapshot.avatarFrame,
    profile.memberSnapshot && profile.memberSnapshot.appearance && profile.memberSnapshot.appearance.avatarFrame,
    member && member.avatarFrame,
    member && member.appearanceFrame,
    member && member.appearance && member.appearance.avatarFrame,
    profile.avatarFrame,
    profile.appearance && profile.appearance.avatarFrame
  );
  const portrait = pickPortraitUrl(
    profile.memberSnapshot && profile.memberSnapshot.portrait,
    member && member.portrait,
    profile.memberSnapshot && profile.memberSnapshot.avatarUrl,
    member && member.avatarUrl,
    ''
  );

  const combatPower = Number.isFinite(attributeSummary.combatPower)
    ? Math.round(attributeSummary.combatPower)
    : Math.round(normalizedCombat.combatPower || 0);

  const equippedSkills = buildEquippedSkillSummary(member && member.pveProfile);
  const fallbackSkills = buildEquippedSkillsFromLoadout(normalizedCombat.skillLoadout || []);
  const skillPayload = equippedSkills.length ? equippedSkills : fallbackSkills;

  return {
    target: {
      memberId: targetId,
      nickName:
        (profile.memberSnapshot && profile.memberSnapshot.nickName) || member.nickName || member.name || '无名仙友',
      avatarUrl:
        (profile.memberSnapshot && profile.memberSnapshot.avatarUrl) || member.avatarUrl || member.portrait || '',
      avatarFrame: avatarFrame || '',
      titleId:
        member.appearanceTitle ||
        (profile.memberSnapshot && profile.memberSnapshot.appearance && profile.memberSnapshot.appearance.titleId) ||
        '',
      titleName:
        member.appearanceTitleName ||
        (profile.memberSnapshot && profile.memberSnapshot.appearance && profile.memberSnapshot.appearance.titleName) ||
        '',
      levelName:
        attributeSummary.levelName ||
        (member.level && (member.level.name || member.level.label)) ||
        (profile.memberSnapshot && profile.memberSnapshot.levelName) ||
        '',
      realmName:
        attributeSummary.realmName ||
        (member.level && member.level.realmName) ||
        (profile.memberSnapshot && profile.memberSnapshot.realmName) ||
        '',
      combatPower,
      tier: tierPayload(tier),
      points: profile.points,
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      background: background || null,
      appearanceBackgroundAnimated: !!(background && background.animated),
      portrait: portrait || ''
    },
    attributes: {
      attributeList,
      combatStats
    },
    skills: {
      equipped: skillPayload
    }
  };
}

function buildEquippedSkillSummary(profile = null) {
  if (!profile || !profile.skills) {
    return [];
  }
  const skillsState = profile.skills || {};
  const inventory = Array.isArray(skillsState.inventory) ? skillsState.inventory : [];
  const equipped = Array.isArray(skillsState.equipped) ? skillsState.equipped : [];
  if (!equipped.length) {
    return [];
  }
  const inventoryMap = inventory.reduce((map, entry) => {
    if (!entry || typeof entry !== 'object') {
      return map;
    }
    const skillId = typeof entry.skillId === 'string' ? entry.skillId.trim() : '';
    if (!skillId) {
      return map;
    }
    map[skillId] = entry;
    return map;
  }, {});

  return equipped
    .map((rawId, index) => {
      const skillId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!skillId) {
        return null;
      }
      const definition = SKILL_MAP[skillId];
      if (!definition) {
        return null;
      }
      const inventoryEntry = inventoryMap[skillId] || {};
      const level = Math.max(1, Math.floor(Number(inventoryEntry.level) || 1));
      const quality = definition.quality || 'linggan';
      return {
        slot: index,
        skillId,
        name: definition.name || '技能',
        level,
        quality,
        qualityLabel: resolveSkillQualityLabel(quality),
        qualityColor: resolveSkillQualityColor(quality)
      };
    })
    .filter((item) => !!item);
}

function buildEquippedSkillsFromLoadout(loadout = []) {
  if (!Array.isArray(loadout)) {
    return [];
  }
  return loadout
    .filter((entry) => entry && entry.id && entry.id !== 'basic_attack')
    .map((entry, index) => {
      const definition = SKILL_MAP[entry.id] || {};
      const quality = definition.quality || entry.quality || 'linggan';
      return {
        slot: index,
        skillId: entry.id,
        name: entry.name || definition.name || '技能',
        level: Math.max(1, Math.floor(Number(entry.level) || 1)),
        quality,
        qualityLabel: resolveSkillQualityLabel(quality),
        qualityColor: resolveSkillQualityColor(quality)
      };
    });
}

async function claimSeasonReward(memberId, event = {}) {
  const seasonId = normalizeId(event.seasonId);
  if (!seasonId) {
    throw createError('SEASON_REQUIRED', '缺少赛季编号');
  }
  const season = await loadSeasonById(seasonId);
  if (!season) {
    throw createError('SEASON_NOT_FOUND', '赛季不存在');
  }
  if (!isSeasonEnded(season)) {
    throw createError('SEASON_NOT_FINISHED', '赛季尚未结束，无法领取奖励');
  }
  const profileDoc = await db
    .collection(COLLECTIONS.PVP_PROFILES)
    .doc(memberId)
    .get()
    .catch(() => null);
  if (!profileDoc || !profileDoc.data) {
    throw createError('PROFILE_NOT_FOUND', '没有找到对应的竞技数据');
  }
  const profile = profileDoc.data;
  let targetEntry = null;
  let entryIndex = -1;
  if (profile.seasonId === seasonId) {
    targetEntry = profile;
  }
  if (!targetEntry && Array.isArray(profile.seasonHistory)) {
    entryIndex = profile.seasonHistory.findIndex((item) => item.seasonId === seasonId);
    if (entryIndex >= 0) {
      targetEntry = profile.seasonHistory[entryIndex];
    }
  }
  if (!targetEntry) {
    throw createError('PROFILE_NOT_FOUND', '未找到赛季结算记录');
  }
  if (targetEntry.claimedSeasonReward) {
    throw createError('REWARD_ALREADY_CLAIMED', '本赛季奖励已领取');
  }
  const tier = resolveTierByPoints(targetEntry.points || DEFAULT_RATING);
  const reward = resolveSeasonReward(tier.id);
  const now = new Date();
  if (targetEntry === profile) {
    await db
      .collection(COLLECTIONS.PVP_PROFILES)
      .doc(memberId)
      .update({
        data: {
          claimedSeasonReward: true,
          updatedAt: now
        }
      })
      .catch(() => {});
  } else if (entryIndex >= 0) {
    const history = Array.isArray(profile.seasonHistory) ? [...profile.seasonHistory] : [];
    history[entryIndex] = { ...history[entryIndex], claimedSeasonReward: true, claimedAt: now };
    await db
      .collection(COLLECTIONS.PVP_PROFILES)
      .doc(memberId)
      .update({
        data: {
          seasonHistory: history,
          updatedAt: now
        }
      })
      .catch(() => {});
  }
  return {
    season: buildSeasonPayload(season),
    reward,
    tier: tierPayload(tier),
    claimedAt: now
  };
}

async function sendInvite(memberId, event = {}) {
  const season = await ensureActiveSeason();
  const member = await ensureMember(memberId);
  const profile = await ensurePvpProfile(memberId, member, season);
  const channel = typeof event.channel === 'string' && event.channel ? event.channel : 'friend';
  const seed = normalizeSeed(event.seed) || buildMatchSeed(`${memberId}:invite`, season._id);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const inviteRecord = {
    inviterId: memberId,
    seasonId: season._id,
    seasonName: season.name,
    channel,
    seed,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt,
    usageCount: 0,
    tierId: profile.tierId,
    tierName: profile.tierName,
    inviterSnapshot: buildMemberSnapshot(member)
  };
  const collection = db.collection(COLLECTIONS.PVP_INVITES);
  const { _id } = await collection.add({ data: inviteRecord });
  const inviteId = _id;
  await collection
    .doc(inviteId)
    .update({ data: { inviteId } })
    .catch(() => {});
  return {
    inviteId,
    seed,
    expiresAt,
    channel,
    season: buildSeasonPayload(season),
    tier: tierPayload(resolveTierByPoints(profile.points)),
    signature: signBattlePayload({
      seasonId: season._id,
      seed,
      inviterId: memberId,
      inviteId
    })
  };
}

async function acceptInvite(memberId, event = {}) {
  const inviteId = normalizeId(event.inviteId);
  if (!inviteId) {
    throw createError('INVITE_REQUIRED', '缺少邀战编号');
  }
  const season = await ensureActiveSeason();
  const inviteSnapshot = await db
    .collection(COLLECTIONS.PVP_INVITES)
    .doc(inviteId)
    .get()
    .catch(() => null);
  if (!inviteSnapshot || !inviteSnapshot.data) {
    throw createError('INVITE_NOT_FOUND', '挑战邀请不存在或已失效');
  }
  const invite = inviteSnapshot.data;
  if (invite.expiresAt) {
    const expiresAt = new Date(invite.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      throw createError('INVITE_EXPIRED', '该邀请已过期');
    }
  }
  const inviterId = invite.inviterId;
  if (!inviterId) {
    throw createError('INVITER_MISSING', '邀请缺少发起人信息');
  }
  if (inviterId === memberId) {
    return matchRandom(memberId, event);
  }
  const [member, inviterMember] = await Promise.all([ensureMember(memberId), ensureMember(inviterId)]);
  const [profile, inviterProfile] = await Promise.all([
    ensurePvpProfile(memberId, member, season),
    ensurePvpProfile(inviterId, inviterMember, season)
  ]);
  const seed = invite.seed || buildMatchSeed(`${inviterId}:${memberId}`, season._id);
  const opponent = {
    isBot: false,
    member: inviterMember,
    profile: inviterProfile
  };
  const battle = await resolveBattle(memberId, member, profile, opponent, season, {
    seed,
    inviteId,
    friendMatch: true,
    inviteMatch: true
  });
  const now = new Date();
  await db
    .collection(COLLECTIONS.PVP_INVITES)
    .doc(inviteId)
    .update({
      data: {
        opponentId: memberId,
        matchId: battle.result.matchId,
        acceptedAt: now,
        updatedAt: now,
        usageCount: _.inc(1)
      }
    })
    .catch(() => {});
  await updateLeaderboardCache(season._id);
  const refreshedProfile = await ensurePvpProfile(memberId, member, season);
  const [recentMatches, leaderboard] = await Promise.all([
    loadRecentMatches(memberId, season._id),
    loadLeaderboardSnapshot(season._id, { limit: 10 })
  ]);
  return {
    season: buildSeasonPayload(season),
    profile: decorateProfileForClient(refreshedProfile, member, season),
    opponent: battle.opponentPreview,
    battle: battle.result,
    recentMatches: recentMatches.map((match) => decorateMatchSummary(match, memberId)),
    leaderboardPreview: leaderboard.entries || [],
    leaderboardUpdatedAt: leaderboard.updatedAt || null
  };
}

async function resolveBattle(memberId, member, profile, opponentDescriptor, season, options = {}) {
  const opponent = opponentDescriptor.isBot
    ? opponentDescriptor
    : {
        ...opponentDescriptor,
        member: opponentDescriptor.member,
        profile: opponentDescriptor.profile
      };
  const opponentMember = opponent.isBot ? null : opponent.member;
  const opponentProfile = opponent.isBot ? buildBotProfile(profile, season, opponentDescriptor.seed) : opponent.profile;
  const seed = normalizeSeed(options.seed) || buildMatchSeed(`${memberId}:${Date.now()}`, season._id);
  const playerCombat = profile.combatSnapshot || buildCombatSnapshot(member);
  const opponentCombat = opponentProfile.combatSnapshot || buildCombatSnapshot(opponentMember || member);
  const playerEntry = buildBattleActor({
    memberId,
    member,
    profile,
    combat: playerCombat
  });
  const opponentEntry = buildBattleActor({
    memberId: opponent.isBot ? opponentProfile.memberId : opponentProfile.memberId || opponentMember._id,
    member: opponentMember,
    profile: opponentProfile,
    combat: opponentCombat,
    isBot: opponent.isBot
  });

  await applyGlobalGameParameters();
  const simulation = simulateBattle(playerEntry, opponentEntry, seed);
  const initiatorId = options && options.inviteMatch ? opponentEntry.memberId : playerEntry.memberId;
  const defenderEntry = initiatorId === playerEntry.memberId ? opponentEntry : playerEntry;
  const resultPayload = await persistBattleResult({
    season,
    player: playerEntry,
    opponent: opponentEntry,
    profile,
    opponentProfile,
    simulation,
    options,
    initiatorId,
    defenderId: defenderEntry.memberId
  });
  const opponentPreview = {
    memberId: opponentEntry.memberId,
    isBot: !!opponentEntry.isBot,
    nickName: opponentEntry.displayName,
    tierId: opponentProfile.tierId,
    tierName: opponentProfile.tierName,
    points: opponentProfile.points,
    avatarUrl: opponentMember ? opponentMember.avatarUrl || '' : '',
    summary: {
      wins: opponentProfile.wins,
      losses: opponentProfile.losses,
      draws: opponentProfile.draws
    }
  };
  const opponentAvatarFrame = resolveAvatarFrameValue(
    opponentEntry.avatarFrame,
    opponentProfile.memberSnapshot && opponentProfile.memberSnapshot.avatarFrame,
    opponentProfile.avatarFrame,
    opponentProfile.appearance && opponentProfile.appearance.avatarFrame,
    opponentMember && opponentMember.avatarFrame,
    opponentMember && opponentMember.appearanceFrame,
    opponentMember && opponentMember.appearance && opponentMember.appearance.avatarFrame
  );
  if (opponentAvatarFrame) {
    opponentPreview.avatarFrame = opponentAvatarFrame;
  }
  if (defenderEntry && defenderEntry.background && defenderEntry.background.id) {
    opponentPreview.defenderBackground = defenderEntry.background;
  }
  return { result: resultPayload, opponentPreview };
}

function simulateBattle(player, opponent, seed) {
  const rng = createRandomGenerator(seed);
  const playerActor = createActorRuntime({
    id: player.memberId,
    name: player.displayName,
    side: 'player',
    combatant: { stats: player.stats, special: player.special },
    skills: Array.isArray(player.skills) ? player.skills : [],
    mode: 'pvp'
  });
  const opponentActor = createActorRuntime({
    id: opponent.memberId,
    name: opponent.displayName,
    side: 'opponent',
    combatant: { stats: opponent.stats, special: opponent.special },
    skills: Array.isArray(opponent.skills) ? opponent.skills : [],
    mode: 'pvp'
  });
  playerActor.memberId = player.memberId;
  playerActor.displayName = player.displayName;
  playerActor.tierId = player.tierId;
  playerActor.tierName = player.tierName;
  playerActor.points = player.points;
  playerActor.isBot = !!player.isBot;
  opponentActor.memberId = opponent.memberId;
  opponentActor.displayName = opponent.displayName;
  opponentActor.tierId = opponent.tierId;
  opponentActor.tierName = opponent.tierName;
  opponentActor.points = opponent.points;
  opponentActor.isBot = !!opponent.isBot;

  const playerBaseMaxHp = Math.max(1, Math.round(playerActor.maxHp || DEFAULT_COMBAT_STATS.maxHp));
  const opponentBaseMaxHp = Math.max(1, Math.round(opponentActor.maxHp || DEFAULT_COMBAT_STATS.maxHp));
  const playerAttributesSnapshot = buildCombatAttributesSnapshot(playerActor.stats);
  const opponentAttributesSnapshot = buildCombatAttributesSnapshot(opponentActor.stats);
  const timeline = [];
  let previousPlayerAttributes = null;
  let previousOpponentAttributes = null;
  for (let round = 1; round <= MATCH_ROUND_LIMIT; round += 1) {
    const { order: roundOrder } = determineRoundOrder(playerActor, opponentActor, {
      playerKey: 'player',
      opponentKey: 'opponent',
      fallbackFirst: 'player'
    });
    const actorsInOrder = roundOrder.map((side) => (side === 'player' ? playerActor : opponentActor));

    let sequence = 1;
    for (let turn = 0; turn < actorsInOrder.length; turn += 1) {
      if (playerActor.hp <= 0 || opponentActor.hp <= 0) {
        break;
      }

      const actor = actorsInOrder[turn];
      const defender = actor === playerActor ? opponentActor : playerActor;
      if (actor.hp <= 0 || defender.hp <= 0) {
        continue;
      }

      const actorSide = actor === playerActor ? 'player' : 'opponent';
      const targetSide = defender === playerActor ? 'player' : 'opponent';
      const beforeState = { player: playerActor.hp, opponent: opponentActor.hp };
      const beforeControl = {
        player: captureControlSnapshot(playerActor),
        opponent: captureControlSnapshot(opponentActor)
      };
      const turnResult = executeSkillTurn({ actor, opponent: defender, rng });
      const afterState = { player: playerActor.hp, opponent: opponentActor.hp };
      const afterControl = {
        player: captureControlSnapshot(playerActor),
        opponent: captureControlSnapshot(opponentActor)
      };
      const events = [];
      if (Array.isArray(turnResult.preEvents) && turnResult.preEvents.length) {
        events.push(...turnResult.preEvents);
      }
      if (Array.isArray(turnResult.events) && turnResult.events.length) {
        events.push(...turnResult.events);
      }
      const actorName = actor.displayName || (actorSide === 'player' ? '我方' : '对手');
      const targetName = defender.displayName || (targetSide === 'player' ? '我方' : '对手');
      const summaryParts = Array.isArray(turnResult.summary) ? turnResult.summary : [];
      const summaryText = summaryParts.length
        ? summaryParts.join('；')
        : `${actorName}发起了攻势`;

      const entry = buildTimelineEntry({
        round,
        sequence,
        actorId: actor.memberId,
        actorName,
        actorSide,
        targetId: defender.memberId,
        targetName,
        events,
        skill: turnResult.skill,
        before: { player: beforeState.player, opponent: beforeState.opponent },
        after: { player: afterState.player, opponent: afterState.opponent },
        playerMaxHp: playerBaseMaxHp,
        opponentMaxHp: opponentBaseMaxHp,
        playerAttributesSnapshot,
        opponentAttributesSnapshot,
        previousAttributes: {
          player: previousPlayerAttributes,
          opponent: previousOpponentAttributes
        },
        controlBefore: beforeControl,
        controlAfter: afterControl,
        summaryText
      });
      timeline.push(entry);
      previousPlayerAttributes = playerAttributesSnapshot ? { ...playerAttributesSnapshot } : null;
      previousOpponentAttributes = opponentAttributesSnapshot ? { ...opponentAttributesSnapshot } : null;
      sequence += 1;

      if (playerActor.hp <= 0 || opponentActor.hp <= 0) {
        break;
      }
    }
    if (playerActor.hp <= 0 || opponentActor.hp <= 0) {
      break;
    }
  }

  const draw = playerActor.hp > 0 && opponentActor.hp > 0;
  let winnerId = null;
  let loserId = null;
  if (!draw) {
    if (playerActor.hp > opponentActor.hp) {
      winnerId = player.memberId;
      loserId = opponent.memberId;
    } else {
      winnerId = opponent.memberId;
      loserId = player.memberId;
    }
  }

  const participantsSnapshot = buildBattleParticipants({
    playerState: playerActor,
    opponentState: opponentActor,
    playerEntry: player,
    opponentEntry: opponent,
    playerMaxHp: playerBaseMaxHp,
    opponentMaxHp: opponentBaseMaxHp,
    playerAttributesSnapshot,
    opponentAttributesSnapshot
  });
  const outcome = buildStructuredBattleOutcome({
    playerState: playerActor,
    opponentState: opponentActor,
    playerEntry: player,
    opponentEntry: opponent,
    draw,
    winnerId,
    loserId,
    timeline
  });
  const metadata = {
    mode: 'pvp',
    seed,
    generatedAt: Date.now()
  };
  const roundsCompleted = Number.isFinite(outcome.rounds)
    ? Math.max(0, Math.floor(outcome.rounds))
    : Math.max(0, timeline.length);

  return {
    seed,
    rounds: roundsCompleted,
    timeline,
    participants: participantsSnapshot,
    outcome,
    metadata,
    draw,
    winnerId,
    loserId
  };
}

async function persistBattleResult({
  season,
  player,
  opponent,
  profile,
  opponentProfile,
  simulation,
  options,
  initiatorId,
  defenderId
}) {
  const now = new Date();
  const result = determineOutcome(simulation, player.memberId);
  const timeline = Array.isArray(simulation.timeline)
    ? simulation.timeline
    : [];
  const legacyRounds = Array.isArray(simulation.rounds) ? simulation.rounds : [];
  const participants = simulation.participants || null;
  const outcome = simulation.outcome || null;
  const metadata = simulation.metadata || { mode: 'pvp', seed: simulation.seed };
  const roundsCount = Number.isFinite(simulation.rounds) && !Array.isArray(simulation.rounds)
    ? Math.max(0, Math.floor(Number(simulation.rounds)))
    : outcome && Number.isFinite(outcome.rounds)
    ? Math.max(0, Math.floor(Number(outcome.rounds)))
    : timeline.length
    ? Math.max(0, Math.floor(Number(timeline[timeline.length - 1].round || timeline.length)))
    : legacyRounds.length;
  const playerUpdate = applyMatchOutcome({
    season,
    profile,
    opponentProfile,
    outcome: result.player,
    isBot: opponent.isBot,
    options
  });
  let opponentUpdate = null;
  if (!opponent.isBot) {
    opponentUpdate = applyMatchOutcome({
      season,
      profile: opponentProfile,
      opponentProfile: profile,
      outcome: result.opponent,
      isBot: false,
      options: { ...options, reversed: true }
    });
  }
  await Promise.all([
    saveProfile(playerUpdate.after, profile.memberId || player.memberId || playerUpdate.after.memberId),
    opponentUpdate && opponentProfile
      ? saveProfile(opponentUpdate.after, opponentProfile.memberId || opponent.memberId || opponentUpdate.after.memberId)
      : Promise.resolve()
  ]);
  const matchRecord = {
    seasonId: season._id,
    seasonName: season.name,
    seed: simulation.seed,
    result: {
      winnerId: simulation.winnerId,
      loserId: simulation.loserId,
      draw: simulation.draw
    },
    player: buildParticipantSnapshot(playerUpdate.after, playerUpdate.delta, player),
    opponent: opponent.isBot
      ? buildParticipantSnapshot(opponentUpdate ? opponentUpdate.after : opponentProfile, opponentUpdate ? opponentUpdate.delta : { points: 0 }, opponent)
      : buildParticipantSnapshot(opponentUpdate.after, opponentUpdate.delta, opponent),
    rounds: roundsCount,
    timeline,
    ...(legacyRounds.length && !timeline.length ? { legacyRounds } : {}),
    participants,
    outcome,
    metadata,
    signature: signBattlePayload({
      seasonId: season._id,
      seed: simulation.seed,
      winnerId: simulation.winnerId,
      loserId: simulation.loserId,
      draw: simulation.draw,
      player: player.memberId,
      opponent: opponent.memberId
    }),
    createdAt: now,
    updatedAt: now,
    options: {
      isBot: opponent.isBot || false,
      friendMatch: !!options.friendMatch,
      inviteMatch: !!options.inviteMatch,
      inviteId: options && options.inviteId ? options.inviteId : null,
      initiatorId: initiatorId || player.memberId,
      defenderId: defenderId || opponent.memberId
    }
  };
  const collection = db.collection(COLLECTIONS.PVP_MATCHES);
  const { _id } = await collection.add({ data: matchRecord });
  const matchId = _id;
  await collection
    .doc(matchId)
    .update({ data: { matchId } })
    .catch(() => {});
  const payload = createBattlePayload({
    battleId: matchId,
    matchId,
    seasonId: season._id,
    seed: simulation.seed,
    mode: 'pvp',
    rounds: roundsCount,
    legacyRounds,
    timeline,
    participants,
    outcome,
    metadata,
    result: matchRecord.result,
    player: matchRecord.player,
    opponent: matchRecord.opponent,
    options: matchRecord.options,
    createdAt: now,
    winnerId: simulation.winnerId,
    loserId: simulation.loserId,
    draw: simulation.draw,
    signature: matchRecord.signature
  });
  payload.seasonId = season._id;
  payload.signature = matchRecord.signature;
  payload.seed = simulation.seed;
  return payload;
}

function buildParticipantSnapshot(profile, delta, actor) {
  const backgroundId = normalizeBackgroundId(actor.appearanceBackgroundId || '');
  const backgroundAnimated = !!actor.appearanceBackgroundAnimated;
  const backgroundPayload = actor.background || buildBackgroundPayloadFromId(backgroundId, backgroundAnimated);
  const avatarFrame = normalizeAvatarFrameValue(actor.avatarFrame || '');
  return {
    memberId: actor.memberId,
    displayName: actor.displayName,
    tierId: profile.tierId,
    tierName: profile.tierName,
    pointsBefore: profile.points - delta.points,
    pointsAfter: profile.points,
    pointsDelta: delta.points,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
    streak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    isBot: !!actor.isBot,
    appearanceBackgroundId: backgroundId,
    appearanceBackgroundAnimated: backgroundAnimated,
    ...(avatarFrame ? { avatarFrame } : {}),
    ...(backgroundPayload ? { background: backgroundPayload } : {})
  };
}

function determineOutcome(simulation, memberId) {
  const draw = simulation.draw;
  const isPlayerWinner = !draw && simulation.winnerId === memberId;
  const isPlayerLoser = !draw && simulation.loserId === memberId;
  return {
    player: {
      result: draw ? 'draw' : isPlayerWinner ? 'win' : 'loss',
      draw
    },
    opponent: {
      result: draw ? 'draw' : isPlayerLoser ? 'win' : 'loss',
      draw
    }
  };
}

function sanitizeProfilePayload(profile) {
  if (!profile || typeof profile !== 'object') {
    return {};
  }
  const payload = { ...profile };
  delete payload._id;
  delete payload._openid;
  delete payload._createTime;
  delete payload._updateTime;
  return payload;
}

async function saveProfile(profile, memberId) {
  const collection = db.collection(COLLECTIONS.PVP_PROFILES);
  const data = sanitizeProfilePayload(profile);
  try {
    await collection.doc(memberId).set({ data });
  } catch (error) {
    if (error && /exists/i.test(error.errMsg || '')) {
      await collection
        .doc(memberId)
        .update({ data })
        .catch((updateError) => {
          throw updateError;
        });
    } else {
      throw error;
    }
  }
}

function applyMatchOutcome({ season, profile, opponentProfile, outcome, isBot, options = {} }) {
  const now = new Date();
  if (options.friendMatch || options.inviteMatch) {
    const tier = resolveTierByPoints(profile.points);
    const updated = {
      ...profile,
      points: profile.points,
      tierId: tier.id,
      tierName: tier.name,
      seasonId: season._id,
      seasonName: season.name,
      memberId: profile.memberId || profile._id,
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      currentStreak: profile.currentStreak || 0,
      longestStreak: profile.longestStreak || 0,
      bestPoints: profile.bestPoints || profile.points,
      lastMatchedAt: now,
      lastResultAt: now,
      updatedAt: now,
      claimedSeasonReward: profile.claimedSeasonReward || false,
      memberSnapshot: profile.memberSnapshot,
      combatSnapshot: profile.combatSnapshot,
      seasonHistory: normalizeSeasonHistory(profile.seasonHistory)
    };
    return { after: updated, delta: { points: 0 } };
  }
  const delta = computeRatingDelta({
    profile,
    opponentProfile,
    outcome,
    isBot,
    options
  });
  const tier = resolveTierByPoints(profile.points + delta.points);
  const updated = {
    ...profile,
    points: Math.max(tier.min, profile.points + delta.points),
    tierId: tier.id,
    tierName: tier.name,
    seasonId: season._id,
    seasonName: season.name,
    memberId: profile.memberId || profile._id,
    wins: profile.wins + (outcome.result === 'win' ? 1 : 0),
    losses: profile.losses + (outcome.result === 'loss' ? 1 : 0),
    draws: profile.draws + (outcome.result === 'draw' ? 1 : 0),
    currentStreak:
      outcome.result === 'win' ? (profile.currentStreak || 0) + 1 : outcome.result === 'loss' ? 0 : profile.currentStreak || 0,
    longestStreak:
      outcome.result === 'win'
        ? Math.max((profile.longestStreak || 0), (profile.currentStreak || 0) + 1)
        : profile.longestStreak || 0,
    bestPoints: Math.max(profile.bestPoints || profile.points, profile.points + delta.points),
    lastMatchedAt: now,
    lastResultAt: now,
    updatedAt: now,
    claimedSeasonReward: profile.claimedSeasonReward || false,
    memberSnapshot: profile.memberSnapshot,
    combatSnapshot: profile.combatSnapshot,
    seasonHistory: normalizeSeasonHistory(profile.seasonHistory)
  };
  return { after: updated, delta };
}

function computeRatingDelta({ profile, opponentProfile, outcome, isBot, options }) {
  if (options && (options.friendMatch || options.inviteMatch)) {
    return { points: 0 };
  }
  const baseWin = options.inviteMatch ? 26 : 30;
  const baseLoss = options.inviteMatch ? -18 : -22;
  const baseDraw = 8;
  const opponentPoints = opponentProfile ? opponentProfile.points || DEFAULT_RATING : profile.points;
  const diff = opponentPoints - profile.points;
  const diffFactor = clamp(diff / 400, -1.5, 1.5);
  let delta = 0;
  if (outcome.result === 'win') {
    const streakBonus = Math.min(profile.currentStreak || 0, 5) * 2;
    delta = Math.round(baseWin + diffFactor * 12 + streakBonus);
  } else if (outcome.result === 'loss') {
    delta = Math.round(baseLoss + diffFactor * 10);
  } else {
    delta = Math.round(baseDraw + diffFactor * 6);
  }
  if (isBot) {
    delta = outcome.result === 'win' ? Math.min(delta, 20) : Math.max(delta, -10);
  }
  return { points: delta };
}

async function findRandomOpponent(memberId, season, profile) {
  const collection = db.collection(COLLECTIONS.PVP_PROFILES);
  const range = Math.max(150, Math.round(profile.points * 0.1));
  const minPoints = Math.max(0, profile.points - range);
  const snapshot = await collection
    .where({
      seasonId: season._id,
      memberId: _.neq(memberId),
      points: _.gte(minPoints)
    })
    .orderBy('lastMatchedAt', 'asc')
    .limit(30)
    .get()
    .catch(() => ({ data: [] }));
  const candidates = (snapshot.data || []).filter((item) => item.points <= profile.points + range);
  if (candidates.length === 0) {
    return {
      isBot: true,
      profile: buildBotProfile(profile, season)
    };
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const pickMemberId = pick.memberId || pick._id;
  const memberSnapshot = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(pickMemberId)
    .get()
    .catch(() => null);
  const opponentMember = memberSnapshot && memberSnapshot.data ? memberSnapshot.data : null;
  return {
    isBot: false,
    member: opponentMember,
    profile: { ...pick, memberId: pickMemberId }
  };
}

function buildBotProfile(profile, season, seed) {
  const rng = createRandomGenerator(seed || buildMatchSeed('bot', season._id));
  const variance = 0.9 + rng() * 0.2;
  const basePoints = Math.round(profile.points * variance);
  const tier = resolveTierByPoints(basePoints);
  return {
    memberId: `bot_${season._id}_${Math.floor(rng() * 100000)}`,
    points: basePoints,
    wins: Math.floor((profile.wins || 0) * variance),
    losses: Math.floor((profile.losses || 0) * (2 - variance)),
    draws: Math.floor(profile.draws || 0),
    tierId: tier.id,
    tierName: tier.name,
    currentStreak: Math.floor((profile.currentStreak || 0) * variance),
    longestStreak: Math.floor((profile.longestStreak || 0) * variance),
    claimedSeasonReward: false,
    combatSnapshot: profile.combatSnapshot || {},
    memberSnapshot: {
      nickName: '擂台傀儡',
      avatarUrl: '',
      levelName: '傀儡守卫'
    },
    seasonId: season._id,
    seasonName: season.name
  };
}

async function ensurePvpProfile(memberId, member, season) {
  const collection = db.collection(COLLECTIONS.PVP_PROFILES);
  const snapshot = await collection
    .doc(memberId)
    .get()
    .catch(() => null);
  const now = new Date();
  const combatSnapshot = buildCombatSnapshot(member);
  if (!snapshot || !snapshot.data) {
    const tier = resolveTierByPoints(DEFAULT_RATING);
    const baseProfile = {
      memberId,
      seasonId: season._id,
      seasonName: season.name,
      tierId: tier.id,
      tierName: tier.name,
      points: DEFAULT_RATING,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestPoints: DEFAULT_RATING,
      claimedSeasonReward: false,
      lastMatchedAt: null,
      lastResultAt: null,
      createdAt: now,
      updatedAt: now,
      memberSnapshot: buildMemberSnapshot(member),
      combatSnapshot,
      seasonHistory: []
    };
    await collection.doc(memberId).set({ data: baseProfile }).catch(() => {});
    return baseProfile;
  }
  let profile = { ...snapshot.data, memberId };
  if (profile.seasonId !== season._id) {
    const history = Array.isArray(profile.seasonHistory) ? [...profile.seasonHistory] : [];
    const historyEntry = buildSeasonHistoryEntry(profile);
    if (historyEntry) {
      history.unshift(historyEntry);
    }
    const tier = resolveTierByPoints(DEFAULT_RATING);
    profile = {
      memberId,
      seasonId: season._id,
      seasonName: season.name,
      tierId: tier.id,
      tierName: tier.name,
      points: DEFAULT_RATING,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestPoints: DEFAULT_RATING,
      claimedSeasonReward: false,
      lastMatchedAt: null,
      lastResultAt: null,
      createdAt: snapshot.data.createdAt || now,
      updatedAt: now,
      memberSnapshot: buildMemberSnapshot(member),
      combatSnapshot,
      seasonHistory: normalizeSeasonHistory(history)
    };
    await collection.doc(memberId).set({ data: profile }).catch(() => {});
    return profile;
  }
  const updatedProfile = {
    ...profile,
    combatSnapshot,
    memberSnapshot: buildMemberSnapshot(member),
    updatedAt: now
  };
  await collection
    .doc(memberId)
    .update({
      data: {
        combatSnapshot,
        memberSnapshot: updatedProfile.memberSnapshot,
        updatedAt: now
      }
    })
    .catch(() => {});
  return updatedProfile;
}

function buildSeasonHistoryEntry(profile) {
  if (!profile || !profile.seasonId) {
    return null;
  }
  return {
    seasonId: profile.seasonId,
    seasonName: profile.seasonName || '',
    points: profile.points || DEFAULT_RATING,
    tierId: profile.tierId,
    tierName: profile.tierName,
    wins: profile.wins || 0,
    losses: profile.losses || 0,
    draws: profile.draws || 0,
    longestStreak: profile.longestStreak || 0,
    bestPoints: profile.bestPoints || profile.points || DEFAULT_RATING,
    claimedSeasonReward: !!profile.claimedSeasonReward,
    finishedAt: profile.lastResultAt || new Date()
  };
}

function normalizeSeasonHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.slice(0, 10);
}

function decorateProfileForClient(profile, member, season) {
  const tier = resolveTierByPoints(profile.points);
  return {
    memberId: profile.memberId,
    nickName: profile.memberSnapshot ? profile.memberSnapshot.nickName : member.nickName || '无名仙友',
    avatarUrl: profile.memberSnapshot ? profile.memberSnapshot.avatarUrl : member.avatarUrl || '',
    tier: tierPayload(tier),
    points: profile.points,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
    currentStreak: profile.currentStreak || 0,
    longestStreak: profile.longestStreak || 0,
    bestPoints: profile.bestPoints || profile.points,
    claimedSeasonReward: !!profile.claimedSeasonReward,
    lastMatchedAt: profile.lastMatchedAt || null,
    lastResultAt: profile.lastResultAt || null,
    seasonId: profile.seasonId,
    seasonName: profile.seasonName || season.name,
    combatSnapshot: profile.combatSnapshot,
    memberSnapshot: profile.memberSnapshot
  };
}

function tierPayload(tier) {
  return {
    id: tier.id,
    name: tier.name,
    min: tier.min,
    max: Number.isFinite(tier.max) ? tier.max : null,
    color: tier.color
  };
}

function formatSeasonHistoryEntry(entry) {
  const tier = tierMap[entry.tierId] || resolveTierByPoints(entry.points || DEFAULT_RATING);
  return {
    seasonId: entry.seasonId,
    seasonName: entry.seasonName,
    tier: tierPayload(tier),
    points: entry.points,
    wins: entry.wins,
    losses: entry.losses,
    draws: entry.draws,
    longestStreak: entry.longestStreak,
    bestPoints: entry.bestPoints,
    claimedSeasonReward: !!entry.claimedSeasonReward,
    finishedAt: entry.finishedAt || null
  };
}

function decorateMatchSummary(match, memberId) {
  const opponent = match.player.memberId === memberId ? match.opponent : match.player;
  const self = match.player.memberId === memberId ? match.player : match.opponent;
  return {
    matchId: match.matchId || match._id,
    opponent: {
      memberId: opponent.memberId,
      displayName: opponent.displayName,
      tierId: opponent.tierId,
      tierName: opponent.tierName,
      pointsAfter: opponent.pointsAfter
    },
    result: match.result,
    self,
    createdAt: match.createdAt || null
  };
}

function decorateMatchReplay(match) {
  const replay = decorateBattleReplay(match, { defaultMode: 'pvp' });
  if (match.seasonId) {
    replay.seasonId = match.seasonId;
  }
  if (match.seasonName) {
    replay.seasonName = match.seasonName;
  }
  if (match.seed && !replay.seed) {
    replay.seed = match.seed;
  }
  return replay;
}

async function ensureActiveSeason() {
  const collection = db.collection(COLLECTIONS.PVP_SEASONS);
  const snapshot = await collection
    .where({ status: 'active' })
    .orderBy('startAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const now = new Date();
  if (snapshot.data && snapshot.data.length) {
    const active = snapshot.data[0];
    if (!isSeasonEnded(active)) {
      return active;
    }
    await collection
      .doc(active._id)
      .update({ data: { status: 'ended', endedAt: now, updatedAt: now } })
      .catch(() => {});
  }
  const latestSnapshot = await collection
    .orderBy('startAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const latest = latestSnapshot.data && latestSnapshot.data.length ? latestSnapshot.data[0] : null;
  const nextIndex = latest ? (latest.index || 0) + 1 : 1;
  const startAt = now;
  const endAt = new Date(startAt.getTime() + DEFAULT_SEASON_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  const season = {
    index: nextIndex,
    name: `第${nextIndex}赛季`,
    status: 'active',
    startAt,
    endAt,
    createdAt: now,
    updatedAt: now,
    baseRating: DEFAULT_RATING,
    ratingFloor: 0
  };
  const { _id } = await collection.add({ data: season });
  season._id = _id;
  await collection
    .doc(_id)
    .update({ data: { seasonId: _id } })
    .catch(() => {});
  return season;
}

async function loadSeasonById(seasonId) {
  const snapshot = await db
    .collection(COLLECTIONS.PVP_SEASONS)
    .doc(seasonId)
    .get()
    .catch(() => null);
  return snapshot && snapshot.data ? snapshot.data : null;
}

async function loadRecentMatches(memberId, seasonId) {
  const collection = db.collection(COLLECTIONS.PVP_MATCHES);
  const snapshot = await collection
    .where(
      _.or([
        { seasonId, 'player.memberId': memberId },
        { seasonId, 'opponent.memberId': memberId }
      ])
    )
    .orderBy('createdAt', 'desc')
    .limit(RECENT_MATCH_LIMIT)
    .get()
    .catch(() => ({ data: [] }));
  return snapshot.data || [];
}

function leaderboardSnapshotNeedsRefresh(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return true;
  }
  if (snapshot.schemaVersion !== LEADERBOARD_CACHE_SCHEMA_VERSION) {
    return true;
  }
  if (!Array.isArray(snapshot.entries)) {
    return true;
  }
  return snapshot.entries.some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return true;
    }
    if (!('avatarFrame' in entry)) {
      return true;
    }
    if (!('titleCatalog' in entry) || !Array.isArray(entry.titleCatalog)) {
      return true;
    }
    if (!('titleId' in entry)) {
      return true;
    }
    if (!('titleName' in entry)) {
      return true;
    }
    return false;
  });
}

async function loadLeaderboardSnapshot(
  seasonId,
  { limit = LEADERBOARD_CACHE_SIZE, type = 'season', forceRefresh = false } = {}
) {
  const docId = `${seasonId}_${type}`;
  if (!forceRefresh) {
    const snapshot = await db
      .collection(COLLECTIONS.PVP_LEADERBOARD)
      .doc(docId)
      .get()
      .catch(() => null);
    if (snapshot && snapshot.data && !leaderboardSnapshotNeedsRefresh(snapshot.data)) {
      return snapshot.data;
    }
  }
  await updateLeaderboardCache(seasonId, { type, limit });
  const refreshed = await db
    .collection(COLLECTIONS.PVP_LEADERBOARD)
    .doc(docId)
    .get()
    .catch(() => null);
  return refreshed && refreshed.data ? refreshed.data : { entries: [], updatedAt: null };
}

async function updateLeaderboardCache(seasonId, { type = 'season', limit = LEADERBOARD_CACHE_SIZE } = {}) {
  const collection = db.collection(COLLECTIONS.PVP_PROFILES);
  const snapshot = await collection
    .where({ seasonId })
    .orderBy('points', 'desc')
    .orderBy('wins', 'desc')
    .orderBy('losses', 'asc')
    .limit(limit)
    .get()
    .catch(() => ({ data: [] }));
  const profiles = snapshot.data || [];
  const memberIds = Array.from(
    new Set(
      profiles
        .map((item) =>
          normalizeMemberId(
            item.memberId ||
              (item.memberSnapshot && item.memberSnapshot.memberId) ||
              item._id
          )
        )
        .filter((id) => !!id)
    )
  );
  const [membersMap, memberExtrasMap] = await Promise.all([
    loadDocumentsByIds(COLLECTIONS.MEMBERS, memberIds),
    loadDocumentsByIds(COLLECTIONS.MEMBER_EXTRAS, memberIds)
  ]);
  const entries = profiles.map((item, index) => {
    const normalizedMemberId = normalizeMemberId(
      item.memberId || (item.memberSnapshot && item.memberSnapshot.memberId) || item._id
    );
    const memberId =
      normalizedMemberId ||
      item.memberId ||
      (item.memberSnapshot && item.memberSnapshot.memberId) ||
      item._id ||
      '';
    const memberDoc = normalizedMemberId ? membersMap.get(normalizedMemberId) || null : null;
    const extrasDoc = normalizedMemberId ? memberExtrasMap.get(normalizedMemberId) || null : null;
    const snapshotMember =
      item.memberSnapshot && typeof item.memberSnapshot === 'object'
        ? item.memberSnapshot
        : null;
    const snapshotAppearance =
      snapshotMember && snapshotMember.appearance && typeof snapshotMember.appearance === 'object'
        ? snapshotMember.appearance
        : null;
    const profileAppearance =
      item.appearance && typeof item.appearance === 'object' ? item.appearance : null;
    const memberAppearance =
      memberDoc && memberDoc.appearance && typeof memberDoc.appearance === 'object'
        ? memberDoc.appearance
        : null;

    const titleCatalogEntries = [];
    if (memberAppearance && Array.isArray(memberAppearance.titleCatalog)) {
      titleCatalogEntries.push(...memberAppearance.titleCatalog);
    }
    if (memberDoc && Array.isArray(memberDoc.titleCatalog)) {
      titleCatalogEntries.push(...memberDoc.titleCatalog);
    }
    if (extrasDoc && Array.isArray(extrasDoc.titleCatalog)) {
      titleCatalogEntries.push(...extrasDoc.titleCatalog);
    }
    if (snapshotMember && Array.isArray(snapshotMember.titleCatalog)) {
      titleCatalogEntries.push(...snapshotMember.titleCatalog);
    }
    if (profileAppearance && Array.isArray(profileAppearance.titleCatalog)) {
      titleCatalogEntries.push(...profileAppearance.titleCatalog);
    }
    if (Array.isArray(item.titleCatalog)) {
      titleCatalogEntries.push(...item.titleCatalog);
    }
    const titleCatalog = normalizeTitleCatalog(titleCatalogEntries);

    const titleIdSource =
      (memberAppearance && memberAppearance.titleId) ||
      (memberDoc && memberDoc.appearanceTitle) ||
      (snapshotMember && snapshotMember.appearanceTitle) ||
      (profileAppearance && profileAppearance.titleId) ||
      item.titleId ||
      '';
    const titleNameSource =
      (memberAppearance && memberAppearance.titleName) ||
      (memberDoc && memberDoc.appearanceTitleName) ||
      (snapshotMember && snapshotMember.appearanceTitleName) ||
      (profileAppearance && profileAppearance.titleName) ||
      item.titleName ||
      '';

    const avatarFrame = resolveAvatarFrameValue(
      snapshotMember && snapshotMember.avatarFrame,
      snapshotAppearance && snapshotAppearance.avatarFrame,
      snapshotMember && snapshotMember.appearanceFrame,
      memberAppearance && memberAppearance.avatarFrame,
      memberDoc && memberDoc.avatarFrame,
      memberDoc && memberDoc.appearanceFrame,
      item.avatarFrame,
      profileAppearance && profileAppearance.avatarFrame,
      item.appearanceFrame
    );

    const nickName =
      (memberDoc && (memberDoc.nickName || memberDoc.name)) ||
      (snapshotMember && snapshotMember.nickName) ||
      '';
    const avatarUrl =
      (memberDoc && memberDoc.avatarUrl) ||
      (snapshotMember && snapshotMember.avatarUrl) ||
      '';

    const payload = {
      rank: index + 1,
      memberId,
      nickName,
      avatarUrl,
      tierId: item.tierId,
      tierName: item.tierName,
      points: item.points,
      wins: item.wins,
      losses: item.losses,
      draws: item.draws,
      streak: item.currentStreak || 0,
      titleId: typeof titleIdSource === 'string' ? normalizeTitleId(titleIdSource) : '',
      titleName: typeof titleNameSource === 'string' ? titleNameSource : '',
      titleCatalog
    };
    payload.avatarFrame = avatarFrame || '';
    return payload;
  });
  const payload = {
    seasonId,
    type,
    entries,
    updatedAt: new Date(),
    schemaVersion: LEADERBOARD_CACHE_SCHEMA_VERSION
  };
  const docId = `${seasonId}_${type}`;
  await db
    .collection(COLLECTIONS.PVP_LEADERBOARD)
    .doc(docId)
    .set({ data: payload })
    .catch(async (error) => {
      if (error && /exists/i.test(error.errMsg || '')) {
        await db
          .collection(COLLECTIONS.PVP_LEADERBOARD)
          .doc(docId)
          .update({ data: { ...payload } })
          .catch(() => {});
      } else {
        throw error;
      }
    });
}

function buildSeasonPayload(season) {
  return {
    seasonId: season._id,
    name: season.name,
    status: season.status,
    startAt: season.startAt,
    endAt: season.endAt,
    index: season.index
  };
}

function resolveTierByPoints(points) {
  const value = Number.isFinite(points) ? points : DEFAULT_RATING;
  for (let i = 0; i < PVP_TIERS.length; i += 1) {
    const tier = PVP_TIERS[i];
    if (value >= tier.min && value <= tier.max) {
      return tier;
    }
  }
  return PVP_TIERS[PVP_TIERS.length - 1];
}

function resolveSeasonReward(tierId) {
  return TIER_REWARD_MAP[tierId] || TIER_REWARD_MAP.bronze;
}

function isSeasonEnded(season) {
  if (!season || !season.endAt) {
    return false;
  }
  const endAt = new Date(season.endAt);
  return !Number.isNaN(endAt.getTime()) && endAt.getTime() < Date.now();
}

function buildMemberSnapshot(member) {
  if (!member) {
    return {
      nickName: '无名仙友',
      avatarUrl: '',
      levelName: '',
      memberId: '',
      avatarFrame: ''
    };
  }
  const level = member.level || {};
  const avatarFrame = normalizeAvatarFrameValue(
    member.avatarFrame ||
      (member.appearance && member.appearance.avatarFrame) ||
      member.appearanceFrame ||
      ''
  );
  const titleCatalog = normalizeTitleCatalog(
    (member.appearance && member.appearance.titleCatalog) || member.titleCatalog || []
  );
  return {
    memberId: member._id || member.memberId || '',
    nickName: member.nickName || member.name || '无名仙友',
    avatarUrl: member.avatarUrl || '',
    levelName: level.name || level.label || '',
    avatarFrame,
    titleCatalog
  };
}

function buildCombatSnapshot(member) {
  if (!member || !member.pveProfile) {
    return defaultCombatSnapshot();
  }
  const profile = member.pveProfile;
  const attributeSummary = (profile && typeof profile === 'object' && profile.attributeSummary) || {};
  const existingSkillSummary = attributeSummary && attributeSummary.skillSummary;
  const skillSummaryValid =
    existingSkillSummary &&
    typeof existingSkillSummary === 'object' &&
    existingSkillSummary.combatAdditive &&
    typeof existingSkillSummary.combatAdditive === 'object';
  const computedSkillSummary = aggregateSkillEffects((profile && profile.skills) || {});
  const enrichedProfile = {
    ...profile,
    attributeSummary: {
      ...attributeSummary,
      skillSummary: skillSummaryValid ? existingSkillSummary : computedSkillSummary
    }
  };
  const { stats, special, combatPower } = extractCombatProfile(enrichedProfile, {
    defaults: DEFAULT_COMBAT_STATS,
    convertLegacyPercentages: true
  });
  const skillLoadout = buildRuntimeSkillLoadout((profile && profile.skills) || {}, { includeBasic: true });
  return {
    stats,
    special,
    combatPower,
    skillLoadout
  };
}

function defaultCombatSnapshot() {
  return {
    stats: { ...DEFAULT_COMBAT_STATS },
    special: { ...DEFAULT_SPECIAL_STATS },
    combatPower: 0,
    skillLoadout: buildRuntimeSkillLoadout({}, { includeBasic: true })
  };
}

function normalizeCombatSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return defaultCombatSnapshot();
  }
  const statsSource = snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : snapshot;
  const combatStats = Array.isArray(snapshot.combatStats) ? snapshot.combatStats : undefined;
  const stats = resolveCombatStats(
    { finalStats: statsSource, combatStats },
    { defaults: DEFAULT_COMBAT_STATS, convertLegacyPercentages: true }
  );
  const special = resolveSpecialStats(snapshot.special || {}, {
    defaults: DEFAULT_SPECIAL_STATS,
    convertLegacyPercentages: true
  });
  const combatPower = Number(snapshot.combatPower || (statsSource && statsSource.combatPower) || 0);
  const skillLoadout = Array.isArray(snapshot.skillLoadout) ? snapshot.skillLoadout : [];
  return {
    stats,
    special,
    combatPower: Number.isFinite(combatPower) ? combatPower : 0,
    skillLoadout
  };
}

function buildBattleActor({ memberId, member, profile, combat, isBot }) {
  const tier = resolveTierByPoints(profile.points);
  const normalized = normalizeCombatSnapshot(combat);
  const backgroundId = buildBackgroundIdFromMember(member);
  const backgroundAnimated = !!(member && member.appearanceBackgroundAnimated);
  const background = buildBackgroundPayloadFromId(backgroundId, backgroundAnimated);
  const avatarUrl =
    (profile.memberSnapshot && profile.memberSnapshot.avatarUrl) || (member && member.avatarUrl) || '';
  const avatarFrame = resolveAvatarFrameValue(
    profile.memberSnapshot && profile.memberSnapshot.avatarFrame,
    profile.memberSnapshot &&
      profile.memberSnapshot.appearance &&
      profile.memberSnapshot.appearance.avatarFrame,
    profile.avatarFrame,
    profile.appearance && profile.appearance.avatarFrame,
    member && member.avatarFrame,
    member && member.appearanceFrame,
    member && member.appearance && member.appearance.avatarFrame
  );
  const portrait = pickPortraitUrl(
    profile.memberSnapshot && profile.memberSnapshot.portrait,
    profile.memberSnapshot && profile.memberSnapshot.avatarUrl,
    member && member.portrait,
    member && member.avatarUrl,
    avatarUrl
  );
  return {
    memberId: memberId || profile.memberId,
    displayName: profile.memberSnapshot && profile.memberSnapshot.nickName ? profile.memberSnapshot.nickName : member ? member.nickName || '无名仙友' : '神秘对手',
    tierId: profile.tierId || tier.id,
    tierName: profile.tierName || tier.name,
    points: profile.points,
    stats: normalized.stats,
    special: normalized.special,
    combatPower: normalized.combatPower,
    skills: Array.isArray(combat.skillLoadout) ? combat.skillLoadout : [],
    isBot: !!isBot,
    appearanceBackgroundId: backgroundId,
    appearanceBackgroundAnimated: backgroundAnimated,
    avatarUrl,
    portrait,
    ...(avatarFrame ? { avatarFrame } : {}),
    ...(background ? { background } : {})
  };
}

function buildBackgroundIdFromMember(member) {
  if (!member || typeof member.appearanceBackground !== 'string') {
    return '';
  }
  return normalizeBackgroundId(member.appearanceBackground);
}

function buildBattleParticipants({
  playerState,
  opponentState,
  playerEntry,
  opponentEntry,
  playerMaxHp,
  opponentMaxHp,
  playerAttributesSnapshot,
  opponentAttributesSnapshot
}) {
  return {
    player: buildBattleParticipantPayload({
      state: playerState,
      actor: playerEntry,
      side: 'player',
      baseMaxHp: playerMaxHp,
      attributes: playerAttributesSnapshot
    }),
    opponent: buildBattleParticipantPayload({
      state: opponentState,
      actor: opponentEntry,
      side: 'opponent',
      baseMaxHp: opponentMaxHp,
      attributes: opponentAttributesSnapshot
    })
  };
}

function buildBattleParticipantPayload({ state, actor, side, baseMaxHp, attributes }) {
  const hpValue = Number.isFinite(state.hp) ? state.hp : baseMaxHp;
  const currentHp = Math.max(0, Math.round(Math.min(hpValue, baseMaxHp)));
  const shield = Math.max(0, Math.round(hpValue - baseMaxHp));
  const payload = {
    id: state.memberId,
    memberId: state.memberId,
    side,
    displayName: state.displayName,
    tierId: state.tierId,
    tierName: state.tierName,
    combatPower: Math.round(Number(actor.combatPower || 0)),
    maxHp: baseMaxHp,
    hp: {
      current: currentHp,
      max: baseMaxHp
    },
    attributes: { ...attributes },
    isBot: !!actor.isBot
  };

  const pointsValue = Number(actor.points);
  if (Number.isFinite(pointsValue)) {
    payload.points = pointsValue;
  }

  if (shield > 0) {
    payload.hp.shield = shield;
  }

  if (actor.portrait) {
    payload.portrait = actor.portrait;
  }
  if (actor.avatarUrl) {
    payload.avatarUrl = actor.avatarUrl;
  }
  if (actor.avatarFrame) {
    payload.avatarFrame = actor.avatarFrame;
  }
  if (actor.appearanceBackgroundId) {
    payload.appearanceBackgroundId = actor.appearanceBackgroundId;
  }
  if (typeof actor.appearanceBackgroundAnimated === 'boolean') {
    payload.appearanceBackgroundAnimated = actor.appearanceBackgroundAnimated;
  }
  if (actor.background) {
    payload.background = actor.background;
  }

  return payload;
}

function buildCombatAttributesSnapshot(stats = {}) {
  const keys = [
    'maxHp',
    'physicalAttack',
    'magicAttack',
    'physicalDefense',
    'magicDefense',
    'speed',
    'accuracy',
    'dodge',
    'critRate',
    'critDamage',
    'critResist',
    'finalDamageBonus',
    'finalDamageReduction',
    'lifeSteal',
    'healingBonus',
    'healingReduction',
    'controlHit',
    'controlResist',
    'physicalPenetration',
    'magicPenetration',
    'comboRate',
    'block',
    'counterRate',
    'damageReduction',
    'healingReceived',
    'rageGain',
    'controlStrength',
    'shieldPower',
    'summonPower',
    'elementalVulnerability'
  ];
  const snapshot = {};
  keys.forEach((key) => {
    if (typeof stats[key] === 'number' && !Number.isNaN(stats[key])) {
      snapshot[key] = Number(stats[key]);
    }
  });
  return snapshot;
}

function resolveSkillStringField(skill, fields) {
  if (!skill || typeof skill !== 'object' || !Array.isArray(fields)) {
    return '';
  }
  for (let i = 0; i < fields.length; i += 1) {
    const trimmed = toTrimmedString(skill[fields[i]]);
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function buildTimelineSkillPayload(skill) {
  const fallback = { id: 'basic_attack', name: '普攻', type: 'basic' };
  if (!skill || typeof skill !== 'object') {
    return { ...fallback };
  }
  const id = toTrimmedString(skill.id) || fallback.id;
  const name = toTrimmedString(skill.name) || fallback.name;
  const type = toTrimmedString(skill.type) || fallback.type;
  const payload = { id, name, type };
  const animation = toTrimmedString(skill.animation);
  if (animation) {
    payload.animation = animation;
  }
  if (skill.resource && typeof skill.resource === 'object') {
    const resource = {};
    const resourceType = toTrimmedString(skill.resource.type);
    if (resourceType) {
      resource.type = resourceType;
    }
    const cost = Number(skill.resource.cost);
    if (Number.isFinite(cost)) {
      resource.cost = Math.max(0, Math.round(cost));
    }
    if (Object.keys(resource).length) {
      payload.resource = resource;
    }
  }
  const quality =
    resolveSkillStringField(skill, ['quality', 'skillQuality', 'rarity', 'qualityKey']) || '';
  const qualityLabel =
    resolveSkillStringField(skill, ['qualityLabel', 'rarityLabel', 'skillQualityLabel']);
  const qualityColor =
    resolveSkillStringField(skill, ['qualityColor', 'skillQualityColor', 'rarityColor']);
  if (quality) {
    payload.quality = quality;
    payload.skillQuality = quality;
    payload.rarity = quality;
  }
  if (qualityLabel) {
    payload.qualityLabel = qualityLabel;
    payload.rarityLabel = qualityLabel;
  }
  if (qualityColor) {
    payload.qualityColor = qualityColor;
    payload.skillQualityColor = qualityColor;
    payload.rarityColor = qualityColor;
  }
  return payload;
}

function buildTimelineEntry({
  round,
  sequence,
  actorId,
  actorName,
  actorSide,
  targetId,
  targetName,
  events,
  skill,
  before,
  after,
  playerMaxHp,
  opponentMaxHp,
  playerAttributesSnapshot,
  opponentAttributesSnapshot,
  previousAttributes = {},
  controlBefore,
  controlAfter,
  summaryText
}) {
  const entry = {
    id: `round-${round}-action-${sequence}`,
    round,
    sequence,
    actorId,
    actorSide,
    actor: { id: actorId, side: actorSide, displayName: actorName },
    target: { id: targetId, side: actorSide === 'player' ? 'opponent' : 'player', displayName: targetName },
    skill: buildTimelineSkillPayload(skill),
    events: Array.isArray(events) ? events.filter(Boolean) : [],
    state: {
      player: buildTimelineStateSide({
        before: before && Number.isFinite(before.player) ? before.player : undefined,
        after: after && Number.isFinite(after.player) ? after.player : undefined,
        maxHp: playerMaxHp,
        attributes: playerAttributesSnapshot,
        previousAttributes: previousAttributes ? previousAttributes.player : null,
        controlBefore: controlBefore ? controlBefore.player : null,
        controlAfter: controlAfter ? controlAfter.player : null
      }),
      opponent: buildTimelineStateSide({
        before: before && Number.isFinite(before.opponent) ? before.opponent : undefined,
        after: after && Number.isFinite(after.opponent) ? after.opponent : undefined,
        maxHp: opponentMaxHp,
        attributes: opponentAttributesSnapshot,
        previousAttributes: previousAttributes ? previousAttributes.opponent : null,
        controlBefore: controlBefore ? controlBefore.opponent : null,
        controlAfter: controlAfter ? controlAfter.opponent : null
      })
    }
  };

  if (summaryText) {
    entry.summary = {
      title: `第${round}回合`,
      text: summaryText
    };
  }

  return entry;
}

function normalizeControlRuntimeSnapshot(runtime) {
  const base = {
    effects: [],
    skip: false,
    disableBasic: false,
    disableActive: false,
    disableDodge: false,
    remainingTurns: 0,
    remainingByEffect: {},
    summaries: {},
    active: false
  };
  if (!runtime || typeof runtime !== 'object') {
    return base;
  }
  const effects = Array.isArray(runtime.effects)
    ? runtime.effects
        .map((effect) => (typeof effect === 'string' ? effect.trim().toLowerCase() : ''))
        .filter(Boolean)
    : [];
  const skip = !!runtime.skip;
  const disableBasic = !!runtime.disableBasic;
  const disableActive = !!runtime.disableActive;
  const disableDodge = !!runtime.disableDodge;
  const remainingTurns = Number.isFinite(Number(runtime.remainingTurns))
    ? Math.max(0, Math.round(Number(runtime.remainingTurns)))
    : 0;
  const sourceRemaining =
    runtime.remainingByEffect && typeof runtime.remainingByEffect === 'object' ? runtime.remainingByEffect : {};
  const remainingByEffect = {};
  effects.forEach((effect) => {
    const raw = Number(sourceRemaining[effect]);
    if (Number.isFinite(raw)) {
      remainingByEffect[effect] = Math.max(0, Math.round(raw));
    }
  });
  const sourceSummaries = runtime.summaries && typeof runtime.summaries === 'object' ? runtime.summaries : {};
  const summaries = {};
  effects.forEach((effect) => {
    const summary = sourceSummaries[effect];
    if (typeof summary === 'string' && summary.trim()) {
      summaries[effect] = summary.trim();
    }
  });
  const active =
    effects.length > 0 || skip || disableBasic || disableActive || disableDodge || remainingTurns > 0;
  return {
    effects,
    skip,
    disableBasic,
    disableActive,
    disableDodge,
    remainingTurns,
    remainingByEffect,
    summaries,
    active
  };
}

function captureControlSnapshot(actor) {
  if (!actor || !actor.controlRuntime) {
    return normalizeControlRuntimeSnapshot();
  }
  return normalizeControlRuntimeSnapshot(actor.controlRuntime);
}

function cloneControlSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const effects = Array.isArray(snapshot.effects)
    ? snapshot.effects.map((effect) => (typeof effect === 'string' ? effect : '')).filter(Boolean)
    : [];
  const sourceRemaining = snapshot.remainingByEffect && typeof snapshot.remainingByEffect === 'object'
    ? snapshot.remainingByEffect
    : {};
  const sourceSummaries = snapshot.summaries && typeof snapshot.summaries === 'object' ? snapshot.summaries : {};
  const remainingByEffect = effects.reduce((acc, effect) => {
    const value = Number(sourceRemaining[effect]);
    if (Number.isFinite(value)) {
      acc[effect] = Math.max(0, Math.round(value));
    }
    return acc;
  }, {});
  const summaries = effects.reduce((acc, effect) => {
    const summary = sourceSummaries[effect];
    if (typeof summary === 'string' && summary.trim()) {
      acc[effect] = summary.trim();
    }
    return acc;
  }, {});
  const remainingTurns = Number.isFinite(Number(snapshot.remainingTurns))
    ? Math.max(0, Math.round(Number(snapshot.remainingTurns)))
    : 0;
  const active =
    typeof snapshot.active === 'boolean'
      ? snapshot.active
      : effects.length > 0 || snapshot.skip || snapshot.disableBasic || snapshot.disableActive || snapshot.disableDodge || remainingTurns > 0;
  return {
    effects,
    skip: !!snapshot.skip,
    disableBasic: !!snapshot.disableBasic,
    disableActive: !!snapshot.disableActive,
    disableDodge: !!snapshot.disableDodge,
    remainingTurns,
    remainingByEffect,
    summaries,
    active
  };
}

function buildTimelineStateSide({
  before,
  after,
  maxHp,
  attributes,
  previousAttributes,
  controlBefore,
  controlAfter
}) {
  const max = Math.max(1, Math.round(maxHp || 1));
  const beforeValue = Number.isFinite(before) ? before : max;
  const afterValue = Number.isFinite(after) ? after : Math.min(beforeValue, max);
  const beforeHp = Math.max(0, Math.round(Math.min(beforeValue, max)));
  const afterHp = Math.max(0, Math.round(Math.min(afterValue, max)));
  const shieldBefore = Math.max(0, Math.round(beforeValue - max));
  const shieldAfter = Math.max(0, Math.round(afterValue - max));
  const changedAttributes = extractChangedAttributes(attributes, previousAttributes);
  const state = {
    hp: {
      before: beforeHp,
      after: afterHp,
      max
    },
    attributes: changedAttributes
  };
  if (shieldBefore > 0 || shieldAfter > 0) {
    state.shield = {
      before: shieldBefore,
      after: shieldAfter
    };
  }
  const hasControlBefore = controlBefore && (controlBefore.active || controlBefore.effects.length);
  const hasControlAfter = controlAfter && (controlAfter.active || controlAfter.effects.length);
  if (hasControlBefore || hasControlAfter) {
    state.control = {
      before: cloneControlSnapshot(controlBefore),
      after: cloneControlSnapshot(controlAfter)
    };
  }
  return state;
}

function extractChangedAttributes(current, previous) {
  if (!current || typeof current !== 'object') {
    return {};
  }
  const previousAttributes = previous && typeof previous === 'object' ? previous : null;
  const changed = {};
  const keys = Object.keys(current);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = current[key];
    const previousValue = previousAttributes ? previousAttributes[key] : undefined;
    if (typeof value === 'number') {
      if (!Number.isFinite(previousValue) || Number(value) !== Number(previousValue)) {
        changed[key] = Number(value);
      }
    } else if (value !== undefined && value !== previousValue) {
      changed[key] = value;
    }
  }
  return changed;
}

function buildStructuredBattleOutcome({
  playerState,
  opponentState,
  playerEntry,
  opponentEntry,
  draw,
  winnerId,
  loserId,
  timeline
}) {
  const roundsCompleted = Array.isArray(timeline) && timeline.length
    ? timeline[timeline.length - 1].round || timeline.length
    : 0;
  const playerName = playerState.displayName || playerEntry.displayName || '我方';
  const opponentName = opponentState.displayName || opponentEntry.displayName || '对手';
  const result = draw ? 'draw' : winnerId === playerEntry.memberId ? 'victory' : 'defeat';
  const winnerName = winnerId === playerState.memberId ? playerName : winnerId === opponentState.memberId ? opponentName : '';
  const loserName = loserId === playerState.memberId ? playerName : loserId === opponentState.memberId ? opponentName : '';
  let summaryText;
  if (draw) {
    summaryText = `${playerName}与${opponentName}的对决以平局收场。`;
  } else if (winnerName && loserName) {
    summaryText = `${winnerName}击败了${loserName}。`;
  } else {
    summaryText = '战斗已结束。';
  }
  const summaryTitle =
    result === 'victory' ? '战斗结果 · 胜利' : result === 'defeat' ? '战斗结果 · 惜败' : '战斗结果 · 平局';
  return {
    winnerId,
    loserId,
    result,
    draw,
    rounds: roundsCompleted,
    summary: {
      title: summaryTitle,
      text: summaryText
    },
    remaining: {
      playerHp: Math.max(0, Math.round(playerState.hp)),
      opponentHp: Math.max(0, Math.round(opponentState.hp))
    }
  };
}

async function ensureMember(memberId) {
  const normalizedId = normalizeMemberId(memberId);
  const snapshot = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(normalizedId)
    .get()
    .catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw createError('MEMBER_NOT_FOUND', '会员信息不存在，请先完成注册');
  }
  return snapshot.data;
}

function createRandomGenerator(seed) {
  const hashedSeed = hashSeed(String(seed || Date.now()));
  let state = hashedSeed;
  const generator = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  generator.seedValue = hashedSeed;
  return generator;
}

function hashSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildMatchSeed(key, seasonId) {
  return `${seasonId}:${key}:${Date.now()}`;
}

function normalizeSeed(seed) {
  if (typeof seed === 'string' && seed.trim()) {
    return seed.trim();
  }
  return '';
}

function normalizeMemberId(memberId) {
  if (typeof memberId === 'string' && memberId.trim()) {
    return memberId.trim();
  }
  return '';
}

function normalizeId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return '';
}

async function loadDocumentsByIds(collectionName, ids = []) {
  const normalizedIds = [];
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (trimmed) {
        normalizedIds.push(trimmed);
      }
    }
  });
  if (!normalizedIds.length) {
    return new Map();
  }
  const uniqueIds = Array.from(new Set(normalizedIds));
  const batchSize = 20;
  const tasks = [];
  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const chunk = uniqueIds.slice(i, i + batchSize);
    tasks.push(
      db
        .collection(collectionName)
        .where({ _id: _.in(chunk) })
        .limit(chunk.length)
        .get()
        .then((snapshot) => (snapshot && snapshot.data ? snapshot.data : []))
        .catch((error) => {
          console.error(`[pvp] load ${collectionName} failed`, error);
          return [];
        })
    );
  }
  const documents = (await Promise.all(tasks)).reduce((acc, list) => acc.concat(list), []);
  const map = new Map();
  documents.forEach((doc) => {
    if (doc && doc._id) {
      map.set(doc._id, doc);
    }
  });
  return map;
}

function isCollectionMissingError(error) {
  if (!error) {
    return false;
  }
  const code = typeof error.errCode === 'number' ? error.errCode : error.code;
  return code === -502005 || code === 'ResourceNotFound';
}

function isCollectionAlreadyExistsError(error) {
  if (!error) {
    return false;
  }
  const code = typeof error.errCode === 'number' ? error.errCode : error.code;
  return code === -502003 || code === 'AlreadyExists';
}

function resolveActorId(defaultMemberId, event = {}) {
  const resolved = resolveOptionalActorId(defaultMemberId, event);
  if (!resolved) {
    throw createError('UNAUTHENTICATED', '缺少身份信息，请重新登录');
  }
  return resolved;
}

function resolveOptionalActorId(defaultMemberId, event = {}) {
  const fromEvent = normalizeMemberId(event.actorId || event.memberId);
  const fromContext = normalizeMemberId(defaultMemberId);
  return fromEvent || fromContext || null;
}

function signBattlePayload(payload) {
  const serialized = JSON.stringify(payload);
  return crypto.createHash('md5').update(serialized).digest('hex');
}

function createError(code, message) {
  const error = new Error(message || '发生未知错误');
  error.code = code;
  error.errCode = code;
  return error;
}
