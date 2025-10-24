import { PveService, PvpService } from '../../services/api';
const {
  createBattleViewModel,
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_PLAYER_IMAGE,
  DEFAULT_OPPONENT_IMAGE
} = require('../../shared/battle');
const {
  resolveBackgroundByRealmName,
  resolveBackgroundById,
  normalizeBackgroundId
} = require('../../shared/backgrounds');
const { CHARACTER_IMAGE_BASE_PATH, buildCloudAssetUrl } = require('../../shared/asset-paths');

const ARENA_BACKGROUND_VIDEO = buildCloudAssetUrl('background', 'battle-stage.mp4');
const SECRET_REALM_BACKGROUND_VIDEO = buildCloudAssetUrl('background', 'mijing.mp4');
const BATTLE_BOT_AVATAR_IMAGE = buildCloudAssetUrl('avatar', 'battle-bot.png');
const BATTLE_BOT_PORTRAIT_IMAGE = buildCloudAssetUrl('character', 'battle-bot.png');
const { listAvatarIds } = require('../../shared/avatar-catalog');

function buildCharacterImageMap() {
  const ids = listAvatarIds();
  return ids.reduce((acc, id) => {
    acc[id] = `${CHARACTER_IMAGE_BASE_PATH}/${id}.png`;
    return acc;
  }, {});
}

const CHARACTER_IMAGE_MAP = buildCharacterImageMap();
const AVATAR_URL_PATTERN = /\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png(?:\?.*)?$/;
const PORTRAIT_NESTED_KEYS = [
  'memberSnapshot',
  'snapshot',
  'profile',
  'appearance',
  'member',
  'player',
  'self',
  'opponent',
  'enemy',
  'target',
  'character',
  'owner',
  'source',
  'data',
  'details',
  'info',
  'participant',
  'participants',
  'preview',
  'opponentPreview',
  'enemyPreview'
];

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeHpEntry(entry) {
  const base = entry && typeof entry === 'object' ? entry : {};
  const max = Math.max(0, toFiniteNumber(base.max, 0));
  let current = toFiniteNumber(base.current, 0);
  if (max > 0) {
    current = Math.max(0, Math.min(max, current));
  } else {
    current = Math.max(0, current);
  }
  let percent = toFiniteNumber(base.percent, NaN);
  if (!Number.isFinite(percent)) {
    percent = max > 0 ? (current / (max || 1)) * 100 : 0;
  }
  const boundedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const roundedPercent = Math.round(boundedPercent * 100) / 100;
  return {
    ...base,
    max,
    current,
    percent: roundedPercent,
    progressStyle: `width: ${roundedPercent}%;`
  };
}

function normalizeHpStateMap(state = {}) {
  return {
    player: normalizeHpEntry(state.player),
    opponent: normalizeHpEntry(state.opponent)
  };
}

const DEFAULT_RESOURCE_MAX = 100;

function normalizeResourceEntry(entry) {
  if (typeof entry === 'number') {
    const current = Math.max(0, toFiniteNumber(entry, 0));
    const max = Math.max(current, DEFAULT_RESOURCE_MAX);
    const percent = max > 0 ? Math.round((current / max) * 10000) / 100 : 0;
    return {
      max,
      current,
      percent,
      progressStyle: `width: ${percent}%;`
    };
  }
  const base = entry && typeof entry === 'object' ? entry : {};
  let max = toFiniteNumber(base.max, NaN);
  let current = toFiniteNumber(
    Object.prototype.hasOwnProperty.call(base, 'current') ? base.current : base.after,
    NaN
  );
  const change = toFiniteNumber(
    Object.prototype.hasOwnProperty.call(base, 'change') ? base.change : base.delta,
    NaN
  );
  const before = toFiniteNumber(base.before, NaN);
  if (!Number.isFinite(current)) {
    if (Number.isFinite(before) && Number.isFinite(change)) {
      current = before + change;
    } else if (Number.isFinite(before)) {
      current = before;
    }
  }
  if (!Number.isFinite(max)) {
    const inferred = Number.isFinite(before) ? before : current;
    if (Number.isFinite(inferred)) {
      max = Math.max(inferred, Number.isFinite(change) ? inferred + Math.abs(change) : inferred);
    }
  }
  const fallbackMax = Number.isFinite(max)
    ? Math.max(0, max)
    : Math.max(0, Number.isFinite(before) ? before : Number.isFinite(current) ? current : 0);
  const resolvedMax = fallbackMax > 0 ? fallbackMax : DEFAULT_RESOURCE_MAX;
  const boundedCurrent = Number.isFinite(current)
    ? current
    : Number.isFinite(before)
    ? before
    : 0;
  const clampedCurrent = Math.max(0, Math.min(resolvedMax, boundedCurrent));
  const percent = resolvedMax > 0 ? Math.round((clampedCurrent / resolvedMax) * 10000) / 100 : 0;
  return {
    ...base,
    max: resolvedMax,
    current: clampedCurrent,
    percent,
    progressStyle: `width: ${percent}%;`
  };
}

function normalizeResourceStateMap(state = {}) {
  return {
    player: normalizeResourceEntry(state.player),
    opponent: normalizeResourceEntry(state.opponent)
  };
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveActionSkill(action = {}) {
  if (!action || typeof action !== 'object') {
    return null;
  }
  if (action.skill && typeof action.skill === 'object') {
    return action.skill;
  }
  const raw = action.raw || {};
  if (raw.skill && typeof raw.skill === 'object') {
    return raw.skill;
  }
  return null;
}

function extractActionSummaryText(action = {}) {
  if (!action || typeof action !== 'object') {
    return '';
  }
  if (typeof action.summary === 'string') {
    return action.summary;
  }
  if (action.summary && typeof action.summary.text === 'string') {
    return action.summary.text;
  }
  const raw = action.raw || {};
  if (typeof raw.summary === 'string') {
    return raw.summary;
  }
  if (raw.summary && typeof raw.summary.text === 'string') {
    return raw.summary.text;
  }
  return '';
}

function textIndicatesControl(text) {
  if (typeof text !== 'string') {
    return false;
  }
  return text.indexOf('被控制') >= 0;
}

function isControlSkipAction(action = {}) {
  const skill = resolveActionSkill(action);
  if (!skill) {
    return false;
  }
  const skillId = toTrimmedString(skill.id).toLowerCase();
  if (skillId !== 'skip') {
    return false;
  }
  const skillType = toTrimmedString(skill.type).toLowerCase();
  if (skillType && skillType !== 'control') {
    return false;
  }
  const skillName = toTrimmedString(skill.name || skill.label || skill.title);
  if (skillName && textIndicatesControl(skillName)) {
    return true;
  }
  const summaryText = extractActionSummaryText(action);
  if (textIndicatesControl(summaryText)) {
    return true;
  }
  const description = toTrimmedString(action.description);
  if (textIndicatesControl(description)) {
    return true;
  }
  return false;
}

function resolveControlTargets(action = {}, actorSide = '', targetSide = '') {
  const controlledSides = [];
  const summaryText = extractActionSummaryText(action);
  const description = toTrimmedString(action.description);
  const combinedText = `${summaryText} ${description}`.trim();
  if (combinedText && textIndicatesControl(combinedText)) {
    if (targetSide === 'player' || targetSide === 'opponent') {
      controlledSides.push(targetSide);
    }
  }
  if (isControlSkipAction(action) && (actorSide === 'player' || actorSide === 'opponent')) {
    controlledSides.push(actorSide);
  }
  return Array.from(new Set(controlledSides));
}

function isExternalInviteSource(source) {
  return source === 'acceptInvite' || source === 'autoInvite';
}

const PLAYER_SIDE_ALIASES = ['player', 'self', 'attacker', 'initiator', 'ally', 'member'];
const OPPONENT_SIDE_ALIASES = ['opponent', 'enemy', 'defender', 'target', 'foe'];
const ENTITY_ID_KEYS = [
  'id',
  'memberId',
  'characterId',
  'roleId',
  'playerId',
  'opponentId',
  'userId',
  'targetId',
  'defenderId',
  'initiatorId',
  'attackerId',
  'uid'
];
const NESTED_ENTITY_KEYS = [
  'profile',
  'player',
  'self',
  'opponent',
  'enemy',
  'character',
  'member',
  'owner',
  'target',
  'defender',
  'initiator',
  'attacker',
  'source'
];

function addIdToSet(set, value) {
  if (value === null || value === undefined) {
    return;
  }
  const stringified = String(value).trim();
  if (!stringified) {
    return;
  }
  set.add(stringified);
  set.add(stringified.toLowerCase());
}

function hasId(idSet, value) {
  if (value === null || value === undefined) {
    return false;
  }
  const stringified = String(value).trim();
  if (!stringified) {
    return false;
  }
  return idSet.has(stringified) || idSet.has(stringified.toLowerCase());
}

function collectIdsFromEntity(entity, set, visited = new Set()) {
  if (!entity || typeof entity !== 'object') {
    return;
  }
  if (visited.has(entity)) {
    return;
  }
  visited.add(entity);
  ENTITY_ID_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(entity, key)) {
      addIdToSet(set, entity[key]);
    }
  });
  if (Array.isArray(entity.ids)) {
    entity.ids.forEach((value) => addIdToSet(set, value));
  }
  if (Array.isArray(entity.aliases)) {
    entity.aliases.forEach((value) => addIdToSet(set, value));
  }
  if (typeof entity.side === 'string') {
    addIdToSet(set, entity.side);
  }
  for (let i = 0; i < NESTED_ENTITY_KEYS.length; i += 1) {
    const nested = entity[NESTED_ENTITY_KEYS[i]];
    if (!nested) {
      continue;
    }
    if (Array.isArray(nested)) {
      for (let j = 0; j < nested.length; j += 1) {
        collectIdsFromEntity(nested[j], set, visited);
      }
    } else if (typeof nested === 'object') {
      collectIdsFromEntity(nested, set, visited);
    }
  }
}

function buildParticipantIdSet(baseKey, entities = []) {
  const set = new Set();
  const aliases =
    baseKey === 'player'
      ? PLAYER_SIDE_ALIASES
      : baseKey === 'opponent'
      ? OPPONENT_SIDE_ALIASES
      : baseKey
      ? [baseKey]
      : [];
  aliases.forEach((alias) => addIdToSet(set, alias));
  const visited = new Set();
  entities.forEach((entity) => {
    if (entity === null || entity === undefined) {
      return;
    }
    if (typeof entity === 'string' || typeof entity === 'number') {
      addIdToSet(set, entity);
      return;
    }
    if (Array.isArray(entity)) {
      entity.forEach((item) => {
        if (item === null || item === undefined) {
          return;
        }
        if (typeof item === 'string' || typeof item === 'number') {
          addIdToSet(set, item);
        } else if (typeof item === 'object') {
          collectIdsFromEntity(item, set, visited);
        }
      });
      return;
    }
    if (typeof entity === 'object') {
      collectIdsFromEntity(entity, set, visited);
    }
  });
  return set;
}

function resolveSideFromCandidate(candidate, playerIds, opponentIds, visited = new Set()) {
  if (candidate === null || candidate === undefined) {
    return '';
  }
  if (Array.isArray(candidate)) {
    for (let i = 0; i < candidate.length; i += 1) {
      const side = resolveSideFromCandidate(candidate[i], playerIds, opponentIds, visited);
      if (side) {
        return side;
      }
    }
    return '';
  }
  if (typeof candidate === 'object') {
    if (visited.has(candidate)) {
      return '';
    }
    visited.add(candidate);
    if (typeof candidate.side === 'string') {
      const sideLabel = candidate.side.trim();
      if (sideLabel === 'player' || sideLabel === 'opponent') {
        return sideLabel;
      }
    }
    for (let i = 0; i < ENTITY_ID_KEYS.length; i += 1) {
      const value = candidate[ENTITY_ID_KEYS[i]];
      if (hasId(playerIds, value)) {
        return 'player';
      }
      if (hasId(opponentIds, value)) {
        return 'opponent';
      }
    }
    if (Array.isArray(candidate.ids)) {
      for (let i = 0; i < candidate.ids.length; i += 1) {
        const value = candidate.ids[i];
        if (hasId(playerIds, value)) {
          return 'player';
        }
        if (hasId(opponentIds, value)) {
          return 'opponent';
        }
      }
    }
    if (Array.isArray(candidate.aliases)) {
      for (let i = 0; i < candidate.aliases.length; i += 1) {
        const value = candidate.aliases[i];
        if (hasId(playerIds, value)) {
          return 'player';
        }
        if (hasId(opponentIds, value)) {
          return 'opponent';
        }
      }
    }
    for (let i = 0; i < NESTED_ENTITY_KEYS.length; i += 1) {
      const nested = candidate[NESTED_ENTITY_KEYS[i]];
      if (!nested) {
        continue;
      }
      const side = resolveSideFromCandidate(nested, playerIds, opponentIds, visited);
      if (side) {
        return side;
      }
    }
    return '';
  }
  if (hasId(playerIds, candidate)) {
    return 'player';
  }
  if (hasId(opponentIds, candidate)) {
    return 'opponent';
  }
  return '';
}

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const match = url.trim().toLowerCase().match(AVATAR_URL_PATTERN);
  return match ? match[1] : '';
}

function resolveCharacterPortraitFromAvatarUrl(url) {
  const avatarId = extractAvatarIdFromUrl(url);
  if (avatarId && CHARACTER_IMAGE_MAP[avatarId]) {
    return CHARACTER_IMAGE_MAP[avatarId];
  }
  return '';
}

function resolvePortraitCandidate(candidate, visited = new Set()) {
  if (candidate === null || candidate === undefined) {
    return '';
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return '';
    }
    const characterPortrait = resolveCharacterPortraitFromAvatarUrl(trimmed);
    return characterPortrait || trimmed;
  }
  if (Array.isArray(candidate)) {
    for (let i = 0; i < candidate.length; i += 1) {
      const resolved = resolvePortraitCandidate(candidate[i], visited);
      if (resolved) {
        return resolved;
      }
    }
    return '';
  }
  if (typeof candidate === 'object') {
    if (visited.has(candidate)) {
      return '';
    }
    visited.add(candidate);
    const directPortrait = resolvePortraitCandidate(candidate.portrait, visited);
    if (directPortrait) {
      return directPortrait;
    }
    const avatarPortrait = resolvePortraitCandidate(candidate.avatarUrl, visited);
    if (avatarPortrait) {
      return avatarPortrait;
    }
    const legacyAvatarPortrait = resolvePortraitCandidate(candidate.avatar, visited);
    if (legacyAvatarPortrait) {
      return legacyAvatarPortrait;
    }
    for (let i = 0; i < PORTRAIT_NESTED_KEYS.length; i += 1) {
      const key = PORTRAIT_NESTED_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
        continue;
      }
      const nested = candidate[key];
      if (!nested) {
        continue;
      }
      const nestedPortrait = resolvePortraitCandidate(nested, visited);
      if (nestedPortrait) {
        return nestedPortrait;
      }
    }
  }
  return '';
}

function pickBattlePortrait(fallback, ...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const resolved = resolvePortraitCandidate(candidates[i]);
    if (resolved) {
      return resolved;
    }
  }
  return fallback;
}

function resolveParticipantByAliases(participants, aliases = []) {
  if (!participants || typeof participants !== 'object' || !Array.isArray(aliases)) {
    return null;
  }
  for (let i = 0; i < aliases.length; i += 1) {
    const key = aliases[i];
    if (!key) {
      continue;
    }
    const candidate = participants[key];
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

const MIN_SKIP_SECONDS = 10;
const ATTACK_INDICATOR_HOLD_DURATION = 1000;
const ATTACK_INDICATOR_FADE_DURATION = 180;
const ATTACK_WINDUP_DURATION = 240;
const ATTACK_CHARGE_DURATION = 340;
const ATTACK_CRIT_CHARGE_DURATION = 240;
const ATTACK_CRIT_PRELAUNCH_HOLD = 300;
const ATTACK_IMPACT_HOLD_DURATION = 140;
const ATTACK_RECOVERY_DURATION = 360;
const ATTACK_DODGE_LEAD_DURATION = 120;
const ATTACK_SEQUENCE_BUFFER = 220;

function createBattleStageState(overrides = {}) {
  return {
    loading: true,
    error: '',
    backgroundVideo: DEFAULT_BACKGROUND_VIDEO,
    player: null,
    opponent: null,
    hpState: normalizeHpStateMap({
      player: { max: 1, current: 1, percent: 100 },
      opponent: { max: 1, current: 1, percent: 100 }
    }),
    resourceState: normalizeResourceStateMap({
      player: { max: DEFAULT_RESOURCE_MAX, current: 0 },
      opponent: { max: DEFAULT_RESOURCE_MAX, current: 0 }
    }),
    attackerKey: 'player',
    defenderKey: 'opponent',
    currentAction: {},
    displayedLogs: [],
    floatingTexts: { player: [], opponent: [] },
    skipLocked: true,
    skipButtonText: `跳过（${MIN_SKIP_SECONDS}）`,
    battleFinished: false,
    resultTitle: '',
    resultSubtitle: '',
    resultClass: '',
    resultRounds: 0,
    currentRound: 1,
    attackPhase: '',
    attackMotion: '',
    attackActor: '',
    attackTarget: '',
    attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' },
    targetReaction: '',
    controlledState: { player: false, opponent: false },
    ...overrides
  };
}

function cloneFloatingTextState(source = {}) {
  return {
    player: Array.isArray(source.player) ? [...source.player] : [],
    opponent: Array.isArray(source.opponent) ? [...source.opponent] : []
  };
}

const INVALID_SKILL_LABELS = ['战斗流转', '连击未果', '身法化解', '持久战', '战斗结果'];

const SKILL_QUALITY_COLORS = {
  linggan: '#6c8cff',
  kaipi: '#45c0a8',
  tongxuan: '#b281ff',
  wudao: '#f2a546'
};

const SKILL_QUALITY_LABEL_COLORS = {
  灵感: SKILL_QUALITY_COLORS.linggan,
  开辟: SKILL_QUALITY_COLORS.kaipi,
  通玄: SKILL_QUALITY_COLORS.tongxuan,
  悟道: SKILL_QUALITY_COLORS.wudao
};

const SKILL_QUALITY_COLOR_KEY_MAP = Object.entries(SKILL_QUALITY_COLORS).reduce((acc, [key, value]) => {
  if (typeof value === 'string') {
    acc[value.toLowerCase()] = key;
  }
  return acc;
}, {});

function sanitizeSkillText(text) {
  if (!text && text !== 0) {
    return '';
  }
  const normalized = String(text).trim();
  if (!normalized) {
    return '';
  }
  if (normalized === 'undefined' || normalized === 'null') {
    return '';
  }
  if (INVALID_SKILL_LABELS.indexOf(normalized) >= 0) {
    return '';
  }
  if (/结果|回合|胜利|平局|惜败/.test(normalized)) {
    return '';
  }
  return normalized;
}

function extractSkillTextFromAction(action = {}) {
  if (!action || action.type === 'result' || action.type === 'dodge') {
    return '';
  }
  const candidates = [];
  if (action.description && typeof action.description === 'string') {
    const match = action.description.match(/「([^」]+)」/);
    if (match && match[1]) {
      candidates.push(match[1]);
    }
  }
  if (action.skillName) {
    candidates.push(action.skillName);
  }
  const raw = action.raw || {};
  if (raw.skillName) {
    candidates.push(raw.skillName);
  }
  if (raw.skill) {
    if (typeof raw.skill === 'string') {
      candidates.push(raw.skill);
    } else {
      if (raw.skill.name) {
        candidates.push(raw.skill.name);
      }
      if (raw.skill.label) {
        candidates.push(raw.skill.label);
      }
      if (raw.skill.title) {
        candidates.push(raw.skill.title);
      }
      if (raw.skill.displayName) {
        candidates.push(raw.skill.displayName);
      }
    }
  }
  if (raw.summary && raw.summary.label) {
    candidates.push(raw.summary.label);
  }
  if (typeof action.title === 'string' && action.title.indexOf('·') >= 0) {
    const parts = action.title.split('·');
    const tail = parts[parts.length - 1];
    candidates.push(tail);
  } else if (typeof action.title === 'string') {
    candidates.push(action.title);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const sanitized = sanitizeSkillText(candidates[i]);
    if (sanitized) {
      return sanitized;
    }
  }
  if (action.type === 'attack') {
    return '普攻';
  }
  return '';
}

function sanitizeColorValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized)) {
    return normalized;
  }
  if (/^rgba?\(/i.test(normalized) || /^hsla?\(/i.test(normalized) || /^var\(/i.test(normalized)) {
    return normalized;
  }
  return '';
}

function resolveQualityKeyFromColor(color) {
  if (typeof color !== 'string') {
    return '';
  }
  const normalized = color.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return SKILL_QUALITY_COLOR_KEY_MAP[normalized] || '';
}

function resolveQualityColorByKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return SKILL_QUALITY_COLORS[normalized] || '';
}

function resolveQualityColorByLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  return SKILL_QUALITY_LABEL_COLORS[normalized] || '';
}

function resolveSkillColorFromSource(source) {
  if (!source && source !== 0) {
    return '';
  }
  if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i += 1) {
      const nested = resolveSkillColorFromSource(source[i]);
      if (nested) {
        return nested;
      }
    }
    return '';
  }
  if (typeof source === 'string') {
    const sanitized = sanitizeColorValue(source);
    if (sanitized) {
      return sanitized;
    }
    const byKey = resolveQualityColorByKey(source);
    if (byKey) {
      return byKey;
    }
    return resolveQualityColorByLabel(source);
  }
  if (typeof source !== 'object') {
    return '';
  }
  const colorFields = ['qualityColor', 'color', 'rarityColor', 'textColor', 'fontColor'];
  for (let i = 0; i < colorFields.length; i += 1) {
    const color = sanitizeColorValue(source[colorFields[i]]);
    if (color) {
      return color;
    }
  }
  const qualityFields = ['quality', 'rarity', 'grade', 'tier', 'rank', 'qualityKey'];
  for (let i = 0; i < qualityFields.length; i += 1) {
    const color = resolveQualityColorByKey(source[qualityFields[i]]);
    if (color) {
      return color;
    }
  }
  const labelFields = ['qualityLabel', 'rarityLabel'];
  for (let i = 0; i < labelFields.length; i += 1) {
    const color = resolveQualityColorByLabel(source[labelFields[i]]);
    if (color) {
      return color;
    }
  }
  const nestedFields = ['detail', 'skill', 'ability'];
  for (let i = 0; i < nestedFields.length; i += 1) {
    const nested = resolveSkillColorFromSource(source[nestedFields[i]]);
    if (nested) {
      return nested;
    }
  }
  return '';
}

function extractSkillQualityColorFromAction(action = {}) {
  if (!action || action.type === 'result' || action.type === 'dodge') {
    return '';
  }
  const directColorFields = ['skillColor', 'skillColour', 'skillColourHex', 'skillQualityColor'];
  for (let i = 0; i < directColorFields.length; i += 1) {
    const color = sanitizeColorValue(action[directColorFields[i]]);
    if (color) {
      return color;
    }
  }
  const directQualityFields = ['skillQuality', 'skillRarity'];
  for (let i = 0; i < directQualityFields.length; i += 1) {
    const color = resolveQualityColorByKey(action[directQualityFields[i]]);
    if (color) {
      return color;
    }
  }
  const skillSources = [];
  if (action.skill) {
    skillSources.push(action.skill);
  }
  if (action.skillDetail) {
    skillSources.push(action.skillDetail);
  }
  if (action.summary) {
    skillSources.push(action.summary);
  }
  const raw = action.raw || {};
  const rawColorFields = ['skillColor', 'skillQualityColor', 'qualityColor', 'rarityColor'];
  for (let i = 0; i < rawColorFields.length; i += 1) {
    const color = sanitizeColorValue(raw[rawColorFields[i]]);
    if (color) {
      return color;
    }
  }
  const rawQualityFields = ['skillQuality', 'quality', 'skillRarity', 'rarity'];
  for (let i = 0; i < rawQualityFields.length; i += 1) {
    const color = resolveQualityColorByKey(raw[rawQualityFields[i]]);
    if (color) {
      return color;
    }
  }
  if (raw.skill) {
    skillSources.push(raw.skill);
  }
  if (raw.detail) {
    skillSources.push(raw.detail);
  }
  if (raw.summary) {
    skillSources.push(raw.summary);
  }
  if (raw.action) {
    skillSources.push(raw.action);
  }
  if (raw.ability) {
    skillSources.push(raw.ability);
  }
  if (Array.isArray(raw.skills)) {
    skillSources.push(...raw.skills);
  }
  for (let i = 0; i < skillSources.length; i += 1) {
    const color = resolveSkillColorFromSource(skillSources[i]);
    if (color) {
      return color;
    }
  }
  return '';
}

function resolveHpValue(state = {}, sideKey) {
  const side = state && state[sideKey] ? state[sideKey] : null;
  if (!side || typeof side.current !== 'number') {
    return Number(side && side.current) || 0;
  }
  return side.current;
}

function resolveBackgroundVideoById(backgroundId) {
  const normalized = normalizeBackgroundId(backgroundId || '');
  if (!normalized) {
    return '';
  }
  const background = resolveBackgroundById(normalized);
  if (!background || !background.video) {
    return '';
  }
  return background.video;
}

function extractRealmName(enemy = {}) {
  if (enemy && typeof enemy.realmName === 'string' && enemy.realmName.trim()) {
    return enemy.realmName.trim();
  }
  if (enemy && typeof enemy.stageName === 'string') {
    const parts = enemy.stageName.split('·');
    if (parts.length && parts[0].trim()) {
      return parts[0].trim();
    }
  }
  return '';
}

function resolvePveSceneBackground(enemy = {}) {
  if (!enemy || typeof enemy !== 'object') {
    return SECRET_REALM_BACKGROUND_VIDEO;
  }
  const scene = enemy.scene || enemy.environment || {};
  if (scene && typeof scene.video === 'string' && scene.video) {
    return scene.video;
  }
  if (scene && typeof scene.backgroundVideo === 'string' && scene.backgroundVideo) {
    return scene.backgroundVideo;
  }
  if (typeof enemy.backgroundVideo === 'string' && enemy.backgroundVideo) {
    return enemy.backgroundVideo;
  }
  const sceneBackgroundId =
    (scene && scene.backgroundId) ||
    (enemy.background && enemy.background.id) ||
    enemy.backgroundId ||
    '';
  const resolvedById = resolveBackgroundVideoById(sceneBackgroundId);
  if (resolvedById) {
    return resolvedById;
  }
  const realmName = extractRealmName(enemy);
  if (realmName) {
    const background = resolveBackgroundByRealmName(realmName);
    if (background && background.video) {
      return background.video;
    }
  }
  return SECRET_REALM_BACKGROUND_VIDEO;
}

function extractBackgroundVideoFromSource(source) {
  if (!source) {
    return '';
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source.background && typeof source.background.video === 'string' && source.background.video) {
    return source.background.video;
  }
  if (typeof source.backgroundVideo === 'string' && source.backgroundVideo) {
    return source.backgroundVideo;
  }
  if (typeof source.video === 'string' && source.video) {
    return source.video;
  }
  if (source.defenderBackground) {
    return extractBackgroundVideoFromSource(source.defenderBackground);
  }
  if (typeof source.appearanceBackgroundId === 'string') {
    const resolved = resolveBackgroundVideoById(source.appearanceBackgroundId);
    if (resolved) {
      return resolved;
    }
  }
  if (source.background && typeof source.background.id === 'string') {
    const resolved = resolveBackgroundVideoById(source.background.id);
    if (resolved) {
      return resolved;
    }
  }
  if (typeof source.backgroundId === 'string') {
    const resolved = resolveBackgroundVideoById(source.backgroundId);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function isInviteSource(source) {
  return source === 'acceptInvite' || source === 'autoInvite';
}

function resolvePvpDefenderBackgroundVideo({ battle = {}, preview = null, source = '' } = {}) {
  const candidates = [];
  const options = battle && battle.options ? battle.options : {};
  const player = battle && battle.player ? battle.player : {};
  const opponent = battle && battle.opponent ? battle.opponent : {};
  const defenderId = options.defenderId || '';
  if (defenderId) {
    if (player && player.memberId === defenderId) {
      candidates.push(player);
    } else if (opponent && opponent.memberId === defenderId) {
      candidates.push(opponent);
    }
  }
  if (!candidates.length) {
    if (isInviteSource(source)) {
      candidates.push(player);
    } else if (options.inviteMatch && options.initiatorId && options.initiatorId !== player.memberId) {
      candidates.push(player);
    } else if (opponent && Object.keys(opponent).length) {
      candidates.push(opponent);
    }
  }
  if (preview) {
    candidates.push(preview);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const video = extractBackgroundVideoFromSource(candidates[i]);
    if (video) {
      return video;
    }
  }
  return '';
}

Page({
  data: {
    navTitle: '战斗演武',
    ...createBattleStageState(),
    actions: [],
    skipCountdown: MIN_SKIP_SECONDS,
    battleState: 'loading',
    battleStage: createBattleStageState()
  },

  onLoad(options = {}) {
    this.mode = options.mode === 'pvp' ? 'pvp' : 'pve';
    this.isReplay = options.replay === '1' || options.replay === true;
    this.contextOptions = options;
    this.navInitialized = false;
    this._floatingTextId = 0;
    this._floatingTextTimers = {};
    this._floatingTexts = cloneFloatingTextState();
    this._attackTimers = [];
    this._currentActionUsesIndicator = false;
    this.setData({
      navTitle: this.isReplay ? '战斗回放' : this.mode === 'pvp' ? '竞技对决' : '秘境对战'
    });
    this.openerChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (this.openerChannel && this.openerChannel.on) {
      this.openerChannel.on('battleContext', (payload = {}) => {
        this.contextPayload = payload || {};
        this.bootstrap();
      });
    }
    if (options.matchId) {
      this.contextPayload = { ...this.contextPayload, matchId: options.matchId, source: 'replay' };
      this.bootstrap();
    } else if (!this.openerChannel) {
      this.bootstrap();
    }
  },

  onUnload() {
    this.clearTimers();
  },

  bootstrap() {
    if (this._bootstrapped) {
      return;
    }
    this._bootstrapped = true;
    this.loadBattle();
  },

  async loadBattle() {
    this.clearTimers();
    this.resetFloatingTexts();
    this.setBattleStageData({ loading: true, error: '', battleFinished: false });
    this.setData({ battleState: 'loading' });
    this._parentNotified = false;
    const context = this.contextPayload || {};
    try {
      let serviceResult = null;
      let battleData = null;
      let viewContext = {};
      if (this.isReplay || context.source === 'replay') {
        if (this.mode === 'pvp') {
          const matchId = context.matchId || this.contextOptions.matchId;
          if (!matchId) {
            throw new Error('未找到战报');
          }
          battleData = await PvpService.battleReplay(matchId);
          const participants = (battleData && battleData.participants) || {};
          const playerParticipant =
            resolveParticipantByAliases(participants, ['player', 'self', 'attacker', 'initiator', 'ally', 'member']) || null;
          const opponentParticipant =
            resolveParticipantByAliases(participants, ['opponent', 'enemy', 'defender', 'target', 'foe']) || null;
          viewContext = {
            playerPortrait: pickBattlePortrait(
              DEFAULT_PLAYER_IMAGE,
              context.playerPortrait,
              playerParticipant,
              battleData.player
            ),
            opponentPortrait: pickBattlePortrait(
              DEFAULT_OPPONENT_IMAGE,
              context.opponentPortrait,
              opponentParticipant,
              battleData.opponent
            ),
            playerName: battleData.player ? battleData.player.displayName : '我方',
            opponentName: battleData.opponent ? battleData.opponent.displayName : '对手',
            playerPower: battleData.player ? battleData.player.pointsAfter : '',
            opponentPower: battleData.opponent ? battleData.opponent.pointsAfter : ''
          };
          viewContext.backgroundVideo = ARENA_BACKGROUND_VIDEO;
        } else {
          battleData = context.battle || null;
          viewContext = context.viewContext || {};
          if (!battleData) {
            throw new Error('暂无战斗回放数据');
          }
        }
      } else if (this.mode === 'pve') {
        const enemyId = context.enemyId || this.contextOptions.enemyId;
        if (!enemyId) {
          throw new Error('未找到敌方信息');
        }
        serviceResult = await PveService.battle(enemyId);
        battleData = serviceResult.battle;
        const participants = (battleData && battleData.participants) || {};
        const playerParticipant = participants.player || participants.self || {};
        const playerCombatPower = playerParticipant ? playerParticipant.combatPower : undefined;
        let playerPowerValue = '';
        if (Number.isFinite(playerCombatPower)) {
          playerPowerValue = Math.round(playerCombatPower);
        } else if (typeof playerCombatPower === 'string' && playerCombatPower.trim()) {
          playerPowerValue = playerCombatPower.trim();
        } else if (Number.isFinite(context.playerPower)) {
          playerPowerValue = Math.round(context.playerPower);
        } else if (typeof context.playerPower === 'string' && context.playerPower.trim()) {
          playerPowerValue = context.playerPower.trim();
        }
        const enemy = context.enemyPreview || {};
        const sceneBackground = resolvePveSceneBackground(enemy);
        const resolvedBackgroundVideo =
          sceneBackground || context.backgroundVideo || SECRET_REALM_BACKGROUND_VIDEO;
        viewContext = {
          playerName:
            playerParticipant.displayName ||
            playerParticipant.name ||
            context.playerName ||
            '你',
          playerPortrait: pickBattlePortrait(
            DEFAULT_PLAYER_IMAGE,
            context.playerPortrait,
            playerParticipant
          ),
          playerPower: playerPowerValue,
          opponentName: enemy.name || '秘境之敌',
          opponentPortrait: pickBattlePortrait(
            DEFAULT_OPPONENT_IMAGE,
            context.opponentPortrait,
            enemy
          ),
          backgroundVideo: resolvedBackgroundVideo
        };
        this.parentPayload = {
          type: 'pve',
          battle: serviceResult.battle || null
        };
      } else {
        const action = context.source || 'random';
        if (action === 'acceptInvite') {
          serviceResult = await PvpService.acceptInvite(context.inviteId || '');
        } else if (action === 'challenge') {
          serviceResult = await PvpService.matchFriend(context.targetId || '');
        } else {
          serviceResult = await PvpService.matchRandom();
        }
        battleData = serviceResult.battle;
        const profile = serviceResult.profile || {};
        const member = profile.memberSnapshot || profile.member || {};
        const opponent = (serviceResult.opponent && serviceResult.opponent) || {};
        viewContext = {
          playerName: member.nickName || member.name || '我方',
          playerPortrait: pickBattlePortrait(
            DEFAULT_PLAYER_IMAGE,
            context.playerPortrait,
            member,
            battleData && battleData.player
          ),
          playerPower:
            (battleData && battleData.player && battleData.player.pointsAfter) ||
            (serviceResult.profile ? serviceResult.profile.points : ''),
          opponentName:
            opponent.nickName || (battleData && battleData.opponent && battleData.opponent.displayName) || '对手',
          opponentPortrait: pickBattlePortrait(
            DEFAULT_OPPONENT_IMAGE,
            context.opponentPortrait,
            opponent,
            battleData && battleData.opponent
          ),
          opponentPower:
            (battleData && battleData.opponent && battleData.opponent.pointsAfter) || opponent.points || ''
        };
        viewContext.backgroundVideo = ARENA_BACKGROUND_VIDEO;
        this.parentPayload = {
          type: 'pvp',
          battleSource: action,
          profile: serviceResult.profile || null,
          battle: serviceResult.battle || null,
          opponent: serviceResult.opponent || null,
          season: serviceResult.season || null,
          recentMatches: serviceResult.recentMatches || null,
          leaderboardPreview: serviceResult.leaderboardPreview || null,
          leaderboardUpdatedAt: serviceResult.leaderboardUpdatedAt || null
        };
      }

      if (!battleData) {
        throw new Error('战斗数据为空');
      }
      this.latestBattle = battleData;
      const viewModel = createBattleViewModel({ mode: this.mode, battle: battleData, context: viewContext });
      this.applyBattleViewModel(viewModel);
    } catch (error) {
      console.error('[battle/play] load battle failed', error);
      const message = error && (error.errMsg || error.message) ? error.errMsg || error.message : '战斗加载失败';
      wx.showToast({ title: message, icon: 'none' });
      this.setBattleStageData({ loading: false, error: message });
      this.setData({ battleState: 'error' });
    }
  },

  applyBattleViewModel(viewModel) {
    const skipLocked = !this.isReplay;
    const alignment = this.resolveBattleAlignment(viewModel);
    const defenderBackground = this.resolveDefenderBackgroundVideo(alignment, viewModel);
    const backgroundVideo = defenderBackground || viewModel.backgroundVideo || DEFAULT_BACKGROUND_VIDEO;
    const stagePlayer = viewModel.player ? { ...viewModel.player } : {};
    const stageOpponent = viewModel.opponent ? { ...viewModel.opponent } : {};

    if (stagePlayer.isBot) {
      stagePlayer.avatar = BATTLE_BOT_AVATAR_IMAGE;
      stagePlayer.portrait = BATTLE_BOT_PORTRAIT_IMAGE;
    }
    if (stageOpponent.isBot) {
      stageOpponent.avatar = BATTLE_BOT_AVATAR_IMAGE;
      stageOpponent.portrait = BATTLE_BOT_PORTRAIT_IMAGE;
    }

    this.initialHp = normalizeHpStateMap({
      player: stagePlayer.hp || (viewModel.player && viewModel.player.hp) || { current: 0, max: 0 },
      opponent: stageOpponent.hp || (viewModel.opponent && viewModel.opponent.hp) || { current: 0, max: 0 }
    });
    this.initialResource = normalizeResourceStateMap({
      player:
        stagePlayer.resource ||
        (viewModel.player && viewModel.player.resource) ||
        { current: 0, max: DEFAULT_RESOURCE_MAX },
      opponent:
        stageOpponent.resource ||
        (viewModel.opponent && viewModel.opponent.resource) ||
        { current: 0, max: DEFAULT_RESOURCE_MAX }
    });
    this.setBattleStageData({
      loading: false,
      error: '',
      backgroundVideo,
      player: stagePlayer,
      opponent: stageOpponent,
      hpState: this.initialHp,
      resourceState: this.initialResource,
      attackerKey: alignment.attackerKey,
      defenderKey: alignment.defenderKey,
      currentAction: {},
      displayedLogs: [],
      skipLocked,
      skipButtonText: skipLocked ? `跳过（${MIN_SKIP_SECONDS}）` : '跳过战斗',
      battleFinished: false,
      resultTitle: '',
      resultSubtitle: '',
      resultClass: '',
      resultRounds: viewModel.result.rounds || viewModel.actions.length,
      currentRound: 1
    });
    this.resetFloatingTexts();
    this.setData({
      actions: viewModel.actions,
      skipCountdown: skipLocked ? MIN_SKIP_SECONDS : 0,
      battleState: 'ready'
    });
    this.battleResultMeta = viewModel.result || {};
    this.clearTimers();
    this.timelineIndex = -1;
    if (skipLocked) {
      this.startSkipCountdown();
    }
    this.scheduleNextAction(600);
  },

  resolveBattleAlignment(viewModel = {}) {
    const battle = this.latestBattle || {};
    const participants = (battle && battle.participants) || {};
    const context = this.contextPayload || {};
    const parentPayload = this.parentPayload || {};
    const options = (battle && battle.options) || {};
    const metadata = (battle && battle.metadata) || {};
    const viewOptions = this.contextOptions || {};

    const playerEntities = [
      battle.player,
      participants.player,
      participants.self,
      context.player,
      context.profile,
      context.playerParticipant,
      context.self,
      parentPayload.profile,
      parentPayload.player,
      parentPayload.self,
      parentPayload.battle && parentPayload.battle.player,
      viewModel.player
    ];

    const opponentEntities = [
      battle.opponent,
      participants.opponent,
      participants.enemy,
      participants.target,
      context.opponent,
      context.enemy,
      context.target,
      context.enemyPreview,
      context.opponentPreview,
      parentPayload.opponent,
      parentPayload.enemy,
      parentPayload.battle && parentPayload.battle.opponent,
      parentPayload.opponentPreview,
      viewModel.opponent
    ];

    const playerIds = buildParticipantIdSet('player', playerEntities);
    const opponentIds = buildParticipantIdSet('opponent', opponentEntities);

    const defenderCandidates = [
      options.defenderId,
      options.targetId,
      options.defender,
      participants.defender,
      metadata.defenderId,
      metadata.defender,
      context.defender,
      context.defenderId,
      parentPayload.defender,
      parentPayload.defenderId
    ];
    if (context.preview && typeof context.preview === 'object') {
      defenderCandidates.push(context.preview.defender, context.preview.defenderId);
    }
    if (parentPayload.preview && typeof parentPayload.preview === 'object') {
      defenderCandidates.push(parentPayload.preview.defender, parentPayload.preview.defenderId);
    }

    for (let i = 0; i < defenderCandidates.length; i += 1) {
      const side = resolveSideFromCandidate(defenderCandidates[i], playerIds, opponentIds);
      if (side) {
        return {
          attackerKey: side === 'player' ? 'opponent' : 'player',
          defenderKey: side
        };
      }
    }

    const attackerCandidates = [
      options.attackerId,
      options.initiatorId,
      options.attacker,
      options.initiator,
      participants.attacker,
      participants.initiator,
      metadata.attackerId,
      metadata.attacker,
      metadata.initiatorId,
      metadata.initiator,
      context.attacker,
      context.attackerId,
      context.initiator,
      context.initiatorId,
      parentPayload.attacker,
      parentPayload.attackerId
    ];
    if (context.preview && typeof context.preview === 'object') {
      attackerCandidates.push(context.preview.attacker, context.preview.initiatorId);
    }
    if (parentPayload.preview && typeof parentPayload.preview === 'object') {
      attackerCandidates.push(parentPayload.preview.attacker, parentPayload.preview.initiatorId);
    }

    for (let i = 0; i < attackerCandidates.length; i += 1) {
      const side = resolveSideFromCandidate(attackerCandidates[i], playerIds, opponentIds);
      if (side) {
        return {
          attackerKey: side,
          defenderKey: side === 'player' ? 'opponent' : 'player'
        };
      }
    }

    const source = context.source || viewOptions.source || '';
    if (isInviteSource(source)) {
      return { attackerKey: 'opponent', defenderKey: 'player' };
    }

    const initiatorHint =
      options.initiatorId || metadata.initiatorId || context.initiatorId || parentPayload.initiatorId;
    if (hasId(playerIds, initiatorHint)) {
      return { attackerKey: 'player', defenderKey: 'opponent' };
    }
    if (hasId(opponentIds, initiatorHint)) {
      return { attackerKey: 'opponent', defenderKey: 'player' };
    }

    if (options.inviteMatch && options.initiatorId) {
      if (hasId(playerIds, options.initiatorId)) {
        return { attackerKey: 'player', defenderKey: 'opponent' };
      }
      if (hasId(opponentIds, options.initiatorId)) {
        return { attackerKey: 'opponent', defenderKey: 'player' };
      }
    }

    if (this.mode === 'pve') {
      return { attackerKey: 'player', defenderKey: 'opponent' };
    }

    return { attackerKey: 'player', defenderKey: 'opponent' };
  },

  resolveDefenderBackgroundVideo(alignment = {}, viewModel = {}) {
    if (this.mode === 'pvp') {
      return ARENA_BACKGROUND_VIDEO;
    }
    const defenderKey = alignment && alignment.defenderKey ? alignment.defenderKey : 'opponent';
    const battle = this.latestBattle || {};
    const participants = (battle && battle.participants) || {};
    const context = this.contextPayload || {};
    const parentPayload = this.parentPayload || {};
    const options = (battle && battle.options) || {};
    const metadata = (battle && battle.metadata) || {};

    const candidateSources = [];
    if (defenderKey === 'player') {
      candidateSources.push(
        viewModel.player,
        battle.player,
        participants.player,
        participants.self,
        context.player,
        context.profile,
        context.playerParticipant,
        context.self,
        parentPayload.profile,
        parentPayload.player,
        parentPayload.self,
        parentPayload.battle && parentPayload.battle.player,
        options.player,
        options.attacker,
        options.initiator,
        metadata.player,
        metadata.attacker,
        metadata.initiator
      );
      if (context.preview && typeof context.preview === 'object') {
        candidateSources.push(context.preview.player, context.preview.attacker);
      }
      if (parentPayload.preview && typeof parentPayload.preview === 'object') {
        candidateSources.push(parentPayload.preview.player, parentPayload.preview.attacker);
      }
    } else {
      candidateSources.push(
        viewModel.opponent,
        battle.opponent,
        participants.opponent,
        participants.enemy,
        participants.target,
        context.opponent,
        context.enemy,
        context.target,
        context.enemyPreview,
        context.opponentPreview,
        context.defenderBackground,
        parentPayload.opponent,
        parentPayload.enemy,
        parentPayload.battle && parentPayload.battle.opponent,
        parentPayload.opponentPreview,
        options.defender,
        options.target,
        options.defenderBackground,
        metadata.defender,
        metadata.target
      );
      if (context.preview && typeof context.preview === 'object') {
        candidateSources.push(context.preview.opponent, context.preview.defenderBackground);
      }
      if (parentPayload.preview && typeof parentPayload.preview === 'object') {
        candidateSources.push(parentPayload.preview.opponent, parentPayload.preview.defenderBackground);
      }
    }

    for (let i = 0; i < candidateSources.length; i += 1) {
      const video = extractBackgroundVideoFromSource(candidateSources[i]);
      if (video) {
        return video;
      }
    }
    return '';
  },

  resetFloatingTexts() {
    this.clearFloatingTextTimers();
    this._floatingTexts = cloneFloatingTextState();
    this.setBattleStageData({ floatingTexts: this._floatingTexts });
  },

  queueAttackTimer(handler, delay = 0) {
    if (!this._attackTimers) {
      this._attackTimers = [];
    }
    const timeout = setTimeout(() => {
      if (typeof handler === 'function') {
        handler.call(this);
      }
    }, Math.max(0, Number(delay) || 0));
    this._attackTimers.push(timeout);
    return timeout;
  },

  clearAttackTimers() {
    if (Array.isArray(this._attackTimers)) {
      this._attackTimers.forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    }
    this._attackTimers = [];
    this._currentActionUsesIndicator = false;
    this._pendingControlledState = null;
    this._pendingControlledStateApplied = false;
    this.setBattleStageData({
      attackPhase: '',
      attackMotion: '',
      attackActor: '',
      attackTarget: '',
      attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' },
      targetReaction: ''
    });
  },

  clearFloatingTextTimers() {
    if (!this._floatingTextTimers) {
      return;
    }
    Object.keys(this._floatingTextTimers).forEach((key) => {
      if (this._floatingTextTimers[key]) {
        clearTimeout(this._floatingTextTimers[key]);
      }
    });
    this._floatingTextTimers = {};
  },

  showFloatingText(side, { text, type = 'skill', duration = 1200, color = '' } = {}) {
    const normalizedSide = side === 'player' || side === 'opponent' ? side : '';
    if (!normalizedSide) {
      return;
    }
    const stringified = typeof text === 'number' ? String(Math.round(text)) : String(text || '').trim();
    if (!stringified) {
      return;
    }
    if (
      this._pendingControlledState &&
      !this._pendingControlledStateApplied &&
      textIndicatesControl(stringified) &&
      this._pendingControlledState[normalizedSide]
    ) {
      this.setBattleStageData({ controlledState: this._pendingControlledState });
      this._pendingControlledStateApplied = true;
      this._pendingControlledState = null;
    }
    const nextState = cloneFloatingTextState(this._floatingTexts);
    const entryId = `ft-${Date.now()}-${(this._floatingTextId += 1)}`;
    const sanitizedColor = typeof color === 'string' ? color.trim() : '';
    const entry = sanitizedColor ? { id: entryId, text: stringified, type, color: sanitizedColor } : { id: entryId, text: stringified, type };
    nextState[normalizedSide].push(entry);
    this._floatingTexts = nextState;
    this.setBattleStageData({ floatingTexts: nextState });
    const timeout = setTimeout(() => {
      this.removeFloatingText(normalizedSide, entryId);
    }, Math.max(600, duration || 0));
    this._floatingTextTimers[entryId] = timeout;
  },

  removeFloatingText(side, id) {
    if (!id) {
      return;
    }
    const normalizedSide = side === 'player' || side === 'opponent' ? side : '';
    if (!normalizedSide) {
      return;
    }
    const current = (this._floatingTexts && this._floatingTexts[normalizedSide]) || [];
    const nextSideEntries = current.filter((item) => item && item.id !== id);
    if (nextSideEntries.length === current.length) {
      if (this._floatingTextTimers && this._floatingTextTimers[id]) {
        clearTimeout(this._floatingTextTimers[id]);
        delete this._floatingTextTimers[id];
      }
      return;
    }
    const nextState = cloneFloatingTextState(this._floatingTexts);
    nextState[normalizedSide] = nextSideEntries;
    this._floatingTexts = nextState;
    this.setBattleStageData({ floatingTexts: nextState });
    if (this._floatingTextTimers && this._floatingTextTimers[id]) {
      clearTimeout(this._floatingTextTimers[id]);
      delete this._floatingTextTimers[id];
    }
  },

  applyActionFloatingTexts(
    action,
    previousHp = {},
    nextHp = {},
    previousResource = {},
    nextResource = {}
  ) {
    if (!action) {
      return;
    }
    const actorSide = action.actor === 'player' || action.actor === 'opponent' ? action.actor : '';
    const targetSide = action.target === 'player' || action.target === 'opponent' ? action.target : '';
    const effects = Array.isArray(action.effects) ? action.effects : [];
    const hasCrit = effects.some((effect) => effect && effect.type === 'crit');
    const hasDodge = action.type === 'dodge' || effects.some((effect) => effect && effect.type === 'dodge');

    if (actorSide) {
      const skillText = extractSkillTextFromAction(action);
      const shouldShowSkillText = !this._currentActionUsesIndicator;
      if (skillText && shouldShowSkillText) {
        const skillColor = skillText === '普攻' ? '' : extractSkillQualityColorFromAction(action);
        this.showFloatingText(actorSide, {
          text: skillText,
          type: 'skill',
          duration: 1400,
          color: skillColor
        });
      }
    }

    if (hasDodge && targetSide) {
      this.showFloatingText(targetSide, { text: '闪避', type: 'dodge', duration: 1200 });
    }

    const sides = ['player', 'opponent'];
    for (let i = 0; i < sides.length; i += 1) {
      const side = sides[i];
      const before = resolveHpValue(previousHp, side);
      const after = resolveHpValue(nextHp, side);
      if (!Number.isFinite(before) || !Number.isFinite(after)) {
        continue;
      }
      const delta = after - before;
      if (delta === 0) {
        continue;
      }
      if (delta < 0) {
        const amount = Math.abs(Math.round(delta));
        if (amount <= 0) {
          continue;
        }
        const isCrit = hasCrit && side === targetSide;
        const text = isCrit ? `暴击 -${amount}` : `-${amount}`;
        this.showFloatingText(side, {
          text,
          type: isCrit ? 'crit' : 'damage',
          duration: isCrit ? 900 : 1200
        });
      } else if (delta > 0) {
        const amount = Math.round(delta);
        if (amount <= 0) {
          continue;
        }
        this.showFloatingText(side, { text: `+${amount}`, type: 'heal', duration: 1200 });
      }
    }
  },

  shouldUseAttackIndicator(action, actorSide, targetSide) {
    if (!action || action.type === 'result') {
      return false;
    }
    if (!actorSide || !targetSide) {
      return false;
    }

    if (isControlSkipAction(action)) {
      return false;
    }

    if (action.type === 'dodge') {
      return true;
    }

    const effects = Array.isArray(action.effects) ? action.effects : [];
    if (effects.some((effect) => effect && effect.type === 'dodge')) {
      return true;
    }

    const skillText = extractSkillTextFromAction(action);
    if (skillText === '普攻') {
      return true;
    }

    if (skillText) {
      return true;
    }

    const actionType = typeof action.type === 'string' ? action.type : '';
    const normalizedType = actionType ? actionType.trim().toLowerCase() : '';
    if (!normalizedType) {
      return false;
    }

    if (normalizedType === 'attack' || normalizedType === 'normalattack' || normalizedType === 'basicattack') {
      return true;
    }

    if (normalizedType === 'skill') {
      const skillName =
        (action.skill && (action.skill.name || action.skill.label || action.skill.title)) ||
        (action.raw && action.raw.skill && (action.raw.skill.name || action.raw.skill.label || action.raw.skill.title));
      const normalizedSkillName = typeof skillName === 'string' ? skillName.trim() : '';
      if (normalizedSkillName === '普攻') {
        return true;
      }
    }

    return false;
  },

  computeActionDuration(action) {
    if (!action) {
      return 1400;
    }
    if (action.type === 'result') {
      return 2200;
    }
    const actorSide = action.actor === 'player' || action.actor === 'opponent' ? action.actor : '';
    const targetSide = action.target === 'player' || action.target === 'opponent' ? action.target : '';
    const useIndicator = this.shouldUseAttackIndicator(action, actorSide, targetSide);
    if (!useIndicator) {
      return 1400;
    }
    const effects = Array.isArray(action.effects) ? action.effects : [];
    const hasCrit = effects.some((effect) => effect && effect.type === 'crit');
    const indicatorLead = ATTACK_INDICATOR_HOLD_DURATION;
    const indicatorDisplay = ATTACK_INDICATOR_HOLD_DURATION + ATTACK_INDICATOR_FADE_DURATION;
    const windupDuration = hasCrit ? ATTACK_WINDUP_DURATION : 0;
    const prelaunchHold = hasCrit ? ATTACK_CRIT_PRELAUNCH_HOLD : 0;
    const chargeDuration = hasCrit ? ATTACK_CRIT_CHARGE_DURATION : ATTACK_CHARGE_DURATION;
    const attackTimeline =
      indicatorLead +
      windupDuration +
      prelaunchHold +
      chargeDuration +
      ATTACK_IMPACT_HOLD_DURATION +
      ATTACK_RECOVERY_DURATION;
    return Math.max(indicatorDisplay, attackTimeline) + ATTACK_SEQUENCE_BUFFER;
  },

  runActionSequence(
    action,
    previousHpState = {},
    nextHpState = {},
    previousResourceState = {},
    nextResourceState = {}
  ) {
    this.clearAttackTimers();
    if (!action) {
      return;
    }
    const actorSide = action.actor === 'player' || action.actor === 'opponent' ? action.actor : '';
    const targetSide = action.target === 'player' || action.target === 'opponent' ? action.target : '';
    const effects = Array.isArray(action.effects) ? action.effects : [];
    const hasCrit = effects.some((effect) => effect && effect.type === 'crit');
    const hasDodge = action.type === 'dodge' || effects.some((effect) => effect && effect.type === 'dodge');
    const useIndicator = this.shouldUseAttackIndicator(action, actorSide, targetSide);
    this._currentActionUsesIndicator = useIndicator;

    this._pendingControlledState = null;
    this._pendingControlledStateApplied = false;
    const currentControlledState =
      (this.data && this.data.battleStage && this.data.battleStage.controlledState) ||
      createBattleStageState().controlledState;
    const nextControlledState = { ...currentControlledState };
    let shouldDelayControlledState = false;
    if (actorSide === 'player' || actorSide === 'opponent') {
      const actorControlled = isControlSkipAction(action);
      nextControlledState[actorSide] = actorControlled;
      if (actorControlled) {
        shouldDelayControlledState = true;
      }
    }
    const controlledTargets = resolveControlTargets(action, actorSide, targetSide);
    controlledTargets.forEach((side) => {
      if (side === 'player' || side === 'opponent') {
        nextControlledState[side] = true;
        shouldDelayControlledState = true;
      }
    });
    if (shouldDelayControlledState) {
      this._pendingControlledState = nextControlledState;
    } else {
      this.setBattleStageData({ controlledState: nextControlledState });
    }

    if (!useIndicator) {
      this.setBattleStageData({
        hpState: nextHpState,
        resourceState: nextResourceState,
        attackPhase: '',
        attackMotion: '',
        attackActor: '',
        attackTarget: '',
        attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' },
        targetReaction: ''
      });
      this.applyActionFloatingTexts(
        action,
        previousHpState,
        nextHpState,
        previousResourceState,
        nextResourceState
      );
      this._currentActionUsesIndicator = false;
      return;
    }

    const indicatorHold = ATTACK_INDICATOR_HOLD_DURATION;
    const indicatorFade = ATTACK_INDICATOR_FADE_DURATION;
    const windupDuration = hasCrit ? ATTACK_WINDUP_DURATION : 0;
    const prelaunchHold = hasCrit ? ATTACK_CRIT_PRELAUNCH_HOLD : 0;
    const chargeDuration = hasCrit ? ATTACK_CRIT_CHARGE_DURATION : ATTACK_CHARGE_DURATION;
    const impactDuration = ATTACK_IMPACT_HOLD_DURATION;
    const recoveryDuration = ATTACK_RECOVERY_DURATION;

    const skillText = extractSkillTextFromAction(action);
    const indicatorText = skillText || '普攻';
    const indicatorColor =
      skillText && skillText !== '普攻' ? extractSkillQualityColorFromAction(action) : '';
    const indicatorQualityKey = resolveQualityKeyFromColor(indicatorColor);

    this.setBattleStageData({
      attackActor: actorSide,
      attackTarget: targetSide,
      attackMotion: hasCrit ? 'crit' : 'normal',
      attackPhase: 'indicator',
      attackIndicator: {
        visible: true,
        side: actorSide,
        status: 'show',
        text: indicatorText,
        color: indicatorColor,
        qualityKey: indicatorQualityKey
      },
      targetReaction: ''
    });

    const indicatorFadeComplete = indicatorHold + indicatorFade;

    this.queueAttackTimer(() => {
      const nextPhase = hasCrit ? 'windup' : 'charging';
      this.setBattleStageData({
        attackPhase: nextPhase,
        attackIndicator: {
          visible: true,
          side: actorSide,
          status: 'leaving',
          text: indicatorText,
          color: indicatorColor,
          qualityKey: indicatorQualityKey
        }
      });
    }, indicatorHold);

    this.queueAttackTimer(() => {
      this.setBattleStageData({
        attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' }
      });
    }, indicatorFadeComplete);

    if (hasCrit) {
      this.queueAttackTimer(() => {
        this.setBattleStageData({ attackPhase: 'prelaunch' });
      }, indicatorHold + windupDuration);
      this.queueAttackTimer(() => {
        this.setBattleStageData({ attackPhase: 'charging' });
      }, indicatorHold + windupDuration + prelaunchHold);
    }

    const chargeStartDelay = indicatorHold + (hasCrit ? windupDuration + prelaunchHold : 0);
    const impactDelay = chargeStartDelay + chargeDuration;
    const recoveryStartDelay = impactDelay + impactDuration;
    const sequenceEndDelay = recoveryStartDelay + recoveryDuration;

    if (hasDodge) {
      const dodgePrepDelay = Math.max(
        chargeStartDelay + 60,
        impactDelay - ATTACK_DODGE_LEAD_DURATION
      );
      this.queueAttackTimer(() => {
        this.setBattleStageData({ targetReaction: 'dodge' });
      }, dodgePrepDelay);
    }

    this.queueAttackTimer(() => {
      this.setBattleStageData({
        attackPhase: 'impact',
        targetReaction: hasDodge ? 'dodge' : 'hit',
        hpState: nextHpState,
        resourceState: nextResourceState
      });
      this.applyActionFloatingTexts(
        action,
        previousHpState,
        nextHpState,
        previousResourceState,
        nextResourceState
      );
    }, impactDelay);

    this.queueAttackTimer(() => {
      this.setBattleStageData({
        attackPhase: 'recovery',
        targetReaction: hasDodge ? 'dodge' : 'hit',
        hpState: nextHpState,
        resourceState: nextResourceState
      });
    }, recoveryStartDelay);

    this.queueAttackTimer(() => {
      this.setBattleStageData({
        attackPhase: '',
        attackMotion: '',
        attackActor: '',
        attackTarget: '',
        attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' },
        targetReaction: ''
      });
      this._currentActionUsesIndicator = false;
    }, sequenceEndDelay);
  },

  scheduleNextAction(delay = 1200) {
    this.clearActionTimer();
    if (!Array.isArray(this.data.actions) || !this.data.actions.length) {
      this.finishBattle();
      return;
    }
    this._actionTimer = setTimeout(() => {
      this.advanceAction();
    }, delay);
  },

  advanceAction() {
    const actions = this.data.actions || [];
    const currentIndex = typeof this.timelineIndex === 'number' ? this.timelineIndex : -1;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= actions.length) {
      this.finishBattle();
      return;
    }
    const action = actions[nextIndex];
    const actorSide =
      action && (action.actor === 'player' || action.actor === 'opponent') ? action.actor : '';
    if (actorSide && !isControlSkipAction(action)) {
      const currentControlledState =
        (this.data && this.data.battleStage && this.data.battleStage.controlledState) ||
        createBattleStageState().controlledState;
      if (currentControlledState[actorSide]) {
        this.setBattleStageData({
          controlledState: { ...currentControlledState, [actorSide]: false }
        });
      }
      if (this._pendingControlledState && this._pendingControlledState[actorSide]) {
        const pendingRelease = { ...this._pendingControlledState, [actorSide]: false };
        if (!pendingRelease.player && !pendingRelease.opponent) {
          this._pendingControlledState = null;
        } else {
          this._pendingControlledState = pendingRelease;
        }
      }
    }
    const nextLogs = [...this.data.displayedLogs, { id: action.id, text: action.description }].slice(-5);
    const previousHpState = this.data.hpState || {};
    const rawNextHpState = action.hp || {};
    const nextHpState = normalizeHpStateMap({
      player:
        Object.prototype.hasOwnProperty.call(rawNextHpState, 'player') && rawNextHpState.player !== undefined
          ? rawNextHpState.player
          : previousHpState.player,
      opponent:
        Object.prototype.hasOwnProperty.call(rawNextHpState, 'opponent') && rawNextHpState.opponent !== undefined
          ? rawNextHpState.opponent
          : previousHpState.opponent
    });
    const previousResourceState = this.data.resourceState || this.initialResource || {};
    const rawNextResourceState = action.resource || action.resources || {};
    const nextResourceState = normalizeResourceStateMap({
      player:
        Object.prototype.hasOwnProperty.call(rawNextResourceState, 'player') && rawNextResourceState.player !== undefined
          ? rawNextResourceState.player
          : previousResourceState.player,
      opponent:
        Object.prototype.hasOwnProperty.call(rawNextResourceState, 'opponent') &&
        rawNextResourceState.opponent !== undefined
          ? rawNextResourceState.opponent
          : previousResourceState.opponent
    });
    this.timelineIndex = nextIndex;
    this.resetFloatingTexts();
    this.setBattleStageData({
      currentAction: action,
      displayedLogs: nextLogs
    });
    this.runActionSequence(action, previousHpState, nextHpState, previousResourceState, nextResourceState);
    this.setData({ battleState: 'playing' });
    const nextRound = action.round || this.data.currentRound || this.data.battleStage.currentRound || 1;
    this.setBattleStageData({ currentRound: nextRound });
    const delay = this.computeActionDuration(action);
    this.scheduleNextAction(delay);
  },

  finishBattle() {
    this.clearTimers();
    this.resetFloatingTexts();
    if (this.data.battleFinished) {
      return;
    }
    const result = this.battleResultMeta || {};
    const victory = !!result.victory;
    const draw = !!result.draw;
    const resultTitle = draw ? '势均力敌' : victory ? '战斗胜利' : '战斗惜败';
    let resultSubtitle = '';
    if (this.mode === 'pve') {
      if (victory && result.rewards) {
        const stones = result.rewards.stones || 0;
        const attributePoints = result.rewards.attributePoints || 0;
        const segments = [];
        if (stones) segments.push(`${stones} 灵石`);
        if (attributePoints) segments.push(`${attributePoints} 属性点`);
        resultSubtitle = segments.length ? `获得 ${segments.join('、')}` : '继续深入秘境收集更多奖励';
      } else if (draw) {
        resultSubtitle = '灵力耗尽，双方暂且休战。';
      } else {
        resultSubtitle = '敌手强劲，回去整顿后再战。';
      }
    } else {
      const source = this.parentPayload ? this.parentPayload.battleSource : '';
      if (isExternalInviteSource(source)) {
        resultSubtitle = victory
          ? '您的仙界实力过硬，继续灰茄提升功力吧。'
          : '赶快灰茄提升功力吧，您在仙界实力太弱了。';
      } else {
        if (
          victory &&
          this.parentPayload &&
          this.parentPayload.battle &&
          this.parentPayload.battle.player
        ) {
          const delta = this.parentPayload.battle.player.pointsDelta;
          if (typeof delta === 'number' && delta !== 0) {
            resultSubtitle = `积分变化 ${delta >= 0 ? '+' : ''}${Math.round(delta)}`;
          }
        }
        if (!resultSubtitle) {
          resultSubtitle = draw ? '积分未有波动，胜负待定。' : victory ? '声名远扬，连战连捷。' : '略逊一筹，继续磨砺。';
        }
      }
    }
    const resultClass = draw ? 'draw' : victory ? 'victory' : 'defeat';
    this.setBattleStageData({
      battleFinished: true,
      resultTitle,
      resultSubtitle,
      resultClass,
      resultRounds: result.rounds || this.timelineIndex + 1,
      skipLocked: false,
      skipButtonText: '重播战斗',
      controlledState: { player: false, opponent: false }
    });
    this.setData({ battleState: 'finished' });
    this.notifyParent();
  },

  handleSkip() {
    if (this.data.battleFinished) {
      this.restartBattle();
      return;
    }
    if (this.data.skipLocked) {
      return;
    }
    this.clearTimers();
    this.resetFloatingTexts();
    const actions = this.data.actions || [];
    if (actions.length) {
      const lastAction = actions[actions.length - 1];
      this.setBattleStageData({
        currentAction: lastAction,
        displayedLogs: [...this.data.displayedLogs, { id: lastAction.id, text: lastAction.description }].slice(-5),
        hpState: lastAction.hp || this.data.hpState,
        resourceState: lastAction.resource || lastAction.resources || this.data.resourceState,
        currentRound: lastAction.round || this.data.currentRound || this.data.battleStage.currentRound || 1
      });
    }
    this.finishBattle();
  },

  handleExit() {
    const source = this.parentPayload ? this.parentPayload.battleSource : '';
    if (isExternalInviteSource(source)) {
      wx.reLaunch({
        url: '/pages/index/index',
        fail: () => {
          wx.navigateBack({ delta: 1 });
        }
      });
      return;
    }
    wx.navigateBack({ delta: 1 });
  },

  restartBattle() {
    const actions = this.data.actions || [];
    if (!actions.length) {
      return;
    }
    this.clearTimers();
    this.timelineIndex = -1;
    this.setBattleStageData({
      battleFinished: false,
      currentAction: {},
      displayedLogs: [],
      hpState: this.initialHp || this.data.hpState,
      resourceState: this.initialResource || this.data.resourceState,
      attackPhase: '',
      attackMotion: '',
      attackActor: '',
      attackTarget: '',
      attackIndicator: { visible: false, side: '', status: '', text: '', color: '', qualityKey: '' },
      targetReaction: '',
      skipLocked: false,
      skipButtonText: '跳过战斗',
      currentRound: 1,
      controlledState: { player: false, opponent: false }
    });
    this.resetFloatingTexts();
    this.setData({ battleState: 'playing', skipCountdown: 0 });
    this.scheduleNextAction(400);
  },

  startSkipCountdown() {
    this.clearSkipTimer();
    this.setBattleStageData({ skipLocked: true, skipButtonText: `跳过（${MIN_SKIP_SECONDS}）` });
    this.setData({ skipCountdown: MIN_SKIP_SECONDS });
    let remaining = MIN_SKIP_SECONDS;
    this._skipTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.clearSkipTimer();
        this.setBattleStageData({ skipLocked: false, skipButtonText: '跳过战斗' });
        this.setData({ skipCountdown: 0 });
      } else {
        this.setBattleStageData({ skipButtonText: `跳过（${remaining}）` });
        this.setData({ skipCountdown: remaining });
      }
    }, 1000);
  },

  notifyParent() {
    if (!this.openerChannel || typeof this.openerChannel.emit !== 'function' || !this.parentPayload) {
      return;
    }
    if (this._parentNotified) {
      return;
    }
    this._parentNotified = true;
    this.openerChannel.emit('battleFinished', this.parentPayload);
  },

  clearTimers() {
    this.clearActionTimer();
    this.clearSkipTimer();
    this.clearFloatingTextTimers();
    this.clearAttackTimers();
  },

  clearActionTimer() {
    if (this._actionTimer) {
      clearTimeout(this._actionTimer);
      this._actionTimer = null;
    }
  },

  clearSkipTimer() {
    if (this._skipTimer) {
      clearInterval(this._skipTimer);
      this._skipTimer = null;
    }
  },

  setBattleStageData(updates = {}) {
    if (!updates || typeof updates !== 'object') {
      return;
    }
    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'hpState')) {
      const previousHpState =
        (this.data && this.data.battleStage && this.data.battleStage.hpState) || createBattleStageState().hpState;
      const nextHpState = normalizedUpdates.hpState || {};
      normalizedUpdates.hpState = normalizeHpStateMap({
        player:
          Object.prototype.hasOwnProperty.call(nextHpState, 'player') && nextHpState.player !== undefined
            ? nextHpState.player
            : previousHpState.player,
        opponent:
          Object.prototype.hasOwnProperty.call(nextHpState, 'opponent') && nextHpState.opponent !== undefined
            ? nextHpState.opponent
            : previousHpState.opponent
      });
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'resourceState')) {
      const previousResourceState =
        (this.data && this.data.battleStage && this.data.battleStage.resourceState) ||
        createBattleStageState().resourceState;
      const nextResourceState = normalizedUpdates.resourceState || {};
      normalizedUpdates.resourceState = normalizeResourceStateMap({
        player:
          Object.prototype.hasOwnProperty.call(nextResourceState, 'player') && nextResourceState.player !== undefined
            ? nextResourceState.player
            : previousResourceState.player,
        opponent:
          Object.prototype.hasOwnProperty.call(nextResourceState, 'opponent') &&
          nextResourceState.opponent !== undefined
            ? nextResourceState.opponent
            : previousResourceState.opponent
      });
    }
    const nextStage = {
      ...this.data.battleStage,
      ...normalizedUpdates
    };
    const dataUpdates = { battleStage: nextStage };
    Object.keys(normalizedUpdates).forEach((key) => {
      dataUpdates[key] = nextStage[key];
    });
    this.setData(dataUpdates);
    // console.log('[battle] battleStage state:', nextStage);
  }
});
