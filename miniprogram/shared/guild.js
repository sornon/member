const { decorateLeaderboardEntries, DEFAULT_AVATAR } = require('./pvp-leaderboard.js');
const { normalizeTitleCatalog, registerCustomTitles } = require('./titles.js');
const { normalizeAvatarFrameValue } = require('./avatar-frames');
const { AVATAR_IMAGE_BASE_PATH } = require('./asset-paths.js');

const DEFAULT_MEMBER_AVATAR = `${AVATAR_IMAGE_BASE_PATH}/default.png`;

function normalizeTicketCandidate(candidate, fallbackSignature = '') {
  if (!candidate) {
    return null;
  }
  if (typeof candidate === 'object') {
    if (candidate.ticket && typeof candidate.ticket === 'string') {
      return {
        ticket: candidate.ticket,
        signature:
          typeof candidate.signature === 'string' && candidate.signature
            ? candidate.signature
            : fallbackSignature || '',
        expiresAt: typeof candidate.expiresAt === 'string' ? candidate.expiresAt : candidate.expireAt || ''
      };
    }
    return null;
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    return {
      ticket: trimmed,
      signature: fallbackSignature || '',
      expiresAt: ''
    };
  }
  return null;
}

function resolveGuildActionTicket(source = {}) {
  if (!source) {
    return null;
  }
  const fallbackSignature =
    (typeof source.signature === 'string' && source.signature) ||
    (typeof source.ticketSignature === 'string' && source.ticketSignature) ||
    '';
  const candidates = [];
  if (source && typeof source === 'object') {
    candidates.push(source);
    candidates.push(source.ticket);
    candidates.push(source.actionTicket);
    if (source.data && typeof source.data === 'object') {
      candidates.push(source.data.ticket);
      candidates.push(source.data.actionTicket);
    }
    if (source.result && typeof source.result === 'object') {
      candidates.push(source.result.ticket);
      candidates.push(source.result.actionTicket);
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeTicketCandidate(candidates[i], fallbackSignature);
    if (normalized && normalized.ticket) {
      return normalized;
    }
  }
  return null;
}

function decorateGuildLeaderboardEntries(entries = []) {
  return decorateLeaderboardEntries(entries, { registerTitles: true });
}

function decorateGuildMembers(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const sanitized = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const avatarUrl = typeof entry.avatarUrl === 'string' && entry.avatarUrl.trim() ? entry.avatarUrl.trim() : DEFAULT_MEMBER_AVATAR;
    const avatarFrame = normalizeAvatarFrameValue(entry.avatarFrame || '');
    const titleCatalog = normalizeTitleCatalog(entry.titleCatalog);
    return {
      ...entry,
      avatarUrl,
      avatarFrame,
      titleCatalog
    };
  });
  const filtered = sanitized.filter(Boolean);
  const catalogs = [];
  filtered.forEach((entry) => {
    if (!Array.isArray(entry.titleCatalog)) {
      return;
    }
    entry.titleCatalog.forEach((item) => {
      if (!item || !item.id) {
        return;
      }
      catalogs.push({ ...item });
    });
  });
  if (catalogs.length) {
    registerCustomTitles(catalogs, { reset: false });
  }
  return filtered;
}

module.exports = {
  resolveGuildActionTicket,
  decorateGuildLeaderboardEntries,
  decorateGuildMembers,
  DEFAULT_GUILD_AVATAR: DEFAULT_AVATAR,
  DEFAULT_MEMBER_AVATAR
};
