const ATTRIBUTE_KEYS = ['attributePoints', 'pendingAttributePoints'];

function normalizePointValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.floor(numeric));
}

function pickLargestCandidate(candidates = []) {
  let max = null;
  candidates.forEach((value) => {
    const normalized = normalizePointValue(value);
    if (normalized !== null) {
      if (max === null || normalized > max) {
        max = normalized;
      }
    }
  });
  return max;
}

export function extractPendingAttributePointCountFromProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const candidates = [];

  ATTRIBUTE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(profile, key)) {
      candidates.push(profile[key]);
    }
  });

  const attributes = profile.attributes && typeof profile.attributes === 'object' ? profile.attributes : null;
  if (attributes) {
    ATTRIBUTE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(attributes, key)) {
        candidates.push(attributes[key]);
      }
    });
  }

  const summary = profile.attributeSummary && typeof profile.attributeSummary === 'object'
    ? profile.attributeSummary
    : null;
  if (summary) {
    ATTRIBUTE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        candidates.push(summary[key]);
      }
    });
  }

  return pickLargestCandidate(candidates);
}

export function extractPendingAttributePointCountFromMember(member) {
  if (!member || typeof member !== 'object') {
    return null;
  }
  const candidates = [];

  ATTRIBUTE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(member, key)) {
      candidates.push(member[key]);
    }
  });

  const summary = member.attributeSummary && typeof member.attributeSummary === 'object'
    ? member.attributeSummary
    : null;
  if (summary) {
    ATTRIBUTE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        candidates.push(summary[key]);
      }
    });
  }

  const profile = member.pveProfile && typeof member.pveProfile === 'object' ? member.pveProfile : null;
  if (profile) {
    const profilePoints = extractPendingAttributePointCountFromProfile(profile);
    if (profilePoints !== null) {
      candidates.push(profilePoints);
    }
  }

  return pickLargestCandidate(candidates);
}

export function resolveTimestamp(value) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) {
      return value;
    }
    if (value > 1e9) {
      return Math.floor(value * 1000);
    }
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) {
        return numeric;
      }
      if (numeric > 1e9) {
        return Math.floor(numeric * 1000);
      }
      return Math.floor(numeric);
    }
    return 0;
  }
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      if (date instanceof Date) {
        const time = date.getTime();
        return Number.isNaN(time) ? 0 : time;
      }
    }
    if (typeof value.getTime === 'function') {
      const time = value.getTime();
      if (Number.isFinite(time)) {
        return time;
      }
    }
    if (typeof value.seconds === 'number') {
      const seconds = Number(value.seconds) || 0;
      const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
      return Math.floor(seconds * 1000 + nanoseconds / 1e6);
    }
  }
  return 0;
}

export function readPendingAttributeOverride() {
  try {
    const app = getApp();
    if (!app || !app.globalData) {
      return null;
    }
    const state = app.globalData.rolePendingAttributes;
    if (!state || typeof state !== 'object') {
      return null;
    }
    const points = normalizePointValue(state.points);
    if (points === null) {
      return null;
    }
    const updatedAt = resolveTimestamp(state.updatedAt);
    return { points, updatedAt };
  } catch (error) {
    return null;
  }
}

export function writePendingAttributeOverride(points, updatedAt = Date.now()) {
  try {
    const app = getApp();
    if (!app || !app.globalData) {
      return;
    }
    const normalizedPoints = normalizePointValue(points);
    if (normalizedPoints === null) {
      return;
    }
    const timestamp = resolveTimestamp(updatedAt) || Date.now();
    app.globalData.rolePendingAttributes = {
      points: normalizedPoints,
      updatedAt: timestamp
    };
  } catch (error) {
    // ignore global state write failures
  }
}

export function shouldShowRoleBadge(member) {
  const memberPoints = extractPendingAttributePointCountFromMember(member);
  const memberUpdatedAt = member ? resolveTimestamp(member.updatedAt) : 0;
  const override = readPendingAttributeOverride();

  if (override) {
    const overridePoints = override.points;
    const overrideUpdatedAt = override.updatedAt || 0;

    if (memberUpdatedAt && memberUpdatedAt > overrideUpdatedAt) {
      const resolvedPoints = memberPoints !== null ? memberPoints : 0;
      writePendingAttributeOverride(resolvedPoints, memberUpdatedAt);
      return resolvedPoints > 0;
    }

    if (memberPoints !== null) {
      if (!memberUpdatedAt || memberUpdatedAt === overrideUpdatedAt) {
        return memberPoints > 0 || overridePoints > 0;
      }
      if (memberUpdatedAt < overrideUpdatedAt) {
        return overridePoints > 0;
      }
    }

    if (memberPoints === null) {
      return overridePoints > 0;
    }

    return memberPoints > 0 || overridePoints > 0;
  }

  if (memberPoints !== null) {
    if (memberUpdatedAt) {
      writePendingAttributeOverride(memberPoints, memberUpdatedAt);
    }
    return memberPoints > 0;
  }

  return false;
}
