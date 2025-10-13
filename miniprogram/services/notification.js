const NOTIFICATION_AUDIO_BASE64 =
  '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';

let audioContext = null;
let audioReady = false;
let audioOptionApplied = false;
let audioPreparePromise = null;
let audioFilePromise = null;
let audioFilePath = '';

function resolveAudioFilePath() {
  if (typeof wx === 'undefined' || !wx || !wx.env || !wx.env.USER_DATA_PATH) {
    return '';
  }
  return `${wx.env.USER_DATA_PATH}/admin-notification.wav`;
}

function ensureAudioFile() {
  if (audioFilePath) {
    return Promise.resolve(audioFilePath);
  }
  if (audioFilePromise) {
    return audioFilePromise;
  }
  if (typeof wx === 'undefined' || !wx || typeof wx.getFileSystemManager !== 'function') {
    return Promise.resolve('');
  }
  const fs = wx.getFileSystemManager();
  const filePath = resolveAudioFilePath();
  if (!filePath) {
    return Promise.resolve('');
  }
  const promise = new Promise((resolve) => {
    try {
      fs.access({
        path: filePath,
        success: () => {
          audioFilePath = filePath;
          resolve(audioFilePath);
        },
        fail: () => {
          fs.writeFile({
            filePath,
            data: NOTIFICATION_AUDIO_BASE64,
            encoding: 'base64',
            success: () => {
              audioFilePath = filePath;
              resolve(audioFilePath);
            },
            fail: (error) => {
              console.error('[notification] write audio file failed', error);
              resolve('');
            }
          });
        }
      });
    } catch (error) {
      console.error('[notification] access audio file failed', error);
      resolve('');
    }
  });
  audioFilePromise = promise.finally(() => {
    audioFilePromise = null;
  });
  return audioFilePromise;
}

function ensureAudioContext() {
  if (typeof wx === 'undefined' || !wx || typeof wx.createInnerAudioContext !== 'function') {
    return Promise.resolve(null);
  }
  if (!audioOptionApplied && typeof wx.setInnerAudioOption === 'function') {
    try {
      wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
    } catch (error) {
      console.error('[notification] setInnerAudioOption failed', error);
    }
    audioOptionApplied = true;
  }
  if (audioContext && audioReady) {
    return Promise.resolve(audioContext);
  }
  if (audioPreparePromise) {
    return audioPreparePromise;
  }
  const preparation = (async () => {
    let context = audioContext;
    if (!context) {
      try {
        context = wx.createInnerAudioContext();
      } catch (error) {
        console.error('[notification] createInnerAudioContext failed', error);
        audioContext = null;
        audioReady = false;
        return null;
      }
      context.autoplay = false;
      context.loop = false;
      context.volume = 1;
      context.obeyMuteSwitch = false;
      audioContext = context;
    }
    const filePath = await ensureAudioFile();
    if (!filePath) {
      audioReady = false;
      return context;
    }
    if (context.src !== filePath) {
      context.src = filePath;
    }
    audioReady = true;
    return context;
  })();
  audioPreparePromise = preparation
    .catch((error) => {
      console.error('[notification] prepare audio context failed', error);
      return null;
    })
    .finally(() => {
      audioPreparePromise = null;
    });
  return audioPreparePromise;
}

export function playAdminNotificationSound() {
  return ensureAudioContext()
    .then((context) => {
      if (!context || !audioReady) {
        return;
      }
      try {
        context.stop();
      } catch (error) {
        // stop may fail if context has not started; ignore quietly.
      }
      try {
        context.play();
      } catch (error) {
        console.error('[notification] play sound failed', error);
      }
    })
    .catch((error) => {
      console.error('[notification] play sound promise failed', error);
    });
}

export function destroyNotificationAudio() {
  if (audioContext && typeof audioContext.destroy === 'function') {
    try {
      audioContext.destroy();
    } catch (error) {
      console.error('[notification] destroy audio context failed', error);
    }
  }
  audioContext = null;
  audioReady = false;
}
