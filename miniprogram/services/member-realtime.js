import { MemberService } from './api';

const { normalizeAvatarFrameValue } = require('../shared/avatar-frames.js');
const { normalizeBackgroundId } = require('../shared/backgrounds.js');
const { registerCustomTitles, normalizeTitleCatalog } = require('../shared/titles.js');

const MAX_WATCH_RESTART_ATTEMPTS = 5;
const WATCH_RETRY_DELAY = 2000;
const WATCH_SUSPEND_DURATION = 60000;
const MANUAL_REFRESH_INTERVAL = 15000;

const listeners = new Set();
let watcher = null;
let extrasWatcher = null;
let activeMemberId = '';
let ensurePromise = null;
let restartTimer = null;
let restartAttempts = 0;
let watcherSuspendedUntil = 0;
let manualRefreshTimer = null;
let manualRefreshPromise = null;

function sanitizeAvatarFrame(value) {
  return normalizeAvatarFrameValue(typeof value === 'string' ? value : '');
}

function sanitizeMemberSnapshot(member) {
  if (!member || typeof member !== 'object') {
    return null;
  }
  const sanitized = { ...member };
  sanitized.avatarFrame = sanitizeAvatarFrame(sanitized.avatarFrame);
  sanitized.appearanceBackground = normalizeBackgroundId(sanitized.appearanceBackground || '');
  sanitized.appearanceBackgroundAnimated = !!sanitized.appearanceBackgroundAnimated;
  const titleCatalog = normalizeTitleCatalog(sanitized.titleCatalog);
  sanitized.titleCatalog = titleCatalog;
  registerCustomTitles(titleCatalog);
  return sanitized;
}

function cloneProxySession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }
  const clone = {
    sessionId: typeof session.sessionId === 'string' ? session.sessionId : '',
    adminId: typeof session.adminId === 'string' ? session.adminId : '',
    adminName: typeof session.adminName === 'string' ? session.adminName : '',
    targetMemberId: typeof session.targetMemberId === 'string' ? session.targetMemberId : '',
    targetMemberName: typeof session.targetMemberName === 'string' ? session.targetMemberName : '',
    active: session.active !== false
  };
  if (session.startedAt) {
    clone.startedAt = session.startedAt;
  }
  if (session.endedAt) {
    clone.endedAt = session.endedAt;
  }
  return clone;
}

function getDatabaseInstance() {
  const canUseDatabase = wx.cloud && typeof wx.cloud.database === 'function';
  if (!canUseDatabase) {
    return null;
  }
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData && app.globalData.env) {
        return wx.cloud.database({ env: app.globalData.env });
      }
    }
  } catch (error) {
    console.error('[member-realtime] resolve database failed', error);
  }
  return wx.cloud.database();
}

function notify(event) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error('[member-realtime] listener error', error);
    }
  });
}

function setGlobalMember(member, options = {}) {
  try {
    if (typeof getApp !== 'function') {
      return;
    }
    const app = getApp();
    if (!app || !app.globalData) {
      return;
    }
    let sanitizedMember = member ? { ...member } : null;
    const memberId =
      sanitizedMember && typeof sanitizedMember === 'object'
        ? sanitizedMember._id || sanitizedMember.id || ''
        : '';
    const incomingSession = cloneProxySession(member && member.proxySession);
    const existingSession = cloneProxySession(app.globalData.proxySession);
    let sessionToApply = incomingSession || null;
    if (options && options.resetProxySession) {
      sessionToApply = incomingSession || null;
    } else if (!sessionToApply && existingSession) {
      if (!memberId || memberId === existingSession.targetMemberId) {
        sessionToApply = existingSession;
      }
    }
    if (sessionToApply && sessionToApply.active === false) {
      sessionToApply = null;
    }
    if (sanitizedMember) {
      if (sessionToApply) {
        sanitizedMember.proxySession = sessionToApply;
      } else if (Object.prototype.hasOwnProperty.call(sanitizedMember, 'proxySession')) {
        delete sanitizedMember.proxySession;
      }
    }
    app.globalData.memberInfo = sanitizedMember;
    app.globalData.proxySession = sessionToApply;
  } catch (error) {
    console.error('[member-realtime] set global member failed', error);
  }
}

function notifyMemberSnapshot(member, origin = 'unknown') {
  const sanitized = sanitizeMemberSnapshot(member);
  if (!sanitized) {
    return;
  }
  setGlobalMember(sanitized);
  notify({ type: 'memberSnapshot', member: sanitized, origin });
}

function stopManualRefresh() {
  if (manualRefreshTimer) {
    clearInterval(manualRefreshTimer);
    manualRefreshTimer = null;
  }
}

function refreshMemberSnapshot() {
  if (!activeMemberId) {
    return Promise.resolve();
  }
  if (manualRefreshPromise) {
    return manualRefreshPromise;
  }
  manualRefreshPromise = MemberService.getMember()
    .then((member) => {
      if (member) {
        notifyMemberSnapshot(member, 'manualRefresh');
      }
    })
    .catch((error) => {
      console.error('[member-realtime] manual refresh failed', error);
    })
    .finally(() => {
      manualRefreshPromise = null;
    });
  return manualRefreshPromise;
}

function startManualRefresh() {
  if (manualRefreshTimer || !activeMemberId) {
    return;
  }
  refreshMemberSnapshot();
  manualRefreshTimer = setInterval(() => {
    refreshMemberSnapshot();
  }, MANUAL_REFRESH_INTERVAL);
}

function stopWatcher() {
  if (watcher && typeof watcher.close === 'function') {
    try {
      watcher.close();
    } catch (error) {
      console.error('[member-realtime] close watcher failed', error);
    }
  }
  watcher = null;
  if (extrasWatcher && typeof extrasWatcher.close === 'function') {
    try {
      extrasWatcher.close();
    } catch (error) {
      console.error('[member-realtime] close extras watcher failed', error);
    }
  }
  extrasWatcher = null;
}

function disableWatcherTemporarily(error) {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  watcherSuspendedUntil = Date.now() + WATCH_SUSPEND_DURATION;
  startManualRefresh();
  console.warn('[member-realtime] realtime suspended after repeated failures', error);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    watcherSuspendedUntil = 0;
    restartAttempts = 0;
    startWatcher();
  }, WATCH_SUSPEND_DURATION);
}

function scheduleRestart(error) {
  if (restartTimer || !activeMemberId) {
    return;
  }
  if (restartAttempts >= MAX_WATCH_RESTART_ATTEMPTS) {
    disableWatcherTemporarily(error);
    return;
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startWatcher();
  }, WATCH_RETRY_DELAY);
}

function startWatcher() {
  if (!activeMemberId || watcher) {
    return;
  }
  if (watcherSuspendedUntil && watcherSuspendedUntil > Date.now()) {
    startManualRefresh();
    return;
  }
  const db = getDatabaseInstance();
  if (!db) {
    return;
  }
  stopManualRefresh();
  try {
    watcher = db
      .collection('members')
      .doc(activeMemberId)
      .watch({
        onChange(snapshot) {
          restartAttempts = 0;
          if (!snapshot) {
            return;
          }
          notify({ type: 'memberChanged', snapshot });
        },
        onError(error) {
          restartAttempts += 1;
          console.error('[member-realtime] watch error', error);
          stopWatcher();
          scheduleRestart(error);
        }
      });
    startExtrasWatcher(db);
  } catch (error) {
    restartAttempts += 1;
    console.error('[member-realtime] start watcher failed', error);
    stopWatcher();
    scheduleRestart(error);
  }
}

function startExtrasWatcher(db) {
  if (!db || !activeMemberId || extrasWatcher) {
    return;
  }
  try {
    extrasWatcher = db
      .collection('memberExtras')
      .doc(activeMemberId)
      .watch({
        onChange(snapshot) {
          restartAttempts = 0;
          if (!snapshot) {
            return;
          }
          notify({ type: 'memberExtrasChanged', snapshot });
        },
        onError(error) {
          restartAttempts += 1;
          console.error('[member-realtime] extras watch error', error);
          if (extrasWatcher && typeof extrasWatcher.close === 'function') {
            try {
              extrasWatcher.close();
            } catch (closeError) {
              console.error('[member-realtime] close extras watcher failed', closeError);
            }
          }
          extrasWatcher = null;
          scheduleRestart(error);
        }
      });
  } catch (error) {
    restartAttempts += 1;
    console.error('[member-realtime] start extras watcher failed', error);
    if (extrasWatcher && typeof extrasWatcher.close === 'function') {
      try {
        extrasWatcher.close();
      } catch (closeError) {
        console.error('[member-realtime] close extras watcher failed', closeError);
      }
    }
    extrasWatcher = null;
    scheduleRestart(error);
  }
}

export function setActiveMember(member) {
  const sanitized = sanitizeMemberSnapshot(member);
  if (!sanitized) {
    return;
  }
  const memberId = sanitized._id || sanitized.id;
  if (!memberId) {
    return;
  }
  activeMemberId = memberId;
  restartAttempts = 0;
  notifyMemberSnapshot(sanitized, 'activeMember');
  startWatcher();
}

export function ensureWatcher() {
  if (activeMemberId) {
    startWatcher();
    if (watcherSuspendedUntil && watcherSuspendedUntil > Date.now()) {
      startManualRefresh();
    }
    return Promise.resolve(activeMemberId);
  }
  if (ensurePromise) {
    return ensurePromise;
  }
  ensurePromise = MemberService.getMember()
    .then((member) => {
      setActiveMember(member);
      return activeMemberId;
    })
    .catch((error) => {
      console.error('[member-realtime] ensure watcher failed', error);
      throw error;
    })
    .finally(() => {
      ensurePromise = null;
    });
  return ensurePromise;
}

export function subscribe(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearListeners() {
  listeners.clear();
  if (!listeners.size) {
    stopManualRefresh();
  }
}
