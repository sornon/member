import { MemberService } from './api';

const MAX_WATCH_RESTART_ATTEMPTS = 5;
const WATCH_RETRY_DELAY = 2000;
const WATCH_SUSPEND_DURATION = 60000;
const MANUAL_REFRESH_INTERVAL = 15000;

const listeners = new Set();
let watcher = null;
let activeMemberId = '';
let ensurePromise = null;
let restartTimer = null;
let restartAttempts = 0;
let watcherSuspendedUntil = 0;
let manualRefreshTimer = null;
let manualRefreshPromise = null;

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

function setGlobalMember(member) {
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.memberInfo = member;
      }
    }
  } catch (error) {
    console.error('[member-realtime] set global member failed', error);
  }
}

function notifyMemberSnapshot(member, origin = 'unknown') {
  if (!member) {
    return;
  }
  setGlobalMember(member);
  notify({ type: 'memberSnapshot', member, origin });
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
  } catch (error) {
    restartAttempts += 1;
    console.error('[member-realtime] start watcher failed', error);
    stopWatcher();
    scheduleRestart(error);
  }
}

export function setActiveMember(member) {
  if (!member || typeof member !== 'object') {
    return;
  }
  const memberId = member._id || member.id;
  if (!memberId) {
    return;
  }
  activeMemberId = memberId;
  restartAttempts = 0;
  notifyMemberSnapshot(member, 'activeMember');
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
