import { MemberService } from './api';

const listeners = new Set();
let watcher = null;
let activeMemberId = '';
let ensurePromise = null;
let restartTimer = null;

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

function scheduleRestart() {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startWatcher();
  }, 2000);
}

function startWatcher() {
  if (!activeMemberId || watcher) {
    return;
  }
  if (!wx.cloud || typeof wx.cloud.database !== 'function') {
    return;
  }
  try {
    watcher = wx
      .cloud
      .database()
      .collection('members')
      .doc(activeMemberId)
      .watch({
        onChange(snapshot) {
          if (!snapshot) {
            return;
          }
          notify({ type: 'memberChanged', snapshot });
        },
        onError(error) {
          console.error('[member-realtime] watch error', error);
          stopWatcher();
          scheduleRestart();
        }
      });
  } catch (error) {
    console.error('[member-realtime] start watcher failed', error);
    stopWatcher();
    scheduleRestart();
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
  setGlobalMember(member);
  notify({ type: 'memberSnapshot', member });
  startWatcher();
}

export function ensureWatcher() {
  if (activeMemberId) {
    startWatcher();
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
}
