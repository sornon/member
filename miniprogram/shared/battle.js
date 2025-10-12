const { buildCloudAssetUrl, CHARACTER_IMAGE_BASE_PATH } = require('./asset-paths');
const { normalizeAvatarFrameValue } = require('./avatar-frames');
const { buildTitleImageUrl, normalizeTitleId, resolveTitleById } = require('./titles');

const DEFAULT_BACKGROUND_VIDEO = buildCloudAssetUrl('video', 'battle_default.mp4');
const DEFAULT_PLAYER_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/male-b-1.png`;
const DEFAULT_OPPONENT_IMAGE = `${CHARACTER_IMAGE_BASE_PATH}/female-c-1.png`;

const PLAYER_SKILL_ROTATION = ['流云剑诀', '星河落斩', '落霞破影', '雷霆贯体'];
const OPPONENT_SKILL_ROTATION = ['幽影突袭', '寒魄碎骨', '血焰冲锋', '枯藤缠袭'];

const PARTICIPANT_ALIASES = {
  player: ['player', 'self', 'attacker', 'initiator', 'ally', 'member'],
  opponent: ['opponent', 'enemy', 'defender', 'target', 'foe']
};

const ACTION_EFFECT_LABELS = {
  crit: '暴击',
  dodge: '闪避',
  block: '格挡',
  shield: '护盾',
  status: '状态',
  heal: '治疗'
};

const AVATAR_FRAME_FIELDS = ['avatarFrame', 'appearanceFrame', 'frame', 'border', 'avatarBorder', 'avatar_frame'];

const TITLE_ID_FIELDS = [
  'appearanceTitle',
  'titleId',
  'titleKey',
  'titleCode',
  'activeTitle',
  'activeTitleId',
  'currentTitle',
  'currentTitleId',
  'title'
];

const TITLE_IMAGE_FIELDS = [
  'titleImage',
  'titleIcon',
  'titleUrl',
  'titleImageUrl',
  'appearanceTitleImage',
  'activeTitleImage'
];

const TITLE_NAME_FIELDS = [
  'titleName',
  'titleLabel',
  'titleDisplay',
  'titleText',
  'appearanceTitleName',
  'appearanceTitleLabel',
  'activeTitleName',
  'currentTitleName'
];

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed;
}

function pushUnique(collection, value) {
  if (!collection || !Array.isArray(collection)) {
    return;
  }
  if (!value) {
    return;
  }
  if (!collection.includes(value)) {
    collection.push(value);
  }
}

function looksLikeUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
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

function resolveAvatarFrameFromSources({ direct = [], sources = [] } = {}) {
  const candidates = [];
  for (let i = 0; i < direct.length; i += 1) {
    const directValue = toTrimmedString(direct[i]);
    if (directValue) {
      candidates.push(directValue);
    }
  }
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (!source || typeof source !== 'object') {
      continue;
    }
    for (let j = 0; j < AVATAR_FRAME_FIELDS.length; j += 1) {
      const field = AVATAR_FRAME_FIELDS[j];
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        const value = toTrimmedString(source[field]);
        if (value) {
          candidates.push(value);
        }
      }
    }
  }
  return resolveAvatarFrameValue(...candidates);
}

const AVATAR_IMAGE_FIELDS = [
  'avatar',
  'avatarUrl',
  'avatarURL',
  'avatar_url',
  'avatarPath',
  'avatar_path',
  'avatarImage',
  'avatarImg',
  'avatar_img',
  'avatarIcon',
  'avatar_icon',
  'avatarPicture',
  'avatarPic',
  'head',
  'headImage',
  'headImg',
  'headImgUrl',
  'headimg',
  'headimgurl',
  'headUrl',
  'headPic',
  'headIcon',
  'icon',
  'iconUrl',
  'iconURL',
  'icon_url',
  'profileAvatar',
  'profileAvatarUrl',
  'profileAvatarURL',
  'profile_avatar',
  'profileImage',
  'profileImg',
  'profileIcon',
  'portraitAvatar'
];

const AVATAR_NESTED_FIELDS = [
  'avatar',
  'profile',
  'member',
  'memberSnapshot',
  'self',
  'player',
  'character',
  'user',
  'owner',
  'account',
  'data',
  'info',
  'details',
  'source'
];

function resolveAvatarCandidateValue(candidate, visited = new Set()) {
  if (candidate === null || candidate === undefined) {
    return '';
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return '';
    }
    if (looksLikeUrl(trimmed)) {
      return trimmed;
    }
    return '';
  }
  if (typeof candidate === 'number') {
    return '';
  }
  if (Array.isArray(candidate)) {
    for (let i = 0; i < candidate.length; i += 1) {
      const resolved = resolveAvatarCandidateValue(candidate[i], visited);
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
    const directKeys = ['url', 'src', 'path'];
    for (let i = 0; i < directKeys.length; i += 1) {
      const key = directKeys[i];
      const value = candidate[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && looksLikeUrl(trimmed)) {
          return trimmed;
        }
      }
    }
    for (let i = 0; i < AVATAR_IMAGE_FIELDS.length; i += 1) {
      const field = AVATAR_IMAGE_FIELDS[i];
      if (!Object.prototype.hasOwnProperty.call(candidate, field)) {
        continue;
      }
      const resolved = resolveAvatarCandidateValue(candidate[field], visited);
      if (resolved) {
        return resolved;
      }
    }
    for (let i = 0; i < AVATAR_NESTED_FIELDS.length; i += 1) {
      const nestedKey = AVATAR_NESTED_FIELDS[i];
      if (!Object.prototype.hasOwnProperty.call(candidate, nestedKey)) {
        continue;
      }
      const resolved = resolveAvatarCandidateValue(candidate[nestedKey], visited);
      if (resolved) {
        return resolved;
      }
    }
  }
  return '';
}

function resolveAvatarFromSources({ direct = [], sources = [] } = {}) {
  const candidates = [];
  const pushCandidate = (value) => {
    if (value !== null && value !== undefined) {
      candidates.push(value);
    }
  };
  for (let i = 0; i < direct.length; i += 1) {
    pushCandidate(direct[i]);
  }
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (!source) {
      continue;
    }
    pushCandidate(source);
    if (typeof source === 'object') {
      for (let j = 0; j < AVATAR_IMAGE_FIELDS.length; j += 1) {
        const field = AVATAR_IMAGE_FIELDS[j];
        if (Object.prototype.hasOwnProperty.call(source, field)) {
          pushCandidate(source[field]);
        }
      }
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const resolved = resolveAvatarCandidateValue(candidates[i]);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function pickFirstUrl(candidates = []) {
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = toTrimmedString(candidates[i]);
    if (looksLikeUrl(candidate)) {
      return candidate;
    }
  }
  return '';
}

function pickNormalizedTitleId(values = []) {
  for (let i = 0; i < values.length; i += 1) {
    const normalized = normalizeTitleId(values[i]);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function categorizeTitleValue(value, target) {
  const candidate = toTrimmedString(value);
  if (!candidate) {
    return;
  }
  if (looksLikeUrl(candidate)) {
    pushUnique(target.images, candidate);
    return;
  }
  if (candidate.indexOf('_') >= 0 || /^title[\w-]*/.test(candidate)) {
    const normalized = normalizeTitleId(candidate);
    if (normalized) {
      pushUnique(target.ids, normalized);
    }
    return;
  }
  if (/[\u4e00-\u9fa5]/.test(candidate)) {
    pushUnique(target.names, candidate);
    return;
  }
  pushUnique(target.names, candidate);
}

function collectTitleCandidatesFromSource(target, source) {
  if (!source || typeof source !== 'object') {
    return;
  }
  for (let i = 0; i < TITLE_ID_FIELDS.length; i += 1) {
    const field = TITLE_ID_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      categorizeTitleValue(source[field], target);
    }
  }
  for (let i = 0; i < TITLE_IMAGE_FIELDS.length; i += 1) {
    const field = TITLE_IMAGE_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      const value = toTrimmedString(source[field]);
      if (value && looksLikeUrl(value)) {
        pushUnique(target.images, value);
      }
    }
  }
  for (let i = 0; i < TITLE_NAME_FIELDS.length; i += 1) {
    const field = TITLE_NAME_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      const value = toTrimmedString(source[field]);
      if (value) {
        pushUnique(target.names, value);
      }
    }
  }
}

function resolveTitleSnapshotFromSources({ direct = [], sources = [] } = {}) {
  const candidates = { ids: [], images: [], names: [] };
  for (let i = 0; i < direct.length; i += 1) {
    categorizeTitleValue(direct[i], candidates);
  }
  for (let i = 0; i < sources.length; i += 1) {
    collectTitleCandidatesFromSource(candidates, sources[i]);
  }
  const id = pickNormalizedTitleId(candidates.ids);
  let image = pickFirstUrl(candidates.images);
  let name = '';
  for (let i = 0; i < candidates.names.length; i += 1) {
    const candidate = toTrimmedString(candidates.names[i]);
    if (candidate) {
      name = candidate;
      break;
    }
  }
  if (!image && id) {
    const built = buildTitleImageUrl(id);
    if (built) {
      image = built;
    }
  }
  if (!name && id) {
    const resolved = resolveTitleById(id);
    if (resolved && resolved.name) {
      name = resolved.name;
    }
  }
  return { id, image, name };
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function resolvePortrait(source, fallback) {
  if (!source) {
    return fallback;
  }
  if (typeof source === 'string' && source.trim()) {
    return source;
  }
  if (source.avatarUrl) {
    return source.avatarUrl;
  }
  if (source.portrait) {
    return source.portrait;
  }
  return fallback;
}

function buildHpState(maxHp, currentHp) {
  const normalizedMax = Math.max(1, toNumber(maxHp, currentHp || 1));
  const normalizedCurrent = clamp(toNumber(currentHp, normalizedMax), 0, normalizedMax);
  const percent = clamp(Math.round((normalizedCurrent / normalizedMax) * 100), 0, 100);
  return { max: normalizedMax, current: normalizedCurrent, percent };
}

function isStructuredTimelineEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (Array.isArray(entry.events) && entry.events.length) {
    return true;
  }
  if (Array.isArray(entry.targets)) {
    for (let i = 0; i < entry.targets.length; i += 1) {
      const target = entry.targets[i];
      if (!target) continue;
      if (Array.isArray(target.events) && target.events.length) {
        return true;
      }
      if (Array.isArray(target.effects) && target.effects.length) {
        return true;
      }
    }
  }
  if (entry.state && (entry.state.player || entry.state.opponent)) {
    return true;
  }
  if (entry.summary && (entry.summary.title || entry.summary.text)) {
    return true;
  }
  return false;
}

function findParticipantByAliases(collection, aliases) {
  if (!collection || typeof collection !== 'object') {
    return null;
  }
  for (let i = 0; i < aliases.length; i += 1) {
    const alias = aliases[i];
    if (alias && collection[alias]) {
      return collection[alias];
    }
  }
  return null;
}

function resolveParticipantSource(participants, fallbackParticipants, aliases) {
  const primary = findParticipantByAliases(participants, aliases);
  if (primary) {
    return primary;
  }
  const fallback = findParticipantByAliases(fallbackParticipants, aliases);
  if (fallback) {
    return fallback;
  }
  return {};
}

function toParticipantName(source, fallback) {
  if (!source) {
    return fallback;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source.displayName) {
    return source.displayName;
  }
  if (source.name) {
    return source.name;
  }
  if (source.nickname) {
    return source.nickname;
  }
  return fallback;
}

function extractParticipantId(source, fallback) {
  if (!source || typeof source !== 'object') {
    return fallback;
  }
  return source.id || source.memberId || source.characterId || source.roleId || fallback;
}

function extractParticipantHp(source, defaultHp) {
  if (!source || typeof source !== 'object') {
    return defaultHp;
  }
  if (typeof source.hp === 'number') {
    return source.hp;
  }
  const hpData = source.hp || source.health || {};
  if (typeof hpData.current === 'number') {
    return hpData.current;
  }
  if (typeof hpData.value === 'number') {
    return hpData.value;
  }
  if (typeof hpData.after === 'number') {
    return hpData.after;
  }
  if (typeof hpData.before === 'number') {
    return hpData.before;
  }
  if (typeof hpData.max === 'number') {
    return hpData.max;
  }
  return defaultHp;
}

function extractParticipantMaxHp(source, defaultMaxHp) {
  if (!source || typeof source !== 'object') {
    return defaultMaxHp;
  }
  if (typeof source.maxHp === 'number') {
    return source.maxHp;
  }
  const hpData = source.hp || source.health || {};
  if (typeof hpData.max === 'number') {
    return hpData.max;
  }
  if (typeof hpData.before === 'number') {
    return hpData.before;
  }
  if (typeof hpData.current === 'number') {
    return hpData.current;
  }
  if (typeof hpData.after === 'number') {
    return hpData.after;
  }
  return defaultMaxHp;
}

const ATTRIBUTE_SNAPSHOT_KEYS = [
  'attributes',
  'attributeSnapshot',
  'attributeSummary',
  'stats',
  'statistics',
  'properties',
  'panel',
  'panelAttributes'
];

const ATTRIBUTE_HINT_KEYS = ['attack', 'defense', 'magicAttack', 'magicDefense', 'speed', 'critRate', 'critDamage', 'hit', 'dodge'];

function ensureAttributesObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const normalized = { ...value };
  return Object.keys(normalized).length ? normalized : null;
}

function extractAttributesSnapshot(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (let i = 0; i < ATTRIBUTE_SNAPSHOT_KEYS.length; i += 1) {
    const key = ATTRIBUTE_SNAPSHOT_KEYS[i];
    if (source[key]) {
      const normalized = ensureAttributesObject(source[key]);
      if (normalized) {
        return normalized;
      }
    }
  }
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (ATTRIBUTE_HINT_KEYS.includes(key)) {
      const normalized = ensureAttributesObject(source);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

function mergeAttributeSnapshots(previous, updates) {
  const base = previous && typeof previous === 'object' ? previous : null;
  const next = updates && typeof updates === 'object' ? updates : null;
  if (!base && !next) {
    return null;
  }
  if (!base) {
    return { ...next };
  }
  if (!next) {
    return { ...base };
  }
  return { ...base, ...next };
}

function resolveTimelineStateSide(state, sideKey) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  if (state[sideKey]) {
    return state[sideKey];
  }
  const aliases = PARTICIPANT_ALIASES[sideKey];
  if (aliases) {
    const resolved = findParticipantByAliases(state, aliases);
    if (resolved) {
      return resolved;
    }
  }
  if (sideKey === 'player' && state.self) {
    return state.self;
  }
  if (sideKey === 'opponent' && (state.enemy || state.target)) {
    return state.enemy || state.target;
  }
  return null;
}

function resolveEventTargets(event) {
  const targets = [];
  if (!event || typeof event !== 'object') {
    return targets;
  }
  if (event.targetId) {
    targets.push({ id: event.targetId, side: event.targetSide || null });
  }
  if (event.target) {
    const target = event.target;
    if (typeof target === 'string') {
      targets.push({ id: target, side: null });
    } else if (target && typeof target === 'object') {
      targets.push({ id: target.id || target.memberId || null, side: target.side || null });
    }
  }
  if (Array.isArray(event.targets)) {
    for (let i = 0; i < event.targets.length; i += 1) {
      const targetItem = event.targets[i];
      if (!targetItem) continue;
      if (typeof targetItem === 'string') {
        targets.push({ id: targetItem, side: null });
      } else if (typeof targetItem === 'object') {
        targets.push({ id: targetItem.id || targetItem.memberId || null, side: targetItem.side || null });
      }
    }
  }
  if (event.side) {
    targets.push({ id: null, side: event.side });
  }
  if (event.team) {
    targets.push({ id: null, side: event.team });
  }
  return targets;
}

function eventTargetsSide(event, sideKey, sideId) {
  const targets = resolveEventTargets(event);
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (target.side && target.side === sideKey) {
      return true;
    }
    if (sideId && target.id && target.id === sideId) {
      return true;
    }
  }
  if (event.targetType) {
    if (event.targetType === sideKey) {
      return true;
    }
    if (sideKey === 'player' && event.targetType === 'self') {
      return true;
    }
    if (sideKey === 'opponent' && event.targetType === 'enemy') {
      return true;
    }
  }
  return false;
}

function collectMaxHpFromTimeline(timeline, sideKey, fallbackMax) {
  let maxHp = toNumber(fallbackMax, 0);
  for (let i = 0; i < timeline.length; i += 1) {
    const entry = timeline[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const state = resolveTimelineStateSide(entry.state, sideKey);
    if (!state) {
      continue;
    }
    const hpData = state.hp || state.health || {};
    const candidates = [hpData.max, hpData.before, hpData.after, hpData.current, state.maxHp];
    for (let j = 0; j < candidates.length; j += 1) {
      const candidate = toNumber(candidates[j], NaN);
      if (Number.isFinite(candidate) && candidate > maxHp) {
        maxHp = candidate;
      }
    }
  }
  return Math.max(1, toNumber(maxHp, 1));
}

function collectInitialHpFromTimeline(timeline, sideKey, fallbackHp, maxHp) {
  let initial = toNumber(fallbackHp, NaN);
  for (let i = 0; i < timeline.length; i += 1) {
    const entry = timeline[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const state = resolveTimelineStateSide(entry.state, sideKey);
    if (!state) {
      continue;
    }
    const hpData = state.hp || state.health || {};
    if (typeof hpData.before === 'number' && hpData.before > 0) {
      initial = hpData.before;
      break;
    }
    if (typeof hpData.current === 'number' && hpData.current > 0) {
      initial = hpData.current;
      break;
    }
    if (typeof hpData.max === 'number' && hpData.max > 0) {
      initial = hpData.max;
      break;
    }
  }
  if (!Number.isFinite(initial) || initial <= 0) {
    initial = toNumber(maxHp, 1);
  }
  return Math.max(1, toNumber(initial, 1));
}

function pushEffect(effects, type) {
  if (!type || !ACTION_EFFECT_LABELS[type]) {
    return;
  }
  for (let i = 0; i < effects.length; i += 1) {
    if (effects[i] && effects[i].type === type) {
      return;
    }
  }
  effects.push({ type, label: ACTION_EFFECT_LABELS[type] });
}

function buildEffectsFromStructuredEntry(events) {
  const effects = [];
  if (!Array.isArray(events)) {
    return effects;
  }
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      continue;
    }
    if (event.type === 'dodge') {
      pushEffect(effects, 'dodge');
    }
    if (event.type === 'block') {
      pushEffect(effects, 'block');
    }
    if (event.type === 'shield' && toNumber(event.change, 0) > 0) {
      pushEffect(effects, 'shield');
    }
    if (event.type === 'status' && (event.operation === 'apply' || toNumber(event.stackChange, 0) > 0)) {
      pushEffect(effects, 'status');
    }
    if (event.type === 'heal' && toNumber(event.value, 0) > 0) {
      pushEffect(effects, 'heal');
    }
    const critFlag = event.crit || event.critical || (Array.isArray(event.tags) && event.tags.indexOf('crit') >= 0);
    if (event.type === 'damage' && critFlag) {
      pushEffect(effects, 'crit');
    }
  }
  return effects;
}

function buildDescriptionFromStructuredEntry({
  actorName,
  targetName,
  skillName,
  damage,
  heal,
  events
}) {
  const parts = [];
  if (Array.isArray(events)) {
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event && event.type === 'dodge') {
        return `${targetName} 成功闪避了 ${actorName} 的攻势。`;
      }
    }
  }
  if (skillName) {
    parts.push(`${actorName} 施展「${skillName}」`);
  } else {
    parts.push(`${actorName} 发动攻击`);
  }
  if (typeof damage === 'number' && damage > 0) {
    let damageText = `，对 ${targetName} 造成 ${damage} 点伤害`;
    if (Array.isArray(events)) {
      const hasCrit = events.some((event) => event && event.type === 'damage' && (event.crit || event.critical || (Array.isArray(event.tags) && event.tags.indexOf('crit') >= 0)));
      if (hasCrit) {
        damageText += '（暴击）';
      }
      const hasBlock = events.some((event) => event && event.type === 'block');
      if (hasBlock) {
        damageText += '，部分伤害被格挡';
      }
      const elements = [];
      events.forEach((event) => {
        if (event && event.type === 'damage') {
          if (event.element && elements.indexOf(event.element) === -1) {
            elements.push(event.element);
          }
          if (event.damageType && elements.indexOf(event.damageType) === -1) {
            elements.push(event.damageType);
          }
        }
      });
      if (elements.length) {
        damageText += `（${elements.join(' / ')}）`;
      }
    }
    damageText += '。';
    parts.push(damageText);
  } else {
    parts.push('，但未造成有效伤害。');
  }
  if (typeof heal === 'number' && heal > 0) {
    parts.push(` ${actorName} 借势恢复 ${heal} 点生命。`);
  }
  if (Array.isArray(events)) {
    const statuses = [];
    events.forEach((event) => {
      if (event && event.type === 'status' && (event.operation === 'apply' || toNumber(event.stackChange, 0) > 0)) {
        const label = event.statusName || event.label || event.statusId;
        if (label && statuses.indexOf(label) === -1) {
          statuses.push(label);
        }
      }
    });
    if (statuses.length) {
      parts.push(` ${targetName} 陷入 ${statuses.join('、')} 状态。`);
    }
  }
  return parts.join('');
}

function updateSideHpFromEntry({
  entry,
  sideKey,
  currentHp,
  currentMaxHp,
  damageTaken,
  healGained
}) {
  let nextHp = toNumber(currentHp, currentMaxHp);
  let nextMax = toNumber(currentMaxHp, 1);
  if (entry && typeof entry === 'object') {
    const state = resolveTimelineStateSide(entry.state, sideKey);
    if (state) {
      const hpData = state.hp || state.health || {};
      const maxCandidate = toNumber(hpData.max, state.maxHp);
      if (Number.isFinite(maxCandidate) && maxCandidate > nextMax) {
        nextMax = maxCandidate;
      }
      const after = toNumber(hpData.after, hpData.current);
      if (Number.isFinite(after)) {
        nextHp = after;
      } else {
        const before = toNumber(hpData.before, hpData.max);
        if (Number.isFinite(before)) {
          nextHp = clamp(before - damageTaken + healGained, 0, Math.max(nextMax, before));
        }
      }
    } else {
      nextHp = clamp(nextHp - damageTaken + healGained, 0, Math.max(1, nextMax));
    }
  }
  return {
    hp: clamp(toNumber(nextHp, nextMax), 0, Math.max(1, nextMax)),
    max: Math.max(1, toNumber(nextMax, 1))
  };
}

function resolveActorSide(entry, playerId, opponentId) {
  if (!entry || typeof entry !== 'object') {
    return 'neutral';
  }
  const actor = entry.actor || {};
  if (entry.actorSide) {
    return entry.actorSide;
  }
  if (actor.side) {
    return actor.side;
  }
  if (entry.team) {
    return entry.team;
  }
  if (entry.actorTeam) {
    return entry.actorTeam;
  }
  const actorId = entry.actorId || actor.id || actor.memberId || actor.roleId;
  if (actorId === playerId) {
    return 'player';
  }
  if (actorId === opponentId) {
    return 'opponent';
  }
  if (actorId && typeof actorId === 'string') {
    if (actorId.indexOf('player') >= 0) {
      return 'player';
    }
    if (actorId.indexOf('opponent') >= 0 || actorId.indexOf('enemy') >= 0) {
      return 'opponent';
    }
  }
  if (entry.side) {
    return entry.side;
  }
  return 'neutral';
}

function extractEventsFromEntry(entry) {
  const events = [];
  if (!entry || typeof entry !== 'object') {
    return events;
  }
  if (Array.isArray(entry.events)) {
    for (let i = 0; i < entry.events.length; i += 1) {
      const event = entry.events[i];
      if (event && typeof event === 'object') {
        events.push(event);
      }
    }
  }
  if (Array.isArray(entry.targets)) {
    for (let i = 0; i < entry.targets.length; i += 1) {
      const target = entry.targets[i];
      if (!target || typeof target !== 'object') {
        continue;
      }
      if (Array.isArray(target.events)) {
        for (let j = 0; j < target.events.length; j += 1) {
          const targetEvent = target.events[j];
          if (targetEvent && typeof targetEvent === 'object') {
            if (!targetEvent.targetId && (target.id || target.memberId)) {
              targetEvent.targetId = target.id || target.memberId;
            }
            if (!targetEvent.targetSide && target.side) {
              targetEvent.targetSide = target.side;
            }
            events.push(targetEvent);
          }
        }
      }
      if (Array.isArray(target.effects)) {
        for (let k = 0; k < target.effects.length; k += 1) {
          const effectEvent = target.effects[k];
          if (effectEvent && typeof effectEvent === 'object') {
            if (!effectEvent.type) {
              effectEvent.type = effectEvent.effectType || 'effect';
            }
            if (!effectEvent.targetId && (target.id || target.memberId)) {
              effectEvent.targetId = target.id || target.memberId;
            }
            if (!effectEvent.targetSide && target.side) {
              effectEvent.targetSide = target.side;
            }
            events.push(effectEvent);
          }
        }
      }
    }
  }
  return events;
}

function buildStructuredBattleViewModel({
  battle = {},
  timeline = [],
  context = {},
  defaults = {},
  fallbackParticipants = {}
} = {}) {
  if (!Array.isArray(timeline) || !timeline.length) {
    return null;
  }
  const participants = battle.participants || {};
  const playerSource = resolveParticipantSource(participants, fallbackParticipants, PARTICIPANT_ALIASES.player);
  const opponentSource = resolveParticipantSource(participants, fallbackParticipants, PARTICIPANT_ALIASES.opponent);
  const defaultPlayerName = defaults.playerName || '你';
  const defaultOpponentName = defaults.opponentName || '敌方';
  const playerName = toParticipantName(
    typeof context.playerName !== 'undefined' && context.playerName !== null ? context.playerName : playerSource,
    defaultPlayerName
  );
  const opponentName = toParticipantName(
    typeof context.opponentName !== 'undefined' && context.opponentName !== null ? context.opponentName : opponentSource,
    defaultOpponentName
  );
  const playerId = context.playerId || extractParticipantId(playerSource, 'player');
  const opponentId = context.opponentId || extractParticipantId(opponentSource, 'opponent');
  const playerPortrait = resolvePortrait(
    context.playerPortrait || (playerSource && (playerSource.portrait || playerSource.avatarUrl)) || playerSource,
    defaults.playerPortrait || DEFAULT_PLAYER_IMAGE
  );
  const opponentPortrait = resolvePortrait(
    context.opponentPortrait || (opponentSource && (opponentSource.portrait || opponentSource.avatarUrl)) || opponentSource,
    defaults.opponentPortrait || DEFAULT_OPPONENT_IMAGE
  );

  const playerBaseMax = extractParticipantMaxHp(playerSource, defaults.playerMaxHp);
  const opponentBaseMax = extractParticipantMaxHp(opponentSource, defaults.opponentMaxHp);
  let playerMaxHp = collectMaxHpFromTimeline(timeline, 'player', playerBaseMax);
  let opponentMaxHp = collectMaxHpFromTimeline(timeline, 'opponent', opponentBaseMax);
  const playerBaseHp = extractParticipantHp(playerSource, playerBaseMax);
  const opponentBaseHp = extractParticipantHp(opponentSource, opponentBaseMax);
  let playerHp = collectInitialHpFromTimeline(timeline, 'player', playerBaseHp, playerMaxHp);
  let opponentHp = collectInitialHpFromTimeline(timeline, 'opponent', opponentBaseHp, opponentMaxHp);

  const contextPlayerAttributes = ensureAttributesObject(context.playerAttributes);
  const contextOpponentAttributes = ensureAttributesObject(context.opponentAttributes);
  let playerAttributes =
    contextPlayerAttributes ||
    extractAttributesSnapshot(playerSource) ||
    extractAttributesSnapshot(battle.player) ||
    extractAttributesSnapshot(fallbackParticipants.player) ||
    null;
  let opponentAttributes =
    contextOpponentAttributes ||
    extractAttributesSnapshot(opponentSource) ||
    extractAttributesSnapshot(battle.opponent || battle.enemy) ||
    extractAttributesSnapshot(fallbackParticipants.opponent) ||
    null;

  const totals = {
    playerDamageDealt: 0,
    playerDamageTaken: 0,
    playerHeal: 0,
    enemyDamageDealt: 0,
    enemyDamageTaken: 0,
    enemyHeal: 0
  };

  const actions = [];
  let maxRound = 0;
  let hasResultEntry = false;

  for (let i = 0; i < timeline.length; i += 1) {
    const entry = timeline[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (entry.type === 'result') {
      hasResultEntry = true;
    }
    const round = toNumber(entry.round, i + 1);
    if (round > maxRound) {
      maxRound = round;
    }
    const events = extractEventsFromEntry(entry);
    const actorSide = resolveActorSide(entry, playerId, opponentId);
    const actorIsPlayer = actorSide === 'player';
    const actorInfo = entry.actor || {};
    const actorName = actorIsPlayer
      ? playerName
      : actorSide === 'opponent'
      ? opponentName
      : actorInfo.displayName || actorInfo.name || actorInfo.label || playerName;
    const targetCandidate = entry.target || entry.primaryTarget || {};
    const targetName = actorIsPlayer
      ? opponentName
      : actorSide === 'opponent'
      ? playerName
      : targetCandidate.displayName || targetCandidate.name || targetCandidate.label || opponentName;
    const skillName = entry.skill ? entry.skill.name || entry.skill.label : entry.summary && entry.summary.label;

    if (actorIsPlayer) {
      const actorAttributes = extractAttributesSnapshot(actorInfo);
      if (actorAttributes) {
        playerAttributes = mergeAttributeSnapshots(playerAttributes, actorAttributes);
      }
    } else if (actorSide === 'opponent') {
      const actorAttributes = extractAttributesSnapshot(actorInfo);
      if (actorAttributes) {
        opponentAttributes = mergeAttributeSnapshots(opponentAttributes, actorAttributes);
      }
    }

    const entryState = entry.state || {};
    const playerStateSnapshot = resolveTimelineStateSide(entryState, 'player');
    const opponentStateSnapshot = resolveTimelineStateSide(entryState, 'opponent');
    const playerStateAttributes = extractAttributesSnapshot(playerStateSnapshot);
    if (playerStateAttributes) {
      playerAttributes = mergeAttributeSnapshots(playerAttributes, playerStateAttributes);
    }
    const opponentStateAttributes = extractAttributesSnapshot(opponentStateSnapshot);
    if (opponentStateAttributes) {
      opponentAttributes = mergeAttributeSnapshots(opponentAttributes, opponentStateAttributes);
    }

    let damageToOpponent = 0;
    let damageToPlayer = 0;
    let healOnPlayer = 0;
    let healOnOpponent = 0;
    for (let j = 0; j < events.length; j += 1) {
      const event = events[j];
      if (!event || typeof event !== 'object') {
        continue;
      }
      if (event.type === 'damage') {
        const value = Math.max(0, toNumber(event.value, event.amount));
        if (eventTargetsSide(event, 'opponent', opponentId)) {
          damageToOpponent += value;
        }
        if (eventTargetsSide(event, 'player', playerId)) {
          damageToPlayer += value;
        }
      }
      if (event.type === 'heal') {
        const healValue = Math.max(0, toNumber(event.value, event.amount));
        if (eventTargetsSide(event, 'player', playerId)) {
          healOnPlayer += healValue;
        }
        if (eventTargetsSide(event, 'opponent', opponentId)) {
          healOnOpponent += healValue;
        }
      }
    }

    totals.playerDamageDealt += damageToOpponent;
    totals.enemyDamageTaken += damageToOpponent;
    totals.enemyDamageDealt += damageToPlayer;
    totals.playerDamageTaken += damageToPlayer;
    totals.playerHeal += healOnPlayer;
    totals.enemyHeal += healOnOpponent;

    const damage = actorIsPlayer ? damageToOpponent : actorSide === 'opponent' ? damageToPlayer : 0;
    const heal = actorIsPlayer ? healOnPlayer : actorSide === 'opponent' ? healOnOpponent : 0;

    const playerState = updateSideHpFromEntry({
      entry,
      sideKey: 'player',
      currentHp: playerHp,
      currentMaxHp: playerMaxHp,
      damageTaken: damageToPlayer,
      healGained: healOnPlayer
    });
    const opponentState = updateSideHpFromEntry({
      entry,
      sideKey: 'opponent',
      currentHp: opponentHp,
      currentMaxHp: opponentMaxHp,
      damageTaken: damageToOpponent,
      healGained: healOnOpponent
    });
    playerHp = playerState.hp;
    opponentHp = opponentState.hp;
    playerMaxHp = Math.max(playerMaxHp, playerState.max);
    opponentMaxHp = Math.max(opponentMaxHp, opponentState.max);

    const effects = buildEffectsFromStructuredEntry(events);
    let actionType = entry.actionType || entry.type || (entry.skill ? 'skill' : 'attack');
    for (let j = 0; j < effects.length; j += 1) {
      if (effects[j].type === 'dodge') {
        actionType = 'dodge';
        break;
      }
    }

    const description = entry.summary && entry.summary.text
      ? entry.summary.text
      : buildDescriptionFromStructuredEntry({
          actorName,
          targetName,
          skillName,
          damage,
          heal,
          events
        });
    const title = entry.summary && entry.summary.title
      ? entry.summary.title
      : `第${round}回合 · ${skillName || (actionType === 'dodge' ? '闪避应对' : '攻势')}`;

    actions.push({
      id: entry.id || `structured-${i}`,
      round,
      actor: actorIsPlayer ? 'player' : actorSide === 'opponent' ? 'opponent' : 'neutral',
      target: actorIsPlayer ? 'opponent' : actorSide === 'opponent' ? 'player' : 'neutral',
      type: actionType,
      damage: Math.round(damage),
      heal: Math.round(heal),
      description,
      title,
      effects,
      hp: {
        player: buildHpState(playerMaxHp, playerHp),
        opponent: buildHpState(opponentMaxHp, opponentHp)
      },
      attributes: {
        player: playerAttributes ? { ...playerAttributes } : null,
        opponent: opponentAttributes ? { ...opponentAttributes } : null
      },
      raw: entry
    });
  }

  const outcome = battle.outcome || {};
  const hasDraw = !!outcome.draw || outcome.result === 'draw' || battle.draw;
  const playerIsWinner = outcome.winnerId
    ? outcome.winnerId === playerId
    : outcome.result === 'victory' || (!!battle.victory && !hasDraw);
  const victory = !hasDraw && playerIsWinner;
  const draw = hasDraw;
  const resultRounds = toNumber(outcome.rounds, maxRound || actions.length);
  const resultRewards = outcome.rewards || battle.rewards || null;
  const resultSummary = outcome.summary || {};

  if (!hasResultEntry) {
    actions.push({
      id: outcome.id || 'structured-result',
      round: resultRounds || (actions.length ? actions[actions.length - 1].round : 1),
      actor: draw ? 'neutral' : victory ? 'player' : 'opponent',
      target: 'neutral',
      type: 'result',
      damage: 0,
      heal: 0,
      title: resultSummary.title
        ? resultSummary.title
        : `战斗结果 · ${draw ? '平局' : victory ? '胜利' : '惜败'}`,
      description: resultSummary.text
        ? resultSummary.text
        : draw
        ? '双方势均力敌，本场战斗以平局结束。'
        : victory
        ? '你技高一筹，成功取得这场战斗的胜利。'
        : '对手更胜一筹，继续修炼再战。',
      effects: [],
      hp: {
        player: buildHpState(playerMaxHp, playerHp),
        opponent: buildHpState(opponentMaxHp, opponentHp)
      },
      attributes: {
        player: playerAttributes ? { ...playerAttributes } : null,
        opponent: opponentAttributes ? { ...opponentAttributes } : null
      },
      raw: outcome
    });
  }

  const backgroundCandidates = [
    context.backgroundVideo,
    battle.backgroundVideo,
    battle.background && battle.background.video,
    battle.scene && battle.scene.video,
    battle.options && battle.options.backgroundVideo
  ];
  let backgroundVideo = '';
  for (let i = 0; i < backgroundCandidates.length; i += 1) {
    const candidate = backgroundCandidates[i];
    if (typeof candidate === 'string' && candidate) {
      backgroundVideo = candidate;
      break;
    }
  }
  if (!backgroundVideo) {
    backgroundVideo = defaults.backgroundVideo || DEFAULT_BACKGROUND_VIDEO;
  }

  const playerRelatedSources = [
    playerSource,
    battle.player,
    participants.player,
    participants.self,
    fallbackParticipants.player,
    context.player,
    context.profile,
    context.profile && context.profile.member,
    context.profile && context.profile.memberSnapshot,
    context.self,
    context.member,
    context.playerParticipant
  ].filter(Boolean);

  const opponentRelatedSources = [
    opponentSource,
    battle.opponent,
    battle.enemy,
    participants.opponent,
    participants.enemy,
    fallbackParticipants.opponent,
    context.opponent,
    context.enemy,
    context.target,
    context.opponentParticipant,
    context.enemyParticipant,
    context.opponentPreview,
    context.enemyPreview
  ].filter(Boolean);

  const playerAvatar = resolveAvatarFromSources({
    direct: [
      context.playerAvatar,
      context.playerAvatarUrl,
      context.playerIcon,
      context.avatar,
      context.avatarUrl
    ],
    sources: playerRelatedSources
  });

  const opponentAvatar = resolveAvatarFromSources({
    direct: [
      context.opponentAvatar,
      context.opponentAvatarUrl,
      context.opponentIcon,
      context.enemyAvatar,
      context.enemyAvatarUrl
    ],
    sources: opponentRelatedSources
  });

  const playerAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.playerAvatarFrame,
      context.playerFrame,
      context.playerAppearanceFrame,
      context.playerAvatarBorder,
      context.playerBorder,
      context.avatarFrame
    ],
    sources: playerRelatedSources
  });

  const opponentAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.opponentAvatarFrame,
      context.opponentFrame,
      context.opponentAppearanceFrame,
      context.opponentAvatarBorder,
      context.opponentBorder,
      context.enemyAvatarFrame,
      context.enemyFrame
    ],
    sources: opponentRelatedSources
  });

  const playerTitle = resolveTitleSnapshotFromSources({
    direct: [
      context.playerTitle,
      context.playerTitleId,
      context.playerTitleName,
      context.playerTitleImage,
      context.playerAppearanceTitle,
      context.appearanceTitle,
      context.title,
      context.titleId,
      context.titleName
    ],
    sources: playerRelatedSources
  });

  const opponentTitle = resolveTitleSnapshotFromSources({
    direct: [
      context.opponentTitle,
      context.opponentTitleId,
      context.opponentTitleName,
      context.opponentTitleImage,
      context.opponentAppearanceTitle,
      context.enemyTitle,
      context.enemyTitleId,
      context.enemyTitleName,
      context.enemyTitleImage
    ],
    sources: opponentRelatedSources
  });

  return {
    player: {
      id: playerId || 'player',
      name: playerName,
      hp: buildHpState(playerMaxHp, playerMaxHp),
      avatar: playerAvatar || playerPortrait,
      portrait: playerPortrait,
      combatPower: toNumber((playerSource && playerSource.combatPower) || context.playerPower),
      avatarFrame: playerAvatarFrame,
      titleId: playerTitle.id,
      titleImage: playerTitle.image,
      titleName: playerTitle.name,
      attributes: playerAttributes ? { ...playerAttributes } : null,
      summary: {
        damageDealt: Math.round(totals.playerDamageDealt),
        damageTaken: Math.round(totals.playerDamageTaken),
        heal: Math.round(totals.playerHeal)
      }
    },
    opponent: {
      id: opponentId || 'opponent',
      name: opponentName,
      hp: buildHpState(opponentMaxHp, opponentMaxHp),
      avatar: opponentAvatar || opponentPortrait,
      portrait: opponentPortrait,
      combatPower: toNumber((opponentSource && opponentSource.combatPower) || context.opponentPower),
      avatarFrame: opponentAvatarFrame,
      titleId: opponentTitle.id,
      titleImage: opponentTitle.image,
      titleName: opponentTitle.name,
      attributes: opponentAttributes ? { ...opponentAttributes } : null,
      summary: {
        damageDealt: Math.round(totals.enemyDamageDealt),
        damageTaken: Math.round(totals.enemyDamageTaken),
        heal: Math.round(totals.enemyHeal)
      }
    },
    actions,
    backgroundVideo,
    result: {
      victory: !!victory,
      draw: !!draw,
      rounds: Math.max(1, resultRounds || actions.length),
      rewards: resultRewards
    }
  };
}

function extractNumberFromLog(log, pattern) {
  const match = log.match(pattern);
  if (!match || match.length < 2) {
    return 0;
  }
  return formatNumber(Number(match[1]));
}

const DAMAGE_BY_PLAYER_PATTERN = /你造成(?:了)?[^\d]*(\d+)/;
const DAMAGE_BY_ENEMY_PATTERN = /敌方造成(?:了)?[^\d]*(\d+)/;
const PLAYER_HEAL_PATTERN = /你回复了[^\d]*(\d+)/;
const ENEMY_HEAL_PATTERN = /敌方.*回复了[^\d]*(\d+)/;

function parsePveTotals(log = []) {
  return log.reduce(
    (acc, entry) => {
      if (typeof entry !== 'string') {
        return acc;
      }
      acc.playerDamageTaken += extractNumberFromLog(entry, DAMAGE_BY_ENEMY_PATTERN);
      acc.enemyDamageTaken += extractNumberFromLog(entry, DAMAGE_BY_PLAYER_PATTERN);
      acc.playerHeal += extractNumberFromLog(entry, PLAYER_HEAL_PATTERN);
      acc.enemyHeal += extractNumberFromLog(entry, ENEMY_HEAL_PATTERN);
      return acc;
    },
    { playerDamageTaken: 0, enemyDamageTaken: 0, playerHeal: 0, enemyHeal: 0 }
  );
}

function parseRoundFromLog(entry, fallback) {
  const match = typeof entry === 'string' ? entry.match(/第(\d+)回合/) : null;
  if (match && match[1]) {
    return Number(match[1]);
  }
  return fallback;
}

function buildPveActions(battle = {}, context = {}) {
  const timeline = Array.isArray(battle.timeline)
    ? battle.timeline.filter((entry) => entry && typeof entry === 'object')
    : [];
  if (timeline.length && timeline.some((entry) => isStructuredTimelineEntry(entry))) {
    const structured = buildStructuredBattleViewModel({
      battle,
      timeline,
      context,
      defaults: {
        playerName: (context && context.playerName) || '你',
        opponentName: (context && context.opponentName) || '秘境之敌',
        playerPortrait: (context && context.playerPortrait) || DEFAULT_PLAYER_IMAGE,
        opponentPortrait: (context && context.opponentPortrait) || DEFAULT_OPPONENT_IMAGE,
        backgroundVideo: (context && context.backgroundVideo) || DEFAULT_BACKGROUND_VIDEO,
        mode: 'pve'
      },
      fallbackParticipants: {
        player: battle.player || (battle.participants && battle.participants.player) || null,
        opponent:
          battle.enemy ||
          battle.opponent ||
          (battle.participants && (battle.participants.opponent || battle.participants.enemy)) ||
          null
      }
    });
    if (structured) {
      return structured;
    }
  }
  const log = Array.isArray(battle.log) ? battle.log : [];
  const remainingPlayerHp = toNumber(battle.remaining && battle.remaining.playerHp, 0);
  const remainingEnemyHp = toNumber(battle.remaining && battle.remaining.enemyHp, 0);
  const totals = parsePveTotals(log);
  const playerMaxHp = Math.max(remainingPlayerHp + totals.playerDamageTaken - totals.playerHeal, remainingPlayerHp, 1);
  const enemyMaxHp = Math.max(remainingEnemyHp + totals.enemyDamageTaken - totals.enemyHeal, remainingEnemyHp, 1);
  let playerHp = playerMaxHp;
  let enemyHp = enemyMaxHp;
  let playerSkillIndex = 0;
  let enemySkillIndex = 0;

  const actions = [];
  log.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry) {
      return;
    }
    const round = parseRoundFromLog(entry, Math.floor(index / 2) + 1);
    const effects = [];
    let actor = 'player';
    let target = 'opponent';
    let damage = 0;
    let heal = 0;
    let type = 'attack';
    let title = '';
    let description = entry;
    if (/敌方闪避/.test(entry)) {
      actor = 'player';
      target = 'opponent';
      type = 'dodge';
      title = `第${round}回合 · 连击未果`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else if (/你闪避了敌方/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      type = 'dodge';
      title = `第${round}回合 · 身法化影`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else if (/你造成/.test(entry)) {
      actor = 'player';
      target = 'opponent';
      damage = extractNumberFromLog(entry, DAMAGE_BY_PLAYER_PATTERN);
      const crit = /暴击/.test(entry);
      const skillName = PLAYER_SKILL_ROTATION[playerSkillIndex % PLAYER_SKILL_ROTATION.length];
      playerSkillIndex += 1;
      title = `第${round}回合 · ${skillName}`;
      if (crit) {
        effects.push({ type: 'crit', label: '暴击' });
      }
      description = `你施展「${skillName}」，对敌方造成 ${damage} 点伤害${crit ? '（暴击）' : ''}。`;
      enemyHp = clamp(enemyHp - damage, 0, enemyMaxHp);
    } else if (/敌方造成/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      damage = extractNumberFromLog(entry, DAMAGE_BY_ENEMY_PATTERN);
      const crit = /暴击/.test(entry);
      const skillName = OPPONENT_SKILL_ROTATION[enemySkillIndex % OPPONENT_SKILL_ROTATION.length];
      enemySkillIndex += 1;
      title = `第${round}回合 · ${skillName}`;
      if (crit) {
        effects.push({ type: 'crit', label: '暴击' });
      }
      description = `敌方发动「${skillName}」，对你造成 ${damage} 点伤害${crit ? '（暴击）' : ''}。`;
      playerHp = clamp(playerHp - damage, 0, playerMaxHp);
    } else if (/灵血回流/.test(entry)) {
      actor = 'player';
      target = 'player';
      type = 'heal';
      heal = extractNumberFromLog(entry, PLAYER_HEAL_PATTERN);
      title = `第${round}回合 · 灵血回流`;
      effects.push({ type: 'heal', label: '治疗' });
      description = `被动「灵血回流」触发，你回复了 ${heal} 点生命。`;
      playerHp = clamp(playerHp + heal, 0, playerMaxHp);
    } else if (/敌方吸取灵力/.test(entry)) {
      actor = 'opponent';
      target = 'opponent';
      type = 'heal';
      heal = extractNumberFromLog(entry, ENEMY_HEAL_PATTERN);
      title = `第${round}回合 · 吸血诀`;
      effects.push({ type: 'heal', label: '吸血' });
      description = `敌方吸取灵力，恢复 ${heal} 点生命。`;
      enemyHp = clamp(enemyHp + heal, 0, enemyMaxHp);
    } else if (/挑战失败/.test(entry)) {
      actor = 'opponent';
      target = 'player';
      type = 'result';
      title = `第${round}回合 · 持久战`;
      description = entry;
    } else {
      title = `第${round}回合 · 战斗流转`;
    }
    const hp = {
      player: buildHpState(playerMaxHp, playerHp),
      opponent: buildHpState(enemyMaxHp, enemyHp)
    };
    actions.push({
      id: `pve-${index}`,
      round,
      actor,
      target,
      type,
      damage,
      heal,
      description,
      title,
      effects,
      hp,
      raw: entry
    });
  });

  if (battle.victory || battle.draw || log.length) {
    const outcomeTitle = battle.victory ? '胜利' : battle.draw ? '势均力敌' : '惜败';
    const hp = {
      player: buildHpState(playerMaxHp, remainingPlayerHp || playerHp),
      opponent: buildHpState(enemyMaxHp, remainingEnemyHp || enemyHp)
    };
    actions.push({
      id: 'pve-result',
      round: toNumber(battle.rounds, actions.length + 1),
      actor: battle.victory ? 'player' : battle.draw ? 'neutral' : 'opponent',
      target: 'neutral',
      type: 'result',
      description: battle.victory
        ? '你成功击败敌人，秘境更进一步。'
        : battle.draw
        ? '双方筋疲力尽，战斗以平局告终。'
        : '战斗告一段落，敌人仍旧伺机而动。',
      title: `战斗结果 · ${outcomeTitle}`,
      effects: [],
      hp
    });
  }

  const playerName = (context && context.playerName) || '你';
  const opponentName = (context && context.opponentName) || '秘境之敌';

  const playerPortrait = resolvePortrait(context && context.playerPortrait, DEFAULT_PLAYER_IMAGE);
  const opponentPortrait = resolvePortrait(context && context.opponentPortrait, DEFAULT_OPPONENT_IMAGE);

  const participants = battle.participants || {};
  const playerRelatedSources = [
    battle.player,
    participants.player,
    participants.self,
    context.player,
    context.profile,
    context.profile && context.profile.member,
    context.profile && context.profile.memberSnapshot,
    context.self,
    context.member
  ].filter(Boolean);

  const opponentRelatedSources = [
    battle.enemy,
    battle.opponent,
    participants.opponent,
    participants.enemy,
    context.opponent,
    context.enemy,
    context.target,
    context.opponentParticipant,
    context.enemyParticipant,
    context.opponentPreview,
    context.enemyPreview
  ].filter(Boolean);

  const playerAvatar = resolveAvatarFromSources({
    direct: [
      context.playerAvatar,
      context.playerAvatarUrl,
      context.avatar,
      context.avatarUrl
    ],
    sources: playerRelatedSources
  });

  const opponentAvatar = resolveAvatarFromSources({
    direct: [
      context.opponentAvatar,
      context.opponentAvatarUrl,
      context.enemyAvatar,
      context.enemyAvatarUrl
    ],
    sources: opponentRelatedSources
  });

  const playerAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.playerAvatarFrame,
      context.playerFrame,
      context.playerAppearanceFrame,
      context.playerAvatarBorder,
      context.playerBorder,
      context.avatarFrame
    ],
    sources: playerRelatedSources
  });

  const opponentAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.opponentAvatarFrame,
      context.opponentFrame,
      context.opponentAppearanceFrame,
      context.opponentAvatarBorder,
      context.opponentBorder,
      context.enemyAvatarFrame,
      context.enemyFrame
    ],
    sources: opponentRelatedSources
  });

  return {
    player: {
      id: 'player',
      name: playerName,
      hp: buildHpState(playerMaxHp, playerMaxHp),
      avatar: playerAvatar || playerPortrait,
      portrait: playerPortrait,
      combatPower: toNumber(battle.combatPower && battle.combatPower.player),
      avatarFrame: playerAvatarFrame,
      attributes: ensureAttributesObject(context && context.playerAttributes),
      summary: {
        damageDealt: totals.enemyDamageTaken,
        damageTaken: totals.playerDamageTaken,
        heal: totals.playerHeal
      }
    },
    opponent: {
      id: 'opponent',
      name: opponentName,
      hp: buildHpState(enemyMaxHp, enemyMaxHp),
      avatar: opponentAvatar || opponentPortrait,
      portrait: opponentPortrait,
      combatPower: toNumber(battle.combatPower && battle.combatPower.enemy),
      avatarFrame: opponentAvatarFrame,
      attributes: ensureAttributesObject(context && context.opponentAttributes),
      summary: {
        damageDealt: totals.playerDamageTaken,
        damageTaken: totals.enemyDamageTaken,
        heal: totals.enemyHeal
      }
    },
    actions,
    backgroundVideo: context && context.backgroundVideo ? context.backgroundVideo : DEFAULT_BACKGROUND_VIDEO,
    result: {
      victory: !!battle.victory,
      draw: !!battle.draw,
      rounds: toNumber(battle.rounds, actions.length),
      rewards: battle.rewards || null
    }
  };
}

function buildPvpActions(battle = {}, context = {}) {
  const timeline = Array.isArray(battle.timeline)
    ? battle.timeline.filter((entry) => entry && typeof entry === 'object')
    : [];
  if (timeline.length && timeline.some((entry) => isStructuredTimelineEntry(entry))) {
    const structured = buildStructuredBattleViewModel({
      battle,
      timeline,
      context,
      defaults: {
        playerName:
          (context && context.playerName) ||
          (battle.player && (battle.player.displayName || battle.player.name)) ||
          '我方',
        opponentName:
          (context && context.opponentName) ||
          (battle.opponent && (battle.opponent.displayName || battle.opponent.name)) ||
          '对手',
        playerPortrait:
          (context && context.playerPortrait) ||
          resolvePortrait(battle.player, DEFAULT_PLAYER_IMAGE),
        opponentPortrait:
          (context && context.opponentPortrait) ||
          resolvePortrait(battle.opponent, DEFAULT_OPPONENT_IMAGE),
        backgroundVideo: (context && context.backgroundVideo) || DEFAULT_BACKGROUND_VIDEO,
        mode: 'pvp'
      },
      fallbackParticipants: {
        player: battle.player || null,
        opponent: battle.opponent || null
      }
    });
    if (structured) {
      return structured;
    }
  }
  const rounds = Array.isArray(battle.legacyRounds)
    ? battle.legacyRounds
    : Array.isArray(battle.rounds) && !Number.isFinite(battle.rounds)
    ? battle.rounds
    : [];
  const playerName = (battle.player && battle.player.displayName) || (context && context.playerName) || '我方';
  const opponentName = (battle.opponent && battle.opponent.displayName) || (context && context.opponentName) || '对手';
  const playerId = battle.player ? battle.player.memberId : '';
  const opponentId = battle.opponent ? battle.opponent.memberId : '';
  const playerMaxHp = Math.max(toNumber(battle.player && battle.player.maxHp, 1), 1);
  const opponentMaxHp = Math.max(toNumber(battle.opponent && battle.opponent.maxHp, 1), 1);
  let playerHp = playerMaxHp;
  let opponentHp = opponentMaxHp;
  let playerSkillIndex = 0;
  let opponentSkillIndex = 0;

  const actions = rounds.map((entry, index) => {
    const roundNumber = toNumber(entry.round, Math.floor(index / 2) + 1);
    const actorIsPlayer = entry.actorId === playerId;
    const actor = actorIsPlayer ? 'player' : 'opponent';
    const target = actorIsPlayer ? 'opponent' : 'player';
    const actorName = actorIsPlayer ? playerName : opponentName;
    const targetName = actorIsPlayer ? opponentName : playerName;
    const effects = [];
    let description = '';
    let title = '';
    let damage = formatNumber(entry.damage);
    let heal = formatNumber(entry.heal);
    const dodged = !!entry.dodged;

    if (dodged) {
      title = `第${roundNumber}回合 · 身法化解`;
      description = `${targetName} 看穿了 ${actorName} 的出手，轻巧闪避。`;
      effects.push({ type: 'dodge', label: '闪避' });
    } else {
      const skillName = actorIsPlayer
        ? PLAYER_SKILL_ROTATION[playerSkillIndex % PLAYER_SKILL_ROTATION.length]
        : OPPONENT_SKILL_ROTATION[opponentSkillIndex % OPPONENT_SKILL_ROTATION.length];
      if (actorIsPlayer) {
        playerSkillIndex += 1;
      } else {
        opponentSkillIndex += 1;
      }
      title = `第${roundNumber}回合 · ${skillName}`;
      description = `${actorName} 施展「${skillName}」，对 ${targetName} 造成 ${damage} 点伤害`;
      if (entry.crit) {
        effects.push({ type: 'crit', label: '暴击' });
        description += '（暴击）';
      }
      description += '。';
    }

    if (heal > 0) {
      const healLabel = actorIsPlayer ? '灵息护体' : '嗜血之力';
      effects.push({ type: 'heal', label: '回复' });
      description += ` ${actorName} 的${healLabel}效果触发，恢复 ${heal} 点生命。`;
    }

    if (!dodged) {
      const remaining = clamp(toNumber(entry.targetRemainingHp, target === 'player' ? playerHp : opponentHp), 0, target === 'player' ? playerMaxHp : opponentMaxHp);
      if (target === 'player') {
        playerHp = remaining;
      } else {
        opponentHp = remaining;
      }
    }
    if (heal > 0) {
      if (actor === 'player') {
        playerHp = clamp(playerHp + heal, 0, playerMaxHp);
      } else {
        opponentHp = clamp(opponentHp + heal, 0, opponentMaxHp);
      }
    }

    const hp = {
      player: buildHpState(playerMaxHp, playerHp),
      opponent: buildHpState(opponentMaxHp, opponentHp)
    };

    return {
      id: `pvp-${index}`,
      round: roundNumber,
      actor,
      target,
      type: dodged ? 'dodge' : 'attack',
      damage,
      heal,
      description,
      title,
      effects,
      hp,
      raw: entry
    };
  });

  const hp = {
    player: buildHpState(playerMaxHp, toNumber(battle.player && battle.player.remainingHp, playerHp)),
    opponent: buildHpState(opponentMaxHp, toNumber(battle.opponent && battle.opponent.remainingHp, opponentHp))
  };

  actions.push({
    id: 'pvp-result',
    round: actions.length ? actions[actions.length - 1].round : 1,
    actor: battle.draw ? 'neutral' : battle.winnerId === playerId ? 'player' : 'opponent',
    target: 'neutral',
    type: 'result',
    damage: 0,
    heal: 0,
    title: battle.draw ? '战斗结果 · 平局' : battle.winnerId === playerId ? '战斗结果 · 胜利' : '战斗结果 · 惜败',
    description: battle.draw
      ? '双方斗得难分难解，本场切磋以平局收场。'
      : battle.winnerId === playerId
      ? '你技高一筹，成功拿下这场比武。'
      : '对手更胜一筹，继续修炼再战。',
    effects: [],
    hp,
    attributes: {
      player: ensureAttributesObject(context && context.playerAttributes),
    opponent: ensureAttributesObject(context && context.opponentAttributes)
    }
  });

  const playerPortrait = resolvePortrait(context && context.playerPortrait, DEFAULT_PLAYER_IMAGE);
  const opponentPortrait = resolvePortrait(context && context.opponentPortrait, DEFAULT_OPPONENT_IMAGE);
  const participants = battle.participants || {};
  const playerRelatedSources = [
    battle.player,
    participants.player,
    participants.self,
    context.player,
    context.profile,
    context.profile && context.profile.member,
    context.profile && context.profile.memberSnapshot,
    context.self,
    context.member
  ].filter(Boolean);

  const opponentRelatedSources = [
    battle.opponent,
    battle.enemy,
    participants.opponent,
    participants.enemy,
    context.opponent,
    context.enemy,
    context.target,
    context.opponentParticipant,
    context.enemyParticipant,
    context.opponentPreview,
    context.enemyPreview
  ].filter(Boolean);

  const playerAvatar = resolveAvatarFromSources({
    direct: [
      context.playerAvatar,
      context.playerAvatarUrl,
      context.avatar,
      context.avatarUrl
    ],
    sources: playerRelatedSources
  });

  const opponentAvatar = resolveAvatarFromSources({
    direct: [
      context.opponentAvatar,
      context.opponentAvatarUrl,
      context.enemyAvatar,
      context.enemyAvatarUrl
    ],
    sources: opponentRelatedSources
  });

  const playerAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.playerAvatarFrame,
      context.playerFrame,
      context.playerAppearanceFrame,
      context.playerAvatarBorder,
      context.playerBorder,
      context.avatarFrame
    ],
    sources: playerRelatedSources
  });

  const opponentAvatarFrame = resolveAvatarFrameFromSources({
    direct: [
      context.opponentAvatarFrame,
      context.opponentFrame,
      context.opponentAppearanceFrame,
      context.opponentAvatarBorder,
      context.opponentBorder,
      context.enemyAvatarFrame,
      context.enemyFrame
    ],
    sources: opponentRelatedSources
  });

  return {
    player: {
      id: playerId || 'player',
      name: playerName,
      hp: buildHpState(playerMaxHp, playerMaxHp),
      avatar: playerAvatar || playerPortrait,
      portrait: playerPortrait,
      combatPower: toNumber(context && context.playerPower),
      avatarFrame: playerAvatarFrame,
      attributes: ensureAttributesObject(context && context.playerAttributes),
      summary: {
        damageDealt: rounds.reduce((total, entry) => (entry.actorId === playerId ? total + formatNumber(entry.damage) : total), 0),
        damageTaken: rounds.reduce((total, entry) => (entry.targetId === playerId ? total + formatNumber(entry.damage) : total), 0),
        heal: rounds.reduce((total, entry) => (entry.actorId === playerId ? total + formatNumber(entry.heal) : total), 0)
      }
    },
    opponent: {
      id: opponentId || 'opponent',
      name: opponentName,
      hp: buildHpState(opponentMaxHp, opponentMaxHp),
      avatar: opponentAvatar || opponentPortrait,
      portrait: opponentPortrait,
      combatPower: toNumber(context && context.opponentPower),
      avatarFrame: opponentAvatarFrame,
      attributes: ensureAttributesObject(context && context.opponentAttributes),
      summary: {
        damageDealt: rounds.reduce((total, entry) => (entry.actorId === opponentId ? total + formatNumber(entry.damage) : total), 0),
        damageTaken: rounds.reduce((total, entry) => (entry.targetId === opponentId ? total + formatNumber(entry.damage) : total), 0),
        heal: rounds.reduce((total, entry) => (entry.actorId === opponentId ? total + formatNumber(entry.heal) : total), 0)
      }
    },
    actions,
    backgroundVideo: context && context.backgroundVideo ? context.backgroundVideo : DEFAULT_BACKGROUND_VIDEO,
    result: {
      victory: !!(!battle.draw && battle.winnerId === playerId),
      draw: !!battle.draw,
      rounds: actions.length,
      rewards: null
    }
  };
}

function createBattleViewModel({ mode = 'pve', battle = {}, context = {} } = {}) {
  if (mode === 'pvp') {
    return buildPvpActions(battle, context);
  }
  return buildPveActions(battle, context);
}

module.exports = {
  createBattleViewModel,
  buildPveActions,
  buildPvpActions,
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_PLAYER_IMAGE,
  DEFAULT_OPPONENT_IMAGE
};
